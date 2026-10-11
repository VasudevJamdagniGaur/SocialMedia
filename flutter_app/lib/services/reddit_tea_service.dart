import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../config/env.dart';
import '../lib/hub_trending_algorithms.dart';
import '../lib/pod_reddit_hot.dart';
import '../lib/pod_topic_news_shared.dart';
import '../lib/reddit_post_filter.dart';
import '../utils/hub_carousel_ai_image.dart';
import '../utils/reddit_thread_comments.dart';
import '../utils/share_news_cache.dart';
import '../utils/tea_content_extraction.dart';
import 'youtube_tea_service.dart';

const _pullPushBase = 'https://api.pullpush.io/reddit/search/submission/';
const _teaSubs = ['BollyBlindsNGossip', 'BollywoodGossip'];
const _newsApiUserAgent = 'DeiteNews/1.0 (+https://deitedatabase.web.app)';

/// Candidate backend bases (Express / Dart server).
List<String> redditProxyBaseUrls() {
  final seen = <String>{};
  void add(String? u) {
    final t = u?.trim().replaceAll(RegExp(r'/$'), '') ?? '';
    if (t.isNotEmpty && t.startsWith('http')) seen.add(t);
  }

  add(Env.backendUrl.trim().isNotEmpty ? Env.backendUrl : null);
  add(Env.baseUrl);

  if (kIsWeb) {
    final host = Uri.base.host;
    if (host == 'localhost' || host == '127.0.0.1') {
      add('http://localhost:3002');
    }
  } else if (defaultTargetPlatform == TargetPlatform.android) {
    add('http://10.0.2.2:3002');
    add('http://127.0.0.1:3002');
    add('http://localhost:3002');
  }

  return seen.toList();
}

bool isRedditTeaThreadUrl(String? url) => isRedditThreadUrl(url);

/// Fetches the OG/meta image for a non-Reddit article URL via the backend extractor.
Future<String?> fetchArticleOgImage(String articleUrl) async {
  for (final base in redditProxyBaseUrls()) {
    try {
      final url = Uri.parse('$base/api/linkedin/article').replace(
        queryParameters: {'url': articleUrl},
      );
      final res = await http
          .get(url, headers: {'Accept': 'application/json', 'User-Agent': _newsApiUserAgent})
          .timeout(const Duration(seconds: 12));
      if (res.statusCode != 200) continue;
      final body = jsonDecode(res.body);
      if (body is! Map) continue;
      final image = '${body['image'] ?? ''}'.trim();
      if (image.startsWith('http')) return image;
    } catch (_) {}
  }
  return null;
}

bool _teaRowNeedsBodyEnrichment(Map<String, dynamic> row) {
  final title = cleanTeaCardTitle('${row['title'] ?? ''}');
  final gossip =
      '${row['gossip'] ?? row['description'] ?? row['selftext'] ?? row['body'] ?? ''}'
          .trim();
  if (gossip.length < 40) return true;
  if (teaTextLooksLikeTitleEcho(gossip, title)) return true;
  return false;
}

/// Fill missing gossip/body and hero images for Tea rows.
/// Reddit → thread JSON; YouTube → Data API description; articles → backend extractor.
Future<List<Map<String, dynamic>>> enrichTeaRows(
  List<Map<String, dynamic>> rows, {
  int maxEnrich = 10,
}) async {
  if (rows.isEmpty) return rows;

  final out = rows.map((r) => Map<String, dynamic>.from(r)).toList();
  final tasks = <Future<void>>[];
  var queued = 0;

  for (var i = 0; i < out.length && queued < maxEnrich; i++) {
    final row = out[i];
    final url = '${row['url'] ?? ''}'.trim();
    if (url.isEmpty) continue;

    final image = '${row['image'] ?? row['thumbnail'] ?? ''}'.trim();
    final needsGossip = _teaRowNeedsBodyEnrichment(row);
    final needsImage = !RegExp(r'^https?://', caseSensitive: false).hasMatch(image);
    if (!needsGossip && !needsImage) continue;

    final idx = i;
    queued++;
    tasks.add(() async {
      try {
        if (needsGossip) {
          final extracted = await resolveTeaPostContent(out[idx]);
          final merged = out[idx];
          if (extracted.title.isNotEmpty) merged['title'] = extracted.title;
          if (extracted.hasSubstantialBody || extracted.body.trim().length >= 40) {
            merged['gossip'] = extracted.body;
            merged['description'] = extracted.body;
            merged['selftext'] = extracted.body;
            merged['body'] = extracted.body;
            merged['extractionStatus'] = extracted.extractionStatus.name;
          } else {
            merged['extractionStatus'] = extracted.extractionStatus.name;
            if (extracted.diagnostic.isNotEmpty) {
              merged['extractionDiagnostic'] = extracted.diagnostic;
            }
          }
          // Propagate headline-first context fields when present on seed merge.
          final seedCtx = extracted.contentStatus;
          if (seedCtx.isNotEmpty) merged['contextLevel'] = seedCtx;
          if (extracted.body.isNotEmpty &&
              '${merged['gossip'] ?? ''}'.trim().isEmpty) {
            merged['gossip'] = extracted.body;
            merged['description'] = extracted.body;
          }
          if (extracted.author.isNotEmpty) merged['author'] = extracted.author;
          if (extracted.media.isNotEmpty) {
            merged['image'] = extracted.media.first;
            merged['thumbnail'] = extracted.media.first;
          }
          debugPrint(
            '[TeaEnrich] idx=$idx status=${extracted.extractionStatus.name} '
            'bodyLen=${extracted.body.length}',
          );
        } else if (needsImage) {
          final isReddit = isRedditTeaThreadUrl(url);
          if (isReddit) {
            final details = await fetchRedditThreadDetails(url, seed: out[idx]);
            final img = '${details?['image'] ?? ''}'.trim();
            if (img.startsWith('http')) {
              out[idx]['image'] = img;
              out[idx]['thumbnail'] = img;
            }
          } else {
            final img = await fetchArticleOgImage(url);
            if (img != null) {
              out[idx]['image'] = img;
              out[idx]['thumbnail'] = img;
            }
          }
        }
      } catch (e) {
        debugPrint('[TeaEnrich] failed idx=$idx: $e');
      }
    }());
  }

  if (tasks.isNotEmpty) await Future.wait(tasks);
  return out;
}

bool teaPostAllowed(Map<String, dynamic> post, {int minScore = 1}) {
  if (post['stickied'] == true) return false;
  final author = '${post['author'] ?? ''}'.trim();
  if (author == 'AutoModerator' || author == '[deleted]') return false;
  final title = '${post['title'] ?? ''}'.trim();
  if (title.isEmpty || title == '[removed]' || title == '[deleted]') return false;
  if (titleHasExcludedKeyword(title)) return false;
  final score = post['score'] is num ? (post['score'] as num).toInt() : 0;
  if (score < minScore) return false;
  return true;
}

Map<String, dynamic>? rowFromRedditPost(Map<String, dynamic> post, String sub) {
  final title = post['title'] is String ? (post['title'] as String).trim() : '';
  if (title.isEmpty) return null;
  final link = redditPermalinkUrl(post);
  if (!RegExp(r'^https?://', caseSensitive: false).hasMatch(link)) return null;
  final image = resolveRedditPostImage(post);
  final thumbnail = post['thumbnail'] is String ? (post['thumbnail'] as String).trim() : '';
  final thumb = RegExp(r'^https?://', caseSensitive: false).hasMatch(thumbnail) &&
          thumbnail != 'self' &&
          thumbnail != 'default'
      ? thumbnail
      : null;
  final gossip = redditGossipSnippetFromPost(post);
  final author = '${post['author'] ?? ''}'.trim();
  return {
    'title': title,
    'url': link,
    'image': image ?? thumb,
    'thumbnail': thumb ?? image,
    'score': post['score'] is num ? (post['score'] as num).toInt() : 0,
    'num_comments': post['num_comments'] is num ? (post['num_comments'] as num).toInt() : 0,
    'author': author.isNotEmpty && author != '[deleted]' ? author : 'unknown',
    'source': 'r/$sub',
    'description': gossip,
    'gossip': gossip,
    'selftext': gossip,
  };
}

List<Map<String, dynamic>> parseRedditHotRssXml(String xml) {
  final items = <Map<String, dynamic>>[];
  final entryBlocks = RegExp(r'<entry>[\s\S]*?</entry>', multiLine: true).allMatches(xml);
  for (final m in entryBlocks) {
    final block = m.group(0) ?? '';
    final titleM = RegExp(
      r'<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?</title>',
      caseSensitive: false,
    ).firstMatch(block);
    final linkM = RegExp(r'<link[^>]+href="([^"]+)"', caseSensitive: false).firstMatch(block);
    final thumbM =
        RegExp(r'<media:thumbnail[^>]+url="([^"]+)"', caseSensitive: false).firstMatch(block);
    var title = titleM?.group(1)?.replaceAll(RegExp(r'\s+'), ' ').trim() ?? '';
    title = title.replaceAll('&amp;', '&').replaceAll('&#39;', "'");
    final url = linkM?.group(1)?.trim() ?? '';
    if (title.isEmpty || url.isEmpty) continue;
    final lower = title.toLowerCase();
    if (lower.contains('fanclub-style') ||
        lower.contains('how can members help mods') ||
        lower.contains('why we don')) {
      continue;
    }
    final image = thumbM?.group(1)?.replaceAll('&amp;', '&') ?? '';
    items.add({
      'title': title,
      'url': url,
      'image': image,
      'thumbnail': image,
      'score': 0,
      'num_comments': 0,
      'author': 'r/BollyBlindsNGossip',
      'source': 'r/BollyBlindsNGossip',
    });
    if (items.length >= 15) break;
  }
  return items;
}

/// Fresh posts via backend RSS parser (`/api/reddit/tea`).
Future<List<Map<String, dynamic>>> fetchTeaRowsFromBackendTeaRss({
  int maxKeep = 12,
}) async {
  for (final base in redditProxyBaseUrls()) {
    try {
      final url = '$base/api/reddit/tea?${Uri(queryParameters: {
        'sub': 'BollyBlindsNGossip',
        'limit': '25',
      }).query}';
      final res = await http
          .get(Uri.parse(url), headers: {'Accept': 'application/json', 'User-Agent': _newsApiUserAgent})
          .timeout(const Duration(seconds: 12));
      if (res.statusCode != 200) continue;
      final body = jsonDecode(res.body);
      if (body is! Map || body['ok'] != true) continue;
      final raw = body['items'];
      if (raw is! List || raw.isEmpty) continue;
      final rows = <Map<String, dynamic>>[];
      for (final item in raw) {
        if (item is! Map) continue;
        final m = Map<String, dynamic>.from(item);
        if ('${m['url'] ?? ''}'.trim().isEmpty) continue;
        if (m['image'] is String) m['image'] = (m['image'] as String).replaceAll('&amp;', '&');
        if (m['thumbnail'] is String) {
          m['thumbnail'] = (m['thumbnail'] as String).replaceAll('&amp;', '&');
        }
        rows.add(m);
        if (rows.length >= maxKeep) break;
      }
      if (rows.isNotEmpty) return rows;
    } catch (_) {}
  }
  return [];
}

/// Reddit RSS via public CORS proxy (web fallback when Express is not running).
Future<List<Map<String, dynamic>>> fetchTeaRowsFromRedditRssCors({
  int maxKeep = 12,
}) async {
  if (!kIsWeb) return [];
  const rssUrl = 'https://www.reddit.com/r/BollyBlindsNGossip/hot/.rss?limit=25';
  final proxy = 'https://api.allorigins.win/raw?url=${Uri.encodeComponent(rssUrl)}';
  try {
    final res = await http
        .get(Uri.parse(proxy), headers: {'Accept': 'application/xml'})
        .timeout(const Duration(seconds: 16));
    if (res.statusCode != 200) return [];
    return parseRedditHotRssXml(res.body).take(maxKeep).toList();
  } catch (_) {
    return [];
  }
}

/// Direct Reddit RSS on native (no CORS).
Future<List<Map<String, dynamic>>> fetchTeaRowsFromRedditRssDirect({
  int maxKeep = 12,
}) async {
  if (kIsWeb) return [];
  const rssUrl = 'https://www.reddit.com/r/BollyBlindsNGossip/hot/.rss?limit=25';
  try {
    final res = await http
        .get(
          Uri.parse(rssUrl),
          headers: {'Accept': 'application/atom+xml', 'User-Agent': _newsApiUserAgent},
        )
        .timeout(const Duration(seconds: 12));
    if (res.statusCode != 200) return [];
    return parseRedditHotRssXml(res.body).take(maxKeep).toList();
  } catch (_) {
    return [];
  }
}

/// PullPush mirror — no CORS, no local Express required.
Future<List<Map<String, dynamic>>> fetchTeaRowsFromPullPush({
  int sizePerSub = 30,
  int maxKeep = 12,
}) async {
  final seen = <String>{};
  final rows = <Map<String, dynamic>>[];

  for (final sub in _teaSubs) {
    if (rows.length >= maxKeep) break;
    final uri = Uri.parse(_pullPushBase).replace(
      queryParameters: {
        'subreddit': sub,
        'size': '$sizePerSub',
        'sort': 'desc',
        'sort_type': 'created_utc',
      },
    );
    try {
      final res = await http
          .get(uri, headers: {'Accept': 'application/json', 'User-Agent': _newsApiUserAgent})
          .timeout(const Duration(seconds: 14));
      if (res.statusCode != 200) continue;
      final body = jsonDecode(res.body);
      final data = body is Map ? body['data'] : null;
      if (data is! List) continue;

      for (final raw in data) {
        if (rows.length >= maxKeep) break;
        if (raw is! Map) continue;
        final post = Map<String, dynamic>.from(raw);
        if (!teaPostAllowed(post)) continue;
        final row = rowFromRedditPost(post, sub);
        if (row == null) continue;
        final url = row['url'] as String;
        if (seen.contains(url)) continue;
        seen.add(url);
        rows.add(row);
      }
    } catch (_) {}
  }

  rows.sort((a, b) {
    final sa = a['score'] is num ? (a['score'] as num).toInt() : 0;
    final sb = b['score'] is num ? (b['score'] as num).toInt() : 0;
    return sb.compareTo(sa);
  });
  return rows.take(maxKeep).toList();
}

Future<List<Map<String, dynamic>>> fetchTeaRowsFromBackendProxy({
  int maxKeep = 12,
}) async {
  for (final base in redditProxyBaseUrls()) {
    try {
      final url = '$base/api/reddit/hot?${Uri(queryParameters: {
        'sub': 'BollyBlindsNGossip',
        'limit': '40',
      }).query}';
      final res = await http
          .get(Uri.parse(url), headers: {'Accept': 'application/json', 'User-Agent': _newsApiUserAgent})
          .timeout(const Duration(seconds: 10));
      if (res.statusCode != 200) continue;
      final root = jsonDecode(res.body);
      if (root is! Map) continue;
      final listing = root['data'];
      final children = listing is Map ? listing['children'] : null;
      if (children is! List) continue;

      final rows = <Map<String, dynamic>>[];
      final seen = <String>{};
      for (final child in children) {
        if (rows.length >= maxKeep) break;
        if (child is! Map) continue;
        final post = child['data'];
        if (post is! Map) continue;
        final m = Map<String, dynamic>.from(post);
        if (!teaPostAllowed(m)) continue;
        final row = rowFromRedditPost(m, 'BollyBlindsNGossip');
        if (row == null) continue;
        final link = row['url'] as String;
        if (seen.contains(link)) continue;
        seen.add(link);
        rows.add(row);
      }
      if (rows.isNotEmpty) return rows;
    } catch (_) {}
  }
  return [];
}

Future<List<Map<String, dynamic>>> fetchTeaRowsFromClassicReddit() async {
  return tryRedditHotRows(
    ['BollyBlindsNGossip'],
    maxPerSub: 40,
    maxKeep: 12,
    minScore: 1,
    timeoutMs: 10000,
    filterPost: teaPostAllowed,
  );
}

List<Map<String, dynamic>> teaRowsFromRssArticles(List<Map<String, dynamic>> rss) {
  return normalizeArticles(rss)
      .where((a) => '${a['url'] ?? ''}'.trim().isNotEmpty)
      .map((a) {
        final title = '${a['title'] ?? ''}'.trim();
        final desc = '${a['description'] ?? ''}'.trim();
        // Only keep real prose snippets — reject Google News link/HTML junk.
        final body = cleanFeedSnippetForDisplay(desc, title: title);
        return {
          'title': title,
          'url': a['url'],
          'image': a['image'],
          'thumbnail': a['image'],
          'score': 0,
          'num_comments': 0,
          'author': a['source'] ?? 'News',
          'source': a['source'] ?? 'News',
          'extractionStatus': body.isNotEmpty ? 'partial' : 'titleOnly',
          if (body.isNotEmpty) 'description': body,
          if (body.isNotEmpty) 'gossip': body,
          if (body.isNotEmpty) 'selftext': body,
          if (a['publishedAt'] != null) 'publishedAt': a['publishedAt'],
        };
      })
      .toList();
}

Future<List<Map<String, dynamic>>> _fetchTeaRssQuickRows() async {
  try {
    const query = '(bollywood gossip OR celebrity scandal OR "bollywood drama") india when:7d';
    final rss = await fetchLiveFromGoogleRssByQueryFast(query, timeoutMs: 5500);
    return teaRowsFromRssArticles(rss);
  } catch (_) {
    return [];
  }
}

List<Map<String, dynamic>> _mergeTeaRowLists(
  List<Map<String, dynamic>> primary,
  List<Map<String, dynamic>> secondary,
) {
  final merged = <Map<String, dynamic>>[];
  final seen = <String>{};
  for (final row in [...secondary, ...primary]) {
    final url = '${row['url'] ?? ''}'.trim();
    if (url.isEmpty || seen.contains(url)) continue;
    seen.add(url);
    merged.add(row);
  }
  return merged;
}

/// Reddit rows with backend-proxy → direct → PullPush fallback chain.
Future<List<Map<String, dynamic>>> _fetchTeaRedditRows() async {
  try {
    final rows = await fetchTeaRowsFromBackendProxy(maxKeep: 12)
        .timeout(const Duration(seconds: 8));
    if (rows.isNotEmpty) return rows;
  } catch (_) {}
  try {
    final rows = await fetchTeaRowsFromClassicReddit()
        .timeout(const Duration(seconds: 8));
    if (rows.isNotEmpty) return rows;
  } catch (_) {}
  try {
    return await fetchTeaRowsFromPullPush(maxKeep: 12)
        .timeout(const Duration(seconds: 8));
  } catch (_) {
    return [];
  }
}

/// Trending Tea rows: Reddit + YouTube + Google RSS, merged and enriched.
Future<List<Map<String, dynamic>>> fetchTrendingTeaRows({bool deferEnrich = true}) async {
  final rssFuture = _fetchTeaRssQuickRows();
  final ytFuture = fetchTeaRowsFromYouTube(maxKeep: 14).timeout(
    const Duration(seconds: 8),
    onTimeout: () => <Map<String, dynamic>>[],
  );
  final redditFuture = _fetchTeaRedditRows().timeout(
    const Duration(seconds: 12),
    onTimeout: () => <Map<String, dynamic>>[],
  );
  final parts = await Future.wait([rssFuture, ytFuture, redditFuture]);
  // Reddit (images) → YouTube (images) → RSS; secondary items appear first.
  var rows = _mergeTeaRowLists(
    _mergeTeaRowLists(parts[0], parts[1]),
    parts[2],
  );

  if (rows.length < 6) {
    final fromRss = await _fetchTeaRssFallbackRows();
    rows = _mergeTeaRowLists(rows, fromRss);
  }

  if (rows.isNotEmpty) {
    sortHubMapRowsImageFirst(
      rows,
      hasReliableImage: teaRowHasReliableImage,
      compare: (a, b) => hubMapRowScore(b).compareTo(hubMapRowScore(a)),
    );
    if (!deferEnrich) {
      rows = await enrichTeaRows(rows, maxEnrich: 10);
      sortHubMapRowsImageFirst(
        rows,
        hasReliableImage: teaRowHasReliableImage,
        compare: (a, b) => hubMapRowScore(b).compareTo(hubMapRowScore(a)),
      );
    }
  }
  return rows;
}

Future<List<Map<String, dynamic>>> _fetchTeaRssFallbackRows() async {
  const queries = [
    '(bollywood gossip OR celebrity scandal OR "bollywood drama") india when:7d',
    '(IPL OR "cricket gossip" OR "cricket controversy") india when:7d',
    '(ISL OR football OR soccer) (gossip OR controversy OR viral) india when:7d',
    '(viral OR trending OR meme OR famous) india when:3d',
  ];

  final merged = <Map<String, dynamic>>[];
  final seen = <String>{};
  for (final query in queries) {
    try {
      final rss = await fetchLiveFromGoogleRssByQueryFast(query, timeoutMs: 10000);
      for (final row in teaRowsFromRssArticles(rss)) {
        final url = '${row['url'] ?? ''}'.trim();
        if (url.isEmpty || seen.contains(url)) continue;
        seen.add(url);
        merged.add(row);
      }
    } catch (_) {}
  }
  return merged;
}
