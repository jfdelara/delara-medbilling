#!/usr/bin/env python3
"""Manitoba Physician's Manual -> site/data/prov/MB.json (rows only; build_prov.py adds meta).
Source: Manitoba Health, Seniors and Long-Term Care, Physician's Manual (PDF), parsed from `pdftotext -layout`.
Each tariff row keeps its own section, sub-heading and PDF page: visit tariffs repeat per specialty with different fees.
Amount columns are read by x-position under the column headers printed on the page (TEC/PRO, GP/Specialist,
Column C, Unit Value). Anaesthetic unit values come from Appendix A."""
import json, re, subprocess, os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PDF = os.path.join(ROOT, 'raw', 'provinces', 'mb_physmanual.pdf')

LABEL = re.compile(r'^\s*(?:[A-Z][a-z]+ \d{1,2}, \d{4})\s+(\S+)\s*$|^\s*(\S+)\s+(?:[A-Z][a-z]+ \d{1,2}, \d{4})\s*$')
CODE = re.compile(r'^(\s{0,12})(\d{4})(\*?)\s+(\S.*)$')
AMT = r'By Report|F/S|\d+%|[\d,]+\.\d+'
FEE = re.compile(r'\.{2,}\s*((?:' + AMT + r')(?:\s+(?:' + AMT + r'))*)\s*$')
COLNAMES = {'TEC': 'tec', 'PRO': 'pro', 'C': 'colc', 'UNIT VALUE': 'au', 'UNIT VA': 'au', 'GENERAL PRACTITIONER': 'gp', 'SPECIALIST': 'sp'}

def unspace(s):
    s = re.sub(r'\b([A-Z]) (?=[A-Z]{2,}|[A-Z]\b)', r'\1', s)
    return re.sub(r'\s+', ' ', s).strip()

def amount(g):
    if g == 'By Report': return 'BR'
    if g == 'F/S': return 'FS'
    if g.endswith('%'): return g
    return float(g.replace(',', ''))

def header_groups(l):
    out = []
    for m in re.finditer(r'\S+(?: \S+)*', l):
        t, a, b = m.group(), m.start(), m.end()
        if t == 'COLUMN C UNIT VALUE': out += [(a + 4, 'colc'), (b - 5, 'au')]
        elif t in ('COLUMN', 'GENERAL'): out.append(((a + b) / 2, None))
        else: out.append(((a + b) / 2, {'TEC': 'tec', 'PRO': 'pro', 'UNIT VALUE': 'au', 'UNIT VA': 'au', 'UNIT': 'au', 'VALUE': 'au', 'PRACTITIONER': 'gp',
                                        'GENERAL PRACTITIONER': 'gp', 'SPECIALIST': 'sp', 'C': 'colc'}.get(t)))
    return out

def is_colhead(l):
    st = l.strip()
    return bool(st) and len(l) - len(l.lstrip()) > 50 and re.fullmatch(r'[A-Z][A-Z .()/&]*', st) is not None and not re.search(r'\b[A-Z] [A-Z] [A-Z]', st)

def appendix_units(pages):
    au = {}
    for p in pages:
        ne = [l for l in p.split('\n') if l.strip()]
        if not ne or ne[0].strip() != 'Appendices': continue
        if 'UNIT VALUE' not in p: continue
        for m in re.finditer(r'(?m)(?:^|\s{2,})(\d{4})\s{2,}(\d{1,2}\.\d{3})\b', p):
            au.setdefault(m.group(1), float(m.group(2)))
    return au

def parse(txt):
    pages = txt.split('\f')
    AU = appendix_units(pages)
    rows = []
    started = False
    for pi, p in enumerate(pages):
        lines = p.split('\n')
        ne = [l for l in lines if l.strip()]
        if not ne: continue
        m = LABEL.match(ne[-1]); label = (m.group(1) or m.group(2)) if m else ''
        header = ne[0].strip()
        if not started and pi > 40 and header.startswith('Visits/Examinations'): started = True
        if not started or header == 'Appendices' or header.startswith('Numeric Tariff'): continue
        section = header
        sub, head, cur, note, root, cols, lastcol = '', [], None, False, '', [], -9
        def flush():
            nonlocal cur, root
            c = cur; cur = None
            if not c or c['amts'] is None: return
            d = re.sub(r'\s+', ' ', c['desc']).strip(' .')
            own = None
            if c['lower'] and c['head']:
                own = d
                w = d.split()[0].strip(',').lower()
                hd = c['head']
                mm = re.search(r'(?:^|[ ,—-])' + re.escape(w) + r'\b', hd.lower())
                if mm and mm.start() > 3: d = hd[:mm.start()].rstrip(' ,—-') + ', ' + d
                elif c['coded'] and ',' in hd: d = hd.split(',')[0].rstrip() + ', ' + d
                else: d = hd.rstrip(' ,—-:') + ' — ' + d
            elif not c['lower']: root = d
            r = {'c': c['code'], 'd': d, 's': section, 'h': c['sub'], 'p': pi + 1, 'l': label}
            if own: r['o'] = own; r['u'] = c['head']
            if c['ast']: r['ast'] = 1
            amts = c['amts']
            named = [cg for cg in cols if cg[1]]
            free = []
            for pos, val in amts:
                near = [cg for cg in named if abs(cg[0] - pos) <= 12]
                k = min(near, key=lambda cg: abs(cg[0] - pos))[1] if near else None
                if k == 'au':
                    ok = isinstance(amount(val), float) and ( (c['code'] in AU and abs(AU[c['code']] - amount(val)) < 1e-6) or (c['code'] not in AU and re.fullmatch(r'\d{2}\.\d{3}', val) and (amount(val) * 8) % 1 == 0))
                    if not ok: k = None
                if k and k not in r: r[k] = amount(val)
                else: free.append(amount(val))
            if 'colc' in r: r['f'] = r.pop('colc'); r['fl'] = 'Column C'
            if free and 'f' not in r and not ({'tec', 'pro', 'gp', 'sp'} & set(r)): r['f'] = free[0]
            if 'gp' in r and 'sp' in r and r['gp'] == r['sp']: r['f'] = r.pop('gp'); r.pop('sp')
            if c['code'] in AU and 'au' not in r: r['au'] = AU[c['code']]
            rows.append(r)
        for li, l in enumerate(lines[1:], 1):
            if not l.strip() or LABEL.match(l): continue
            st = l.strip()
            if is_colhead(l):
                gs = header_groups(l)
                if li - lastcol <= 2 and cols:
                    for pos, k in gs:
                        near = [c for c in cols if abs(c[0] - pos) < 9]
                        if near and k: cols[cols.index(near[0])] = (near[0][0], k)
                        elif not near and k: cols.append((pos, k))
                else:
                    cols = [(pos, k) for pos, k in gs if k] if any(k for _, k in gs) else [(pos, None) for pos, _ in gs]
                # "COLUMN" alone on the first line: names arrive on the next line
                lastcol = li; cols = [c for c in cols]
                continue
            if re.fullmatch(r'(?:[A-Z]\s?){3,}.*', st) and st.upper() == st and re.search(r'\b[A-Z] [A-Z]', st) and not re.search(r'\d{4}', st) and len(l) - len(l.lstrip()) < 20:
                flush(); sub = unspace(st).title(); head = []; note = False; root = ''; cols = []; continue
            if st.startswith('These benefits cannot') or st.startswith('COLUMN C:'): continue
            m = CODE.match(l)
            if m:
                flush(); note = False
                desc = m.group(4)
                if not desc[:1].islower(): head = []
                cur = {'code': m.group(2), 'ast': bool(m.group(3)), 'desc': '', 'amts': None, 'sub': sub,
                       'head': ' '.join(head).strip(' :—-') or root, 'coded': not head, 'lower': desc[:1].islower()}
                rest, off = desc, m.start(4)
            elif cur and not note:
                rest, off = st, len(l) - len(l.lstrip())
            else:
                if re.match(r'^(Note|NOTE)s?\b', st): note = True; continue
                if note: continue
                if cur is None and not re.search(r'\.{3,}', st) and len(st) < 160 and l[:1] == ' ' and not st[:1].isdigit():
                    if head and st[:1].isupper() and not head[-1].endswith(('—', '-', ',', 'and', 'or', 'of', 'with')): head = []
                    head.append(st); root = ''
                continue
            if re.match(r'^(Note|NOTE)s?\b', rest.strip()):
                note = True; cur = None if cur and cur['amts'] is None else cur; continue
            fm = FEE.search(rest)
            if fm:
                cur['desc'] += ' ' + rest[:fm.start()]
                cur['amts'] = [(off + fm.start(1) + a.start() + len(a.group()) / 2, a.group()) for a in re.finditer(AMT, fm.group(1))]
                flush()
            else:
                cur['desc'] += ' ' + rest
        flush()
    return rows

def rules_toc(txt):
    """Rules of Application (General Rules) titles with page labels, from the table of contents."""
    out = []
    for p in txt.split('\f')[:4]:
        for l in p.split('\n'):
            m = re.match(r'^\s*(\d{1,2})\s*[—-]\s*(.+?)\s*\.{3,}\s*(\S+)\s*$', l)
            if m: out.append({'n': int(m.group(1)), 'title': re.sub(r'\s+', ' ', m.group(2)), 'label': m.group(3)})
    return out

def label_pages(txt):
    lab = {}
    for i, p in enumerate(txt.split('\f')):
        ne = [l for l in p.split('\n') if l.strip()]
        if ne:
            m = LABEL.match(ne[-1])
            if m: lab.setdefault(m.group(1) or m.group(2), i + 1)
    return lab

def extract(pdf=PDF):
    txt = subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True, check=True).stdout
    return txt, parse(txt)

if __name__ == '__main__':
    txt, rows = extract()
    print(len(rows), 'rows', len({r['c'] for r in rows}), 'codes')
    json.dump(rows, open('/tmp/mb_rows.json', 'w'), indent=0)
