// Studino — service worker : rend l'appli installable et l'ouvre même avec une connexion faible.
// Pages, scripts et styles : toujours la version en ligne d'abord (pour avoir les mises à jour),
// la copie gardée seulement si le réseau ne répond pas. Images et sons : la copie gardée d'abord.
// Les autres sites (IA Gemini, bibliothèques) ne passent pas par ici.
var CACHE = "studino-v1";

self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var isMedia = /\.(png|jpe?g|gif|webp|svg|mp3|wav|ogg)$/i.test(url.pathname);
  if (isMedia) {
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
        return res;
      });
    }));
    return;
  }
  e.respondWith(fetch(req).then(function (res) {
    if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: req.mode === "navigate" });
  }));
});
