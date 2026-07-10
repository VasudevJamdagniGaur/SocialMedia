import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../config/env.dart';
import 'render_backend_queue.dart';

/// HTTP client for Google Gemini (direct API key) and non-AI backend routes.
class VertexApiClient {
  VertexApiClient._();

  static final VertexApiClient instance = VertexApiClient._();

  static const String defaultBaseUrl = 'https://detea-backend.onrender.com';
  static const String _googleApiBase = 'https://generativelanguage.googleapis.com';
  static const String _googleTextModel = 'gemini-2.5-flash';
  static const String _googleImageModel = 'gemini-2.0-flash-preview-image-generation';

  String get _googleApiKey => Env.googleApiKey.trim();
  bool get _hasGoogleApiKey => _googleApiKey.isNotEmpty;

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

  bool get isConfigured => _hasGoogleApiKey;

  String getVertexBackendBaseUrl() =>
      _hasGoogleApiKey ? _googleApiBase : 'NOT SET (GOOGLE_API_KEY)';

  bool isVertexBackendConfigured() => _hasGoogleApiKey;

  void _requireGoogleApiKey(String operation) {
    if (!_hasGoogleApiKey) {
      throw Exception(
        '$operation requires GOOGLE_API_KEY. Add it to .env and rebuild with --dart-define-from-file=../.env',
      );
    }
  }

  Uri _googleModelUri(String model, String action) => Uri.parse(
    '$_googleApiBase/v1beta/models/$model:$action',
  );

  Map<String, String> get _googleApiHeaders => {
    'Content-Type': 'application/json',
    'x-goog-api-key': _googleApiKey,
  };

  Future<Map<String, dynamic>> _googleGenerateContentJson({
    required String prompt,
    required String model,
    double temperature = 0.65,
    int maxOutputTokens = 1024,
    Duration? timeout,
    Map<String, dynamic>? extraGenerationConfig,
  }) async {
    _requireGoogleApiKey('Google Gemini');
    final client = http.Client();
    try {
      final res = await client
          .post(
            _googleModelUri(model, 'generateContent'),
            headers: _googleApiHeaders,
            body: jsonEncode({
              'contents': [
                {
                  'role': 'user',
                  'parts': [
                    {'text': prompt.trim()},
                  ],
                },
              ],
              'generationConfig': {
                'temperature': temperature,
                'maxOutputTokens': maxOutputTokens,
                ...?extraGenerationConfig,
              },
            }),
          )
          .timeout(timeout ?? const Duration(seconds: 60));

      final data = res.body.isEmpty ? <String, dynamic>{} : jsonDecode(res.body) as Map<String, dynamic>;
      if (res.statusCode < 200 || res.statusCode >= 300) {
        final msg = data['error'] ?? data['message'] ?? res.body;
        throw Exception('Google Gemini HTTP ${res.statusCode}: ${msg is String ? msg : jsonEncode(msg)}');
      }
      return data;
    } finally {
      client.close();
    }
  }

  String _parseGoogleTextResponse(Map<String, dynamic> data) {
    final candidates = data['candidates'];
    if (candidates is! List || candidates.isEmpty) {
      throw Exception('Unexpected response from Google Gemini');
    }
    final first = candidates.first;
    if (first is! Map) throw Exception('Unexpected candidate from Google Gemini');
    final content = first['content'];
    if (content is! Map) throw Exception('Google Gemini response missing content');
    final parts = content['parts'];
    if (parts is! List) throw Exception('Google Gemini response missing parts');
    final text = parts.whereType<Map>().map((p) => (p['text'] as String?) ?? '').join('').trim();
    if (text.isEmpty) throw Exception('Google Gemini response missing text');
    return text;
  }

  String _parseGoogleImageResponse(Map<String, dynamic> data) {
    final candidates = data['candidates'];
    if (candidates is! List || candidates.isEmpty) {
      throw Exception('Unexpected image response from Google Gemini');
    }
    for (final candidate in candidates.whereType<Map>()) {
      final content = candidate['content'];
      if (content is! Map) continue;
      final parts = content['parts'];
      if (parts is! List) continue;
      for (final part in parts.whereType<Map>()) {
        final inlineData = part['inlineData'];
        if (inlineData is! Map) continue;
        final dataString = inlineData['data'];
        final mimeType = (inlineData['mimeType'] as String?) ?? 'image/png';
        if (dataString is String && dataString.isNotEmpty) {
          return 'data:$mimeType;base64,$dataString';
        }
      }
    }
    throw Exception('Google Gemini response missing inline image data');
  }

  Future<String> _googleGenerateText({
    required String prompt,
    double temperature = 0.65,
    int maxOutputTokens = 1024,
    Duration? timeout,
  }) async {
    final data = await _googleGenerateContentJson(
      prompt: prompt,
      model: _googleTextModel,
      temperature: temperature,
      maxOutputTokens: maxOutputTokens,
      timeout: timeout,
    );
    return _parseGoogleTextResponse(data);
  }

  Future<String> _googleGenerateImage(
    String prompt, {
    Duration? timeout,
  }) async {
    final data = await _googleGenerateContentJson(
      prompt: prompt,
      model: _googleImageModel,
      temperature: 0.8,
      maxOutputTokens: 2048,
      timeout: timeout ?? const Duration(seconds: 120),
      extraGenerationConfig: const {
        'responseModalities': ['TEXT', 'IMAGE'],
      },
    );
    return _parseGoogleImageResponse(data);
  }

  String _patternAnalysisPromptFromBody(Map<String, dynamic>? body) {
    final instruction =
        (body?['instruction'] as String?)?.trim() ??
        'Analyze the data and return only valid JSON.';
    final days = body?['days'];
    final chatData = body?['chatData'];
    return '''$instruction

Days: $days

Chat data:
${jsonEncode(chatData ?? const [])}''';
  }

  Future<Map<String, dynamic>> fetchJson(
    String path, {
    String method = 'POST',
    Map<String, dynamic>? body,
    Duration? timeout,
    RenderBackendPriority priority = RenderBackendPriority.background,
  }) async {
    if (path == '/analyze-pattern') {
      final result = await _googleGenerateText(
        prompt: _patternAnalysisPromptFromBody(body),
        temperature: 0.3,
        maxOutputTokens: 2048,
        timeout: timeout,
      );
      return {'result': result};
    }
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

  List<String> get _backendBaseUrls {
    final seen = <String>{};
    final urls = <String>[];
    for (final candidate in [
      Env.backendUrl.trim(),
      Env.vertexBackendUrl.trim(),
      Env.vertexGeminiUrl.trim(),
      defaultBaseUrl,
    ]) {
      if (candidate.isEmpty) continue;
      final normalized = candidate.replaceAll(RegExp(r'/$'), '');
      if (seen.add(normalized)) urls.add(normalized);
    }
    return urls;
  }

  bool _shouldTryNextBackend(Object error) {
    final msg = error.toString().toLowerCase();
    return msg.contains('http 404') ||
        msg.contains('http 500') ||
        msg.contains('http 502') ||
        msg.contains('http 503') ||
        msg.contains('network timeout') ||
        msg.contains('network error');
  }

  Future<Map<String, dynamic>> _fetchJsonUnqueued(
    String path, {
    String method = 'POST',
    Map<String, dynamic>? body,
    Duration? timeout,
  }) async {
    final p = path.startsWith('/') ? path : '/$path';
    Exception? lastErr;

    for (final base in _backendBaseUrls) {
      final url = Uri.parse('$base$p');
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
        lastErr = Exception('Network timeout calling backend ($url): $e');
        if (_shouldTryNextBackend(lastErr)) continue;
        rethrow;
      } catch (e) {
        final err = e is Exception ? e : Exception('Network error calling backend ($url): $e');
        lastErr = err;
        if (_shouldTryNextBackend(err)) {
          debugPrint('[VertexApiClient] Backend $url failed, trying next: $err');
          continue;
        }
        rethrow;
      } finally {
        client.close();
      }
    }

    throw lastErr ?? Exception('No backend URL configured for $path');
  }

  Future<String> vertexChat(
    String message, {
    Duration? timeout,
    double? temperature,
    int? maxOutputTokens,
    RenderBackendPriority priority = RenderBackendPriority.background,
  }) async {
    return _googleGenerateText(
      prompt: message,
      temperature: temperature ?? 0.65,
      maxOutputTokens: maxOutputTokens ?? 1024,
      timeout: timeout,
    );
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
    return RenderBackendQueue.instance.run(
      priority: priority,
      debugLabel: 'google-generateContent',
      work: () => _googleGenerateText(
        prompt: prompt,
        temperature: temperature,
        maxOutputTokens: maxOutputTokens,
        timeout: timeout,
      ),
    );
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
    return _googleGenerateText(
      prompt: prompt,
      temperature: temperature,
      maxOutputTokens: maxOutputTokens,
      timeout: timeout,
    );
  }

  /// Bypasses [RenderBackendQueue] — use for share/reflection images so carousel jobs do not block.
  Future<String> vertexGenerateNewsImageDirect(
    String prompt, {
    Duration? timeout,
    Map<String, String>? referenceImage,
  }) async {
    final p = prompt.trim();
    if (p.isEmpty) throw Exception('vertexGenerateNewsImageDirect: prompt is required');
    if (referenceImage != null && (referenceImage['base64'] ?? '').trim().isNotEmpty) {
      debugPrint('[ImageGen] reference images are not supported with direct Google API yet');
    }
    return _googleGenerateImage(p, timeout: timeout);
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
      debugLabel: 'google-generate-image',
      work: () => vertexGenerateNewsImageDirect(
        p,
        timeout: timeout,
        referenceImage: referenceImage,
      ),
    );
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
    body: data,
    timeout: timeout,
    priority: priority,
  );
  final result = res['result'];
  if (result is! String) {
    throw Exception('Vertex /analyze-pattern: response missing result');
  }
  return result;
}
