/**
 * Inline-reference detection used in bulletin text.
 *
 * Mirrors the server-side patterns in `lib/search/patterns.js`. The
 * classifyRef() function tightens those matches case-sensitively to
 * reject false positives like "TSI wird" or "BACKEN" that the global-i
 * combined regex would otherwise accept.
 */

const REF_DTC          = /\b[PBCU][0-9A-F]{4,7}\b/;
const REF_DOC          = /\b(?:TSI|OASIS(?:\s+BCM)?|GSB|SSM|FSA|TI|TSB|Aktion|Bulletin|Service[\s-]?Aktion|SA)\s+(?:Nr\.?\s*)?[A-Z0-9](?:[\w./-]*[\w/-])?/;
const REF_NUM_ATTACH   = /\b(?:Formular|Anhang|Anlage|Abbildung|Bild|Anzeige)\s+\d+(?:[.\-]\d+)?/;
const REF_SIEHE        = /\b(?:siehe|s\.|sh\.|vgl\.)\s+(?:Abbildung|Anhang|Anlage|Anzeige|Bild|Formular|original\s+Information(?:en)?)/;

/** Single combined regex used by LinkedText for the initial scan. */
export const REFERENCE_PATTERN = new RegExp(
  [REF_DTC.source, REF_DOC.source, REF_NUM_ATTACH.source, REF_SIEHE.source].join('|'),
  'gi',
);

/**
 * @typedef {Object} RefDtc        { kind: 'dtc', code: string }
 * @typedef {Object} RefDoc        { kind: 'doc', code: string, full: string, resolvedCode?: string }
 * @typedef {Object} RefAttachment { kind: 'attachment', number: string|null }
 * @typedef {Object} RefUnknown    { kind: 'unknown' }
 * @typedef {RefDtc|RefDoc|RefAttachment|RefUnknown} Ref
 */

/**
 * Classify a single regex match into its kind. Returns `{ kind: 'unknown' }`
 * for matches that look like real references but fail extra validation —
 * those should render as plain text.
 *
 * @param {string} ref
 * @returns {Ref}
 */
export function classifyRef(ref) {
  // DTC: must be uppercase P/B/C/U + 4-7 hex chars (digits or upper A-F).
  if (/^[PBCU][0-9A-F]{4,7}$/.test(ref)) {
    return { kind: 'dtc', code: ref };
  }

  // Doc: extracted code must contain a digit, otherwise it's almost
  // certainly a false positive like "TSI wird" / "Aktion ist".
  if (new RegExp('^' + REF_DOC.source + '$', 'i').test(ref)) {
    const code = ref.replace(/^\s*\S+(?:\s+BCM)?\s+(?:Nr\.?\s*)?/i, '').trim();
    if (/\d/.test(code)) return { kind: 'doc', code, full: ref };
  }

  // Numbered attachment (Formular 3, Anhang 2.1, …)
  if (new RegExp('^' + REF_NUM_ATTACH.source + '$', 'i').test(ref)) {
    const num = ref.match(/\d+(?:[.\-]\d+)?$/);
    return { kind: 'attachment', number: num ? num[0] : null };
  }

  // Generic "siehe …" attachment hint without a number.
  if (new RegExp('^' + REF_SIEHE.source, 'i').test(ref)) {
    return { kind: 'attachment', number: null };
  }

  return { kind: 'unknown' };
}
