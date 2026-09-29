/**
 * Fingerprint of the data directory.
 *
 * neo-KIAS runs unauthenticated on a shared server, where "neu einlesen"
 * is a button anyone can press. Re-reading takes seconds locally and up
 * to two minutes from a network share, so pressing it when nothing
 * changed is pure waste, and several people pressing it in a row used to
 * mean several full re-reads.
 *
 * Instead of trusting the click, we look at the files: name, size and
 * modification time of everything the loader reads (`.dbf` with their
 * `.fpt`/`.dbt` memo companions). Index files (`.cdx`) are ignored, the
 * loader never opens them. The values are hashed into one short digest;
 * an identical digest means an identical read, so the reload can be
 * skipped.
 *
 * Timestamps can lie: a copy tool that preserves mtime and size would
 * hide a changed file. That is why `/api/reload?force=true` exists.
 *
 * @module data/DataFingerprint
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Files the loader actually opens. */
const RELEVANT = /\.(dbf|fpt|dbt)$/i;

/** Subdirectories of the data root that hold them. */
const DIRS = ['Daten', 'Update'];

/**
 * Build the fingerprint of a data root.
 *
 * Never throws: an unreadable directory simply contributes nothing,
 * which changes the digest and therefore triggers a reload rather than
 * hiding the problem.
 *
 * @param {string} rootDir
 * @returns {{ digest: string, files: number, ms: number, dirs: Record<string, {status:string, files:number, code?:string}> }}
 */
function fingerprintDataDir(rootDir) {
  const t0 = Date.now();
  const hash = crypto.createHash('sha1');
  let files = 0;
  /** @type {Record<string, {status:string, files:number, code?:string}>} */
  const dirs = {};

  for (const dir of DIRS) {
    const full = path.join(rootDir, dir);
    let names;
    try {
      names = fs.readdirSync(full).sort();
    } catch (err) {
      // Der Fehlschlag wandert in den Hash, damit ein später wieder
      // erreichbares Verzeichnis als Änderung gilt. Warum er auftrat,
      // gehört aber nach draußen: "fehlt" und "keine Rechte" führen zu
      // ganz verschiedenen Handgriffen.
      hash.update(`${dir}:missing\n`);
      dirs[dir] = {
        status: err.code === 'ENOENT' ? 'missing' : 'unreadable',
        files: 0,
        code: err.code,
      };
      continue;
    }
    dirs[dir] = { status: 'ok', files: 0 };
    for (const name of names) {
      if (!RELEVANT.test(name)) continue;
      try {
        const st = fs.statSync(path.join(full, name));
        if (!st.isFile()) continue;
        // Size and mtime together catch every realistic edit: a new
        // update file, a replaced base table, a re-run of the KIAS
        // updater.
        hash.update(`${dir}/${name}:${st.size}:${st.mtimeMs}\n`);
        files++;
        dirs[dir].files++;
      } catch {
        hash.update(`${dir}/${name}:unreadable\n`);
      }
    }
  }

  return { digest: hash.digest('hex'), files, ms: Date.now() - t0, dirs };
}

module.exports = { fingerprintDataDir };
