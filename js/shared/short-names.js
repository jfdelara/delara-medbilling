// Curated short labels (2-3 words) for code rows, shared by Fee Desk and MedBilling Logs.
// Plain ES module, no dependencies. Keys: 'H:<fee code>' or 'I:<ICD-9 code>' (Alberta). Full descriptions stay in the data files.
// Medical wording to be reviewed by the owner.
export const SHORT_NAMES = Object.freeze({
  'H:80.19B': 'Myomectomy',
  'H:66.4A': 'Lysis of adhesions',
  'H:86.9C': 'Elective C-section',
  'H:03.03B': 'Prenatal visit',
  'H:03.04A': 'Comprehensive assessment',
  'H:03.08A': 'Comprehensive consultation',
  'H:13.99BA': 'Pap smear',
  'H:87.89B': 'Vaginal laceration repair',
  'I:218': 'Uterine leiomyoma',
  'I:568.0': 'Peritoneal adhesions',
  'I:669.7': 'Caesarean delivery',
  'I:642.4': 'Mild pre-eclampsia',
  'I:665.4': 'High vaginal laceration',
});
export default SHORT_NAMES;
