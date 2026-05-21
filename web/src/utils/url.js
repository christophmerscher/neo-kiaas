/**
 * URL <-> application-state codec.
 *
 * Everything that should survive a page reload (search, current bulletin,
 * page mode) is encoded as URL query parameters. Keeping the read/write
 * functions next to each other in a single module makes the encoding
 * easy to evolve.
 */

/**
 * @typedef {Object} UrlState
 * @property {string}      q         Search query
 * @property {string}      fz        Vehicle filter
 * @property {string}      scode     Symptom-code filter
 * @property {string}      keyword   Keyword filter
 * @property {string}      yearFrom  Lower year bound
 * @property {string}      yearTo    Upper year bound
 * @property {string|null} selected  A_CODE currently being viewed (detail)
 * @property {string}      page      Top-level page mode ('' | 'scodes' | 'vehicles')
 * @property {string}      cat       Category drilled into on a list page
 */

/** Parse the current window URL into a UrlState. */
export function readUrl() {
  const p = new URLSearchParams(window.location.search);
  return {
    q:        p.get('q')    || '',
    fz:       p.get('fz')   || '',
    scode:    p.get('scode')|| '',
    keyword:  p.get('kw')   || '',
    yearFrom: p.get('from') || '',
    yearTo:   p.get('to')   || '',
    selected: p.get('code') || null,
    page:     p.get('page') || '',
    cat:      p.get('cat')  || '',
  };
}

/**
 * Render a UrlState into a URL string. Keeps the current pathname so it
 * works behind reverse proxies that mount us under e.g. `/neo-kias`.
 *
 * @param {UrlState} s
 * @returns {string}
 */
export function writeUrl(s) {
  const p = new URLSearchParams();
  if (s.q)        p.set('q', s.q);
  if (s.fz)       p.set('fz', s.fz);
  if (s.scode)    p.set('scode', s.scode);
  if (s.keyword)  p.set('kw', s.keyword);
  if (s.yearFrom) p.set('from', s.yearFrom);
  if (s.yearTo)   p.set('to', s.yearTo);
  if (s.selected) p.set('code', s.selected);
  if (s.page)     p.set('page', s.page);
  if (s.cat)      p.set('cat', s.cat);
  const qs = p.toString();
  return qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
}

/**
 * Categorise a UrlState into a coarse navigation mode. Used by the
 * history-sync logic to decide when to pushState vs. replaceState and
 * by App.jsx to pick which page to render.
 *
 * @param {UrlState} s
 * @returns {'scodes-cat'|'scodes'|'vehicles-cat'|'vehicles'|'detail'|'results'|'landing'}
 */
export function modeOf(s) {
  if (s.page === 'scodes' && s.cat)   return 'scodes-cat';
  if (s.page === 'scodes')            return 'scodes';
  if (s.page === 'vehicles' && s.cat) return 'vehicles-cat';
  if (s.page === 'vehicles')          return 'vehicles';
  if (s.selected)                     return 'detail';
  if (s.q || s.fz || s.scode || s.keyword || s.yearFrom || s.yearTo) return 'results';
  return 'landing';
}

/**
 * Stable signature used by the history-sync effect to decide whether the
 * current state change deserves a new entry (mode/selected/cat/page
 * changed) or is just a search-input update inside the same mode.
 *
 * @param {UrlState} s
 * @returns {string}
 */
export function navKeyOf(s) {
  return `${modeOf(s)}|${s.selected || ''}|${s.cat || ''}|${s.page || ''}`;
}
