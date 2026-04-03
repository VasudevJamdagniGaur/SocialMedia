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
          'Backend NewsAPI is unavailable. Set NEWSAPI_KEY on the server (Firebase Functions: `newsApi`). Showing browse links only.',
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
          'News returned no articles. Web: set REACT_APP_NEWSAPI in .env and restart the dev server. APK: run npm run build with that variable set, then npx cap sync android and reinstall. Or deploy Firebase (NEWSAPI_KEY on function newsApi and hosting). Check NewsAPI plan limits.',
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
