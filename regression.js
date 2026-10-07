/* Local linear regression of recorded doses, never a prescription engine. */
(() => {
  'use strict';
  const FEATURES = [
    ['fatG', 'Greix estimat de l’àpat (g)'], ['weightKg', 'Pes registrat (kg)'],
    ['bristol48h', 'Bristol mitjà en les 48 h prèvies'], ['greasy48h', 'Proporció d’aspecte gras observat en les 48 h prèvies'],
    ['previousUI', 'Última presa registrada abans de l’àpat (UI)']
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
    if (rows.length < 10 || rows.some(row => row.x.length !== FEATURES.length || !row.x.every(Number.isFinite) || !Number.isFinite(row.y))) throw new Error('Falten observacions vàlides per ajustar el model.');
    const n = rows.length, p = FEATURES.length;
    const means = FEATURES.map((_, j) => rows.reduce((sum, row) => sum + row.x[j], 0) / n);
    const scales = means.map((mean, j) => Math.sqrt(rows.reduce((sum, row) => sum + (row.x[j] - mean) ** 2, 0) / n));
    const meanY = rows.reduce((sum, row) => sum + row.y, 0) / n;
    const y = rows.map(row => row.y - meanY), q = [], r = [], active = [], omitted = [];
    // Reorthogonalized QR avoids inverting an ill-conditioned normal-equation matrix.
    for (let j = 0; j < p; j++) {
      if (scales[j] < 1e-10 * Math.max(1, Math.abs(means[j]))) { omitted.push({ feature: j, reason: 'sense variació' }); continue; }
      const v = rows.map(row => (row.x[j] - means[j]) / scales[j]);
      const column = Array(q.length).fill(0);
      for (let pass = 0; pass < 2; pass++) for (let k = 0; k < q.length; k++) {
        const projection = dot(q[k], v); column[k] += projection;
        for (let i = 0; i < n; i++) v[i] -= projection * q[k][i];
      }
      const norm = Math.sqrt(dot(v, v));
      if (norm < 1e-8 * Math.sqrt(n)) { omitted.push({ feature: j, reason: 'colineal amb altres variables' }); continue; }
      const k = q.length;
      for (let i = 0; i < k; i++) r[i][k] = column[i];
      r.push(Array(k + 1).fill(0)); r[k][k] = norm;
      q.push(v.map(value => value / norm)); active.push(j);
    }
    if (n < Math.max(10, active.length * 3 + 1)) throw new Error('Falten registres en relació amb el nombre de variables del model.');
    const standardized = Array(active.length).fill(0), qty = q.map(column => dot(column, y));
    for (let i = active.length - 1; i >= 0; i--) {
      let value = qty[i];
      for (let j = i + 1; j < active.length; j++) value -= r[i][j] * standardized[j];
      standardized[i] = value / r[i][i];
    }
    const coefficients = Array(p).fill(0);
    active.forEach((j, k) => { coefficients[j] = standardized[k] / scales[j]; });
    const intercept = meanY - dot(coefficients, means);
    if (![intercept, ...coefficients].every(Number.isFinite)) throw new Error('No s’ha pogut ajustar un model estable amb aquests registres.');
    return { intercept, coefficients, means, scales, active, omitted, meanY, ranges: FEATURES.map((_, j) => [Math.min(...rows.map(row => row.x[j])), Math.max(...rows.map(row => row.x[j]))]) };
  }
  function predict(fitted, x) {
    if (!Array.isArray(x) || x.length !== FEATURES.length || !x.every(Number.isFinite)) throw new Error('Falten variables per calcular la predicció estadística.');
    return fitted.intercept + dot(fitted.coefficients, x);
  }
  function score(actual, predicted) {
    const n = actual.length;
    if (!n || n !== predicted.length) throw new Error('No hi ha dades de validació.');
    const mean = actual.reduce((sum, y) => sum + y, 0) / n;
    const errors = actual.map((y, i) => predicted[i] - y);
    const sse = errors.reduce((sum, e) => sum + e * e, 0), sst = actual.reduce((sum, y) => sum + (y - mean) ** 2, 0);
    return { mae: errors.reduce((sum, e) => sum + Math.abs(e), 0) / n, rmse: Math.sqrt(sse / n), r2: sst > 1e-10 ? 1 - sse / sst : null };
  }
  function train(rows) {
    if (rows.length < MIN_ROWS) throw new Error(`Calen com a mínim ${MIN_ROWS} àpats amb preses associades i totes les variables prèvies; hi ha ${rows.length}.`);
    const split = Math.floor(rows.length * .8), test = rows.slice(split);
    // Labels from a late-linked take must also have been available before validation starts.
    const training = rows.slice(0, split).filter(row => (row.targetAvailableAt || row.timestamp) < test[0].timestamp);
    if (training.length < 10) throw new Error('Falten àpats d’entrenament amb preses conegudes abans de la validació.');
    if (training.at(-1).timestamp === test[0].timestamp) throw new Error('La separació temporal coincide en la mateixa hora. Revisa els registres duplicats.');
    const fitted = fit(training), estimates = test.map(row => predict(fitted, row.x));
    return { ...fitted, trainingCount: training.length, testCount: test.length, trainingEnd: training.at(-1).timestamp,
      metrics: score(test.map(row => row.y), estimates), meanBaseline: score(test.map(row => row.y), test.map(() => fitted.meanY)), previousDoseBaseline: score(test.map(row => row.y), test.map(row => row.x[4])),
      validation: test.map((row, i) => ({ ...row, predicted: estimates[i] })) };
  }
  function formatted(value) { return Number(value).toLocaleString('ca-ES', { maximumFractionDigits: 1 }); }
  function init() {
    if (!$('analytics-tools')) return;
    const panel = document.createElement('div'); panel.className = 'card diary-form'; panel.id = 'regression-panel';
    panel.innerHTML = `<h2>Regressió lineal de l’historial</h2><p class="help">Prediu les UI registrades per àpat a partir de greix estimat, pes, Bristol mitjà i aspecte gras en les 48 hores prèvies, i última presa. Aprèn el patró dels teus registres; no la dosi terapèutica adequada. No modifica la teva pauta ni es converteix en càpsules per prendre.</p><p class="help">Utilitza l’historial complet, indepènntment del filtre de dates del resum. Associa les preses a els seus àpats a Registres. Calen com a mínim 30 àpats complets. El 80 % més antic es reserva per entrenar i el 20 % posterior per avaluar. Tant les variables com les etiquetes d’entrenament han d’estar disponibles abans de la validació.</p><p id="regression-data" class="help"></p><button type="button" class="btn-save" id="train-regression">Entrenar regressió amb el meu historial</button><p id="regression-status" role="status" class="help"></p><div id="regression-result"></div>`;
    $('analytics-tools').append(panel);
    const preview = document.createElement('div'); preview.className = 'card diary-form'; preview.id = 'regression-preview';
    preview.innerHTML = '<h2>Predicció estadística del registre</h2><p id="regression-prediction" class="help">Entrena el model als ajustos de l’historial per explorar les UI que prediria l’historial. Aquesta xifra no és una indicació de presa.</p>';
    $('capsule-card').after(preview);
    $('train-regression').addEventListener('click', () => {
      try {
        const data = dataset(window.RubyDiary.getEntries());
        model = train(data.rows); renderModel(); renderPrediction();
        $('regression-status').textContent = 'Model entrenat localment, sense enviar dades a cap proveïdor. L’avaluació descriu predicció de l’historial, no eficàcia ni seguretat del tractament.';
      } catch (error) { model = null; $('regression-result').replaceChildren(); $('regression-status').textContent = error.message; renderPrediction(); }
    });
    dataChanged();
  }
  function renderModel() {
    const columns = FEATURES.map(([_, label], j) => `<tr><td>${escape(label)}</td><td>${formatted(model.coefficients[j])}</td><td>${escape(model.omitted.find(item => item.feature === j)?.reason || 'Inclosa')}</td></tr>`).join('');
    $('regression-result').innerHTML = `<p class="help">${model.trainingCount} àpats d’entrenament · ${model.testCount} de validació posterior.</p><div class="analytics-metrics"><div><span>Error absolut mitjà</span><strong>${formatted(model.metrics.mae)} UI</strong></div><div><span>Error quadràtic mitjà (arrel)</span><strong>${formatted(model.metrics.rmse)} UI</strong></div><div><span>R² de validació</span><strong>${model.metrics.r2 == null ? 'No calculable' : formatted(model.metrics.r2)}</strong></div><div><span>Error d’utilitzar l’última presa</span><strong>${formatted(model.previousDoseBaseline.mae)} UI</strong></div></div><p class="help">Error d’utilitzar la mitjana de l’entrenament: ${formatted(model.meanBaseline.mae)} UI. Un bon ajust no demostra que la dosi registrada fos adequada.</p><div class="diary-table-wrap"><table class="diary-table"><thead><tr><th>Variable</th><th>Coeficient (UI per unitat)</th><th>Estat</th></tr></thead><tbody><tr><td>Intercepció</td><td>${formatted(model.intercept)}</td><td>Inclòs</td></tr>${columns}</tbody></table><table class="diary-table"><thead><tr><th>Validació</th><th>UI registrades</th><th>UI predites</th></tr></thead><tbody>${model.validation.slice(-10).map(row => `<tr><td>${escape(window.RubyDiary.localDateTime(new Date(row.timestamp)).slice(0, 10))}</td><td>${formatted(row.y)}</td><td>${formatted(row.predicted)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function renderPrediction() {
    if (!$('regression-prediction')) return;
    if (!model) { $('regression-prediction').textContent = 'Entrena el model als ajustos de l’historial. La predicció del registre és indepènnt de la combinació de càpsules segons la teva pauta.'; return; }
    const meal = window.RubyDiary.getMealAnalysis();
    if (!meal) { $('regression-prediction').textContent = 'Analitza l’àpat per obtenir el seu greix estimat. El model no indica què dosi has de prendre.'; return; }
    const x = featuresAt(window.RubyDiary.getEntries(), $('meal-time').value, meal.totalFat);
    if (!x) { $('regression-prediction').textContent = 'Falten pes, deposicions amb aspecte gras observat en les 48 hores prèvies o una presa anterior. No se substitueixen dades desconegudes per zero.'; return; }
    const value = predict(model, x);
    const outside = model.ranges.some(([min, max], j) => x[j] < min || x[j] > max);
    $('regression-prediction').textContent = `Predicció del registre: ${formatted(value)} UI. ${value < 0 || outside ? 'Extrapolació fora de les dades d’entrenament: no és fiable. ' : ''}És una sortida estadística sense validació clínica; no és una dosi per prendre i no canvia la teva pauta.`;
  }
  function dataChanged() {
    if (!$('regression-data')) return;
    const data = dataset(window.RubyDiary.getEntries());
    $('regression-data').textContent = `${data.rows.length} àpats complets. Exclosos: ${data.excluded.unlinked} preses sense àpat associat; ${data.excluded.noAnalysis} àpats sense greix estimat; ${data.excluded.missingHistory} sense variables prèvies completes; ${data.excluded.timing} amb preses anteriors a la data del seu àpat.`;
    model = null; $('regression-result').replaceChildren(); renderPrediction();
  }
  window.RubyRegression = { init, dataChanged, renderPrediction, featuresAt, dataset, fit, predict, score, train, FEATURES };
})();
