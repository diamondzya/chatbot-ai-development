/* ==========================================================================
   STI Assist AI — service worker
   Network-first for the app shell so development stays fresh, with an
   offline fallback to the last cached copy. API calls, SSE streams, and the
   handbook PDF are never cached.
   ========================================================================== */

const CACHE = 'sti-assist-shell-v4';
const SHELL = ['/', '/chat/', '/css/style.css', '/css/home.css', '/css/chat.css', '/js/app.js', '/js/home.js', '/js/theme.js', '/favicon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  // Never cache API responses, event streams, or the PDF.
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/handbook.pdf') return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches
            .open(CACHE)
            .then((cache) => cache.put(request, copy))
            .catch(() => undefined);
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode !== 'navigate') return Response.error();
        const chat = url.pathname === '/chat' || url.pathname.startsWith('/chat/');
        return (await caches.match(chat ? '/chat/' : '/')) || Response.error();
      })
  );
});
