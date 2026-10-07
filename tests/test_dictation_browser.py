"""Dictation integration with synthetic speech events; no microphone/network required."""
import os
from playwright.sync_api import sync_playwright

URL = os.environ.get('RUBYKREON_TEST_URL', 'http://127.0.0.1:8765/RubyKreon_App/')
MOCK = """window.webkitSpeechRecognition = class {
  constructor() { window.speechTest = this; }
  start() { this.started = true; }
  stop() { this.stopped = true; }
  abort() { this.aborted = true; this.onend?.(); }
  result(text) { this.onresult({resultIndex:0,results:[Object.assign([{transcript:text}],{isFinal:true})]}); }
}; window.SpeechRecognition = undefined;"""

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('RUBYKREON_CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), headless=True)
    page = browser.new_page(viewport={'width':390, 'height':844})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script(MOCK)
    page.goto(URL)
    page.wait_for_selector('[data-chart]', state='attached')
    field = page.locator('#meal-title')
    button = page.locator('#dictate-meal')
    field.fill('Arròs')
    button.click()
    assert page.evaluate('speechTest.started && speechTest.lang === "ca-ES"')
    assert page.locator('#analyze-btn').is_disabled()
    page.evaluate('speechTest.result("amb pollastre i oli d’oliva")')
    assert field.input_value() == 'Arròs amb pollastre i oli d’oliva'
    assert page.evaluate('appHasChanges')
    button.click()
    assert page.evaluate('speechTest.stopped')
    page.evaluate('speechTest.onend()')
    assert page.locator('#analyze-btn').is_enabled()
    assert button.get_attribute('aria-pressed') == 'false'
    # Dictation invalidates an existing meal analysis through the normal input event.
    page.evaluate('showResults({totalFat:20,saturatedFat:3,calories:400,confidence:"high",description:"Prova",dish:"Arròs"})')
    button.click()
    page.evaluate('speechTest.result("i una amanida"); speechTest.onend()')
    assert not page.locator('#results').is_visible()
    assert field.input_value().endswith('i una amanida')
    button.click()
    page.evaluate('speechTest.onerror({error:"not-allowed"}); speechTest.onend()')
    assert 'Permet l’accés' in page.locator('#dictation-status').inner_text()
    assert button.get_attribute('aria-pressed') == 'false'
    # Leaving the meal screen cancels recognition; late results cannot modify it.
    button.click()
    previous = field.input_value()
    page.locator('[data-screen="diary"]').click()
    assert page.evaluate('speechTest.aborted')
    page.evaluate('speechTest.result("text tardà")')
    assert field.input_value() == previous
    # Unsupported browsers keep the editable description and explain keyboard dictation.
    unsupported = browser.new_page()
    unsupported.add_init_script('window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;')
    unsupported.goto(URL)
    unsupported.locator('#dictate-meal').click()
    assert 'micròfon del teclat' in unsupported.locator('#dictation-status').inner_text()
    assert not errors, errors
    browser.close()
    print('PASS: Catalan dictation, append/stop, meal invalidation, permission errors, cancellation and unsupported fallback')
