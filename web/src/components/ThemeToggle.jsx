/**
 * Sun/moon button that toggles the active theme.
 *
 * @param {{ theme: 'light' | 'dark', onToggle: () => void }} props
 */
export function ThemeToggle({ theme, onToggle }) {
  const isDark = theme === 'dark';
  return (
    <button
      className="theme-toggle"
      onClick={onToggle}
      title={isDark ? 'Hell-Modus' : 'Dunkel-Modus'}
      aria-label={isDark ? 'Hell-Modus aktivieren' : 'Dunkel-Modus aktivieren'}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="currentColor" d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0-5a1 1 0 0 1 1 1v2a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1Zm0 17a1 1 0 0 1 1 1v2a1 1 0 1 1-2 0v-2a1 1 0 0 1 1-1ZM4.22 4.22a1 1 0 0 1 1.42 0l1.41 1.41a1 1 0 0 1-1.41 1.42L4.22 5.64a1 1 0 0 1 0-1.42Zm12.73 12.73a1 1 0 0 1 1.42 0l1.41 1.41a1 1 0 0 1-1.41 1.42l-1.42-1.41a1 1 0 0 1 0-1.42ZM2 12a1 1 0 0 1 1-1h2a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1Zm17 0a1 1 0 0 1 1-1h2a1 1 0 1 1 0 2h-2a1 1 0 0 1-1-1ZM5.64 18.36a1 1 0 0 1 0-1.41l1.41-1.42a1 1 0 0 1 1.42 1.42l-1.42 1.41a1 1 0 0 1-1.41 0Zm12.72-12.72a1 1 0 0 1 0-1.42l1.41-1.41a1 1 0 1 1 1.42 1.42l-1.42 1.41a1 1 0 0 1-1.41 0Z"/>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="currentColor" d="M21.64 13.39A9 9 0 1 1 10.61 2.36 1 1 0 0 1 11.9 3.6 7 7 0 0 0 20.4 12.1a1 1 0 0 1 1.24 1.29Z"/>
    </svg>
  );
}
