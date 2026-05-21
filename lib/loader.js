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

async function loadStatic(datenDir) {
  const read = async (f) => {
    try { return await readDBF(path.join(datenDir, f)); }
    catch (e) { console.warn('skip', f, e.message); return []; }
  };
  return {
    htn:       await read('FO_HTN.DBF'),
    htnGrup:   await read('FO_HTN_GR.DBF'),
    htnRepg:   await read('FO_HTNREPG.DBF'),
    kbc:       await read('FO_KBC.DBF'),
    kbcGrup:   await read('FO_KBC_GR.DBF'),
    kbcHgrup:  await read('FO_KBC_HGR.DBF'),
    rep2Grup:  await read('FO_REP2GRUP.DBF'),
  };
}

async function loadAll(rootDir) {
  const datenDir = path.join(rootDir, 'Daten');
  const updateDir = path.join(rootDir, 'Update');
  const out = {};
  for (const [name, cfg] of Object.entries(SCHEMA)) {
    out[name] = await loadAndMerge(cfg, datenDir, updateDir);
  }
  const statics = await loadStatic(datenDir);
  Object.assign(out, statics);
  return out;
}

module.exports = { loadAll, readDBF, SCHEMA };
