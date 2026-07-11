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

  /// Parse Gemini 2.5 Flash Image generateContent JSON.
  /// Returns text (joined) + first image as a data URI.
  ({String text, String? imageDataUrl}) _parseImageAndTextFromResponse(
    Map<String, dynamic> data,
  ) {
    final textBuf = StringBuffer();
    String? imageDataUrl;
    final partTypes = <String>[];

    final candidates = data['candidates'];
    final candidateCount = candidates is List ? candidates.length : 0;
    stderr.writeln('[VertexImage] candidateCount=$candidateCount');

    if (candidates is! List || candidates.isEmpty) {
      stderr.writeln('[VertexImage] no candidates to parse');
      return (text: '', imageDataUrl: null);
    }

    for (var ci = 0; ci < candidates.length; ci++) {
      final c = candidates[ci];
      if (c is! Map) continue;
      final content = c['content'];
      if (content is! Map) continue;
      final parts = content['parts'];
      if (parts is! List) continue;

      for (var pi = 0; pi < parts.length; pi++) {
        final p = parts[pi];
        if (p is! Map) continue;

        final text = p['text'] ?? p['Text'];
        if (text is String && text.isNotEmpty) {
          partTypes.add('text');
          textBuf.write(text);
          stderr.writeln(
            '[VertexImage] parse candidate[$ci].part[$pi]=text len=${text.length}',
          );
        }

        final inline = p['inlineData'] ?? p['inline_data'];
        if (inline is Map) {
          partTypes.add('inlineData');
          final mime =
              (inline['mimeType'] ?? inline['mime_type'] ?? 'image/png')
                  .toString()
                  .trim();
          final raw = inline['data'];
          final b64 = _coerceInlineDataToBase64(raw);
          stderr.writeln(
            '[VertexImage] parse candidate[$ci].part[$pi]=inlineData '
            'mime=$mime rawType=${raw.runtimeType} b64Len=${b64?.length ?? 0}',
          );
          if (b64 != null && b64.isNotEmpty && imageDataUrl == null) {
            imageDataUrl = 'data:$mime;base64,$b64';
          }
        } else if (p.containsKey('fileData') || p.containsKey('file_data')) {
          partTypes.add('fileData');
          stderr.writeln(
            '[VertexImage] parse candidate[$ci].part[$pi]=fileData '
            '${jsonEncode(p['fileData'] ?? p['file_data'])}',
          );
        } else if (text is! String) {
          partTypes.add('other:${p.keys.join(",")}');
          stderr.writeln(
            '[VertexImage] parse candidate[$ci].part[$pi]=other keys=${p.keys.toList()}',
          );
        }
      }
    }

    stderr.writeln('[VertexImage] partTypesReturned=$partTypes');
    stderr.writeln(
      '[VertexImage] parsed textLen=${textBuf.length} '
      'hasImage=${imageDataUrl != null} '
      'imageDataUrlLen=${imageDataUrl?.length ?? 0}',
    );
    return (text: textBuf.toString().trim(), imageDataUrl: imageDataUrl);
  }

  /// inlineData.data may be a base64 String or a raw byte List.
  String? _coerceInlineDataToBase64(Object? raw) {
    if (raw == null) return null;
    if (raw is String) {
      final s = raw.replaceAll(RegExp(r'\s'), '');
      return s.isEmpty ? null : s;
    }
    if (raw is List) {
      try {
        final bytes = <int>[];
        for (final e in raw) {
          if (e is int) {
            bytes.add(e);
          } else if (e is num) {
            bytes.add(e.toInt());
          } else {
            return null;
          }
        }
        if (bytes.isEmpty) return null;
        return base64Encode(bytes);
      } catch (e) {
        stderr.writeln('[VertexImage] failed to coerce byte list to base64: $e');
        return null;
      }
    }
    stderr.writeln(
      '[VertexImage] unsupported inlineData.data type: ${raw.runtimeType}',
    );
    return null;
  }

  /// Redact credentials / huge base64 blobs for request logging.
  Object? _redactForLog(Object? value, {int depth = 0}) {
    if (depth > 12) return '<max-depth>';
    if (value is Map) {
      final out = <String, dynamic>{};
      value.forEach((k, v) {
        final key = '$k';
        if (key == 'data' && v is String && v.length > 64) {
          out[key] = '<base64 omitted len=${v.length}>';
        } else {
          out[key] = _redactForLog(v, depth: depth + 1);
        }
      });
      return out;
    }
    if (value is List) {
      return value.map((e) => _redactForLog(e, depth: depth + 1)).toList();
    }
    return value;
  }

  void _logImageRequest({
    required Uri uri,
    required String payload,
    required String debugLabel,
    required String modelId,
    required bool useBeta,
    required int attempt,
  }) {
    stderr.writeln(
      '[VertexImage] ========== REQUEST '
      'label=$debugLabel model=$modelId beta=$useBeta attempt=$attempt ==========',
    );
    stderr.writeln('[VertexImage] URL: $uri');
    stderr.writeln(
      '[VertexImage] project=${ServerConfig.projectId} '
      'location=${ServerConfig.vertexLocation} '
      'resource=publishers/google/models/${ServerConfig.normalizeVertexModelId(modelId)}',
    );
    try {
      final decoded = jsonDecode(payload);
      final redacted = _redactForLog(decoded);
      const encoder = JsonEncoder.withIndent('  ');
      final gen = decoded is Map ? decoded['generationConfig'] : null;
      stderr.writeln('[VertexImage] modelId=$modelId');
      stderr.writeln('[VertexImage] generationConfig: ${encoder.convert(gen)}');
      final modalities = gen is Map ? gen['responseModalities'] ?? gen['response_modalities'] : null;
      stderr.writeln(
        '[VertexImage] responseModalities=$modalities '
        '(must include IMAGE per official Gemini 2.5 Flash Image sample)',
      );
      stderr.writeln(
        '[VertexImage] full request body (excluding credentials / base64):\n'
        '${encoder.convert(redacted)}',
      );
    } catch (e, st) {
      stderr.writeln('[VertexImage] could not parse request JSON for logging: $e');
      stderr.writeln('[VertexImage] stack: $st');
      stderr.writeln(
        '[VertexImage] raw request body (truncated): '
        '${payload.substring(0, payload.length.clamp(0, 2000))}',
      );
    }
  }

  void _logImageResponseParts(Map<String, dynamic> data) {
    const encoder = JsonEncoder.withIndent('  ');
    try {
      final redacted = _redactForLog(data);
      stderr.writeln(
        '[VertexImage] FULL RESPONSE as formatted JSON (base64 redacted):\n'
        '${encoder.convert(redacted)}',
      );
    } catch (e, st) {
      stderr.writeln('[VertexImage] failed to pretty-print response: $e');
      stderr.writeln('[VertexImage] stack: $st');
    }

    final promptFeedback = data['promptFeedback'] ?? data['prompt_feedback'];
    if (promptFeedback != null) {
      stderr.writeln('[VertexImage] promptFeedback: ${jsonEncode(promptFeedback)}');
    }
    final usage = data['usageMetadata'] ?? data['usage_metadata'];
    if (usage != null) {
      stderr.writeln('[VertexImage] usageMetadata: ${jsonEncode(usage)}');
    }

    final candidates = data['candidates'];
    if (candidates is! List || candidates.isEmpty) {
      stderr.writeln('[VertexImage] candidates: NONE / empty');
      return;
    }

    stderr.writeln('[VertexImage] candidateCount=${candidates.length}');
    for (var ci = 0; ci < candidates.length; ci++) {
      final c = candidates[ci];
      if (c is! Map) {
        stderr.writeln('[VertexImage] candidate[$ci]: non-map ${c.runtimeType} value=$c');
        continue;
      }
      stderr.writeln(
        '[VertexImage] ----- candidate[$ci] keys=${c.keys.toList()} -----',
      );
      final finish = c['finishReason'] ?? c['finish_reason'];
      final safety = c['safetyRatings'] ?? c['safety_ratings'];
      final finishMsg = c['finishMessage'] ?? c['finish_message'];
      stderr.writeln(
        '[VertexImage] candidate[$ci] finishReason=$finish finishMessage=$finishMsg',
      );
      if (safety != null) {
        stderr.writeln('[VertexImage] candidate[$ci] safetyRatings: ${jsonEncode(safety)}');
      }

      final content = c['content'];
      if (content is! Map) {
        stderr.writeln('[VertexImage] candidate[$ci] content: missing (raw=${jsonEncode(c)})');
        continue;
      }
      final role = content['role'];
      final parts = content['parts'];
      stderr.writeln(
        '[VertexImage] candidate[$ci] role=$role partCount=${parts is List ? parts.length : 0}',
      );
      if (parts is! List) {
        stderr.writeln('[VertexImage] candidate[$ci] parts missing/invalid');
        continue;
      }

      for (var pi = 0; pi < parts.length; pi++) {
        final p = parts[pi];
        if (p is! Map) {
          stderr.writeln('[VertexImage]   part[$pi]: non-map ${p.runtimeType}');
          continue;
        }
        final hasText = p.containsKey('text') || p.containsKey('Text');
        final inline = p['inlineData'] ?? p['inline_data'];
        final fileData = p['fileData'] ?? p['file_data'];
        final thought = p['thought'];
        final executableCode = p['executableCode'] ?? p['executable_code'];
        final functionCall = p['functionCall'] ?? p['function_call'];
        final keys = p.keys.toList();

        String partType = 'unknown';
        if (hasText && inline == null) {
          partType = 'text';
        } else if (inline != null && !hasText) {
          partType = 'inlineData';
        } else if (inline != null && hasText) {
          partType = 'text+inlineData';
        } else if (fileData != null) {
          partType = 'fileData';
        } else if (thought != null) {
          partType = 'thought';
        } else if (executableCode != null) {
          partType = 'executableCode';
        } else if (functionCall != null) {
          partType = 'functionCall';
        } else {
          partType = 'other(${keys.join(",")})';
        }

        stderr.writeln('[VertexImage]   part[$pi] type=$partType keys=$keys');
        stderr.writeln(
          '[VertexImage]   part[$pi] hasText=$hasText '
          'inlineDataExists=${inline != null} '
          'fileDataExists=${fileData != null} '
          'hasThought=${thought != null}',
        );

        if (hasText) {
          final text = '${p['text'] ?? p['Text'] ?? ''}';
          stderr.writeln(
            '[VertexImage]   part[$pi] text(${text.length}): '
            '${text.substring(0, text.length.clamp(0, 500))}',
          );
        }
        if (inline is Map) {
          final b64 = inline['data'];
          final mime = inline['mimeType'] ?? inline['mime_type'];
          final len = b64 is String
              ? b64.length
              : (b64 is List ? b64.length : 0);
          stderr.writeln(
            '[VertexImage]   part[$pi] inlineData EXISTS=true mimeType=$mime '
            'dataType=${b64.runtimeType} dataLen=$len '
            'empty=${b64 == null || (b64 is String && b64.isEmpty) || (b64 is List && b64.isEmpty)}',
          );
        } else {
          stderr.writeln('[VertexImage]   part[$pi] inlineData EXISTS=false');
        }
        if (fileData is Map) {
          stderr.writeln('[VertexImage]   part[$pi] fileData: ${jsonEncode(fileData)}');
        }
      }
    }
  }

  /// Official Gemini 2.5 Flash Image sample (Vertex REST uses camelCase):
  /// generationConfig.responseModalities = ["TEXT", "IMAGE"]
  Map<String, dynamic> _imageGenerationConfig({
    double temperature = 0.9,
    String aspectRatio = '16:9',
  }) {
    return {
      'temperature': temperature,
      'maxOutputTokens': 32768,
      // Required for image output from gemini-2.5-flash-image.
      'responseModalities': ['TEXT', 'IMAGE'],
      'imageConfig': {
        'aspectRatio': aspectRatio,
      },
    };
  }

  Future<String> _postImagePayload(String payload, {String? debugLabel}) async {
    final label = debugLabel ?? 'image';
    final sw = Stopwatch()..start();
    void checkpoint(String stage) {
      final ms = sw.elapsedMilliseconds;
      stderr.writeln('[VertexImage] checkpoint stage=$stage label=$label elapsedMs=$ms');
      if (ms > 5000) {
        stderr.writeln(
          '[VertexImage] SLOW (>5s) still at stage=$stage label=$label elapsedMs=$ms',
        );
      }
    }

    checkpoint('post_image_start');
    final client = await _client();
    checkpoint('auth_client_ready');
    Object? lastErr;

    // Pin to Gemini 2.5 Flash Image (normalize full resource names → short ID).
    final primary = ServerConfig.normalizeVertexModelId(ServerConfig.vertexImageModel);
    final models = <String>[
      if (primary.isNotEmpty) primary,
      'gemini-2.5-flash-image',
    ];
    final seen = <String>{};
    final modelIds = models.where((m) => seen.add(m)).toList();
    stderr.writeln('[VertexImage] modelIds=$modelIds (pinned gemini-2.5-flash-image)');

    for (final modelId in modelIds) {
      for (var attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
          final delaySec = 2 << (attempt - 1);
          await Future<void>.delayed(Duration(seconds: delaySec));
        }

        // GA samples use v1; try v1 first, then v1beta1.
        for (final useBeta in [false, true]) {
          final uri = _modelUri(modelId, useBeta: useBeta);
          checkpoint('before_vertex_http model=$modelId beta=$useBeta attempt=${attempt + 1}');
          _logImageRequest(
            uri: uri,
            payload: payload,
            debugLabel: label,
            modelId: modelId,
            useBeta: useBeta,
            attempt: attempt + 1,
          );

          late http.Response res;
          try {
            res = await client.post(
              uri,
              headers: {'Content-Type': 'application/json'},
              body: payload,
            );
          } catch (e, st) {
            stderr.writeln('[VertexImage] HTTP transport error: $e');
            stderr.writeln('[VertexImage] full stack trace:\n$st');
            lastErr = e;
            continue;
          }

          checkpoint('after_vertex_http status=${res.statusCode}');
          stderr.writeln(
            '[VertexImage] ========== RESPONSE status=${res.statusCode} '
            'bytes=${res.body.length} label=$label model=$modelId beta=$useBeta ==========',
          );
          // Always dump raw body first (complete Vertex response).
          stderr.writeln('[VertexImage] COMPLETE VERTEX RESPONSE JSON:\n${res.body}');

          if (res.statusCode < 200 || res.statusCode >= 300) {
            stderr.writeln(
              '[VertexImage] ERROR status=${res.statusCode} complete error body above',
            );
            lastErr = HttpException(
              'Vertex image HTTP ${res.statusCode}: ${res.body}',
            );
            if (_isVertexRateLimited(res)) {
              stderr.writeln('[VertexImage] rate-limited — will retry');
              continue;
            }
            if (res.statusCode == 404 && !useBeta) {
              stderr.writeln('[VertexImage] 404 on v1 — trying v1beta1');
              continue;
            }
            if (res.statusCode == 404) {
              stderr.writeln('[VertexImage] 404 on v1beta1 — next model');
              break;
            }
            continue;
          }

          Map<String, dynamic> data;
          try {
            final decoded = jsonDecode(res.body);
            if (decoded is! Map) {
              stderr.writeln(
                '[VertexImage] response JSON is not an object: ${res.body}',
              );
              lastErr = Exception('Vertex image response was not a JSON object');
              continue;
            }
            data = Map<String, dynamic>.from(decoded);
          } catch (e, st) {
            stderr.writeln('[VertexImage] JSON parse failed: $e');
            stderr.writeln('[VertexImage] raw body:\n${res.body}');
            stderr.writeln('[VertexImage] full stack trace:\n$st');
            lastErr = e;
            continue;
          }

          checkpoint('after_parse_response');
          _logImageResponseParts(data);

          final parsed = _parseImageAndTextFromResponse(data);
          stderr.writeln(
            '[VertexImage] found inlineData/imageBytes=${parsed.imageDataUrl != null} '
            'textLen=${parsed.text.length}',
          );
          if (parsed.text.isNotEmpty) {
            stderr.writeln(
              '[VertexImage] model text: '
              '${parsed.text.substring(0, parsed.text.length.clamp(0, 500))}',
            );
          }

          final image = parsed.imageDataUrl;
          if (image != null && image.startsWith('data:image')) {
            checkpoint('success');
            stderr.writeln(
              '[VertexImage] SUCCESS extracted image data URL '
              'len=${image.length} mimePrefix=${image.substring(0, image.length.clamp(0, 40))}',
            );
            return image;
          }

          stderr.writeln(
            '[VertexImage] NO IMAGE BYTES (inlineData/fileData/image missing) — '
            'complete Vertex response JSON was logged above',
          );
          final finish = _responseFinishReason(data);
          lastErr = Exception(
            'Model $modelId returned no inlineData image '
            '(finishReason=$finish textLen=${parsed.text.length} label=$label). '
            'See complete Vertex response JSON above.',
          );
        }
      }
    }

    checkpoint('all_attempts_failed');
    stderr.writeln('[VertexImage] ALL ATTEMPTS FAILED lastErr=$lastErr');
    throw lastErr ?? Exception('Vertex image generation failed after retries');
  }

  Future<String> _generateIllustrationImage(String prompt, {required String prefix}) async {
    final body = prompt.trim();
    if (body.isEmpty) {
      stderr.writeln('[VertexImage] empty prompt — throwing');
      throw ArgumentError('illustration prompt must be non-empty');
    }

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
      'generationConfig': _imageGenerationConfig(temperature: 0.9),
    });

    try {
      return await _postImagePayload(payload, debugLabel: 'illustration');
    } catch (firstErr, firstSt) {
      stderr.writeln('[VertexImage] illustration attempt failed: $firstErr');
      stderr.writeln('[VertexImage] full stack trace:\n$firstSt');
      stderr.writeln('[VertexImage] retrying with shortened prompt…');

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
        'generationConfig': _imageGenerationConfig(temperature: 0.85),
      });
      return _postImagePayload(retryPayload, debugLabel: 'illustration-retry');
    }
  }

  Future<String> generatePublicFigureIllustrationImage(
    String prompt, {
    required String referenceImageBase64,
    String mimeType = 'image/jpeg',
  }) async {
    return _imageGenQueue.run(() async {
      final b64 = referenceImageBase64.replaceAll(RegExp(r'\s'), '');
      if (b64.isEmpty) {
        throw ArgumentError('public-figure: reference image base64 is empty');
      }

      final body = prompt.trim();
      if (body.isEmpty) {
        throw ArgumentError('public-figure: prompt is empty');
      }

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
        'generationConfig': _imageGenerationConfig(temperature: 0.35),
      });

      return _postImagePayload(payload, debugLabel: 'public-figure');
    });
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

  Future<String> generateNewsIllustrationImage(String prompt) async {
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
  Future<String> generateShareSceneImage(String prompt) async {
    return _imageGenQueue.run(() => _generateIllustrationImage(
          prompt,
          prefix:
              'Create one vivid editorial photograph or illustration for a social media post. '
              'Depict the SCENE, objects, and mood described below — environment and situation are the focus. '
              'Medium or wide shot; avoid face close-ups and identifiable celebrities. '
              'No text, captions, or logos in the image.\n\n',
        ));
  }

  void close() {
    _authClient?.close();
    _http.close();
  }
}
