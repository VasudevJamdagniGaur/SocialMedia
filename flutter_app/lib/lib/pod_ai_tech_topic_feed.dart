import 'package:deite/services/ai_tech_personalization_service.dart';

import 'pod_reddit_hot.dart';
import 'pod_topic_news_shared.dart';

const Map<String, List<String>> redditAiTechSubs = {
  'ai-models': ['ArtificialIntelligence', 'LocalLLaMA', 'AI_Agents'],
  'startups': ['startups', 'Entrepreneur', 'EntrepreneurRideAlong', 'SideProject'],
  'tools': ['AIToolsAndTips', 'AIToolTesting', 'ChatGPTPromptGenius'],
  'vibe-coding': ['programming', 'webdev', 'VibeCodeDevs', 'vibecoding'],
  'big-tech': [
    'google',
    'facebook',
    'apple',
    'microsoft',
    'amazon',
    'tech',
    'ClaudeAI',
    'ChatGPT',
  ],
};

const Map<String, Map<String, int>> _hubTopicOpts = {
  'ai-models': {'maxPerSub': 45, 'maxKeep': 26, 'minScore': 10},
  'startups': {'maxPerSub': 45, 'maxKeep': 26, 'minScore': 12},
  'tools': {'maxPerSub': 45, 'maxKeep': 26, 'minScore': 10},
  'vibe-coding': {'maxPerSub': 45, 'maxKeep': 26, 'minScore': 10},
  'big-tech': {'maxPerSub': 45, 'maxKeep': 28, 'minScore': 14},
};

const Map<String, Map<String, int>> _exploreListOpts = {
  'ai-models': {'maxPerSub': 50, 'maxKeep': 32, 'minScore': 8},
  'startups': {'maxPerSub': 50, 'maxKeep': 32, 'minScore': 10},
  'tools': {'maxPerSub': 50, 'maxKeep': 32, 'minScore': 8},
  'vibe-coding': {'maxPerSub': 50, 'maxKeep': 32, 'minScore': 8},
  'big-tech': {'maxPerSub': 50, 'maxKeep': 34, 'minScore': 10},
};

Future<List<NewsArticle>> fetchAiTechHubTrendingCarouselItems() async {
  final ordered = <NewsArticle>[];
  for (final topicId in podAiTechExploreSlugs) {
    final subs = redditAiTechSubs[topicId];
    if (subs == null || subs.isEmpty) continue;
    final base = _hubTopicOpts[topicId] ?? {'maxPerSub': 40, 'maxKeep': 22, 'minScore': 10};

    var rows = await tryRedditHotRows(
      subs,
      maxPerSub: base['maxPerSub']!,
      maxKeep: base['maxKeep']!,
      minScore: base['minScore']!,
    );
    var pick = pickBestHubCarouselRow(rows);
    if (pick == null && base['minScore']! > 6) {
      rows = await tryRedditHotRows(
        subs,
        maxPerSub: base['maxPerSub']!,
        maxKeep: base['maxKeep']!,
        minScore: 6,
      );
      pick = pickBestHubCarouselRow(rows);
    }
    if (pick != null) {
      ordered.add(
        NewsArticle.fromNormalized(
          hubCarouselFromRedditRow(pick, exploreTopic: topicId),
        ),
      );
    }
  }
  return ordered;
}

Future<List<Map<String, dynamic>>> fetchAiTechRedditExploreRows(String topicId) async {
  final subs = redditAiTechSubs[topicId];
  if (subs == null || subs.isEmpty) return [];
  final base = _exploreListOpts[topicId] ?? {'maxPerSub': 45, 'maxKeep': 30, 'minScore': 8};
  var rows = await tryRedditHotRows(
    subs,
    maxPerSub: base['maxPerSub']!,
    maxKeep: base['maxKeep']!,
    minScore: base['minScore']!,
  );
  if (rows.isEmpty && base['minScore']! > 5) {
    rows = await tryRedditHotRows(
      subs,
      maxPerSub: base['maxPerSub']!,
      maxKeep: base['maxKeep']!,
      minScore: 5,
    );
  }
  return rows.map((r) => {...r, 'exploreTopic': topicId}).toList();
}
