import {
  canFetchLiveNews,
  fetchNewsApiEverythingNormalized,
  filterNewsRowsIndiaLocal,
  enrichNewsItemsWithOgImages,
} from './podTopicNewsShared';
import {
  EXPLORE_TOPICS,
  isStartupsRegionTopic,
  resolveExploreNewsQuery,
  resolveExploreGoogleQuery,
  buildFallbackRows,
} from './podExploreTopicConfig';

/**
 * Fetch + enrich one explore topic feed (shared by PodExploreTopicPage and prefetch cache).
 * @param {{ section: string, topicId: string, startupRegion: string }} opts
 * @returns {Promise<{ items: object[], error: string }>}
 */
export async function fetchExploreTopicFeed({ section, topicId, startupRegion }) {
  const cfg = EXPLORE_TOPICS[section]?.[topicId];
  const title = cfg?.label ?? 'Explore';

  if (!cfg) {
    return { items: [], error: '' };
  }

  try {
    if (!canFetchLiveNews()) {
      const googleQ = resolveExploreGoogleQuery(cfg, startupRegion);
      return {
        items: buildFallbackRows(title, googleQ),
        error:
          'Add REACT_APP_NEWSAPI to .env (web) or NEWSAPI_KEY on Firebase Functions (Android). Restart/rebuild. Showing browse links only.',
      };
    }

    const newsQ = resolveExploreNewsQuery(cfg, startupRegion);
    const googleQ = resolveExploreGoogleQuery(cfg, startupRegion);

    let rows = null;
    if (newsQ) {
      const pageSize =
        isStartupsRegionTopic(section, topicId) && startupRegion === 'local' ? 50 : 30;
      rows = await fetchNewsApiEverythingNormalized({ q: newsQ, pageSize });
      if (rows?.length) {
        if (isStartupsRegionTopic(section, topicId) && startupRegion === 'local') {
          rows = filterNewsRowsIndiaLocal(rows);
        }
        rows = rows.slice(0, 30);
      }
    }

    if (!rows?.length) {
      return {
        items: buildFallbackRows(title, googleQ),
        error:
          'NewsAPI returned no articles (check your key, plan limits, or query). Showing quick fallback headlines.',
      };
    }

    const enriched = await enrichNewsItemsWithOgImages(rows, { enableOgFallback: true });
    return { items: enriched, error: '' };
  } catch {
    const fallbackGoogle = resolveExploreGoogleQuery(cfg, startupRegion);
    return {
      items: buildFallbackRows(title, fallbackGoogle || ''),
      error: 'Live sources unavailable. Showing quick fallback headlines.',
    };
  }
}
