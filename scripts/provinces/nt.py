"""NWT Insured Services Tariff parser, using word positions (pdftotext -bbox).
Columns: Fee Code (left), Descriptor (middle), Price (right). An entry is a vertical run of lines without a blank-line gap;
the code may be split over two lines (e.g. "OB -" / "011F"). (+) markers are kept."""
import re, subprocess, html
W = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>')
AMT = re.compile(r'^[\d,]+\.\d\d$')

def words(pdf):
    out = subprocess.run(['pdftotext', '-bbox', pdf, '-'], capture_output=True, text=True).stdout
    pages = []
    for p in out.split('<page ')[1:]:
        pw = float(re.search(r'width="([\d.]+)"', p).group(1))
        pages.append((pw, [(float(m[1]), float(m[2]), float(m[3]), float(m[4]), html.unescape(m[5])) for m in W.finditer(p)]))
    return pages

def lines_of(ws):
    ls = []
    for w in sorted(ws, key=lambda w: (round(w[1]), w[0])):
        if ls and abs(ls[-1]['y'] - w[1]) < 3: ls[-1]['w'].append(w)
        else: ls.append({'y': w[1], 'h': w[3] - w[1], 'w': [w]})
    for l in ls: l['w'].sort(key=lambda w: w[0])
    return ls

def desc_on_line(l, w):
    """True when w is preceded on its line by a description word (so it is description text, e.g. 'ASA III')."""
    return False

def extract(pdf):
    pages = words(pdf); rows = []; problems = []
    sec = sub = ''
    for pi, (pw, ws) in enumerate(pages):
        txt = ' '.join(w[4] for w in ws)
        if pi < 55 or not re.search(r'[A-Z]{2}\s?-\s?\d{3}', txt): continue
        ls = lines_of(ws)
        # drop running header/footer (page number, EFFECTIVE line, column header)
        ls = [l for l in ls if not re.fullmatch(r'\d{1,3}|EFFECTIVE APRIL 1, 2025|Fee Code|Descriptor|Price|Fee Code Price|Descriptor Fee Code Price', ' '.join(w[4] for w in l['w']))]
        segs = []
        for l in ls:
            if segs and l['y'] - segs[-1][-1]['y'] < 1.6 * max(l['h'], 10): segs[-1].append(l)
            else: segs.append([l])
        CODEX, PRICEX = 0.20 * pw, 0.52 * pw
        for sg in segs:
            codes, desc, price = [], [], []   # codes: [y, text, plus]
            pend_plus = False
            for l in sg:
                for w in l['w']:
                    t = w[4]
                    cur = codes[-1] if codes else None
                    incomplete = cur is not None and not re.fullmatch(r'[A-Z]{2,3}-\d{3}[A-Z]{0,2}|[A-Z]{2}\d{3}', cur[1])
                    if w[0] < CODEX and t in ('(+)', '+') and not desc_on_line(l, w):
                        pend_plus = True; continue
                    if w[0] < CODEX and re.fullmatch(r'[A-Z]{2,3}(?:\s?-\s?\d{3}[A-Z]{0,2}|-)?|[A-Z]{2}\d{3}', t) and not (cur and incomplete) and not (cur and cur[0] == l['y']):
                        codes.append([l['y'], t, pend_plus]); pend_plus = False; continue
                    if w[0] < CODEX and cur and incomplete and re.fullmatch(r'-|-?\d{3}[A-Z]{0,2}|[A-Z]{1,2}', t):
                        cur[1] += t; continue
                    if w[0] >= PRICEX and (AMT.match(t) or t in ('BR', 'IC', 'I.C.')): price.append((l['y'], t)); continue
                    desc.append((l['y'], w[0], t))
            if not codes:
                dtext = re.sub(r'\s+', ' ', ' '.join(t for _, _, t in desc)).strip()
                if dtext and not price:
                    m = re.match(r'^SECTION ([A-Z]{2,3}) (.+)$', dtext)
                    if m: sec = f'Section {m.group(1)} – {m.group(2).title()}'; sub = ''
                    elif len(dtext) < 80 and not dtext.endswith('.'): sub = dtext
                elif price: problems.append((pi + 1, 'price without code', dtext[:80], price))
                continue
            if len(price) != len(codes) or any(not re.fullmatch(r'[A-Z]{2,3}-\d{3}[A-Z]{0,2}|[A-Z]{2}\d{3}', c[1]) for c in codes):
                problems.append((pi + 1, [c[1] for c in codes], ' '.join(t for _, _, t in desc)[:80], [p for _, p in price])); continue
            # each price and description line goes to the nearest code by vertical position
            ys = [c[0] for c in codes]
            near = lambda y: min(range(len(ys)), key=lambda k: (abs(ys[k] - y), -k))
            pr = {}
            for y, t in price:
                k = near(y)
                if k in pr: problems.append((pi + 1, 'two prices for one code', codes[k][1], [p for _, p in price])); pr = None; break
                pr[k] = t
            if pr is None: continue
            dd = {}
            if len(codes) == 1: dd[0] = desc
            else:
                for d in desc: dd.setdefault(near(d[0]), []).append(d)
            for k, (y, code, plus) in enumerate(codes):
                dtext = re.sub(r'\s+', ' ', ' '.join(t for _, _, t in sorted(dd.get(k, []), key=lambda d: (round(d[0]), d[1])))).strip()
                pv = pr[k]
                rows.append({'c': code, 'd': dtext, 's': sec, 'h': sub, 'p': pi + 1,
                             'f': float(pv.replace(',', '')) if AMT.match(pv) else ('BR' if pv == 'BR' else 'IC'), **({'mk': '+'} if plus else {})})
    return pages, rows, problems

if __name__ == '__main__':
    import sys, json, collections
    pages, rows, probs = extract(sys.argv[1])
    print(len(rows), 'rows', len({r['c'] for r in rows}), 'codes', len(probs), 'problems')
    for p in probs[:40]: print('PROB', p)
    print(collections.Counter(r['s'] for r in rows))
    json.dump(rows, open('/tmp/nt_rows.json', 'w'), indent=0, ensure_ascii=False)
