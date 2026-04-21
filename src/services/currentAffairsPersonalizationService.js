import { POD_CURRENT_AFFAIRS_EXPLORE_SLUGS } from '../lib/podCurrentAffairsConstants';

const LS_CURRENT_AFFAIRS_EXPLORE_STATS = 'pod_current_affairs_explore_stats_v1';

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
  return safeParseJson(localStorage.getItem(LS_CURRENT_AFFAIRS_EXPLORE_STATS) || '{}', {});
}

function writeLocalExploreStats(stats) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_CURRENT_AFFAIRS_EXPLORE_STATS, JSON.stringify(stats));
  } catch {
    /* quota */
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
 * Bonus 0–55 per Explore category (mirrors AI & Tech explore weights).
 * @returns {Promise<Record<string, number>>}
 */
export async function getCurrentAffairsPersonalizationWeights() {
  const stats = readLocalExploreStats();
  const raw = {};
  let total = 0;
  for (const slug of POD_CURRENT_AFFAIRS_EXPLORE_SLUGS) {
    const sec = Number(stats[slug]?.seconds) || 0;
    const v = Number(stats[slug]?.visits) || 0;
    raw[slug] = sec + v * 45;
    total += raw[slug];
  }
  const weights = {};
  if (total < 90) {
    for (const slug of POD_CURRENT_AFFAIRS_EXPLORE_SLUGS) weights[slug] = 0;
    return weights;
  }
  for (const slug of POD_CURRENT_AFFAIRS_EXPLORE_SLUGS) {
    weights[slug] = Math.round((raw[slug] / total) * 55);
  }
  return weights;
}

/**
 * @param {string} slug — one of POD_CURRENT_AFFAIRS_EXPLORE_SLUGS
 */
export async function recordCurrentAffairsExploreDwell(slug, secondsDelta, visitInc) {
  if (!POD_CURRENT_AFFAIRS_EXPLORE_SLUGS.includes(slug)) return;
  const sd = Math.min(900, Math.max(0, Math.round(secondsDelta || 0)));
  const vi = Math.min(50, Math.max(0, Math.round(visitInc || 0)));
  if (sd === 0 && vi === 0) return;

  const local = readLocalExploreStats();
  writeLocalExploreStats(mergeLocalSlug(local, slug, sd, vi));
}
