/**
 * Aufrufe an die Verwaltungsendpunkte des REST-Dienstes.
 *
 * Alle Pfade sind relativ: im Betrieb reicht der Admin-Dienst sie an
 * rest-kias weiter, im Entwicklungsbetrieb der Vite-Server. Deshalb
 * braucht diese App keine Adresse und kein CORS.
 *
 * `credentials: 'same-origin'` ist Pflicht, sonst bleibt der Sitzungskeks
 * beim Absenden liegen und jeder zweite Aufruf endet in einer 401.
 */

/** Antwort lesen und Fehler als Error mit lesbarem Text weiterreichen. */
async function send(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // Kein JSON: dann zählt allein der Statuscode.
  }

  if (!res.ok) {
    const err = new Error((data && data.message) || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  session: () => send('/api/admin/session'),
  login: (user, password) => send('/api/admin/login', { method: 'POST', body: { user, password } }),
  logout: () => send('/api/admin/logout', { method: 'POST' }),
  state: () => send('/api/admin/state'),
  testPath: (path) => send('/api/admin/data-root/test', { method: 'POST', body: { path } }),
  savePath: (path, reload) => send('/api/admin/data-root', { method: 'PUT', body: { path, reload } }),
  reload: (force) => send(`/api/admin/reload?force=${force ? 'true' : 'false'}`, { method: 'POST' }),
};
