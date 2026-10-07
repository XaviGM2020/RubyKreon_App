/* RubyKreon diary: local records and original documents, no remote history. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MAX_FILES_BYTES = 20 * 1024 * 1024;
  const TYPES = { meal: '🍽️ Comida', kreon: '💊 Kreon tomado', stool: '🚽 Deposición', weight: '⚖️ Peso', lab: '📄 Documento anterior', review: '🧠 Análisis del diario' };
  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  // Descriptive labels based on the NHS Bristol chart; no diagnostic interpretation.
  const BRISTOL = ['Tipo 1 · bolas duras separadas', 'Tipo 2 · alargada, con bultos', 'Tipo 3 · alargada, con grietas', 'Tipo 4 · alargada, lisa y blanda', 'Tipo 5 · fragmentos blandos definidos', 'Tipo 6 · fragmentos pastosos e irregulares', 'Tipo 7 · líquida, sin fragmentos sólidos'];
  let dbPromise, entries = [], extraPhotos = [], mealAnalysis = null;
  let revision = 0;
  let mealFilesReading = false, mealFilesVersion = 0;

  function status(message, error = false) {
    $('diary-status').textContent = message;
    $('diary-status').classList.toggle('error', error);
  }
  function localDateTime(date = new Date()) {
    const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return shifted.toISOString().slice(0, 16);
  }
  function dateTime(value) {
    if (!value || !Number.isFinite(new Date(value).getTime())) throw new Error('Introduce una fecha y hora válidas.');
    return new Date(value).toISOString();
  }
  function number(value, label, min = 0, integer = false) {
    if (value === '' || value == null) throw new Error(`Introduce ${label}.`);
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || (integer && !Number.isSafeInteger(n))) throw new Error(`El valor de ${label} no es válido.`);
    return n;
  }
  function text(value, limit = 5000) {
    if (value != null && typeof value !== 'string') throw new Error('El registro contiene texto no válido.');
    return (value || '').slice(0, limit);
  }
  function normalizeFile(file, pdf = false) {
    const mime = file?.mime;
    if (!IMAGE_TYPES.includes(mime) && !(pdf && mime === 'application/pdf')) throw new Error('Formato de archivo no compatible. Usa PDF, JPG, PNG, WEBP o GIF.');
    if (typeof file.dataUrl !== 'string' || !file.dataUrl.startsWith(`data:${mime};base64,`) || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.dataUrl.split(',')[1] || '')) throw new Error('El archivo adjunto no es válido.');
    const base64 = file.dataUrl.split(',')[1];
    const size = Math.floor(base64.length * .75) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
    if (!size || size > MAX_FILES_BYTES) throw new Error('El archivo supera el límite de 20 MB.');
    return { name: text(file.name, 200) || 'documento', mime, dataUrl: file.dataUrl, size };
  }
  function normalizeMarkers(markers) {
    if (!Array.isArray(markers) || markers.length > 200) throw new Error('La analítica admite hasta 200 parámetros.');
    return markers.map(marker => {
      const name = text(marker.name, 200).trim();
      if (!name) throw new Error('Cada parámetro necesita un nombre.');
      const value = typeof marker.value === 'number' ? String(marker.value) : text(marker.value, 200);
      if (!value.trim()) throw new Error(`Introduce el valor de ${name}.`);
      return { name, value, unit: text(marker.unit, 100), reference: text(marker.reference, 300) };
    });
  }
  function normalizeEntry(record) {
    if (!record || !Object.hasOwn(TYPES, record.type)) throw new Error('Tipo de registro no válido.');
    if (typeof record.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(record.id)) throw new Error('Identificador de registro no válido.');
    const item = { id: record.id, type: record.type, timestamp: dateTime(record.timestamp), notes: text(record.notes), createdAt: dateTime(record.createdAt || record.timestamp) };
    if (item.type === 'meal') {
      item.title = text(record.title, 200).trim();
      if (!item.title) throw new Error('Introduce una descripción de la comida.');
      item.grams = record.grams == null || record.grams === '' ? null : number(record.grams, 'cantidad del plato', .1);
      item.ingredients = text(record.ingredients);
      item.kind = record.kind === 'snack' ? 'snack' : 'meal';
      item.suggestion = record.suggestion ? window.RubyAnalytics.normalizeSuggestion(record.suggestion) : null;
      if (!Array.isArray(record.photos) || record.photos.length > 4) throw new Error('Una comida admite hasta 4 fotos.');
      item.photos = record.photos.map(photo => normalizeFile(photo));
      if (record.analysis) {
        const a = record.analysis;
        item.analysis = {
          totalFat: number(a.totalFat, 'grasa'), saturatedFat: number(a.saturatedFat ?? 0, 'grasa saturada'),
          calories: number(a.calories ?? 0, 'calorías'), confidence: Math.min(100, number(a.confidence ?? 0, 'confianza')),
          dish: text(a.dish, 200), description: text(a.description),
          dose: a.dose ? { rounded: number(a.dose.rounded, 'estimación anterior'), unit: text(a.dose.unit, 100), med: text(a.dose.med, 100) } : null
        };
      } else item.analysis = null;
    } else if (item.type === 'kreon') {
      item.capsules = {};
      item.mealId = record.mealId ? text(record.mealId, 100) : null;
      for (const strength of [10, 25, 35]) item.capsules[strength] = number(record.capsules?.[strength] ?? 0, 'cápsulas', 0, true);
      item.totalUI = capsuleTotal(item.capsules);
      if (!Number.isSafeInteger(item.totalUI)) throw new Error('El total de cápsulas no es válido.');
      if (!item.totalUI) throw new Error('Introduce al menos una cápsula tomada.');
    } else if (item.type === 'stool') {
      item.bristol = number(record.bristol, 'tipo Bristol', 1, true);
      if (item.bristol > 7) throw new Error('La escala Bristol va del 1 al 7.');
      item.greasy = ['yes', 'no'].includes(record.greasy) ? record.greasy : 'unknown';
    } else if (item.type === 'weight') {
      item.kg = number(record.kg, 'peso', .1);
    } else if (item.type === 'review') {
      item.report = window.RubyAnalytics.normalizeReport(record.report);
    } else {
      item.title = text(record.title, 200).trim() || 'Analítica';
      item.markers = normalizeMarkers(record.markers || []);
      if (!Array.isArray(record.files) || record.files.length > 6) throw new Error('Un informe admite hasta 6 archivos.');
      item.files = record.files.map(file => normalizeFile(file, true));
      if (!item.files.length) throw new Error('Adjunta el informe original.');
      item.reviewed = record.reviewed === true;
      if (item.markers.length && !item.reviewed) throw new Error('Revisa los valores extraídos antes de archivarlos.');
    }
    const files = item.files || item.photos || [];
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_FILES_BYTES) throw new Error('Los archivos del registro superan los 20 MB en total.');
    return item;
  }
  function capsuleTotal(capsules) {
    return [10, 25, 35].reduce((sum, strength) => sum + Number(capsules[strength] || 0) * strength * 1000, 0);
  }

  function database() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('Este navegador no permite guardar el diario. Abre la app en Chrome o Safari.'));
      const request = indexedDB.open('rubykreon-diary', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('entries', { keyPath: 'id' });
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => status('Cierra otras pestañas de RubyKreon para abrir el diario.', true);
    }).catch(error => { dbPromise = null; throw error; });
    return dbPromise;
  }
  async function transaction(mode, work) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('entries', mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(new Error(tx.error?.name === 'QuotaExceededError' ? 'No queda espacio para guardar el registro. Exporta una copia y libera espacio en el diario.' : 'No se pudo completar el guardado. Inténtalo de nuevo.'));
      tx.onerror = () => {};
      try {
        const request = work(tx.objectStore('entries'));
        if (request) request.onsuccess = () => { result = request.result; };
      } catch (error) { tx.abort(); reject(error); }
    });
  }
  async function refresh() {
    entries = await transaction('readonly', store => store.getAll());
    entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    renderTimeline();
    renderTrends();
    window.RubyAnalytics?.dataChanged();
    window.RubyRegression?.dataChanged();
    refreshMealChoices();
  }
  async function save(record) {
    const normalized = normalizeEntry(record);
    await transaction('readwrite', store => store.put(normalized));
    await refresh();
    status('✓ Registro guardado en este móvil.');
    return normalized;
  }
  function newRecord(type, timestamp, notes = '') {
    return { id: crypto.randomUUID(), type, timestamp: dateTime(timestamp), notes, createdAt: new Date().toISOString() };
  }
  function screen(name) {
    for (const key of ['meal', 'diary', 'lab']) $(key + '-screen').hidden = key !== name;
    document.querySelectorAll('[data-screen]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.screen === name)));
  }
  function field(label, id, type = 'text', attrs = '') {
    return `<label>${label}<input id="${id}" type="${type}" ${attrs}></label>`;
  }
  function timeField(id) { return field('Fecha y hora', id, 'datetime-local', 'required'); }
  function notesField(id) { return `<label>Observaciones<textarea id="${id}" maxlength="5000" rows="2"></textarea></label>`; }
  function capsuleFields(prefix) {
    return `<div class="diary-grid">${[10, 25, 35].map(n => field(`${n}.000 UI · cápsulas`, `${prefix}-${n}`, 'number', 'value="0" min="0" step="1" required')).join('')}</div><p id="${prefix}-total" class="help">Total tomado: 0 UI</p>`;
  }
  function readCapsules(prefix) {
    return Object.fromEntries([10, 25, 35].map(n => [n, number($(`${prefix}-${n}`).value, 'cápsulas', 0, true)]));
  }
  function wireCapsules(prefix) {
    for (const n of [10, 25, 35]) $(`${prefix}-${n}`).addEventListener('input', () => {
      try { $(`${prefix}-total`).textContent = `Total tomado: ${capsuleTotal(readCapsules(prefix)).toLocaleString('es-ES')} UI`; }
      catch { $(`${prefix}-total`).textContent = 'Introduce números enteros de cápsulas.'; }
    });
  }
  async function submit(form, button, action) {
    if (!form.reportValidity()) return;
    button.disabled = true;
    try { form.querySelector('.form-feedback')?.remove(); await action(); }
    catch (error) {
      const message = error.message || 'No se pudo completar la operación.';
      status(message, true);
      let feedback = form.querySelector('.form-feedback');
      if (!feedback) { feedback = document.createElement('p'); feedback.className = 'form-feedback help'; feedback.setAttribute('role', 'alert'); form.append(feedback); }
      feedback.textContent = message;
    }
    finally { button.disabled = false; }
  }
  function fileData(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      reader.readAsDataURL(file);
    });
  }
  async function readFiles(list, max, pdf = false) {
    const files = Array.from(list);
    if (files.length > max) throw new Error(`Selecciona un máximo de ${max} archivos.`);
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_FILES_BYTES) throw new Error('Los archivos no pueden superar 20 MB en total.');
    return Promise.all(files.map(async file => {
      const mime = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : '');
      if (!IMAGE_TYPES.includes(mime) && !(pdf && mime === 'application/pdf')) throw new Error('Usa PDF, JPG, PNG, WEBP o GIF.');
      const dataUrl = await fileData(new Blob([file], { type: mime }));
      return normalizeFile({ name: file.name, mime, dataUrl }, pdf);
    }));
  }
  function download(data, name, mime) {
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    const link = document.createElement('a');
    link.href = url; link.download = name;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function downloadFile(file) {
    const decoded = atob(file.dataUrl.split(',')[1]);
    const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
    download(bytes, file.name, file.mime);
  }
  function attachmentList(files, removable = false) {
    return files.map((file, i) => `<figure>${file.mime.startsWith('image/') ? `<img src="${escape(file.dataUrl)}" alt="${escape(file.name)}">` : '📄'}<figcaption>${escape(file.name)}</figcaption>${removable ? `<button type="button" class="small-btn" data-remove-photo="${i}">Quitar</button>` : ''}</figure>`).join('');
  }

  function buildDiary() {
    $('diary-screen').innerHTML = `
      <div class="card diary-form">
        <h2>Añadir un registro</h2>
        <label>Tipo<select id="record-type"><option value="kreon">Kreon tomado</option><option value="stool">Deposición · Bristol</option><option value="weight">Peso</option></select></label>
        <form id="record-form" class="diary-form">
          ${timeField('record-time')}
          <div id="record-kreon">${capsuleFields('record-caps')}</div>
          <label id="record-meal-label">Comida asociada (para el modelo)<select id="record-meal"><option value="">Sin asociar</option></select></label>
          <div id="record-stool" hidden class="diary-form"><label>Escala Bristol<select id="record-bristol">${BRISTOL.map((label, i) => `<option value="${i + 1}">${label}</option>`).join('')}</select></label><label>¿Observaste un aspecto graso o aceitoso?<select id="record-greasy"><option value="unknown">No lo sé / no observado</option><option value="yes">Sí</option><option value="no">No</option></select></label><p class="help">Es una observación, no una medición de grasa fecal.</p><p class="help" style="margin-top:8px"><a href="https://www.england.nhs.uk/wp-content/uploads/2023/07/Bristol-stool-chart-for-people-with-a-learning-disability-print-version.pdf" target="_blank" rel="noopener">Ver guía visual Bristol (NHS, en inglés)</a></p></div>
          <div id="record-weight" hidden>${field('Peso (kg)', 'record-kg', 'number', 'min="0.1" step="0.1"')}</div>
          ${notesField('record-notes')}
          <p class="help">Las cápsulas de 10.000, 25.000 y 35.000 UI corresponden a las presentaciones indicadas por ti. Registra lo que has tomado según tu pauta.</p>
          <button type="submit" id="save-record" class="btn-save">✓ Guardar registro</button>
        </form>
      </div>
      <div class="card">
        <h2>Línea temporal</h2>
        <div class="diary-filter">
          <label>Día<input id="timeline-date" type="date"></label>
          <label>Tipo<select id="timeline-type"><option value="">Todos</option>${Object.entries(TYPES).map(([type, title]) => `<option value="${type}">${title}</option>`).join('')}</select></label>
        </div>
        <button type="button" id="clear-filters" class="small-btn">Ver todo</button>
        <div id="timeline" class="timeline" style="margin-top:14px"></div>
      </div>
      <div class="card diary-form">
        <h2>Evolución</h2>
        <label>Datos<select id="trend-select"><option value="weight">Peso</option></select></label>
        <div id="trend-table" class="diary-table-wrap"></div>
        <p class="help">En Analíticas puedes comparar comidas, grasa estimada, tomas, Bristol y peso por día.</p>
      </div>
      <div class="card diary-form">
        <h2>Copia de seguridad</h2>
        <p class="help">El diario y los informes se guardan solo en este navegador y móvil. Exporta una copia para conservarlos si cambias de teléfono o borras los datos del navegador. La copia incluye tus fotos e informes; no incluye la clave de API.</p>
        <button type="button" id="export-diary" class="small-btn">Descargar copia del diario</button>
        <label>Importar copia (.json)<input id="import-diary" type="file" accept="application/json,.json"></label>
        <p class="help">La importación añade los registros nuevos y omite los que ya existen.</p>
      </div>`;
    $('record-time').value = localDateTime();
    const updateRecordType = () => {
      for (const type of ['kreon', 'stool', 'weight']) $(`record-${type}`).hidden = $('record-type').value !== type;
      $('record-kg').required = $('record-type').value === 'weight';
      $('record-kg').disabled = $('record-type').value !== 'weight';
      $('record-bristol').disabled = $('record-type').value !== 'stool';
      $('record-greasy').disabled = $('record-type').value !== 'stool';
      $('record-meal').disabled = $('record-type').value !== 'kreon'; $('record-meal-label').hidden = $('record-type').value !== 'kreon';
      for (const n of [10, 25, 35]) $(`record-caps-${n}`).disabled = $('record-type').value !== 'kreon';
    };
    $('record-type').addEventListener('change', updateRecordType);
    updateRecordType();
    wireCapsules('record-caps');
    $('record-form').addEventListener('submit', e => {
      e.preventDefault();
      submit(e.target, $('save-record'), async () => {
        const type = $('record-type').value;
        const record = newRecord(type, $('record-time').value, $('record-notes').value);
        if (type === 'kreon') { record.capsules = readCapsules('record-caps'); record.mealId = $('record-meal').value || null; }
        if (type === 'stool') { record.bristol = Number($('record-bristol').value); record.greasy = $('record-greasy').value; }
        if (type === 'weight') record.kg = number($('record-kg').value, 'peso', .1);
        await save(record);
        $('record-form').reset(); $('record-time').value = localDateTime();
        $('record-caps-total').textContent = 'Total tomado: 0 UI';
      });
    });
    for (const id of ['timeline-date', 'timeline-type']) $(id).addEventListener('change', renderTimeline);
    $('clear-filters').addEventListener('click', () => { $('timeline-date').value = ''; $('timeline-type').value = ''; renderTimeline(); });
    $('trend-select').addEventListener('change', renderTrendTable);
    $('export-diary').addEventListener('click', async () => {
      try {
        const records = await transaction('readonly', store => store.getAll());
        download(JSON.stringify({ app: 'RubyKreon', version: 1, exportedAt: new Date().toISOString(), entries: records }), `RubyKreon-${localDateTime().slice(0, 10)}.json`, 'application/json');
        status('Copia preparada. Conserva el archivo descargado.');
      } catch (error) { status(error.message, true); }
    });
    $('import-diary').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      e.target.disabled = true;
      try {
        if (file.size > 200 * 1024 * 1024) throw new Error('La copia supera el límite de importación de 200 MB.');
        const backup = JSON.parse(await file.text());
        if (backup.app !== 'RubyKreon' || backup.version !== 1 || !Array.isArray(backup.entries) || backup.entries.length > 10000) throw new Error('El archivo no es una copia compatible de RubyKreon.');
        const records = backup.entries.map(normalizeEntry);
        const existing = new Set((await transaction('readonly', store => store.getAll())).map(record => record.id));
        const additions = records.filter(record => { if (existing.has(record.id)) return false; existing.add(record.id); return true; });
        await transaction('readwrite', store => { additions.forEach(record => store.add(record)); });
        await refresh(); status(`✓ Importados ${additions.length} registros. Los existentes se han conservado.`);
      } catch (error) { status(error instanceof SyntaxError ? 'La copia no contiene JSON válido.' : error.message, true); }
      finally { e.target.value = ''; e.target.disabled = false; }
    });
    $('timeline').addEventListener('click', async e => {
      const action = e.target.closest('[data-action]');
      if (!action) return;
      const record = entries.find(item => item.id === action.dataset.id);
      if (!record) return;
      if (action.dataset.action === 'edit') openEditor(record);
      if (action.dataset.action === 'file') downloadFile((record.files || record.photos)[Number(action.dataset.index)]);
      if (action.dataset.action === 'delete' && confirm('¿Eliminar este registro y sus archivos del diario?')) {
        try { await transaction('readwrite', store => store.delete(record.id)); await refresh(); status('Registro eliminado.'); }
        catch (error) { status(error.message, true); }
      }
    });
  }

  function renderTimeline() {
    const date = $('timeline-date').value, type = $('timeline-type').value;
    const records = entries.filter(record => (!type || record.type === type) && (!date || localDateTime(new Date(record.timestamp)).slice(0, 10) === date));
    $('timeline').innerHTML = records.length ? records.map(record => {
      let title = TYPES[record.type], content = '';
      if (record.type === 'meal') {
        title = record.title;
        content = `<p>${record.kind === 'snack' ? 'Tentempié' : 'Comida principal'}${record.grams ? ` · ${record.grams} g de plato` : ''}</p><p>${escape(record.ingredients)}</p>`;
        if (record.analysis) content += `<p>Estimación IA: ${record.analysis.totalFat} g de grasa · ${record.analysis.calories} kcal</p><p>${escape(record.analysis.description)}</p>`;
        if (record.analysis?.dose) content += `<p class="help">Estimación anterior: ${record.analysis.dose.rounded.toLocaleString('es-ES')} ${escape(record.analysis.dose.unit)}. No corresponde a una pauta registrada ni a una toma.</p>`;
        if (record.suggestion) content += `<p>Combinación según la pauta guardada: ${escape(window.RubyAnalytics.combinationText(record.suggestion.capsules))} · ${record.suggestion.totalUI.toLocaleString('es-ES')} UI. No registrada como tomada.</p>`;
      }
      if (record.type === 'kreon') content = `<p>${[10, 25, 35].filter(n => record.capsules[n]).map(n => `${record.capsules[n]} × ${n}.000 UI`).join(' + ')}\nTotal tomado: ${record.totalUI.toLocaleString('es-ES')} UI</p>`;
      if (record.type === 'stool') content = `<p>Bristol: tipo ${record.bristol} de 7\nAspecto graso observado: ${record.greasy === 'yes' ? 'sí' : record.greasy === 'no' ? 'no' : 'sin información'}</p>`;
      if (record.type === 'weight') content = `<p>${record.kg.toLocaleString('es-ES')} kg</p>`;
      if (record.type === 'lab') {
        title = record.title;
        content = record.markers.length ? markersTable(record.markers) : '<p>Informe archivado sin valores extraídos.</p>';
        content += `<p class="help">${record.reviewed ? 'Valores revisados por el usuario.' : 'Pendiente de extracción o revisión.'}</p>`;
      }
      if (record.type === 'review') {
        title = `Análisis: ${record.report.from} — ${record.report.to}`;
        content = `<p>${escape(record.report.summary)}</p>${record.report.observations.map(item => `<p>• ${escape(item)}</p>`).join('')}<p class="help">${record.report.entryCount} registros incluidos. Este análisis no modifica la pauta.</p>`;
      }
      const files = record.files || record.photos || [];
      const attachments = files.length ? `<details><summary>Archivos originales (${files.length})</summary>${files.map((file, index) => `${file.mime.startsWith('image/') ? `<img class="entry-photo" loading="lazy" src="${escape(file.dataUrl)}" alt="${escape(file.name)}">` : ''}<p><button class="small-btn" type="button" data-action="file" data-id="${record.id}" data-index="${index}">Descargar ${escape(file.name)}</button></p>`).join('')}</details>` : '';
      return `<article><time datetime="${record.timestamp}">${escape(new Date(record.timestamp).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }))}</time><span class="entry-kind"> · ${TYPES[record.type]}</span><h3>${escape(title)}</h3>${content}<p>${escape(record.notes)}</p>${attachments}<div class="photo-actions"><button type="button" class="small-btn" data-action="edit" data-id="${record.id}">Editar</button><button type="button" class="small-btn danger" data-action="delete" data-id="${record.id}">Eliminar</button></div></article>`;
    }).join('') : '<p class="help">Todavía no hay registros para esta selección. Guarda una comida o añade un registro.</p>';
  }
  function markersTable(markers) {
    return `<div class="diary-table-wrap"><table class="diary-table"><thead><tr><th>Parámetro</th><th>Valor</th><th>Unidad</th><th>Referencia del informe</th></tr></thead><tbody>${markers.map(marker => `<tr><td>${escape(marker.name)}</td><td>${escape(marker.value)}</td><td>${escape(marker.unit)}</td><td>${escape(marker.reference)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function renderTrends() {
    renderTrendTable();
  }
  function renderTrendTable() {
    const key = $('trend-select').value;
    const rows = entries.slice().reverse().flatMap(record => {
      if (key === 'weight') return record.type === 'weight' ? [{ timestamp: record.timestamp, value: record.kg, unit: 'kg', reference: '' }] : [];
      return [];
    });
    $('trend-table').innerHTML = rows.length ? `<table class="diary-table"><thead><tr><th>Fecha</th><th>Valor</th><th>Unidad</th><th>Referencia</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escape(new Date(row.timestamp).toLocaleDateString('es-ES'))}</td><td>${escape(row.value)}</td><td>${escape(row.unit)}</td><td>${escape(row.reference)}</td></tr>`).join('')}</tbody></table>` : '<p class="help">Guarda registros para consultar su evolución.</p>';
  }

  function addMarker(container, marker = {}) {
    if (container.children.length >= 200) throw new Error('Máximo 200 parámetros por informe.');
    const row = document.createElement('div'); row.className = 'lab-marker';
    row.innerHTML = `<label>Parámetro<input data-marker="name" maxlength="200" required value="${escape(marker.name)}"></label><div class="diary-grid"><label>Valor<input data-marker="value" maxlength="200" required value="${escape(marker.value)}"></label><label>Unidad<input data-marker="unit" maxlength="100" value="${escape(marker.unit)}"></label></div><label>Rango de referencia del informe<input data-marker="reference" maxlength="300" value="${escape(marker.reference)}"></label><button type="button" class="small-btn danger">Quitar parámetro</button>`;
    row.querySelector('button').addEventListener('click', () => row.remove());
    container.append(row);
  }
  function readMarkers(container) {
    return normalizeMarkers(Array.from(container.children, row => Object.fromEntries(Array.from(row.querySelectorAll('[data-marker]'), input => [input.dataset.marker, input.value]))));
  }
  function openEditor(record) {
    const dialog = $('entry-editor');
    let specific = '';
    if (record.type === 'meal') specific = `${field('Descripción', 'edit-title', 'text', 'required maxlength="200"')}${field('Cantidad (g, opcional)', 'edit-grams', 'number', 'min="0.1" step="0.1"')}<label>Ingredientes<textarea id="edit-ingredients" maxlength="5000" rows="3"></textarea></label><p class="help">Cambiar la descripción, ingredientes o cantidad elimina la estimación anterior. Las fotos originales se conservan.</p>`;
    if (record.type === 'kreon') specific = capsuleFields('edit-caps') + `<label>Comida asociada<select id="edit-meal"><option value="">Sin asociar</option>${entries.filter(item => item.type === 'meal').map(item => `<option value="${item.id}">${escape(new Date(item.timestamp).toLocaleString('es-ES'))} · ${escape(item.title)}</option>`).join('')}</select></label>`;
    if (record.type === 'stool') specific = `<label>Bristol<select id="edit-bristol">${BRISTOL.map((label, i) => `<option value="${i + 1}">${label}</option>`).join('')}</select></label><label>Aspecto graso observado<select id="edit-greasy"><option value="unknown">No lo sé / no observado</option><option value="yes">Sí</option><option value="no">No</option></select></label>`;
    if (record.type === 'weight') specific = field('Peso (kg)', 'edit-kg', 'number', 'required min="0.1" step="0.1"');
    if (record.type === 'lab') specific = `${field('Nombre del informe', 'edit-title', 'text', 'required maxlength="200"')}<div id="edit-markers" class="lab-marker-list"></div><button id="edit-add-marker" class="small-btn" type="button">+ Añadir parámetro</button><label class="check-label"><input id="edit-reviewed" type="checkbox">He comprobado los valores y la fecha con el original.</label><p class="help">Los archivos originales se conservan. Puedes descargarlos desde la línea temporal.</p>`;
    dialog.innerHTML = `<form id="edit-form" class="diary-form"><h2 id="editor-title">Editar ${TYPES[record.type]}</h2>${timeField('edit-time')}${specific}${notesField('edit-notes')}<button id="edit-save" class="btn-save" type="submit">Guardar cambios</button><button id="edit-cancel" class="small-btn" type="button">Cancelar</button></form>`;
    $('edit-time').value = localDateTime(new Date(record.timestamp)); $('edit-notes').value = record.notes;
    if (record.type === 'meal') { $('edit-title').value = record.title; $('edit-grams').value = record.grams ?? ''; $('edit-ingredients').value = record.ingredients; }
    if (record.type === 'kreon') { for (const n of [10, 25, 35]) $(`edit-caps-${n}`).value = record.capsules[n]; wireCapsules('edit-caps'); $('edit-caps-total').textContent = `Total tomado: ${record.totalUI.toLocaleString('es-ES')} UI`; $('edit-meal').value = record.mealId || ''; }
    if (record.type === 'stool') { $('edit-bristol').value = record.bristol; $('edit-greasy').value = record.greasy || 'unknown'; }
    if (record.type === 'weight') $('edit-kg').value = record.kg;
    if (record.type === 'lab') {
      $('edit-title').value = record.title; $('edit-reviewed').checked = record.reviewed;
      record.markers.forEach(marker => addMarker($('edit-markers'), marker));
      $('edit-add-marker').addEventListener('click', () => { try { addMarker($('edit-markers')); $('edit-reviewed').checked = false; } catch (error) { status(error.message, true); } });
      $('edit-markers').addEventListener('input', () => { $('edit-reviewed').checked = false; });
      $('edit-time').addEventListener('input', () => { $('edit-reviewed').checked = false; });
    }
    $('edit-cancel').addEventListener('click', () => dialog.close());
    $('edit-form').addEventListener('submit', e => {
      e.preventDefault();
      submit(e.target, $('edit-save'), async () => {
        const updated = { ...record, timestamp: dateTime($('edit-time').value), notes: $('edit-notes').value };
        if (record.type === 'meal') {
          updated.title = $('edit-title').value; updated.grams = $('edit-grams').value; updated.ingredients = $('edit-ingredients').value;
          if (updated.title !== record.title || String(updated.grams) !== String(record.grams ?? '') || updated.ingredients !== record.ingredients) updated.analysis = null;
        }
        if (record.type === 'kreon') { updated.capsules = readCapsules('edit-caps'); updated.mealId = $('edit-meal').value || null; }
        if (record.type === 'stool') { updated.bristol = Number($('edit-bristol').value); updated.greasy = $('edit-greasy').value; }
        if (record.type === 'weight') updated.kg = $('edit-kg').value;
        if (record.type === 'lab') { updated.title = $('edit-title').value; updated.markers = readMarkers($('edit-markers')); updated.reviewed = $('edit-reviewed').checked; }
        await save(updated); dialog.close();
      });
    });
    dialog.showModal();
  }

  function refreshMealChoices() {
    if (!$('record-meal')) return;
    const previous = $('record-meal').value;
    $('record-meal').innerHTML = '<option value="">Sin asociar</option>' + entries.filter(record => record.type === 'meal').map(record => `<option value="${record.id}">${escape(new Date(record.timestamp).toLocaleString('es-ES'))} · ${escape(record.title)}</option>`).join('');
    if (entries.some(record => record.id === previous)) $('record-meal').value = previous;
  }
  function clearMealAnalysis() { mealAnalysis = null; window.RubyAnalytics?.renderSimulation(); ++revision; window.RubyRegression?.renderPrediction(); }
  function mealContext() { return { description: $('meal-title').value, portionGrams: $('meal-grams').value, ingredients: $('meal-ingredients').value, kind: $('meal-kind').value }; }
  function buildMeals() {
    $('meal-time').value = localDateTime();
    for (const id of ['meal-title', 'meal-grams', 'meal-ingredients']) $(id).addEventListener('input', () => { clearMealAnalysis(); $('results').style.display = 'none'; checkReady(); });
    $('meal-kind').addEventListener('change', () => { clearMealAnalysis(); $('results').style.display = 'none'; window.RubyAnalytics.renderCapsules(); });
    $('meal-time').addEventListener('input', () => window.RubyRegression.renderPrediction());
    $('meal-extra').addEventListener('change', async e => {
      const version = ++mealFilesVersion;
      mealFilesReading = true; clearMealAnalysis(); extraPhotos = []; checkReady();
      $('meal-extra-list').replaceChildren(); $('results').style.display = 'none';
      try {
        const files = await readFiles(e.target.files, 3);
        if (version !== mealFilesVersion) return;
        extraPhotos = files; $('meal-extra-list').innerHTML = attachmentList(extraPhotos, true);
      } catch (error) { if (version === mealFilesVersion) status(error.message, true); }
      finally { if (version === mealFilesVersion) { mealFilesReading = false; ++revision; checkReady(); } }
    });
    $('meal-extra-list').addEventListener('click', e => {
      const button = e.target.closest('[data-remove-photo]');
      if (!button) return;
      extraPhotos.splice(Number(button.dataset.removePhoto), 1); clearMealAnalysis();
      $('results').style.display = 'none'; $('meal-extra-list').innerHTML = attachmentList(extraPhotos, true); checkReady();
    });
    $('meal-form').addEventListener('submit', e => {
      e.preventDefault();
      submit(e.target, $('save-meal'), async () => {
        if (mealFilesReading) throw new Error('Espera a que se carguen las fotos.');
        const photos = [...extraPhotos];
        if (imageBase64) photos.unshift({ name: 'plato.' + (imageMime.split('/')[1] || 'jpg'), mime: imageMime, dataUrl: `data:${imageMime};base64,${imageBase64}` });
        await save({ ...newRecord('meal', $('meal-time').value, $('meal-notes').value), title: $('meal-title').value, grams: $('meal-grams').value, ingredients: $('meal-ingredients').value, kind: $('meal-kind').value, suggestion: window.RubyAnalytics.suggestForMeal($('meal-kind').value), photos, analysis: mealAnalysis });
        $('meal-form').reset(); $('meal-time').value = localDateTime();
        ++mealFilesVersion; extraPhotos = []; mealFilesReading = false;
        $('meal-extra-list').replaceChildren(); resetImage(); window.RubyAnalytics.renderCapsules(); screen('diary');
      });
    });
  }

  window.RubyDiary = {
    getEntries: () => entries,
    getMealAnalysis: () => mealAnalysis,
    saveReview: report => save({ ...newRecord('review', new Date().toISOString()), report }),
    prepareTakenDose(capsules) {
      $('record-type').value = 'kreon'; $('record-type').dispatchEvent(new Event('change'));
      for (const n of [10, 25, 35]) $(`record-caps-${n}`).value = capsules[n] || 0;
      $('record-caps-10').dispatchEvent(new Event('input'));
      $('record-time').value = localDateTime(); screen('diary');
      status('Revisa la combinación y guarda el registro cuando hayas tomado las cápsulas.');
    },
    clearMealAnalysis, mealRevision: () => revision, mealContext,
    mealImages: () => {
      if (mealFilesReading) throw new Error('Espera a que se carguen las fotos adicionales.');
      const size = (imageBase64?.length || 0) * .75 + extraPhotos.reduce((sum, file) => sum + file.size, 0);
      if (size > MAX_FILES_BYTES) throw new Error('Las fotos de la comida superan los 20 MB en total. Quita alguna foto o elige imágenes más pequeñas.');
      return extraPhotos;
    },
    setMealAnalysis(fat) {
      mealAnalysis = { ...fat, dose: null };
      window.RubyAnalytics.renderSimulation();
      window.RubyRegression.renderPrediction();
      if (!$('meal-title').value.trim() && typeof fat.dish === 'string') $('meal-title').value = fat.dish.slice(0, 200);
    },
    // Pure functions also used by validation tests.
    normalizeEntry, normalizeMarkers, capsuleTotal, localDateTime
  };
  document.addEventListener('DOMContentLoaded', async () => {
    buildDiary(); buildMeals(); window.RubyAnalytics.init(); window.RubyRegression.init();
    document.querySelectorAll('[data-screen]').forEach(button => button.addEventListener('click', () => screen(button.dataset.screen)));
    try {
      await refresh();
      if (navigator.storage?.persisted && !await navigator.storage.persisted()) {
        // Storage persistence is requested after the first explicit save, below.
        document.addEventListener('click', e => {
          if (e.target.closest('#save-meal, #save-record, #save-review')) navigator.storage.persist?.().catch(() => {});
        });
      }
    } catch (error) { status(error.message || 'No se pudo abrir el diario en este navegador.', true); }
  });
})();
