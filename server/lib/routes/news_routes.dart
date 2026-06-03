import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';

import '../config.dart';
import '../utils/http_utils.dart';

/// NewsAPI proxy — port of functions/src/newsApi.ts
Router buildNewsRouter() {
  final router = Router();

  Future<Response> proxyNews(Request req, String endpoint) async {
    if (req.method == 'OPTIONS') {
      return Response(204, headers: apiCorsHeaders);
    }
    if (req.method != 'GET') {
      return jsonError(405, 'Method not allowed');
    }

    final apiKey = ServerConfig.newsApiKey;
    if (apiKey == null || apiKey.isEmpty) {
      return jsonOk({
        'status': 'error',
        'code': 'config',
        'message': 'News API not configured on server',
      }, status: 503);
    }

    final upstream = Uri.parse('https://newsapi.org/v2/$endpoint').replace(
      queryParameters: {
        for (final e in req.url.queryParameters.entries)
          if (e.key != 'apiKey' && e.key != 'endpoint') e.key: e.value,
        'apiKey': apiKey,
      },
    );

    try {
      final res = await http.get(
        upstream,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'DeiteNews/1.0 (+https://deitedatabase.web.app)',
        },
      );
      final data = jsonDecode(res.body);
      return Response(
        res.statusCode,
        body: jsonEncode(data),
        headers: {...apiCorsHeaders, 'Content-Type': 'application/json'},
      );
    } catch (e) {
      return jsonOk({'status': 'error', 'message': 'NewsAPI request failed'}, status: 502);
    }
  }

  router.get('/api/news/everything', (req) => proxyNews(req, 'everything'));
  router.get('/api/news/top-headlines', (req) => proxyNews(req, 'top-headlines'));
  // Hosting rewrite compatibility
  router.get('/everything', (req) => proxyNews(req, 'everything'));
  router.get('/top-headlines', (req) => proxyNews(req, 'top-headlines'));

  return router;
}

const apiCorsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/// Reddit dev proxy — port of detea-proxy/server.js
Router buildRedditProxyRouter() {
  final router = Router();
  const upstream =
      'https://www.reddit.com/r/WorldNewsHeadlines/hot.json?limit=45&raw_json=1';

  router.get('/api/news', (Request req) async {
    if (req.method == 'OPTIONS') return Response(204, headers: apiCorsHeaders);
    try {
      final res = await http.get(
        Uri.parse(upstream),
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'DeteaLocalDev/1.0.0',
        },
      );
      if (res.statusCode != 200) {
        return jsonOk({
          'error': 'Upstream Reddit request failed',
          'status': res.statusCode,
        }, status: res.statusCode);
      }
      return Response.ok(
        res.body,
        headers: {...apiCorsHeaders, 'Content-Type': 'application/json'},
      );
    } catch (e) {
      return jsonError(500, 'Proxy server error', details: '$e');
    }
  });

  return router;
}
