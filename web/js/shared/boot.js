// Exposes the shared ES modules to the classic app.js script.
import * as F from './rowfmt.js';
import { SHORT_NAMES } from './short-names.js';
import * as FAV from './favrow.js';
import * as SUITE from './suite.js';
window.MBRowFmt = { ...F, SHORT_NAMES };
window.MBFav = FAV;      // Suite parity v1: the shared favourites component (same file as MedBilling Logs)
window.MBSuite = SUITE;  // shared toast, tab bar height, wording
SUITE.syncBar(document.getElementById('tabs'));
document.dispatchEvent(new Event('mbrowfmt'));
