/**
 * Prüfen, ob unter einem Pfad brauchbare KIAS-Daten liegen.
 *
 * Die Verwaltung ruft das, bevor jemand einen Pfad speichert. Ohne diese
 * Prüfung merkt man den Vertipper erst zwei Minuten später an einer leeren
 * Datenbank, und der Fehler sieht dann aus wie „KIAS ist kaputt".
 *
 * Geprüft wird aus Sicht des Servers, nicht aus Sicht des Browsers. Im
 * Container heißt das: der Pfad muss dort hinein gemountet sein, ein
 * Laufwerksbuchstabe vom Arbeitsplatz hilft nicht.
 *
 * @module data/inspectDataRoot
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** Mehr Dateien werden nicht gezählt; das reicht für „da ist etwas". */
const MAX_SCAN = 5000;

/**
 * @typedef {Object} Check
 * @property {string} name    Was geprüft wurde, für die Anzeige.
 * @property {boolean} ok
 * @property {boolean} [required] Ein Fehlschlag hier macht den Pfad unbrauchbar.
 * @property {string} detail  Ergebnis in einem Satz.
 */

/** Ein Verzeichnis, seine Lesbarkeit und die DBF-Dateien darin. */
function inspectDir(dir, { pattern = /\.dbf$/i } = {}) {
  if (!fs.existsSync(dir)) return { exists: false, readable: false, files: 0 };
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch {
    return { exists: true, readable: false, files: 0 };
  }
  if (!stat.isDirectory()) return { exists: true, isDir: false, readable: false, files: 0 };
  try {
    const entries = fs.readdirSync(dir);
    const files = entries.filter(f => pattern.test(f)).slice(0, MAX_SCAN);
    return { exists: true, isDir: true, readable: true, files: files.length, sample: files[0] || null };
  } catch (err) {
    return { exists: true, isDir: true, readable: false, files: 0, error: err.message };
  }
}

/** Tatsächlich in eine Datei hineinlesen, nicht nur ihren Eintrag ansehen. */
function canRead(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, Buffer.alloc(32), 0, 32, 0);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* egal */ }
  }
}

/**
 * Einen Pfad begutachten.
 *
 * @param {string} input Pfad, wie ihn jemand eingetippt hat.
 * @returns {{ ok:boolean, root:string, checks:Check[], summary:string }}
 */
function inspectDataRoot(input) {
  const raw = String(input || '').trim();
  /** @type {Check[]} */
  const checks = [];

  if (!raw) {
    return {
      ok: false, root: '',
      checks: [{ name: 'Pfad', ok: false, required: true, detail: 'Kein Pfad angegeben.' }],
      summary: 'Kein Pfad angegeben.',
    };
  }

  const root = path.resolve(raw);
  const rootInfo = inspectDir(root, { pattern: /.*/ });

  checks.push({
    name: 'Verzeichnis',
    ok: Boolean(rootInfo.exists && rootInfo.isDir !== false && rootInfo.readable),
    required: true,
    detail: !rootInfo.exists
      ? 'Existiert nicht, jedenfalls nicht aus Sicht des Servers.'
      : rootInfo.isDir === false
        ? 'Ist eine Datei, kein Verzeichnis.'
        : !rootInfo.readable
          ? `Nicht lesbar (${rootInfo.error || 'keine Berechtigung'}).`
          : 'Vorhanden und lesbar.',
  });

  const daten = inspectDir(path.join(root, 'Daten'));
  checks.push({
    name: 'Daten/',
    ok: Boolean(daten.readable && daten.files > 0),
    required: true,
    detail: !daten.exists
      ? 'Fehlt. Ohne Daten/ ist der Bestand leer.'
      : !daten.readable
        ? `Nicht lesbar (${daten.error || 'keine Berechtigung'}).`
        : daten.files === 0
          ? 'Vorhanden, enthält aber keine DBF-Datei.'
          : `${daten.files} DBF-Dateien.`,
  });

  if (daten.readable && daten.sample) {
    const probe = canRead(path.join(root, 'Daten', daten.sample));
    checks.push({
      name: 'Leseprobe',
      ok: probe.ok,
      required: true,
      detail: probe.ok
        ? `${daten.sample} ließ sich öffnen und lesen.`
        : `${daten.sample} ließ sich nicht lesen (${probe.error}).`,
    });
  }

  const update = inspectDir(path.join(root, 'Update'));
  checks.push({
    name: 'Update/',
    ok: update.readable,
    detail: !update.exists
      ? 'Fehlt. Zulässig, dann gilt allein der Basisstand.'
      : !update.readable
        ? `Nicht lesbar (${update.error || 'keine Berechtigung'}).`
        : `${update.files} DBF-Dateien.`,
  });

  const formulare = inspectDir(path.join(root, 'Formulare'), { pattern: /.*/ });
  checks.push({
    name: 'Formulare/',
    ok: formulare.readable,
    detail: !formulare.exists
      ? 'Fehlt. Zulässig, dann bleiben Anhänge unerreichbar.'
      : !formulare.readable
        ? `Nicht lesbar (${formulare.error || 'keine Berechtigung'}).`
        : `${formulare.files} Dateien.`,
  });

  const ok = checks.every(c => (c.required ? c.ok : true));
  const failed = checks.filter(c => c.required && !c.ok);
  return {
    ok,
    root,
    checks,
    summary: ok
      ? `Daten gefunden: ${daten.files} DBF-Dateien unter Daten/.`
      : `Nicht benutzbar: ${failed.map(c => c.name).join(', ')}.`,
  };
}

module.exports = { inspectDataRoot };
