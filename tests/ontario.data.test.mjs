// Data and wording checks for the Ontario release (licence C/N 0198/26/N). Run: node --test tests/
import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const J = p => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8')), T = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ON = J('site/data/prov/ON.json'), IDX = J('site/data/prov/index.json');
const LEGEND = "© King's Printer for Ontario, 2026. Reproduced with permission.";   // licence s.2.2, year confirmed by Ontario
test('licence legend is verbatim, once per licensed work', () => {
  assert.deepEqual(ON.meta.legends.map(l => l.text), [LEGEND, LEGEND]);
  assert.deepEqual(ON.meta.legends.map(l => l.work), ['Schedule of Benefits for Physician Services (effective July 1, 2026)', 'OHIP Physician Fee Schedule Master']);
  assert.equal(ON.meta.credit, LEGEND);
});
test('no personal name, title or email anywhere in the Ontario data or card', () => {
  const blob = JSON.stringify(ON) + JSON.stringify(IDX.list.find(j => j.id === 'ON'));
  for (const bad of [/Dr\./, /@/, /gmail/i, /0198/]) assert.doesNotMatch(blob, bad);
});
test('index card is live and points at ON.json; counts match', () => {
  const c = IDX.list.find(j => j.id === 'ON');
  assert.equal(c.status, 'live'); assert.equal(c.file, 'ON.json'); assert.equal(c.counts.rows, ON.rows.length); assert.equal(c.counts.codes, ON.meta.counts.codes);
  assert.ok(!c.pending);
});
test('licensed scope only: Schedule of Benefits + Master; links are the two licensed Ontario pages', () => {
  assert.equal(ON.meta.pdf, 'https://www.ontario.ca/files/2026-08/moh-schedule-benefit-effective-2026-07-01.pdf');
  assert.equal(ON.meta.landing, 'https://www.ontario.ca/page/ohip-schedule-benefits-and-fees');
  assert.equal(ON.meta.dx.label, 'not bundled'); assert.ok(!ON.meta.dx.file);   // Diagnostic Codes list is not licensed
  assert.equal(ON.meta.noAiDesc, true);   // Schedule text is not forwarded to third-party AI sites
  assert.match(ON.meta.governs, /official Schedule of Benefits governs/);
  assert.match(ON.meta.governs, /accuracy, completeness or currency/);
});
test('rows: valid codes, unique, numeric amounts, valid page links and section indexes', () => {
  const re = new RegExp(ON.meta.codeRe), seen = new Set();
  assert.ok(ON.rows.length > 5000);
  for (const r of ON.rows) {
    assert.match(r.c, re); assert.ok(!seen.has(r.c), 'dup ' + r.c); seen.add(r.c);
    assert.ok(r.d && r.d.length > 1);
    for (const k of ['f', 'tec', 'pro']) if (k in r) assert.ok(typeof r[k] === 'number' && r[k] >= 0 && r[k] < 100000, r.c + k);
    assert.ok(Number.isInteger(r.p) && r.p >= 1 && r.p <= 1000, r.c); assert.ok(ON.secs[r.s] !== undefined && ON.subs[r.h] !== undefined, r.c);
  }
});
test('spot values printed in the Schedule of Benefits (checked against the PDF)', () => {
  const R = Object.fromEntries(ON.rows.map(r => [r.c, r]));
  assert.equal(R.A001.f, 26.8); assert.equal(R.A100.f, 78.95); assert.equal(R.J902.tec, 90.4); assert.equal(R.J902.pro, 51);
  assert.equal(R.A935.f, 194.65); assert.equal(R.A001.d, 'Minor assessment');
});
test('terms, privacy and support carry the legend and the accuracy disclaimer; public mirrors match', () => {
  for (const f of ['terms', 'privacy']) { const t = T(`site/${f}.html`); assert.ok(t.includes(LEGEND.replace("'", "'"))); assert.match(t, /no representation or warranty about the accuracy, completeness or currency/); assert.doesNotMatch(t, /Ontario \(approval pending\)/); }
  assert.match(T('site/support.html'), /Ontario: © King's Printer for Ontario, 2026\. Reproduced with permission\./);
  for (const f of ['terms', 'privacy', 'support']) assert.equal(T(`site/${f}.html`), T(`public/${f}.html`));
});
test('app shows the legend on every view that displays Schedule text', () => {
  const a = T('site/js/app.js');
  assert.equal((a.match(/legendBlock\(\)/g) || []).length >= 8, true);
  assert.match(a, /m\.legends \? legendBlock\(\)/);
});
test('service worker cache version was bumped for this release', () => assert.match(T('site/sw.js'), /const V = 'mb-v50-20261030-on'/));
