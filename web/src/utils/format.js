/**
 * Display-formatting helpers shared by multiple components.
 *
 * Keep these pure (no React imports) — they're easy to unit-test and any
 * caller can import them without dragging in the rendering layer.
 */

/**
 * Format a date or datetime string into `dd.MM.YYYY` (date only) or
 * `dd.MM.YYYY hh:mm` (24h) depending on whether the input carries a time
 * component. Returns inputs that don't look like a date unchanged so this
 * is safe to call on free-text fields like `VON`/`BIS`.
 *
 * @param {string|Date|null|undefined} input
 * @returns {string}
 */
export function fmtDateTime(input) {
  if (input == null || input === '') return '';
  const pad2 = (n) => String(n).padStart(2, '0');

  if (typeof input === 'string') {
    const dateOnly = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) return `${dateOnly[3]}.${dateOnly[2]}.${dateOnly[1]}`;

    const dateTime = input.match(/^(\d{4})-(\d{2})-(\d{2})[T ]\d{2}:\d{2}/);
    if (dateTime) {
      const d = new Date(input);
      if (!isNaN(d.getTime())) {
        return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ` +
               `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
      }
    }
    return input;
  }

  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return String(input);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ` +
         `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
