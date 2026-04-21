import { tryRedditHotRows } from './podSportsTopicFeed';
import { getCurrentAffairsPersonalizationWeights } from '../services/currentAffairsPersonalizationService';
import { POD_CURRENT_AFFAIRS_EXPLORE_SLUGS, REDDIT_CURRENT_AFFAIRS_SUBS } from './podCurrentAffairsConstants';

export { POD_CURRENT_AFFAIRS_EXPLORE_SLUGS, REDDIT_CURRENT_AFFAIRS_SUBS } from './podCurrentAffairsConstants';

const EXPLORE_OPTS = { maxPerSub: 45, maxKeep: 28, minScore: 7 };

function redditEngagement(row) {
  const s = Number(row?.score) || 0;
  const c = Number(row?.num_comments) || 0;
  return s + c * 2;
}

/**
 * Full Explore topic list from Reddit for one Current Affairs tab.
 * @param {string} topicId
 * @returns {Promise<object[]>}
 */
export async function fetchCurrentAffairsRedditExploreRows(topicId) {
  const subs = REDDIT_CURRENT_AFFAIRS_SUBS[topicId];
  if (!subs?.length) return [];
  const base = EXPLORE_OPTS;
  let rows = await tryRedditHotRows(subs, base);
  if (!rows.length && base.minScore > 4) {
    rows = await tryRedditHotRows(subs, { ...base, minScore: 4 });
  }
  return rows.map((r) => ({
    ...r,
    exploreTopic: topicId,
  }));
}

/**
 * Trending carousel: posts from each Explore topic, ranked by Reddit engagement (score + comments)
 * and boosted by how often the user opens each Explore tab. World News always gets a small base boost
 * so it stays represented.
 * @returns {Promise<object[]>}
 */
export async function fetchCurrentAffairsHubTrendingCarouselItems() {
  const weights = await getCurrentAffairsPersonalizationWeights();

  const rowsByTopic = await Promise.all(
    POD_CURRENT_AFFAIRS_EXPLORE_SLUGS.map((id) => fetchCurrentAffairsRedditExploreRows(id))
  );

  const seenUrl = new Set();
  const candidates = [];
  for (let i = 0; i < POD_CURRENT_AFFAIRS_EXPLORE_SLUGS.length; i++) {
    const topic = POD_CURRENT_AFFAIRS_EXPLORE_SLUGS[i];
    for (const row of rowsByTopic[i] || []) {
      const url = String(row?.url || '').trim();
      const key = url || String(row?.title || '').toLowerCase();
      if (!key || seenUrl.has(key)) continue;
      seenUrl.add(key);
      candidates.push({ ...row, exploreTopic: topic });
    }
  }

  const topicPreference = (topic) => {
    const w = Number(weights[topic]) || 0;
    const fromUsage = 1 + (w / 55) * 0.55;
    const worldFloor = topic === 'world-news' ? 1.22 : 1;
    return fromUsage * worldFloor;
  };

  const scored = candidates.map((r) => {
    const topic = r.exploreTopic || 'world-news';
    const eng = redditEngagement(r);
    const rank = eng * topicPreference(topic);
    return { ...r, _rank: rank };
  });

  scored.sort((a, b) => Number(b._rank) - Number(a._rank));

  return scored.slice(0, 10).map((pick) => ({
    title: pick.title,
    url: pick.url,
    source: pick.source || 'Reddit',
    image: pick.image || pick.thumbnail || null,
    description: pick.description || '',
    publishedAt: pick.publishedAt,
  }));
}
