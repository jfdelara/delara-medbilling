// Suite parity v1: shared chrome for Fee Desk and MedBilling Logs (identical file in both apps: js/shared/suite.js).
// One toast, the bottom tab bar's height (CSS --tbh, so bottom bars and sheets sit above it), the suite wording, and the
// favourites part of the shared backup. Plain ES module, no build step. Styles: css/shared/suite.css.
export const WORDS = { fee: 'Fee code', dx: 'Diagnosis (ICD-9)', specialty: 'Specialty', province: 'Province', textSize: 'Text size' };
// Fee Desk keys that hold favourites (codes only, never patient data); the shared backup carries them as they are stored
export const FAV_KEYS = ['mb.favs', 'mb.recent', 'mb.savedts', 'mb.favlinks', 'mb.favmodlinks', 'mb.favgroups', 'mb.favgroupx', 'mb.favnames', 'mb.favbundles', 'mb.skill', 'mb.jur'];

let tt = 0;
export function toast(msg, ms) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
  const top = document.querySelector('header.top'); if (top) document.documentElement.style.setProperty('--toph', Math.max(44, Math.round(top.getBoundingClientRect().height)) + 'px');
  el.className = 'toast sptoast show'; el.textContent = msg; el.hidden = false;
  clearTimeout(tt); tt = setTimeout(() => { el.hidden = true; el.classList.remove('show'); }, ms > 0 ? ms : 2200);
}
// keep --tbh = the bottom tab bar's real height (labels may wrap at large text sizes)
export function syncBar(bar) {
  if (!bar) return;
  const set = () => document.documentElement.style.setProperty('--tbh', Math.round(bar.getBoundingClientRect().height) + 'px');
  set(); if (window.ResizeObserver) new ResizeObserver(set).observe(bar); window.addEventListener('resize', set);
  document.body.classList.add('sp');
}
// favourites snapshot for a backup file (raw strings as stored; restore writes only keys this device does not have yet)
export function favSnapshot(ls) { const o = {}; FAV_KEYS.forEach(k => { try { const v = ls.getItem(k); if (v != null) o[k] = v; } catch (e) { /* none */ } }); return o; }
export function favRestore(ls, snap) {
  if (!snap || typeof snap !== 'object') return { added: [], kept: [] };
  const added = [], kept = [];
  FAV_KEYS.forEach(k => { if (typeof snap[k] !== 'string') return; let had = null; try { had = ls.getItem(k); } catch (e) { /* none */ }
    if (had != null && had !== '[]' && had !== '{}') { kept.push(k); return; }
    try { if (k !== 'mb.skill' && k !== 'mb.jur') JSON.parse(snap[k]); ls.setItem(k, snap[k]); added.push(k); } catch (e) { /* skip bad value */ } });
  return { added, kept };
}
// text size (0.85 .. 1.4) applied the same way in both apps
export const TEXT_SIZES = [0.85, 0.92, 1, 1.08, 1.16, 1.25, 1.4];
export default { WORDS, FAV_KEYS, toast, syncBar, favSnapshot, favRestore, TEXT_SIZES };
