#!/usr/bin/env python3
"""Build site/data/prov/<ID>.json for each live jurisdiction plus site/data/prov/index.json (the picker registry).
Run after the source PDFs in raw/provinces/ are refreshed (scripts/update-data.py --provinces does both).
Never invents values: every fee comes from the parsed official document; rows that cannot be read are left out."""
import json, subprocess, os, re, sys, datetime, zipfile, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
RAW = os.path.join(ROOT, 'raw', 'provinces')
OUT = os.path.join(ROOT, 'site', 'data', 'prov')
GOVERNS = 'Reference only. The official schedule governs if there is any difference.'

def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, name + '.py'))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m

def checked(path):
    st = os.path.join(RAW, 'checked.json')
    d = json.load(open(st)) if os.path.exists(st) else {}
    return d.get(os.path.basename(path)) or datetime.date.fromtimestamp(os.path.getmtime(path)).isoformat()

# ---- ICD-9-CM (CMS v32, the list Manitoba Health names as its source of valid codes)
CH = [(1, 139, 'Infectious and parasitic diseases'), (140, 239, 'Neoplasms'), (240, 279, 'Endocrine, nutritional and metabolic diseases, and immunity disorders'),
      (280, 289, 'Diseases of the blood and blood-forming organs'), (290, 319, 'Mental disorders'), (320, 389, 'Diseases of the nervous system and sense organs'),
      (390, 459, 'Diseases of the circulatory system'), (460, 519, 'Diseases of the respiratory system'), (520, 579, 'Diseases of the digestive system'),
      (580, 629, 'Diseases of the genitourinary system'), (630, 679, 'Complications of pregnancy, childbirth, and the puerperium'),
      (680, 709, 'Diseases of the skin and subcutaneous tissue'), (710, 739, 'Diseases of the musculoskeletal system and connective tissue'),
      (740, 759, 'Congenital anomalies'), (760, 779, 'Certain conditions originating in the perinatal period'), (780, 799, 'Symptoms, signs, and ill-defined conditions'),
      (800, 999, 'Injury and poisoning')]
def icd9cm_block(code):
    if code[0] == 'V': return 'Supplementary classification: factors influencing health status (V01-V91)'
    if code[0] == 'E': return 'Supplementary classification: external causes of injury (E000-E999)'
    n = int(code[:3])
    for a, b, t in CH:
        if a <= n <= b: return f'{t} ({a:03d}-{b:03d})'
    return ''
def build_icd9cm():
    zp = os.path.join(RAW, 'cms_icd9cm_v32.zip')
    if not os.path.exists(zp):  # CI has no copy of this static CMS file: keep the committed dx-icd9cm.json
        print('ICD-9-CM zip not in raw/provinces, keeping the existing dx-icd9cm.json'); return None
    z = zipfile.ZipFile(zp)
    out = []
    for line in z.read('CMS32_DESC_LONG_DX.txt').decode('latin-1').splitlines():
        m = re.match(r'^(\S+)\s+(.+)$', line.strip())
        if not m: continue
        raw, desc = m.groups()
        cut = 4 if raw[0] == 'E' else 3
        code = raw[:cut] + ('.' + raw[cut:] if len(raw) > cut else '')
        out.append({'code': code, 'desc': desc.strip(), 'block': icd9cm_block(code)})
    json.dump(out, open(os.path.join(OUT, 'dx-icd9cm.json'), 'w'), separators=(',', ':'), ensure_ascii=False)
    return len(out)

# ---- registry
REG = [
    ('AB', 'Alberta', 'prov'), ('BC', 'British Columbia', 'prov'), ('MB', 'Manitoba', 'prov'), ('NB', 'New Brunswick', 'prov'),
    ('NL', 'Newfoundland and Labrador', 'prov'), ('NS', 'Nova Scotia', 'prov'), ('ON', 'Ontario', 'prov'), ('PE', 'Prince Edward Island', 'prov'),
    ('QC', 'Quebec', 'prov'), ('SK', 'Saskatchewan', 'prov'), ('NT', 'Northwest Territories', 'terr'), ('NU', 'Nunavut', 'terr'), ('YT', 'Yukon', 'terr')]
PERM = 'Permission to republish the official schedule has been requested. No fees are shown until it is granted.'
SOON = {
    'BC': {'status': 'soon', 'message': PERM, 'why': 'The Province of British Columbia does not permit reproduction or redistribution of the MSC Payment Schedule without written permission.',
           'link': 'https://www2.gov.bc.ca/gov/content/health/practitioner-professional-resources/msp/physicians/payment-schedules/msc-payment-schedule', 'linkLabel': 'MSC Payment Schedule (gov.bc.ca)'},
    'ON': {'status': 'soon', 'message': PERM, 'why': 'Ontario permits non-commercial reproduction of the Schedule of Benefits only without changes; a searchable re-presentation needs permission (copyright@ontario.ca).',
           'link': 'https://www.ontario.ca/page/ohip-schedule-benefits-and-fees', 'linkLabel': 'OHIP Schedule of Benefits and Fees (ontario.ca)'},
    'QC': {'status': 'soon', 'message': PERM, 'why': 'Reproduction of the RAMQ manuals requires authorization from the Government of Québec.',
           'link': 'https://www.ramq.gouv.qc.ca/fr/professionnels/medecins-specialistes/manuels/Pages/remuneration-acte.aspx', 'linkLabel': 'RAMQ manuals: rémunération à l\'acte (ramq.gouv.qc.ca)'},
    'PE': {'status': 'soon', 'message': PERM, 'why': 'Prince Edward Island permits one unmodified copy for non-commercial use; further copies need the Government of Prince Edward Island\'s permission (Copyright Permission Request Form).',
           'link': 'https://www.princeedwardisland.ca/sites/default/files/publications/physician_services_agreement_2024-2029.pdf', 'linkLabel': 'Physician Services Agreement 2024-2029 (princeedwardisland.ca, PDF)'},
    'NB': {'status': 'soon', 'message': PERM, 'why': 'The New Brunswick Physicians\u2019 Manual is © Government of New Brunswick, all rights reserved; republishing it needs the Department of Health\u2019s permission.',
           'link': 'https://www2.gnb.ca/content/dam/gnb/Departments/h-s/pdf/en/Physicians/new_brunswick_physicians_manual.pdf', 'linkLabel': 'New Brunswick Physicians\u2019 Manual (gnb.ca, PDF)'},
    'NU': {'status': 'none', 'message': 'MedBilling Fee Desk does not include a fee schedule for Nunavut.',   # privacy-link-b4: Legal's exact wording, no reasons
           'link': 'https://www.nunavutlegislation.ca/en/file-download/download/public/4785', 'linkLabel': 'Medical Care Regulations'},
}
PENDING = {
    'SK': ('Payment Schedule for Insured Services Provided by a Physician', 'https://www.saskatchewan.ca/government/health-care-administration-and-provider-resources/resources-for-health-care-businesses-and-career-development/establishing-and-operating-a-practice/physicians'),
    'NS': ('MSI Physician\'s Manual', 'https://msi.medavie.bluecross.ca/physicians-manual/'),
    'PE': ('Physician Services Agreement 2024-2029', 'https://www.princeedwardisland.ca/sites/default/files/publications/physician_services_agreement_2024-2029.pdf'),
    'NT': ('Insured Services Tariff', 'https://www.hss.gov.nt.ca/sites/hss/files/resources/insured-services-tariff.pdf'),
    'YT': ('Yukon Physician Fee Guide', 'https://apps.gov.yk.ca/physicianresources/f?p=271:9000'),
    'NL': ('MCP Medical Payment Schedule', 'https://www.gov.nl.ca/hcs/files/Medical-Payment-Schedule-October-1-2026.pdf'),
    'NB': ('New Brunswick Physicians\' Manual', 'https://www2.gnb.ca/content/dam/gnb/Departments/h-s/pdf/en/Physicians/new_brunswick_physicians_manual.pdf'),
}

def compact(meta, rows, rules):
    secs, subs = [], []
    def ix(lst, v):
        if v not in lst: lst.append(v)
        return lst.index(v)
    out = []
    for r in rows:
        r = dict(r); r['s'] = ix(secs, r['s']); r['h'] = ix(subs, r.get('h', '')); out.append(r)
    return {'meta': meta, 'secs': secs, 'subs': subs, 'rows': out, 'rules': rules}

def build_mb():
    mb = load('mb')
    pdf = os.path.join(RAW, 'mb_physmanual.pdf')
    txt, rows = mb.extract(pdf)
    labels = mb.label_pages(txt)
    rules, head = [], ''
    toc = '\n'.join(txt.split('\f')[1:31])
    for l in toc.split('\n'):
        m = re.match(r'^(\s{0,6})(\S.*?)\s*\.{3,}\s*(\S+)\s*$', l)
        if not m: continue
        ind, title, lab = len(m.group(1)), re.sub(r'\s+', ' ', m.group(2)), m.group(3)
        g = 'h' if title.upper() == title else ('r' if re.match(r'^\d{1,2}\b', title) else 's')
        if g == 'h': head = title
        pre = 'CONT-INFO-' if re.search(r'CONTACT|INTRODUCTION|LEGISLATION', head) else 'CLMST-' if 'CLAIMS' in head else 'Rules-' if 'RULES OF APPLICATION' in head else ''
        key = (pre + lab) if re.fullmatch(r'\d+', lab) else lab
        if key not in labels: continue
        if g == 's' and (ind > 4 or not re.search(r'CLAIMS|RULES|ANESTHESIA|GENERAL SCHEDULE|OBSTETRICS|FEMALE GENITAL', head)): continue
        rules.append({'t': title.title() if g == 'h' else title, 'p': labels[key], 'l': key, 'g': g})
    vis = []
    for r in rows:
        if re.search(r'\(\d{2}(?:-\d+)?(?:, \d{2}(?:-\d+)?)*\)$', r['s']) and r['s'] not in vis: vis.append(r['s'])
    meta = {
        'id': 'MB', 'name': 'Manitoba', 'feeModel': 'single', 'codeLabel': 'Tariff', 'codeRe': '^\\d{1,4}$',
        'publisher': 'Manitoba Health, Seniors and Long-Term Care', 'title': "Physician's Manual",
        'edition': 'Physician\'s Manual updated 1 October 2026 (tariff pages dated 1 April 2026 unless amended)',
        'effective': '2026-10-01', 'effectiveLabel': 'Updated 1 October 2026',
        'pdf': 'https://www.manitoba.ca/health/documents/physmanual.pdf', 'landing': 'https://www.manitoba.ca/health/manual/index.html',
        'checked': checked(pdf),
        'licence': {'text': 'Contains information from the Government of Manitoba, licensed under the OpenMB Information and Data Use License (Manitoba.ca/OpenMB).',
                    'url': 'https://www.gov.mb.ca/asset_library/en/legal/OpenMB-Information-Data-Use-Licence.pdf'},
        'governs': GOVERNS,
        'skillLabel': 'Specialty (visit tariffs)', 'skills': [{'code': s, 'name': s} for s in vis], 'defaultSkill': 'Obstetrics and Gynaecology (09)',
        'skillNote': 'Visit and consultation tariffs differ by specialty section; other tariffs have one benefit.',
        'cols': {'f': 'Benefit', 'tec': 'Technical (TEC)', 'pro': 'Professional (PRO)', 'au': 'Anaesthetic units'},
        'dx': {'file': 'dx-icd9cm.json', 'system': 'ICD-9-CM', 'label': 'ICD-9-CM (CMS version 32)',
               'note': 'Manitoba Health names the CMS ICD-9-CM list as the source of valid diagnosis codes and requires four-digit codes where they exist. List: CMS ICD-9-CM v32 (U.S. public domain).',
               'url': 'https://www.manitoba.ca/health/claims/faq.html', 'urlLabel': 'Manitoba Health claims FAQ: diagnosis codes'},
        'rulesNote': 'Rules of Application and section preambles are in the Physician\'s Manual; links open the PDF at the page.',
        'counts': {'rows': len(rows), 'codes': len({r['c'] for r in rows})},
    }
    json.dump(compact(meta, rows, rules), open(os.path.join(OUT, 'MB.json'), 'w'), separators=(',', ':'), ensure_ascii=False)
    return meta

ICD9CM_REF = {'file': 'dx-icd9cm.json', 'system': 'ICD-9', 'urlLabel': 'Official source'}

def build_sk():
    sk = load('sk')
    pdf = os.path.join(RAW, 'sk_payment_schedule_2026-10-01.pdf')
    txt, rows = sk.extract(pdf)
    pages = txt.split('\f')
    rules = []
    grp = ''
    for l in pages[1].split('\n'):
        m = re.match(r'^\s(\S.*?)?\s*(?:•\s*(.+?))?\s{2,}(\d{1,3})\s*$', l)
        if not m or 'Page' in l: continue
        left, bul, n = (m.group(1) or '').strip(), m.group(2), int(m.group(3))
        if bul:
            if left: grp = left
            t = grp + ' – ' + bul.strip()
        else:
            t = left; grp = ''
        if not left and not bul: continue
        key = (bul or left).strip().upper()
        if key not in pages[n - 1].upper():  # printed TOC page wrong (e.g. Verification Program): use the page carrying the heading
            hit = [i + 1 for i in range(2, 66) if re.search(r'^\s*' + re.escape(key) + r'\s*$', pages[i].upper(), re.M)]
            if hit: n = hit[0]
        if t and 1 <= n < len(pages): rules.append({'t': t, 'p': n, 'l': str(n), 'g': 's'})
    seen = set()
    for r in rows:
        if r['s'] not in seen:
            seen.add(r['s']); first = min(x['p'] for x in rows if x['s'] == r['s'])
            rules.append({'t': r['s'], 'p': first, 'l': str(first), 'g': 'h'})
    rules.sort(key=lambda r: (r['p'], r['g'] != 'h'))
    for r in rows:
        r['l'] = str(r['p']); r.pop('cl', None)
        if r.get('cls') in ('L', 'M', 'H'):  # page without a column header: re-read the printed Class/Anes pair at line end
            ln = next((l for l in pages[r['p'] - 1].split('\n') if re.match(r'^\s*' + r['c'] + r'\b', l)), '')
            m = re.search(r'\s(0|10|42|D)\s+(LB|L|M|H)\s*$', ln) or re.search(r'(?:\$[\d,]+\.\d\d|By [Rr]eport)\s+(LB|L|M|H)\s*$', ln)
            if m and m.lastindex == 2: r['cls'], r['an'] = m.group(1), m.group(2)
            elif m: r.pop('cls'); r['an'] = m.group(1)
            else: raise SystemExit('SK class/anes unresolved ' + r['c'])
    meta = {
        'id': 'SK', 'name': 'Saskatchewan', 'feeModel': 'cols', 'codeLabel': 'Service', 'codeRe': '^\\d{1,4}[A-Z]?$',
        'publisher': 'Saskatchewan Ministry of Health, Medical Services Branch', 'title': 'Payment Schedule for Insured Services Provided by a Physician',
        'edition': 'October 1, 2026 edition', 'effective': '2026-10-01', 'effectiveLabel': 'Effective 1 October 2026',
        'pdf': 'https://publications.saskatchewan.ca/api/v1/products/129078/formats/157436/download',
        'landing': 'https://www.saskatchewan.ca/government/health-care-administration-and-provider-resources/resources-for-health-care-businesses-and-career-development/establishing-and-operating-a-practice/physicians',
        'checked': checked(pdf),
        'credit': '© 2026, Government of Saskatchewan. Reproduced for non-commercial reference under the Government of Saskatchewan copyright terms (saskatchewan.ca/copyright); this is not an official version.',
        'licence': {'text': 'Saskatchewan materials may be reproduced for non-commercial purposes if reproduced accurately and not represented as an official version.', 'url': 'https://www.saskatchewan.ca/copyright'},
        'governs': GOVERNS,
        'skillLabel': 'Fee column', 'skills': [{'code': 'sp', 'name': 'Specialist'}, {'code': 'gp', 'name': 'General Practitioner'}], 'defaultSkill': 'sp',
        'pick': {'sp': ['sp', 'ref', 'tot', 'f', 'gp'], 'gp': ['gp', 'ref', 'tot', 'f', 'sp']},
        'colNames': {'sp': 'Specialist', 'gp': 'General Practitioner', 'ref': 'Referred', 'nr': 'Not referred / by entitlement', 'tec': 'Technical component',
                     'int': 'Interpretation component', 'tot': 'Technical & interpretation', 'f': 'Fee'},
        'extraCols': {'cls': 'Class', 'an': 'Anes'},
        'cols': {'f': 'Fee'},
        'markNote': 'Amounts marked * or # carry a condition printed on the schedule page (for example payment by approval or entitlement).',
        'dx': {'file': 'dx-icd9cm.json', 'system': 'ICD-9', 'label': 'ICD-9-CM reference list (CMS version 32); Saskatchewan claims use the three-digit category',
               'note': 'Saskatchewan claims require a three-digit ICD diagnostic code (Payment Schedule, Submission of Accounts), plus Ministry codes named in the schedule (e.g. Z51, Z53). The Ministry\'s own diagnostic code file is supplied through the eHealth Customer Portal and is not public; enter the first three characters of the code shown here.',
               'url': 'https://www.saskatchewan.ca/government/health-care-administration-and-provider-resources/resources-for-health-care-businesses-and-career-development/establishing-and-operating-a-practice/physicians', 'urlLabel': 'Saskatchewan physician resources'},
        'rulesNote': 'Preamble, assessment rules and section notes are in the Payment Schedule; links open the PDF at the page.',
        'counts': {'rows': len(rows), 'codes': len({r['c'] for r in rows})},
    }
    json.dump(compact(meta, rows, rules), open(os.path.join(OUT, 'SK.json'), 'w'), separators=(',', ':'), ensure_ascii=False)
    return meta

def build_ns():
    ns = load('ns')
    pdf = os.path.join(RAW, 'ns_msi_physicians_manual_2026-08.pdf')
    txt, rows, bad = ns.extract(pdf)
    pages = txt.split('\f')
    fmap = {}
    for i, pg in enumerate(pages[:215]):
        m = re.search(r'Section (\d): .*?-\s*(\d+)\s*$', pg.rstrip(), re.S | re.M)
        last = [l for l in pg.split('\n') if l.strip()][-1:] or ['']
        m = re.search(r'Section (\d):.*?-\s*(\d+)\s*$', last[0])
        if m: fmap.setdefault((m.group(1), m.group(2)), i + 1)
    rules, secno = [], None
    for pg in pages[2:6]:
        for l in pg.split('\n'):
            m = re.match(r'^(\s*)(.+?)\s*\.{3,}\s*(\d+)\s*$', l)
            if not m: continue
            ind, title, k = len(m.group(1)), re.sub(r'\s+', ' ', m.group(2)).strip(), m.group(3)
            sm = re.match(r'SECTION (\d):', title)
            if sm: secno = sm.group(1)
            if not secno or secno == '8': continue
            pdfp = fmap.get((secno, k))
            if pdfp: rules.append({'t': title if not sm else title.title().replace('(', '(').replace('Msi', 'MSI'), 'p': pdfp, 'l': f'S{secno}-{k}', 'g': 'h' if sm else ('s' if ind < 6 else 'r')})
    seen = {}
    for r in rows: seen.setdefault(r['s'], (r['p'], r['l']))
    for sec, (pp, ll) in seen.items(): rules.append({'t': 'Schedule of Benefits – ' + sec, 'p': pp, 'l': 'S8-' + ll, 'g': 'h'})
    for r in rows: r['l'] = 'S8-' + r['l']; r.pop('cat', None)
    secs = sorted(seen, key=lambda x: (x != 'Obstetrics & Gynaecology', x))
    meta = {
        'id': 'NS', 'name': 'Nova Scotia', 'feeModel': 'msu', 'codeLabel': 'Health service', 'codeRe': '^\\d{2}\\.\\d{1,2}[A-Z]{0,2}$',
        'publisher': 'Nova Scotia Department of Health and Wellness, Medical Services Insurance (MSI; administered by Medavie Blue Cross)',
        'title': 'MSI Physician’s Manual', 'edition': 'Physician’s Manual 2026 (last updated July 2026; posted August 2026)',
        'effective': '2026-04-01', 'effectiveLabel': 'Manual of July 2026 (units as printed)',
        'pdf': 'http://msi.medavie.bluecross.ca/wp-content/uploads/sites/3/2026/08/Physicians-Manual-1.pdf',
        'landing': 'https://msi.medavie.bluecross.ca/physicians-manual/',
        'checked': checked(pdf),
        'credit': 'Source: Government of Nova Scotia (MSI Physician’s Manual). © Crown copyright, Province of Nova Scotia. Reproduced for non-commercial reference under Nova Scotia’s published copyright terms while a licence request is pending; not an official version and not affiliated with or endorsed by the Government of Nova Scotia.',
        'licence': {'text': 'Province of Nova Scotia materials may be reproduced for non-commercial purposes if the source and Crown copyright are acknowledged, the materials are not modified, the reproduction is accurate, and it is not represented as official or made with government affiliation or endorsement. A licence for this searchable reference has been requested.', 'url': 'https://www.novascotia.ca/copyright'},
        'governs': GOVERNS,
        'skillLabel': 'Specialty section', 'skills': [{'code': x, 'name': x} for x in secs], 'defaultSkill': 'Obstetrics & Gynaecology',
        'specSecs': secs,
        'unitNote': 'Values are MSI base units exactly as printed in the Physician’s Manual. MSI pays per unit at the rate in manual section 4.1.18 (medical service unit and anaesthetic unit). +MU = plus multiples; +T = plus time units; IC = independent consideration.',
        'cols': {'f': 'Base units'},
        'caveat': {'text': 'Fee changes announced in MSI Physician’s Bulletins after this manual was compiled (for example the July 17 and September 25, 2026 bulletins: new HSC 03.08B, Internal Medicine visit increases) are not included.',
                   'url': 'https://msi.medavie.bluecross.ca/physicians-bulletins/', 'urlLabel': 'MSI Physician’s Bulletins'},
        'dx': {'file': 'dx-icd9cm.json', 'system': 'ICD-9-CM', 'label': 'ICD-9-CM (CMS version 32 list)',
               'note': 'MSI claims use ICD-9-CM diagnostic codes (Physician’s Manual 3.2.69). This list is the US CMS ICD-9-CM v32 file, for reference.',
               'url': 'https://msi.medavie.bluecross.ca/physicians-manual/', 'urlLabel': 'MSI Physician’s Manual'},
        'rulesNote': 'Preamble sections 1–7 (general rules, claims, tariff, assessment rules, appendices) and each specialty section of the Schedule of Benefits; links open the PDF at the page.',
        'counts': {'rows': len(rows), 'codes': len({r['c'] for r in rows}), 'skipped': len(bad)},
    }
    json.dump(compact(meta, rows, rules), open(os.path.join(OUT, 'NS.json'), 'w'), separators=(',', ':'), ensure_ascii=False)
    return meta

def build_pe():
    pe = load('pe')
    pdf = os.path.join(RAW, 'pei_psa_2024-2029.pdf')
    txt, rows = pe.extract(pdf)
    pages = txt.split('\f')
    fmap = {}
    for i, pg in enumerate(pages):
        last = [l for l in pg.split('\n') if l.strip()][-1:] or ['']
        m = re.match(r'^\s*Tariff - (\w+)\s*$', last[0])
        if m: fmap.setdefault(m.group(1), i + 1)
    rules = []
    for pg in pages[100:107]:
        for l in pg.split('\n'):
            m = re.match(r'^(\s*)(\d+(?:\.[A-Z](?:\.\d+)?)?\.?)\s+(.+?)\s*\.{3,}\s*(\d+)\s*$', l)
            if not m: continue
            num, title, k = m.group(2).rstrip('.'), re.sub(r'\s+', ' ', m.group(3)).strip(), m.group(4)
            if k in fmap:
                depth = num.count('.')
                rules.append({'t': f'{num} {title.title() if title.isupper() else title}', 'p': fmap[k], 'l': 'Tariff-' + k, 'g': 'h' if depth == 0 else ('s' if depth == 1 else 'r')})
    seen = {}
    for r in rows: seen.setdefault(r['s'], r['p'])
    for sec, pp in seen.items(): rules.append({'t': 'Tariff of Fees – ' + sec, 'p': pp, 'l': 'Tariff-' + next(k for k, v in fmap.items() if v == pp), 'g': 'h'})
    inv = {v: k for k, v in fmap.items()}
    for r in rows: r['l'] = 'Tariff-' + inv.get(r['p'], str(r['p']))
    cols = [('2025-04-01', 'From 1 April 2025 (current)'), ('2027-04-01', 'From 1 April 2027'), ('2027-10-01', 'From 1 October 2027'),
            ('2028-04-01', 'From 1 April 2028'), ('2028-10-01', 'From 1 October 2028')]
    meta = {
        'id': 'PE', 'name': 'Prince Edward Island', 'feeModel': 'cols', 'codeLabel': 'Fee', 'codeRe': '^\\d{4}[A-Z]?$',
        'publisher': 'Government of Prince Edward Island, Health PEI and the Medical Society of PEI',
        'title': 'Physician Services Agreement 2024–2029, Schedule A Tariff of Fees', 'edition': 'Agreement April 1, 2024 to March 31, 2029',
        'effective': '2025-04-01', 'effectiveLabel': 'Rates effective 1 April 2025 (next change 1 April 2027)',
        'pdf': 'https://www.princeedwardisland.ca/sites/default/files/publications/physician_services_agreement_2024-2029.pdf',
        'landing': 'https://www.princeedwardisland.ca/sites/default/files/publications/physician_services_agreement_2024-2029.pdf',
        'checked': checked(pdf),
        'credit': 'Source: Government of Prince Edward Island. Reproduced for non-commercial reference; not an official version and not made in affiliation with or with the endorsement of the Government of Prince Edward Island.',
        'licence': {'text': 'Government of Prince Edward Island materials may be reproduced for non-commercial use without modification, with due diligence for accuracy and the Government identified as the source.', 'url': 'https://www.princeedwardisland.ca/en/information/executive-council-office/website-disclaimer-and-copyright-policy'},
        'governs': GOVERNS,
        'skillLabel': 'Rate column', 'skills': [{'code': c, 'name': n} for c, n in cols], 'defaultSkill': '2025-04-01',
        'colNames': dict(cols),
        'cols': {'f': 'Fee'},
        'skillNote': 'The tariff prints five rate columns; the 1 April 2025 column applies until 1 April 2027.',
        'dx': {'file': 'dx-icd9cm.json', 'system': 'ICD-9', 'label': 'ICD-9-CM reference list (CMS version 32)',
               'note': 'Fee-for-service claims to Health PEI use ICD-9 coding (Physician Services Agreement C4.9). This is the US CMS ICD-9-CM v32 list, for reference.',
               'url': 'https://www.princeedwardisland.ca/sites/default/files/publications/physician_services_agreement_2024-2029.pdf', 'urlLabel': 'Physician Services Agreement'},
        'rulesNote': 'Preamble to the Tariff of Fees (sections 1–), and each tariff section; links open the PDF at the page.',
        'counts': {'rows': len(rows), 'codes': len({r['c'] for r in rows})},
    }
    json.dump(compact(meta, rows, rules), open(os.path.join(OUT, 'PE.json'), 'w'), separators=(',', ':'), ensure_ascii=False)
    return meta

def build_nt():
    nt = load('nt')
    pdf = os.path.join(RAW, 'nt_insured_services_tariff.pdf')
    _, rows, probs = nt.extract(pdf)
    txt = subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True).stdout
    pages = txt.split('\f')
    # AN-025 / AN-026: the amount is printed as a percentage over three lines (page 57); transcribed as printed
    pg = next(i + 1 for i, t in enumerate(pages) if 'AN-025' in t and 'Anaesthesia Modifiers' in t)
    pct = '20% (of time-based benefits + procedural benefits)'
    assert pages[pg - 1].count('20% (of time-based') == 2
    an = [r for r in rows if r['c'].startswith('AN-')]
    sec, sub = an[0]['s'], 'Anaesthesia Modifiers'
    at = next(i for i, r in enumerate(rows) if r['c'] == 'AN-027')
    rows[at:at] = [{'c': 'AN-025', 'd': 'Body Mass Index (BMI) greater than 40', 's': sec, 'h': sub, 'p': pg, 'f': pct},
                   {'c': 'AN-026', 'd': 'Sleep apnea patient using C-PAP apparatus and with a Body Mass Index (BMI) less than 40', 's': sec, 'h': sub, 'p': pg, 'f': pct}]
    rules = []
    for l in pages[1].split('\n'):
        m = re.match(r'^\s*([A-I])\s{2,}(.+?)\s{2,}(\d{2})\s*$', l)
        if not m: continue
        letter, title = m.group(1), m.group(2).strip()
        first = lambda t: next((x.strip() for x in t.split('\n')[:6] if x.strip() and 'Preamble to the Insured' not in x), '')
        hit = next((i + 1 for i in range(2, 55) if re.match(letter + r'\s+' + re.escape(title.split()[0]), first(pages[i]))), None)
        if hit: rules.append({'t': f'Preamble {letter} – {title}', 'p': hit, 'l': str(hit), 'g': 'h'})
    for i in range(2, 55):  # numbered subsections such as "E.2 Telehealth Services"
        for m in re.finditer(r'^\s*([A-I]\.\d{1,2})\s{2,}([A-Z][A-Za-z ,/\-–()’\']{3,70})\s*$', pages[i], re.M):
            rules.append({'t': m.group(1) + ' ' + m.group(2).strip(), 'p': i + 1, 'l': str(i + 1), 'g': 's'})
    seen = {}
    for r in rows: seen.setdefault(r['s'], r['p'])
    for sc, pp in seen.items(): rules.append({'t': sc, 'p': pp, 'l': str(pp), 'g': 'h'})
    dd = {}
    for r in rules: dd.setdefault((r['t'], r['p']), r)
    rules = sorted(dd.values(), key=lambda r: r['p'])
    def plabel(i):  # printed page number: last standalone number on the page
        nums = [x.strip() for x in pages[i - 1].split('\n') if re.fullmatch(r'\s*\d{1,3}\s*', x)]
        return nums[-1] if nums else str(i)
    for r in rows: r['l'] = plabel(r['p'])
    for r in rules: r['l'] = plabel(r['p'])
    meta = {
        'id': 'NT', 'name': 'Northwest Territories', 'feeModel': 'single', 'codeLabel': 'Fee', 'codeRe': '^[A-Z]{2,3}-?\\d{3}[A-Z]{0,2}$',
        'publisher': 'Government of the Northwest Territories, Department of Health and Social Services',
        'title': 'Insured Services Tariff (physicians)', 'edition': 'Effective April 1, 2025 (latest published; checked October 2026)',
        'effective': '2025-04-01', 'effectiveLabel': 'Effective 1 April 2025',
        'pdf': 'https://www.hss.gov.nt.ca/sites/hss/files/resources/insured-services-tariff.pdf',
        'landing': 'https://www.hss.gov.nt.ca/en/services/nwt-health-care-plan/physician-services',
        'checked': checked(pdf),
        'credit': '© Government of the Northwest Territories. Reproduced for non-commercial reference.',
        'licence': {'text': 'Government of the Northwest Territories material may be reproduced or redistributed for non-commercial purposes with acknowledgement of GNWT copyright; commercial use needs prior written consent.', 'url': 'https://www.gov.nt.ca/terms'},
        'governs': GOVERNS,
        'skillLabel': '', 'skills': [], 'defaultSkill': '',
        'cols': {'f': 'Price'},
        'markNote': '(+) Designated procedure: visits on the procedure day and before/after it may also be paid when the procedure was not booked in advance (Preamble E.9).',
        'dx': {'system': 'Diagnostic code', 'label': 'not bundled',
               'note': 'NWT claims must include a diagnosis and an applicable diagnostic code (Medical Care Regulations s.4), but neither the tariff nor the regulations name the coding system, so no diagnostic list is bundled for the Northwest Territories.',
               'url': 'https://laws.opennwt.ca/legislation/medical-care-regulations/', 'urlLabel': 'Medical Care Regulations'},
        'rulesNote': 'Preamble sections A–I and each tariff section; links open the PDF at the page.',
        'counts': {'rows': len(rows), 'codes': len({r['c'] for r in rows}), 'skipped': len(probs)},
    }
    json.dump(compact(meta, rows, rules), open(os.path.join(OUT, 'NT.json'), 'w'), separators=(',', ':'), ensure_ascii=False)
    return meta

def build_yt():
    yt = load('yt')
    pdf = os.path.join(RAW, 'yk_fee_guide_2026.pdf')
    pages, rows, probs = yt.extract(pdf)
    rules = []
    for i in range(2, 20):
        for l in pages[i].split('\n'):
            m = re.match(r'^\s{0,4}(\d{1,2})\.\s+([A-Z][A-Z ,&/-]+?)\s*$', l)
            if m: rules.append({'t': f'Preamble {m.group(1)}. {m.group(2).title()}', 'p': i + 1, 'l': str(i + 1), 'g': 'h' if m.group(1) == '1' else 's'})
    for l in pages[1].split('\n'):
        m = re.match(r'^(\S.*?)\s{3,}(\d{1,3})\s*$', l)
        if m and m.group(1).strip() != 'Preamble':
            rules.append({'t': m.group(1).strip(), 'p': int(m.group(2)), 'l': m.group(2), 'g': 'h'})
    rules.sort(key=lambda r: r['p'])
    land = 'https://apps.gov.yk.ca/physicianresources/f?p=271:9000'
    meta = {
        'id': 'YT', 'name': 'Yukon', 'feeModel': 'single', 'codeLabel': 'Fee code', 'codeRe': '^\\d{4,6}$',
        'publisher': 'Government of Yukon, Department of Health and Social Services (Yukon Health Care Insurance Plan)',
        'title': 'Payment Schedule', 'edition': 'Payment Schedule for April 1, 2026 (generated from the YHCIP Physician Resources site, October 2026)',
        'effective': '2026-04-01', 'effectiveLabel': 'Effective 1 April 2026',
        'pdf': land, 'landing': land,
        'pdfGen': {'label': 'Fee schedule (Physician Resources: View Fee Schedule)',
                   'note': 'Yukon publishes the schedule as a PDF generated on request: open Physician Resources, choose “View Fee Schedule”, then go to the page shown.'},
        'checked': checked(pdf),
        'credit': '© Government of Yukon 2026. Reproduced for non-commercial reference; not an official version.',
        'licence': {'text': 'Material on Government of Yukon websites may be reproduced for non-commercial purposes only; reproductions must be accurate and must not be represented as an official version.', 'url': 'https://yukon.ca/en/copyright'},
        'governs': GOVERNS,
        'skillLabel': '', 'skills': [], 'defaultSkill': '',
        'cols': {'f': 'YHCIP/YWCHSB fee'},
        'extraCols': {'an': 'Anes or Proc Code'},
        'markNotes': {'T': 'Printed with a “T” before the fee code (e.g. “T 9010”). The schedule does not explain the T.',
                      '*': 'Marked * in the schedule: an eye examination that Special Consultation 2012 should include when indicated (see fee code 2012).'},
        'dx': {'file': 'dx-icd9cm.json', 'system': 'ICD-9', 'label': 'ICD-9-CM reference list (CMS version 32)',
               'note': 'The Yukon Payment Schedule cites ICD-9 diagnostic codes on claims (e.g. 250 diabetes, 428 heart failure). This is the US CMS ICD-9-CM v32 list, for reference.',
               'url': land, 'urlLabel': 'YHCIP Physician Resources'},
        'rulesNote': 'Preamble sections 1–12 and each specialty section (page numbers of the generated PDF).',
        'counts': {'rows': len(rows), 'codes': len({r['c'] for r in rows}), 'skipped': len(probs)},
    }
    json.dump(compact(meta, rows, rules), open(os.path.join(OUT, 'YT.json'), 'w'), separators=(',', ':'), ensure_ascii=False)
    return meta

def build_nl():
    nl = load('nl')
    pdf = os.path.join(RAW, 'nl_mcp_payment_schedule_2026-10-01.pdf')
    texts, rows, probs = nl.extract(pdf)
    lab = {}
    for i, ls in enumerate(texts):
        if ls: lab.setdefault(ls[-1]['t'].strip(), i + 1)
    for r in rows: r['l'] = r['l'] or str(r['p'])
    toc = subprocess.run(['pdftotext', '-layout', '-f', '2', '-l', '6', pdf, '-'], capture_output=True, text=True).stdout
    rules = []
    for l in toc.split('\n'):
        m = re.match(r'^([A-Z]-\d+)(?:\s*–\s*[A-Z]-?\d+)?(\s{2,})(\S.*?)\s*$', l)
        if m and m.group(1) in lab:
            rules.append({'t': re.sub(r',? (listed )?as follows:$|:$', '', m.group(3)), 'p': lab[m.group(1)], 'l': m.group(1), 'g': 'h' if m.start(3) < 22 else 's'})
    cv = 'Consultations and Visits – '
    vis = sorted({r['s'] for r in rows if r['s'].startswith(cv) and 'Premiums' not in r['s']})
    ob = cv + 'Obstetrics and Gynecology and Gynecological Oncology'
    fm = cv + 'Family Medicine'
    meta = {
        'id': 'NL', 'name': 'Newfoundland and Labrador', 'feeModel': 'single', 'codeLabel': 'Fee code', 'codeRe': '^\\d{2,6}$',
        'publisher': 'Government of Newfoundland and Labrador, Department of Health and Community Services (Medical Care Plan)',
        'title': 'MCP Medical Payment Schedule', 'edition': 'Combined Medical Payment Schedule, October 1, 2026',
        'effective': '2026-10-01', 'effectiveLabel': 'Effective 1 October 2026',
        'pdf': 'https://www.gov.nl.ca/hcs/files/Medical-Payment-Schedule-October-1-2026.pdf',
        'landing': 'https://www.gov.nl.ca/hcs/mcp/providers/',
        'checked': checked(pdf),
        'credit': '© Government of Newfoundland and Labrador. Reproduced for reference; not an official version.',
        'licence': {'text': 'The Government of Newfoundland and Labrador grants permission for information on its website to be used by the public and non-government organizations (users agree to indemnify the Government against claims arising from its use).', 'url': 'https://www.gov.nl.ca/disclaimer/'},
        'governs': GOVERNS,
        'skillLabel': 'Specialty (visit codes)', 'skills': [{'code': s, 'name': s[len(cv):]} for s in vis], 'defaultSkill': ob, 'fpSkill': fm, 'specSecs': vis,
        'skillNote': 'Consultation and visit codes are paid at the rate listed for your specialty; other codes have one listed rate (FP/Spec.).',
        'cols': {'f': 'Rate (FP/Spec.)'},
        'extraCols': {'as': 'Assist', 'an': 'Anaes. units'},
        'anOnlyNote': 'Anaesthesia basic fee in units, as printed; the dollar value per unit is in Table I of the schedule.',
        'dx': {'file': 'dx-icd9cm.json', 'system': 'ICD-9', 'label': 'ICD-9-CM reference list (CMS version 32)',
               'note': 'The NL schedule lists three-digit diagnosis codes from ICD-9 (e.g. 428 heart failure, 491–496 chronic obstructive lung disease) but does not name the edition. This is the US CMS ICD-9-CM v32 list, for reference.',
               'url': 'https://www.gov.nl.ca/hcs/mcp/providers/', 'urlLabel': 'MCP provider information'},
        'rulesNote': 'General Preamble (A), visit premiums (B), visit listings (C) and the other sections from the table of contents; links open the PDF at the page.',
        'counts': {'rows': len(rows), 'codes': len({r['c'] for r in rows}), 'skipped': len(probs)},
    }
    json.dump(compact(meta, rows, rules), open(os.path.join(OUT, 'NL.json'), 'w'), separators=(',', ':'), ensure_ascii=False)
    return meta

def build_nb():
    nb = load('nb')
    pdf = os.path.join(RAW, 'nb_physicians_manual.pdf')
    P, rows, probs = nb.extract(pdf)
    pages = subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True).stdout.split('\f')
    lab = {}
    for i, pg in enumerate(pages):
        L = [l.strip() for l in pg.split('\n') if l.strip()]
        m = L and re.match(r'^(\d{1,3})\s+\w+ 20\d\d$', L[-1])
        if m: lab.setdefault(m.group(1), i + 1)
    ls = [l.rstrip() for pg in pages[1:16] for l in pg.split('\n')]
    CH = nb.toc_titles(pdf)[0]; rules, chap, i = [], 0, 0
    while i < len(ls):
        l = ls[i].strip()
        if l and not nb.LEAD.search(l) and i + 1 < len(ls) and nb.LEAD.search(ls[i + 1]) and not re.match(r'^\d', ls[i + 1].strip()):
            l = l + ' ' + ls[i + 1].strip(); i += 1
        i += 1
        m = re.match(r'^(.+?)\s*[.…]{3,}\s*(\d{1,3})$', l)
        if not m: continue
        t, k = re.sub(r'\s+', ' ', m.group(1)).strip(' .'), m.group(2)
        cm = re.match(r'^CHAPTER\s*(\d+):', t)
        if cm: chap = int(cm.group(1))
        g = 'h' if cm else 's' if t.startswith('Section') else 'r'
        if g == 'r' and chap > 5: continue
        if cm: t = f'Chapter {chap}: ' + CH.get(chap, t)
        if k in lab: rules.append({'t': t, 'p': lab[k], 'l': k, 'g': g})
    c5 = 'Chapter 5: Specialties – '
    secs = sorted({r['s'] for r in rows if r['s'].startswith(c5)}, key=lambda x: int(re.search(r'Section (\d+)', x).group(1)))
    ob = c5 + 'Section 10: Specialists in Obstetrics and Gynaecology'
    meta = {
        'id': 'NB', 'name': 'New Brunswick', 'feeModel': 'msu', 'codeLabel': 'Service code', 'codeRe': '^\\d{1,4}$',
        'publisher': 'Government of New Brunswick, Department of Health (New Brunswick Medicare)',
        'title': 'New Brunswick Physicians’ Manual', 'edition': 'Physicians’ Manual, April 2026 (pages revised to June 2026)',
        'effective': '2026-04-01', 'effectiveLabel': 'Manual of April 2026 (units as printed)',
        'pdf': 'https://www2.gnb.ca/content/dam/gnb/Departments/h-s/pdf/en/Physicians/new_brunswick_physicians_manual.pdf',
        'landing': 'https://www2.gnb.ca/content/gnb/en/departments/health/healthprofessionals.html',
        'checked': checked(pdf),
        'credit': '© Government of New Brunswick. All rights reserved. Not an official version.',
        'licence': {'text': 'All content © Government of New Brunswick. All rights reserved. Not to be published until permission is granted.', 'url': 'https://www.gnb.ca/en/admin/disclaimer.html'},
        'governs': GOVERNS,
        'skillLabel': 'Specialty (visit codes)', 'skills': [{'code': x, 'name': x[len(c5):]} for x in secs], 'defaultSkill': ob, 'specSecs': secs,
        'skillNote': 'Consultation and visit codes are listed by specialty in Chapter 5; procedure codes have one listing.',
        'unitNote': 'Values are Medicare units exactly as printed (Gen = general units, An = anaesthesia units; TU = time units; IC = independent consideration; VF = visit fee). The dollar value per unit depends on the specialty (Chapter 3, section 1.5 Unit Values, e.g. Obstetrics and Gynaecology $1.66 from 01/04/26); no dollar amounts are calculated here.',
        'cols': {'f': 'Units (Gen)'},
        'extraCols': {'ls': 'List'},
        'markNote': 'List A–D: see the legend in Chapter 3, section 1.7.',
        'dx': {'file': None, 'system': 'ICD-10', 'label': 'ICD-10 (not bundled)',
               'note': 'New Brunswick Medicare claims use ICD-10 diagnosis codes (NB Medicare / NBMS billing sessions, 2025). No ICD-10 list is bundled with this app.',
               'url': 'https://www.nbms.nb.ca/wp-content/uploads/2025/05/Medicare-Billing-Session-2-EN.pdf', 'urlLabel': 'Medicare Billing Session 2 (NBMS, PDF)'},
        'rulesNote': 'Chapters 1–5 (Medicare information, assessment rules, general preamble, common items, specialties) and the chapter and section headings of the procedure chapters; links open the PDF at the page.',
        'counts': {'rows': len(rows), 'codes': len({r['c'] for r in rows}), 'skipped': len(probs)},
    }
    json.dump(compact(meta, rows, rules), open(os.path.join(OUT, 'NB.json'), 'w'), separators=(',', ':'), ensure_ascii=False)
    return meta

BUILDERS = {'MB': build_mb, 'SK': build_sk, 'NS': build_ns, 'PE': build_pe, 'NT': build_nt, 'YT': build_yt, 'NL': build_nl, 'NB': build_nb}
EXCLUDED = {'BC', 'ON', 'QC', 'NB', 'NS', 'PE'}  # privacy-link-b3: removed from index.json entirely (no fee schedules for these provinces)
AWAITING = {'PE', 'NB', 'NS'}  # built for the repo (raw/held/) but not served until permission is granted (NS held 2026-10-06)
for _h in filter(None, os.environ.get('HOLD', '').split(',')): BUILDERS.pop(_h, None)  # keep a built jurisdiction out of the live index

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    only = sys.argv[1:] or list(BUILDERS)
    n = build_icd9cm(); print('ICD-9-CM', n)
    live = {}
    for k in only:
        live[k] = BUILDERS[k](); print(k, live[k]['counts'])
        if k in AWAITING:
            os.makedirs(os.path.join(ROOT, 'raw', 'held'), exist_ok=True)
            os.replace(os.path.join(OUT, k + '.json'), os.path.join(ROOT, 'raw', 'held', k + '.json')); live.pop(k); print(k, 'held (awaiting permission): raw/held/' + k + '.json')
    prev = {}
    p = os.path.join(OUT, 'index.json')
    if os.path.exists(p): prev = {j['id']: j for j in json.load(open(p))['list']}
    lst = []
    for jid, name, grp in REG:
        if jid in EXCLUDED: continue  # privacy-link-b3 (Eng CEO ruling): never listed in the app's province picker
        e = {'id': jid, 'name': name, 'group': grp}
        if jid == 'AB': e['status'] = 'live'
        elif jid not in AWAITING and (jid in live or (jid in BUILDERS and prev.get(jid, {}).get('status') == 'live')):
            m = live.get(jid)
            if not m:
                pe = dict(prev[jid]); pe.pop('pending', None)
                lst.append(pe); continue
            e.update({'status': 'live', 'file': jid + '.json', 'effective': m['effective'], 'effectiveLabel': m['effectiveLabel'], 'counts': m['counts'],
                      'link': m['landing'], 'linkLabel': m['title']})
        elif jid in SOON: e.update(SOON[jid])
        else:
            t, u = PENDING[jid]
            e.update({'status': 'soon', 'message': 'Coming soon - being prepared', 'why': 'Parsing and spot-checking of the official schedule is in progress.', 'link': u, 'linkLabel': t})
        lst.append(e)
    json.dump({'built': datetime.datetime.now().astimezone().isoformat(timespec='seconds'), 'list': lst}, open(p, 'w'), indent=1, ensure_ascii=False)
    print('index', [(e['id'], e['status']) for e in lst])
