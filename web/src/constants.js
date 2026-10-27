/** Build-time constants for the neo-KIAS frontend. */

/**
 * Current application version. Comes from the package.json in the repository
 * root, injected by vite.config.js, so it cannot drift from the API any more.
 * The fallback only applies outside a Vite build.
 */
export const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';

/** localStorage keys we own — listed here so they're easy to grep. */
export const STORAGE_KEYS = Object.freeze({
  view: 'kias.view',           // 'google' | 'classic'
  theme: 'kias.theme',         // 'light' | 'dark'
  scodeView: 'kias.scodeView', // 'cards' | 'table'
  vehicleView: 'kias.vehicleView', // 'cards' | 'table'
});
