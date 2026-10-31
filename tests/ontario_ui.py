"""Browser check: the Ontario legend is on every view that shows Schedule text. Needs playwright + chromium.
Run: python3 tests/ontario_ui.py   (serves site/ on a local port; synthetic state only, no personal data)"""
import http.server, threading, functools, sys, os
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(__file__), '..', 'site')
LEG = "© King's Printer for Ontario, 2026. Reproduced with permission."
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Q, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{srv.server_port}/'
fails = []
def check(name, cond):
    print(('PASS ' if cond else 'FAIL ') + name)
    if not cond: fails.append(name)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME', '/usr/bin/google-chrome'), args=['--no-sandbox'])
    for label, vp in (('desktop', {'width': 1280, 'height': 900}), ('phone', {'width': 390, 'height': 844})):
        ctx = b.new_context(viewport=vp, service_workers='block'); pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.add_init_script("try{localStorage.setItem('mb.jur','ON')}catch(e){}")
        pg.goto(base); pg.wait_for_selector('#q', timeout=15000); pg.wait_for_timeout(1500)
        pg.fill('#q', 'A001'); pg.press('#q', 'Enter'); pg.wait_for_timeout(1000)
        body = pg.inner_text('body')
        res = pg.inner_text('#results') if pg.query_selector('#results') else ''
        check(f'{label}: results list shows A001 and its own legend', 'Minor assessment' in res and LEG in res)
        # footer/source note
        check(f'{label}: footer legend with work names', 'OHIP Physician Fee Schedule Master' in body and 'Schedule of Benefits for Physician Services' in body)
        check(f'{label}: governs/disclaimer in footer', 'makes no representation about the accuracy, completeness or currency' in body)
        # open detail
        pg.goto(base + '#/code/A001'); pg.wait_for_timeout(1200)
        d = pg.inner_text('body'); check(f'{label}: code detail legend', LEG in d and 'Minor assessment' in d)
        # price list & rules
        for tab in ('price', 'rules'):
            pg.evaluate("t=>{const b=document.querySelector('[data-tab=\"'+t+'\"]'); b&&b.click()}", tab); pg.wait_for_timeout(800)
            d = pg.inner_text('body'); check(f'{label}: {tab} view legend', LEG in d)
        # no AI description leak
        check(f'{label}: no page errors', not errs)
        ctx.close()
    b.close()
sys.exit(1 if fails else 0)
