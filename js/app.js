/* MedBilling Fee Desk - app. Static, offline-capable. No analytics, no trackers, no patient data stored. */
(function () {
  'use strict';
  const STUDIO_BRAND = 'Medibrisa'; // the one place the studio/brand name lives in app code; no personal name or title on app screens
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => n == null || isNaN(n) ? '—' : '$' + Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const LS = { get: (k, d) => { try { const v = localStorage.getItem('mb.' + k); return v == null ? d : v; } catch (e) { return d; } },
               set: (k, v) => { try { localStorage.setItem('mb.' + k, v); } catch (e) {} } };
  // ---- Pick mode for MedBilling Logs (v33). Logs opens Fee Desk with ?pick=hsc|dx&ctx=<token>&return=<Logs URL>[&jur=XX].
  // Tapping a code then sends it straight back to the spreadsheet cell it was picked for. Only the code, its kind and the
  // one-time token travel; no patient data ever comes here. The return address must be MedBilling Logs on this same origin
  // (or the MedBilling Logs app's own mblogs://pick link): anything else is ignored, so this can't be used as an open redirect.
  const PICK = (() => {
    const SK = 'mb.pick.v1', TTL = 30 * 60000, TOK = /^[a-f0-9]{32}$/;
    function okReturn(r) {
      let u; try { u = new URL(r); } catch (e) { return null; }
      if (u.href === 'mblogs://pick') return { href: 'mblogs://pick', native: true };
      if (u.origin !== location.origin || u.username || u.password || u.search || u.hash) return null;
      if (!/^\/medbilling-logs\/(index\.html)?$/.test(u.pathname)) return null;
      return { href: u.origin + u.pathname, native: false };
    }
    let cur = null;
    try {
      const sp = new URLSearchParams(location.search);
      if (sp.has('pick') || sp.has('ctx') || sp.has('return')) {
        const kind = sp.get('pick'), ctx = sp.get('ctx') || '', ret = okReturn(sp.get('return') || ''), jur = (sp.get('jur') || '').toUpperCase();
        if ((kind === 'hsc' || kind === 'dx') && TOK.test(ctx) && ret) {
          // v36: pv=2 means this MedBilling Logs understands the multi-code return (pick protocol 2); without it, one code per pick as before
          cur = { kind, ctx, ret: ret.href, native: ret.native, jur: /^[A-Z]{2}$/.test(jur) ? jur : '', v: sp.get('pv') === '2' ? 2 : 1, max: Math.min(10, Math.max(3, parseInt(sp.get('pmax'), 10) || 3)), t: Date.now() };
          try { sessionStorage.setItem(SK, JSON.stringify(cur)); } catch (e) {}
        } else { cur = null; try { sessionStorage.removeItem(SK); } catch (e) {} }
        ['pick', 'ctx', 'return', 'jur', 'pv', 'pmax'].forEach(k => sp.delete(k));
        const qs = sp.toString(); history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
      } else {
        const o = JSON.parse(sessionStorage.getItem(SK) || 'null');
        if (o && TOK.test(o.ctx || '') && okReturn(o.ret) && (o.kind === 'hsc' || o.kind === 'dx') && Date.now() - o.t < TTL) cur = o; else sessionStorage.removeItem(SK);
      }
    } catch (e) { cur = null; }
    return {
      get: () => cur && Date.now() - cur.t < TTL ? cur : null,
      clear: () => { cur = null; try { sessionStorage.removeItem(SK); sessionStorage.removeItem('mb.picktray.v1'); } catch (e) {} },
      setJur: id => { if (!cur) return; cur.jur = id; try { sessionStorage.setItem(SK, JSON.stringify(cur)); } catch (e) {} },
      okReturn
    };
  })();
  const PICK_CODE = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/;
  const pickBC = (() => { try { return 'BroadcastChannel' in window ? new BroadcastChannel('medbilling-pick') : null; } catch (e) { return null; } })();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // ask a MedBilling Logs tab that is still open (same browser) to take the code; resolves true when it confirms
  function pickAsk(msg, ms) {
    return new Promise(res => {
      if (!pickBC) return res(false);
      const t = setTimeout(() => { pickBC.removeEventListener('message', on); res(false); }, ms);
      function on(ev) { const d = ev.data || {}; if (d.type === 'ack' && d.ctx === msg.ctx) { clearTimeout(t); pickBC.removeEventListener('message', on); res(true); } }
      pickBC.addEventListener('message', on); pickBC.postMessage(msg);
    });
  }
  let pickSending = false;
  // type 'pick' (one code: code + kind 'hsc'|'dx', protocol 1), 'multi' (code = {fee, dx, dxFor, mod, modFor}, protocol 2) or 'cancel'
  async function pickReturn(type, code, kind) {
    const p = PICK.get(); if (!p || pickSending) return false;
    pickSending = true; PICK.clear(); pickBar(); paintTray();
    const enc = a => a.map(encodeURIComponent).join(',');
    const q = type === 'pick' ? `?picked=${encodeURIComponent(code)}&kind=${kind}&ctx=${p.ctx}`
      : type === 'multi' ? `?pickv=2&ctx=${p.ctx}` + ['fee', 'dx', 'dxFor', 'mod', 'modFor'].filter(k => code[k].some(Boolean)).map(k => `&${k.toLowerCase()}=${enc(code[k])}`).join('')
      : `?pickcancel=1&ctx=${p.ctx}`;
    if (p.native) { location.href = p.ret + q; return true; }   // the app's own link; it reopens MedBilling Logs
    const msg = type === 'pick' ? { type: 'pick', ctx: p.ctx, code, kind, t: Date.now() }
      : type === 'multi' ? Object.assign({ type: 'pick', v: 2, ctx: p.ctx, t: Date.now() }, code) : { type: 'cancel', ctx: p.ctx, t: Date.now() };
    try { localStorage.setItem('medbilling.pick.v1', JSON.stringify(msg)); } catch (e) {}
    const ack = await pickAsk(msg, 600);
    if (ack) {   // the Logs tab has it: close this tab and go back there
      try { if (window.opener && !window.opener.closed) window.opener.focus(); } catch (e) {}
      try { window.close(); } catch (e) {}
      await sleep(400);
      if (window.closed) return true;
      // the window could not close itself (e.g. the in-app browser of a Home Screen app): the code is already in
      // MedBilling Logs, so don't reload it (that would lock it); say so and offer the way back
      pickSent(type === 'pick' ? code : type === 'multi' ? multiLabel(code) : '', p.ret);
      return true;
    }
    location.replace(p.ret + q);
    return true;
  }
  function pickSent(code, ret) {
    const b = document.createElement('div'); b.id = 'pickbar'; b.className = 'pickbar sent'; b.setAttribute('role', 'status');
    b.innerHTML = `<span class="pbtxt">${code ? `${esc(code)} ${/,| codes$/.test(code) ? 'are' : 'is'} in MedBilling Logs. Close this page (Done) to go back` : 'Pick cancelled. Close this page (Done) to go back'}</span><span class="pbsep" aria-hidden="true"> · </span><button type="button" class="pbcancel" id="pickBack">Back</button>`;
    const old = document.getElementById('pickbar'); if (old) old.remove();
    document.documentElement.classList.add('picking'); document.body.insertBefore(b, document.body.firstChild);
    b.querySelector('#pickBack').addEventListener('click', () => location.replace(ret));
  }
  function sendPick(code, kind) {
    code = String(code || '').trim().toUpperCase();
    if (!PICK.get() || !PICK_CODE.test(code) || (kind !== 'hsc' && kind !== 'dx')) return false;
    if (kind === 'hsc' && dxPick()) { toast(DXMSG); return false; }   // M1-d: a fee code never goes back into any Dx pick
    toast(`Sending ${code} to MedBilling Logs…`);
    pickReturn('pick', code, kind);
    return true;
  }
  function pickBar() {
    const p = PICK.get(); document.documentElement.classList.toggle('picking', !!p);
    document.documentElement.classList.toggle('picking-dx', !!p && p.kind === 'dx');
    let b = document.getElementById('pickbar');
    if (!p) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement('div'); b.id = 'pickbar'; b.className = 'pickbar'; b.setAttribute('role', 'status');
      b.innerHTML = `<span class="pbtxt">${pickMulti() ? `Picking for MedBilling Logs: tap a code to send it, or <b class="pbplus">＋</b> to pick several (up to ${tmax()} fee, ${tmax()} ICD-9, ${tmax()} modifiers)` : 'Picking a code for MedBilling Logs, tap a code to send it back'}</span><span class="pbsep" aria-hidden="true"> · </span>${pickMulti() ? '<button type="button" id="pickMods" class="pbcancel pbmods">Modifiers</button>' : ''}<button type="button" id="pickCancel" class="pbcancel">Cancel</button>`;
      document.body.insertBefore(b, document.body.firstChild);
      b.querySelector('#pickCancel').addEventListener('click', () => pickReturn('cancel'));
      const pm = b.querySelector('#pickMods'); if (pm) pm.addEventListener('click', () => { if (location.hash === '#/modifiers') route(); else location.hash = '#/modifiers'; window.scrollTo(0, 0); });
    }
  }
  // "Use … in MedBilling Logs" button on a code page (only in pick mode)
  function pickBtn(kind, code) {
    if (!PICK.get()) return '';
    if (kind === 'hsc' && dxPick()) return `<p class="pickno" role="note">Diagnosis pick: this is a fee code. Choose an ICD code to send.</p>`;   // M1-e: no Use / Select on fee pages in a Dx pick
    return `<button type="button" class="primary pickuse" data-pick="${esc(kind)}" data-code="${esc(code)}">Use ${esc(code)} in MedBilling Logs</button>` +
      (pickMulti() ? `<button type="button" class="ghost pselb" data-psel="${kind === 'dx' ? 'I' : 'H'}:${esc(code)}" aria-pressed="false">＋ Select</button>` : '');
  }
  // small "Details" chip on a search result while picking a fee code (tapping the rest of the row sends the code)
  const pickDet = () => { const p = PICK.get(); return p && p.kind === 'hsc' ? '<span class="pdet" role="button" tabindex="0" aria-label="Show details">Details</span>' : ''; };

  // ---- Multi-code pick (v36, pick protocol 2; only when MedBilling Logs asked for it with pv=2). Up to 10 fee codes, 10 ICD-9
  // codes and 10 modifiers (v37, when Logs sends pmax=10; 3 each for Logs v9l) are collected in a small tray and sent back together with one "Send to MedBilling Logs". A plain tap
  // still sends one code at once, exactly as before, unless something is already selected (then taps add to the selection) or
  // the code is a favourite with linked codes (then the linked set is pre-selected for review). Modifiers and ICD-9 codes can
  // carry the fee code they belong to ("for"), from a linked favourite, so MedBilling Logs can put them beside the right fee
  // code. Only codes travel, as before. The tray lives in this tab's sessionStorage and only for this pick's one-time token.
  const TRAY_SK = 'mb.picktray.v1', TWORD = { H: 'fee code', I: 'ICD-9 code', M: 'modifier' };
  // v37: up to 10 per kind when MedBilling Logs says it accepts them (pmax=10, Logs v9m+); 3 for Logs v9l (pv=2 without pmax)
  const tmax = () => { const p = PICK.get(); return p && p.max >= 3 && p.max <= 10 ? p.max : 3; };
  const pickMulti = () => { const p = PICK.get(); return !!(p && p.v >= 2) && JUR === 'AB'; };   // Alberta: fee, ICD-9 and AHCIP modifiers
  const emptyTray = () => ({ H: [], I: [], M: [] });
  let TRAY = (() => {
    try { const o = JSON.parse(sessionStorage.getItem(TRAY_SK) || 'null'), p = PICK.get();
      if (o && p && o.ctx === p.ctx) { const t = emptyTray(); ['H', 'I', 'M'].forEach(k => { t[k] = (Array.isArray(o[k]) ? o[k] : []).filter(x => x && typeof x.c === 'string' && PICK_CODE.test(x.c)).slice(0, tmax()).map(x => ({ c: x.c, f: typeof x.f === 'string' ? x.f : '' })); }); return t; } } catch (e) {}
    return emptyTray();
  })();
  const trayN = () => TRAY.H.length + TRAY.I.length + TRAY.M.length;
  const inTray = (t, c) => TRAY[t].some(x => x.c === c);
  function traySave() { const p = PICK.get(); try { if (p && trayN()) sessionStorage.setItem(TRAY_SK, JSON.stringify(Object.assign({ ctx: p.ctx }, TRAY))); else sessionStorage.removeItem(TRAY_SK); } catch (e) {} }
  // add one code; '' when added (or already there), else why not
  function trayAdd(t, c, f) {
    const x = TRAY[t].find(y => y.c === c); if (x) { if (f && !x.f) x.f = f; return ''; }
    if (TRAY[t].length >= tmax()) return `Already ${tmax()} ${TWORD[t]}s selected (the most per send). Remove one first.`;
    TRAY[t].push({ c, f: f || '' }); return '';
  }
  function trayRemove(t, c) { TRAY[t] = TRAY[t].filter(x => x.c !== c); if (t === 'H') ['I', 'M'].forEach(k => TRAY[k].forEach(x => { if (x.f === c) x.f = ''; })); }
  const DXMSG = 'Diagnosis pick: choose an ICD code';
  const dxPick = () => { const p = PICK.get(); return !!(p && p.kind === 'dx'); };   // a Logs Dx pick: fee codes never travel back
  function trayToggle(t, c) {
    if (t === 'H' && dxPick()) { toast(DXMSG); return; }   // M1-c: no fee code joins a Dx pick's selection
    if (inTray(t, c)) { trayRemove(t, c); traySave(); paintTray(); toast(`${t === 'M' ? 'Modifier ' + c : c} removed from the selection`); return; }
    const m = trayAdd(t, c); traySave(); paintTray(); toast(m || `${t === 'M' ? 'Modifier ' + c : c} selected (${TRAY[t].length} of ${tmax()} ${TWORD[t]}s). Tap Send when ready`, m ? 3200 : 2200);
  }
  // a favourite with linked codes: select it with its linked fee / ICD-9 codes and modifiers
  function trayLinked(key) {
    const sk = splitKey(key), own = sk.t, fee = own === 'H' ? sk.code : '';
    const sel = [[own, sk.code, '']];
    linksOf(key).forEach(k => { const s = splitKey(k); if (s.jur === JUR) sel.push([s.t, s.code, own === 'I' ? '' : fee]); });
    const lf = own === 'I' ? linksOf(key).map(k => splitKey(k).code)[0] || '' : fee;
    if (own === 'I' && lf) sel[0][2] = lf;   // the diagnosis goes with its (first) linked fee code
    modsOf(key).forEach(k => { const c = splitKey(k).code; if (modOk(c)) sel.push(['M', c, lf]); });
    let added = 0, full = 0;
    if (dxPick()) { for (let i = sel.length - 1; i >= 0; i--) if (sel[i][0] === 'H') sel.splice(i, 1); if (!sel.length) { toast(DXMSG); return 0; } }   // M1-c/M1-d: no fee, not even the tapped one
    let lnk = 0;   // M1-d: count only the linked codes actually added (not the tapped code, not dropped fees, not ones already there)
    sel.forEach(([t, c, f], i) => { const had = inTray(t, c); if (trayAdd(t, c, f)) full++; else if (!had) { added++; if (i || t !== own) lnk++; } });
    traySave(); paintTray();
    toast(`Selected ${sk.code} with ${lnk} linked code${lnk === 1 ? '' : 's'}${full ? ` (${full} not added: ${tmax()} per kind at most)` : ''}. Review, then tap Send`, 3800);
    return added;
  }
  const pselBtn = (t, code) => {
    if (!pickMulti() || (t === 'M' && !modOk(code))) return '';
    const on = inTray(t, code);
    return `<span class="psel${on ? ' on' : ''}" role="button" tabindex="0" data-psel="${t}:${esc(code)}" aria-pressed="${on}" aria-label="${on ? 'Selected' : 'Select'} ${esc(code)} (up to ${tmax()} ${TWORD[t]}s)" title="${on ? 'Selected: tap to remove' : `Select (up to ${tmax()} ${TWORD[t]}s)`}">${on ? '✓' : '＋'}</span>`;
  };
  function multiLabel(o) { const all = [].concat(o.fee, o.dx, o.mod); return all.length <= 3 ? all.join(', ') : all.length + ' codes'; }
  function trayPayload() {
    const fee = TRAY.H.map(x => x.c), forOk = f => fee.includes(f) ? f : '';
    return { fee, dx: TRAY.I.map(x => x.c), dxFor: TRAY.I.map(x => forOk(x.f)), mod: TRAY.M.map(x => x.c), modFor: TRAY.M.map(x => forOk(x.f)) };
  }
  function sendMulti(o) {
    if (!pickMulti()) return false;
    if (dxPick() && o.fee.length) { o.fee = []; }   // M1-d: belt and braces, a Dx pick never carries fee codes
    const n = o.fee.length + o.dx.length + o.mod.length; if (!n) return false;
    o.fee.forEach(c => touchKey(hk(c))); o.dx.forEach(c => touchKey(ik(c))); o.mod.forEach(c => touchKey('M:' + c));   // v38: groups holding these codes were used
    toast(`Sending ${multiLabel(o)} to MedBilling Logs…`);
    TRAY = emptyTray(); traySave();
    pickReturn('multi', o);
    return true;
  }
  function paintTray() {
    $$('[data-psel]').forEach(el => { const [t, c] = [el.dataset.psel[0], el.dataset.psel.slice(2)], on = inTray(t, c);
      el.setAttribute('aria-pressed', String(on)); el.classList.toggle('on', on);
      if (el.classList.contains('psel')) { el.textContent = on ? '✓' : '＋'; el.title = on ? 'Selected: tap to remove' : `Select (up to ${tmax()} ${TWORD[t]}s)`; }
      else el.textContent = on ? '✓ Selected' : '＋ Select'; });
    let b = document.getElementById('picktray');
    const show = pickMulti() && trayN() > 0;
    document.documentElement.classList.toggle('traying', show);
    if (!show) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('div'); b.id = 'picktray'; b.className = 'picktray'; b.setAttribute('role', 'region'); b.setAttribute('aria-label', 'Codes selected for MedBilling Logs'); document.body.appendChild(b); }
    const grp = (t, lab) => TRAY[t].length ? `<div class="ptg"><span class="ptl">${lab} <span class="ptn">${TRAY[t].length}/${tmax()}</span></span>${TRAY[t].map(x =>
      `<span class="ptc k-${t}"><span class="code">${esc(x.c)}</span>${x.f && t !== 'H' && TRAY.H.some(h => h.c === x.f) ? `<span class="ptf">for ${esc(x.f)}</span>` : ''}<button type="button" class="ptx" data-trayrm="${t}:${esc(x.c)}" aria-label="Remove ${esc(x.c)}">×</button></span>`).join('')}</div>` : '';
    const n = trayN();
    b.innerHTML = `<div class="ptrows">${grp('H', 'Fee')}${grp('I', 'ICD-9')}${grp('M', 'Modifiers')}</div>
      <div class="ptacts"><button type="button" class="ghost" id="ptClear">Clear</button><button type="button" class="primary" id="ptSend">Send to MedBilling Logs (${n})</button></div>`;
    trayFit();
  }
  function trayFit() {   // the tray sits right above the pick bar; the page and toasts make room for both
    const pb = document.getElementById('pickbar'), tr = document.getElementById('picktray'), h = document.documentElement;
    h.style.setProperty('--pbh', (pb ? pb.offsetHeight : 0) + 'px'); if (tr) h.style.setProperty('--trayh', tr.offsetHeight + 'px');
  }
  window.addEventListener('resize', () => { if (document.getElementById('picktray')) trayFit(); });
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('#picktray'); if (!b) return;
    const rm = e.target.closest('[data-trayrm]');
    if (rm) { const v = rm.dataset.trayrm; trayRemove(v[0], v.slice(2)); traySave(); paintTray(); const s = $('#ptSend'); if (s) s.focus({ preventScroll: true }); return; }
    if (e.target.closest('#ptClear')) { TRAY = emptyTray(); traySave(); paintTray(); toast('Selection cleared'); return; }
    if (e.target.closest('#ptSend')) sendMulti(trayPayload());
  });

  // ---- Jurisdiction (province/territory) picked at the top; remembered on this device. Alberta is the default.
  // privacy-link-b4: BC/ON/QC/NB/NS/PE are not included in this version; a saved one opens Alberta for this visit, but the stored setting and codes are left untouched
  const REMOVED_JUR = /^(BC|ON|QC|NB|NS|PE)$/;
  const JUR = (v => /^[A-Z]{2}$/.test(v) && !REMOVED_JUR.test(v) ? v : 'AB')((PICK.get() && PICK.get().jur) || LS.get('jur', 'AB'));   // pick mode: Logs' province for this visit only
  // ---- Favourites and recent codes: kept on this device only (localStorage). Keys are 'H:<HSC>' or 'I:<ICD-9>' for Alberta,
  // 'H:<JUR>|<code>' / 'I:<JUR>|<code>' for other jurisdictions (Alberta keys are unchanged from earlier versions).
  const hk = code => JUR === 'AB' ? 'H:' + code : 'H:' + JUR + '|' + code;
  const ik = code => JUR === 'AB' ? 'I:' + code : 'I:' + JUR + '|' + code;
  const splitKey = key => { const b = key.slice(2), i = b.indexOf('|'); return i > 0 ? { t: key[0], jur: b.slice(0, i), code: b.slice(i + 1) } : { t: key[0], jur: 'AB', code: b }; };
  const readList = k => { try { const a = JSON.parse(LS.get(k, '[]')); return Array.isArray(a) ? a.filter(x => typeof x === 'string' && /^[HI]:/.test(x)) : []; } catch (e) { return []; } };
  let FAVS = readList('favs'), RECENT = readList('recent');
  const RECENT_MAX = 20;
  const isFav = key => FAVS.includes(key);
  // Timestamps (ISO) for export: when each favourite was added and when each recent code was last opened.
  let TS = (() => { try { const o = JSON.parse(LS.get('savedts', '{}')); return { f: o.f || {}, r: o.r || {} }; } catch (e) { return { f: {}, r: {} }; } })();
  const saveTS = () => LS.set('savedts', JSON.stringify(TS));
  // ---- Favourite groups (v34): folders by specialty, doctor or a custom name. Stored on this device only under
  // 'mb.favgroups'; 'mb.favs' stays the master list exactly as before, so older versions keep working and a favourite in
  // no group is shown under "Ungrouped". A code can sit in several groups. Group names are the user's own labels.
  const GKEY = 'favgroups', GID = /^g[a-z0-9]{1,24}$/;
  const GTYPES = { specialty: 'Specialty', doctor: 'Doctor', custom: 'Custom' };
  const SPECIALTIES = ['Family Medicine', 'Obstetrics & Gynecology', 'General Surgery', 'Internal Medicine', 'Pediatrics', 'Anesthesia',
    'Emergency Medicine', 'Psychiatry', 'Orthopedics', 'Cardiology', 'Cardiac Surgery', 'Critical Care', 'Dermatology', 'Endocrinology',
    'Gastroenterology', 'Geriatrics', 'Hematology', 'Infectious Diseases', 'Nephrology', 'Neurology', 'Neurosurgery', 'Oncology',
    'Ophthalmology', 'Otolaryngology (ENT)', 'Palliative Care', 'Pathology', 'Physical Medicine & Rehabilitation', 'Plastic Surgery',
    'Radiology', 'Respirology', 'Rheumatology', 'Sports Medicine', 'Thoracic Surgery', 'Urology', 'Vascular Surgery'];
  const cleanName = v => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  // ---- Code groups (v38, Jose Oct 7 8:46 PM): a group is a named bundle of codes billed together (e.g. "C-section", "Clinic visit").
  // Besides its fee and ICD-9 favourites it can hold explicit AHCIP modifiers (Alberta), and the group list sorts A–Z, by most
  // recently used, or in your own order. Those extras live apart from 'mb.favgroups', under 'mb.favgroupx' =
  // {v:1, sort:'az'|'recent'|'custom', used:{<group id>: ISO time}, mods:{<group id>: ['CMGP', ...]}}, so older versions keep
  // reading (and writing) the groups exactly as before. "Used" = the group was opened, or a code in it was opened, picked or sent.
  const XKEY = 'favgroupx', GSORTS = ['az', 'recent', 'custom'];
  function readGroupX() {
    const x = { sort: null, used: {}, mods: {} };
    let o = null; try { o = JSON.parse(LS.get(XKEY, 'null')); } catch (e) { o = null; }
    if (!o || typeof o !== 'object') return x;
    if (GSORTS.includes(o.sort)) x.sort = o.sort;
    if (o.used && typeof o.used === 'object') Object.keys(o.used).forEach(id => { const t = o.used[id]; if (GID.test(id) && typeof t === 'string' && !isNaN(Date.parse(t))) x.used[id] = new Date(t).toISOString(); });
    if (o.mods && typeof o.mods === 'object') Object.keys(o.mods).forEach(id => { if (GID.test(id) && Array.isArray(o.mods[id])) x.mods[id] = [...new Set(o.mods[id].filter(m => typeof m === 'string' && /^[A-Z0-9]{1,8}$/.test(m)))].slice(0, 200); });
    return x;
  }
  function readGroups() {
    const X = readGroupX();
    const g = { groups: [], sort: X.sort || 'az', collapsed: [], last: [], used: X.used };
    let o = null; try { o = JSON.parse(LS.get(GKEY, 'null')); } catch (e) { o = null; }
    if (!o || typeof o !== 'object') return g;
    const seen = new Set();
    if (Array.isArray(o.groups)) o.groups.forEach(x => {
      if (!x || typeof x.id !== 'string' || !GID.test(x.id) || seen.has(x.id) || !cleanName(x.name)) return; seen.add(x.id);
      g.groups.push({ id: x.id, name: cleanName(x.name), type: GTYPES[x.type] ? x.type : 'custom',
        keys: Array.isArray(x.keys) ? [...new Set(x.keys.filter(k => typeof k === 'string' && /^[HI]:/.test(k)))] : [], mods: X.mods[x.id] || [] });
    });
    g.sort = X.sort || (o.sort === 'az' ? 'az' : 'custom');   // a v34–v37 list keeps the order it had
    const strs = a => Array.isArray(a) ? a.filter(x => typeof x === 'string') : [];
    g.collapsed = strs(o.collapsed); g.last = strs(o.last);
    return g;
  }
  let GS = readGroups();
  function pruneGroups() {   // group members must be favourites; drop unknown ids from the UI state
    const f = new Set(FAVS), ids = new Set(GS.groups.map(g => g.id));
    GS.groups.forEach(g => { g.keys = g.keys.filter(k => f.has(k)); });
    GS.collapsed = GS.collapsed.filter(id => id === 'ungrouped' || ids.has(id)); GS.last = GS.last.filter(id => ids.has(id));
    Object.keys(GS.used).forEach(id => { if (!ids.has(id)) delete GS.used[id]; });
  }
  pruneGroups();
  const saveGroups = () => { pruneGroups();
    LS.set(GKEY, JSON.stringify({ v: 1, groups: GS.groups.map(g => ({ id: g.id, name: g.name, type: g.type, keys: g.keys })), sort: GS.sort === 'az' ? 'az' : 'custom', collapsed: GS.collapsed, last: GS.last }));
    const mods = {}; GS.groups.forEach(g => { if (g.mods.length) mods[g.id] = g.mods; });
    LS.set(XKEY, JSON.stringify({ v: 1, sort: GS.sort, used: GS.used, mods })); };
  const groupById = id => GS.groups.find(g => g.id === id);
  const groupsOf = key => GS.groups.filter(g => g.keys.includes(key));
  const ungroupedKeys = () => { const inG = new Set(); GS.groups.forEach(g => g.keys.forEach(k => inG.add(k))); return FAVS.filter(k => !inG.has(k)); };
  function addToGroup(id, key) { const g = groupById(id); if (g && !g.keys.includes(key)) g.keys.unshift(key); }
  function removeFromGroup(id, key) { const g = groupById(id); if (g) g.keys = g.keys.filter(k => k !== key); }
  const byName = (a, b) => a.name.localeCompare(b.name, 'en-CA', { sensitivity: 'base', numeric: true }) || a.type.localeCompare(b.type);
  // A–Z; Recent: last used first (never-used groups after, A–Z); custom: your own order (move up / down)
  const orderedGroups = () => GS.sort === 'az' ? GS.groups.slice().sort(byName)
    : GS.sort === 'recent' ? GS.groups.slice().sort((a, b) => { const ta = GS.used[a.id] || '', tb = GS.used[b.id] || ''; return (tb > ta) - (tb < ta) || byName(a, b); }) : GS.groups.slice();
  const gTotal = g => g.keys.length + g.mods.length;
  // mark groups as used now (opened, or one of their codes opened / picked / sent); no re-render, so nothing jumps under your finger
  function touchGroups(ids) { const now = new Date().toISOString(); let n = 0; ids.forEach(id => { if (groupById(id)) { GS.used[id] = now; n++; } }); if (n) saveGroups(); }
  const touchKey = key => { if (!GS.groups.length) return; const m = key[0] === 'M' ? key.slice(2) : null; touchGroups(GS.groups.filter(g => m ? g.mods.includes(m) : g.keys.includes(key)).map(g => g.id)); };
  function addModToGroup(id, m) { const g = groupById(id); if (g && !g.mods.includes(m)) g.mods.push(m); }
  function removeModFromGroup(id, m) { const g = groupById(id); if (g) g.mods = g.mods.filter(x => x !== m); }
  const groupsOfMod = m => GS.groups.filter(g => g.mods.includes(m));
  const findGroup = (type, name) => GS.groups.find(g => g.type === type && g.name.toLowerCase() === cleanName(name).toLowerCase());
  function newGroup(type, name) {
    let id; do { id = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); } while (groupById(id));
    GS.groups.push({ id, name: cleanName(name), type: GTYPES[type] ? type : 'custom', keys: [], mods: [] });
    return id;
  }
  // ---- Linked favourites (v35): a fee code linked to the ICD-9 code(s) usually billed with it, and back. Stored on this
  // device only under 'mb.favlinks' = {v:1, pairs:[[<fee key>, <ICD-9 key>], ...]} (same per-jurisdiction keys as favourites).
  // A link belongs to the pair, so it shows on both codes; at most 3 links per code. A pair is kept while at least one of its
  // codes is a favourite. Nothing is written until the first link is made, so older versions and existing favourites are untouched.
  const LKEY = 'favlinks', LMAX = 3;
  const sameJur = (a, b) => splitKey(a).jur === splitKey(b).jur;
  function cleanPairs(list) {
    const out = [], seen = new Set(), cnt = {};
    (Array.isArray(list) ? list : []).forEach(p => {
      if (!Array.isArray(p) || p.length !== 2) return; const [h, i] = p;
      if (typeof h !== 'string' || typeof i !== 'string' || !/^H:[^|]/.test(h) || !/^I:[^|]/.test(i) || !sameJur(h, i)) return;
      const id = h + '\n' + i; if (seen.has(id) || (cnt[h] || 0) >= LMAX || (cnt[i] || 0) >= LMAX) return;
      seen.add(id); cnt[h] = (cnt[h] || 0) + 1; cnt[i] = (cnt[i] || 0) + 1; out.push([h, i]);
    });
    return out;
  }
  let LINKS = (() => { try { const o = JSON.parse(LS.get(LKEY, 'null')); return o && typeof o === 'object' ? cleanPairs(o.pairs) : []; } catch (e) { return []; } })();
  // ---- Linked modifiers (v36, Alberta only): a favourite fee code or ICD-9 code linked to up to 3 explicit AHCIP modifiers.
  // Stored apart from the v35 pairs, under 'mb.favmodlinks' = {v:1, pairs:[[<fee or ICD-9 key>, 'M:<modifier>'], ...]}, so older
  // versions never see (or drop) them. Modifiers are not favourites themselves: a link lives while its code is a favourite.
  const MKEY = 'favmodlinks', MCODE = /^[A-Z0-9]{1,8}$/;
  function cleanModPairs(list) {
    const out = [], seen = new Set(), cnt = {};
    (Array.isArray(list) ? list : []).forEach(p => {
      if (!Array.isArray(p) || p.length !== 2) return; const [k, m] = p;
      if (typeof k !== 'string' || typeof m !== 'string' || !/^[HI]:[^|]+$/.test(k) || !/^M:/.test(m) || !MCODE.test(m.slice(2))) return;
      const id = k + '\n' + m; if (seen.has(id) || (cnt[k] || 0) >= LMAX) return;
      seen.add(id); cnt[k] = (cnt[k] || 0) + 1; out.push([k, m]);
    });
    return out;
  }
  let MLINKS = (() => { try { const o = JSON.parse(LS.get(MKEY, 'null')); return o && typeof o === 'object' ? cleanModPairs(o.pairs) : []; } catch (e) { return []; } })();
  const modsOf = key => MLINKS.filter(p => p[0] === key).map(p => p[1]);
  const isModLinked = (key, m) => MLINKS.some(p => p[0] === key && p[1] === m);
  function addModLink(key, m) {
    if (!/^[HI]:[^|]+$/.test(key) || !/^M:/.test(m)) return 'Modifiers can be linked to Alberta fee and ICD-9 codes only.';
    if (isModLinked(key, m)) return '';
    if (modsOf(key).length >= LMAX) return `${splitKey(key).code} already has ${LMAX} linked modifiers (the most allowed). Remove one to link ${m.slice(2)}.`;
    MLINKS.push([key, m]); return '';
  }
  function removeModLink(key, m) { MLINKS = MLINKS.filter(p => !(p[0] === key && p[1] === m)); }
  const linksOf = key => LINKS.filter(p => p[0] === key || p[1] === key).map(p => p[0] === key ? p[1] : p[0]);
  const isLinked = (a, b) => LINKS.some(p => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a));
  function pruneLinks() { const f = new Set(FAVS); LINKS = LINKS.filter(p => f.has(p[0]) || f.has(p[1])); MLINKS = MLINKS.filter(p => f.has(p[0])); }
  pruneLinks();
  const saveLinks = () => { pruneLinks(); if (LINKS.length || LS.get(LKEY, null) != null) LS.set(LKEY, JSON.stringify({ v: 1, pairs: LINKS }));
    if (MLINKS.length || LS.get(MKEY, null) != null) LS.set(MKEY, JSON.stringify({ v: 1, pairs: MLINKS })); };
  const kindWord = (key, plural) => key[0] === 'H' ? 'fee code' + (plural ? 's' : '') : (key && splitKey(key).jur === 'AB' ? 'ICD-9 code' : 'diagnostic code') + (plural ? 's' : '');
  // link two codes (one fee code, one ICD-9 code, same jurisdiction). Returns '' when linked (or already linked), else the reason.
  function addLink(a, b) {
    const h = a[0] === 'H' ? a : b, i = a[0] === 'H' ? b : a;
    if (h[0] !== 'H' || i[0] !== 'I' || !sameJur(h, i)) return 'These two codes cannot be linked.';
    if (isLinked(h, i)) return '';
    const capA = linksOf(a), capB = linksOf(b), ca = splitKey(a).code, cb = splitKey(b).code;
    if (capA.length >= LMAX) return `${ca} already has ${LMAX} linked ${kindWord(b, true)} (the most allowed). Remove one to link ${cb}.`;
    if (capB.length >= LMAX) return `${cb} is already linked to ${LMAX} ${kindWord(a, true)} (${capB.map(k => splitKey(k).code).join(', ')}), the most allowed. Remove one of its links first.`;
    LINKS.push([h, i]); return '';
  }
  function removeLink(a, b) { LINKS = LINKS.filter(p => !((p[0] === a && p[1] === b) || (p[0] === b && p[1] === a))); }
  const saveLists = () => { LS.set('favs', JSON.stringify(FAVS)); LS.set('recent', JSON.stringify(RECENT)); saveTS(); if (GS.groups.length || LS.get(GKEY, null) != null) saveGroups(); saveLinks(); };
  // Ask the browser not to evict local data (supported in Chrome, Edge, Firefox, Safari 15.2+). Silent if unsupported or refused.
  function persistStorage() { try { if (navigator.storage && navigator.storage.persist) navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => {}); } catch (e) {} }
  function star(key) {
    const on = isFav(key), lab = on ? 'Remove from favourites' : 'Add to favourites';
    return `<span class="star${on ? ' on' : ''}" role="button" tabindex="0" data-fav="${esc(key)}" aria-pressed="${on}" aria-label="${lab}" title="${lab}">${on ? '★' : '☆'}</span>`;
  }
  function paintStar(el) {
    const on = isFav(el.dataset.fav), lab = on ? 'Remove from favourites' : 'Add to favourites';
    el.classList.toggle('on', on); el.textContent = on ? '★' : '☆'; el.setAttribute('aria-pressed', String(on)); el.setAttribute('aria-label', lab); el.title = lab;
  }
  function toggleFav(key, also) {   // also: ICD-saved favourites merged into this row (removed together; see mergeKeys)
    const on = !isFav(key), drop = on ? [] : [key].concat((also || []).filter(k => k !== key && isFav(k)));
    FAVS = on ? [key].concat(FAVS) : FAVS.filter(k => !drop.includes(k));
    if (on) { TS.f[key] = new Date().toISOString(); persistStorage(); } else drop.forEach(d => { delete TS.f[d]; GS.groups.forEach(g => { g.keys = g.keys.filter(k => k !== d); }); });
    // v34: a new favourite goes into the group(s) used last (none = Ungrouped); the quick sheet lets you change that
    if (on && GS.groups.length) GS.last.forEach(id => addToGroup(id, key));
    saveLists();
    $$('[data-fav]').forEach(el => { if (el.dataset.fav === key || drop.includes(el.dataset.fav)) paintStar(el); });
    refreshSaved();
    if (on && GS.groups.length) codeSheet(key, { fresh: true });
    else if (on && canLink(key)) snack(`Added to favourites. Link the ${partnerWord(key, true)} you usually bill with ${splitKey(key).code}? (optional)`, 'Link ' + partnerShort(key), () => linkSheet(key, { fresh: true }));
    else toast(on ? 'Added to favourites' : drop.length > 1 ? 'Removed from favourites: ' + drop.map(k => splitKey(k).code).join(' + ') : 'Removed from favourites');
  }
  function addRecent(key) {
    RECENT = [key].concat(RECENT.filter(k => k !== key)).slice(0, RECENT_MAX);
    TS.r[key] = new Date().toISOString(); Object.keys(TS.r).forEach(k => { if (!RECENT.includes(k)) delete TS.r[k]; });
    touchKey(key); saveLists();
  }
  // ---- Export / import (codes and timestamps only; nothing else leaves the device)
  const keyToItem = (k, t) => { const s = splitKey(k); return { type: s.t === 'H' ? 'HSC' : 'ICD9', code: s.code, jur: s.jur, ...(t ? { at: t } : {}) }; };
  function exportSaved() {
    const now = new Date();
    // version 3 adds "groups" (name, type and member codes; custom order) and "groupSort". Older versions read only
    // "favourites" and "recent", so a new file still imports there: every code arrives, just without its groups.
    // version 4 adds "links": each fee code ↔ ICD-9 pair ({hsc, icd}); older versions ignore it and import the codes.
    // version 5 adds "modLinks": each favourite's linked AHCIP modifiers ({code, modifier}); older versions ignore it.
    // version 6 adds, per group, "mods" (explicit AHCIP modifiers in that code group) and "usedAt" (last used), and groupSort
    // can be "recent"; older versions ignore both and read the group's fee and ICD-9 codes as before.
    const data = { app: 'MedBilling Fee Desk', kind: 'favourites', version: 6, exported: now.toISOString(),
      favourites: FAVS.map(k => keyToItem(k, TS.f[k])), recent: RECENT.map(k => keyToItem(k, TS.r[k])),
      groups: GS.groups.map(g => ({ name: g.name, type: g.type, codes: g.keys.map(k => keyToItem(k)), ...(g.mods.length ? { mods: g.mods.slice() } : {}), ...(GS.used[g.id] ? { usedAt: GS.used[g.id] } : {}) })), groupSort: GS.sort,
      links: LINKS.map(([h, i]) => ({ hsc: keyToItem(h), icd: keyToItem(i) })),
      modLinks: MLINKS.map(([k, m]) => ({ code: keyToItem(k), modifier: m.slice(2) })),
      // Suite parity v1: the one shared backup also carries the shared settings (older versions ignore this field)
      settings: { province: JUR, specialty: skill, textSize: TEXT_SIZES[textSizeIx()] } };
    const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const name = `medbilling-fee-desk-favourites-${d}.json`, text = JSON.stringify(data, null, 1);
    const blob = new Blob([text], { type: 'application/json' });
    const download = () => { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); toast('Exported ' + name); };
    // iPhone/iPad (Safari and home-screen app): the share sheet offers "Save to Files", AirDrop, Mail. Elsewhere: a normal download.
    let file = null; try { file = new File([blob], name, { type: 'application/json' }); } catch (e) {}
    if (phone && file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'MedBilling Fee Desk favourites' }).then(() => toast('Exported ' + name)).catch(err => { if (!err || err.name !== 'AbortError') download(); });
    } else download();
  }
  function parseImport(text) {
    const o = JSON.parse(text);
    if (!o || typeof o !== 'object' || (!Array.isArray(o.favourites) && !Array.isArray(o.recent))) throw new Error('not a MedBilling Fee Desk favourites file');
    const one = x => {
      if (!x || typeof x.code !== 'string') return null;
      const code = x.code.trim().toUpperCase(), t = x.type === 'ICD9' ? 'I' : 'H';
      const jur = typeof x.jur === 'string' && /^[A-Z]{2}$/.test(x.jur.toUpperCase()) ? x.jur.toUpperCase() : 'AB';
      if (JREG.length && !JREG.some(j => j.id === jur) && !REMOVED_JUR.test(jur)) return null;   // privacy-link-b4: codes for removed provinces are kept (hidden), never dropped
      // Codes for the jurisdiction on screen are checked against its data; others are checked when that jurisdiction is opened.
      if (jur === JUR ? (t === 'H' ? !BYCODE[code] : !ICDBY[code]) : !/^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(code)) return null;
      const at = typeof x.at === 'string' && !isNaN(Date.parse(x.at)) ? new Date(x.at).toISOString() : null;
      return { key: t + ':' + (jur === 'AB' ? '' : jur + '|') + code, at };
    };
    const conv = arr => (Array.isArray(arr) ? arr : []).map(one).filter(Boolean);
    // links (version 4+): fee code ↔ ICD-9 pairs; both codes must be valid and from the same jurisdiction
    const links = (Array.isArray(o.links) ? o.links : []).slice(0, 5000).map(l => {
      if (!l || typeof l !== 'object' || !l.hsc || !l.icd) return null;
      const h = one({ ...l.hsc, type: 'HSC' }), i = one({ ...l.icd, type: 'ICD9' });
      return h && i && sameJur(h.key, i.key) ? [h.key, i.key] : null;
    }).filter(Boolean);
    // modifier links (version 5+): an Alberta fee or ICD-9 code and an explicit modifier from the official list
    const modLinks = (Array.isArray(o.modLinks) ? o.modLinks : []).slice(0, 5000).map(l => {
      if (!l || typeof l !== 'object' || !l.code || typeof l.modifier !== 'string') return null;
      const k = one(l.code), m = l.modifier.trim().toUpperCase();
      return k && /^[HI]:[^|]+$/.test(k.key) && (MODX ? modOk(m) : MCODE.test(m)) ? [k.key, 'M:' + m] : null;
    }).filter(Boolean);
    // groups (version 3+): an old file has none, so its codes simply land in Ungrouped
    // v6: a group's modifiers (explicit AHCIP modifiers from the official list) and when it was last used
    const gmods = a => [...new Set((Array.isArray(a) ? a : []).filter(m => typeof m === 'string').map(m => m.trim().toUpperCase()).filter(m => MODX ? modOk(m) : MCODE.test(m)))].slice(0, 200);
    const groups = (Array.isArray(o.groups) ? o.groups : []).map(g => g && typeof g === 'object' && cleanName(g.name)
      ? { name: cleanName(g.name), type: GTYPES[g.type] ? g.type : 'custom', keys: [...new Set(conv(g.codes).map(x => x.key))], mods: gmods(g.mods),
          usedAt: typeof g.usedAt === 'string' && !isNaN(Date.parse(g.usedAt)) ? new Date(g.usedAt).toISOString() : '' } : null).filter(Boolean).slice(0, 500);
    const st = o.settings && typeof o.settings === 'object' ? o.settings : null;
    return { settings: st, fav: conv(o.favourites), rec: conv(o.recent), groups, links, modLinks, groupSort: GSORTS.includes(o.groupSort) ? o.groupSort : null,
      skipped: ((o.favourites || []).length + (o.recent || []).length) };
  }
  function importSaved(file) {
    const r = new FileReader();
    r.onload = () => {
      let p; try { p = parseImport(String(r.result)); } catch (e) { restoreSettings = false; alert('Import failed: this is not a MedBilling Fee Desk favourites file.'); return; }
      applyParsed(p, file.name, false, restoreSettings);
    };
    r.onerror = () => alert('Import failed: the file could not be read.');
    r.readAsText(file);
  }
  // b: shared by the Favourites import (asks with confirm) and Import my data for older backup files (quiet: the shared
  // preview already asked). Returns a one-line summary, or '' when there was nothing new, or null when cancelled.
  function applyParsed(p, fileName, quiet, withSettings) {
    {
      if (withSettings && p.settings) {   // Settings → Restore: specialty and text size come back too (province stays as chosen)
        const ts = Number(p.settings.textSize); if (TEXT_SIZES.includes(ts)) { LS.set('textsize', String(ts)); applyTextSize(); const z = $('#spSize'); if (z) z.value = String(textSizeIx()); }
        const sp = String(p.settings.specialty || ''); if (sp && p.settings.province === JUR && $(`#skill option[value="${CSS.escape(sp)}"]`)) setSkill(sp);
      }
      restoreSettings = false;
      const newFav = [...new Set(p.fav.map(x => x.key))].filter(k => !FAVS.includes(k));
      const skipped = p.skipped - p.fav.length - p.rec.length;
      // groups: merged by type + name (case-insensitive); only codes that are favourites after the import are placed
      const willFav = new Set(FAVS.concat(newFav));
      let gNew = 0, gPlace = 0; const gSeen = new Set();
      p.groups.forEach(g => { const ex = findGroup(g.type, g.name), id = g.type + '|' + g.name.toLowerCase();
        if (!ex && !gSeen.has(id)) gNew++; gSeen.add(id);
        g.keys.forEach(k => { if (willFav.has(k) && !(ex && ex.keys.includes(k))) gPlace++; });
        g.mods.forEach(m => { if (!(ex && ex.mods.includes(m))) gPlace++; }); });
      // links: merged; a pair that would go over 3 links for either code is skipped (existing links are never removed)
      const trial = LINKS.slice(); let lNew = 0, lCap = 0;
      p.links.forEach(([h, i]) => { if (!(willFav.has(h) || willFav.has(i))) return; if (trial.some(x => x[0] === h && x[1] === i)) return;
        const n = k => trial.filter(x => x[0] === k || x[1] === k).length; if (n(h) >= LMAX || n(i) >= LMAX) { lCap++; return; } trial.push([h, i]); lNew++; });
      const lLine = p.links.length ? `\n• ${lNew} new linked pair${lNew === 1 ? '' : 's'} (fee code ↔ ICD-9)` + (lCap ? `, ${lCap} skipped (a code already has ${LMAX} links)` : '') : '';
      const mtrial = MLINKS.slice(); let mNew = 0, mCap = 0;
      p.modLinks.forEach(([k, m]) => { if (!willFav.has(k) || mtrial.some(x => x[0] === k && x[1] === m)) return;
        if (mtrial.filter(x => x[0] === k).length >= LMAX) { mCap++; return; } mtrial.push([k, m]); mNew++; });
      const mLine = p.modLinks.length ? `\n• ${mNew} new linked modifier${mNew === 1 ? '' : 's'}` + (mCap ? `, ${mCap} skipped (a code already has ${LMAX} modifiers)` : '') : '';
      const gLine = p.groups.length ? `\n• ${p.groups.length} group${p.groups.length === 1 ? '' : 's'} (${gNew} new), ${gPlace} code${gPlace === 1 ? '' : 's'} placed in groups`
        : (GS.groups.length && newFav.length ? '\n• No groups in this file: new favourites go to Ungrouped' : '');
      if (!newFav.length && !p.rec.length && !gNew && !gPlace && !lNew && !mNew) { if (quiet) return ''; alert('Nothing to import: all favourites in this file are already saved' + (skipped ? ` (${skipped} unknown code${skipped > 1 ? 's' : ''} skipped)` : '') + '.'); return; }
      if (!quiet && !confirm(`Import from ${fileName}?\n\n• ${newFav.length} new favourite${newFav.length === 1 ? '' : 's'} (${p.fav.length - newFav.length} already saved)\n• ${p.rec.length} recent code${p.rec.length === 1 ? '' : 's'} merged, newest kept, max ${RECENT_MAX}` + gLine + lLine + mLine + (skipped ? `\n• ${skipped} unknown code${skipped > 1 ? 's' : ''} skipped` : '') + '\n\nExisting favourites, groups and links are kept; nothing is deleted.')) return;
      const now = new Date().toISOString();
      p.fav.forEach(x => { if (newFav.includes(x.key) && !TS.f[x.key]) TS.f[x.key] = x.at || now; });
      FAVS = FAVS.concat(newFav);
      const hadGroups = GS.groups.length > 0;
      p.groups.forEach(g => { const id = (findGroup(g.type, g.name) || {}).id || newGroup(g.type, g.name), grp = groupById(id);
        g.keys.slice().reverse().forEach(k => { if (willFav.has(k) && !grp.keys.includes(k)) grp.keys.unshift(k); });
        g.mods.forEach(m => { if (!grp.mods.includes(m)) grp.mods.push(m); });
        if (g.usedAt && !(GS.used[id] && GS.used[id] >= g.usedAt)) GS.used[id] = g.usedAt; });
      if (!hadGroups && p.groupSort) GS.sort = p.groupSort;
      if (p.groups.length) saveGroups();
      LINKS = trial; MLINKS = mtrial;
      const rmap = {}; RECENT.forEach(k => rmap[k] = TS.r[k] || ''); p.rec.forEach(x => { const t = x.at || ''; if (!(x.key in rmap) || t > rmap[x.key]) rmap[x.key] = t; });
      const order = Object.keys(rmap).map((k, i) => ({ k, t: rmap[k], i })).sort((a, b) => (b.t > a.t) - (b.t < a.t) || a.i - b.i);
      RECENT = order.slice(0, RECENT_MAX).map(x => x.k); TS.r = {}; order.slice(0, RECENT_MAX).forEach(x => { if (x.t) TS.r[x.k] = x.t; });
      saveLists(); persistStorage();
      refreshSaved();
      const msg = (`Imported ${newFav.length} favourite${newFav.length === 1 ? '' : 's'}${p.groups.length ? `, ${p.groups.length} group${p.groups.length === 1 ? '' : 's'}` : ''}${lNew + mNew ? `, ${lNew + mNew} link${lNew + mNew === 1 ? '' : 's'}` : ''} and ${p.rec.length} recent`); if (!quiet) toast(msg); return msg;
    }
  }
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const fmtDate = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
  const shortDate = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`; };

  let TOP, META, CODES, BYCODE = {}, RULES, RULEBY = {}, MODS, MODTYPE = {}, MODCODE = {}, EXPL, ICD, ICDBY = {}, BULL, BULLBY = {}, RES;
  let MODX = null, MODXBY = {}, MODXT = {};   // v36 modifier search data (official list, cleaned; see renderMods)
  const modOk = c => !!(MODXBY[c] && MODXBY[c].k === 'E');   // explicit modifiers only can be linked or sent
  const modNice = n => { const v = String(n || ''); return v && v === v.toUpperCase() ? v.charAt(0) + v.slice(1).toLowerCase() : v; };
  let codeIndex, icdIndex;
  let JREG = [], JINFO = null, P = null;   // registry, this jurisdiction's registry entry, province data (null for Alberta)
  // Display names of a jurisdiction / the loaded schedule. Not used in SI prompts.
  const jn = j => j ? j.name : '';
  const pn = () => P ? P.meta.name : '';
  const SKEY = JUR === 'AB' ? 'skill' : 'skill.' + JUR;
  let skill = LS.get(SKEY, JUR === 'AB' ? 'OBGY' : '');
  // ---- Phone/tablet mode: automatic on touch devices under 1024px wide or a mobile UA; user choice is remembered.
  const autoPhone = () => ((('ontouchstart' in window) || navigator.maxTouchPoints > 0) && window.innerWidth < 1024) ||
    /iPhone|iPod|iPad|Android|Mobile/i.test(navigator.userAgent);
  let phone = false;
  function applyLayout() {
    const pref = LS.get('layout', '');
    phone = pref ? pref === 'phone' : autoPhone();
    document.documentElement.classList.toggle('phone', phone);
    const t = document.getElementById('layoutToggle');
    if (t) { t.hidden = !(phone || pref === 'desktop' || autoPhone()); t.textContent = phone ? 'Desktop version' : 'Phone version'; }
  }
  applyLayout();
  // Suite parity v1: text size (shared key mb.textsize, also read by MedBilling Logs)
  const TEXT_SIZES = [0.85, 0.92, 1, 1.08, 1.16, 1.25, 1.4];
  const textSizeIx = () => { const v = parseFloat(LS.get('textsize', '1')); const i = TEXT_SIZES.indexOf(v); return i < 0 ? 2 : i; };
  function applyTextSize() { const v = TEXT_SIZES[textSizeIx()]; document.documentElement.style.fontSize = v === 1 ? '' : (v * 100) + '%'; }
  applyTextSize();
  let restoreSettings = false;
  let region = LS.get('region', 'CA');
  let lastQuery = '', current = null;

  // ------------------------------------------------------------ app-defined scope tables (not Alberta Health mappings)
  // Procedure-list sections treated as in scope per fee skill (roman numeral of SOMB Part B section).
  const SKILL_SECTIONS = {
    OBGY: ['I', 'IX', 'X', 'XI', 'XIII', 'XIV', 'XVI', 'XVII', 'XVIII'],
    UROL: ['I', 'X', 'XI', 'XII', 'XVII', 'XVIII'],
    GNSG: ['I', 'III', 'IX', 'X', 'XI', 'XIII', 'XVI', 'XVII', 'XVIII'],
    CARD: ['I', 'VIII', 'XVIII'], CTSG: ['I', 'VII', 'VIII', 'XVIII'], CRSG: ['I', 'VIII', 'XVIII'], VSSG: ['I', 'VIII', 'XVIII'], THOR: ['I', 'VII', 'XVIII'],
    OPHT: ['I', 'IV', 'XVIII'], OTOL: ['I', 'III', 'V', 'VI', 'VII', 'XVIII'], NUSG: ['I', 'II', 'XV', 'XVIII'], ORTH: ['I', 'XV', 'XVIII'],
    PLAS: ['I', 'XV', 'XVI', 'XVII', 'XVIII'], DERM: ['I', 'XVII', 'XVIII']
  };
  // ICD-9 category ranges in scope per fee skill. Skills not listed (and GP, EMSP, FTER, INMD, ANES) see the full list.
  const ICD_SCOPE = {
    OBGY: { label: 'pregnancy/childbirth (630-679), female genital & breast (610-629), urinary (590-599), gynaecologic neoplasms, genital infections, relevant symptoms, V20-V28 and related V codes',
      r: [[630, 679], [610, 629], [590, 599], [174, 174], [179, 184], [198, 198], [218, 221], [233, 233], [236, 236], [239, 239], [54, 54], [78, 79], [98, 99], [112, 112], [131, 131], [256, 256], [788, 789], [795, 795]],
      v: [[13, 13], [20, 28], [45, 45], [61, 61], [67, 67], [72, 72], [76, 76]] },
    CARD: { label: 'circulatory (390-459), cardiac congenital (745-747), symptoms (780-799)', r: [[390, 459], [745, 747], [780, 799]], v: [[12, 12], [15, 15], [42, 45], [53, 53], [58, 58], [67, 67], [71, 72], [81, 81]] },
    PEDC: { label: 'circulatory, congenital, perinatal, symptoms', r: [[390, 459], [740, 779], [780, 799]], v: [[20, 21], [30, 39], [42, 45], [67, 67], [72, 72]] },
    UROL: { label: 'genitourinary (580-608), urologic neoplasms, symptoms', r: [[580, 608], [185, 189], [222, 222], [233, 233], [236, 236], [752, 753], [788, 788], [791, 791], [996, 996]], v: [[13, 13], [25, 26], [44, 45], [53, 53], [55, 56], [64, 67]] },
    DERM: { label: 'skin (680-709), skin neoplasms, infections', r: [[680, 709], [1, 139], [172, 173], [216, 216], [232, 232], [238, 238], [782, 782]], v: [[10, 10], [67, 67], [72, 72]] },
    OPHT: { label: 'eye (360-379), related', r: [[360, 379], [190, 190], [224, 224], [743, 743], [918, 918], [921, 921], [940, 940]], v: [[41, 41], [43, 43], [45, 45], [67, 67], [72, 72], [80, 80]] },
    OTOL: { label: 'ear/nose/throat & respiratory (380-389, 460-478), head & neck neoplasms', r: [[380, 389], [460, 478], [140, 149], [160, 161], [784, 784]], v: [[41, 41], [67, 67], [72, 72]] },
    PSYC: { label: 'mental disorders (290-319)', r: [[290, 319], [780, 780], [799, 799]], v: [[11, 11], [15, 15], [40, 40], [60, 62], [65, 65], [67, 67], [70, 71]] },
    NEUR: { label: 'nervous system (320-359), cerebrovascular, symptoms', r: [[320, 359], [430, 438], [780, 781], [784, 784], [850, 854], [950, 957]], v: [[12, 12], [17, 17], [67, 67]] },
    GAST: { label: 'digestive (520-579), GI neoplasms, symptoms', r: [[520, 579], [150, 159], [211, 211], [230, 230], [787, 789], [792, 792]], v: [[10, 10], [12, 12], [16, 16], [18, 18], [44, 44], [53, 53], [55, 55], [67, 67], [76, 76]] },
    RSMD: { label: 'respiratory (460-519), lung neoplasms, symptoms', r: [[460, 519], [11, 11], [162, 163], [786, 786]], v: [[12, 12], [15, 15], [44, 44], [46, 46], [67, 67], [71, 71]] },
    NEPH: { label: 'kidney/urinary (580-599), hypertension, metabolic', r: [[580, 599], [401, 405], [250, 250], [270, 279], [788, 788], [791, 791]], v: [[42, 42], [45, 45], [56, 56], [67, 67]] },
    ORTH: { label: 'musculoskeletal (710-739), injuries (800-999)', r: [[710, 739], [800, 999], [754, 756]], v: [[43, 43], [45, 45], [48, 49], [54, 54], [67, 67]] }
  };
  ['SPMH', 'GNMH'].forEach(k => ICD_SCOPE[k] = ICD_SCOPE.PSYC);
  ['PDNR'].forEach(k => ICD_SCOPE[k] = ICD_SCOPE.NEUR); ['PDGE'].forEach(k => ICD_SCOPE[k] = ICD_SCOPE.GAST); ['PEDN'].forEach(k => ICD_SCOPE[k] = ICD_SCOPE.NEPH);
  const FULL_ICD = new Set(['BASE', 'GP', 'EMSP', 'FTER', 'INMD', 'ANES', 'CRCM']);

  function icdInScope(icd, sk) {
    sk = sk || skill;
    if (FULL_ICD.has(sk) || !ICD_SCOPE[sk]) return true;
    const sc = ICD_SCOPE[sk];
    if (icd.code[0] === 'V') { const n = parseInt(icd.code.slice(1, 3), 10); return sc.v.some(([a, b]) => n >= a && n <= b); }
    if (icd.code[0] === 'E') return false;
    const n = parseInt(icd.code.slice(0, 3), 10);
    return sc.r.some(([a, b]) => n >= a && n <= b);
  }
  const romanOf = c => c.roman != null ? c.roman : (c.section || '').split('.')[0].trim();
  function codeInSkill(c, sk) {
    sk = sk || skill;
    if (c.skill && c.skill[sk]) return true;
    const secs = SKILL_SECTIONS[sk];
    if (!secs) return true;
    return secs.includes(romanOf(c));
  }
  // down-weight codes whose wording ties them to another discipline (search ranking only)
  const DISC = { OBGY: /obstetr|gyn|perinat|uro-gyn|prenatal|pregnan/i, PSYC: /psychiatr/i, CARD: /cardiolog/i, PED: /pediatric|paediatric/i,
    NEUR: /neurolog/i, OPHT: /ophthalm/i, DERM: /dermatolog/i, GAST: /gastroenterolog/i, UROL: /urolog(?!y,)/i, RHEU: /rheumatolog/i,
    ORSG: /dental|oral surg/i, PODS: /podiatr/i, NEPH: /nephrolog/i, MDON: /oncolog/i, ANES: /anesthetist|anaesthetist/i };
  ['SPMH', 'GNMH'].forEach(k => DISC[k] = DISC.PSYC); ['PDGE', 'PDNR', 'PDSG', 'PEDC', 'PEDN', 'NPM'].forEach(k => DISC[k] = DISC.PED);
  function offSkillPenalty(c) {
    if (P) return c.rows && c.rows.some(r => r.sn === skill) ? 1.15 : 1;
    const own = DISC[skill];
    if (own && own.test(c.desc)) return 1;
    for (const [k, re] of Object.entries(DISC)) if (k !== skill && DISC[k] !== own && re.test(c.desc)) return 0.6;
    return 1;
  }
  function feeFor(c, sk) {
    sk = sk || skill;
    if (P) return provFee(c, sk);
    if (c.byAssess) return { amount: null, label: 'By assessment', note: 'Fee by assessment (procedure list: BY ASSESS)' };
    if (sk !== 'BASE' && c.skill && c.skill[sk] != null) return { amount: parseFloat(c.skill[sk]), label: sk + ' rate', note: `SKLL ${sk} replace-base rate from the price list` };
    return { amount: c.base, label: sk === 'BASE' ? 'schedule base' : 'schedule base', note: sk === 'BASE' ? 'Schedule base rate' : `No SKLL ${sk} rate listed; schedule base applies` };
  }

  // ------------------------------------------------------------ provinces and territories (lazy: only the chosen jurisdiction's file loads)
  // Section name -> Alberta-style body-system section, used only to reuse the ICD suggestion rules.
  const ROMAN = { 'Obstetrics': 'XIV', 'Female Genital System': 'XIII', 'Breast': 'XVI', 'Male Genital System': 'XII', 'Urinary System': 'XI',
    'Digestive System': 'X', 'Hemic and Lymphatic Systems': 'IX', 'Cardiovascular System': 'VIII', 'Respiratory System': 'VII', 'Ocular System': 'IV',
    'Audio-Vestibular System': 'V', 'Nervous System': 'II', 'Endocrine System': 'III', 'Musculoskeletal System': 'XV', 'Integumentary System': 'XVII' };
  const dxName = () => P ? P.meta.dx.system : JUR === 'AB' ? 'ICD-9' : 'diagnostic code';
  const chipText = v => P ? ((P.meta.skills.find(x => x.code === v) || {}).name || v || '').replace(/\s*\([^)]*\)\s*$/, '').replace(/^Visits\/Examinations—/, '').slice(0, 22) : v === 'BASE' ? 'Base' : v;
  const pdfLink = (p, l, txt) => P && P.meta.pdf && p ? `<a target="_blank" rel="noopener noreferrer" href="${esc(P.meta.pdf)}${P.meta.pdfGen ? '' : '#page=' + p}">${esc(txt || P.meta.title + ' p. ' + (l || p))}</a>` : '';
  function switchJur(id, hash) {
    LS.set('jur', id); PICK.setJur(id);
    location.href = location.pathname + location.search + (hash || '');
    if (hash) setTimeout(() => location.reload(), 50);
  }
  function initJur() {
    const sel = $('#jur'), chip = $('#jurChip'); if (!sel) return;
    const opt = j => `<option value="${esc(j.id)}">${esc(jn(j))}${j.status === 'live' ? '' : j.status === 'none' ? ' (no schedule)' : ' (coming soon)'}</option>`;
    sel.innerHTML = JREG.filter(j => j.group !== 'terr').map(opt).join('') + (JREG.some(j => j.group === 'terr') ? `<optgroup label="Territories">${JREG.filter(j => j.group === 'terr').map(opt).join('')}</optgroup>` : '');
    [sel, chip].forEach(x => { if (!x) return; x.innerHTML = sel.innerHTML; x.value = JUR; x.addEventListener('change', () => { if (x.value !== JUR) switchJur(x.value, ''); }); });
    const ct = $('#jurChipText'); if (ct) ct.textContent = JINFO && JINFO.id === JUR ? jn(JINFO) : JUR;
    const root = document.documentElement;
    root.classList.toggle('jur-x', JUR !== 'AB');
    root.classList.toggle('jur-soon', !!JINFO && JINFO.status !== 'live');
    root.dataset.jur = JUR;
  }
  function provCodes(D) {
    const S = D.secs, H = D.subs, by = {}, out = [];
    D.rows.forEach(r => {
      r.sn = S[r.s]; r.hn = H[r.h] || '';
      let c = by[r.c];
      if (!c) { c = by[r.c] = { code: r.c, display: r.c, rows: [] }; out.push(c); }
      c.rows.push(r);
    });
    out.forEach(c => {
      const cnt = {}; c.rows.forEach(r => cnt[r.d] = (cnt[r.d] || 0) + 1);
      const ds = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
      c.desc = ds[0]; c.alt = ds.slice(1).join(' · ');
      c.section = c.rows[0].sn; c.sub = c.rows[0].hn; c.roman = ROMAN[c.section] || '';
      c.heads = [...new Set(c.rows.map(r => r.sn + ' ' + r.hn))].join(' ');
    });
    return out.sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
  }
  async function bootOther(get) {
    const tasks = [get('resources'), get('top-sources')];
    if (JINFO.status === 'live' && JINFO.file) tasks.push(get('prov/' + JINFO.file.replace(/\.json$/, '')));
    const [res, top, D] = await Promise.all(tasks);
    RES = res; TOP = top;
    if (D) {
      P = D; P.codeRe = new RegExp(D.meta.codeRe || '^$');
      META = { skills: D.meta.skills };
      CODES = provCodes(D);
      ICD = D.meta.dx && D.meta.dx.file ? await get('prov/' + D.meta.dx.file.replace(/\.json$/, '')) : [];
    } else { META = { skills: [] }; CODES = []; ICD = []; }
    RULES = []; MODS = []; EXPL = []; BULL = [];
    CODES.forEach(c => BYCODE[c.code] = c);
    ICD.forEach(i => ICDBY[i.code] = i);
    document.documentElement.classList.toggle('noskill', !(P && P.meta.skills.length));
    applyJurLabels();
    initSkill();
    footerOther();
    codeIndex = new MBSearch.Index(CODES.map(c => ({ id: c.code, c, fields: { desc: c.desc + (c.alt ? ' ' + c.alt : ''), head: c.heads, notes: '', chap: '' } })), { desc: 3, head: 1.1, notes: 0.35, chap: 0.4 }, { phraseField: 'desc' });
    icdIndex = new MBSearch.Index(ICD.map(i => ({ id: i.code, i, fields: { desc: i.desc, block: i.block || '', excl: '' } })), { desc: 3, block: 0.6 }, { phraseField: 'desc' });
    wire();
    renderStatic();
    if (!lastQuery) renderSaved();
    route();
  }
  function applyJurLabels() {
    const name = JINFO ? jn(JINFO) : JUR;
    const q = $('#q'); if (q) { q.placeholder = P ? ((window.SPUI && SPUI.SEARCH_PH) || 'Search codes') : 'Fee codes coming soon'; /* v1b M11: one shared placeholder (fits at 360) */ q.setAttribute('aria-label', 'Service description or code'); q.dataset.ph = q.placeholder; fitQph(); }
    $$('[data-tab="price"]').forEach(b => b.textContent = 'Fee list');
    $$('[data-tab="icd9"]').forEach(b => b.textContent = P ? dxName() : 'Diagnostic codes');
    const iq = $('#iq'); if (iq) iq.placeholder = P ? `Search ${dxName()} (e.g. pre-eclampsia, 642.4, V22)` : 'Search diagnostic codes';
    const rf = $('#rf'); if (rf) rf.placeholder = 'Filter rules and sections';
    const pf = $('#pf'); if (pf) pf.placeholder = 'Filter by code, word or section';
    $$('.skill > span, .skillchip > .small').forEach(e => e.textContent = P && P.meta.skillLabel ? P.meta.skillLabel.replace(/\s*\(.*\)$/, '') : 'Specialty');
    $('#skill').setAttribute('aria-label', P && P.meta.skillLabel ? P.meta.skillLabel : 'Specialty');
    const lim = $('#limitSkill'); if (lim) { lim.checked = false; lim.disabled = true; }
    const bar = $('#jurbar');
    if (bar) {
      bar.hidden = false;
      bar.innerHTML = P ? `<b>${esc(name)}</b> · ${esc(P.meta.title)} · <span class="eff">${esc(P.meta.effectiveLabel)}</span> · <a target="_blank" rel="noopener noreferrer" href="${esc(P.meta.landing)}">Official source</a>`
        : `<b>${esc(name)}</b> · <span class="eff">${esc(JINFO ? JINFO.message : '')}</span>`;
    }
  }
  function soonPanel() {
    const j = JINFO || {};
    return `<div class="card soon"><h2>${esc(jn(j) || JUR)}</h2><p class="warn">${esc(j.message || '')}</p>${j.why ? `<p class="small">${esc(j.why)}</p>` : ''}
      ${j.link ? `<p><a target="_blank" rel="noopener noreferrer" href="${esc(j.link)}">${esc(j.linkLabel || 'Official source')}</a></p>` : ''}
      <p class="small muted">Choose another province or territory at the top. Alberta is the default.</p></div>`;
  }
  function footerOther() {
    $('#dataline').innerHTML = P ? `Data: ${esc(pn())} ${esc(P.meta.title)}, ${esc(P.meta.effectiveLabel.replace(/^./, ch => ch.toLowerCase()))} · ${P.meta.counts.codes.toLocaleString()} codes · <a href="${esc(P.meta.pdf)}" target="_blank" rel="noopener noreferrer">PDF</a>`
      : `${esc(JINFO ? jn(JINFO) : JUR)}: ${esc(JINFO ? JINFO.message : '')}`;
    const d = $('.foot .disclaimer'); if (d) d.textContent = P ? `Reference only; verify against the current ${P.meta.name} ${P.meta.title} before submitting claims.` : 'Reference only; verify against the official schedule before submitting claims.';
    renderSourceNote();
  }
  // Source footnote: publisher, document, edition/effective date, link, last checked, required licence/credit wording.
  // ICD-9-CM (U.S. CMS/NCHS) credit, shown wherever the CMS list is the bundled diagnostic list; app-wide non-endorsement line.
  const ICD9CM_CREDIT = 'https://www.cms.gov/medicare/coding-billing/icd-10-codes/icd-9-cm-diagnosis-procedure-codes-abbreviated-and-full-code-titles';
  const NOT_OFFICIAL = 'Not an official version; not affiliated with or endorsed by any government.';
  function sourceNoteHtml() {
    const a = (u, t) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>`;
    const icdcm = P && P.meta.dx && P.meta.dx.file === 'dx-icd9cm.json'
      ? `<p class="small icdcredit">ICD-9-CM diagnostic codes: version 32, U.S. Centers for Medicare &amp; Medicaid Services (CMS) and National Center for Health Statistics (NCHS, CDC); U.S. public domain, available free at ${a(ICD9CM_CREDIT, 'cms.gov')}. Use does not imply endorsement by CMS, CDC, HHS or the U.S. Government.</p>` : '';
    return sourceNoteBody() + icdcm + `<p class="small notofficial">${esc(NOT_OFFICIAL)}</p>`;
  }
  function sourceNoteBody() {
    const a = (u, t) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>`;
    const chk = iso => iso ? fmtDate(iso.slice(0, 10)) : '';
    if (JUR === 'AB' && META && META.sombEffective) {
      return `<p class="small">Source: Alberta Health, Schedule of Medical Benefits (SOMB), effective ${esc(fmtDate(META.sombEffective))}. ${a(META.albertaCa, 'alberta.ca')} · ${a(META.sombDataset, 'SOMB files (open.alberta.ca)')}.
        Diagnostic codes: ${esc(META.icd9.name)} (${a(META.icd9.dataset, 'open.alberta.ca')}). Bulletins: ${a(META.bulletinsDataset, 'AHCIP medical bulletins')}. Last checked by the app: ${esc(chk(META.downloadedAt))}.</p>
        <p class="small">Contains information licensed under the ${a('https://open.alberta.ca/licence', 'Open Government Licence – Alberta')}.</p>
        <p class="small muted">Reference only. The official schedule governs if there is any difference.</p>`;
    }
    if (P) {
      const m = P.meta;
      return `<p class="small">Source: ${esc(m.publisher)}, ${esc(m.title)}, ${esc(m.effectiveLabel.replace(/^./, ch => ch.toLowerCase()))}. ${a(m.pdf, m.pdfGen ? m.pdfGen.label : 'Official PDF')} · ${a(m.landing, 'source page')}. Edition: ${esc(m.edition)}. Last checked by the app: ${esc(chk(m.checked))}.</p>
        ${m.dx && m.dx.label ? `<p class="small">Diagnostic codes: ${esc(m.dx.label)}. ${m.dx.url ? a(m.dx.url, m.dx.urlLabel || 'source') : ''}</p>` : ''}
        ${m.licence ? `<p class="small">${esc(m.licence.text)}${m.licence.url ? ' ' + a(m.licence.url, 'Licence') : ''}</p>` : ''}
        ${m.credit ? `<p class="small">${esc(m.credit)}</p>` : ''}
        ${m.caveat ? `<p class="small caveat">${esc(m.caveat.text)}${m.caveat.url ? ' ' + a(m.caveat.url, m.caveat.urlLabel || 'Updates') : ''}</p>` : ''}
        <p class="small muted">${esc(m.governs || 'Reference only. The official schedule governs if there is any difference.')}</p>`;
    }
    const j = JINFO || {};
    return `<p class="small">${esc(jn(j))}: ${esc(j.message || '')} ${j.link ? a(j.link, j.linkLabel || 'Official source') : ''}</p><p class="small muted">No ${esc(j.name || '')} fees are shown in this app. The official schedule governs.</p>`;
  }
  function renderSourceNote() { const el = $('#srcnote'); if (el) el.innerHTML = sourceNoteHtml(); }
  // ---- fees
  const isSpecSec = n => P && P.meta.specSecs ? P.meta.specSecs.includes(n) : /\(\d{2}(?:-\d+)?(?:, \d{2}(?:-\d+)?)*\)$/.test(n || '');
  function pickRow(c, sk) {
    return c.rows.find(r => r.sn === sk) || c.rows.find(r => !isSpecSec(r.sn)) || c.rows[0];
  }
  const TXT = { BR: 'By report', FS: 'F/S (included)', NC: 'No charge (NC)', IC: 'Independent consideration (IC)' };
  const skillName = () => { const s = P && P.meta.skills.find(x => x.code === skill); return s ? s.name : skill; };
  const amtStr = v => typeof v === 'number' ? money(v) : (TXT[v] || String(v));
  function rowAmount(r, sk) {
    const m = P.meta;
    if (m.feeModel === 'msu') {  // units only, exactly as printed (no dollar conversion)
      const an = r.an ? (r.an === 'TU' ? 'Anaes TU (time units)' : `Anaes units ${r.an}`) : '';
      if (!r.u) return { amount: null, label: r.an ? 'Anaesthetic units only' : 'See document', note: an };
      const pct = /%$/.test(r.u), vf = r.u === 'VF', ic = r.u === 'IC';
      return { amount: null, label: ic ? 'Independent consideration' : vf ? 'VF (visit fee)' : pct ? r.u : `${r.u} units`, note: [ic || vf ? '' : pct ? 'Percentage as printed' : 'Base units as printed', an].filter(Boolean).join(' · ') };
    }
    if (m.pick) {
      const k = (m.pick[sk] || m.pick[m.defaultSkill]).find(x => r[x] != null);
      if (!k) return { amount: null, label: 'See document', note: '' };
      const others = Object.keys(m.colNames).filter(x => x !== k && r[x] != null).map(x => `${m.colNames[x]} ${amtStr(r[x])}`);
      const note = [(k !== sk ? m.colNames[k] : '') + (r.mk ? ' (marked ' + r.mk + ')' : ''), ...others].filter(x => x.trim()).join(' · ');
      return typeof r[k] === 'number' ? { amount: r[k], label: '', note } : { amount: null, label: amtStr(r[k]), note };
    }
    if (m.feeModel === 'units' && r.u != null) {
      const rate = m.unitRates ? (m.unitRates[sk] != null ? m.unitRates[sk] : null) : m.unitValue;
      return rate == null ? { amount: null, label: r.u + ' units', note: 'Choose a specialty to price the units' } : { amount: Math.round(r.u * rate * 100) / 100, label: '', note: `${r.u} units × ${money(rate)}` };
    }
    if (r.v) { const k = r.v[sk] != null ? sk : m.defaultSkill, v = r.v[k], nm = k === sk && m.pick === undefined && m.feeModel === 'cols' ? '' : (m.colNames && m.colNames[k]) || k; return v == null ? { amount: null, label: '—', note: '' } : typeof v === 'number' ? { amount: v, label: '', note: nm } : { amount: null, label: v === 'IC' ? 'Independent consideration' : (TXT[v] || v), note: nm }; }
    if (r.fp != null || r.sp != null) {  // separate FP and Spec. columns (NL visit premiums)
      const k = sk === m.fpSkill ? 'fp' : 'sp', v = r[k], note = `FP ${r.fp != null ? amtStr(r.fp) : '—'} · Spec. ${r.sp != null ? amtStr(r.sp) : '—'}`;
      return typeof v === 'number' ? { amount: v, label: '', note } : { amount: null, label: v != null ? amtStr(v) : '—', note };
    }
    if (r.f == null && r.an != null && m.anOnlyNote) return { amount: null, label: /unit/.test(r.an) ? r.an : r.an + ' units', note: 'Anaesthesia basic units' };
    if (typeof r.f === 'number') return { amount: r.f, label: '', note: r.fl || '' };
    if (typeof r.f === 'string') return { amount: null, label: TXT[r.f] || r.f, note: /%$/.test(r.f) ? 'Percentage premium' : '' };
    if (r.pro != null || r.tec != null) return { amount: null, label: [r.pro != null ? 'PRO ' + money(r.pro) : '', r.tec != null ? 'TEC ' + money(r.tec) : ''].filter(Boolean).join(' · '), note: 'Professional and technical components' };
    return { amount: null, label: 'See document', note: '' };
  }
  function provFee(c, sk) {
    const r = pickRow(c, sk), a = rowAmount(r, sk);
    const other = isSpecSec(r.sn) && r.sn !== sk && P.meta.skills.length;
    return { amount: a.amount, label: a.label || (a.amount == null ? '—' : ''), note: [a.note, other ? `from ${r.sn}` : ''].filter(Boolean).join(' · '), row: r };
  }
  const feeTxt = f => f.amount == null ? esc(f.label) : money(f.amount);
  function provDetail(c, quiet) {
    current = c.code;
    if (!quiet) addRecent(hk(c.code));
    $$('.hit').forEach(b => b.classList.toggle('sel', b.dataset.code === c.code && !b.dataset.jur));
    const m = P.meta, f = feeFor(c), r0 = f.row, el = $('#detail'); el.hidden = false;
    const cols = m.cols || {};
    const amtCells = r => { const a = rowAmount(r, skill); return `<td class="fee">${feeTxt({ amount: a.amount, label: a.label })}${a.note ? `<div class="small muted">${esc(a.note)}</div>` : ''}</td>${cols.au ? `<td>${r.au != null ? esc(r.au) : ''}</td>` : ''}`; };
    const rowsHtml = `<div class="tablewrap"><table><thead><tr><th>Section</th><th>${esc(cols.f || 'Fee')}</th>${cols.au ? `<th>${esc(cols.au)}</th>` : ''}<th>Page</th></tr></thead><tbody>${c.rows.map(r => `<tr class="${r === r0 ? 'hl' : ''}"><td>${esc(r.sn)}${r.hn ? ' › ' + esc(r.hn) : ''}${r.d !== c.desc ? `<div class="small muted">${esc(r.d)}</div>` : ''}${r.m ? `<div class="small mods">${esc(r.m)}</div>` : ''}</td>${amtCells(r)}<td class="nowrap">${pdfLink(r.p, r.l, 'p. ' + r.l)}</td></tr>`).join('')}</tbody></table></div>`;
    const modsP = r0.m ? `<p class="small">Modifiers: <span class="mods">${esc(r0.m)}</span>${c.rows.length > 1 ? ` · ${c.rows.length} listings below` : ''}</p>` : '';
    const unitP = [m.unitNote, m.pdfGen && m.pdfGen.note, r0.f == null && r0.an != null && m.anOnlyNote].filter(Boolean).map(t => `<p class="small muted">${esc(t)}</p>`).join('');
    const cav = m.caveat ? `<p class="small caveat">${esc(m.caveat.text)} <a target="_blank" rel="noopener noreferrer" href="${esc(m.caveat.url)}">${esc(m.caveat.urlLabel)}</a></p>` : '';
    const under = r0.o ? `<p class="small muted">Printed as “${esc(r0.o)}”, listed under “${esc(r0.u)}”.</p>` : '';
    const docLinks = [...new Set(c.rows.map(r => r.p))].slice(0, 6).map(p => { const r = c.rows.find(x => x.p === p); return pdfLink(p, r.l) + ` <span class="small muted">(${esc(r.sn)})</span>`; });
    const extraX = Object.entries(m.extraCols || {}).filter(([k]) => r0[k] != null).map(([k, n]) => `${esc(n)} ${esc(r0[k])}`).join(' · ');
    const extra = [r0.au != null && cols.au ? `${esc(cols.au)}: ${esc(r0.au)}` : '', extraX].filter(Boolean).join(' · ');
    const mkN = r0.mk && (m.markNotes ? m.markNotes[r0.mk] : m.markNote), markP = mkN ? `<p class="small muted">${esc(mkN)}</p>` : '';
    const feeLabel = m.skills.length ? esc(skillName()) : 'Benefit';
    const credit = `<p class="small muted srcmini">Source: ${esc(m.publisher)}, ${esc(m.title)} (${esc(m.effectiveLabel.replace(/^./, ch => ch.toLowerCase()))}). ${esc(m.governs)}</p>`;
    if (phone) {
      el.innerHTML = `<div class="pcard">
        <button type="button" class="ghost back" id="pBack">‹ Results</button>
        <div class="row1"><span class="code codebig">${esc(c.code)}</span>${star(hk(c.code))}${r0.ast ? '<span class="badge">*</span>' : ''}</div>
        <h2>${esc(r0.d)}</h2>${under}${markP}${modsP}
        <div class="pfee"><div class="fee big">${feeTxt(f)}</div><div class="small muted">${feeLabel}${f.note ? ' · ' + esc(f.note) : ''}${extra ? ' · ' + extra : ''}</div><div class="small eff">${esc(pn() || m.name)} · ${esc(m.effectiveLabel)}</div></div>
        <div class="pbtns"><button type="button" class="ghost" id="pDoc" aria-expanded="false">Document</button><button type="button" class="ghost" id="askCode">Ask SI</button><button type="button" class="ghost" id="pMore">More about this condition</button></div>${pickBtn('hsc', c.code)}
        <div id="pDocs" class="links" hidden>${docLinks.join('') || '<span class="muted">No document page listed.</span>'}</div>
        ${c.rows.length > 1 ? `<details><summary>All listings (${c.rows.length})</summary>${rowsHtml}</details>` : ''}
        <h3>Suggested ${esc(dxName())}</h3><p class="small muted" id="icdsugbasis"></p><div id="icdsug" class="picklist"></div>${unitP}${cav}${credit}</div>`;
      const sg = suggestIcd(c); $('#icdsugbasis').textContent = ICD.length ? sg.basis : ''; renderIcdList($('#icdsug'), ICD.length ? sg.rows : [], ICD.length ? sg.empty : noDxMsg());
      pickedIcd = ICD.length && sg.rows.length ? sg.rows[0].i.code : null;
      const mark = () => $$('#icdsug .icdrow').forEach(x => x.classList.toggle('picked', x.dataset.icd === pickedIcd)); mark();
      $('#icdsug').addEventListener('click', e => { const x = e.target.closest('.icdrow'); if (x && !e.target.closest('button')) { pickedIcd = x.dataset.icd; mark(); } });
      $('#pMore').disabled = !pickedIcd; $('#pMore').onclick = () => pickedIcd && showMedRes(pickedIcd);
      $('#pDoc').onclick = () => { const d = $('#pDocs'); d.hidden = !d.hidden; $('#pDoc').setAttribute('aria-expanded', String(!d.hidden)); };
      $('#askCode').onclick = () => openAI(codePrompt(c));
      $('#pBack').onclick = () => { current = null; el.hidden = true; el.innerHTML = ''; $('.split').classList.remove('showing'); $$('.hit').forEach(b => b.classList.remove('sel')); if (!lastQuery) renderSaved(); history.replaceState(null, '', location.pathname + location.search); window.scrollTo(0, 0); };
      $('.split').classList.add('showing'); window.scrollTo(0, 0);
    } else {
      $('.split').classList.remove('showing');
      el.innerHTML = `
        ${m.skills.length ? `<div class="mobileskill">${esc(m.skillLabel)} <select class="skillsel" aria-label="${esc(m.skillLabel)}"></select></div>` : ''}
        <div class="row1"><span class="code codebig">${esc(c.code)}</span>${star(hk(c.code))}${r0.ast ? '<span class="badge" title="Asterisked procedure (see Rule of Application 21)">*</span>' : ''}<span class="badge j">${esc(pn() || m.name)}</span></div>
        <h2>${esc(r0.d)}</h2>${under}${markP}${modsP}
        <div class="small muted">${esc([r0.sn, r0.hn].filter(Boolean).join(' › '))}</div>
        <div class="feeblock">
          <div><div class="small muted">${m.skills.length ? 'Benefit (' + esc(skillName()) + ')' : 'Benefit'}</div><div class="fee big">${feeTxt(f)}</div><div class="small muted">${esc(f.note)}</div></div>
          ${extra ? `<div><div class="small muted">${r0.au != null && cols.au ? esc(cols.au) : 'Details'}</div><div class="fee">${r0.au != null && cols.au ? esc(r0.au) + (extraX ? ' · ' + extraX : '') : extraX}</div></div>` : ''}
          <div><div class="small muted">Effective</div><div class="eff">${esc(m.effectiveLabel)}</div></div>
        </div>
        <div class="row"><button class="ghost" id="askCode">Ask SI</button><button class="ghost" id="copyCode">Copy code</button>${pickBtn('hsc', c.code)}</div>
        <h3>In the official document</h3><div class="links">${docLinks.join('') || '<span class="muted">—</span>'}</div>
        <p class="small">Notes, rules and modifiers for this code are on the linked page and in the ${esc(m.title)} rules (<a href="#/rules">Rules tab</a>).</p>
        <h3>${c.rows.length > 1 ? 'All listings (' + c.rows.length + ')' : 'Listing'}</h3>${rowsHtml}
        <h3>Suggested ${esc(dxName())} <span class="small muted" id="icdsugbasis"></span></h3><div id="icdsug"></div>${unitP}${cav}${credit}`;
      const ss = $('.skillsel', el); if (ss) { skillOptions(ss); ss.addEventListener('change', e => setSkill(e.target.value)); }
      $('#askCode').onclick = () => openAI(codePrompt(c));
      $('#copyCode').onclick = () => copy(c.code, 'Code copied');
      const sg = suggestIcd(c); $('#icdsugbasis').textContent = ICD.length ? '(' + sg.basis + ')' : ''; renderIcdList($('#icdsug'), ICD.length ? sg.rows : [], ICD.length ? sg.empty : noDxMsg());
      if (!quiet && !window.matchMedia('(min-width:900px)').matches) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (location.hash !== '#/code/' + c.code) history.replaceState(null, '', '#/code/' + c.code);
  }
  const noDxMsg = () => P && P.meta.dx && P.meta.dx.note ? P.meta.dx.note : 'No diagnostic code list is bundled for this jurisdiction.';
  function renderDxScope() {
    const el = $('#icdscope');
    if (!P) { el.textContent = JINFO ? jn(JINFO) + ': ' + JINFO.message : ''; return; }
    const d = P.meta.dx;
    el.innerHTML = ICD.length ? `${esc(P.meta.name)}: ${esc(d.label)}, ${ICD.length.toLocaleString()} codes. ${esc(d.note || '')} ${d.url ? `<a target="_blank" rel="noopener noreferrer" href="${esc(d.url)}">${esc(d.urlLabel || 'Source')}</a>` : ''}`
      : `${esc(d.note || noDxMsg())} ${d.url ? `<a target="_blank" rel="noopener noreferrer" href="${esc(d.url)}">${esc(d.urlLabel || 'Official source')}</a>` : ''}`;
  }
  function provPrice() {
    const f = ($('#pf').value || '').trim().toLowerCase(), cq = f.toUpperCase().replace(/\s+/g, '');
    const rows = CODES.filter(c => !f || c.code.startsWith(cq) || c.desc.toLowerCase().includes(f) || c.heads.toLowerCase().includes(f));
    const show = rows.slice(0, 300), cols = P.meta.cols || {};
    $('#pricelist').innerHTML = `<p class="small muted pad">${rows.length.toLocaleString()} of ${CODES.length.toLocaleString()} codes${rows.length > 300 ? ' (first 300 shown; refine the filter)' : ''} · ${esc(P.meta.name)} ${esc(P.meta.title)}, ${esc(P.meta.effectiveLabel.replace(/^./, ch => ch.toLowerCase()))}${P.meta.skills.length ? ' · fees for ' + esc(skillName()) : ''}.</p>
      <table><thead><tr><th>Code</th><th>Description</th><th>Section</th><th>${esc(cols.f || 'Fee')}</th>${cols.au ? `<th>${esc(cols.au)}</th>` : ''}<th>Page</th></tr></thead><tbody>
      ${show.map(c => { const fe = feeFor(c), r = fe.row; return `<tr><td class="nowrap">${star(hk(c.code))}<a class="code" href="#/code/${esc(c.code)}">${esc(c.code)}</a></td><td>${esc(r.d)}</td><td class="small">${esc(r.sn)}</td><td class="fee">${feeTxt(fe)}</td>${cols.au ? `<td>${r.au != null ? esc(r.au) : ''}</td>` : ''}<td class="nowrap">${pdfLink(r.p, r.l, r.l)}</td></tr>`; }).join('')}
      </tbody></table>`;
  }
  function provRules() {
    const f = ($('#rf').value || '').trim().toLowerCase();
    const rows = (P.rules || []).filter(r => !f || r.t.toLowerCase().includes(f));
    $('#rules').innerHTML = `<p class="small muted">${esc(P.meta.rulesNote || '')} ${esc(P.meta.name)} ${esc(P.meta.title)}, ${esc(P.meta.effectiveLabel.replace(/^./, ch => ch.toLowerCase()))}. <a target="_blank" rel="noopener noreferrer" href="${esc(P.meta.pdf)}">${esc(P.meta.pdfGen ? P.meta.pdfGen.label : 'Whole PDF')}</a></p>` +
      rows.map(r => `<div class="rule${r.g === 'h' ? ' rh' : ''}">${r.g === 'h' ? `<b>${esc(r.t)}</b>` : esc(r.t)} ${pdfLink(r.p, r.l, 'p. ' + r.l)}</div>`).join('');
  }

  // ------------------------------------------------------------ boot
  async function boot() {
    const get = n => fetch('data/' + n + '.json').then(r => { if (!r.ok) throw new Error(n + ' ' + r.status); return r.json(); });
    JREG = await get('prov/index').then(j => j.list).catch(() => [{ id: 'AB', name: 'Alberta', group: 'prov', status: 'live' }]);
    JINFO = JREG.find(j => j.id === JUR) || JREG[0];
    initJur();
    if (JUR !== 'AB') return bootOther(get);
    const mx = get('modifier-search').catch(() => null);
    [META, CODES, RULES, MODS, EXPL, ICD, BULL, RES, TOP] = await Promise.all(['meta', 'codes', 'rules', 'modifiers', 'explanatory', 'icd9', 'bulletins', 'resources', 'top-sources'].map(get));
    CODES.forEach(c => BYCODE[c.code] = c);
    RULES.forEach(r => RULEBY[r.id] = r);
    MODS.forEach(t => { MODTYPE[t.type] = t; t.codes.forEach(c => MODCODE[t.type + ':' + c.code] = c); });
    MODX = await mx;
    if (MODX && Array.isArray(MODX.codes)) { MODX.types.forEach(t => MODXT[t.t] = t); MODX.codes.forEach(o => { if (!MODXBY[o.c] || o.k === 'E') MODXBY[o.c] = o; }); } else MODX = null;
    ICD.forEach(i => ICDBY[i.code] = i);
    BULL.forEach(b => BULLBY[b.num] = b);
    initSkill();
    footer();
    codeIndex = new MBSearch.Index(CODES.map(c => ({ id: c.code, c, fields: {
      desc: c.desc, head: [c.group, c.sub].filter(Boolean).join(' ').replace(/\d{2}\.\d+\s?[A-Z]*/g, ''),
      notes: c.notes || '', chap: (c.chapter || '').replace(/^\d+\s/, '') } })), { desc: 3, head: 1.1, notes: 0.35, chap: 0.4 }, { phraseField: 'desc' });
    icdIndex = new MBSearch.Index(ICD.map(i => ({ id: i.code, i, fields: { desc: i.desc, block: i.block, excl: '' } })), { desc: 3, block: 0.6 }, { phraseField: 'desc' });
    wire();
    renderStatic();
    if (!lastQuery) renderSaved();
    route();
  }

  function skillOptions(sel) {
    if (P) { sel.innerHTML = P.meta.skills.map(s => `<option value="${esc(s.code)}">${esc(s.name)}</option>`).join(''); sel.value = skill; return; }
    const opts = ['<option value="BASE">Schedule base only</option>'].concat(
      META.skills.map(s => `<option value="${esc(s.code)}">${esc(s.code)} — ${esc(s.name)}</option>`));
    sel.innerHTML = opts.join('');
    sel.value = skill;
  }
  function initSkill() {
    const sel = $('#skill'); skillOptions(sel);
    if (!sel.value) { skill = P ? (P.meta.skills.some(s => s.code === P.meta.defaultSkill) ? P.meta.defaultSkill : (P.meta.skills[0] || {}).code || '') : 'OBGY'; sel.value = skill; }
    sel.addEventListener('change', () => setSkill(sel.value));
    const chip = $('#skillChip'); if (chip) { skillOptions(chip); chip.value = sel.value; $('#skillChipText').textContent = chipText(sel.value); chip.addEventListener('change', () => setSkill(chip.value)); }
  }
  function setSkill(v) {
    skill = v; LS.set(SKEY, v);
    $$('select.skillsel, #skill, #skillChip').forEach(s => s.value = v);
    const ct = $('#skillChipText'); if (ct) ct.textContent = chipText(v);
    $('#limitSkill').disabled = !SKILL_SECTIONS[skill];
    if (lastQuery) doSearch(lastQuery, true); else renderSaved();
    if (current) showCode(current, true);
    renderPrice(); renderIcdScope(); if (P) renderRules();
    const iq = $('#iq').value.trim(); if (iq) icdSearch(iq);
  }

  function footer() {
    const eff = fmtDate(META.sombEffective);
    const newest = BULL.slice().sort((a, b) => b.num - a.num)[0];
    $('#dataline').innerHTML = `Data: SOMB effective ${esc(eff)}, source <a href="${esc(META.albertaCa)}" target="_blank" rel="noopener noreferrer">alberta.ca</a>` +
      ` · <a href="${esc(META.sombDataset)}" target="_blank" rel="noopener noreferrer">SOMB files</a>` +
      ` · ICD-9 supplement as of ${esc(META.icd9.asOf)}` + (newest ? ` · Bulletins to MED ${newest.num} (${esc(newest.date)})` : '') +
      ` · ${META.counts.codes.toLocaleString()} fee codes`;
    renderSourceNote();
  }

  // ------------------------------------------------------------ routing (hash holds only codes, never typed text)
  // Suite parity v1: one bottom tab bar (Favourites · Procedures · Codes · Settings); the ten reference tabs sit under Codes
  const CODE_TABS = ['price', 'rules', 'modifiers', 'explanatory', 'icd9', 'bulletins', 'notes', 'resources'];
  const barKey = n => n === 'favmanage' ? 'fav' : CODE_TABS.includes(n) ? 'codes' : n;
  function codesSub() {   // the Codes sub-tab last used (one that this province has), else the first one shown
    const cp = $('#codesPick'), s = LS.get('codesub', ''), vis = b => !!b && getComputedStyle(b).display !== 'none';
    if (CODE_TABS.includes(s) && (!cp || vis($(`button[data-tab="${s}"]`, cp)))) return s;
    const f = cp ? $$('button', cp).find(vis) : null; return f ? f.dataset.tab : 'resources';
  }
  function showTab(name) {
    if (name === 'codes') name = codesSub();
    const fv = name === 'fav', real = fv ? 'procedures' : name, bk = fv ? 'fav' : barKey(name);
    document.documentElement.classList.toggle('favview', fv);
    $$('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + real));
    $$('#tabs button').forEach(b => { const on = b.dataset.tab === bk; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    const cp = $('#codesPick'); if (cp) { cp.hidden = bk !== 'codes'; $$('button', cp).forEach(b => { const on = b.dataset.tab === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }); }
    if (CODE_TABS.includes(name)) LS.set('codesub', name);
  }
  // Favourites tab: the saved list on its own (search hidden); Logs hands favourites actions over as #/fav/<act>/<key>
  function openFavTab() {
    current = null; lastQuery = '';
    const q = $('#q'); q.value = ''; $('#qclear').hidden = true; $('#results')._ctx = null; doSearch('');
    const d = $('#detail'); d.hidden = true; d.innerHTML = ''; $('.split').classList.remove('showing');
    showTab('fav');
  }
  function favAction(act, key) {
    const sel = { menu: k => `#results [data-favmenu="${CSS.escape(k)}"]`, link: k => `#results [data-favlink="${CSS.escape(k)}"]`, unstar: k => `#results .hit[data-fk="${CSS.escape(k)}"] .star[data-fav]`,
      newgroup: () => '#favNewGrp', import: () => '#impSaved', export: () => '#expSaved' }[act];
    history.replaceState(null, '', '#/fav');
    if (!sel) return;
    setTimeout(() => { const el = $(sel(key || '')); if (el) el.click(); else if (key) toast('That favourite is not in this list.'); }, 30);
  }
  function closeMore() { const m = $('#moreMenu'); if (m) { m.hidden = true; $('#moreBtn').setAttribute('aria-expanded', 'false'); } }
  function route() {
    const h = decodeURIComponent(location.hash.slice(2));
    const [kind, arg] = [h.split('/')[0], h.split('/').slice(1).join('/')];
    if (kind === 'fav') { openFavTab(); if (arg) { const [act, ...k] = arg.split('/'); favAction(act, k.join('/')); } }
    else if (kind === 'codes' || kind === 'settings') showTab(kind);
    else if (kind === 'code' && BYCODE[arg]) { showTab('procedures'); showCode(arg); }
    else if (kind === 'rules') { showTab('rules'); if (arg) setTimeout(() => { const el = document.getElementById('gr-' + arg); if (el) el.scrollIntoView({ block: 'start' }); }, 30); }
    else if (kind === 'medres' && ICDBY[arg]) { showMedRes(arg); }
    else if (kind === 'modifiers' && arg && JUR === 'AB') { showTab('modifiers'); $('#mf').value = arg; renderMods(); }
    else if (kind && $('#tab-' + kind)) showTab(kind);
    else showTab('procedures');
  }
  window.addEventListener('hashchange', route);
  // Home: Procedures tab, search cleared, code detail closed, scrolled to top. Fee skill is kept.
  function goHome() {
    current = null; lastQuery = '';
    const q = $('#q'); q.value = ''; $('#qclear').hidden = true; q.blur();
    $('#results')._ctx = null; doSearch('');
    const d = $('#detail'); d.hidden = true; d.innerHTML = ''; d.scrollTop = 0; $('.split').classList.remove('showing'); closeMore();
    $$('dialog[open]').forEach(x => x.close());
    showTab('procedures');
    if (location.hash) history.pushState(null, '', location.pathname + location.search);
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------ query understanding (local only)
  const PERIOD_CODES = {
    EV: ['EV', 'TEV', 'HAEV', 'OFEV', 'BNEV'], NTPM: ['NTPM', 'TNTP', 'HANTPM', 'OFNTPM', 'BNNTPM'],
    NTAM: ['NTAM', 'TNTA', 'HANTAM', 'OFNTAM', 'BNNTAM'], WK: ['WK', 'TWK', 'TST', 'TDES', 'HAEVWK', 'OFEVWK', 'BNEVWK']
  };
  const PERIOD_LABEL = { EV: 'weekday evening 1700-2200', NTPM: 'night 2200-2400', NTAM: 'night 0000-0700', WK: 'weekend/stat holiday 0700-2200' };
  const CALLBACK = { DAY: '03.05N', EV: '03.05P', NTPM: '03.05QA', NTAM: '03.05QB', WK: '03.05R' };
  function parseContext(q) {
    const s = q.toLowerCase(); const ctx = { periods: [], minutes: null };
    const weekend = /\b(weekend|saturday|sunday|sat|sun|stat|holiday)\b/.test(s);
    let hour = null;
    let m = s.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/);
    if (m) { hour = parseInt(m[1], 10) % 12 + (m[3][0] === 'p' ? 12 : 0); }
    else if ((m = s.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)) || (m = s.match(/\b([01]\d|2[0-3])([0-5]\d)\s*(h|hrs|hours)?\b(?!\s*(min|minutes))/))) {
      if (!/(\d+)\s*(min|minutes|mins)/.test(s) || m[0].includes(':')) hour = parseInt(m[1], 10);
    }
    if (/\bmidnight\b/.test(s)) hour = 0;
    if (hour != null) {
      if (hour >= 22) ctx.periods.push('NTPM'); else if (hour < 7) ctx.periods.push('NTAM');
      else if (weekend) ctx.periods.push('WK'); else if (hour >= 17) ctx.periods.push('EV'); else ctx.periods.push('DAY');
      ctx.hour = hour;
    } else {
      if (/\bevening\b/.test(s)) ctx.periods.push(weekend ? 'WK' : 'EV');
      if (/\b(night|overnight)\b/.test(s)) ctx.periods.push('NTPM', 'NTAM');
      if (weekend && !ctx.periods.length) ctx.periods.push('WK');
    }
    if ((m = s.match(/(\d+)\s*(?:\+\s*)?(min|mins|minutes)\b/))) ctx.minutes = parseInt(m[1], 10);
    else if (/\bhalf (an )?hour\b/.test(s)) ctx.minutes = 30;
    else if ((m = s.match(/(\d+)\s*(h|hr|hrs|hour|hours)\b/))) ctx.minutes = parseInt(m[1], 10) * 60;
    ctx.over = /(\bover\b|more than|exceed|longer than|>)/.test(s);
    if (ctx.over && ctx.minutes) ctx.minutes += 1;
    ctx.hospital = /\b(hospital|inpatient|ward|admitted|l&d|labour|labor|delivery suite)\b/.test(s);
    ctx.callback = /\b(call ?back|called in|callback)\b/.test(s);
    return ctx;
  }
  function stripContext(q) {
    return q.replace(/\b\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)/gi, ' ').replace(/\b([01]?\d|2[0-3]):[0-5]\d\b/g, ' ')
      .replace(/\b(over|more than|longer than|exceeding|>)?\s*\d+\s*(min|mins|minutes|h|hr|hrs|hours?)\b/gi, ' ').replace(/\bhalf (an )?hour\b/gi, ' ')
      .replace(/\bat\b/gi, ' ').replace(/\b(weekday|weekend|saturday|sunday|tonight|midnight|overnight|evening|night)\b/gi, ' ');
  }

  // ------------------------------------------------------------ procedure search
  function doSearch(q, keepSel) {
    lastQuery = q;
    const box = $('#results');
    q = q.trim();
    if (!q) { renderSaved(); $('#timehint').textContent = ''; return; }
    const ctx = parseContext(q);
    const limit = $('#limitSkill').checked && !!SKILL_SECTIONS[skill];
    let hits;
    const cq = q.toUpperCase().replace(/\s+/g, '');
    if (P ? P.codeRe.test(cq) : /^\d{2}\.\d{0,2}[A-Z]{0,3}$/.test(cq)) {
      hits = CODES.filter(c => c.code.startsWith(cq)).slice(0, 10).map(c => ({ score: c.code === cq ? 100 : 50, doc: { c } }));
    } else {
      const res = codeIndex.search(stripContext(q), { limit: 10,
        filter: limit ? d => codeInSkill(d.c) : null,
        boost: d => (d.c.skill && d.c.skill[skill] ? 1.35 : 1) * (codeInSkill(d.c) ? 1.1 : 1) * (d.c.desc ? 1 : 0.5) * offSkillPenalty(d.c) });
      hits = res.hits;
    }
    const hint = [];
    if (ctx.periods.length) hint.push('Time: ' + ctx.periods.map(p => p === 'DAY' ? 'weekday daytime (no after-hours premium)' : PERIOD_LABEL[p]).join(', '));
    if (ctx.minutes) hint.push(`Duration: ${ctx.over ? 'over ' + (ctx.minutes - 1) : ctx.minutes} min`);
    $('#timehint').textContent = hint.join(' · ');
    if (!hits.length) { box.innerHTML = P ? `<p class="muted pad">No matching ${esc(P.meta.codeLabel.toLowerCase())} codes in the ${esc(P.meta.name)} schedule. Try other wording or a code.</p>` : '<p class="muted pad">No matching health service codes. Try other wording or a fee code.</p>'; return; }
    const top = hits[0].score || 1;
    box.innerHTML = hits.map((h, i) => {
      const c = h.doc.c, f = feeFor(c);
      return `<button class="hit${current === c.code ? ' sel' : ''}" data-code="${esc(c.code)}" aria-label="${esc((c.display || c.code) + ' ' + c.desc + ', ' + (f.amount == null ? f.label : money(f.amount)))}">
        <div class="row1"><span class="lft"><span class="code">${esc(c.display || c.code)}</span><span class="hshort" title="${esc(c.desc)}">${esc(shortOf('H', c.code, c.desc))}</span>${star(hk(c.code))}</span><span class="fee">${f.amount == null ? esc(f.label) : money(f.amount)}</span>${pickDet()}${P ? '' : pselBtn('H', c.code)}</div>
        <div class="hdesc" aria-hidden="true">${esc(c.desc)}</div>
        <div class="score">#${i + 1} · score ${h.score.toFixed(2)} (${Math.round(100 * h.score / top)}%) · ${esc(f.label)}${c.cat ? ' · cat ' + esc(c.cat) : ''}
        ${c.bulletins && c.bulletins.some(b => !b.superseded) ? ' · <span class="badge b">MED ' + c.bulletins[0].num + '</span>' : ''}</div></button>`;
    }).join('');
    if (ctx.minutes > 30 && /consult/i.test(q) && BYCODE['03.08M'] && !hits.some(h => h.doc.c.code === '03.08M') && (skill === 'OBGY' || skill === 'BASE')) {
      const x = BYCODE['03.08M'];
      box.insertAdjacentHTML('beforeend', `<button class="hit" data-code="03.08M"><div class="row1"><span class="lft"><span class="code">03.08M</span>${star('H:03.08M')}</span><span class="fee">${money(feeFor(x).amount)}</span></div><div>${esc(x.desc)}</div><div class="score">Time add-on (rule-based, not scored): HSC note — claimable with 03.08A/AZ/B/BZ when the consultation exceeds 30 minutes</div></button>`);
    }
    box._ctx = ctx;
    if (!keepSel && window.matchMedia('(min-width:900px)').matches) showCode(hits[0].doc.c.code, true);
  }

  // ------------------------------------------------------------ favourites / recent view (home screen when the search is empty)
  // Saved codes from a jurisdiction whose data is not served (permission pending) are never shown; one line per jurisdiction says so.
  const heldJur = id => { if (id === 'AB') return false; const j = JREG.find(x => x.id === id); return !j || j.status !== 'live'; };
  function heldSavedRows(list) {
    const by = {}; let gone = 0; list.forEach(k => { const id = splitKey(k).jur; if (REMOVED_JUR.test(id)) gone++; else if (heldJur(id)) by[id] = (by[id] || 0) + 1; });
    // privacy-link-b5 (Eng CEO): removed provinces are reported by ONE notice for the whole saved view (removedNotice), never per group
    return Object.keys(by).map(id => { const j = JREG.find(x => x.id === id), n = by[id];
      return `<div class="hit compact heldsaved"><span class="cdesc">${esc(j ? jn(j) : id)}: ${n} saved code${n > 1 ? 's' : ''} hidden.</span><button type="button" class="linkbtn" data-dropheld="${esc(id)}">Remove</button></div>`; }).join('');
  }
  // v42 shared row formatter (js/shared/rowfmt.js, loaded as an ES module by js/shared/boot.js): code · short label · price · [ICD-9]
  const RF = () => window.MBRowFmt;
  const shortOf = (t, code, desc) => { const f = RF(); return f ? f.shortLabel(t, code, desc) : (desc || ''); };
  document.addEventListener('mbrowfmt', () => { try { if (typeof refreshSaved === 'function') refreshSaved(); } catch (e) {} });
  // S1 merge (display only, Jose OK 2026-10-22): an ICD-saved favourite that leads with fee code H, when H is itself a favourite in
  // the same list and is linked back to that ICD-9 only (see dup below), would show the very same row twice. Show only the fee-saved row; stored
  // favourites are untouched. Removal choice: REMOVE BOTH. Un-starring the merged row (its star, or "Remove from favourites" in
  // its ⋯ menu) removes the fee-saved and the merged ICD-saved favourite together, so the row goes in one tap and the hidden
  // duplicate never reappears. A star elsewhere (search card, code page) still toggles only its own code.
  const leadOf = key => { const sk = splitKey(key); return key[0] === 'I' && sk.jur === JUR && !heldJur(sk.jur) && ICDBY[sk.code] ? linksOf(key).find(k => k[0] === 'H' && sameJur(k, key) && BYCODE[splitKey(k).code]) || null : null; };
  function mergeKeys(keys) {   // -> {keys: shown keys, merged: {feeKey: [ICD-saved keys shown inside it]}}
    const merged = {}, set = new Set(keys);
    // duplicate-looking = same fee + same ICD-9 and nothing else on either row: the ICD-9's only fee link is H, H's only ICD-9 link
    // is that ICD-9, and the ICD-9 has no linked modifiers of its own (those would be lost from view)
    const dup = (k, l) => set.has(l) && linksOf(k).filter(x => x[0] === 'H').length === 1 && JSON.stringify(linksOf(l).filter(x => x[0] === 'I')) === JSON.stringify([k]) && !modLinksShown(k).length;
    const shown = keys.filter(k => { const l = leadOf(k); if (l && dup(k, l)) { (merged[l] = merged[l] || []).push(k); return false; } return true; });
    return { keys: shown, merged };
  }
  let MERGED = {};
  function savedRow(key, gid, fav) {   // one compact line: bold code, description truncated with an ellipsis, [linked codes], fee/badge, star (+ ⋯ in Favourites)
    const sk = splitKey(key), code = sk.code;
    if (heldJur(sk.jur)) return '';
    fav = fav || !!gid;
    const menu = fav ? `<span class="rowmenu" role="button" tabindex="0" data-favmenu="${esc(key)}" data-g="${esc(gid || '')}" aria-label="Links, groups and options for ${esc(code)}" title="Linked codes, groups and options">⋯</span>` : '';
    // code first: an ICD-9 favourite with a linked fee code leads with that fee code; the ICD-9 becomes the chip (display only)
    const lead = fav && key[0] === 'I' && sk.jur === JUR ? linksOf(key).find(k => k[0] === 'H' && sameJur(k, key) && BYCODE[splitKey(k).code]) : null;
    const lk = fav ? (lead ? linkChips(key, [key].concat(linksOf(key).filter(k => k !== lead && k[0] === 'H')).concat(modLinksShown(key))) : linkChips(key)) : '';
    const icdKeys = fav ? (lead ? [key] : linksOf(key)).filter(k => k[0] === 'I') : [];
    const icdT = icdKeys.length ? ' · ICD-9 ' + icdKeys.map(k => splitKey(k).code + ' ' + shortDesc(k, false)).join('; ') : '';   // S2/(c): ICD-9 full text in title + aria
    const FR = window.MBFav;
    const line = (attrs, cls, cd, desc, right, title, t) => FR ? FR.rowShell({ key, cls, attrs, merged: fav && MERGED[key] ? MERGED[key].join(' ') : '', cd, title, desc, icdT, label: t ? shortOf(t, cd, desc) : desc, short: !!t, right, lk, codefirst: !!lead,
      tail: (!P && sk.jur === JUR && sk.jur === 'AB' ? pselBtn(sk.t, code) : '') + star(key) + (sk.t === 'H' && sk.jur === JUR ? pickDet() : '') + menu }) : `<button class="hit compact${cls}${lk ? ' haslinks' : ''}${lead ? ' codefirst' : ''}" ${attrs} data-fk="${esc(key)}"${fav && MERGED[key] ? ` data-merged="${esc(MERGED[key].join(' '))}"` : ''}${title ? ` title="${esc(cd + ' ' + title + icdT)}"` : ''} aria-label="${esc(cd + ' ' + (title || desc) + icdT)}"><span class="ccode code">${esc(cd)}</span><span class="cdesc${t ? ' short' : ''}">${esc(t ? shortOf(t, cd, desc) : desc)}</span>${right}${lk}${!P && sk.jur === JUR && sk.jur === 'AB' ? pselBtn(sk.t, code) : ''}${star(key)}${sk.t === 'H' && sk.jur === JUR ? pickDet() : ''}${menu}</button>`;
    if (sk.jur !== JUR) {
      const j = JREG.find(x => x.id === sk.jur), nm = j ? jn(j) : sk.jur;
      return line(`data-jur="${esc(sk.jur)}" data-${sk.t === 'H' ? 'code' : 'icd'}="${esc(code)}"`, ' other', code, `${sk.t === 'H' ? 'Fee code' : 'Diagnostic code'} saved under ${nm}. Tap to switch to ${nm}.`, `<span class="badge j">${esc(nm)}</span>`, 'Opens ' + nm);
    }
    if (key[0] === 'H') {
      const c = BYCODE[code]; if (!c) return '';
      const f = feeFor(c);
      return line(`data-code="${esc(c.code)}"`, current === c.code ? ' sel' : '', c.display || c.code, c.desc, `<span class="fee">${f.amount == null ? esc(f.label) : money(f.amount)}</span>`, c.desc, 'H');
    }
    if (lead) { const c = BYCODE[splitKey(lead).code], f = feeFor(c);
      // S1 (Jose OK 2026-10-22): an ICD-saved favourite led by its fee code opens / sends that fee code; in a Dx pick it sends the ICD-9
      return line(`data-icd="${esc(code)}" data-code="${esc(c.code)}" data-lead="1"`, '', c.display || c.code, c.desc, `<span class="fee">${f.amount == null ? esc(f.label) : money(f.amount)}</span>`, c.desc, 'H'); }
    const i = ICDBY[code]; if (!i) return '';
    return line(`data-icd="${esc(i.code)}"`, '', i.code, icdLabel(i), '<span class="small muted">ICD-9</span>', icdLabel(i), 'I');
  }
  // text a favourite is matched on by the Favourites filter: code + description (current jurisdiction) + group names
  function favText(key) {
    const sk = splitKey(key); let t = sk.code;
    if (sk.jur === JUR) { if (sk.t === 'H' && BYCODE[sk.code]) t += ' ' + BYCODE[sk.code].desc; else if (sk.t === 'I' && ICDBY[sk.code]) t += ' ' + icdLabel(ICDBY[sk.code]); }
    else { const j = JREG.find(x => x.id === sk.jur); if (j) t += ' ' + j.name; }
    linksOf(key).concat(modsOf(key)).forEach(k => { t += ' ' + splitKey(k).code; });
    return t.toLowerCase();
  }
  let favFilter = '';
  const ICONS = {
    specialty: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 1.5h4v4.5h4.5v4H10v4.5H6V10H1.5V6H6z"/></svg>',
    doctor: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="4.6" r="3.1"/><path d="M1.8 15c.3-3.6 2.9-5.6 6.2-5.6s5.9 2 6.2 5.6z"/></svg>',
    custom: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3h4.8l1.6 1.8h6.6V14h-13z"/></svg>',
    ungrouped: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3h4.8l1.6 1.8h6.6V14h-13zM3 6.3V12.5h10V6.3z" fill-rule="evenodd"/></svg>' };
  const typeTag = t => `<span class="fgtype t-${t}">${ICONS[t]}<span>${GTYPES[t]}</span></span>`;
  // ---- Linked favourites UI (v35)
  const partnerWord = (key, plural) => (key[0] === 'H' ? (splitKey(key).jur === 'AB' ? 'ICD-9 code' : P && P.meta.dx ? P.meta.dx.system + ' code' : 'diagnostic code') : 'fee code') + (plural ? 's' : '');
  const partnerShort = key => key[0] === 'H' ? (splitKey(key).jur === 'AB' ? 'ICD-9' : P && P.meta.dx ? P.meta.dx.system : 'Dx') : 'fee codes';
  // a code can be linked when it is from the jurisdiction on screen and that jurisdiction has the other kind of code to pick from
  const canLink = key => { const sk = splitKey(key); if (sk.jur !== JUR || heldJur(sk.jur)) return false; return sk.t === 'H' ? !!BYCODE[sk.code] && !!(ICD && ICD.length) : !!ICDBY[sk.code] && !!(CODES && CODES.length); };
  // v36: explicit AHCIP modifiers can be linked to an Alberta favourite (fee or ICD-9 code) once the official list has loaded
  const canModLink = key => { const sk = splitKey(key); return JUR === 'AB' && !!MODX && /^[HI]:[^|]+$/.test(key) && (sk.t === 'H' ? !!BYCODE[sk.code] : !!ICDBY[sk.code]); };
  const modLinksShown = key => JUR === 'AB' && MODX ? modsOf(key).filter(m => modOk(m.slice(2))) : [];
  function shortDesc(key, chip) {   // chip: the code's own title (e.g. "Mild or unspecified pre-eclampsia") unless that alone says too little
    const sk = splitKey(key); if (sk.t === 'M') { const m = MODXBY[sk.code]; return m ? modNice(m.n) : ''; }
    if (sk.jur !== JUR) return '';
    if (sk.t === 'H') { const c = BYCODE[sk.code]; return c ? (chip ? shortOf('H', c.code, c.desc) : c.desc) : ''; }
    const i = ICDBY[sk.code]; if (!i) return '';
    if (chip) return shortOf('I', i.code, i.desc);
    return chip && i.desc && i.desc.length >= 12 && !/^(unspecified|other|not otherwise)/i.test(i.desc) ? i.desc : icdLabel(i);
  }
  const pickPrice = k => { const sk = splitKey(k), c = sk.t === 'H' && sk.jur === JUR ? BYCODE[sk.code] : null; if (!c) return ''; const f = feeFor(c); return `<span class="fee lkp">${f.amount == null ? esc(f.label) : money(f.amount)}</span>`; };   // prices in pickers (fee codes only)
  const linkCodeTxt = k => { const sk = splitKey(k); return sk.t === 'H' && sk.jur === JUR && BYCODE[sk.code] ? (BYCODE[sk.code].display || sk.code) : sk.code; };
  // compact chips beside a favourite: code + short description of each linked code (tap: open it; in pick mode: send it)
  function linkChips(key, list) {
    const ls = list || linksOf(key).filter(k => !heldJur(splitKey(k).jur)).concat(modLinksShown(key)); if (!ls.length) return '';
    const kind0 = key[0] === 'H' ? partnerShort(key) : 'fee code';
    const FR = window.MBFav;
    const chips = ls.map(k => { const d = shortDesc(k, true), c = linkCodeTxt(k), kind = k[0] === 'M' ? 'modifier' : k[0] === 'I' ? 'ICD-9' : kind0;
      if (FR) return FR.chipHtml(k, c, d, kind);
      return `<span class="lchip k-${k[0]}" role="button" tabindex="0" data-lk="${esc(k)}" title="${esc((k[0] === 'M' ? 'Modifier ' : '') + c + (d ? ' ' + d : ''))}" aria-label="Linked ${esc(kind)} ${esc(c)}${d ? ', ' + esc(d) : ''}"><span class="code">${esc(c)}</span>${d ? `<span class="ld">${esc(d)}</span>` : ''}</span>`; }).join('');
    if (FR) return FR.lnksHtml(chips, canLink(key) || canModLink(key) ? FR.editChipHtml(key, splitKey(key).code) : '');
    const edit = canLink(key) || canModLink(key) ? `<span class="lchip ledit" role="button" tabindex="0" data-favlink="${esc(key)}" aria-label="Edit linked codes for ${esc(splitKey(key).code)}" title="Edit linked codes">✎</span>` : '';
    return `<span class="lnks" aria-label="Linked codes"><span class="lnkic" aria-hidden="true">↔</span>${chips}${edit}</span>`;
  }
  // a small bar with one action (e.g. after starring: "Link ICD-9"); it never blocks the page and goes away by itself
  let snackT;
  function snack(text, label, fn) {
    let el = $('#snack'); if (!el) { el = document.createElement('div'); el.id = 'snack'; el.className = 'snack'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.innerHTML = `<span class="snt">${esc(text)}</span><button type="button" class="snb">${esc(label)}</button><button type="button" class="snx" aria-label="Dismiss">×</button>`;
    el.hidden = false; const tt0 = $('#toast'); if (tt0) tt0.hidden = true;
    const hide = () => { el.hidden = true; clearTimeout(snackT); };
    $('.snb', el).onclick = () => { hide(); fn(); }; $('.snx', el).onclick = hide;
    clearTimeout(snackT); snackT = setTimeout(hide, 8000);
  }
  // Search one kind of code by code or words (used by the link picker and, v38, by "Add codes" in a group): t = 'H' fee codes,
  // 'I' ICD-9 / diagnostic codes, 'M' explicit AHCIP modifiers. Returns keys (hk / ik / 'M:CODE'), at most 15.
  function searchCodes(t, v) {
    if (t === 'M') return MODX ? modSearch(v, 'E').slice(0, 15).map(x => 'M:' + x.c) : [];
    const cq = v.toUpperCase().replace(/\s+/g, '');
    if (t === 'I') {
      if (!ICD || !ICD.length) return [];
      let cq2 = cq; if (P && /^([V\d]\d{2}|E\d{3})\d{1,2}$/.test(cq2)) cq2 = cq2.replace(/^(E\d{3}|[V\d]\d{2})/, '$1.');
      const rows = /^(V\d{0,2}|\d{1,3}|E\d{0,3})(\.\d{0,2})?$/.test(cq2) ? ICD.filter(i => i.code.startsWith(cq2)).slice(0, 15).map(i => i.code)
        : icdIndex.search(v, { limit: 15, boost: d => d.i.code.includes('.') ? 1.05 : 1 }).hits.map(h => h.doc.i.code);
      return rows.map(ik);
    }
    const rows = (P ? P.codeRe.test(cq) : /^\d{2}\.\d{0,2}[A-Z]{0,3}$/.test(cq)) ? CODES.filter(x => x.code.startsWith(cq)).slice(0, 15).map(x => x.code)
      : codeIndex.search(stripContext(v), { limit: 15, boost: d => (d.c.skill && d.c.skill[skill] ? 1.35 : 1) * (codeInSkill(d.c) ? 1.1 : 1) * (d.c.desc ? 1 : 0.5) }).hits.map(h => h.doc.c.code);
    return rows.map(hk);
  }
  // Link picker: the codes linked to one favourite (remove any), plus a search of the other kind of code (tap to link / unlink).
  // v36 (Alberta): a second tab links explicit AHCIP modifiers to the same favourite, up to 3.
  function linkSheet(key, o) {
    o = o || {}; const canC = canLink(key), canM = canModLink(key); if (!canC && !canM) return;
    const sk = splitKey(key), isH = sk.t === 'H', code = linkCodeTxt(key), word = partnerWord(key, true), short = partnerShort(key);
    const c = isH ? BYCODE[sk.code] : null;
    let q = '', mode = o.mode === 'mod' && canM ? 'mod' : canC ? 'code' : 'mod';
    const seg = canC && canM ? `<div class="lkseg" role="tablist" aria-label="What to link">
        <button type="button" role="tab" data-lkmode="code">${isH ? esc(short) : 'Fee codes'} <span class="lksn" data-n="code"></span></button>
        <button type="button" role="tab" data-lkmode="mod">Modifiers <span class="lksn" data-n="mod"></span></button></div>` : '';
    const body = codeLabel(key) +
      `<p class="small muted fgnote" id="lkNote"></p>${seg}
      <p class="fgsub">Linked <span class="lkn" id="lkN"></span></p><div class="lkcur" id="lkCur"></div>
      <p class="fgerr" id="lkErr" role="alert" hidden></p>
      <div class="inputwrap fgq"><input id="lkQ" type="search" enterkeyhint="search" autocapitalize="off" spellcheck="false"></div>
      <p class="fgsub" id="lkResH"></p><div class="fgopts lkres" id="lkRes" role="group" aria-labelledby="lkResH"></div>
      <div class="fgacts">${o.fresh ? '<button type="button" class="ghost" data-close>Skip</button>' : ''}<button type="button" class="primary" data-lkdone>Done</button></div>`;
    const title = (o.fresh ? '★ ' : '') + `Link ${canC ? (isH ? esc(short) : 'fee codes') + (canM ? ' and modifiers' : '') : 'modifiers'} to ${esc(code)}`;
    openSheet('fgLinkSheet', title, body, el => {
      const err = $('#lkErr', el), inp = $('#lkQ', el);
      const suggestions = () => {
        if (mode === 'mod') {   // explicit modifiers the price list lists for this fee code; for a diagnosis, those of its linked fee codes
          const hs = isH ? [sk.code] : linksOf(key).map(k => splitKey(k).code);
          const seen = new Set(); hs.forEach(h => ((BYCODE[h] || {}).mods || []).forEach(m => { if (m[2] && modOk(m[1])) seen.add(m[1]); }));
          hs.forEach(h => modsOf(isH ? key : hk(h)).forEach(m => seen.add(m.slice(2))));
          return [...seen].slice(0, 12).map(x => 'M:' + x);
        }
        const mine = FAVS.filter(k => k[0] === (isH ? 'I' : 'H') && splitKey(k).jur === JUR);
        let more = [];
        if (isH && c) { try { more = suggestIcd(c).rows.map(r => ik(r.i.code)); } catch (e) { more = []; } }
        if (!isH) more = RECENT.filter(k => k[0] === 'H' && splitKey(k).jur === JUR);
        return [...new Set(mine.concat(more))].filter(k => isH ? ICDBY[splitKey(k).code] : BYCODE[splitKey(k).code]).slice(0, 12);
      };
      const search = v => searchCodes(mode === 'mod' ? 'M' : isH ? 'I' : 'H', v);
      const linked = (k) => k[0] === 'M' ? isModLinked(key, k) : isLinked(key, k);
      const paint = () => {
        const curC = canC ? linksOf(key) : [], curM = canM ? modsOf(key).filter(m => modOk(m.slice(2))) : [], cur = mode === 'mod' ? curM : curC, full = cur.length >= LMAX;
        $('#lkNote', el).textContent = mode === 'mod' ? `Pick the explicit AHCIP modifiers you usually claim with this ${isH ? 'fee code' : 'diagnosis'}, up to ${LMAX} (official SOMB modifier list).`
          : (isH ? `Pick the ${word} you usually bill with this fee code, up to ${LMAX}.` : `Pick the fee codes you usually bill with this diagnosis, up to ${LMAX}.`) + ' Links are optional, show side by side in Favourites and appear on both codes.';
        $('#lkN', el).textContent = (canC ? `${isH ? short : 'fee codes'} ${curC.length} of ${LMAX}` : '') + (canC && canM ? ' · ' : '') + (canM ? `modifiers ${curM.length} of ${LMAX}` : '');
        $$('[data-lkmode]', el).forEach(b => { const on = b.dataset.lkmode === mode; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
        $$('.lksn', el).forEach(n => { n.textContent = `${n.dataset.n === 'mod' ? curM.length : curC.length}/${LMAX}`; });
        inp.placeholder = mode === 'mod' ? 'Search modifiers by code or words (e.g. CMGP, evening)' : isH ? `Search ${short} by code or words` : 'Search fee codes by code or words';
        inp.setAttribute('aria-label', mode === 'mod' ? 'Search modifiers' : isH ? `Search ${short} codes` : 'Search fee codes');
        const allCur = curC.concat(curM);
        $('#lkCur', el).innerHTML = allCur.length ? allCur.map(k => { const d = shortDesc(k, true), cd = linkCodeTxt(k);
          return `<div class="lkrow k-${k[0]}" title="${esc(cd + ' ' + shortDesc(k))}"><span class="code">${esc(cd)}</span><span class="lkd">${k[0] === 'M' ? '<span class="lkm">Modifier</span> ' : ''}${esc(d)}</span>${pickPrice(k)}<button type="button" class="ghost lkrm" data-unlink="${esc(k)}" aria-label="Remove link to ${esc(cd)}">Remove</button></div>`; }).join('')
          : `<p class="muted small lknone">Nothing linked yet${o.fresh ? ' (you can skip this)' : ''}.</p>`;
        const list = q ? search(q) : suggestions();
        $('#lkResH', el).textContent = q ? (list.length ? 'Results' : '') : (list.length ? (mode === 'mod' ? (isH ? 'Explicit modifiers listed for this fee code' : 'Modifiers of its linked fee codes') : isH ? `Your ${short} favourites and suggestions` : 'Your fee code favourites and recent codes') : '');
        $('#lkRes', el).innerHTML = list.length ? list.map(k => { const on = linked(k), d = shortDesc(k, true), cd = linkCodeTxt(k);
          return `<button type="button" class="lkopt${!on && full ? ' full' : ''}" data-link="${esc(k)}" aria-pressed="${on}" title="${esc(cd + ' ' + shortDesc(k))}"><span class="code">${esc(cd)}</span><span class="lkd">${esc(d)}</span>${pickPrice(k)}<span class="lkst">${on ? '✓ Linked' : '+ Link'}</span></button>`; }).join('')
          : `<p class="muted small lknone">${q ? `No matching ${mode === 'mod' ? 'explicit modifiers' : esc(isH ? word : 'fee codes')}.` : mode === 'mod' ? 'Type a modifier code or a few words above (e.g. CMGP, complex, evening, telehealth).' : `Type a ${isH ? esc(partnerWord(key)) : 'fee code'} or a few words above.`}</p>`;
        $('#lkRes', el).classList.toggle('empty', !list.length);
      };
      const changed = () => { saveLinks(); refreshSaved(); paint(); };
      const showErr = m => { err.textContent = m; err.hidden = !m; };
      paint();
      inp.addEventListener('input', () => { q = inp.value.trim(); paint(); });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
      el.addEventListener('click', e => {
        const md = e.target.closest('[data-lkmode]');
        if (md) { mode = md.dataset.lkmode; q = ''; inp.value = ''; showErr(''); paint(); return; }
        const rm = e.target.closest('[data-unlink]');
        if (rm) { const k = rm.dataset.unlink; if (k[0] === 'M') removeModLink(key, k); else removeLink(key, k); showErr(''); changed(); toast(`Link removed: ${code} ↔ ${splitKey(k).code}`); return; }
        const op = e.target.closest('[data-link]');
        if (op) { const k = op.dataset.link;
          if (linked(k)) { if (k[0] === 'M') removeModLink(key, k); else removeLink(key, k); showErr(''); changed(); toast(`Link removed: ${code} ↔ ${splitKey(k).code}`); }
          else { const m = k[0] === 'M' ? addModLink(key, k) : addLink(key, k); showErr(m); if (!m) { changed(); toast(`Linked ${code} ↔ ${k[0] === 'M' ? 'modifier ' : ''}${splitKey(k).code}`); } }
          const again = $(`#lkRes [data-link="${CSS.escape(k)}"]`, el); if (again) again.focus({ preventScroll: true });
          return; }
        if (e.target.closest('[data-lkdone]')) { closeSheet(); if (o.back) o.back(); }
      });
    });
  }
  // v38: when a group was last used, in words ("5 min ago") and as a date and time for the group sheet
  function agoTxt(iso) {
    if (!iso) return 'not used yet'; const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; const h = Math.round(m / 60); if (h < 24) return h + ' h ago';
    const d = Math.round(h / 24); return d < 7 ? d + ' d ago' : new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }
  const whenTxt = iso => iso ? new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ` (${agoTxt(iso)})` : 'not yet';
  const modsShown = () => JUR === 'AB' && !!MODX;
  const modText = m => ('modifier ' + m + ' ' + (MODXBY[m] ? MODXBY[m].n + ' ' + MODXBY[m].t : '')).toLowerCase();
  // codes of a group that can go to MedBilling Logs in one send (this jurisdiction; modifiers: explicit only)
  function groupSendable(g) {
    const of = t => g.keys.filter(k => k[0] === t && splitKey(k).jur === JUR).map(k => splitKey(k).code).filter(c => t === 'H' ? BYCODE[c] : ICDBY[c]);
    return { H: of('H'), I: of('I'), M: modsShown() ? g.mods.filter(modOk) : [] };
  }
  const nSendable = g => { const x = groupSendable(g); return x.H.length + x.I.length + x.M.length; };
  // one modifier inside a code group: code, name, "Modifier", [＋ in multi-pick], ⋯ (groups / remove)
  function savedModRow(m, gid) {
    const o = MODXBY[m]; if (!o) return '';
    return `<button class="hit compact gmod" data-gmod="${esc(m)}" data-g="${esc(gid)}" title="${esc('Modifier ' + m + ': ' + modNice(o.n))}"><span class="ccode code">${esc(m)}</span><span class="cdesc">${esc(modNice(o.n))}</span><span class="small muted">Modifier</span>${pselBtn('M', m)}<span class="gsp" aria-hidden="true"></span><span class="rowmenu" role="button" tabindex="0" data-gmodmenu="${esc(m)}" data-g="${esc(gid)}" aria-label="Groups and options for modifier ${esc(m)}" title="Groups and options">⋯</span></button>`;
  }
  function groupsHtml() {
    const q = favFilter.trim().toLowerCase(), showM = modsShown();
    const secs = orderedGroups().map(g => ({ id: g.id, name: g.name, type: g.type, keys: g.keys, mods: g.mods, g }));
    const ug = ungroupedKeys(); if (ug.length) secs.push({ id: 'ungrouped', name: 'Ungrouped', type: null, keys: ug, mods: [] });
    let shown = 0;
    const html = secs.map(g => {
      const nameHit = q && g.type && g.name.toLowerCase().includes(q);
      const keys0 = !q || nameHit ? g.keys : g.keys.filter(k => favText(k).includes(q));
      const keys = keys0.filter(k => k[0] === 'H').concat(keys0.filter(k => k[0] !== 'H'));   // v38: fee codes, then ICD-9, then modifiers
      const allM = showM ? g.mods.filter(m => MODXBY[m]) : [], mods = !q || nameHit ? allM : allM.filter(m => modText(m).includes(q));
      if (q && !keys.length && !mods.length) return '';
      shown++;
      const open = q ? true : !GS.collapsed.includes(g.id);
      const mg = mergeKeys(keys); Object.assign(MERGED, mg.merged);
      const rowList = mg.keys.map(k => savedRow(k, g.id)).filter(Boolean), held = keys.filter(k => heldJur(splitKey(k).jur)).length;
      const n = rowList.length + held + mods.length, total = q ? g.keys.filter(k => heldJur(splitKey(k).jur) || savedRow(k)).length + allM.length : n;
      const hiddenM = !showM && g.mods.length ? `<p class="muted small fgempty">${g.mods.length} Alberta modifier${g.mods.length === 1 ? '' : 's'} in this group show${g.mods.length === 1 ? 's' : ''} when Alberta is selected.</p>` : '';
      const rows = rowList.join('') + mods.map(m => savedModRow(m, g.id)).join('') + heldSavedRows(keys) + (rowList.length || held || mods.length ? hiddenM : '');
      const empty = g.type ? (hiddenM || `<p class="muted small fgempty">No codes yet. <button type="button" class="linkbtn" data-fgadd="${esc(g.id)}">Add codes</button> (fee codes, ${JUR === 'AB' ? 'ICD-9 codes and modifiers' : 'diagnostic codes'}), or tap ☆ on any code.</p>`) : '';
      const when = g.type && GS.sort === 'recent' ? `<span class="fgwhen" title="Last used">${esc(agoTxt(GS.used[g.id]))}</span>` : '';
      const send = g.type && pickMulti() && nSendable(g.g) ? `<button type="button" class="fgsend" data-fgsend="${esc(g.id)}" aria-label="Send group ${esc(g.name)} to MedBilling Logs" title="Send this group's codes to MedBilling Logs">Send</button>` : '';
      return `<section class="favgrp${g.type ? '' : ' ungrouped'}" data-gid="${esc(g.id)}"><div class="fgh">
        <button type="button" class="fgtoggle" data-fgtoggle="${esc(g.id)}" aria-expanded="${open}" aria-controls="fgb-${esc(g.id)}"${g.type ? ` title="Last used: ${esc(whenTxt(GS.used[g.id]))}"` : ''}><span class="fgchev" aria-hidden="true">${open ? '▾' : '▸'}</span><span class="fgic">${ICONS[g.type || 'ungrouped']}</span><span class="fgname">${esc(g.name)}</span>${g.type ? typeTag(g.type) : ''}${when}<span class="fgcount" aria-label="${n} code${n === 1 ? '' : 's'}">${q && n !== total ? n + '/' + total : n}</span></button>
        ${send}${g.type ? `<button type="button" class="fgmenu" data-fgmenu="${esc(g.id)}" aria-label="Options for group ${esc(g.name)}" title="Add codes, rename, reorder or delete">⋯</button>` : ''}</div>
        <div class="fgbody" id="fgb-${esc(g.id)}"${open ? '' : ' hidden'}>${rows || empty}</div></section>`;
    }).join('');
    return shown ? html : `<p class="muted small pad savedempty">No favourites match “${esc(favFilter.trim())}”.</p>`;
  }
  // privacy-link-b5 (Eng CEO): exactly one notice for codes saved for the six provinces this version doesn’t include; it lists every
  // affected group (plus ungrouped favourites and recent) with its codes, and carries the single 'Remove hidden codes' action.
  function removedNotice() {
    const m = k => REMOVED_JUR.test(splitKey(k).jur), lbl = k => { const x = splitKey(k); return esc(x.jur + ' ' + x.code); };
    const inG = new Set(); GS.groups.forEach(g => g.keys.forEach(k => inG.add(k)));
    const rows = GS.groups.map(g => [esc(g.name), g.keys.filter(m)]).concat([['Favourites', FAVS.filter(k => m(k) && !inG.has(k))], ['Recent', RECENT.filter(m)]]).filter(r => r[1].length);
    if (!rows.length) return '';
    return '<div class="hit compact heldsaved removedjur"><span class="cdesc">Some saved codes are for provinces MedBilling Fee Desk does not cover. They are hidden and not used:'
      + `<ul class="rjlist">${rows.map(r => `<li><b>${r[0]}</b>: ${r[1].map(lbl).join(', ')}</li>`).join('')}</ul></span><button type="button" class="linkbtn" data-dropremoved>Remove hidden codes</button></div>`;
  }
  function renderSaved() {
    const box = $('#results'); box._ctx = null;
    const grouped = GS.groups.length > 0;
    MERGED = {}; const mf = grouped ? null : mergeKeys(FAVS); if (mf) MERGED = mf.merged;
    const fav = grouped ? '' : mf.keys.map(k => savedRow(k, '', true)).filter(Boolean).join('') + heldSavedRows(FAVS), rec = RECENT.map(k => savedRow(k)).filter(Boolean).join('') + heldSavedRows(RECENT);
    const sk = esc(skill === 'BASE' ? 'base' : skill);
    const tools = (FAVS.length >= 2 || grouped) ? `<div class="favtools"><div class="inputwrap fgq"><input id="favq" type="search" enterkeyhint="search" autocapitalize="off" spellcheck="false" placeholder="Filter favourites" aria-label="Filter favourites" value="${esc(favFilter)}"></div>${GS.groups.length >= 2 ? `<div class="fgsort" role="radiogroup" aria-label="Sort groups"><span>Sort</span>${[['az', 'A–Z', 'Alphabetical'], ['recent', 'Recent', 'Most recently used first'], ['custom', 'My order', 'Your own order (Move up / down)']].map(([v, l, t]) => `<button type="button" role="radio" class="fgsortb" data-gsort="${v}" aria-checked="${GS.sort === v}" title="${t}">${l}</button>`).join('')}</div>` : ''}</div>` : '';
    const favBody = grouped ? `<div id="favgroups" class="favgroups">${groupsHtml()}</div>` : (fav || '<p class="muted small pad savedempty">Tap ☆ on any code to keep it here.</p>');
    const hint = !grouped && FAVS.length >= 3 ? '<p class="muted small fghint">Bill some codes together? Make a named group (e.g. C-section) with <b>+ New group</b>. Groups can also sort favourites by specialty or doctor.</p>' : '';
    const FR = window.MBFav, foot = (P ? (P.meta.skills.length ? `Fees shown for ${esc(P.meta.skillLabel.toLowerCase())} ${esc(skillName())}. ` : '') + `Codes from other provinces or territories are marked; tap one to switch.` : JUR === 'AB' ? `Fees shown for specialty ${sk}.` : '') + ' Search runs on this device only; nothing you type is sent anywhere.';
    if (FR) { box.innerHTML = FR.paneHtml({ pre: (JINFO && JINFO.status !== 'live' ? soonPanel() : '') + removedNotice(), tools: !!tools, sortHtml: tools ? tools.replace(/^<div class="favtools"><div class="inputwrap fgq">.*?<\/div>/, '').replace(/<\/div>$/, '') : '', filter: favFilter, hint: !!hint, body: favBody, rec, recentMax: RECENT_MAX, foot }); if (!grouped && favFilter) applyFlatFilter(); return; }
    box.innerHTML = (JINFO && JINFO.status !== 'live' ? soonPanel() : '') + removedNotice() + `<div class="savedh" id="savedFav"><h3>★ Favourites</h3><span class="sph"><button type="button" class="spmanage" id="favManage" aria-label="Manage favourites (table)">Manage</button><button type="button" class="fgnew" id="favNewGrp" aria-label="New favourites group">+ New group</button></span></div>${tools}${hint}${favBody}
      <div class="savedh" id="savedRecent"><h3>Recent</h3>${rec ? '<button type="button" class="linkbtn" id="clearRecent">Clear</button>' : ''}</div>${rec || '<p class="muted small pad savedempty">Codes you open appear here (last ' + RECENT_MAX + ').</p>'}
      <div class="savedtools">
        <div class="saverow"><button type="button" class="ghost" id="expSaved" title="Save favourites &amp; recent codes to a file" aria-label="Save favourites &amp; recent codes to a file" aria-describedby="expHelp">Export</button><p class="small savedhelp" id="expHelp">Export saves your favourites and recent codes to a file so you can back them up or move them to another device.</p></div>
        <div class="saverow"><button type="button" class="ghost" id="impSaved" title="Load favourites &amp; recent codes from a saved file" aria-label="Load favourites &amp; recent codes from a saved file" aria-describedby="impHelp">Import</button><p class="small savedhelp" id="impHelp">Import loads that file back in. Nothing leaves your device unless you share the file.</p></div>
      </div>
      <p class="small muted pad savednote">Saved on this device only. Add to Home Screen on iPhone to keep them safe.</p>
      <p class="muted small pad savedfoot">${P ? (P.meta.skills.length ? `Fees shown for ${esc(P.meta.skillLabel.toLowerCase())} ${esc(skillName())}. ` : '') + `Codes from other provinces or territories are marked; tap one to switch.` : JUR === 'AB' ? `Fees shown for specialty ${sk}.` : ''} Search runs on this device only; nothing you type is sent anywhere.</p>`;
    if (!grouped && favFilter) applyFlatFilter();
  }
  const refreshSaved = () => { if (!lastQuery && $('#results .savedh')) renderSaved(); };
  function applyFlatFilter() {   // no groups yet: the rows stay one list; non-matching ones are hidden
    const q = favFilter.trim().toLowerCase(); let n = 0;
    const fav = []; let el = $('#savedFav'); while ((el = el && el.nextElementSibling) && el.id !== 'savedRecent') if (el.matches('.hit[data-fk]')) fav.push(el);
    fav.forEach(r => { const m = !q || favText(r.dataset.fk).includes(q); r.hidden = !m; if (m) n++; });
    let msg = $('#favnomatch'); if (!n && q && fav.length) { if (!msg) { msg = document.createElement('p'); msg.id = 'favnomatch'; msg.className = 'muted small pad savedempty'; $('#savedRecent').before(msg); } msg.textContent = `No favourites match “${favFilter.trim()}”.`; } else if (msg) msg.remove();
  }
  function onFavFilter(v) {
    favFilter = v;
    if (GS.groups.length) { const g = $('#favgroups'); if (g) g.innerHTML = groupsHtml(); } else applyFlatFilter();
  }
  function toggleGroup(id) {
    const open = GS.collapsed.includes(id);   // was collapsed -> open it
    GS.collapsed = open ? GS.collapsed.filter(x => x !== id) : GS.collapsed.concat(id);
    if (open && groupById(id)) GS.used[id] = new Date().toISOString();   // v38: opening a group counts as using it
    saveGroups();
    const sec = $(`#results .favgrp[data-gid="${id}"]`); if (!sec || favFilter.trim()) return;
    const b = $('.fgtoggle', sec); b.setAttribute('aria-expanded', String(open)); $('.fgchev', b).textContent = open ? '▾' : '▸'; $('.fgbody', sec).hidden = !open;
  }

  // ---- Sheets (small dialogs: bottom sheet on a phone, centred card on wider screens)
  let sheetEl = null, sheetPrevFocus = null;
  document.addEventListener('keydown', e => { if (sheetEl && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSheet(); } }, true);
  function closeSheet() {
    if (!sheetEl) return; const s = sheetEl; sheetEl = null; s.remove(); document.documentElement.classList.remove('sheet-open');
    if (sheetPrevFocus && document.contains(sheetPrevFocus)) { try { sheetPrevFocus.focus({ preventScroll: true }); } catch (e) {} }
  }
  function openSheet(id, title, body, wireFn) {
    const keep = sheetEl ? sheetPrevFocus : document.activeElement; closeSheet(); sheetPrevFocus = keep;
    const back = document.createElement('div'); back.className = 'fgback'; back.id = id;
    back.innerHTML = `<div class="fgsheet" role="dialog" aria-modal="true" aria-labelledby="${id}-t"><div class="fgsh"><h3 id="${id}-t">${title}</h3><button type="button" class="fgx" data-close aria-label="Close">×</button></div><div class="fgsb">${body}</div></div>`;
    document.body.appendChild(back); sheetEl = back; document.documentElement.classList.add('sheet-open');
    back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) closeSheet(); });
    back.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const f = $$('button:not([disabled]),input:not([disabled]),select,[tabindex="0"]', back).filter(x => x.offsetParent !== null); if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
    if (wireFn) wireFn(back);
    const first = $('[autofocus]', back) || $('.fgsb button, .fgsb input', back) || $('.fgx', back);
    setTimeout(() => { try { first.focus({ preventScroll: true }); } catch (e) {} }, 30);
    return back;
  }
  function codeLabel(key) {
    const sk = splitKey(key); let d = '';
    if (sk.jur === JUR) d = sk.t === 'H' ? (BYCODE[sk.code] || {}).desc || '' : ICDBY[sk.code] ? icdLabel(ICDBY[sk.code]) : '';
    else { const j = JREG.find(x => x.id === sk.jur); d = (sk.t === 'H' ? 'Fee code' : 'Diagnostic code') + ' saved under ' + (j ? jn(j) : sk.jur); }
    return `<p class="fgcode"><span class="code">${esc(sk.code)}</span> <span class="muted">${esc(d)}</span></p>`;
  }
  const groupOpt = (g, checked) => `<label class="fgopt"><input type="checkbox" data-gid="${esc(g.id)}"${checked ? ' checked' : ''}><span class="fgic">${ICONS[g.type]}</span><span class="fgname">${esc(g.name)}</span>${typeTag(g.type)}<span class="fgcount">${gTotal(g)}</span></label>`;
  // Groups for one code: tick any number of groups (copy), untick to remove, "Move from <group> to" (move), or remove the star.
  // fresh: just starred; ticking here also becomes the default for the next star ("last used").
  function codeSheet(key, o) {
    o = o || {}; const from = o.from && o.from !== 'ungrouped' ? groupById(o.from) : null;
    const code = splitKey(key).code;
    const body = () => {
      const gs = orderedGroups(), mine = new Set(groupsOf(key).map(g => g.id));
      const lk0 = linksOf(key).filter(k => !heldJur(splitKey(k).jur)), lm = modLinksShown(key), lk = lk0.concat(lm), can = canLink(key) || canModLink(key);
      const lsec = can || lk.length ? `<div class="lksec"><p class="fgsub">Linked ${esc(partnerWord(key, true))} <span class="lkn">${lk0.length} of ${LMAX}</span>${canModLink(key) || lm.length ? ` · modifiers <span class="lkn">${lm.length} of ${LMAX}</span>` : ''}</p>
        ${lk.length ? `<div class="lkchips">${lk.map(k => `<span class="lchip k-${k[0]} static"><span class="code">${esc(linkCodeTxt(k))}</span><span class="ld">${esc(shortDesc(k, true))}</span></span>`).join('')}</div>` : `<p class="small muted lknone">${o.fresh ? `Optional: link the ${esc(partnerWord(key, true))} you usually bill with it.` : 'None yet.'}</p>`}
        ${can ? `<button type="button" class="ghost lkedit" data-linkedit>${lk.length ? 'Edit links…' : 'Link ' + esc(partnerShort(key)) + '…'}</button>` : ''}</div>` : '';
      return codeLabel(key) + lsec + (gs.length ? `<p class="fgsub">Groups</p>` : '') +
        (gs.length ? `<p class="small muted fgnote">${o.fresh ? 'Choose the group(s) for this code. A code can be in several groups; none ticked = Ungrouped.' : 'Tick the groups this code belongs to. A code can be in several groups; none ticked = Ungrouped.'}</p>
        <div class="fgopts" role="group" aria-label="Groups">${gs.map(g => groupOpt(g, mine.has(g.id))).join('')}</div>` : `<p class="small muted fgnote">No groups yet. Use <b>+ New group</b> to make a named group of codes you bill together (e.g. C-section), or to sort favourites by specialty or doctor.</p>`) + `
        ${from && gs.length > 1 ? `<p class="fgsub">Move from ${esc(from.name)} to</p><div class="fgmove">${gs.filter(g => g.id !== from.id).map(g => `<button type="button" class="chip spchip" data-moveto="${esc(g.id)}">${esc(g.name)}</button>`).join('')}</div>` : ''}
        <div class="fgacts"><button type="button" class="ghost" data-newgrp>+ New group</button>${from ? `<button type="button" class="ghost" data-rmfrom>Remove from ${esc(from.name)}</button>` : ''}${o.fresh ? '' : '<button type="button" class="ghost danger" data-unfav>Remove from favourites</button>'}<button type="button" class="primary" data-close>Done</button></div>`;
    };
    const changed = () => { if (o.fresh) GS.last = groupsOf(key).map(g => g.id); saveGroups(); refreshSaved(); };
    const wireIt = el => {
      el.addEventListener('change', e => { const c = e.target.closest('input[data-gid]'); if (!c) return; if (c.checked) addToGroup(c.dataset.gid, key); else removeFromGroup(c.dataset.gid, key); changed(); $$('.fgopt', el).forEach(l => { const g = groupById($('input', l).dataset.gid); $('.fgcount', l).textContent = g ? gTotal(g) : 0; }); });
      el.addEventListener('click', e => {
        const mv = e.target.closest('[data-moveto]');
        if (mv) { const to = groupById(mv.dataset.moveto); removeFromGroup(from.id, key); addToGroup(to.id, key); changed(); closeSheet(); toast(`${code} moved to ${to.name}`); return; }
        if (e.target.closest('[data-rmfrom]')) { removeFromGroup(from.id, key); changed(); closeSheet(); toast(`${code} removed from ${from.name}` + (groupsOf(key).length ? '' : ' (now Ungrouped)')); return; }
        if (e.target.closest('[data-unfav]')) { closeSheet(); if (isFav(key)) toggleFav(key, o.also); return; }
        if (e.target.closest('[data-newgrp]')) groupEditor(null, id => { addToGroup(id, key); changed(); codeSheet(key, o); });
        if (e.target.closest('[data-linkedit]')) linkSheet(key, { back: () => codeSheet(key, o) });
      });
    };
    openSheet('fgCodeSheet', o.fresh ? '★ Added to favourites' : (GS.groups.length ? 'Links and groups for ' : 'Options for ') + esc(code), body(), wireIt);
  }
  // Create or edit a group: type (Custom / Specialty / Doctor) and name. v38: Custom (a named set of codes) comes first and is the default.
  function groupEditor(gid, then) {
    const g = gid ? groupById(gid) : null; let type = g ? g.type : 'custom';
    const ph = { specialty: 'Specialty, e.g. Family Medicine', doctor: "Doctor's name, e.g. Dr. A. Patel", custom: 'Any name, e.g. C-section, Clinic visit' };
    const help = { specialty: 'Pick one below or type your own.', doctor: 'Your own label for a doctor you bill for. Kept on this device only.',
      custom: `A named set of codes you bill together. It can hold fee codes, ${JUR === 'AB' ? 'ICD-9 codes and modifiers' : 'diagnostic codes'}.` };
    const body = `<div class="fgseg" role="radiogroup" aria-label="Group type">${['custom', 'specialty', 'doctor'].map(t => `<button type="button" role="radio" class="fgsegb t-${t}" data-type="${t}" aria-checked="${t === type}">${ICONS[t]}<span>${GTYPES[t]}</span></button>`).join('')}</div>
      <label class="fglab" for="fgName">Name</label><input id="fgName" class="fginput" type="text" maxlength="60" autocomplete="off" autocapitalize="words" spellcheck="false" list="fgSpecList" value="${g ? esc(g.name) : ''}">
      <datalist id="fgSpecList">${SPECIALTIES.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <p class="small muted fghelp" id="fgHelp"></p>
      <div class="fgspecs" id="fgSpecs" role="group" aria-label="Common specialties">${SPECIALTIES.map(x => `<button type="button" class="chip spchip" data-spec="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <p class="fgerr" id="fgErr" role="alert" hidden></p>
      <div class="fgacts"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="primary" id="fgSave">${g ? 'Save' : 'Create group'}</button></div>`;
    openSheet('fgEditor', g ? 'Edit group' : 'New group', body, el => {
      const inp = $('#fgName', el), err = $('#fgErr', el);
      const paint = () => { $$('.fgsegb', el).forEach(b => b.setAttribute('aria-checked', String(b.dataset.type === type))); inp.placeholder = ph[type]; $('#fgHelp', el).textContent = help[type];
        $('#fgSpecs', el).hidden = type !== 'specialty'; if (type === 'specialty') inp.setAttribute('list', 'fgSpecList'); else inp.removeAttribute('list');
        inp.setAttribute('aria-describedby', 'fgHelp'); err.hidden = true; };
      paint();
      el.addEventListener('click', e => {
        const t = e.target.closest('[data-type]'); if (t) { type = t.dataset.type; paint(); inp.focus(); return; }
        const sp = e.target.closest('[data-spec]'); if (sp) { inp.value = sp.dataset.spec; err.hidden = true; return; }
        if (e.target.closest('#fgSave')) save();
      });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
      function save() {
        const name = cleanName(inp.value);
        if (!name) { err.textContent = 'Type a name for the group.'; err.hidden = false; inp.focus(); return; }
        const dup = findGroup(type, name); if (dup && dup.id !== gid) { err.textContent = `You already have the ${GTYPES[type].toLowerCase()} group “${dup.name}”.`; err.hidden = false; inp.focus(); return; }
        let id = gid; if (g) { g.name = name; g.type = type; } else id = newGroup(type, name);
        saveGroups(); refreshSaved(); closeSheet(); toast(g ? 'Group saved' : `Group “${name}” created`);
        if (then) then(id);
      }
    });
    if (!g) setTimeout(() => { try { $('#fgName').focus(); } catch (e) {} }, 60);
  }
  // what a group holds, in words: "2 fee codes · 1 ICD-9 code · 2 modifiers"
  function groupCountTxt(g) {
    const h = g.keys.filter(k => k[0] === 'H').length, i = g.keys.length - h, m = g.mods.length, dx = JUR === 'AB' ? 'ICD-9 code' : 'diagnostic code';
    const parts = [h ? `${h} fee code${h === 1 ? '' : 's'}` : '', i ? `${i} ${dx}${i === 1 ? '' : 's'}` : '', m ? `${m} modifier${m === 1 ? '' : 's'}` : ''].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'No codes yet';
  }
  // Group options: send (multi-code pick), add or remove codes, rename/change type, move up/down (your own order), delete
  function groupSheet(gid) {
    const g = groupById(gid); if (!g) return;
    const ord = orderedGroups(), i = ord.indexOf(g);
    const body = `<p class="fgcode">${typeTag(g.type)} <span class="muted">${esc(groupCountTxt(g))}</span></p>
      <p class="small muted fgused">Last used: ${esc(whenTxt(GS.used[gid]))}</p>
      <div class="fglist">
        ${pickMulti() && nSendable(g) ? '<button type="button" class="fgitem" data-act="send">Send this group to MedBilling Logs…</button>' : ''}
        <button type="button" class="fgitem" data-act="add">Add or remove codes…<span class="small muted">Fee codes, ${JUR === 'AB' ? 'ICD-9 codes and modifiers' : 'diagnostic codes'}</span></button>
        <button type="button" class="fgitem" data-act="edit">Rename or change type…</button>
        <button type="button" class="fgitem" data-act="up"${i <= 0 ? ' disabled' : ''}>Move up</button>
        <button type="button" class="fgitem" data-act="down"${i >= ord.length - 1 ? ' disabled' : ''}>Move down</button>
        <button type="button" class="fgitem danger" data-act="del">Delete group…</button>
      </div>${GS.sort !== 'custom' && ord.length > 1 ? `<p class="small muted fgnote">Groups are sorted ${GS.sort === 'az' ? 'A–Z' : 'by most recently used'}. Moving a group switches to My order.</p>` : ''}`;
    openSheet('fgGroupSheet', esc(g.name), body, el => el.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b || b.disabled) return; const a = b.dataset.act;
      if (a === 'send') return groupSendSheet(gid);
      if (a === 'add') return groupPicker(gid);
      if (a === 'edit') return groupEditor(gid);
      if (a === 'del') return deleteSheet(gid);
      const cur = orderedGroups(), at = cur.indexOf(g), to = a === 'up' ? at - 1 : at + 1; if (to < 0 || to >= cur.length) return;
      cur.splice(at, 1); cur.splice(to, 0, g); GS.groups = cur; GS.sort = 'custom'; saveGroups(); refreshSaved(); groupSheet(gid);
      const s = $(`#results .favgrp[data-gid="${gid}"]`); if (s) s.scrollIntoView({ block: 'nearest' });
    }));
  }
  // privacy-link-b5: confirm before deleting saved codes for the six provinces this version doesn’t include. Cancel keeps everything.
  function removeHiddenSheet() {
    const body = `<p>This can’t be undone. Your original file is not changed.</p>
      <div class="fglist"><button type="button" class="fgitem" data-close autofocus>Cancel</button><button type="button" class="fgitem danger" data-rmhidden>Remove</button></div>`;
    openSheet('rmHiddenSheet', 'Remove these hidden codes from MedBilling Fee Desk?', body, el => el.addEventListener('click', e => {
      if (!e.target.closest('[data-rmhidden]')) return;
      const m = k => REMOVED_JUR.test(splitKey(k).jur);
      FAVS = FAVS.filter(k => !m(k)); RECENT = RECENT.filter(k => !m(k));
      Object.keys(TS.f).forEach(k => { if (m(k)) delete TS.f[k]; }); Object.keys(TS.r).forEach(k => { if (m(k)) delete TS.r[k]; });
      GS.groups.forEach(g => { g.keys = g.keys.filter(k => !m(k)); });
      saveLists(); saveGroups(); $$('[data-fav]').forEach(paintStar); refreshSaved(); closeSheet(); toast('Hidden codes removed');
    }));
  }
  function deleteSheet(gid) {
    const g = groupById(gid); if (!g) return; const n = gTotal(g), nm = g.mods.length;
    const only = g.keys.filter(k => groupsOf(k).length === 1).length;
    const body = `<p>Delete the group <b>${esc(g.name)}</b>?${n ? ` It has ${esc(groupCountTxt(g))}.` : ''}</p>
      <div class="fglist">${n ? `<button type="button" class="fgitem" data-del="keep">Delete group, keep its codes<span class="small muted">Fee and ${JUR === 'AB' ? 'ICD-9' : 'diagnostic'} codes stay in your favourites${only ? ` (${only} move to Ungrouped)` : ''}.${nm ? ' Its modifiers leave with the group.' : ''}</span></button>
        <button type="button" class="fgitem danger" data-del="remove">Delete group and its codes<span class="small muted">Removes them from your favourites. Codes that are also in another group stay there.</span></button>`
        : '<button type="button" class="fgitem danger" data-del="keep">Delete group</button>'}
        <button type="button" class="fgitem" data-close>Cancel</button></div>`;
    openSheet('fgDelSheet', 'Delete group', body, el => el.addEventListener('click', e => {
      const b = e.target.closest('[data-del]'); if (!b) return;
      let removed = 0;
      if (b.dataset.del === 'remove') { const drop = g.keys.filter(k => groupsOf(k).length === 1); removed = drop.length; FAVS = FAVS.filter(k => !drop.includes(k)); drop.forEach(k => { delete TS.f[k]; }); }
      GS.groups = GS.groups.filter(x => x.id !== gid); saveLists(); saveGroups();
      $$('[data-fav]').forEach(paintStar); refreshSaved(); closeSheet();
      toast(`Group “${g.name}” deleted` + (removed ? `, ${removed} code${removed === 1 ? '' : 's'} removed` : ''));
    }));
  }
  // Add or remove a group's codes. v38: tabs Favourites (tick favourites, as in v34) · Fee codes · ICD-9 · Modifiers (Alberta):
  // search any code by code or words and tap to add / take out. A fee or ICD-9 code added here is also starred (groups live in
  // Favourites); taking it out of the group keeps the star. Modifiers live only in their groups.
  function groupPicker(gid, mode0) {
    const g = groupById(gid); if (!g) return;
    const canI = !!(ICD && ICD.length), canM = modsShown(), dxShort = JUR === 'AB' ? 'ICD-9' : P && P.meta.dx ? P.meta.dx.system : 'Dx';
    const favKeys = () => FAVS.filter(k => !heldJur(splitKey(k).jur));
    const modes = [['fav', 'Favourites'], ['H', 'Fee codes']].concat(canI ? [['I', dxShort]] : [], canM ? [['M', 'Modifiers']] : []);
    let mode = modes.some(m => m[0] === mode0) ? mode0 : favKeys().length ? 'fav' : 'H', q = '';
    const row = k => { const t = codeLabel(k).replace(/<\/?p[^>]*>/g, '');
      return `<label class="fgopt fgpick" data-t="${esc(favText(k))}"><input type="checkbox" data-key="${esc(k)}"${g.keys.includes(k) ? ' checked' : ''}><span class="fgpl">${t}</span>${pickPrice(k)}</label>`; };
    const favHtml = () => { const ks = favKeys(); return ks.length ? `<div class="inputwrap fgq"><input id="fgPickQ" type="search" placeholder="Filter favourites" aria-label="Filter favourites" autocapitalize="off" spellcheck="false"></div>
      <div class="fgopts fgpicks">${ks.map(row).join('')}</div>` : `<p class="muted small lknone">No favourites yet. Use the Fee codes${canI ? ', ' + esc(dxShort) : ''}${canM ? ' or Modifiers' : ''} tab to find codes.</p>`; };
    const body = `<p class="fgcode">${typeTag(g.type)} <span class="muted" id="fgAddN"></span></p>
      ${modes.length > 1 ? `<div class="lkseg fgaddseg n${modes.length}" role="tablist" aria-label="Find codes">${modes.map(([m, l]) => `<button type="button" role="tab" data-gmode="${m}">${esc(l)}</button>`).join('')}</div>` : ''}
      <p class="small muted fgnote" id="fgAddNote"></p>
      <div id="fgModeFav"></div>
      <div id="fgModeSearch" hidden><div class="inputwrap fgq"><input id="fgAddQ" type="search" enterkeyhint="search" autocapitalize="off" spellcheck="false"></div>
        <p class="fgsub" id="fgAddResH"></p><div class="fgopts lkres" id="fgAddRes" role="group" aria-labelledby="fgAddResH"></div></div>
      <div class="fgacts"><button type="button" class="primary" data-close>Done</button></div>`;
    openSheet('fgPicker', 'Add to ' + esc(g.name), body, el => {
      const inp = $('#fgAddQ', el);
      const inGroup = k => k[0] === 'M' ? g.mods.includes(k.slice(2)) : g.keys.includes(k);
      const suggestions = () => {   // the group's own codes of that kind first, then your favourites / recent / codes listed with its fee codes
        const fees = g.keys.filter(k => k[0] === 'H' && splitKey(k).jur === JUR).map(k => splitKey(k).code).filter(c => BYCODE[c]);
        if (mode === 'M') { const seen = new Set(g.mods.filter(modOk)); fees.forEach(h => ((BYCODE[h] || {}).mods || []).forEach(m => { if (m[2] && modOk(m[1])) seen.add(m[1]); }));
          fees.forEach(h => modsOf(hk(h)).forEach(m => { if (modOk(m.slice(2))) seen.add(m.slice(2)); })); return [...seen].slice(0, 20).map(x => 'M:' + x); }
        const own = g.keys.filter(k => k[0] === mode && splitKey(k).jur === JUR), fav = FAVS.filter(k => k[0] === mode && splitKey(k).jur === JUR);
        let more = mode === 'H' ? RECENT.filter(k => k[0] === 'H' && splitKey(k).jur === JUR) : [];
        if (mode === 'I') { fees.forEach(h => linksOf(hk(h)).forEach(k => more.push(k))); fees.slice(0, 3).forEach(h => { try { more = more.concat(suggestIcd(BYCODE[h]).rows.slice(0, 6).map(r => ik(r.i.code))); } catch (e) {} }); }
        return [...new Set(own.concat(fav, more))].filter(k => mode === 'H' ? BYCODE[splitKey(k).code] : ICDBY[splitKey(k).code]).slice(0, 20);
      };
      const paint = () => {
        $('#fgAddN', el).textContent = groupCountTxt(g);
        $$('[data-gmode]', el).forEach(b => { const on = b.dataset.gmode === mode; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
        $('#fgAddNote', el).textContent = mode === 'fav' ? 'Tick favourites to put them in this group; untick to take them out. A code can be in several groups.'
          : mode === 'M' ? 'Explicit AHCIP modifiers (official SOMB list). Tap to add to this group or take out.'
          : `Search by code or words. Tap to add to this group or take out. A code you add is also starred in Favourites.`;
        $('#fgModeFav', el).hidden = mode !== 'fav'; $('#fgModeSearch', el).hidden = mode === 'fav';
        if (mode === 'fav') return;
        inp.placeholder = mode === 'M' ? 'Search modifiers (e.g. CMGP, evening)' : mode === 'I' ? `Search ${dxShort} by code or words` : 'Search fee codes by code or words';
        inp.setAttribute('aria-label', mode === 'M' ? 'Search modifiers' : mode === 'I' ? `Search ${dxShort} codes` : 'Search fee codes');
        const list = q ? searchCodes(mode, q) : suggestions();
        $('#fgAddResH', el).textContent = q ? (list.length ? 'Results' : '') : (list.length ? 'In this group, your favourites and suggestions' : '');
        $('#fgAddRes', el).innerHTML = list.length ? list.map(k => { const on = inGroup(k), cd = linkCodeTxt(k);
          return `<button type="button" class="lkopt k-${k[0]}" data-gadd="${esc(k)}" aria-pressed="${on}" title="${esc(cd + ' ' + shortDesc(k))}"><span class="code">${esc(cd)}</span><span class="lkd">${esc(shortDesc(k, true))}</span>${pickPrice(k)}<span class="lkst">${on ? '✓ In group' : '+ Add'}</span></button>`; }).join('')
          : `<p class="muted small lknone">${q ? 'No matching codes.' : mode === 'M' ? 'Type a modifier code or a few words above (e.g. CMGP, evening, complex).' : 'Type a code or a few words above.'}</p>`;
        $('#fgAddRes', el).classList.toggle('empty', !list.length);
      };
      const favSec = () => { $('#fgModeFav', el).innerHTML = favHtml(); const fq = $('#fgPickQ', el); if (fq) fq.addEventListener('input', () => { const v = fq.value.trim().toLowerCase(); $$('.fgpick', el).forEach(l => { l.hidden = !!v && !l.dataset.t.includes(v); }); }); };
      favSec(); paint();
      el.addEventListener('change', e => { const c = e.target.closest('input[data-key]'); if (!c) return; if (c.checked) addToGroup(gid, c.dataset.key); else removeFromGroup(gid, c.dataset.key); saveGroups(); refreshSaved(); $('#fgAddN', el).textContent = groupCountTxt(g); });
      inp.addEventListener('input', () => { q = inp.value.trim(); paint(); });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
      el.addEventListener('click', e => {
        const md = e.target.closest('[data-gmode]');
        if (md) { mode = md.dataset.gmode; q = ''; inp.value = ''; if (mode === 'fav') favSec(); paint(); if (mode !== 'fav') inp.focus({ preventScroll: true }); return; }
        const op = e.target.closest('[data-gadd]'); if (!op) return;
        const k = op.dataset.gadd, c = splitKey(k).code;
        if (inGroup(k)) { if (k[0] === 'M') removeModFromGroup(gid, c); else removeFromGroup(gid, k); toast(`${k[0] === 'M' ? 'Modifier ' : ''}${c} taken out of ${g.name}`); }
        else {
          if (k[0] === 'M') addModToGroup(gid, c);
          else { if (!isFav(k)) { FAVS = [k].concat(FAVS); TS.f[k] = new Date().toISOString(); persistStorage(); } addToGroup(gid, k); }
          toast(`${k[0] === 'M' ? 'Modifier ' : ''}${c} added to ${g.name}`);
        }
        saveLists(); saveGroups(); $$('[data-fav]').forEach(paintStar); refreshSaved(); paint();
        const again = $(`#fgAddRes [data-gadd="${CSS.escape(k)}"]`, el); if (again) again.focus({ preventScroll: true });
      });
    });
  }
  // A modifier and its code groups (⋯ on a modifier in a group, or "Add to group" on the Modifiers tab): tick / untick groups
  function modGroupSheet(m, o) {
    o = o || {}; const from = o.from ? groupById(o.from) : null, x = MODXBY[m]; if (!x) return;
    const body = () => { const gs = orderedGroups(), mine = new Set(groupsOfMod(m).map(g => g.id));
      return `<p class="fgcode"><span class="code">${esc(m)}</span> <span class="muted">${esc(modNice(x.n))}</span></p>` +
        (gs.length ? `<p class="fgsub">Groups</p><p class="small muted fgnote">Tick the code groups this modifier belongs to (e.g. with the fee and ICD-9 codes you bill it with).</p>
        <div class="fgopts" role="group" aria-label="Groups">${gs.map(g => groupOpt(g, mine.has(g.id))).join('')}</div>`
          : '<p class="small muted fgnote">No groups yet. Make a named group (e.g. C-section) to keep this modifier with the fee and ICD-9 codes you bill it with.</p>') +
        `<div class="fgacts"><button type="button" class="ghost" data-newgrp>+ New group</button>${from ? `<button type="button" class="ghost" data-rmfrom>Remove from ${esc(from.name)}</button>` : ''}<button type="button" class="primary" data-close>Done</button></div>`; };
    openSheet('fgModSheet', 'Modifier ' + esc(m) + ' in groups', body(), el => {
      el.addEventListener('change', e => { const c = e.target.closest('input[data-gid]'); if (!c) return; if (c.checked) addModToGroup(c.dataset.gid, m); else removeModFromGroup(c.dataset.gid, m); saveGroups(); refreshSaved();
        $$('.fgopt', el).forEach(l => { const g = groupById($('input', l).dataset.gid); $('.fgcount', l).textContent = g ? gTotal(g) : 0; }); paintModGrp(m); toast(`Modifier ${m} ${c.checked ? 'added to' : 'taken out of'} ${(groupById(c.dataset.gid) || {}).name}`); });
      el.addEventListener('click', e => {
        if (e.target.closest('[data-rmfrom]')) { removeModFromGroup(from.id, m); saveGroups(); refreshSaved(); paintModGrp(m); closeSheet(); toast(`Modifier ${m} removed from ${from.name}`); return; }
        if (e.target.closest('[data-newgrp]')) groupEditor(null, id => { addModToGroup(id, m); saveGroups(); refreshSaved(); paintModGrp(m); modGroupSheet(m, o); });
      });
    });
  }
  const paintModGrp = m => { const b = $(`#modifiers [data-modgrp="${CSS.escape(m)}"]`); if (b) b.textContent = groupsOfMod(m).length ? '✓ In group' : '+ Group'; };
  // v38, multi-code pick (MedBilling Logs pv=2, Alberta): send a whole group, or the codes you leave ticked, in one go. Up to
  // tmax() per kind (10 with Logs v9m+, else 3); more than that: the first ones are ticked and the cap stops further ticks.
  // "Add to selection" puts them in the tray instead, to combine with single codes. An ICD-9 code or modifier linked to one of
  // the ticked fee codes goes with that fee code ("for"), as with linked favourites; others let MedBilling Logs place them.
  function groupSendSheet(gid) {
    const g = groupById(gid); if (!g || !pickMulti()) return;
    const L = groupSendable(g), cap = tmax(), W = { H: 'fee code', I: 'ICD-9 code', M: 'modifier' };
    const sel = { H: new Set(L.H.slice(0, cap)), I: new Set(L.I.slice(0, cap)), M: new Set(L.M.slice(0, cap)) };
    const over = ['H', 'I', 'M'].filter(t => L[t].length > cap);
    const desc = (t, c) => t === 'H' ? (BYCODE[c] || {}).desc || '' : t === 'I' ? (ICDBY[c] ? icdLabel(ICDBY[c]) : '') : modNice((MODXBY[c] || {}).n);
    const sec = t => L[t].length ? `<p class="fgsub">${W[t] === 'ICD-9 code' ? 'ICD-9 codes' : W[t].charAt(0).toUpperCase() + W[t].slice(1) + 's'} <span class="lkn" data-gscnt="${t}"></span></p>
      <div class="fgopts gsend" role="group">${L[t].map(c => `<label class="fgopt k-${t}"><input type="checkbox" data-gs="${t}:${esc(c)}"${sel[t].has(c) ? ' checked' : ''}><span class="code">${esc(c)}</span><span class="fgpl">${esc(desc(t, c))}</span></label>`).join('')}</div>` : '';
    const body = `<p class="small muted fgnote">Sends the ticked codes to your MedBilling Logs row in one go (up to ${cap} fee codes, ${cap} ICD-9 codes and ${cap} modifiers). Untick any you don't need, or close this and tap single codes in the group.</p>
      ${over.length ? `<p class="fgerr gsover">${over.map(t => `This group has ${L[t].length} ${W[t]}s; one send takes ${cap}, so the first ${cap} are ticked.`).join(' ')}</p>` : ''}
      ${trayN() ? `<p class="small fgnote">${trayN()} code${trayN() === 1 ? ' is' : 's are'} already selected and will go too.</p>` : ''}
      ${sec('H')}${sec('I')}${sec('M')}<p class="fgerr" id="gsErr" role="alert" hidden></p>
      <div class="fgacts"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="ghost" id="gsAdd">Add to selection</button><button type="button" class="primary" id="gsSend">Send</button></div>`;
    openSheet('fgSendSheet', 'Send ' + esc(g.name), body, el => {
      const err = $('#gsErr', el), n = () => sel.H.size + sel.I.size + sel.M.size;
      const paint = () => { $$('[data-gscnt]', el).forEach(x => { x.textContent = `${sel[x.dataset.gscnt].size} of ${cap}`; });
        $('#gsSend', el).textContent = `Send ${n() + trayN()} code${n() + trayN() === 1 ? '' : 's'}`; $('#gsSend', el).disabled = !(n() + trayN()); $('#gsAdd', el).disabled = !n(); };
      paint();
      el.addEventListener('change', e => { const c = e.target.closest('input[data-gs]'); if (!c) return; const t = c.dataset.gs[0], code = c.dataset.gs.slice(2);
        if (c.checked && sel[t].size >= cap) { c.checked = false; err.textContent = `Up to ${cap} ${W[t]}s per send. Untick one first.`; err.hidden = false; return; }
        err.hidden = true; if (c.checked) sel[t].add(code); else sel[t].delete(code); paint(); });
      const toTray = () => {   // keep the group's order; linked ICD-9 / modifiers go with their fee code
        const fees = L.H.filter(c => sel.H.has(c)); let full = 0;
        fees.forEach(c => { if (trayAdd('H', c)) full++; });
        L.I.filter(c => sel.I.has(c)).forEach(c => { const f = fees.find(h => isLinked(hk(h), ik(c))) || ''; if (trayAdd('I', c, f)) full++; });
        L.M.filter(c => sel.M.has(c)).forEach(c => { const f = fees.find(h => isModLinked(hk(h), 'M:' + c)) || ''; if (trayAdd('M', c, f)) full++; });
        GS.used[gid] = new Date().toISOString(); saveGroups(); traySave(); return full;
      };
      el.addEventListener('click', e => {
        if (e.target.closest('#gsAdd')) { const full = toTray(); closeSheet(); paintTray(); refreshSaved(); toast(`${g.name}: ${n()} code${n() === 1 ? '' : 's'} added to the selection${full ? ` (${full} not added: ${cap} per kind at most)` : ''}. Tap Send when ready`, 3800); return; }
        if (e.target.closest('#gsSend')) { const full = toTray(); closeSheet(); if (full) toast(`${full} code${full === 1 ? '' : 's'} not sent: ${cap} per kind at most`, 3000); sendMulti(trayPayload()); }
      });
    });
  }
  function openSaved(which) {
    goHome();
    const t = $(which === 'recent' ? '#savedRecent' : '#savedFav'); if (t && which === 'recent') t.scrollIntoView({ block: 'start' });
  }

  // ------------------------------------------------------------ code detail
  function pdfUrl(key) { const r = META.sources.find(s => s.key === key); return r ? r.url : '#'; }
  function grLinks(text) {
    return esc(text).replace(/\bGRs?\s+((?:\d{1,2}(?:\.\d{1,2}){0,3})(?:(?:,\s*|\s+and\s+|\s*-\s*)\d{1,2}(?:\.\d{1,2}){0,3})*)/g, (m, list) =>
      m.replace(/\d{1,2}(?:\.\d{1,2}){0,3}/g, id => RULEBY[id] ? `<a href="#/rules/${id}">${id}</a>` : id))
      .replace(/\b(\d{2}\.\d{1,2}\s?[A-Z]{0,3})\b/g, (m, c) => { const k = c.replace(/\s/g, ''); return BYCODE[k] && k !== current ? `<a href="#/code/${k}">${c}</a>` : m; });
  }
  function modDef(type, code) {
    const d = MODCODE[type + ':' + code]; const t = MODTYPE[type];
    return (d ? d.text : '') || (t ? t.text : '');
  }
  function showCode(code, quiet) {
    const c = BYCODE[code]; if (!c) return;
    if (P) return provDetail(c, quiet);
    current = code;
    if (!quiet) addRecent('H:' + code);
    $$('.hit').forEach(b => b.classList.toggle('sel', b.dataset.code === code));
    const ctx = ($('#results')._ctx) || { periods: [] };
    const f = feeFor(c);
    const hl = new Set(ctx.periods.flatMap(p => PERIOD_CODES[p] || []));
    const minutes = ctx.minutes;
    const el = $('#detail'); el.hidden = false;
    const bl = (c.bulletins || []);
    const docLinks = [];
    bl.forEach(b => { const B = BULLBY[b.num]; if (B) docLinks.push(`<a target="_blank" rel="noopener noreferrer" href="${esc(B.url)}#page=${b.page}">Open MED ${b.num} at this code</a> <span class="small muted">(${esc(B.date)}${b.superseded ? ', superseded' : ''}, p. ${b.page})</span>`); });
    if (c.plPage) docLinks.push(`<a target="_blank" rel="noopener noreferrer" href="${esc(pdfUrl('procedure'))}#page=${c.plPage}">Procedure list p. ${esc(c.plLabel)}</a>`);
    if (c.pricePage) docLinks.push(`<a target="_blank" rel="noopener noreferrer" href="${esc(pdfUrl('price'))}#page=${c.pricePage}">Price list p. ${esc(c.priceLabel)}</a>`);
    // context callouts
    const call = [];
    if (ctx.periods.length) {
      const own = (c.mods || []).filter(m => hl.has(m[1]));
      own.forEach(m => call.push(`On this fee code: <b>${esc(m[0])} ${esc(m[1])}</b> ${esc(m[3])} ${esc(m[4])} — ${esc(modDef(m[0], m[1]))}`));
      const aa = BYCODE['03.01AA'];
      if (aa) (aa.mods || []).filter(m => hl.has(m[1])).forEach(m => call.push(`After-hours time premium: <a href="#/code/03.01AA">03.01AA</a> with SURT ${esc(m[1])} — ${m[5] ? esc(m[5].map(x => `calls ${x[0]}: ${x[1]} ${x[2]}`).join('; ')) : ''} (<a href="#/rules/15.13">GR 15.13</a>)`));
      if (ctx.hospital || ctx.callback) ctx.periods.forEach(p => { const cb = BYCODE[CALLBACK[p]]; if (cb) call.push(`Special callback (if called in): <a href="#/code/${cb.code}">${esc(cb.code)}</a> ${esc(cb.desc)} <span class="fee">${money(cb.base)}</span> (<a href="#/rules/15.3">GR 15.3</a>, <a href="#/rules/15.8">15.8</a>)`); });
      if (!own.length && !call.length) call.push('No after-hours modifier is listed for this fee code in the price list.');
    }
    if (minutes) {
      (c.mods || []).filter(m => m[0] === 'CARE').forEach(m => { const mm = parseInt((m[1].match(/\d+/) || [0])[0], 10); if (mm && minutes >= mm) { hl.add(m[1]); call.push(`Complex care time: <b>CARE ${esc(m[1])}</b> ${esc(m[3])} ${esc(m[4])} — ${esc(modDef('CARE', m[1]))}`); } });
      if (/consultation/i.test(c.desc) && minutes > 30 && BYCODE['03.08M'] && c.code !== '03.08M') { const x = BYCODE['03.08M']; call.push(`Extended consultation over 30 min: <a href="#/code/03.08M">03.08M</a> ${esc(x.desc)} <span class="fee">${money(feeFor(x).amount)}</span>`); }
    }
    const skillRows = Object.entries(c.skill || {});
    if (phone) { phoneCard(c, f, call, docLinks, el); return; }
    $('.split').classList.remove('showing');
    el.innerHTML = `
      <div class="mobileskill">Specialty <select class="skillsel" aria-label="Specialty"></select></div>
      <div class="row1"><span class="code codebig">${esc(c.display || c.code)}</span>${star('H:' + c.code)}
        ${c.cat ? `<span class="badge">cat ${esc(c.cat)}</span>` : ''}${c.visit ? '<span class="badge">V</span>' : ''}${c.notInPriceList ? '<span class="badge b">not in price list</span>' : ''}</div>
      <h2>${esc(c.desc)}</h2>
      <div class="small muted">${esc([c.section, c.chapter, c.sub, c.group].filter(Boolean).join(' › '))}</div>
      <div class="feeblock">
        <div><div class="small muted">Schedule fee (${esc(skill === 'BASE' ? 'base' : skill)})</div><div class="fee big">${f.amount == null ? esc(f.label) : money(f.amount)}</div><div class="small muted">${esc(f.note)}</div></div>
        ${skill !== 'BASE' && f.amount !== c.base && !c.byAssess ? `<div><div class="small muted">Schedule base</div><div class="fee">${money(c.base)}</div></div>` : ''}
        ${c.ane != null ? `<div><div class="small muted">Anaesthetic benefit (separate)</div><div class="fee">${money(c.ane)}</div></div>` : ''}
      </div>
      <div class="row"><button class="ghost" id="askCode">Ask SI</button><button class="ghost" id="copyCode">Copy fee code</button>${pickBtn('hsc', c.code)}</div>
      ${call.length ? `<h3>For your description</h3><ul>${call.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}
      ${c.notes ? `<h3>Notes</h3><p>${grLinks(c.notes)}</p>` : ''}
      ${c.gr && c.gr.length ? `<p class="small">Governing rules: ${c.gr.map(g => `<a href="#/rules/${g}">GR ${g}</a>`).join(', ')}</p>` : ''}
      <h3>In the ministry document</h3><div class="links">${docLinks.join('') || '<span class="muted">—</span>'}</div>
      <h3>Suggested ICD-9 <span class="small muted" id="icdsugbasis"></span></h3>
      <div id="icdsug"></div>
      <h3>Modifiers (price list)</h3>
      ${(c.mods || []).length ? `<div class="tablewrap"><table><thead><tr><th>Type</th><th>Code</th><th>Expl.</th><th>Action</th><th>Amount</th></tr></thead><tbody>
        ${c.mods.map(m => `<tr class="${hl.has(m[1]) ? 'hl' : ''}"><td>${esc(m[0])}</td><td title="${esc(modDef(m[0], m[1]))}">${esc(m[1])}</td><td>${m[2] ? 'Y' : ''}</td><td>${esc(m[3])}${m[5] ? '<br><span class="small muted">' + esc(m[5].map(x => `calls ${x[0]}: ${x[1]} ${x[2]}`).join('; ')) + '</span>' : ''}</td><td>${esc(m[4])}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted small">No modifier rows listed.</p>'}
      ${skillRows.length ? `<details><summary class="small">Fee-skill rates (SKLL, replace base) — ${skillRows.length}</summary><div class="tablewrap"><table><tbody>${skillRows.map(([k, v]) => `<tr class="${k === skill ? 'hl' : ''}"><td>${esc(k)}</td><td>${esc((META.skills.find(s => s.code === k) || {}).name || '')}</td><td class="fee">${money(parseFloat(v))}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
    `;
    skillOptions($('.skillsel', el)); $('.skillsel', el).addEventListener('change', e => setSkill(e.target.value));
    $('#askCode').onclick = () => openAI(codePrompt(c));
    $('#copyCode').onclick = () => copy(c.code, 'Fee code copied');
    { const sg = suggestIcd(c); $('#icdsugbasis').textContent = '(' + sg.basis + ')'; renderIcdList($('#icdsug'), sg.rows, sg.empty); }
    if (!quiet && !window.matchMedia('(min-width:900px)').matches) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (location.hash !== '#/code/' + code) history.replaceState(null, '', '#/code/' + code);
  }

  // Phone code card: fee, key notes collapsed, ICD-9 suggestions, Document / Ask AI / More about this condition.
  let pickedIcd = null;
  function phoneCard(c, f, call, docLinks, el) {
    el.innerHTML = `<div class="pcard">
      <button type="button" class="ghost back" id="pBack">‹ Results</button>
      <div class="row1"><span class="code codebig">${esc(c.display || c.code)}</span>${star('H:' + c.code)}${c.cat ? `<span class="badge">cat ${esc(c.cat)}</span>` : ''}</div>
      <h2>${esc(c.desc)}</h2>
      <div class="pfee"><div class="fee big">${f.amount == null ? esc(f.label) : money(f.amount)}</div>
        <div class="small muted">Schedule fee (${esc(skill === 'BASE' ? 'base' : skill)})${skill !== 'BASE' && f.amount !== c.base && !c.byAssess ? ' · base ' + money(c.base) : ''}${c.ane != null ? ' · anaesthetic ' + money(c.ane) + ' (separate)' : ''}</div></div>
      <div class="pbtns"><button type="button" class="ghost" id="pDoc" aria-expanded="false">Document</button><button type="button" class="ghost" id="askCode">Ask SI</button><button type="button" class="ghost" id="pMore">More about this condition</button></div>${pickBtn('hsc', c.code)}
      <div id="pDocs" class="links" hidden>${docLinks.join('') || '<span class="muted">No document page listed.</span>'}</div>
      ${call.length ? `<details><summary>For your description</summary><ul>${call.map(x => `<li>${x}</li>`).join('')}</ul></details>` : ''}
      ${c.notes || (c.gr && c.gr.length) ? `<details><summary>Key notes</summary>${c.notes ? `<p>${grLinks(c.notes)}</p>` : ''}${c.gr && c.gr.length ? `<p class="small">Governing rules: ${c.gr.map(g => `<a href="#/rules/${g}">GR ${g}</a>`).join(', ')}</p>` : ''}</details>` : ''}
      <h3>Suggested ICD-9</h3><p class="small muted" id="icdsugbasis"></p><div id="icdsug" class="picklist"></div></div>`;
    const sg = suggestIcd(c); $('#icdsugbasis').textContent = sg.basis; renderIcdList($('#icdsug'), sg.rows, sg.empty);
    pickedIcd = sg.rows.length ? sg.rows[0].i.code : null;
    const mark = () => $$('#icdsug .icdrow').forEach(r => r.classList.toggle('picked', r.dataset.icd === pickedIcd));
    mark();
    $('#icdsug').addEventListener('click', e => { const r = e.target.closest('.icdrow'); if (r && !e.target.closest('button')) { pickedIcd = r.dataset.icd; mark(); } });
    $('#pMore').disabled = !pickedIcd;
    $('#pMore').onclick = () => pickedIcd && showMedRes(pickedIcd);
    $('#pDoc').onclick = () => { const d = $('#pDocs'); d.hidden = !d.hidden; $('#pDoc').setAttribute('aria-expanded', String(!d.hidden)); };
    $('#askCode').onclick = () => openAI(codePrompt(c));
    $('#pBack').onclick = () => { current = null; el.hidden = true; el.innerHTML = ''; $('.split').classList.remove('showing'); $$('.hit').forEach(b => b.classList.remove('sel')); if (!lastQuery) renderSaved(); history.replaceState(null, '', location.pathname + location.search); window.scrollTo(0, 0); };
    $('.split').classList.add('showing');
    window.scrollTo(0, 0);
    if (location.hash !== '#/code/' + c.code) history.replaceState(null, '', '#/code/' + c.code);
  }

  // ------------------------------------------------------------ ICD-9
  const CONCEPTS = [
    [/pessary/i, 'prolapse uterovaginal vaginal wall cystocele rectocele stress incontinence'],
    [/cesarean|caesarean/i, 'cesarean delivery previous uterine scar malposition malpresentation breech obstructed labour fetal distress placenta praevia multiple gestation'],
    [/colposcop|cervi(x|cal)|cone biopsy|leep|loop electrical/i, 'cervix dysplasia abnormal papanicolaou smear carcinoma in situ condyloma cervicitis'],
    [/contracept/i, 'contraceptive management intrauterine device'],
    [/prenatal|obstetric|pregnan/i, 'pregnancy supervision normal high-risk'],
    [/delivery|labour|labor/i, 'delivery normal labour'],
    [/hysterectomy|myomectomy|ablation/i, 'leiomyoma uterus excessive menstruation menorrhagia prolapse endometriosis postmenopausal bleeding'],
    [/sterili|tubal/i, 'sterilization contraceptive management'],
    [/ectopic/i, 'ectopic pregnancy tubal'],
    [/endometri/i, 'endometrial hyperplasia excessive menstruation postmenopausal bleeding'],
    [/termination|abortion|curettage|evacuation/i, 'abortion missed spontaneous legally induced'],
    [/laparoscop/i, 'pelvic pain endometriosis ovarian cyst'],
    [/ovar/i, 'ovary cyst neoplasm'], [/vulv/i, 'vulva'], [/vagin/i, 'vagina'], [/fertil/i, 'infertility female'],
    [/incontinence|sling|urethr|bladder|cysto/i, 'incontinence stress urinary'],
    [/amnio|chorionic|fetal|cordocentesis/i, 'fetal abnormality antenatal screening'],
    [/induction/i, 'post term prolonged pregnancy'], [/laceration|perine|sphincter/i, 'laceration perineal'],
    [/hemorrhage|haemorrhage/i, 'postpartum hemorrhage'], [/placenta/i, 'retained placenta'], [/breast/i, 'breast'],
    [/consultation|visit|assessment/i, '']
  ];
  function scopeLabel() {
    if (FULL_ICD.has(skill) || !ICD_SCOPE[skill]) return 'full ICD-9 list';
    return skill + ' scope';
  }
  function renderIcdScope() {
    if (JUR !== 'AB') { renderDxScope(); return; }
    const sc = ICD_SCOPE[skill];
    $('#icdscope').textContent = (FULL_ICD.has(skill) || !sc) ? `Specialty ${skill === 'BASE' ? 'not set' : skill}: full Alberta ICD-9 list (${ICD.length.toLocaleString()} codes).`
      : `Specialty ${skill}: limited to ${sc.label}. App-defined scope; switch to GP or "Schedule base only" for the full list.`;
  }
  // ------------------------------------------------------------ HSC -> ICD-9 relevance (app-defined clinical mapping)
  // Each rule: test(c) on the HSC; n = ICD-9 numeric category ranges; v = V-code ranges; x = exact code prefixes;
  // pin = ordered high-relevance codes (shown only if present in the Alberta ICD-9 list); q = search terms for further ranking.
  const GYN_NEO = ['179', '180', '182', '183', '184', '218', '219', '220', '221', '233.1', '233.2', '233.3'];
  const ch2 = c => parseInt(String(c.code).split('.')[0], 10);
  const txt = c => [c.desc, c.group, c.sub, c.chapter].filter(Boolean).join(' ');
  const sec = c => romanOf(c);
  const FG = c => ['XIII', 'XIV'].includes(sec(c));           // female genital / obstetric sections
  const ONC = /carcinoma|malignan|cancer|radical|debulk|radium|oncolog/i;
  const OB_N = [[640, 679]];
  const SITE_RULES = [
    { id: 'iud', why: 'Matches procedure: intrauterine contraception',
      test: c => /intra-?uterine contraceptive|\bIUD\b|\bIUCD\b/i.test(c.desc),
      v: [[25, 25]], x: ['V45.5', '996.3', '626.2', '627.0'],
      pin: ['V25.1', 'V25.4', 'V25.0', 'V25.8', 'V45.5', '996.3', '626.2'], q: 'contraceptive intrauterine device' },
    { id: 'steril', why: 'Matches procedure: sterilization',
      test: c => (FG(c) || sec(c) === 'XII') && /sterili[sz]|tubal ligation|vasectomy/i.test(c.desc) && !/cesarean|caesarean/i.test(c.desc),
      v: [[25, 26]], x: [], pin: ['V25.2', 'V25.0', 'V26.0'], q: 'sterilization contraceptive' },
    { id: 'abort', why: 'Matches obstetric event: pregnancy loss / termination',
      test: c => FG(c) && /abortion|terminat\w* (of )?pregnancy|terminate pregnancy|fetal reduction/i.test(c.desc),
      n: [[632, 639]], x: ['655', '651', '667.1', '666.2', 'V61.7'],
      pin: ['635.9', '632', '634.9', '655.9', '655.1', '655.0', '637.9', '667.1', '651.0', '651.1'], q: 'abortion legally induced missed spontaneous fetal abnormality' },
    { id: 'ectopic', why: 'Matches obstetric event: ectopic pregnancy',
      test: c => FG(c) && /ectopic|intraperitoneal embryo/i.test(c.desc),
      x: ['633'], pin: ['633.1', '633.0', '633.2', '633.8', '633.9'], q: 'ectopic tubal pregnancy' },
    { id: 'cerclage', why: 'Matches obstetric event: cervical incompetence (cerclage)',
      test: c => FG(c) && /cerclage|suturing of cervix|encircling suture/i.test(c.desc),
      n: OB_N, x: ['V23'], pinw: 260, pin: ['654.5', 'V23.4', 'V23.5', '644.2'], q: 'cervical incompetence poor obstetric history' },
    { id: 'pph', why: 'Matches obstetric event: third stage / postpartum haemorrhage',
      test: c => FG(c) && /placenta|post ?partum hemorrhage|haemorrhage|inverted uterus/i.test(c.desc.replace(/without manual removal of placenta/i, '')),
      n: [[665, 667]], x: ['669.4'], pin: ['666.1', '666.0', '667.0', '666.2', '667.1', '665.2', '666.3'], q: 'postpartum haemorrhage retained placenta inversion uterus' },
    { id: 'obtrauma', why: 'Matches obstetric event: obstetric laceration / haematoma',
      test: c => sec(c) === 'XIV' && /laceration|sphincter|hematoma|haematoma/i.test(c.desc),
      x: ['664', '665', '674', '668', '669.4'], pin: ['664.2', '664.3', '665.3', '665.4', '665.7', '664.1', '674.3', '674.1', '665.1'], q: 'perineal laceration cervix vaginal haematoma wound' },
    { id: 'cs', why: 'Matches obstetric event: cesarean delivery',
      test: c => (sec(c) === 'XIV' && ch2(c) === 86) || (FG(c) || sec(c) === 'II') && /cesarean|caesarean/i.test(c.desc) && !/vaginal delivery/i.test(c.desc),
      n: OB_N, v: [[27, 27]],
      pin: ['654.2', '669.7', '652.2', '653.4', '656.3', '660.0', '641.0', '651.0', '652.8', 'V27.0'],
      q: 'caesarean uterine scar malpresentation breech disproportion obstructed labour fetal distress placenta praevia twin' },
    { id: 'induction', why: 'Matches obstetric event: induction of labour',
      test: c => sec(c) === 'XIV' && /induction/i.test(c.desc),
      n: OB_N, v: [[27, 27]], pin: ['645', '658.1', '642.4', '656.5', '648.8', '642.5', '656.3', '651.0'], q: 'prolonged pregnancy premature rupture pre-eclampsia poor fetal growth' },
    { id: 'vd', why: 'Matches obstetric event: labour and vaginal delivery',
      test: c => (sec(c) === 'XIV' || sec(c) === 'II') && /deliver|labou?r|forceps|vacuum|ventouse|breech|version|induction|dystocia/i.test(c.desc) && !/drug delivery/i.test(c.desc),
      n: OB_N, v: [[27, 27]],
      pin: ['650', '664.0', '664.1', '664.2', '645', '658.1', '660.4', '669.5', '652.2', '654.2', '651.0', '651.1', '661.2', '662.1', 'V27.0', 'V27.2', 'V27.5'],
      q: 'delivery normal perineal laceration prolonged pregnancy premature rupture shoulder dystocia' },
    { id: 'ob', why: 'Matches obstetric procedure: pregnancy / fetal assessment', test: c => sec(c) === 'XIV',
      n: [[630, 679]], v: [[22, 24], [27, 28]], pin: ['655.9', '656.5', '656.3', 'V28.0', 'V28.3', 'V23.9'], q: 'pregnancy antenatal fetal' },
    { id: 'fert', why: 'Matches procedure: tubal patency / infertility investigation',
      test: c => FG(c) && /patency|hysterosalping|insufflation|infertil/i.test(c.desc),
      n: [[628, 628]], x: ['614.6', '256.4', 'V26', '617', '752'], pin: ['628.2', '628.9', 'V26.2', '614.6', '628.0', '617.2'], q: 'infertility female tubal' },
    { id: 'endo', why: 'Matches condition: endometriosis / pelvic adhesions',
      test: c => FG(c) && /endometriosis|lysis of adhes/i.test(c.desc),
      n: [[614, 614], [617, 617]], x: ['625.3', '625.0', '625.9', '628', '620'], pin: ['617.0', '617.1', '617.3', '614.6', '625.3', '625.0', '617.9'], q: 'endometriosis adhesions pelvic pain dysmenorrhoea' },
    { id: 'congen', why: 'Matches condition: congenital anomaly of female genital tract',
      test: c => sec(c) === 'XIII' && /congenital/i.test(c.desc),
      x: ['752', '626.0', '625.0'], pin: ['752.4', '752.3', '752.2', '752.8', '626.0'], q: 'anomalies uterus vagina cervix' },
    { id: 'gyninj', why: 'Matches condition: non-obstetric injury of female genital tract',
      test: c => sec(c) === 'XIII' && /injury|non-obstetrical laceration|hematoma|haematoma/i.test(c.desc),
      x: ['867.4', '867.5', '867.6', '867.7', '939.2', '624.5', '623.6', '998.2', '624.4', '618.7'], pin: ['939.2', '624.5', '623.6', '867.4', '867.5', '998.2', '624.4'], q: 'injury haematoma vulva vagina uterus' },
    { id: 'cervix', why: 'Matches procedure site: cervix',
      test: c => FG(c) && (ch2(c) === 79 || /colposcop|cervi(x|cal)|cone biopsy|conization|\bLEEP\b|loop electr/i.test(c.desc)),
      x: ['622', '616.0', '180', '219.0', '233.1', '795.0', '795.1', '078.1', 'V76.2', 'V72.3', '752.4'],
      pin: ['795.0', '622.1', '233.1', '180', '616.0', '622.7', '078.1', 'V76.2'], q: 'cervix dysplasia papanicolaou smear carcinoma in situ cervicitis polyp' },
    { id: 'pessary', why: 'Matches procedure: vaginal pessary (pelvic organ support)',
      test: c => /pessary/i.test(c.desc) || /^10\.16/.test(c.code),
      x: ['618', '625.6', '788.3', '996.3', '623.5', '616.1'],
      pin: ['618.1', '618.0', '618.2', '618.3', '618.4', '618.5', '625.6', '996.3'], q: 'prolapse uterovaginal vaginal wall incontinence stress' },
    { id: 'ovary', why: 'Matches procedure site: ovary / adnexa',
      test: c => FG(c) && ([77, 78].includes(ch2(c)) || /ovar|oophor|salping|fallopian|adnex/i.test(c.desc)),
      n: [[614, 614], [620, 620], [628, 628]], x: ['183', '198.6', '220', '236.2', '256.4', '625.9', '617.1', '617.2', 'V26', 'V84'],
      pin: ['620.2', '620.0', '617.1', '614.6', '220', '183.0', '256.4'], onc: ['183.0', '183', '198.6', '236.2'], q: 'ovarian cyst endometriosis adhesions neoplasm ovary' },
    { id: 'uterus', why: 'Matches procedure site: uterus',
      test: c => FG(c) && ([80, 81].includes(ch2(c)) || /hysterect|myomect|endometri|uter(us|ine)|curettage|D ?& ?C\b/i.test(c.desc)),
      n: [[615, 615], [617, 618], [621, 621], [625, 627]], x: ['179', '180', '182', '218', '219.1', '233.1', '233.2', '236.0', '614', '620', '752'],
      pin: ['218', '626.2', '627.1', '618.1', '617.0', '621.0', '621.3', '182.0', '625.3'], onc: ['182.0', '180', '179', '233.2', '236.0'],
      q: 'uterus leiomyoma menorrhagia excessive menstruation postmenopausal bleeding prolapse endometrial hyperplasia' },
    { id: 'vagina', why: 'Matches procedure site: vagina / pelvic floor', test: c => FG(c) && ch2(c) === 82,
      n: [[618, 619], [623, 623]], x: ['614.4', '616.1', '184.0', '221.1', '233.3', '625.0', '625.6', '752.4', '078.1', '996.3'],
      pin: ['618.0', '618.5', '623.0', '616.1', '619.1', '625.6', '625.0', '221.1'], onc: ['184.0', '233.3'], q: 'vagina vaginal wall prolapse dysplasia vaginitis fistula' },
    { id: 'vulva', why: 'Matches procedure site: vulva / perineum', test: c => FG(c) && (ch2(c) === 83 || /vulv|bartholin|perine/i.test(c.desc)),
      n: [[624, 624]], x: ['616', '184.4', '221.2', '233.3', '078.1', '625.0', '618.7'],
      pin: ['616.2', '616.3', '624.0', '624.8', '616.1', '078.1', '624.4', '184.4'], onc: ['184.4', '233.3', '624.0'], q: 'vulva bartholin cyst abscess dystrophy' },
    { id: 'gyn', why: 'Matches procedure site: female genital organs', test: c => sec(c) === 'XIII',
      n: [[614, 629]], v: [[25, 26], [72, 72]], x: GYN_NEO, pin: [], q: 'female genital' },
    { id: 'breast', why: 'Matches procedure site: breast', test: c => sec(c) === 'XVI',
      n: [[610, 611]], x: ['174', '175', '217', '233.0', '238.3', '239.3', '793.8', 'V10.3', 'V16.3', 'V76.1'], pin: ['174.9', '611.7', '610.0', '610.1', '217', '233.0', '793.8'], onc: ['174.9', '233.0', '174'], q: 'breast neoplasm mass' }
  ];
  // Body-system ranges for other procedure sections (operations on X → diagnoses of X).
  const SYS = {
    II: { why: 'nervous system', n: [[320, 359], [191, 192], [225, 225], [430, 438], [741, 742], [850, 854], [950, 957]] },
    III: { why: 'endocrine system', n: [[240, 259], [193, 194], [226, 227]] },
    IV: { why: 'eye', n: [[360, 379], [190, 190], [224, 224], [743, 743], [870, 871], [918, 918], [921, 921], [930, 930], [940, 940]] },
    V: { why: 'ear', n: [[380, 389], [744, 744], [872, 872], [931, 931]] },
    VI: { why: 'nose, mouth and pharynx', n: [[470, 478], [520, 529], [140, 149], [160, 160], [210, 210], [749, 749], [802, 802], [873, 873], [932, 933]] },
    VII: { why: 'respiratory system', n: [[460, 519], [160, 163], [212, 212], [231, 231], [786, 786], [860, 862], [934, 934]] },
    VIII: { why: 'cardiovascular system', n: [[390, 459], [745, 747], [785, 785]] },
    IX: { why: 'haemic and lymphatic system', n: [[200, 208], [280, 289], [196, 196], [785, 785]] },
    X: { why: 'digestive system', n: [[520, 579], [150, 159], [211, 211], [230, 230], [787, 787], [935, 938]] },
    XI: { why: 'urinary tract', n: [[580, 599], [188, 189], [223, 223], [753, 753], [788, 788], [791, 791], [866, 867]], x: ['625.6', '996.3'] },
    XII: { why: 'male genital organs', n: [[600, 608], [185, 187], [222, 222], [752, 752]], v: [[25, 26]] },
    XV: { why: 'musculoskeletal system', n: [[710, 739], [800, 848], [754, 756], [170, 171], [213, 213], [215, 215], [905, 905]] },
    XVII: { why: 'skin and subcutaneous tissue', n: [[680, 709], [172, 173], [214, 214], [216, 216], [232, 232], [870, 897], [910, 919], [940, 949], [110, 111]], x: ['078.1'] }
  };
  function icdAllowed(i, r) {
    const code = i.code;
    if ((r.x || []).some(p => code === p || code.startsWith(p + '.') || (p.includes('.') && code.startsWith(p)))) return true;
    if (code[0] === 'E') return false;
    if (code[0] === 'V') { const n = parseInt(code.slice(1, 3), 10); return (r.v || []).some(([a, b]) => n >= a && n <= b); }
    const n = parseInt(code.slice(0, 3), 10);
    return (r.n || []).some(([a, b]) => n >= a && n <= b);
  }
  function icdRuleFor(c) {
    const r = SITE_RULES.find(r => r.test(c));
    if (r) return r;
    const s = SYS[sec(c)];
    if (s) return { id: 'sys', why: 'Matches procedure body system: ' + s.why, n: s.n, v: s.v, x: s.x, pin: [], q: '' };
    return null; // visits, consultations and general services: fee-skill scope
  }
  function suggestIcd(c) {
    const MAX = 8;
    const q = [c.desc, c.group, c.sub].filter(Boolean).join(' ').replace(/\d{2}\.\d+\s?[A-Z]*/g, ' ');
    const rule = icdRuleFor(c);
    if (rule) {
      const STOP = new Set(['delivery', 'vaginal', 'management', 'procedure', 'other', 'section', 'approach', 'method', 'repair', 'includes', 'without', 'additional', 'benefit', 'assisted', 'presentation', 'following', 'reason', 'minutes', 'first', 'claimed', 'abdominal', 'surgical', 'treatment', 'removal', 'insertion', 'operations', 'labour', 'labor', 'pregnancy', 'blood', 'absence', 'uterus', 'uterine', 'induction', 'medical', 'ectopic', 'umbilical', 'sampling', 'percutaneous']);
      const STOP6 = new Set(['hyster', 'pregna', 'labour', 'cesare', 'obstet']);
      const SYN = { multip: ['twin', 'triplet', 'multip'], reduct: ['twin', 'triplet'], incisi: ['wound', 'surgic'], rectal: ['fourth'], sphinc: ['third', 'fourth'], efface: ['incompet'], encirc: ['incompet'] };
      const fold = s => s.toLowerCase().replace(/ae/g, 'e').replace(/oe/g, 'e');
      const words = [...new Set((fold(c.desc).match(/[a-z]{5,}/g) || []).filter(w => !STOP.has(w)).map(w => w.slice(0, 6)).filter(w => !STOP6.has(w)))].flatMap(w => SYN[w] || [w]);
      const wm = i => { const d = fold(i.desc); return words.filter(w => d.includes(w)).length; };
      const onc = ONC.test(c.desc) && rule.onc ? rule.onc : [];
      const cand = new Map();
      const add = (i, base, score) => { if (!i || !icdAllowed(i, rule)) return; const prev = cand.get(i.code); const v = base + wm(i) * 100; if (!prev || prev.v < v) cand.set(i.code, { i, v, score }); };
      onc.forEach((code, k) => add(ICDBY[code], 300 - k, null));
      (rule.pin || []).forEach((code, k) => add(ICDBY[code], (rule.pinw || 60) - k, null));
      const query = (rule.q || '') + ' ' + q.split(/\s+/).slice(0, 8).join(' ');
      icdIndex.search(query, { limit: 40, filter: d => icdAllowed(d.i, rule), boost: d => d.i.code.includes('.') ? 1.1 : 1 }).hits
        .forEach(h => add(h.doc.i, Math.min(h.score, 30), h.score));
      const out = [...cand.values()].sort((x, y) => y.v - x.v).map(r => ({ i: r.i, score: (rule.pin || []).includes(r.i.code) || onc.includes(r.i.code) ? null : r.score, why: rule.why }));
      return { rows: out.slice(0, MAX), basis: rule.why };
    }
    let extra = '';
    CONCEPTS.forEach(([re, words]) => { if (re.test(c.desc + ' ' + (c.group || '') + ' ' + (c.sub || ''))) extra += ' ' + words; });
    const isVisit = /consultation|visit|assessment|examination|interview/i.test(c.desc + ' ' + (c.sub || ''));
    if (isVisit && skill === 'OBGY' && !/prenatal|obstetric/i.test(c.desc)) extra += ' pregnancy supervision pelvic pain menstruation menopausal';
    const why = (isVisit ? 'Visit/consultation code: ' : 'General service: ') + (P ? 'full ' + dxName() + ' list' : FULL_ICD.has(skill) || !ICD_SCOPE[skill] ? 'full list (specialty ' + (skill === 'BASE' ? 'not set' : skill) + ')' : skill + ' fee-skill scope');
    const VISIT_PINS = { OBGY: ['V22.1', 'V22.0', 'V23.9', 'V24.2', 'V72.3', '626.2', '627.1', '625.3'] };
    if (isVisit && VISIT_PINS[skill]) {
      const rows = VISIT_PINS[skill].map(k => ICDBY[k]).filter(i => i && icdInScope(i)).map(i => ({ i, why }));
      return { rows: rows.slice(0, MAX), basis: why };
    }
    if (isVisit) return { rows: [], basis: why, empty: 'Visit codes: diagnosis follows the presenting condition. Search the ' + dxName() + ' tab (' + (P ? 'full list' : scopeLabel()) + ').' };
    const res = icdIndex.search((extra || q) + ' ' + (extra ? q.split(/\s+/).slice(0, 6).join(' ') : ''), { limit: MAX, filter: d => icdInScope(d.i), boost: d => d.i.code.includes('.') ? 1.1 : 1 });
    return { rows: res.hits.slice(0, MAX).map(h => ({ i: h.doc.i, score: h.score, why })), basis: why };
  }
  // Sub-codes in the Alberta list often read only "Unspecified" or "Ovary"; prefix the parent category for context.
  function icdLabel(i) {
    if (!i.code.includes('.') || i.desc.length > 40) return i.desc;
    let p = ICDBY[i.code.split('.')[0]];
    if (!p && i.code.split('.')[1].length > 1) p = ICDBY[i.code.slice(0, -1)];
    // The source PDF repeats a child's title on a few parent rows (e.g. 618); skip those parents rather than mislabel.
    const dup = p && [...'0123456789'].some(d => { const k = ICDBY[p.code + '.' + d]; return k && p.desc.slice(0, 30).toLowerCase() === k.desc.slice(0, 30).toLowerCase(); });
    return p && p.desc && !dup && !i.desc.toLowerCase().includes(p.desc.toLowerCase()) ? p.desc + ': ' + i.desc : i.desc;
  }
  function renderIcdList(el, rows, emptyMsg) {
    if (!rows.length) { el.innerHTML = '<p class="muted small">' + esc(emptyMsg || 'No ICD-9 suggestions in this scope.') + '</p>'; return; }
    el.innerHTML = rows.map(r => `<div class="icdrow" data-icd="${esc(r.i.code)}"><div><span class="code">${esc(r.i.code)}</span> ${esc(icdLabel(r.i))}
      <div class="small muted">${esc(r.i.block || '')}${r.score != null ? ' · score ' + r.score.toFixed(2) : (r.why ? ' · key match' : '')}</div>${r.why ? `<div class="small why">Why suggested: ${esc(r.why)}</div>` : ''}</div>
      <div class="btns">${PICK.get() ? `<button class="primary pickuse sm" data-pick="dx" data-code="${esc(r.i.code)}" aria-label="Use ${esc(r.i.code)} in MedBilling Logs">Use</button>` : ''}${pselBtn('I', r.i.code)}${star(ik(r.i.code))}<button class="ghost" data-copy="${esc(r.i.code)}">Copy</button><button class="ghost" data-medres="${esc(r.i.code)}">More about this condition</button></div></div>`).join('');
  }
  function icdSearch(q) {
    const el = $('#icdresults');
    q = q.trim(); if (!q) { el.innerHTML = ''; return; }
    let cq = q.toUpperCase().replace(/\s+/g, '');
    if (P && /^([V\d]\d{2}|E\d{3})\d{1,2}$/.test(cq)) cq = cq.replace(/^(E\d{3}|[V\d]\d{2})/, '$1.');
    let rows;
    if (/^(V\d{0,2}|\d{1,3}|E\d{0,3})(\.\d{0,2})?$/.test(cq)) rows = ICD.filter(i => i.code.startsWith(cq) && icdInScope(i)).slice(0, 25).map(i => ({ i }));
    else rows = icdIndex.search(q, { limit: 25, filter: d => icdInScope(d.i), boost: d => d.i.code.includes('.') ? 1.05 : 1 }).hits.map(h => ({ i: h.doc.i, score: h.score }));
    renderIcdList(el, rows);
    if (!rows.length) el.innerHTML = `<p class="muted">No matches in ${esc(JUR === 'AB' ? scopeLabel() : dxName() + ' list')}.</p>`;
  }

  // ------------------------------------------------------------ Medical resources
  // Search term = condition name only. Use the code's own title when it is specific; fall back to parent + title.
  function condTerm(i) {
    const GENERIC = /^(unspecified|other|others|without|with |not specified|site unspecified|closed|open|nos\b|ovary$|uterus$|vagina$|vulva$|breast)/i;
    const own = i.desc.trim();
    let d = own;
    if (own.length < 14 || GENERIC.test(own)) { const lab = icdLabel(i); d = lab.includes(': ') ? lab.split(': ')[0] : lab; }
    if (GENERIC.test(d) && i.block) d = i.block.replace(/\([^)]*\)/g, '').trim();
    d = d.replace(/,\s*(closed|open)$/i, '');
    return d.replace(/\([^)]*\)/g, ' ').replace(/:/g, ' ').replace(/\b(without|with) mention of .*$/i, ' ')
      .replace(/,?\s*(unspecified|not elsewhere classified|nec|other specified|other|unspecified site|not specified as malignant or benign)\b/gi, ' ')
      .replace(/\s+/g, ' ').replace(/[:,\s-]+$/, '').trim() || own;
  }
  function resourcesHtml(icd) {
    const term = icd ? condTerm(icd) : null;
    const regs = region === 'ALL' ? RES.regions : RES.regions.filter(r => r.id === region);
    const item = it => {
      const url = term && it.search ? it.search.replace('{q}', encodeURIComponent(term)) : it.home;
      const kind = term && it.search ? 'search' : 'home';
      return `<li><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(it.name)}</a> <span class="small muted">${kind === 'search' ? 'search' : 'site'}${it.sub ? ' · subscription' : ''}${it.obgy ? ' · OB/GYN' : ''}${it.pt ? ' · patient-facing' : ''}</span></li>`;
    };
    const sel = `<label class="small">Region <select id="regionSel"><option value="ALL">All</option>${RES.regions.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></label>`;
    return `${sel}${regs.map(r => {
      const orgs = r.orgs.filter(o => !o.obgy || skill === 'OBGY' || skill === 'BASE' || !icd);
      const js = r.journals.filter(o => !o.obgy || skill === 'OBGY' || skill === 'BASE' || !icd);
      return `<div class="region"><h3>${esc(r.name)}</h3><ul>${orgs.map(item).join('')}</ul>${r.local ? `<h4>${esc(r.localLabel || 'Regional and local resources')}</h4><ul>${r.local.map(item).join('')}</ul>` : ''}${r.charities ? `<h4>National Health Charities &amp; Organizations</h4><ul>${r.charities.map(item).join('')}</ul>` : ''}<h4>Journals</h4><ul>${js.map(item).join('')}</ul></div>`;
    }).join('')}
    <p class="small muted">External links for reference; MedBilling Fee Desk is not affiliated. Search links carry only the condition name${icd ? ` ("${esc(term)}")` : ''}.</p>
    <p class="small muted">ICD-10/ICD-11 equivalents: no validated crosswalk from the ${JUR === 'AB' ? 'Alberta ICD-9 supplement' : esc(dxName()) + ' list'} is bundled; use the WHO ICD-10/11 browsers above.</p>`;
  }
  function wireRegion(root, icd) {
    const s = $('#regionSel', root); if (!s) return;
    s.value = region;
    s.onchange = () => { region = s.value; LS.set('region', region); if (icd) showMedRes(icd.code); else renderResources(); };
  }
  function aboutHtml() {
    const L = (u, t) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>`;
    return `<div class="card aboutcard"><h3>About MedBilling Fee Desk</h3>
      <p class="small">An independent reference tool made by ${esc(STUDIO_BRAND)}. ${esc(NOT_OFFICIAL)} Fee schedules change; always confirm codes, fees and rules in the current official schedule before you submit a claim.</p>
      <p class="aboutlinks">${L('https://jfdelara.github.io/delara-medbilling/privacy.html', 'Privacy policy')} · ${L('https://jfdelara.github.io/delara-medbilling/terms.html', 'Terms of use')} · ${L('https://jfdelara.github.io/delara-medbilling/support.html', 'Support')} · <a href="licences.html">Open-source licences</a></p>
      <p class="small muted">Suggest a change: <a href="mailto:delaramedbilling@gmail.com?subject=MedBilling%20Fee%20Desk%20feedback">delaramedbilling@gmail.com</a>. Do not include patient details.</p></div>`;
  }
  function renderResources() {
    const el = $('#resources');
    el.innerHTML = `<div class="condhead"><h2>Resources</h2><p class="small muted">Clinical and guideline sources by region. Open “More about this condition” on any diagnostic code for condition-specific searches.</p></div>` + resourcesHtml(null) + (JUR === 'AB' ? ahcipBullHtml() : '') +
      `<div class="card srccard"><h3>Source and credits: ${esc(JINFO ? jn(JINFO) : 'Alberta')}</h3>${sourceNoteHtml()}</div>` + aboutHtml();
    wireRegion(el, null);
  }
  // Top sources: ICD-9 range -> specialty -> ranked top 10 sites and top 10 journals (curated, data/top-sources.json).
  function topSpecialty(i) {
    const code = i.code;
    for (const m of TOP.map) {
      if (m.kind === 'x' && m.val.some(p => code === p || code.startsWith(p + '.') || (p.includes('.') && code.startsWith(p)))) return m.sp;
      if (m.kind === 'e' && code[0] === 'E') return m.sp;
      if (m.kind === 'v' && code[0] === 'V') { const n = parseInt(code.slice(1, 3), 10); if (n >= m.val[0] && n <= m.val[1]) return m.sp; }
      if (m.kind === 'n' && /^\d/.test(code)) { const n = parseInt(code.slice(0, 3), 10); if (n >= m.val[0] && n <= m.val[1]) return m.sp; }
    }
    return 'gen';
  }
  function topSourcesHtml(i) {
    const sp = TOP.specialties[topSpecialty(i)], term = condTerm(i), qe = encodeURIComponent(term);
    const sub = x => x.sub ? ' <span class="badge sub">subscription</span>' : '';
    const sites = sp.sites.map(k => TOP.sites[k]).map(s => `<li><a href="${esc(s.search ? s.search.replace('{q}', qe) : s.home)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a> <span class="small muted">${s.search ? 'search' : 'site'}</span>${sub(s)}</li>`).join('');
    const jours = sp.journals.map(k => TOP.journals[k]).map(j => `<li><a href="${esc('https://pubmed.ncbi.nlm.nih.gov/?term=' + encodeURIComponent(term + ' AND "' + j.nlm + '"[jour]'))}" target="_blank" rel="noopener noreferrer">${esc(j.name)}</a> <span class="small muted">PubMed in journal · <a href="${esc(j.home)}" target="_blank" rel="noopener noreferrer">journal site</a></span>${sub(j)}</li>`).join('');
    return `<div class="topsrc"><h3>Top sources for <span class="code">${esc(i.code)}</span> ${esc(icdLabel(i))}</h3>
      <p class="small muted">${esc(sp.label)}. Ranked by authority, then relevance. Searches carry only "${esc(term)}".</p>
      <div class="topgrid"><div><h4>Top 10 websites</h4><ol>${sites}</ol></div><div><h4>Top 10 journals</h4><ol>${jours}</ol></div></div></div>
      <h3>Directory by region</h3>`;
  }
  function showMedRes(code) {
    const i = ICDBY[code]; if (!i) return;
    addRecent(ik(code));
    let sec = $('#tab-medres');
    if (!sec) { sec = document.createElement('section'); sec.id = 'tab-medres'; sec.className = 'tab'; $('#main').appendChild(sec); }
    const dxDesc = icdLabel(i);
    sec.innerHTML = `<div class="condhead"><div class="small muted">Medical resources</div><h2><span class="code">${esc(i.code)}</span>${star(ik(i.code))} ${esc(dxDesc)}</h2>
      <div class="small muted">${esc(i.block || '')}${i.excl ? ' · ' + esc(i.excl) : ''}</div>
      <div class="row mt8"><button class="ghost" data-copy="${esc(i.code)}">Copy ${esc(dxName())}</button>${pickBtn('dx', i.code)}<button class="ghost" id="medBack">Back</button></div></div>` + topSourcesHtml(i) + resourcesHtml(i);
    wireRegion(sec, i);
    $('#medBack', sec).onclick = () => history.back();
    showTab('medres');
    window.scrollTo(0, 0);
    if (location.hash !== '#/medres/' + code) history.pushState(null, '', '#/medres/' + code);
  }

  // ------------------------------------------------------------ other tabs
  function renderPrice() {
    if (P) { provPrice(); return; }
    if (JUR !== 'AB') return;
    const f = ($('#pf').value || '').trim().toLowerCase();
    const cq = f.toUpperCase().replace(/\s+/g, '');
    const rows = CODES.filter(c => !f || c.code.startsWith(cq) || (c.desc || '').toLowerCase().includes(f) || (c.section || '').toLowerCase().includes(f) || (c.sub || '').toLowerCase().includes(f));
    const show = rows.slice(0, 300);
    $('#pricelist').innerHTML = `<p class="small muted pad">${rows.length.toLocaleString()} of ${CODES.length.toLocaleString()} fee codes${rows.length > 300 ? ' (first 300 shown; refine the filter)' : ''}. Fee column uses specialty ${esc(skill === 'BASE' ? 'base' : skill)}.</p>
      <table><thead><tr><th>Fee code</th><th>Description</th><th>Base</th><th>${esc(skill === 'BASE' ? 'Fee' : skill)}</th><th>ANE</th><th>Cat</th></tr></thead><tbody>
      ${show.map(c => { const fe = feeFor(c); return `<tr><td class="nowrap">${star('H:' + c.code)}<a class="code" href="#/code/${esc(c.code)}">${esc(c.display || c.code)}</a></td><td>${esc(c.desc)}</td><td>${c.byAssess ? 'By assess' : money(c.base)}</td><td class="fee">${fe.amount == null ? '—' : money(fe.amount)}</td><td>${c.ane != null ? money(c.ane) : ''}</td><td>${esc(c.cat || '')}</td></tr>`; }).join('')}
      </tbody></table>`;
  }
  function renderRules() {
    if (P) { provRules(); return; }
    if (JUR !== 'AB') return;
    const f = ($('#rf').value || '').trim().toLowerCase();
    const rows = RULES.filter(r => !f || r.id === f || r.id.startsWith(f + '.') || r.text.toLowerCase().includes(f));
    $('#rules').innerHTML = `<p class="small muted">Medical governing rules, SOMB effective ${esc(fmtDate(META.sombEffective))} — ${rows.length} of ${RULES.length} rules. <a target="_blank" rel="noopener noreferrer" href="${esc(pdfUrl('rules'))}">PDF</a></p>` +
      rows.map(r => `<div class="rule" id="gr-${esc(r.id)}"><span class="code">GR ${esc(r.id)}</span>${grLinks(r.text)} <a class="small" target="_blank" rel="noopener noreferrer" href="${esc(pdfUrl('rules'))}#page=${r.page}">p.</a></div>`).join('');
  }
  // ---- Modifier search (v36): every AHCIP fee modifier from the official "Fee modifier definitions" (SOMB, data/modifier-search.json,
  // built by scripts/build-modifier-search.py from the Alberta Health PDF; nothing added). Search by code, type or words; each code
  // shows its meaning, whether it is explicit (entered on the claim) or implicit (derived by the claims system), the type's rule
  // text and on how many HSCs the price list lists it. In multi-code pick mode, explicit modifiers can be selected (＋ or tap).
  let modKind = 'all', modKindSet = false;
  const MODSHOW = 80;
  function modSearch(q, kind) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean), cq = q.toUpperCase().replace(/\s+/g, ' ').trim(), out = [];
    MODX.codes.forEach(o => {
      if ((kind === 'E' && o.k !== 'E') || (kind === 'I' && o.k !== 'I')) return;
      if (!terms.length) { out.push({ o, s: 0 }); return; }
      const T = MODXT[o.t] || {}, hay = (o.c + ' ' + o.t + ' ' + (T.n || '') + ' ' + o.n + ' ' + o.x + ' ' + (T.x || '')).toLowerCase();
      if (!terms.every(w => hay.includes(w))) return;
      const words = (o.n + ' ' + (T.n || '')).toLowerCase().split(/[^a-z0-9]+/);
      let s = 1;
      if (o.c === cq) s = 100; else if (o.c.startsWith(cq)) s = 80; else if (o.t === cq) s = 60; else if (o.t.startsWith(cq)) s = 50;
      else if (terms.every(w => words.some(x => x.startsWith(w)))) s = 30; else if (terms.every(w => (o.n + ' ' + o.d).toLowerCase().includes(w))) s = 15;
      out.push({ o, s: s + (o.k === 'E' ? 2 : 0) + Math.min(o.h, 2000) / 4000 });
    });
    if (terms.length) out.sort((a, b) => b.s - a.s);
    return out.map(x => x.o);
  }
  function modRow(o) {
    const T = MODXT[o.t] || {};
    const acts = o.a.filter(a => a[0]).map(a => esc(a[0]) + (o.a.length > 1 ? ` (${a[1]})` : '')).join('; ');
    const ex = o.e.map(c => BYCODE[c] ? `<a href="#/code/${esc(c)}">${esc(c)}</a>` : esc(c)).join(', ');
    return `<div class="modrow${o.k === 'E' ? ' mx' : ''}" data-mod="${esc(o.c)}"${o.k === 'E' ? ' data-mx="1"' : ''}>
      <div class="mr1"><span class="code">${esc(o.c)}</span><span class="mname">${esc(modNice(o.n))}</span>${o.k === 'E' && JUR === 'AB' ? `<button type="button" class="mgrp" data-modgrp="${esc(o.c)}" aria-label="Add modifier ${esc(o.c)} to a code group" title="Add to a code group">${groupsOfMod(o.c).length ? '✓ In group' : '+ Group'}</button>` : ''}${pselBtn('M', o.c)}</div>
      <div class="mr2"><span class="badge mk-${o.k}" title="${o.k === 'E' ? 'Explicit: you enter it on the claim' : 'Implicit: derived by the claims system, not entered on the claim'}">${o.k === 'E' ? 'Explicit' : 'Implicit'}</span><span class="mtype">${esc(o.t)} · ${esc(modNice(T.n || ''))}</span>${o.h ? `<span class="mh">on ${o.h.toLocaleString()} fee code${o.h === 1 ? '' : 's'}</span>` : ''}</div>
      ${o.d ? `<div class="mdesc">${esc(o.d)}</div>` : ''}
      <details class="mmore"><summary>When it applies</summary>
        <p><b>${esc(o.t)}</b> <span class="muted">(${o.k === 'E' ? 'explicit: entered on the claim' : 'implicit: derived by the claims system, not entered on the claim'})</span>: ${esc(T.x || '')}</p>
        <p><b>${esc(o.c)}</b>: ${esc(o.x)}</p>
        ${o.h ? `<p>Listed on ${o.h.toLocaleString()} fee code${o.h === 1 ? '' : 's'} in the price list${acts ? ': ' + acts : ''}.${ex ? ' For example ' + ex + (o.h > o.e.length ? ', …' : '') + '.' : ''}</p>` : '<p class="muted">Not listed against specific fee codes in the price list; see the text above.</p>'}
        <p class="small"><a target="_blank" rel="noopener noreferrer" href="${esc(MODX.source.url)}#page=${o.p}">Fee modifier definitions, page ${o.p}</a></p>
      </details></div>`;
  }
  function modSourceHtml() {
    const s = MODX.source, c = MODX.counts;
    return `<p class="small muted modsrc">Source: ${esc(s.publisher)}, Schedule of Medical Benefits: <a target="_blank" rel="noopener noreferrer" href="${esc(s.url)}">${esc(s.title)}</a> (RG122, ${esc(s.edition)} edition, <a target="_blank" rel="noopener noreferrer" href="${esc(s.dataset)}">open.alberta.ca</a>). ${c.codes} modifier codes in ${c.types} types, ${c.explicit} explicit. Fee code counts and actions are from the <a target="_blank" rel="noopener noreferrer" href="${esc(s.usage.url)}">${esc(s.usage.title.replace(/^Medical/, 'medical'))}</a>. Only explicit modifiers can be linked or sent to MedBilling Logs. Always confirm modifier rules in the current SOMB.</p>`;
  }
  function renderMods() {
    const f = ($('#mf').value || '').trim();
    if (!MODX) {   // the search file did not load: the plain list, as before
      const fl = f.toLowerCase();
      $('#modifiers').innerHTML = MODS.filter(t => !fl || t.type.toLowerCase().includes(fl) || t.text.toLowerCase().includes(fl) || t.codes.some(c => c.code.toLowerCase().includes(fl) || c.text.toLowerCase().includes(fl)))
        .map(t => `<div class="rule"><span class="code">${esc(t.type)}</span>${esc(t.text)}${t.codes.length ? `<table><tbody>${t.codes.map(c => `<tr><td class="code">${esc(c.code)}</td><td>${esc(c.text)}</td></tr>`).join('')}</tbody></table>` : ''}</div>`).join('');
      return;
    }
    if (!modKindSet && pickMulti()) modKind = 'E';
    const rows = modSearch(f, modKind), shown = rows.slice(0, f ? MODSHOW : rows.length);
    const kinds = `<div class="modkinds" role="group" aria-label="Show">${[['all', 'All'], ['E', 'Explicit (on the claim)'], ['I', 'Implicit (automatic)']].map(([k, l]) => SPUI.chip({ tag: 'button', cls: 'chip' + (modKind === k ? ' on' : ''), attrs: { 'data-mk': k, 'aria-pressed': String(modKind === k) }, text: l })).join('')}</div>`;
    const head = `<p class="small muted modcount" aria-live="polite">${f ? `${rows.length} modifier${rows.length === 1 ? '' : 's'} match${rows.length === 1 ? 'es' : ''}` : `${rows.length} modifier codes`}${rows.length > shown.length ? `, showing the first ${shown.length}; add words to narrow it` : ''}${pickMulti() ? ' · tap an explicit modifier to send it, or ＋ to select it with other codes' : ''}</p>`;
    let body = '';
    if (!rows.length) body = `<p class="muted pad">No modifiers match “${esc(f)}”. Try a code (CMGP, EV, TELES) or words such as complex, evening, telehealth, assistant.</p>`;
    else if (f) body = shown.map(modRow).join('');
    else { let last = ''; body = shown.map(o => { const T = MODXT[o.t] || {}, h = o.t !== last ? `<h3 class="mtypehead"><span class="code">${esc(o.t)}</span> ${esc(modNice(T.n || ''))} <span class="small muted">${T.k === 'E' ? 'explicit' : 'implicit'}</span></h3>` : ''; last = o.t; return h + modRow(o); }).join(''); }
    $('#modifiers').innerHTML = kinds + head + `<div class="modlist">${body}</div>` + modSourceHtml();
  }
  function renderExpl() {
    const f = ($('#ef').value || '').trim().toLowerCase();
    $('#explanatory').innerHTML = EXPL.filter(e => !f || e.code.toLowerCase().startsWith(f) || (e.title + ' ' + e.text).toLowerCase().includes(f))
      .map(e => `<div class="rule"><span class="code">${esc(e.code)}</span><b>${esc(e.title)}</b> <span class="small muted">${esc(e.group || '')}</span><br>${esc(e.text)}</div>`).join('');
  }
  // Alberta Health Care Insurance Plan bulletin series (official open.alberta.ca pages; all checked 200 on 6 Oct 2026)
  const AHCIP_BULL = [['ARP Bulletins', 'arp'], ['Chiropractic Bulletins', 'chiropractic-services'], ['Dental Bulletins', 'dental-services'], ['General Bulletins', 'general-information'],
    ['Medical Bulletins', 'medical-services'], ['Optometric Bulletins', 'optometric-services'], ['Podiatric Surgery Bulletins', 'podiatric-surgery-services'], ['Podiatry Bulletins', 'podiatry-services']];
  const ahcipBullHtml = () => `<div class="card ahcipbull"><h3>Alberta Health Care Insurance Plan bulletins</h3><ul class="bulllinks">${AHCIP_BULL.map(([n, s]) => `<li><a href="https://open.alberta.ca/publications/bulletin-alberta-health-care-insurance-plan-${s}" target="_blank" rel="noopener noreferrer">${esc(n)}</a></li>`).join('')}</ul><p class="small muted">Official pages on open.alberta.ca (opens outside the app).</p></div>`;
  function renderBulletins() {
    const list = BULL.slice().sort((a, b) => b.num - a.num);
    $('#bulletins').innerHTML = ahcipBullHtml() + `<p class="small muted">AHCIP medical bulletins (MED 251 onward) from <a target="_blank" rel="noopener noreferrer" href="${esc(META.bulletinsDataset)}">open.alberta.ca</a>. fee codes named in a bulletin are flagged on the code detail.</p>` +
      list.map(b => `<div class="bul${b.superseded ? ' sup' : ''}"><b>MED ${b.num}</b> — ${esc(b.title)} <span class="small muted">${esc(b.date || b.created)}</span>
        ${b.superseded ? `<span class="badge s">superseded${b.supersededBy ? ' by MED ' + b.supersededBy : ''}</span>` : ''}
        ${b.supersedes && b.supersedes.length ? `<div class="small muted">Supersedes MED ${b.supersedes.join(', ')}</div>` : ''}
        <div class="small"><a target="_blank" rel="noopener noreferrer" href="${esc(b.url)}">Open PDF</a>${b.codes && b.codes.length ? ` · ${b.codes.length} fee codes: ${b.codes.slice(0, 40).map(c => `<a href="#/code/${esc(c)}">${esc(c)}</a>`).join(', ')}${b.codes.length > 40 ? '…' : ''}` : ''}</div></div>`).join('');
  }
  function hsc(code) { const c = BYCODE[code]; return c ? `<a href="#/code/${code}">${esc(c.display || code)}</a> ${esc(c.desc)} (<span class="fee">${c.byAssess ? 'by assessment' : money(feeFor(c).amount)}</span>)` : esc(code); }
  function gr(id) { return RULEBY[id] ? `<a href="#/rules/${id}">GR ${id}</a>` : 'GR ' + id; }
  function renderNotes() {
    $('#notes').innerHTML = `<div class="notes">
    <p class="small muted">Short claim notes written for MedBilling Fee Desk from the SOMB effective ${esc(fmtDate(META.sombEffective))}. Fees shown for specialty ${esc(skill === 'BASE' ? 'base' : skill)}. The governing rule text prevails.</p>
    <div class="card"><h3>Cesarean section and BMI</h3><ul>
      <li>${hsc('86.9C')}; ${hsc('86.9D')}; ${hsc('86.9B')}. Neither 86.9C nor 86.9D may be claimed with 81.29C (HSC note).</li>
      <li>BMI modifier (BMIPRO for the surgeon/assistant, BMIANE/BMI2AN for anaesthesia) adds 25% where the price list lists it: adult BMI ≥ 40 or paediatric &gt; 97th percentile — ${gr('18.1')}.</li>
      <li>Surgical assist and anaesthesia are claimed under ROLE modifiers (SA, SAQS, ANE); anaesthetic benefit is separate from the surgical fee.</li></ul></div>
    <div class="card"><h3>Prenatal care</h3><ul>
      <li>Initial prenatal visit ${hsc('03.04B')} — once per pregnancy; full history, examination and prenatal record (${gr('8.1.1')}).</li>
      <li>Subsequent prenatal visits ${hsc('03.03B')} / ${hsc('03.03BZ')}; prenatal, emergency and hospital visits may be claimed up to and including the day of delivery, except when delivery occurs within 24 h of admission (${gr('8.1.2')}).</li>
      <li>Obstetrical consultation ${hsc('03.08B')}; repeat obstetrical consultation ${hsc('03.07C')}. Extended perinatology/uro-gynaecology consultation time: ${hsc('03.08M')} when the consultation exceeds 30 min.</li></ul></div>
    <div class="card"><h3>Vaginal delivery</h3><ul>
      <li>${hsc('87.98A')}; VBAC ${hsc('87.98C')}; additional newborn ${hsc('87.98D')}.</li>
      <li>Delivery benefit includes surgical induction, episiotomy and repair of 1st/2nd-degree lacerations, and ordinary immediate newborn care (${gr('8.1.4')}). When delivery occurs within 24 h of admission it includes the admission (03.04C) or hospital visit (03.03D) and post-partum hospital visits for one week (${gr('8.1.5')}).</li>
      <li>Add-ons claimable at 100% with delivery per HSC notes, e.g. ${hsc('87.82')}, ${hsc('87.89A')}, ${hsc('87.6')}, ${hsc('87.99A')}, ${hsc('84.21D')}.</li></ul></div>
    <div class="card"><h3>After-hours (unscheduled services and time premium)</h3><ul>
      <li>Periods: weekday evening 1700-2200, weekend/stat 0700-2200, any night 2200-0700 (${gr('15.3')}). Claim by the time the encounter starts, not the time of the call (${gr('15.6')}).</li>
      <li>SURC (EV, NTPM, NTAM, WK) on eligible fee codes requires a special call on the patient's behalf, unscheduled response outside normal hours, priority attendance and direct attendance (${gr('15.7.1')}). Not claimable when the physician initiates the service (${gr('15.4')}).</li>
      <li>After-hours time premium: ${hsc('03.01AA')} with SURT TEV/TNTP/TNTA/TWK/TST per 15 min of direct care, max 4 per hour (${gr('15.13')}).</li></ul></div>
    <div class="card"><h3>Special callbacks to hospital inpatient</h3><ul>
      <li>${hsc('03.05N')}; ${hsc('03.05P')}; ${hsc('03.05QA')}; ${hsc('03.05QB')}; ${hsc('03.05R')}.</li>
      <li>One callback/unscheduled benefit per encounter (${gr('15.5')}); subsequent inpatients in the same callback use ${hsc('03.03AR')}; ${hsc('03.03DF')} may be added (${gr('15.8')}). Maximums: ${gr('15.11')}.</li></ul></div>
    <div class="card"><h3>Consultations</h3><ul>
      <li>Comprehensive ${hsc('03.08A')} / ${hsc('03.08AZ')}; limited ${hsc('03.07A')}; repeat ${hsc('03.07B')}. Definitions: ${gr('4.3')}; referral requirements: ${gr('4.4')}.</li>
      <li>Comprehensive visits/consultations: once per 365 days per patient by the same physician (${gr('4.6.1')}). Not for transfer of care alone (${gr('4.4.1')}); repeat consultation requires a new referral request (${gr('4.4.6')}).</li>
      <li>Complex consultation modifier CMXC30 (where listed) for consultations meeting its time definition; telephone/video consult ${hsc('03.08CV')}. See MED 289 on telephone consults with invalid practitioner IDs.</li></ul></div>
    </div>`;
  }
  function renderStatic() {
    if (JUR !== 'AB') { renderPrice(); renderRules(); renderResources(); renderIcdScope(); renderSourceNote(); return; }
    renderPrice(); renderRules(); renderMods(); renderExpl(); renderBulletins(); renderNotes(); renderResources(); renderIcdScope(); $('#limitSkill').disabled = !SKILL_SECTIONS[skill]; }

  // ------------------------------------------------------------ Ask AI (links only; prompt never includes typed text)
  const AIS = [
    { id: 'grok', name: 'Grok', url: p => 'https://grok.com/?q=' + encodeURIComponent(p) },
    { id: 'chatgpt', name: 'ChatGPT', url: p => 'https://chatgpt.com/?q=' + encodeURIComponent(p) },
    { id: 'claude', name: 'Claude', url: p => 'https://claude.ai/new?q=' + encodeURIComponent(p) },
    { id: 'gemini', name: 'Gemini', url: () => 'https://gemini.google.com/app', copy: true },
    { id: 'perplexity', name: 'Perplexity', url: p => 'https://www.perplexity.ai/search?q=' + encodeURIComponent(p) },
    { id: 'grokipedia', name: 'Grokipedia', url: (p, t) => 'https://grokipedia.com/search?q=' + encodeURIComponent(t || 'Alberta Schedule of Medical Benefits') }
  ];
  const effShort = () => shortDate(META.sombEffective);
  function codePrompt(c) {
    if (P) { const d = (c.desc || '').slice(0, 160), m = P.meta; return { text: `${m.name} ${m.title}, ${m.codeLabel.toLowerCase()} code ${c.code} (${d})${m.skills.length && skill ? ', ' + skillName() : ''}, ${m.effectiveLabel.replace(/^./, ch => ch.toLowerCase())}: explain billing rules, common modifiers and appropriate ${dxName()} diagnostic codes. Verify against the current ${m.name} ${m.title}.`, topic: d }; }
    const d = (c.desc || '').slice(0, 160);
    return { text: `Alberta SOMB health service code ${c.code} (${d}), specialty ${skill === 'BASE' ? 'not specified' : skill}, effective ${effShort()}: explain billing rules, common modifiers and appropriate ICD-9 codes. Verify against the current SOMB.`, topic: d };
  }
  function generalPrompt() {
    if (JUR !== 'AB') { const n = JINFO ? JINFO.name : JUR, t = P ? P.meta.title : 'physician fee schedule'; return { text: `${n} ${t}${P ? ', ' + P.meta.effectiveLabel.replace(/^./, ch => ch.toLowerCase()) : ''}: explain how to choose fee codes, modifiers and diagnostic codes for physician billing. Verify against the current official ${n} schedule.`, topic: n + ' physician fee schedule' }; }
    return { text: `Alberta Schedule of Medical Benefits (SOMB), specialty ${skill === 'BASE' ? 'not specified' : skill}, effective ${effShort()}: explain how to choose health service codes, modifiers and ICD-9 diagnostic codes. Verify against the current SOMB.`, topic: 'Alberta Schedule of Medical Benefits' };
  }
  let aiPrompt = null, aiPick = null;
  function openAI(p) {
    aiPrompt = p; aiPick = null;
    const dlg = $('#aiDialog');
    $('#aiPrompt').textContent = p.text;
    const last = LS.get('ai', '');
    const order = AIS.slice().sort((a, b) => (b.id === last) - (a.id === last));
    $('#aiList').innerHTML = order.map(a => `<button type="button" data-ai="${a.id}" class="${a.id === last ? 'last' : ''}">${esc(a.name)}${a.copy ? '<br><span class="small muted">copies prompt</span>' : ''}${a.id === last ? '<br><span class="small muted">last used</span>' : ''}</button>`).join('');
    $('#aiConfirm').hidden = true; $('#aiList').hidden = false; $('#aiMsg').textContent = '';
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }
  function wireAI() {
    $('#aiList').addEventListener('click', e => {
      const b = e.target.closest('button[data-ai]'); if (!b) return;
      aiPick = AIS.find(a => a.id === b.dataset.ai);
      $('#aiConfirmText').textContent = `This opens ${aiPick.name} outside MedBilling Fee Desk. Do not add patient names, PHN, DOB, chart or claim numbers.`;
      $('#aiList').hidden = true; $('#aiConfirm').hidden = false;
    });
    $('#aiBack').onclick = () => { $('#aiConfirm').hidden = true; $('#aiList').hidden = false; };
    $('#aiGo').onclick = async () => {
      if (!aiPick || !aiPrompt) return;
      LS.set('ai', aiPick.id);
      const url = aiPick.url(aiPrompt.text, aiPrompt.topic);
      if (aiPick.copy) {
        const w = window.open('about:blank', '_blank');
        const ok = await copy(aiPrompt.text, null);
        $('#aiMsg').textContent = ok ? 'Prompt copied, paste it.' : 'Copy failed; select the prompt above and copy it.';
        toast(ok ? 'Prompt copied, paste it' : 'Copy the prompt manually');
        if (w) { w.opener = null; w.location.href = url; } else window.open(url, '_blank', 'noopener');
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
        $('#aiDialog').close();
      }
    };
  }

  // ------------------------------------------------------------ misc
  async function copy(text, note) {
    try { await navigator.clipboard.writeText(text); if (note) toast(note); return true; }
    catch (e) {
      try { const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); if (ok && note) toast(note); return ok; } catch (e2) { return false; }
    }
  }
  // M1-e: honours its duration; sized to the sticky app bar so it lies over the bar, never over list rows
  let tt; function toast(t, ms) { if (window.MBSuite) return window.MBSuite.toast(t, ms); const el = $('#toast'), top = $('.top'); if (top) document.documentElement.style.setProperty('--toph', Math.max(44, Math.round(top.getBoundingClientRect().height)) + 'px');
    el.textContent = t; el.hidden = false; clearTimeout(tt); tt = setTimeout(() => el.hidden = true, ms > 0 ? ms : 2200); }
  // M1-e: brief shake + highlight on a row that can't be picked here (a fee row in a Dx pick)
  function nope(el) { if (!el) return; el.classList.remove('nope'); void el.offsetWidth; el.classList.add('nope'); setTimeout(() => el.classList.remove('nope'), 700); }

  function wire() {
    if ($('#moreBtn')) $('#moreBtn').addEventListener('click', e => { e.stopPropagation(); const m = $('#moreMenu'); m.hidden = !m.hidden; $('#moreBtn').setAttribute('aria-expanded', String(!m.hidden)); });
    if ($('#moreMenu')) $('#moreMenu').addEventListener('click', e => { if (e.target.closest('a[href]')) { closeMore(); return; } const b = e.target.closest('button[data-tab]'); if (!b) return; closeMore(); if (b.dataset.tab === 'procedures') { goHome(); return; } showTab(b.dataset.tab); history.replaceState(null, '', '#/' + b.dataset.tab); window.scrollTo(0, 0); });
    document.addEventListener('click', e => { if (!e.target.closest('.morewrap')) closeMore(); });
    $('#layoutToggle').addEventListener('click', () => {
      LS.set('layout', phone ? 'desktop' : 'phone'); applyLayout();
      if (current) showCode(current, true); else { $('.split').classList.remove('showing'); }
      if (lastQuery) doSearch(lastQuery, true);
    });
    window.addEventListener('resize', () => { if (!LS.get('layout', '')) { const was = phone; applyLayout(); if (was !== phone && current) showCode(current, true); } });
    $('#tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (!b) return; const t = b.dataset.tab;
      if (t === 'fav') { openFavTab(); history.replaceState(null, '', '#/fav'); window.scrollTo(0, 0); return; }
      showTab(t); history.replaceState(null, '', t === 'procedures' && current ? '#/code/' + current : '#/' + (t === 'codes' ? codesSub() : t)); if (t !== 'procedures') window.scrollTo(0, 0); });
    $('#codesPick').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (!b) return; showTab(b.dataset.tab); history.replaceState(null, '', '#/' + b.dataset.tab); });
    // Favourites: Manage opens the table; the table's back button returns to the list
    $('#results').addEventListener('click', e => { if (e.target.closest('#favManage')) { showTab('favmanage'); history.replaceState(null, '', '#/favmanage'); window.scrollTo(0, 0); } });
    $('#fmBack').addEventListener('click', () => { openFavTab(); history.replaceState(null, '', '#/fav'); });
    // Settings: text size + one backup (favourites with links, groups and recent codes, plus these settings)
    const sz = $('#spSize'); sz.value = String(textSizeIx()); sz.addEventListener('input', () => { LS.set('textsize', String(TEXT_SIZES[+sz.value] || 1)); applyTextSize(); });
    // move-prep: Export my data / Import my data (shared js/shared/move.js). Fee Desk keeps everything in localStorage under
    // 'mb.' (favourites, recent, links, groups, names, bundles, saved times, province, specialty, text size, layout, region,
    // SI choice, code subset). It uses no IndexedDB. Session-only keys (pick, pick tray, banner dismissal) are not exported.
    if (window.MBMove) {
      const MV = window.MBMove, keep = k => /^mb\./.test(k) && !/^mb\.(pick|picktray|move)\./.test(k);
      const n = v => { try { const o = JSON.parse(v); return Array.isArray(o) ? o.length : (o && typeof o === 'object' ? Object.keys(o).length : 1); } catch (e) { return v ? 1 : 0; } };
      const ROWS = [['favourites', 'Favourite codes'], ['recent', 'Recent codes'], ['links', 'Linked codes'], ['groups', 'Favourite groups'], ['settings', 'Settings'], ['keys', 'Stored items (total)']];
      const FAVK = { 'mb.favs': 'favourites', 'mb.recent': 'recent', 'mb.favlinks': 'links', 'mb.favmodlinks': 'links', 'mb.favgroups': 'groups' };
      const SETK = ['mb.jur', 'mb.skill', 'mb.textsize', 'mb.layout', 'mb.region', 'mb.ai', 'mb.codesub'];
      const countOf = snap => { const c = { favourites: 0, recent: 0, links: 0, groups: 0, settings: 0, keys: 0 };
        Object.keys(snap).forEach(k => { c.keys++; if (FAVK[k]) c[FAVK[k]] += n(snap[k]); else if (SETK.includes(k)) c.settings++; }); return c; };
      MV.init({ appId: 'feedesk', appVersion: 'mb-v57-20261026-privacy-link-b13', settingsMount: '#spSettings', bannerMount: '#main', toast,
        exportData: async () => { const snap = MV.lsSnapshot(localStorage, keep);
          return { data: { localStorage: snap, indexedDB: {} }, counts: countOf(snap), inventory: { localStorage: Object.keys(snap), indexedDB: [], notExported: ['sessionStorage (pick in progress, banner dismissed)', 'offline cache (app files, downloaded again)'] } }; },
        // b: older Fee Desk backup files (kind 'favourites', from Back up favourites & settings or the Favourites export) are
        // still accepted here. Merge only, through the same favourites import as before; specialty and text size come back too.
        readLegacy: async o => { if (!o || typeof o !== 'object' || (o.app && o.app !== 'MedBilling Fee Desk')) return false;
          let p; try { p = parseImport(JSON.stringify(o)); } catch (e) { return false; }
          const st = p.settings && typeof p.settings === 'object' ? ['province', 'specialty', 'textSize'].filter(k => p.settings[k] != null).length : 0;
          const when = o.exported ? String(o.exported).slice(0, 10) : '';
          return { from: `Older Fee Desk backup file${when ? ' from ' + when : ''}`, modes: ['merge'], notes: [MV.T.legacy(o.version)],
            counts: { favourites: p.fav.length, recent: p.rec.length, links: p.links.length + p.modLinks.length, groups: p.groups.length, settings: st, keys: p.fav.length + p.rec.length },
            rows: ROWS.filter(r => r[0] !== 'keys'),
            apply: async () => { const m = applyParsed(p, 'file', true, true);
              return { reload: true, message: m ? m.replace(/\.$/, '') : 'Nothing new in that file: everything in it is already here' }; } }; },
        readImport: async env => { const snap = env.data.localStorage; if (!snap || typeof snap !== 'object' || Array.isArray(snap) || Object.values(snap).some(v => typeof v !== 'string')) throw new MV.MoveError('bad', MV.ERR.bad);
          const clean = {}; Object.keys(snap).forEach(k => { if (keep(k)) clean[k] = snap[k]; });
          return { counts: countOf(clean), rows: ROWS, apply: async mode => { const r = MV.lsApply(localStorage, clean, mode, keep);
            return { reload: true, message: mode === 'replace' ? `Imported (replace): ${r.added} items written, ${r.removed} removed` : `Imported (merge): ${r.added} added, ${r.merged} combined, ${r.kept} kept as they were` }; } }; } });
    }
    const q = $('#q'), clr = $('#qclear');
    $('#qform').addEventListener('submit', e => { e.preventDefault(); q.blur(); doSearch(q.value); });
    q.addEventListener('input', () => { clr.hidden = !q.value; });
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); q.blur(); doSearch(q.value); } });
    clr.addEventListener('click', () => { q.value = ''; clr.hidden = true; doSearch(''); q.focus(); });
    $('#limitSkill').addEventListener('change', () => lastQuery && doSearch(lastQuery, true));
    $('#results').addEventListener('click', e => {
      if (e.target.closest('[data-dropremoved]')) { removeHiddenSheet(); return; }
      const dh = e.target.closest('[data-dropheld]');
      if (dh) { const id = dh.dataset.dropheld, m = k => splitKey(k).jur === id; FAVS = FAVS.filter(k => !m(k)); RECENT = RECENT.filter(k => !m(k));
        Object.keys(TS.f).forEach(k => { if (m(k)) delete TS.f[k]; }); Object.keys(TS.r).forEach(k => { if (m(k)) delete TS.r[k]; }); saveLists(); renderSaved(); toast('Hidden codes removed'); return; }
      if (e.target.closest('#clearRecent')) { RECENT = []; TS.r = {}; saveLists(); renderSaved(); toast('Recent codes cleared'); return; }
      if (e.target.closest('#expSaved')) { exportSaved(); return; }
      if (e.target.closest('#impSaved')) { const f = $('#impFile'); f.value = ''; f.click(); return; }
      // v34 favourite groups
      const tg = e.target.closest('[data-fgtoggle]'); if (tg) { toggleGroup(tg.dataset.fgtoggle); return; }
      const gm = e.target.closest('[data-fgmenu]'); if (gm) { groupSheet(gm.dataset.fgmenu); return; }
      const ga = e.target.closest('[data-fgadd]'); if (ga) { groupPicker(ga.dataset.fgadd); return; }
      if (e.target.closest('#favNewGrp')) { groupEditor(null, id => groupPicker(id)); return; }
      // v38 code groups: sort toggle, Send (multi-code pick), a modifier row (opens it on the Modifiers tab)
      const gs = e.target.closest('[data-gsort]');
      if (gs) { const v = gs.dataset.gsort; if (GSORTS.includes(v) && v !== GS.sort) { GS.sort = v; saveGroups(); renderSaved(); toast(v === 'az' ? 'Groups sorted A–Z' : v === 'recent' ? 'Groups sorted by most recently used' : 'Groups in your own order'); } const b2 = $(`#results [data-gsort="${v}"]`); if (b2) b2.focus({ preventScroll: true }); return; }
      const fs = e.target.closest('[data-fgsend]'); if (fs) { groupSendSheet(fs.dataset.fgsend); return; }
      if (e.target.closest('.favtools')) return;
      const b = e.target.closest('.hit'); if (!b) return;
      if (b.dataset.gmod) { const m = b.dataset.gmod; touchKey('M:' + m); if (JUR === 'AB') { showTab('modifiers'); $('#mf').value = m; renderMods(); history.replaceState(null, '', '#/modifiers/' + encodeURIComponent(m)); window.scrollTo(0, 0); } return; }
      if (b.dataset.jur) { switchJur(b.dataset.jur, b.dataset.icd ? '#/medres/' + b.dataset.icd : '#/code/' + b.dataset.code); return; }
      if (b.dataset.lead && b.dataset.code) { showCode(b.dataset.code); return; }
      if (b.dataset.icd) showMedRes(b.dataset.icd); else showCode(b.dataset.code);
    });
    $('#impFile').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) importSaved(f); });
    $('#results').addEventListener('input', e => { if (e.target.id === 'favq') onFavFilter(e.target.value); });
    $('#results').addEventListener('keydown', e => { if (e.target.id === 'favq' && e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
    if (FAVS.length) persistStorage();
    $$('[data-saved]').forEach(b => b.addEventListener('click', () => { closeMore(); openSaved(b.dataset.saved); }));
    $('#askGeneral').onclick = () => openAI(generalPrompt());
    const iq = $('#iq'), icl = $('#iclear');
    $('#iform').addEventListener('submit', e => { e.preventDefault(); iq.blur(); icdSearch(iq.value); });
    iq.addEventListener('input', () => { icl.hidden = !iq.value; });
    icl.addEventListener('click', () => { iq.value = ''; icl.hidden = true; icdSearch(''); iq.focus(); });
    let t; const deb = fn => () => { clearTimeout(t); t = setTimeout(fn, 150); };
    $('#pf').addEventListener('input', deb(renderPrice)); $('#rf').addEventListener('input', deb(renderRules));
    $('#mf').addEventListener('input', deb(renderMods));
    $('#modifiers').addEventListener('click', e => { const g = e.target.closest('[data-modgrp]'); if (g) { modGroupSheet(g.dataset.modgrp); return; } const b = e.target.closest('[data-mk]'); if (b) { modKind = b.dataset.mk; modKindSet = true; renderMods(); } }); $('#ef').addEventListener('input', deb(renderExpl));
    document.addEventListener('click', e => {
      const c = e.target.closest('[data-copy]'); if (c) { copy(c.dataset.copy, c.dataset.copy + ' copied'); return; }
      const m = e.target.closest('[data-medres]'); if (m) showMedRes(m.dataset.medres);
    });
    wireAI();
  }
  // Pick mode taps (capture phase, before rows open their detail). Fee code: a search result, saved row, price-list code,
  // the big code on its page or "Use … in MedBilling Logs". ICD-9: any ICD-9 row (search, suggested list, saved) or its page.
  // v36: in multi-code mode (pick protocol 2) ＋ selects a code; once something is selected, taps add to the selection; a favourite
  // with linked codes pre-selects its linked set; otherwise a tap sends that one code, as before (pickTap).
  function pickTap(code, kind) {
    code = String(code || '').trim().toUpperCase();
    if (kind === 'hsc' && dxPick()) { toast(DXMSG); return true; }   // M1-d: refuse fee codes in any Dx pick (single or multi)
    if (!pickMulti()) { if (kind !== 'mod') touchKey(kind === 'dx' ? ik(code) : hk(code)); return kind === 'mod' ? false : sendPick(code, kind); }
    const t = kind === 'dx' ? 'I' : kind === 'mod' ? 'M' : 'H';
    if (t === 'M' && !modOk(code)) return false;
    if (trayN()) { trayToggle(t, code); return true; }
    const key = t === 'H' ? hk(code) : t === 'I' ? ik(code) : '';
    touchKey(key || 'M:' + code);
    // M1-b: in a Logs Dx pick (pick=dx) an ICD-9 favourite with linked codes sends only its ICD-9; the fee+ICD-9 tray never opens, so no fee goes into a Dx pick
    const pk = PICK.get(); if (t === 'I' && pk && pk.kind === 'dx') return sendPick(code, kind);
    if (key && isFav(key) && (linksOf(key).some(k => splitKey(k).jur === JUR) || modsOf(key).some(m => modOk(m.slice(2))))) { trayLinked(key); return true; }
    if (t === 'M') return sendMulti({ fee: [], dx: [], dxFor: [], mod: [code], modFor: [''] });
    return sendPick(code, kind);
  }
  function pselKey(v) {   // 'H:03.04A' / 'I:650' / 'M:CMGP' from a ＋ button; must be a real code of this jurisdiction
    const t = v[0], c = v.slice(2);
    if (t === 'M') return modOk(c) ? ['M', c] : null;
    if (t === 'H') return BYCODE[c] ? ['H', c] : null;
    return t === 'I' && ICDBY[c] ? ['I', c] : null;
  }
  document.addEventListener('click', e => {
    const p = PICK.get(); if (!p || !ready) return;
    const t = e.target; if (!t.closest) return;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (t.closest('#picktray')) return;
    const ps = t.closest('[data-psel]'); if (ps) { stop(); const k = pselKey(ps.dataset.psel); if (k && k[0] === 'H' && dxPick()) nope(ps.closest('.hit')); if (k) trayToggle(k[0], k[1]); return; }
    const b = t.closest('[data-pick]'); if (b) { stop(); pickTap(b.dataset.code, b.dataset.pick); return; }
    // v35 linked chip: sends that one code (ICD-9 -> Dx; fee code when picking a fee code); v36 multi-code: also modifiers, and adds to a selection
    const lc = t.closest('[data-lk]');
    if (lc) { const s = splitKey(lc.dataset.lk); if (s.jur === JUR) { if (s.t === 'I' && ICDBY[s.code]) { stop(); pickTap(s.code, 'dx'); } else if (s.t === 'H' && (p.kind === 'hsc' || (pickMulti() && trayN())) && BYCODE[s.code]) { stop(); pickTap(s.code, 'hsc'); } else if (s.t === 'M' && pickMulti() && modOk(s.code)) { stop(); pickTap(s.code, 'mod'); } } return; }
    if (t.closest('#pickbar, [data-fav], [data-favmenu], [data-gmodmenu], [data-modgrp], [data-favlink], #snack, .fgh, .favtools, .fgback, #favNewGrp, [data-fgadd], [data-copy], [data-medres], .pdet, a[target="_blank"], select, input, summary, .mmore, #pBack, #pDoc, #askCode, #copyCode, #medBack, #pMore, [data-mk], dialog')) return;
    const mr = t.closest('.modrow[data-mx]'); if (mr && pickMulti()) { stop(); pickTap(mr.dataset.mod, 'mod'); return; }
    const ir = t.closest('.icdrow'); if (ir && ir.dataset.icd) { stop(); pickTap(ir.dataset.icd, 'dx'); return; }
    const h = t.closest('#results .hit');
    const hscOk = p.kind === 'hsc' || (pickMulti() && trayN());   // picking a Dx: a fee row opens its details, unless a selection is under way
    // M1-e: a fee row in a Dx pick: toast + shake, nothing sent or selected (its ⓘ details control still opens the page)
    if (h && dxPick() && !h.dataset.jur && !h.dataset.gmod && !h.dataset.merged && !h.dataset.icd && h.dataset.code && BYCODE[h.dataset.code]) { stop(); toast(DXMSG); nope(h); return; }
    if (h) { if (h.dataset.jur) return; if (h.dataset.gmod) { if (pickMulti() && modOk(h.dataset.gmod)) { stop(); pickTap(h.dataset.gmod, 'mod'); } return; } if (h.dataset.lead && h.dataset.code && hscOk) { stop(); pickTap(h.dataset.code, 'hsc'); } else if (h.dataset.merged && !hscOk) { stop(); pickTap(splitKey(h.dataset.merged.split(' ')[0]).code, 'dx'); } else if (h.dataset.icd) { stop(); pickTap(h.dataset.icd, 'dx'); } else if (h.dataset.code && hscOk) { stop(); pickTap(h.dataset.code, 'hsc'); } return; }
    const a = t.closest('#pricelist a.code'); if (a && hscOk) { const m = (a.getAttribute('href') || '').match(/^#\/code\/(.+)$/); if (m && BYCODE[decodeURIComponent(m[1])]) { stop(); pickTap(decodeURIComponent(m[1]), 'hsc'); } return; }
    if (t.closest('#detail .codebig') && current) { stop(); if (hscOk && !dxPick()) pickTap(current, 'hsc'); else if (dxPick()) toast(DXMSG); return; }   // M1-d B1
    const mc = t.closest('#tab-medres .condhead h2 .code'); if (mc) { stop(); pickTap(mc.textContent, 'dx'); }
  }, true);
  document.addEventListener('keydown', e => { const s = e.target.closest && e.target.closest('[data-psel]'); if (!s || (e.key !== 'Enter' && e.key !== ' ')) return; e.preventDefault(); e.stopPropagation(); if (ready) s.click(); }, true);
  document.addEventListener('keydown', e => { const d = e.target.closest && e.target.closest('.pdet'); if (d && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); const h = d.closest('.hit'); if (h && h.dataset.code) showCode(h.dataset.code); } });
  // Star toggles run in the capture phase so a tap never opens the row, card or link underneath.
  document.addEventListener('click', e => { const s = e.target.closest && e.target.closest('[data-fav]'); if (!s) return; e.preventDefault(); e.stopPropagation(); if (ready) toggleFav(s.dataset.fav, mergedOf(s, s.dataset.fav)); }, true);
  document.addEventListener('keydown', e => { const s = e.target.closest && e.target.closest('[data-fav]'); if (!s || (e.key !== 'Enter' && e.key !== ' ')) return; e.preventDefault(); e.stopPropagation(); if (ready) toggleFav(s.dataset.fav, mergedOf(s, s.dataset.fav)); }, true);
  function mergedOf(el, key) { const r = el.closest('[data-merged]'); return r && r.dataset.fk === key ? r.dataset.merged.split(' ') : []; }
  // ⋯ on a favourite inside a group: groups for that code (capture phase, so the row underneath doesn't open)
  const favMenu = s => { if (ready) codeSheet(s.dataset.favmenu, { from: s.dataset.g, also: mergedOf(s, s.dataset.favmenu) }); };
  document.addEventListener('click', e => { const s = e.target.closest && e.target.closest('[data-favmenu]'); if (!s) return; e.preventDefault(); e.stopPropagation(); favMenu(s); }, true);
  document.addEventListener('keydown', e => { const s = e.target.closest && e.target.closest('[data-favmenu]'); if (!s || (e.key !== 'Enter' && e.key !== ' ')) return; e.preventDefault(); e.stopPropagation(); favMenu(s); }, true);
  // v38: ⋯ on a modifier inside a code group
  const gmodMenu = s => { if (ready) modGroupSheet(s.dataset.gmodmenu, { from: s.dataset.g }); };
  document.addEventListener('click', e => { const s = e.target.closest && e.target.closest('[data-gmodmenu]'); if (!s) return; e.preventDefault(); e.stopPropagation(); gmodMenu(s); }, true);
  document.addEventListener('keydown', e => { const s = e.target.closest && e.target.closest('[data-gmodmenu]'); if (!s || (e.key !== 'Enter' && e.key !== ' ')) return; e.preventDefault(); e.stopPropagation(); gmodMenu(s); }, true);
  // v35 linked chips beside a favourite: open the linked code (other province: switch); ✎ opens the link picker
  const chipAct = s => { if (!ready) return;
    if (s.dataset.favlink) { linkSheet(s.dataset.favlink); return; }
    const k = splitKey(s.dataset.lk);
    if (k.t === 'M') { if (JUR === 'AB') { showTab('modifiers'); $('#mf').value = k.code; renderMods(); history.replaceState(null, '', '#/modifiers/' + encodeURIComponent(k.code)); window.scrollTo(0, 0); } return; }
    if (k.jur !== JUR) { switchJur(k.jur, k.t === 'I' ? '#/medres/' + k.code : '#/code/' + k.code); return; }
    if (k.t === 'I') { if (ICDBY[k.code]) showMedRes(k.code); } else if (BYCODE[k.code]) showCode(k.code); };
  document.addEventListener('click', e => { if (e.defaultPrevented) return; const s = e.target.closest && e.target.closest('[data-lk], [data-favlink]'); if (!s || s.closest('.fgback')) return; e.preventDefault(); e.stopPropagation(); chipAct(s); }, true);
  document.addEventListener('keydown', e => { const s = e.target.closest && e.target.closest('[data-lk], [data-favlink]'); if (!s || s.closest('.fgback') || (e.key !== 'Enter' && e.key !== ' ')) return; e.preventDefault(); e.stopPropagation(); chipAct(s); }, true);
  // Home link: bound before data loads. Until the app is ready the plain href="./" reload still lands on home.
  let ready = false;
  $('#homeLink').addEventListener('click', e => { if (!ready) return; e.preventDefault(); goHome(); });

  // Service worker: bypass the HTTP cache for sw.js, check for updates on load and when the tab becomes visible,
  // and reload once when a new version takes control so stale code never lingers.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
  }

  // ------------------------------------------------------------ v40: close ✕ on the code detail + Favourites manager tab
  function closeDetail() {
    const el = $('#detail'); if (!el || el.hidden) return;
    current = null; el.hidden = true; el.innerHTML = ''; $('.split').classList.remove('showing');
    $$('.hit').forEach(b => b.classList.remove('sel')); if (!lastQuery) renderSaved();
    history.replaceState(null, '', location.pathname + location.search);
  }
  (function () {
    const el = $('#detail'); if (!el) return;
    const add = () => { if (!el.hidden && el.firstChild && !el.querySelector(':scope > .dclose')) el.insertAdjacentHTML('afterbegin', '<button type="button" class="dclose" aria-label="Close code details" title="Close (Esc)">✕</button>'); };
    new MutationObserver(add).observe(el, { childList: true, attributes: true, attributeFilter: ['hidden'] });
    el.addEventListener('click', e => { if (e.target.closest('.dclose')) { e.preventDefault(); e.stopPropagation(); closeDetail(); } }, true);
    document.addEventListener('keydown', e => { if (e.key !== 'Escape' || sheetEl || $$('dialog[open]').length || el.hidden) return; if (e.target.matches && e.target.matches('input,textarea,select') && e.target.value) return; e.preventDefault(); closeDetail(); });
  })();
  // Custom names: 'mb.favnames' = {<fav key>: name}; device only. Order = FAVS order (↑↓ moves within it).
  const NAMES = (() => { try { const o = JSON.parse(LS.get('favnames', '{}')); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } })();
  const saveNames = () => { Object.keys(NAMES).forEach(k => { if (!FAVS.includes(k) || !NAMES[k]) delete NAMES[k]; }); LS.set('favnames', JSON.stringify(NAMES)); };
  const fmOpen = new Set();
  function fmDesc(key) { const sk = splitKey(key); if (sk.jur !== JUR) return ''; if (sk.t === 'H') return BYCODE[sk.code] ? BYCODE[sk.code].desc : ''; return ICDBY[sk.code] ? icdLabel(ICDBY[sk.code]) : ''; }
  function fmLine(h, dx) {   // bundle line: code · short label · price · [ICD-9]
    const sk = splitKey(h), c = sk.jur === JUR ? BYCODE[sk.code] : null, f = c ? feeFor(c) : null, d = fmDesc(h);
    return `<b>${esc(c ? c.display || c.code : sk.code)}</b> <span title="${esc(d)}" aria-label="${esc(d)}">${esc(shortOf('H', sk.code, d))}</span>${f ? ` <span class="fee">${f.amount == null ? esc(f.label) : money(f.amount)}</span>` : ''}${dx.length ? ` <span class="muted">[${esc(dx.map(x => splitKey(x).code).join(', '))}]</span>` : ''}`;
  }
  // M12: a favourite without a custom name shows its short label (same wording as the list), never "—"
  function fmLabel(k) { const sk = splitKey(k); if (sk.jur === JUR) { if (sk.t === 'H' && BYCODE[sk.code]) return shortOf('H', sk.code, BYCODE[sk.code].desc); if (sk.t === 'I' && ICDBY[sk.code]) return shortOf('I', sk.code, ICDBY[sk.code].desc); } return sk.code; }
  function renderFavManage() {
    const box = $('#fmList'); if (!box) return;
    const q = ($('#fmq').value || '').trim().toLowerCase();
    const keys = FAVS.filter(k => !heldJur(splitKey(k).jur));
    const shown = keys.filter(k => !q || ((NAMES[k] || '') + ' ' + favText(k)).toLowerCase().includes(q));
    const bq = BUNDLES.filter(x => !q || (x.name + ' ' + x.lines.map(l => splitKey(l.h).code + ' ' + l.dx.map(d => splitKey(d).code).join(' ')).join(' ')).toLowerCase().includes(q));
    const bRows = bq.map(x => { const op = fmOpen.has('B:' + x.id), f = x.lines[0];
      return `<div class="fmrow fmb" data-fmb="${esc(x.id)}"><button type="button" class="fmexp" data-fma="exp" aria-expanded="${op}" aria-label="Show all lines">${op ? '▴' : '▾'}</button><span class="fmname">${esc(x.name)}</span><span class="code fmcode">${esc(splitKey(f.h).code)} <span class="badge">+${x.lines.length - 1}</span></span><span class="fmdx">${esc(f.dx.map(d => splitKey(d).code).join(', '))}</span><span class="fmact"><button type="button" data-fma="edit" aria-label="Edit bundle" title="Edit">✎</button><button type="button" data-fma="del" aria-label="Delete bundle" title="Delete">✕</button></span>${op ? `<div class="fmdesc small">${x.lines.map((l, i) => `${i + 1}. ${fmLine(l.h, l.dx)}`).join('<br>')}</div>` : ''}</div>`; }).join('');
    if (!keys.length && !BUNDLES.length) { box.innerHTML = '<p class="muted pad">No favourites yet. Tap + New favourite (one code or a bundle of lines), tap ☆ beside any code, or import a CSV.</p>'; return; }
    box.innerHTML = `<div class="fmhead"><span>Name</span><span>Fee code</span><span>Diagnosis (ICD-9)</span><span></span></div>` + bRows + (shown.map(k => {
      const sk = splitKey(k), i = FAVS.indexOf(k), op = fmOpen.has(k);
      const dx = sk.t === 'H' ? linksOf(k).map(x => splitKey(x).code).join(', ') : '';
      const desc = fmDesc(k), lnk = linksOf(k).map(x => `${splitKey(x).code} ${fmDesc(x)}`).join(' · ');
      return `<div class="fmrow" data-fmk="${esc(k)}"><button type="button" class="fmexp" data-fma="exp" aria-expanded="${op}" aria-label="Show description">${op ? '▴' : '▾'}</button><span class="fmname${NAMES[k] ? '' : ' fmlbl'}">${esc(NAMES[k] || fmLabel(k))}</span><span class="code fmcode">${esc(sk.code)}${sk.jur !== JUR ? ` <span class="badge j">${esc(sk.jur)}</span>` : ''}</span><span class="fmdx">${esc(dx || (sk.t === 'I' ? 'ICD-9' : ''))}</span><span class="fmact"><button type="button" data-fma="up" aria-label="Move up"${i <= 0 || q ? ' disabled' : ''}>↑</button><button type="button" data-fma="down" aria-label="Move down"${i >= FAVS.length - 1 || q ? ' disabled' : ''}>↓</button><button type="button" data-fma="edit" aria-label="Rename" title="Edit name">✎</button><button type="button" data-fma="del" aria-label="Delete favourite" title="Delete">✕</button></span>${op ? `<div class="fmdesc small">${esc(desc || 'Saved under ' + sk.jur)}${lnk ? `<br><span class="muted">Linked: ${esc(lnk)}</span>` : ''}</div>` : ''}</div>`;
    }).join('') || (bRows ? '' : '<p class="muted pad">No favourites match.</p>'));
  }
  function csvCell(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function parseCsv(t) {
    const rows = []; let r = [], c = '', q = false;
    for (let i = 0; i < t.length; i++) { const ch = t[i];
      if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { r.push(c); c = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; r.push(c); rows.push(r); r = []; c = ''; } else c += ch; }
    if (c || r.length) { r.push(c); rows.push(r); } return rows.filter(x => x.some(y => y.trim()));
  }
  function fmExport() {
    const lines = [['name', 'type', 'code', 'jurisdiction', 'linked icd9', 'bundle'].join(',')].concat(FAVS.map(k => { const s = splitKey(k);
      return [NAMES[k] || '', s.t === 'H' ? 'HSC' : 'ICD9', s.code, s.jur, s.t === 'H' ? linksOf(k).map(x => splitKey(x).code).join(' ') : '', ''].map(csvCell).join(','); }),
      BUNDLES.flatMap(b => b.lines.map(l => { const s = splitKey(l.h); return [b.name, 'HSC', s.code, s.jur, l.dx.map(d => splitKey(d).code).join(' '), 'yes'].map(csvCell).join(','); })));
    const a = document.createElement('a'), d = new Date().toISOString().slice(0, 10);
    a.href = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' })); a.download = `fee-desk-favourites-${d}.csv`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); toast('Exported ' + FAVS.length + ' favourites' + (BUNDLES.length ? ` and ${BUNDLES.length} bundles` : ''));
  }
  function fmImport(file) {
    const r = new FileReader(); r.onload = () => {
      const rows = parseCsv(String(r.result)); if (!rows.length) return alert('Import failed: empty CSV.');
      const h = rows[0].map(x => x.trim().toLowerCase()), ix = n => h.indexOf(n);
      if (ix('code') < 0) return alert('Import failed: the CSV needs a "code" column (columns: name, type, code, jurisdiction, linked icd9).');
      let add = 0, skip = 0, ren = 0, lk = 0; const mk = (t, j, c) => t + ':' + (j === 'AB' ? '' : j + '|') + c;
      const nb = {};
      rows.slice(1).forEach(x => { const g = n => ix(n) >= 0 ? (x[ix(n)] || '').trim() : '';
        if (/^(y|yes|1|true)$/i.test(g('bundle')) && g('name')) { const code = g('code').toUpperCase(), j = (g('jurisdiction') || JUR).toUpperCase();
          if (!code || (j === JUR && !BYCODE[code])) { skip++; return; }
          (nb[g('name')] = nb[g('name')] || []).push({ h: mk('H', j, code), dx: g('linked icd9').split(/[\s;]+/).filter(Boolean).map(d => d.toUpperCase()).filter(d => j !== JUR || ICDBY[d]).slice(0, LMAX).map(d => mk('I', j, d)) }); return; }
        const code = g('code').toUpperCase(), j = (g('jurisdiction') || JUR).toUpperCase(), t = /icd/i.test(g('type')) ? 'I' : 'H';
        if (!code || (j === JUR && (t === 'H' ? !BYCODE[code] : !ICDBY[code]))) { skip++; return; }
        const k = mk(t, j, code); if (!FAVS.includes(k)) { FAVS.push(k); add++; }
        if (g('name')) { NAMES[k] = g('name').slice(0, 80); ren++; }
        if (t === 'H') g('linked icd9').split(/[\s;]+/).filter(Boolean).forEach(d => { d = d.toUpperCase(); if (j !== JUR || !ICDBY[d]) return; const ik = mk('I', j, d); if (!addLink(k, ik)) lk++; }); });
      let nbn = 0; Object.keys(nb).forEach(n => { const ls = nb[n].slice(0, BMAX), ex = BUNDLES.find(b => b.name === n);
        if (ex) ex.lines = ls; else BUNDLES.push({ id: 'b' + Date.now().toString(36) + (nbn), name: n, lines: ls }); nbn++; }); if (nbn) saveBundles();
      saveLists(); saveNames(); renderFavManage(); renderSaved();
      toast((nbn ? `${nbn} bundle${nbn === 1 ? '' : 's'}; ` : '') + `Imported ${add} new favourite${add === 1 ? '' : 's'}, ${ren} name${ren === 1 ? '' : 's'}, ${lk} link${lk === 1 ? '' : 's'}` + (skip ? `; ${skip} unknown skipped` : ''));
    }; r.readAsText(file);
  }
  // v41: Favourite bundles 'mb.favbundles' = [{id, name, lines:[{h:<fee key>, dx:[<icd keys>]}]}], 2..BMAX lines, device only.
  // The "+ New favourite" editor: name + lines (fee code + optional ICD-9 each); 1 line saves a normal favourite, 2+ a bundle.
  const BMAX = 10;
  const BUNDLES = (() => { try { const o = JSON.parse(LS.get('favbundles', '[]')); return Array.isArray(o) ? o.filter(x => x && Array.isArray(x.lines)) : []; } catch (e) { return []; } })();
  const saveBundles = () => LS.set('favbundles', JSON.stringify(BUNDLES));
  function fmNewSheet(bid) {
    const ed = bid ? BUNDLES.find(x => x.id === bid) : null;
    let lines = ed ? ed.lines.map(l => ({ h: l.h, dx: l.dx.slice() })) : [{ h: null, dx: [] }];
    const body = `<label class="fgsub" for="nfName">Name</label><div class="inputwrap"><input id="nfName" maxlength="80" placeholder="e.g. TAH + BSO/Cysto" aria-label="Favourite name" value="${esc(ed ? ed.name : '')}"></div>
      <div id="nfLines"></div>
      <button type="button" class="ghost nfadd" id="nfAdd">+ Add line</button>
      <p class="fgerr" id="nfErr" role="alert" hidden></p>
      <div class="fgacts"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="primary" id="nfSave">Save favourite</button></div>`;
    openSheet('fmNewSheet', ed ? '★ Edit favourite' : '★ New favourite', body, el => {
      const chip = (k, attr) => `<div class="lkrow k-${k[0]}"><span class="code">${esc(splitKey(k).code)}</span><span class="lkd">${esc(shortDesc(k, true))}</span><button type="button" class="ghost lkrm" ${attr}>${k[0] === 'H' ? 'Change' : 'Remove'}</button></div>`;
      const opt = (k, on, attr) => `<button type="button" class="lkopt" ${attr}="${esc(k)}" aria-pressed="${on}"><span class="code">${esc(splitKey(k).code)}</span><span class="lkd">${esc(shortDesc(k, true))}</span>${pickPrice(k)}<span class="lkst">${on ? '✓' : '+'}</span></button>`;
      const paint = () => {
        $('#nfLines', el).innerHTML = lines.map((l, i) => `<div class="nfline" data-li="${i}"><div class="nflh"><b>Line ${i + 1}</b>${lines.length > 1 ? `<button type="button" class="ghost nfx" data-nfdel aria-label="Remove line ${i + 1}">✕</button>` : ''}</div>
          ${l.h ? chip(l.h, 'data-nfun') : `<div class="inputwrap fgq"><input class="nfq" type="search" autocapitalize="off" spellcheck="false" placeholder="Fee code: search by code or words" aria-label="Search fee codes, line ${i + 1}"></div><div class="fgopts lkres nfres"></div>`}
          ${l.dx.map(k => chip(k, `data-nfdrm="${esc(k)}"`)).join('')}
          ${l.dx.length < LMAX ? `<div class="inputwrap fgq"><input class="nfd" type="search" autocapitalize="off" spellcheck="false" placeholder="ICD-9 (optional): search" aria-label="Search ICD-9 codes, line ${i + 1}"></div><div class="fgopts lkres nfdres"></div>` : ''}</div>`).join('');
        $('#nfAdd', el).hidden = lines.length >= BMAX;
      };
      const err = m => { const e = $('#nfErr', el); e.textContent = m; e.hidden = !m; };
      paint(); const f0 = $(ed ? '#nfName' : '.nfq', el); if (f0) f0.focus();
      el.addEventListener('input', e => {
        const ln = e.target.closest('.nfline'); if (!ln) return; const l = lines[+ln.dataset.li], v = e.target.value.trim();
        if (e.target.matches('.nfq')) $('.nfres', ln).innerHTML = v ? (searchCodes('H', v).map(k => opt(k, false, 'data-nfh')).join('') || '<p class="muted small lknone">No matching fee codes.</p>') : '';
        if (e.target.matches('.nfd')) $('.nfdres', ln).innerHTML = v ? (searchCodes('I', v).map(k => opt(k, l.dx.includes(k), 'data-nfi')).join('') || '<p class="muted small lknone">No matching ICD-9 codes.</p>') : '';
      });
      el.addEventListener('click', e => {
        const t = e.target.closest('[data-nfh],[data-nfun],[data-nfi],[data-nfdrm],[data-nfdel],#nfAdd,#nfSave'); if (!t) return; err('');
        const ln = t.closest('.nfline'), i = ln ? +ln.dataset.li : -1, l = lines[i];
        if (t.dataset.nfh) l.h = t.dataset.nfh;
        else if (t.hasAttribute('data-nfun')) l.h = null;
        else if (t.dataset.nfi) { const k = t.dataset.nfi; if (!l.dx.includes(k)) l.dx.push(k); }
        else if (t.dataset.nfdrm) l.dx = l.dx.filter(x => x !== t.dataset.nfdrm);
        else if (t.hasAttribute('data-nfdel')) lines.splice(i, 1);
        else if (t.id === 'nfAdd') { lines.push({ h: null, dx: [] }); paint(); const q = $$('.nfq', el); if (q.length) q[q.length - 1].focus(); return; }
        else if (t.id === 'nfSave') {
          const ok = lines.filter(x => x.h), n = $('#nfName', el).value.trim().slice(0, 80);
          if (!ok.length) return err('Pick a fee code first.');
          if (ok.length < lines.length) return err('Every line needs a fee code (or remove the empty line with ✕).');
          if (ok.length > 1 && !n) return err('Give the bundle a name.');
          if (ok.length === 1) {   // one line = a normal single favourite (links + name)
            const k = ok[0].h; if (!FAVS.includes(k)) FAVS.push(k);
            const fails = ok[0].dx.map(d => addLink(k, d)).filter(Boolean); if (n) NAMES[k] = n;
            if (ed) BUNDLES.splice(BUNDLES.indexOf(ed), 1);
            saveLists(); saveNames(); saveBundles(); closeSheet(); renderFavManage(); renderSaved();
            toast('Saved favourite ' + (n ? n + ' (' + splitKey(k).code + ')' : splitKey(k).code) + (fails.length ? '. ' + fails[0] : '')); return;
          }
          const rec = { id: ed ? ed.id : 'b' + Date.now().toString(36), name: n, lines: ok.map(x => ({ h: x.h, dx: x.dx.slice() })) };
          if (ed) BUNDLES[BUNDLES.indexOf(ed)] = rec; else BUNDLES.push(rec);
          saveBundles(); closeSheet(); renderFavManage(); toast(`Saved bundle ${n} (${ok.length} lines)`); return;
        }
        paint();
      });
    });
  }
  (function () {
    const list = $('#fmList'); if (!list) return;
    $('#fmq').addEventListener('input', renderFavManage);
    $('#fmExp').addEventListener('click', fmExport);
    $('#fmNew').addEventListener('click', () => fmNewSheet());
    $('#fmImp').addEventListener('click', () => $('#fmFile').click());
    $('#fmFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) fmImport(f); e.target.value = ''; });
    list.addEventListener('click', e => {
      const b = e.target.closest('[data-fma]'), row = e.target.closest('.fmrow'); if (!row) return;
      if (row.dataset.fmb) { const id = row.dataset.fmb, x = BUNDLES.find(y => y.id === id), a = b ? b.dataset.fma : 'exp'; if (!x) return;
        if (a === 'exp') { const ok = 'B:' + id; fmOpen.has(ok) ? fmOpen.delete(ok) : fmOpen.add(ok); }
        else if (a === 'edit') return fmNewSheet(id);
        else if (a === 'del') { if (!confirm(`Delete bundle ${x.name} (${x.lines.length} lines)?`)) return; BUNDLES.splice(BUNDLES.indexOf(x), 1); saveBundles(); }
        return renderFavManage(); }
      const k = row.dataset.fmk, i = FAVS.indexOf(k), a = b ? b.dataset.fma : 'exp';
      if (a === 'exp') { fmOpen.has(k) ? fmOpen.delete(k) : fmOpen.add(k); }
      else if (a === 'up' || a === 'down') { const j = a === 'up' ? i - 1 : i + 1; if (j < 0 || j >= FAVS.length) return; FAVS.splice(i, 1); FAVS.splice(j, 0, k); saveLists(); renderSaved(); }
      else if (a === 'edit') { const n = prompt('Favourite name for ' + splitKey(k).code + ' (blank = none)', NAMES[k] || ''); if (n == null) return; NAMES[k] = n.trim().slice(0, 80); saveNames(); }
      else if (a === 'del') { if (!confirm(`Delete favourite ${NAMES[k] ? NAMES[k] + ' (' + splitKey(k).code + ')' : splitKey(k).code}?`)) return; toggleFav(k); saveNames(); }
      renderFavManage();
    });
    new MutationObserver(() => { if ($('#tab-favmanage').classList.contains('on')) renderFavManage(); }).observe($('#tab-favmanage'), { attributes: true, attributeFilter: ['class'] });
  })();

  pickBar();
  boot().then(() => { ready = true; paintTray(); }).catch(err => { document.body.insertAdjacentHTML('afterbegin', '<p class="pad warn">Could not load data files. Serve this folder over http (e.g. python3 -m http.server).</p>'); console.error(err); });
})();

// Suite parity v1 (M11): the main search placeholder is never clipped; it steps down to shorter wording when the field is narrow
function fitQph() {
  const q = document.getElementById('q'); if (!q) return; if (!q.dataset.ph) q.dataset.ph = q.placeholder;
  const w = q.clientWidth; if (!w) return;
  const cs = getComputedStyle(q), c = fitQph.c || (fitQph.c = document.createElement('canvas').getContext('2d')); c.font = cs.font;
  const room = w - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0) - 4;
  const code = (q.dataset.ph.match(/enter an? (.+)$/) || [, 'fee code'])[1];
  const opts = [q.dataset.ph, 'Service or ' + code, 'Search ' + code + 's'];
  q.placeholder = opts.find(t => c.measureText(t).width <= room) || opts[opts.length - 1];
}
window.addEventListener('resize', () => fitQph());
(function () { const go = () => { const q = document.getElementById('q'); if (q && window.ResizeObserver) new ResizeObserver(() => fitQph()).observe(q); }; if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go(); })();
