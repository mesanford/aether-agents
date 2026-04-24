const CACHE = 'sanford-ai-v2';
const SHELL = ['/'];

// ── Install: pre-cache the app shell (index.html at "/") ─────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL))
  );
  self.skipWaiting();
});

// ── Activate: delete old caches ───────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

// ── Fetch: three-tier strategy ────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Always-network paths — never cache these
  if (url.pathname.startsWith('/api/') || url.pathname === '/manifest.json') {
    event.respondWith(fetch(request));
    return;
  }

  // 2. Navigation requests (HTML) — network first, fall back to cached shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // Update the shell cache with the fresh response
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put('/', clone));
          return res;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // 3. Static assets (JS, CSS, images, fonts) — stale-while-revalidate
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(request).then((cached) => {
        const networkFetch = fetch(request).then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        }).catch(() => cached);
        return cached || networkFetch;
      })
    )
  );
});

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = { title: 'Agent Update', message: '' };
  if (event.data) {
    try { data = event.data.json(); } catch { data.message = event.data.text(); }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Agent Update', {
      body: data.message || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'agent-notification',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const targetUrl = new URL(url, self.location.origin);
      
      for (const c of list) {
        const clientUrl = new URL(c.url);
        // If we find a client on the same origin, focus and navigate it
        if (clientUrl.origin === targetUrl.origin) {
          return c.focus().then((focusedClient) => {
            if (focusedClient && 'navigate' in focusedClient) {
              return focusedClient.navigate(url);
            }
            return focusedClient;
          });
        }
      }
      
      // If no matching client found, open a new window
      return clients.openWindow?.(url);
    })
  );
});
