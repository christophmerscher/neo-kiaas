/** Build-time constants for the neo-KIAS frontend. */

/** Current application version. Bumped manually before each release tag. */
export const VERSION = '1.0.0-ALPHA';

/** localStorage keys we own — listed here so they're easy to grep. */
export const STORAGE_KEYS = Object.freeze({
  view: 'kias.view',           // 'google' | 'classic'
  theme: 'kias.theme',         // 'light' | 'dark'
  scodeView: 'kias.scodeView', // 'cards' | 'table'
  vehicleView: 'kias.vehicleView', // 'cards' | 'table'
});
