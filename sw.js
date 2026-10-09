const CACHE_NAME = 'rubykreon-v23';
const ASSETS = [
  '/RubyKreon_App/',
  '/RubyKreon_App/index.html',
  '/RubyKreon_App/diary.js',
  '/RubyKreon_App/analytics.js',
  '/RubyKreon_App/regression.js',
  '/RubyKreon_App/diary.css',
  '/RubyKreon_App/manifest.json',
  '/RubyKreon_App/icons/ruby-r-192.png',
  '/RubyKreon_App/icons/ruby-r-512.png'
];

// Install: cache core assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && /^(fatdose-|rubykreon-)/.test(k)).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network first, fallback to cache
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  // Don't cache API calls
  if (e.request.url.includes('openrouter.ai') || e.request.url.includes('googleapis.com')) {
    return;
  }
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy)));
        }
        return res;
      })
      .catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return await cache.match(e.request) || (e.request.mode === 'navigate' ? await cache.match('/RubyKreon_App/') : undefined) || Response.error();
      })
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'APP_VERSION') event.ports[0]?.postMessage({ version: CACHE_NAME });
});
