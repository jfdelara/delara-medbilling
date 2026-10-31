#!/usr/bin/env python3
"""Single place for the legal go-live date: edit GO-LIVE-DATE (repo root), run this script, commit.
Sets "Effective date" and "Last updated" in site/privacy.html and site/terms.html."""
import os, re, sys
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
date = open(os.path.join(root, 'GO-LIVE-DATE')).read().strip()
if not date: sys.exit('GO-LIVE-DATE is empty')
pat = re.compile(r'(MedBilling Fee Desk · Effective date: )[^·<]*?( · Last updated: )[^<]*?(</p>)')
for f in ('privacy.html', 'terms.html'):
    p = os.path.join(root, 'site', f); s = open(p, encoding='utf-8').read()
    n, c = pat.subn(lambda m: f'{m.group(1)}{date}{m.group(2)}{date}{m.group(3)}', s)
    if c != 1: sys.exit(f'{f}: meta line not found')
    open(p, 'w', encoding='utf-8').write(n); print(f'{f}: effective + last updated = {date}')
