/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';

const sw = self as unknown as ServiceWorkerGlobalScope;
const PREFIX = 'tide-';
const CACHE = PREFIX + version;
const SHELL = '/index.html';
const precached = new Set(
  [...immutable, ...assets].map(({ path }) => (path.startsWith('/') ? path : '/' + path))
);
const bypass = ['/api', '/rtc', '/moil', '/egress-template'];

sw.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([...precached, SHELL])));
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))
        )
      )
  );
});

// The server answers a missing /_app/immutable/*.js with index.html and 200;
// caching that under a script URL would break the app until the cache rolls.
async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  const html = (res.headers.get('content-type') ?? '').includes('text/html');
  if (res.ok && res.type === 'basic' && !html) cache.put(request, res.clone());
  return res;
}

async function navigation(request: Request): Promise<Response> {
  try {
    return await fetch(request);
  } catch (err) {
    const shell = await (await caches.open(CACHE)).match(SHELL);
    if (shell) return shell;
    throw err;
  }
}

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;
  if (bypass.some((p) => url.pathname.startsWith(p))) return;

  if (url.pathname.startsWith('/_app/immutable/') || precached.has(url.pathname)) {
    event.respondWith(cacheFirst(request));
  } else if (request.mode === 'navigate') {
    event.respondWith(navigation(request));
  }
});
