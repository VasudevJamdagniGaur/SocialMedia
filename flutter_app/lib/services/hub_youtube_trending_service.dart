import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../config/env.dart';
import 'package:deite/lib/hub_trending_algorithms.dart';
import 'package:deite/lib/pod_topic_news_shared.dart';
import 'package:deite/lib/reddit_post_filter.dart';
import 'reddit_tea_service.dart';
import 'youtube_tea_service.dart';

const _newsApiUserAgent = 'DeiteNews/1.0 (+https://deitedatabase.web.app)';

const _hubVerticalYouTubeQueries = <String, List<String>>{
  'sports': [
    'india cricket news today latest',
    'IPL cricket news hindi india',
    'team india cricket highlights news',
    'BCCI cricket news india latest',
    'indian football ISL news today',
    'sports news india hindi latest',
    'pro kabaddi india news',
    'badminton india sports news',
    'Formula 1 F1 race news india',
    'chess india grandmaster news',
    'sports viral moments india today',
  ],
  'ai-tech': [
    'artificial intelligence AI news latest',
    'ChatGPT OpenAI Google Gemini AI news',
    'tech startup news india latest',
    'coding developer programming tools news',
    'Nvidia Apple Microsoft big tech news',
    'vibe coding AI tools news',
  ],
  'entrepreneurship': [
    'startup news india funding latest',
    'entrepreneur founder story india',
    'venture capital startup unicorn news',
    'business startup success india hindi',
    'SMB founder playbook india',
  ],
  'current-affairs': [
    'india news today breaking latest',
    'world news today latest headlines',
    'india politics news latest',
    'india economy RBI news latest',
    'climate environment news india',
  ],
};

const _hubVerticalSignals = <String, List<String>>{
  'sports': [
    'cricket', 'ipl', 'football', 'soccer', 'f1', 'formula', 'chess', 'sport',
    'wicket', 'goal', 'match', 'tennis', 'badminton', 'bcci', 'isl', 'kabaddi',
    'hockey', 'india', 'indian', 'team india', 'hindi', 'sports',
  ],
  'ai-tech': [
    'ai', 'artificial intelligence', 'tech', 'startup', 'chatgpt', 'openai',
    'google', 'microsoft', 'nvidia', 'coding', 'software', 'developer', 'gemini',
    'llm', 'machine learning', 'robot',
  ],
  'entrepreneurship': [
    'startup', 'founder', 'entrepreneur', 'funding', 'venture', 'business',
    'unicorn', 'invest', 'revenue', 'ceo', 'bootstrap', 'pitch',
  ],
  'current-affairs': [
    'news', 'politic', 'econom', 'climate', 'india', 'world', 'government',
    'election', 'parliament', 'budget', 'minister', 'diplomat',
  ],
};

bool isRelevantHubVerticalYouTubeContent(
  String vertical, {
  required String title,
  String description = '',
  String channel = '',
}) {
  if (title.trim().isEmpty || titleHasExcludedKeyword(title)) return false;
  final blob = '$title $description $channel'.toLowerCase();
  final signals = _hubVerticalSignals[vertical];
  if (signals == null || signals.isEmpty) return true;
  return signals.any((s) => blob.contains(s));
}

NewsArticle hubNewsArticleFromYouTubeRow(Map<String, dynamic> row, {String? exploreTopic}) {
  final videoId = '${row['videoId'] ?? ''}'.trim();
  var image = row['image'] is String ? row['image'] as String : (row['thumbnail'] as String?);
  image = '${image ?? ''}'.trim();
  if (!image.startsWith('http')) {
    image = _youtubeThumbFromVideoId(videoId) ?? '';
  }
  return NewsArticle(
    title: '${row['title'] ?? ''}'.trim(),
    source: '${row['author'] ?? row['source'] ?? 'YouTube'}'.trim(),
    url: '${row['url'] ?? ''}'.trim(),
    image: image.isNotEmpty ? image : null,
    description: '${row['description'] ?? row['gossip'] ?? ''}'.trim(),
    trendingScore: row['score'] is num ? row['score'] as num : null,
    exploreTopic: exploreTopic,
  );
}

String _hubYouTubePublishedAfter({int days = 21}) {
  return DateTime.now()
      .toUtc()
      .subtract(Duration(days: days))
      .toIso8601String()
      .replaceFirst(RegExp(r'\.\d+'), '');
}

String? _youtubeThumbFromVideoId(String? videoId) {
  final id = '${videoId ?? ''}'.trim();
  if (id.length < 6) return null;
  return 'https://i.ytimg.com/vi/$id/hqdefault.jpg';
}

List<Map<String, dynamic>> _mergeHubYouTubeRows(
  Iterable<List<Map<String, dynamic>>> batches, {
  required int maxKeep,
}) {
  final seen = <String>{};
  final rows = <Map<String, dynamic>>[];
  for (final batch in batches) {
    for (final row in batch) {
      final url = '${row['url'] ?? ''}'.trim();
      if (url.isEmpty || seen.contains(url)) continue;
      seen.add(url);
      rows.add(row);
    }
  }
  rows.sort((a, b) {
    final sa = a['score'] is num ? (a['score'] as num).toInt() : 0;
    final sb = b['score'] is num ? (b['score'] as num).toInt() : 0;
    return sb.compareTo(sa);
  });
  return rows.take(maxKeep).toList();
}

Future<List<Map<String, dynamic>>> _fetchHubVerticalFromBackend(
  String vertical, {
  int maxKeep = 12,
}) async {
  for (final base in redditProxyBaseUrls()) {
    try {
      final url = Uri.parse('$base/api/youtube/hub').replace(
        queryParameters: {'vertical': vertical, 'limit': '$maxKeep'},
      );
      final res = await http
          .get(url, headers: {'Accept': 'application/json', 'User-Agent': _newsApiUserAgent})
          .timeout(const Duration(seconds: 18));
      if (res.statusCode != 200) continue;
      final body = jsonDecode(res.body);
      if (body is! Map || body['ok'] != true) continue;
      final raw = body['items'];
      if (raw is! List || raw.isEmpty) continue;
      final rows = <Map<String, dynamic>>[];
      final seen = <String>{};
      for (final item in raw) {
        if (item is! Map) continue;
        final m = Map<String, dynamic>.from(item);
        final urlStr = '${m['url'] ?? ''}'.trim();
        if (urlStr.isEmpty || seen.contains(urlStr)) continue;
        final title = '${m['title'] ?? ''}'.trim();
        if (!isRelevantHubVerticalYouTubeContent(
          vertical,
          title: title,
          description: '${m['description'] ?? m['gossip'] ?? ''}',
          channel: '${m['author'] ?? ''}',
        )) {
          continue;
        }
        seen.add(urlStr);
        rows.add(m);
      }
      if (rows.isNotEmpty) {
        debugPrint('[HubYouTube] backend returned ${rows.length} for $vertical from $base');
        return rows.take(maxKeep).toList();
      }
    } catch (e) {
      debugPrint('[HubYouTube] backend fetch failed ($base/$vertical): $e');
    }
  }
  return [];
}

Future<List<Map<String, dynamic>>> _fetchHubVerticalYouTubeDirect(
  String vertical, {
  int maxKeep = 12,
}) async {
  final queries = _hubVerticalYouTubeQueries[vertical];
  if (queries == null || queries.isEmpty) return [];

  final apiKey = Env.youtubeApiKey.trim();
  if (apiKey.isEmpty) {
    debugPrint('[HubYouTube] direct skipped for $vertical — YOUTUBE_API_KEY not set');
    return [];
  }

  final seen = <String>{};
  final rows = <Map<String, dynamic>>[];
  const perQuery = 6;
  final publishedAfter = _hubYouTubePublishedAfter(
    days: vertical == 'sports' ? 30 : 21,
  );

  for (var qi = 0; qi < queries.length; qi++) {
    final query = queries[qi];
    final order = vertical == 'sports'
        ? (qi.isEven ? 'relevance' : 'date')
        : 'date';
    final lang = vertical == 'sports' && qi.isOdd ? 'hi' : 'en';
    try {
      final searchUri = Uri.parse('https://www.googleapis.com/youtube/v3/search').replace(
        queryParameters: {
          'part': 'snippet',
          'type': 'video',
          'order': order,
          'q': query,
          'maxResults': '$perQuery',
          'regionCode': 'IN',
          'relevanceLanguage': lang,
          'publishedAfter': publishedAfter,
          'key': apiKey,
        },
      );
      final searchRes = await http
          .get(searchUri, headers: {'Accept': 'application/json'})
          .timeout(const Duration(seconds: 16));
      if (searchRes.statusCode != 200) {
        debugPrint(
          '[HubYouTube] search failed ${searchRes.statusCode} ($vertical/$query): '
          '${searchRes.body.substring(0, searchRes.body.length.clamp(0, 180))}',
        );
        continue;
      }
      final searchBody = jsonDecode(searchRes.body);
      if (searchBody is! Map) continue;
      final items = searchBody['items'];
      if (items is! List || items.isEmpty) continue;

      final videoIds = <String>[];
      final snippets = <String, Map<String, dynamic>>{};
      for (final item in items) {
        if (item is! Map) continue;
        final idObj = item['id'];
        final snippet = item['snippet'];
        if (idObj is! Map || snippet is! Map) continue;
        final vid = '${idObj['videoId'] ?? ''}'.trim();
        if (vid.isEmpty || seen.contains(vid)) continue;
        snippets[vid] = Map<String, dynamic>.from(snippet);
        videoIds.add(vid);
      }
      if (videoIds.isEmpty) continue;

      final statsUri = Uri.parse('https://www.googleapis.com/youtube/v3/videos').replace(
        queryParameters: {
          'part': 'statistics,snippet',
          'id': videoIds.join(','),
          'key': apiKey,
        },
      );
      final statsRes = await http
          .get(statsUri, headers: {'Accept': 'application/json'})
          .timeout(const Duration(seconds: 16));
      if (statsRes.statusCode != 200) continue;
      final statsBody = jsonDecode(statsRes.body);
      final statItems = statsBody is Map ? statsBody['items'] : null;
      if (statItems is! List) continue;

      for (final statItem in statItems) {
        if (statItem is! Map) continue;
        final vid = '${statItem['id'] ?? ''}'.trim();
        if (vid.isEmpty || seen.contains(vid)) continue;
        final snippet = statItem['snippet'] is Map
            ? Map<String, dynamic>.from(statItem['snippet'] as Map)
            : snippets[vid];
        if (snippet == null) continue;

        final title = '${snippet['title'] ?? ''}'.trim();
        final description = '${snippet['description'] ?? ''}'.trim();
        final channel = '${snippet['channelTitle'] ?? 'YouTube'}'.trim();
        if (!isRelevantHubVerticalYouTubeContent(
          vertical,
          title: title,
          description: description,
          channel: channel,
        )) {
          continue;
        }

        final stats = statItem['statistics'] is Map
            ? Map<String, dynamic>.from(statItem['statistics'] as Map)
            : <String, dynamic>{};
        final views = int.tryParse('${stats['viewCount'] ?? '0'}') ?? 0;
        final comments = int.tryParse('${stats['commentCount'] ?? '0'}') ?? 0;
        final image = _bestYouTubeThumbnail(
          snippet['thumbnails'] is Map
              ? Map<String, dynamic>.from(snippet['thumbnails'] as Map)
              : null,
        ) ?? _youtubeThumbFromVideoId(vid);
        final gossip = description.length > 320
            ? '${description.substring(0, 320).trimRight()}…'
            : (description.isNotEmpty ? description : title);

        seen.add(vid);
        rows.add({
          'title': title,
          'url': 'https://www.youtube.com/watch?v=$vid',
          'image': image,
          'thumbnail': image,
          'score': views,
          'num_comments': comments,
          'author': channel.isNotEmpty ? channel : 'YouTube',
          'source': 'YouTube',
          'description': gossip,
          'gossip': gossip,
          'selftext': description.isNotEmpty ? description : title,
          'videoId': vid,
        });
      }
    } catch (e) {
      debugPrint('[HubYouTube] direct search failed for "$query": $e');
    }
  }

  rows.sort((a, b) {
    final sa = a['score'] is num ? (a['score'] as num).toInt() : 0;
    final sb = b['score'] is num ? (b['score'] as num).toInt() : 0;
    return sb.compareTo(sa);
  });
  if (rows.isNotEmpty) {
    debugPrint('[HubYouTube] direct API returned ${rows.length} for $vertical');
  }
  return rows.take(maxKeep).toList();
}

String? _bestYouTubeThumbnail(Map<String, dynamic>? thumbnails) {
  if (thumbnails == null) return null;
  for (final key in ['maxres', 'high', 'medium', 'default']) {
    final entry = thumbnails[key];
    if (entry is Map) {
      final url = '${entry['url'] ?? ''}'.trim();
      if (url.startsWith('http')) return url;
    }
  }
  return null;
}

Future<List<Map<String, dynamic>>> fetchHubVerticalYouTubeRows(
  String vertical, {
  int maxKeep = 12,
}) async {
  final batches = await Future.wait([
    _fetchHubVerticalFromBackend(vertical, maxKeep: maxKeep),
    _fetchHubVerticalYouTubeDirect(vertical, maxKeep: maxKeep),
  ]);
  final merged = _mergeHubYouTubeRows(batches, maxKeep: maxKeep);
  if (merged.isNotEmpty) {
    debugPrint('[HubYouTube] merged ${merged.length} rows for $vertical');
  }
  return merged;
}

/// Sports Trending — India-first YouTube videos (Data API + RSS fallbacks).
Future<List<NewsArticle>> fetchSportsYouTubeTrending({int maxKeep = 12}) =>
    fetchSportsTrendingAll(maxKeep: maxKeep);

NewsArticle _sportsArticleFromRssMap(Map<String, dynamic> raw) {
  final url = '${raw['url'] ?? ''}'.trim();
  final title = '${raw['title'] ?? ''}'.trim();
  var image = '${raw['image'] ?? ''}'.trim();
  if (isYouTubeTeaUrl(url)) {
    image = youtubeTeaThumbnailFromUrl(url) ?? image;
  }
  return NewsArticle(
    title: title,
    source: isYouTubeTeaUrl(url) ? 'YouTube' : '${raw['source'] ?? 'Sports'}'.trim(),
    url: url,
    image: image.startsWith('http') ? image : null,
    description: '${raw['description'] ?? ''}'.trim(),
  );
}

Future<List<NewsArticle>> _fetchSportsYouTubeViaGoogleRss({int maxKeep = 10}) async {
  const queries = [
    'site:youtube.com IPL cricket india when:7d',
    'site:youtube.com team india cricket when:7d',
    'site:youtube.com ISL football india when:7d',
    'site:youtube.com sports news india when:7d',
  ];
  final seen = <String>{};
  final out = <NewsArticle>[];
  for (final query in queries) {
    try {
      final items = await fetchLiveFromGoogleRssByQueryFast(query, timeoutMs: 9000);
      for (final raw in normalizeArticles(items)) {
        final url = '${raw['url'] ?? ''}'.trim();
        if (!isYouTubeTeaUrl(url) || seen.contains(url)) continue;
        final title = '${raw['title'] ?? ''}'.trim();
        if (title.isEmpty || titleHasExcludedKeyword(title)) continue;
        seen.add(url);
        out.add(_sportsArticleFromRssMap(raw));
        if (out.length >= maxKeep) return out;
      }
    } catch (e) {
      debugPrint('[HubYouTube] sports YouTube RSS failed ($query): $e');
    }
  }
  if (out.isNotEmpty) {
    debugPrint('[HubYouTube] sports YouTube RSS returned ${out.length}');
  }
  return out;
}

Future<List<NewsArticle>> _fetchSportsIndiaNewsRss({int maxKeep = 10}) async {
  const queries = [
    'cricket india when:5d',
    'IPL india when:5d',
    'india sports news when:5d',
    'BCCI team india when:5d',
  ];
  final seen = <String>{};
  final out = <NewsArticle>[];
  for (final query in queries) {
    try {
      final items = await fetchLiveFromGoogleRssByQueryFast(query, timeoutMs: 9000);
      for (final raw in normalizeArticles(items)) {
        final url = '${raw['url'] ?? ''}'.trim();
        if (url.isEmpty || seen.contains(url)) continue;
        final title = '${raw['title'] ?? ''}'.trim();
        if (title.isEmpty || titleHasExcludedKeyword(title)) continue;
        seen.add(url);
        out.add(_sportsArticleFromRssMap(raw));
        if (out.length >= maxKeep) return out;
      }
    } catch (e) {
      debugPrint('[HubYouTube] sports news RSS failed ($query): $e');
    }
  }
  return out;
}

/// India sports trending: YouTube API (if configured) + Google News RSS (always).
Future<List<NewsArticle>> fetchSportsTrendingAll({int maxKeep = 10}) async {
  final apiFuture = fetchHubVerticalTrendingArticles('sports', maxKeep: maxKeep);
  final ytRssFuture = _fetchSportsYouTubeViaGoogleRss(maxKeep: maxKeep);
  final newsRssFuture = _fetchSportsIndiaNewsRss(maxKeep: maxKeep);

  final parts = await Future.wait([apiFuture, ytRssFuture, newsRssFuture]);
  final fromApi = parts[0];
  final fromYtRss = parts[1];
  final fromNewsRss = parts[2];

  final merged = mergeHubTrendingWithFallback(
    youtube: [...fromApi, ...fromYtRss],
    others: fromNewsRss,
    maxItems: maxKeep,
  );
  debugPrint(
    '[HubYouTube] sports total=${merged.length} '
    '(api=${fromApi.length} ytRss=${fromYtRss.length} newsRss=${fromNewsRss.length})',
  );
  return merged.where((a) => a.title.trim().isNotEmpty).toList();
}

/// YouTube trending cards for a hub vertical (Sports, AI & Tech, etc.).
Future<List<NewsArticle>> fetchHubVerticalTrendingArticles(
  String vertical, {
  int maxKeep = 12,
}) async {
  final rows = await fetchHubVerticalYouTubeRows(vertical, maxKeep: maxKeep);
  return rows
      .map((r) => hubNewsArticleFromYouTubeRow(r))
      .where((a) => a.title.isNotEmpty && a.url.isNotEmpty)
      .toList();
}

List<NewsArticle> mergeHubTrendingWithFallback({
  required List<NewsArticle> youtube,
  required List<NewsArticle> others,
  int maxItems = 10,
}) {
  final seen = <String>{};
  final merged = <NewsArticle>[];
  for (final row in [...youtube, ...others]) {
    if (row.url.isEmpty || seen.contains(row.url)) continue;
    seen.add(row.url);
    merged.add(row);
    if (merged.length >= maxItems) break;
  }
  return prioritizeWithImagesFirst(
    merged,
    (item) => hasUsableHubImage(item.image),
  );
}
