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
import { fetchAiTechRedditExploreRows } from './podAiTechTopicFeed';

/**
 * NewsAPI `everything` on AI/ML queries often returns PyPI/npm index rows: package name + semver
 * (e.g. "litellm 1.83.3", "foo added to PyPI") — not news headlines. Strip those.
 * @param {object[]} rows
 * @returns {object[]}
 */
export function filterDeveloperRegistrySpamFromNewsRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return rows;

  const isSpam = (item) => {
    const t = String(item?.title || '').trim();
    const d = String(item?.description || '').trim();
    const combined = `${t} ${d}`;

    if (/\b(added to|published on|released on)\s+(PyPI|npm)\b/i.test(combined)) return true;
    if (/\bPyPI\s+(package|project|release)\b/i.test(combined)) return true;
    if (/^\s*npm\s+package\b/i.test(t)) return true;

    const newsLike =
      /\b(announc|launch|say|said|says|report|warn|study|deal|acquire|raises|raising|funding|billion|million|court|law|\bCEO\b|interview|breaking|according|warns|unveil|introduc|explains|reveals|confirms|denies|investigat|editorial|opinion|podcast|vs\.|versus)\b/i.test(
        t
      );
    const majorBrand =
      /\b(OpenAI|Google|Microsoft|Meta|Apple|Amazon|Nvidia|Anthropic|DeepMind|IBM|Intel|AMD|Tesla|BBC|Reuters|CNN|FT\b|The Guardian|Washington Post|TechCrunch|Ars Technica|The Verge|Wired)\b/i.test(
        t
      );

    if (newsLike || majorBrand || t.length >= 80) return false;

    // Short vendor model lines are news; PyPI spam rarely starts like this.
    if (/^(Llama|GPT|Claude|Gemini|Mistral|Gemma|Phi-|Qwen|DeepSeek|Grok)\b/i.test(t)) return false;

    const onlyPkgVersion =
      /^(@[\w.-]+\/)?[\w][\w.-]{0,52}\s+v?\d+\.\d+[\w.-]*\s*$/i.test(t) ||
      /^[\w][\w.-]{0,52}\s+v?\d+\.\d+\.\d+[a-z0-9.-]*\s*$/i.test(t);

    return onlyPkgVersion;
  };

  return rows.filter((item) => !isSpam(item));
}

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
    if (section === 'ai-tech') {
      const redditRows = await fetchAiTechRedditExploreRows(topicId);
      if (redditRows?.length) {
        const enriched = await enrichNewsItemsWithOgImages(redditRows, { enableOgFallback: true });
        return { items: enriched.slice(0, 30), error: '' };
      }
    }

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
        isStartupsRegionTopic(section, topicId) && startupRegion === 'local'
          ? 50
          : section === 'ai-tech'
            ? 50
            : 30;
      rows = await fetchNewsApiEverythingNormalized({ q: newsQ, pageSize });
      if (rows?.length) {
        if (isStartupsRegionTopic(section, topicId) && startupRegion === 'local') {
          rows = filterNewsRowsIndiaLocal(rows);
        }
        if (section === 'ai-tech') {
          rows = filterDeveloperRegistrySpamFromNewsRows(rows);
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
