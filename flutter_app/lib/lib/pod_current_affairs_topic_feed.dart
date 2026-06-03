import 'package:deite/services/current_affairs_personalization_service.dart';

import 'pod_current_affairs_constants.dart' show redditCurrentAffairsSubs;
import 'pod_reddit_hot.dart';
import 'pod_topic_news_shared.dart';

const Map<String, int> _exploreOpts = {'maxPerSub': 45, 'maxKeep': 28, 'minScore': 7};

int redditEngagement(Map<String, dynamic> row) {
  final s = row['score'] is num ? (row['score'] as num).toInt() : 0;
  final c = row['num_comments'] is num ? (row['num_comments'] as num).toInt() : 0;
  return s + c * 2;
}

Future<List<Map<String, dynamic>>> fetchCurrentAffairsRedditExploreRows(
  String topicId,
) async {
  final subs = redditCurrentAffairsSubs[topicId];
  if (subs == null || subs.isEmpty) return [];
  var rows = await tryRedditHotRows(
    subs,
    maxPerSub: _exploreOpts['maxPerSub']!,
    maxKeep: _exploreOpts['maxKeep']!,
    minScore: _exploreOpts['minScore']!,
  );
  if (rows.isEmpty && _exploreOpts['minScore']! > 4) {
    rows = await tryRedditHotRows(
      subs,
      maxPerSub: _exploreOpts['maxPerSub']!,
      maxKeep: _exploreOpts['maxKeep']!,
      minScore: 4,
    );
  }
  return rows.map((r) => {...r, 'exploreTopic': topicId}).toList();
}

Future<List<NewsArticle>> fetchCurrentAffairsHubTrendingCarouselItems() async {
  final weights = await getCurrentAffairsPersonalizationWeights();

  final rowsByTopic = await Future.wait(
    podCurrentAffairsExploreSlugs.map(fetchCurrentAffairsRedditExploreRows),
  );

  final seenUrl = <String>{};
  final candidates = <Map<String, dynamic>>[];
  for (var i = 0; i < podCurrentAffairsExploreSlugs.length; i++) {
    final topic = podCurrentAffairsExploreSlugs[i];
    for (final row in rowsByTopic[i]) {
      final url = '${row['url'] ?? ''}'.trim();
      final key = url.isNotEmpty ? url : '${row['title'] ?? ''}'.toLowerCase();
      if (key.isEmpty || seenUrl.contains(key)) continue;
      seenUrl.add(key);
      candidates.add({...row, 'exploreTopic': topic});
    }
  }

  double topicPreference(String topic) {
    final w = (weights[topic] as num?)?.toDouble() ?? 0;
    final fromUsage = 1 + (w / 55) * 0.55;
    final worldFloor = topic == 'world-news' ? 1.22 : 1.0;
    return fromUsage * worldFloor;
  }

  final scored = candidates.map((r) {
    final topic = '${r['exploreTopic'] ?? 'world-news'}';
    final eng = redditEngagement(r);
    return {...r, '_rank': eng * topicPreference(topic)};
  }).toList();

  scored.sort((a, b) => ((b['_rank'] as num?) ?? 0).compareTo((a['_rank'] as num?) ?? 0));

  return scored.take(10).map((pick) {
    return NewsArticle.fromNormalized({
      'title': pick['title'],
      'url': pick['url'],
      'source': pick['source'] ?? 'Reddit',
      'image': pick['image'] ?? pick['thumbnail'],
      'description': pick['description'] ?? '',
      'publishedAt': pick['publishedAt'],
      'exploreTopic': pick['exploreTopic'] ?? 'world-news',
      'trendingScore': pick['score'],
    });
  }).toList();
}
