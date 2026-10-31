/* move-prep: shared "Export my data" / "Import my data" and "This app is moving" banner for Fee Desk and MedBilling Logs
   (identical file in both apps: js/shared/move.js; styles css/shared/move.css). Plain script, no build step, no network.
   Each app passes an adapter to MBMove.init(); this file owns the wording, the controls, the file format and validation,
   so both apps look and behave the same. The banner is OFF unless the build flag window.MOVING_TO_URL is a URL. */
(function (g) {
  'use strict';
  const SCHEMA = 'mb-suite-data', VERSION = 1;
  const APPS = { 'feedesk': 'MedBilling Fee Desk', 'medbilling-logs': 'MedBilling Logs' };
  const T = {
    row: 'Your data', exp: 'Export my data', imp: 'Import my data',
    help: 'Export my data saves everything this app keeps on this device to one file. Import my data checks a file, shows what it holds and asks before anything changes. Use them to move to a new address or another device.',
    // in-app help (same wording in both apps; Logs also prints it in its manual and manual PDF)
    guideTitle: 'Your data: Export my data, Import my data and moving',
    guide: [
      'Export my data saves everything this app keeps on this device to one file (its name ends in -my-data- and the date). Keep the file somewhere safe; it is your copy.',
      'In MedBilling Logs the file is locked with your passcode. You need that passcode to import it later.',
      'Import my data (Settings) checks the file first and shows what it holds. Nothing changes until you choose Merge or Replace.',
      'Merge adds what is in the file to what is already here. Nothing here is removed.',
      'Replace makes this device match the file. Tick the confirmation box first. Replace is all or nothing: if anything goes wrong part-way, nothing on this device is changed.',
      'Older backup files can still be imported. Fee Desk favourites files can only be merged.',
      'This app is moving: when the app gets a new web address, a notice appears at the top of the app with the new address and four steps: Export my data, open the new address, Import my data there, then add the new address to your home screen. Not now hides the notice until you next open the app.',
      'Your data stays in this browser at this address only, so it does not move to a new address by itself. Export it first.'
    ],
    bTitle: 'This app is moving', bDismiss: 'Not now',
    bText: 'This app has a new address. Your data is kept by this browser for this address only, so it does not move by itself.',
    steps: ['Export my data (button below) and keep the file.', 'Open the new address: ', 'In Settings, choose Import my data and pick the file.', 'Re-add the app to your home screen from the new address.'],
    dTitle: 'Import my data', merge: 'Merge: add what is in the file to what is here (nothing here is removed)',
    replace: 'Replace: make this device match the file (data here that is not in the file is removed)',
    sure: 'I understand Replace removes data on this device that is not in the file.', go: 'Import', cancel: 'Cancel', close: 'Close',
    shareTitle: a => `${APPS[a] || 'MedBilling'}: my data`,
    reading: 'Checking the file…', none: 'No file chosen.',
    // used only by apps whose file is locked with a passcode (Logs); Fee Desk files are not locked, so it shows none of these
    passExport: 'Enter your passcode. Entries, photos and settings in the file are locked with it. To import the file at the new address you will need this same passcode, even if you choose a different passcode there.',
    passImport: 'This file is locked with the passcode that was used when it was exported. Enter that passcode (it may differ from the passcode you use on this device). Nothing changes until you choose Merge or Replace.',
    passWrong: 'That is not the passcode this file was exported with.',
    passOk: 'Opened with the passcode used when this file was exported.',
    audit: 'Audit log: kept in the file as an archive only. It is not restored here; this device keeps its own audit log from now on.',
    legacy: (v, full) => `Older backup file${v ? ' (version ' + v + ')' : ''}, made before Export my data.` + (full ? '' : ' It can only be merged: what is in the file is added and nothing here is removed.')
  };
  const ERR = {
    badjson: 'That file could not be read. It is not a valid Export my data file (bad JSON).',
    notours: 'That file is not an Export my data file from this suite.',
    wrongapp: a => `That file was exported from ${APPS[a] || 'another app'}. Open ${APPS[a] ? 'that app' : 'the app it came from'} and import it there.`,
    newer: 'That file was made by a newer version of the app. Reload this app to update it, then try again.',
    empty: 'That file has no data to import.',
    bad: 'That file is damaged or incomplete, so nothing was imported.',
    failed: 'The import could not finish, so nothing on this device was changed. Try again; if it keeps failing, free some storage space first.'
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const day = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  class MoveError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

  // ---- file format
  function envelope(appId, appVersion, data, counts, inventory) {
    return { schema: SCHEMA, schemaVersion: VERSION, app: appId, appName: APPS[appId] || appId, appVersion: appVersion || '',
      exportedAt: new Date().toISOString(), from: (g.location ? g.location.origin + g.location.pathname : ''), counts: counts || {}, inventory: inventory || {}, data };
  }
  const total = c => Object.values(c || {}).reduce((a, n) => a + (typeof n === 'number' && n > 0 ? n : 0), 0);
  function validate(o, appId) {
    if (!o || typeof o !== 'object' || Array.isArray(o) || o.schema !== SCHEMA) throw new MoveError('notours', ERR.notours);
    if (o.app !== appId) throw new MoveError('wrongapp', ERR.wrongapp(o.app));
    if (typeof o.schemaVersion !== 'number' || o.schemaVersion < 1) throw new MoveError('bad', ERR.bad);
    if (o.schemaVersion > VERSION) throw new MoveError('newer', ERR.newer);
    if (!o.data || typeof o.data !== 'object') throw new MoveError('bad', ERR.bad);
    if (!total(o.counts)) throw new MoveError('empty', ERR.empty);
    return o;
  }
  function parse(text, appId) {
    if (!text || !String(text).trim()) throw new MoveError('empty', ERR.empty);
    let o; try { o = JSON.parse(text); } catch (e) { throw new MoveError('badjson', ERR.badjson); }
    return validate(o, appId);
  }

  // ---- localStorage helpers (raw strings, exactly as stored)
  const lsKeys = (ls, keep) => { const out = []; try { for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k != null && keep(k)) out.push(k); } } catch (e) { /* none */ } return out.sort(); };
  function lsSnapshot(ls, keep) { const o = {}; lsKeys(ls, keep).forEach(k => { const v = ls.getItem(k); if (v != null) o[k] = v; }); return o; }
  // c: run fn as one all-or-nothing change to the app's localStorage keys: on any error the keys are restored to the snapshot
  // taken before fn ran (added keys removed, changed or removed keys put back) and the error is passed on.
  function lsRestore(ls, keep, before) {
    lsKeys(ls, keep).forEach(k => { if (!(k in before)) { try { ls.removeItem(k); } catch (e) { /* none */ } } });
    Object.keys(before).forEach(k => { try { if (ls.getItem(k) !== before[k]) ls.setItem(k, before[k]); } catch (e) { /* none */ } });
  }
  function lsTxn(ls, keep, fn) {
    const before = lsSnapshot(ls, keep);
    try { return fn(); } catch (e) { lsRestore(ls, keep, before); throw (e instanceof MoveError ? e : new MoveError('bad', ERR.failed)); }
  }
  const jp = s => { try { return JSON.parse(s); } catch (e) { return undefined; } };
  // merge: missing keys are added; arrays are joined (what is here first, then new items from the file); objects gain the file's
  // missing keys (what is here wins on a clash); plain values here are kept. replace: the device ends up equal to the file.
  function lsApply(ls, snap, mode, keep) {
    const r = { added: 0, merged: 0, kept: 0, removed: 0 }; snap = snap && typeof snap === 'object' ? snap : {};
    if (mode === 'replace') {
      // c: atomic. Check every value first, then swap; if any write fails, put back exactly what was here and stop.
      if (Object.keys(snap).some(k => keep(k) && typeof snap[k] !== 'string')) throw new MoveError('bad', ERR.bad);
      return lsTxn(ls, keep, () => {
        lsKeys(ls, keep).forEach(k => { if (!(k in snap)) { ls.removeItem(k); r.removed++; } });
        Object.keys(snap).forEach(k => { if (keep(k)) { ls.setItem(k, snap[k]); r.added++; } });
        return r;
      });
    }
    Object.keys(snap).forEach(k => {
      const fv = snap[k]; if (!keep(k) || typeof fv !== 'string') return;
      const hv = ls.getItem(k);
      if (hv == null || hv === '' || hv === '[]' || hv === '{}') { ls.setItem(k, fv); r.added++; return; }
      if (hv === fv) { r.kept++; return; }
      const a = jp(hv), b = jp(fv);
      if (Array.isArray(a) && Array.isArray(b)) { const seen = new Set(a.map(x => JSON.stringify(x))); const out = a.slice(); b.forEach(x => { const s = JSON.stringify(x); if (!seen.has(s)) { seen.add(s); out.push(x); } }); ls.setItem(k, JSON.stringify(out)); r.merged++; return; }
      if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) { ls.setItem(k, JSON.stringify(Object.assign({}, b, a))); r.merged++; return; }
      r.kept++;
    });
    return r;
  }

  // ---- download / share
  function saveFile(env) {
    const name = `${env.app}-my-data-${day(new Date())}.json`, text = JSON.stringify(env, null, 1);
    // c: the share sheet title names the whole data file (native wrappers read data-share-title on the download link)
    const title = T.shareTitle(env.app), blob = new Blob([text], { type: 'application/json' });
    const dl = () => { const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; a.rel = 'noopener'; a.dataset.shareTitle = title; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); return 'downloaded'; };
    let file = null; try { file = new File([blob], name, { type: 'application/json' }); } catch (e) { /* old browser */ }
    const touch = g.matchMedia && g.matchMedia('(pointer:coarse)').matches;
    if (touch && file && navigator.canShare && navigator.canShare({ files: [file] }))
      return navigator.share({ files: [file], title }).then(() => 'shared', e => (e && e.name === 'AbortError' ? 'cancelled' : dl())).then(s => ({ name, how: s }));
    return Promise.resolve({ name, how: dl() });
  }

  // ---- UI
  let A = null;
  const $ = s => document.querySelector(s);
  const say = (m, ms) => { if (A && A.toast) A.toast(m, ms); };
  async function doExport() {
    try {
      const r = await A.exportData(); if (!r) return null;
      const env = envelope(A.appId, A.appVersion, r.data, r.counts, r.inventory);
      const s = await saveFile(env); if (s.how !== 'cancelled') say(`Exported ${s.name}`, 3000);
      return env;
    } catch (e) { say((e && e.message) || 'Export did not finish', 3500); return null; }
  }
  function dlg() {
    let d = $('#mvDlg'); if (d) return d;
    d = document.createElement('dialog'); d.id = 'mvDlg'; d.className = 'mvdlg'; d.setAttribute('aria-labelledby', 'mvTitle');
    d.innerHTML = `<form method="dialog" class="mvform"><h3 id="mvTitle">${esc(T.dTitle)}</h3><p id="mvFrom" class="mvfrom"></p>
      <table id="mvCounts" class="mvcounts"><tbody></tbody></table>
      <ul id="mvNotes" class="mvnotes" hidden></ul>
      <fieldset id="mvModes" class="mvmodes"><legend class="mvsr">How to import</legend>
        <label><input type="radio" name="mvMode" value="merge" checked> <span>${esc(T.merge)}</span></label>
        <label id="mvRepRow"><input type="radio" name="mvMode" value="replace"> <span>${esc(T.replace)}</span></label>
        <label id="mvSureRow" class="mvsure" hidden><input type="checkbox" id="mvSure"> <span>${esc(T.sure)}</span></label></fieldset>
      <p id="mvErr" class="mverr" role="alert"></p>
      <div class="mvbtns"><button type="button" id="mvGo" class="mvprimary">${esc(T.go)}</button><button type="button" id="mvCancel" class="mvghost">${esc(T.cancel)}</button></div></form>`;
    document.body.appendChild(d);
    const sync = () => { const rep = d.querySelector('input[name=mvMode]:checked').value === 'replace'; d.querySelector('#mvSureRow').hidden = !rep; if (!rep) d.querySelector('#mvSure').checked = false; d.querySelector('#mvGo').disabled = rep && !d.querySelector('#mvSure').checked; };
    d.querySelectorAll('input[name=mvMode]').forEach(x => x.addEventListener('change', sync)); d.querySelector('#mvSure').addEventListener('change', sync);
    d.querySelector('#mvCancel').addEventListener('click', () => d.close('cancel'));
    d._sync = sync; return d;
  }
  function showError(msg) {
    const d = dlg(); d.classList.add('mvisErr'); d.querySelector('#mvFrom').textContent = ''; d.querySelector('#mvCounts tbody').innerHTML = ''; d.querySelector('#mvNotes').hidden = true;
    d.querySelector('#mvModes').hidden = true; d.querySelector('#mvGo').hidden = true; d.querySelector('#mvCancel').textContent = T.close; d.querySelector('#mvErr').textContent = msg;
    if (!d.open) d.showModal();
  }
  async function importText(text) {
    let env, legacy = false; try { env = parse(text, A.appId); } catch (e) {
      // older backup files (made before Export my data) are still accepted when the app knows their format
      let o = null; if (e.code === 'notours' && A.readLegacy) { try { o = JSON.parse(text); } catch (x) { o = null; } }
      if (!o) { showError(e.message); return { error: e.code || 'bad' }; }
      legacy = true; env = { app: A.appId, exportedAt: o.exported || o.exportedAt || o.created || '', legacy: o };
    }
    let prep; try { prep = legacy ? await A.readLegacy(env.legacy) : await A.readImport(env); if (legacy && prep === false) { showError(ERR.notours); return { error: 'notours' }; } } catch (e) { showError((e && e.message) || ERR.bad); return { error: 'bad' }; }
    if (!prep) return { error: 'cancelled' };
    if (!total(prep.counts)) { showError(ERR.empty); return { error: 'empty' }; }
    const d = dlg(); d.classList.remove('mvisErr'); d.querySelector('#mvModes').hidden = false; const go = d.querySelector('#mvGo'); go.hidden = false; d.querySelector('#mvCancel').textContent = T.cancel;
    d.querySelector('#mvErr').textContent = '';
    const when = env.exportedAt ? new Date(env.exportedAt) : null;
    d.querySelector('#mvFrom').textContent = prep.from || `File from ${APPS[env.app]}${when && !isNaN(when) ? ', exported ' + when.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : ''}`.replace(/\.$/, '') + '. It holds:';
    d.querySelector('#mvCounts tbody').innerHTML = (prep.rows || Object.keys(prep.counts).map(k => [k, k])).map(([k, label]) => `<tr data-k="${esc(k)}"><th scope="row">${esc(label)}</th><td>${esc(prep.counts[k] || 0)}</td></tr>`).join('');
    const notes = (prep.notes || []).filter(Boolean), ul = d.querySelector('#mvNotes');
    ul.innerHTML = notes.map(n => `<li>${esc(n)}</li>`).join(''); ul.hidden = !notes.length;
    d.querySelector('#mvRepRow').hidden = !!(prep.modes && !prep.modes.includes('replace'));
    d.querySelector('input[name=mvMode][value=merge]').checked = true; d._sync();
    if (!d.open) d.showModal();
    return new Promise(res => {
      const done = v => { go.onclick = null; d.removeEventListener('close', onClose); res(v); };
      const onClose = () => done({ error: 'cancelled' });
      d.addEventListener('close', onClose);
      go.onclick = async () => {
        const mode = d.querySelector('input[name=mvMode]:checked').value; go.disabled = true;
        try { const r = await prep.apply(mode); d.removeEventListener('close', onClose); d.close('done'); say(r && r.message ? r.message : 'Imported', 4000); done({ mode, result: r }); if (r && r.reload) { try { sessionStorage.setItem('mb.move.msg', r.message || 'Imported'); } catch (e) { /* none */ } location.reload(); } }
        catch (e) { go.disabled = false; d.querySelector('#mvErr').textContent = (e && e.message) || ERR.bad; }
      };
    });
  }
  function pickFile() {
    let f = $('#mvFile');
    if (!f) { f = document.createElement('input'); f.type = 'file'; f.id = 'mvFile'; f.hidden = true; f.accept = A.accept || '.json,application/json'; f.setAttribute('aria-label', T.imp + ' file'); document.body.appendChild(f);
      f.addEventListener('change', async () => { const x = f.files && f.files[0]; f.value = ''; if (!x) return; let t = ''; try { t = await x.text(); } catch (e) { return showError(ERR.bad); } importText(t); }); }
    if (A.beforePick) A.beforePick(); f.click();
  }
  function guideHtml() { return `<summary>${esc(T.guideTitle)}</summary><ul>${T.guide.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`; }
  function settingsRow(mount) {
    if (!mount || mount.querySelector('#mvExport')) return;
    const row = document.createElement('div'); row.className = 'sprow mvrow';
    row.innerHTML = `<label>${esc(T.row)}</label><div class="spbtns"><button type="button" id="mvExport">${esc(T.exp)}</button><button type="button" id="mvImport">${esc(T.imp)}</button></div>`;
    const help = document.createElement('p'); help.className = 'sphelp mvhelp'; help.textContent = T.help;
    // placement (same in both apps): straight after the Backup row and its help line
    // (or where the app marks it with data-mv-anchor, e.g. Fee Desk after its old Backup row was retired)
    const bk = mount.querySelector('#spBackup'); let after = bk ? bk.closest('.sprow') : null;
    if (after && after.nextElementSibling && after.nextElementSibling.classList.contains('sphelp')) after = after.nextElementSibling;
    const an = !after && mount.querySelector('[data-mv-anchor]'); if (an) after = an;
    const gd = document.createElement('details'); gd.className = 'mvguide'; gd.id = 'mvGuide'; gd.innerHTML = guideHtml();
    if (after) { after.insertAdjacentElement('afterend', row); row.insertAdjacentElement('afterend', help); help.insertAdjacentElement('afterend', gd); } else { mount.appendChild(row); mount.appendChild(help); mount.appendChild(gd); }
    row.querySelector('#mvExport').addEventListener('click', doExport); row.querySelector('#mvImport').addEventListener('click', pickFile);
  }
  const SK = () => 'mb.move.dismissed.' + A.appId;
  function flagUrl() { const u = g.MOVING_TO_URL; return typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : ''; }
  function banner() {
    const url = flagUrl(); const old = $('#mvBanner');
    let off = false; try { off = sessionStorage.getItem(SK()) === '1'; } catch (e) { /* none */ }
    if (!url || off) { if (old) old.remove(); return null; }
    if (old) return old;
    const b = document.createElement('section'); b.id = 'mvBanner'; b.className = 'mvbanner'; b.setAttribute('role', 'region'); b.setAttribute('aria-labelledby', 'mvBTitle');
    b.innerHTML = `<div class="mvbhd"><h2 id="mvBTitle">${esc(T.bTitle)}</h2><button type="button" id="mvBDismiss" class="mvghost">${esc(T.bDismiss)}</button></div>
      <p>${esc(T.bText)}</p><p class="mvnew">New address: <a id="mvBUrl" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a></p>
      <ol class="mvsteps"><li>${esc(T.steps[0])}</li><li>${esc(T.steps[1])}<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url.replace(/^https:\/\//, ''))}</a></li><li>${esc(T.steps[2])}</li><li>${esc(T.steps[3])}</li></ol>
      <div class="mvbtns"><button type="button" id="mvBExport" class="mvprimary">${esc(T.exp)}</button></div>`;
    const at = A.bannerMount ? $(A.bannerMount) : null;
    if (at) at.parentNode.insertBefore(b, at); else document.body.insertBefore(b, document.body.firstChild);
    b.querySelector('#mvBExport').addEventListener('click', doExport);
    b.querySelector('#mvBDismiss').addEventListener('click', () => { try { sessionStorage.setItem(SK(), '1'); } catch (e) { /* none */ } b.remove(); });
    return b;
  }
  function init(adapter) {
    A = adapter; settingsRow(adapter.settingsMount ? $(adapter.settingsMount) : null); banner();
    try { const m = sessionStorage.getItem('mb.move.msg'); if (m) { sessionStorage.removeItem('mb.move.msg'); setTimeout(() => say(m, 4000), 300); } } catch (e) { /* none */ }
  }
  g.MBMove = Object.freeze({ SCHEMA, VERSION, APPS, T, ERR, MoveError, envelope, validate, parse, lsKeys, lsSnapshot, lsApply, lsTxn, lsRestore, guideHtml, init, banner, importText, doExport, flagUrl, total });
})(typeof window !== 'undefined' ? window : globalThis);
