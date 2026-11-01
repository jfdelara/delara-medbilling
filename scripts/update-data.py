#!/usr/bin/env python3
"""
MedBilling Fee Desk - data refresh.

Re-downloads the current official Alberta Health files and re-parses them into
site/data/*.json.  Run monthly (or after an AHCIP bulletin):

    python3 scripts/update-data.py            # discover latest SOMB, download, parse
    python3 scripts/update-data.py --offline  # re-parse files already in raw/
    python3 scripts/update-data.py --download-only  # fetch the sources + raw/manifest.json, parse nothing (scripts/data-pipeline.py)
    python3 scripts/update-data.py --provinces          # Alberta, then every live province/territory
    python3 scripts/update-data.py --provinces-only     # provinces/territories only
      (see scripts/provinces/update_provinces.py; manual steps are printed at the end)

Sources (all public, Open Government Licence - Alberta):
  * alberta.ca "Fees information for health professionals" page links the
    current SOMB edition on open.alberta.ca (dataset id somb-YYYY-MM-DD).
  * open.alberta.ca CKAN API (package_show) gives each PDF's download URL.
  * ICD-9 supplement: dataset alberta-health-diagnostic-codes.
  * Medical bulletins: dataset bulletin-alberta-health-care-insurance-plan-medical-services.

Requires: python3, pdftotext (poppler-utils), curl.
Nothing here is invented: every code, description and fee comes from the PDFs.
"""
import json, os, re, subprocess, sys, datetime, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'raw')
OUT = os.path.join(ROOT, 'site', 'data')
UA = 'Mozilla/5.0 (X11; Linux x86_64) MedBillingFeeDesk-updater'
CKAN = 'https://open.alberta.ca/api/3/action/'
FEES_PAGE = 'https://www.alberta.ca/fees-health-professionals'
OFFLINE = '--offline' in sys.argv

def log(*a): print(*a, file=sys.stderr)

def http(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()

def ckan(action, **params):
    q = '&'.join(f'{k}={urllib.parse.quote(str(v))}' for k, v in params.items())
    return json.loads(http(f'{CKAN}{action}?{q}'))['result']

def download(url, dest):
    # curl copes better with the open.alberta.ca CDN than urllib (403s seen)
    for attempt in range(3):
        subprocess.run(['curl', '-sSL', '-A', UA, '--retry', '2', '-o', dest, url], check=False)
        if os.path.exists(dest) and open(dest, 'rb').read(5) == b'%PDF-':
            return True
    log('  !! not a PDF after retries:', url)
    return False

def pdftext(pdf):
    txt = pdf[:-4] + '.txt'
    subprocess.run(['pdftotext', '-layout', pdf, txt], check=True)
    return open(txt, encoding='utf-8', errors='replace').read()

import urllib.parse

# ---------------------------------------------------------------- discovery
def discover():
    """Return manifest with SOMB edition + resources, ICD-9, bulletins."""
    man = {}
    # 1. which SOMB edition does alberta.ca currently point to?
    edition = None
    try:
        html = http(FEES_PAGE).decode('utf-8', 'replace')
        m = re.search(r'open\.alberta\.ca/publications/(somb-\d{4}-\d{2}-\d{2})"[^>]*>\s*See all SOMB lists effective ([^<]+)', html)
        if m:
            edition, label = m.group(1), m.group(2).strip()
            man['albertaCaPage'] = FEES_PAGE
            man['albertaCaLabel'] = 'See all SOMB lists effective ' + label
    except Exception as e:
        log('alberta.ca fees page fetch failed:', e)
    # 2. cross-check with the newest somb-* dataset on open.alberta.ca
    res = ckan('package_search', q='name:somb-*', rows=50, sort='metadata_created desc')
    names = sorted([p['name'] for p in res['results'] if re.fullmatch(r'somb-\d{4}-\d{2}-\d{2}', p['name'])
                    and not p['name'].startswith('somb-21')], reverse=True)
    newest = names[0] if names else None
    if edition and newest and newest > edition:
        log(f'NOTE: open.alberta.ca has {newest}, newer than alberta.ca link {edition}; using {newest}')
        edition = newest
    edition = edition or newest
    pkg = ckan('package_show', id=edition)
    man['somb'] = {'dataset': edition, 'datasetUrl': f'https://open.alberta.ca/publications/{edition}',
                   'title': pkg['title'], 'effective': edition[5:], 'resources': []}
    want = {'explanatory': 'Explanatory code', 'modifiers': 'Fee modifier', 'price': 'Medical price list',
            'procedure': 'Medical procedure list', 'rules': 'Medical governing rules'}
    for key, prefix in want.items():
        r = next(r for r in pkg['resources'] if r['name'].startswith(prefix))
        man['somb']['resources'].append({'key': key, 'name': r['name'], 'url': r['url'],
                                         'lastModified': r.get('last_modified') or r.get('created'),
                                         'file': r['url'].split('/')[-1]})
    icd = ckan('package_show', id='alberta-health-diagnostic-codes')
    cur = [r for r in icd['resources'] if 'SUPERSEDED' not in r['name'].upper()]
    cur.sort(key=lambda r: r.get('created', ''), reverse=True)
    r = cur[0]
    man['icd9'] = {'dataset': 'https://open.alberta.ca/publications/alberta-health-diagnostic-codes',
                   'name': r['name'], 'url': r['url'], 'file': 'diagnostic-code-icd-9.pdf'}
    b = ckan('package_show', id='bulletin-alberta-health-care-insurance-plan-medical-services')
    man['bulletins'] = {'dataset': 'https://open.alberta.ca/publications/bulletin-alberta-health-care-insurance-plan-medical-services',
                        'items': []}
    for r in b['resources']:
        m = re.match(r'\s*(\[SUPERSEDED\]\s*-?\s*)?MED\s*(\d+)\s*-\s*(.*)', r['name'], re.I)
        if not m or not r['url'].lower().endswith('.pdf'):
            continue
        man['bulletins']['items'].append({'num': int(m.group(2)), 'title': m.group(3).strip(),
            'supersededLabel': bool(m.group(1)), 'url': r['url'], 'file': r['url'].split('/')[-1],
            'created': (r.get('created') or '')[:10]})
    return man

def fetch_all(man):
    os.makedirs(os.path.join(RAW, 'bulletins'), exist_ok=True)
    for r in man['somb']['resources']:
        log('download', r['file']); download(r['url'], os.path.join(RAW, r['file']))
    log('download ICD-9'); download(man['icd9']['url'], os.path.join(RAW, man['icd9']['file']))
    for b in man['bulletins']['items']:
        dest = os.path.join(RAW, 'bulletins', b['file'])
        if not (os.path.exists(dest) and open(dest, 'rb').read(5) == b'%PDF-'):
            download(b['url'], dest)

# ---------------------------------------------------------------- helpers
CODE_RE = r'\d{2}\.\d{1,2}(?: ?[A-Z]{1,3})?'
def norm(code): return code.replace(' ', '').upper()
def money(s): return float(s.replace(',', ''))

def pages_of(text):
    """yield (physical_page_number, printed_label, page_text)"""
    for i, p in enumerate(text.split('\f')):
        m = re.search(r'Page\s+([0-9ivxlIVXL-]+)\s*$', p[:1200], re.M) or re.search(r'Page\s+([0-9A-Za-z.-]+)', p[:1200])
        yield i + 1, (m.group(1) if m else ''), p

# ---------------------------------------------------------------- price list
CATSET = {'V', 'M', 'M+', 'T', 'C', 'R', '1', '3', '4', '6', '14', '15'}

def parse_price(text):
    codes = {}
    cur = None; lastmod = None
    head = re.compile(r'^ {10}(' + CODE_RE + r')\s+(?:([\d,]+\.\d{2})|\(cont\'d\))\s*(.*)$')
    for phys, label, page in pages_of(text):
        for line in page.split('\n'):
            m = head.match(line)
            if m:
                c = norm(m.group(1)); rest = m.group(3).strip(); cat = ''
                if m.group(2):
                    toks = rest.split()
                    if toks and toks[-1] in CATSET and re.search(r'\s{2,}' + re.escape(toks[-1]) + r'$', rest) or rest in CATSET:
                        cat = toks[-1]; rest = rest[:len(rest) - len(cat)].rstrip()
                    cur = codes.setdefault(c, {'code': c, 'display': m.group(1), 'base': money(m.group(2)),
                                               'cat': cat, 'mods': [], 'pricePage': phys, 'pricePageLabel': label})
                else:
                    cur = codes.get(c)
                lastmod = None
                if cur is not None and rest:
                    lastmod = add_mod(cur, rest)
                continue
            if cur is None: continue
            st = line.strip()
            if st.startswith('-----'):
                cur = None; continue
            if not st: continue
            indent = len(line) - len(line.lstrip())
            if lastmod is not None and indent >= 33 and re.match(r'\d', st):
                mm = re.match(r'^(\S+)\s+(.*?)\s{2,}(\S+)\s*$', st)
                if mm:
                    lastmod.setdefault('calls', []).append({'range': mm.group(1), 'action': mm.group(2).strip(),
                                                            'amount': mm.group(3)})
            elif 26 <= indent <= 32 and re.match(r'[A-Z0-9]', st):
                lastmod = add_mod(cur, st)
    return codes

def add_mod(cur, txt):
    toks = txt.split()
    if not toks: return None
    if re.fullmatch(r'[IVX]+\.?', toks[0]): return None
    dm = re.fullmatch(r'([A-Z0-9]{2,4})\1', toks[0])
    if dm: toks = [dm.group(1), dm.group(1)] + toks[1:]
    mtype = toks[0]; mcode = toks[1] if len(toks) > 1 else ''
    k = 2; explicit = False
    if len(toks) > k and toks[k] == 'Y': explicit = True; k += 1
    restt = toks[k:]
    amount = ''
    if restt and re.fullmatch(r'[\d.,]+%?', restt[-1]): amount = restt.pop()
    mod = {'type': mtype, 'code': mcode, 'explicit': explicit, 'action': ' '.join(restt), 'amount': amount}
    cur['mods'].append(mod)
    return mod

# ---------------------------------------------------------------- procedure list
ROMAN = re.compile(r'^\s+((?:X{0,3})(?:IX|IV|V?I{0,3}))\.?\s{1,8}([A-Z][A-Z ,/&()\'-]{6,}?)\s*(?:\(cont\'d\))?\s*$')
FEE_TAIL = re.compile(r'(?:\.\s?){2,}\s*([\d,]+\.\d{2}|BY ASSESS)(\s+V)?(?:\s+([\d,]+\.\d{2}))?\s*$|\s{3,}([\d,]+\.\d{2}|BY ASSESS)(\s+V)?(?:\s+([\d,]+\.\d{2}))?\s*$')
HEADER_LINE = re.compile(r'^(Classification: Public|RG1\d\d|\s+Schedule of Medical Benefits\s*$|Generated \d{4}/|\s+ALBERTA HEALTH CARE INSURANCE PLAN)')

def started_pre(phys, line):
    return phys > 5

def parse_procedures(text, price_codes):
    procs = {}
    section = sub_head = sub = group = ''
    started = False
    cur = None
    lines_all = []
    for phys, label, page in pages_of(text):
        for line in page.split('\n'):
            if started_pre(phys, line) and (HEADER_LINE.match(line) or re.match(r'^\s+BASE\s+ANE\s*$', line)
                    or re.match(r'^\s+Page \d+\s*$', line) or line.rstrip().endswith("(cont'd)")):
                if line.rstrip().endswith("(cont'd)") and re.match(r'^\s{3,}[a-z]', line):
                    # wrapped heading continuation: drop the heading's first line too
                    k = len(lines_all) - 1
                    while k >= 0 and not lines_all[k][2].strip(): k -= 1
                    if k >= 0 and re.match(r'^\s*' + CODE_RE + r'\s+[A-Z]', lines_all[k][2]) and not FEE_TAIL.search(lines_all[k][2]):
                        del lines_all[k]
                continue
            lines_all.append((phys, label, line))
    i = 0
    n = len(lines_all)
    while i < n:
        phys, label, line = lines_all[i]
        s = line.strip()
        if phys <= 5 or (not started and not re.match(r'^\s+I\.\s+CERTAIN', line)):
            i += 1; continue
        started = True
        if HEADER_LINE.match(line) or re.match(r'^\s+BASE\s+ANE\s*$', line) or "(cont'd)" in line:
            if "(cont'd)" in line:
                pass
            elif cur is None:
                pass
            i += 1; continue
        rm = ROMAN.match(line)
        if rm and rm.group(1) and len(line) - len(line.lstrip()) > 15:
            section = (rm.group(1) + '. ' + rm.group(2).strip().title())
            cur = None; i += 1; continue
        m = re.match(r'^(\s*)(' + CODE_RE + r'|\d{2})\s+(\S.*)$', line)
        indent = len(m.group(1)) if m else 99
        is_chap = bool(m and re.fullmatch(r'\d{2}', m.group(2)) and indent <= 2 and re.match(r'[A-Z]{3}', m.group(3)))
        is_code = bool(m and not re.fullmatch(r'\d{2}', m.group(2)) and indent <= 14)
        if is_chap or is_code:
            tok, rest = m.group(2), m.group(3)
            c = norm(tok)
            if re.fullmatch(r'\d{2}', tok):
                sub_head = tok + ' ' + rest.strip().title(); sub = group = ''; cur = None; i += 1; continue
            # gather description lines until a fee appears (max 5 lines)
            desc = [rest]; fee = None; j = i
            fm = FEE_TAIL.search(rest)
            nonblank = 0
            while not fm and j + 1 < n and j - i < 80 and nonblank < 12:
                nxt = lines_all[j + 1][2]
                if not nxt.strip():
                    j += 1; continue
                nonblank += 1
                if re.match(r'^\s*(' + CODE_RE + r')\s+[A-Z(]', nxt) and len(nxt) - len(nxt.lstrip()) <= 14 \
                        or 'NOTE' in nxt or HEADER_LINE.match(nxt):
                    break
                j += 1; desc.append(nxt.strip()); fm = FEE_TAIL.search(nxt)
            if fm and (c in price_codes or FEE_TAIL.search(rest)) and re.match(r'[A-Z(0-9"]', rest):
                g = fm.groups()
                base = g[0] or g[3]; v = g[1] or g[4]; ane = g[2] or g[5]
                d = ' '.join(desc)
                d = FEE_TAIL.sub('', d).strip()
                d = re.sub(r'(\s?\.){2,}\s*$', '', d).strip()
                d = re.sub(r'\s{2,}', ' ', d)
                cur = procs.get(c)
                if cur is None:
                    cur = procs[c] = {'code': c, 'display': tok, 'desc': d, 'base': None if base == 'BY ASSESS' else money(base),
                                      'byAssess': base == 'BY ASSESS',
                                      'visit': bool(v), 'ane': money(ane) if ane else None,
                                      'section': section, 'chapter': sub_head, 'sub': sub, 'group': group,
                                      'notes': [], 'page': phys, 'pageLabel': label}
                i = j + 1; continue
            # otherwise a heading
            hdr = tok + ' ' + re.sub(r'(\s?\.){2,}.*$', '', rest).strip()
            if re.fullmatch(r'\d{2}\.\d', c): sub = hdr; group = ''
            else: group = hdr
            cur = None; i += 1; continue
        if cur is not None and s:
            cur['notes'].append(s)
        i += 1
    for p in procs.values():
        p['notes'] = tidy_notes(p['notes'])
    return procs

def tidy_notes(lines):
    txt = ' '.join(lines)
    txt = re.sub(r'\s{2,}', ' ', txt).strip()
    return txt

# ---------------------------------------------------------------- governing rules
def parse_rules(text):
    rules = []; cur = None
    for phys, label, page in pages_of(text):
        for line in page.split('\n'):
            if HEADER_LINE.match(line) or re.match(r'^\s+Part A - General Rules', line) or re.match(r'^\s+Page \d+\s*$', line) \
                    or re.match(r'^\s+Generated', line):
                continue
            m = re.match(r'^ {4,10}(\d{1,2}(?:\.\d{1,2}){0,3})\s+(\S.*)$', line)
            if m and (cur is None or plausible_next(cur['id'], m.group(1))):
                cur = {'id': m.group(1), 'text': m.group(2).strip(), 'page': phys}
                rules.append(cur); continue
            if cur and line.strip():
                cur['text'] += '\n' + line.strip()
    # titles for headings (all caps first line)
    for r in rules:
        first = r['text'].split('\n')[0]
        r['title'] = first if first.upper() == first and len(first) < 90 else ''
    return rules

def plausible_next(prev, new):
    a = [int(x) for x in prev.split('.')]; b = [int(x) for x in new.split('.')]
    if b[0] == a[0]: return b > a
    return b[0] in (a[0] + 1, a[0] + 2) and len(b) <= 2

# ---------------------------------------------------------------- fee modifiers
def parse_modifiers(text):
    types = []; cur = None; sub = None
    for phys, label, page in pages_of(text):
        for line in page.split('\n'):
            if HEADER_LINE.match(line) or 'MODIFIER DEFINITIONS' in line or re.match(r'^\s+RG122', line): continue
            m = re.match(r'^ {17}([A-Z0-9/+]{2,6})\s+(\S.*)$', line)
            if m and not line.startswith(' ' * 18):
                cur = {'type': m.group(1), 'text': m.group(2).strip(), 'codes': [], 'page': phys}
                types.append(cur); sub = None; continue
            m = re.match(r'^ {25}([A-Z0-9/+.]{2,8})\s+(\S.*)$', line)
            if m and cur is not None and not line.startswith(' ' * 26):
                sub = {'code': m.group(1), 'text': m.group(2).strip()}
                cur['codes'].append(sub); continue
            if line.strip() and cur is not None:
                if sub is not None: sub['text'] += ' ' + line.strip()
                else: cur['text'] += ' ' + line.strip()
    for t in types:
        t['text'] = re.sub(r'\s{2,}', ' ', t['text'])
        for c in t['codes']: c['text'] = re.sub(r'\s{2,}', ' ', c['text'])
    return types

# ---------------------------------------------------------------- explanatory codes
def parse_explanatory(text):
    out = []; cur = None; heading = ''
    for phys, label, page in pages_of(text):
        if phys < 3: continue
        for line in page.split('\n'):
            if HEADER_LINE.match(line) or 'EXPLANATORY CODES' in line or re.match(r'^\s+RG131', line): continue
            m = re.match(r'^ {25}([0-9]{2}[A-Z0-9]{0,3})\s{2,}(\S.*)$', line)
            if m:
                cur = {'code': m.group(1), 'title': m.group(2).strip(), 'text': '', 'group': heading, 'page': phys}
                out.append(cur); continue
            h = re.match(r'^ {30,60}([A-Z][A-Z ,/&()\'-]{4,})\s*(?:\(cont\'d\))?\s*$', line)
            if h and not cur or (h and line.strip().isupper() and len(line) - len(line.lstrip()) > 40):
                heading = h.group(1).strip().title(); cur = None; continue
            if cur and line.strip():
                cur['text'] += (' ' if cur['text'] else '') + line.strip()
    for e in out: e['text'] = re.sub(r'\s{2,}', ' ', e['text'])
    return out

# ---------------------------------------------------------------- ICD-9
def icd_chapter(code):
    if code.startswith('V'): return 'V'
    n = int(code[:3])
    for lo, hi, ch in [(1,139,'1'),(140,239,'2'),(240,279,'3'),(280,289,'4'),(290,319,'5'),(320,389,'6'),
                       (390,459,'7'),(460,519,'8'),(520,579,'9'),(580,629,'10'),(630,679,'11'),(680,709,'12'),
                       (710,739,'13'),(740,759,'14'),(760,779,'15'),(780,799,'16'),(800,999,'17')]:
        if lo <= n <= hi: return ch
    return '?'

def parse_icd9(text):
    codes = []; cur = None; started = False; block = ''
    for phys, label, page in pages_of(text):
        if not started:
            if re.search(r'SUPPLEMENTARY CODES INFLUENCING HEALTH STATUS|INFECTIOUS AND PARASITIC DISEASES \(001', page) and 'TABLE OF CONTENTS' not in page and 'INDEX' not in page[:1500]:
                started = True
            else:
                continue
        for line in page.split('\n'):
            if re.match(r'^\s*(© Government of Alberta|ALBERTA HEALTH|CLAIMS ASSESSMENT|Alberta Health Diagnostic Codes|As of:|_{10,})', line.strip() and line.strip()[:40] or ''):
                cur = None if 'As of' in line else cur; continue
            m = re.match(r'^ {8,12}(V\d{2}(?:\.\d{1,2})?|\d{3}(?:\.\d{1,2})?)\s+(\S.*)$', line)
            if m:
                cur = {'code': m.group(1), 'desc': m.group(2).strip(), 'ch': icd_chapter(m.group(1)), 'block': block,
                       'page': phys, 'excl': ''}
                codes.append(cur); continue
            b = re.match(r'^ {10,20}([A-Z][A-Z ,\'/()-]{6,}\(V?\d{2,3}-V?\d{2,3}\))', line)
            if b: block = b.group(1).strip().title(); cur = None; continue
            if cur and line.strip():
                st = line.strip()
                if st.startswith(('Excludes', 'Includes')) or cur.get('_inx'):
                    cur['_inx'] = True
                    cur['excl'] += (' ' if cur['excl'] else '') + st
                elif len(line) - len(line.lstrip()) >= 15:
                    cur['desc'] += ' ' + st
    seen = {}
    for c in codes:
        c.pop('_inx', None)
        c['desc'] = re.sub(r'\s{2,}', ' ', c['desc'])
        c['excl'] = re.sub(r'\s{2,}', ' ', c['excl'])[:400]
        seen.setdefault(c['code'], c)
    return list(seen.values())

# ---------------------------------------------------------------- bulletins
def parse_bulletins(man, all_codes):
    items = []
    bdir = os.path.join(RAW, 'bulletins')
    superseded_by = {}
    for b in sorted(man['bulletins']['items'], key=lambda x: -x['num']):
        pdf = os.path.join(bdir, b['file'])
        if not (os.path.exists(pdf) and open(pdf, 'rb').read(5) == b'%PDF-'):
            log('  bulletin missing', b['file']); b2 = dict(b, codes=[], downloaded=False); items.append(b2); continue
        text = pdftext(pdf)
        dm = re.search(r'Date:\s*([A-Z][a-z]+\.? \d{1,2},? \d{4})', text)
        hits = {}
        for phys, label, page in pages_of(text):
            for m in re.finditer(r'(?<![\d$.])(' + CODE_RE + r')(?![\d.])', page):
                c = norm(m.group(1))
                if c not in all_codes:
                    c2 = re.sub(r'[A-Z]+$', '', c)
                    continue
                hits.setdefault(c, phys)
        sup = []
        for m in re.finditer(r'supersedes?\s+MED\s*([\d ,and]+)', re.sub(r'\s+', ' ', text), re.I):
            sup += [int(x) for x in re.findall(r'\d+', m.group(1))]
        for s in sup: superseded_by.setdefault(s, b['num'])
        items.append(dict(b, date=dm.group(1) if dm else b['created'], codes=sorted(hits),
                          codePages=hits, supersedes=sup, downloaded=True,
                          summary=re.sub(r'\s+', ' ', text)[:600]))
    for it in items:
        it['supersededBy'] = superseded_by.get(it['num'])
        it['superseded'] = bool(it['supersededBy'] or it['supersededLabel'])
    return items

# ---------------------------------------------------------------- main
def main():
    os.makedirs(RAW, exist_ok=True); os.makedirs(OUT, exist_ok=True)
    manpath = os.path.join(RAW, 'manifest.json')
    if OFFLINE and os.path.exists(manpath):
        man = json.load(open(manpath))
    else:
        man = discover(); fetch_all(man)
        man['downloadedAt'] = datetime.datetime.now().astimezone().isoformat(timespec='seconds')
        json.dump(man, open(manpath, 'w'), indent=1)
    if '--download-only' in sys.argv:  # data-pipeline.py: fetch the sources and write raw/manifest.json, parse nothing
        log('download-only: sources in raw/, manifest written'); return
    res = {r['key']: r for r in man['somb']['resources']}
    T = {k: pdftext(os.path.join(RAW, r['file'])) for k, r in res.items()}
    price = parse_price(T['price'])
    procs = parse_procedures(T['procedure'], price)
    log('price codes', len(price), 'procedure entries', len(procs))
    # merge
    codes = []
    for c, p in price.items():
        pr = procs.get(c, {})
        skills = {m['code']: m['amount'] for m in p['mods'] if m['type'] == 'SKLL' and m['action'].startswith('Replace Base')}
        codes.append({'code': c, 'display': pr.get('display', p['display']), 'desc': pr.get('desc', ''),
            'base': p['base'], 'procBase': pr.get('base'), 'ane': pr.get('ane'), 'visit': pr.get('visit', False),
            'cat': p['cat'], 'section': pr.get('section', ''), 'chapter': pr.get('chapter', ''),
            'sub': pr.get('sub', ''), 'group': pr.get('group', ''), 'notes': pr.get('notes', ''),
            'gr': sorted(set(re.findall(r'GRs?\s+(\d{1,2}(?:\.\d{1,2}){0,3})', pr.get('notes', '')))),
            'skill': skills, 'mods': [m for m in p['mods'] if m['type'] != 'SKLL'],
            'plPage': pr.get('page'), 'plLabel': pr.get('pageLabel'), 'byAssess': pr.get('byAssess', False),
            'pricePage': p['pricePage'], 'priceLabel': p['pricePageLabel']})
    for c, pr in procs.items():
        if c in price: continue
        codes.append({'code': c, 'display': pr['display'], 'desc': pr['desc'], 'base': pr['base'], 'procBase': pr['base'],
            'ane': pr['ane'], 'visit': pr['visit'], 'cat': '', 'section': pr['section'], 'chapter': pr['chapter'],
            'sub': pr['sub'], 'group': pr['group'], 'notes': pr['notes'],
            'gr': sorted(set(re.findall(r'GRs?\s+(\d{1,2}(?:\.\d{1,2}){0,3})', pr['notes']))), 'skill': {}, 'mods': [],
            'plPage': pr['page'], 'plLabel': pr['pageLabel'], 'pricePage': None, 'priceLabel': None,
            'notInPriceList': True, 'byAssess': pr.get('byAssess', False)})
    codes.sort(key=lambda x: [int(t) if t.isdigit() else t for t in re.findall(r'\d+|[A-Z]+', x['code'])])
    rules = parse_rules(T['rules'])
    mods = parse_modifiers(T['modifiers'])
    expl = parse_explanatory(T['explanatory'])
    icd = parse_icd9(pdftext(os.path.join(RAW, man['icd9']['file'])))
    all_codes = {c['code'] for c in codes}
    bulls = parse_bulletins(man, all_codes)
    # flag codes named in current (non-superseded) bulletins
    bymap = {}
    for b in bulls:
        for c in b.get('codes', []):
            bymap.setdefault(c, []).append({'num': b['num'], 'page': b['codePages'][c], 'superseded': b['superseded']})
    for c in codes:
        c['bulletins'] = sorted(bymap.get(c['code'], []), key=lambda x: -x['num'])
    icd_date = re.search(r'As of:\s*(\d{4}/\d{2}/\d{2})', open(os.path.join(RAW, man['icd9']['file'][:-4] + '.txt')).read())
    skills_def = next((t for t in mods if t['type'] == 'SKLL'), {'codes': []})
    meta = {
        'app': 'MedBilling Fee Desk',
        'sombEffective': man['somb']['effective'],
        'sombDataset': man['somb']['datasetUrl'],
        'albertaCa': man.get('albertaCaPage', FEES_PAGE), 'albertaCaLabel': man.get('albertaCaLabel', ''),
        'sources': man['somb']['resources'],
        'icd9': dict(man['icd9'], asOf=icd_date.group(1) if icd_date else ''),
        'bulletinsDataset': man['bulletins']['dataset'],
        'downloadedAt': man.get('downloadedAt'),
        'builtAt': datetime.datetime.now().astimezone().isoformat(timespec='seconds'),
        'counts': {'codes': len(codes), 'withDescription': sum(1 for c in codes if c['desc']), 'rules': len(rules),
                   'modifierTypes': len(mods), 'modifierCodes': sum(len(t['codes']) for t in mods),
                   'explanatory': len(expl), 'icd9': len(icd), 'bulletins': len(bulls),
                   'codesFlaggedByBulletin': sum(1 for c in codes if c['bulletins'])},
        'skills': [{'code': s['code'], 'name': re.sub(r'\s*-\s*\(Implicit\)\s*', '', s['text']).strip().title()} for s in skills_def['codes']],
    }
    def dump(name, obj):
        with open(os.path.join(OUT, name), 'w') as f: json.dump(obj, f, separators=(',', ':'), ensure_ascii=False)
    # compact modifier rows -> [type, code, explicit(0/1), action, amount, calls|null]
    for c in codes:
        c['mods'] = [[m['type'], m['code'], 1 if m['explicit'] else 0, m['action'], m['amount'],
                      [[x['range'], x['action'], x['amount']] for x in m['calls']] if m.get('calls') else None] for m in c['mods']]
        c.pop('procBase', None)
        for k in [k for k, v in list(c.items()) if v in ('', None, [], {}, False)]:
            del c[k]
    dump('meta.json', meta); dump('codes.json', codes); dump('rules.json', rules); dump('modifiers.json', mods)
    dump('explanatory.json', expl); dump('icd9.json', icd)
    dump('bulletins.json', [{k: v for k, v in b.items() if k not in ('codePages',)} for b in bulls])
    print(json.dumps(meta['counts'], indent=1))

def provinces():
    args = [sys.executable, os.path.join(ROOT, 'scripts', 'provinces', 'update_provinces.py')] + (['--offline'] if OFFLINE else [])
    subprocess.run(args, check=True)

if __name__ == '__main__':
    if '--provinces-only' not in sys.argv:
        main()
    if '--provinces' in sys.argv or '--provinces-only' in sys.argv:
        provinces()
