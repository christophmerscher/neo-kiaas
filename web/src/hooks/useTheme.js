import { useCallback, useEffect, useState } from 'react';
import { STORAGE_KEYS } from '../constants';

/**
 * Manages the light/dark theme preference.
 *
 *  - Reads from localStorage first
 *  - Falls back to `prefers-color-scheme: dark`
 *  - Applies the choice to `<html data-theme="…">` so the CSS variables
 *    in styles.css switch palettes
 *  - Persists each change back to localStorage
 *
 * @returns {[ 'light' | 'dark', () => void ]}
 */
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.theme);
    if (saved === 'dark' || saved === 'light') return saved;
    return typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(STORAGE_KEYS.theme, theme);
  }, [theme]);

  const toggle = useCallback(
    () => setTheme(t => (t === 'dark' ? 'light' : 'dark')),
    [],
  );

  return [theme, toggle];
}
