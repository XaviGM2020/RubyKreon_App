const CACHE_NAME = 'rubykreon-v6';
const ASSETS = [
  '/RubyKreon_App/',
  '/RubyKreon_App/index.html',
  '/RubyKreon_App/diary.js',
  '/RubyKreon_App/analytics.js',
  '/RubyKreon_App/regression.js',
  '/RubyKreon_App/diary.css',
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
      Promise.all(keys.filter(k => k !== CACHE_NAME && /^(fatdose-|rubykreon-)/.test(k)).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network first, fallback to cache
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  // Don't cache API calls
  if (e.request.url.includes('openrouter.ai') || e.request.url.includes('googleapis.com')) {
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy)));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
