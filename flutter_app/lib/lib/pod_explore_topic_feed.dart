import 'pod_ai_tech_topic_feed.dart';
import 'pod_current_affairs_topic_feed.dart';
import 'pod_entrepreneurship_topic_feed.dart';
import 'pod_explore_topic_config.dart';
import 'pod_reddit_hot.dart';
import 'pod_topic_news_shared.dart';

class ExploreFeedResult {
  const ExploreFeedResult({required this.items, this.error = ''});
  final List<NewsArticle> items;
  final String error;
}

/// Port of filterDeveloperRegistrySpamFromNewsRows in podExploreTopicFeed.js
List<Map<String, dynamic>> filterDeveloperRegistrySpamFromNewsRows(
  List<Map<String, dynamic>> rows,
) {
  if (rows.isEmpty) return rows;

  bool isSpam(Map<String, dynamic> item) {
    final t = '${item['title'] ?? ''}'.trim();
    final d = '${item['description'] ?? ''}'.trim();
    final combined = '$t $d';

    if (RegExp(
      r'\b(added to|published on|released on)\s+(PyPI|npm)\b',
      caseSensitive: false,
    ).hasMatch(combined)) {
      return true;
    }
    if (RegExp(r'\bPyPI\s+(package|project|release)\b', caseSensitive: false)
        .hasMatch(combined)) {
      return true;
    }
    if (RegExp(r'^\s*npm\s+package\b', caseSensitive: false).hasMatch(t)) {
      return true;
    }

    final newsLike = RegExp(
      r'\b(announc|launch|say|said|says|report|warn|study|deal|acquire|raises|raising|funding|billion|million|court|law|\bCEO\b|interview|breaking|according|warns|unveil|introduc|explains|reveals|confirms|denies|investigat|editorial|opinion|podcast|vs\.|versus)\b',
      caseSensitive: false,
    ).hasMatch(t);
    final majorBrand = RegExp(
      r'\b(OpenAI|Google|Microsoft|Meta|Apple|Amazon|Nvidia|Anthropic|DeepMind|IBM|Intel|AMD|Tesla|BBC|Reuters|CNN|FT\b|The Guardian|Washington Post|TechCrunch|Ars Technica|The Verge|Wired)\b',
      caseSensitive: false,
    ).hasMatch(t);

    if (newsLike || majorBrand || t.length >= 80) return false;
    if (RegExp(r'^(Llama|GPT|Claude|Gemini|Mistral|Gemma|Phi-|Qwen|DeepSeek|Grok)\b',
            caseSensitive: false)
        .hasMatch(t)) {
      return false;
    }

    final onlyPkgVersion = RegExp(
          r'^(@[\w.-]+\/)?[\w][\w.-]{0,52}\s+v?\d+\.\d+[\w.-]*\s*$',
          caseSensitive: false,
        ).hasMatch(t) ||
        RegExp(
          r'^[\w][\w.-]{0,52}\s+v?\d+\.\d+\.\d+[a-z0-9.-]*\s*$',
          caseSensitive: false,
        ).hasMatch(t);

    return onlyPkgVersion;
  }

  return rows.where((item) => !isSpam(item)).toList();
}

Future<ExploreFeedResult> fetchExploreTopicFeed({
  required String section,
  required String topicId,
  String startupRegion = 'international',
}) async {
  final cfg = exploreTopics[section]?[topicId];
  final title = cfg?['label'] ?? 'Explore';

  if (cfg == null) {
    return const ExploreFeedResult(items: [], error: '');
  }

  try {
    if (section == 'ai-tech') {
      final redditRows = await fetchAiTechRedditExploreRows(topicId);
      if (redditRows.isNotEmpty) {
        final enriched = await enrichNewsItemsWithOgImages(
          redditRows,
          enableOgFallback: true,
        );
        return ExploreFeedResult(
          items: mapsToNewsArticles(enriched).take(30).toList(),
        );
      }
    }

    if (section == 'entrepreneurship' &&
        (topicId == 'startups' || topicId == 'founders')) {
      final redditRows = await fetchEntrepreneurshipRedditExploreRows(topicId);
      if (redditRows.isNotEmpty) {
        final enriched = await enrichNewsItemsWithOgImages(
          redditRows,
          enableOgFallback: true,
        );
        return ExploreFeedResult(
          items: mapsToNewsArticles(enriched).take(30).toList(),
        );
      }
    }

    if (section == 'current-affairs') {
      final redditRows = await fetchCurrentAffairsRedditExploreRows(topicId);
      if (redditRows.isNotEmpty) {
        final enriched = await enrichNewsItemsWithOgImages(
          redditRows,
          enableOgFallback: true,
        );
        return ExploreFeedResult(
          items: mapsToNewsArticles(enriched).take(30).toList(),
        );
      }
      final googleQ = resolveExploreGoogleQuery(cfg, startupRegion);
      return ExploreFeedResult(
        items: mapsToNewsArticles(buildFallbackRows(title, googleQ)),
        error: 'Could not load Reddit. Showing browse links only.',
      );
    }

    if (!canFetchLiveNews()) {
      final googleQ = resolveExploreGoogleQuery(cfg, startupRegion);
      return ExploreFeedResult(
        items: mapsToNewsArticles(buildFallbackRows(title, googleQ)),
        error:
            'Backend NewsAPI is unavailable. Set NEWSAPI_KEY on the server (Firebase Functions: `newsApi`). Showing browse links only.',
      );
    }

    final newsQ = resolveExploreNewsQuery(cfg, startupRegion);
    final googleQ = resolveExploreGoogleQuery(cfg, startupRegion);

    List<Map<String, dynamic>>? rows;
    if (newsQ.isNotEmpty) {
      final pageSize = isStartupsRegionTopic(section, topicId) && startupRegion == 'local'
          ? 50
          : section == 'ai-tech'
              ? 50
              : 30;
      rows = await fetchNewsApiEverythingNormalized(q: newsQ, pageSize: pageSize);
      if (rows.isNotEmpty) {
        if (isStartupsRegionTopic(section, topicId) && startupRegion == 'local') {
          rows = filterNewsRowsIndiaLocal(rows);
        }
        if (section == 'ai-tech') {
          rows = filterDeveloperRegistrySpamFromNewsRows(rows);
        }
        rows = rows.take(30).toList();
      }
    }

    if (rows == null || rows.isEmpty) {
      return ExploreFeedResult(
        items: mapsToNewsArticles(buildFallbackRows(title, googleQ)),
        error:
            'News returned no articles. Set NEWSAPI_KEY on Firebase Functions (`newsApi`) or pass API keys at build time. Check NewsAPI plan limits.',
      );
    }

    final enriched = await enrichNewsItemsWithOgImages(
      rows,
      enableOgFallback: true,
    );
    return ExploreFeedResult(items: mapsToNewsArticles(enriched));
  } catch (_) {
    final fallbackGoogle = resolveExploreGoogleQuery(cfg, startupRegion);
    return ExploreFeedResult(
      items: mapsToNewsArticles(
        buildFallbackRows(title, fallbackGoogle.isEmpty ? '' : fallbackGoogle),
      ),
      error: 'Live sources unavailable. Showing quick fallback headlines.',
    );
  }
}
