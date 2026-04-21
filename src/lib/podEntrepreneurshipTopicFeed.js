import { tryRedditHotRows } from './podSportsTopicFeed';
import { POD_ENTREPRENEURSHIP_EXPLORE_SLUGS } from './podEntrepreneurshipTrendingPersonalization';

/** Hot-feed subreddits per Entrepreneurship Explore tab. */
export const REDDIT_ENTREPRENEURSHIP_SUBS = {
  startups: ['startups', 'SideProject', 'StartupAccelerators', 'StartupsHelpStartups'],
  founders: ['EntrepreneurRideAlong', 'Entrepreneur'],
};

const HUB_TOPIC_OPTS = {
  startups: { maxPerSub: 45, maxKeep: 28, minScore: 12 },
  founders: { maxPerSub: 45, maxKeep: 26, minScore: 12 },
};

const EXPLORE_LIST_OPTS = {
  startups: { maxPerSub: 50, maxKeep: 34, minScore: 8 },
  founders: { maxPerSub: 50, maxKeep: 32, minScore: 8 },
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
 * One top Reddit post per Explore tab (Startups, Founders) for the Entrepreneurship hub “Trending” carousel.
 * @returns {Promise<object[]>}
 */
export async function fetchEntrepreneurshipHubTrendingCarouselItems() {
  const runTopic = async (topicId) => {
    const subs = REDDIT_ENTREPRENEURSHIP_SUBS[topicId];
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

  const ordered = await Promise.all(POD_ENTREPRENEURSHIP_EXPLORE_SLUGS.map((id) => runTopic(id)));
  return ordered.filter(Boolean);
}

/**
 * Full Explore topic list from Reddit (NewsAPI only if this is empty).
 * @param {string} topicId — 'startups' | 'founders'
 * @returns {Promise<object[]>}
 */
export async function fetchEntrepreneurshipRedditExploreRows(topicId) {
  const subs = REDDIT_ENTREPRENEURSHIP_SUBS[topicId];
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
