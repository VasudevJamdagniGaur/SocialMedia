import {
  doc,
  setDoc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  runTransaction,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import {
  computeHubTrendingScore,
  effectiveHubRankScore,
  mixHubFeedSegments,
  HUB_DEFAULT_INTERESTS,
} from '../lib/hubTrendingAlgorithms';
import {
  canFetchLiveNews,
  enrichNewsItemsWithOgImages,
  fetchNewsApiEverythingNormalized,
  fetchNewsApiTopHeadlinesNormalized,
  fetchLiveFromGoogleRssByQuery,
  isNewsApiRateLimitedCooldown,
} from '../lib/podTopicNewsShared';

const COLLECTION = 'news';

const FIRESTORE_QUERY_TIMEOUT_MS = 12000;

function getDocsWithTimeout(qRef, label) {
  return Promise.race([
    getDocs(qRef),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`firestore_timeout:${label}`)),
        FIRESTORE_QUERY_TIMEOUT_MS
      )
    ),
  ]);
}

export function hubNewsDocIdFromUrl(url) {
  const s = String(url || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return `hn_${Math.abs(h).toString(36)}`;
}

function normalizeCountry(code) {
  return String(code || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 2);
}

function normalizeCategory(c) {
  return String(c || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40);
}

function normalizeCity(c) {
  return String(c || '')
    .trim()
    .slice(0, 80);
}

/**
 * Merge Hub feed profile on users/{uid}: country, city, interests (per product spec).
 */
export async function getUserHubFeedProfile(uid) {
  if (!uid) return null;
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  const d = snap.exists() ? snap.data() : {};
  let country = normalizeCountry(d.country || d.hubCountry);
  let city = normalizeCity(d.city || d.hubCity);
  let interests = Array.isArray(d.interests) ? d.interests.map((x) => normalizeCategory(x)).filter(Boolean) : [];
  if (interests.length === 0) interests = [...HUB_DEFAULT_INTERESTS];
  interests = [...new Set(interests)].slice(0, 10);
  return { country, city, interests, raw: d };
}

export async function mergeUserHubFeedProfile(uid, partial) {
  if (!uid) return { success: false };
  const ref = doc(db, 'users', uid);
  const payload = {};
  if (partial.country != null) payload.country = normalizeCountry(partial.country);
  if (partial.city != null) payload.city = normalizeCity(partial.city);
  if (Array.isArray(partial.interests)) {
    payload.interests = [...new Set(partial.interests.map((x) => normalizeCategory(x)).filter(Boolean))].slice(0, 15);
  }
  if (Object.keys(payload).length === 0) return { success: true };
  await setDoc(ref, payload, { merge: true });
  return { success: true };
}

/**
 * Resolve country + city from ipapi.co and persist to user doc.
 */
export async function syncUserHubLocationFromIp(uid) {
  if (!uid) return { success: false };
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch('https://ipapi.co/json/', { signal: ctrl.signal });
    clearTimeout(tid);
    const data = await res.json().catch(() => null);
    const country = normalizeCountry(data?.country_code);
    const city = normalizeCity(data?.city || '');
    if (country.length === 2) {
      await mergeUserHubFeedProfile(uid, { country, city });
      return { success: true, country, city };
    }
  } catch {
    /* ignore */
  }
  return { success: false };
}

/**
 * Upsert a news row (creates with engagement 0 and computed initial trendingScore).
 */
export async function upsertHubNewsItem({
  title,
  image,
  source,
  url,
  category,
  country,
  city,
}) {
  const urlStr = String(url || '').trim();
  if (!urlStr || !title) return { success: false, error: 'missing url/title' };
  const id = hubNewsDocIdFromUrl(urlStr);
  const ref = doc(db, COLLECTION, id);
  const snap = await getDoc(ref);
  const ctry = normalizeCountry(country);
  if (ctry.length !== 2) return { success: false, error: 'invalid country' };
  const cat = normalizeCategory(category) || 'others';
  const nowTs = Timestamp.now();
  if (!snap.exists()) {
    const likes = 0;
    const shares = 0;
    const views = 0;
    const trendingScore = computeHubTrendingScore(likes, shares, views, nowTs);
    await setDoc(ref, {
      title: String(title).slice(0, 500),
      image: image || null,
      source: String(source || 'News').slice(0, 200),
      url: urlStr,
      category: cat,
      country: ctry,
      city: normalizeCity(city),
      likes,
      shares,
      views,
      trendingScore,
      createdAt: nowTs,
    });
    return { success: true, id, created: true };
  }
  return { success: true, id, created: false };
}

/**
 * Increment engagement and recompute trendingScore (time decay).
 */
export async function incrementHubNewsEngagement(newsId, kind) {
  const id = String(newsId || '').trim();
  if (!id || !['like', 'share', 'view'].includes(kind)) return { success: false };
  const ref = doc(db, COLLECTION, id);
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) return;
    const d = snap.data();
    let likes = Number(d.likes) || 0;
    let shares = Number(d.shares) || 0;
    let views = Number(d.views) || 0;
    if (kind === 'like') likes += 1;
    else if (kind === 'share') shares += 1;
    else views += 1;
    const trendingScore = computeHubTrendingScore(likes, shares, views, d.createdAt);
    transaction.update(ref, { likes, shares, views, trendingScore });
  });
  return { success: true };
}

async function queryNewsTrending(country, categories, maxDocs) {
  const ctry = normalizeCountry(country);
  if (ctry.length !== 2 || !categories.length) return [];
  const cats = categories.slice(0, 10);
  try {
    const col = collection(db, COLLECTION);
    const q = query(
      col,
      where('country', '==', ctry),
      where('category', 'in', cats),
      orderBy('trendingScore', 'desc'),
      limit(Math.min(maxDocs, 40))
    );
    const snap = await getDocsWithTimeout(q, 'trending');
    return snap.docs.map((d) => mapNewsDoc(d.id, d.data()));
  } catch (e) {
    if (e?.code === 'permission-denied') throw e;
    if (String(e?.message || '').startsWith('firestore_timeout:')) {
      console.warn('queryNewsTrending: timeout');
      return [];
    }
    console.warn('queryNewsTrending', e?.message || e);
    return [];
  }
}

async function queryNewsLatest(country, categories, maxDocs) {
  const ctry = normalizeCountry(country);
  if (ctry.length !== 2 || !categories.length) return [];
  const cats = categories.slice(0, 10);
  try {
    const col = collection(db, COLLECTION);
    const q = query(
      col,
      where('country', '==', ctry),
      where('category', 'in', cats),
      orderBy('createdAt', 'desc'),
      limit(Math.min(maxDocs, 40))
    );
    const snap = await getDocsWithTimeout(q, 'latest');
    return snap.docs.map((d) => mapNewsDoc(d.id, d.data()));
  } catch (e) {
    if (e?.code === 'permission-denied') throw e;
    if (String(e?.message || '').startsWith('firestore_timeout:')) {
      console.warn('queryNewsLatest: timeout');
      return [];
    }
    console.warn('queryNewsLatest', e?.message || e);
    return [];
  }
}

function mapNewsDoc(id, x) {
  return {
    id,
    title: x.title || '',
    image: x.image || null,
    source: x.source || '',
    url: x.url || '',
    category: x.category || '',
    country: x.country || '',
    city: x.city || '',
    likes: Number(x.likes) || 0,
    shares: Number(x.shares) || 0,
    views: Number(x.views) || 0,
    trendingScore: Number(x.trendingScore) || 0,
    createdAt: x.createdAt,
  };
}

const INTEREST_QUERIES = {
  cricket: '(cricket OR IPL OR "test match")',
  football: '(football OR soccer OR FIFA OR Premier League)',
  f1: '(F1 OR "Formula 1" OR Grand Prix)',
  chess: '(chess OR FIDE OR "world chess")',
  others: '(sports OR athletics OR Olympics)',
};

/** Google News RSS per interest (no NewsAPI quota) — fills the hub when API is rate-limited. */
const HUB_RSS_BY_INTEREST = {
  cricket: 'cricket OR IPL OR T20 when:2d',
  football: 'soccer OR MLS OR Premier League when:2d',
  f1: 'Formula 1 OR F1 when:2d',
  chess: 'chess OR FIDE when:2d',
  others: 'sports headlines when:2d',
};

/**
 * Syndicated Google News items often share the same story title with different URLs
 * ("India IPL Cricket - smalltownpaper.com"). Dedupe on story key, not just URL.
 */
function hubFeedTitleDedupeKey(raw) {
  let t = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!t) return '';
  t = t.replace(/\s*[-–—]\s*[^-–—]{1,120}$/, '').trim();
  return t.slice(0, 140);
}

function tryAddHubFeedItem(seenUrl, seenTitleKey, list, row, partial) {
  const url = String(row?.url || '').trim();
  const title = String(row?.title || '').trim();
  if (!url || !title) return false;
  if (seenUrl.has(url)) return false;
  const tk = hubFeedTitleDedupeKey(title);
  if (tk && seenTitleKey.has(tk)) return false;
  seenUrl.add(url);
  if (tk) seenTitleKey.add(tk);
  list.push({
    id: hubNewsDocIdFromUrl(url),
    title: row.title,
    image: row.image || null,
    description: row.description || '',
    publisherUrl: row.publisherUrl || '',
    publishedAt: row.publishedAt || null,
    source: row.source || 'News',
    url,
    likes: 0,
    shares: 0,
    views: 0,
    trendingScore: 0,
    createdAt: null,
    fromNewsApiFallback: true,
    ...partial,
  });
  return true;
}

async function appendInterestGoogleNewsRssParallel(profile, cats, seenUrl, seenTitleKey, unique, capUrls) {
  const ctry = normalizeCountry(profile?.country || '');
  const sub = (cats || []).slice(0, 5).filter(Boolean);
  if (!sub.length) return;
  const pairs = sub.map((cat) => ({
    cat,
    q: HUB_RSS_BY_INTEREST[cat] || `${cat} news when:2d`,
  }));
  const batches = await Promise.all(pairs.map((p) => fetchLiveFromGoogleRssByQuery(p.q)));
  for (let i = 0; i < batches.length; i++) {
    if (unique.length >= capUrls) break;
    const cat = pairs[i].cat;
    for (const row of batches[i] || []) {
      if (unique.length >= capUrls) break;
      tryAddHubFeedItem(seenUrl, seenTitleKey, unique, row, {
        category: cat,
        country: ctry || '',
        city: profile.city || '',
        feedTag: { label: 'For you', emoji: '📰' },
        mixBucket: 'trending',
      });
    }
  }
}

async function appendHubGoogleNewsRss(profile, seenUrl, seenTitleKey, unique) {
  const ctry = normalizeCountry(profile?.country || '');
  // Avoid "cricket" here for IN — interest RSS already covers cricket; was flooding duplicate syndicated IPL rows.
  const rssQ =
    String(ctry || '').toUpperCase() === 'IN'
      ? 'India news OR technology OR business when:2d'
      : 'world news headlines when:2d';
  const rssItems = await fetchLiveFromGoogleRssByQuery(rssQ);
  for (const row of rssItems || []) {
    tryAddHubFeedItem(seenUrl, seenTitleKey, unique, row, {
      category: 'others',
      country: ctry || '',
      city: profile.city || '',
      feedTag: { label: 'Headlines', emoji: '📰' },
      mixBucket: 'trending',
    });
  }
}

function hubItemPublishedTs(item) {
  const t = item?.publishedAt;
  if (!t || typeof t !== 'string') return 0;
  const n = Date.parse(t);
  return Number.isFinite(n) ? n : 0;
}

function sortHubTrendingByRecency(items) {
  items.sort((a, b) => hubItemPublishedTs(b) - hubItemPublishedTs(a));
}

/** Same notion as NewsAPI `urlToImage` — remote photo URL (not our SVG placeholder). */
function hubItemHasRemotePhoto(it) {
  const im = it?.image;
  if (typeof im !== 'string') return false;
  const s = im.trim();
  return /^https?:\/\//i.test(s) && !/^data:/i.test(s);
}

/**
 * Prefer NewsAPI first (same sources as Sports trending for photos), then RSS.
 * Sports page images come from NewsAPI `urlToImage`, not OG — we merge sports top-headlines here
 * and rank rows with remote photos first so the carousel matches Sports.
 */
async function buildNewsApiFallbackFeed(profile, targetSize = 20) {
  const cats = (profile?.interests?.length ? profile.interests : HUB_DEFAULT_INTERESTS).slice(0, 5);
  if (!canFetchLiveNews()) return [];

  const seenUrl = new Set();
  const seenTitleKey = new Set();
  const unique = [];
  const ctry = normalizeCountry(profile?.country || '');
  const skipNewsApi = isNewsApiRateLimitedCooldown();

  if (!skipNewsApi) {
    const code = ctry.length === 2 ? ctry.toLowerCase() : 'us';

    const sportsHeadlinesForHub = async () => {
      let s = await fetchNewsApiTopHeadlinesNormalized({
        category: 'sports',
        country: code,
        language: 'en',
        pageSize: 22,
      });
      if (!s?.length) {
        s = await fetchNewsApiTopHeadlinesNormalized({
          category: 'sports',
          country: code,
          language: false,
          pageSize: 22,
        });
      }
      return s || [];
    };

    const [th, sportsTh, perCatRows] = await Promise.all([
      fetchNewsApiTopHeadlinesNormalized({
        country: code,
        pageSize: Math.min(32, targetSize + 12),
        language: 'en',
      }),
      sportsHeadlinesForHub(),
      Promise.all(
        cats.map((cat) =>
          fetchNewsApiEverythingNormalized({
            q: INTEREST_QUERIES[cat] || cat,
            pageSize: 10,
            language: 'en',
          })
        )
      ),
    ]);

    for (const row of th || []) {
      tryAddHubFeedItem(seenUrl, seenTitleKey, unique, row, {
        category: 'others',
        country: ctry || '',
        city: profile.city || '',
        feedTag: { label: 'Trending', emoji: '🔥' },
        mixBucket: 'trending',
      });
    }

    for (const row of sportsTh) {
      tryAddHubFeedItem(seenUrl, seenTitleKey, unique, row, {
        category: 'others',
        country: ctry || '',
        city: profile.city || '',
        feedTag: { label: 'Sports', emoji: '⚽' },
        mixBucket: 'trending',
      });
    }

    for (let i = 0; i < cats.length; i++) {
      const cat = cats[i];
      for (const row of perCatRows[i] || []) {
        tryAddHubFeedItem(seenUrl, seenTitleKey, unique, row, {
          category: cat,
          country: profile.country || '',
          city: profile.city || '',
          feedTag: { label: 'For you', emoji: '📰' },
          mixBucket: 'trending',
        });
      }
    }
  }

  await appendHubGoogleNewsRss(profile, seenUrl, seenTitleKey, unique);
  await appendInterestGoogleNewsRssParallel(profile, cats, seenUrl, seenTitleKey, unique, 48);

  sortHubTrendingByRecency(unique);
  const withPhoto = unique.filter(hubItemHasRemotePhoto);
  const rest = unique.filter((it) => !hubItemHasRemotePhoto(it));
  const ranked = [...withPhoto, ...rest];
  const top = ranked.slice(0, targetSize);

  // Match Sports trending: prefer API thumbnails; OG only for rows still missing an image.
  const enriched = await enrichNewsItemsWithOgImages(top, {
    enableOgFallback: true,
    maxResolve: targetSize,
    concurrency: 4,
  });

  return enriched.map((it) => {
    if (hubItemHasRemotePhoto(it)) return it;
    const im = typeof it.image === 'string' ? it.image.trim() : '';
    if (/^https?:\/\//i.test(im) && !/^data:/i.test(im)) return it;
    return { ...it, image: null };
  });
}

/**
 * Pull headlines per interest and upsert into `news` (bounded API usage).
 */
export async function hydrateHubNewsFromApi(country, city, interests) {
  const ctry = normalizeCountry(country);
  const cit = normalizeCity(city);
  const cats = (interests.length ? interests : HUB_DEFAULT_INTERESTS).slice(0, 5);
  if (!canFetchLiveNews() || ctry.length !== 2) return { success: false, count: 0 };
  if (isNewsApiRateLimitedCooldown()) return { success: true, count: 0 };

  let total = 0;
  for (const cat of cats) {
    const qExtra = INTEREST_QUERIES[cat] || cat;
    const rows = await fetchNewsApiEverythingNormalized({
      q: qExtra,
      pageSize: 5,
      language: 'en',
    });
    for (const row of rows || []) {
      if (!row.url || !row.title) continue;
      const r = await upsertHubNewsItem({
        title: row.title,
        image: row.image,
        source: row.source,
        url: row.url,
        category: cat,
        country: ctry,
        city: cit,
      });
      if (r.success && r.created) total += 1;
    }
  }
  return { success: true, count: total };
}

/**
 * Record open → bump interest weight (unique categories, cap 15).
 */
export async function recordHubNewsClick(uid, category) {
  const cat = normalizeCategory(category);
  if (!uid || !cat) return;
  const ref = doc(db, 'users', uid);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists() ? snap.data() : {};
    const existing = Array.isArray(d.interests) ? d.interests.map((x) => normalizeCategory(x)).filter(Boolean) : [];
    const next = [cat, ...existing.filter((c) => c !== cat)];
    tx.set(ref, { interests: next.slice(0, 15) }, { merge: true });
  });
}

/**
 * Build personalized mixed feed (60/20/20), sorted trending arm by effective rank score.
 */
export async function fetchHubPersonalizedFeed(uid, options = {}) {
  const targetSize = options.targetSize || 20;
  if (!uid) return { success: false, items: [], error: 'not_signed_in' };

  let profile = await getUserHubFeedProfile(uid);
  try {
    if (!profile.country || profile.country.length !== 2) {
      await syncUserHubLocationFromIp(uid);
      profile = await getUserHubFeedProfile(uid);
    }
  } catch {
    /* location merge optional */
  }
  if (!profile.country || profile.country.length !== 2) {
    profile = {
      ...profile,
      country: 'US',
      city: profile.city || '',
      interests: profile.interests?.length ? profile.interests : [...HUB_DEFAULT_INTERESTS],
    };
  }

  const interestsLower = (profile.interests || []).map((x) => String(x).toLowerCase());
  const cats = profile.interests.slice(0, 10);
  if (!cats.length) return { success: true, items: [], profile };

  // Prefer fresh NewsAPI + RSS over stale Firestore `news` rows (cached articles ranked by old engagement).
  let liveItems = [];
  if (canFetchLiveNews()) {
    liveItems = await buildNewsApiFallbackFeed(profile, targetSize);
  }

  // Firestore backfill only when live path is empty — avoids 5 extra `everything` calls racing the hub fetch when RSS already filled the carousel.
  if (liveItems.length === 0 && canFetchLiveNews()) {
    void hydrateHubNewsFromApi(profile.country, profile.city, cats).catch(() => {});
  }

  if (liveItems.length > 0) {
    return {
      success: true,
      items: liveItems,
      profile,
      usedFirestore: false,
    };
  }

  let trending = [];
  let latest = [];

  try {
    trending = await queryNewsTrending(profile.country, cats, 40);
    latest = await queryNewsLatest(profile.country, cats, 40);
  } catch (e) {
    const code = e?.code || '';
    const msg = e?.message || String(e);
    console.warn('[HubTrending] Firestore `news` unavailable:', code || msg);
    trending = [];
    latest = [];
  }

  trending = [...trending].sort(
    (a, b) =>
      effectiveHubRankScore(b, profile.city, interestsLower) -
      effectiveHubRankScore(a, profile.city, interestsLower)
  );

  const items = mixHubFeedSegments(trending, latest, targetSize);

  return {
    success: true,
    items,
    profile,
    usedFirestore: items.length > 0,
  };
}

export default {
  hubNewsDocIdFromUrl,
  getUserHubFeedProfile,
  mergeUserHubFeedProfile,
  syncUserHubLocationFromIp,
  upsertHubNewsItem,
  incrementHubNewsEngagement,
  hydrateHubNewsFromApi,
  recordHubNewsClick,
  fetchHubPersonalizedFeed,
};
