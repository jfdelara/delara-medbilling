/* Free temporary /web/ preview of MedBilling Fee Desk.
   Public site only (copied into dist-landing/web/ by scripts/landing-bundle.py). Not used by the native app.

   To turn the preview off early (show the "has ended" page): set WEB_PREVIEW_ENABLED = false and redeploy.
   To remove /web/ from the public site entirely: set INCLUDE_WEB_PREVIEW = False in scripts/landing-bundle.py.
   Expiry is the end of 23 May 2027 in America/Edmonton (2027-05-24T00:00:00-06:00). */
(function () {
  'use strict';
  var WEB_PREVIEW_ENABLED = true;
  var WEB_PREVIEW_EXPIRES_AT = '2027-05-24T00:00:00-06:00';
  window.WEB_PREVIEW_ENABLED = WEB_PREVIEW_ENABLED;
  window.WEB_PREVIEW_EXPIRES_AT = WEB_PREVIEW_EXPIRES_AT;

  function nowMs() {
    var host = location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      var q = new URLSearchParams(location.search).get('web_preview_now');
      if (q) {
        var t = Date.parse(q);
        if (!isNaN(t)) return t;
      }
    }
    return Date.now();
  }

  var expiresAt = Date.parse(WEB_PREVIEW_EXPIRES_AT);
  var ended = !WEB_PREVIEW_ENABLED || !isFinite(expiresAt) || nowMs() >= expiresAt;
  window.WEB_PREVIEW_ENDED = ended;
  document.documentElement.classList.add(ended ? 'web-preview-ended' : 'web-preview-live');

  var path = location.pathname;
  if (path && !path.endsWith('/') && !/\.[a-z0-9]+$/i.test(path)) {
    location.replace(path + '/' + location.search + location.hash);
    return;
  }

  if (ended && 'serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (r) { r.unregister(); });
    }).catch(function () {});
  }
})();
