"""Nova Scotia MSI Physician's Manual, Section 8 Schedule of Benefits parser (pdftotext -layout).
Each priced line becomes a row: code, item description, modifiers as printed (m), base units (u, as printed),
anaesthetic units (an, as printed). Specialty section comes from the page footer."""
import re, subprocess
CAT = r'[A-Z]{4}'
CODE = r'\d{2}\.\d{1,2}[A-Z]{0,2}'
ITEM = re.compile(r'^\s*(' + CAT + r')\s+(' + CODE + r')(?:\s+(\S.*))?$')
FOOT = re.compile(r'Section 8: NS MSI Schedule of Benefits\s*[–-]\s*(.+?)\s*-\s*(\d+)\s*$', re.M)
TAIL = re.compile(r'^(.*?)\s*\.{3,}\s*(.*?)\s*$')
BASE = r'(?:IC(?:\s+at)?\s*\d+\s*(?:MSU)?/hr|\d+\s*(?:MSU)?/hr|(?:\d+(?:\.\d+)?|IC|BR)(?:\s*MSU/hr)?(?:\s*\+\s*MU?\b)?(?:\s+per\s+(?:\d+|½)\s+(?:min|hour|hr)\.?)?(?:\s*\+\s*MU\b)?)'
AN = r'(?:(?:\d+(?:\.\d+)?|IC)\s*\+\s*T\b|\d+\+(?!\S)|Time Only|\d+(?:\.\d+)?)'

SHORT = re.compile(r'^(.*?\S)\s*(?:\.{1,2}\s+|\s{6,}|(?<=\))\s+)(\d+(?:\.\d+)?|IC)(?:\s+(' + AN + r'))?\s*$')

def split_tail(rest):
    """rest = text after the dot leader. Returns (base, anaes) as printed. A lone plain number far from the
    leader (>12 spaces) is in the anaesthetic column; +T and 'Time Only' are always anaesthetic."""
    if not rest.strip(): return None, None
    m = re.match(r'^(\s*)(?:(' + BASE + r')(?:\s+(' + AN + r'))?|(' + AN + r'))\s*$', rest)
    if not m: return 'ERR:' + rest, None
    gap, base, an, lone = len(m.group(1)), m.group(2), m.group(3), m.group(4)
    if lone and not base: return (lone, None) if re.fullmatch(r'\d+(?:\.\d+)?', lone) else (None, lone)
    return base, an

def extract(pdf):
    txt = subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True).stdout
    pages = txt.split('\f'); rows = []; bad = []
    for pi, page in enumerate(pages):
        fm = FOOT.search(page)
        if not fm or pi < 215: continue
        sec, lab = fm.group(1).strip(), fm.group(2)
        cur = None; sub = ''
        lines = page.split('\n')
        for li, l in enumerate(lines):
            if FOOT.search(l) or 'PHYSICIAN’S MANUAL 2026' in l: continue
            s = l.strip()
            if not s: continue
            im = ITEM.match(l)
            if im:
                cat, code, rest = im.groups(); rest = rest or ''
                tm = TAIL.match(rest)
                # dot leader runs to the line end and the amount gap is measured on the raw line
                if tm and re.search(r'\.{3,}', rest):
                    desc = tm.group(1).strip(); after = rest[list(re.finditer(r'\.{3,}', rest))[-1].end():]
                    cur = {'c': code, 'cat': cat, 'd': desc, 's': sec, 'h': sub, 'p': pi + 1, 'l': lab, 'priced': False}
                    base, an = split_tail(after)
                    if base and base.startswith('ERR'): bad.append((pi + 1, l)); continue
                    rows.append(dict(cur, u=base, an=an)); cur['priced'] = True
                else:
                    cur = {'c': code, 'cat': cat, 'd': rest.strip(), 's': sec, 'h': sub, 'p': pi + 1, 'l': lab, 'priced': False}
                    sm = SHORT.match(rest)
                    if sm:  # short or missing dot leader before the units, e.g. "(regions required) 10", ".. 375   10+T"
                        cur['d'] = sm.group(1).strip(' .')
                        rows.append(dict(cur, u=sm.group(2), an=sm.group(3))); cur['priced'] = True
                continue
            if re.fullmatch(r'[A-Z0-9 ,&/()\-–\'’.:;]+', s) and len(s) > 3 and not re.search(r'[a-z]', s) and '=' not in s and '...' not in s:
                if s not in ('HEALTH', 'SERVICE', 'CATEGORY CODE    DESCRIPTION / MODIFIERS') and not s.startswith('CATEGORY') and not re.match(r'^(BASE|ANAES|UNITS)', s):
                    sub = re.sub(r'\s+', ' ', s); cur = None
                continue
            if cur is None: continue
            if re.search(r'\.{3,}', l):
                txtpart = l[:l.find('...')].strip(); after = l[list(re.finditer(r'\.{3,}', l))[-1].end():]
                base, an = split_tail(after)
                if base and base.startswith('ERR'): bad.append((pi + 1, l)); continue
                if base is None and an is None: continue
                if re.search(r'\b[A-Z]{2}=[A-Z0-9]{4}', txtpart) or txtpart.startswith('-') or cur['priced']:
                    rows.append(dict(cur, m=txtpart.strip(' -') if txtpart else '', u=base, an=an)); cur['priced'] = True
                else:
                    cur['d'] = (cur['d'] + ' ' + txtpart).strip()
                    rows.append(dict(cur, u=base, an=an)); cur['priced'] = True
            elif not cur['priced'] and not re.match(r'^(Note|\*|NOTE)', s) and not re.search(r'\b[A-Z]{2}=[A-Z0-9]{4}', s):
                sm = SHORT.match(s)
                if sm:
                    cur['d'] = (cur['d'] + ' ' + sm.group(1).strip(' .')).strip()
                    rows.append(dict(cur, u=sm.group(2), an=sm.group(3))); cur['priced'] = True
                else: cur['d'] = (cur['d'] + ' ' + s).strip()
    for r in rows:
        r.pop('priced', None)
        for k in ('u', 'an', 'm'):
            if r.get(k) in (None, ''): r.pop(k, None)
            elif isinstance(r.get(k), str): r[k] = re.sub(r'\s+', ' ', r[k])
        r['d'] = re.sub(r'\s+', ' ', r['d'])
    return txt, rows, bad

if __name__ == '__main__':
    import sys, json, collections
    txt, rows, bad = extract(sys.argv[1])
    print(len(rows), 'rows', len({r['c'] for r in rows}), 'codes', len(bad), 'bad')
    for b in bad[:30]: print('BAD', b)
    print(collections.Counter(re.sub(r'[\d.]+', 'N', r.get('u', '-')) for r in rows).most_common(20))
    print(collections.Counter(re.sub(r'[\d.]+', 'N', r.get('an', '-')) for r in rows).most_common(10))
    json.dump(rows, open('/tmp/ns_rows.json', 'w'), indent=0)
