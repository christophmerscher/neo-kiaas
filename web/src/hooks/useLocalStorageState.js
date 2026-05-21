import { useEffect, useState } from 'react';

/**
 * useState wrapper that persists the value to localStorage. Reads the
 * value once on mount; writes it every time it changes.
 *
 * @template T
 * @param {string} key
 * @param {T} initial
 * @returns {[T, (v:T)=>void]}
 */
export function useLocalStorageState(key, initial) {
  const [value, setValue] = useState(() => {
    const stored = localStorage.getItem(key);
    return stored == null ? initial : stored;
  });
  useEffect(() => {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  }, [key, value]);
  return [value, setValue];
}
