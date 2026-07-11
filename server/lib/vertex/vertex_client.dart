import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:googleapis_auth/auth_io.dart';
import 'package:http/http.dart' as http;

import '../config.dart';

/// Serializes Vertex image API calls so parallel carousel requests do not exhaust quota.
class _VertexImageGenQueue {
  Future<void> _tail = Future.value();

  Future<T> run<T>(Future<T> Function() action) {
    final completer = Completer<T>();
    _tail = _tail.then((_) async {
      try {
        completer.complete(await action());
      } catch (e, st) {
        completer.completeError(e, st);
      }
    });
    return completer.future;
  }
}

bool _isVertexRateLimited(http.Response res) {
  if (res.statusCode == 429) return true;
  final body = res.body.toLowerCase();
  return body.contains('resource exhausted') ||
      body.contains('"code":429') ||
      body.contains('rate limit');
}

/// Vertex AI Gemini via REST (service account) — port of backend-vertex/lib/generateText.js
class VertexClient {
  VertexClient({http.Client? httpClient}) : _http = httpClient ?? http.Client();

  final http.Client _http;
  AutoRefreshingAuthClient? _authClient;
  final _imageGenQueue = _VertexImageGenQueue();

  Future<AutoRefreshingAuthClient> _client() async {
    if (_authClient != null) return _authClient!;
    final path = ServerConfig.credentialsPath;
    if (!File(path).existsSync()) {
      throw StateError('Missing service account at $path (set GOOGLE_APPLICATION_CREDENTIALS)');
    }
    final creds = ServiceAccountCredentials.fromJson(
      jsonDecode(await File(path).readAsString()) as Map<String, dynamic>,
    );
    _authClient = await clientViaServiceAccount(
      creds,
      ['https://www.googleapis.com/auth/cloud-platform'],
    );
    return _authClient!;
  }

  Uri _modelUri(String modelId, {bool useBeta = false}) {
    final id = ServerConfig.normalizeVertexModelId(modelId);
    final version = useBeta ? 'v1beta1' : 'v1';
    return Uri.parse(
      'https://${ServerConfig.vertexLocation}-aiplatform.googleapis.com/$version/'
      'projects/${ServerConfig.projectId}/locations/${ServerConfig.vertexLocation}/'
      'publishers/google/models/$id:generateContent',
    );
  }

  String? _responseFinishReason(Map<String, dynamic> data) {
    final candidates = data['candidates'];
    if (candidates is! List || candidates.isEmpty) return null;
    final c0 = candidates[0];
    if (c0 is! Map) return null;
    final reason = c0['finishReason'] ?? c0['finish_reason'];
    return reason?.toString();
  }

  List<String> _responseTextParts(Map<String, dynamic> data) {
    final candidates = data['candidates'];
    if (candidates is! List || candidates.isEmpty) return const [];
    final content = candidates[0] is Map ? candidates[0]['content'] : null;
    if (content is! Map) return const [];
    final parts = content['parts'];
    if (parts is! List) return const [];
    final out = <String>[];
    for (final p in parts) {
      if (p is Map && p['text'] is String) out.add(p['text'] as String);
    }
    return out;
  }

  bool _isNotFoundModel(Object err) {
    final msg = err.toString().toLowerCase();
    return msg.contains('404') ||
        msg.contains('not_found') ||
        msg.contains('publisher model') ||
        msg.contains('was not found');
  }

  String _extractText(Map<String, dynamic> data) {
    final candidates = data['candidates'];
    if (candidates is! List || candidates.isEmpty) return '';
    final content = candidates[0] is Map ? candidates[0]['content'] : null;
    if (content is! Map) return '';
    final parts = content['parts'];
    if (parts is! List) return '';
    final buf = StringBuffer();
    for (final p in parts) {
      if (p is Map && p['text'] is String) buf.write(p['text']);
    }
    return buf.toString().trim();
  }

  String? _extractImageDataUrl(Map<String, dynamic> data) {
    final candidates = data['candidates'];
    if (candidates is! List || candidates.isEmpty) return null;
    final content = candidates[0] is Map ? candidates[0]['content'] : null;
    if (content is! Map) return null;
    final parts = content['parts'];
    if (parts is! List) return null;
    for (final p in parts) {
      if (p is! Map) continue;
      final inline = p['inlineData'] ?? p['inline_data'];
      if (inline is! Map) continue;
      final b64 = inline['data'];
      if (b64 is! String || b64.isEmpty) continue;
      final mime = (inline['mimeType'] ?? inline['mime_type'] ?? 'image/png')
          .toString()
          .trim();
      return 'data:$mime;base64,${b64.replaceAll(RegExp(r'\s'), '')}';
    }
    return null;
  }

  Map<String, dynamic> _textGenerationConfig({
    required double temperature,
    required int maxOutputTokens,
  }) {
    return {
      'temperature': temperature,
      'maxOutputTokens': maxOutputTokens.clamp(1, 8192),
      // Gemini 2.5 Flash thinks by default (~8k tokens) — disable for latency.
      'thinkingConfig': {'thinkingBudget': 0},
    };
  }

  Future<String> _generateTextViaVertex(
    String prompt, {
    required double temperature,
    required int maxOutputTokens,
  }) async {
    final body = jsonEncode({
      'contents': [
        {
          'role': 'user',
          'parts': [
            {'text': prompt},
          ],
        },
      ],
      'generationConfig': _textGenerationConfig(
        temperature: temperature,
        maxOutputTokens: maxOutputTokens,
      ),
    });

    Object? lastErr;
    for (final modelId in ServerConfig.vertexTextModelFallbacks) {
      try {
        final client = await _client();
        final res = await client.post(
          _modelUri(modelId),
          headers: {'Content-Type': 'application/json'},
          body: body,
        );
        if (res.statusCode == 404) continue;
        if (res.statusCode < 200 || res.statusCode >= 300) {
          throw HttpException('Vertex ${res.statusCode}: ${res.body}');
        }
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        return _extractText(data);
      } catch (e) {
        lastErr = e;
        if (_isNotFoundModel(e)) continue;
        rethrow;
      }
    }
    throw Exception('Vertex generateContent failed: $lastErr');
  }

  Future<String> generateText(
    String prompt, {
    double temperature = 0.65,
    int maxOutputTokens = 2048,
  }) async {
    final trimmed = prompt.trim();
    if (trimmed.isEmpty) throw ArgumentError('prompt must be non-empty');

    final hasCreds = File(ServerConfig.credentialsPath).existsSync();
    // Prefer service-account Vertex first — API keys often fail slowly (429/depleted).
    if (hasCreds) {
      try {
        return await _generateTextViaVertex(
          trimmed,
          temperature: temperature,
          maxOutputTokens: maxOutputTokens,
        );
      } catch (e) {
        stderr.writeln('[VertexClient] Vertex SA failed, trying Gemini API key: $e');
      }
    }

    final apiKey = ServerConfig.googleApiKey;
    if (apiKey != null) {
      return _generateTextViaGeminiApi(
        trimmed,
        apiKey: apiKey,
        temperature: temperature,
        maxOutputTokens: maxOutputTokens,
      );
    }

    if (hasCreds) {
      // Re-throw last Vertex path by retrying once for a clear error.
      return _generateTextViaVertex(
        trimmed,
        temperature: temperature,
        maxOutputTokens: maxOutputTokens,
      );
    }
    throw StateError('No Vertex credentials or GOOGLE_API_KEY configured');
  }

  Future<String> _generateTextViaGeminiApi(
    String prompt, {
    required String apiKey,
    double temperature = 0.65,
    int maxOutputTokens = 2048,
  }) async {
    final models = ServerConfig.vertexTextModelFallbacks;
    Object? lastErr;

    for (final modelId in models) {
      try {
        final res = await _http.post(
          Uri.parse(
            'https://generativelanguage.googleapis.com/v1beta/models/$modelId:generateContent',
          ),
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: jsonEncode({
            'contents': [
              {
                'role': 'user',
                'parts': [
                  {'text': prompt},
                ],
              },
            ],
            'generationConfig': _textGenerationConfig(
              temperature: temperature,
              maxOutputTokens: maxOutputTokens,
            ),
          }),
        );
        if (res.statusCode == 404) continue;
        if (res.statusCode < 200 || res.statusCode >= 300) {
          throw HttpException('Gemini API ${res.statusCode}: ${res.body}');
        }
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        final text = _extractText(data);
        if (text.isEmpty) {
          throw HttpException('Gemini API returned empty text');
        }
        return text;
      } catch (e) {
        lastErr = e;
        if (_isNotFoundModel(e)) continue;
        rethrow;
      }
    }
    throw Exception('Gemini API generateContent failed: $lastErr');
  }

  Future<String?> generateNewsIllustrationImage(String prompt) async {
    return _imageGenQueue.run(() => _generateIllustrationImage(
          prompt,
          prefix:
              'Create a single editorial illustration for a news story. '
              'Tasteful and symbolic or environmental; no graphic violence, gore, or identifiable private individuals. '
              'No text, captions, or logos in the image. '
              'Use a medium or wide shot when people appear; avoid face close-ups.\n\n',
        ));
  }

  /// Share/reflection posts — scene-focused, not wire-service news tone.
  Future<String?> generateShareSceneImage(String prompt) async {
    return _imageGenQueue.run(() => _generateIllustrationImage(
          prompt,
          prefix:
              'Create one vivid editorial photograph or illustration for a social media post. '
              'Depict the SCENE, objects, and mood described below — environment and situation are the focus. '
              'Medium or wide shot; avoid face close-ups and identifiable celebrities. '
              'No text, captions, or logos in the image.\n\n',
        ));
  }

  Future<String?> generatePublicFigureIllustrationImage(
    String prompt, {
    required String referenceImageBase64,
    String mimeType = 'image/jpeg',
  }) async {
    return _imageGenQueue.run(() async {
      final b64 = referenceImageBase64.replaceAll(RegExp(r'\s'), '');
      if (b64.isEmpty) return null;

      final body = prompt.trim();
      if (body.isEmpty) return null;

      const instructions =
          'REFERENCE PHOTO ATTACHED: This is the real public figure who must appear in the output.\n'
          'Generate ONE editorial news illustration for social media.\n'
          'CRITICAL: The person in the generated image MUST have the EXACT same face, facial structure, '
          'skin tone, hair, and beard or hairstyle as the reference photo. Do NOT invent a different person.\n'
          'Show their face clearly and recognizably. Match the story scene below while preserving identity.\n'
          'No text overlays or logos unless mentioned in the story.\n\n'
          'Story / scene:\n';

      final full = '$instructions${body.length > 5500 ? body.substring(0, 5500) : body}';
      final cleanMime = mimeType.trim().isEmpty ? 'image/jpeg' : mimeType.trim();

      final payload = jsonEncode({
        'contents': [
          {
            'role': 'user',
            'parts': [
              {
                'inlineData': {
                  'mimeType': cleanMime,
                  'data': b64,
                },
              },
              {'text': full},
            ],
          },
        ],
        'generationConfig': {
          'temperature': 0.35,
          'maxOutputTokens': 8192,
          'responseModalities': ['TEXT', 'IMAGE'],
        },
      });

      return _postImagePayload(payload, debugLabel: 'public-figure');
    });
  }

  Future<String?> _postImagePayload(String payload, {String? debugLabel}) async {
    final client = await _client();
    Object? lastErr;
    final models = ServerConfig.vertexImageModelFallbacks;

    for (final modelId in models) {
      for (var attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
          final delaySec = 2 << (attempt - 1);
          await Future<void>.delayed(Duration(seconds: delaySec));
        }

        for (final useBeta in [true, false]) {
          try {
            final uri = _modelUri(modelId, useBeta: useBeta);
            stderr.writeln('[VertexImage] POST $uri ${debugLabel ?? ''}');
            final res = await client.post(
              uri,
              headers: {'Content-Type': 'application/json'},
              body: payload,
            );
            if (_isVertexRateLimited(res)) {
              lastErr = HttpException('Vertex image ${res.statusCode}: ${res.body}');
              continue;
            }
            if (res.statusCode == 404 && useBeta) continue;
            if (res.statusCode < 200 || res.statusCode >= 300) {
              lastErr = HttpException('Vertex image ${res.statusCode}: ${res.body}');
              if (res.statusCode == 404) break;
              continue;
            }

            final data = jsonDecode(res.body) as Map<String, dynamic>;
            final image = _extractImageDataUrl(data);
            if (image != null) return image;

            final finish = _responseFinishReason(data);
            final textParts = _responseTextParts(data);
            stderr.writeln(
              '[VertexImage] no image from $modelId beta=$useBeta '
              '${debugLabel ?? ''} finish=$finish textParts=${textParts.length}',
            );
            if (textParts.isNotEmpty) {
              stderr.writeln(
                '[VertexImage] model text: ${textParts.first.substring(0, textParts.first.length.clamp(0, 240))}',
              );
            }
            lastErr = Exception('Model $modelId returned no image part (finish=$finish)');
          } catch (e) {
            lastErr = e;
            if (_isNotFoundModel(e)) break;
          }
        }
      }
    }

    throw lastErr ?? Exception('Vertex image generation failed after retries');
  }

  Future<String?> _generateIllustrationImage(String prompt, {required String prefix}) async {
    final body = prompt.trim();
    if (body.isEmpty) return null;

    final full = '$prefix${body.length > 6000 ? body.substring(0, 6000) : body}';

    final payload = jsonEncode({
      'contents': [
        {
          'role': 'user',
          'parts': [
            {'text': full},
          ],
        },
      ],
      'generationConfig': {
        'temperature': 0.9,
        'maxOutputTokens': 8192,
        'responseModalities': ['TEXT', 'IMAGE'],
      },
    });

    try {
      return await _postImagePayload(payload, debugLabel: 'illustration');
    } catch (_) {
      final shortened = body.length > 900 ? body.substring(body.length - 900) : body;
      final simple = '$prefix'
          'Scene to illustrate (medium wide shot, no face close-up, no text in image):\n'
          '${shortened.length > 1200 ? shortened.substring(0, 1200) : shortened}';
      final retryPayload = jsonEncode({
        'contents': [
          {
            'role': 'user',
            'parts': [
              {'text': simple},
            ],
          },
        ],
        'generationConfig': {
          'temperature': 0.85,
          'maxOutputTokens': 8192,
          'responseModalities': ['TEXT', 'IMAGE'],
        },
      });
      return _postImagePayload(retryPayload, debugLabel: 'illustration-retry');
    }
  }

  void close() {
    _authClient?.close();
    _http.close();
  }
}
