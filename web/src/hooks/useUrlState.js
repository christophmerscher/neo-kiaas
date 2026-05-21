import { useEffect, useMemo, useRef, useState } from 'react';
import { readUrl, writeUrl, navKeyOf } from '../utils/url';

/**
 * Bidirectional binding between the navigation-relevant React state and
 * the browser URL.
 *
 *  - Initial state is seeded from the URL on mount.
 *  - Whenever any tracked piece of state changes, the URL is rewritten.
 *    Major transitions (mode / selected / cat / page changes) use
 *    pushState so the back button restores the previous view. Search
 *    typing replaces the URL in place so we don't pollute history per
 *    keystroke.
 *  - `popstate` (browser back/forward) re-reads the URL and applies it
 *    via the same setter API used by the rest of the app.
 *
 * The state object is intentionally flat — easy to spread when needed.
 *
 * @returns {{
 *   q:string, fz:string, scode:string, keyword:string,
 *   yearFrom:string, yearTo:string,
 *   selected:string|null, page:string, cat:string,
 *   setQ:(v:string)=>void, setFz:(v:string)=>void, setScode:(v:string)=>void,
 *   setKeyword:(v:string)=>void, setYearFrom:(v:string)=>void,
 *   setYearTo:(v:string)=>void,
 *   setSelected:(v:string|null)=>void, setPage:(v:string)=>void,
 *   setCat:(v:string)=>void,
 *   resetAll:()=>void, goBack:()=>void,
 * }}
 */
export function useUrlState() {
  const initial = useMemo(() => readUrl(), []);

  const [q, setQ]               = useState(initial.q);
  const [fz, setFz]             = useState(initial.fz);
  const [scode, setScode]       = useState(initial.scode);
  const [keyword, setKeyword]   = useState(initial.keyword);
  const [yearFrom, setYearFrom] = useState(initial.yearFrom);
  const [yearTo, setYearTo]     = useState(initial.yearTo);
  const [selected, setSelected] = useState(initial.selected);
  const [page, setPage]         = useState(initial.page);
  const [cat, setCat]           = useState(initial.cat);

  const current = { q, fz, scode, keyword, yearFrom, yearTo, selected, page, cat };

  // History bookkeeping — push when the navigation key changes (real mode
  // transitions), replace otherwise.
  const prevNavKeyRef = useRef(navKeyOf(current));
  // Set when state is being applied from a popstate event, so the sync
  // effect doesn't fight the browser by re-pushing.
  const skipNextSyncRef = useRef(false);

  useEffect(() => {
    if (skipNextSyncRef.current) {
      skipNextSyncRef.current = false;
      prevNavKeyRef.current = navKeyOf(current);
      return;
    }
    const url = writeUrl(current);
    const newKey = navKeyOf(current);
    if (newKey !== prevNavKeyRef.current) {
      window.history.pushState({}, '', url);
      prevNavKeyRef.current = newKey;
    } else {
      window.history.replaceState({}, '', url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, fz, scode, keyword, yearFrom, yearTo, selected, page, cat]);

  useEffect(() => {
    const onPop = () => {
      const s = readUrl();
      skipNextSyncRef.current = true;
      setQ(s.q);
      setFz(s.fz);
      setScode(s.scode);
      setKeyword(s.keyword);
      setYearFrom(s.yearFrom);
      setYearTo(s.yearTo);
      setSelected(s.selected);
      setPage(s.page);
      setCat(s.cat);
      prevNavKeyRef.current = navKeyOf(s);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /** Clear every search/filter/page state and return to landing. */
  function resetAll() {
    setQ(''); setFz(''); setScode(''); setKeyword('');
    setYearFrom(''); setYearTo('');
    setSelected(null); setPage(''); setCat('');
  }

  /** Prefer browser history (restores prior state); otherwise fall back to a full reset. */
  function goBack() {
    if (window.history.length > 1) window.history.back();
    else resetAll();
  }

  return {
    q, fz, scode, keyword, yearFrom, yearTo, selected, page, cat,
    setQ, setFz, setScode, setKeyword, setYearFrom, setYearTo,
    setSelected, setPage, setCat,
    resetAll, goBack,
  };
}
