/**
 * Root component: orchestrates state, wires API calls, and dispatches to
 * the right page renderer based on the current URL/mode.
 *
 * Most heavy lifting lives in dedicated modules:
 *   - hooks/useUrlState     URL <-> state binding, history pushing
 *   - hooks/useTheme        light/dark + persistence
 *   - hooks/useDebounced    typing throttle for search
 *   - pages/ScodesPage      Symptomcode browser
 *   - pages/VehiclesPage    Vehicle browser
 *   - components/Detail     Bulletin detail panel
 *   - components/LinkedText Inline reference rendering inside long text
 *   - components/InfoModal  About / disclaimer / license
 *
 * This file just composes them.
 */

import { useEffect, useMemo, useState } from 'react';

import { VERSION, STORAGE_KEYS } from './constants';
import { getJson, postJson, formUrl } from './services/api';
import { useDebounced } from './hooks/useDebounced';
import { useTheme } from './hooks/useTheme';
import { useUrlState } from './hooks/useUrlState';
import { fmtDateTime } from './utils/format';
import { nArtLabel, nArtTitle } from './utils/nArt';

import { ThemeToggle } from './components/ThemeToggle';
import { VersionBadge } from './components/VersionBadge';
import { Highlight } from './components/Highlight';
import { InfoModal } from './components/InfoModal';
import { Detail } from './components/Detail';

import { ScodesPage } from './pages/ScodesPage';
import { VehiclesPage } from './pages/VehiclesPage';

export default function App() {
  // ── Lookup data fetched from the API once on mount ──────────────────
  const [status, setStatus]       = useState(null);
  const [vehicles, setVehicles]   = useState([]);
  const [scodes, setScodes]       = useState([]);
  const [carImages, setCarImages] = useState({});

  useEffect(() => {
    getJson('/api/status').then(stat => {
      setStatus(stat);
      // Only fetch the photo catalog if the feature is enabled server-side.
      if (stat?.features?.carImages) {
        getJson('/api/car-images').then(list => {
          const map = {};
          for (const item of list || []) {
            if (item && item.slug && item.file) map[item.slug] = item.file;
          }
          setCarImages(map);
        }).catch(() => {});
      }
    }).catch(() => {});
    getJson('/api/vehicles').then(setVehicles).catch(() => {});
    getJson('/api/scodes').then(setScodes).catch(() => {});
  }, []);

  const showCarImages = Boolean(status?.features?.carImages);

  // ── Search / navigation state (URL-synced) ──────────────────────────
  const url = useUrlState();
  const {
    q, fz, scode, keyword, yearFrom, yearTo, selected, page, cat,
    setQ, setFz, setScode, setKeyword, setYearFrom, setYearTo,
    setSelected, setPage, setCat,
    resetAll, goBack,
  } = url;

  // ── UI preferences (persisted) ──────────────────────────────────────
  const [theme, toggleTheme] = useTheme();
  const [view, setView] = useState(
    () => localStorage.getItem(STORAGE_KEYS.view) || 'google',
  );
  const [scodeView, setScodeView] = useState(
    () => localStorage.getItem(STORAGE_KEYS.scodeView) || 'cards',
  );
  const [vehicleView, setVehicleView] = useState(
    () => localStorage.getItem(STORAGE_KEYS.vehicleView) || 'cards',
  );
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.view, view); }, [view]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.scodeView, scodeView); }, [scodeView]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.vehicleView, vehicleView); }, [vehicleView]);

  // ── Search results + bulletin detail ────────────────────────────────
  const [results, setResults] = useState({ total: 0, results: [] });
  const [loading, setLoading] = useState(false);
  const [detail, setDetail]   = useState(null);

  const qDeb  = useDebounced(q, 250);
  const kwDeb = useDebounced(keyword, 250);

  // Gate: which page does the URL state currently want us to render?
  // Uses raw (non-debounced) values so clearing feels instant.
  const hasQuery = Boolean(q || fz || scode || keyword || yearFrom || yearTo);
  // Fetch trigger: debounced so we don't fire on every keystroke.
  const hasDebouncedQuery = Boolean(qDeb || fz || scode || kwDeb || yearFrom || yearTo);

  useEffect(() => {
    if (!hasDebouncedQuery) { setResults({ total: 0, results: [] }); return; }
    const params = new URLSearchParams();
    if (qDeb) params.set('q', qDeb);
    if (fz) params.set('fz', fz);
    if (scode) params.set('scode', scode);
    if (kwDeb) params.set('keyword', kwDeb);
    if (yearFrom) params.set('yearFrom', yearFrom);
    if (yearTo) params.set('yearTo', yearTo);
    params.set('limit', 200);
    setLoading(true);
    getJson(`/api/bulletins?${params}`).then(r => {
      setResults(r);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [hasDebouncedQuery, qDeb, fz, scode, kwDeb, yearFrom, yearTo]);

  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    getJson(`/api/bulletin/${encodeURIComponent(selected)}`).then(setDetail);
  }, [selected]);

  // ── Action handlers ─────────────────────────────────────────────────
  const reload = async () => setStatus(await postJson('/api/reload'));

  const vehicleLabel = useMemo(() => {
    const map = new Map(vehicles.map(v => [v.FZ, v.INTBEZEICH || v.BEZEICH || v.FZ]));
    return (code) => map.get(code) || code;
  }, [vehicles]);

  /** Exit the detail view when the user mutates any search/filter value. */
  const exitDetail = () => { if (selected) setSelected(null); };

  const followReference = (text) => {
    setPage(''); setCat('');
    setFz(''); setScode(''); setKeyword(''); setYearFrom(''); setYearTo('');
    setSelected(null);
    setQ(text);
  };

  const openScodes = () => { setSelected(null); setCat(''); setPage('scodes'); };
  const openVehicles = () => { setSelected(null); setCat(''); setPage('vehicles'); };

  const selectScodeFilter = (sc) => {
    setPage(''); setCat('');
    setQ(''); setFz(''); setKeyword(''); setYearFrom(''); setYearTo('');
    setSelected(null);
    setScode(sc);
  };
  const selectVehicleFilter = (fzCode) => {
    setPage(''); setCat('');
    setQ(''); setScode(''); setKeyword(''); setYearFrom(''); setYearTo('');
    setSelected(null);
    setFz(fzCode);
  };

  // ── Info modal ──────────────────────────────────────────────────────
  const [infoOpen, setInfoOpen] = useState(false);
  const openInfo  = () => setInfoOpen(true);
  const closeInfo = () => setInfoOpen(false);

  const totalRecs = status?.counts
    ? Object.values(status.counts).reduce((a, b) => a + b, 0)
    : 0;

  // ── Dispatch on URL mode ────────────────────────────────────────────

  if (page === 'vehicles') {
    return (
      <>
        <VehiclesPage
          vehicles={vehicles}
          carImages={carImages}
          showCarImages={showCarImages}
          theme={theme}
          onToggleTheme={toggleTheme}
          onBack={goBack}
          onHome={resetAll}
          onOpenInfo={openInfo}
          onSelectVehicle={selectVehicleFilter}
          view={vehicleView}
          onChangeView={setVehicleView}
          cat={cat}
          onChangeCat={setCat}
        />
        {infoOpen && <InfoModal onClose={closeInfo} />}
      </>
    );
  }

  if (page === 'scodes') {
    return (
      <>
        <ScodesPage
          scodes={scodes}
          theme={theme}
          onToggleTheme={toggleTheme}
          onBack={goBack}
          onHome={resetAll}
          onOpenInfo={openInfo}
          onSelectScode={selectScodeFilter}
          scodeView={scodeView}
          onChangeScodeView={setScodeView}
          cat={cat}
          onChangeCat={setCat}
        />
        {infoOpen && <InfoModal onClose={closeInfo} />}
      </>
    );
  }

  if (!hasQuery) {
    return (
      <LandingPage
        status={status}
        q={q} setQ={setQ}
        view={view} setView={setView}
        theme={theme} toggleTheme={toggleTheme}
        reload={reload}
        onOpenScodes={openScodes}
        onOpenVehicles={openVehicles}
        onOpenInfo={openInfo}
        onYearFromShortcut={() => setYearFrom(String(new Date().getFullYear()))}
        infoOpen={infoOpen}
        onCloseInfo={closeInfo}
      />
    );
  }

  if (view === 'classic') {
    return (
      <ClassicView
        status={status} totalRecs={totalRecs}
        url={url} exitDetail={exitDetail}
        vehicles={vehicles} scodes={scodes}
        results={results} loading={loading}
        detail={detail}
        view={view} setView={setView}
        theme={theme} toggleTheme={toggleTheme}
        reload={reload}
        onOpenScodes={openScodes}
        onOpenVehicles={openVehicles}
        onOpenInfo={openInfo}
        followReference={followReference}
        vehicleLabel={vehicleLabel}
        infoOpen={infoOpen} closeInfo={closeInfo}
      />
    );
  }

  return (
    <GoogleView
      url={url} exitDetail={exitDetail}
      vehicles={vehicles} scodes={scodes}
      results={results} loading={loading}
      detail={detail}
      qDeb={qDeb}
      view={view} setView={setView}
      theme={theme} toggleTheme={toggleTheme}
      reload={reload}
      onOpenScodes={openScodes}
      onOpenVehicles={openVehicles}
      onOpenInfo={openInfo}
      followReference={followReference}
      vehicleLabel={vehicleLabel}
      infoOpen={infoOpen} closeInfo={closeInfo}
    />
  );
}

// ── Landing page ───────────────────────────────────────────────────────────

function LandingPage({
  status, q, setQ, view, setView,
  theme, toggleTheme,
  reload, onOpenScodes, onOpenVehicles, onOpenInfo,
  onYearFromShortcut,
  infoOpen, onCloseInfo,
}) {
  return (
    <div className="landing">
      <div className="landing-inner">
        <div className="landing-logo">
          <span className="logo-accent">neo-KIAS</span>
        </div>
        <div className="landing-sub">
          {status?.loaded
            ? `${status.counts.aktion.toLocaleString()} Aktionen durchsuchen`
            : 'Lade Daten…'}
        </div>
        <div className="landing-search">
          <SearchIcon big />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="neo-KIAS durchsuchen – Aktionscode, Stichwort, Teil…"
            autoFocus
          />
        </div>
        <div className="landing-tips">
          <span onClick={() => setQ('Bremse')}>Bremse</span>
          <span onClick={() => setQ('Airbag')}>Airbag</span>
          <span onClick={() => setQ('Getriebe')}>Getriebe</span>
          <span onClick={() => setQ('Steuergerät')}>Steuergerät</span>
          <span onClick={onYearFromShortcut}>Aktuelles Jahr</span>
        </div>
        <div className="landing-actions">
          <div className="view-toggle landing-view-toggle">
            <button className={view === 'google' ? 'active' : ''} onClick={() => setView('google')}>
              Listen-Ansicht
            </button>
            <button className={view === 'classic' ? 'active' : ''} onClick={() => setView('classic')}>
              Klassische Ansicht
            </button>
          </div>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
        <div className="landing-footer">
          {status?.loaded && (
            <>
              Stand {fmtDateTime(status.loadedAt)} ·{' '}
              <button className="linklike" onClick={reload}>neu einlesen</button>{' · '}
            </>
          )}
          <button className="linklike" onClick={onOpenScodes}>Symptomcodes</button>
          {' · '}
          <button className="linklike" onClick={onOpenVehicles}>Fahrzeuge</button>
          {' · '}
          <button className="linklike" onClick={onOpenInfo}>Über neo-KIAS</button>
        </div>
        <div className="landing-disclaimer">
          Inoffizielle Erweiterung – nicht von Ford. Ohne Gewähr, Nutzung auf eigene Gefahr.
        </div>
        <div className="landing-version-wrap">
          <span className="version-badge">Version: {VERSION}</span>
        </div>
      </div>
      {infoOpen && <InfoModal onClose={onCloseInfo} />}
    </div>
  );
}

// ── Classic view (sidebar + detail) ────────────────────────────────────────

function ClassicView({
  status, totalRecs,
  url, exitDetail,
  vehicles, scodes,
  results, loading,
  detail,
  view, setView,
  theme, toggleTheme,
  reload, onOpenScodes, onOpenVehicles, onOpenInfo,
  followReference, vehicleLabel,
  infoOpen, closeInfo,
}) {
  const { q, fz, scode, keyword, yearFrom, yearTo, selected,
          setQ, setFz, setScode, setKeyword, setYearFrom, setYearTo,
          setSelected, resetAll } = url;

  /** All sidebar inputs both update their value AND drop the detail view. */
  const sx = (set) => (e) => { set(e.target.value); exitDetail(); };

  return (
    <>
      <header>
        <h1 className="clickable" onClick={resetAll} title="Zur Startseite">
          <span className="logo-accent">neo-KIAS</span> Explorer
          <VersionBadge small />
        </h1>
        <div className="view-toggle header-toggle">
          <button className={view === 'google' ? 'active' : ''} onClick={() => setView('google')}>Liste</button>
          <button className={view === 'classic' ? 'active' : ''} onClick={() => setView('classic')}>Klassisch</button>
        </div>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <button className="header-link" onClick={onOpenScodes} title="Alle Symptomcodes ansehen">Symptomcodes</button>
        <button className="header-link" onClick={onOpenVehicles} title="Alle Fahrzeuge ansehen">Fahrzeuge</button>
        <button className="info-btn" onClick={onOpenInfo} title="Über neo-KIAS" aria-label="Info">i</button>
        <span className="status">
          {status?.loaded ? (
            <>
              {status.counts.aktion.toLocaleString()} Aktionen · {totalRecs.toLocaleString()} Datensätze ·
              Stand {fmtDateTime(status.loadedAt)}
            </>
          ) : 'Lade Daten…'}
        </span>
        <button onClick={reload} title="Daten neu aus DBF-Dateien einlesen">Neu laden</button>
      </header>
      {infoOpen && <InfoModal onClose={closeInfo} />}

      <div className="layout">
        <aside className="sidebar">
          <div className="filters">
            <div>
              <label>Volltextsuche</label>
              <input value={q} onChange={sx(setQ)} placeholder="Aktionscode, Beschreibung, Teil…" autoFocus />
            </div>
            <div>
              <label>Fahrzeug</label>
              <select value={fz} onChange={sx(setFz)}>
                <option value="">Alle Fahrzeuge</option>
                {vehicles.map(v => (
                  <option key={v.FZ} value={v.FZ}>{v.FZ} — {v.INTBEZEICH || v.BEZEICH}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Symptomcode</label>
              <select value={scode} onChange={sx(setScode)}>
                <option value="">Alle Symptome</option>
                {scodes.map(cat => (
                  <optgroup key={cat.KATEGORI} label={cat.KATEGORI || '—'}>
                    {cat.entries.map(s => (
                      <option key={s.SCODE} value={s.SCODE}>{s.SCODE} — {s.SCBEZEICH}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label>Schlagwort</label>
              <input value={keyword} onChange={sx(setKeyword)} placeholder="z.B. Bremse" />
            </div>
            <div>
              <label>Zeitraum (Jahr)</label>
              <div className="row">
                <input value={yearFrom} onChange={sx(setYearFrom)} placeholder="von" />
                <input value={yearTo}   onChange={sx(setYearTo)}   placeholder="bis" />
              </div>
            </div>
          </div>

          <div className="result-meta">
            {loading
              ? 'Suche…'
              : `${results.total.toLocaleString()} Treffer${
                  results.total > results.results.length ? ` (zeige ${results.results.length})` : ''
                }`}
          </div>

          <div className="result-list">
            {results.results.map(b => (
              <div
                key={b.A_CODE}
                className={`result-item ${selected === b.A_CODE ? 'active' : ''}`}
                onClick={() => setSelected(b.A_CODE)}
              >
                <div className="code">
                  {b.A_CODE}
                  {b.N_ART && (
                    <span
                      className="badge"
                      style={{ marginLeft: 6 }}
                      title={nArtTitle(b.N_ART)}
                    >
                      {nArtLabel(b.N_ART)}
                    </span>
                  )}
                </div>
                <div className="title">
                  {b.K_BEZEICH || b.BAUZEIT || <span style={{ color: '#94a3b8' }}>(ohne Kurztitel)</span>}
                </div>
                <div className="meta">
                  <span>{fmtDateTime(b.A_DAT) || '—'}</span>
                  {b.HILF_NR && <span>HN: {b.HILF_NR}</span>}
                  {b.vehicles.length > 0 && <span>{b.vehicles.length} Fzg.</span>}
                  {b.forms > 0 && <span>📄 {b.forms}</span>}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <main className="detail">
          {!detail ? (
            <div className="placeholder">Wählen Sie einen Eintrag aus der Liste.</div>
          ) : (
            <Detail
              detail={detail}
              vehicleLabel={vehicleLabel}
              onNavigateRef={followReference}
              onSelectBulletin={setSelected}
            />
          )}
        </main>
      </div>
    </>
  );
}

// ── Google-style view (results list + detail page) ─────────────────────────

function GoogleView({
  url, exitDetail,
  vehicles, scodes,
  results, loading, detail, qDeb,
  view, setView, theme, toggleTheme,
  reload, onOpenScodes, onOpenVehicles, onOpenInfo,
  followReference, vehicleLabel,
  infoOpen, closeInfo,
}) {
  const { q, fz, scode, keyword, yearFrom, yearTo,
          setQ, setFz, setScode, setKeyword, setYearFrom, setYearTo,
          setSelected, goBack, resetAll } = url;

  const sx = (set) => (e) => { set(e.target.value); exitDetail(); };
  const hasFilters = fz || scode || keyword || yearFrom || yearTo;

  return (
    <div className="results-page">
      <header className="results-header">
        <div className="results-header-inner">
          <button className="back-circle" onClick={goBack} title="Zurück" aria-label="Zurück">
            <BackIcon />
          </button>
          <div className="small-logo" onClick={resetAll} title="Zur Startseite">
            <span className="logo-accent">neo-KIAS</span>
            <VersionBadge small />
          </div>
          <div className="top-search">
            <SearchIcon />
            <input
              value={q}
              onChange={e => { setQ(e.target.value); exitDetail(); }}
              placeholder="neo-KIAS durchsuchen…"
              autoFocus
            />
            {q && (
              <button
                className="clear-btn"
                onClick={() => { setQ(''); exitDetail(); }}
                aria-label="Leeren"
              >×</button>
            )}
          </div>
          <div className="view-toggle">
            <button className={view === 'google' ? 'active' : ''} onClick={() => setView('google')}>Liste</button>
            <button className={view === 'classic' ? 'active' : ''} onClick={() => setView('classic')}>Klassisch</button>
          </div>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <button className="header-link" onClick={onOpenScodes} title="Alle Symptomcodes ansehen">Symptomcodes</button>
          <button className="header-link" onClick={onOpenVehicles} title="Alle Fahrzeuge ansehen">Fahrzeuge</button>
          <button className="info-btn" onClick={onOpenInfo} title="Über neo-KIAS" aria-label="Info">i</button>
          <button className="reload-btn" onClick={reload} title="Daten neu aus DBF-Dateien einlesen">↻</button>
        </div>
        <div className="filter-bar">
          <select value={fz} onChange={sx(setFz)}>
            <option value="">Alle Fahrzeuge</option>
            {vehicles.map(v => (
              <option key={v.FZ} value={v.FZ}>{v.INTBEZEICH || v.BEZEICH || v.FZ}</option>
            ))}
          </select>
          <select value={scode} onChange={sx(setScode)}>
            <option value="">Alle Symptome</option>
            {scodes.map(cat => (
              <optgroup key={cat.KATEGORI} label={cat.KATEGORI || '—'}>
                {cat.entries.map(s => (
                  <option key={s.SCODE} value={s.SCODE}>{s.SCODE} — {s.SCBEZEICH}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <input value={keyword}  onChange={sx(setKeyword)}  placeholder="Schlagwort" />
          <input value={yearFrom} onChange={sx(setYearFrom)} placeholder="Jahr von" className="small" />
          <input value={yearTo}   onChange={sx(setYearTo)}   placeholder="Jahr bis" className="small" />
          {hasFilters && (
            <button
              className="linklike"
              onClick={() => {
                setFz(''); setScode(''); setKeyword('');
                setYearFrom(''); setYearTo('');
                exitDetail();
              }}
            >
              Filter leeren
            </button>
          )}
        </div>
      </header>

      {detail ? (
        <main className="detail-page">
          <button className="back-btn" onClick={goBack}>← Zurück zu den Ergebnissen</button>
          <Detail
            detail={detail}
            vehicleLabel={vehicleLabel}
            onNavigateRef={followReference}
            onSelectBulletin={setSelected}
          />
        </main>
      ) : (
        <ResultsList
          results={results}
          loading={loading}
          qDeb={qDeb}
          setSelected={setSelected}
          vehicleLabel={vehicleLabel}
        />
      )}
      {infoOpen && <InfoModal onClose={closeInfo} />}
    </div>
  );
}

function ResultsList({ results, loading, qDeb, setSelected, vehicleLabel }) {
  return (
    <main className="results-main">
      <div className="results-stats">
        {loading
          ? 'Suche…'
          : `Ungefähr ${results.total.toLocaleString()} Ergebnisse${
              results.total > results.results.length ? ` (zeige erste ${results.results.length})` : ''
            }`}
      </div>

      {results.results.length === 0 && !loading && (
        <div className="no-results">
          Keine Treffer für <strong>{qDeb || 'diese Filter'}</strong>.
          <div style={{ marginTop: 8, fontSize: 13 }}>
            Versuchen Sie andere Begriffe oder entfernen Sie Filter.
          </div>
        </div>
      )}

      <ol className="results-list">
        {results.results.map(b => (
          <li key={b.A_CODE} className="result-card" onClick={() => setSelected(b.A_CODE)}>
            <div className="result-breadcrumb">
              <span className="result-favicon" aria-hidden="true">K</span>
              <span className="breadcrumb-path">
                <span className="breadcrumb-domain">neo-KIAS · KIAS Datenbank</span>
                <span className="breadcrumb-url">
                  kias › aktion › {b.A_CODE}
                  {b.A_DAT && <> · {fmtDateTime(b.A_DAT)}</>}
                </span>
              </span>
              {b.N_ART && (
                <span className="badge" title={nArtTitle(b.N_ART)}>
                  {nArtLabel(b.N_ART)}
                </span>
              )}
            </div>
            <div className="result-title">{b.K_BEZEICH || b.BAUZEIT || b.A_CODE}</div>
            <div className="result-snippet">
              {b.snippet
                ? <Highlight text={b.snippet} q={qDeb} />
                : (b.BAUZEIT && b.K_BEZEICH ? b.BAUZEIT : null)}
              {b.HILF_NR && <> · Hilfs-Nr: <strong>{b.HILF_NR}</strong></>}
            </div>
            <div className="result-meta-row">
              {b.vehicles.length > 0 && (
                <>
                  {b.vehicles.slice(0, 5).map(v => (
                    <span key={v} className="mini-chip">{vehicleLabel(v)}</span>
                  ))}
                  {b.vehicles.length > 5 && (
                    <span className="mini-chip more">+{b.vehicles.length - 5}</span>
                  )}
                </>
              )}
              {b.forms > 0 && (
                <span className="mini-chip files">📄 {b.forms} Formular{b.forms > 1 ? 'e' : ''}</span>
              )}
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}

// ── SVG icons used inline ──────────────────────────────────────────────────

function SearchIcon({ big }) {
  const size = big ? 20 : 18;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path fill="#9aa0a6" d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19zM4 9.5A5.5 5.5 0 1 1 15 9.5 5.5 5.5 0 0 1 4 9.5z"/>
    </svg>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="currentColor" d="M15.41 16.59 10.83 12l4.58-4.59L14 6l-6 6 6 6z"/>
    </svg>
  );
}
