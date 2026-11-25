// Fa funzionare l'app anche offline. Conserva solo i file dell'app, mai i dati dell'utente.
const C = "fit-tracker-app-v1";
const FILES = ["./fit-tracker.html", "./manifest.webmanifest", "./icon-180.png", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  // Prima la rete, così gli aggiornamenti arrivano subito; senza rete, la copia salvata.
  e.respondWith(fetch(r).then(res => {
    if (res.ok || res.type === "opaque") { const cp = res.clone(); caches.open(C).then(c => c.put(r, cp)); }
    return res;
  }).catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match("./fit-tracker.html"))));
});
