/**
 * Builds the in-memory lookup tables ("indexes") used by the search and
 * detail endpoints. Pure function: given a snapshot of loaded DBF data, it
 * returns a frozen bag of Maps keyed by A_CODE / FZ / SCODE / etc.
 *
 * Keeping this as a stateless function (rather than a class) keeps testing
 * trivial — pass synthetic data, assert the returned maps.
 *
 * @module data/Indexes
 */

'use strict';

/**
 * @typedef {Object} StoreData
 * @property {Array<object>} aktion       FO_AKTION rows
 * @property {Array<object>} aktFz        FO_AKT_FZ rows
 * @property {Array<object>} fz           FO_FZ rows
 * @property {Array<object>} formulare    FO_Formulare rows
 * @property {Array<object>} symptom      FO_SYMPTOM rows
 * @property {Array<object>} saetze       FO_Saetze rows
 * @property {Array<object>} scode        FO_Scode rows
 * @property {Array<object>} schlagwort   FO_Schlagwort rows
 * @property {Array<object>} repNGrup     FO_REPNGRUP rows
 * @property {Array<object>} repGrup      FO_REPGRUP rows
 * @property {Array<object>} [rep2Grup]   FO_REP2GRUP rows
 */

/**
 * @typedef {Object} StoreIndexes
 * @property {Map<string,object>} fzByCode
 * @property {Map<string,object>} scodeByCode
 * @property {Map<string,object>} repGrupByNr
 * @property {Map<string,object>} repNGrupByNr          FO_REPNGRUP-Untergruppe je NR
 * @property {Map<string,string>} repNGrupHeadByGruppe  GRUPPE → Text der Hauptgruppe
 * @property {Map<string,object>} rep2GrupByNr
 * @property {Map<string,Set<string>>} vehiclesByCode   A_CODE → set of FZ codes
 * @property {Map<string,Set<string>>} repGrupsByCode    A_CODE → set of REPGRUP nrs (alt)
 * @property {Map<string,Set<string>>} repNGrupsByCode   A_CODE → set of WREPGRUP nrs (neu)
 * @property {Map<string,Set<string>>} symptomsByCode    A_CODE → set of SCODEs
 * @property {Map<string,Array<string>>} formsByCode      A_CODE → ordered list of FORMULAR filenames
 * @property {Map<string,Array<string>>} keywordsByCode   A_CODE → list of Schlagworte
 * @property {Map<string,Set<string>>} keywordsByWord     lowercased WORT → set of A_CODEs
 * @property {Map<string,object>} saetzeByCode
 * @property {Map<string,object>} aktionByCode
 * @property {Map<string,Set<string>>} aCodesByFz       FZ → set of A_CODEs that mention it
 * @property {Map<string,Set<string>>} aCodesByScode    SCODE → set of A_CODEs
 * @property {Map<string,Set<string>>} aCodesByRepGrup  REPGRUP NR → set of A_CODEs
 * @property {Map<string,Set<string>>} aCodesByRepNGrup WREPGRUP NR → set of A_CODEs
 */

/**
 * Build all lookup tables in one pass.
 *
 * @param {StoreData} d
 * @returns {StoreIndexes}
 */
function buildIndexes(d) {
  const fzByCode = new Map();
  d.fz.forEach(r => { if (r.FZ) fzByCode.set(r.FZ, r); });

  const scodeByCode = new Map();
  d.scode.forEach(r => { if (r.SCODE) scodeByCode.set(r.SCODE, r); });

  const repGrupByNr = new Map();
  d.repGrup.forEach(r => { if (r.NR) repGrupByNr.set(r.NR, r); });

  const rep2GrupByNr = new Map();
  (d.rep2Grup || []).forEach(r => { if (r.NR) rep2GrupByNr.set(r.NR, r); });

  // FO_REPNGRUP, die neue Gruppenstruktur, hat zwei Sorten Zeilen: die
  // Hauptgruppe trägt nur GRUPPE und GRTEXT ("4", "Antriebsstrang") und
  // keine NR, die Untergruppen darunter tragen NR und CTEXT ("414-01",
  // "…") und dieselbe GRUPPE. Für einen lesbaren Text braucht man beide,
  // deshalb zwei Zuordnungen.
  const repNGrupByNr = new Map();
  const repNGrupHeadByGruppe = new Map();
  for (const r of (d.repNGrup || [])) {
    if (r.NR) repNGrupByNr.set(r.NR, r);
    else if (r.GRUPPE && r.GRTEXT) repNGrupHeadByGruppe.set(r.GRUPPE, r.GRTEXT);
  }

  // FO_AKT_FZ: bulletin ↔ vehicle ↔ repair-group links. Build forward and
  // reverse lookups in one sweep.
  // Jede Zeile trägt entweder die alte Gruppe in REPGRUP oder die neue in
  // WREPGRUP, nie beide: nachgezählt über alle 317.837 Zeilen des
  // Bestands sind es 152.084 alte, 163.111 neue und null gemischte. Wer
  // nur REPGRUP auswertet, lässt also gut die Hälfte der Einordnung
  // liegen, und zwar ausgerechnet die neuere.
  const vehiclesByCode = new Map();
  const repGrupsByCode = new Map();
  const repNGrupsByCode = new Map();
  const aCodesByFz = new Map();
  const aCodesByRepGrup = new Map();
  const aCodesByRepNGrup = new Map();
  for (const r of d.aktFz) {
    if (!r.A_CODE) continue;
    if (!vehiclesByCode.has(r.A_CODE)) vehiclesByCode.set(r.A_CODE, new Set());
    if (r.FZ) {
      vehiclesByCode.get(r.A_CODE).add(r.FZ);
      if (!aCodesByFz.has(r.FZ)) aCodesByFz.set(r.FZ, new Set());
      aCodesByFz.get(r.FZ).add(r.A_CODE);
    }
    if (r.REPGRUP) {
      if (!repGrupsByCode.has(r.A_CODE)) repGrupsByCode.set(r.A_CODE, new Set());
      repGrupsByCode.get(r.A_CODE).add(r.REPGRUP);
      if (!aCodesByRepGrup.has(r.REPGRUP)) aCodesByRepGrup.set(r.REPGRUP, new Set());
      aCodesByRepGrup.get(r.REPGRUP).add(r.A_CODE);
    }
    if (r.WREPGRUP) {
      if (!repNGrupsByCode.has(r.A_CODE)) repNGrupsByCode.set(r.A_CODE, new Set());
      repNGrupsByCode.get(r.A_CODE).add(r.WREPGRUP);
      if (!aCodesByRepNGrup.has(r.WREPGRUP)) aCodesByRepNGrup.set(r.WREPGRUP, new Set());
      aCodesByRepNGrup.get(r.WREPGRUP).add(r.A_CODE);
    }
  }

  // FO_SYMPTOM: bulletin ↔ symptom-code links
  const symptomsByCode = new Map();
  const aCodesByScode = new Map();
  for (const r of d.symptom) {
    if (!r.A_CODE) continue;
    if (!symptomsByCode.has(r.A_CODE)) symptomsByCode.set(r.A_CODE, new Set());
    if (r.SCODE) {
      symptomsByCode.get(r.A_CODE).add(r.SCODE);
      if (!aCodesByScode.has(r.SCODE)) aCodesByScode.set(r.SCODE, new Set());
      aCodesByScode.get(r.SCODE).add(r.A_CODE);
    }
  }

  const formsByCode = new Map();
  for (const r of d.formulare) {
    if (!formsByCode.has(r.A_CODE)) formsByCode.set(r.A_CODE, []);
    if (r.FORMULAR) formsByCode.get(r.A_CODE).push(r.FORMULAR);
  }

  const keywordsByCode = new Map();
  const keywordsByWord = new Map();
  for (const r of d.schlagwort) {
    if (!keywordsByCode.has(r.A_CODE)) keywordsByCode.set(r.A_CODE, []);
    keywordsByCode.get(r.A_CODE).push(r.WORT);
    const word = (r.WORT || '').toLowerCase();
    if (word) {
      if (!keywordsByWord.has(word)) keywordsByWord.set(word, new Set());
      keywordsByWord.get(word).add(r.A_CODE);
    }
  }

  const saetzeByCode = new Map();
  d.saetze.forEach(r => { if (r.A_CODE) saetzeByCode.set(r.A_CODE, r); });

  const aktionByCode = new Map();
  d.aktion.forEach(r => { if (r.A_CODE) aktionByCode.set(r.A_CODE, r); });

  return Object.freeze({
    fzByCode,
    scodeByCode,
    repGrupByNr,
    rep2GrupByNr,
    repNGrupByNr,
    repNGrupHeadByGruppe,
    vehiclesByCode,
    repGrupsByCode,
    repNGrupsByCode,
    symptomsByCode,
    formsByCode,
    keywordsByCode,
    keywordsByWord,
    saetzeByCode,
    aktionByCode,
    aCodesByFz,
    aCodesByScode,
    aCodesByRepGrup,
    aCodesByRepNGrup,
  });
}

module.exports = { buildIndexes };
