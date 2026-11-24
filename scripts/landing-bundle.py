#!/usr/bin/env python3
"""Build the public website for feedesk.medibrisa.com and the GitHub Pages copy: landing/ + site/ -> dist-landing/.

Layout:
  /          "Get the app" page (landing/) plus legal pages and icons copied from site/
  /web/      full Fee Desk web app (site/), with a 6-month free-preview timer (landing/web-preview.*)

Native app builds still vendor site/ only; they do not include the /web/ timer.
landing/sw.js replaces the old root offline web app's service worker: it clears its caches and unregisters.

To omit /web/ from the public site entirely, set INCLUDE_WEB_PREVIEW = False.
To hide the app at /web/ while leaving the URL up (ended notice), set WEB_PREVIEW_ENABLED = false
in landing/web-preview.js.

Usage: python3 scripts/landing-bundle.py [--out dist-landing]
"""
import argparse, importlib.util, os, re, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Set False to omit /web/ from the public bundle. The JS flag WEB_PREVIEW_ENABLED only hides the UI.
INCLUDE_WEB_PREVIEW = True

PREVIEW_JS_TAG = '<script src="js/web-preview.js"></script>'
PREVIEW_CSS_TAG = '<link rel="stylesheet" href="css/web-preview.css">'
ASSETS_NEEDLE = "'css/app.css'"
ASSETS_WITH_PREVIEW = "'css/app.css', 'css/web-preview.css', 'js/web-preview.js'"
HEAD_CHARSET = '<meta charset="utf-8">'
MOVE_CSS = '<link rel="stylesheet" href="css/shared/move.css">'
HEADER_END = '</header>\n<nav class="tabs'
OG_URL = '<meta property="og:url" content="https://feedesk.medibrisa.com/">'
OG_URL_WEB = '<meta property="og:url" content="https://feedesk.medibrisa.com/web/">'
REDIRECTS = '# Trailing slash so relative css/js/data URLs resolve under /web/.\n/web /web/ 308\n'

def _load_cf():
    spec = importlib.util.spec_from_file_location('cf_bundle', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cf-bundle.py'))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m

def _must_replace(text, old, new, where):
    if text.count(old) != 1:
        raise SystemExit(f'landing-bundle: expected {old!r} exactly once in {where}')
    return text.replace(old, new, 1)

def _read(path):
    return open(path, encoding='utf-8').read()

def _write(path, text):
    open(path, 'w', encoding='utf-8').write(text)

def _install_web_preview(web, landing):
    js_src = os.path.join(landing, 'web-preview.js')
    css_src = os.path.join(landing, 'web-preview.css')
    banner = _read(os.path.join(landing, 'web-preview-banner.html')).strip() + '\n'
    gate = _read(os.path.join(landing, 'web-preview-gate.html')).strip() + '\n'
    shutil.copy(js_src, os.path.join(web, 'js', 'web-preview.js'))
    shutil.copy(css_src, os.path.join(web, 'css', 'web-preview.css'))

    index_path = os.path.join(web, 'index.html')
    html = _read(index_path)
    html = _must_replace(html, HEAD_CHARSET, HEAD_CHARSET + '\n' + PREVIEW_JS_TAG, 'web/index.html charset')
    html = _must_replace(html, MOVE_CSS, MOVE_CSS + '\n' + PREVIEW_CSS_TAG, 'web/index.html stylesheets')
    html = _must_replace(html, OG_URL, OG_URL_WEB, 'web/index.html og:url')
    html = _must_replace(html, '<body>\n', '<body>\n' + gate, 'web/index.html <body>')
    html = _must_replace(html, HEADER_END, '</header>\n' + banner + '<nav class="tabs', 'web/index.html header')
    _write(index_path, html)

    sw_path = os.path.join(web, 'sw.js')
    sw = _read(sw_path)
    sw = _must_replace(sw, ASSETS_NEEDLE, ASSETS_WITH_PREVIEW, 'web/sw.js ASSETS')
    sw, n = re.subn(r"^(const V = '[^']+)';", r"\1-webpreview';", sw, count=1, flags=re.M)
    if n != 1:
        raise SystemExit('landing-bundle: could not suffix the web/sw.js cache name')
    _write(sw_path, sw)

def build(out_rel='dist-landing'):
    out = out_rel if os.path.isabs(out_rel) else os.path.join(ROOT, out_rel)
    landing = os.path.join(ROOT, 'landing')
    site = os.path.join(ROOT, 'site')
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)
    for f in ('index.html', 'sw.js'):
        shutil.copy(os.path.join(landing, f), out)
    for f in ('privacy.html', 'terms.html', 'support.html', 'licences.html', 'og.jpg'):
        shutil.copy(os.path.join(site, f), out)
    shutil.copytree(os.path.join(site, 'icons'), os.path.join(out, 'icons'))
    open(os.path.join(out, '.nojekyll'), 'w').close()
    _write(os.path.join(out, '_redirects'), REDIRECTS)

    if INCLUDE_WEB_PREVIEW:
        cf = _load_cf()
        cf.build(site, os.path.join(out, 'web'))
        _install_web_preview(os.path.join(out, 'web'), landing)

    for f in ('data', 'js', 'css', 'manifest.webmanifest'):
        if os.path.exists(os.path.join(out, f)):
            sys.exit(f'landing-bundle: {f} must not be published at the site root')
    return out

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--out', default='dist-landing'); a = ap.parse_args()
    out = build(a.out)
    print('landing-bundle:', out, sorted(os.listdir(out)))
