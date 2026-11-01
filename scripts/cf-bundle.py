#!/usr/bin/env python3
"""Build the Cloudflare Pages copy of the Fee Desk site: site/ -> dist-cf/ with the service-worker redirect fix.

Pages answers /x.html with a 308 to /x. A redirected Response cannot be served to a navigation, so the install
step of sw.js must store a redirect-free copy. The repo copy of sw.js is left alone (it also feeds the iOS app and
GitHub Pages); only the dist-cf copy is patched. Fails loudly if the line to patch is not found.

Usage: python3 scripts/cf-bundle.py [--src site] [--out dist-cf]
"""
import argparse, os, shutil, sys

OLD = "fetch(new Request(a, { cache: 'reload' })).then(r => { if (r.ok) return c.put(a, r); })"
NEW = ("fetch(new Request(a, { cache: 'reload' })).then(async r => { if (r.ok) return c.put(a, "
       "r.redirected ? new Response(await r.blob(), { status: r.status, statusText: r.statusText, headers: r.headers }) : r); })")
BANNER = "/* [Cloudflare Pages copy] Install now stores redirect-free copies (Pages 308s /x.html to /x; a redirected response cannot be served to a navigation offline). */\n"

def patch_sw(text):
    if text.count(OLD) != 1:
        raise SystemExit("cf-bundle: the sw.js install line to patch was not found exactly once; update scripts/cf-bundle.py")
    return BANNER + text.replace(OLD, NEW)

def build(src, out):
    if os.path.exists(out): shutil.rmtree(out)
    shutil.copytree(src, out, ignore=shutil.ignore_patterns('.nojekyll', '.DS_Store'))
    p = os.path.join(out, 'sw.js')
    patched = patch_sw(open(p, encoding='utf-8').read())
    open(p, 'w', encoding='utf-8').write(patched)
    return out

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--src', default='site'); ap.add_argument('--out', default='dist-cf')
    a = ap.parse_args(); print('cf-bundle:', build(a.src, a.out))
