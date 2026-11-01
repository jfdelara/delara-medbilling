#!/usr/bin/env python3
"""Spot-check parsed fees against the official PDF page, using a different extraction mode (pdftotext -raw, one page)
than the parser (pdftotext -layout, whole file). Writes/updates the jurisdiction's section in raw/provinces/spotcheck.md.
Usage: spotcheck.py MB [n_random]"""
import json, os, re, sys, random, subprocess, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
RAW = os.path.join(ROOT, 'raw', 'provinces'); OUT = os.path.join(RAW, 'spotcheck.md')
PDFS = {'MB': 'mb_physmanual.pdf', 'SK': 'sk_payment_schedule_2026-10-01.pdf', 'NS': 'ns_msi_physicians_manual_2026-08.pdf', 'PE': 'pei_psa_2024-2029.pdf', 'NT': 'nt_insured_services_tariff.pdf', 'YT': 'yk_fee_guide_2026.pdf', 'NL': 'nl_mcp_payment_schedule_2026-10-01.pdf'}
PICKS = {'MB': ['4800', '4822', '4631', '4851', '8694', '7014', '0171'],
         'SK': ['42P', '40P', '80P', '3B', '5B', '3C', '700E', '74A'],
         'NT': ['OB-001', 'OB-008', 'OB-011', 'OB-011F', 'OB-045A', 'OB-046', 'OB-050', 'AN-027', 'GP-008F', 'TE-002'],
         'NL': ['80004', '80002', '80014', '80016', '81002', '81004', '81006', '80046', '50', '60', '97948', '74520'],
         'YT': ['4105', '4123', '4108', '4201', '4202', '4010', '4090', '4120', '1030', '0046', '9010', '2020'],
         'PE': ['6004', '6001', '0002', '6006', '6014', '6953', '1850', '1460', '6024'],
         'NS': ['86.1', '86.1A', '03.08', '87.6', '85.01', '99.09A', '62.49', '89.69B']}
VISUAL = {'NL': 'Visual check 2026-10-03: PDF pages 194 (I-3, Obstetrics) and 86 (B-1, Special Visit Premiums) rendered and read by eye: 81002 Assist 55.54 / FP-Spec. 618.30 / Anaes. 6; 81004 55.54 / 872.41 / 8; 81006 55.54 / 558.10 / 5; premiums 50 FP 26.23 Spec. 18.53, 52 32.74 / 37.05, 53 39.24 / 55.64, 60-63 NC / 18.53, 37.05, 37.05, 55.64, 66-69 NC / 10.60, 15.86, 15.86, 24.31, 70-73 20.89, 41.66, 58.56, 87.86 (both), 76-79 11.88, 17.85, 28.55, 42.94 (both). All match.',
          'YT': 'Visual check 2026-10-03: PDF pages 99 (Obstetrics & Gynecology) and 27 rendered and read by eye: 4010 220.00, 4012 111.90, 4013 315.90, 4007 74.50, 4008 61.30, 4009 101.70, 0250 69.30, 0251 190.00, 0252 222.40, 4020 468.10 / 4+T, 4021 724.60 / 4+T, 4022 246.80 / 3+T, 4023 246.80 / 3+T, 4090 117.30, 4091 58.70, 4092 119.50, 4100 123.90, 4108 843.00, 4109 125.10, 4110 103.30, 4105 748.80 / 5+T, 4106 1056.90 / 8+T, 4111 310.60 / 1+T; p. 27 T 9010 1500.00. All match the parsed values.',
          'NT': 'Visual check 2026-10-03: PDF page 98 (printed p.44, Section OB) rendered and read by eye: OB-042 899.71 (+), OB-043 346.04, OB-044 326.16, OB-044F 276.83, OB-045 415.25, OB-045A 587.12, OB-046 1107.33, OB-047 1038.13, OB-048 276.83, OB-049 207.63 (+), OB-050 276.83 (+), OB-051 415.25, OP-001 152.24 … OP-006 124.56; all match. AN-025/AN-026 are printed as "20% (of time-based benefits + procedural benefits)" and are shown as printed.',
          'PE': 'Visual check 2026-10-03: PDF page 228 (Tariff-122, Obstetrical Operations) rendered and read by eye: 0002, 0004, 6001, 6004, 6007 $739.42 (then 746.81 / 754.28 / 761.83 / 769.44); 6005 $93.41; 6006 $979.92 … $1,019.71; 6014 $145.92; 6953 $510.65; 6024 $160.36; all match. The tariff has no 1 April 2026 column; the 1 April 2025 column is current until 1 April 2027.',
          'NS': 'Visual check 2026-10-03: PDF page 330 (S8-115, Obstetrics & Gynaecology) rendered and read by eye: 85.01 23.5 / 4+T; 85.91A 50 / 4+T; 86.1 SP=GNSG and SP=OBGY 366.91 / 7+T, plus multiples 49.39, CO=INFE 10+T; 86.1A 395.13 / 7+T; 86.3A 183.45 / 6+T; 87.21 100.19 / 4+T; 87.4 125; all match. The app shows these units as printed (no dollar conversion). Two lines printed truncated in the PDF (p.228 "16.", p.410 ".20") are left out rather than guessed.',
          'SK': 'Visual check 2026-10-03: PDF pages 66, 151 and 262 rendered and read by eye: 74A Specialist $140.00 / GP $75.00; 700E Referred $67.35 / Unreferred $59.15#; 42P $688.00/$688.00, 40P $714.00 (Specialist only), 41P $704.50 (GP only), 46P $635.00/$635.00 Anes M, 246P $94.50, 44P $148.00; all match.',
          'MB': 'Visual check: PDF page 464 (N-10) rendered to an image and read by eye on 2026-10-03: 4822 $593.58 / 20.000 units, 4800 $728.14 / 22.750, 4803 $1,052.53 / 26.875, 4826 $571.28 all match the parsed values.'}
FIELDS = ['f', 'tec', 'pro', 'au', 'gp', 'sp', 'ref', 'nr', 'int', 'tot', 'v']

def fmt(v):
    if isinstance(v, (int, float)):
        a = f'{v:.2f}' if round(v, 2) == v and not (v * 1000) % 10 else f'{v:.3f}'
        return [a, f'{v:,.2f}', f'{v:.3f}']
    return {'BR': ['By Report'], 'FS': ['F/S']}.get(v, [str(v)])

def page_text(pdf, p):
    return subprocess.run(['pdftotext', '-f', str(p), '-l', str(p), '-raw', pdf, '-'], capture_output=True, text=True).stdout

def check(jid, nrand=8, seed=20261003):
    d = json.load(open(os.path.join(ROOT, 'site', 'data', 'prov', jid + '.json')))
    pdf = os.path.join(RAW, PDFS[jid]); S = d['secs']
    rows = d['rows']; pick = []
    for c in PICKS.get(jid, []):
        r = next((r for r in rows if r['c'] == c), None)
        if r: pick.append(r)
    rnd = random.Random(seed); pool = [r for r in rows if r not in pick and (any(isinstance(r.get(k), float) for k in FIELDS) or isinstance(r.get('u'), str) or isinstance(r.get('v'), dict))]
    pick += rnd.sample(pool, nrand)
    res = []
    for r in pick:
        lines = page_text(pdf, r['p']).split('\n')
        hit = None
        if jid == 'NT':  # code (hyphen spacing normalised, split codes rejoined) with its printed price within 3 lines
            norm = [re.sub(r'\b([A-Z]{2,3})\s*-\s*', r'\1-', x) for x in lines]
            for i, l in enumerate(norm):
                if re.search(r'(?<![A-Z-])' + re.escape(r['c']) + r'(?![A-Z0-9])', l) or (l.rstrip().endswith(r['c'][:3]) and i + 1 < len(norm) and r['c'][3:] in norm[i + 1]):
                    want = f"{r['f']:.2f}" if isinstance(r['f'], float) else str(r['f'])[:3]
                    nxt = next((k for k in range(i + 1, min(i + 8, len(norm))) if re.search(r'(?<![A-Z-])[A-Z]{2,3}-\d{3}', norm[k])), min(i + 8, len(norm)))
                    blk = ' '.join(lines[i:nxt]).replace(',', '')
                    if re.search(r'(?<![\d.])' + re.escape(want) + r'(?![\d])', blk): hit = l.strip()[:110]; break
            res.append((r, hit)); continue
        if jid == 'NL':  # code line up to the next parsed code on the page must carry every parsed column value (raw order varies)
            onp = {x['c'] for x in rows if x['p'] == r['p']}
            want = [f'{r[k]:,.2f}' if isinstance(r[k], float) else str(r[k]) for k in ('f', 'fp', 'sp', 'as', 'an') if k in r]
            for i, l in enumerate(lines):
                if not re.match(r'^\s*' + r['c'] + r'\s', l): continue
                nxt = next((k for k in range(i + 1, len(lines)) if (lines[k].split() or [''])[0] in onp), len(lines))
                blk = ' ' + ' '.join(lines[i:nxt]) + ' '
                if all((' ' + w + ' ') in blk or (' ' + w.lstrip('0') + ' ') in blk for w in want): hit = l.strip()[:110]; break
            res.append((r, hit)); continue
        if jid == 'YT':  # code line (optionally after T or *) up to the next code line must carry the fee and the Anes/Proc value (raw order varies)
            cre = re.compile(r'^\s*(?:T\s*|\*\s*)?\d{4,6}\s')
            for i, l in enumerate(lines):
                if not re.match(r'^\s*(?:T\s*|\*\s*)?' + r['c'] + r'\s', l): continue
                onp = {x['c'] for x in rows if x['p'] == r['p']}  # codes parsed on this page (eligible-procedure lists are not rows)
                nxt = next((k for k in range(i + 1, len(lines)) if cre.match(lines[k]) and re.sub(r'^\s*(?:T\s*|\*\s*)?', '', lines[k]).split()[0] in onp), len(lines))
                toks = ' '.join(lines[i:nxt]).split()[1:]
                if ('f' not in r or f"{r['f']:.2f}" in toks) and (not r.get('an') or r['an'] in toks): hit = l.strip()[:110]; break
            res.append((r, hit)); continue
        if jid == 'PE':  # the line carrying the code must also carry all five printed amounts, in column order
            want = [('I.C.' if v == 'IC' else f'{v:,.2f}') for v in r['v'].values()]
            for l in lines:
                toks = l.split()
                if r['c'] in toks:
                    i = toks.index(r['c'])
                    if toks[i + 1:i + 6] == want: hit = l.strip()[:110]; break
            res.append((r, hit)); continue
        if jid == 'NS':  # code line, then the line carrying this row's modifiers (or the code line) must end with the printed units
            norm = lambda x: re.sub(r'\s+', '', x)
            for i, l in enumerate(lines):
                if re.match(r'^\s*(?:[A-Z]{4}\s+)?' + re.escape(r['c']) + r'(?:\s|$)', l):
                    for l2 in lines[i:i + 30]:
                        tail = norm(l2.split('.' * 3)[-1]) if '...' in l2 else norm(l2)
                        want = norm((r.get('u') or '') + (r.get('an') or ''))
                        if (not r.get('m') or norm(r['m']) in norm(l2)) and tail.endswith(want):
                            hit = l2.strip()[:110]; break
                    if hit: break
            res.append((r, hit)); continue
        for i, l in enumerate(lines):
            if re.match(r'^\s*' + r['c'] + r'\*?\b', l):
                blk = ' '.join(lines[i:i + 10])
                vals = {k: r[k] for k in FIELDS if k in r and k != 'au'}
                if all(any(f in blk for f in fmt(v)) for v in vals.values()): hit = l.strip()[:110]; break
        res.append((r, hit))
    ok = sum(1 for _, h in res if h)
    lines = [f'## {jid}: {d["meta"]["name"]}', '',
             f'Source: {d["meta"]["pdf"]} ({d["meta"]["edition"]}). Checked {datetime.date.today().isoformat()} by re-reading each row\'s PDF page with `pdftotext -raw` (independent of the `-layout` parse) and matching the tariff and every amount.', '',
             f'Result: **{ok}/{len(res)} match**.', ''] + ([VISUAL[jid], ''] if jid in VISUAL else []) + [ '| Code | Description (parsed) | Section | Parsed amounts | PDF page | Match | PDF line |', '|---|---|---|---|---|---|---|']
    for r, h in res:
        am = ', '.join(f'{k}={r[k]}' for k in FIELDS + ['u', 'an', 'm'] if k in r and k != 'v') + (' ' + ' / '.join(str(x) for x in r['v'].values()) if isinstance(r.get('v'), dict) else '')
        lines.append(f'| {r["c"]} | {r["d"][:70]} | {S[r["s"]]} | {am} | {r["p"]} ({r["l"]}) | {"yes" if h else "**NO**"} | {(h or "").replace("|", "/")} |')
    sec = '\n'.join(lines) + '\n'
    txt = open(OUT).read() if os.path.exists(OUT) else '# Fee spot-checks against official PDFs\n\nEach jurisdiction: fixed picks (common OB/GYN and multi-column rows) plus a seeded random sample.\n\n'
    txt = re.sub(r'## ' + jid + r':.*?(?=\n## |\Z)', '', txt, flags=re.S).rstrip() + '\n\n' + sec
    open(OUT, 'w').write(txt)
    print(f'{jid}: {ok}/{len(res)}')
    for r, h in res:
        if not h: print('  MISMATCH', r)
    return ok, len(res)

if __name__ == '__main__':
    check(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 8)
