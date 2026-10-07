"""Browser regression tests. Synthetic history and mocked AI only; no clinical validation."""
import base64
import json
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get('RUBYKREON_TEST_URL', 'http://127.0.0.1:8765/RubyKreon_App/')
CHROME = os.environ.get('RUBYKREON_CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=')
PDF = b'%PDF-1.4\n% Synthetic legacy fixture\n%%EOF'


def stored(page):
    return page.evaluate("""() => new Promise((resolve, reject) => {
      const r = indexedDB.open('rubykreon-diary',1);
      r.onsuccess = () => {const db=r.result; const q=db.transaction('entries').objectStore('entries').getAll();
        q.onsuccess=()=>{resolve(q.result);db.close();}; q.onerror=()=>reject(q.error);};
    })""")


def count(page, n):
    expect(page.locator('#timeline article')).to_have_count(n)


def synthetic_history():
    records = [{'id':'seed-dose','type':'kreon','timestamp':'2026-07-31T18:00:00Z','capsules':{'10':0,'25':1,'35':0}}]
    start = datetime(2026,8,1,tzinfo=timezone.utc)
    for i in range(40):
        date = start + timedelta(days=i)
        def stamp(hour):
            return date.replace(hour=hour).isoformat().replace('+00:00','Z')
        fat = 10 + (i % 7) * 5
        target = 20000 + fat * 1000
        # Exact combinations of 10k/25k/35k, without relying on the app implementation.
        if target % 10000 == 0:
            capsules = {'10':target//10000,'25':0,'35':0}
        else:
            capsules = {'10':(target-25000)//10000,'25':1,'35':0}
        records += [
            {'id':f'weight-{i}','type':'weight','timestamp':stamp(6),'kg':64+(i%3)*.1},
            {'id':f'stool-{i}','type':'stool','timestamp':stamp(8),'bristol':1+(i*3)%7,'greasy':'yes' if i%2 else 'no'},
            {'id':f'meal-{i}','type':'meal','timestamp':stamp(12),'title':f'Comida sintética {i}','grams':200,'ingredients':'Datos sintéticos','photos':[],
             'analysis':{'totalFat':fat,'calories':400,'confidence':80,'dose':None}},
            {'id':f'dose-{i}','type':'kreon','timestamp':stamp(13),'mealId':f'meal-{i}','capsules':capsules}
        ]
    return records


def run():
    with sync_playwright() as p, tempfile.TemporaryDirectory(prefix='rubykreon-test-') as tmp:
        options={'headless':True}
        if Path(CHROME).exists(): options['executable_path']=CHROME
        browser=p.chromium.launch(**options)
        context=browser.new_context(viewport={'width':390,'height':844},timezone_id='Europe/Madrid',accept_downloads=True)
        page=context.new_page(); errors=[]; requests=[]; mode={'value':'success'}; pending=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        def mock(route):
            body=route.request.post_data_json; requests.append(body)
            if mode['value']=='hold': pending.append(route); return
            diary=any(m['role']=='system' for m in body['messages'])
            if diary:
                data=json.loads(body['messages'][1]['content'])
                result={'summary':'Hay datos registrados para revisar.','observations':['El historial reúne comidas y tomas.'],
                        'missingData':['Falta completar el contexto clínico.'],'questionsForClinician':['¿Qué datos adicionales conviene registrar?'],
                        'doseReview':{'status':'review_needed','reason':'Revisar la secuencia temporal con el profesional.','evidenceIds':[data['events'][0]['id']],'proposedUI':None}}
                if mode['value']=='unsafe': result['doseReview']['proposedUI']=100000
                if mode['value']=='invalid-ids': result['doseReview']['evidenceIds']=['invented-id']
            else:
                result={'dish':'Arroz con pollo','totalFat':12.5,'saturatedFat':2,'calories':420,'confidence':80,'description':'Estimación sintética.'}
            route.fulfill(content_type='application/json',body=json.dumps({'choices':[{'finish_reason':'stop','message':{'content':json.dumps(result)}}]}))
        context.route('https://openrouter.ai/api/v1/chat/completions',mock)
        page.goto(URL); page.wait_for_selector('#record-form',state='attached')
        assert page.locator('#med-type').count()==0 and page.locator('#dose-per-gram').count()==0
        assert page.locator('#lab-files').count()==0
        expect(page.locator('#capsule-details')).to_contain_text('pauta prescrita')
        expect(page.locator('#api-key-input')).not_to_be_visible()
        assert page.locator('#install-card, #install-banner').count()==0
        page.locator('#meal-title').fill('Arroz con pollo')
        expect(page.locator('#analyze-btn')).to_be_enabled()
        page.locator('#analyze-btn').click()
        expect(page.locator('#settings-dialog')).to_be_visible()
        page.locator('#api-key-input').fill('sk-or-test-only'); page.get_by_role('button',name='Guardar',exact=True).click()
        page.get_by_role('button',name='Cerrar ajustes').click()
        page.locator('#meal-title').fill('')
        expect(page.locator('#analyze-btn')).to_be_disabled()
        page.locator('#meal-title').fill('150 g de arroz cocido con 100 g de pollo y 10 g de aceite')
        expect(page.locator('#analyze-btn')).to_be_enabled()
        page.locator('#analyze-btn').click(); expect(page.locator('#results')).to_be_visible()
        content=requests[-1]['messages'][0]['content']
        assert len(content)==1 and content[0]['type']=='text'
        expect(page.locator('#aemps-reference-card')).to_be_visible()
        assert page.locator('#aemps-reference-combinations tbody tr').count()==12
        reference=page.locator('#aemps-reference-combinations tbody tr').all_text_contents()
        assert any('25.0001 cápsula de 25.000 UI1' in row for row in reference)
        assert any('80.000' in row and '3' in row for row in reference)
        assert page.evaluate('RubyAnalytics.suggestForMeal()') is None
        expect(page.locator('#simulation-result')).to_contain_text('12.500 UI')
        expect(page.locator('#simulation-capsules')).to_contain_text('no tiene una combinación exacta')
        page.locator('#simulation-ui-per-gram').fill('2000')
        expect(page.locator('#simulation-result')).to_contain_text('25.000 UI')
        expect(page.locator('#simulation-capsules tbody tr')).to_have_count(1)
        expect(page.locator('#simulation-capsules tbody')).to_contain_text('25.000')
        page.locator('#save-simulation-factor').click()
        assert page.evaluate("localStorage.getItem('rubykreon-demo-ui-per-gram')")=='2000'
        assert page.evaluate('RubyAnalytics.suggestForMeal()') is None
        page.locator('#simulation-ui-per-gram').fill('0')
        expect(page.locator('#simulation-capsules tbody tr')).to_have_count(0)
        page.locator('#simulation-ui-per-gram').fill('2000')
        assert '150 g de arroz cocido' in content[0]['text']
        page.locator('#meal-title').fill(' ')
        expect(page.locator('#analyze-btn')).to_be_disabled()
        expect(page.locator('#results')).not_to_be_visible()
        page.locator('#file-input').set_input_files({'name':'plato.png','mimeType':'image/png','buffer':PNG})
        page.locator('#meal-title').fill('Arroz con pollo'); page.locator('#meal-grams').fill('250')
        page.locator('#meal-ingredients').fill('150 g de arroz, 100 g de pollo')
        page.locator('#meal-extra').set_input_files({'name':'ingredientes.png','mimeType':'image/png','buffer':PNG})
        expect(page.locator('#meal-extra-list figure')).to_have_count(1)
        page.locator('#analyze-btn').click(); expect(page.locator('#results')).to_be_visible()
        assert len(requests[-1]['messages'][0]['content'])==3
        page.locator('#save-meal').click(); count(page,1)
        meal=stored(page)[0]; assert meal['analysis']['dose'] is None and meal['suggestion'] is None
        assert len(meal['photos'])==2
        print('PASS: removed medicine parameters and laboratory UI; meals work without an invented dose')

        page.locator('[data-screen="lab"]').click()
        page.locator('details:has(#regimen-form) > summary').click()
        page.locator('#regimen-meal').fill('65000'); page.locator('#regimen-snack').fill('25000')
        page.locator('#regimen-confirmed').check(); page.locator('#regimen-form button[type="submit"]').click()
        expect(page.locator('#regimen-status')).to_contain_text('Pauta guardada')
        page.locator('[data-screen="meal"]').click()
        expect(page.locator('#capsule-details')).to_contain_text('3 cápsulas de 10.000')
        expect(page.locator('#capsule-details')).to_contain_text('1 cápsula de 35.000')
        expect(page.locator('#capsule-breakdown')).to_contain_text('65.000')
        page.locator('#meal-kind').select_option('snack'); expect(page.locator('#capsule-details')).to_contain_text('1 cápsula de 25.000')
        page.locator('#use-capsules').click(); assert len(stored(page))==1
        page.locator('#record-meal').select_option(meal['id'])
        page.locator('#save-record').click(); count(page,2)
        assert next(r for r in stored(page) if r['type']=='kreon')['mealId']==meal['id']
        page.locator('#record-type').select_option('stool'); page.locator('#record-bristol').select_option('7'); page.locator('#record-greasy').select_option('yes')
        page.locator('#save-record').click(); count(page,3)
        page.locator('#record-type').select_option('weight'); page.locator('#record-kg').fill('65.2'); page.locator('#save-record').click(); count(page,4)
        page.reload(); page.locator('[data-screen="diary"]').click(); count(page,4)
        print('PASS: exact prescribed capsule combinations, snack selection, explicit taking and meal association, persistence')

        page.locator('[data-screen="lab"]').click()
        expect(page.locator('#analytics-metrics')).to_contain_text('25.000 UI')
        expect(page.locator('#analytics-metrics')).to_contain_text('12,5 g')
        page.locator('#analyze-diary').click(); expect(page.locator('#analytics-result')).to_contain_text('Faltan datos')
        review_request=requests[-1]
        payload=json.loads(review_request['messages'][1]['content'])
        assert set(e['type'] for e in payload['events'])=={'meal','kreon','stool','weight'}
        assert 'data:image' not in review_request['messages'][1]['content']
        assert 'AEMPS' in review_request['messages'][0]['content']
        assert 'greasyAppearance' in review_request['messages'][1]['content']
        assert page.evaluate("JSON.parse(localStorage.getItem('rubykreon-prescribed-regimen')).mealUI")==65000
        page.locator('#save-review').click(); expect(page.locator('#analytics-status')).to_contain_text('Análisis guardado')
        review=next(r for r in stored(page) if r['type']=='review'); assert review['report']['doseReview']['status']=='insufficient_data'
        mode['value']='unsafe'; page.locator('#analyze-diary').click(); expect(page.locator('#analytics-status')).to_have_class('help error')
        expect(page.locator('#save-review')).not_to_be_visible()
        assert page.evaluate("JSON.parse(localStorage.getItem('rubykreon-prescribed-regimen')).mealUI")==65000
        mode['value']='invalid-ids'; page.locator('#analyze-diary').click(); expect(page.locator('#analytics-status')).to_contain_text('registros que no')
        mode['value']='hold'; page.locator('#analyze-diary').click(); expect(page.locator('#cancel-analysis')).to_be_visible()
        page.locator('#cancel-analysis').click(); expect(page.locator('#analytics-status')).to_contain_text('cancelado')
        if pending: pending.pop().fulfill(content_type='application/json',body='{}')
        mode['value']='success'
        print('PASS: diary-only LLM payload, official reference, missing-context guard, no autonomous dosing, invented evidence rejection, cancellation')

        page.locator('[data-screen="diary"]').click(); count(page,5)
        legacy={'id':'legacy-pdf','type':'lab','timestamp':'2026-06-01T12:00:00Z','title':'Documento anterior','markers':[],
                'files':[{'name':'original.pdf','mime':'application/pdf','dataUrl':'data:application/pdf;base64,'+base64.b64encode(PDF).decode()}]}
        page.locator('#import-diary').set_input_files({'name':'old.json','mimeType':'application/json','buffer':json.dumps({'app':'RubyKreon','version':1,'entries':[legacy]}).encode()})
        count(page,6)
        page.locator('article:has([data-id="legacy-pdf"]) summary').click()
        with page.expect_download() as info: page.locator('[data-action="file"][data-id="legacy-pdf"]').click()
        assert Path(info.value.path()).read_bytes()==PDF
        with page.expect_download() as info: page.locator('#export-diary').click()
        backup_path=Path(tmp)/'backup.json'; info.value.save_as(backup_path)
        backup=json.loads(backup_path.read_text()); assert len(backup['entries'])==6 and 'sk-or-test-only' not in backup_path.read_text()
        fresh=browser.new_context(viewport={'width':390,'height':844},timezone_id='Europe/Madrid')
        second=fresh.new_page(); second.on('pageerror',lambda e:errors.append(str(e)))
        second.goto(URL); second.wait_for_selector('#record-form',state='attached'); second.locator('[data-screen="diary"]').click()
        second.locator('#import-diary').set_input_files(str(backup_path)); count(second,6)
        second.locator('#import-diary').set_input_files(str(backup_path)); expect(second.locator('#diary-status')).to_contain_text('Importados 0')
        assert second.evaluate("localStorage.getItem('rubykreon-prescribed-regimen')")==None
        print('PASS: legacy originals retained, backup and restore, duplicate-safe import, prescriptions not invented from backups')

        history=synthetic_history()
        second.locator('#import-diary').set_input_files({'name':'synthetic.json','mimeType':'application/json','buffer':json.dumps({'app':'RubyKreon','version':1,'entries':history}).encode()})
        count(second,167)
        second.locator('[data-screen="lab"]').click()
        second.locator('#train-regression').click(); expect(second.locator('#regression-status')).to_contain_text('Modelo entrenado')
        expect(second.locator('#regression-result')).to_contain_text('32 comidas de entrenamiento')
        expect(second.locator('#regression-result')).to_contain_text('8 de validación')
        math=second.evaluate("""() => {
          const data=RubyRegression.dataset(RubyDiary.getEntries()); const trained=RubyRegression.train(data.rows);
          const future={id:'future',type:'weight',timestamp:'2027-01-01T12:00:00Z',kg:999};
          const after=RubyRegression.dataset([...RubyDiary.getEntries(),future]);
          return {rows:data.rows.length,mae:trained.metrics.mae,r2:trained.metrics.r2,
            unchanged:JSON.stringify(data.rows)===JSON.stringify(after.rows),
            meanBaseline:trained.meanBaseline.mae, latestBaseline:trained.previousDoseBaseline.mae,
            split:trained.trainingEnd < trained.validation[0].timestamp};
        }""")
        assert math['rows']==40 and math['mae']<.01 and math['r2']>.9999
        assert math['unchanged'] and math['split'] and math['meanBaseline']>math['mae']
        late_label=second.evaluate("""() => {
          const rows=RubyRegression.dataset(RubyDiary.getEntries()).rows;
          rows[0]={...rows[0],targetAvailableAt:'2027-01-01T12:00:00Z',y:1000000};
          const fitted=RubyRegression.train(rows); return {count:fitted.trainingCount,mae:fitted.metrics.mae};
        }""")
        assert late_label['count']==31 and late_label['mae']<.01
        assert second.evaluate("localStorage.getItem('rubykreon-prescribed-regimen')")==None
        # Collinear and constant features must be omitted rather than create unstable coefficients.
        constant=second.evaluate("""() => {
          const rows=Array.from({length:40},(_,i)=>({x:[i,65,2*i,0,25000],y:20000+1000*i,timestamp:new Date(Date.UTC(2026,0,i+1)).toISOString()}));
          const result=RubyRegression.train(rows); return {error:result.metrics.mae,omitted:result.omitted.length};
        }""")
        assert constant['error']<.01 and constant['omitted']==4
        second.locator('[data-screen="meal"]').click(); second.locator('#meal-time').fill('2026-09-10T12:00')
        second.evaluate("RubyDiary.setMealAnalysis({totalFat:20,calories:400,confidence:80,dish:'Prueba',description:'Prueba sintética'})")
        expect(second.locator('#regression-prediction')).to_contain_text('Predicción del registro:')
        expect(second.locator('#capsule-details')).to_contain_text('Indica tu pauta prescrita')
        print('PASS: linear fit against known synthetic relationship, chronological validation, future-data exclusion, collinearity handling, prediction separated from prescribing')

        second.locator('[data-screen="diary"]').click()
        second.locator('#timeline-type').select_option('stool'); expect(second.locator('#timeline article')).to_have_count(41)
        second.locator('#clear-filters').click(); count(second,167)
        invalid={'app':'RubyKreon','version':1,'entries':[{'id':'bad','type':'stool','timestamp':'2026-10-07','bristol':0}]}
        second.locator('#import-diary').set_input_files({'name':'invalid.json','mimeType':'application/json','buffer':json.dumps(invalid).encode()})
        expect(second.locator('#diary-status')).to_have_class('error'); assert len(stored(second))==167
        second.evaluate('() => navigator.serviceWorker.ready'); second.reload(); second.wait_for_function('Boolean(navigator.serviceWorker.controller)')
        assert second.evaluate("() => caches.open('rubykreon-v11').then(c=>c.keys()).then(keys=>keys.some(k=>k.url.endsWith('/regression.js')))")
        fresh.set_offline(True); second.reload(); second.locator('[data-screen="diary"]').click(); count(second,167); fresh.set_offline(False)
        assert second.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert not errors,errors
        print('PASS: filtering, invalid-import preservation, offline diary and model assets, mobile layout, no browser errors')
        fresh.close(); context.close(); browser.close()


if __name__=='__main__': run()
