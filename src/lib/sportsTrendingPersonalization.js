import { sportArticleMatchesTopic, POD_SPORTS_EXPLORE_SLUGS } from './podSportsTopicFeed';

/** Drop obvious non-sports noise from NewsAPI / merged feeds (WIRED Autocomplete, politics, etc.). */
export function isLikelySportsTrendingItem(item) {
  const blob = `${item?.title || ''} ${item?.description || ''}`;
  if (!blob.trim()) return false;

  if (/\b(web'?s most searched|autocomplete interview)\b/i.test(blob)) return false;
  if (/\bKalshi\b/i.test(blob) && /\b(strategist|political|democratic|onboards|legal)\b/i.test(blob)) {
    return false;
  }
  if (/\b(crypto airdrop|nft drop|stock tip)\b/i.test(blob)) return false;
  if (/\b(emmys?|oscars?|netflix series|movie premiere|album release)\b/i.test(blob)) return false;

  if (
    /\b(live score|box score|nba|nfl|mlb|nhl|mls|wnba|ipl|cricket|wimbledon|masters|pga|f1|formula 1|grand prix|chess|olympics|playoffs?|championship|super bowl|world cup|ufc|mma)\b/i.test(
      blob
    )
  ) {
    return true;
  }
  if (/\b(fc\b| vs\.? | versus |match|game \d|season opener|roster|injury report|coach)\b/i.test(blob)) {
    return true;
  }
  if (/\b(sports|athlete|stadium|tournament|qualifying|semi-?final|final)\b/i.test(blob)) return true;

  return false;
}

/** Map a row to an Explore slug for personalization (cricket / football / f1 / chess / others). */
export function classifyExploreSlugForTrending(item) {
  for (const slug of ['cricket', 'football', 'f1', 'chess']) {
    if (sportArticleMatchesTopic(slug, item)) return slug;
  }
  return 'others';
}

export function isIndiaNewsRegion(countryCodeUpper) {
  return String(countryCodeUpper || '')
    .toUpperCase()
    .slice(0, 2) === 'IN';
}

const INDIA_CITY_HINTS =
  /\b(delhi|new delhi|noida|gurgaon|gurugram|mumbai|bengaluru|bangalore|hyderabad|chennai|kolkata|pune|ahmedabad|jaipur|lucknow|india)\b/i;

export function isLikelyIndiaMetroCity(cityNorm) {
  const c = String(cityNorm || '').trim().toLowerCase();
  if (!c) return false;
  return INDIA_CITY_HINTS.test(c);
}

export { POD_SPORTS_EXPLORE_SLUGS };

export const LS_INDIA_CRICKET_BOOT = 'pod_sports_india_cricket_boot_v1';
export const LS_EXPLORE_STATS = 'pod_sports_explore_stats_v1';
export const LS_SPORTS_SURFACE_SEC = 'pod_sports_surface_seconds_v1';
