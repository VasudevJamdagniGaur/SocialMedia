import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/env.dart';

/// HTTP client for the Vertex AI Express backend.
/// No Gemini API keys in the app â€” AI goes through the server.
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
        throw Exception(msg is String ? msg : jsonEncode(msg));
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
  }) async {
    final body = <String, dynamic>{'message': message};
    if (temperature != null) body['temperature'] = temperature;
    if (maxOutputTokens != null) body['maxOutputTokens'] = maxOutputTokens;

    final data = await fetchJson('/chat', body: body, timeout: timeout);
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
    );

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

  Future<String> vertexGenerateNewsImage(String prompt, {Duration? timeout}) async {
    final p = prompt.trim();
    if (p.isEmpty) throw Exception('vertexGenerateNewsImage: prompt is required');

    final base = baseUrl.replaceAll(RegExp(r'/$'), '');
    final fallback = Env.generateNewsImageFallbackUrl.trim().replaceAll(RegExp(r'/$'), '');

    final urls = <String>[
      if (base.isNotEmpty) '$base/generate-news-image',
      if (fallback.isNotEmpty) '$fallback/generate-news-image',
    ];

    Exception? lastErr;
    for (final url in urls.toSet()) {
      try {
        final client = http.Client();
        final res = await client
            .post(
              Uri.parse(url),
              headers: {'Content-Type': 'application/json'},
              body: jsonEncode({'prompt': p}),
            )
            .timeout(timeout ?? const Duration(seconds: 120));
        client.close();

        if (res.statusCode < 200 || res.statusCode >= 300) {
          lastErr = Exception(
            'HTTP ${res.statusCode} from $url: ${res.body.substring(0, res.body.length.clamp(0, 200))}',
          );
          continue;
        }

        final data = jsonDecode(res.body) as Map<String, dynamic>;
        final imageDataUrl = data['imageDataUrl'];
        if (imageDataUrl is String && imageDataUrl.startsWith('data:image')) {
          return imageDataUrl;
        }
        lastErr = Exception('Response missing imageDataUrl');
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
}) =>
    _vertex.vertexChat(
      message,
      timeout: timeout,
      temperature: temperature,
      maxOutputTokens: maxOutputTokens,
    );

Future<String> vertexGenerateContent({
  required String prompt,
  double temperature = 0.65,
  int maxOutputTokens = 1024,
  Duration? timeout,
}) =>
    _vertex.vertexGenerateContent(
      prompt: prompt,
      temperature: temperature,
      maxOutputTokens: maxOutputTokens,
      timeout: timeout,
    );

Future<String> vertexGenerateNewsImage(String prompt, {Duration? timeout}) =>
    _vertex.vertexGenerateNewsImage(prompt, timeout: timeout);

Future<String> vertexAnalyzePattern(
  Map<String, dynamic> data, {
  Duration? timeout,
}) async {
  final res = await _vertex.fetchJson(
    '/analyze-pattern',
    body: {'data': data},
    timeout: timeout,
  );
  final result = res['result'];
  if (result is! String) {
    throw Exception('Vertex /analyze-pattern: response missing result');
  }
  return result;
}
