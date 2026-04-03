/**
 * Crew Trending — personalized NewsAPI fetch + scoring (location, interests, behavior, engagement heuristics).
 * Keeps hub card shape compatible with HubTrendingFeed / HubTrendingCard.
 */

import {
  canFetchLiveNews,
  fetchNewsApiEverythingNormalized,
  fetchNewsApiTopHeadlinesNormalized,
  enrichNewsItemsWithOgImages,
} from '../lib/podTopicNewsShared';

/** When user has no interests saved (Step 7). */
export const PERSONALIZED_DEFAULT_INTERESTS = ['cricket', 'technology', 'business'];

const INTEREST_QUERIES = {
  cricket: '(cricket OR IPL OR "test cricket" OR T20 OR wicket)',
  football: '(football OR soccer OR FIFA OR "Premier League")',
  f1: '(F1 OR "Formula 1" OR "Grand Prix")',
  chess: '(chess OR FIDE OR grandmaster)',
  others: '(sports OR athletics OR Olympics)',
  technology: '(AI OR artificial intelligence OR technology OR tech OR machine learning)',
  business: '(business OR startup OR entrepreneur OR funding OR unicorn)',
  entrepreneurship: '(startup OR entrepreneur OR VC OR funding)',
  ai: '(AI OR artificial intelligence OR ChatGPT OR OpenAI)',
};

function hubNewsDocIdFromUrl(url) {
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
 * Step 9 — keyword engagement heuristic (0–1). Replace with LLM later if needed.
 */
export function getEngagementScore(headline) {
  const t = String(headline || '').toLowerCase();
  if (!t.trim()) return 0;
  let s = 0;
  if (/\bvs\.?\b/i.test(t)) s += 1;
  if (/\b(controversy|scandal|debate)\b/i.test(t)) s += 1;
  if (/\b(launch|unveil|release)\b/i.test(t)) s += 1;
  if (/\b(big|massive|huge|record)\b/i.test(t)) s += 1;
  if (/\b(viral|trending)\b/i.test(t)) s += 1;
  if (/\b(wins?|won|victory|champion)\b/i.test(t)) s += 1;
  return Math.min(1, s / 3);
}

function interestMatchForArticle(blob, interestsLower) {
  if (!interestsLower?.length) return 0;
  const b = blob.toLowerCase();
  for (const intr of interestsLower) {
    if (intr.length > 1 && b.includes(intr)) return 1;
    const tokens = intr.split(/[^a-z]+/i).filter((x) => x.length > 2);
    if (tokens.some((tok) => b.includes(tok))) return 1;
  }
  return 0;
}

function assignArticleCategory(blob, interestsLower) {
  for (const intr of interestsLower) {
    const q = INTEREST_QUERIES[intr];
    if (!q) {
      if (blob.toLowerCase().includes(intr)) return intr;
      continue;
    }
    const tokens = intr.split(/[^a-z]+/i).filter((x) => x.length > 2);
    if (tokens.some((t) => blob.toLowerCase().includes(t))) return intr;
  }
  return interestsLower[0] || 'others';
}

function locationMatchForArticle(blob, city, locationLabel, country) {
  const b = blob.toLowerCase();
  const cityLc = normalizeCity(city).toLowerCase();
  if (cityLc && (b.includes(cityLc) || (cityLc === 'delhi' && /\b(ncr|new delhi|gurgaon|gurugram|noida|faridabad)\b/i.test(blob))))
    return 1;
  const loc = String(locationLabel || '').trim().toLowerCase();
  if (loc && loc.length > 2 && b.includes(loc)) return 1;
  if (country === 'IN' && /\b(india|indian|bharat|delhi|mumbai|bengaluru|bangalore|hyderabad|chennai|kolkata)\b/i.test(blob))
    return 1;
  return 0;
}

/** Maps article category → users.{behavior} bucket (sports | ai | business). */
export function behaviorBucketForCategory(cat) {
  const c = normalizeCategory(cat);
  if (['cricket', 'football', 'f1', 'chess', 'others'].includes(c)) return 'sports';
  if (['technology', 'ai', 'entrepreneurship', 'business'].includes(c)) {
    if (c === 'entrepreneurship' || c === 'business') return 'business';
    return 'ai';
  }
  return 'sports';
}

function normalizedBehaviorScore(profile, category) {
  const b = profile.behavior && typeof profile.behavior === 'object' ? profile.behavior : {};
  const bucket = behaviorBucketForCategory(category);
  const v = Number(b[bucket]) || 0;
  const total =
    (Number(b.sports) || 0) + (Number(b.ai) || 0) + (Number(b.business) || 0) || 1;
  return Math.min(1, v / total);
}

/**
 * Step 4 — score one article (normalized row from NewsAPI).
 */
export function scorePersonalizedArticle(article, profile, interestsLower) {
  const blob = `${article.title || ''} ${article.description || ''}`;
  const cat = assignArticleCategory(blob, interestsLower);
  const country = normalizeCountry(profile.country);
  const interestMatch = interestMatchForArticle(blob, interestsLower);
  const behaviorScore = normalizedBehaviorScore(profile, cat);
  const locationMatch = locationMatchForArticle(blob, profile.city, profile.location, country);
  const engagementScore = getEngagementScore(article.title);

  let score =
    interestMatch * 5 + behaviorScore * 3 + locationMatch * 4 + engagementScore * 5;

  if (country === 'IN' && /\b(cricket|ipl|t20|odi|bbl|wicket|bcci)\b/i.test(blob)) {
    score += 3;
  }

  return { score, cat, interestMatch, behaviorScore, locationMatch, engagementScore };
}

function buildInterestQuery(interests) {
  const parts = [];
  for (const intr of interests.slice(0, 6)) {
    const q = INTEREST_QUERIES[intr] || intr;
    if (q) parts.push(`(${q})`);
  }
  return parts.length ? parts.join(' OR ') : '(news)';
}

/**
 * Step 3 + 5 + 6 — fetch, score, sort, segment into personal / local / general buckets.
 * @param {object} profile from getUserHubFeedProfile + extensions
 * @returns {Promise<object[]>} hub-shaped items (max ~20)
 */
/** @param {object} user — same shape as getUserHubFeedProfile() result */
export async function getPersonalizedNews(user, options = {}) {
  return fetchPersonalizedTrendingItems(user, options);
}

export async function fetchPersonalizedTrendingItems(profile, options = {}) {
  const targetSize = options.targetSize || 20;
  if (!canFetchLiveNews()) return [];

  const country = normalizeCountry(profile.country) || 'IN';
  const city = normalizeCity(profile.city);
  let interests = Array.isArray(profile.interests) ? profile.interests.map((x) => normalizeCategory(x)).filter(Boolean) : [];
  if (!interests.length) interests = [...PERSONALIZED_DEFAULT_INTERESTS];
  const interestsLower = interests.map((x) => String(x).toLowerCase());

  const collected = [];
  const seenUrl = new Set();

  const pushRows = (rows, defaultCat) => {
    for (const row of rows || []) {
      const u = String(row.url || '').trim();
      if (!u || !row.title || seenUrl.has(u)) continue;
      seenUrl.add(u);
      collected.push({ ...row, _defaultCat: defaultCat });
    }
  };

  try {
    const interestQ = buildInterestQuery(interests);
    const cityQ = city ? ` AND (${city} OR "New ${city}")` : '';
    const rowsEverything = await fetchNewsApiEverythingNormalized({
      q: interestQ + cityQ,
      pageSize: Math.min(50, 100),
      language: 'en',
    });
    pushRows(rowsEverything, interests[0] || 'others');
  } catch {
    /* continue with headlines only */
  }

  try {
    const headlines = await fetchNewsApiTopHeadlinesNormalized({
      country: country.toLowerCase(),
      pageSize: 30,
      language: 'en',
    });
    pushRows(headlines, 'others');
  } catch {
    /* optional */
  }

  if (!collected.length) return [];

  const scored = collected.map((row) => {
    const blob = `${row.title || ''} ${row.description || ''}`;
    const cat = assignArticleCategory(blob, interestsLower) || row._defaultCat || 'others';
    const meta = scorePersonalizedArticle({ ...row, title: row.title, description: row.description }, { ...profile, country }, interestsLower);
    return {
      raw: row,
      ...meta,
      category: cat,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const personal = scored.slice(0, 5);
  const afterPersonal = scored.slice(5);
  const withLoc = afterPersonal.filter((x) => x.locationMatch >= 1);
  withLoc.sort((a, b) => b.score - a.score);
  const localPick = withLoc.slice(0, 5);
  const localIds = new Set(localPick.map((x) => x.raw.url));
  const personalIds = new Set(personal.map((x) => x.raw.url));
  const remainder = afterPersonal.filter((x) => !localIds.has(x.raw.url));
  remainder.sort((a, b) => b.score - a.score);
  const needLocal = 5 - localPick.length;
  const extraLocal = needLocal > 0 ? remainder.filter((x) => !personalIds.has(x.raw.url)).slice(0, needLocal) : [];
  const local = [...localPick, ...extraLocal].slice(0, 5);
  const used = new Set([...personal.map((x) => x.raw.url), ...local.map((x) => x.raw.url)]);
  const general = scored.filter((x) => !used.has(x.raw.url)).sort((a, b) => b.score - a.score).slice(0, targetSize - personal.length - local.length);

  const feedTagFor = (segment) => {
    if (segment === 'personal') return { label: 'For you', emoji: '✨' };
    if (segment === 'local') return { label: 'Near you', emoji: '📍' };
    return { label: 'Trending', emoji: '🔥' };
  };

  const segmentBlocks = [
    ['personal', personal],
    ['local', local],
    ['general', general],
  ];
  const hubItems = [];
  for (const [segmentName, rows] of segmentBlocks) {
    const tag = feedTagFor(segmentName);
    for (const s of rows) {
      const row = s.raw;
      hubItems.push({
        id: hubNewsDocIdFromUrl(row.url),
        title: row.title,
        image: row.image || null,
        description: row.description || '',
        source: row.source || 'News',
        url: row.url,
        category: s.category,
        country,
        city: profile.city || '',
        likes: 0,
        shares: 0,
        views: 0,
        trendingScore: s.score,
        createdAt: null,
        fromNewsApiFallback: true,
        feedTag: tag,
        mixBucket: 'trending',
        personalizationScore: s.score,
        personalizationSegment: segmentName,
      });
    }
  }

  const unique = [];
  const uSeen = new Set();
  for (const it of hubItems) {
    if (uSeen.has(it.url)) continue;
    uSeen.add(it.url);
    unique.push(it);
    if (unique.length >= targetSize) break;
  }

  return enrichNewsItemsWithOgImages(unique, { enableOgFallback: true, maxResolve: 14 });
}

export default {
  getEngagementScore,
  getPersonalizedNews,
  scorePersonalizedArticle,
  fetchPersonalizedTrendingItems,
  behaviorBucketForCategory,
  PERSONALIZED_DEFAULT_INTERESTS,
  INTEREST_QUERIES,
};
