/**
 * HTTP client for the Vertex AI Express backend.
 * No Gemini API keys in the browser — all AI goes through the server.
 *
 * Set REACT_APP_VERTEX_BACKEND_URL or REACT_APP_VERTEX_GEMINI_URL (e.g. http://localhost:3001).
 */

/**
 * @returns {string} Base URL without trailing slash, or empty string if unset
 */
export function getVertexBackendBaseUrl() {
  const u = (
    process.env.REACT_APP_VERTEX_BACKEND_URL ||
    process.env.REACT_APP_VERTEX_GEMINI_URL ||
    ''
  ).trim();
  return u.replace(/\/$/, '');
}

export function isVertexBackendConfigured() {
  return getVertexBackendBaseUrl().length > 0;
}

export function assertVertexBackendConfigured() {
  const base = getVertexBackendBaseUrl();
  if (!base) {
    throw new Error(
      'Vertex backend URL is not set. Add REACT_APP_VERTEX_BACKEND_URL or REACT_APP_VERTEX_GEMINI_URL (e.g. http://localhost:3001) to .env and restart the dev server.'
    );
  }
  return base;
}

/**
 * @param {string} path - e.g. "/chat"
 * @param {{ body?: object, signal?: AbortSignal, method?: string }} [options]
 * @returns {Promise<object>} Parsed JSON body
 */
export async function vertexBackendFetch(path, options = {}) {
  const base = assertVertexBackendConfigured();
  const p = path.startsWith('/') ? path : `/${path}`;
  const url = `${base}${p}`;
  const { body, signal, method = 'POST' } = options;

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    throw new Error(`Vertex backend unreachable (${url}): ${msg}`);
  }

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Vertex backend returned non-JSON (${res.status}): ${(text || '').slice(0, 240)}`
    );
  }

  if (!res.ok) {
    const msg = data.error || data.message || text || res.statusText;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  return data;
}

/**
 * POST /chat — full prompt in `message` (Detea system + conversation).
 * @param {string} message
 * @param {{ signal?: AbortSignal, temperature?: number, maxOutputTokens?: number }} [opts]
 */
export async function vertexChat(message, opts = {}) {
  const { signal, temperature, maxOutputTokens } = opts;
  const body = { message };
  if (typeof temperature === 'number') body.temperature = temperature;
  if (typeof maxOutputTokens === 'number') body.maxOutputTokens = maxOutputTokens;

  const data = await vertexBackendFetch('/chat', { body, signal });
  if (typeof data.reply !== 'string') {
    throw new Error('Vertex /chat: response missing reply');
  }
  return data.reply;
}

/**
 * POST /generateContent — legacy shape; returns plain text from candidates.
 */
export async function vertexGenerateContent({
  prompt,
  temperature = 0.65,
  maxOutputTokens = 1024,
  signal,
} = {}) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('vertexGenerateContent: prompt is required');
  }
  const data = await vertexBackendFetch('/generateContent', {
    body: { prompt: prompt.trim(), temperature, maxOutputTokens },
    signal,
  });
  if (
    data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts
  ) {
    return data.candidates[0].content.parts.map((p) => (p && p.text) || '').join('');
  }
  throw new Error('Unexpected response from Vertex /generateContent');
}

export async function vertexReflection(conversation, opts = {}) {
  const data = await vertexBackendFetch('/reflection', {
    body: { conversation },
    signal: opts.signal,
  });
  if (typeof data.reflection !== 'string') {
    throw new Error('Vertex /reflection: response missing reflection');
  }
  return data.reflection;
}

export async function vertexSummary(text, opts = {}) {
  const data = await vertexBackendFetch('/summary', {
    body: { text },
    signal: opts.signal,
  });
  if (typeof data.summary !== 'string') {
    throw new Error('Vertex /summary: response missing summary');
  }
  return data.summary;
}

export async function vertexAnalyzePattern(data, opts = {}) {
  const res = await vertexBackendFetch('/analyze-pattern', {
    body: { data },
    signal: opts.signal,
  });
  if (typeof res.result !== 'string') {
    throw new Error('Vertex /analyze-pattern: response missing result');
  }
  return res.result;
}
