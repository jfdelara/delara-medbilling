"""Newfoundland and Labrador MCP Medical Payment Schedule parser (pdftotext -bbox word positions).
Each listing page has a column header: Code + (Rate | FP Spec. | FP/Spec. Anaes. | Assist FP/Spec. Anaes.).
A row starts with a code at the left; description words run to the dot leader; values are assigned to the
nearest header column (by right edge). Wrapped description lines are indented deeper than the description column.
Lines at the description column without a code are headings (short) or notes (they end the current row)."""
import re, subprocess, html
W = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>')
AMT = re.compile(r'^\d[\d,]*\.\d\d$|^\.\d\d$')
VAL = re.compile(r'^(\d[\d,]*\.\d\d|\.\d\d|\d{1,2}(\.\d)?|NC|IC|I\.C\.|BR|\d{1,3}%|units?|\+|time)$')
CODE = re.compile(r'^\d{2,6}$')
LEAD = re.compile(r'[.…]{2,}\S*$|…+')

def pages_of(pdf):
    out = subprocess.run(['pdftotext', '-bbox', pdf, '-'], capture_output=True, text=True).stdout
    return [[(float(m[1]), float(m[2]), float(m[3]), float(m[4]), html.unescape(m[5])) for m in W.finditer(p)] for p in out.split('<page ')[1:]]

def lines_of(ws):
    ls = []
    for w in sorted(ws, key=lambda w: (w[1], w[0])):
        if ls and abs(ls[-1]['y'] - w[1]) < 3: ls[-1]['w'].append(w)
        else: ls.append({'y': w[1], 'w': [w]})
    for l in ls: l['w'].sort(key=lambda w: w[0]); l['t'] = ' '.join(w[4] for w in l['w'])
    return ls

def cap(s):
    s = s.title()
    for a in (' And ', ' Or ', ' Of ', ' For ', ' The ', ' In ', ' To ', ' On ', ' With '): s = s.replace(a, a.lower())
    return s

def extract(pdf):
    P = pages_of(pdf); rows, problems = [], []
    texts = []
    for pi, ws in enumerate(P):
        ls = lines_of(ws)
        texts.append(ls)
        label = ls[-1]['t'].strip() if ls else ''
        hi = next((i for i, l in enumerate(ls) if l['w'][0][4] == 'Code' and l['w'][0][0] < 90 and len(l['w']) > 1), None)
        if hi is None or re.match(r'^(X|Table)', label) or ' '.join(l['t'] for l in ls[:3]).find('Table') >= 0: continue
        hdr = ls[hi]['w'][1:] + [w for w in (ls[hi - 1]['w'] if hi else []) if w[4] in ('FP/', 'FP')]
        names = [w[4] for w in hdr]
        cols = []
        for w in ls[hi]['w'][1:]:
            t = w[4]
            if t == 'Rate': cols.append(('an' if 'DENTAL' in ' '.join(l['t'] for l in ls[:hi]) else 'f', w))  # dental anaesthesia: Rate = units
            elif t == 'Assist': cols.append(('as', w))
            elif t == 'Anaes.': cols.append(('an', w))
            elif t == 'Spec.': cols.append(('sp' if 'FP' in [x[4] for x in ls[hi]['w']] else 'f', w))
            elif t == 'FP': cols.append(('fp', w))
        if not cols: continue
        lo = min(c[1][0] for c in cols) - 50
        # section title: lines between the date line and the "These Listings ..." line
        ti = next((i for i, l in enumerate(ls) if l['t'].startswith('These Listings')), hi)
        title = [l['t'] for l in ls[:ti] if not re.search(r'\b20\d\d$', l['t']) and l['t'].strip() not in ('FP/', 'Prem FP/')]
        sec = ' – '.join(cap(x) for x in title) or (rows[-1]['s'] if rows else '')
        sub = rows[-1]['h'] if rows and rows[-1]['s'] == sec else ''
        cur = None; descx = None; lasthead = None
        for l in ls[hi + 1:-1]:
            ws_ = l['w']
            vals = []   # trailing value tokens (right of the dot leader), right to left
            for w in reversed(ws_):
                if w[0] >= lo and VAL.match(w[4]): vals.insert(0, w)
                else: break
            if not vals:  # an amount in a column followed by a short remark (e.g. "103.69 See biopsy codes")
                am = [w for w in ws_ if w[0] >= lo and AMT.match(w[4])]
                if len(am) == 1: vals = am
            text = [w for w in ws_ if w not in vals]
            first = text[0] if text else None
            iscode = first is not None and CODE.match(first[4]) and first[2] < 110 and first[0] < 95
            if iscode: lasthead = None
            if iscode:
                code = first[4]; text = text[1:]
                if text: descx = text[0][0] if descx is None else descx
                cur = {'c': code, 'd': '', 's': sec, 'h': sub, 'p': pi + 1, 'l': label, 'v': {}}
                rows.append(cur)
            elif first is not None and descx is not None and first[0] < descx + 6 and cur is not None and cur['v'] and vals:
                problems.append((pi + 1, 'values without code', l['t'][:90])); cur = None; continue
            elif first is not None and not vals and (cur is None or (descx is not None and first[0] < descx + 6 and cur['v'])):
                t = re.sub(r'\s+', ' ', LEAD.sub('', ' '.join(w[4] for w in text))).strip()
                if t and len(t) < 70 and not t.endswith(('.', ':')) and not re.match(r'^\d+\.', t):
                    sub = (sub + ' ' + t) if lasthead is not None and l['y'] - lasthead < 14 else t   # two-line heading
                    lasthead = l['y']
                else: lasthead = None
                cur = None; continue
            if cur is None:
                if vals: problems.append((pi + 1, 'values without code', l['t'][:90]))
                continue
            d = ' '.join(LEAD.sub('', w[4]) for w in text).strip()
            if d: cur['d'] = (cur['d'] + ' ' + d).strip()
            for w in vals:
                k = min(cols, key=lambda c: abs(c[1][2] - w[2]))[0]
                cur['v'].setdefault(k, []).append(w[4])
    out = []
    for r in rows:
        v = r.pop('v'); r['d'] = re.sub(r'([a-z])- ([a-z])', r'\1-\2', re.sub(r'\s+', ' ', r['d'])).strip(' .…')  # rejoin words hyphenated at a line break
        bad = False
        for k, toks in v.items():
            if sum(1 for t in toks if AMT.match(t)) > 1: bad = True
            s = ' '.join(toks).replace('I.C.', 'IC')
            r[k] = float(s.replace(',', '')) if AMT.match(s) else s
        if bad: problems.append((r['p'], 'two amounts in one column', r['c'], v)); continue
        if not any(k in r for k in ('f', 'fp', 'sp', 'as', 'an')) and re.match(r'^(\d{5}\b|$)', r['d']):  # code lists (e.g. premium-eligible procedures)
            problems.append((r['p'], 'empty row', r['c'])); continue
        out.append(r)
    return texts, out, problems

if __name__ == '__main__':
    import sys, json, collections
    texts, rows, probs = extract(sys.argv[1])
    print(len(rows), 'rows', len({r['c'] for r in rows}), 'codes', len(probs), 'problems')
    for p in probs[:60]: print('PROB', p)
    print(collections.Counter(r['s'] for r in rows).most_common(60))
    print('no value', sum(1 for r in rows if not any(k in r for k in ('f', 'fp', 'sp', 'as', 'an'))))
    json.dump(rows, open('/tmp/nl/rows.json', 'w'), indent=0, ensure_ascii=False)
