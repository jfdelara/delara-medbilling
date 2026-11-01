#!/usr/bin/env python3
"""MedBilling Fee Desk - Friday data pipeline (what .github/workflows/friday-data-update.yml runs).

    python3 scripts/data-pipeline.py run                 # fetch sources, detect change, rebuild site/data, verify, update the lock + SW cache
    python3 scripts/data-pipeline.py run --offline       # no network: use what is already in raw/ (local rehearsal)
    python3 scripts/data-pipeline.py run --force         # rebuild even when no source changed
    python3 scripts/data-pipeline.py verify              # only the sanity checks on site/data

How a change is detected: data-sources.lock.json holds the SHA-256 of every official source file the data was built from
(Alberta SOMB lists, ICD-9 supplement, each AHCIP bulletin, and the live province/territory PDFs). Output files are NOT hashed, because
meta.json carries downloadedAt/builtAt timestamps. Any added, removed or changed source = "changed".

Rules kept from the runbook: never hand-edit data; a failed download of a live source is NEEDS ATTENTION and nothing is rebuilt (no partial
update). NS, NB and PE are held (not published): they are fetched for the record but never block a run. Yukon and the CMS ICD-9-CM file have
no automatic source: their committed JSON is left exactly as it is. Writes only under site/data, site/sw.js, data-sources.lock.json and raw/.
Writes result.json (and GITHUB_OUTPUT / GITHUB_STEP_SUMMARY when set)."""
import argparse, datetime, hashlib, json, os, re, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'raw')
SITE = os.path.join(ROOT, 'site')
DATA = os.path.join(SITE, 'data')
LOCK = os.path.join(ROOT, 'data-sources.lock.json')
SW = os.path.join(SITE, 'sw.js')
PY = sys.executable
LIVE_PROV = ['MB', 'SK', 'NL', 'NT']                 # downloadable and published
HELD_PROV = ['NS', 'NB', 'PE']                       # downloaded for the record, never published
HELD_IDS = {'BC', 'ON', 'QC', 'PE', 'NB', 'NS'}      # must never appear in the published province picker
MIN_KEEP = 0.9                                       # a rebuilt list may not shrink below 90% of the committed one

def log(*a): print(*a, file=sys.stderr, flush=True)

def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''): h.update(chunk)
    return h.hexdigest()

def is_pdf(path):
    try: return open(path, 'rb').read(5) == b'%PDF-'
    except OSError: return False

def run(cmd, **kw):
    log('$', ' '.join(os.path.relpath(c, ROOT) if os.path.isabs(c) and c.startswith(ROOT) else c for c in cmd))
    return subprocess.run(cmd, cwd=ROOT, text=True, **kw)

# ------------------------------------------------------------------ sources + lock
def province_sources():
    sys.path.insert(0, os.path.join(ROOT, 'scripts', 'provinces'))
    import importlib; up = importlib.import_module('update_provinces')
    return {jid: s['file'] for jid, s in up.SOURCES.items()}

def expected_sources(raw=RAW):
    """{relative path: sha256} for every source file the current raw/manifest.json + province list names; missing/non-PDF -> value None."""
    man = json.load(open(os.path.join(raw, 'manifest.json')))
    files = [r['file'] for r in man['somb']['resources']] + [man['icd9']['file']]
    files += ['bulletins/' + b['file'] for b in man['bulletins']['items']]
    out = {}
    for f in files:
        p = os.path.join(raw, f); out[f] = sha(p) if is_pdf(p) else None
    for jid, f in province_sources().items():
        p = os.path.join(raw, 'provinces', f); out[f'provinces/{f}'] = sha(p) if is_pdf(p) else None
    return out

def prov_of(rel):
    for jid, f in province_sources().items():
        if rel == f'provinces/{f}': return jid
    return None

def diff_lock(old, new):
    """Return (changed, added, removed) lists of source names between two {name: sha} dicts (None values ignored)."""
    new = {k: v for k, v in new.items() if v}
    changed = sorted(k for k in new if k in old and old[k] != new[k])
    added = sorted(k for k in new if k not in old)
    removed = sorted(k for k in old if k not in new)
    return changed, added, removed

def blocking_failures(expected):
    """Names of live sources that could not be fetched. Held provinces are only reported."""
    bad, held = [], []
    for rel, h in expected.items():
        if h: continue
        j = prov_of(rel)
        (held if j in HELD_PROV else bad).append(rel)
    return bad, held

# ------------------------------------------------------------------ SW cache bump
SW_RE = re.compile(r"^(const V = ')mb-v(\d+)-(\d{8})-([^']*)(';)", re.M)
def bump_sw(date, path=SW):
    s = open(path, encoding='utf-8').read(); m = SW_RE.search(s)
    if not m: raise SystemExit(f"data-pipeline: `const V = 'mb-vN-YYYYMMDD-...'` not found in {path}")
    old = f'mb-v{m.group(2)}-{m.group(3)}-{m.group(4)}'
    new = f'mb-v{int(m.group(2)) + 1}-{date}-data'
    open(path, 'w', encoding='utf-8').write(s[:m.start()] + m.group(1) + new + m.group(5) + s[m.end():])
    return old, new

# ------------------------------------------------------------------ verification
def count_of(obj):
    if isinstance(obj, list): return len(obj)
    if isinstance(obj, dict): return len(obj.get('codes', obj.get('list', obj)))
    return 0

def verify(data=DATA, baseline=None, site=SITE):
    """Sanity checks on a built data folder. baseline = folder with the previously committed data (shrink guard). Returns a list of problems."""
    problems = []
    files = {}
    for dp, _, fs in os.walk(data):
        for n in fs:
            p = os.path.join(dp, n); rel = os.path.relpath(p, data)
            if not n.endswith('.json'): continue
            try: files[rel] = json.load(open(p, encoding='utf-8'))
            except Exception as e: problems.append(f'{rel}: not valid JSON ({e})')
    for need in ('meta.json', 'codes.json', 'icd9.json', 'bulletins.json', 'modifiers.json', 'rules.json', 'explanatory.json', 'modifier-search.json', os.path.join('prov', 'index.json')):
        if need not in files: problems.append(f'{need}: missing')
    meta = files.get('meta.json', {})
    if meta.get('app') != 'MedBilling Fee Desk' or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(meta.get('sombEffective', ''))): problems.append('meta.json: app/sombEffective not as expected')
    if not meta.get('counts', {}).get('codes'): problems.append('meta.json: counts.codes is 0')
    idx = files.get(os.path.join('prov', 'index.json'), {})
    for e in idx.get('list', []):
        if e.get('id') in HELD_IDS: problems.append(f"prov/index.json lists held jurisdiction {e['id']}")
        if e.get('status') == 'live' and e.get('file') and e['file'] != 'AB.json' and os.path.join('prov', e['file']) not in files:
            problems.append(f"prov/index.json: {e['id']} is live but prov/{e['file']} is missing")
    for rel in files:
        if rel.startswith('prov' + os.sep):
            jid = os.path.basename(rel)[:-5]
            if jid in HELD_IDS: problems.append(f'{rel}: held jurisdiction must not be published')
    if baseline and os.path.isdir(baseline):
        for rel in ('codes.json', 'icd9.json', 'bulletins.json', 'rules.json', 'modifiers.json', 'explanatory.json', 'modifier-search.json') + tuple(
                os.path.join('prov', f) for f in os.listdir(os.path.join(baseline, 'prov')) if f.endswith('.json') and f != 'index.json'):
            bp = os.path.join(baseline, rel)
            if not os.path.exists(bp) or rel not in files: continue
            try: old = count_of(json.load(open(bp, encoding='utf-8')))
            except Exception: continue
            new = count_of(files[rel])
            if old and new < old * MIN_KEEP: problems.append(f'{rel}: shrank from {old} to {new} entries (floor {int(old * MIN_KEEP)})')
    for dp, _, fs in os.walk(site):
        for n in fs:
            if n.endswith(('.html', '.js', '.json')):
                with open(os.path.join(dp, n), encoding='utf-8', errors='replace') as fh: t = fh.read()
                for tok in ('[LAWYER]', '[GO-LIVE DATE]'):
                    if tok in t: problems.append(f'{os.path.relpath(os.path.join(dp, n), site)}: placeholder {tok}')
    return problems

# ------------------------------------------------------------------ run
def emit(result, summary):
    json.dump(result, open(os.path.join(ROOT, 'result.json'), 'w'), indent=1)
    print(json.dumps(result, indent=1))
    go = os.environ.get('GITHUB_OUTPUT')
    if go:
        with open(go, 'a') as f:
            f.write(f"status={result['status']}\nchanged={'true' if result['status'] == 'changed' else 'false'}\n")
    st = os.environ.get('GITHUB_STEP_SUMMARY')
    if st: open(st, 'a').write(summary + '\n')
    open(os.path.join(ROOT, 'pr-body.md'), 'w').write(summary + '\n')

def cmd_run(a):
    today = a.date or datetime.date.today().strftime('%Y%m%d')
    os.makedirs(os.path.join(RAW, 'provinces'), exist_ok=True)
    if not a.offline:
        for c in ([PY, 'scripts/update-data.py', '--download-only'], [PY, 'scripts/provinces/update_provinces.py', '--download-only']):
            r = run(c, capture_output=True)
            sys.stderr.write(r.stderr or ''); log((r.stdout or '').split('\nManual steps:')[0])
            if r.returncode and 'update-data' in c[1]: log('update-data download step exited', r.returncode, '(missing files are reported below)')
    if not os.path.exists(os.path.join(RAW, 'manifest.json')):
        result = {'status': 'needs_attention', 'failures': ['raw/manifest.json missing: Alberta discovery failed'], 'held_notes': []}
        emit(result, '## Fee Desk Friday data check: NEEDS ATTENTION\n\nAlberta source discovery failed (no manifest). Nothing was rebuilt.'); return 2
    exp = expected_sources()
    bad, held = blocking_failures(exp)
    lock = json.load(open(LOCK)) if os.path.exists(LOCK) else {}
    changed, added, removed = diff_lock(lock.get('sources', {}), exp)
    live_changed = [k for k in changed + added + removed if prov_of(k) not in HELD_PROV]
    held_changed = [k for k in changed + added + removed if prov_of(k) in HELD_PROV]
    result = {'status': 'unchanged', 'changed': changed, 'added': added, 'removed': removed, 'failures': bad, 'held_notes': held + held_changed}
    if bad:
        result['status'] = 'needs_attention'
        emit(result, '## Fee Desk Friday data check: NEEDS ATTENTION\n\nThese live sources could not be fetched (kept as-is, nothing rebuilt, no partial update):\n\n' + '\n'.join(f'- `{b}`' for b in bad)); return 2
    if not live_changed and not a.force:
        emit(result, '## Fee Desk Friday data check: no change\n\nEvery live source file matches `data-sources.lock.json`.' + (
            '\n\nHeld (not published) sources that changed, note only: ' + ', '.join(held_changed) if held_changed else '')); return 0
    # ---- rebuild (only now touch site/data)
    base = tempfile.mkdtemp(prefix='fd-baseline-'); shutil.copytree(DATA, os.path.join(base, 'data'))
    steps = [[PY, 'scripts/update-data.py', '--offline'], [PY, 'scripts/provinces/build_prov.py'] + LIVE_PROV, [PY, 'scripts/build-modifier-search.py']]
    for c in steps:
        r = run(c)
        if r.returncode:
            result['status'] = 'needs_attention'; result['failures'] = [f'{os.path.basename(c[1])} exited {r.returncode}']
            emit(result, f'## Fee Desk Friday data check: NEEDS ATTENTION\n\n`{os.path.basename(c[1])}` failed after the sources changed. site/data may be half-written: discard this workspace.'); return 2
    mism = []
    for jid in LIVE_PROV:
        r = run([PY, 'scripts/provinces/spotcheck.py', jid], capture_output=True); log(r.stdout)
        m = re.search(rf'^{jid}: (\d+)/(\d+)$', r.stdout or '', re.M)
        if r.returncode or not m or m.group(1) != m.group(2): mism.append(f'{jid}: ' + (m.group(0) if m else 'spot-check did not run'))
    problems = verify(DATA, os.path.join(base, 'data')) + [f'spot-check {x}' for x in mism]
    if problems:
        result['status'] = 'needs_attention'; result['failures'] = problems
        emit(result, '## Fee Desk Friday data check: NEEDS ATTENTION\n\nSources changed but the rebuilt data failed its checks. Nothing is published.\n\n' + '\n'.join(f'- {p}' for p in problems)); return 2
    sw_old, sw_new = bump_sw(today)
    json.dump({'note': 'SHA-256 of each official source file the committed data was built from. Written by scripts/data-pipeline.py.', 'sources': {k: v for k, v in sorted(exp.items()) if v}}, open(LOCK, 'w'), indent=1)
    open(LOCK, 'a').write('\n')
    meta = json.load(open(os.path.join(DATA, 'meta.json')))
    result.update({'status': 'changed', 'sw_before': sw_old, 'sw_after': sw_new, 'counts': meta['counts'], 'sombEffective': meta['sombEffective']})
    lines = ['## Fee Desk Friday data update', '', f"SOMB edition effective **{meta['sombEffective']}**. Counts: " + ', '.join(f'{k} {v}' for k, v in meta['counts'].items()) + '.', '',
             f'Service-worker cache `{sw_old}` -> `{sw_new}`.', '', f'Sources changed ({len(changed)}), added ({len(added)}), removed ({len(removed)}):', '']
    items = [f'- changed `{k}`' for k in changed] + [f'- added `{k}`' for k in added] + [f'- removed `{k}`' for k in removed]
    lines += items[:25] + ([f'- ... and {len(items) - 25} more'] if len(items) > 25 else [])
    if a.force and not live_changed: lines.append('- (forced rebuild: no source changed)')
    if held_changed: lines += ['', 'Held (never published) sources that changed, note only: ' + ', '.join(held_changed)]
    lines += ['', 'Yukon and the CMS ICD-9-CM file have no automatic source; their committed JSON is untouched.']
    emit(result, '\n'.join(lines)); return 0

def main(argv=None):
    ap = argparse.ArgumentParser(); sp = ap.add_subparsers(dest='cmd', required=True)
    r = sp.add_parser('run'); r.add_argument('--offline', action='store_true'); r.add_argument('--force', action='store_true'); r.add_argument('--date')
    sp.add_parser('verify')
    a = ap.parse_args(argv)
    if a.cmd == 'verify':
        p = verify(); print('\n'.join(p) if p else 'verify: OK'); return 1 if p else 0
    return cmd_run(a)

if __name__ == '__main__':
    sys.exit(main())
