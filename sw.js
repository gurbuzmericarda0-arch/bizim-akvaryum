// Offline cache: the page itself is fetched fresh when online; pictures and code come from cache first.
const V = "akvaryum-v1";
const CORE = ["./", "index.html", "shim.js", "firebase-config.js", "manifest.webmanifest", "three.module.min.js", "hmaps.json", "seed.json", "icons/icon-192.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url); if (e.request.method !== "GET" || u.origin !== location.origin) return;
  const fresh = e.request.mode === "navigate" || /\.(html|js|json)$/.test(u.pathname);
  e.respondWith(fresh
    ? fetch(e.request).then(r => { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html")))
    : caches.match(e.request).then(r => r || fetch(e.request).then(r2 => { const c = r2.clone(); caches.open(V).then(x => x.put(e.request, c)); return r2; })));
});
