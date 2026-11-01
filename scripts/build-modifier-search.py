#!/usr/bin/env python3
"""Build site/data/modifier-search.json for the Fee Desk modifier search (v36).

Source (official, Alberta Health): "Fee modifier definitions as of 01 April 2026" (RG122 Modifier Definitions,
Schedule of Medical Benefits), open.alberta.ca dataset somb-2026-04-01. The PDF and its text are in raw/; the
parsed list is site/data/modifiers.json (scripts/update-data.py parse_modifiers). This script:
  - takes every modifier type and value code from modifiers.json, nothing else (no invented modifiers);
  - checks each code against the raw PDF text (the code must start a line in the code column);
  - drops two parse artifacts that are continuation lines, not codes (ANU "MINUTE", SAU "UNIT");
  - repairs the two 6-character LEVL codes that contain a space ("E/M H1", "E/M H2");
  - marks each code Explicit (entered on the claim) or Implicit (derived by the claims system) from the
    official "(Explicit)" / "(Implicit)" marker on its type (checked against the code's own marker and against
    the price list's "Expl." flag for every HSC);
  - counts on how many HSCs each code is listed in the Medical price list (site/data/codes.json mods) and the
    usual action/amount there.
Usage: python3 scripts/build-modifier-search.py
"""
import json, os, re, collections, sys, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)
mods = json.load(open(P('site', 'data', 'modifiers.json')))
codes = json.load(open(P('site', 'data', 'codes.json')))
man = json.load(open(P('raw', 'manifest.json')))
somb = man['somb']; res = next(r for r in somb['resources'] if r['key'] == 'modifiers')
raw = open(P('raw', res['file'][:-4] + '.txt'), encoding='utf-8').read()  # edition-independent (was a hard-coded 2026-04 file name)
pl = next(r for r in somb['resources'] if r['key'] == 'price')

ARTIFACTS = {('ANU', 'MINUTE'): 'continuation of the ANU type text ("...ADDITIONAL 5 MINUTE UNITS MAY NOT BE CLAIMED...")',
             ('SAU', 'UNIT'): 'continuation of the SAU type text ("...EACH UNIT REPRESENTS 15 MINUTES.")'}
MARK = re.compile(r'\(\s*(explicit|implicit)\s*\)', re.I)

def kind_of(text):
    m = MARK.search(text or ''); return m.group(1)[0].upper() if m else ''

def split_name(text, code=''):
    """'CODE NAME - (Explicit) - meaning' / '(Explicit) NAME - meaning' / 'NAME (Implicit)' -> (name, meaning)"""
    t = MARK.sub(' ', re.sub(r'\s+', ' ', text or ''), count=1)
    t = re.sub(r'\s*-\s*(-\s*)+', ' - ', re.sub(r'\s+', ' ', t)).strip().lstrip('- ').strip()
    while code and t.upper().startswith(code.upper() + ' '):
        rest = t[len(code):].strip().lstrip('- ').strip()
        if not rest: break
        t = rest
    i = t.find(' - ')
    return (t[:i].strip(), t[i + 3:].strip()) if i > 0 else (t.strip(' -'), '')

usage = collections.defaultdict(collections.Counter); hscs = collections.defaultdict(list); exflag = collections.defaultdict(set)
for c in codes:
    for m in c.get('mods') or []:
        k = (m[0], m[1])
        if m[1] == 'E/M' and re.match(r'H[12]\b', m[3] or ''): k = (m[0], 'E/M ' + m[3][:2]); m = m[:3] + [m[3][3:]] + m[4:]
        usage[k][' '.join(x for x in (m[3], m[4]) if x)] += 1; exflag[m[0]].add(bool(m[2]))
        if c['code'] not in hscs[k]: hscs[k].append(c['code'])

types, out, problems, dropped, fixed = [], [], [], [], []
for t in mods:
    tk = kind_of(t['text'][:90])
    if not tk: problems.append('no marker on type ' + t['type'])
    if t['type'] in exflag and exflag[t['type']] != {tk == 'E'}: problems.append(f"price-list Expl. flag disagrees for {t['type']}")
    tname, tmean = split_name(t['text'])
    types.append({'t': t['type'], 'n': tname.title() if tname.isupper() else tname, 'k': tk, 'x': re.sub(r'\s+', ' ', t['text']).strip(), 'p': t['page']})
    for c in t['codes']:
        code, text = c['code'], c['text']
        if (t['type'], code) in ARTIFACTS: dropped.append(f"{t['type']} {code}: {ARTIFACTS[(t['type'], code)]}"); continue
        if code == 'E/M' and re.match(r'H[12]\b', text):
            code = 'E/M ' + text[:2]; text = text[3:]; fixed.append(f"LEVL E/M -> {code}")
        if not re.search(r'(?m)^\s{8,}' + re.escape(code) + r'(\s|$)', raw): problems.append(f"{t['type']} {code} not found in the PDF text")
        ck = kind_of(text)
        if ck and ck != tk: problems.append(f"{t['type']} {code} marker {ck} != type {tk}")
        name, meaning = split_name(text, code)
        if not meaning and not ck: meaning = ''
        u = usage.get((t['type'], code), collections.Counter())
        hl = hscs.get((t['type'], code), [])
        out.append({'c': code, 't': t['type'], 'k': tk, 'n': name, 'd': meaning, 'x': re.sub(r'\s+', ' ', text).strip(), 'p': t['page'],
                    'h': len(hl), 'e': hl[:8], 'a': [[a, n] for a, n in u.most_common(3)]})

seen = collections.Counter(o['c'] for o in out if o['k'] == 'E')
dup = [k for k, v in seen.items() if v > 1]
if dup: problems.append('duplicate explicit codes: ' + ', '.join(dup))
if problems: print('\n'.join(problems)); sys.exit('build-modifier-search: problems above')
doc = {
    'source': {
        'publisher': 'Alberta Health (Alberta Health Care Insurance Plan)',
        'title': res['name'], 'document': 'RG122 Modifier Definitions, Schedule of Medical Benefits',
        'asOf': somb['effective'], 'edition': datetime.datetime.strptime(somb['effective'], '%Y-%m-%d').strftime('%B %Y'), 'url': res['url'], 'dataset': somb['datasetUrl'],
        'lastModified': res['lastModified'], 'usage': {'title': pl['name'], 'url': pl['url']},
        'built': datetime.date.today().isoformat(),
        'notes': ['Codes and wording are as printed in the official PDF; only layout (line breaks) is changed.',
                  'Dropped (not codes): ' + '; '.join(dropped), 'Repaired: ' + '; '.join(fixed),
                  'Explicit = entered on the claim; Implicit = derived by the claims system (per the type marker).']
    },
    'counts': {'types': len(types), 'codes': len(out), 'explicit': sum(o['k'] == 'E' for o in out), 'implicit': sum(o['k'] == 'I' for o in out)},
    'types': types, 'codes': out}
json.dump(doc, open(P('site', 'data', 'modifier-search.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print(json.dumps(doc['counts']), '| dropped:', dropped, '| fixed:', fixed)
