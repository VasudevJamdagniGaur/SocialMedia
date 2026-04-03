import { canFetchLiveNews } from './podTopicNewsShared';
import { fetchSportsTopicRawItems, POD_SPORTS_EXPLORE_SLUGS } from './podSportsTopicFeed';

const TTL_MS = 12 * 60 * 1000;
const store = new Map();
const inflight = new Map();

export function getSportsTopicFeedCache(topicId) {
  const e = store.get(topicId);
  if (!e) return null;
  if (Date.now() - e.ts > TTL_MS) {
    store.delete(topicId);
    return null;
  }
  return e;
}

export function setSportsTopicFeedCache(topicId, entry) {
  store.set(topicId, {
    items: entry.items,
    error: entry.error || '',
    rewritten: !!entry.rewritten,
    ts: Date.now(),
  });
}

export function invalidateSportsTopicFeedCache(topicId) {
  store.delete(topicId);
  inflight.delete(topicId);
}

/** Clear all Sports → Explore topic caches (Cricket, Football, …). */
export function invalidateAllSportsTopicExploreCaches() {
  for (const id of POD_SPORTS_EXPLORE_SLUGS) {
    store.delete(id);
    inflight.delete(id);
  }
}

/**
 * Prefetch every explore topic (RSS-only for NewsAPI — avoids 5× parallel `everything` on one navigation).
 * @returns {Promise<void>}
 */
export function prefetchAllSportsExploreTopicsNow() {
  if (typeof window === 'undefined' || !canFetchLiveNews()) return Promise.resolve();
  return Promise.all(POD_SPORTS_EXPLORE_SLUGS.map((slug) => prefetchSportsTopicRaw(slug))).then(() => {});
}

/** Pull-to-refresh: drop caches and refetch all explore feeds. */
export function refreshAllSportsExploreTopicCaches() {
  invalidateAllSportsTopicExploreCaches();
  return prefetchAllSportsExploreTopicsNow();
}

/**
 * Warm cache for Explore rows (NewsAPI + images). Staggered to avoid bursting the API.
 */
export function prefetchSportsExploreTopics() {
  if (typeof window === 'undefined') return;
  if (!canFetchLiveNews()) return;
  POD_SPORTS_EXPLORE_SLUGS.forEach((slug, i) => {
    window.setTimeout(() => {
      void prefetchSportsTopicRaw(slug);
    }, 200 + i * 400);
  });
}

export function prefetchSportsTopicRaw(topicId) {
  if (!topicId || !canFetchLiveNews()) return Promise.resolve();
  if (getSportsTopicFeedCache(topicId)) return Promise.resolve();
  if (inflight.has(topicId)) return inflight.get(topicId);

  const p = fetchSportsTopicRawItems(topicId, { rssOnlyPrefetch: true })
    .then((res) => {
      inflight.delete(topicId);
      if (res.items?.length) {
        setSportsTopicFeedCache(topicId, {
          items: res.items,
          error: res.error || '',
          rewritten: res.allowRewrite === false,
        });
      }
      return res;
    })
    .catch(() => {
      inflight.delete(topicId);
    });

  inflight.set(topicId, p);
  return p;
}
