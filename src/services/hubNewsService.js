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
  shuffleInPlace,
  HUB_DEFAULT_INTERESTS,
} from '../lib/hubTrendingAlgorithms';
import {
  canFetchLiveNews,
  fetchNewsApiEverythingNormalized,
  fetchNewsApiTopHeadlinesNormalized,
  fetchLiveFromGoogleRssByQuery,
} from '../lib/podTopicNewsShared';

const COLLECTION = 'news';

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
    const snap = await getDocs(q);
    return snap.docs.map((d) => mapNewsDoc(d.id, d.data()));
  } catch (e) {
    if (e?.code === 'permission-denied') throw e;
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
    const snap = await getDocs(q);
    return snap.docs.map((d) => mapNewsDoc(d.id, d.data()));
  } catch (e) {
    if (e?.code === 'permission-denied') throw e;
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

/**
 * When Firestore `news` is blocked or empty: same interest mix from NewsAPI only (no writes).
 */
async function buildNewsApiFallbackFeed(profile, targetSize = 20) {
  const cats = (profile?.interests?.length ? profile.interests : HUB_DEFAULT_INTERESTS).slice(0, 5);
  if (!canFetchLiveNews()) return [];
  const collected = [];
  for (const cat of cats) {
    const qExtra = INTEREST_QUERIES[cat] || cat;
    const rows = await fetchNewsApiEverythingNormalized({
      q: qExtra,
      pageSize: 6,
      language: 'en',
    });
    for (const row of rows || []) {
      if (!row.url || !row.title) continue;
      collected.push({
        id: hubNewsDocIdFromUrl(row.url),
        title: row.title,
        image: row.image || null,
        source: row.source || 'News',
        url: row.url,
        category: cat,
        country: profile.country || '',
        city: profile.city || '',
        likes: 0,
        shares: 0,
        views: 0,
        trendingScore: 0,
        createdAt: null,
        fromNewsApiFallback: true,
        feedTag: { label: 'For you', emoji: '📰' },
        mixBucket: 'trending',
      });
    }
  }
  const seen = new Set();
  const unique = [];
  for (const r of collected) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    unique.push(r);
  }

  const ctry = normalizeCountry(profile?.country || '');
  if (!unique.length) {
    const code = ctry.length === 2 ? ctry.toLowerCase() : 'us';
    const th = await fetchNewsApiTopHeadlinesNormalized({
      country: code,
      pageSize: Math.min(40, targetSize + 10),
      language: 'en',
    });
    for (const row of th || []) {
      if (!row.url || !row.title || seen.has(row.url)) continue;
      seen.add(row.url);
      unique.push({
        id: hubNewsDocIdFromUrl(row.url),
        title: row.title,
        image: row.image || null,
        source: row.source || 'News',
        url: row.url,
        category: 'others',
        country: ctry || '',
        city: profile.city || '',
        likes: 0,
        shares: 0,
        views: 0,
        trendingScore: 0,
        createdAt: null,
        fromNewsApiFallback: true,
        feedTag: { label: 'Trending', emoji: '🔥' },
        mixBucket: 'trending',
      });
    }
  }

  if (!unique.length) {
    const rssQ =
      String(ctry || '').toUpperCase() === 'IN'
        ? 'India news OR cricket OR technology when:7d'
        : 'world news headlines when:7d';
    const rssItems = await fetchLiveFromGoogleRssByQuery(rssQ);
    for (const row of rssItems || []) {
      if (!row.url || !row.title || seen.has(row.url)) continue;
      seen.add(row.url);
      unique.push({
        id: hubNewsDocIdFromUrl(row.url),
        title: row.title,
        image: row.image || null,
        source: row.source || 'News',
        url: row.url,
        category: 'others',
        country: ctry || '',
        city: profile.city || '',
        likes: 0,
        shares: 0,
        views: 0,
        trendingScore: 0,
        createdAt: null,
        fromNewsApiFallback: true,
        feedTag: { label: 'Headlines', emoji: '📰' },
        mixBucket: 'trending',
      });
    }
  }

  shuffleInPlace(unique);
  return unique.slice(0, targetSize);
}

/**
 * Pull headlines per interest and upsert into `news` (bounded API usage).
 */
export async function hydrateHubNewsFromApi(country, city, interests) {
  const ctry = normalizeCountry(country);
  const cit = normalizeCity(city);
  const cats = (interests.length ? interests : HUB_DEFAULT_INTERESTS).slice(0, 5);
  if (!canFetchLiveNews() || ctry.length !== 2) return { success: false, count: 0 };

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

  let trending = [];
  let latest = [];
  let firestoreNewsOk = true;

  try {
    await hydrateHubNewsFromApi(profile.country, profile.city, cats);
    trending = await queryNewsTrending(profile.country, cats, 40);
    latest = await queryNewsLatest(profile.country, cats, 40);
  } catch (e) {
    firestoreNewsOk = false;
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

  let items = mixHubFeedSegments(trending, latest, targetSize);

  if (items.length === 0) {
    items = await buildNewsApiFallbackFeed(profile, targetSize);
    if (!firestoreNewsOk && items.length > 0) {
      console.info(
        '[HubTrending] Using live headlines (NewsAPI). To persist rankings/likes in Firestore, deploy rules + indexes for the `news` collection — see firestore.rules and firestore.indexes.json.'
      );
    }
    return {
      success: true,
      items,
      profile,
      usedFirestore: false,
    };
  }

  return {
    success: true,
    items,
    profile,
    usedFirestore: true,
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
