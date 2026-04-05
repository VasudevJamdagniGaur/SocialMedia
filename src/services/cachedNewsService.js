/**
 * Cached hub news: read-only from Firestore `news/{category}` (populated by Cloud Function `newsIngestScheduler`).
 * No external news API calls from the client.
 */
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

const COLLECTION = 'news';

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

const HUB_CATEGORIES = ['current_affairs', 'sports', 'ai_tech', 'entrepreneurship'];

/**
 * Merge all category buckets for Crew hub trending (dedupe by URL, sort by publishedAt desc).
 * @returns {Promise<{ success: boolean, items: Array<CachedArticle & { id: string, category: string }>, error?: string }>}
 */
export async function getHubTrendingMergedFromFirestore() {
  try {
    const results = await Promise.all(HUB_CATEGORIES.map((c) => getNews(c)));
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

export default { getNews, getHubTrendingMergedFromFirestore };
