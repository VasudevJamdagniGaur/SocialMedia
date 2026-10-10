import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';

import '../utils/article_extract.dart';
import '../utils/http_utils.dart';
import 'news_routes.dart' show apiCorsHeaders;

/// GET /api/linkedin/article?url=... — article text/meta for share generation.
Router buildArticleRouter() {
  final router = Router();

  router.get('/api/linkedin/article', _handleArticle);
  router.get('/article', _handleArticle);

  return router;
}

Future<Response> _handleArticle(Request req) async {
  if (req.method == 'OPTIONS') {
    return Response(204, headers: {
      ...apiCorsHeaders,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    });
  }
  if (req.method != 'GET') return jsonError(405, 'Method not allowed');

  final rawUrl = queryParam(req, 'url') ?? '';
  try {
    final payload = await extractArticleFromUrl(rawUrl);
    // Always 200 with contentStatus so clients can distinguish unavailable vs network 502.
    return jsonOk(payload, headers: apiCorsHeaders);
  } on ArgumentError catch (e) {
    return jsonError(400, e.message?.toString() ?? 'Invalid url');
  } on ArticleFetchException catch (e) {
    return jsonOk(
      {
        'url': rawUrl,
        'sourceUrl': rawUrl,
        'title': '',
        'image': '',
        'imageUrl': '',
        'source': '',
        'publishedAt': '',
        'description': '',
        'bodyText': '',
        'text': '',
        'contentStatus': 'unavailable',
        'extractionError': e.message,
      },
      headers: apiCorsHeaders,
    );
  } catch (e) {
    return jsonOk(
      {
        'url': rawUrl,
        'sourceUrl': rawUrl,
        'title': '',
        'image': '',
        'imageUrl': '',
        'source': '',
        'publishedAt': '',
        'description': '',
        'bodyText': '',
        'text': '',
        'contentStatus': 'unavailable',
        'extractionError': 'server_error',
      },
      headers: apiCorsHeaders,
    );
  }
}
