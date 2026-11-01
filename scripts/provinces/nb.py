"""New Brunswick Physicians' Manual parser (pdftotext -bbox word positions).
Fee pages have a header "<Chapter title>  List  Code  Units(Gen)  Units(An)". A service is the description lines since the
previous service/heading/note plus the line carrying the code (in the Code column) and its units. Lines at the left margin are
headings; "Medicare Note:" paragraphs (indented less than descriptions) are skipped. A one-line entry indented deeper than the
preceding multi-line entry's first line inherits that first line as its parent (e.g. "Repair of inversion of uterus – Manual").
Units are kept exactly as printed (the dollar value per unit depends on the specialty, Chapter 3 section 1.5)."""
import re, subprocess, html
W = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>')
LEAD = re.compile(r'[.…]{2,}')

def pages_of(pdf):
    out = subprocess.run(['pdftotext', '-bbox', pdf, '-'], capture_output=True, text=True).stdout
    return [[(float(m[1]), float(m[2]), float(m[3]), float(m[4]), html.unescape(m[5])) for m in W.finditer(p)] for p in out.split('<page ')[1:]]

def lines_of(ws):
    ls = []
    for w in sorted(ws, key=lambda w: (w[1], w[0])):
        if ls and abs(ls[-1]['y'] - w[1]) < 4: ls[-1]['w'].append(w)
        else: ls.append({'y': w[1], 'w': [w]})
    for l in ls: l['w'].sort(key=lambda w: w[0]); l['t'] = ' '.join(w[4] for w in l['w']); l['x'] = l['w'][0][0]
    return ls

def clean(t):
    t = LEAD.sub(' ', t)
    return re.sub(r'\s+', ' ', re.sub(r'([a-z])- ([a-z])', r'\1-\2', t)).strip(' .…')

SMALL = {'and', 'of', 'the', 'in', 'with', 'to', 'for', 'or', 'on'}
def toc_titles(pdf):
    """Full chapter titles and Chapter 5 section titles from the table of contents (running headers are truncated)."""
    t = subprocess.run(['pdftotext', '-layout', '-f', '2', '-l', '16', pdf, '-'], capture_output=True, text=True).stdout
    ls = [l.strip() for l in t.split('\n')]
    chaps, secs, cur, i = {}, {}, None, 0
    while i < len(ls):
        l = ls[i]; m = re.match(r'^(CHAPTER|Section)\s*(\d+):\s*(.*)$', l)
        if m:
            txt = m.group(3)
            if not LEAD.search(txt) and i + 1 < len(ls) and ls[i + 1] and not re.match(r'^(CHAPTER|Section|\d)', ls[i + 1]): txt += ' ' + ls[i + 1]; i += 1
            txt = re.sub(r'\s+', ' ', LEAD.split(txt)[0]).strip(' .')
            if m.group(1) == 'CHAPTER':
                cur = int(m.group(2))
                w = txt.lower().split(); chaps[cur] = ' '.join(x if (x in SMALL and k) else x[:1].upper() + x[1:] for k, x in enumerate(w))
            elif cur == 5: secs.setdefault(int(m.group(2)), txt)
        i += 1
    return chaps, secs

def extract(pdf):
    P = pages_of(pdf); rows, problems = [], []; shifted = []
    CH, S5 = toc_titles(pdf)
    chap = sub = spec = ''; parent = None; pend = []; note = False; prevy = -99
    for pi, ws in enumerate(P):
        ls = lines_of(ws)
        if len(ls) < 3: continue
        top = next((l for l in ls[:3] if 'Code' in [w[4] for w in l['w']] and ({'List', 'Lists'} & {w[4] for w in l['w']})), None)
        if top is None: continue
        hw = {w[4]: w for w in top['w'] if w[0] > 300}
        units = [w for w in top['w'] if w[4] == 'Units']
        if 'Code' not in hw or len(units) < 2: continue
        cx, gx, ax, lx = hw['Code'][0], units[0][0], units[1][0], (hw.get('List') or hw.get('Lists') or (0,))[0]
        ga = next((l for l in ls[:4] if l['t'] == 'Gen An'), None)
        if ga and abs(ga['w'][0][0] - gx) > 10:              # header words shifted one column (e.g. PDF p. 328): trust the Gen/An line
            d = ga['w'][0][0] - gx; cx, gx, ax, lx = cx + d, gx + d, ga['w'][1][0], lx + d; shifted.append(pi + 1)
        hm = re.match(r'Chapter (\d+)', clean(' '.join(w[4] for w in top['w'] if w[0] < lx - 5)))
        if hm and int(hm.group(1)) in CH: chap = f'Chapter {hm.group(1)}: ' + CH[int(hm.group(1))]
        foot = ls[-1]['t']; label = (re.match(r'^(\d{1,3})\b', foot) or re.search(r'(\d{1,3})$', foot) or [None, str(pi + 1)])[1]
        body = [l for l in ls if l is not top and l is not ls[-1] and not (l['y'] < top['y'] + 20 and l['t'] in ('Gen An', 'Gen', 'An'))]
        if sum(1 for l in body for w in l['w'] if w[0] < 300 and re.fullmatch(r'\d{4}', w[4])) > 15: continue   # code index pages
        newpage = True
        for l in body:
            codes = [w for w in l['w'] if cx - 14 < w[0] < gx - 6 and re.fullmatch(r'\d{1,4}[A-Z]?', w[4])]
            t = l['t']
            gap = 0 if newpage else l['y'] - prevy
            if l['x'] >= 80 and (t.startswith('Medicare Note') or (note and not LEAD.search(t) and (l['x'] < 104 if gap == 0 else (l['x'] < 99 or gap < 15)))):
                note = True; pend = []; prevy = l['y']; newpage = False; continue
            if not codes:
                if l['x'] < 80:                                  # heading at the left margin
                    h = clean(t)
                    h = re.sub(r'[^\x20-\x7e\u00a0-\u024f\u2013\u2014\u2019]', '', h).strip()
                    m5 = re.match(r'^Section (\d+):\s*(.+)$', h)
                    mc = re.match(r'^CHAPTER\s*(\d+):', h)
                    if mc and int(mc.group(1)) in CH: chap = f'Chapter {mc.group(1)}: ' + CH[int(mc.group(1))]; spec = sub = ''
                    if m5 and chap.startswith('Chapter 5:'): spec = f'Section {m5.group(1)}: ' + S5.get(int(m5.group(1)), m5.group(2)); sub = ''
                    elif h and not h.startswith(('See legend', 'These fees')) and len(h) < 90 and not h.startswith('CHAPTER'): sub = h
                    pend = []; note = False; parent = None; newpage = False; prevy = l['y']; continue
                newpage = False
                note = False
                if pend and gap > 18: pend = []            # paragraph break: earlier lines were a note or preamble
                if not re.match(r'^\(?(See |Refer to )', t): pend.append(l)
                prevy = l['y']; continue
            note = False; prevy = l['y']; newpage = False
            if len(codes) > 1: problems.append((pi + 1, 'two codes on one line', t[:90])); pend = []; continue
            c = codes[0]
            left = [w for w in l['w'] if w[0] < c[0] - 2]
            lst = ''
            if left:
                m = re.search(r'(?:^|[.…])([A-D])$', left[-1][4])
                if m and (left[-1][0] > lx - 60 or LEAD.search(left[-1][4])):
                    lst = m.group(1); left = left[:-1] + ([(left[-1][0], 0, 0, 0, left[-1][4][:-1])] if len(left[-1][4]) > 1 else [])
            right = [w for w in l['w'] if w[0] > c[2] + 1]
            gen = ' '.join(w[4] for w in right if w[0] < ax - 8); an = ' '.join(w[4] for w in right if w[0] >= ax - 8)
            UV = re.compile(r'^(\d+(\.\d+)?|IC|TU|VF|BR|\+?\d+%|\+|T|U|units?)$')
            if any(not UV.match(w[4]) for w in right):   # a code number inside a note sentence, not a service line
                problems.append((pi + 1, 'code in text', t[:90])); pend = []; continue
            grp = pend + [{'x': l['x'] if left else c[0], 't': ' '.join(w[4] for w in left)}]
            d = clean(' '.join(g['t'] for g in grp))
            if len(grp) == 1 and parent and grp[0]['x'] > parent[1] + 10: d = parent[0] + ' – ' + d
            elif len(grp) > 1 and grp[1]['x'] > grp[0]['x'] + 10: parent = (clean(grp[0]['t']), grp[0]['x'])
            elif len(grp) > 1: parent = None
            r = {'c': c[4], 'd': d, 's': (chap + ' – ' + spec) if spec and chap.startswith('Chapter 5:') else chap, 'h': sub, 'p': pi + 1, 'l': label}
            if gen: r['u'] = gen
            if an: r['an'] = an
            if lst: r['ls'] = lst
            if not d: problems.append((pi + 1, 'no description', c[4])); pend = []; continue
            rows.append(r); pend = []
    if shifted: print('header shifted on PDF pages', shifted)
    return P, rows, problems

if __name__ == '__main__':
    import sys, json, collections
    P, rows, probs = extract(sys.argv[1])
    print(len(rows), 'rows', len({r['c'] for r in rows}), 'codes', len(probs), 'problems')
    for p in probs[:30]: print('PROB', p)
    print(collections.Counter(r['s'] for r in rows).most_common(40))
    print(collections.Counter(r.get('u') for r in rows if not re.fullmatch(r'\d+(\.\d+)?', r.get('u', '0'))).most_common(20))
    print(collections.Counter(r.get('an') for r in rows).most_common(20))
    json.dump(rows, open('/tmp/nb/rows.json', 'w'), indent=0, ensure_ascii=False)
