const CACHE_NAME = 'fatdose-v1';
const ASSETS = [
  '/RubyKreon_App/',
  '/RubyKreon_App/index.html',
  '/RubyKreon_App/manifest.json',
  '/RubyKreon_App/icons/icon-192.png',
  '/RubyKreon_App/icons/icon-512.png'
];

// Install: cache core assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network first, fallback to cache
self.addEventListener('fetch', e => {
  // Don't cache API calls
  if (e.request.url.includes('openrouter.ai') || e.request.url.includes('googleapis.com')) {
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
