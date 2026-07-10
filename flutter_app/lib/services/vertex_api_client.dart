import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../config/env.dart';
import 'firebase_gemini_client.dart';
import 'render_backend_queue.dart';

/// HTTP client for the Vertex AI Express backend (Render).
/// AI text: BACKEND_URL first, then Google API key, then Firebase AI Logic.
/// Skips backends stuck on the broken `offgrid-492919` project.
class VertexApiClient {
  VertexApiClient._();

  static final VertexApiClient instance = VertexApiClient._();

  static const String _googleApiBase = 'https://generativelanguage.googleapis.com';
  static const String _googleTextModel = 'gemini-2.5-flash';
  static const String _googleImageModel = 'gemini-2.0-flash-preview-image-generation';
  static const String _brokenGcpProject = 'offgrid-492919';
  static const String _legacyBrokenHost = 'detea-backend.onrender.com';

  String get _googleApiKey => Env.googleApiKey.trim();
  bool get _hasGoogleApiKey => _googleApiKey.isNotEmpty;

  /// Always [Env.baseUrl] — set via `BACKEND_URL` / `--dart-define-from-file`.
  String get baseUrl {
    final raw = Env.baseUrl;
    if (raw.contains(_legacyBrokenHost)) {
      return 'https://socitea.onrender.com';
    }
    return raw;
  }

  bool get isConfigured => true; // Firebase AI always available as last resort

  bool get _hasBackend => baseUrl.isNotEmpty;

  String getVertexBackendBaseUrl() => baseUrl;

  bool isVertexBackendConfigured() => isConfigured;

  /// Cached health: null = unknown, true = usable, false = skip (offgrid / down).
  final Map<String, bool> _backendUsableCache = {};
  final Map<String, DateTime> _backendHealthCheckedAt = {};

  Future<bool> _isBackendUsable(String origin) async {
    // Known-good production host — skip the extra /health round-trip.
    if (origin.contains('socitea.onrender.com')) {
      _backendUsableCache[origin] = true;
      _backendHealthCheckedAt[origin] = DateTime.now();
      return true;
    }

    final cached = _backendUsableCache[origin];
    final checkedAt = _backendHealthCheckedAt[origin];
    if (cached != null &&
        checkedAt != null &&
        DateTime.now().difference(checkedAt) < const Duration(minutes: 15)) {
      return cached;
    }

    final client = http.Client();
    try {
      final res = await client
          .get(Uri.parse('$origin/health'))
          .timeout(const Duration(seconds: 3));
      if (res.statusCode < 200 || res.statusCode >= 300) {
        _backendUsableCache[origin] = false;
        _backendHealthCheckedAt[origin] = DateTime.now();
        return false;
      }
      final body = res.body.toLowerCase();
      final broken = body.contains(_brokenGcpProject) ||
          body.contains('consumer_invalid');
      if (broken) {
        debugPrint(
          '[VertexApiClient] Skipping $origin — health still on $_brokenGcpProject',
        );
      }
      _backendUsableCache[origin] = !broken;
      _backendHealthCheckedAt[origin] = DateTime.now();
      return !broken;
    } catch (e) {
      debugPrint('[VertexApiClient] Health check failed for $origin: $e');
      // Don't permanently skip on transient network errors.
      return true;
    } finally {
      client.close();
    }
  }

  bool _isBrokenBackendError(Object error) {
    final msg = error.toString().toLowerCase();
    return msg.contains(_brokenGcpProject) ||
        msg.contains('consumer_invalid') ||
        (msg.contains('permission denied') && msg.contains('offgrid'));
  }

  Uri _googleModelUri(String model, String action) => Uri.parse(
    '$_googleApiBase/v1beta/models/$model:$action',
  );

  Map<String, String> get _googleApiHeaders => {
    'Content-Type': 'application/json',
    'x-goog-api-key': _googleApiKey,
  };

  bool _shouldFallbackToGoogle(Object error) {
    final msg = error.toString().toLowerCase();
    return _isBrokenBackendError(error) ||
        msg.contains('http 404') ||
        msg.contains('http 500') ||
        msg.contains('http 502') ||
        msg.contains('http 503') ||
        msg.contains('network timeout') ||
        msg.contains('network error') ||
        msg.contains('permission_denied') ||
        msg.contains('consumer_invalid');
  }

  Future<String> _firebaseGenerateText({
    required String prompt,
    double temperature = 0.65,
    int maxOutputTokens = 1024,
  }) {
    return FirebaseGeminiClient.instance.generateText(
      prompt: prompt,
      temperature: temperature,
      maxOutputTokens: maxOutputTokens,
    );
  }

  Future<Map<String, dynamic>> _googleGenerateContentJson({
    required String prompt,
    required String model,
    double temperature = 0.65,
    int maxOutputTokens = 1024,
    Duration? timeout,
    Map<String, dynamic>? extraGenerationConfig,
  }) async {
    if (!_hasGoogleApiKey) {
      throw Exception('GOOGLE_API_KEY is not configured');
    }
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

  Future<String> _backendGenerateText({
    required String prompt,
    double temperature = 0.65,
    int maxOutputTokens = 1024,
    Duration? timeout,
    bool bypassQueue = false,
    RenderBackendPriority priority = RenderBackendPriority.background,
  }) async {
    final body = {
      'prompt': prompt.trim(),
      'temperature': temperature,
      'maxOutputTokens': maxOutputTokens,
    };
    final data = bypassQueue
        ? await _fetchJsonUnqueued('/generateContent', body: body, timeout: timeout)
        : await fetchJson('/generateContent', body: body, timeout: timeout, priority: priority);
    return _parseGenerateContentResponse(data);
  }

  Future<String> _generateTextResolvingProvider({
    required String prompt,
    double temperature = 0.65,
    int maxOutputTokens = 1024,
    Duration? timeout,
    bool bypassQueue = false,
    RenderBackendPriority priority = RenderBackendPriority.background,
  }) async {
    Object? lastErr;

    if (_hasBackend) {
      final usable = await _isBackendUsable(baseUrl);
      if (!usable) {
        debugPrint(
          '[VertexApiClient] Backend $baseUrl unusable (offgrid/broken); skipping',
        );
        lastErr = Exception(
          'Backend $baseUrl is stuck on $_brokenGcpProject. Redeploy server/ with my-socitea.',
        );
      } else {
        try {
          return await _backendGenerateText(
            prompt: prompt,
            temperature: temperature,
            maxOutputTokens: maxOutputTokens,
            timeout: timeout,
            bypassQueue: bypassQueue,
            priority: priority,
          );
        } catch (e) {
          lastErr = e;
          if (_isBrokenBackendError(e)) {
            _backendUsableCache[baseUrl] = false;
            _backendHealthCheckedAt[baseUrl] = DateTime.now();
          }
          if (!_shouldFallbackToGoogle(e) && !_hasGoogleApiKey) {
            // Still try Firebase below.
            debugPrint('[VertexApiClient] Backend text failed: $e');
          } else {
            debugPrint('[VertexApiClient] Backend text failed, trying fallbacks: $e');
          }
        }
      }
    }

    if (_hasGoogleApiKey) {
      try {
        return await _googleGenerateText(
          prompt: prompt,
          temperature: temperature,
          maxOutputTokens: maxOutputTokens,
          timeout: timeout,
        );
      } catch (e) {
        lastErr = e;
        debugPrint('[VertexApiClient] Google API text failed, trying Firebase AI: $e');
      }
    }

    try {
      return await _firebaseGenerateText(
        prompt: prompt,
        temperature: temperature,
        maxOutputTokens: maxOutputTokens,
      );
    } catch (e) {
      debugPrint('[VertexApiClient] Firebase AI text failed: $e');
      throw Exception(
        'All AI providers failed. '
        'Render backend is on $_brokenGcpProject (redeploy server/ with my-socitea), '
        'GOOGLE_API_KEY credits may be depleted, and Firebase AI failed: $e. '
        'Last backend error: $lastErr',
      );
    }
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
      final result = await _generateTextResolvingProvider(
        prompt: _patternAnalysisPromptFromBody(body),
        temperature: 0.3,
        maxOutputTokens: 2048,
        timeout: timeout,
        priority: priority,
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
      baseUrl,
      'https://socitea.onrender.com',
    ]) {
      if (candidate.isEmpty) continue;
      if (candidate.contains(_legacyBrokenHost)) continue;
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
    return _generateTextResolvingProvider(
      prompt: message,
      temperature: temperature ?? 0.65,
      maxOutputTokens: maxOutputTokens ?? 1024,
      timeout: timeout,
      bypassQueue: true,
      priority: priority,
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
      debugLabel: '/generateContent',
      work: () => _generateTextResolvingProvider(
        prompt: prompt,
        temperature: temperature,
        maxOutputTokens: maxOutputTokens,
        timeout: timeout,
        priority: priority,
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
    return _generateTextResolvingProvider(
      prompt: prompt,
      temperature: temperature,
      maxOutputTokens: maxOutputTokens,
      timeout: timeout,
      bypassQueue: true,
    );
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

    if (_hasBackend) {
      try {
        return await _vertexGenerateNewsImageUnqueued(
          p,
          timeout: timeout,
          referenceImage: referenceImage,
        );
      } catch (e) {
        if (!_hasGoogleApiKey || !_shouldFallbackToGoogle(e)) rethrow;
        debugPrint('[VertexApiClient] Backend image failed, trying Google API: $e');
      }
    }

    if (_hasGoogleApiKey) {
      return _googleGenerateImage(p, timeout: timeout);
    }

    throw Exception(
      'No image provider configured. Set BACKEND_URL or GOOGLE_API_KEY in .env and rebuild.',
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
      work: () => vertexGenerateNewsImageDirect(
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
