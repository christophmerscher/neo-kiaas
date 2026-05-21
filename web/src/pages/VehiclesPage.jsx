import { useMemo, useState } from 'react';
import { VersionBadge } from '../components/VersionBadge';
import { ThemeToggle } from '../components/ThemeToggle';
import CarIcon, { carTypeFor, modelSlug } from '../CarIcon';
import { vehicleModel, titleCaseModel } from '../utils/vehicleModel';
import { carImageUrl } from '../services/api';

/**
 * Browser page for every vehicle generation in the dataset.
 *
 *   - "Karten" view groups by model line ({@link vehicleModel}) and shows
 *     one card per line. Optionally rendered with real photos when
 *     `showCarImages` is on and a matching slug exists in the server's
 *     car-images directory.
 *   - "Tabelle" view collapses to a single flat list grouped by section.
 *   - Drilling into a model from a card opens its generation table.
 *
 * @param {{
 *   vehicles: Array<object>,
 *   carImages: Record<string,string>,
 *   showCarImages: boolean,
 *   theme: 'light' | 'dark',
 *   onToggleTheme: () => void,
 *   onBack: () => void,
 *   onHome: () => void,
 *   onOpenInfo: () => void,
 *   onSelectVehicle: (fz:string) => void,
 *   view: 'cards' | 'table',
 *   onChangeView: (v:'cards'|'table') => void,
 *   cat: string,
 *   onChangeCat: (cat:string) => void,
 * }} props
 */
export function VehiclesPage({
  vehicles, carImages, showCarImages,
  theme, onToggleTheme, onBack, onHome, onOpenInfo, onSelectVehicle,
  view, onChangeView, cat, onChangeCat,
}) {
  const [filter, setFilter] = useState('');
  const filterLower = filter.toLowerCase().trim();

  // Group vehicles by model line. Lowercased key merges casing variants
  // (MONDEO/Mondeo); the first encountered display form wins.
  const grouped = useMemo(() => {
    /** @type {Map<string,{ model:string, items:Array<object> }>} */
    const map = new Map();
    for (const v of vehicles) {
      const display = titleCaseModel(vehicleModel(v));
      const key = display.toLowerCase();
      if (!map.has(key)) map.set(key, { model: display, items: [] });
      map.get(key).items.push(v);
    }
    return [...map.values()]
      .map(g => ({
        ...g,
        items: g.items.slice().sort((a, b) => (a.VON || '').localeCompare(b.VON || '')),
      }))
      .sort((a, b) => a.model.localeCompare(b.model));
  }, [vehicles]);

  const filtered = useMemo(() => {
    if (!filterLower) return grouped;
    return grouped
      .map(g => ({
        model: g.model,
        items: g.items.filter(v =>
          (v.FZ || '').toLowerCase().includes(filterLower) ||
          (v.BEZEICH || '').toLowerCase().includes(filterLower) ||
          (v.INTBEZEICH || '').toLowerCase().includes(filterLower) ||
          g.model.toLowerCase().includes(filterLower)
        ),
      }))
      .filter(g => g.items.length > 0);
  }, [grouped, filterLower]);

  const totalAll   = vehicles.length;
  const totalShown = filtered.reduce((a, g) => a + g.items.length, 0);
  const activeModel = cat ? filtered.find(g => g.model === cat) : null;
  const showingCards = view === 'cards' && !activeModel;

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
              placeholder="Modell, Code oder Bauzeit filtern…"
              autoFocus
            />
            {filter && <button className="clear-btn" onClick={() => setFilter('')} aria-label="Leeren">×</button>}
          </div>
          <div className="view-toggle">
            <button
              className={view === 'cards' ? 'active' : ''}
              onClick={() => onChangeView('cards')}
              title="Modelle als Karten anzeigen"
            >
              Karten
            </button>
            <button
              className={view === 'table' ? 'active' : ''}
              onClick={() => { onChangeView('table'); onChangeCat(''); }}
              title="Alle Fahrzeuge als Tabelle anzeigen"
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
          <h1>Fahrzeuge</h1>
          {!activeModel ? (
            <p>
              Übersicht aller Fahrzeug-Generationen in der KIAS-Datenbank.{' '}
              {view === 'cards'
                ? 'Wählen Sie ein Modell, um die zugehörigen Generationen zu sehen.'
                : 'Klicken Sie auf einen Eintrag, um alle dazu passenden Aktionen anzuzeigen.'}
            </p>
          ) : (
            <p className="scodes-breadcrumb">
              <button className="linklike" onClick={() => onChangeCat('')}>← Alle Modelle</button>
              <span> › </span>
              <strong>{activeModel.model}</strong>
            </p>
          )}
          <div className="scodes-stats">
            {activeModel
              ? `${activeModel.items.length.toLocaleString()} Generation${activeModel.items.length === 1 ? '' : 'en'} in diesem Modell`
              : filterLower
                ? `${totalShown.toLocaleString()} Fahrzeuge in ${filtered.length} Modell${filtered.length === 1 ? '' : 'en'} (gefiltert aus ${totalAll.toLocaleString()})`
                : `${totalAll.toLocaleString()} Fahrzeuge in ${grouped.length} Modell-Linien`}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="no-results">
            Keine Fahrzeuge gefunden für <strong>{filter}</strong>.
          </div>
        ) : activeModel ? (
          <VehicleList items={activeModel.items} onSelect={onSelectVehicle} />
        ) : showingCards ? (
          <ModelCardGrid
            groups={filtered}
            showCarImages={showCarImages}
            carImages={carImages}
            onChangeCat={onChangeCat}
          />
        ) : (
          filtered.map(g => (
            <section key={g.model} className="scode-cat">
              <h2 className="scode-cat-title">
                <span>{g.model}</span>
                <span className="scode-cat-count">{g.items.length}</span>
              </h2>
              <VehicleList items={g.items} onSelect={onSelectVehicle} />
            </section>
          ))
        )}
      </main>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Convert KIAS VON/BIS half-dates into a single display string. */
function fmtVehicleRange(von, bis) {
  const v = (von || '').trim();
  const b = (bis || '').trim();
  if (!v && !b) return '';
  if (b === '.' || b === '' || b === '-') return v ? `seit ${v}` : '';
  return v ? `${v} – ${b}` : b;
}

function VehicleList({ items, onSelect }) {
  return (
    <ul className="veh-list">
      {items.map(v => (
        <li
          key={v.FZ}
          className="veh-row"
          onClick={() => onSelect(v.FZ)}
          title={`Bulletins zu ${v.INTBEZEICH || v.BEZEICH || v.FZ} anzeigen`}
        >
          <span className="veh-code">{v.FZ}</span>
          <span className="veh-name">
            <strong>{v.INTBEZEICH || v.BEZEICH || '—'}</strong>
            {v.BEZEICH && v.INTBEZEICH &&
              v.BEZEICH.toLowerCase() !== v.INTBEZEICH.toLowerCase() && (
                <span className="veh-alias"> · {v.BEZEICH}</span>
              )}
          </span>
          <span className="veh-range">{fmtVehicleRange(v.VON, v.BIS)}</span>
          <span className="veh-arrow" aria-hidden="true">→</span>
        </li>
      ))}
    </ul>
  );
}

function ModelCardGrid({ groups, showCarImages, carImages, onChangeCat }) {
  return (
    <div className="cat-grid">
      {groups.map(g => {
        const slug = showCarImages ? modelSlug(g.model) : null;
        const imageFile = showCarImages && carImages ? carImages[slug] : null;
        return (
          <button
            key={g.model}
            className={'cat-card' + (showCarImages ? ' has-image' : '')}
            onClick={() => onChangeCat(g.model)}
            title={`${g.items.length} Generation${g.items.length === 1 ? '' : 'en'}`}
          >
            <span className="cat-card-count">{g.items.length}</span>
            {showCarImages && (
              <span className={'cat-card-image' + (imageFile ? ' has-photo' : '')}>
                <CarIcon
                  type={carTypeFor(g.model)}
                  src={imageFile ? carImageUrl(imageFile) : null}
                  alt={g.model}
                  className="car-icon"
                />
              </span>
            )}
            <span className="cat-card-name">{g.model}</span>
            <span className="cat-card-foot">
              Generationen ansehen <span aria-hidden="true">→</span>
            </span>
          </button>
        );
      })}
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
