/* InlineIQ service worker — Web Push + offline caching */

/* ============================================================================
 * Cache configuration
 * ------------------------------------------------------------------------- */
const SW_VERSION = 'v1';
const STATIC_CACHE = `inlineiq-static-${SW_VERSION}`;
const PLANS_CACHE  = 'plans-cache';
const JOB_CACHE    = 'job-data-cache';
const CREW_CACHE   = 'crew-data-cache';

// App shell + static files cached on install. Hashed JS/CSS chunks can't be
// listed here (their names aren't known ahead of time) — they're cached at
// runtime, cache-first, in the fetch handler below.
const APP_SHELL = [
  '/app/crew',
  '/app/supervisor',
  '/join',
  '/inlineiq-logo.png',
  '/manifest.webmanifest',
];

// Max number of plan files (PDF/CSV/image) kept offline — LRU eviction.
const PLANS_MAX = 50;

// Expiry windows for cached Supabase data responses.
const JOB_TTL_MS  = 24 * 60 * 60 * 1000; // 24 hours
const CREW_TTL_MS = 60 * 60 * 1000;       // 1 hour

// Supabase tables whose GET responses we cache, split by freshness policy.
const JOB_TABLES  = ['jobs', 'cabinet_units', 'parts', 'job_drawings'];
const CREW_TABLES = ['crew_members', 'time_clock'];

/* ============================================================================
 * Install — precache the app shell
 * ------------------------------------------------------------------------- */
self.addEventListener('install', function (event) {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(STATIC_CACHE);
        // addAll is atomic — a single failure rejects the whole batch, so add
        // entries individually and swallow per-file failures.
        await Promise.all(
          APP_SHELL.map((url) => cache.add(url).catch(() => {}))
        );
      } catch (e) {
        /* precache best-effort */
      }
      // Activate the new worker immediately.
      self.skipWaiting();
    })()
  );
});

/* ============================================================================
 * Activate — drop old static caches, take control
 * ------------------------------------------------------------------------- */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((k) => k.startsWith('inlineiq-static-') && k !== STATIC_CACHE)
            .map((k) => caches.delete(k))
        );
      } catch (e) {
        /* cleanup best-effort */
      }
      await self.clients.claim();
    })()
  );
});

/* ============================================================================
 * Helpers
 * ------------------------------------------------------------------------- */

// Trim a cache down to `max` entries, evicting the oldest (insertion order).
async function trimCache(cacheName, max) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= max) return;
    for (let i = 0; i < keys.length - max; i++) {
      await cache.delete(keys[i]);
    }
  } catch (e) {
    /* eviction best-effort */
  }
}

// Stamp a cached response with the time it was stored so we can expire it.
async function putWithTimestamp(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    const body = await response.clone().blob();
    const headers = new Headers(response.headers);
    headers.set('sw-cached-at', String(Date.now()));
    const stamped = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    await cache.put(request, stamped);
  } catch (e) {
    /* cache write best-effort */
  }
}

// Return a cached response only if it's still within its TTL.
async function getFresh(cacheName, request, ttlMs) {
  try {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (!cached) return null;
    const at = Number(cached.headers.get('sw-cached-at') || '0');
    if (at && Date.now() - at > ttlMs) return null;
    return cached;
  } catch (e) {
    return null;
  }
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/static/') ||
    /\.(?:js|css|woff2?|ttf|otf|png|jpg|jpeg|gif|webp|svg|ico)$/i.test(url.pathname)
  );
}

function isPlanFile(url) {
  // Supabase Storage public objects — plan PDFs, CSVs, images.
  return url.pathname.includes('/storage/v1/object/');
}

// Which data cache (if any) a Supabase REST GET belongs to.
function dataCacheFor(url) {
  if (!url.pathname.includes('/rest/v1/')) return null;
  const table = url.pathname.split('/rest/v1/')[1]?.split('?')[0]?.split('/')[0];
  if (!table) return null;
  if (JOB_TABLES.includes(table))  return { cache: JOB_CACHE, ttl: JOB_TTL_MS };
  if (CREW_TABLES.includes(table)) return { cache: CREW_CACHE, ttl: CREW_TTL_MS };
  return null;
}

/* ============================================================================
 * Fetch — routing by request type
 * ------------------------------------------------------------------------- */
self.addEventListener('fetch', function (event) {
  const req = event.request;

  // Only GET requests are cacheable; everything else (writes, auth) passes through.
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  // 1. Plan files — cache first, then network (available offline after first view).
  if (isPlanFile(url)) {
    event.respondWith(planFileStrategy(req));
    return;
  }

  // 2. Supabase data (jobs / cabinet_units / parts / job_drawings / crew / clock)
  //    — network first, cache fallback, with TTL expiry.
  const dataTarget = dataCacheFor(url);
  if (dataTarget) {
    event.respondWith(dataStrategy(req, dataTarget.cache, dataTarget.ttl));
    return;
  }

  // Same-origin only beyond this point.
  if (url.origin !== self.location.origin) return;

  // 3. Static assets — cache first, network fallback.
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // 4. Navigations (app shell pages) — network first, cache fallback.
  if (req.mode === 'navigate') {
    event.respondWith(navigationStrategy(req));
    return;
  }
});

async function cacheFirst(req) {
  try {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    const res = await fetch(req);
    if (res && res.ok) { try { await cache.put(req, res.clone()); } catch (e) {} }
    return res;
  } catch (e) {
    const cached = await caches.match(req);
    if (cached) return cached;
    return Response.error();
  }
}

async function planFileStrategy(req) {
  try {
    const cache = await caches.open(PLANS_CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) {
      try {
        await cache.put(req, res.clone());
        await trimCache(PLANS_CACHE, PLANS_MAX);
      } catch (e) {}
    }
    return res;
  } catch (e) {
    const cached = await caches.match(req);
    if (cached) return cached;
    return Response.error();
  }
}

async function dataStrategy(req, cacheName, ttl) {
  try {
    const res = await fetch(req);
    if (res && res.ok) { await putWithTimestamp(cacheName, req, res); }
    return res;
  } catch (e) {
    const cached = await getFresh(cacheName, req, ttl);
    if (cached) return cached;
    // Stale-but-present is better than nothing when fully offline.
    const any = await caches.open(cacheName).then((c) => c.match(req)).catch(() => null);
    if (any) return any;
    return Response.error();
  }
}

async function navigationStrategy(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      try { const cache = await caches.open(STATIC_CACHE); await cache.put(req, res.clone()); } catch (e) {}
    }
    return res;
  } catch (e) {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(req) || await cache.match(new URL(req.url).pathname);
    if (cached) return cached;
    return Response.error();
  }
}

/* ============================================================================
 * Web Push  (unchanged — must keep working after the SW update)
 * ------------------------------------------------------------------------- */
// A notification is a "message" notification if its title mentions a message or
// it routes to the crew app — those should deep-link to the Messages screen.
function isMessageNotification(data) {
  const title = (data && data.title ? String(data.title) : '').toLowerCase();
  const url   = (data && data.url ? String(data.url) : '');
  return /message/.test(title) || url.indexOf('/app/crew') !== -1;
}

// Persist a flag the crew app reads on open so a message that arrived while the
// app was closed still triggers a refresh. Stored as a cache entry (works from
// the SW without IndexedDB plumbing).
async function setNewMessagesFlag() {
  try {
    const cache = await caches.open('inlineiq-flags');
    await cache.put('/has_new_messages', new Response('1', { headers: { 'sw-set-at': String(Date.now()) } }));
  } catch (e) { /* best-effort */ }
}

self.addEventListener('push', function (event) {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: 'InlineIQ', body: event.data.text() };
  }

  const options = {
    body: data.body,
    icon: '/inlineiq-logo.png',
    badge: '/inlineiq-logo.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/',
      isMessage: isMessageNotification(data),
    },
    actions: data.actions || [],
  };

  event.waitUntil(
    (async () => {
      if (options.data.isMessage) await setNewMessagesFlag();
      await self.registration.showNotification(data.title || 'InlineIQ', options);
    })()
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const data = event.notification.data || {};
  // Message notifications jump straight to the crew Messages screen.
  const target = data.isMessage ? '/app/crew?open=messages' : (data.url || '/');
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      // Focus an existing tab if one is already open, otherwise open a new window.
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
