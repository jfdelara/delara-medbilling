// Shared code-row formatter for Fee Desk and MedBilling Logs. Plain ES module, no dependencies, no build step.
// Row order everywhere: billing code · short label · price · [ICD-9 chips].
import { SHORT_NAMES } from './short-names.js';
export { SHORT_NAMES };

const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
// bareCode('AB|80.19B') -> '80.19B'; also drops a leading 'H:'/'I:' key prefix ('H:BC|00100' -> '00100').
export const bareCode = c => norm(c).replace(/^[HI]:/, '').replace(/^[A-Z]{2}\|/, '');
// barePrice('$308.65 base') -> '$308.65' (the word 'base' is never shown)
export const barePrice = p => norm(p).replace(/\s*\(?\bbase\b\)?/gi, '').trim();

// shortLabel(kind, code, desc, opts?) -> string
//   kind 'H' (fee code) | 'I' (ICD-9); curated name from SHORT_NAMES wins, else the first maxWords (default 3)
//   whole words of desc, stopping early at a comma/colon/dash clause break; never cuts a word in half.
export function shortLabel(kind, code, desc, opts = {}) {
  const names = opts.names || SHORT_NAMES, max = opts.maxWords || 3;
  const cur = names[kind + ':' + bareCode(code).replace(/\s+/g, '').toUpperCase()];
  if (cur) return cur;
  const d = norm(desc); if (!d) return '';
  const words = d.split(' '), out = [];
  for (const w of words) {
    if (out.length >= max) break;
    if (/^[-–—:]$/.test(w)) break;
    const clean = w.replace(/[,;:]+$/, '');
    out.push(clean);
    if (clean !== w) break;              // clause ends after this word
  }
  while (out.length > 1 && /^(of|and|or|the|a|an|to|for|with|in|on|by|without|-)$/i.test(out[out.length - 1])) out.pop();
  return out.join(' ');
}

// codeFirst({ key, links }) -> { lead, chips }
//   key: favourite key 'H:…' / 'I:…' (optionally 'H:JUR|code'); links: partner keys of the other kind.
//   An ICD-9 saved with linked fee codes leads with its first fee code; the ICD-9 (and any other fee codes) become chips.
//   Display only: stored keys and links are never changed.
export function codeFirst({ key, links = [] }) {
  if (key && key[0] === 'I') {
    const h = links.filter(k => k && k[0] === 'H');
    if (h.length) return { lead: h[0], chips: [key].concat(h.slice(1)) };
  }
  return { lead: key, chips: links.slice() };
}

// rowParts({ code, desc, price, kind, dx }) -> { code, label, title, price, dx }
//   code: display code; desc: full description; price: preformatted string or ''; kind 'H'|'I'; dx: ICD-9 codes (strings).
//   label = shortLabel(...); title/aria text = full "code description".
//   dxFull (optional, additive): ICD-9 full descriptions, same order as dx; appended to title.
export function rowParts({ code, desc, price = '', kind = 'H', dx = [], dxFull = [] }) {
  const full = norm(desc), d = dx.filter(Boolean);
  const icdT = d.map((c, i) => norm(c) + (dxFull[i] ? ' ' + norm(dxFull[i]) : '')).join('; ');
  return { code: norm(code), label: shortLabel(kind, code, full), title: norm(code) + (full ? ' ' + full : '') + (icdT ? ' · ICD-9 ' + icdT : ''), price: barePrice(price), dx: d };
}

// formatRow(row) -> parts + text  (MAIN, app-agnostic entry point; each app adapts its own data to `row`)
//   row = { code, short, full, price, icd, icdShort, icdFull, extraCount, mods }   (every field optional)
//     code: fee code as displayed ('80.19B', 'AB|80.19B' ok); short: curated/override label; full: full fee description
//     price: preformatted ('$308.65', '$308.65 base' -> '$308.65'); icd: ICD-9 code string (or array of codes)
//     icdShort / icdFull: ICD-9 label / full description (string, or arrays matching icd); extraCount: number of further fee codes
//     mods: modifier codes ['CMGP', 'BMI'] -> code suffix '80.19B·CMGP·BMI'
//   returns { kind: 'fee'|'icd'|'empty', code, mods, codeText, extra, label, price, icd: [..], icdLabel, chips: ['[218]'], title, aria, text }
//     kind 'fee':  text = 'codeText [+N] label price [icd, …]'    e.g. '80.19B·M1 +2 Myomectomy $308.65 [218]'
//     kind 'icd':  (no fee code) text = '[icd] icdLabel', price ''  e.g. '[218] Uterine leiomyoma'
//     kind 'empty': nothing usable -> every string ''
//     unknown/typed code (no full, no short, not curated): label '' -> text is just the code (+ price/chips if given)
//     title === aria: 'codeText full · ICD-9 icd icdFull; …' (full descriptions, for tooltip + aria-label)
export function formatRow(row = {}) {
  const arr = v => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v])).map(norm);
  const code = bareCode(row.code), full = norm(row.full), mods = arr(row.mods).filter(Boolean);
  const icd = arr(row.icd).filter(Boolean), iS = arr(row.icdShort), iF = arr(row.icdFull);
  const n = Math.max(0, Math.floor(Number(row.extraCount) || 0)), extra = n ? '+' + n : '';
  const icdLabel = icd.map((c, i) => norm(iS[i]) || shortLabel('I', c, iF[i] || '')).filter(Boolean).join(', ');
  const icdT = icd.map((c, i) => c + (iF[i] ? ' ' + iF[i] : (iS[i] ? ' ' + iS[i] : ''))).join('; ');
  const chips = icd.map(c => '[' + c + ']');
  if (!code) {
    if (!icd.length) return { kind: 'empty', code: '', mods: [], codeText: '', extra: '', label: '', price: '', icd: [], icdLabel: '', chips: [], title: '', aria: '', text: '' };
    const t = 'ICD-9 ' + icdT;
    return { kind: 'icd', code: '', mods: [], codeText: '', extra: '', label: '', price: '', icd, icdLabel, chips, title: t, aria: t, text: [chips.join(' '), icdLabel].filter(Boolean).join(' ') };
  }
  const codeText = code + mods.map(m => '·' + m).join('');
  const label = norm(row.short) || shortLabel('H', code, full), price = barePrice(row.price);
  const title = codeText + (full ? ' ' + full : (label ? ' ' + label : '')) + (icdT ? ' · ICD-9 ' + icdT : '');
  return { kind: 'fee', code, mods, codeText, extra, label, price, icd, icdLabel, chips, title, aria: title,
    text: [codeText, extra, label, price, icd.length ? '[' + icd.join(', ') + ']' : ''].filter(Boolean).join(' ') };
}

// rowText(parts) -> '80.19B Myomectomy $308.65 [218]' (plain-text order used in tests, CSV previews, Logs cells)
export function rowText(p) {
  return [p.code, p.label, p.price, p.dx.length ? '[' + p.dx.join(', ') + ']' : ''].filter(Boolean).join(' ');
}

export default { formatRow, shortLabel, codeFirst, rowParts, rowText, bareCode, barePrice, SHORT_NAMES };
