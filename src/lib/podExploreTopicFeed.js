import {
  canFetchLiveNews,
  fetchNewsApiEverythingNormalized,
  filterNewsRowsIndiaLocal,
  enrichNewsItemsWithOgImages,
  getNewsApiDebugSnapshot,
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
      const snap = getNewsApiDebugSnapshot?.();
      const last = snap?.last;
      const d = last?.data;
      const px = snap?.proxy;
      const pxd = px?.data;
      const pe = snap?.err;
      const ped = pe?.data;
      const fx = snap?.fn;
      const fxd = fx?.data;
      const dd = snap?.direct;
      const directDbg = dd
        ? `direct=${String(dd.message || '')};native=${dd.isNative};hasKey=${dd.hasKey};http=${dd.httpStatus ?? 'na'};api=${dd.apiStatus ?? 'na'};code=${dd.apiCode ?? dd.error ?? 'na'};articles=${dd.articleCount ?? 'na'}`
        : 'direct=none';
      const dbgText = ` (debug:last=${String(last?.message || 'none')}; fnUrl=${d?.fnUrlPresent ? 'yes' : 'no'}; base0=${String(d?.base0 ?? 'null')}; proxyStatus=${String(pxd?.httpStatus ?? 'null')}; proxyType=${String(pxd?.contentType ?? 'null')}; err=${String(ped?.error ?? 'null')}; fnStatus=${String(fxd?.httpStatus ?? 'null')}; ${directDbg})`;
      return {
        items: buildFallbackRows(title, googleQ),
        error:
          `News returned no articles. Web: ensure REACT_APP_NEWSAPI is in .env and restart dev server. APK: rebuild after setting REACT_APP_NEWSAPI (baked in at build time), then npx cap sync android. Or deploy Firebase (NEWSAPI_KEY on function newsApi + hosting). Also check NewsAPI plan limits.${dbgText}`,
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
