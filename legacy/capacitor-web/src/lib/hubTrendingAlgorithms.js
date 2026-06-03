/**
 * Hub → Trending ranking: engagement with time decay, interest/city boosts, feed mixing.
 */

export const HUB_INTEREST_MATCH_BOOST = 50;
export const HUB_CITY_MATCH_BOOST = 30;

/** Default interests when user has none set (Firestore `in` max 10). */
export const HUB_DEFAULT_INTERESTS = ['cricket', 'football', 'f1', 'chess', 'others'];

/**
 * trendingScore = ((likes*3)+(shares*5)+(views*1)) / max(hoursSincePosted, 1)
 * @param {number} likes
 * @param {number} shares
 * @param {number} views
 * @param {import('@firebase/firestore').Timestamp | Date | number} createdAt
 */
export function computeHubTrendingScore(likes, shares, views, createdAt) {
  const engagement = (Number(likes) || 0) * 3 + (Number(shares) || 0) * 5 + (Number(views) || 0) * 1;
  let createdMs;
  if (createdAt && typeof createdAt.toMillis === 'function') {
    createdMs = createdAt.toMillis();
  } else if (createdAt instanceof Date) {
    createdMs = createdAt.getTime();
  } else if (typeof createdAt === 'number') {
    createdMs = createdAt;
  } else {
    createdMs = Date.now();
  }
  const hoursSincePosted = Math.max(1, (Date.now() - createdMs) / 3600000);
  return engagement / hoursSincePosted;
}

/**
 * Sort/rank key: stored trendingScore + interest boost + same-city boost.
 */
export function effectiveHubRankScore(item, userCity, userInterestsLower) {
  const base = Number(item.trendingScore) || 0;
  const cat = String(item.category || '').toLowerCase();
  const interestBoost =
    Array.isArray(userInterestsLower) && userInterestsLower.includes(cat) ? HUB_INTEREST_MATCH_BOOST : 0;
  const uc = String(userCity || '').trim().toLowerCase();
  const nc = String(item.city || '').trim().toLowerCase();
  const cityBoost = uc && nc && uc === nc ? HUB_CITY_MATCH_BOOST : 0;
  return base + interestBoost + cityBoost;
}

export function shuffleInPlace(arr) {
  const a = arr;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * @param {'trending'|'latest'|'random'} bucket
 * @param {number} trendingScore
 * @param {import('@firebase/firestore').Timestamp | Date} createdAt
 * @param {boolean} inTopTrendingTier
 */
export function hubNewsTag(bucket, trendingScore, createdAt, inTopTrendingTier) {
  if (bucket === 'trending' && inTopTrendingTier) return { label: 'Trending', emoji: '🔥' };
  let createdMs;
  if (createdAt && typeof createdAt.toMillis === 'function') createdMs = createdAt.toMillis();
  else if (createdAt instanceof Date) createdMs = createdAt.getTime();
  else createdMs = Date.now();
  const hours = (Date.now() - createdMs) / 3600000;
  if (hours < 8 && Number(trendingScore) > 0) return { label: 'Rising', emoji: '📈' };
  return null;
}

/**
 * Mix: ~60% trending, ~20% latest, ~20% random (deduped by id).
 * Random pool is shuffled merge of trending+latest sources not yet shown.
 */
export function mixHubFeedSegments(trendingList, latestList, targetSize = 20) {
  const nT = Math.max(1, Math.round(targetSize * 0.6));
  const nL = Math.max(1, Math.round(targetSize * 0.2));
  const nR = Math.max(0, targetSize - nT - nL);

  const seen = new Set();
  const take = (list, n) => {
    const out = [];
    for (const item of list) {
      const id = item.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(item);
      if (out.length >= n) break;
    }
    return out;
  };

  const trendingPart = take(trendingList, nT);
  const latestPart = take(latestList, nL);

  const pool = [];
  for (const x of trendingList) if (x.id && !seen.has(x.id)) pool.push(x);
  for (const x of latestList) if (x.id && !seen.has(x.id)) pool.push(x);
  shuffleInPlace(pool);
  const randomPart = take(pool, nR);

  const topScore = trendingList.length ? Number(trendingList[0]?.trendingScore) || 0 : 0;
  const tierCut = topScore * 0.35;

  let ti = 0;
  let li = 0;
  let ri = 0;
  const interleaved = [];
  while (interleaved.length < targetSize) {
    let progressed = false;
    for (let k = 0; k < 3 && ti < trendingPart.length && interleaved.length < targetSize; k++) {
      interleaved.push({ ...trendingPart[ti++], _mixBucket: 'trending' });
      progressed = true;
    }
    if (li < latestPart.length && interleaved.length < targetSize) {
      interleaved.push({ ...latestPart[li++], _mixBucket: 'latest' });
      progressed = true;
    }
    if (ri < randomPart.length && interleaved.length < targetSize) {
      interleaved.push({ ...randomPart[ri++], _mixBucket: 'random' });
      progressed = true;
    }
    if (!progressed) {
      while (ti < trendingPart.length && interleaved.length < targetSize) {
        interleaved.push({ ...trendingPart[ti++], _mixBucket: 'trending' });
      }
      while (li < latestPart.length && interleaved.length < targetSize) {
        interleaved.push({ ...latestPart[li++], _mixBucket: 'latest' });
      }
      while (ri < randomPart.length && interleaved.length < targetSize) {
        interleaved.push({ ...randomPart[ri++], _mixBucket: 'random' });
      }
      break;
    }
  }

  return interleaved.map((x, i) => {
    const inTop =
      x._mixBucket === 'trending' &&
      Number(x.trendingScore) >= tierCut &&
      i < Math.ceil(targetSize * 0.35);
    const tag = hubNewsTag(x._mixBucket, x.trendingScore, x.createdAt, inTop);
    const { _mixBucket, ...rest } = x;
    return { ...rest, mixBucket: _mixBucket, feedTag: tag };
  });
}
