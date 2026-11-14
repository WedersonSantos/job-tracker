/* Cache only these public assets. Never store profiles, API responses or pages. */
const CACHE = "jobtracker-pwa-static-v1";
const STATIC = ["/offline.html", "/icons/pwa-192.png", "/icons/pwa-512.png", "/icons/pwa-maskable-512.png", "/icons/apple-touch-icon.png"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC)));
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith("jobtracker-pwa-static-") && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (await (await caches.open(CACHE)).match("/offline.html")) || new Response("Job Tracker sem conexão. Tente novamente quando o servidor estiver disponível.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })));
  } else if (STATIC.includes(new URL(request.url).pathname)) {
    event.respondWith((async () => (await (await caches.open(CACHE)).match(request)) || fetch(request))());
  }
});
