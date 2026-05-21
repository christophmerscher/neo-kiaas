/**
 * Slim horizontal progress bar with an optional two-line caption below.
 *
 * Values are clamped to [0, max], so out-of-range inputs are safe.
 *
 * @param {{
 *   value: number,
 *   max?: number,
 *   label?: string,        // left-aligned caption (e.g. current file name)
 *   sublabel?: string,     // right-aligned counter (e.g. "5 / 18")
 *   tone?: 'progress' | 'success',  // changes the fill gradient
 * }} props
 */
export function ProgressBar({ value, max = 1, label, sublabel, tone = 'progress' }) {
  const pct = max > 0
    ? Math.min(100, Math.max(0, (value / max) * 100))
    : 0;
  return (
    <div className="progress-bar">
      <div className="progress-bar-track">
        <div
          className={'progress-bar-fill progress-bar-fill-' + tone}
          style={{ width: pct + '%' }}
        />
      </div>
      {(label || sublabel) && (
        <div className="progress-bar-meta">
          <span className="progress-bar-label" title={label || ''}>{label || ''}</span>
          {sublabel && <span className="progress-bar-sublabel">{sublabel}</span>}
        </div>
      )}
    </div>
  );
}
