import { canFetchLiveNews } from './podTopicNewsShared';
import { fetchExploreTopicFeed } from './podExploreTopicFeed';

const TTL_MS = 12 * 60 * 1000;
const store = new Map();
const inflight = new Map();

/** Cache key includes region for dual Local/International startup topics. */
export function exploreTopicCacheKey(section, topicId, startupRegion) {
  const r =
    startupRegion === 'local' || startupRegion === 'international' ? startupRegion : 'international';
  return `${section}|${topicId}|${r}`;
}

export function getExploreTopicFeedCache(key) {
  const e = store.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > TTL_MS) {
    store.delete(key);
    return null;
  }
  return e;
}

export function setExploreTopicFeedCache(key, entry) {
  store.set(key, {
    items: entry.items,
    error: entry.error || '',
    ts: Date.now(),
  });
}

export function invalidateExploreTopicFeedCache(key) {
  store.delete(key);
}

/**
 * Warm cache before navigating to /pod/explore/:section/:topicId (default region international).
 */
export function prefetchExploreTopicRaw(section, topicId, startupRegion = 'international') {
  if (!section || !topicId) return Promise.resolve();
  if (!canFetchLiveNews() && section !== 'ai-tech' && section !== 'entrepreneurship' && section !== 'current-affairs')
    return Promise.resolve();
  const key = exploreTopicCacheKey(section, topicId, startupRegion);
  if (getExploreTopicFeedCache(key)) return Promise.resolve();
  if (inflight.has(key)) return inflight.get(key);

  const p = fetchExploreTopicFeed({ section, topicId, startupRegion })
    .then((res) => {
      inflight.delete(key);
      if (res.items?.length) {
        setExploreTopicFeedCache(key, { items: res.items, error: res.error || '' });
      }
      return res;
    })
    .catch(() => {
      inflight.delete(key);
    });

  inflight.set(key, p);
  return p;
}
