/**
 * Bulletin-detail derivations.
 */

/**
 * Pick the best title for a bulletin's detail view.
 *
 * K_BEZEICH is a 90-byte fixed-width column so long titles get truncated
 * mid-word. BESCHREIB's first paragraph is the authoritative full headline
 * — we use it when present, capped at 360 chars to stay readable.
 *
 * @param {object|null|undefined} detail
 * @returns {string}
 */
export function bulletinTitle(detail) {
  if (detail && detail.BESCHREIB) {
    const firstPara = detail.BESCHREIB.split(/\r?\n\s*\r?\n/)[0].trim();
    if (firstPara) {
      return firstPara.length > 360
        ? firstPara.slice(0, 357).trimEnd() + '…'
        : firstPara;
    }
  }
  return ((detail && detail.K_BEZEICH) || '').trim();
}
