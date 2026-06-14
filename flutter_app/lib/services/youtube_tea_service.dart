import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../config/env.dart';
import '../lib/reddit_post_filter.dart';
import 'reddit_tea_service.dart';

const _newsApiUserAgent = 'DeiteNews/1.0 (+https://deitedatabase.web.app)';

/// Spicy Tea feed: Bollywood gossip, cricket/football drama, viral internet moments (India-first).
const _teaYouTubeQueries = [
  'bollywood gossip scandal drama india latest',
  'bollywood celebrity breakup affair controversy hindi',
  'bollywood insider tea spilled india entertainment',
  'IPL cricket gossip controversy drama india',
  'cricket team india gossip news controversy',
  'ISL indian super league football gossip news',
  'football soccer gossip viral india hindi',
  'tollywood kollywood sandalwood gossip scandal india',
  'bigg boss india drama gossip hindi',
  'india viral trend today social media famous',
  'trending india viral video meme internet',
  'indian celebrity spotted dating leaked news',
];

const _teaSpicySignals = [
  'gossip',
  'scandal',
  'controversy',
  'drama',
  'viral',
  'trending',
  'meme',
  'feud',
  'breakup',
  'affair',
  'leaked',
  'spotted',
  'dating',
  'exclusive',
  'exposed',
  'fight',
  'slams',
  'roast',
  'inside',
  'truth',
  'spicy',
  'tea',
  'rumour',
  'rumor',
];

const _internationalTeaSignals = [
  'hollywood',
  'kardashian',
  'taylor swift',
  'nba ',
  ' nfl',
  'uk royal',
  'white house',
  'fox news',
  'cnn breaking',
  'k-pop',
  'kpop',
  'marvel studios',
  'disney world',
  'eurovision',
  'grammy awards',
];

const _indianTeaSignals = [
  'bollywood',
  'india',
  'indian',
  'hindi',
  'cricket',
  'ipl',
  'bcci',
  'football',
  'soccer',
  'isl',
  'tollywood',
  'kollywood',
  'sandalwood',
  'mumbai',
  'delhi',
  'bigg boss',
  'filmfare',
  'box office',
  'crore',
  'lakh',
  'virat',
  'dhoni',
  'rohit sharma',
  'ind vs',
  'india vs',
  'star sports',
  'hotstar',
  'messi',
  'ronaldo',
  'neymar',
  'team india',
  'wicket',
  'premier league',
  'champions league',
];

bool isRelevantIndianTeaYouTubeContent({
  required String title,
  String description = '',
  String channel = '',
}) {
  final blob = '$title $description $channel'.toLowerCase();
  if (blob.trim().isEmpty) return false;

  final hasTeaLean = _indianTeaSignals.any((s) => blob.contains(s)) ||
      bollywoodTeaTopicKeywords.any((kw) => blob.contains(kw.toLowerCase())) ||
      _teaSpicySignals.any((s) => blob.contains(s));
  if (!hasTeaLean) return false;

  final looksInternational = _internationalTeaSignals.any((s) => blob.contains(s));
  if (looksInternational && !hasTeaLean) return false;
  return true;
}

String _teaYouTubePublishedAfter() {
  return DateTime.now()
      .toUtc()
      .subtract(const Duration(days: 14))
      .toIso8601String()
      .replaceFirst(RegExp(r'\.\d+'), '');
}

bool isYouTubeTeaUrl(String? url) {
  final u = '${url ?? ''}'.trim().toLowerCase();
  return u.contains('youtube.com/watch') ||
      u.contains('youtube.com/shorts/') ||
      u.contains('youtu.be/');
}

String? youtubeTeaVideoId(String? url) {
  final u = '${url ?? ''}'.trim();
  if (u.isEmpty) return null;
  for (final pattern in [
    RegExp(r'[?&]v=([\w-]{11})', caseSensitive: false),
    RegExp(r'youtu\.be/([\w-]{11})', caseSensitive: false),
    RegExp(r'youtube\.com/shorts/([\w-]{11})', caseSensitive: false),
  ]) {
    final match = pattern.firstMatch(u);
    if (match != null) return match.group(1);
  }
  return null;
}

/// Standard YouTube poster when API thumbnail is missing from navigation payload.
String? youtubeTeaThumbnailFromUrl(String? url) {
  final id = youtubeTeaVideoId(url);
  if (id == null || id.isEmpty) return null;
  return 'https://i.ytimg.com/vi/$id/hqdefault.jpg';
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

Map<String, dynamic>? rowFromYouTubeSnippet(
  Map<String, dynamic> snippet, {
  String? videoId,
  int viewCount = 0,
  int commentCount = 0,
}) {
  final id = videoId ??
      (snippet['resourceId'] is Map
          ? '${(snippet['resourceId'] as Map)['videoId'] ?? ''}'.trim()
          : '');
  final resolvedId = id.isNotEmpty
      ? id
      : (snippet['id'] is Map ? '${(snippet['id'] as Map)['videoId'] ?? ''}'.trim() : '');
  if (resolvedId.isEmpty) return null;

  final title = '${snippet['title'] ?? ''}'.trim();
  if (title.isEmpty || titleHasExcludedKeyword(title)) return null;

  final description = '${snippet['description'] ?? ''}'.trim();
  final channel = '${snippet['channelTitle'] ?? 'YouTube'}'.trim();
  if (!isRelevantIndianTeaYouTubeContent(
    title: title,
    description: description,
    channel: channel,
  )) {
    return null;
  }
  final gossip = description.length > 320
      ? '${description.substring(0, 320).trimRight()}…'
      : description;
  final channelTitle = channel;
  final image = _bestYouTubeThumbnail(
    snippet['thumbnails'] is Map ? Map<String, dynamic>.from(snippet['thumbnails'] as Map) : null,
  );

  return {
    'title': title,
    'url': 'https://www.youtube.com/watch?v=$resolvedId',
    'image': image,
    'thumbnail': image,
    'score': viewCount,
    'num_comments': commentCount,
    'author': channelTitle.isNotEmpty ? channelTitle : 'YouTube',
    'source': 'YouTube',
    'description': gossip.isNotEmpty ? gossip : title,
    'gossip': gossip.isNotEmpty ? gossip : title,
    'selftext': description.isNotEmpty ? description : title,
    'videoId': resolvedId,
  };
}

List<Map<String, dynamic>> _parseYouTubeTeaItems(dynamic raw) {
  if (raw is! List) return [];
  final rows = <Map<String, dynamic>>[];
  final seen = <String>{};
  for (final item in raw) {
    if (item is! Map) continue;
    final m = Map<String, dynamic>.from(item);
    final url = '${m['url'] ?? ''}'.trim();
    if (url.isEmpty || seen.contains(url)) continue;
    final title = '${m['title'] ?? ''}'.trim();
    final description = '${m['description'] ?? m['gossip'] ?? ''}'.trim();
    final channel = '${m['author'] ?? ''}'.trim();
    if (!isRelevantIndianTeaYouTubeContent(
      title: title,
      description: description,
      channel: channel,
    )) {
      continue;
    }
    seen.add(url);
    rows.add(m);
  }
  return rows;
}

Future<List<Map<String, dynamic>>> fetchTeaRowsFromBackendYouTube({
  int maxKeep = 18,
}) async {
  for (final base in redditProxyBaseUrls()) {
    try {
      final url = Uri.parse('$base/api/youtube/tea').replace(
        queryParameters: {'limit': '$maxKeep'},
      );
      final res = await http
          .get(url, headers: {'Accept': 'application/json', 'User-Agent': _newsApiUserAgent})
          .timeout(const Duration(seconds: 18));
      if (res.statusCode != 200) continue;
      final body = jsonDecode(res.body);
      if (body is! Map || body['ok'] != true) continue;
      final rows = _parseYouTubeTeaItems(body['items']);
      if (rows.isNotEmpty) {
        debugPrint('[YouTubeTea] backend returned ${rows.length} items from $base');
        return rows.take(maxKeep).toList();
      }
    } catch (e) {
      debugPrint('[YouTubeTea] backend fetch failed ($base): $e');
    }
  }
  return [];
}

Future<List<Map<String, dynamic>>> fetchTeaRowsFromYouTubeDirect({
  int maxKeep = 18,
}) async {
  final apiKey = Env.youtubeApiKey.trim();
  if (apiKey.isEmpty) return [];

  final seen = <String>{};
  final rows = <Map<String, dynamic>>[];
  const perQuery = 5;

  for (final query in _teaYouTubeQueries) {
    try {
      final searchUri = Uri.parse('https://www.googleapis.com/youtube/v3/search').replace(
        queryParameters: {
          'part': 'snippet',
          'type': 'video',
          'order': 'date',
          'q': query,
          'maxResults': '$perQuery',
          'regionCode': 'IN',
          'relevanceLanguage': 'hi',
          'publishedAfter': _teaYouTubePublishedAfter(),
          'key': apiKey,
        },
      );
      final searchRes = await http
          .get(searchUri, headers: {'Accept': 'application/json'})
          .timeout(const Duration(seconds: 16));
      if (searchRes.statusCode != 200) {
        debugPrint('[YouTubeTea] search failed ${searchRes.statusCode}: ${searchRes.body.substring(0, searchRes.body.length.clamp(0, 200))}');
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
        final stats = statItem['statistics'] is Map
            ? Map<String, dynamic>.from(statItem['statistics'] as Map)
            : <String, dynamic>{};
        final views = int.tryParse('${stats['viewCount'] ?? '0'}') ?? 0;
        final comments = int.tryParse('${stats['commentCount'] ?? '0'}') ?? 0;
        final row = rowFromYouTubeSnippet(
          snippet,
          videoId: vid,
          viewCount: views,
          commentCount: comments,
        );
        if (row == null) continue;
        seen.add(vid);
        rows.add(row);
      }
    } catch (e) {
      debugPrint('[YouTubeTea] direct search failed for "$query": $e');
    }
  }

  rows.sort((a, b) {
    final sa = a['score'] is num ? (a['score'] as num).toInt() : 0;
    final sb = b['score'] is num ? (b['score'] as num).toInt() : 0;
    return sb.compareTo(sa);
  });
  if (rows.isNotEmpty) {
    debugPrint('[YouTubeTea] direct API returned ${rows.length} items');
  }
  return rows.take(maxKeep).toList();
}

/// Trending Tea via YouTube Data API (backend proxy first, then direct key).
Future<List<Map<String, dynamic>>> fetchTeaRowsFromYouTube({
  int maxKeep = 18,
}) async {
  var rows = await fetchTeaRowsFromBackendYouTube(maxKeep: maxKeep);
  if (rows.length < 4) {
    final direct = await fetchTeaRowsFromYouTubeDirect(maxKeep: maxKeep);
    if (direct.length > rows.length) rows = direct;
  }
  return rows;
}
