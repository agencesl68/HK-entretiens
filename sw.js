/* HK Entretiens — service worker
   . ouverture rapide même en 4G faible (copie locale si le réseau traîne)
   . notifications push envoyées par la GitHub Action « alertes-entretiens » */
var CACHE = "hke-v18";
var COQUILLE = ["./", "index.html", "echeances.js", "manifest.webmanifest", "icon.png?v=2"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(COQUILLE); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (k) {
    return Promise.all(k.filter(function (n) { return n !== CACHE; }).map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});
/* Ouverture : le réseau a 2,5 s pour répondre, sinon on affiche la copie
   enregistrée sur le téléphone (jamais d'écran blanc en 4G faible). */
self.addEventListener("fetch", function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;   // Supabase : jamais en cache
  var copie = function () {
    return caches.match(e.request, { ignoreSearch: e.request.mode === "navigate" }).then(function (r) {
      if (r || e.request.mode !== "navigate") return r;
      return caches.match("./").then(function (x) { return x || caches.match("index.html"); });
    });
  };
  var reseau = fetch(e.request).then(function (r) {
    if (r && r.ok) { var c2 = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, c2); }); }
    return r;
  });
  e.respondWith(new Promise(function (ok) {
    var fini = false;
    var t = setTimeout(function () {
      copie().then(function (r) { if (!fini && r) { fini = true; ok(r); } });
    }, 2500);
    reseau.then(function (r) { if (!fini) { fini = true; clearTimeout(t); ok(r); } })
      .catch(function () { clearTimeout(t); copie().then(function (r) { if (!fini) { fini = true; ok(r || Response.error()); } }); });
  }));
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
