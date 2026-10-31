/* Offline cache for MedBilling Fee Desk. Same-origin only; never caches or forwards anything else.
   App shell (HTML/JS/CSS/manifest) is network-first so updates show up immediately; data and icons are
   stale-while-revalidate. Install fetches bypass the HTTP cache so a new version never caches old files. */
const V = 'mb-v58-20261030-privacy-link-b-on-main';
const ASSETS = ['./', 'index.html', 'css/app.css', 'js/search.js', 'js/app.js', 'js/shared/boot.js', 'js/shared/rowfmt.js', 'js/shared/short-names.js', 'js/shared/favrow.js', 'js/shared/suite.js', 'css/shared/suite.css', 'css/shared/spui.css', 'js/shared/spui.js', 'js/shared/move.js', 'css/shared/move.css', 'js/move-config.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'data/meta.json', 'data/codes.json', 'data/rules.json', 'data/modifiers.json', 'data/modifier-search.json', 'data/explanatory.json',
  'data/icd9.json', 'data/bulletins.json', 'data/resources.json', 'data/top-sources.json', 'data/prov/index.json', 'privacy.html', 'support.html', 'terms.html', 'licences.html'];
self.addEventListener('install', e => e.waitUntil(
  caches.open(V).then(c => Promise.all(ASSETS.map(a => fetch(new Request(a, { cache: 'reload' })).then(r => { if (r.ok) return c.put(a, r); }))))
    .then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
const isShell = u => u.pathname.endsWith('/') || /\.(html|js|css|webmanifest)$/.test(u.pathname);
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (e.request.mode === 'navigate' || isShell(u)) {
    // network-first, fall back to cache when offline. Only the app page itself is stored as './';
    // other pages (privacy.html, support.html, terms.html) are cached under their own URL.
    const appNav = e.request.mode === 'navigate' && /\/(index\.html)?$/.test(u.pathname);
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(V).then(c => c.put(appNav ? './' : e.request, copy)); }
      return res;
    }).catch(() => caches.match(appNav ? './' : e.request, { ignoreSearch: true }).then(r => r || caches.match('./'))));
    return;
  }
  // stale-while-revalidate for data and images
  e.respondWith(caches.open(V).then(c => c.match(e.request, { ignoreSearch: true }).then(hit => {
    const net = fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; });
    return hit || net;
  })));
});
