"""Browser regression checks with synthetic files and mocked AI (no API charges).

Run a local server for the app, then:
  RUBYKREON_TEST_URL=http://127.0.0.1:8765/ python3 tests/test_diary_browser.py
Requires Python playwright and Chrome, or a Playwright Chromium installation.
"""
import base64
import json
import os
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get('RUBYKREON_TEST_URL', 'http://127.0.0.1:8765/')
CHROME = os.environ.get('RUBYKREON_CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=')
PDF = b'%PDF-1.4\n% Synthetic lab fixture, not a real patient document.\n%%EOF'


def stored(page):
    return page.evaluate("""() => new Promise((resolve, reject) => {
      const r = indexedDB.open('rubykreon-diary', 1);
      r.onsuccess = () => {
        const db = r.result;
        const request = db.transaction('entries').objectStore('entries').getAll();
        request.onsuccess = () => { resolve(request.result); db.close(); };
        request.onerror = () => reject(request.error);
      };
    })""")


def wait_count(page, count):
    expect(page.locator('#timeline article')).to_have_count(count)


def run():
    with sync_playwright() as p, tempfile.TemporaryDirectory(prefix='rubykreon-test-') as tmp:
        options = {'headless': True}
        if Path(CHROME).exists():
            options['executable_path'] = CHROME
        browser = p.chromium.launch(**options)
        context = browser.new_context(viewport={'width': 390, 'height': 844}, timezone_id='Europe/Madrid', accept_downloads=True)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        requests = []
        pending = []
        ai_mode = {'value': 'success'}

        def mock_ai(route):
            body = route.request.post_data_json
            requests.append(body)
            if ai_mode['value'] == 'hold':
                pending.append(route)
                return
            if ai_mode['value'] == 'error':
                route.fulfill(status=503, content_type='application/json', body=json.dumps({'error': {'message': 'Servicio no disponible'}}))
                return
            lab = any(message['role'] == 'system' for message in body['messages'])
            data = {'date': '2026-10-06', 'markers': [
                {'name': 'Hemoglobina', 'value': '13,4', 'unit': 'g/dL', 'reference': '12–16'},
                {'name': 'Proteína C reactiva', 'value': '<0,5', 'unit': 'mg/L', 'reference': '<5'}
            ], 'notes': 'Documento sintético de prueba.'} if lab else {
                'dish': 'Arroz con pollo', 'totalFat': 12.5, 'saturatedFat': 2, 'calories': 420,
                'confidence': 80, 'description': 'Estimación sintética de prueba.'
            }
            route.fulfill(content_type='application/json', body=json.dumps({'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(data)}}]}))

        context.route('https://openrouter.ai/api/v1/chat/completions', mock_ai)
        page.goto(URL)
        page.wait_for_selector('#record-form', state='attached')
        # Store only a fake test key.
        page.locator('#api-key-input').fill('sk-or-test-only')
        page.get_by_role('button', name='Guardar', exact=True).click()
        page.locator('#file-input').set_input_files({'name': 'plato.png', 'mimeType': 'image/png', 'buffer': PNG})
        expect(page.locator('#preview-wrap')).to_be_visible()
        page.locator('#meal-title').fill('Arroz con pollo')
        page.locator('#meal-grams').fill('250')
        page.locator('#meal-ingredients').fill('150 g de arroz, 100 g de pollo')
        page.locator('#meal-extra').set_input_files({'name': 'ingredientes.png', 'mimeType': 'image/png', 'buffer': PNG})
        expect(page.locator('#meal-extra-list figure')).to_have_count(1)
        page.locator('#analyze-btn').click()
        expect(page.locator('#results')).to_be_visible()
        assert len(requests[-1]['messages'][0]['content']) == 3  # two photos + context
        assert '150 g de arroz' in requests[-1]['messages'][0]['content'][-1]['text']
        page.locator('#save-meal').click()
        wait_count(page, 1)
        meal = stored(page)[0]
        assert len(meal['photos']) == 2 and meal['analysis']['totalFat'] == 12.5
        assert meal['grams'] == 250
        assert not any(r['type'] == 'kreon' for r in stored(page))
        print('PASS: multiple meal photos, ingredient-aware AI, independent meal and taken dose')

        page.locator('#record-caps-10').fill('3')
        page.locator('#record-caps-25').fill('0')
        page.locator('#record-caps-35').fill('1')
        expect(page.locator('#record-caps-total')).to_contain_text('65.000')
        page.locator('#save-record').click()
        wait_count(page, 2)
        assert next(r for r in stored(page) if r['type'] == 'kreon')['totalUI'] == 65000
        # Invalid values in a different record type must not block the visible form.
        page.locator('#record-caps-10').fill('-1')
        page.locator('#record-type').select_option('stool')
        page.locator('#record-bristol').select_option('7')
        page.locator('#save-record').click()
        wait_count(page, 3)
        page.locator('#record-type').select_option('weight')
        page.locator('#record-kg').fill('65.2')
        page.locator('#save-record').click()
        wait_count(page, 4)
        expect(page.locator('#trend-table')).to_contain_text('65.2')
        page.reload()
        page.locator('[data-screen="diary"]').click()
        wait_count(page, 4)
        print('PASS: mixed Kreon strengths, Bristol, weight, persistence after reload')

        # Edit weight and retain its ID.
        weight_id = next(r['id'] for r in stored(page) if r['type'] == 'weight')
        page.locator(f'[data-action="edit"][data-id="{weight_id}"]').click()
        page.locator('#edit-kg').fill('65.4')
        page.locator('#edit-save').click()
        expect(page.locator('#entry-editor')).not_to_be_visible()
        assert next(r for r in stored(page) if r['id'] == weight_id)['kg'] == 65.4
        page.locator('#timeline-type').select_option('weight')
        wait_count(page, 1)
        page.locator('#clear-filters').click()
        wait_count(page, 4)

        page.locator('[data-screen="lab"]').click()
        page.locator('#lab-title').fill('Revisión sintética')
        page.locator('#lab-files').set_input_files({'name': 'informe.pdf', 'mimeType': 'application/pdf', 'buffer': PDF})
        expect(page.locator('#lab-file-list figure')).to_have_count(1)
        page.locator('#read-lab').click()
        expect(page.locator('#lab-markers .lab-marker')).to_have_count(2)
        assert requests[-1]['plugins'][0]['pdf']['engine'] == 'mistral-ocr'
        assert requests[-1]['messages'][1]['content'][1]['file']['file_data'].startswith('data:application/pdf;base64,')
        assert page.locator('#lab-time').input_value() == '2026-10-06T12:00'
        page.locator('#save-lab').click()
        expect(page.locator('#diary-status')).to_contain_text('Confirma')
        assert len(stored(page)) == 4
        page.locator('#lab-markers [data-marker="value"]').first.fill('13,5')
        page.locator('#lab-reviewed').check()
        page.locator('#save-lab').click()
        wait_count(page, 5)
        lab = next(r for r in stored(page) if r['type'] == 'lab')
        assert lab['reviewed'] and lab['markers'][0]['value'] == '13,5'
        assert base64.b64decode(lab['files'][0]['dataUrl'].split(',')[1]) == PDF
        page.locator('#trend-select').select_option(label='Hemoglobina (g/dL)')
        expect(page.locator('#trend-table')).to_contain_text('13,5')
        print('PASS: PDF request, editable extraction, mandatory review, original bytes, lab evolution')

        # Read an archived report again without creating a duplicate.
        page.locator(f'[data-action="lab"][data-id="{lab["id"]}"]').click()
        expect(page.locator('#lab-markers .lab-marker')).to_have_count(2)
        page.locator('#lab-markers [data-marker="value"]').first.fill('13,6')
        expect(page.locator('#lab-reviewed')).not_to_be_checked()
        page.locator('#lab-reviewed').check()
        page.locator('#save-lab').click()
        wait_count(page, 5)
        assert next(r for r in stored(page) if r['id'] == lab['id'])['markers'][0]['value'] == '13,6'

        # Cancelling a pending extraction releases the form and discards late results.
        page.locator('[data-screen="lab"]').click()
        page.locator('#lab-title').fill('Lectura cancelada')
        page.locator('#lab-files').set_input_files({'name': 'cancelar.pdf', 'mimeType': 'application/pdf', 'buffer': PDF})
        expect(page.locator('#lab-file-list figure')).to_have_count(1)
        ai_mode['value'] = 'hold'
        page.locator('#read-lab').click()
        expect(page.locator('#lab-title')).to_be_disabled()
        page.locator('#cancel-lab').click()
        expect(page.locator('#lab-title')).to_be_enabled()
        expect(page.locator('#lab-markers .lab-marker')).to_have_count(0)
        if pending:
            pending.pop().fulfill(content_type='application/json', body=json.dumps({'choices':[{'message':{'content':json.dumps({'date':None,'markers':[{'name':'Respuesta tardía','value':'99'}]})}}]}))
        expect(page.locator('#lab-markers .lab-marker')).to_have_count(0)
        assert len(stored(page)) == 5

        # A reading failure still allows the original to be archived.
        page.locator('[data-screen="lab"]').click()
        page.locator('#lab-title').fill('Informe pendiente')
        page.locator('#lab-files').set_input_files({'name': 'pagina.png', 'mimeType': 'image/png', 'buffer': PNG})
        expect(page.locator('#lab-file-list figure')).to_have_count(1)
        ai_mode['value'] = 'error'
        page.locator('#read-lab').click()
        expect(page.locator('#lab-status')).to_contain_text('Servicio no disponible')
        page.locator('#save-lab').click()
        wait_count(page, 6)
        assert any(r['type'] == 'lab' and not r['markers'] and r['files'] for r in stored(page))
        print('PASS: archived report updates, image input, API failure preserves manual archival')

        # Original archive download and backup must contain exact synthetic bytes.
        page.locator(f'article:has([data-id="{lab["id"]}"]) summary').click()
        with page.expect_download() as download_info:
            page.locator(f'[data-action="file"][data-id="{lab["id"]}"]').click()
        document = download_info.value
        assert Path(document.path()).read_bytes() == PDF
        with page.expect_download() as download_info:
            page.locator('#export-diary').click()
        backup_path = Path(tmp) / 'backup.json'
        download_info.value.save_as(backup_path)
        backup = json.loads(backup_path.read_text())
        assert len(backup['entries']) == 6
        assert 'sk-or-test-only' not in backup_path.read_text()
        page.locator('#import-diary').set_input_files(str(backup_path))
        expect(page.locator('#diary-status')).to_contain_text('Importados 0')
        assert len(stored(page)) == 6
        # Restore into an empty profile, including reports and photos.
        second = context.new_page()
        second.goto(URL)
        second.wait_for_selector('#record-form', state='attached')
        second.evaluate("""() => new Promise(resolve => {
          const r = indexedDB.open('rubykreon-diary', 1);
          r.onsuccess = () => { const db = r.result; const tx = db.transaction('entries','readwrite'); tx.objectStore('entries').clear(); tx.oncomplete = () => { db.close(); resolve(); }; };
        })""")
        second.reload()
        second.locator('[data-screen="diary"]').click()
        second.locator('#import-diary').set_input_files(str(backup_path))
        wait_count(second, 6)
        restored = stored(second)
        assert next(r for r in restored if r['id'] == lab['id'])['files'][0]['dataUrl'] == lab['files'][0]['dataUrl']
        print('PASS: original download, full backup, duplicate-safe import, restore originals')

        # Reject an invalid backup as a unit; preserve existing history.
        invalid = dict(backup)
        invalid['entries'] = [dict(backup['entries'][0], id='new-identifier'), {'id': 'bad', 'type': 'stool', 'timestamp': '2026-10-07', 'bristol': 0}]
        second.locator('#import-diary').set_input_files({'name': 'invalid.json', 'mimeType': 'application/json', 'buffer': json.dumps(invalid).encode()})
        expect(second.locator('#diary-status')).to_have_class('error')
        assert len(stored(second)) == 6
        # Dynamic report text must be rendered as text, never executable HTML.
        second.locator('[data-screen="meal"]').click()
        second.locator('#meal-title').fill('<img src=x onerror="window.injected=true">')
        second.locator('#save-meal').click()
        wait_count(second, 7)
        assert not second.evaluate('Boolean(window.injected)')
        assert second.locator('#timeline h3').filter(has_text='<img src=x').count() == 1
        # Bristol 0/8, non-integer capsules and unsafe document schemes are rejected.
        validation = second.evaluate("""() => {
          const base = {id:'test', timestamp:'2026-10-07T10:00:00Z'};
          const cases = [{...base,type:'stool',bristol:0}, {...base,type:'stool',bristol:8}, {...base,type:'kreon',capsules:{10:1.5}}, {...base,type:'lab',files:[{mime:'application/pdf',dataUrl:'javascript:alert(1)'}]}];
          return cases.map(item => {try {RubyDiary.normalizeEntry(item); return false;} catch {return true;}});
        }""")
        assert all(validation)
        print('PASS: invalid backup is atomic, safe text rendering, Bristol and capsule validation')

        assert not errors, errors
        assert second.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile layout overflows'
        second.screenshot(path=str(Path(tmp) / 'mobile-diary.png'), full_page=True)
        # Deleting asks explicitly and leaves unrelated records untouched.
        second.once('dialog', lambda dialog: dialog.accept())
        second.locator(f'[data-action="delete"][data-id="{weight_id}"]').click()
        wait_count(second, 6)
        print('PASS: mobile layout, no browser errors, record deletion')
        # Real service worker caches every new asset and preserves the local diary offline.
        if '/RubyKreon_App/' in URL:
            second.evaluate('() => navigator.serviceWorker.ready')
            second.reload()
            second.wait_for_function('Boolean(navigator.serviceWorker.controller)')
            assert second.evaluate("() => caches.open('rubykreon-v4').then(c => c.keys()).then(keys => keys.some(k => k.url.endsWith('/diary.js')))")
            context.set_offline(True)
            second.reload()
            second.locator('[data-screen="diary"]').click()
            wait_count(second, 6)
            second.locator('#record-type').select_option('weight')
            second.locator('#record-kg').fill('66')
            second.locator('#save-record').click()
            wait_count(second, 7)
            context.set_offline(False)
            print('PASS: service worker assets, offline launch, offline diary reads and writes')
        # On Android, Tomar foto opens the native capture input, without requesting a video stream.
        mobile = browser.new_context(user_agent='Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36', viewport={'width':390,'height':844})
        phone = mobile.new_page()
        phone.goto(URL)
        phone.wait_for_selector('#record-form', state='attached')
        phone.evaluate("""() => {
          window.streamRequested = false;
          navigator.mediaDevices.getUserMedia = () => {window.streamRequested = true; return Promise.reject(new Error('Unexpected stream'));};
        }""")
        with phone.expect_file_chooser() as chooser:
            phone.locator('#camera-btn').click()
        assert chooser.value.element.get_attribute('capture') == 'environment'
        chooser.value.set_files({'name':'captura.png','mimeType':'image/png','buffer':PNG})
        expect(phone.locator('#preview-wrap')).to_be_visible()
        assert not phone.evaluate('window.streamRequested')
        print('PASS: Android native photo capture is preserved')
        mobile.close()
        context.close()
        browser.close()


if __name__ == '__main__':
    run()
