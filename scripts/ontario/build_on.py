#!/usr/bin/env python3
"""Build site/data/prov/ON.json (and the ON card in index.json) from the licensed Ontario documents.
Licence: King's Printer for Ontario, C/N 0198/26/N. Licensed Material = (1) Schedule of Benefits for Physician Services
(effective July 1, 2026) and (2) OHIP Physician Fee Schedule Master. Nothing else is reproduced.
Usage: build_on.py RAW_DIR   (RAW_DIR holds sob.txt = `pdftotext -layout` of the SOB PDF and master/OCTSOB*.001; kept private, not in git)"""
import json, subprocess, sys, os, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
RAW = sys.argv[1]; TMP = '/tmp/on_stage.json'
subprocess.check_call([sys.executable, os.path.join(HERE, 'on_parse.py'), RAW, TMP])
S = json.load(open(TMP))
rows = S['rows']
codes = len({r['c'] for r in rows})
LEG = "© King's Printer for Ontario, 2026. Reproduced with permission."
meta = {
 'id': 'ON', 'name': 'Ontario', 'feeModel': 'single', 'codeLabel': 'Fee code', 'codeRe': r'^[A-Z]\d{3}[A-Z]?$',
 'publisher': 'Ontario Ministry of Health',
 'title': 'Schedule of Benefits for Physician Services',
 'edition': 'Schedule of Benefits for Physician Services (effective July 1, 2026), document dated July 22, 2026. Amounts are checked against the OHIP Physician Fee Schedule Master',
 'effective': '2026-07-01', 'effectiveLabel': 'Effective 1 July 2026',
 'pdf': 'https://www.ontario.ca/files/2026-08/moh-schedule-benefit-effective-2026-07-01.pdf',
 'landing': 'https://www.ontario.ca/page/ohip-schedule-benefits-and-fees',
 'checked': datetime.date.today().isoformat(),
 'legends': [
   {'work': 'Schedule of Benefits for Physician Services (effective July 1, 2026)', 'text': LEG},
   {'work': 'OHIP Physician Fee Schedule Master', 'text': LEG}],
 'credit': LEG,
 'licence': {'text': "Reproduced under licence from the King's Printer for Ontario, limited to the Schedule of Benefits for Physician Services and the OHIP Physician Fee Schedule Master."},
 'governs': "Reference only. The official Schedule of Benefits governs if there is any difference. The King's Printer for Ontario makes no representation about the accuracy, completeness or currency of this material or its fitness for any particular purpose.",
 'compNote': 'TEC is the technical component (the “H” or “T” fee) and PRO is the professional component (“P”), as printed in the Schedule.',
 'noAiDesc': True,
 'ctxNote': 'Items printed with a leading “-” are shown under the line printed above them in the Schedule.',
 'skillLabel': '', 'skills': [], 'defaultSkill': '', 'cols': {'f': 'Fee'},
 'rulesNote': 'Section headings from the Schedule’s table of contents; links open the PDF at the page. Preambles, payment rules and surgical units are in the Schedule itself.',
 'dx': {'system': 'Diagnostic code', 'label': 'not bundled',
        'note': 'Ontario diagnostic codes are not part of the licensed material and are not included in this app.',
        'url': 'https://www.ontario.ca/page/ohip-schedule-benefits-and-fees', 'urlLabel': 'Ministry of Health (ontario.ca)'},
 'counts': {'rows': len(rows), 'codes': codes},
}
out = {'meta': meta, 'secs': S['secs'], 'subs': S['subs'], 'rows': rows, 'rules': S['rules']}
json.dump(out, open(os.path.join(ROOT, 'site/data/prov/ON.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
ip = os.path.join(ROOT, 'site/data/prov/index.json'); I = json.load(open(ip))
for j in I['list']:
    if j['id'] == 'ON':
        j.clear(); j.update({'id': 'ON', 'name': 'Ontario', 'group': 'prov', 'status': 'live', 'file': 'ON.json', 'effective': meta['effective'],
          'effectiveLabel': meta['effectiveLabel'], 'counts': meta['counts'], 'link': meta['landing'], 'linkLabel': 'OHIP Schedule of Benefits and Fees (ontario.ca)'})
json.dump(I, open(ip, 'w'), ensure_ascii=False, indent=1); open(ip, 'a').write('\n')
print('ON.json rows', len(rows), 'codes', codes)
