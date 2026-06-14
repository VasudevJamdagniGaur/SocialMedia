import 'dart:convert';
import 'dart:io';

import 'package:googleapis_auth/auth_io.dart';
import 'package:http/http.dart' as http;

import '../config.dart';

/// Vertex AI Gemini via REST (service account) — port of backend-vertex/lib/generateText.js
class VertexClient {
  VertexClient({http.Client? httpClient}) : _http = httpClient ?? http.Client();

  final http.Client _http;
  AutoRefreshingAuthClient? _authClient;

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

  Uri _modelUri(String modelId) => Uri.parse(
        'https://${ServerConfig.vertexLocation}-aiplatform.googleapis.com/v1/'
        'projects/${ServerConfig.projectId}/locations/${ServerConfig.vertexLocation}/'
        'publishers/google/models/$modelId:generateContent',
      );

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

  Future<String> generateText(
    String prompt, {
    double temperature = 0.65,
    int maxOutputTokens = 2048,
  }) async {
    final trimmed = prompt.trim();
    if (trimmed.isEmpty) throw ArgumentError('prompt must be non-empty');

    final capped = maxOutputTokens.clamp(1, 8192);
    final body = jsonEncode({
      'contents': [
        {
          'role': 'user',
          'parts': [
            {'text': trimmed},
          ],
        },
      ],
      'generationConfig': {
        'temperature': temperature,
        'maxOutputTokens': capped,
      },
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

  Future<String?> generateNewsIllustrationImage(String prompt) async {
    return _generateIllustrationImage(
      prompt,
      prefix:
          'Create a single editorial illustration for a news story. '
          'Tasteful and symbolic or environmental; no graphic violence, gore, or identifiable private individuals. '
          'No text, captions, or logos in the image. '
          'Use a medium or wide shot when people appear; avoid face close-ups.\n\n',
    );
  }

  Future<String?> generatePublicFigureIllustrationImage(
    String prompt, {
    required String referenceImageBase64,
    String mimeType = 'image/jpeg',
  }) async {
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

    final client = await _client();
    final res = await client.post(
      _modelUri(ServerConfig.vertexImageModel),
      headers: {'Content-Type': 'application/json'},
      body: payload,
    );
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw HttpException('Vertex public figure image ${res.statusCode}: ${res.body}');
    }
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    return _extractImageDataUrl(data);
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

    final client = await _client();
    final res = await client.post(
      _modelUri(ServerConfig.vertexImageModel),
      headers: {'Content-Type': 'application/json'},
      body: payload,
    );
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw HttpException('Vertex image ${res.statusCode}: ${res.body}');
    }
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    return _extractImageDataUrl(data);
  }

  void close() {
    _authClient?.close();
    _http.close();
  }
}
