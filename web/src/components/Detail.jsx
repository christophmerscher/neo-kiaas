import { Fragment } from 'react';
import { fmtDateTime } from '../utils/format';
import { nArtLabel, nArtTitle, nArtKenndaten } from '../utils/nArt';
import { bulletinTitle } from '../utils/bulletin';
import { resolveReference as apiResolveReference, formUrl } from '../services/api';
import { LinkedText } from './LinkedText';

/**
 * Bulletin detail panel. Renders the full bulletin: header (A_CODE + N_ART
 * badge + title), Kenndaten table, vehicle/symptom/keyword chips,
 * attached forms, and all the long-text sections (Beschreibung,
 * Vergütung, Vercodung, Arbeitszeiten, Ersatzteile).
 *
 * Inline references inside long text are rendered via {@link LinkedText}.
 *
 * @param {{
 *   detail: object,
 *   vehicleLabel: (fz:string) => string,
 *   onNavigateRef: (refText:string) => void,
 *   onSelectBulletin: (code:string) => void,
 * }} props
 */
export function Detail({ detail, vehicleLabel, onNavigateRef, onSelectBulletin }) {
  const openForm = (file) => {
    if (file) window.open(formUrl(file), '_blank', 'noopener');
  };

  /**
   * Decide where a click on a classified reference should go.
   *
   *  - attachment → open the bulletin's N-th form (or first)
   *  - doc        → onSelectBulletin(resolvedCode); fall back to async
   *                 lookup if the pre-resolution didn't run
   *  - dtc/other  → onNavigateRef(refText) (cross-table search)
   */
  const handleRefClick = async (refText, classified) => {
    if (classified.kind === 'attachment') {
      const forms = detail.forms || [];
      if (forms.length === 0) return;
      const idx = classified.number
        ? Math.max(0, Math.min(parseInt(classified.number, 10) - 1, forms.length - 1))
        : 0;
      openForm(forms[idx]);
      return;
    }
    if (classified.kind === 'doc') {
      if (classified.resolvedCode) {
        onSelectBulletin(classified.resolvedCode);
        return;
      }
      const resolved = await apiResolveReference(refText);
      if (resolved) onSelectBulletin(resolved);
      else onNavigateRef(refText);
      return;
    }
    onNavigateRef(refText);
  };

  /** Tiny helper to wrap any free-text field with LinkedText. */
  const linked = (s) => (
    <LinkedText
      text={s}
      onRefClick={handleRefClick}
      hasForms={Boolean(detail.forms && detail.forms.length > 0)}
      refs={detail.refs}
      currentCode={detail.A_CODE}
    />
  );

  const kenndaten = [
    ['Datum', fmtDateTime(detail.A_DAT)],
    ['Nachrichtenart', nArtKenndaten(detail.N_ART)],
    ['DC', detail.DC],
    ['CC', detail.CC],
    ['Hilfsnr.', detail.HILF_NR],
    ['Nachfass', detail.NACHFASS],
    ['Bauzeit', detail.BAUZEIT],
    ['Kurzbeschreibung', detail.K_BEZEICH],
  ].filter(([, v]) => v != null && String(v).trim() !== '');

  const title = bulletinTitle(detail);

  return (
    <>
      <h2>
        {detail.A_CODE}
        {detail.N_ART && (
          <span className="badge" style={{ marginLeft: 10, verticalAlign: 'middle' }} title={nArtTitle(detail.N_ART)}>
            {nArtLabel(detail.N_ART)}
          </span>
        )}
      </h2>
      <div className="sub">
        {fmtDateTime(detail.A_DAT)}
        {title && <> · {linked(title)}</>}
      </div>

      <section className="section">
        <h3>Kenndaten</h3>
        <dl className="kv">
          {kenndaten.map(([k, v]) => (
            <Fragment key={k}>
              <dt>{k}</dt>
              <dd>{typeof v === 'string' ? linked(v) : v}</dd>
            </Fragment>
          ))}
        </dl>
      </section>

      {detail.vehicles?.length > 0 && (
        <section className="section">
          <h3>Fahrzeuge ({detail.vehicles.length})</h3>
          <div className="chiplist">
            {detail.vehicles.map(v => (
              <span
                key={v.FZ}
                className="chip fz"
                title={`${fmtDateTime(v.VON) || ''} – ${fmtDateTime(v.BIS) || ''}`.trim()}
              >
                {v.INTBEZEICH || v.BEZEICH || v.FZ}
              </span>
            ))}
          </div>
        </section>
      )}

      {detail.symptoms?.length > 0 && (
        <section className="section">
          <h3>Symptomcodes ({detail.symptoms.length})</h3>
          <div className="chiplist">
            {detail.symptoms.map(s => (
              <span key={s.SCODE} className="chip sym" title={s.KATEGORI}>
                {s.SCODE}{s.SCBEZEICH ? ` — ${s.SCBEZEICH}` : ''}
              </span>
            ))}
          </div>
        </section>
      )}

      {detail.keywords?.length > 0 && (
        <section className="section">
          <h3>Schlagwörter</h3>
          <div className="chiplist">
            {detail.keywords.map((k, i) => <span key={i} className="chip kw">{k}</span>)}
          </div>
        </section>
      )}

      {detail.forms?.length > 0 && (
        <section className="section">
          <h3>Formulare / Anhänge</h3>
          <div className="chiplist">
            {detail.forms.map(f => (
              <a key={f} href={formUrl(f)} target="_blank" rel="noreferrer" className="form-link">{f}</a>
            ))}
          </div>
        </section>
      )}

      {detail.BESCHREIB && (
        <section className="section">
          <h3>Beschreibung</h3>
          <pre>{linked(detail.BESCHREIB)}</pre>
        </section>
      )}
      {detail.VERGUETUNG && detail.VERGUETUNG.trim() && (
        <section className="section">
          <h3>Vergütung</h3>
          <pre>{linked(detail.VERGUETUNG)}</pre>
        </section>
      )}
      {detail.VERCODUNG && detail.VERCODUNG.trim() && (
        <section className="section">
          <h3>Vercodung</h3>
          <pre>{linked(detail.VERCODUNG)}</pre>
        </section>
      )}
      {detail.ARBZEIT && (
        <section className="section">
          <h3>Arbeitszeiten</h3>
          <pre>{linked(detail.ARBZEIT)}</pre>
        </section>
      )}
      {detail.ETEILE && (
        <section className="section">
          <h3>Ersatzteile</h3>
          <pre>{linked(detail.ETEILE)}</pre>
        </section>
      )}
    </>
  );
}
