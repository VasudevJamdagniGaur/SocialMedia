/**
 * HTTP client for the Vertex AI Express backend.
 * No Gemini API keys in the browser — all AI goes through the server.
 */

import { BASE_URL, fetchJson } from './apiClient';

export function getVertexBackendBaseUrl() {
  return BASE_URL;
}

export function isVertexBackendConfigured() {
  return Boolean(BASE_URL);
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

  const data = await fetchJson('/chat', { body, signal });
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
  const data = await fetchJson('/generateContent', {
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
  const data = await fetchJson('/reflection', {
    body: { conversation },
    signal: opts.signal,
  });
  if (typeof data.reflection !== 'string') {
    throw new Error('Vertex /reflection: response missing reflection');
  }
  return data.reflection;
}

export async function vertexSummary(text, opts = {}) {
  const data = await fetchJson('/summary', {
    body: { text },
    signal: opts.signal,
  });
  if (typeof data.summary !== 'string') {
    throw new Error('Vertex /summary: response missing summary');
  }
  return data.summary;
}

export async function vertexAnalyzePattern(data, opts = {}) {
  const res = await fetchJson('/analyze-pattern', {
    body: { data },
    signal: opts.signal,
  });
  if (typeof res.result !== 'string') {
    throw new Error('Vertex /analyze-pattern: response missing result');
  }
  return res.result;
}

/**
 * POST /generate-news-image — tries primary backend (BASE_URL), then optional fallback.
 * If Render returns 404, redeploy from `backend-vertex` (see `backend-vertex/render.yaml`)
 * or set REACT_APP_GENERATE_NEWS_IMAGE_FALLBACK_URL to another host that exposes the same route.
 * @param {string} prompt
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<string>} data URL
 */
export async function vertexGenerateNewsImage(prompt, opts = {}) {
  const p = String(prompt || '').trim();
  if (!p) throw new Error('vertexGenerateNewsImage: prompt is required');

  const base = (BASE_URL || '').replace(/\/$/, '');
  const fallback = (process.env.REACT_APP_GENERATE_NEWS_IMAGE_FALLBACK_URL || '').trim().replace(/\/$/, '');

  /** @type {string[]} */
  const urls = [];
  if (base) urls.push(`${base}/generate-news-image`);
  if (fallback) urls.push(`${fallback}/generate-news-image`);

  const seen = new Set();
  const unique = urls.filter((u) => {
    if (!u || seen.has(u)) return false;
    seen.add(u);
    return true;
  });

  if (!unique.length) {
    throw new Error(
      'No backend URL for image generation. Set REACT_APP_BACKEND_URL or REACT_APP_GENERATE_NEWS_IMAGE_FALLBACK_URL.'
    );
  }

  let lastErr;
  for (const url of unique) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: p }),
        signal: opts.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        lastErr = new Error(
          `HTTP ${res.status} from ${url}: ${text.slice(0, 200)}. If 404, redeploy backend-vertex so POST /generate-news-image exists, or set REACT_APP_GENERATE_NEWS_IMAGE_FALLBACK_URL.`
        );
        continue;
      }
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        lastErr = new Error(`Non-JSON from ${url}`);
        continue;
      }
      if (typeof data.imageDataUrl === 'string' && data.imageDataUrl.startsWith('data:image')) {
        return data.imageDataUrl;
      }
      lastErr = new Error('Response missing imageDataUrl');
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr || new Error('vertexGenerateNewsImage: all backends failed');
}
