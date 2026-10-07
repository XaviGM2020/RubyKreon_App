/* Local linear regression of recorded doses, never a prescription engine. */
(() => {
  'use strict';
  const FEATURES = [
    ['fatG', 'Grasa estimada de la comida (g)'], ['weightKg', 'Peso registrado (kg)'],
    ['bristol48h', 'Bristol medio en las 48 h previas'], ['greasy48h', 'Proporción de aspecto graso observado en las 48 h previas'],
    ['previousUI', 'Última toma registrada antes de la comida (UI)']
  ];
  const MIN_ROWS = 30;
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let model = null;
  function featuresAt(records, timestamp, fatG, mealId = null) {
    const cutoff = new Date(timestamp).getTime();
    if (!Number.isFinite(cutoff) || !Number.isFinite(fatG) || fatG < 0) return null;
    const prior = records.filter(record => new Date(record.timestamp).getTime() < cutoff).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const weight = prior.filter(record => record.type === 'weight').at(-1);
    const previous = prior.filter(record => record.type === 'kreon' && record.mealId !== mealId).at(-1);
    const stools = prior.filter(record => record.type === 'stool' && cutoff - new Date(record.timestamp).getTime() <= 48 * 3600000);
    const observed = stools.filter(record => ['yes', 'no'].includes(record.greasy));
    if (!weight || !previous || !stools.length || !observed.length) return null;
    const x = [fatG, weight.kg, stools.reduce((sum, record) => sum + record.bristol, 0) / stools.length, observed.filter(record => record.greasy === 'yes').length / observed.length, previous.totalUI];
    return x.every(Number.isFinite) ? x : null;
  }
  function dataset(records) {
    const meals = new Map(records.filter(record => record.type === 'meal').map(record => [record.id, record]));
    const groups = new Map(), excluded = { unlinked: 0, noAnalysis: 0, missingHistory: 0, timing: 0 };
    for (const take of records.filter(record => record.type === 'kreon')) {
      if (!take.mealId || !meals.has(take.mealId)) { ++excluded.unlinked; continue; }
      if (!groups.has(take.mealId)) groups.set(take.mealId, []);
      groups.get(take.mealId).push(take);
    }
    const rows = [];
    for (const [id, takes] of groups) {
      const meal = meals.get(id);
      if (!meal.analysis || !Number.isFinite(meal.analysis.totalFat)) { ++excluded.noAnalysis; continue; }
      if (takes.some(take => take.timestamp < meal.timestamp)) { ++excluded.timing; continue; }
      const x = featuresAt(records, meal.timestamp, meal.analysis.totalFat, id);
      if (!x) { ++excluded.missingHistory; continue; }
      const y = takes.reduce((sum, take) => sum + take.totalUI, 0);
      if (!Number.isFinite(y) || y <= 0) continue;
      rows.push({ mealId: id, title: meal.title, timestamp: meal.timestamp, targetAvailableAt: takes.map(take => take.timestamp).sort().at(-1), x, y });
    }
    rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return { rows, excluded };
  }
  function dot(a, b) { return a.reduce((sum, value, i) => sum + value * b[i], 0); }
  function fit(rows) {
    if (rows.length < 10 || rows.some(row => row.x.length !== FEATURES.length || !row.x.every(Number.isFinite) || !Number.isFinite(row.y))) throw new Error('Faltan observaciones válidas para ajustar el modelo.');
    const n = rows.length, p = FEATURES.length;
    const means = FEATURES.map((_, j) => rows.reduce((sum, row) => sum + row.x[j], 0) / n);
    const scales = means.map((mean, j) => Math.sqrt(rows.reduce((sum, row) => sum + (row.x[j] - mean) ** 2, 0) / n));
    const meanY = rows.reduce((sum, row) => sum + row.y, 0) / n;
    const y = rows.map(row => row.y - meanY), q = [], r = [], active = [], omitted = [];
    // Reorthogonalized QR avoids inverting an ill-conditioned normal-equation matrix.
    for (let j = 0; j < p; j++) {
      if (scales[j] < 1e-10 * Math.max(1, Math.abs(means[j]))) { omitted.push({ feature: j, reason: 'sin variación' }); continue; }
      const v = rows.map(row => (row.x[j] - means[j]) / scales[j]);
      const column = Array(q.length).fill(0);
      for (let pass = 0; pass < 2; pass++) for (let k = 0; k < q.length; k++) {
        const projection = dot(q[k], v); column[k] += projection;
        for (let i = 0; i < n; i++) v[i] -= projection * q[k][i];
      }
      const norm = Math.sqrt(dot(v, v));
      if (norm < 1e-8 * Math.sqrt(n)) { omitted.push({ feature: j, reason: 'colineal con otras variables' }); continue; }
      const k = q.length;
      for (let i = 0; i < k; i++) r[i][k] = column[i];
      r.push(Array(k + 1).fill(0)); r[k][k] = norm;
      q.push(v.map(value => value / norm)); active.push(j);
    }
    if (n < Math.max(10, active.length * 3 + 1)) throw new Error('Faltan registros respecto al número de variables del modelo.');
    const standardized = Array(active.length).fill(0), qty = q.map(column => dot(column, y));
    for (let i = active.length - 1; i >= 0; i--) {
      let value = qty[i];
      for (let j = i + 1; j < active.length; j++) value -= r[i][j] * standardized[j];
      standardized[i] = value / r[i][i];
    }
    const coefficients = Array(p).fill(0);
    active.forEach((j, k) => { coefficients[j] = standardized[k] / scales[j]; });
    const intercept = meanY - dot(coefficients, means);
    if (![intercept, ...coefficients].every(Number.isFinite)) throw new Error('No se pudo ajustar un modelo estable con estos registros.');
    return { intercept, coefficients, means, scales, active, omitted, meanY, ranges: FEATURES.map((_, j) => [Math.min(...rows.map(row => row.x[j])), Math.max(...rows.map(row => row.x[j]))]) };
  }
  function predict(fitted, x) {
    if (!Array.isArray(x) || x.length !== FEATURES.length || !x.every(Number.isFinite)) throw new Error('Faltan variables para calcular la predicción estadística.');
    return fitted.intercept + dot(fitted.coefficients, x);
  }
  function score(actual, predicted) {
    const n = actual.length;
    if (!n || n !== predicted.length) throw new Error('No hay datos de validación.');
    const mean = actual.reduce((sum, y) => sum + y, 0) / n;
    const errors = actual.map((y, i) => predicted[i] - y);
    const sse = errors.reduce((sum, e) => sum + e * e, 0), sst = actual.reduce((sum, y) => sum + (y - mean) ** 2, 0);
    return { mae: errors.reduce((sum, e) => sum + Math.abs(e), 0) / n, rmse: Math.sqrt(sse / n), r2: sst > 1e-10 ? 1 - sse / sst : null };
  }
  function train(rows) {
    if (rows.length < MIN_ROWS) throw new Error(`Se necesitan al menos ${MIN_ROWS} comidas con tomas asociadas y todas las variables previas; hay ${rows.length}.`);
    const split = Math.floor(rows.length * .8), test = rows.slice(split);
    // Labels from a late-linked take must also have been available before validation starts.
    const training = rows.slice(0, split).filter(row => (row.targetAvailableAt || row.timestamp) < test[0].timestamp);
    if (training.length < 10) throw new Error('Faltan comidas de entrenamiento cuyas tomas fueran conocidas antes de la validación.');
    if (training.at(-1).timestamp === test[0].timestamp) throw new Error('La separación temporal coincide en la misma hora. Revisa los registros duplicados.');
    const fitted = fit(training), estimates = test.map(row => predict(fitted, row.x));
    return { ...fitted, trainingCount: training.length, testCount: test.length, trainingEnd: training.at(-1).timestamp,
      metrics: score(test.map(row => row.y), estimates), meanBaseline: score(test.map(row => row.y), test.map(() => fitted.meanY)), previousDoseBaseline: score(test.map(row => row.y), test.map(row => row.x[4])),
      validation: test.map((row, i) => ({ ...row, predicted: estimates[i] })) };
  }
  function formatted(value) { return Number(value).toLocaleString('es-ES', { maximumFractionDigits: 1 }); }
  function init() {
    const panel = document.createElement('div'); panel.className = 'card diary-form'; panel.id = 'regression-panel';
    panel.innerHTML = `<h2>Regresión lineal del historial</h2><p class="help">Predice las UI registradas por comida a partir de grasa estimada, peso, Bristol medio y aspecto graso en las 48 horas previas, y última toma. Aprende el patrón de tus registros; no la dosis terapéutica adecuada. No modifica tu pauta ni se convierte en cápsulas para tomar.</p><p class="help">Utiliza el historial completo, independientemente del filtro de fechas del resumen. Asocia las tomas a sus comidas en Diario. Se necesitan al menos 30 comidas completas. El 80 % más antiguo se reserva para entrenar y el 20 % posterior para evaluar. Tanto las variables como las etiquetas de entrenamiento deben estar disponibles antes de la validación.</p><p id="regression-data" class="help"></p><button type="button" class="btn-save" id="train-regression">Entrenar regresión con mi historial</button><p id="regression-status" role="status" class="help"></p><div id="regression-result"></div>`;
    $('analytics-tools').append(panel);
    const preview = document.createElement('div'); preview.className = 'card diary-form'; preview.id = 'regression-preview';
    preview.innerHTML = '<h2>Predicción estadística del registro</h2><p id="regression-prediction" class="help">Entrena el modelo en Analíticas para explorar las UI que predeciría el historial. Esta cifra no es una indicación de toma.</p>';
    $('capsule-card').after(preview);
    $('train-regression').addEventListener('click', () => {
      try {
        const data = dataset(window.RubyDiary.getEntries());
        model = train(data.rows); renderModel(); renderPrediction();
        $('regression-status').textContent = 'Modelo entrenado localmente, sin enviar datos a ningún proveedor. La evaluación describe predicción del historial, no eficacia ni seguridad del tratamiento.';
      } catch (error) { model = null; $('regression-result').replaceChildren(); $('regression-status').textContent = error.message; renderPrediction(); }
    });
    dataChanged();
  }
  function renderModel() {
    const columns = FEATURES.map(([_, label], j) => `<tr><td>${escape(label)}</td><td>${formatted(model.coefficients[j])}</td><td>${escape(model.omitted.find(item => item.feature === j)?.reason || 'Incluida')}</td></tr>`).join('');
    $('regression-result').innerHTML = `<p class="help">${model.trainingCount} comidas de entrenamiento · ${model.testCount} de validación posterior.</p><div class="analytics-metrics"><div><span>Error absoluto medio</span><strong>${formatted(model.metrics.mae)} UI</strong></div><div><span>Error cuadrático medio (raíz)</span><strong>${formatted(model.metrics.rmse)} UI</strong></div><div><span>R² de validación</span><strong>${model.metrics.r2 == null ? 'No calculable' : formatted(model.metrics.r2)}</strong></div><div><span>Error de usar la última toma</span><strong>${formatted(model.previousDoseBaseline.mae)} UI</strong></div></div><p class="help">Error de usar la media del entrenamiento: ${formatted(model.meanBaseline.mae)} UI. Un buen ajuste no demuestra que la dosis registrada fuese adecuada.</p><div class="diary-table-wrap"><table class="diary-table"><thead><tr><th>Variable</th><th>Coeficiente (UI por unidad)</th><th>Estado</th></tr></thead><tbody><tr><td>Intercepto</td><td>${formatted(model.intercept)}</td><td>Incluido</td></tr>${columns}</tbody></table><table class="diary-table"><thead><tr><th>Validación</th><th>UI registradas</th><th>UI predichas</th></tr></thead><tbody>${model.validation.slice(-10).map(row => `<tr><td>${escape(window.RubyDiary.localDateTime(new Date(row.timestamp)).slice(0, 10))}</td><td>${formatted(row.y)}</td><td>${formatted(row.predicted)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function renderPrediction() {
    if (!$('regression-prediction')) return;
    if (!model) { $('regression-prediction').textContent = 'Entrena el modelo en Analíticas. La predicción del registro es independiente de la combinación de cápsulas según tu pauta.'; return; }
    const meal = window.RubyDiary.getMealAnalysis();
    if (!meal) { $('regression-prediction').textContent = 'Analiza la comida para obtener su grasa estimada. El modelo no indica qué dosis debes tomar.'; return; }
    const x = featuresAt(window.RubyDiary.getEntries(), $('meal-time').value, meal.totalFat);
    if (!x) { $('regression-prediction').textContent = 'Faltan peso, deposiciones con aspecto graso observado en las 48 horas previas o una toma anterior. No se sustituyen datos desconocidos por cero.'; return; }
    const value = predict(model, x);
    const outside = model.ranges.some(([min, max], j) => x[j] < min || x[j] > max);
    $('regression-prediction').textContent = `Predicción del registro: ${formatted(value)} UI. ${value < 0 || outside ? 'Extrapolación fuera de los datos de entrenamiento: no es fiable. ' : ''}Es una salida estadística sin validación clínica; no es una dosis para tomar y no cambia tu pauta.`;
  }
  function dataChanged() {
    if (!$('regression-data')) return;
    const data = dataset(window.RubyDiary.getEntries());
    $('regression-data').textContent = `${data.rows.length} comidas completas. Excluidos: ${data.excluded.unlinked} tomas sin comida asociada; ${data.excluded.noAnalysis} comidas sin grasa estimada; ${data.excluded.missingHistory} sin variables previas completas; ${data.excluded.timing} con tomas anteriores a la fecha de su comida.`;
    model = null; $('regression-result').replaceChildren(); renderPrediction();
  }
  window.RubyRegression = { init, dataChanged, renderPrediction, featuresAt, dataset, fit, predict, score, train, FEATURES };
})();
