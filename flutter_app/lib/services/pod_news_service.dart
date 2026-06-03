/// Barrel export for pod hub news feeds — mirrors src/lib/pod* + screens imports.
library;

export 'package:deite/lib/pod_ai_tech_topic_feed.dart';
export 'package:deite/lib/pod_current_affairs_constants.dart';
export 'package:deite/lib/pod_current_affairs_topic_feed.dart';
export 'package:deite/lib/pod_entrepreneurship_topic_feed.dart';
export 'package:deite/lib/pod_explore_topic_config.dart' hide buildFallbackRows;
export 'package:deite/lib/pod_explore_topic_feed.dart';
export 'package:deite/lib/pod_explore_topic_prefetch_cache.dart';
export 'package:deite/lib/pod_reddit_hot.dart';
export 'package:deite/lib/pod_sports_topic_feed.dart';
export 'package:deite/lib/pod_sports_topic_prefetch_cache.dart';
export 'package:deite/lib/pod_topic_news_shared.dart' show NewsArticle;
export 'package:deite/lib/reddit_post_filter.dart';

import 'package:deite/lib/pod_topic_news_shared.dart';

// Trending classification helpers (used by hub personalization widgets)

bool isLikelySportsTrendingItem(NewsArticle a) {
  final blob = '${a.title} ${a.description}'.toLowerCase();
  return blob.contains('sport') ||
      blob.contains('cricket') ||
      blob.contains('football') ||
      blob.contains('soccer') ||
      blob.contains('f1') ||
      blob.contains('chess');
}

String classifyExploreSlugForTrending(NewsArticle a) {
  final t = '${a.title} ${a.description}'.toLowerCase();
  if (t.contains('cricket')) return 'cricket';
  if (t.contains('football') || t.contains('soccer')) return 'football';
  if (t.contains('f1') || t.contains('formula')) return 'f1';
  if (t.contains('chess')) return 'chess';
  return 'others';
}

String classifyExploreSlugForAiTechTrending(NewsArticle a) {
  final t = a.title.toLowerCase();
  if (t.contains('startup')) return 'startups';
  if (t.contains('openai') || t.contains('gemini') || t.contains('llm')) {
    return 'ai-models';
  }
  return 'tools';
}

bool isLikelyAiTechTrendingItem(NewsArticle a) {
  final t = '${a.title} ${a.description}'.toLowerCase();
  return t.contains('ai') || t.contains('tech') || t.contains('software');
}

String classifyExploreSlugForEntrepreneurshipTrending(NewsArticle a) {
  final t = a.title.toLowerCase();
  return t.contains('founder') ? 'founders' : 'startups';
}

bool isLikelyEntrepreneurshipTrendingItem(NewsArticle a) {
  final t = '${a.title} ${a.description}'.toLowerCase();
  return t.contains('startup') || t.contains('business') || t.contains('founder');
}
