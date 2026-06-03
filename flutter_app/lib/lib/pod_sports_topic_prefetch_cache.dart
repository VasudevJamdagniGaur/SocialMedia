import 'package:deite/services/sports_personalization_service.dart';

import 'pod_sports_topic_feed.dart';
import 'pod_topic_news_shared.dart';

const int _sportsCacheTtlMs = 12 * 60 * 1000;

class SportsTopicCacheEntry {
  SportsTopicCacheEntry({
    required this.items,
    required this.ts,
    this.error = '',
    this.rewritten = false,
    this.fromRssPrefetch = false,
  });
  final List<NewsArticle> items;
  final String error;
  final bool rewritten;
  final bool fromRssPrefetch;
  final int ts;
}

final _sportsStore = <String, SportsTopicCacheEntry>{};
final _sportsInflight = <String, Future<void>>{};

SportsTopicCacheEntry? getSportsTopicFeedCacheEntry(String topicId) {
  final e = _sportsStore[topicId];
  if (e == null) return null;
  if (DateTime.now().millisecondsSinceEpoch - e.ts > _sportsCacheTtlMs) {
    _sportsStore.remove(topicId);
    return null;
  }
  return e;
}

List<NewsArticle>? getSportsTopicFeedCache(String topicId) =>
    getSportsTopicFeedCacheEntry(topicId)?.items;

void setSportsTopicFeedCache(
  String topicId,
  List<NewsArticle> items, {
  String error = '',
  bool rewritten = false,
  bool fromRssPrefetch = false,
}) {
  _sportsStore[topicId] = SportsTopicCacheEntry(
    items: items,
    error: error,
    rewritten: rewritten,
    fromRssPrefetch: fromRssPrefetch,
    ts: DateTime.now().millisecondsSinceEpoch,
  );
}

void invalidateSportsTopicFeedCache(String topicId) {
  _sportsStore.remove(topicId);
  _sportsInflight.remove(topicId);
}

void invalidateAllSportsTopicExploreCaches() {
  for (final id in podSportsExploreSlugs) {
    _sportsStore.remove(id);
    _sportsInflight.remove(id);
  }
}

Future<void> prefetchAllSportsExploreTopicsNow() async {
  if (!canFetchLiveNews()) return;
  await Future.wait(
    podSportsExploreSlugs.map((slug) => prefetchSportsTopicRaw(slug)),
  );
}

Future<void> refreshAllSportsExploreTopicCaches() async {
  invalidateAllSportsTopicExploreCaches();
  await prefetchAllSportsExploreTopicsNow();
}

void prefetchSportsExploreTopics() {
  if (!canFetchLiveNews()) return;
  for (var i = 0; i < podSportsExploreSlugs.length; i++) {
    final slug = podSportsExploreSlugs[i];
    Future.delayed(Duration(milliseconds: 200 + i * 400), () {
      prefetchSportsTopicRaw(slug);
    });
  }
}

Future<void> prefetchSportsTopicRaw(String topicId) async {
  if (topicId.isEmpty || !canFetchLiveNews()) return;
  if (getSportsTopicFeedCacheEntry(topicId) != null) return;
  if (_sportsInflight.containsKey(topicId)) {
    await _sportsInflight[topicId];
    return;
  }

  final p = fetchSportsTopicRawItemsResult(topicId, rssOnlyPrefetch: true).then((res) {
    _sportsInflight.remove(topicId);
    if (res.items.isNotEmpty) {
      setSportsTopicFeedCache(
        topicId,
        res.items,
        error: res.error,
        rewritten: !res.allowRewrite,
        fromRssPrefetch: true,
      );
    }
  }).catchError((_) {
    _sportsInflight.remove(topicId);
  });

  _sportsInflight[topicId] = p;
  await p;
}
