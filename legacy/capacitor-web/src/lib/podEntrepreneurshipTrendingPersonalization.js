/** Explore slugs for Entrepreneurship hub — Reddit-backed tabs + trending personalization. */
export const POD_ENTREPRENEURSHIP_EXPLORE_SLUGS = ['startups', 'founders'];

export const LS_ENTREPRENEURSHIP_EXPLORE_STATS = 'pod_entrepreneurship_explore_stats_v1';

export function isLikelyEntrepreneurshipTrendingItem(item) {
  const blob = `${item?.title || ''} ${item?.description || ''}`;
  if (!blob.trim()) return false;
  if (/\b(web'?s most searched|autocomplete interview)\b/i.test(blob)) return false;
  return true;
}

/**
 * @param {object} item
 * @returns {'startups'|'founders'}
 */
export function classifyExploreSlugForEntrepreneurshipTrending(item) {
  const direct = String(item?.exploreTopic || '').trim();
  if (direct === 'startups' || direct === 'founders') return direct;

  const blob = `${item?.title || ''} ${item?.description || ''}`;
  if (!blob.trim()) return 'startups';

  let sFounders = 0;
  let sStartups = 0;

  if (/\b(founder|founders|entrepreneur|ceo|solo founder|co-?founder|bootstrapping|solopreneur)\b/i.test(blob)) {
    sFounders += 3;
  }
  if (/\b(my journey|burnout|mindset|advice for)\b/i.test(blob)) sFounders += 1;

  if (/\b(startup|startups|unicorn|accelerator|y combinator|vc\b|venture|seed round|series [a-d]|pitch|runway)\b/i.test(blob)) {
    sStartups += 3;
  }
  if (/\b(funding|valuation|cap table|investor)\b/i.test(blob)) sStartups += 2;

  if (sFounders > sStartups) return 'founders';
  if (sStartups > sFounders) return 'startups';
  return 'startups';
}
