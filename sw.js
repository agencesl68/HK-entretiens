/* HK Entretiens — service worker
   . ouverture hors ligne (réseau d'abord, copie locale en secours)
   . notifications push envoyées par la GitHub Action « alertes-entretiens » */
var CACHE = "hke-v11";
var COQUILLE = ["./", "index.html", "echeances.js", "manifest.webmanifest", "icon.png?v=2"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(COQUILLE); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (k) {
    return Promise.all(k.filter(function (n) { return n !== CACHE; }).map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;   // Supabase : jamais en cache
  e.respondWith(fetch(e.request).then(function (r) {
    var copie = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copie); });
    return r;
  }).catch(function () { return caches.match(e.request).then(function (r) { return r || caches.match("index.html"); }); }));
});

self.addEventListener("push", function (event) {
  var d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(d.title || "HK Entretiens", {
    body: d.body || "Un entretien est à prévoir.",
    icon: "icon.png?v=2", badge: "icon.png?v=2", tag: d.tag || "hke", renotify: true,
    data: { url: d.url || self.registration.scope + "#/planning" }
  }));
});
self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || self.registration.scope + "#/planning";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (l) {
    for (var i = 0; i < l.length; i++) if (l[i].url.indexOf(self.registration.scope) === 0 && "focus" in l[i]) { l[i].navigate(url); return l[i].focus(); }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  }));
});
