import 'dart:io';

import 'package:shelf/shelf.dart';
import 'package:shelf/shelf_io.dart' as shelf_io;
import 'package:shelf_cors_headers/shelf_cors_headers.dart';
import 'package:shelf_router/shelf_router.dart';

import 'config.dart';
import 'routes/api_routes.dart';
import 'routes/article_routes.dart';
import 'routes/news_routes.dart';
import 'routes/vertex_routes.dart';
import 'routes/youtube_routes.dart';
import 'vertex/vertex_client.dart';

/// Unified Deite Dart backend — replaces backend-vertex, socitea-proxy, and HTTP functions.
Future<void> runServer() async {
  final vertex = VertexClient();
  final app = Router()
    ..mount('/', buildVertexRouter(vertex).call)
    ..mount('/', buildNewsRouter().call)
    ..mount('/', buildRedditProxyRouter().call)
    ..mount('/', buildYouTubeRouter().call)
    ..mount('/', buildSuggestionsRouter(vertex).call)
    ..mount('/', buildArticleRouter().call)
    ..mount('/', buildAccountRouter().call);

  final handler = Pipeline()
      .addMiddleware(logRequests())
      .addMiddleware(corsHeaders())
      .addHandler(app.call);

  final port = ServerConfig.port;
  final server = await shelf_io.serve(handler, InternetAddress.anyIPv4, port);
  stdout.writeln('Deite Dart server listening on http://${server.address.host}:$port');
  stdout.writeln('  Project: ${ServerConfig.projectId}  Region: ${ServerConfig.vertexLocation}');
  stdout.writeln('  Model: ${ServerConfig.vertexModel}');
}
