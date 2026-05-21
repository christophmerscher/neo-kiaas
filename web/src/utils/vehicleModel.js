/**
 * Helpers for grouping vehicles by their Ford model line.
 *
 * KIAS data carries vehicle names in many styles ("MONDEO 2015",
 * "Mondeo ab1997", "Fiesta 89", "Transit 2012 Custom", …). These helpers
 * strip year/build-period markers, MCA annotations and slash variants so
 * every generation of the same nameplate ends up in one group.
 */

/**
 * Extract the model line from a vehicle row.
 *
 * @param {{ INTBEZEICH?: string, BEZEICH?: string }|null|undefined} v
 * @returns {string}
 */
export function vehicleModel(v) {
  let name = String((v && (v.INTBEZEICH || v.BEZEICH)) || '').trim();
  // Drop parentheticals
  name = name.replace(/\s*\([^)]*\)\s*/g, ' ');
  // Drop "/Bxxxx ab YYYY" suffix
  name = name.replace(/\s*\/B\d+.*$/i, '');
  // Drop "ab YYYY[.M]" anywhere
  name = name.replace(/\s*\bab\s*\d{2,4}(?:\.\d+)?/gi, ' ');
  // Drop standalone year/version numbers
  name = name.replace(/\s+\d{4}(?:\.\d+)?(?!\d)/g, ' ');
  name = name.replace(/\s+\d{2}(?:\.\d+)?(?!\d)/g, ' ');
  // Drop "MCA" / "Mca" model-change annotations
  name = name.replace(/\s+mca\b/gi, '');
  // Drop trailing "/altname"
  name = name.replace(/\s*\/\s*[^\/]+$/, '');
  // Drop trailing dots/slashes
  name = name.replace(/[.\/\s]+$/, '');
  // Collapse whitespace
  name = name.replace(/\s+/g, ' ').trim();
  return name || '—';
}

/**
 * Title-case for the German diacritic set. Used for display so all-caps
 * source data ("MONDEO") looks consistent with title-case data ("Mondeo").
 *
 * @param {string} s
 * @returns {string}
 */
export function titleCaseModel(s) {
  return String(s || '').toLowerCase().replace(
    /(^|[^A-Za-zÄÖÜäöüß])([a-zäöüß])/g,
    (_, p, c) => p + c.toUpperCase(),
  );
}
