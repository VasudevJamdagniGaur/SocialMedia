import 'package:flutter/foundation.dart';

/// Compile-time environment configuration via `--dart-define`.
///
/// Backend host comes only from [backendUrl] (`BACKEND_URL`). Use:
/// `flutter run --dart-define-from-file=../.env`
class Env {
  Env._();

  static const String openAiApiKey = String.fromEnvironment('OPENAI_API_KEY');
  static const String grokApiKey = String.fromEnvironment('GROK_API_KEY');
  static const String googleApiKey = String.fromEnvironment('GOOGLE_API_KEY');

  /// Primary backend for chat, images, news proxy, suggestions, etc.
  static const String backendUrl = String.fromEnvironment(
    'BACKEND_URL',
    defaultValue: 'https://socitea.onrender.com',
  );

  /// Optional overrides; empty means "use [backendUrl]".
  static const String vertexBackendUrl = String.fromEnvironment(
    'VERTEX_BACKEND_URL',
    defaultValue: '',
  );
  static const String vertexGeminiUrl = String.fromEnvironment(
    'VERTEX_GEMINI_URL',
    defaultValue: '',
  );
  static const String generateNewsImageFallbackUrl = String.fromEnvironment(
    'GENERATE_NEWS_IMAGE_FALLBACK_URL',
    defaultValue: '',
  );
  static const String newsApiKey = String.fromEnvironment('NEWSAPI_KEY');
  static const String newsApiFunctionUrl = String.fromEnvironment(
    'NEWSAPI_FUNCTION_URL',
    defaultValue: '',
  );
  static const String newsProxyOrigin = String.fromEnvironment(
    'NEWS_PROXY_ORIGIN',
    defaultValue: '',
  );
  static const String newsApiForceCorsProxy = String.fromEnvironment(
    'NEWSAPI_FORCE_CORS_PROXY',
    defaultValue: '',
  );
  static const String firebaseProjectId = String.fromEnvironment(
    'FIREBASE_PROJECT_ID',
    defaultValue: 'deitedatabase',
  );
  static const String youtubeApiKey = String.fromEnvironment('YOUTUBE_API_KEY');

  /// Normalized backend origin used by all HTTP clients.
  static String get baseUrl {
    for (final candidate in [
      backendUrl.trim(),
      vertexBackendUrl.trim(),
      vertexGeminiUrl.trim(),
    ]) {
      if (candidate.isEmpty) continue;
      // Legacy Render service stuck on broken GCP project — never use it.
      if (candidate.contains('detea-backend.onrender.com')) continue;
      return candidate.replaceAll(RegExp(r'/$'), '');
    }
    // Local Flutter web → Express reddit proxy (see express-backend/)
    if (kIsWeb) {
      final host = Uri.base.host;
      if (host == 'localhost' || host == '127.0.0.1') {
        return 'http://localhost:3002';
      }
    }
    return 'https://socitea.onrender.com';
  }

  /// Backend that serves Vertex AI (`/generateContent`, `/generate-news-image`).
  /// Never use the local Express reddit proxy — it has no image routes.
  static String get aiBackendUrl {
    final b = baseUrl;
    if (b.contains('localhost') ||
        b.contains('127.0.0.1') ||
        b.contains(':3002')) {
      return 'https://socitea.onrender.com';
    }
    if (b.contains('detea-backend.onrender.com')) {
      return 'https://socitea.onrender.com';
    }
    return b;
  }
}
