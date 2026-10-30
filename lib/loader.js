const path = require('path');
const fs = require('fs');
const { readAllRecords } = require('./dbfReader');
const { createYielder, TICK_MASK } = require('./cooperative');

function normStr(v) {
  if (v == null) return '';
  if (typeof v !== 'string') return v;
  return v.replace(/\u0000+/g, '').trim();
}

function normRec(r) {
  const out = {};
  for (const k of Object.keys(r)) {
    let v = r[k];
    if (typeof v === 'string') v = normStr(v);
    out[k] = v;
  }
  return out;
}

/**
 * Eine DBF-Datei lesen und normalisieren.
 *
 * Fehlt die Datei oder lässt sie sich nicht lesen, kommt eine leere Liste
 * zurück: eine halbe Datenbank ist besser als keine. Damit dieser
 * Großmut nicht zum stillen Datenverlust wird, meldet `onResult` jeden
 * Ausgang an den Aufrufer, der daraus das Leseprotokoll baut.
 *
 * @param {string} filePath
 * @param {Function} [tick]
 * @param {(info:{file:string, path:string, status:'ok'|'missing'|'error', records:number, ms:number, error?:string, code?:string})=>void} [onResult]
 * @returns {Promise<Array<object>>}
 */
async function readDBF(filePath, tick, onResult) {
  const t0 = Date.now();
  const file = path.basename(filePath);
  const report = (status, records, extra) => {
    if (onResult) onResult({ file, path: filePath, status, records, ms: Date.now() - t0, ...extra });
  };

  if (!fs.existsSync(filePath)) {
    report('missing', 0);
    return [];
  }
  try {
    const { records } = await readAllRecords(filePath, { tick });
    // Normalising allocates a fresh object per record, which is another
    // 300k-iteration loop on the big tables — keep it cooperative too.
    const out = new Array(records.length);
    for (let i = 0; i < records.length; i++) {
      if (tick && (i & TICK_MASK) === 0) await tick();
      out[i] = normRec(records[i]);
    }
    report('ok', out.length);
    return out;
  } catch (e) {
    report('error', 0, { error: e.message, code: e.code });
    return [];
  }
}

function keyOf(rec, keys) {
  return keys.map(k => (rec[k] == null ? '' : String(rec[k]))).join('\x1f');
}

/**
 * Apply one delta file to the merged map.
 *
 * @param {Map<string,object>} baseMap
 * @param {Array<object>} deltaRecs
 * @param {Array<string>} keys
 * @param {Array<string>} [stripFields]
 * @param {((change:{action:'add'|'update'|'remove'|'rename', key:string, oldKey?:string, rec:object, prev:object|undefined})=>void)} [onChange]
 *        Called for every record the delta actually changes. Used to build
 *        the update history; omitted (and thus free) when history is off.
 */
function applyDelta(baseMap, deltaRecs, keys, stripFields = ['UPAKTION', 'OLDKEY'], onChange) {
  for (const raw of deltaRecs) {
    const rec = { ...raw };
    const action = rec.UPAKTION;
    const oldKey = rec.OLDKEY;
    stripFields.forEach(f => delete rec[f]);

    if (action === '2') {
      // UPAKTION 2 carries OLDKEY and covers two different things:
      //   OLDKEY == the record's own key  → the record is withdrawn
      //   OLDKEY != the record's own key  → it was renumbered (e.g.
      //                                     23-2141 became 2141/23)
      // Treating both as a plain delete drops renumbered records on the
      // floor, so a rename re-inserts the record under its new key.
      const selfKey = keyOf(rec, keys);
      const trimmedOld = oldKey ? String(oldKey).trim() : '';
      const delKey = trimmedOld
        ? (keys.length === 1 ? trimmedOld : keyOf({ ...rec, [keys[0]]: trimmedOld }, keys))
        : selfKey;
      const prev = baseMap.get(delKey);
      baseMap.delete(delKey);
      if (delKey !== selfKey) {
        baseMap.set(selfKey, rec);
        if (onChange) onChange({ action: 'rename', key: selfKey, oldKey: delKey, rec, prev });
      } else if (onChange) {
        onChange({ action: 'remove', key: delKey, rec, prev });
      }
    } else {
      // A non-empty OLDKEY means the record was renamed: drop the old key
      // first, then insert under the new one. That is still an update, not
      // an addition, even though the new key was previously absent.
      let renamed = false;
      if (oldKey && oldKey.trim()) {
        const oldK = keys.length === 1 ? oldKey : keyOf({ ...rec, [keys[0]]: oldKey }, keys);
        renamed = baseMap.delete(oldK);
      }
      const key = keyOf(rec, keys);
      const prev = baseMap.get(key);
      baseMap.set(key, rec);
      if (onChange) {
        onChange({ action: (prev || renamed) ? 'update' : 'add', key, rec, prev });
      }
    }
  }
}

/**
 * Ein Unterverzeichnis der Datenwurzel ansehen, bevor daraus gelesen wird.
 *
 * Trennt die drei Fälle, die später ganz unterschiedliche Antworten
 * verlangen: gibt es nicht, darf ich nicht, ist da. Genau diese
 * Unterscheidung fehlt, wenn der Lader stillschweigend leere Listen
 * liefert.
 *
 * @param {string} dir
 * @returns {{path:string, status:'ok'|'missing'|'unreadable', files:number, error?:string, code?:string}}
 */
function describeDir(dir) {
  try {
    return { path: dir, status: 'ok', files: fs.readdirSync(dir).length };
  } catch (err) {
    return {
      path: dir,
      status: err.code === 'ENOENT' ? 'missing' : 'unreadable',
      files: 0,
      error: err.message,
      code: err.code,
    };
  }
}

/**
 * Hebt die Zeilen auf, die die Update-Kette aus einer Stammtabelle
 * entfernt hat ("Grabsteine").
 *
 * Hintergrund: Ford nimmt ausgelaufene Modelle aus FO_FZ heraus, lässt die
 * Verknüpfungen in FO_AKT_FZ aber stehen. 2024 bis 2026 trifft das 14 Codes
 * an gut 8.400 Zuordnungen, darunter die gesamten Nutzfahrzeuge. Ohne
 * Stammzeile bleibt in der Oberfläche nur die nackte Nummer, obwohl die
 * Löschzeile den Namen mitbringt.
 *
 * Der Grabstein gilt nur, solange der Schlüssel tot ist. Jede spätere Zeile
 * zu demselben Schlüssel räumt ihn weg, egal ob sie ihn wiederbelebt oder
 * neu vergibt: wird "056" eines Tages ein anderes Modell, steht dieses in
 * der lebenden Tabelle, der Grabstein ist fort, und selbst wenn nicht,
 * fragen Store und Oberfläche immer zuerst die lebende Tabelle.
 *
 * @param {string} keyField Spalte, unter der der Schlüssel wieder eingesetzt
 *   wird, damit eine entfernte Zeile ihren eigenen Code behält.
 * @returns {{ collect: (file:string, changes:Array<object>) => void, rows: () => Array<object> }}
 */
function createRetirementTracker(keyField) {
  const tombs = new Map();
  return {
    collect(file, changes) {
      for (const c of changes) {
        if (c.action === 'remove') {
          // c.prev ist die zuletzt gültige Zeile. Fehlt sie, weil derselbe
          // Schlüssel zweimal zurückgezogen wurde, tut es der frühere
          // Grabstein, und zur Not die Löschzeile selbst: auch sie führt
          // den Namen mit.
          const last = c.prev || tombs.get(c.key) || c.rec;
          tombs.set(c.key, { ...last, [keyField]: c.key, former: { file } });
        } else if (c.action === 'rename') {
          // Umbenannt heißt: den alten Schlüssel gibt es nicht mehr, den
          // Inhalt schon. Wer noch auf den alten zeigt, soll erfahren,
          // wohin er gewandert ist.
          const last = c.prev || c.rec;
          tombs.set(c.oldKey, { ...last, [keyField]: c.oldKey, former: { file, renamedTo: c.key } });
          tombs.delete(c.key);
        } else {
          tombs.delete(c.key);
        }
      }
    },
    rows() {
      return [...tombs.values()];
    },
  };
}

function listUpdateFiles(updateDir, prefix) {
  if (!fs.existsSync(updateDir)) return [];
  const regex = new RegExp('^' + prefix + '(\\d+)\\.dbf$', 'i');
  const matches = [];
  for (const f of fs.readdirSync(updateDir)) {
    const m = f.match(regex);
    if (m) matches.push({ file: f, seq: m[1] });
  }
  matches.sort((a, b) => a.seq.localeCompare(b.seq));
  return matches.map(m => path.join(updateDir, m.file));
}

async function loadAndMerge({ baseFile, prefix, keys }, datenDir, updateDir, onFileChanges, tick, track = {}) {
  const { report, logger, table, quiet = false } = track;
  const t0 = Date.now();
  const basePath = path.join(datenDir, baseFile);

  /** @type {{status:string, error?:string, code?:string}} */
  let base = { status: 'ok' };
  const baseRecs = await readDBF(basePath, tick, (info) => { base = info; });

  const map = new Map();
  let n = 0;
  for (const r of baseRecs) {
    if (tick && (n++ & TICK_MASK) === 0) await tick();
    const copy = { ...r };
    delete copy.UPAKTION;
    delete copy.OLDKEY;
    map.set(keyOf(copy, keys), copy);
  }

  const updateFiles = listUpdateFiles(updateDir, prefix);
  let deltaCount = 0;
  let updatesApplied = 0;
  for (const uf of updateFiles) {
    try {
      if (tick) await tick();
      const delta = await readDBF(uf, tick, (info) => {
        if (info.status === 'error' && report) {
          report.addUpdateFailure(info.file, { message: info.error, code: info.code });
        }
      });
      deltaCount += delta.length;
      updatesApplied++;
      const changes = onFileChanges ? [] : null;
      applyDelta(map, delta, keys, undefined, changes ? c => changes.push(c) : undefined);
      if (changes) onFileChanges(path.basename(uf), changes);
    } catch (e) {
      if (report) report.addUpdateFailure(path.basename(uf), e);
      if (logger) logger.warn({ file: path.basename(uf), err: e.message, code: e.code }, 'update file skipped');
    }
  }

  const info = {
    table,
    file: baseFile,
    status: base.status,
    records: baseRecs.length,
    updates: updatesApplied,
    deltaRecords: deltaCount,
    merged: map.size,
    ms: Date.now() - t0,
    error: base.error,
    code: base.code,
  };
  if (report) report.addTable(info);
  if (logger) {
    // Ein fehlendes oder kaputtes Basisfile ist der Anfang jeder späteren
    // Suche nach „warum ist der Bestand leer"; deshalb laut, und nicht
    // erst in der Zusammenfassung.
    if (base.status === 'missing') {
      logger[quiet ? 'debug' : 'warn']({ ...info, path: basePath }, 'base table missing');
    } else if (base.status === 'error') {
      logger.error({ ...info, path: basePath }, 'reading a base table failed');
    } else {
      logger.debug(info, 'table read');
    }
  }
  return [...map.values()];
}

const SCHEMA = {
  aktion:     { baseFile: 'FO_AKTION.DBF',    prefix: 'FO_UA',  keys: ['A_CODE'] },
  aktFz:      { baseFile: 'FO_AKT_FZ.DBF',    prefix: 'FO_UAF', keys: ['A_CODE', 'FZ', 'REPGRUP'] },
  fz:         { baseFile: 'FO_FZ.DBF',        prefix: 'FO_UF',  keys: ['FZ'] },
  formulare:  { baseFile: 'FO_Formulare.DBF', prefix: 'FO_UFo', keys: ['A_CODE', 'FORMULAR'] },
  symptom:    { baseFile: 'FO_SYMPTOM.DBF',   prefix: 'FO_USY', keys: ['A_CODE', 'FZ', 'SCODE'] },
  saetze:     { baseFile: 'FO_Saetze.dbf',    prefix: 'FO_USa', keys: ['A_CODE'] },
  scode:      { baseFile: 'FO_Scode.DBF',     prefix: 'FO_USc', keys: ['SCODE'] },
  schlagwort: { baseFile: 'FO_Schlagwort.DBF',prefix: 'FO_USw', keys: ['WORT', 'A_CODE'] },
  repNGrup:   { baseFile: 'FO_REPNGRUP.DBF',  prefix: 'FO_UnR', keys: ['GRUPPE', 'NR'] },
  repGrup:    { baseFile: 'FO_REPGRUP.DBF',   prefix: 'FO_Urp', keys: ['NR'] },
};

/** Static lookup tables that don't have delta updates. */
const STATIC_FILES = [
  { name: 'htn',      file: 'FO_HTN.DBF' },
  { name: 'htnGrup',  file: 'FO_HTN_GR.DBF' },
  { name: 'htnRepg',  file: 'FO_HTNREPG.DBF' },
  { name: 'kbc',      file: 'FO_KBC.DBF' },
  { name: 'kbcGrup',  file: 'FO_KBC_GR.DBF' },
  { name: 'kbcHgrup', file: 'FO_KBC_HGR.DBF' },
  { name: 'rep2Grup', file: 'FO_REP2GRUP.DBF' },
];

/**
 * Read all DBF data into memory, applying any delta updates.
 *
 * @param {string} rootDir  Directory containing Daten/ and Update/.
 * @param {((step:{stage:string,name:string,current:number,total:number})=>void)} [onProgress]
 *        Called with a progress update before each file/stage so callers
 *        can surface load progress (e.g. in a /api/status response while
 *        the server is still warming up).
 * @param {{ changeLog?: Array<object>|null, report?: import('./data/ReadReport').ReadReport|null, logger?: import('pino').BaseLogger|null }} [opts]
 *        Pass an array as `changeLog` to have the bulletin table's delta
 *        changes recorded into it (one entry per changed A_CODE per update
 *        file). Left out, nothing is tracked and nothing is allocated.
 *        `report` sammelt, was gelesen wurde und was nicht; `logger`
 *        schreibt jeden Fehlschlag sofort mit, damit ein langer Lauf
 *        nicht erst am Ende verrät, wo es klemmt.
 * @returns {Promise<object>}
 */
async function loadAll(rootDir, onProgress, {
  changeLog = null, tick = createYielder(), report = null, logger = null,
} = {}) {
  const datenDir = path.join(rootDir, 'Daten');
  const updateDir = path.join(rootDir, 'Update');

  // Zuerst die Verzeichnisse selbst, dann die Dateien darin. Fehlt Daten/,
  // ist das eine Zeile im Protokoll und nicht siebzehn Mal "Datei fehlt":
  // ein Protokoll, das man erst filtern muss, liest im Ernstfall niemand.
  const daten = describeDir(datenDir);
  if (report) {
    report.addDir('Daten', daten);
    report.addDir('Update', describeDir(updateDir));
    report.addDir('Formulare', describeDir(path.join(rootDir, 'Formulare')));
    if (logger) {
      for (const [name, info] of Object.entries(report.dirs)) {
        if (info.status === 'ok') continue;
        const line = { dir: name, ...info };
        if (name === 'Daten') logger.error(line, 'the data directory is not readable');
        else logger.warn(line, 'optional data directory is not readable');
      }
    }
  }
  // Ist Daten/ schon weg, sagt jede einzelne fehlende Tabelle dasselbe
  // noch einmal. Ins Protokoll kommen sie dann nur noch auf debug, im
  // Bericht stehen sie weiterhin vollständig.
  const quiet = daten.status !== 'ok';

  const schemaEntries = Object.entries(SCHEMA);
  const total = schemaEntries.length + STATIC_FILES.length + 1; // +1 for indexing
  const reportProgress = (stage, name, current) => {
    if (onProgress) onProgress({ stage, name, current, total });
  };

  const fzRetired = createRetirementTracker('FZ');

  const out = {};
  let i = 0;
  for (const [name, cfg] of schemaEntries) {
    reportProgress('loading', cfg.baseFile, i);
    // Only the bulletin table feeds the history: it is the one users
    // search for, and the one whose codes appear in the UI.
    const collect = name === 'fz' ? fzRetired.collect : changeLog && name === 'aktion'
      ? (file, changes) => {
          for (const c of changes) {
            const src = c.action === 'remove' ? (c.prev || c.rec) : c.rec;
            const gone = c.action === 'remove' || c.action === 'rename';
            changeLog.push({
              file,
              action: c.action,
              code: c.action === 'remove' ? c.key : (c.rec.A_CODE || c.key),
              oldCode: c.action === 'rename' ? c.oldKey : '',
              title: src.K_BEZEICH || src.BAUZEIT || '',
              date: src.A_DAT || '',
              // Keep the whole record for codes that stop resolving. It is
              // the only remaining copy: K_BEZEICH is capped at 90 chars by
              // the KIAS schema, so the real text lives in the BESCHREIB
              // memo, and that would be lost with the record. Live records
              // are not retained here — they stay in the merged table.
              record: gone ? (c.prev || c.rec) : null,
            });
          }
        }
      : undefined;
    out[name] = await loadAndMerge(cfg, datenDir, updateDir, collect, tick,
      { report, logger, table: name, quiet });
    i++;
  }
  // Als eigene Tabelle und nicht als Beiwerk an fz: so bekommt sie den
  // Suchblob wie jede andere, und counts() zählt sie mit.
  out.fzRetired = fzRetired.rows();
  for (const s of STATIC_FILES) {
    reportProgress('loading', s.file, i);
    const t0 = Date.now();
    try {
      out[s.name] = await readDBF(path.join(datenDir, s.file), tick, (info) => {
        const entry = {
          table: s.name,
          file: s.file,
          status: info.status,
          records: info.records,
          updates: 0,
          deltaRecords: 0,
          merged: info.records,
          ms: info.ms,
          error: info.error,
          code: info.code,
        };
        if (report) report.addTable(entry);
        if (logger && info.status === 'error') {
          logger.error({ ...entry, path: info.path }, 'reading a lookup table failed');
        } else if (logger && info.status === 'missing') {
          logger[quiet ? 'debug' : 'warn']({ ...entry, path: info.path }, 'lookup table missing');
        }
      });
    } catch (e) {
      if (report) {
        report.addTable({
          table: s.name, file: s.file, status: 'error', records: 0,
          updates: 0, deltaRecords: 0, merged: 0, ms: Date.now() - t0,
          error: e.message, code: e.code,
        });
      }
      if (logger) logger.error({ file: s.file, err: e.message }, 'reading a lookup table failed');
      out[s.name] = [];
    }
    i++;
  }
  // `indexing` is the final step — the caller (Store.load) builds indexes
  // after we return. We pre-emit a progress event so the UI sees the
  // "Indizes aufbauen" stage.
  reportProgress('indexing', 'Indizes aufbauen', i);
  return out;
}

module.exports = { loadAll, readDBF, SCHEMA, createRetirementTracker };
