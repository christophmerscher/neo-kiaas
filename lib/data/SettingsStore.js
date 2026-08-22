/**
 * Einstellungen, die zur Laufzeit verstellt werden können.
 *
 * Bisher gab es nur die `.env`, und die ist beim Start eingefroren. Was
 * die Verwaltung ändern darf, muss den Neustart eines Containers
 * überleben, deshalb liegt es in Postgres.
 *
 * Die Datenbank ist optional. Ohne `DATABASE_URL` läuft alles wie vorher,
 * nur eben unveränderlich: die Verwaltung zeigt den Pfad aus der `.env`
 * an und sagt dazu, dass er sich ohne Datenbank nicht speichern lässt.
 * Damit bleiben `npm start` und ein Compose ohne Verwaltung benutzbar,
 * ohne dass jemand einen Datenbankserver braucht.
 *
 * Gespeichert wird ein winziges Schlüssel-Wert-Paar je Einstellung, kein
 * Abbild der KIAS-Daten: die liest die Anwendung weiterhin direkt aus den
 * DBF-Dateien.
 *
 * @module data/SettingsStore
 */

'use strict';

const { Pool } = require('pg');

/** Bekannte Schlüssel. Alles andere wird abgelehnt, damit die Tabelle nicht wuchert. */
const KEYS = Object.freeze({
  /** Verzeichnis mit Daten/, Update/ und Formulare/, aus Sicht des Servers. */
  DATA_ROOT: 'dataRoot',
});

/** So lange versucht der Start, die Datenbank zu erreichen. */
const CONNECT_ATTEMPTS = 10;
const CONNECT_DELAY_MS = 1500;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class SettingsStore {
  /**
   * @param {{ url: string, logger?: import('pino').BaseLogger }} opts
   */
  constructor({ url, logger }) {
    this.url = url || '';
    this.logger = logger || null;
    /** @type {import('pg').Pool | null} */
    this.pool = null;
    /** @type {boolean} Verbindung steht und die Tabelle ist da. */
    this.ready = false;
    /** @type {string|null} Warum es nicht klappt, für die Verwaltung. */
    this.error = null;
  }

  /** Ob überhaupt eine Datenbank konfiguriert ist. */
  get configured() {
    return this.url !== '';
  }

  /**
   * Verbinden und die Tabelle anlegen.
   *
   * Wird im Hintergrund gerufen, nachdem der Server schon lauscht: der
   * Postgres-Container startet parallel, und ein Fehlschlag darf die
   * Suche nicht aufhalten. Deshalb mehrere Versuche und kein Werfen.
   *
   * @returns {Promise<boolean>} ob die Einstellungen benutzbar sind
   */
  async init() {
    if (!this.configured) {
      this.error = 'DATABASE_URL ist nicht gesetzt';
      return false;
    }
    this.pool = new Pool({
      connectionString: this.url,
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    // Ein Fehler auf einer leerlaufenden Verbindung darf den Prozess
    // nicht beenden; pg wirft ihn sonst als unbehandeltes Ereignis.
    this.pool.on('error', (err) => {
      this.ready = false;
      this.error = err.message;
      if (this.logger) this.logger.warn({ err: err.message }, 'settings database connection lost');
    });

    for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt++) {
      try {
        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS settings (
            key        text PRIMARY KEY,
            value      jsonb NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now(),
            updated_by text
          )
        `);
        this.ready = true;
        this.error = null;
        if (this.logger) this.logger.info({ attempt }, 'settings database ready');
        return true;
      } catch (err) {
        this.error = err.message;
        if (attempt === CONNECT_ATTEMPTS) {
          if (this.logger) {
            this.logger.error(
              { err: err.message, attempts: attempt },
              'settings database unreachable — falling back to the values from .env',
            );
          }
          return false;
        }
        await sleep(CONNECT_DELAY_MS);
      }
    }
    return false;
  }

  /**
   * Wert einer Einstellung, oder null wenn nichts gespeichert ist oder
   * die Datenbank fehlt.
   *
   * @param {string} key
   * @returns {Promise<any|null>}
   */
  async get(key) {
    if (!this.ready) return null;
    try {
      const { rows } = await this.pool.query(
        'SELECT value FROM settings WHERE key = $1', [key],
      );
      return rows.length ? rows[0].value : null;
    } catch (err) {
      this.error = err.message;
      if (this.logger) this.logger.warn({ err: err.message, key }, 'reading a setting failed');
      return null;
    }
  }

  /**
   * Einstellung schreiben.
   *
   * @param {string} key
   * @param {any} value
   * @param {string} [by] Wer es geändert hat, fürs Protokoll.
   * @returns {Promise<{ updatedAt: string }>}
   * @throws wenn keine Datenbank da ist — der Aufrufer soll das der
   *   Verwaltung zeigen und nicht so tun, als sei etwas gespeichert.
   */
  async set(key, value, by) {
    if (!this.ready) {
      throw new Error(
        this.configured
          ? `Die Einstellungsdatenbank antwortet nicht (${this.error || 'unbekannt'}).`
          : 'Ohne Datenbank lässt sich die Einstellung nicht dauerhaft speichern.',
      );
    }
    const { rows } = await this.pool.query(
      `INSERT INTO settings (key, value, updated_by)
            VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value,
                updated_at = now(),
                updated_by = EXCLUDED.updated_by
         RETURNING updated_at`,
      [key, JSON.stringify(value), by || null],
    );
    return { updatedAt: rows[0].updated_at };
  }

  /** Zustand für die Verwaltung. */
  status() {
    return { configured: this.configured, ready: this.ready, error: this.error };
  }

  async close() {
    if (this.pool) await this.pool.end().catch(() => {});
    this.pool = null;
    this.ready = false;
  }
}

module.exports = { SettingsStore, KEYS };
