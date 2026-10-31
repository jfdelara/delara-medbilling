/* Suite parity v1b: shared UI kit for Fee Desk and MedBilling Logs (identical file in both apps: js/shared/spui.js).
   SPUI.SEARCH_PH: the one code-search placeholder (M11, fits at 360). SPUI.chip(): the one chip markup (M14). */
(function (g) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // chip({ html, text, tag, cls, attrs }): html is trusted markup built by the caller; text is escaped. attrs values are escaped.
  function chip(o) {
    o = o || {}; const tag = o.tag === 'button' ? 'button' : 'span';
    const a = Object.entries(o.attrs || {}).filter(([, v]) => v != null && v !== false).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
    return `<${tag}${tag === 'button' ? ' type="button"' : ''} class="spchip${o.cls ? ' ' + o.cls : ''}"${a}>${o.html != null ? o.html : esc(o.text)}</${tag}>`;
  }
  g.SPUI = Object.freeze({ SEARCH_PH: 'Search codes', chip, esc });
})(typeof window !== 'undefined' ? window : globalThis);
