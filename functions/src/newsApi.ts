import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

/**
 * Server-side NewsAPI proxy for Capacitor / WebView clients.
 * Browser requests from https://localhost are blocked by NewsAPI CORS; hosting + this function are not.
 *
 * Set NEWSAPI_KEY or REACT_APP_NEWSAPI in Firebase Console → Functions → Environment variables.
 */
export const newsApi = onRequest({ cors: true }, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = (
    process.env.NEWSAPI_KEY ||
    process.env.REACT_APP_NEWSAPI ||
    process.env.NEWSAPI_API_KEY ||
    ''
  ).trim();
  if (!apiKey) {
    logger.warn('[news] NEWSAPI_KEY / REACT_APP_NEWSAPI not set on Functions');
    res.status(503).json({ status: 'error', code: 'config', message: 'News API not configured on server' });
    return;
  }

  const pathOnly = (req.url || '').split('?')[0];
  let endpoint: 'everything' | 'top-headlines' | null = null;
  if (pathOnly.includes('everything')) endpoint = 'everything';
  else if (pathOnly.includes('top-headlines')) endpoint = 'top-headlines';

  if (!endpoint) {
    res.status(404).json({ error: 'Use /api/news/everything or /api/news/top-headlines' });
    return;
  }

  const upstream = new URL(`https://newsapi.org/v2/${endpoint}`);
  const q = req.query as Record<string, string | string[] | undefined>;
  for (const [k, v] of Object.entries(q)) {
    if (!k || k === 'apiKey') continue;
    const val = Array.isArray(v) ? v[0] : v;
    if (val != null && String(val).length) upstream.searchParams.set(k, String(val));
  }
  upstream.searchParams.set('apiKey', apiKey);

  try {
    const newsRes = await fetch(upstream.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const data = (await newsRes.json().catch(() => null)) as Record<string, unknown> | null;
    if (!data || typeof data !== 'object') {
      res.status(502).json({ status: 'error', message: 'Invalid NewsAPI response' });
      return;
    }
    res.status(newsRes.ok ? 200 : newsRes.status).json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn('[news] upstream fetch failed', { message: msg });
    res.status(502).json({ status: 'error', message: 'NewsAPI request failed' });
  }
});
