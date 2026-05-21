import { VERSION } from '../constants';

/**
 * Small monospace version pill rendered next to the logo / inside
 * headings. The `small` variant is half-size for tight spots.
 *
 * @param {{ small?: boolean, label?: string }} props
 */
export function VersionBadge({ small = false, label }) {
  return (
    <span className={'version-badge' + (small ? ' small' : '')}>
      {label ? `${label}: ${VERSION}` : VERSION}
    </span>
  );
}
