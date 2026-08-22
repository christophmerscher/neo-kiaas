/**
 * OpenAPI description of the neo-KIAS HTTP API.
 *
 * Hand-written rather than generated: the API is small, stable and has a
 * few shapes (the archived-bulletin case, the 503 while loading) that no
 * annotation scheme would capture as clearly. Kept next to the routes so
 * the two are edited together.
 *
 * @module api/openapi
 */

'use strict';

const { version } = require('../../package.json');

/** Reusable 503 response: every data route answers this while loading. */
const LOADING_RESPONSE = {
  description: 'Daten werden noch eingelesen. Der Client soll `/api/status` pollen.',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'loading' },
          message: { type: 'string' },
          progress: { $ref: '#/components/schemas/Progress' },
        },
      },
    },
  },
};

/**
 * Build the spec. Taking config in keeps the document honest about
 * features that can be switched off.
 *
 * @param {import('../config')} config
 * @returns {object} OpenAPI 3.0.3 document
 */
function buildOpenApiSpec(config) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'neo-KIAS API',
      version,
      description: [
        'JSON-Schnittstelle der neo-KIAS-Oberfläche. Alle Endpunkte sind',
        'lesend, bis auf `/api/reload`, das die DBF-Dateien neu einliest.',
        '',
        'Solange der Server die Daten einliest, antworten die Datenendpunkte',
        'mit **503**. `/api/status` ist durchgehend erreichbar und liefert',
        'den Fortschritt.',
      ].join('\n'),
      license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
    },
    servers: [{ url: '/', description: 'Dieser Server' }],
    tags: [
      { name: 'Erkennung', description: 'Erreichbarkeit und Gesundheit des Servers' },
      { name: 'Status', description: 'Ladezustand und Neu-Einlesen' },
      { name: 'Aktionen', description: 'Suche und Detailabruf' },
      { name: 'Stammdaten', description: 'Fahrzeuge, Symptomcodes, Updates' },
      { name: 'Dateien', description: 'Formulare und Fahrzeugbilder' },
    ],
    paths: {
      '/api/ping': {
        get: {
          tags: ['Erkennung'],
          summary: 'Antwortet hier ein neo-KIAS?',
          description: [
            'Bewusst winzig und ohne Datenzugriff. Gedacht für die App:',
            'prüft eine eingegebene Serveradresse, bevor es weitergeht.',
            '',
            'Antwortet auch während des Einlesens; `loaded` sagt, ob die',
            'Datenendpunkte schon benutzbar sind.',
          ].join('\n'),
          responses: {
            200: {
              description: 'Der Server lebt',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      pong: { type: 'boolean', example: true },
                      service: { type: 'string', example: 'neo-kias' },
                      version: { type: 'string' },
                      loaded: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/health': {
        get: {
          tags: ['Erkennung'],
          summary: 'Ist dieser Server benutzbar?',
          description: [
            'Für Überwachung und Betrieb gedacht, nicht für die App: der',
            'Docker-Healthcheck nutzt ihn, später ein vorgeschalteter Load',
            'Balancer, sobald die Schnittstelle getrennt von der',
            'Suchoberfläche läuft.',
            '',
            'Antwortet **200** nur bei `status: "ok"`, sonst **503**:',
            '`starting` während des Einlesens, `unhealthy` wenn unter der',
            'Datenwurzel kein `Daten/` liegt.',
          ].join('\n'),
          responses: {
            200: {
              description: 'Server ist benutzbar',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Health' } },
              },
            },
            503: {
              description: 'Server liest noch ein oder findet seine Daten nicht',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Health' } },
              },
            },
          },
        },
      },
      '/api/status': {
        get: {
          tags: ['Status'],
          summary: 'Ladezustand, Zähler und Feature-Schalter',
          description: 'Auch während des Einlesens erreichbar. `rootOk: false` bedeutet, dass unter der Datenwurzel kein `Daten/` liegt.',
          responses: {
            200: {
              description: 'Status',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Status' } } },
            },
          },
        },
      },
      '/api/reload': {
        post: {
          tags: ['Status'],
          summary: 'Daten neu einlesen, wenn sie sich geändert haben',
          description: [
            'Prüft zuerst Größe und Änderungsdatum aller gelesenen Dateien.',
            'Stimmen sie mit dem Stand des letzten Einlesens überein, passiert',
            'nichts und die Antwort kommt sofort (`reload.reason: "unchanged"`).',
            '',
            'Läuft bereits ein Ladevorgang, wird dieser abgewartet, statt einen',
            'zweiten anzustoßen (`"in-progress"`). Antwortet erst nach Abschluss.',
          ].join('\n'),
          parameters: [
            {
              name: 'force', in: 'query', schema: { type: 'boolean' },
              description: 'Einlesen erzwingen, auch ohne erkannte Änderung. Nötig, wenn eine Kopie Größe und Zeitstempel erhalten hat.',
            },
          ],
          responses: {
            200: {
              description: 'Status nach dem Einlesen, ergänzt um das Ergebnis der Prüfung',
              content: {
                'application/json': {
                  schema: {
                    allOf: [
                      { $ref: '#/components/schemas/Status' },
                      {
                        type: 'object',
                        properties: { reload: { $ref: '#/components/schemas/ReloadResult' } },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
      '/api/bulletins': {
        get: {
          tags: ['Aktionen'],
          summary: 'Aktionen suchen und filtern',
          description: 'Volltextsuche über alle verknüpften Tabellen. Ohne Treffer wird geprüft, ob `q` einem zurückgezogenen oder umnummerierten Aktionscode entspricht; dann steht das Ergebnis in `former`.',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Freitext, auch Aktionscode', example: 'getriebe' },
            { name: 'fz', in: 'query', schema: { type: 'string' }, description: 'Fahrzeugcode (siehe /api/vehicles)' },
            { name: 'scode', in: 'query', schema: { type: 'string' }, description: 'Symptomcode (siehe /api/scodes)' },
            { name: 'keyword', in: 'query', schema: { type: 'string' }, description: 'Schlagwort, Teiltreffer' },
            { name: 'yearFrom', in: 'query', schema: { type: 'string' }, description: 'Frühestes Jahr', example: '2024' },
            { name: 'yearTo', in: 'query', schema: { type: 'string' }, description: 'Spätestes Jahr' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 100, maximum: 500 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: {
            200: {
              description: 'Trefferliste',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/BulletinList' } } },
            },
            503: LOADING_RESPONSE,
          },
        },
      },
      '/api/bulletin/{code}': {
        get: {
          tags: ['Aktionen'],
          summary: 'Eine Aktion vollständig',
          description: 'Liefert auch zurückgezogene Aktionen aus dem Archiv, erkennbar am Feld `former`. Verknüpfte Fahrzeuge und Symptomcodes sind dort leer.',
          parameters: [
            { name: 'code', in: 'path', required: true, schema: { type: 'string' }, example: '25SC5' },
          ],
          responses: {
            200: {
              description: 'Aktion',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/BulletinDetail' } } },
            },
            404: { $ref: '#/components/responses/NotFound' },
            503: LOADING_RESPONSE,
          },
        },
      },
      '/api/resolve': {
        get: {
          tags: ['Aktionen'],
          summary: 'Textverweis zu einem Aktionscode auflösen',
          description: 'Wandelt Schreibweisen aus Fließtext, etwa `TSI 60/2010` oder `SSM 54371`, in den zugehörigen Aktionscode um.',
          parameters: [
            { name: 'ref', in: 'query', required: true, schema: { type: 'string' }, example: 'TSI 60/2010' },
          ],
          responses: {
            200: {
              description: 'Aufgelöst',
              content: { 'application/json': { schema: { type: 'object', properties: { resolved: { type: 'string' } } } } },
            },
            400: { $ref: '#/components/responses/BadRequest' },
            404: { $ref: '#/components/responses/NotFound' },
            503: LOADING_RESPONSE,
          },
        },
      },
      '/api/history': {
        get: {
          tags: ['Aktionen'],
          summary: 'Änderungen je Update-Datei',
          description: config.history
            ? 'Was jedes KIAS-Update aufgenommen, geändert, umnummeriert und zurückgezogen hat.'
            : 'Aktuell abgeschaltet (`KIAS_HISTORY=false`): antwortet mit `enabled: false` und einer leeren Liste.',
          responses: {
            200: {
              description: 'Changelog',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/History' } } },
            },
            503: LOADING_RESPONSE,
          },
        },
      },
      '/api/vehicles': {
        get: {
          tags: ['Stammdaten'],
          summary: 'Alle Fahrzeuge',
          responses: {
            200: {
              description: 'Fahrzeugliste',
              content: {
                'application/json': {
                  schema: { type: 'array', items: { $ref: '#/components/schemas/Vehicle' } },
                },
              },
            },
            503: LOADING_RESPONSE,
          },
        },
      },
      '/api/scodes': {
        get: {
          tags: ['Stammdaten'],
          summary: 'Symptomcodes, nach Kategorie gruppiert',
          responses: {
            200: {
              description: 'Kategorien mit Codes',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        KATEGORI: { type: 'string' },
                        entries: { type: 'array', items: { $ref: '#/components/schemas/Scode' } },
                      },
                    },
                  },
                },
              },
            },
            503: LOADING_RESPONSE,
          },
        },
      },
      '/api/updates': {
        get: {
          tags: ['Stammdaten'],
          summary: 'Vorhandene Update-Dateien auf der Platte',
          description: 'Listet die `FO_Inhalt*.dbf` im Update-Verzeichnis mit Änderungsdatum und Größe.',
          responses: {
            200: {
              description: 'Dateiliste',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        file: { type: 'string' },
                        mtime: { type: 'string', format: 'date-time' },
                        size: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
            503: LOADING_RESPONSE,
          },
        },
      },
      '/api/forms/{file}': {
        get: {
          tags: ['Dateien'],
          summary: 'Formular oder Anhang ausliefern',
          description: 'Dateinamen stammen aus `forms` einer Aktion. Pfadanteile werden abgelehnt.',
          parameters: [
            { name: 'file', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Datei', content: { 'application/pdf': {}, 'application/octet-stream': {} } },
            400: { description: 'Ungültiger Dateiname' },
            404: { description: 'Nicht gefunden' },
            503: LOADING_RESPONSE,
          },
        },
      },
      '/api/car-images': {
        get: {
          tags: ['Dateien'],
          summary: 'Vorhandene Fahrzeugbilder',
          description: config.showCarImages
            ? 'Liefert Dateiname und Modell-Slug je Bild.'
            : 'Aktuell abgeschaltet (`KIAS_SHOW_CAR_IMAGES=false`): antwortet mit einer leeren Liste.',
          responses: {
            200: {
              description: 'Bildliste',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: { file: { type: 'string' }, slug: { type: 'string' } },
                    },
                  },
                },
              },
            },
            503: LOADING_RESPONSE,
          },
        },
      },
      '/api/car-images/{file}': {
        get: {
          tags: ['Dateien'],
          summary: 'Ein Fahrzeugbild ausliefern',
          parameters: [
            { name: 'file', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Bild', content: { 'image/png': {}, 'image/webp': {}, 'image/svg+xml': {} } },
            400: { description: 'Ungültiger Dateiname' },
            404: { description: 'Nicht gefunden oder abgeschaltet' },
            503: LOADING_RESPONSE,
          },
        },
      },
    },
    components: {
      responses: {
        NotFound: {
          description: 'Nicht gefunden',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        BadRequest: {
          description: 'Fehlender oder ungültiger Parameter',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: { error: { type: 'string' } },
        },
        Health: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['ok', 'starting', 'unhealthy'],
              description: 'ok: benutzbar. starting: liest ein. unhealthy: Datenwurzel fehlt.',
            },
            service: { type: 'string', example: 'neo-kias' },
            version: { type: 'string' },
            uptimeSeconds: { type: 'integer' },
            checks: {
              type: 'object',
              properties: {
                dataRoot: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    detail: { type: 'string', nullable: true },
                  },
                },
                data: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    loading: { type: 'boolean' },
                    bulletins: { type: 'integer' },
                    loadedAt: { type: 'string', format: 'date-time', nullable: true },
                  },
                },
              },
            },
          },
        },
        ReloadResult: {
          type: 'object',
          properties: {
            reloaded: { type: 'boolean', description: 'Ob tatsächlich gelesen wurde' },
            reason: {
              type: 'string',
              enum: ['unchanged', 'changed', 'forced', 'initial', 'in-progress'],
              description: 'unchanged: Dateien identisch. changed: Dateien haben sich geändert. forced: force=true. initial: erstes Einlesen. in-progress: es lief bereits ein Ladevorgang.',
            },
            files: { type: 'integer', description: 'Anzahl geprüfter Dateien' },
            checkMs: { type: 'integer', description: 'Dauer der Prüfung' },
            digest: { type: 'string', description: 'Fingerabdruck der Dateien' },
          },
        },
        Progress: {
          type: 'object',
          nullable: true,
          description: 'Nur während des Einlesens gefüllt.',
          properties: {
            stage: { type: 'string', enum: ['starting', 'loading', 'indexing'] },
            name: { type: 'string', description: 'Aktuelle Datei' },
            current: { type: 'integer' },
            total: { type: 'integer' },
            elapsedMs: { type: 'integer' },
          },
        },
        Status: {
          type: 'object',
          properties: {
            loaded: { type: 'boolean' },
            loading: { type: 'boolean' },
            loadedAt: { type: 'string', format: 'date-time', nullable: true },
            progress: { $ref: '#/components/schemas/Progress' },
            counts: {
              type: 'object',
              additionalProperties: { type: 'integer' },
              description: 'Zeilen je Tabelle, etwa `aktion`, `aktFz`, `symptom`.',
            },
            root: { type: 'string', description: 'Datenwurzel des Servers' },
            rootOk: { type: 'boolean', description: 'Ob unter der Wurzel ein `Daten/` liegt' },
            features: {
              type: 'object',
              properties: {
                carImages: { type: 'boolean' },
                history: { type: 'boolean' },
                apiDocs: { type: 'boolean' },
              },
            },
            dataCheck: {
              type: 'object',
              nullable: true,
              description: 'Fingerabdruck der Dateien hinter dem aktuellen Stand.',
              properties: {
                digest: { type: 'string' },
                files: { type: 'integer' },
              },
            },
            searchCache: {
              type: 'object',
              properties: {
                hits: { type: 'integer' },
                misses: { type: 'integer' },
                evictions: { type: 'integer' },
                size: { type: 'integer' },
                max: { type: 'integer' },
              },
            },
          },
        },
        BulletinSummary: {
          type: 'object',
          properties: {
            A_CODE: { type: 'string', description: 'Aktionscode', example: '25SC5' },
            A_DAT: { type: 'string', description: 'Datum, ISO' },
            N_ART: { type: 'string', description: 'Nachrichtenart, ein Buchstabe' },
            K_BEZEICH: { type: 'string', description: 'Kurzbezeichnung, im KIAS-Schema auf 90 Zeichen begrenzt' },
            HILF_NR: { type: 'string' },
            BAUZEIT: { type: 'string' },
            vehicles: { type: 'array', items: { type: 'string' } },
            forms: { type: 'integer', description: 'Anzahl angehängter Formulare' },
            snippet: { type: 'string', nullable: true, description: 'Textstelle des Treffers' },
          },
        },
        Former: {
          type: 'object',
          description: 'Ein Code, den ein Update zurückgezogen oder umnummeriert hat.',
          properties: {
            kind: { type: 'string', enum: ['removed', 'renamed'] },
            code: { type: 'string' },
            newCode: { type: 'string', description: 'Nur bei `renamed` gefüllt' },
            title: { type: 'string' },
            date: { type: 'string' },
            updateSeq: { type: 'string', example: '26007' },
            updateLabel: { type: 'string', example: '007 / 2026' },
            updateAt: { type: 'string' },
            hasRecord: { type: 'boolean', description: 'Ob der letzte Stand über `/api/bulletin/{code}` abrufbar ist' },
          },
        },
        BulletinList: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            offset: { type: 'integer' },
            limit: { type: 'integer' },
            results: { type: 'array', items: { $ref: '#/components/schemas/BulletinSummary' } },
            former: { $ref: '#/components/schemas/Former' },
          },
        },
        BulletinDetail: {
          type: 'object',
          description: 'Alle Felder des Datensatzes plus die aufgelösten Verknüpfungen.',
          properties: {
            A_CODE: { type: 'string' },
            A_DAT: { type: 'string' },
            N_ART: { type: 'string' },
            K_BEZEICH: { type: 'string' },
            BAUZEIT: { type: 'string' },
            BESCHREIB: { type: 'string', description: 'Volltext aus dem Memo-Feld' },
            VERGUETUNG: { type: 'string' },
            VERCODUNG: { type: 'string' },
            ARBZEIT: { type: 'string' },
            ETEILE: { type: 'string' },
            vehicles: { type: 'array', items: { $ref: '#/components/schemas/Vehicle' } },
            symptoms: { type: 'array', items: { $ref: '#/components/schemas/Scode' } },
            repGrups: { type: 'array', items: { type: 'object' } },
            forms: { type: 'array', items: { type: 'string' } },
            keywords: { type: 'array', items: { type: 'string' } },
            refs: {
              type: 'object',
              additionalProperties: { type: 'string', nullable: true },
              description: 'Im Text erkannte Verweise, bereits aufgelöst',
            },
            former: { $ref: '#/components/schemas/Former' },
          },
        },
        Vehicle: {
          type: 'object',
          properties: {
            FZ: { type: 'string', description: 'Fahrzeugcode' },
            BEZEICH: { type: 'string' },
            INTBEZEICH: { type: 'string' },
            VON: { type: 'string' },
            BIS: { type: 'string' },
          },
        },
        Scode: {
          type: 'object',
          properties: {
            SCODE: { type: 'string' },
            SCBEZEICH: { type: 'string' },
            KATEGORI: { type: 'string' },
          },
        },
        HistoryChange: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            title: { type: 'string' },
            date: { type: 'string' },
            from: { type: 'string', description: 'Nur bei umnummerierten Einträgen: der alte Code' },
          },
        },
        History: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            totals: {
              type: 'object',
              nullable: true,
              properties: {
                updates: { type: 'integer' },
                added: { type: 'integer' },
                updated: { type: 'integer' },
                removed: { type: 'integer' },
                renamed: { type: 'integer' },
                gone: { type: 'integer' },
              },
            },
            updates: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  seq: { type: 'string', example: '26007' },
                  file: { type: 'string', example: 'FO_UA26007.dbf' },
                  label: { type: 'string', example: '007 / 2026' },
                  from: { type: 'string' },
                  to: { type: 'string' },
                  added: { type: 'array', items: { $ref: '#/components/schemas/HistoryChange' } },
                  updated: { type: 'array', items: { $ref: '#/components/schemas/HistoryChange' } },
                  removed: { type: 'array', items: { $ref: '#/components/schemas/HistoryChange' } },
                  renamed: { type: 'array', items: { $ref: '#/components/schemas/HistoryChange' } },
                },
              },
            },
          },
        },
      },
    },
  };
}

module.exports = { buildOpenApiSpec };
