// Fa funzionare l'app anche offline. Conserva solo i file dell'app, mai i dati dell'utente.
const C = "fit-tracker-app-v2";
const FILES = ["./fit-tracker.html", "./manifest.webmanifest", "./icon-180.png", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const r = e.request;
  // Solo i file dell'app e le librerie: i dati (Supabase, Open Food Facts) non vanno in cache.
  if (r.method !== "GET" || !(r.url.startsWith(self.location.origin) || /^https:\/\/(cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com|tessdata\.projectnaptha\.com)\//.test(r.url))) return;
  // Prima la rete, così gli aggiornamenti arrivano subito; senza rete, la copia salvata.
  e.respondWith(fetch(r).then(res => {
    if (res.ok || res.type === "opaque") { const cp = res.clone(); caches.open(C).then(c => c.put(r, cp)); }
    return res;
  }).catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match("./fit-tracker.html"))));
});

// Notifiche push dal servizio "notify" su Supabase.
self.addEventListener("push", e => {
  let m = { title: "Fit Tracker", body: "" };
  try { m = { ...m, ...e.data.json() }; } catch { if (e.data) m.body = e.data.text(); }
  e.waitUntil(self.registration.showNotification(m.title, { body: m.body, tag: m.tag, icon: "icon-192.png", badge: "icon-192.png", data: { url: m.url || "./fit-tracker.html" } }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) if ("focus" in c) return c.focus();
    return clients.openWindow(e.notification.data && e.notification.data.url || "./fit-tracker.html");
  }));
});
