import { VERSION } from '../constants';
import { SuccessCheck } from '../components/SuccessCheck';
import { ProgressBar } from '../components/ProgressBar';

/**
 * Splash screen shown while the backend reads DBF data on first boot.
 *
 * Three visual phases driven by the props:
 *
 *  - **connecting** (no status object yet) — server hasn't answered
 *    `/api/status` once. Spinner + "Warte auf Server…".
 *  - **loading** (status.loaded === false) — server is up and reporting
 *    progress. Spinner + progress bar + per-file label.
 *  - **complete** (status.loaded === true) — load is done. Spinner is
 *    replaced by the {@link SuccessCheck} animation, the bar finishes
 *    at 100%, and the headline changes to "Bereit!". The parent
 *    component (App) keeps this phase visible briefly so the check
 *    animation can play before the main UI takes over.
 *
 * @param {{
 *   progress: { stage: string, name: string, current: number, total: number, elapsedMs: number } | null | undefined,
 *   loaded:   boolean,
 * }} props
 */
export function LoadingPage({ progress, loaded }) {
  const phase = loaded
    ? 'complete'
    : progress ? 'loading' : 'connecting';

  const value = phase === 'complete'
    ? 1
    : progress && progress.total > 0
      ? progress.current / progress.total
      : 0;

  const headline = phase === 'complete'
    ? 'Bereit!'
    : `${stageLabel(progress?.stage)}…`;

  const elapsedSeconds = progress?.elapsedMs ? Math.floor(progress.elapsedMs / 1000) : 0;

  return (
    <div className={'loading-page loading-page-' + phase}>
      <div className="loading-inner">
        <div className="landing-logo">
          <span className="logo-accent">neo-KIAS</span>
        </div>

        <div className="loading-visual">
          {phase === 'complete'
            ? <SuccessCheck />
            : <div className="loading-spinner" aria-hidden="true" />
          }
        </div>

        <div className="loading-text">{headline}</div>

        <ProgressBar
          value={value}
          tone={phase === 'complete' ? 'success' : 'progress'}
          label={phase !== 'complete' ? progress?.name : ''}
          sublabel={phase !== 'complete' && progress?.total > 0
            ? `${progress.current} / ${progress.total}`
            : null}
        />

        {phase !== 'complete' && (
          <div className="loading-hint">
            Beim ersten Start dauert das Einlesen ca. 2 Minuten.
            {elapsedSeconds >= 5 && (
              <span className="loading-elapsed"> · {formatElapsed(elapsedSeconds)} verstrichen</span>
            )}
          </div>
        )}

        <div className="landing-version-wrap">
          <span className="version-badge">Version: {VERSION}</span>
        </div>
      </div>
    </div>
  );
}

/** Map a loader stage code to its German UI label. */
function stageLabel(stage) {
  switch (stage) {
    case 'starting': return 'Starte';
    case 'loading':  return 'Lade DBF-Dateien';
    case 'indexing': return 'Baue Indizes auf';
    default:         return 'Warte auf Server';
  }
}

/** Render an elapsed-seconds value as "Xs" or "Xm YYs". */
function formatElapsed(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}
