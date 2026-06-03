import 'pod_explore_topic_feed.dart';
import 'pod_topic_news_shared.dart';

const int _exploreCacheTtlMs = 12 * 60 * 1000;

class ExploreTopicCacheEntry {
  ExploreTopicCacheEntry({
    required this.items,
    required this.ts,
    this.error = '',
  });
  final List<NewsArticle> items;
  final String error;
  final int ts;
}

final _exploreStore = <String, ExploreTopicCacheEntry>{};
final _exploreInflight = <String, Future<void>>{};

String exploreTopicCacheKey(String section, String topicId, String startupRegion) {
  final r = startupRegion == 'local' || startupRegion == 'international'
      ? startupRegion
      : 'international';
  return '$section|$topicId|$r';
}

ExploreTopicCacheEntry? getExploreTopicFeedCacheEntry(String key) {
  final e = _exploreStore[key];
  if (e == null) return null;
  if (DateTime.now().millisecondsSinceEpoch - e.ts > _exploreCacheTtlMs) {
    _exploreStore.remove(key);
    return null;
  }
  return e;
}

List<NewsArticle>? getExploreTopicFeedCache(String key) =>
    getExploreTopicFeedCacheEntry(key)?.items;

void setExploreTopicFeedCache(String key, List<NewsArticle> items, {String error = ''}) {
  _exploreStore[key] = ExploreTopicCacheEntry(
    items: items,
    error: error,
    ts: DateTime.now().millisecondsSinceEpoch,
  );
}

void invalidateExploreTopicFeedCache(String key) {
  _exploreStore.remove(key);
  _exploreInflight.remove(key);
}

Future<void> prefetchExploreTopicRaw(
  String section,
  String topicId, [
  String startupRegion = 'international',
]) async {
  if (section.isEmpty || topicId.isEmpty) return;
  if (!canFetchLiveNews() &&
      section != 'ai-tech' &&
      section != 'entrepreneurship' &&
      section != 'current-affairs') {
    return;
  }
  final key = exploreTopicCacheKey(section, topicId, startupRegion);
  if (getExploreTopicFeedCacheEntry(key) != null) return;
  if (_exploreInflight.containsKey(key)) {
    await _exploreInflight[key];
    return;
  }

  final p = fetchExploreTopicFeed(
    section: section,
    topicId: topicId,
    startupRegion: startupRegion,
  ).then((res) {
    _exploreInflight.remove(key);
    if (res.items.isNotEmpty) {
      setExploreTopicFeedCache(key, res.items, error: res.error);
    }
  }).catchError((_) {
    _exploreInflight.remove(key);
  });

  _exploreInflight[key] = p;
  await p;
}
