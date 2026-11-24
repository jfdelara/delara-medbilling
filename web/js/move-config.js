/* move-prep build flag. MOVING_TO_URL empty = the "This app is moving" banner is OFF (default).
   For the last build at the old address set it to the new one, e.g. 'https://feedesk.medibrisa.com/'. */
window.MOVING_TO_URL = window.MOVING_TO_URL || '';
/* The one place app code reads the canonical Fee Desk web address (About links in app.js). Static pages (index.html,
   privacy.html, terms.html, support.html) cannot read it; see README "Switching the web address". */
window.APP_URL = window.APP_URL || 'https://feedesk.medibrisa.com/';
