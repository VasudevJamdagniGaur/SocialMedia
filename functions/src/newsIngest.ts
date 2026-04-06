/**
 * Scheduled ingestion: external news APIs → Firestore `news/{category}`.
 * Keys: set the same names in Firebase Console → Functions → Environment variables
 * (REACT_APP_* names match the app .env convention).
 */
import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

export const NEWS_CATEGORY_IDS = [
  'current_affairs',
  'sports',
  'ai_tech',
  'entrepreneurship',
] as const;

export type NewsCategoryId = (typeof NEWS_CATEGORY_IDS)[number];

const CATEGORY_QUERIES: Record<NewsCategoryId, string> = {
  current_affairs: 'world OR politics OR global',
  sports: 'cricket OR football OR sports',
  ai_tech: 'AI OR artificial intelligence OR technology',
  entrepreneurship: 'startup OR business OR entrepreneurship',
};

/** NewsAPI top-headlines `category` param (free tier friendly; `everything` often restricted). */
const NEWSAPI_TOP_HEADLINES_CATEGORY: Record<NewsCategoryId, string> = {
  current_affairs: 'general',
  sports: 'sports',
  ai_tech: 'technology',
  entrepreneurship: 'business',
};

/** ms */
const CATEGORY_INTERVALS: Record<NewsCategoryId, number> = {
  current_affairs: 10 * 60 * 1000,
  sports: 30 * 60 * 1000,
  ai_tech: 30 * 60 * 1000,
  entrepreneurship: 60 * 60 * 1000,
};

const NEWS_COLLECTION = 'news';
const PAGE_SIZE = 10;
const USER_AGENT = 'DeiteNewsIngest/1.0 (+https://deitedatabase.web.app)';

export type IngestArticle = {
  title: string;
  source: string;
  url: string;
  image: string | null;
  description: string;
  publishedAt: string | null;
};

function envTrim(name: string): string {
  return String(process.env[name] ?? '').trim();
}

/** Primary NewsAPI key: REACT_APP_NEWSAPI, else NEWSAPI_KEY (Functions console). */
function newsApiPrimaryKey(): string {
  return envTrim('REACT_APP_NEWSAPI') || envTrim('NEWSAPI_KEY') || envTrim('NEWSAPI_API_KEY');
}

type ChainSlot = { label: string; key: string; kind: 'newsapi' | 'worldnews' | 'gnews' | 'thenews' };

function buildFallbackChain(): ChainSlot[] {
  const slots: ChainSlot[] = [
    { label: 'REACT_APP_NEWSAPI', key: newsApiPrimaryKey(), kind: 'newsapi' },
    { label: 'REACT_APP_NEWSAPI2', key: envTrim('REACT_APP_NEWSAPI2'), kind: 'newsapi' },
    { label: 'REACT_APP_WORLDNEWS_API_KEY', key: envTrim('REACT_APP_WORLDNEWS_API_KEY'), kind: 'worldnews' },
    { label: 'REACT_APP_WORLDNEWS_API_2', key: envTrim('REACT_APP_WORLDNEWS_API_2'), kind: 'worldnews' },
    { label: 'REACT_APP_GNEWS_API_KEY', key: envTrim('REACT_APP_GNEWS_API_KEY'), kind: 'gnews' },
    { label: 'REACT_APP_GNEWS_API_2', key: envTrim('REACT_APP_GNEWS_API_2'), kind: 'gnews' },
    { label: 'REACT_APP_THENEWS_API_TOKEN', key: envTrim('REACT_APP_THENEWS_API_TOKEN'), kind: 'thenews' },
    { label: 'REACT_APP_THENEWS_API_2', key: envTrim('REACT_APP_THENEWS_API_2'), kind: 'thenews' },
  ];
  return slots.filter((s) => s.key.length > 0);
}

async function fetchJson(url: string, timeoutMs = 18000): Promise<unknown> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    });
    const data = await res.json().catch(() => null);
    return data;
  } finally {
    clearTimeout(tid);
  }
}

function normalizeNewsApiArticles(raw: unknown): IngestArticle[] {
  if (!raw || typeof raw !== 'object') return [];
  const o = raw as { status?: string; articles?: unknown[] };
  if (o.status !== 'ok' || !Array.isArray(o.articles)) return [];
  const out: IngestArticle[] = [];
  for (const a of o.articles) {
    if (!a || typeof a !== 'object') continue;
    const x = a as {
      title?: string;
      url?: string;
      urlToImage?: string;
      description?: string;
      publishedAt?: string;
      source?: { name?: string } | string;
    };
    const title = String(x.title || '').trim();
    const url = String(x.url || '').trim();
    if (!title || !url) continue;
    const src =
      typeof x.source === 'object' && x.source?.name
        ? String(x.source.name).trim()
        : typeof x.source === 'string'
          ? x.source.trim()
          : '';
    const image = x.urlToImage && String(x.urlToImage).trim().startsWith('http') ? String(x.urlToImage).trim() : null;
    out.push({
      title,
      source: src || 'News',
      url,
      image,
      description: String(x.description || '').trim(),
      publishedAt: x.publishedAt ? String(x.publishedAt) : null,
    });
    if (out.length >= PAGE_SIZE) break;
  }
  return out;
}

async function tryNewsApi(key: string, category: NewsCategoryId): Promise<IngestArticle[] | null> {
  const q = CATEGORY_QUERIES[category];
  const topCat = NEWSAPI_TOP_HEADLINES_CATEGORY[category];

  for (const country of ['us', 'gb']) {
    const thUrl = new URL('https://newsapi.org/v2/top-headlines');
    thUrl.searchParams.set('apiKey', key);
    thUrl.searchParams.set('country', country);
    thUrl.searchParams.set('category', topCat);
    thUrl.searchParams.set('pageSize', String(PAGE_SIZE));
    try {
      const data = await fetchJson(thUrl.toString());
      const articles = normalizeNewsApiArticles(data);
      if (articles.length > 0) {
        logger.info('[newsIngest] NewsAPI top-headlines ok', { category, country, count: articles.length });
        return articles;
      }
      const errBody = data as { status?: string; message?: string; code?: string };
      if (errBody?.status && errBody.status !== 'ok') {
        logger.warn('[newsIngest] NewsAPI top-headlines response', {
          category,
          country,
          status: errBody.status,
          code: errBody.code,
          message: errBody.message,
        });
      }
    } catch (e) {
      logger.warn('[newsIngest] NewsAPI top-headlines fetch failed', {
        category,
        country,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const evUrl = new URL('https://newsapi.org/v2/everything');
  evUrl.searchParams.set('apiKey', key);
  evUrl.searchParams.set('q', q);
  evUrl.searchParams.set('pageSize', String(PAGE_SIZE));
  evUrl.searchParams.set('language', 'en');
  evUrl.searchParams.set('sortBy', 'publishedAt');
  try {
    const data = await fetchJson(evUrl.toString());
    const articles = normalizeNewsApiArticles(data);
    if (articles.length > 0) return articles;
    const errBody = data as { status?: string; message?: string; code?: string };
    if (errBody?.status && errBody.status !== 'ok') {
      logger.warn('[newsIngest] NewsAPI everything response', {
        category,
        status: errBody.status,
        code: errBody.code,
        message: errBody.message,
      });
    }
    return null;
  } catch (e) {
    logger.warn('[newsIngest] NewsAPI everything failed', { message: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

function normalizeWorldNewsArticles(raw: unknown): IngestArticle[] {
  if (!raw || typeof raw !== 'object') return [];
  const o = raw as { news?: unknown[] };
  if (!Array.isArray(o.news)) return [];
  const out: IngestArticle[] = [];
  for (const a of o.news) {
    if (!a || typeof a !== 'object') continue;
    const x = a as {
      title?: string;
      url?: string;
      image?: string;
      summary?: string;
      text?: string;
      publish_date?: string;
      authors?: string[];
    };
    const title = String(x.title || '').trim();
    const url = String(x.url || '').trim();
    if (!title || !url) continue;
    const image = x.image && String(x.image).trim().startsWith('http') ? String(x.image).trim() : null;
    const author = Array.isArray(x.authors) && x.authors[0] ? String(x.authors[0]) : '';
    out.push({
      title,
      source: author || 'News',
      url,
      image,
      description: String(x.summary || x.text || '').trim().slice(0, 500),
      publishedAt: x.publish_date ? String(x.publish_date) : null,
    });
    if (out.length >= PAGE_SIZE) break;
  }
  return out;
}

async function tryWorldNews(key: string, q: string): Promise<IngestArticle[] | null> {
  const url = new URL('https://api.worldnewsapi.com/search-news');
  url.searchParams.set('api-key', key);
  url.searchParams.set('text', q);
  url.searchParams.set('number', String(PAGE_SIZE));
  url.searchParams.set('language', 'en');
  try {
    const data = await fetchJson(url.toString());
    const articles = normalizeWorldNewsArticles(data);
    return articles.length > 0 ? articles : null;
  } catch (e) {
    logger.warn('[newsIngest] WorldNews failed', { message: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

function normalizeGNewsArticles(raw: unknown): IngestArticle[] {
  if (!raw || typeof raw !== 'object') return [];
  const o = raw as { articles?: unknown[] };
  if (!Array.isArray(o.articles)) return [];
  const out: IngestArticle[] = [];
  for (const a of o.articles) {
    if (!a || typeof a !== 'object') continue;
    const x = a as {
      title?: string;
      url?: string;
      image?: string;
      description?: string;
      publishedAt?: string;
      source?: { name?: string } | null;
    };
    const title = String(x.title || '').trim();
    const url = String(x.url || '').trim();
    if (!title || !url) continue;
    const image = x.image && String(x.image).trim().startsWith('http') ? String(x.image).trim() : null;
    const src = x.source?.name ? String(x.source.name).trim() : '';
    out.push({
      title,
      source: src || 'News',
      url,
      image,
      description: String(x.description || '').trim(),
      publishedAt: x.publishedAt ? String(x.publishedAt) : null,
    });
    if (out.length >= PAGE_SIZE) break;
  }
  return out;
}

async function tryGNews(key: string, q: string): Promise<IngestArticle[] | null> {
  const url = new URL('https://gnews.io/api/v4/search');
  url.searchParams.set('apikey', key);
  url.searchParams.set('q', q);
  url.searchParams.set('max', String(PAGE_SIZE));
  url.searchParams.set('lang', 'en');
  try {
    const data = await fetchJson(url.toString());
    const articles = normalizeGNewsArticles(data);
    return articles.length > 0 ? articles : null;
  } catch (e) {
    logger.warn('[newsIngest] GNews failed', { message: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

function normalizeThenewsArticles(raw: unknown): IngestArticle[] {
  if (!raw || typeof raw !== 'object') return [];
  const o = raw as { data?: unknown[] };
  if (!Array.isArray(o.data)) return [];
  const out: IngestArticle[] = [];
  for (const a of o.data) {
    if (!a || typeof a !== 'object') continue;
    const x = a as {
      title?: string;
      url?: string;
      image_url?: string;
      description?: string;
      published_at?: string;
      source?: string;
    };
    const title = String(x.title || '').trim();
    const url = String(x.url || '').trim();
    if (!title || !url) continue;
    const image =
      x.image_url && String(x.image_url).trim().startsWith('http') ? String(x.image_url).trim() : null;
    out.push({
      title,
      source: String(x.source || 'News').trim() || 'News',
      url,
      image,
      description: String(x.description || '').trim(),
      publishedAt: x.published_at ? String(x.published_at) : null,
    });
    if (out.length >= PAGE_SIZE) break;
  }
  return out;
}

async function tryThenews(key: string, q: string): Promise<IngestArticle[] | null> {
  const url = new URL('https://api.thenewsapi.com/v1/news/all');
  url.searchParams.set('api_token', key);
  url.searchParams.set('search', q);
  url.searchParams.set('language', 'en');
  url.searchParams.set('limit', String(PAGE_SIZE));
  try {
    const data = await fetchJson(url.toString());
    const articles = normalizeThenewsArticles(data);
    return articles.length > 0 ? articles : null;
  } catch (e) {
    logger.warn('[newsIngest] TheNewsAPI failed', { message: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export async function fetchWithFallback(category: NewsCategoryId): Promise<IngestArticle[]> {
  const chain = buildFallbackChain();
  const q = CATEGORY_QUERIES[category];
  if (chain.length === 0) {
    logger.warn('[newsIngest] No API keys configured for fallback chain');
    return [];
  }

  for (const slot of chain) {
    let articles: IngestArticle[] | null = null;
    try {
      if (slot.kind === 'newsapi') {
        articles = await tryNewsApi(slot.key, category);
      } else if (slot.kind === 'worldnews') {
        articles = await tryWorldNews(slot.key, q);
      } else if (slot.kind === 'gnews') {
        articles = await tryGNews(slot.key, q);
      } else {
        articles = await tryThenews(slot.key, q);
      }
    } catch (e) {
      logger.warn('[newsIngest] slot error', {
        slot: slot.label,
        message: e instanceof Error ? e.message : String(e),
      });
    }
    if (articles && articles.length > 0) {
      logger.info('[newsIngest] success', { category, provider: slot.kind, env: slot.label, count: articles.length });
      return articles;
    }
    logger.info('[newsIngest] try next', { category, failed: slot.label, kind: slot.kind });
  }

  logger.warn('[newsIngest] all providers failed', { category });
  return [];
}

export const newsIngestScheduler = onSchedule(
  {
    schedule: 'every 10 minutes',
    timeZone: 'UTC',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 540,
  },
  async () => {
    const db = admin.firestore();
    const now = Date.now();
    logger.info('[newsIngest] scheduler tick', { now });

    for (const category of NEWS_CATEGORY_IDS) {
      const interval = CATEGORY_INTERVALS[category];
      const docRef = db.collection(NEWS_COLLECTION).doc(category);
      let lastUpdated = 0;
      try {
        const snap = await docRef.get();
        if (snap.exists) {
          const lu = snap.data()?.lastUpdated;
          lastUpdated = typeof lu === 'number' ? lu : 0;
        }
      } catch (e) {
        logger.warn('[newsIngest] read lastUpdated failed', {
          category,
          message: e instanceof Error ? e.message : String(e),
        });
      }

      const isExpired = now - lastUpdated >= interval;
      if (!isExpired) {
        logger.info('[newsIngest] skip (fresh)', { category, lastUpdated, intervalMs: interval });
        continue;
      }

      const articles = await fetchWithFallback(category);
      try {
        await docRef.set({
          articles,
          lastUpdated: Date.now(),
        });
        logger.info('[newsIngest] saved', { category, count: articles.length });
      } catch (e) {
        logger.error('[newsIngest] Firestore save failed', {
          category,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }
);
