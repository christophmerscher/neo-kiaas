/**
 * Update history ("Änderungen") for the bulletin table.
 *
 * KIAS ships its data as a base file plus a numbered chain of delta files
 * (FO_UA25022.dbf, FO_UA26007.dbf, …). Merging them yields the current
 * state and throws the journey away: a bulletin that was added in one
 * update and deleted in a later one simply isn't there, with nothing to
 * explain where it went. `25SC4` is the case that prompted this module.
 *
 * The loader hands us every change it applied to the bulletin table. Here
 * they are grouped per update file and enriched with that update's
 * metadata from FO_Up.DBF (its number, and the period it covers), so the
 * UI can render a changelog and answer "this code existed until update
 * 26007".
 *
 * @module data/History
 */

'use strict';

const path = require('path');
const { readDBF } = require('../loader');

/** Titles are display-only; keep the payload small. */
const MAX_TITLE = 160;

/**
 * @typedef {Object} HistoryChange
 * @property {string} code   A_CODE that changed
 * @property {string} title  Last known title (K_BEZEICH, else BAUZEIT)
 * @property {string} date   A_DAT of the record
 */

/**
 * @typedef {Object} HistoryUpdate
 * @property {string} seq      Sequence as it appears in the filename, e.g. "26007"
 * @property {string} file     Delta filename
 * @property {string} label    Human-readable number, e.g. "07 / 2026"
 * @property {string} from     Period start (ERSTELLT from FO_Up.DBF), may be ''
 * @property {string} to       Period end (ABSCHLUSS), may be ''
 * @property {Array<HistoryChange>} added
 * @property {Array<HistoryChange>} updated
 * @property {Array<HistoryChange>} removed
 * @property {Array<HistoryChange & {from:string}>} renamed  Renumbered, `from` is the old code
 */

/** Sequence out of "FO_UA26007.dbf" → "26007". */
function seqOf(file) {
  const m = /(\d+)\.dbf$/i.exec(file);
  return m ? m[1] : file;
}

/** "26007" → "07 / 2026". Falls back to the raw sequence for odd numbering. */
function labelOf(seq) {
  const m = /^(\d{2})(\d{3})$/.exec(seq);
  return m ? `${m[2]} / 20${m[1]}` : seq;
}

function trim(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > MAX_TITLE ? t.slice(0, MAX_TITLE) + '…' : t;
}

/**
 * Read the update catalogue KIAS maintains next to the delta files. Each
 * row describes one update (number, year, and the period it covers).
 *
 * @param {string} updateDir
 * @returns {Promise<Map<string, {from:string, to:string}>>} keyed by sequence
 */
async function readUpdateCatalogue(updateDir) {
  const bySeq = new Map();
  let rows = [];
  try {
    rows = await readDBF(path.join(updateDir, 'FO_Up.DBF'));
  } catch {
    return bySeq;  // catalogue is optional; the chain works without it
  }
  for (const r of rows) {
    const seq = `${r.JAHR || ''}${r.NUMMER || ''}`;
    if (!seq.trim()) continue;
    bySeq.set(seq, { from: r.ERSTELLT || '', to: r.ABSCHLUSS || '' });
  }
  return bySeq;
}

/**
 * Build the history from the loader's raw change log.
 *
 * @param {Array<{file:string, action:'add'|'update'|'remove', code:string, title:string, date:string}>} changeLog
 * @param {string} updateDir
 * @returns {Promise<{
 *   updates: Array<HistoryUpdate>,
 *   formerByCode: Map<string, {kind:'removed'|'renamed', code:string, newCode:string, title:string, date:string, updateSeq:string, updateLabel:string, updateAt:string}>,
 *   totals: { updates:number, added:number, updated:number, removed:number, renamed:number, gone:number },
 * }>}
 */
async function buildHistory(changeLog, updateDir) {
  const catalogue = await readUpdateCatalogue(updateDir);

  /** @type {Map<string, HistoryUpdate>} */
  const byFile = new Map();
  /** Last action seen per code, in chain order — decides what is gone now. */
  const lastByCode = new Map();

  for (const c of changeLog) {
    let u = byFile.get(c.file);
    if (!u) {
      const seq = seqOf(c.file);
      const meta = catalogue.get(seq) || { from: '', to: '' };
      u = {
        seq,
        file: c.file,
        label: labelOf(seq),
        from: meta.from,
        to: meta.to,
        added: [],
        updated: [],
        removed: [],
        renamed: [],
      };
      byFile.set(c.file, u);
    }
    const entry = { code: c.code, title: trim(c.title), date: c.date || '' };
    if (c.action === 'add') u.added.push(entry);
    else if (c.action === 'remove') u.removed.push(entry);
    else if (c.action === 'rename') u.renamed.push({ ...entry, from: c.oldCode });
    else u.updated.push(entry);

    lastByCode.set(c.code, { action: c.action, entry, update: u, record: c.record });
    // A renumbered record leaves its old code behind: remember that too,
    // so searching the old code can point at the new one.
    if (c.action === 'rename' && c.oldCode) {
      lastByCode.set(c.oldCode, {
        action: 'renamed-away', entry, update: u, to: c.code, record: c.record,
      });
    }
  }

  // Newest update first, matching how the page reads.
  const updates = [...byFile.values()].sort((a, b) => b.seq.localeCompare(a.seq));
  for (const u of updates) {
    for (const list of [u.added, u.updated, u.removed, u.renamed]) {
      list.sort((a, b) => a.code.localeCompare(b.code));
    }
  }

  // Codes that no longer resolve, and why. Only the last action per code
  // counts: something withdrawn and re-added later is simply there again.
  const formerByCode = new Map();
  for (const [code, last] of lastByCode) {
    if (last.action !== 'remove' && last.action !== 'renamed-away') continue;
    formerByCode.set(code.toUpperCase(), {
      kind: last.action === 'remove' ? 'removed' : 'renamed',
      code,
      newCode: last.to || '',
      title: last.entry.title,
      date: last.entry.date,
      updateSeq: last.update.seq,
      updateLabel: last.update.label,
      updateAt: last.update.to || last.update.from || '',
      // Last known full record, so the detail view can still show the
      // complete text of a bulletin that no longer exists.
      record: last.record || null,
    });
  }

  const sum = (key) => updates.reduce((n, u) => n + u[key].length, 0);
  const totals = {
    updates: updates.length,
    added: sum('added'),
    updated: sum('updated'),
    removed: sum('removed'),
    renamed: sum('renamed'),
    gone: [...formerByCode.values()].filter(e => e.kind === 'removed').length,
  };

  return { updates, formerByCode, totals };
}

module.exports = { buildHistory };
