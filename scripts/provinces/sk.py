#!/usr/bin/env python3
"""Saskatchewan Payment Schedule for Insured Services Provided by a Physician -> rows.
Amounts are assigned to the column headers printed on each page by x-position (Specialist / General Practitioner,
Referred / Not referred, Technical / Interpretation / Total, Class, Anes)."""
import re, os, subprocess
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PDF = os.path.join(ROOT, 'raw', 'provinces', 'sk_payment_schedule_2026-10-01.pdf')
CODE = re.compile(r'^(\s{0,5})(\d{1,4}[A-Z])\s{2,}(\S.*)$')
AMT = re.compile(r'\$[\d,]+\.\d{2}[#*†]*|By [Rr]eport')
HWORDS = {'Specialist', 'General', 'Practitioner', 'Class', 'Anes', 'Referred', 'Not', 'referred', 'Unreferred/', 'By', 'entitlement', 'Entitlement',
          'Technical', 'Technical*', 'Interpretation', 'Component', 'Component*', '&'}

def unspace(s):
    s = re.sub(r'\b([A-Z]) (?=[A-Z]\b)', r'\1', s)
    return re.sub(r'\s+', ' ', re.sub(r'\b([A-Z]) ([A-Z]+)\b', r'\1\2', s)).strip()

def is_header(l):
    toks = l.split()
    return bool(toks) and all(t in HWORDS for t in toks) and len(l) - len(l.lstrip()) > 40

def colkey(label):
    s = label.lower()
    if 'technical' in s and 'interpretation' in s: return 'tot'
    if 'technical' in s: return 'tec'
    if 'interpretation' in s: return 'int'
    if s.startswith('not') or 'unreferred' in s or 'entitlement' in s: return 'nr'
    if 'referred' in s: return 'ref'
    if 'practitioner' in s or s == 'general': return 'gp'
    if 'specialist' in s: return 'sp'
    if s == 'class': return 'cls'
    if s == 'anes': return 'an'
    return None

def merge_headers(lines):
    cols = []  # [center, label]
    for l in lines:
        for m in re.finditer(r'\S+(?: \S+)?', l):
            for part in re.finditer(r'\S+', m.group()) if m.group().split()[0] in ('Class', 'Anes') or len(m.group().split()) == 1 else [m]:
                c = part.start() + (m.start() if part is not m else 0) + len(part.group()) / 2
                near = [x for x in cols if abs(x[0] - c) <= 7]
                if near: near[0][1] += ' ' + part.group(); near[0][0] = (near[0][0] + c) / 2
                else: cols.append([c, part.group()])
    return [(c, colkey(lbl), lbl) for c, lbl in cols if colkey(lbl)]

def parse(txt):
    pages = txt.split('\f'); rows = []
    section = ''; cols = []
    for pi, p in enumerate(pages):
        lines = p.split('\n')
        if pi < 60: continue
        prevcols = cols; cols = []
        hdr, sub, cur, laststem = [], '', None, ''
        newsec = False
        def flush():
            nonlocal cur
            if cur and cur.get('done'): rows.append(cur['r'])
            cur = None
        for li, l in enumerate(lines):
            st = l.strip()
            if not st or st.startswith('Payment Schedule for Insured Services') or re.match(r'^[A-Z][a-z]+ \d{1,2}, \d{4}\s+Page \d+$', st): 
                if cur and not st: flush()
                continue
            if 'S E C T I O N' in st:
                sec_txt = re.split(r'\s{3,}', st)[0]
                ms = re.match(r'S E C T I O N\s*([A-Z])\s*[–-]\s*(.+)$', sec_txt)
                nsec = f'Section {ms.group(1)} – {ms.group(2).strip(" *")}' if ms else unspace(sec_txt)
                if nsec != section: prevcols = []
                section = nsec; newsec = True
                rest = st[len(sec_txt):].strip()
                hl = l[:]; hl = ' ' * (len(l) - len(l.lstrip()) + len(sec_txt)) + l.lstrip()[len(sec_txt):]
                if rest and is_header(hl): hdr.append(hl)
                continue
            if is_header(l):
                hdr.append(l); continue
            if hdr:
                cols = merge_headers(hdr); hdr = []
            m = CODE.match(l)
            if m:
                flush()
                code, rest = m.group(2), m.group(3)
                am = list(AMT.finditer(l))
                desc = l[m.start(3): am[0].start()].strip() if am else rest.strip()
                desc = re.split(r'\s{3,}', desc)[0] if am else desc
                if not am: laststem = ''; continue
                if not cols and len(am) > 1 and prevcols: cols = prevcols
                r = {'c': code, 'd': desc, 's': section, 'h': sub, 'p': pi + 1}
                tail = l[am[-1].end():]
                for a in am:
                    cen = (a.start() + a.end()) / 2
                    k = min(cols, key=lambda x: abs(x[0] - cen)) if cols else None
                    if k and abs(k[0] - cen) > 16: k = None
                    val = a.group().rstrip('#*†')
                    v = 'BR' if val.lower() == 'by report' else float(val[1:].replace(',', ''))
                    if a.group()[-1] in '#*†': r.setdefault('mk', a.group()[len(val):])
                    key = k[1] if k else None
                    if key in (None, 'cls', 'an'): key = 'f' if 'f' not in r else None
                    if key and key not in r: r[key] = v
                    elif 'f' not in r: r['f'] = v
                # class / anes columns
                for t in re.finditer(r'\S+', tail):
                    cen = t.start() + len(l) - len(tail) + len(t.group()) / 2
                    k = min(cols, key=lambda x: abs(x[0] - cen)) if cols else None
                    if k and abs(k[0] - cen) <= 8 and k[1] in ('cls', 'an'): r[k[1]] = t.group()
                if cols:
                    r['cl'] = [lbl for _, key, lbl in cols if key not in ('cls', 'an')]
                if desc.startswith('--') and laststem: r['o'] = desc; r['u'] = laststem; r['d'] = laststem + ' ' + desc
                elif desc.startswith('--') and sub: r['o'] = desc; r['u'] = sub; r['d'] = sub + ' ' + desc
                elif '--' in desc: laststem = desc.split('--')[0].strip()
                else: laststem = ''
                cur = {'r': r, 'done': True, 'ind': m.start(3)}
                continue
            ind = len(l) - len(l.lstrip())
            if cur and abs(ind - cur['ind']) <= 3 and not re.match(r'^(\d+\.|[a-z]\)|Note|NOTE|#|\*)', st) and not AMT.search(l) and not cur.get('stop'):
                cur['r']['d'] += ' ' + re.split(r'\s{3,}', st)[0]
                if st.endswith(('.', ':')): cur['stop'] = True
                continue
            if cur: cur['stop'] = True
            nxt = lines[li + 1] if li + 1 < len(lines) else ''
            if (not AMT.search(l) and len(st) < 90 and ind < 16 and not re.match(r'^(\d+\.|[a-z]\)|Note|NOTE|#|\*|--)', st) and st[:1].isupper()
                    and not st.endswith(('.', ',', ':', ';')) and (li == 0 or not lines[li - 1].strip()) and (not nxt.strip() or CODE.match(nxt))):
                sub = st; laststem = ''
    flush()
    for r in rows:
        r['d'] = re.sub(r'\s+', ' ', r['d']).strip()
        if r['d'].startswith('--'): r['d'] = r['d'].lstrip('- ').strip()
        r['s'] = r['s'] or 'Section A – General Services'
    return rows

def extract(pdf=PDF):
    txt = subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True, check=True).stdout
    return txt, parse(txt)

if __name__ == '__main__':
    import json, collections, random
    txt, rows = extract()
    print(len(rows), len({r['c'] for r in rows}))
    print(collections.Counter(tuple(sorted(k for k in r if k in ('f', 'sp', 'gp', 'ref', 'nr', 'tec', 'int', 'tot'))) for r in rows).most_common(15))
    print(collections.Counter(r['s'] for r in rows).most_common(40))
    random.seed(5)
    for r in random.sample(rows, 20): print(r)
    json.dump(rows, open('/tmp/sk_rows.json', 'w'))
