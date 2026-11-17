#!/usr/bin/env python3
"""Build the public website for feedesk.medibrisa.com and the GitHub Pages copy: landing/ -> dist-landing/.

Fee Desk is app-only. The website is a "Get the app" page plus the legal pages (privacy, terms, support,
licences) and icons, copied from site/ so they stay identical to the copies bundled in the app.
site/ is NOT published: it is the source the iOS/Android build vendors.
landing/sw.js replaces the old offline web app's service worker: it clears its caches and unregisters.

Usage: python3 scripts/landing-bundle.py [--out dist-landing]
"""
import argparse, os, shutil, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser(); ap.add_argument('--out', default='dist-landing'); a = ap.parse_args()
out = os.path.join(ROOT, a.out); shutil.rmtree(out, ignore_errors=True); os.makedirs(out)
for f in ('index.html', 'sw.js'):
    shutil.copy(os.path.join(ROOT, 'landing', f), out)
for f in ('privacy.html', 'terms.html', 'support.html', 'licences.html', 'og.jpg'):
    shutil.copy(os.path.join(ROOT, 'site', f), out)
shutil.copytree(os.path.join(ROOT, 'site', 'icons'), os.path.join(out, 'icons'))
open(os.path.join(out, '.nojekyll'), 'w').close()
for f in ('data', 'js', 'css', 'manifest.webmanifest'):
    if os.path.exists(os.path.join(out, f)): sys.exit(f'landing-bundle: {f} must not be published')
print('landing-bundle:', out, sorted(os.listdir(out)))
