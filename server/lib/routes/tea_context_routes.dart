import 'dart:collection';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';

import '../config.dart';
import '../utils/http_utils.dart';
import 'news_routes.dart' show apiCorsHeaders;

const _cacheTtl = Duration(minutes: 45);
const _cacheMax = 100;

class _CtxCacheEntry {
  _CtxCacheEntry(this.body, this.expiresAt);
  final Map<String, dynamic> body;
  final DateTime expiresAt;
}

final LinkedHashMap<String, _CtxCacheEntry> _ctxCache = LinkedHashMap();

/// GET /api/tea/context?headline=&url= — NewsAPI-backed related sources for headline-first Tea.
Router buildTeaContextRouter() {
  final router = Router();
  router.get('/api/tea/context', _handleTeaContext);
  return router;
}

Future<Response> _handleTeaContext(Request req) async {
  if (req.method == 'OPTIONS') {
    return Response(204, headers: {
      ...apiCorsHeaders,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    });
  }
  if (req.method != 'GET') return jsonError(405, 'Method not allowed');

  final headline = (queryParam(req, 'headline') ?? '').trim();
  final url = (queryParam(req, 'url') ?? '').trim();
  if (headline.length < 6) {
    return jsonError(400, 'headline is required');
  }

  final cacheKey = '${headline.toLowerCase()}|$url'.hashCode.toRadixString(36);
  final cached = _ctxCache[cacheKey];
  if (cached != null && DateTime.now().isBefore(cached.expiresAt)) {
    return jsonOk({...cached.body, 'cached': true}, headers: apiCorsHeaders);
  }

  final related = <Map<String, String>>[];
  final apiKey = ServerConfig.newsApiKey;
  if (apiKey != null && apiKey.isNotEmpty) {
    try {
      final upstream = Uri.parse('https://newsapi.org/v2/everything').replace(
        queryParameters: {
          'q': headline.length > 120 ? headline.substring(0, 120) : headline,
          'pageSize': '5',
          'language': 'en',
          'sortBy': 'relevancy',
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
          for (final a in (data['articles'] as List).take(5)) {
            if (a is! Map) continue;
            final title = '${a['title'] ?? ''}'.trim();
            final link = '${a['url'] ?? ''}'.trim();
            if (title.isEmpty || link.isEmpty) continue;
            final source = a['source'];
            final publisher = source is Map
                ? '${source['name'] ?? 'News'}'
                : 'News';
            related.add({
              'title': title,
              'url': link,
              'publisher': publisher,
              'snippet': '${a['description'] ?? ''}'.trim(),
            });
          }
        }
      }
    } catch (_) {
      // Graceful: empty relatedSources
    }
  }

  final level = related.length >= 2
      ? 'multiSource'
      : (related.isNotEmpty ? 'snippetBased' : 'headlineOnly');

  final body = <String, dynamic>{
    'headline': headline,
    'sourceUrl': url,
    'relatedSources': related,
    'contextLevel': level,
    'confidence': related.length >= 2 ? 0.65 : (related.isNotEmpty ? 0.4 : 0.2),
    'generatedAt': DateTime.now().toUtc().toIso8601String(),
    'cached': false,
  };

  _ctxCache.remove(cacheKey);
  while (_ctxCache.length >= _cacheMax) {
    _ctxCache.remove(_ctxCache.keys.first);
  }
  _ctxCache[cacheKey] = _CtxCacheEntry(body, DateTime.now().add(_cacheTtl));

  return jsonOk(body, headers: apiCorsHeaders);
}
