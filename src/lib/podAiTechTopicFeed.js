import { tryRedditHotRows } from './podSportsTopicFeed';
import { POD_AI_TECH_EXPLORE_SLUGS } from './podAiTechTrendingPersonalization';

/** Hot-feed subreddits per AI & Tech Explore tab. */
export const REDDIT_AI_TECH_SUBS = {
  'ai-models': ['ArtificialIntelligence', 'LocalLLaMA', 'AI_Agents'],
  startups: ['startups', 'Entrepreneur', 'EntrepreneurRideAlong', 'SideProject'],
  tools: ['AIToolsAndTips', 'AIToolTesting', 'ChatGPTPromptGenius'],
  'vibe-coding': ['programming', 'webdev', 'VibeCodeDevs', 'vibecoding'],
  'big-tech': ['google', 'facebook', 'apple', 'microsoft', 'amazon', 'tech', 'ClaudeAI', 'ChatGPT'],
};

const HUB_TOPIC_OPTS = {
  'ai-models': { maxPerSub: 45, maxKeep: 26, minScore: 10 },
  startups: { maxPerSub: 45, maxKeep: 26, minScore: 12 },
  tools: { maxPerSub: 45, maxKeep: 26, minScore: 10 },
  'vibe-coding': { maxPerSub: 45, maxKeep: 26, minScore: 10 },
  'big-tech': { maxPerSub: 45, maxKeep: 28, minScore: 14 },
};

const EXPLORE_LIST_OPTS = {
  'ai-models': { maxPerSub: 50, maxKeep: 32, minScore: 8 },
  startups: { maxPerSub: 50, maxKeep: 32, minScore: 10 },
  tools: { maxPerSub: 50, maxKeep: 32, minScore: 8 },
  'vibe-coding': { maxPerSub: 50, maxKeep: 32, minScore: 8 },
  'big-tech': { maxPerSub: 50, maxKeep: 34, minScore: 10 },
};

function hasHubCarouselHeroImage(row) {
  const u = String(row?.image || row?.thumbnail || '').trim();
  return /^https?:\/\//i.test(u);
}

function pickBestHubCarouselRow(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const byScore = [...rows].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const withHero = byScore.filter(hasHubCarouselHeroImage);
  return withHero[0] || byScore[0];
}

/**
 * One top Reddit post per Explore tab for the AI & Tech hub “Trending” carousel.
 * @returns {Promise<object[]>}
 */
export async function fetchAiTechHubTrendingCarouselItems() {
  const runTopic = async (topicId) => {
    const subs = REDDIT_AI_TECH_SUBS[topicId];
    if (!subs?.length) return null;
    const base = HUB_TOPIC_OPTS[topicId] || { maxPerSub: 40, maxKeep: 22, minScore: 10 };

    let rows = await tryRedditHotRows(subs, base);
    let pick = pickBestHubCarouselRow(rows);
    if (!pick && base.minScore > 6) {
      rows = await tryRedditHotRows(subs, { ...base, minScore: 6 });
      pick = pickBestHubCarouselRow(rows);
    }
    if (!pick) return null;

    const hero = pick.image || pick.thumbnail || null;
    return {
      title: pick.title,
      url: pick.url,
      source: pick.source || 'Reddit',
      image: hero,
      description: pick.description || '',
      publishedAt: pick.publishedAt,
      city: null,
      firestoreId: null,
      trendingScore: Number(pick.score) || 0,
      likes: 0,
      shares: 0,
      views: 0,
      score: Number(pick.score) || 0,
      num_comments: Number(pick.num_comments) || 0,
      exploreTopic: topicId,
    };
  };

  const ordered = await Promise.all(POD_AI_TECH_EXPLORE_SLUGS.map((id) => runTopic(id)));
  return ordered.filter(Boolean);
}

/**
 * Full Explore topic list from Reddit (hub uses NewsAPI only if this is empty).
 * @param {string} topicId
 * @returns {Promise<object[]>}
 */
export async function fetchAiTechRedditExploreRows(topicId) {
  const subs = REDDIT_AI_TECH_SUBS[topicId];
  if (!subs?.length) return [];
  const base = EXPLORE_LIST_OPTS[topicId] || { maxPerSub: 45, maxKeep: 30, minScore: 8 };
  let rows = await tryRedditHotRows(subs, base);
  if (!rows.length && base.minScore > 5) {
    rows = await tryRedditHotRows(subs, { ...base, minScore: 5 });
  }
  return rows.map((r) => ({
    ...r,
    exploreTopic: topicId,
  }));
}
