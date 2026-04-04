import { getCurrentUser } from './authService';
import firestoreService from './firestoreService';
import { POD_SPORTS_EXPLORE_SLUGS, LS_EXPLORE_STATS, LS_SPORTS_SURFACE_SEC } from '../lib/sportsTrendingPersonalization';
import { TOPIC_META } from '../lib/podSportsTopicFeed';

function safeParseJson(raw, fallback) {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
}

function readLocalExploreStats() {
  if (typeof localStorage === 'undefined') return {};
  return safeParseJson(localStorage.getItem(LS_EXPLORE_STATS) || '{}', {});
}

function writeLocalExploreStats(stats) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_EXPLORE_STATS, JSON.stringify(stats));
  } catch {
    /* ignore quota */
  }
}

function mergeLocalSlug(stats, slug, secondsDelta, visitInc) {
  const next = { ...stats };
  const cur = next[slug] || { seconds: 0, visits: 0 };
  const sec = Math.min(86400, Math.max(0, Number(cur.seconds) || 0) + Math.max(0, secondsDelta));
  const vis = Math.max(0, Number(cur.visits) || 0) + Math.max(0, visitInc);
  next[slug] = { seconds: sec, visits: vis };
  return next;
}

/**
 * @returns {Promise<Record<string, { seconds?: number, visits?: number }>>}
 */
export async function getMergedExploreStats(uid) {
  const local = readLocalExploreStats();
  if (!uid) return local;
  try {
    const cloud = await firestoreService.getSportsExploreStats(uid);
    const out = { ...local };
    for (const slug of POD_SPORTS_EXPLORE_SLUGS) {
      const l = local[slug] || {};
      const c = cloud[slug] || {};
      out[slug] = {
        seconds: Math.max(Number(l.seconds) || 0, Number(c.seconds) || 0),
        visits: Math.max(Number(l.visits) || 0, Number(c.visits) || 0),
      };
    }
    return out;
  } catch {
    return local;
  }
}

/**
 * Bonus 0–55 added to effective trending rank per article class.
 */
export async function getSportsPersonalizationWeights(uid) {
  const stats = await getMergedExploreStats(uid);
  const raw = {};
  let total = 0;
  for (const slug of POD_SPORTS_EXPLORE_SLUGS) {
    const sec = Number(stats[slug]?.seconds) || 0;
    const v = Number(stats[slug]?.visits) || 0;
    raw[slug] = sec + v * 45;
    total += raw[slug];
  }
  const weights = {};
  if (total < 90) {
    for (const slug of POD_SPORTS_EXPLORE_SLUGS) weights[slug] = 0;
    return weights;
  }
  for (const slug of POD_SPORTS_EXPLORE_SLUGS) {
    weights[slug] = Math.round((raw[slug] / total) * 55);
  }
  return weights;
}

export async function recordSportsExploreDwell(slug, secondsDelta, visitInc) {
  if (!POD_SPORTS_EXPLORE_SLUGS.includes(slug)) return;
  const sd = Math.min(900, Math.max(0, Math.round(secondsDelta || 0)));
  const vi = Math.min(50, Math.max(0, Math.round(visitInc || 0)));
  if (sd === 0 && vi === 0) return;

  const local = readLocalExploreStats();
  writeLocalExploreStats(mergeLocalSlug(local, slug, sd, vi));

  const u = getCurrentUser();
  if (u?.uid) {
    await firestoreService.mergeSportsExploreStats(u.uid, slug, { secondsDelta: sd, visitInc: vi });
  }
}

/** Time on the Sports hub surface (PodSportsPage), local + optional cloud. */
export function recordSportsSurfaceSeconds(deltaSec) {
  const d = Math.min(3600, Math.max(0, Math.round(deltaSec || 0)));
  if (d < 2 || typeof localStorage === 'undefined') return;
  try {
    const prev = Number(localStorage.getItem(LS_SPORTS_SURFACE_SEC)) || 0;
    localStorage.setItem(LS_SPORTS_SURFACE_SEC, String(prev + d));
  } catch {
    /* ignore */
  }
  const u = getCurrentUser();
  if (u?.uid) {
    void firestoreService.mergeSportsSurfaceSeconds(u.uid, d);
  }
}

/**
 * Explanatory lines under Sports trending (region, explore dwell, behavior, social rank).
 * @param {Record<string, { seconds?: number, visits?: number }>} exploreStats
 */
export function buildSportsTrendingInsightLines(exploreStats, regionLabel, userCityRaw) {
  const lines = [];
  const reg = String(regionLabel || '').trim();
  if (reg) lines.push(`Location: headlines scoped to ${reg}.`);

  const city = String(userCityRaw || '').trim();
  if (city) lines.push(`Local signal: same-city stories rank higher (${city}).`);

  let bestSlug = null;
  let bestScore = -1;
  for (const slug of POD_SPORTS_EXPLORE_SLUGS) {
    const sec = Number(exploreStats?.[slug]?.seconds) || 0;
    const vis = Number(exploreStats?.[slug]?.visits) || 0;
    const sc = sec + vis * 42;
    if (sc > bestScore) {
      bestScore = sc;
      bestSlug = slug;
    }
  }
  if (bestSlug && bestScore >= 35) {
    lines.push(`Interest: most Explore time on ${TOPIC_META[bestSlug]?.label || bestSlug}.`);
  }

  const beh = POD_SPORTS_EXPLORE_SLUGS.map((slug) => {
    const sec = Number(exploreStats?.[slug]?.seconds) || 0;
    const vis = Number(exploreStats?.[slug]?.visits) || 0;
    if (sec < 25 && vis < 1) return null;
    const lb = TOPIC_META[slug]?.label || slug;
    const parts = [];
    if (sec >= 25) parts.push(`${Math.max(1, Math.round(sec / 60))}m`);
    if (vis) parts.push(`${vis} visit${vis === 1 ? '' : 's'}`);
    return parts.length ? `${lb}: ${parts.join(', ')}` : null;
  }).filter(Boolean);

  if (beh.length) lines.push(`Behavior: ${beh.slice(0, 4).join(' · ')}`);

  lines.push('Social: ranked by likes, shares, and reads—still sports-only headlines.');
  return lines;
}
