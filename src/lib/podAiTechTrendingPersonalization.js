/** Explore slugs for AI & Tech hub — used for trending classification + dwell stats. */
export const POD_AI_TECH_EXPLORE_SLUGS = [
  'ai-models',
  'startups',
  'tools',
  'vibe-coding',
  'big-tech',
];

export const LS_AI_TECH_EXPLORE_STATS = 'pod_ai_tech_explore_stats_v1';

/** Drop obvious non-tech / low-signal lines from merged NewsAPI rows (sports hub has a similar guard). */
export function isLikelyAiTechTrendingItem(item) {
  const blob = `${item?.title || ''} ${item?.description || ''}`;
  if (!blob.trim()) return false;
  if (/\b(web'?s most searched|autocomplete interview)\b/i.test(blob)) return false;
  if (/\b(nba|nfl|mlb|nhl|ipl|wimbledon|ufc|mma|f1 qualifying only)\b/i.test(blob)) {
    if (!/\b(ai|tech|chip|cloud|llm|gpt|model)\b/i.test(blob)) return false;
  }
  return true;
}

/**
 * Map a carousel or news row to an Explore slug for personalization.
 * @param {object} item
 * @returns {string}
 */
export function classifyExploreSlugForAiTechTrending(item) {
  const direct = String(item?.exploreTopic || '').trim();
  if (direct && POD_AI_TECH_EXPLORE_SLUGS.includes(direct)) return direct;

  const blob = `${item?.title || ''} ${item?.description || ''}`;
  if (!blob.trim()) return 'big-tech';

  const scores = {
    'vibe-coding': 0,
    startups: 0,
    tools: 0,
    'big-tech': 0,
    'ai-models': 0,
  };

  if (/\b(vibe\s*coding|programming|developer|webdev|javascript|typescript|react\b|vue\.?js|svelte|github|npm|css|html|full[\s-]?stack|frontend|backend)\b/i.test(blob)) {
    scores['vibe-coding'] += 4;
  }
  if (/\b(startup|seed round|series [a-d]|venture|founder|unicorn|y combinator|accelerator|valuation|ipo)\b/i.test(blob)) {
    scores.startups += 4;
  }
  if (/\b(tool|sdk|api\b|langchain|llamaindex|vector db|copilot|plugin|mcp\b|workflow|prompt engineering)\b/i.test(blob)) {
    scores.tools += 3;
  }
  if (
    /\b(google|alphabet|microsoft|meta\b|facebook|apple|amazon|aws\b|azure|nvidia|openai|anthropic)\b/i.test(blob)
  ) {
    scores['big-tech'] += 3;
  }
  if (/\b(llm|gpt|claude|gemini|llama|mistral|open weight|foundation model|reasoning model|agent\b)\b/i.test(blob)) {
    scores['ai-models'] += 4;
  }

  let best = 'big-tech';
  let max = -1;
  for (const slug of POD_AI_TECH_EXPLORE_SLUGS) {
    const s = scores[slug] || 0;
    if (s > max) {
      max = s;
      best = slug;
    }
  }
  if (max <= 0) {
    if (/\b(ai|artificial intelligence|machine learning|neural|chip|semiconductor)\b/i.test(blob)) return 'ai-models';
    return 'big-tech';
  }
  return best;
}
