/**
 * Central backend configuration for the frontend.
 *
 * Use REACT_APP_BACKEND_URL (preferred) to override per environment.
 * Falls back to the deployed backend so builds don't accidentally hit localhost.
 */
export const DEFAULT_BASE_URL = 'https://detea-backend.onrender.com';

export const BASE_URL = (
  process.env.REACT_APP_BACKEND_URL ||
  process.env.REACT_APP_VERTEX_BACKEND_URL ||
  process.env.REACT_APP_VERTEX_GEMINI_URL ||
  DEFAULT_BASE_URL
)
  .trim()
  .replace(/\/$/, '');

/**
 * Fetch JSON from the backend with consistent error handling.
 *
 * - Handles network errors
 * - Handles non-2xx responses (surfacing backend error messages when present)
 * - Handles non-JSON responses
 */
export async function fetchJson(path, options = {}) {
  const p = typeof path === 'string' ? path : '';
  const finalPath = p.startsWith('/') ? p : `/${p}`;
  const url = `${BASE_URL}${finalPath}`;

  const {
    method = 'POST',
    body,
    signal,
    headers = {},
  } = options;

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    throw new Error(`Network error calling backend (${url}): ${msg}`);
  }

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Backend returned non-JSON (${res.status}) from ${url}: ${(text || '').slice(0, 240)}`);
  }

  if (!res.ok) {
    const msg = data?.error || data?.message || text || res.statusText || 'Request failed';
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  return data;
}
