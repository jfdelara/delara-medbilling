/* MedBilling Fee Desk - local BM25 + fuzzy + synonym search. Runs entirely in the browser; no network. */
(function (global) {
  'use strict';
  const STOP = new Set('a an and or the of for to in on at by with without from is are be as per any other than this that into its it within each all not may only same when which who over under after before more less than s e g eg etc nec'.split(' '));
  // query-side synonym expansion (words only; never codes)
  const SYN = {
    iud: ['intrauterine', 'contraceptive', 'device'], iucd: ['intrauterine', 'contraceptive', 'device'],
    mirena: ['intrauterine', 'contraceptive', 'device'], coil: ['intrauterine', 'contraceptive', 'device'],
    csection: ['cesarean'], 'c-section': ['cesarean'], cs: ['cesarean'], lscs: ['cesarean'], caesarean: ['cesarean'], section: [],
    consult: ['consultation'], consults: ['consultation'], colpo: ['colposcopy'], leep: ['loop', 'electrical', 'excision'], lletz: ['loop', 'electrical', 'excision'],
    dnc: ['dilation', 'curettage'], 'd&c': ['dilation', 'curettage'], dc: ['dilation', 'curettage'], hsc: [],
    tah: ['total', 'abdominal', 'hysterectomy'], tlh: ['laparoscopic', 'hysterectomy'], tvh: ['vaginal', 'hysterectomy'],
    bso: ['salpingo', 'oophorectomy'], uso: ['salpingo', 'oophorectomy'], pap: ['papanicolaou', 'cytology', 'smear'],
    us: ['ultrasound'], 'u/s': ['ultrasound'], ultrasound: ['ultrasound', 'sonography'], nst: ['non', 'stress', 'test'],
    svd: ['vaginal', 'delivery'], nvd: ['vaginal', 'delivery'], vbac: ['vaginal', 'delivery', 'previous', 'cesarean'],
    miscarriage: ['abortion', 'spontaneous'], sab: ['abortion', 'spontaneous'], top: ['termination', 'pregnancy'],
    antenatal: ['prenatal'], ob: ['obstetrical'], obstetric: ['obstetrical'], gyne: ['gynecological'], gyn: ['gynecological', 'gynecology'],
    postpartum: ['post', 'partum'], pph: ['post', 'partum', 'hemorrhage'], bleeding: ['hemorrhage', 'bleeding'],
    callback: ['callback', 'call'], 'call-back': ['callback'], er: ['emergency'], ed: ['emergency'],
    hospital: ['hospital', 'inpatient', 'out'], inpatient: ['inpatient', 'hospital'], clinic: ['office'], office: ['office'],
    min: ['minutes'], mins: ['minutes'], minute: ['minutes'], hr: ['hour'], hrs: ['hours'],
    prolapse: ['prolapse', 'pessary'], lap: ['laparoscopy', 'laparoscopic'], scope: ['endoscopy'], hysteroscopy: ['hysteroscopy', 'hysteroscopic'],
    tubal: ['tubal', 'sterilization'], ligation: ['sterilization', 'ligation'], cerclage: ['cerclage', 'suturing', 'cervix'],
    episiotomy: ['episiotomy', 'laceration'], tear: ['laceration'], forceps: ['forceps', 'assisted'], vacuum: ['vacuum', 'assisted'],
    ectopic: ['ectopic'], amnio: ['amniocentesis'], cvs: ['chorionic', 'villus', 'sampling'], implant: ['implant', 'implantation'],
    nexplanon: ['subdermal', 'contraceptive', 'implant'], biopsy: ['biopsy'], emb: ['endometrial', 'biopsy'],
    removal: ['removal', 'remove'], reinsertion: ['reinsertion', 'insertion'], replace: ['replacement', 'reinsertion']
  };
  function fold(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/ae/g, 'e').replace(/oe/g, 'e');
  }
  function stem(w) {
    if (w.length <= 4 || /^\d/.test(w)) return w;
    const rules = [['ational', 'ate'], ['ations', ''], ['ation', ''], ['ments', ''], ['ment', ''], ['ings', ''], ['ing', ''], ['ions', ''], ['ion', ''],
      ['ies', 'y'], ['ied', 'y'], ['ically', 'ic'], ['ical', 'ic'], ['ally', 'al'], ['ly', ''], ['es', ''], ['ed', ''], ['al', ''], ['ic', ''], ['y', ''], ['s', '']];
    for (const [suf, rep] of rules) {
      if (w.endsWith(suf) && w.length - suf.length >= 4) return w.slice(0, w.length - suf.length) + rep;
    }
    return w;
  }
  function tokens(s) {
    const out = [];
    for (const raw of fold(s).split(/[^a-z0-9&/+-]+/)) {
      for (const t of raw.split(/[/+-]/)) {
        if (!t || STOP.has(t)) continue;
        if (t.length < 2 && !/^\d$/.test(t)) continue;
        out.push(stem(t));
      }
    }
    return out;
  }
  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]; let best = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  /** Build an index. docs: [{id, fields:{name:text}}], weights: {name:weight} */
  function Index(docs, weights, opts) {
    opts = opts || {};
    this.k1 = opts.k1 || 1.2; this.b = opts.b || 0.6;
    this.docs = docs; this.tf = []; this.len = []; this.df = new Map(); this.raw = [];
    let total = 0;
    for (const d of docs) {
      const tf = new Map(); let L = 0;
      for (const [f, w] of Object.entries(weights)) {
        const ts = tokens(d.fields[f] || '');
        for (const t of ts) { tf.set(t, (tf.get(t) || 0) + w); L += w; }
      }
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
      this.tf.push(tf); this.len.push(L); total += L;
      this.raw.push(fold(d.fields[opts.phraseField || Object.keys(weights)[0]] || ''));
    }
    this.avg = total / Math.max(1, docs.length);
    this.vocab = Array.from(this.df.keys());
  }
  Index.prototype.idf = function (t) {
    const n = this.df.get(t) || 0, N = this.docs.length;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  };
  /** expand query -> [{t, w}] with synonyms and fuzzy corrections */
  Index.prototype.expand = function (q) {
    // returns [{t, w, g}] where g = index of the typed word the term came from (synonyms share a group)
    const out = []; const seen = new Map();
    const add = (t, w, g) => { if (!t) return; const k = t + '|' + g; if (seen.has(k)) { const o = seen.get(k); o.w = Math.max(o.w, w); return; } const o = { t, w, g }; seen.set(k, o); out.push(o); };
    const words = fold(q).split(/[^a-z0-9&/+-]+/).filter(Boolean);
    let g = 0;
    for (const w of words) {
      const syn = SYN[w];
      const toks = tokens(w);
      if (!toks.length && !(syn && syn.length)) continue;
      if (syn) syn.forEach(s => tokens(s).forEach(t => add(t, 0.85, g)));
      for (const t of toks) {
        if (this.df.has(t)) { add(t, 1, g); continue; }
        if (syn && syn.length) continue;
        if (/^\d+$/.test(t)) continue;
        const max = t.length >= 7 ? 2 : (t.length >= 4 ? 1 : 0);
        if (!max) continue;
        const best = [];
        for (const v of this.vocab) {
          if (v[0] !== t[0] && max < 2) continue;
          const d = lev(t, v, max);
          if (d <= max) best.push([d, v]);
          else if (t.length >= 5 && v.startsWith(t)) best.push([1, v]);
        }
        best.sort((a, b) => a[0] - b[0] || (this.df.get(b[1]) - this.df.get(a[1])));
        best.slice(0, 3).forEach(([d, v]) => add(v, d === 0 ? 1 : 0.7, g));
      }
      g++;
    }
    out.groups = g;
    return out;
  };
  Index.prototype.search = function (q, opts) {
    opts = opts || {};
    const terms = this.expand(q);
    if (!terms.length) return { terms, hits: [] };
    const qwords = tokens(q);
    const scores = [];
    for (let i = 0; i < this.docs.length; i++) {
      if (opts.filter && !opts.filter(this.docs[i])) continue;
      const tf = this.tf[i]; const best = new Map(); let extra = 0;
      for (const { t, w, g } of terms) {
        const f = tf.get(t); if (!f) continue;
        const v = w * this.idf(t) * (f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + this.b * this.len[i] / this.avg));
        const prev = best.get(g) || 0;
        if (v > prev) { extra += prev * 0.25; best.set(g, v); } else extra += v * 0.25;
      }
      if (!best.size) continue;
      let s = extra; for (const v of best.values()) s += v;
      // coverage: share of typed words (concept groups) matched
      const cov = best.size / Math.max(1, terms.groups);
      s *= 0.35 + 0.65 * cov * cov;
      // phrase bonus: adjacent query words appear together in primary field
      const raw = this.raw[i];
      for (let k = 0; k + 1 < qwords.length; k++) {
        const re = new RegExp('\\b' + qwords[k] + '\\w*\\W+(?:\\w+\\W+)?' + qwords[k + 1]);
        if (re.test(raw)) s *= 1.15;
      }
      if (opts.boost) s *= opts.boost(this.docs[i]);
      scores.push([s, i]);
    }
    scores.sort((a, b) => b[0] - a[0]);
    return { terms, hits: scores.slice(0, opts.limit || 10).map(([s, i]) => ({ score: s, doc: this.docs[i] })) };
  };
  global.MBSearch = { Index, tokens, fold, stem, SYN };
})(window);
