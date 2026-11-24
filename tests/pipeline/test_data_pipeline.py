"""Unit tests for scripts/data-pipeline.py, scripts/cf-bundle.py and scripts/landing-bundle.py. No network. Run: python3 -m unittest discover -s tests/pipeline -v"""
import importlib.util, json, os, re, shutil, tempfile, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
def load(name, file):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, 'scripts', file)); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
dp = load('data_pipeline', 'data-pipeline.py')
cf = load('cf_bundle', 'cf-bundle.py')
lb = load('landing_bundle', 'landing-bundle.py')

class DiffLock(unittest.TestCase):
    def test_no_change(self):
        self.assertEqual(dp.diff_lock({'a': '1', 'b': '2'}, {'a': '1', 'b': '2'}), ([], [], []))
    def test_changed_added_removed(self):
        self.assertEqual(dp.diff_lock({'a': '1', 'b': '2'}, {'a': '9', 'c': '3'}), (['a'], ['c'], ['b']))
    def test_missing_download_is_not_a_removal_of_content(self):
        # a None hash means the file could not be fetched: it is reported by blocking_failures, never treated as new content
        self.assertEqual(dp.diff_lock({'a': '1'}, {'a': None}), ([], [], ['a']))
    def test_empty_lock_marks_everything_added(self):
        self.assertEqual(dp.diff_lock({}, {'a': '1'}), ([], ['a'], []))

class Blocking(unittest.TestCase):
    def test_live_failure_blocks_held_does_not(self):
        live = 'provinces/' + dp.province_sources()['SK']; held = 'provinces/' + dp.province_sources()['NS']
        bad, held_l = dp.blocking_failures({live: None, held: None, 'x.pdf': 'h'})
        self.assertEqual(bad, [live]); self.assertEqual(held_l, [held])
    def test_all_ok(self):
        self.assertEqual(dp.blocking_failures({'a': 'h'}), ([], []))

class SwBump(unittest.TestCase):
    def test_bump(self):
        d = tempfile.mkdtemp(); p = os.path.join(d, 'sw.js')
        open(p, 'w').write("// x\nconst V = 'mb-v62-20261031-privacy-link-b-on-main-f';\nconst A = [];\n")
        old, new = dp.bump_sw('20261102', p)
        self.assertEqual(old, 'mb-v62-20261031-privacy-link-b-on-main-f'); self.assertEqual(new, 'mb-v63-20261102-data')
        self.assertIn("const V = 'mb-v63-20261102-data';", open(p).read())
        self.assertEqual(dp.bump_sw('20261102', p)[1], 'mb-v64-20261102-data')
    def test_missing_pattern_fails(self):
        d = tempfile.mkdtemp(); p = os.path.join(d, 'sw.js'); open(p, 'w').write("const V = 'other';\n")
        with self.assertRaises(SystemExit): dp.bump_sw('20261102', p)
    def test_repo_sw_matches(self):
        self.assertTrue(dp.SW_RE.search(open(dp.SW, encoding='utf-8').read()))

class Verify(unittest.TestCase):
    """verify() against a copy of the committed site/ with one defect injected at a time."""
    def setUp(self):
        self.tmp = tempfile.mkdtemp(); self.site = os.path.join(self.tmp, 'site'); shutil.copytree(dp.SITE, self.site)
        self.data = os.path.join(self.site, 'data'); self.base = os.path.join(self.tmp, 'base'); shutil.copytree(self.data, self.base)
    def tearDown(self): shutil.rmtree(self.tmp, ignore_errors=True)
    def check(self): return dp.verify(self.data, self.base, self.site)
    def test_committed_data_is_clean(self): self.assertEqual(self.check(), [])
    def test_invalid_json(self):
        open(os.path.join(self.data, 'rules.json'), 'w').write('{nope')
        self.assertTrue(any('rules.json' in p and 'not valid JSON' in p for p in self.check()))
    def test_shrink_guard(self):
        p = os.path.join(self.data, 'codes.json'); j = json.load(open(p)); j = j[:len(j) // 2] if isinstance(j, list) else {**j, 'codes': j['codes'][:len(j['codes']) // 2]}
        json.dump(j, open(p, 'w'))
        self.assertTrue(any('codes.json: shrank' in p for p in self.check()))
    def test_held_jurisdiction_in_index(self):
        p = os.path.join(self.data, 'prov', 'index.json'); j = json.load(open(p)); j['list'].append({'id': 'NS', 'status': 'live', 'file': 'NS.json'}); json.dump(j, open(p, 'w'))
        self.assertTrue(any('held jurisdiction NS' in p for p in self.check()))
    def test_held_file_published(self):
        open(os.path.join(self.data, 'prov', 'PE.json'), 'w').write('[]')
        self.assertTrue(any('PE.json' in p and 'held' in p for p in self.check()))
    def test_missing_required_file(self):
        os.remove(os.path.join(self.data, 'icd9.json'))
        self.assertTrue(any('icd9.json: missing' in p for p in self.check()))
    def test_placeholder_text(self):
        open(os.path.join(self.site, 'terms.html'), 'a').write('<p>[LAWYER]</p>')
        self.assertTrue(any('[LAWYER]' in p for p in self.check()))

class CfBundle(unittest.TestCase):
    def test_patch_applies_once_and_only_to_the_install_line(self):
        src = open(os.path.join(ROOT, 'site', 'sw.js'), encoding='utf-8').read(); out = cf.patch_sw(src)
        self.assertIn('r.redirected ? new Response(await r.blob()', out); self.assertEqual(out.count('r.redirected'), 1)
    def test_fails_when_pattern_missing(self):
        with self.assertRaises(SystemExit): cf.patch_sw('nothing to patch')
    def test_build_leaves_source_untouched(self):
        d = tempfile.mkdtemp(); out = cf.build(os.path.join(ROOT, 'site'), os.path.join(d, 'out'))
        self.assertIn('redirected', open(os.path.join(out, 'sw.js')).read()); self.assertNotIn('redirected', open(os.path.join(ROOT, 'site', 'sw.js')).read())
        self.assertFalse(os.path.exists(os.path.join(out, '.nojekyll')))

class WorkflowSchedule(unittest.TestCase):
    """The weekly run is Friday 06:00 America/Edmonton: two UTC crons (DST), gated on Friday + hour 06 local."""
    def setUp(self):
        self.wf = open(os.path.join(ROOT, '.github', 'workflows', 'friday-data-update.yml')).read()
    def test_two_friday_crons(self):
        import re
        crons = re.findall(r"cron: '([^']+)'", self.wf)
        self.assertEqual(crons, ['0 12 * * 5', '0 13 * * 5'])
    def test_gate_checks_friday_and_edmonton_hour(self):
        self.assertIn('TZ=America/Edmonton date +%H', self.wf)
        self.assertIn('TZ=America/Edmonton date +%u', self.wf)
        self.assertIn('"$d" != "5"', self.wf)
        self.assertIn('"$h" != "06"', self.wf)
    def test_no_monday_left(self):
        self.assertNotIn('monday', self.wf.lower())
    def test_deploy_only_from_main_and_no_push_trigger(self):
        self.assertIn("github.ref == 'refs/heads/main'", self.wf)
        self.assertNotIn('\n  push:', self.wf)
    def test_deploys_landing_bundle_and_smokes_web_preview(self):
        self.assertIn('landing-bundle.py --out dist-landing', self.wf)
        self.assertIn('feedesk.medibrisa.com/web/', self.wf)
        self.assertIn('web/data/meta.json', self.wf)

class LandingBundle(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(); self.out = os.path.join(self.tmp, 'dist-landing')
    def tearDown(self): shutil.rmtree(self.tmp, ignore_errors=True)
    def test_root_stays_get_the_app_and_web_gets_the_full_app(self):
        lb.build(self.out)
        root = os.listdir(self.out)
        self.assertIn('index.html', root); self.assertIn('privacy.html', root); self.assertIn('web', root)
        self.assertNotIn('js', root); self.assertNotIn('css', root); self.assertNotIn('data', root)
        self.assertNotIn('manifest.webmanifest', root)
        landing = open(os.path.join(self.out, 'index.html'), encoding='utf-8').read()
        self.assertIn('Get the app', landing); self.assertIn('href="web/"', landing)
        self.assertNotIn('id="q"', landing)
        web_index = open(os.path.join(self.out, 'web', 'index.html'), encoding='utf-8').read()
        self.assertIn('id="q"', web_index)
        self.assertIn('js/web-preview.js', web_index)
        self.assertIn('css/web-preview.css', web_index)
        self.assertIn('web-preview-banner', web_index)
        self.assertIn('web-preview-gate', web_index)
        self.assertIn('js/app.js', web_index)
        self.assertNotIn("href=\"/css/", web_index)
        self.assertNotIn("src=\"/js/", web_index)
        self.assertNotIn("href=\"/data/", web_index)
        preview = open(os.path.join(self.out, 'web', 'js', 'web-preview.js'), encoding='utf-8').read()
        self.assertIn("WEB_PREVIEW_ENABLED = true", preview)
        self.assertIn("WEB_PREVIEW_EXPIRES_AT = '2027-05-24T00:00:00-06:00'", preview)
        self.assertTrue(os.path.isfile(os.path.join(self.out, 'web', 'js', 'app.js')))
        self.assertTrue(os.path.isfile(os.path.join(self.out, 'web', 'css', 'app.css')))
        self.assertTrue(os.path.isfile(os.path.join(self.out, 'web', 'data', 'meta.json')))
        self.assertTrue(os.path.isfile(os.path.join(self.out, 'web', 'data', 'codes.json')))
        self.assertTrue(os.path.isfile(os.path.join(self.out, 'web', 'icons', 'icon-192.png')))
        meta = json.load(open(os.path.join(self.out, 'web', 'data', 'meta.json')))
        self.assertTrue(meta)
        sw = open(os.path.join(self.out, 'web', 'sw.js'), encoding='utf-8').read()
        self.assertIn('web-preview.js', sw)
        self.assertIn('redirected', sw)
        self.assertIn('-webpreview', sw)
        redirects = open(os.path.join(self.out, '_redirects'), encoding='utf-8').read()
        self.assertIn('/web /web/ 308', redirects)
        leaked = []
        for dirpath, _, files in os.walk(self.out):
            for name in files:
                if not name.endswith(('.html', '.js', '.css', '.webmanifest', '.md')): continue
                text = open(os.path.join(dirpath, name), encoding='utf-8').read()
                if re.search(r'\bJose\b', text) or re.search(r'jfdelara', text, re.I):
                    leaked.append(os.path.join(dirpath, name))
        self.assertEqual(leaked, [])


if __name__ == '__main__': unittest.main()
