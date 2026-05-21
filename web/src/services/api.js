/**
 * Tiny fetch wrapper around the backend's JSON endpoints.
 *
 * Centralising fetch logic means the rest of the app doesn't need to
 * remember to check response.ok, encode query params, or pick error
 * shapes. Every helper returns a Promise that resolves with the parsed
 * JSON or rejects with the error.
 */

/**
 * GET a JSON endpoint. Rejects on non-2xx responses.
 *
 * @param {string} path
 * @returns {Promise<any>}
 */
export function getJson(path) {
  return fetch(path).then(r => r.ok ? r.json() : Promise.reject(r));
}

/**
 * POST a JSON endpoint with optional body.
 *
 * @param {string} path
 * @param {object} [body]
 * @returns {Promise<any>}
 */
export function postJson(path, body) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(r => r.ok ? r.json() : Promise.reject(r));
}

/** Resolve a search/text reference to an A_CODE, or null when nothing matches. */
export async function resolveReference(ref) {
  try {
    const r = await fetch(`/api/resolve?ref=${encodeURIComponent(ref)}`);
    if (r.ok) {
      const body = await r.json();
      return body && body.resolved ? body.resolved : null;
    }
  } catch { /* ignored */ }
  return null;
}

/** URL used in <img src="…"> for a car-image file. */
export const carImageUrl = (file) =>
  `/api/car-images/${encodeURIComponent(file)}`;

/** URL used in window.open for a form/attachment file. */
export const formUrl = (file) =>
  `/api/forms/${encodeURIComponent(file)}`;
