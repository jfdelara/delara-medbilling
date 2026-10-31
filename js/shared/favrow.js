// Shared favourites component for Fee Desk and MedBilling Logs (Suite parity v1). Plain ES module, no build step.
// The SAME file ships in both apps (js/shared/favrow.js). Fee Desk builds its saved rows, linked chips, the Favourites pane
// (header with Manage + "+ New group", filter, Recent, Export / Import) and the Manage table rows with these functions, and
// Logs renders its Favourites tab with them, so the two lists are one component. Row text comes from rowfmt.js /
// short-names.js (unchanged). Storage: Fee Desk owns 'mb.favs', 'mb.favlinks', 'mb.recent', 'mb.favnames', 'mb.favgroups',
// 'mb.skill'; Logs only READS them (readFavs). Favourites hold billing codes only (never patient data).
import { shortLabel, barePrice } from './rowfmt.js';

export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ABKEY = /^[HI]:[^|]+$/;

// ---- markup shared by both apps ---------------------------------------------------------------------------------------
// one slim row: code · short label · [right: fee or "ICD-9"] · [linked chips] · [tail: ＋ / ★ / Details / ⋯]
// o: {key, cls, attrs, merged, cd, title, desc, icdT, label, short, right, lk, codefirst, tail, button}
export function rowShell(o) {
  const t = o.icdT || '';
  return `<button${o.button ? ' type="button"' : ''} class="hit compact${o.cls || ''}${o.lk ? ' haslinks' : ''}${o.codefirst ? ' codefirst' : ''}"${o.attrs ? ' ' + o.attrs : ''} data-fk="${esc(o.key)}"${o.merged ? ` data-merged="${esc(o.merged)}"` : ''}${o.title ? ` title="${esc(o.cd + ' ' + o.title + t)}"` : ''} aria-label="${esc(o.cd + ' ' + (o.title || o.desc) + t)}">` +
    `<span class="ccode code">${esc(o.cd)}</span><span class="cdesc${o.short ? ' short' : ''}">${esc(o.label)}</span>${o.right || ''}${o.lk || ''}${o.tail || ''}</button>`;
}
// one linked chip (k: 'H:…' | 'I:…' | 'M:…'); kind = word read by screen readers
export const chipHtml = (k, code, desc, kind) => `<span class="lchip k-${k[0]}" role="button" tabindex="0" data-lk="${esc(k)}" title="${esc((k[0] === 'M' ? 'Modifier ' : '') + code + (desc ? ' ' + desc : ''))}" aria-label="Linked ${esc(kind)} ${esc(code)}${desc ? ', ' + esc(desc) : ''}"><span class="code">${esc(code)}</span>${desc ? `<span class="ld">${esc(desc)}</span>` : ''}</span>`;
export const editChipHtml = (key, code) => `<span class="lchip ledit" role="button" tabindex="0" data-favlink="${esc(key)}" aria-label="Edit linked codes for ${esc(code)}" title="Edit linked codes">✎</span>`;
export const lnksHtml = (chips, edit) => chips || edit ? `<span class="lnks" aria-label="Linked codes"><span class="lnkic" aria-hidden="true">↔</span>${chips}${edit || ''}</span>` : '';
export const starHtml = (key, on) => `<span class="star${on ? ' on' : ''}" role="button" tabindex="0" data-fav="${esc(key)}" aria-pressed="${on}" aria-label="${on ? 'Remove from favourites' : 'Add to favourites'}" title="${on ? 'Remove from favourites' : 'Add to favourites'}">${on ? '★' : '☆'}</span>`;
export const menuHtml = (key, code, gid) => `<span class="rowmenu" role="button" tabindex="0" data-favmenu="${esc(key)}" data-g="${esc(gid || '')}" aria-label="Links, groups and options for ${esc(code)}" title="Linked codes, groups and options">⋯</span>`;

// the Favourites pane: header (★ Favourites · Manage · + New group), filter, hint, rows, Recent, Export / Import, notes
// o: {pre, tools, sortHtml, filter, hint, body, rec, recentMax, note, foot}
export function paneHtml(o) {
  const tools = o.tools ? `<div class="favtools"><div class="inputwrap fgq"><input id="favq" type="search" enterkeyhint="search" autocapitalize="off" spellcheck="false" placeholder="Filter favourites" aria-label="Filter favourites" value="${esc(o.filter || '')}"></div>${o.sortHtml || ''}</div>` : '';
  const hint = o.hint ? '<p class="muted small fghint">Bill some codes together? Make a named group (e.g. C-section) with <b>+ New group</b>. Groups can also sort favourites by specialty or doctor.</p>' : '';
  return (o.pre || '') + `<div class="savedh" id="savedFav"><h3>★ Favourites</h3><span class="sph"><button type="button" class="spmanage" id="favManage" aria-label="Manage favourites (table)">Manage</button><button type="button" class="fgnew" id="favNewGrp" aria-label="New favourites group">+ New group</button></span></div>${tools}${hint}${o.body || '<p class="muted small pad savedempty">Tap ☆ on any code to keep it here.</p>'}
      <div class="savedh" id="savedRecent"><h3>Recent</h3>${o.rec ? '<button type="button" class="linkbtn" id="clearRecent">Clear</button>' : ''}</div>${o.rec || '<p class="muted small pad savedempty">Codes you open appear here (last ' + (o.recentMax || 12) + ').</p>'}
      <div class="savedtools">
        <div class="saverow"><button type="button" class="ghost" id="expSaved" title="Save favourites &amp; recent codes to a file" aria-label="Save favourites &amp; recent codes to a file" aria-describedby="expHelp">Export</button><p class="small savedhelp" id="expHelp">Export saves your favourites and recent codes to a file so you can back them up or move them to another device.</p></div>
        <div class="saverow"><button type="button" class="ghost" id="impSaved" title="Load favourites &amp; recent codes from a saved file" aria-label="Load favourites &amp; recent codes from a saved file" aria-describedby="impHelp">Import</button><p class="small savedhelp" id="impHelp">Import loads that file back in. Nothing leaves your device unless you share the file.</p></div>
      </div>
      <p class="small muted pad savednote">${esc(o.note || 'Saved on this device only. Add to Home Screen on iPhone to keep them safe.')}</p>
      ${o.foot ? `<p class="muted small pad savedfoot">${o.foot}</p>` : ''}`;
}
// Manage table (opened by "Manage"): one row per favourite: name (or short label) · code · ICD-9 · ↑ ↓ ✎ ✕
// r: {key, name, label, code, badge, dx, first, last, open, desc, locked}
export const mgrHeadHtml = () => '<div class="fmhead"><span>Name</span><span>Fee code</span><span>Diagnosis (ICD-9)</span><span></span></div>';
export function mgrRowHtml(r) {
  const dis = c => c ? ' disabled' : '';
  return `<div class="fmrow" data-fmk="${esc(r.key)}"><button type="button" class="fmexp" data-fma="exp" aria-expanded="${!!r.open}" aria-label="Show description">${r.open ? '▴' : '▾'}</button><span class="fmname${r.name ? '' : ' fmlbl'}">${esc(r.name || r.label || r.code)}</span><span class="code fmcode">${esc(r.code)}${r.badge ? ` <span class="badge j">${esc(r.badge)}</span>` : ''}</span><span class="fmdx">${esc(r.dx || '')}</span><span class="fmact"><button type="button" data-fma="up" aria-label="Move up"${dis(r.first || r.locked)}>↑</button><button type="button" data-fma="down" aria-label="Move down"${dis(r.last || r.locked)}>↓</button><button type="button" data-fma="edit" aria-label="Rename" title="Edit name">✎</button><button type="button" data-fma="del" aria-label="Delete favourite" title="Delete">✕</button></span>${r.open ? `<div class="fmdesc small">${esc(r.desc || '')}</div>` : ''}</div>`;
}

// ---- Logs (read-only view of Fee Desk storage) ------------------------------------------------------------------------
export function readFavs(ls) {
  const get = k => { try { return ls.getItem('mb.' + k); } catch (e) { return null; } };
  const list = k => { try { const a = JSON.parse(get(k) || '[]'); return Array.isArray(a) ? a.filter(x => typeof x === 'string' && ABKEY.test(x)) : []; } catch (e) { return []; } };
  let pairs = []; try { const o = JSON.parse(get('favlinks') || 'null'); if (o && Array.isArray(o.pairs)) pairs = o.pairs.filter(p => Array.isArray(p) && p.length === 2 && p.every(k => typeof k === 'string' && ABKEY.test(k))); } catch (e) { /* none */ }
  let names = {}; try { const o = JSON.parse(get('favnames') || '{}'); if (o && typeof o === 'object') Object.keys(o).forEach(k => { if (ABKEY.test(k) && typeof o[k] === 'string' && o[k].trim()) names[k] = o[k].trim().slice(0, 80); }); } catch (e) { /* none */ }
  let groups = []; try { const o = JSON.parse(get('favgroups') || 'null'); if (o && Array.isArray(o.groups)) groups = o.groups.filter(g => g && typeof g.name === 'string' && Array.isArray(g.keys)).map(g => ({ id: String(g.id || ''), name: g.name.slice(0, 80), keys: g.keys.filter(k => typeof k === 'string' && ABKEY.test(k)) })); } catch (e) { /* none */ }
  return { favs: list('favs'), recent: list('recent'), pairs, names, groups, skill: String(get('skill') || '').toUpperCase() };
}

// model -> [{key, kind:'H'|'I', code, label, desc, price, chips:[{key,code,label,desc}], fee: fee code to insert or '', dx: [ICD-9]}]
export function buildRows(store, data, keys) {
  const { favs, pairs } = store, skill = data.skill || store.skill || '';
  const linksOf = k => pairs.filter(p => p[0] === k || p[1] === k).map(p => p[0] === k ? p[1] : p[0]);
  const code = k => k.slice(2);
  const price = c => { const F = data.fees && data.fees[c]; if (F) { const sk = F[1] && skill ? F[1][skill] : null; return '$' + Number(sk || F[0]).toFixed(2); }
    const h = data.codes[c]; return h ? barePrice(h[2]) : ''; };
  const chip = k => { const i = data.icd[code(k)]; return { key: k, code: code(k), label: i ? shortLabel('I', code(k), i[1]) : '', desc: i ? i[1] : '' }; };
  const set = new Set(favs), rows = [], hidden = new Set(), recent = !!keys;
  // Fee Desk S1 merge: an ICD-saved favourite led by fee H, where H is a favourite whose only ICD link is this ICD -> shown once (fee row)
  if (!recent) favs.forEach(k => { if (k[0] !== 'I') return; const hs = linksOf(k).filter(x => x[0] === 'H' && data.codes[code(x)]);
    if (hs.length === 1 && set.has(hs[0]) && JSON.stringify(linksOf(hs[0]).filter(x => x[0] === 'I')) === JSON.stringify([k])) hidden.add(k); });
  (keys || favs).forEach(k => {
    if (hidden.has(k)) return;
    if (k[0] === 'H') { const h = data.codes[code(k)]; if (!h) return; const dx = recent ? [] : linksOf(k).filter(x => x[0] === 'I');
      rows.push({ key: k, kind: 'H', code: code(k), label: shortLabel('H', code(k), h[1]), desc: h[1], price: price(code(k)), chips: dx.map(chip), fee: code(k), dx: dx.map(code), fav: set.has(k) }); return; }
    const i = data.icd[code(k)]; if (!i) return;
    const lead = recent ? null : linksOf(k).find(x => x[0] === 'H' && data.codes[code(x)]);
    if (lead) { const h = data.codes[code(lead)];   // code first: the ICD-9 favourite leads with its linked fee code; the ICD-9 is the chip
      rows.push({ key: k, kind: 'H', code: code(lead), label: shortLabel('H', code(lead), h[1]), desc: h[1], price: price(code(lead)), chips: [chip(k)], fee: code(lead), dx: [code(k)], codefirst: true, fav: true }); return; }
    rows.push({ key: k, kind: 'I', code: code(k), label: shortLabel('I', code(k), i[1]), desc: i[1], price: '', chips: [], fee: '', dx: [code(k)], fav: set.has(k) });
  });
  return rows;
}

// one Logs row through the shared shell (same markup as a Fee Desk favourite row)
export function rowHtml(r, o) {
  o = o || {};
  const t = r.chips.length ? ' · ICD-9 ' + r.chips.map(c => c.code + ' ' + c.desc).join('; ') : '';
  const lk = o.recent || !r.chips.length ? '' : lnksHtml(r.chips.map(c => chipHtml(c.key || 'I:' + c.code, c.code, c.label, 'ICD-9')).join(''), editChipHtml(r.key, r.key.slice(2)));
  const right = r.kind === 'H' ? `<span class="fee">${esc(r.price)}</span>` : '<span class="small muted">ICD-9</span>';
  return rowShell({ button: true, key: r.key, attrs: `data-ins-fee="${esc(r.fee)}" data-ins-dx="${esc(r.dx.join(','))}"`, cd: r.code, title: r.desc, desc: r.desc, icdT: t, label: r.label, short: true, right, lk, codefirst: r.codefirst,
    tail: starHtml(r.key, o.recent ? !!r.fav : true) + (o.recent ? '' : menuHtml(r.key, r.code)) });
}
const match = (r, q) => (r.code + ' ' + r.desc + ' ' + r.chips.map(c => c.code + ' ' + c.desc).join(' ')).toLowerCase().includes(q);
export function listHtml(rows, filter, groups) {
  const q = String(filter || '').toLowerCase().trim();
  const shown = q ? rows.filter(r => match(r, q)) : rows;
  if (!shown.length) return `<p class="muted small pad savedempty">${rows.length ? 'No favourites match.' : 'Tap ☆ on any code to keep it here.'}</p>`;
  if (!groups || !groups.length) return shown.map(r => rowHtml(r)).join('');
  // Fee Desk groups (read-only here): one heading per group, then Ungrouped
  const seen = new Set(), out = [];
  groups.forEach(g => { const rs = shown.filter(r => g.keys.includes(r.key)); if (!rs.length) return; rs.forEach(r => seen.add(r.key));
    out.push(`<section class="favgrp" data-gid="${esc(g.id)}"><h4 class="fgname">${esc(g.name)}</h4><div class="fgbody">${rs.map(r => rowHtml(r)).join('')}</div></section>`); });
  const rest = shown.filter(r => !seen.has(r.key));
  if (rest.length) out.push(`<section class="favgrp" data-gid="_u"><h4 class="fgname">Ungrouped</h4><div class="fgbody">${rest.map(r => rowHtml(r)).join('')}</div></section>`);
  return `<div id="favgroups" class="favgroups">${out.join('')}</div>`;
}

// Logs insertion payload: same v2 shape Fee Desk sends (fee + linked Dx beside it; ICD-only favourite -> Dx only)
export function pickPayload(fee, dx) {
  const d = String(dx || '').split(',').filter(Boolean);
  return fee ? { v: 2, fee: [fee], dx: d, dxFor: d.map(() => fee), mod: [], modFor: [] } : { v: 2, fee: [], dx: d, dxFor: d.map(() => ''), mod: [], modFor: [] };
}
// a Fee Desk deep link for a favourites action Logs hands over (Fee Desk owns the data): #/fav/<act>[/<key>]
export const fdActionHash = (act, key) => '#/fav/' + act + (key ? '/' + encodeURIComponent(key) : '');
export default { esc, rowShell, chipHtml, editChipHtml, lnksHtml, starHtml, menuHtml, paneHtml, mgrHeadHtml, mgrRowHtml, readFavs, buildRows, rowHtml, listHtml, pickPayload, fdActionHash };
