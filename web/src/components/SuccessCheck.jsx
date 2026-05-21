/**
 * Animated success indicator — a green circle that draws itself in, then a
 * checkmark strokes over it. Pure SVG + CSS keyframes; no JS animation.
 *
 * Sized via the `size` prop (px). Color follows `currentColor` so callers
 * can theme it by setting `color` on the parent (defaults to a soft green
 * via the CSS variables in styles.css).
 *
 * Used by {@link LoadingPage} to signal "data load finished" before the
 * main UI takes over.
 *
 * @param {{ size?: number }} props
 */
export function SuccessCheck({ size = 72 }) {
  return (
    <svg
      className="success-check"
      viewBox="0 0 80 80"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <circle className="success-check-circle" cx="40" cy="40" r="36" />
      <path
        className="success-check-mark"
        d="M24 41 L36 53 L58 28"
      />
    </svg>
  );
}
