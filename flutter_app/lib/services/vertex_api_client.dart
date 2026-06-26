import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../config/env.dart';
import 'render_backend_queue.dart';

/// HTTP client for the Vertex AI Express backend.
/// No Gemini API keys in the app — AI goes through the server.
/// All requests are serialized globally via [RenderBackendQueue].
class VertexApiClient {
  VertexApiClient._();

  static final VertexApiClient instance = VertexApiClient._();

  static const String defaultBaseUrl = 'https://detea-backend.onrender.com';

  String get baseUrl {
    final candidates = [
      Env.backendUrl.trim(),
      Env.vertexBackendUrl.trim(),
      Env.vertexGeminiUrl.trim(),
      defaultBaseUrl,
    ];
    for (final c in candidates) {
      if (c.isNotEmpty) return c.replaceAll(RegExp(r'/$'), '');
    }
    return defaultBaseUrl;
  }

  bool get isConfigured => baseUrl.isNotEmpty;

  String getVertexBackendBaseUrl() => baseUrl;

  bool isVertexBackendConfigured() => isConfigured;

  Future<Map<String, dynamic>> fetchJson(
    String path, {
    String method = 'POST',
    Map<String, dynamic>? body,
    Duration? timeout,
    RenderBackendPriority priority = RenderBackendPriority.background,
  }) async {
    return RenderBackendQueue.instance.run(
      priority: priority,
      debugLabel: path,
      work: () => _fetchJsonUnqueued(
        path,
        method: method,
        body: body,
        timeout: timeout,
      ),
    );
  }

  Future<Map<String, dynamic>> _fetchJsonUnqueued(
    String path, {
    String method = 'POST',
    Map<String, dynamic>? body,
    Duration? timeout,
  }) async {
    final p = path.startsWith('/') ? path : '/$path';
    final url = Uri.parse('${baseUrl}$p');
    final client = http.Client();
    try {
      late http.Response res;
      if (method.toUpperCase() == 'GET') {
        res = await client.get(url).timeout(timeout ?? const Duration(seconds: 60));
      } else {
        res = await client
            .post(
              url,
              headers: {'Content-Type': 'application/json'},
              body: body != null ? jsonEncode(body) : null,
            )
            .timeout(timeout ?? const Duration(seconds: 60));
      }

      Map<String, dynamic> data = {};
      if (res.body.isNotEmpty) {
        try {
          data = jsonDecode(res.body) as Map<String, dynamic>;
        } catch (_) {
          throw Exception(
            'Backend returned non-JSON (${res.statusCode}) from $url: ${res.body.substring(0, res.body.length.clamp(0, 240))}',
          );
        }
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        final msg = data['error'] ?? data['message'] ?? res.body;
        final details = data['details'];
        final detailText = details == null ? '' : ' $details';
        throw Exception(
          'HTTP ${res.statusCode} from $url: ${msg is String ? msg : jsonEncode(msg)}$detailText',
        );
      }
      return data;
    } on TimeoutException catch (e) {
      throw Exception('Network timeout calling backend ($url): $e');
    } catch (e) {
      if (e is Exception) rethrow;
      throw Exception('Network error calling backend ($url): $e');
    } finally {
      client.close();
    }
  }

  Future<String> vertexChat(
    String message, {
    Duration? timeout,
    double? temperature,
    int? maxOutputTokens,
    RenderBackendPriority priority = RenderBackendPriority.background,
  }) async {
    final body = <String, dynamic>{'message': message};
    if (temperature != null) body['temperature'] = temperature;
    if (maxOutputTokens != null) body['maxOutputTokens'] = maxOutputTokens;

    final data = await fetchJson('/chat', body: body, timeout: timeout, priority: priority);
    final reply = data['reply'];
    if (reply is! String) {
      throw Exception('Vertex /chat: response missing reply');
    }
    return reply;
  }

  Future<String> vertexGenerateContent({
    required String prompt,
    double temperature = 0.65,
    int maxOutputTokens = 1024,
    Duration? timeout,
    RenderBackendPriority priority = RenderBackendPriority.background,
  }) async {
    if (prompt.trim().isEmpty) {
      throw Exception('vertexGenerateContent: prompt is required');
    }
    final data = await fetchJson(
      '/generateContent',
      body: {
        'prompt': prompt.trim(),
        'temperature': temperature,
        'maxOutputTokens': maxOutputTokens,
      },
      timeout: timeout,
      priority: priority,
    );

    return _parseGenerateContentResponse(data);
  }

  /// Bypasses [RenderBackendQueue] — use only for user-interactive flows
  /// (chat, reflections) where queuing behind image-gen jobs is unacceptable.
  Future<String> vertexGenerateContentDirect({
    required String prompt,
    double temperature = 0.65,
    int maxOutputTokens = 1024,
    Duration? timeout,
  }) async {
    if (prompt.trim().isEmpty) {
      throw Exception('vertexGenerateContentDirect: prompt is required');
    }
    final data = await _fetchJsonUnqueued(
      '/generateContent',
      body: {
        'prompt': prompt.trim(),
        'temperature': temperature,
        'maxOutputTokens': maxOutputTokens,
      },
      timeout: timeout,
    );
    return _parseGenerateContentResponse(data);
  }

  String _parseGenerateContentResponse(Map<String, dynamic> data) {
    final candidates = data['candidates'];
    if (candidates is List &&
        candidates.isNotEmpty &&
        candidates[0] is Map &&
        candidates[0]['content'] is Map &&
        candidates[0]['content']['parts'] is List) {
      final parts = candidates[0]['content']['parts'] as List;
      return parts.map((p) => (p is Map ? p['text'] : null) ?? '').join('');
    }
    throw Exception('Unexpected response from Vertex /generateContent');
  }

  /// Bypasses [RenderBackendQueue] — use for share/reflection images so carousel jobs do not block.
  Future<String> vertexGenerateNewsImageDirect(
    String prompt, {
    Duration? timeout,
    Map<String, String>? referenceImage,
  }) async {
    final p = prompt.trim();
    if (p.isEmpty) throw Exception('vertexGenerateNewsImageDirect: prompt is required');
    return _vertexGenerateNewsImageUnqueued(
      p,
      timeout: timeout,
      referenceImage: referenceImage,
    );
  }

  Future<String> vertexGenerateNewsImage(
    String prompt, {
    Duration? timeout,
    Map<String, String>? referenceImage,
    RenderBackendPriority priority = RenderBackendPriority.background,
  }) async {
    final p = prompt.trim();
    if (p.isEmpty) throw Exception('vertexGenerateNewsImage: prompt is required');

    return RenderBackendQueue.instance.run(
      priority: priority,
      debugLabel: '/generate-news-image',
      work: () => _vertexGenerateNewsImageUnqueued(
        p,
        timeout: timeout,
        referenceImage: referenceImage,
      ),
    );
  }

  Future<String> _vertexGenerateNewsImageUnqueued(
    String p, {
    Duration? timeout,
    Map<String, String>? referenceImage,
  }) async {
    final base = baseUrl.replaceAll(RegExp(r'/$'), '');
    final fallback = Env.generateNewsImageFallbackUrl.trim().replaceAll(RegExp(r'/$'), '');

    final urls = <String>[
      if (base.isNotEmpty) '$base/generate-news-image',
      if (fallback.isNotEmpty) '$fallback/generate-news-image',
    ];

    final requestBody = <String, dynamic>{'prompt': p};
    if (referenceImage != null &&
        (referenceImage['base64'] ?? '').trim().isNotEmpty) {
      requestBody['referenceImage'] = {
        'base64': referenceImage['base64'],
        'mimeType': referenceImage['mimeType'] ?? 'image/jpeg',
      };
    }

    Exception? lastErr;
    for (final url in urls.toSet()) {
      try {
        debugPrint(
          '[ImageGen] API request sent url=$url promptLen=${p.length} '
          'hasReference=${requestBody.containsKey('referenceImage')}',
        );
        final client = http.Client();
        final res = await client
            .post(
              Uri.parse(url),
              headers: {'Content-Type': 'application/json'},
              body: jsonEncode(requestBody),
            )
            .timeout(timeout ?? const Duration(seconds: 120));
        client.close();

        debugPrint(
          '[ImageGen] API response received url=$url status=${res.statusCode} bodyLen=${res.body.length}',
        );

        if (res.statusCode < 200 || res.statusCode >= 300) {
          lastErr = Exception(
            'HTTP ${res.statusCode} from $url: ${res.body.substring(0, res.body.length.clamp(0, 200))}',
          );
          continue;
        }

        final data = jsonDecode(res.body) as Map<String, dynamic>;
        final ok = data['ok'];
        if (ok == false) {
          lastErr = Exception('Backend returned ok=false');
          continue;
        }
        final imageDataUrl = data['imageDataUrl'];
        if (imageDataUrl is String && imageDataUrl.startsWith('data:image')) {
          debugPrint('[ImageGen] imageDataUrl length=${imageDataUrl.length}');
          return imageDataUrl;
        }
        lastErr = Exception('Response missing imageDataUrl');
        debugPrint('[ImageGen] response keys=${data.keys.toList()}');
      } catch (e) {
        lastErr = e is Exception ? e : Exception(e.toString());
      }
    }
    throw lastErr ?? Exception('vertexGenerateNewsImage: all backends failed');
  }
}

// Top-level helpers matching JS exports.
final _vertex = VertexApiClient.instance;

String getVertexBackendBaseUrl() => _vertex.getVertexBackendBaseUrl();

bool isVertexBackendConfigured() => _vertex.isVertexBackendConfigured();

Future<String> vertexChat(
  String message, {
  Duration? timeout,
  double? temperature,
  int? maxOutputTokens,
  RenderBackendPriority priority = RenderBackendPriority.background,
}) =>
    _vertex.vertexChat(
      message,
      timeout: timeout,
      temperature: temperature,
      maxOutputTokens: maxOutputTokens,
      priority: priority,
    );

Future<String> vertexGenerateContent({
  required String prompt,
  double temperature = 0.65,
  int maxOutputTokens = 1024,
  Duration? timeout,
  RenderBackendPriority priority = RenderBackendPriority.background,
}) =>
    _vertex.vertexGenerateContent(
      prompt: prompt,
      temperature: temperature,
      maxOutputTokens: maxOutputTokens,
      timeout: timeout,
      priority: priority,
    );

Future<String> vertexGenerateContentDirect({
  required String prompt,
  double temperature = 0.65,
  int maxOutputTokens = 1024,
  Duration? timeout,
}) =>
    _vertex.vertexGenerateContentDirect(
      prompt: prompt,
      temperature: temperature,
      maxOutputTokens: maxOutputTokens,
      timeout: timeout,
    );

Future<String> vertexGenerateNewsImageDirect(
  String prompt, {
  Duration? timeout,
  Map<String, String>? referenceImage,
}) =>
    _vertex.vertexGenerateNewsImageDirect(
      prompt,
      timeout: timeout,
      referenceImage: referenceImage,
    );

Future<String> vertexGenerateNewsImage(
  String prompt, {
  Duration? timeout,
  Map<String, String>? referenceImage,
  RenderBackendPriority priority = RenderBackendPriority.background,
}) =>
    _vertex.vertexGenerateNewsImage(
      prompt,
      timeout: timeout,
      referenceImage: referenceImage,
      priority: priority,
    );

Future<String> vertexAnalyzePattern(
  Map<String, dynamic> data, {
  Duration? timeout,
  RenderBackendPriority priority = RenderBackendPriority.background,
}) async {
  final res = await _vertex.fetchJson(
    '/analyze-pattern',
    body: {'data': data},
    timeout: timeout,
    priority: priority,
  );
  final result = res['result'];
  if (result is! String) {
    throw Exception('Vertex /analyze-pattern: response missing result');
  }
  return result;
}
