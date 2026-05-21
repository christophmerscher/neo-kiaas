import { useMemo, useState } from 'react';
import { VersionBadge } from '../components/VersionBadge';
import { ThemeToggle } from '../components/ThemeToggle';

/**
 * Browser page for all symptom codes in the dataset. Supports two view
 * modes ("Karten" cards by category, "Tabelle" flat per-category list)
 * and live filtering.
 *
 * Clicking a code calls `onSelectScode(SCODE)` which the parent uses to
 * filter the main results view.
 *
 * @param {{
 *   scodes: Array<{ KATEGORI: string, entries: Array<{ SCODE: string, SCBEZEICH: string, KATEGORI?: string }> }>,
 *   theme: 'light' | 'dark',
 *   onToggleTheme: () => void,
 *   onBack: () => void,
 *   onHome: () => void,
 *   onOpenInfo: () => void,
 *   onSelectScode: (scode: string) => void,
 *   scodeView: 'cards' | 'table',
 *   onChangeScodeView: (v: 'cards' | 'table') => void,
 *   cat: string,
 *   onChangeCat: (cat: string) => void,
 * }} props
 */
export function ScodesPage({
  scodes, theme, onToggleTheme, onBack, onHome, onOpenInfo, onSelectScode,
  scodeView, onChangeScodeView, cat, onChangeCat,
}) {
  const [filter, setFilter] = useState('');
  const filterLower = filter.toLowerCase().trim();

  const filtered = useMemo(() => {
    if (!filterLower) return scodes;
    return scodes
      .map(c => ({
        KATEGORI: c.KATEGORI,
        entries: c.entries.filter(s =>
          (s.SCODE || '').toLowerCase().includes(filterLower) ||
          (s.SCBEZEICH || '').toLowerCase().includes(filterLower) ||
          (c.KATEGORI || '').toLowerCase().includes(filterLower)
        ),
      }))
      .filter(c => c.entries.length > 0);
  }, [scodes, filterLower]);

  const totalAll   = scodes.reduce((a, c) => a + c.entries.length, 0);
  const totalShown = filtered.reduce((a, c) => a + c.entries.length, 0);
  const activeCat  = cat ? filtered.find(c => (c.KATEGORI || '') === cat) : null;
  const showingCards = scodeView === 'cards' && !activeCat;

  const renderCodeList = (entries) => (
    <ul className="scode-list">
      {entries.map(s => (
        <li
          key={s.SCODE}
          className="scode-row"
          onClick={() => onSelectScode(s.SCODE)}
          title={`Aktionen zu ${s.SCODE} anzeigen`}
        >
          <span className="scode-code">{s.SCODE}</span>
          <span className="scode-desc">{s.SCBEZEICH || <em>(ohne Bezeichnung)</em>}</span>
          <span className="scode-arrow" aria-hidden="true">→</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="scodes-page">
      <header className="results-header">
        <div className="results-header-inner">
          <button className="back-circle" onClick={onBack} title="Zurück" aria-label="Zurück">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="currentColor" d="M15.41 16.59 10.83 12l4.58-4.59L14 6l-6 6 6 6z"/>
            </svg>
          </button>
          <div className="small-logo" onClick={onHome} title="Zur Startseite">
            <span className="logo-accent">neo-KIAS</span>
            <VersionBadge small />
          </div>
          <div className="top-search scodes-filter-search">
            <SearchIcon />
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Code, Bezeichnung oder Kategorie filtern…"
              autoFocus
            />
            {filter && <button className="clear-btn" onClick={() => setFilter('')} aria-label="Leeren">×</button>}
          </div>
          <div className="view-toggle">
            <button
              className={scodeView === 'cards' ? 'active' : ''}
              onClick={() => onChangeScodeView('cards')}
              title="Kategorien als Karten anzeigen"
            >
              Karten
            </button>
            <button
              className={scodeView === 'table' ? 'active' : ''}
              onClick={() => { onChangeScodeView('table'); onChangeCat(''); }}
              title="Alle Codes als Tabelle anzeigen"
            >
              Tabelle
            </button>
          </div>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <button className="info-btn" onClick={onOpenInfo} title="Über neo-KIAS" aria-label="Info">i</button>
        </div>
      </header>

      <main className="scodes-main">
        <div className="scodes-intro">
          <h1>Symptomcodes</h1>
          {!activeCat ? (
            <p>
              Übersicht aller in der Datenbank vorkommenden Symptomcodes.{' '}
              {scodeView === 'cards'
                ? 'Wählen Sie eine Kategorie, um die enthaltenen Codes zu sehen.'
                : 'Klicken Sie auf einen Code, um alle dazu passenden Aktionen zu sehen.'}
            </p>
          ) : (
            <p className="scodes-breadcrumb">
              <button className="linklike" onClick={() => onChangeCat('')}>← Alle Kategorien</button>
              <span> › </span>
              <strong>{activeCat.KATEGORI || '— ohne Kategorie —'}</strong>
            </p>
          )}
          <div className="scodes-stats">
            {activeCat
              ? `${activeCat.entries.length.toLocaleString()} Codes in dieser Kategorie`
              : filterLower
                ? `${totalShown.toLocaleString()} Codes in ${filtered.length} Kategorien (gefiltert aus ${totalAll.toLocaleString()})`
                : `${totalAll.toLocaleString()} Codes in ${scodes.length} Kategorien`}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="no-results">
            Keine Symptomcodes gefunden für <strong>{filter}</strong>.
          </div>
        ) : activeCat ? (
          renderCodeList(activeCat.entries)
        ) : showingCards ? (
          <div className="cat-grid">
            {filtered.map(c => (
              <button
                key={c.KATEGORI || '—'}
                className="cat-card"
                onClick={() => onChangeCat(c.KATEGORI || '')}
                title={`${c.entries.length} Codes`}
              >
                <span className="cat-card-count">{c.entries.length}</span>
                <span className="cat-card-name">{c.KATEGORI || '— ohne Kategorie —'}</span>
                <span className="cat-card-foot">Codes ansehen <span aria-hidden="true">→</span></span>
              </button>
            ))}
          </div>
        ) : (
          filtered.map(c => (
            <section key={c.KATEGORI || '—'} className="scode-cat">
              <h2 className="scode-cat-title">
                <span>{c.KATEGORI || '— ohne Kategorie —'}</span>
                <span className="scode-cat-count">{c.entries.length}</span>
              </h2>
              {renderCodeList(c.entries)}
            </section>
          ))
        )}
      </main>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#9aa0a6" d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19zM4 9.5A5.5 5.5 0 1 1 15 9.5 5.5 5.5 0 0 1 4 9.5z"/>
    </svg>
  );
}
