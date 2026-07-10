import 'dart:convert';
import 'dart:io';

/// Server configuration from environment (mirrors backend-vertex/lib/config.js + functions env).
class ServerConfig {
  ServerConfig._();

  static final Map<String, String> _localEnv = {};

  /// Stale GCP project that must never be used for Vertex (broken / invalid consumer).
  static const String _legacyBrokenProjectId = 'offgrid-492919';
  static const String _defaultVertexProjectId = 'my-socitea';

  /// Local `.env` overrides (dev only). Render/production uses [Platform.environment].
  static void setLocalEnv(String key, String value) {
    _localEnv[key.trim()] = value;
  }

  static String? env(String key) {
    final local = _localEnv[key]?.trim();
    if (local != null && local.isNotEmpty) return local;
    final fromPlatform = Platform.environment[key]?.trim();
    if (fromPlatform != null && fromPlatform.isNotEmpty) return fromPlatform;
    return null;
  }

  static String? _sanitizeProjectId(String? raw) {
    final id = raw?.trim() ?? '';
    if (id.isEmpty) return null;
    if (id == _legacyBrokenProjectId) return null;
    return id;
  }

  /// Prefer `project_id` from the service-account JSON so a stale Render
  /// `GOOGLE_CLOUD_PROJECT=offgrid-492919` cannot keep breaking Vertex.
  static String? projectIdFromCredentialsFile() {
    try {
      final path = credentialsPath;
      final file = File(path);
      if (!file.existsSync()) return null;
      final decoded = jsonDecode(file.readAsStringSync());
      if (decoded is! Map) return null;
      return _sanitizeProjectId('${decoded['project_id'] ?? ''}');
    } catch (_) {
      return null;
    }
  }

  static String get projectId =>
      projectIdFromCredentialsFile() ??
      _sanitizeProjectId(env('GOOGLE_CLOUD_PROJECT')) ??
      _defaultVertexProjectId;

  /// Firebase / Firestore project (deitedatabase) — may differ from Vertex GCP project.
  static String get firestoreProjectId {
    for (final k in ['FIREBASE_PROJECT_ID', 'FIRESTORE_PROJECT_ID', 'GCLOUD_PROJECT']) {
      final v = env(k);
      if (v != null && v.isNotEmpty) return v;
    }
    return 'deitedatabase';
  }

  static String get vertexLocation => env('VERTEX_LOCATION') ?? 'us-central1';

  static String get vertexModel => env('VERTEX_GEMINI_MODEL') ?? 'gemini-2.5-flash';

  static String get vertexImageModel {
    final nano = env('VERTEX_NANO_BANANA_IMAGE_MODEL');
    if (nano != null && nano.isNotEmpty) return nano;
    final gemini = env('VERTEX_GEMINI_IMAGE_MODEL');
    if (gemini != null && gemini.isNotEmpty) return gemini;
    return 'gemini-2.5-flash-image';
  }

  static int get port => int.tryParse(env('PORT') ?? '') ?? 3002;

  static String? get googleApiKey {
    for (final k in ['GOOGLE_API_KEY', 'GEMINI_API_KEY']) {
      final v = env(k);
      if (v != null && v.isNotEmpty) return v;
    }
    return null;
  }

  static String get credentialsPath => env('GOOGLE_APPLICATION_CREDENTIALS') ?? 'service-account.json';

  static String? get newsApiKey {
    for (final k in [
      'NEWSAPI_KEY',
      'REACT_APP_NEWSAPI',
      'NEWSAPI_API_KEY',
    ]) {
      final v = env(k);
      if (v != null && v.isNotEmpty) return v;
    }
    return null;
  }

  static String? get youtubeApiKey {
    for (final k in ['YOUTUBE_API_KEY', 'REACT_APP_YOUTUBE_API_KEY']) {
      final v = env(k);
      if (v != null && v.isNotEmpty) return v;
    }
    return null;
  }

  /// Firebase Storage bucket (e.g. deitedatabase.appspot.com or deitedatabase.firebasestorage.app).
  static String get storageBucket {
    for (final k in [
      'FIREBASE_STORAGE_BUCKET',
      'REACT_APP_FIREBASE_STORAGE_BUCKET',
      'GCLOUD_STORAGE_BUCKET',
    ]) {
      final v = env(k);
      if (v != null && v.isNotEmpty) return v;
    }
    return '${firestoreProjectId}.appspot.com';
  }

  static String? get openAiApiKey {
    final v = env('OPENAI_API_KEY');
    if (v != null && v.isNotEmpty) return v;
    return env('REACT_APP_OPENAI_API_KEY');
  }

  static String get linkedInClientId => env('LINKEDIN_CLIENT_ID') ?? '';

  static String get linkedInClientSecret => env('LINKEDIN_CLIENT_SECRET') ?? '';

  static const linkedInRedirectUri =
      'https://deitedatabase.firebaseapp.com/auth/linkedin/callback';

  static List<String> get vertexTextModelFallbacks => [
        vertexModel,
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
        'gemini-1.5-flash-002',
        'gemini-1.5-flash',
      ];

  /// Image models tried in order when the primary model returns no image bytes.
  static List<String> get vertexImageModelFallbacks {
    final primary = vertexImageModel;
    final fallbacks = <String>[
      primary,
      'gemini-2.5-flash-image',
      'gemini-2.0-flash-preview-image-generation',
    ];
    final seen = <String>{};
    return fallbacks.where((m) => seen.add(m)).toList();
  }
}
