import { useMemo, useState } from 'react';
import { VersionBadge } from '../components/VersionBadge';
import { ThemeToggle } from '../components/ThemeToggle';
import { fmtDateTime } from '../utils/format';

/**
 * Changelog of the KIAS update chain.
 *
 * Each delta file (FO_UA26007.dbf and friends) is one entry: what it added,
 * changed, renumbered and withdrew. This is the only place where a
 * withdrawn bulletin is still visible, which is the point — merging the
 * deltas otherwise erases the fact that a code ever existed.
 *
 * Clicking a code runs a normal search for it rather than opening the
 * detail view directly: codes that were withdrawn have no detail page, and
 * the search result explains what happened to them.
 *
 * @param {{
 *   history: { enabled: boolean, totals: object|null, updates: Array<object> } | null,
 *   loading: boolean,
 *   theme: 'light' | 'dark',
 *   onToggleTheme: () => void,
 *   onBack: () => void,
 *   onHome: () => void,
 *   onOpenInfo: () => void,
 *   onSelectCode: (code: string) => void,
 * }} props
 */
export function HistoryPage({
  history, loading, theme, onToggleTheme, onBack, onHome, onOpenInfo, onSelectCode,
}) {
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());
  const filterLower = filter.toLowerCase().trim();

  const updates = history?.updates || [];
  const totals = history?.totals;

  /** Filtering keeps an update only if one of its codes/titles matches. */
  const filtered = useMemo(() => {
    if (!filterLower) return updates;
    const hit = (e) =>
      (e.code || '').toLowerCase().includes(filterLower) ||
      (e.from || '').toLowerCase().includes(filterLower) ||
      (e.title || '').toLowerCase().includes(filterLower);
    return updates
      .map(u => ({
        ...u,
        added: u.added.filter(hit),
        updated: u.updated.filter(hit),
        removed: u.removed.filter(hit),
        renamed: u.renamed.filter(hit),
      }))
      .filter(u =>
        u.added.length || u.updated.length || u.removed.length || u.renamed.length ||
        u.label.toLowerCase().includes(filterLower),
      );
  }, [updates, filterLower]);

  const toggle = (seq) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq); else next.add(seq);
      return next;
    });
  };

  const renderCodes = (entries, kind) => (
    <ul className={`hist-codes hist-codes-${kind}`}>
      {entries.map(e => (
        <li key={kind + e.code + (e.from || '')}>
          <button
            className="hist-code"
            onClick={() => onSelectCode(e.code)}
            title={kind === 'removed' ? 'Nach diesem Code suchen (zurückgezogen)' : 'Nach diesem Code suchen'}
          >
            {e.code}
          </button>
          {kind === 'renamed' && e.from && (
            <span className="hist-from">vorher {e.from}</span>
          )}
          <span className="hist-title">{e.title || <em>(ohne Bezeichnung)</em>}</span>
          {e.date && <span className="hist-date">{fmtDateTime(e.date)}</span>}
        </li>
      ))}
    </ul>
  );

  const sections = [
    ['added', 'Neue Aktionen'],
    ['renamed', 'Umnummeriert'],
    ['updated', 'Geänderte Aktionen'],
    ['removed', 'Zurückgezogene Aktionen'],
  ];

  return (
    <div className="scodes-page history-page">
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
              placeholder="Aktionscode, Bezeichnung oder Update filtern…"
              autoFocus
            />
            {filter && <button className="clear-btn" onClick={() => setFilter('')} aria-label="Leeren">×</button>}
          </div>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <button className="info-btn" onClick={onOpenInfo} title="Über neo-KIAS" aria-label="Info">i</button>
        </div>
      </header>

      <main className="scodes-main">
        <div className="scodes-intro">
          <h1>Änderungen</h1>
          <p>
            Was die einzelnen KIAS-Updates an den Aktionen verändert haben. Neu
            aufgenommene, geänderte, umnummerierte und zurückgezogene Aktionen,
            je Update-Datei und mit dem Zeitraum, den sie abdeckt.
          </p>
          {totals && (
            <div className="scodes-stats">
              {totals.updates.toLocaleString()} Updates ·{' '}
              {totals.added.toLocaleString()} neu ·{' '}
              {totals.updated.toLocaleString()} geändert ·{' '}
              {totals.renamed.toLocaleString()} umnummeriert ·{' '}
              {totals.removed.toLocaleString()} zurückgezogen
              {totals.gone > 0 && <> · davon {totals.gone.toLocaleString()} bis heute nicht wieder aufgetaucht</>}
            </div>
          )}
        </div>

        {loading && <div className="no-results">Änderungen werden geladen…</div>}

        {!loading && history && !history.enabled && (
          <div className="no-results">
            Die Änderungshistorie ist abgeschaltet.
            <div style={{ marginTop: 8, fontSize: 13 }}>
              Zum Einschalten <code>KIAS_HISTORY=true</code> in der <code>.env</code> setzen
              und den Server neu starten.
            </div>
          </div>
        )}

        {!loading && history?.enabled && filtered.length === 0 && (
          <div className="no-results">
            Keine Änderungen gefunden für <strong>{filter}</strong>.
          </div>
        )}

        {!loading && filtered.map(u => {
          const open = expanded.has(u.seq) || Boolean(filterLower);
          const untouched = !u.added.length && !u.updated.length
            && !u.removed.length && !u.renamed.length;
          return (
            <section key={u.seq} className="hist-update">
              <button className="hist-head" onClick={() => toggle(u.seq)} aria-expanded={open}>
                <span className={`hist-caret${open ? ' open' : ''}`} aria-hidden="true">›</span>
                <span className="hist-label">Update {u.label}</span>
                <span className="hist-period">
                  {u.from || u.to
                    ? `${fmtDateTime(u.from)}${u.to ? ` bis ${fmtDateTime(u.to)}` : ''}`
                    : u.file}
                </span>
                <span className="hist-counts">
                  {u.added.length > 0 && <span className="hist-chip chip-add">+{u.added.length} neu</span>}
                  {u.renamed.length > 0 && <span className="hist-chip chip-ren">{u.renamed.length} umbenannt</span>}
                  {u.updated.length > 0 && <span className="hist-chip chip-upd">{u.updated.length} geändert</span>}
                  {u.removed.length > 0 && <span className="hist-chip chip-del">−{u.removed.length} entfernt</span>}
                  {untouched && <span className="hist-chip">keine Änderung an Aktionen</span>}
                </span>
              </button>

              {open && (
                <div className="hist-body">
                  {sections.map(([key, heading]) =>
                    u[key].length > 0 ? (
                      <div key={key} className={`hist-section hist-section-${key}`}>
                        <h3>{heading} <span className="hist-section-count">{u[key].length}</span></h3>
                        {renderCodes(u[key], key)}
                      </div>
                    ) : null,
                  )}
                </div>
              )}
            </section>
          );
        })}
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
