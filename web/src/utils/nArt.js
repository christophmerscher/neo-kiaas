/**
 * Lookup helpers for the single-letter Nachrichtenart codes (N_ART column).
 *
 * The codes are KIAS conventions (Aktion, OASIS, TSI, …). We keep a short
 * label for badges and a long one for tooltips / detail tables.
 */

/** Short labels used in compact badges. */
const SHORT = Object.freeze({
  A: 'Aktion',
  G: 'Gewährleistung',
  I: 'Information',
  L: 'Lieferinfo',
  M: 'Meldung',
  O: 'OASIS',
  S: 'Service',
  T: 'TSI',
});

/** Long labels used in tooltips and Kenndaten tables. */
const LONG = Object.freeze({
  A: 'Aktion / Servicemaßnahme',
  G: 'Gewährleistungsinformation',
  I: 'Information',
  L: 'Lieferanten-Information',
  M: 'Meldung',
  O: 'OASIS-Information',
  S: 'Service-Aktion',
  T: 'Technische Service-Information (TSI)',
});

/** Normalise a code to its short label. Unknown codes are returned verbatim. */
export function nArtLabel(code) {
  if (!code) return '';
  const k = String(code).trim().toUpperCase();
  return SHORT[k] || code;
}

/** Tooltip-friendly long form: "<long-name> (<code>)". */
export function nArtTitle(code) {
  if (!code) return '';
  const k = String(code).trim().toUpperCase();
  const long = LONG[k];
  return long ? `${long} (${k})` : String(code);
}

/** Used in Kenndaten rows: "<long-name> (<code>)" or empty when no code. */
export function nArtKenndaten(code) {
  if (!code) return '';
  const k = String(code).trim().toUpperCase();
  return `${LONG[k] || nArtLabel(code)} (${code})`;
}
