/* Public shell only. Account security and auth code always require the network. */
const CACHE = "cmcollab-v56-optional-mfa";
const CORE = ["./", "./workspaces/", "./board/", "./assets/css/type.css", "./assets/css/site.css", "./assets/css/board.css", "./assets/js/i18n-es.js", "./assets/js/i18n.js", "./assets/js/config.js", "./assets/js/board.js", "./assets/js/ai.js", "./assets/js/sync.js", "./assets/js/hub.js", "./assets/js/templates/kits.js", "./assets/js/templates/kits2.js", "./assets/js/icons.js", "./assets/js/modules.js", "./assets/favicon.svg", "./assets/app/icon-192.png"];
const SCOPE = new URL("./", self.location.href).pathname;
function cacheKey(request) {
  const u = new URL(request.url);
  if (request.method !== "GET" || u.origin !== self.location.origin || !u.pathname.startsWith(SCOPE)) return null;
  if (request.headers.has("range") || request.headers.has("authorization")) return null;
  if (Array.from(u.searchParams.keys()).some(function (k) { return /^(?:oobCode|apiKey|mode|continueUrl|idToken|access_token|refresh_token|token|code|state|mfaReauth)$/i.test(k); })) return null;
  const path = u.pathname.slice(SCOPE.length);
  if (/^(?:conta\/seguranca\/|assets\/js\/mfa\/|assets\/js\/auth\.js$)/.test(path)) return null;
  if (/^(?:assets\/.*\.(?:js|css|png|jpg|jpeg|gif|webp|svg|woff2?)|manifest\.webmanifest)$/i.test(path) || /^(?:(?:workspaces|board|admin|planning|game|sst|itsm|pricing|feedback|beta)\/)?(?:index\.html)?$/.test(path)) {
    u.search = ""; u.hash = ""; return u.href;
  }
  return null;
}
self.addEventListener("install", function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).catch(function () {})); self.skipWaiting(); });
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.startsWith("cmcollab-") && k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  const request = e.request, key = cacheKey(request); if (!key) return;
  e.respondWith(fetch(request).then(function (res) {
    if (res && res.ok && !res.redirected && !/(?:no-store|private)/i.test(res.headers.get("cache-control") || "")) {
      const copy = res.clone(); e.waitUntil(caches.open(CACHE).then(function (c) { return c.put(key, copy); }).catch(function () {}));
    }
    return res;
  }).catch(function () { return caches.open(CACHE).then(function (c) { return c.match(key); }); }));
});
