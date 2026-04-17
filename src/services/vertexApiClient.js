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
