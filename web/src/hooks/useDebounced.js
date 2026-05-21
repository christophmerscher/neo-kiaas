import { useEffect, useState } from 'react';

/**
 * Returns the latest `value`, but only after `delay` ms of no further
 * changes. Used to throttle search fetches while the user types.
 *
 * @template T
 * @param {T} value
 * @param {number} [delay=300]
 * @returns {T}
 */
export function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
