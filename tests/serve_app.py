"""Serve only the app's public assets on localhost, with its production path."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import mimetypes

ROOT = Path(__file__).resolve().parent.parent
ASSETS = {'index.html', 'manifest.json', 'sw.js', 'diary.js', 'diary.css', 'analytics.js', 'regression.js',
          'icons/ruby-r-192.png', 'icons/ruby-r-512.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icon-192.png', 'icon-512.png'}


class AppHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith('/RubyKreon_App/'):
            path = path[len('/RubyKreon_App/'):]
        else:
            path = path.lstrip('/')
        path = path or 'index.html'
        if path not in ASSETS:
            self.send_error(404)
            return
        data = (ROOT / path).read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', mimetypes.guess_type(path)[0] or 'application/octet-stream')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == '__main__':
    print('RubyKreon preview: http://127.0.0.1:8765/RubyKreon_App/', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 8765), AppHandler).serve_forever()
