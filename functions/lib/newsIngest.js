"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.newsIngestScheduler = exports.fetchWithFallback = exports.NEWS_CATEGORY_IDS = void 0;
/**
 * Scheduled ingestion: external news APIs → Firestore `news/{category}`.
 * Keys: set the same names in Firebase Console → Functions → Environment variables
 * (REACT_APP_* names match the app .env convention).
 */
const admin = __importStar(require("firebase-admin"));
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firebase_functions_1 = require("firebase-functions");
exports.NEWS_CATEGORY_IDS = [
    'current_affairs',
    'sports',
    'ai_tech',
    'entrepreneurship',
];
const CATEGORY_QUERIES = {
    current_affairs: 'world OR politics OR global',
    sports: 'cricket OR football OR sports',
    ai_tech: 'AI OR artificial intelligence OR technology',
    entrepreneurship: 'startup OR business OR entrepreneurship',
};
/** ms */
const CATEGORY_INTERVALS = {
    current_affairs: 10 * 60 * 1000,
    sports: 30 * 60 * 1000,
    ai_tech: 30 * 60 * 1000,
    entrepreneurship: 60 * 60 * 1000,
};
const NEWS_COLLECTION = 'news';
const PAGE_SIZE = 10;
const USER_AGENT = 'DeiteNewsIngest/1.0 (+https://deitedatabase.web.app)';
function envTrim(name) {
    return String(process.env[name] ?? '').trim();
}
/** Primary NewsAPI key: REACT_APP_NEWSAPI, else NEWSAPI_KEY (Functions console). */
function newsApiPrimaryKey() {
    return envTrim('REACT_APP_NEWSAPI') || envTrim('NEWSAPI_KEY') || envTrim('NEWSAPI_API_KEY');
}
function buildFallbackChain() {
    const slots = [
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
async function fetchJson(url, timeoutMs = 18000) {
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
    }
    finally {
        clearTimeout(tid);
    }
}
function normalizeNewsApiArticles(raw) {
    if (!raw || typeof raw !== 'object')
        return [];
    const o = raw;
    if (o.status !== 'ok' || !Array.isArray(o.articles))
        return [];
    const out = [];
    for (const a of o.articles) {
        if (!a || typeof a !== 'object')
            continue;
        const x = a;
        const title = String(x.title || '').trim();
        const url = String(x.url || '').trim();
        if (!title || !url)
            continue;
        const src = typeof x.source === 'object' && x.source?.name
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
        if (out.length >= PAGE_SIZE)
            break;
    }
    return out;
}
async function tryNewsApi(key, q) {
    const url = new URL('https://newsapi.org/v2/everything');
    url.searchParams.set('apiKey', key);
    url.searchParams.set('q', q);
    url.searchParams.set('pageSize', String(PAGE_SIZE));
    url.searchParams.set('language', 'en');
    url.searchParams.set('sortBy', 'publishedAt');
    try {
        const data = await fetchJson(url.toString());
        const articles = normalizeNewsApiArticles(data);
        return articles.length > 0 ? articles : null;
    }
    catch (e) {
        firebase_functions_1.logger.warn('[newsIngest] NewsAPI failed', { message: e instanceof Error ? e.message : String(e) });
        return null;
    }
}
function normalizeWorldNewsArticles(raw) {
    if (!raw || typeof raw !== 'object')
        return [];
    const o = raw;
    if (!Array.isArray(o.news))
        return [];
    const out = [];
    for (const a of o.news) {
        if (!a || typeof a !== 'object')
            continue;
        const x = a;
        const title = String(x.title || '').trim();
        const url = String(x.url || '').trim();
        if (!title || !url)
            continue;
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
        if (out.length >= PAGE_SIZE)
            break;
    }
    return out;
}
async function tryWorldNews(key, q) {
    const url = new URL('https://api.worldnewsapi.com/search-news');
    url.searchParams.set('api-key', key);
    url.searchParams.set('text', q);
    url.searchParams.set('number', String(PAGE_SIZE));
    url.searchParams.set('language', 'en');
    try {
        const data = await fetchJson(url.toString());
        const articles = normalizeWorldNewsArticles(data);
        return articles.length > 0 ? articles : null;
    }
    catch (e) {
        firebase_functions_1.logger.warn('[newsIngest] WorldNews failed', { message: e instanceof Error ? e.message : String(e) });
        return null;
    }
}
function normalizeGNewsArticles(raw) {
    if (!raw || typeof raw !== 'object')
        return [];
    const o = raw;
    if (!Array.isArray(o.articles))
        return [];
    const out = [];
    for (const a of o.articles) {
        if (!a || typeof a !== 'object')
            continue;
        const x = a;
        const title = String(x.title || '').trim();
        const url = String(x.url || '').trim();
        if (!title || !url)
            continue;
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
        if (out.length >= PAGE_SIZE)
            break;
    }
    return out;
}
async function tryGNews(key, q) {
    const url = new URL('https://gnews.io/api/v4/search');
    url.searchParams.set('apikey', key);
    url.searchParams.set('q', q);
    url.searchParams.set('max', String(PAGE_SIZE));
    url.searchParams.set('lang', 'en');
    try {
        const data = await fetchJson(url.toString());
        const articles = normalizeGNewsArticles(data);
        return articles.length > 0 ? articles : null;
    }
    catch (e) {
        firebase_functions_1.logger.warn('[newsIngest] GNews failed', { message: e instanceof Error ? e.message : String(e) });
        return null;
    }
}
function normalizeThenewsArticles(raw) {
    if (!raw || typeof raw !== 'object')
        return [];
    const o = raw;
    if (!Array.isArray(o.data))
        return [];
    const out = [];
    for (const a of o.data) {
        if (!a || typeof a !== 'object')
            continue;
        const x = a;
        const title = String(x.title || '').trim();
        const url = String(x.url || '').trim();
        if (!title || !url)
            continue;
        const image = x.image_url && String(x.image_url).trim().startsWith('http') ? String(x.image_url).trim() : null;
        out.push({
            title,
            source: String(x.source || 'News').trim() || 'News',
            url,
            image,
            description: String(x.description || '').trim(),
            publishedAt: x.published_at ? String(x.published_at) : null,
        });
        if (out.length >= PAGE_SIZE)
            break;
    }
    return out;
}
async function tryThenews(key, q) {
    const url = new URL('https://api.thenewsapi.com/v1/news/all');
    url.searchParams.set('api_token', key);
    url.searchParams.set('search', q);
    url.searchParams.set('language', 'en');
    url.searchParams.set('limit', String(PAGE_SIZE));
    try {
        const data = await fetchJson(url.toString());
        const articles = normalizeThenewsArticles(data);
        return articles.length > 0 ? articles : null;
    }
    catch (e) {
        firebase_functions_1.logger.warn('[newsIngest] TheNewsAPI failed', { message: e instanceof Error ? e.message : String(e) });
        return null;
    }
}
async function fetchWithFallback(category) {
    const q = CATEGORY_QUERIES[category];
    const chain = buildFallbackChain();
    if (chain.length === 0) {
        firebase_functions_1.logger.warn('[newsIngest] No API keys configured for fallback chain');
        return [];
    }
    for (const slot of chain) {
        let articles = null;
        try {
            if (slot.kind === 'newsapi') {
                articles = await tryNewsApi(slot.key, q);
            }
            else if (slot.kind === 'worldnews') {
                articles = await tryWorldNews(slot.key, q);
            }
            else if (slot.kind === 'gnews') {
                articles = await tryGNews(slot.key, q);
            }
            else {
                articles = await tryThenews(slot.key, q);
            }
        }
        catch (e) {
            firebase_functions_1.logger.warn('[newsIngest] slot error', {
                slot: slot.label,
                message: e instanceof Error ? e.message : String(e),
            });
        }
        if (articles && articles.length > 0) {
            firebase_functions_1.logger.info('[newsIngest] success', { category, provider: slot.kind, env: slot.label, count: articles.length });
            return articles;
        }
        firebase_functions_1.logger.info('[newsIngest] try next', { category, failed: slot.label, kind: slot.kind });
    }
    firebase_functions_1.logger.warn('[newsIngest] all providers failed', { category });
    return [];
}
exports.fetchWithFallback = fetchWithFallback;
exports.newsIngestScheduler = (0, scheduler_1.onSchedule)({
    schedule: 'every 10 minutes',
    timeZone: 'UTC',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 540,
}, async () => {
    const db = admin.firestore();
    const now = Date.now();
    firebase_functions_1.logger.info('[newsIngest] scheduler tick', { now });
    for (const category of exports.NEWS_CATEGORY_IDS) {
        const interval = CATEGORY_INTERVALS[category];
        const docRef = db.collection(NEWS_COLLECTION).doc(category);
        let lastUpdated = 0;
        try {
            const snap = await docRef.get();
            if (snap.exists) {
                const lu = snap.data()?.lastUpdated;
                lastUpdated = typeof lu === 'number' ? lu : 0;
            }
        }
        catch (e) {
            firebase_functions_1.logger.warn('[newsIngest] read lastUpdated failed', {
                category,
                message: e instanceof Error ? e.message : String(e),
            });
        }
        const isExpired = now - lastUpdated >= interval;
        if (!isExpired) {
            firebase_functions_1.logger.info('[newsIngest] skip (fresh)', { category, lastUpdated, intervalMs: interval });
            continue;
        }
        const articles = await fetchWithFallback(category);
        try {
            await docRef.set({
                articles,
                lastUpdated: Date.now(),
            });
            firebase_functions_1.logger.info('[newsIngest] saved', { category, count: articles.length });
        }
        catch (e) {
            firebase_functions_1.logger.error('[newsIngest] Firestore save failed', {
                category,
                message: e instanceof Error ? e.message : String(e),
            });
        }
    }
});
//# sourceMappingURL=newsIngest.js.map