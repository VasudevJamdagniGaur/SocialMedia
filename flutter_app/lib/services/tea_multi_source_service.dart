import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'package:deite/lib/hub_trending_algorithms.dart';
import 'package:deite/lib/pod_reddit_hot.dart';
import 'package:deite/lib/pod_topic_news_shared.dart';

import '../utils/hub_carousel_ai_image.dart';
import '../utils/tea_event_topics.dart';
import '../utils/tea_story_cluster.dart';
import '../utils/tea_topic_context.dart';
import 'reddit_tea_service.dart';
import 'youtube_tea_service.dart';

const _sectionCachePrefix = 'deite_tea_section_v1_';
const _sectionCacheTtl = Duration(minutes: 25);
const _newsApiUserAgent = 'DeiteNews/1.0 (+https://deitedatabase.web.app)';

DateTime? _lastTeaRefreshAt;
DateTime? get lastTeaRefreshAt => _lastTeaRefreshAt;

/// PullPush keyword search across optional subreddits.
Future<List<Map<String, dynamic>>> fetchRedditRowsByQuery({
  required String query,
  List<String> subs = const [],
  int maxKeep = 16,
}) async {
  final q = query.trim();
  if (q.isEmpty) return [];
  final seen = <String>{};
  final rows = <Map<String, dynamic>>[];
  final targets = subs.isEmpty ? [''] : subs;

  for (final sub in targets) {
    if (rows.length >= maxKeep) break;
    final params = <String, String>{
      'q': q,
      'size': '25',
      'sort': 'desc',
      'sort_type': 'created_utc',
    };
    if (sub.isNotEmpty) params['subreddit'] = sub;
    final uri = Uri.parse('https://api.pullpush.io/reddit/search/submission/')
        .replace(queryParameters: params);
    try {
      final res = await http
          .get(uri, headers: {
            'Accept': 'application/json',
            'User-Agent': _newsApiUserAgent,
          })
          .timeout(const Duration(seconds: 12));
      if (res.statusCode != 200) continue;
      final body = jsonDecode(res.body);
      final data = body is Map ? body['data'] : null;
      if (data is! List) continue;
      for (final raw in data) {
        if (rows.length >= maxKeep) break;
        if (raw is! Map) continue;
        final post = Map<String, dynamic>.from(raw);
        final subName = '${post['subreddit'] ?? sub}'.trim();
        if (!teaPostAllowed(post, minScore: 0)) continue;
        final row = rowFromRedditPost(post, subName.isEmpty ? 'reddit' : subName);
        if (row == null) continue;
        final url = '${row['url'] ?? ''}';
        if (url.isEmpty || seen.contains(url)) continue;
        seen.add(url);
        row['sourceType'] = 'reddit';
        row['category'] = 'reddit';
        rows.add(row);
      }
    } catch (e) {
      debugPrint('[TeaMulti] reddit query failed sub=$sub: $e');
    }
  }

  // Public Reddit search.json fallback (no OAuth) when PullPush is thin.
  if (rows.length < 4) {
    try {
      final uri = Uri.parse('https://www.reddit.com/search.json').replace(
        queryParameters: {
          'q': q,
          'sort': 'new',
          'limit': '25',
          'raw_json': '1',
        },
      );
      final res = await http
          .get(uri, headers: {
            'Accept': 'application/json',
            'User-Agent': _newsApiUserAgent,
          })
          .timeout(const Duration(seconds: 10));
      if (res.statusCode == 200) {
        final body = jsonDecode(res.body);
        final data = body is Map ? body['data'] : null;
        final children = data is Map ? data['children'] : null;
        if (children is List) {
          for (final child in children) {
            if (rows.length >= maxKeep) break;
            if (child is! Map) continue;
            final post = child['data'];
            if (post is! Map) continue;
            final map = Map<String, dynamic>.from(post);
            final subName = '${map['subreddit'] ?? 'reddit'}';
            if (!teaPostAllowed(map, minScore: 0)) continue;
            final row = rowFromRedditPost(map, subName);
            if (row == null) continue;
            final url = '${row['url'] ?? ''}';
            if (url.isEmpty || seen.contains(url)) continue;
            seen.add(url);
            row['sourceType'] = 'reddit';
            row['category'] = 'reddit';
            rows.add(row);
          }
        }
      }
    } catch (e) {
      debugPrint('[TeaMulti] reddit search.json failed: $e');
    }
  }
  return rows;
}

Future<List<Map<String, dynamic>>> _fetchRssQueries(
  List<String> queries, {
  int timeoutMs = 6500,
  int maxPerQuery = 8,
}) async {
  final out = <Map<String, dynamic>>[];
  final seen = <String>{};
  for (final q in queries) {
    if (q.trim().isEmpty) continue;
    try {
      final rss = await fetchLiveFromGoogleRssByQueryFast(q, timeoutMs: timeoutMs)
          .timeout(Duration(milliseconds: timeoutMs + 500), onTimeout: () => []);
      for (final row in teaRowsFromRssArticles(rss).take(maxPerQuery)) {
        final url = '${row['url'] ?? ''}'.trim();
        if (url.isEmpty || seen.contains(url)) continue;
        seen.add(url);
        out.add(row);
      }
    } catch (_) {}
  }
  return out;
}

Future<List<Map<String, dynamic>>> _fetchNewsApiQuery(String q, {int pageSize = 8}) async {
  if (q.trim().isEmpty) return [];
  try {
    final rows = await fetchNewsApiEverythingNormalized(q: q, pageSize: pageSize)
        .timeout(const Duration(seconds: 8), onTimeout: () => []);
    return teaRowsFromRssArticles(rows);
  } catch (_) {
    return [];
  }
}

Future<List<Map<String, dynamic>>> _fetchRedditHotSubs(
  List<String> subs, {
  int maxKeep = 20,
}) async {
  final out = <Map<String, dynamic>>[];
  final seen = <String>{};
  for (final sub in subs.take(5)) {
    if (out.length >= maxKeep) break;
    try {
      final rows = await tryRedditHotRows(
        [sub],
        maxPerSub: 20,
        maxKeep: 8,
        minScore: 1,
        timeoutMs: 8000,
        filterPost: teaPostAllowed,
      ).timeout(const Duration(seconds: 9), onTimeout: () => []);
      for (final row in rows) {
        final url = '${row['url'] ?? ''}';
        if (url.isEmpty || seen.contains(url)) continue;
        seen.add(url);
        row['sourceType'] = 'reddit';
        out.add(row);
      }
    } catch (_) {}
  }
  if (out.isEmpty) {
    // PullPush fallback for first few subs.
    try {
      final push = await fetchTeaRowsFromPullPush(maxKeep: maxKeep);
      out.addAll(push);
    } catch (_) {}
  }
  return out.take(maxKeep).toList();
}

List<Map<String, dynamic>> _mergeRows(Iterable<List<Map<String, dynamic>>> parts) {
  final seen = <String>{};
  final out = <Map<String, dynamic>>[];
  for (final list in parts) {
    for (final row in list) {
      final url = '${row['url'] ?? ''}'.trim();
      if (url.isEmpty || seen.contains(url)) continue;
      seen.add(url);
      out.add(row);
    }
  }
  return out;
}

Future<List<Map<String, dynamic>>?> _loadSectionDisk(String key) async {
  try {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('$_sectionCachePrefix$key');
    if (raw == null || raw.isEmpty) return null;
    final decoded = jsonDecode(raw);
    if (decoded is! Map) return null;
    final savedAt = DateTime.tryParse('${decoded['savedAt'] ?? ''}');
    if (savedAt == null || DateTime.now().difference(savedAt) > _sectionCacheTtl) {
      return null;
    }
    final items = decoded['items'];
    if (items is! List) return null;
    return items.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
  } catch (_) {
    return null;
  }
}

Future<void> _saveSectionDisk(String key, List<Map<String, dynamic>> rows) async {
  try {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      '$_sectionCachePrefix$key',
      jsonEncode({
        'savedAt': DateTime.now().toIso8601String(),
        'items': rows.take(40).toList(),
      }),
    );
  } catch (_) {}
}

/// Fetch + cluster a Tea feed section.
Future<List<TeaStoryCluster>> fetchTeaSectionClusters(
  TeaFeedSection section, {
  bool forceRefresh = false,
}) async {
  final cacheKey = section.id;
  if (!forceRefresh) {
    final cached = await _loadSectionDisk(cacheKey);
    if (cached != null && cached.isNotEmpty) {
      return clusterTeaRows(
        cached,
        category: section.id,
        isBreaking: section == TeaFeedSection.breaking,
      );
    }
  }

  List<Map<String, dynamic>> rows;
  switch (section) {
    case TeaFeedSection.breaking:
      final rss = await _fetchRssQueries(teaSectionGoogleQueries[section]!);
      final reddit = await _fetchRedditHotSubs(teaSectionRedditSubs[section]!);
      rows = _mergeRows([rss, reddit]);
      for (final r in rows) {
        r['isBreaking'] = true;
        r['category'] = 'breaking';
      }
      break;
    case TeaFeedSection.fun:
      final rss = await _fetchRssQueries(teaSectionGoogleQueries[section]!);
      final reddit = await _fetchRedditHotSubs(teaSectionRedditSubs[section]!);
      rows = _mergeRows([rss, reddit]);
      for (final r in rows) {
        r['category'] = 'fun';
      }
      break;
    case TeaFeedSection.reddit:
      rows = await _fetchRedditHotSubs(teaSectionRedditSubs[section]!, maxKeep: 28);
      break;
    case TeaFeedSection.socialBuzz:
      // Authorized public social lane: YouTube + Reddit (no X/IG API keys in repo).
      final yt = await fetchTeaRowsFromYouTube(maxKeep: 12)
          .timeout(const Duration(seconds: 10), onTimeout: () => []);
      final reddit = await _fetchRedditHotSubs(teaSectionRedditSubs[section]!);
      final rss = await _fetchRssQueries(teaSectionGoogleQueries[section]!);
      rows = _mergeRows([yt, reddit, rss]);
      for (final r in rows) {
        r['category'] = 'social';
      }
      break;
    case TeaFeedSection.events:
      rows = await fetchAllRegisteredEventRows();
      break;
    case TeaFeedSection.trending:
      rows = await fetchTrendingTeaRows(deferEnrich: true);
      // Blend in India/politics RSS.
      final extra = await _fetchRssQueries(teaSectionGoogleQueries[section]!);
      rows = _mergeRows([rows, extra]);
      break;
    case TeaFeedSection.forYou:
      // Mix classic Tea + India news/tech/sports; watchlist boost applied in UI.
      rows = await fetchTrendingTeaRows(deferEnrich: true);
      final interestRss = await _fetchRssQueries(teaSectionGoogleQueries[section]!);
      final eventRows = await fetchAllRegisteredEventRows();
      rows = _mergeRows([eventRows, rows, interestRss]);
      break;
  }

  // Tag known events.
  for (final r in rows) {
    final eid = matchTeaEventId(
      '${r['title'] ?? ''}',
      '${r['gossip'] ?? r['description'] ?? ''}',
    );
    if (eid != null) r['eventId'] = eid;
  }

  sortHubMapRowsImageFirst(
    rows,
    hasReliableImage: teaRowHasReliableImage,
    compare: (a, b) => hubMapRowScore(b).compareTo(hubMapRowScore(a)),
  );

  await _saveSectionDisk(cacheKey, rows);
  _lastTeaRefreshAt = DateTime.now();

  return clusterTeaRows(
    rows,
    category: section.id,
    isBreaking: section == TeaFeedSection.breaking,
  );
}

/// Discover coverage for one registered event via multi-source queries.
Future<List<Map<String, dynamic>>> fetchEventTopicRows(
  TeaEventTopic topic, {
  int maxKeep = 40,
}) async {
  final parts = await Future.wait([
    _fetchRssQueries(topic.googleQueries, timeoutMs: 8000, maxPerQuery: 10),
    _fetchNewsApiQuery(topic.newsApiQuery, pageSize: 10),
    fetchRedditRowsByQuery(
      query: topic.redditQuery,
      subs: topic.redditSubs,
      maxKeep: 12,
    ),
    fetchYouTubeRowsByQuery(topic.youtubeQuery, maxKeep: 6),
  ]);

  final merged = _mergeRows(parts);
  for (final r in merged) {
    r['eventId'] = topic.eventId;
    r['category'] = topic.category;
    r['isBreaking'] = topic.isBreaking;
  }
  return merged.take(maxKeep).toList();
}

Future<List<Map<String, dynamic>>> fetchAllRegisteredEventRows() async {
  final batches = await Future.wait(
    teaEventTopics.map((t) => fetchEventTopicRows(t)),
  );
  return _mergeRows(batches);
}

/// Full event aggregation: clusters + optional context enrichment for hero.
Future<TeaStoryCluster?> fetchEventStoryBundle(
  String eventId, {
  bool enrichHero = true,
}) async {
  final topic = teaEventTopicById(eventId);
  if (topic == null) return null;
  final rows = await fetchEventTopicRows(topic);
  if (rows.isEmpty) {
    debugPrint('[TeaEvent] no accessible coverage for $eventId');
    return null;
  }
  final clusters = clusterTeaRows(
    rows,
    eventId: topic.eventId,
    category: topic.category,
    isBreaking: topic.isBreaking,
    similarityThreshold: 0.32,
  );
  if (clusters.isEmpty) return null;

  // Merge all clusters into one event umbrella cluster for the detail view.
  final allRelated = <Map<String, String>>[];
  final allMembers = <Map<String, dynamic>>[];
  final seenUrl = <String>{};
  for (final c in clusters) {
    for (final s in c.relatedSources) {
      final u = s['url'] ?? '';
      if (u.isEmpty || seenUrl.contains(u)) continue;
      seenUrl.add(u);
      allRelated.add(s);
    }
    allMembers.addAll(c.members);
  }
  final hero = clusters.first;
  var summary = hero.summary;
  if (enrichHero) {
    try {
      final ctx = await enrichTeaTopicContext(hero.toTeaRow());
      if (ctx.displaySummary.isNotEmpty) summary = ctx.displaySummary;
    } catch (_) {}
  }

  return TeaStoryCluster(
    storyId: 'event_${topic.eventId}',
    title: topic.label,
    summary: summary.isNotEmpty
        ? summary
        : 'Aggregated coverage of ${topic.label} from ${allRelated.length} accessible sources.',
    category: topic.category,
    sourceType: 'event',
    sourceName: 'Multi-source',
    sourceUrl: hero.sourceUrl,
    publishedAt: hero.publishedAt,
    firstSeenAt: hero.firstSeenAt,
    lastUpdatedAt: DateTime.now(),
    thumbnailUrl: hero.thumbnailUrl,
    relatedSources: allRelated,
    relatedStoryIds: clusters.map((c) => c.storyId).toList(),
    eventId: topic.eventId,
    verifiedFacts: [
      'Event topic: ${topic.label}',
      'Accessible source count: ${allRelated.length}',
      ...hero.verifiedFacts.take(3),
    ],
    unverifiedClaims: hero.unverifiedClaims,
    contextLevel: allRelated.length >= 2
        ? TeaContextLevel.multiSource.name
        : TeaContextLevel.headlineOnly.name,
    engagement: clusters.fold<int>(0, (a, c) => a + c.engagement),
    isBreaking: topic.isBreaking,
    isDeveloping: true,
    contentStatus: allRelated.isEmpty ? 'unavailable' : 'partial',
    members: allMembers,
  );
}

/// Flat rows for a section (for TeaItem mapping).
Future<List<Map<String, dynamic>>> fetchTeaSectionRows(
  TeaFeedSection section, {
  bool forceRefresh = false,
}) async {
  final clusters = await fetchTeaSectionClusters(
    section,
    forceRefresh: forceRefresh,
  );
  return clusters.map((c) => c.toTeaRow()).toList();
}
