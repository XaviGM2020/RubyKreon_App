/* RubyKreon diary: local records and original documents, no remote history. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MAX_FILES_BYTES = 20 * 1024 * 1024;
  const TYPES = { meal: '🍽️ Menjar', kreon: '💊 Kreon pres', stool: '🚽 Deposició', weight: '⚖️ Pes', lab: '📄 Document anterior', review: '🧠 Anàlisi del diari' };
  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  // Descriptive labels based on the NHS Bristol chart; no diagnostic interpretation.
  const BRISTOL = ['Tipus 1 · boles dures separades', 'Tipus 2 · allargada, amb grumolls', 'Tipus 3 · allargada, amb esquerdes', 'Tipus 4 · allargada, llisa i tova', 'Tipus 5 · fragments tous definits', 'Tipus 6 · fragments pastosos i irregulars', 'Tipus 7 · líquida, sense fragments sòlids'];
  let dbPromise, entries = [], extraPhotos = [], mealAnalysis = null;
  let revision = 0;
  let mealFilesReading = false, mealFilesVersion = 0;

  function status(message, error = false) {
    $('diary-status').textContent = message;
    $('diary-status').classList.toggle('error', error);
    if ($('record-status')) { $('record-status').textContent = message; $('record-status').classList.toggle('error', error); }
  }
  function localDateTime(date = new Date()) {
    const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return shifted.toISOString().slice(0, 16);
  }
  function dateTime(value) {
    if (!value || !Number.isFinite(new Date(value).getTime())) throw new Error('Introdueix una data i hora vàlides.');
    return new Date(value).toISOString();
  }
  function number(value, label, min = 0, integer = false) {
    if (value === '' || value == null) throw new Error(`Introdueix ${label}.`);
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || (integer && !Number.isSafeInteger(n))) throw new Error(`El valor de ${label} no és vàlid.`);
    return n;
  }
  function text(value, limit = 5000) {
    if (value != null && typeof value !== 'string') throw new Error('El registre conté text no vàlid.');
    return (value || '').slice(0, limit);
  }
  function normalizeFile(file, pdf = false) {
    const mime = file?.mime;
    if (!IMAGE_TYPES.includes(mime) && !(pdf && mime === 'application/pdf')) throw new Error('Format de fitxer no compatible. Usa PDF, JPG, PNG, WEBP o GIF.');
    if (typeof file.dataUrl !== 'string' || !file.dataUrl.startsWith(`data:${mime};base64,`) || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.dataUrl.split(',')[1] || '')) throw new Error('El fitxer adjunt no és vàlid.');
    const base64 = file.dataUrl.split(',')[1];
    const size = Math.floor(base64.length * .75) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
    if (!size || size > MAX_FILES_BYTES) throw new Error('El fitxer supera el límit de 20 MB.');
    return { name: text(file.name, 200) || 'document', mime, dataUrl: file.dataUrl, size };
  }
  function normalizeMarkers(markers) {
    if (!Array.isArray(markers) || markers.length > 200) throw new Error('L’analítica admet fins a 200 paràmetres.');
    return markers.map(marker => {
      const name = text(marker.name, 200).trim();
      if (!name) throw new Error('Cada paràmetre necessita un nom.');
      const value = typeof marker.value === 'number' ? String(marker.value) : text(marker.value, 200);
      if (!value.trim()) throw new Error(`Introdueix el valor de ${name}.`);
      return { name, value, unit: text(marker.unit, 100), reference: text(marker.reference, 300) };
    });
  }
  function normalizeEntry(record) {
    if (!record || !Object.hasOwn(TYPES, record.type)) throw new Error('Tipus de registre no vàlid.');
    if (typeof record.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(record.id)) throw new Error('Identificador de registre no vàlid.');
    const item = { id: record.id, type: record.type, timestamp: dateTime(record.timestamp), notes: text(record.notes), createdAt: dateTime(record.createdAt || record.timestamp) };
    if (item.type === 'meal') {
      item.title = text(record.title, 5000).trim();
      if (!item.title) throw new Error('Introdueix una descripció de l’àpat.');
      item.grams = record.grams == null || record.grams === '' ? null : number(record.grams, 'quantitat del plat', .1);
      item.ingredients = text(record.ingredients);
      item.kind = record.kind === 'snack' ? 'snack' : 'meal';
      item.suggestion = record.suggestion ? window.RubyAnalytics.normalizeSuggestion(record.suggestion) : null;
      if (!Array.isArray(record.photos) || record.photos.length > 4) throw new Error('Un àpat admet fins a 4 fotos.');
      item.photos = record.photos.map(photo => normalizeFile(photo));
      if (record.analysis) {
        const a = record.analysis;
        item.analysis = {
          totalFat: number(a.totalFat, 'greix'), saturatedFat: number(a.saturatedFat ?? 0, 'greix saturat'),
          calories: number(a.calories ?? 0, 'calories'), confidence: Math.min(100, number(a.confidence ?? 0, 'confiança')),
          dish: text(a.dish, 200), description: text(a.description),
          dose: a.dose ? { rounded: number(a.dose.rounded, 'estimació anterior'), unit: text(a.dose.unit, 100), med: text(a.dose.med, 100) } : null
        };
      } else item.analysis = null;
    } else if (item.type === 'kreon') {
      item.capsules = {};
      item.mealId = record.mealId ? text(record.mealId, 100) : null;
      for (const strength of [10, 25, 35]) item.capsules[strength] = number(record.capsules?.[strength] ?? 0, 'càpsules', 0, true);
      item.totalUI = capsuleTotal(item.capsules);
      if (!Number.isSafeInteger(item.totalUI)) throw new Error('El total de càpsules no és vàlid.');
      if (!item.totalUI) throw new Error('Introdueix com a mínim una càpsula presa.');
    } else if (item.type === 'stool') {
      item.bristol = number(record.bristol, 'tipus Bristol', 1, true);
      if (item.bristol > 7) throw new Error('L’escala Bristol va del 1 al 7.');
      item.greasy = ['yes', 'no'].includes(record.greasy) ? record.greasy : 'unknown';
    } else if (item.type === 'weight') {
      item.kg = number(record.kg, 'pes', .1);
    } else if (item.type === 'review') {
      item.report = window.RubyAnalytics.normalizeReport(record.report);
    } else {
      item.title = text(record.title, 200).trim() || 'Analítica';
      item.markers = normalizeMarkers(record.markers || []);
      if (!Array.isArray(record.files) || record.files.length > 6) throw new Error('Un informe admet fins a 6 fitxers.');
      item.files = record.files.map(file => normalizeFile(file, true));
      if (!item.files.length) throw new Error('Adjunta l’informe original.');
      item.reviewed = record.reviewed === true;
      if (item.markers.length && !item.reviewed) throw new Error('Revisa els valors extrets abans d’arxivar-los.');
    }
    const files = item.files || item.photos || [];
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_FILES_BYTES) throw new Error('Els fitxers del registre superen els 20 MB en total.');
    return item;
  }
  function capsuleTotal(capsules) {
    return [10, 25, 35].reduce((sum, strength) => sum + Number(capsules[strength] || 0) * strength * 1000, 0);
  }

  function database() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('Aquest navegador no permet desar el diari. Obre l’app en Chrome o Safari.'));
      const request = indexedDB.open('rubykreon-diary', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('entries', { keyPath: 'id' });
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => status('Tanca les altres pestanyes de RubyKreon per obrir el diari.', true);
    }).catch(error => { dbPromise = null; throw error; });
    return dbPromise;
  }
  async function transaction(mode, work) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('entries', mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(new Error(tx.error?.name === 'QuotaExceededError' ? 'no queda espai per desar el registre. Exporta una còpia i allibera espai als registres.' : 'No s’ha pogut completar el desat. Inténtalo de nou.'));
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
    status('✓ Registre desat en aquest mòbil.');
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
  function timeField(id) { return field('Data i hora', id, 'datetime-local', 'required'); }
  function notesField(id) { return `<label>Observacions<textarea id="${id}" maxlength="5000" rows="2"></textarea></label>`; }
  function capsuleFields(prefix) {
    return `<div class="diary-grid">${[10, 25, 35].map(n => field(`${n}.000 UI · càpsules`, `${prefix}-${n}`, 'number', 'value="0" min="0" step="1" required')).join('')}</div><p id="${prefix}-total" class="help">Total pres: 0 UI</p>`;
  }
  function readCapsules(prefix) {
    return Object.fromEntries([10, 25, 35].map(n => [n, number($(`${prefix}-${n}`).value, 'càpsules', 0, true)]));
  }
  function wireCapsules(prefix) {
    for (const n of [10, 25, 35]) $(`${prefix}-${n}`).addEventListener('input', () => {
      try { $(`${prefix}-total`).textContent = `Total pres: ${capsuleTotal(readCapsules(prefix)).toLocaleString('ca-ES')} UI`; }
      catch { $(`${prefix}-total`).textContent = 'Introdueix nombres enters de càpsules.'; }
    });
  }
  async function submit(form, button, action) {
    if (!form.reportValidity()) return;
    button.disabled = true;
    try { form.querySelector('.form-feedback')?.remove(); await action(); }
    catch (error) {
      const message = error.message || 'No s’ha pogut completar l’operació.';
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
      reader.onerror = () => reject(new Error('No s’ha pogut llegir el fitxer.'));
      reader.readAsDataURL(file);
    });
  }
  async function readFiles(list, max, pdf = false) {
    const files = Array.from(list);
    if (files.length > max) throw new Error(`Selecciona un màxim de ${max} fitxers.`);
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_FILES_BYTES) throw new Error('Els fitxers no poden superar 20 MB en total.');
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
    return files.map((file, i) => `<figure>${file.mime.startsWith('image/') ? `<img src="${escape(file.dataUrl)}" alt="${escape(file.name)}">` : '📄'}<figcaption>${escape(file.name)}</figcaption>${removable ? `<button type="button" class="small-btn" data-remove-photo="${i}">Treure</button>` : ''}</figure>`).join('');
  }

  function buildDiary() {
    $('diary-screen').innerHTML = `
      <div class="card diary-form">
        <h2>Afegir un registre</h2>
        <label>Tipus<select id="record-type"><option value="kreon">Kreon pres</option><option value="meal">Menjar</option><option value="stool">Deposició · Bristol</option><option value="weight">Pes</option></select></label>
        <form id="record-form" class="diary-form">
          ${timeField('record-time')}
          <div id="record-kreon">${capsuleFields('record-caps')}</div>
          <label id="record-meal-label">Menjar associat (per al model)<select id="record-meal"><option value="">Sense associar</option></select></label>
          <div id="record-stool" hidden class="diary-form"><label>Escala Bristol<select id="record-bristol">${BRISTOL.map((label, i) => `<option value="${i + 1}">${label}</option>`).join('')}</select></label><label>Has observat un aspecte gras o oliós?<select id="record-greasy"><option value="unknown">No ho sé / no observat</option><option value="yes">Sí</option><option value="no">no</option></select></label><p class="help">És una observació, no una mesura de greix fecal.</p><p class="help" style="margin-top:8px"><a href="https://www.england.nhs.uk/wp-content/uploads/2023/07/Bristol-stool-chart-for-people-with-a-learning-disability-print-version.pdf" target="_blank" rel="noopener">Veure la guia visual Bristol (NHS, en anglès)</a></p></div>
          <div id="record-weight" hidden>${field('Pes (kg)', 'record-kg', 'number', 'min="0.1" step="0.1"')}</div>
          ${notesField('record-notes')}
          <p class="help">Les càpsules de 10.000, 25.000 i 35.000 UI corresponen a les presentacions indicades per tu. Registra el que has pres segons la teva pauta.</p>
          <button type="submit" id="save-record" class="btn-save">✓ Desar registre</button>
        </form>
      </div>
      <div class="card">
        <h2>Línia temporal</h2>
        <div class="diary-filter">
          <label>Dia<input id="timeline-date" type="date"></label>
          <label>Tipus<select id="timeline-type"><option value="">Tots</option>${Object.entries(TYPES).map(([type, title]) => `<option value="${type}">${title}</option>`).join('')}</select></label>
        </div>
        <button type="button" id="clear-filters" class="small-btn">Veure-ho tot</button>
        <div id="timeline" class="timeline" style="margin-top:14px"></div>
      </div>
      <div class="card diary-form">
        <h2>Evolució</h2>
        <label>Dades<select id="trend-select"><option value="weight">Pes</option></select></label>
        <div id="trend-table" class="diary-table-wrap"></div>
        <p class="help">En Analítiques pots comparar àpats, greix estimat, preses, Bristol i pes per dia.</p>
      </div>
      <div class="card diary-form">
        <h2>Còpia de seguretat</h2>
        <p class="help">El diari i els informes es desen només en aquest navegador i mòbil. Exporta una còpia per conservar-los si canvies de telèfon o esborres les dades del navegador. La còpia inclou les teves fotos i informes; no inclou la clau d’API.</p>
        <button type="button" id="export-diary" class="small-btn">Descarregar còpia del diari</button>
        <label>Importar còpia (.json)<input id="import-diary" type="file" accept="application/json,.json"></label>
        <p class="help">La importació afegeix els registres nous i omite els que ya existen.</p>
      </div>`;
    const screenCards = Array.from($('diary-screen').children);
    const createDialog = $('record-dialog');
    createDialog.append(screenCards[0]);
    screenCards[0].querySelector('h2').id = 'record-dialog-title';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'small-btn'; cancel.textContent = 'Cancel·lar';
    cancel.addEventListener('click', () => createDialog.close()); $('record-form').append(cancel);
    const dialogStatus = document.createElement('p'); dialogStatus.id = 'record-status'; dialogStatus.setAttribute('role', 'status'); $('record-form').append(dialogStatus);
    for (const [index, title] of [[2, 'Evolució del pes'], [3, 'Còpia de seguretat']]) {
      const details = document.createElement('details'); details.className = 'card'; if (index === 3) details.id = 'backup-settings';
      const summary = document.createElement('summary'); summary.textContent = title;
      details.append(summary, screenCards[index]); $('settings-dialog').append(details);
    }
    $('diary-screen').innerHTML = '<div id="timeline" class="diary-table-wrap"></div><button id="new-record" type="button" class="btn-save">Nou registre</button>';
    $('new-record').addEventListener('click', openNewRecord);
    $('record-time').value = localDateTime();
    const updateRecordType = () => {
      if ($('record-type').value === 'meal') { $('record-dialog').close(); screen('meal'); $('meal-title').focus(); return; }
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
        if (type === 'weight') record.kg = number($('record-kg').value, 'pes', .1);
        await save(record);
        $('record-form').reset(); $('record-time').value = localDateTime();
        $('record-caps-total').textContent = 'Total pres: 0 UI'; updateRecordType();
        $('record-dialog').close();
      });
    });
    $('trend-select').addEventListener('change', renderTrendTable);
    $('export-diary').addEventListener('click', async () => {
      try {
        const records = await transaction('readonly', store => store.getAll());
        download(JSON.stringify({ app: 'RubyKreon', version: 1, exportedAt: new Date().toISOString(), entries: records }), `RubyKreon-${localDateTime().slice(0, 10)}.json`, 'application/json');
        status('Copia preparada. Conserva el fitxer descarregat.');
      } catch (error) { status(error.message, true); }
    });
    $('import-diary').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      e.target.disabled = true;
      try {
        if (file.size > 200 * 1024 * 1024) throw new Error('La còpia supera el límit de importació de 200 MB.');
        const backup = JSON.parse(await file.text());
        if (backup.app !== 'RubyKreon' || backup.version !== 1 || !Array.isArray(backup.entries) || backup.entries.length > 10000) throw new Error('El fitxer no és una còpia compatible de RubyKreon.');
        const records = backup.entries.map(normalizeEntry);
        const existing = new Set((await transaction('readonly', store => store.getAll())).map(record => record.id));
        const additions = records.filter(record => { if (existing.has(record.id)) return false; existing.add(record.id); return true; });
        await transaction('readwrite', store => { additions.forEach(record => store.add(record)); });
        await refresh(); status(`✓ Importats ${additions.length} registres. Els registres existents s’han conservat.`);
      } catch (error) { status(error instanceof SyntaxError ? 'La còpia no conté JSON vàlid.' : error.message, true); }
      finally { e.target.value = ''; e.target.disabled = false; }
    });
    $('timeline').addEventListener('click', async e => {
      const action = e.target.closest('[data-action]');
      if (!action) return;
      const record = entries.find(item => item.id === action.dataset.id);
      if (!record) return;
      if (action.dataset.action === 'edit') openEditor(record);
      if (action.dataset.action === 'file') downloadFile((record.files || record.photos)[Number(action.dataset.index)]);
      if (action.dataset.action === 'delete' && confirm('Esborrar aquest registre i les seves fitxers?')) {
        try { await transaction('readwrite', store => store.delete(record.id)); await refresh(); status('Registre eliminat.'); }
        catch (error) { status(error.message, true); }
      }
    });
  }

  function openNewRecord() {
    $('record-form').reset(); $('record-type').value = 'kreon';
    $('record-type').dispatchEvent(new Event('change'));
    $('record-time').value = localDateTime(); $('record-caps-total').textContent = 'Total pres: 0 UI';
    $('record-status').textContent = '';
    $('record-dialog').showModal(); $('record-type').focus();
  }
  function renderTimeline() {
    const rows = entries.map(record => {
      const date = new Date(record.timestamp);
      const day = date.toLocaleDateString('ca-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const time = date.toLocaleTimeString('ca-ES', { hour: '2-digit', minute: '2-digit' });
      return `<tr data-record-id="${record.id}"><td>${escape(day)}</td><td>${escape(time)}</td><td>${escape(TYPES[record.type])}</td><td><button type="button" class="small-btn" data-action="edit" data-id="${record.id}" aria-label="Editar ${escape(TYPES[record.type])} ${day} ${time}">Editar</button></td><td><button type="button" class="small-btn danger" data-action="delete" data-id="${record.id}" aria-label="Esborrar ${escape(TYPES[record.type])} ${day} ${time}">Esborrar</button></td></tr>`;
    }).join('');
    $('timeline').innerHTML = `<table class="diary-table records-table"><caption class="sr-only">Registres desats</caption><thead><tr><th>Dia</th><th>Hora</th><th>Tipus</th><th>Editar</th><th>Esborrar</th></tr></thead><tbody>${rows || '<tr><td colspan="5">Todavía No hi ha registres.</td></tr>'}</tbody></table>`;
  }
  function markersTable(markers) {
    return `<div class="diary-table-wrap"><table class="diary-table"><thead><tr><th>Paràmetre</th><th>Valor</th><th>Unitat</th><th>Referència dl’informe</th></tr></thead><tbody>${markers.map(marker => `<tr><td>${escape(marker.name)}</td><td>${escape(marker.value)}</td><td>${escape(marker.unit)}</td><td>${escape(marker.reference)}</td></tr>`).join('')}</tbody></table></div>`;
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
    $('trend-table').innerHTML = rows.length ? `<table class="diary-table"><thead><tr><th>Data</th><th>Valor</th><th>Unitat</th><th>Referència</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escape(new Date(row.timestamp).toLocaleDateString('ca-ES'))}</td><td>${escape(row.value)}</td><td>${escape(row.unit)}</td><td>${escape(row.reference)}</td></tr>`).join('')}</tbody></table>` : '<p class="help">Desa registres per consultar la seva evolució.</p>';
  }

  function addMarker(container, marker = {}) {
    if (container.children.length >= 200) throw new Error('Màxim 200 paràmetres per informe.');
    const row = document.createElement('div'); row.className = 'lab-marker';
    row.innerHTML = `<label>Paràmetre<input data-marker="name" maxlength="200" required value="${escape(marker.name)}"></label><div class="diary-grid"><label>Valor<input data-marker="value" maxlength="200" required value="${escape(marker.value)}"></label><label>Unitat<input data-marker="unit" maxlength="100" value="${escape(marker.unit)}"></label></div><label>Rango de referència dl’informe<input data-marker="reference" maxlength="300" value="${escape(marker.reference)}"></label><button type="button" class="small-btn danger">Treure paràmetre</button>`;
    row.querySelector('button').addEventListener('click', () => row.remove());
    container.append(row);
  }
  function readMarkers(container) {
    return normalizeMarkers(Array.from(container.children, row => Object.fromEntries(Array.from(row.querySelectorAll('[data-marker]'), input => [input.dataset.marker, input.value]))));
  }
  function openEditor(record) {
    const dialog = $('entry-editor');
    let specific = '';
    if (record.type === 'meal') specific = `${field('Descripció', 'edit-title', 'text', 'required maxlength="5000"')}${field('Quantitat (g, opcional)', 'edit-grams', 'number', 'min="0.1" step="0.1"')}<label>Ingredients<textarea id="edit-ingredients" maxlength="5000" rows="3"></textarea></label><p class="help">Canviar la descripció, ingredients o quantitat elimina la estimació anterior. Les fotos originals es conserven.</p>`;
    if (record.type === 'kreon') specific = capsuleFields('edit-caps') + `<label>Menjar associat<select id="edit-meal"><option value="">Sense associar</option>${entries.filter(item => item.type === 'meal').map(item => `<option value="${item.id}">${escape(new Date(item.timestamp).toLocaleString('ca-ES'))} · ${escape(item.title)}</option>`).join('')}</select></label>`;
    if (record.type === 'stool') specific = `<label>Bristol<select id="edit-bristol">${BRISTOL.map((label, i) => `<option value="${i + 1}">${label}</option>`).join('')}</select></label><label>Aspecte gras observat<select id="edit-greasy"><option value="unknown">No ho sé / no observat</option><option value="yes">Sí</option><option value="no">no</option></select></label>`;
    if (record.type === 'weight') specific = field('Pes (kg)', 'edit-kg', 'number', 'required min="0.1" step="0.1"');
    if (record.type === 'lab') specific = `${field('Nom de l’informe', 'edit-title', 'text', 'required maxlength="200"')}<div id="edit-markers" class="lab-marker-list"></div><button id="edit-add-marker" class="small-btn" type="button">+ Afegir paràmetre</button><label class="check-label"><input id="edit-reviewed" type="checkbox">He comprovat els valors i la data amb el original.</label><p class="help">Els fitxers originals es conserven. Pots descarregar-los des de la llista de registres.</p>`;
    dialog.innerHTML = `<form id="edit-form" class="diary-form"><h2 id="editor-title">Editar ${TYPES[record.type]}</h2>${timeField('edit-time')}${specific}${notesField('edit-notes')}<button id="edit-save" class="btn-save" type="submit">Desar canvis</button><button id="edit-cancel" class="small-btn" type="button">Cancel·lar</button></form>`;
    $('edit-time').value = localDateTime(new Date(record.timestamp)); $('edit-notes').value = record.notes;
    if (record.type === 'meal') { $('edit-title').value = record.title; $('edit-grams').value = record.grams ?? ''; $('edit-ingredients').value = record.ingredients; }
    if (record.type === 'kreon') { for (const n of [10, 25, 35]) $(`edit-caps-${n}`).value = record.capsules[n]; wireCapsules('edit-caps'); $('edit-caps-total').textContent = `Total pres: ${record.totalUI.toLocaleString('ca-ES')} UI`; $('edit-meal').value = record.mealId || ''; }
    if (record.type === 'stool') { $('edit-bristol').value = record.bristol; $('edit-greasy').value = record.greasy || 'unknown'; }
    if (record.type === 'weight') $('edit-kg').value = record.kg;
    if (record.type === 'lab') {
      $('edit-title').value = record.title; $('edit-reviewed').checked = record.reviewed;
      record.markers.forEach(marker => addMarker($('edit-markers'), marker));
      $('edit-add-marker').addEventListener('click', () => { try { addMarker($('edit-markers')); $('edit-reviewed').checked = false; } catch (error) { status(error.message, true); } });
      $('edit-markers').addEventListener('input', () => { $('edit-reviewed').checked = false; });
      $('edit-time').addEventListener('input', () => { $('edit-reviewed').checked = false; });
    }
    const originals = record.files || record.photos || [];
    if (originals.length) {
      const attachments = document.createElement('details');
      attachments.innerHTML = `<summary>Fitxers originals (${originals.length})</summary>${originals.map((file, index) => `<button type="button" class="small-btn" data-download-index="${index}">${escape(file.name)}</button>`).join('')}`;
      attachments.addEventListener('click', event => { const button = event.target.closest('[data-download-index]'); if (button) downloadFile(originals[Number(button.dataset.downloadIndex)]); });
      $('edit-form').append(attachments);
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
    $('record-meal').innerHTML = '<option value="">Sense associar</option>' + entries.filter(record => record.type === 'meal').map(record => `<option value="${record.id}">${escape(new Date(record.timestamp).toLocaleString('ca-ES'))} · ${escape(record.title)}</option>`).join('');
    if (entries.some(record => record.id === previous)) $('record-meal').value = previous;
  }
  function clearMealAnalysis() { mealAnalysis = null; window.RubyAnalytics?.renderSimulation(); ++revision; window.RubyRegression?.renderPrediction(); }
  function mealContext() { return { description: $('meal-title').value, kind: $('meal-kind').value }; }
  function renderMealPhotos() { $('meal-extra-list').innerHTML = attachmentList(extraPhotos, true); checkReady(); }
  function resetMealPhotos() {
    ++mealFilesVersion; mealFilesReading = false; extraPhotos = []; renderMealPhotos(); clearMealAnalysis();
  }
  async function addMealPhotos(list) {
    if (mealFilesReading) { status('Espera que es carreguin les fotos.', true); return; }
    const version = ++mealFilesVersion;
    mealFilesReading = true; clearMealAnalysis(); $('results').style.display = 'none';
    try {
      const files = await readFiles(list, 4 - extraPhotos.length);
      if (version !== mealFilesVersion) return;
      if ([...extraPhotos, ...files].reduce((sum, file) => sum + file.size, 0) > MAX_FILES_BYTES) throw new Error('Les fotos no poden superar 20 MB en total.');
      extraPhotos.push(...files); renderMealPhotos(); status('');
    } catch (error) { if (version === mealFilesVersion) status(error.message, true); }
    finally { if (version === mealFilesVersion) { mealFilesReading = false; ++revision; checkReady(); } }
  }
  function addMealPhotoData(photo) {
    try {
      if (mealFilesReading) throw new Error('Espera que es carreguin les fotos.');
      const file = normalizeFile(photo);
      if (extraPhotos.length >= 4) throw new Error('Un àpat admet fins a 4 fotos.');
      if (extraPhotos.reduce((sum, photo) => sum + photo.size, file.size) > MAX_FILES_BYTES) throw new Error('Les fotos no poden superar 20 MB en total.');
      extraPhotos.push(file); ++mealFilesVersion; clearMealAnalysis(); $('results').style.display = 'none'; renderMealPhotos(); status('');
    } catch (error) { status(error.message, true); }
  }
  function buildMeals() {
    $('meal-time').value = localDateTime();
    $('meal-title').addEventListener('input', () => { clearMealAnalysis(); $('results').style.display = 'none'; checkReady(); });
    $('meal-kind').addEventListener('change', () => { clearMealAnalysis(); $('results').style.display = 'none'; window.RubyAnalytics.renderCapsules(); });
    $('meal-time').addEventListener('input', () => window.RubyRegression.renderPrediction());
    $('meal-extra-list').addEventListener('click', e => {
      const button = e.target.closest('[data-remove-photo]');
      if (!button) return;
      extraPhotos.splice(Number(button.dataset.removePhoto), 1); ++mealFilesVersion; mealFilesReading = false; clearMealAnalysis();
      $('results').style.display = 'none'; renderMealPhotos();
    });
    $('meal-form').addEventListener('submit', e => {
      e.preventDefault();
      submit(e.target, $('save-meal'), async () => {
        if (mealFilesReading) throw new Error('Espera que es carreguin les fotos.');
        const photos = [...extraPhotos];
        if (imageBase64) photos.unshift({ name: 'plat.' + (imageMime.split('/')[1] || 'jpg'), mime: imageMime, dataUrl: `data:${imageMime};base64,${imageBase64}` });
        await save({ ...newRecord('meal', localDateTime(), ''), title: $('meal-title').value.trim() || mealAnalysis?.dish || 'Menjar', grams: null, ingredients: '', kind: $('meal-kind').value, suggestion: window.RubyAnalytics.suggestForMeal($('meal-kind').value), photos, analysis: mealAnalysis });
        $('meal-form').reset(); $('meal-time').value = localDateTime();
        ++mealFilesVersion; extraPhotos = []; mealFilesReading = false;
        $('meal-extra-list').replaceChildren(); resetImage(); window.RubyAnalytics.renderCapsules(); screen('diary');
      });
    });
  }

  window.RubyDiary = {
    addMealPhotos, addMealPhotoData, resetMealPhotos,
    getEntries: () => entries,
    getMealAnalysis: () => mealAnalysis,
    saveReview: report => save({ ...newRecord('review', new Date().toISOString()), report }),
    prepareTakenDose(capsules) {
      openNewRecord();
      $('record-type').value = 'kreon'; $('record-type').dispatchEvent(new Event('change'));
      for (const n of [10, 25, 35]) $(`record-caps-${n}`).value = capsules[n] || 0;
      $('record-caps-10').dispatchEvent(new Event('input'));
      $('record-time').value = localDateTime(); screen('diary');
      status('Revisa la combinació i desa el registre quan hagis pres les càpsules.');
    },
    clearMealAnalysis, mealRevision: () => revision, mealContext,
    mealImages: () => {
      if (mealFilesReading) throw new Error('Espera que es carreguin les fotos addicionals.');
      const size = (imageBase64?.length || 0) * .75 + extraPhotos.reduce((sum, file) => sum + file.size, 0);
      if (size > MAX_FILES_BYTES) throw new Error('Les fotos de l’àpat superen els 20 MB en total. Treu alguna foto o tria imatges més petites.');
      return extraPhotos;
    },
    setMealAnalysis(fat) {
      $('meal-time').value = localDateTime();
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
    } catch (error) { status(error.message || 'No s’ha pogut obrir el diari en aquest navegador.', true); }
  });
})();
