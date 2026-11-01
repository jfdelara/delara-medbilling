"""PEI Physician Services Agreement 2024-2029, Schedule A Tariff of Fees parser (pdftotext -layout).
Each fee line: description, 4-digit fee code, five amounts (columns effective 1 Apr 2025, 1 Apr 2027, 1 Oct 2027,
1 Apr 2028, 1 Oct 2028). Wrapped description lines above a fee line are joined to it; short items under a
one-line group heading (e.g. "Sympathectomy" / "Cervical") take the heading as context."""
import re, subprocess
COLS = ['2025-04-01', '2027-04-01', '2027-10-01', '2028-04-01', '2028-10-01']
AMT = r'(?:[\d,]+\.\d\d|I\.C\.)'
FEE = re.compile(r'^(.*?)\s{2,}(\d{4}[A-Z]?)\s+(' + AMT + r')\s+(' + AMT + r')\s+(' + AMT + r')\s+(' + AMT + r')\s+(' + AMT + r')\s*$')
HDR = re.compile(r'^\s*(Fee\s+1-Apr|Code\s+2025|Tariff - \d+|These fees cannot be correctly interpreted|to the Preamble\.)')

def val(v): return 'IC' if v == 'I.C.' else float(v.replace(',', ''))

def extract(pdf, first=174, last=251):
    txt = subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True).stdout
    pages = txt.split('\f'); rows = []
    sec = sub = ''
    for pi in range(first - 1, min(last, len(pages))):
        lines = pages[pi].split('\n'); pending = []; stem = ''; prev_row = None
        for li, l in enumerate(lines):
            s = l.strip()
            if not s: pending = []; prev_row = None; continue
            if HDR.match(l): continue
            m = FEE.match(l)
            if m:
                own = m.group(1).strip(); amts = [val(m.group(i)) for i in range(3, 8)]
                printed = own; parent = ''
                if re.match(r'^-\s*See\b', own):  # wrapped "- See Preamble x" belongs to the description above
                    d = ' '.join(pending + [own]) if pending else (rows[-1]['d'] if rows else '') + ' ' + own
                    if not pending: parent = rows[-1]['d'] if rows else ''
                elif own.startswith('-') or own == '':
                    bare = own.lstrip('- ').strip()
                    if pending:
                        parent = ' '.join(pending); stem = parent; d = parent + ' – ' + bare
                    elif stem and len(bare.split()) < 3:
                        parent = stem; d = stem + ' – ' + bare
                    else:
                        d = bare; stem = ''
                elif pending:
                    joined = ' '.join(pending)
                    if len(pending) == 1 and len(joined.split()) <= 5 and not re.search(r'[,\-/]$|\b(and|of|or|with|the|for|to)$|\d', joined) and own[:1].isupper() and len(own.split()) <= 4:
                        stem = joined; parent = stem; d = stem + ' – ' + own
                    else:
                        d = joined + ' ' + own; stem = '' if not own.startswith('-') else stem
                elif stem and len(own.split()) <= 3:
                    parent = stem; d = stem + ' – ' + own
                else:
                    d = own; stem = ''
                d = re.sub(r'\s+', ' ', d).strip().lstrip('*').strip()
                r = {'c': m.group(2), 'd': d, 's': sec, 'h': sub, 'p': pi + 1, 'v': dict(zip(COLS, amts)),
                     'stem': re.sub(r'\s+', ' ', parent or d.split(' – ')[0])}
                if parent: r['o'] = printed; r['u'] = parent
                rows.append(r); pending = []; prev_row = r; continue
            if re.fullmatch(r'[A-Z0-9 &,/()\-–\'’.:]+', s) and re.search(r'[A-Z]{3}', s):
                nxt = next((x.strip() for x in lines[li + 1:li + 4] if x.strip()), '')
                if nxt.startswith('These fees cannot'): sec = re.sub(r'\b(On|The|And|Of)\b', lambda w: w.group(1).lower(), re.sub(r'\s+', ' ', s).title()); sec = sec[0].upper() + sec[1:]; sub = ''
                else: sub = re.sub(r'\s+', ' ', s)
                pending = []; stem = ''; continue
            if re.match(r'^\d+\.\s+[A-Z][A-Z &/,\-]{3,}', s): sub = re.sub(r'\s+', ' ', s); pending = []; stem = ''; continue
            if s.startswith('**') or s.startswith('*'): pending = []; continue
            if prev_row is not None and s.startswith('('):
                prev_row['d'] += ' ' + s; continue
            pending.append(s)
    for r in rows: r.pop('stem', None)
    return txt, rows

if __name__ == '__main__':
    import sys, json, collections
    txt, rows = extract(sys.argv[1])
    print(len(rows), 'rows', len({r['c'] for r in rows}), 'codes')
    print(collections.Counter(r['s'] for r in rows).most_common(40))
    json.dump(rows, open('/tmp/pe_rows.json', 'w'), indent=0, ensure_ascii=False)
    for r in rows:
        if r['c'] in ('5980', '5981', '6004', '6006', '6009', '6010', '0004', '6005', '1850', '0812', '6014'): print(r)
