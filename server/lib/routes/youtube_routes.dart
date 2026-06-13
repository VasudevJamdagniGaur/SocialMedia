import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';

import '../config.dart';
import '../utils/http_utils.dart';
import 'news_routes.dart';

const _teaYouTubeQueries = [
  'bollywood gossip celebrity tea',
  'bollywood controversy drama',
  'celebrity news india entertainment',
];

Router buildYouTubeRouter() {
  final router = Router();

  router.get('/api/youtube/tea', (Request req) async {
    if (req.method == 'OPTIONS') return Response(204, headers: apiCorsHeaders);

    final apiKey = ServerConfig.youtubeApiKey;
    if (apiKey == null || apiKey.isEmpty) {
      return jsonOk({
        'ok': false,
        'items': [],
        'error': 'youtube_not_configured',
      }, status: 503, headers: apiCorsHeaders);
    }

    final maxKeep = (int.tryParse(req.url.queryParameters['limit'] ?? '') ?? 12).clamp(4, 25);
    final seen = <String>{};
    final rows = <Map<String, dynamic>>[];

    for (final query in _teaYouTubeQueries) {
      if (rows.length >= maxKeep) break;
      try {
        final searchUri = Uri.parse('https://www.googleapis.com/youtube/v3/search').replace(
          queryParameters: {
            'part': 'snippet',
            'type': 'video',
            'order': 'viewCount',
            'q': query,
            'maxResults': '$maxKeep',
            'regionCode': 'IN',
            'relevanceLanguage': 'en',
            'key': apiKey,
          },
        );
        final searchRes = await http.get(
          searchUri,
          headers: {'Accept': 'application/json'},
        );
        if (searchRes.statusCode != 200) continue;
        final searchBody = jsonDecode(searchRes.body);
        if (searchBody is! Map) continue;
        final items = searchBody['items'];
        if (items is! List) continue;

        final videoIds = <String>[];
        for (final item in items) {
          if (item is! Map) continue;
          final idObj = item['id'];
          if (idObj is! Map) continue;
          final vid = '${idObj['videoId'] ?? ''}'.trim();
          if (vid.isEmpty || seen.contains(vid)) continue;
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
        final statsRes = await http.get(
          statsUri,
          headers: {'Accept': 'application/json'},
        );
        if (statsRes.statusCode != 200) continue;
        final statsBody = jsonDecode(statsRes.body);
        final statItems = statsBody is Map ? statsBody['items'] : null;
        if (statItems is! List) continue;

        for (final statItem in statItems) {
          if (rows.length >= maxKeep) break;
          if (statItem is! Map) continue;
          final vid = '${statItem['id'] ?? ''}'.trim();
          if (vid.isEmpty || seen.contains(vid)) continue;
          final snippet = statItem['snippet'];
          if (snippet is! Map) continue;
          final s = Map<String, dynamic>.from(snippet);
          final title = '${s['title'] ?? ''}'.trim();
          if (title.isEmpty) continue;

          final description = '${s['description'] ?? ''}'.trim();
          final gossip = description.length > 320
              ? '${description.substring(0, 320).trimRight()}…'
              : (description.isNotEmpty ? description : title);
          final channel = '${s['channelTitle'] ?? 'YouTube'}'.trim();
          final thumbs = s['thumbnails'] is Map ? s['thumbnails'] as Map : null;
          String? image;
          if (thumbs != null) {
            for (final key in ['maxres', 'high', 'medium', 'default']) {
              final entry = thumbs[key];
              if (entry is Map && '${entry['url'] ?? ''}'.startsWith('http')) {
                image = '${entry['url']}';
                break;
              }
            }
          }
          final stats = statItem['statistics'] is Map
              ? Map<String, dynamic>.from(statItem['statistics'] as Map)
              : <String, dynamic>{};
          final views = int.tryParse('${stats['viewCount'] ?? '0'}') ?? 0;
          final comments = int.tryParse('${stats['commentCount'] ?? '0'}') ?? 0;

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
      } catch (_) {}
    }

    rows.sort((a, b) {
      final sa = a['score'] is num ? (a['score'] as num).toInt() : 0;
      final sb = b['score'] is num ? (b['score'] as num).toInt() : 0;
      return sb.compareTo(sa);
    });

    return jsonOk({
      'ok': true,
      'items': rows.take(maxKeep).toList(),
    }, headers: apiCorsHeaders);
  });

  return router;
}
