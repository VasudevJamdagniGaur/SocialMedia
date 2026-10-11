import 'dart:collection';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';

import '../config.dart';
import '../utils/http_utils.dart';
import 'news_routes.dart' show apiCorsHeaders;

const _cacheTtl = Duration(minutes: 20);
const _cacheMax = 40;

class _EventCache {
  _EventCache(this.body, this.expiresAt);
  final Map<String, dynamic> body;
  final DateTime expiresAt;
}

final LinkedHashMap<String, _EventCache> _eventCache = LinkedHashMap();

/// Query-driven event discovery (no hardcoded articles).
/// GET /api/tea/events?eventId=cjp-protest-2026-10-10
Router buildTeaEventsRouter() {
  final router = Router();
  router.get('/api/tea/events', _handleTeaEvents);
  return router;
}

Map<String, dynamic> _eventConfig(String eventId) {
  // Keep in sync with flutter tea_event_topics.dart — query registry only.
  if (eventId == 'cjp-protest-2026-10-10') {
    return {
      'eventId': eventId,
      'label': 'CJP protest — 10 Oct 2026',
      'newsApiQuery':
          '("Cockroach Janta Party" OR CJP) AND (protest OR "Jantar Mantar" OR CEC OR "Gyanesh Kumar" OR SIR)',
      'googleQueries': [
        '("Cockroach Janta Party" OR CJP) (protest OR rally OR "Jantar Mantar") when:14d',
        '("Jantar Mantar") (protest OR CJP OR "Cockroach Janta") when:14d',
        '("Gyanesh Kumar" OR CEC) (resign OR resignation OR CJP OR protest) when:14d',
        '("Special Intensive Revision" OR SIR) (voter OR electoral OR roll) (protest OR CJP) when:14d',
        '(CJP OR "Cockroach Janta") (Mumbai OR Bengaluru OR Bangalore OR Ahmedabad OR Delhi) protest when:14d',
      ],
    };
  }
  return {
    'eventId': eventId,
    'label': eventId,
    'newsApiQuery': eventId.replaceAll('-', ' '),
    'googleQueries': <String>[],
  };
}

Future<Response> _handleTeaEvents(Request req) async {
  if (req.method == 'OPTIONS') {
    return Response(204, headers: {
      ...apiCorsHeaders,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    });
  }
  if (req.method != 'GET') return jsonError(405, 'Method not allowed');

  final eventId = (queryParam(req, 'eventId') ?? 'cjp-protest-2026-10-10').trim();
  final cached = _eventCache[eventId];
  if (cached != null && DateTime.now().isBefore(cached.expiresAt)) {
    return jsonOk({...cached.body, 'cached': true}, headers: apiCorsHeaders);
  }

  final cfg = _eventConfig(eventId);
  final related = <Map<String, String>>[];
  final seenUrls = <String>{};
  final apiKey = ServerConfig.newsApiKey;
  final q = '${cfg['newsApiQuery'] ?? ''}'.trim();

  void addRelated(Map<String, String> item) {
    final link = (item['url'] ?? '').trim();
    final title = (item['title'] ?? '').trim();
    if (title.isEmpty || link.isEmpty || seenUrls.contains(link)) return;
    seenUrls.add(link);
    related.add(item);
  }

  if (apiKey != null && apiKey.isNotEmpty && q.isNotEmpty) {
    try {
      final upstream = Uri.parse('https://newsapi.org/v2/everything').replace(
        queryParameters: {
          'q': q.length > 180 ? q.substring(0, 180) : q,
          'pageSize': '10',
          'language': 'en',
          'sortBy': 'publishedAt',
          'apiKey': apiKey,
        },
      );
      final res = await http.get(
        upstream,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'DeiteNews/1.0 (+https://deitedatabase.web.app)',
        },
      ).timeout(const Duration(seconds: 12));
      if (res.statusCode >= 200 && res.statusCode < 300) {
        final data = jsonDecode(res.body);
        if (data is Map && data['articles'] is List) {
          for (final a in (data['articles'] as List).take(10)) {
            if (a is! Map) continue;
            final source = a['source'];
            addRelated({
              'title': '${a['title'] ?? ''}'.trim(),
              'url': '${a['url'] ?? ''}'.trim(),
              'publisher': source is Map ? '${source['name'] ?? 'News'}' : 'News',
              'snippet': '${a['description'] ?? ''}'.trim(),
              'publishedAt': '${a['publishedAt'] ?? ''}',
              'sourceType': 'newsapi',
            });
          }
        }
      }
    } catch (_) {}
  }

  // Google News RSS — always attempted (no API key); mirrors Flutter event queries.
  final googleQueries = cfg['googleQueries'];
  if (googleQueries is List) {
    for (final rawQ in googleQueries.take(3)) {
      final gq = '$rawQ'.trim();
      if (gq.isEmpty) continue;
      try {
        final rssUri = Uri.parse('https://news.google.com/rss/search').replace(
          queryParameters: {
            'q': gq,
            'hl': 'en-IN',
            'gl': 'IN',
            'ceid': 'IN:en',
          },
        );
        final res = await http.get(
          rssUri,
          headers: {
            'Accept': 'application/rss+xml, application/xml, text/xml, */*',
            'User-Agent': 'DeiteNews/1.0 (+https://deitedatabase.web.app)',
          },
        ).timeout(const Duration(seconds: 10));
        if (res.statusCode < 200 || res.statusCode >= 300) continue;
        final chunks = res.body.split(RegExp(r'<item[\s>]', caseSensitive: false)).skip(1);
        for (final chunk in chunks.take(8)) {
          final titleMatch = RegExp(
            r'<title><!\[CDATA\[(.*?)\]\]></title>|<title>(.*?)</title>',
            caseSensitive: false,
            dotAll: true,
          ).firstMatch(chunk);
          final linkMatch =
              RegExp(r'<link>(.*?)</link>', caseSensitive: false, dotAll: true)
                  .firstMatch(chunk);
          final pubMatch =
              RegExp(r'<pubDate>(.*?)</pubDate>', caseSensitive: false, dotAll: true)
                  .firstMatch(chunk);
          final title = ((titleMatch?.group(1) ?? titleMatch?.group(2) ?? '')
                  .replaceAll(RegExp(r'<[^>]+>'), '')
                  .trim());
          final link = (linkMatch?.group(1) ?? '').trim();
          if (title.isEmpty || link.isEmpty) continue;
          final sourceName = title.contains(' - ')
              ? title.split(' - ').last.trim()
              : 'Google News';
          addRelated({
            'title': title,
            'url': link,
            'publisher': sourceName,
            'snippet': '',
            'publishedAt': (pubMatch?.group(1) ?? '').trim(),
            'sourceType': 'google_rss',
          });
        }
      } catch (_) {}
    }
  }

  final body = <String, dynamic>{
    'eventId': eventId,
    'label': cfg['label'],
    'relatedSources': related,
    'sourceCount': related.length,
    'contextLevel': related.length >= 2
        ? 'multiSource'
        : (related.isNotEmpty ? 'snippetBased' : 'headlineOnly'),
    'generatedAt': DateTime.now().toUtc().toIso8601String(),
    'limitations': related.isEmpty
        ? 'No accessible NewsAPI/RSS hits. Client still merges Google News RSS + Reddit + optional YouTube.'
        : 'Server merges NewsAPI (if keyed) + Google News RSS. Flutter also adds Reddit/YouTube. No X/Instagram API.',
    'cached': false,
  };

  _eventCache.remove(eventId);
  while (_eventCache.length >= _cacheMax) {
    _eventCache.remove(_eventCache.keys.first);
  }
  _eventCache[eventId] = _EventCache(body, DateTime.now().add(_cacheTtl));

  return jsonOk(body, headers: apiCorsHeaders);
}
