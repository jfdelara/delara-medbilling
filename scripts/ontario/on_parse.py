#!/usr/bin/env python3
"""Ontario (OHIP) Schedule of Benefits + Fee Schedule Master -> Fee Desk province JSON (ON.json).
Licence C/N 0198/26/N: only Licensed Material (Schedule of Benefits, eff. 1 Jul 2026; OHIP Physician Fee Schedule Master).
Descriptions are copied as printed (no rewriting). Fees from the SOB Numeric Index (as printed); Master used to cross-check."""
import re, json, sys, subprocess, collections
RAW = sys.argv[1] if len(sys.argv) > 1 else '/workspace/ont-work/raw'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/workspace/ont-work/build/ON.json'
pages = open(f'{RAW}/sob.txt').read().split('\f')
if not pages[-1].strip(): pages.pop()
NP = len(pages)
# ---- printed page labels (e.g. A4, GP27, M19) per PDF page
LAB = re.compile(r'(?:^|\s)([A-Z]{1,2}\d{1,3})\s{2,}July 22, 2026|July 22, 2026 \(effective July 1, 2026\)\s{2,}([A-Z]{1,2}\d{1,3})\s*$|^\s*([A-Z]{1,2}\d{1,3})\s*$', re.M)
label = {}
ISTART_ = next(i for i, p in enumerate(pages) if 'NUMERIC INDEX' in p and 'CODE' in p)
for i, p in enumerate(pages, 1):
    if i - 1 >= ISTART_: break
    tail = '\n'.join([l for l in p.split('\n') if l.strip()][-4:])
    ms = [m for m in LAB.finditer(tail)]
    if ms:
        m = ms[-1]; label[i] = next(g for g in m.groups() if g)
lab2pdf = {}
for i in sorted(label): lab2pdf.setdefault(label[i], i)
# ---- Table of contents: chapters and sub-sections with printed page labels
toc_end = next(i for i, p in enumerate(pages) if 'NI. Numeric Index' in p)
chapters, entries = [], []   # entries: (chapter idx, title, label)
cur = None
for p in pages[:toc_end + 1]:
    for ln in p.split('\n'):
        m = re.match(r'^([A-Z]{1,2})\.\s+(.+?)\s*$', ln)
        if m and not re.search(r'\.{4}', ln):
            chapters.append((m.group(1), m.group(2))); cur = len(chapters) - 1; continue
        m = re.match(r'^\s+(\S.*?)\s*\.{4,}\s*([A-Z]{1,2}\d{1,3})\s*$', ln)
        if m and cur is not None: entries.append((cur, m.group(1).strip(), m.group(2)))
def split_lab(l): m = re.match(r'([A-Z]+)(\d+)$', l); return m.group(1), int(m.group(2))
chap_by_pref = {}
for ci, (pref, t) in enumerate(chapters): chap_by_pref[pref] = ci
# ---- Numeric Index
istart = next(i for i, p in enumerate(pages) if 'NUMERIC INDEX' in p and 'CODE' in p)
idx = {}
for pi in range(istart, NP):
    hdr = None
    plines = pages[pi].split('\n')
    for li, ln in enumerate(plines):
        if re.search(r'\bCODE\b.*\$.*\bT\b.*\bP\b.*Page', ln):
            pagecol = ln.index('Page')
            hdr = {'f': ln.index('$'), 't': re.search(r'\sT\s', ln).start() + 1, 'p': re.search(r'\sP\s', ln).start() + 1}; continue
        m = re.match(r'^\s*([A-Z]\d{3}[A-Z]?)\s{2,}(.*)$', ln)
        if not (m and hdr): continue
        nums = [(mm.start(), float(mm.group().replace(',', ''))) for mm in re.finditer(r'(?<![\w.])\d[\d,]*\.\d\d(?!\w)', ln)]
        pg = re.search(r'([A-Z]{1,2}\d+)\s*$', ln) or re.search(r'(?<![\w.])([A-Z]{1,2}\d{1,3})(?=,)', ln[12:])
        r = {'pg': pg.group(1) if pg else None}
        if not r['pg']:   # page list wrapped onto the next line(s): first listed page
            for nx in plines[li + 1:li + 3]:
                mp = re.match(r'^\s{10,}([A-Z]{1,2}\d{1,3})\b', nx)
                if mp and not re.match(r'^\s*[A-Z]\d{3}[A-Z]?\s+\S', nx): r['pg'] = mp.group(1); break
        for pos, v in nums:
            k = min(hdr, key=lambda h: abs(hdr[h] - pos)); r[k] = v
        idx.setdefault(m.group(1), r)
# ---- Master (cross-check + effective dates)
master = {}
for ln in open(f'{RAW}/master/OCTSOB2026.001', encoding='latin-1'):
    ln = ln.rstrip('\n')
    if len(ln) < 75: continue
    code = ln[:4]; eff, end = ln[4:12], ln[12:20]
    f = [int(ln[20 + 11 * i:31 + 11 * i]) / 10000 for i in range(5)]
    master.setdefault(code, []).append({'eff': eff, 'end': end, 'f': f})
# ---- body descriptions
body = collections.OrderedDict()   # code -> (desc, pdfpage)
CODE = re.compile(r'^\s*(?:[#*+]\s*)?([A-Z]\d{3}[A-Z]?)\s+(\S.*)$')
for pi in range(1, istart):
    ls = pages[pi - 1 + 0].split('\n') if False else pages[pi].split('\n')
    for k, ln in enumerate(ls):
        m = CODE.match(ln)
        if not m: continue
        code, rest = m.group(1), m.group(2)
        if code in body: continue
        if re.match(r'^[,;]|^(and|to|or)\b', rest): continue
        parts = []; cur_ = rest; j = k
        while True:
            lead = re.search(r'\s*\.{3,}', cur_) or re.search(r'\s{3,}(?=[\d,]+\.\d\d\s*$)', cur_)
            if lead: parts.append(cur_[:lead.start()].strip()); break
            parts.append(cur_.strip()); j += 1
            if j >= len(ls) or j - k > 6 or CODE.match(ls[j]) or not ls[j].strip(): parts = None; break
            cur_ = ls[j].strip()
        if not parts: continue
        d = re.sub(r'\s+', ' ', ' '.join(parts)).strip()
        d = re.sub(r'\s*\badd\s*$', '', d).strip()
        if len(d) < 2 or re.fullmatch(r'[\d.,\s%$]+', d): continue
        ctx = None
        if d.startswith('-'):
            q = k - 1; hops = 0
            while q >= 0 and hops < 8:
                t = ls[q].strip(); hops += 1
                if not t: q -= 1; continue
                if CODE.match(ls[q]) or re.search(r'\.{3,}', t) or re.match(r'^\d+\.|^[a-z]\.|^[a-z(]', t): 
                    # a coded row: take its description if it does not start with a dash
                    mm = CODE.match(ls[q])
                    if mm and not mm.group(2).lstrip().startswith('-'):
                        c2 = re.split(r'\s*\.{3,}', mm.group(2))[0].strip()
                        if len(c2) > 2: ctx = re.sub(r'\s+', ' ', c2); break
                    if mm: q -= 1; continue
                    # leader/numbered/lowercase continuation or note line: keep looking up
                    q -= 1; continue
                if len(t) <= 90 and not re.search(r'[.:\]\[]$', t) and not re.match(r'^(Note|Payment rules|Commentary|\[|July|[A-Z]{1,2}\d+$)', t) and not re.search(r'July 22, 2026', t) and t != t.upper():
                    ctx = re.sub(r'\s+', ' ', t); break
                q -= 1
        body[code] = (d, pi + 1, ctx)
# ---- assemble rows
secs = [f'{p}. {t}' if False else t for p, t in chapters]
subs = [e[1] for e in entries]
def sub_for(lab):
    pref, n = split_lab(lab); best = None
    for ei, (ci, t, l) in enumerate(entries):
        lp, ln_ = split_lab(l)
        if lp == pref and ln_ <= n: best = ei if best is None or split_lab(entries[best][2])[1] <= ln_ else best
    return best
rows, nodesc, missing_idx = [], [], []
for code, r in idx.items():
    lab = r['pg']
    if not lab: continue
    pdfp = lab2pdf.get(lab) or (body.get(code) or (None, None, None))[1]
    if not pdfp: continue
    pref = split_lab(lab)[0]
    ci = chap_by_pref.get(pref)
    if ci is None: continue
    d = body.get(code, (None,))[0]; ctx = body.get(code, (None, None, None))[2]
    row = {'c': code, 'd': d or 'Description: see the Schedule of Benefits (linked page)', 's': ci, 'h': sub_for(lab) if sub_for(lab) is not None else 0, 'p': pdfp, 'l': lab}
    if ctx: row['x'] = ctx
    if d is None: nodesc.append(code)
    if 'f' in r: row['f'] = r['f']
    if 't' in r: row['tec'] = r['t']
    if 'p' in r: row['pro'] = r['p']
    rows.append(row)
print('index codes', len(idx), 'rows', len(rows), 'no body description', len(nodesc), 'chapters', len(chapters), 'toc entries', len(entries), 'pages labelled', len(label), file=sys.stderr)
# dash-prefixed descriptions: context from preceding non-dash description
# (kept as printed in d; context shown as heading)
rules = []
for ci, t, l in entries:
    if l in lab2pdf: rules.append({'t': t, 'p': lab2pdf[l], 'l': l, 'g': 'h' if split_lab(l)[1] <= 3 else 's'})
# ---- cross-check against the Master (a mismatch is reported, never silently "fixed"; the printed Schedule is used)
xc = collections.Counter(); xdiff = []
for r in rows:
    m = master.get(r['c'][:4])
    if not m: xc['not_in_master'] += 1; continue
    cur = ([x for x in m if x['end'] == '99999999'] or m)[-1]['f']
    for k in ('f', 'pro'):
        if k in r:
            ok = any(abs(r[k] - v) < 0.006 for v in cur); xc[k + ('_match' if ok else '_DIFF')] += 1
            if not ok: xdiff.append((r['c'], k, r[k], cur))
    if 'tec' in r: xc['tec_match' if any(abs(r['tec'] - v) < 0.006 for v in cur) else 'tec_differs_from_master_field2'] += 1
print('master cross-check', dict(xc), 'unexpected differences:', xdiff, file=sys.stderr)
json.dump({'rows': rows, 'secs': secs, 'subs': subs, 'rules': rules, 'nodesc': nodesc, 'xcheck': dict(xc), 'xdiff': xdiff}, open(OUT, 'w'), ensure_ascii=False)
