"""Real service-worker upgrades against temporary public assets and synthetic data."""
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
ASSETS = ['index.html','sw.js','diary.js','analytics.js','regression.js','diary.css','manifest.json','icons/icon-192.png','icons/icon-512.png']

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        if 'If-Modified-Since' in self.headers: del self.headers['If-Modified-Since']
        return super().do_GET()

with tempfile.TemporaryDirectory(prefix='rubykreon-pwa-') as directory:
    target=Path(directory)/'RubyKreon_App'; target.mkdir()
    for name in ASSETS:
        destination=target/name; destination.parent.mkdir(parents=True,exist_ok=True)
        destination.write_bytes((ROOT/name).read_bytes())
    def release(version):
        for name in ['index.html','sw.js']:
            (target/name).write_text((ROOT/name).read_text().replace('rubykreon-v9',f'rubykreon-v{version}'))
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=directory))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    url=f'http://127.0.0.1:{server.server_port}/RubyKreon_App/'
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path=CHROME,headless=True)
            context=browser.new_context()
            clean=context.new_page(); clean.goto(url)
            clean.wait_for_function('!!navigator.serviceWorker.controller')
            clean.evaluate("localStorage.setItem('gai_key','synthetic-test-key')")
            dirty=context.new_page(); dirty.goto(url)
            dirty.locator('#meal-title').fill('Texto sin guardar')
            release(10)
            clean.wait_for_function('!!appRegistration')
            clean.evaluate('checkAppUpdate()')
            clean.wait_for_function("APP_VERSION === 'rubykreon-v10'", timeout=15000)
            dirty.get_by_role('button',name='Ajustes',exact=True).click()
            expect(dirty.locator('#apply-app-update')).to_be_visible()
            assert dirty.evaluate('APP_VERSION')=='rubykreon-v9'
            expect(dirty.locator('#meal-title')).to_have_value('Texto sin guardar')
            assert clean.evaluate("localStorage.getItem('gai_key')")=='synthetic-test-key'
            dirty.evaluate('location.reload()')
            dirty.wait_for_function("APP_VERSION === 'rubykreon-v10'")
            assert dirty.evaluate("localStorage.getItem('gai_key')")=='synthetic-test-key'
            # Older workers must not trigger a reload loop.
            dirty.evaluate("applyAppVersion('rubykreon-v9')")
            assert dirty.evaluate('updateReloading') is False
            # Installation requires a click and hides the affordance after installation.
            dirty.evaluate("""() => {
              window.promptCalls=0;
              const e=new Event('beforeinstallprompt',{cancelable:true});
              e.prompt=async()=>{window.promptCalls++}; e.userChoice=Promise.resolve({outcome:'accepted'});
              window.dispatchEvent(e);
            }""")
            expect(dirty.locator('#install-header-btn')).to_be_visible()
            assert dirty.evaluate('promptCalls')==0
            dirty.locator('#install-header-btn').click()
            assert dirty.evaluate('promptCalls')==1
            dirty.evaluate("window.dispatchEvent(new Event('appinstalled'))")
            expect(dirty.locator('#install-header-btn')).not_to_be_visible()
            # Fixed URL, including old query links, remains available offline.
            context.set_offline(True); clean.goto(url+'?old-link=1')
            expect(clean.locator('#meal-form')).to_be_visible()
            assert clean.evaluate('APP_VERSION')=='rubykreon-v10'
            browser.close()
            print('PASS: real automatic upgrade, draft protection, persistent key, no reload loop, installation gesture, offline navigation')
    finally: server.shutdown(); server.server_close()
