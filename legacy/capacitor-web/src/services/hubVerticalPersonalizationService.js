/**
 * Crew hub verticals (top-level categories) — time, visits, and taps drive trending mix + copy.
 */

export const HUB_VERTICAL_IDS = ['sports', 'ai-tech', 'entrepreneurship', 'current-affairs'];

export const HUB_VERTICAL_LABELS = {
  sports: 'Sports',
  'ai-tech': 'AI & Tech',
  entrepreneurship: 'Entrepreneurship',
  'current-affairs': 'Current Affairs',
};

const LS_KEY = 'pod_hub_vertical_stats_v1';

function safeParseJson(raw, fallback) {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
}

function readLocal() {
  if (typeof localStorage === 'undefined') return {};
  return safeParseJson(localStorage.getItem(LS_KEY) || '{}', {});
}

function writeLocal(stats) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(stats));
  } catch {
    /* quota */
  }
}

function mergeSlug(stats, id, secondsDelta, visitInc, clickInc) {
  if (!HUB_VERTICAL_IDS.includes(id)) return stats;
  const next = { ...stats };
  const cur = next[id] || { seconds: 0, visits: 0, clicks: 0 };
  const sec = Math.min(86400, Math.max(0, Number(cur.seconds) || 0) + Math.max(0, secondsDelta));
  const vis = Math.max(0, Number(cur.visits) || 0) + Math.max(0, visitInc);
  const clk = Math.max(0, Number(cur.clicks) || 0) + Math.max(0, clickInc);
  next[id] = { seconds: sec, visits: vis, clicks: clk };
  return next;
}

/**
 * @param {'sports'|'ai-tech'|'entrepreneurship'|'current-affairs'} verticalId
 */
export function recordHubVerticalDwell(verticalId, secondsDelta, visitInc) {
  const sd = Math.min(900, Math.max(0, Math.round(secondsDelta || 0)));
  const vi = Math.min(80, Math.max(0, Math.round(visitInc || 0)));
  if (sd === 0 && vi === 0) return;
  const local = readLocal();
  writeLocal(mergeSlug(local, verticalId, sd, vi, 0));
}

/**
 * @param {'sports'|'ai-tech'|'entrepreneurship'|'current-affairs'} verticalId
 */
export function recordHubVerticalClick(verticalId) {
  if (!HUB_VERTICAL_IDS.includes(verticalId)) return;
  const local = readLocal();
  writeLocal(mergeSlug(local, verticalId, 0, 0, 1));
}

export function getHubVerticalStats() {
  const s = readLocal();
  const out = {};
  for (const id of HUB_VERTICAL_IDS) {
    const x = s[id] || {};
    out[id] = {
      seconds: Math.max(0, Number(x.seconds) || 0),
      visits: Math.max(0, Number(x.visits) || 0),
      clicks: Math.max(0, Number(x.clicks) || 0),
    };
  }
  return out;
}

/**
 * Per-vertical weight 0–50 for ranking (same idea as sports explore weights).
 * @returns {Record<string, number>}
 */
export function getHubVerticalWeights() {
  const stats = getHubVerticalStats();
  const raw = {};
  let total = 0;
  for (const id of HUB_VERTICAL_IDS) {
    const sec = Number(stats[id]?.seconds) || 0;
    const vis = Number(stats[id]?.visits) || 0;
    const clk = Number(stats[id]?.clicks) || 0;
    raw[id] = sec + vis * 45 + clk * 22;
    total += raw[id];
  }
  const weights = {};
  if (total < 72) {
    for (const id of HUB_VERTICAL_IDS) weights[id] = 0;
    return weights;
  }
  for (const id of HUB_VERTICAL_IDS) {
    weights[id] = Math.round((raw[id] / total) * 50);
  }
  return weights;
}

export function inferHubVerticalForNewsItem(item) {
  if (item?.hubVertical && HUB_VERTICAL_IDS.includes(item.hubVertical)) return item.hubVertical;
  const cat = String(item?.category || '').toLowerCase();
  if (['cricket', 'football', 'f1', 'chess', 'others'].includes(cat)) return 'sports';
  if (cat === 'technology') return 'ai-tech';
  if (cat === 'business') return 'entrepreneurship';
  if (cat === 'general' || cat === 'politics' || cat === 'economy' || cat === 'climate') {
    return 'current-affairs';
  }
  return 'current-affairs';
}

/**
 * @param {Record<string, number>} verticalWeights
 */
export function rankHubLiveItemsByPersonalization(items, verticalWeights) {
  const vw = verticalWeights || {};
  const scored = (items || []).map((it) => {
    const v = inferHubVerticalForNewsItem(it);
    const vb = Number(vw[v]) || 0;
    const eng =
      (Number(it.likes) || 0) * 3 + (Number(it.shares) || 0) * 5 + (Number(it.views) || 0);
    let pub = 0;
    const t = it?.publishedAt;
    if (typeof t === 'string') {
      const n = Date.parse(t);
      if (Number.isFinite(n)) pub = n;
    }
    return { it, s: vb * 1400 + eng * 4 + pub / 50000 };
  });
  scored.sort((a, b) => {
    const d = b.s - a.s;
    if (Math.abs(d) > 0.5) return d;
    const pa =
      typeof a.it?.publishedAt === 'string' ? Date.parse(a.it.publishedAt) : 0;
    const pb =
      typeof b.it?.publishedAt === 'string' ? Date.parse(b.it.publishedAt) : 0;
    return (Number.isFinite(pb) ? pb : 0) - (Number.isFinite(pa) ? pa : 0);
  });
  return scored.map((x) => x.it);
}

function formatDurationShort(sec) {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 120) return `${m}m`;
  const h = Math.round(m / 60);
  return `${h}h`;
}

/**
 * @param {{ city?: string, country?: string }} profile
 * @returns {{ lines: string[] }}
 */
export function buildHubTrendingInsightLines(profile) {
  const stats = getHubVerticalStats();
  const lines = [];

  const city = String(profile?.city || '').trim();
  const ctry = String(profile?.country || '').trim().toUpperCase();
  let regionLine = '';
  if (city && ctry.length === 2) {
    try {
      const countryName = new Intl.DisplayNames(['en'], { type: 'region' }).of(ctry);
      regionLine = `Near ${city} · ${countryName || ctry}`;
    } catch {
      regionLine = `Near ${city} · ${ctry}`;
    }
  } else if (ctry.length === 2) {
    try {
      regionLine = `Region: ${new Intl.DisplayNames(['en'], { type: 'region' }).of(ctry) || ctry}`;
    } catch {
      regionLine = `Region: ${ctry}`;
    }
  }

  if (regionLine) lines.push(regionLine);

  let bestId = null;
  let bestScore = -1;
  for (const id of HUB_VERTICAL_IDS) {
    const sec = Number(stats[id]?.seconds) || 0;
    const vis = Number(stats[id]?.visits) || 0;
    const clk = Number(stats[id]?.clicks) || 0;
    const score = sec + vis * 50 + clk * 35;
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }

  if (bestId && bestScore >= 45) {
    const label = HUB_VERTICAL_LABELS[bestId] || bestId;
    lines.push(`Most time in ${label} (${formatDurationShort(stats[bestId].seconds)} on hub pages)`);
  }

  const behaviorParts = HUB_VERTICAL_IDS.map((id) => {
    const sec = Number(stats[id]?.seconds) || 0;
    const vis = Number(stats[id]?.visits) || 0;
    const clk = Number(stats[id]?.clicks) || 0;
    if (sec < 30 && vis < 1 && clk < 1) return null;
    const lb = HUB_VERTICAL_LABELS[id];
    const bits = [];
    if (sec >= 30) bits.push(`${formatDurationShort(sec)}`);
    if (vis > 0) bits.push(`${vis} visit${vis === 1 ? '' : 's'}`);
    if (clk > 0) bits.push(`${clk} open${clk === 1 ? '' : 's'}`);
    return bits.length ? `${lb}: ${bits.join(' · ')}` : null;
  }).filter(Boolean);

  if (behaviorParts.length) {
    lines.push(`Your behavior: ${behaviorParts.slice(0, 3).join(' · ')}`);
  }

  lines.push('Social signal: stories with more likes, shares, and reads rank higher when we have data.');

  return { lines };
}
