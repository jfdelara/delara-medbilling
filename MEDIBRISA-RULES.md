# Medibrisa standing rules (for every person and every Claude session working on this app)

Set by Jose (owner, Medibrisa Software Ltd.) on 24 Nov 2026. These apply automatically — nobody needs to be reminded.

1. **Google Drive is the library.** Everything about this app lives in Google Drive › My Drive › Medibrisa Software Ltd. › <Medibrisa app name> (account dr.delara@gmail.com):
   - `Source code/` — a zip snapshot (no node_modules/Pods/build) after every meaningful change: `<App>-source-<branch>-<commit>.zip`
   - `Builds/` — every build you make (App Store/Play upload, .dmg, .exe, .apk, .aab): `<App>-<version>-<platform>.<ext>`
   - `<App> — Overview & Architecture` doc — update it when store status, version, price, name, bundle ID or architecture changes.
   Read "00 READ ME — Medibrisa App Library & Rules" in that folder first.
2. **medibrisa.com is kept in step.** Every new app, new version, name change or price change is added to www.medibrisa.com (home page, /apps/ and the app's page) the same day it is built or submitted. Website source: Mac ~/Developer/medibrisa-site/public; publish with Deploy-Website.command.
3. **Names start with "Medibrisa"** everywhere (stores, websites, desktop, phone icon label), and every app says it is from Medibrisa Software Ltd., contact admin@medibrisa.com.
4. Report what you did to the Chief of Staff project register (claude.ai Project "Chief of Staff (manager of all projects)").

A nightly scheduled task (23:00 Edmonton) checks for anything missed and fills it in.
