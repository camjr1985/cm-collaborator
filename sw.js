/* CM Collaborator service worker – network first (always fresh when online), cache fallback when offline. */
const CACHE = "cmcollab-v11";
const CORE = ["./", "./workspaces/", "./board/", "./assets/css/site.css", "./assets/css/board.css", "./assets/js/i18n.js", "./assets/js/config.js", "./assets/js/auth.js", "./assets/js/board.js", "./assets/js/ai.js", "./assets/js/sync.js", "./assets/js/hub.js", "./assets/js/templates/kits.js", "./assets/favicon.svg", "./assets/app/icon-192.png"];
self.addEventListener("install", function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).catch(function () {})); self.skipWaiting(); });
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  const r = e.request;
  if (r.method !== "GET" || new URL(r.url).origin !== location.origin) return; // Firebase, fonts etc. go straight to the network
  e.respondWith(fetch(r).then(function (res) {
    if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(r, copy); }); }
    return res;
  }).catch(function () { return caches.match(r, { ignoreSearch: r.mode === "navigate" }); }));
});
