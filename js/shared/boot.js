// Exposes the shared ES modules to the classic app.js script.
import * as F from './rowfmt.js';
import { SHORT_NAMES } from './short-names.js';
window.MBRowFmt = { ...F, SHORT_NAMES };
document.dispatchEvent(new Event('mbrowfmt'));
