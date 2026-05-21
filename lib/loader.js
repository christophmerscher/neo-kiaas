const path = require('path');
const fs = require('fs');
const { readAllRecords } = require('./dbfReader');

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

async function readDBF(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const { records } = await readAllRecords(filePath);
    return records.map(normRec);
  } catch (e) {
    console.warn(`  readDBF failed for ${path.basename(filePath)}: ${e.message}`);
    return [];
  }
}

function keyOf(rec, keys) {
  return keys.map(k => (rec[k] == null ? '' : String(rec[k]))).join('\x1f');
}

function applyDelta(baseMap, deltaRecs, keys, stripFields = ['UPAKTION', 'OLDKEY']) {
  for (const raw of deltaRecs) {
    const rec = { ...raw };
    const action = rec.UPAKTION;
    const oldKey = rec.OLDKEY;
    stripFields.forEach(f => delete rec[f]);

    if (action === '2') {
      const delKey = oldKey ? oldKey : keyOf(rec, keys);
      baseMap.delete(delKey);
    } else {
      if (oldKey && oldKey.trim()) {
        const oldK = keys.length === 1 ? oldKey : keyOf({ ...rec, [keys[0]]: oldKey }, keys);
        baseMap.delete(oldK);
      }
      baseMap.set(keyOf(rec, keys), rec);
    }
  }
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

async function loadAndMerge({ baseFile, prefix, keys }, datenDir, updateDir) {
  const basePath = path.join(datenDir, baseFile);
  const baseRecs = await readDBF(basePath);
  const map = new Map();
  for (const r of baseRecs) {
    const copy = { ...r };
    delete copy.UPAKTION;
    delete copy.OLDKEY;
    map.set(keyOf(copy, keys), copy);
  }
  const updateFiles = listUpdateFiles(updateDir, prefix);
  let deltaCount = 0;
  for (const uf of updateFiles) {
    try {
      const delta = await readDBF(uf);
      deltaCount += delta.length;
      applyDelta(map, delta, keys);
    } catch (e) {
      console.warn('Skip update', uf, e.message);
    }
  }
  console.log(`[${baseFile}] base=${baseRecs.length} updates=${updateFiles.length} deltaRecs=${deltaCount} merged=${map.size}`);
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
 * @returns {Promise<object>}
 */
async function loadAll(rootDir, onProgress) {
  const datenDir = path.join(rootDir, 'Daten');
  const updateDir = path.join(rootDir, 'Update');
  const schemaEntries = Object.entries(SCHEMA);
  const total = schemaEntries.length + STATIC_FILES.length + 1; // +1 for indexing
  const report = (stage, name, current) => {
    if (onProgress) onProgress({ stage, name, current, total });
  };

  const out = {};
  let i = 0;
  for (const [name, cfg] of schemaEntries) {
    report('loading', cfg.baseFile, i);
    out[name] = await loadAndMerge(cfg, datenDir, updateDir);
    i++;
  }
  for (const s of STATIC_FILES) {
    report('loading', s.file, i);
    try {
      out[s.name] = await readDBF(path.join(datenDir, s.file));
    } catch (e) {
      console.warn('skip', s.file, e.message);
      out[s.name] = [];
    }
    i++;
  }
  // `indexing` is the final step — the caller (Store.load) builds indexes
  // after we return. We pre-emit a progress event so the UI sees the
  // "Indizes aufbauen" stage.
  report('indexing', 'Indizes aufbauen', i);
  return out;
}

module.exports = { loadAll, readDBF, SCHEMA };
