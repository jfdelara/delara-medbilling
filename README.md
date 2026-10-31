# deLara MedBilling

Alberta SOMB billing lookup — static web app (installable PWA).

Live: https://feedesk.medibrisa.com/

The site files live in `site/` and are deployed to GitHub Pages by `.github/workflows/pages.yml` on every push to `main`.

## Switching the web address

The app-code constant is `window.APP_URL` in `site/js/move-config.js` (used by the About links in `site/js/app.js`).
These other places hard-code the address and must change in the same commit when the site moves
(now `https://feedesk.medibrisa.com/`; previously `https://jfdelara.github.io/delara-medbilling/`):

- `site/index.html`: og:image, og:url, twitter:image (meta, lines ~18-21); Settings "About & legal" links (~143); footer legal links (~154)
- `site/privacy.html` line ~45 and `site/terms.html` line ~45 (web-version link and its visible text)
- `site/support.html` line ~89 (visible text)
- `site/js/move-config.js`: `MOVING_TO_URL` (set on the last build at the old address to turn on the "moving" banner)
- `site/js/app.js`: pick-mode `okReturn()` only accepts MedBilling Logs on the **same origin** at `/medbilling-logs/`;
  with separate hosts (feedesk / logs) it must accept `https://logs.medibrisa.com/` instead
- `site/js/shared/move.js`: `APPS` map and the export "from" origin; export/import between the two apps assumes each app's own origin
- `.github/workflows/pages.yml` (GitHub Pages deploy) if hosting moves to Cloudflare Pages
- `site/sw.js`: bump the cache name `V` on any of the above
- the iOS/Android wrapper `server.url` / `www` copies, and MedBilling Logs (its Fee Desk link and pick-mode return URL)
