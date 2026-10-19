/**
 * Lookup helpers for the single-letter Nachrichtenart codes (N_ART column).
 *
 * Die Buchstaben sind keine Konvention, die man sich herleiten muss: KIAS
 * führt sie in `System\Fabrikate.DBF` je Fabrikat mit Klartext mit. Für
 * Ford stehen dort TYPE1..TYPE8 und die zugehörigen TYPETXT-Spalten, und
 * genau daraus stammen die Bezeichnungen hier. Drei davon waren vorher
 * geraten und falsch (L, M, G), deshalb der Hinweis: wer sie ändern will,
 * sieht bitte erst in dieser Tabelle nach.
 *
 * Gegenprobe an den Daten:
 *   L → `SP990603` „Liste nicht kulanzfähiger Bauteile"  (Schwerpunktliste)
 *   M → `A0001/05` „Fz mit Xenon-Scheinwerfer …"          (Aktuelles zu Modellen)
 *   G → `18-7002`  „Einführung des vollständig neuen Ford GT"
 *
 * `H` („Frei") ist im Fabrikat abgeschaltet und kommt im Bestand nicht
 * vor; unbekannte Buchstaben werden unverändert durchgereicht.
 */

/** Short labels used in compact badges. */
const SHORT = Object.freeze({
  A: 'Aktion',
  G: 'Service-Info',
  L: 'Schwerpunkt',
  M: 'Aktuelles',
  O: 'OASIS',
  S: 'SR',
  T: 'TSI',
});

/** Long labels used in tooltips and Kenndaten tables. */
const LONG = Object.freeze({
  // A bleibt „Aktion / Servicemaßnahme" und wird nicht zu
  // „Rückruf-Aktion": unter diesem Buchstaben stehen laut Hilfe auch
  // Service-Programme und dringende Arbeiten vor der Auslieferung.
  A: 'Aktion / Servicemaßnahme',
  G: 'Allgemeine Service-Information',
  L: 'Schwerpunktliste',
  M: 'Aktuelles zu Modellen',
  O: 'OASIS-Information',
  S: 'Service-Rundschreiben (SR)',
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
