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
        '',
        'Im Compose-Aufbau läuft diese Schnittstelle als eigener Dienst',
        '(`rest-kias`). Die Oberfläche (`neo-kias`) reicht ihre Aufrufe unter',
        '`/api` dorthin weiter, die App athena-KIAS spricht sie direkt an.',
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
      { name: 'Verwaltung', description: 'Anmeldung, Datenpfad, Einlesen. Nur mit KIAS_ADMIN=true.' },
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
            'Docker-Healthcheck des Dienstes `rest-kias` nutzt ihn, ebenso',
            'ein vorgeschalteter Load Balancer.',
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
      '/healthz': {
        get: {
          tags: ['Erkennung'],
          summary: 'Lebt dieser Prozess?',
          description: [
            'Ohne Datenzugriff und ohne Weiterleitung, deshalb außerhalb von',
            '`/api`. Der Web-Dienst prüft sich damit selbst: `/api/health`',
            'ginge bei ihm durch den Weiterleiter und meldete den Zustand der',
            'Schnittstelle statt den eigenen.',
          ].join('\n'),
          responses: {
            200: {
              description: 'Der Prozess antwortet',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      ok: { type: 'boolean', example: true },
                      role: { type: 'string', enum: ['api', 'web', 'all'] },
                    },
                  },
                },
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
          tags: ['Verwaltung'],
          summary: 'Daten neu einlesen, wenn sie sich geändert haben',
          security: [{ adminBasic: [] }, { adminSession: [] }],
          description: [
            'Verlangt die Zugangsdaten der Verwaltung. Der Knopf dafür saß',
            'früher in der Suchoberfläche und ist dort verschwunden.',
            '',
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
            401: { $ref: '#/components/responses/Unauthorized' },
            404: { description: 'Die Verwaltung ist abgeschaltet' },
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
      '/api/admin/login': {
        post: {
          tags: ['Verwaltung'],
          summary: 'An der Verwaltung anmelden',
          description: [
            'Benutzer und Passwort. Der Benutzername ist immer `admin`, das',
            'Passwort kommt aus `KIAS_ADMIN_PASSWORD`; ohne Angabe ist es',
            'ebenfalls `admin`.',
            '',
            'Bei Erfolg setzt die Antwort einen Sitzungskeks. Für Skripte',
            'genügt stattdessen HTTP Basic an jedem Verwaltungsendpunkt.',
          ].join('\n'),
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['user', 'password'],
                  properties: {
                    user: { type: 'string', example: 'admin' },
                    password: { type: 'string', format: 'password' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Angemeldet, Keks gesetzt' },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/api/admin/logout': {
        post: {
          tags: ['Verwaltung'],
          summary: 'Abmelden',
          responses: { 200: { description: 'Sitzung verworfen' } },
        },
      },
      '/api/admin/session': {
        get: {
          tags: ['Verwaltung'],
          summary: 'Gilt die Sitzung noch?',
          description: 'Ohne Anmeldung erreichbar; antwortet dann `authenticated: false`.',
          responses: {
            200: {
              description: 'Zustand der Sitzung',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      authenticated: { type: 'boolean' },
                      user: { type: 'string' },
                      defaultPassword: { type: 'boolean', description: 'Noch das voreingestellte Passwort' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/admin/state': {
        get: {
          tags: ['Verwaltung'],
          summary: 'Alles, was die Verwaltung anzeigt',
          security: [{ adminBasic: [] }, { adminSession: [] }],
          description: [
            'Datenpfad samt Herkunft (`env` oder `db`), Ladezustand,',
            'Fortschritt, Zustand der Einstellungsdatenbank.',
            '',
            'Auch während des Einlesens erreichbar: liegt der Pfad falsch,',
            'ist nichts geladen, und genau dann braucht man diese Antwort.',
          ].join('\n'),
          responses: {
            200: { description: 'Zustand' },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/api/admin/data-root/test': {
        post: {
          tags: ['Verwaltung'],
          summary: 'Zugriff auf einen Datenpfad prüfen',
          security: [{ adminBasic: [] }, { adminSession: [] }],
          description: [
            'Sieht nach, ob unter dem Pfad `Daten/`, `Update/` und',
            '`Formulare/` liegen, zählt die DBF-Dateien und liest probeweise',
            'in eine hinein. Ändert nichts.',
            '',
            'Geprüft wird aus Sicht des Servers: im Container muss der Pfad',
            'dort hinein gemountet sein.',
          ].join('\n'),
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object', properties: { path: { type: 'string', example: '/data' } } },
              },
            },
          },
          responses: {
            200: {
              description: 'Prüfbericht',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/DataRootReport' } } },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/api/admin/data-root': {
        put: {
          tags: ['Verwaltung'],
          summary: 'Datenpfad speichern',
          security: [{ adminBasic: [] }, { adminSession: [] }],
          description: [
            'Speichert den Pfad in der Einstellungsdatenbank und stellt den',
            'laufenden Dienst darauf um. Vorher läuft dieselbe Prüfung wie',
            'unter `/api/admin/data-root/test`: was sie nicht besteht, wird',
            'nicht gespeichert.',
            '',
            'Danach wird neu eingelesen. Die Antwort wartet nicht darauf,',
            'das dauert Minuten.',
          ].join('\n'),
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['path'],
                  properties: {
                    path: { type: 'string' },
                    reload: { type: 'boolean', default: true },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Gespeichert' },
            400: { description: 'Pfad unbrauchbar, nichts gespeichert' },
            401: { $ref: '#/components/responses/Unauthorized' },
            503: { description: 'Einstellungsdatenbank nicht erreichbar' },
          },
        },
      },
      '/api/admin/reload': {
        post: {
          tags: ['Verwaltung'],
          summary: 'Daten neu einlesen',
          security: [{ adminBasic: [] }, { adminSession: [] }],
          description: 'Gleichbedeutend mit `POST /api/reload`; der Knopf der Verwaltung ruft diesen Pfad.',
          parameters: [
            { name: 'force', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: {
            200: { description: 'Status nach dem Einlesen' },
            401: { $ref: '#/components/responses/Unauthorized' },
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
      securitySchemes: {
        adminBasic: {
          type: 'http', scheme: 'basic',
          description: 'Benutzer `admin`, Passwort aus `KIAS_ADMIN_PASSWORD`.',
        },
        adminSession: {
          type: 'apiKey', in: 'cookie', name: 'kias_admin',
          description: 'Keks aus `POST /api/admin/login`.',
        },
      },
      responses: {
        Unauthorized: {
          description: 'Anmeldung fehlt oder stimmt nicht',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
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
        DataRootReport: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', description: 'Alle Pflichtprüfungen bestanden' },
            root: { type: 'string', description: 'Aufgelöster Pfad' },
            summary: { type: 'string' },
            checks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', example: 'Daten/' },
                  ok: { type: 'boolean' },
                  required: { type: 'boolean', description: 'Fehlschlag macht den Pfad unbrauchbar' },
                  detail: { type: 'string' },
                },
              },
            },
          },
        },
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
            rejected: {
              type: 'boolean',
              description:
                'Der Lauf fand nichts und wurde verworfen, der bisherige '
                + 'Bestand bleibt stehen. Die Endpunkte antworten dann mit 409.',
            },
            reason: {
              type: 'string',
              enum: ['unchanged', 'changed', 'forced', 'initial', 'in-progress', 'empty'],
              description: 'unchanged: Dateien identisch. changed: Dateien haben sich geändert. forced: force=true. initial: erstes Einlesen. in-progress: es lief bereits ein Ladevorgang. empty: nichts gefunden, verworfen.',
            },
            summary: { type: 'string', description: 'Satz aus dem Leseprotokoll' },
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
            readError: {
              type: 'object',
              nullable: true,
              description:
                'Gesetzt, solange ein Leseversuch verworfen wurde, weil er '
                + 'nichts fand. Dann gilt weiterhin der zuletzt gelesene '
                + 'Bestand, und `loadedAt` ist sein Stand, nicht der des '
                + 'letzten Versuchs.',
              properties: {
                at: { type: 'string', format: 'date-time' },
                trigger: { type: 'string' },
                summary: { type: 'string' },
                keptAt: { type: 'string', format: 'date-time', nullable: true },
              },
            },
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
            repGrups: {
              type: 'array',
              description: 'Alte Reparaturgruppen, zweistellig (NR, CTEXT)',
              items: { type: 'object' },
            },
            repNGrups: {
              type: 'array',
              description:
                'Neue Reparaturgruppen, sechsstellig (NR, CTEXT) mit ihrer '
                + 'Hauptgruppe (GRUPPE, GRTEXT). Die meisten Aktionen sind in '
                + 'beiden Strukturen eingeordnet und füllen beide Listen.',
              items: { type: 'object' },
            },
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
            former: {
              type: 'object',
              description: 'Nur bei entfallenen Fahrzeugen: die Zeile steht '
                + 'nicht mehr in FO_FZ, der Name ist der zuletzt bekannte. '
                + 'Die Codes hängen weiterhin an Aktionen, deshalb werden sie '
                + 'weiter geliefert. Fehlt das Feld, ist das Fahrzeug aktuell.',
              properties: {
                file: { type: 'string', description: 'Updatedatei, die die Zeile entfernt hat' },
                renamedTo: { type: 'string', description: 'Neuer Code, falls umbenannt statt entfernt' },
              },
            },
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
