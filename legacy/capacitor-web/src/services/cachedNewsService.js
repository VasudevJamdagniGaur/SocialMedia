/**
 * Hub news: prefer Firestore `news/{category}` (from `newsIngestScheduler`).
 * If empty (local dev / first run), falls back to NewsAPI via existing proxy (REACT_APP_NEWSAPI / setupProxy).
 */
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import {
  fetchNewsApiEverythingRaw,
  fetchNewsApiTopHeadlinesRaw,
  normalizeArticles,
  resolveUserNewsRegionForNewsApi,
} from '../lib/podTopicNewsShared';

const COLLECTION = 'news';

const LIVE_QUERIES = {
  current_affairs: 'world OR politics OR global',
  sports: 'cricket OR football OR sports',
  ai_tech: 'AI OR artificial intelligence OR technology',
  entrepreneurship: 'startup OR business OR entrepreneurship',
};

const HEADLINE_CATEGORY = {
  current_affairs: 'general',
  sports: 'sports',
  ai_tech: 'technology',
  entrepreneurship: 'business',
};

/** @typedef {{ title: string, source: string, url: string, image: string|null, description?: string, publishedAt?: string|null }} CachedArticle */

/**
 * @param {string} url
 * @returns {string}
 */
function hubNewsDocIdFromUrl(url) {
  const s = String(url || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return `hn_${Math.abs(h).toString(36)}`;
}

/**
 * @param {'current_affairs'|'sports'|'ai_tech'|'entrepreneurship'} category
 * @returns {Promise<{ success: boolean, articles: CachedArticle[], lastUpdated: number, error?: string }>}
 */
export async function getNews(category) {
  const id = String(category || '').trim();
  if (!id) {
    return { success: false, articles: [], lastUpdated: 0, error: 'missing_category' };
  }
  try {
    const ref = doc(db, COLLECTION, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return { success: true, articles: [], lastUpdated: 0 };
    }
    const d = snap.data() || {};
    const raw = Array.isArray(d.articles) ? d.articles : [];
    const lastUpdated = typeof d.lastUpdated === 'number' ? d.lastUpdated : 0;
    const articles = raw
      .filter((a) => a && typeof a === 'object' && a.title && a.url)
      .map((a) => ({
        title: String(a.title || ''),
        source: String(a.source || 'News'),
        url: String(a.url || ''),
        image: a.image && String(a.image).trim().startsWith('http') ? String(a.image).trim() : null,
        description: String(a.description || ''),
        publishedAt: a.publishedAt != null ? String(a.publishedAt) : null,
      }));
    return { success: true, articles, lastUpdated };
  } catch (e) {
    return {
      success: false,
      articles: [],
      lastUpdated: 0,
      error: e?.message || String(e),
    };
  }
}

/**
 * Firestore first; if no articles, load live via NewsAPI (same stack as before server-only ingest).
 * @param {'current_affairs'|'sports'|'ai_tech'|'entrepreneurship'} category
 * @returns {Promise<{ success: boolean, articles: CachedArticle[], lastUpdated: number, fromLiveFallback: boolean, error?: string, fallbackError?: string }>}
 */
export async function getNewsWithLiveFallback(category) {
  const id = String(category || '').trim();
  const base = await getNews(id);
  if (base.success && base.articles.length > 0) {
    return { ...base, fromLiveFallback: false };
  }

  const q = LIVE_QUERIES[id];
  const headCat = HEADLINE_CATEGORY[id];
  if (!q || !headCat) {
    return { ...base, fromLiveFallback: false };
  }

  try {
    const { code } = await resolveUserNewsRegionForNewsApi();
    let raw = await fetchNewsApiTopHeadlinesRaw({
      category: headCat,
      country: code,
      language: 'en',
      pageSize: 10,
    });
    if (!raw || raw.length === 0) {
      raw = await fetchNewsApiTopHeadlinesRaw({
        category: headCat,
        country: code,
        language: false,
        pageSize: 10,
      });
    }
    if (!raw || raw.length === 0) {
      raw = await fetchNewsApiEverythingRaw({
        q,
        language: 'en',
        pageSize: 10,
        sortBy: 'publishedAt',
      });
    }

    const articles = normalizeArticles(raw || []).map((a) => ({
      title: a.title,
      source: a.source,
      url: a.url,
      image: a.image && String(a.image).trim().startsWith('http') ? String(a.image).trim() : null,
      description: String(a.description || ''),
      publishedAt: a.publishedAt != null ? String(a.publishedAt) : null,
    }));

    if (articles.length === 0) {
      return {
        ...base,
        fromLiveFallback: false,
        fallbackError: 'NewsAPI returned no articles. Check REACT_APP_NEWSAPI and dev proxy.',
      };
    }

    return {
      success: true,
      articles,
      lastUpdated: base.lastUpdated || 0,
      fromLiveFallback: true,
    };
  } catch (e) {
    return {
      ...base,
      fromLiveFallback: false,
      fallbackError: e?.message || String(e),
    };
  }
}

const HUB_CATEGORIES = ['current_affairs', 'sports', 'ai_tech', 'entrepreneurship'];

/**
 * Merge all category buckets for Crew hub trending (dedupe by URL, sort by publishedAt desc).
 * @returns {Promise<{ success: boolean, items: Array<CachedArticle & { id: string, category: string }>, error?: string }>}
 */
export async function getHubTrendingMergedFromFirestore() {
  try {
    const results = await Promise.all(HUB_CATEGORIES.map((c) => getNewsWithLiveFallback(c)));
    const failed = results.find((r) => !r.success);
    if (failed && failed.error) {
      return { success: false, items: [], error: failed.error };
    }

    const seen = new Set();
    /** @type {Array<CachedArticle & { id: string, category: string }>} */
    const items = [];

    for (let i = 0; i < HUB_CATEGORIES.length; i++) {
      const cat = HUB_CATEGORIES[i];
      const { articles } = results[i];
      for (const a of articles) {
        const u = String(a.url || '').trim();
        if (!u || seen.has(u)) continue;
        seen.add(u);
        items.push({
          ...a,
          id: hubNewsDocIdFromUrl(u),
          category: cat,
          fromNewsApiFallback: true,
        });
      }
    }

    items.sort((a, b) => {
      const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
      const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });

    return { success: true, items };
  } catch (e) {
    return { success: false, items: [], error: e?.message || String(e) };
  }
}

export default { getNews, getNewsWithLiveFallback, getHubTrendingMergedFromFirestore };
