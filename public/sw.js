/**
 * Mr. Baseball Dynasty — offline service worker.
 *
 * The game has no server. It has no account, no matchmaking and no telemetry;
 * once the files are on the device there is nothing left for the network to do.
 * Without this file the browser does not know that, so an installed copy on a
 * phone with no signal — a basement, a plane, a school with bad wifi, the exact
 * places somebody plays a game on a phone — shows a dinosaur.
 *
 * Two strategies, chosen for one property each:
 *
 *  - the page itself is NETWORK-FIRST. Cache-first on the HTML is how a broken
 *    deploy becomes permanent: the shell pins itself, keeps pointing at the
 *    asset hashes it was built with, and no amount of reloading escapes. Going
 *    to the network first costs one request when online and nothing at all when
 *    offline, where the cached copy answers.
 *  - the build assets are CACHE-FIRST. Their filenames contain a hash of their
 *    contents, so a given URL can never mean two different things and revisiting
 *    the network to confirm that is pure latency.
 *
 * Bump CACHE when the caching rules themselves change. Content changes do not
 * need it — the hashed filenames handle those, and the old entries are evicted
 * with their cache generation.
 */

// Bumped for the rename. The icons and the shell HTML changed identity rather
// than content, and a cache generation is the only thing that evicts an
// already-installed copy still wearing the old name and the old tile.
const CACHE = 'mbd-v4';

/** The minimum needed to boot to a playable state with no network at all. */
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-maskable.svg',
  // The raster icons matter offline for a different reason than the others: an
  // installed copy that cannot fetch its own icon is a home screen tile with a
  // hole in it, and the home screen is the only part of an installed game a
  // person sees before deciding to open it.
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  // MBD's opening-day rosters. This is the league the game opens in, so an
  // installed copy without it is an installed copy that quietly falls back to a
  // different one — which is exactly the kind of silent substitution the bridge
  // exists to avoid. About 78 kB over the wire.
  './mbd-world.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Individually, so one 404 on an optional icon cannot fail the install
      // and leave the game with no offline support at all.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Another origin's response is not ours to store, and there are none here.
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
    return;
  }
  event.respondWith(cacheFirst(req));
});

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    const cached = (await caches.match(req)) || (await caches.match('./index.html'));
    if (cached) return cached;
    throw new Error('offline and nothing cached');
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  // Opaque and error responses are not worth keeping: a cached 404 would
  // outlive the deploy that caused it.
  if (res && res.ok && res.type === 'basic') {
    const cache = await caches.open(CACHE);
    cache.put(req, res.clone());
  }
  return res;
}
