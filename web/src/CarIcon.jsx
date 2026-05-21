// Side-view silhouettes for the Ford body types in our dataset.
// All SVGs are single-color (currentColor), transparent background, so they
// blend cleanly with any card / theme. Drop one in by importing
//   import CarIcon, { carTypeFor } from './CarIcon';
// and rendering <CarIcon type={carTypeFor(model)} />.

const VIEWBOX = '0 0 120 38';

// Each body is a single closed path. The path is drawn clockwise from the
// front-lower-left corner, around the silhouette, and back. The viewBox
// includes a bit of space at the bottom so the wheels (drawn as circles on
// top) protrude below the body.
const BODIES = {
  // Compact 3-door hatchback — Fiesta, Focus, Ka, Escort
  hatchback:
    'M 4 28 L 4 24 Q 6 18 14 18 L 22 18 Q 26 11 32 10 L 68 10 Q 76 11 80 18 L 102 18 Q 108 18 110 24 L 110 28 Z',
  // 3-box sedan — Mondeo, Scorpio
  sedan:
    'M 4 28 L 4 24 Q 6 20 14 20 L 24 20 Q 28 14 36 12 L 70 12 Q 78 14 82 20 L 104 20 Q 110 20 110 24 L 110 28 Z',
  // SUV / crossover — Puma, Kuga, Explorer, Mustang Mach-E
  suv:
    'M 4 28 L 4 22 Q 6 16 14 16 L 22 16 Q 26 8 34 6 L 72 6 Q 80 8 84 16 L 104 16 Q 110 16 110 22 L 110 28 Z',
  // People-carrier / MPV — Galaxy, S-Max, C-Max, Windstar
  mpv:
    'M 4 28 L 4 22 Q 6 14 14 14 L 22 14 Q 26 6 36 4 L 68 4 Q 78 6 82 14 L 104 14 Q 110 14 110 22 L 110 28 Z',
  // Large van — Transit, Transit Custom, Transit BEV
  van:
    'M 4 28 L 4 18 Q 4 4 14 4 L 100 4 Q 110 4 110 14 L 110 28 Z',
  // Compact van — Transit Connect, Transit Courier
  'small-van':
    'M 4 28 L 4 20 Q 6 12 14 12 L 22 12 Q 26 6 34 4 L 96 4 Q 104 4 104 14 L 104 28 Z',
  // Pickup truck — Ranger, Maverick (two-box: cab + bed)
  pickup:
    'M 4 28 L 4 22 Q 6 18 14 18 L 22 18 Q 26 10 34 8 L 58 8 L 58 18 L 102 18 Q 110 18 110 22 L 110 28 Z',
  // Sporty coupe — Mustang, Capri, Cougar, Probe
  coupe:
    'M 4 28 L 4 24 Q 6 20 14 20 L 22 20 L 50 10 L 72 10 Q 82 12 86 20 L 104 20 Q 110 20 110 24 L 110 28 Z',
  // Low slung sports — Ford GT
  sports:
    'M 4 28 L 4 26 Q 8 22 14 22 L 30 18 L 50 12 L 70 12 Q 82 14 88 22 L 102 22 Q 110 22 110 26 L 110 28 Z',
};

// Slug a model name to the filename convention used for car photos.
//   "Mondeo"           → "mondeo"
//   "Transit Connect"  → "transit-connect"
//   "Mustang Mach-E"   → "mustang-mach-e"
//   "C-Max"            → "c-max"
//   "Ka Plus"          → "ka-plus"
export function modelSlug(model) {
  return String(model || '')
    .toLowerCase()
    .trim()
    .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Renders, in order of preference:
//   1. <img src> if a `src` was provided (user supplied a real photo)
//   2. SVG silhouette of the given body type as a fallback
export default function CarIcon({ type = 'sedan', src, alt, className }) {
  if (src) {
    return (
      <img
        src={src}
        alt={alt || ''}
        className={(className || '') + ' car-photo'}
        loading="lazy"
        draggable="false"
      />
    );
  }
  const body = BODIES[type] || BODIES.sedan;
  return (
    <svg
      viewBox={VIEWBOX}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      fill="currentColor"
    >
      <path d={body} />
      {/* Wheels — filled discs, drawn after the body so they sit on top.
          The transparent background of the SVG means cards see through the
          gaps; no white wash. */}
      <circle cx="24" cy="32" r="5" />
      <circle cx="92" cy="32" r="5" />
    </svg>
  );
}

// Map a normalized model line (e.g. "fiesta", "transit connect", "mustang
// mach-e") to one of the body-type keys above. Returns 'sedan' as a safe
// fallback for unknown names.
export function carTypeFor(model) {
  const k = String(model || '').toLowerCase().trim();

  // Specific cases first so they don't collide with broader prefix rules
  if (/mach-?e/.test(k))           return 'suv';      // Mustang Mach-E
  if (k === 'focus electric')      return 'hatchback';
  if (k === 'ford gt')             return 'sports';
  if (k === 'us-fahrzeuge')        return 'sedan';

  // Transits: split between large van and compact van
  if (/^transit\s+(?:connect|conn|courier)/.test(k)) return 'small-van';
  if (/^transit/.test(k))          return 'van';

  // Body-type by model line
  if (/^(?:capri|cougar|probe|mustang)/.test(k))        return 'coupe';
  if (/^(?:puma|ecosport|kuga|explorer|edge)/.test(k))  return 'suv';
  if (/^(?:maverick|ranger)/.test(k))                   return 'pickup';
  if (/^(?:b-max|c-max|s-max|galaxy|fusion|windstar)/.test(k)) return 'mpv';
  if (/^(?:fiesta|focus|ka|escort)/.test(k))            return 'hatchback';
  if (/^(?:mondeo|scorpio|orion)/.test(k))              return 'sedan';

  return 'sedan';
}
