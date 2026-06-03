import 'package:deite/services/entrepreneurship_personalization_service.dart';

import 'pod_reddit_hot.dart';
import 'pod_topic_news_shared.dart';

const Map<String, List<String>> redditEntrepreneurshipSubs = {
  'startups': ['startups', 'SideProject', 'StartupAccelerators', 'StartupsHelpStartups'],
  'founders': ['EntrepreneurRideAlong', 'Entrepreneur'],
};

const Map<String, Map<String, int>> _hubTopicOpts = {
  'startups': {'maxPerSub': 45, 'maxKeep': 28, 'minScore': 12},
  'founders': {'maxPerSub': 45, 'maxKeep': 26, 'minScore': 12},
};

const Map<String, Map<String, int>> _exploreListOpts = {
  'startups': {'maxPerSub': 50, 'maxKeep': 34, 'minScore': 8},
  'founders': {'maxPerSub': 50, 'maxKeep': 32, 'minScore': 8},
};

Future<List<NewsArticle>> fetchEntrepreneurshipHubTrendingCarouselItems() async {
  final ordered = <NewsArticle>[];
  for (final topicId in podEntrepreneurshipExploreSlugs) {
    final subs = redditEntrepreneurshipSubs[topicId];
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

Future<List<Map<String, dynamic>>> fetchEntrepreneurshipRedditExploreRows(
  String topicId,
) async {
  final subs = redditEntrepreneurshipSubs[topicId];
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
