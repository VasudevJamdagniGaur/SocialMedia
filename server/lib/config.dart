import 'dart:io';

/// Server configuration from environment (mirrors backend-vertex/lib/config.js + functions env).
class ServerConfig {
  ServerConfig._();

  static String get projectId =>
      Platform.environment['GOOGLE_CLOUD_PROJECT']?.trim().isNotEmpty == true
          ? Platform.environment['GOOGLE_CLOUD_PROJECT']!.trim()
          : 'offgrid-492919';

  /// Firebase / Firestore project (deitedatabase) — may differ from Vertex GCP project.
  static String get firestoreProjectId {
    for (final k in ['FIREBASE_PROJECT_ID', 'FIRESTORE_PROJECT_ID', 'GCLOUD_PROJECT']) {
      final v = Platform.environment[k]?.trim();
      if (v != null && v.isNotEmpty) return v;
    }
    return 'deitedatabase';
  }

  static String get vertexLocation =>
      Platform.environment['VERTEX_LOCATION']?.trim().isNotEmpty == true
          ? Platform.environment['VERTEX_LOCATION']!.trim()
          : 'us-central1';

  static String get vertexModel =>
      Platform.environment['VERTEX_GEMINI_MODEL']?.trim().isNotEmpty == true
          ? Platform.environment['VERTEX_GEMINI_MODEL']!.trim()
          : 'gemini-2.5-flash';

  static String get vertexImageModel =>
      Platform.environment['VERTEX_NANO_BANANA_IMAGE_MODEL']?.trim().isNotEmpty ==
              true
          ? Platform.environment['VERTEX_NANO_BANANA_IMAGE_MODEL']!.trim()
          : (Platform.environment['VERTEX_GEMINI_IMAGE_MODEL']?.trim().isNotEmpty ==
                  true
              ? Platform.environment['VERTEX_GEMINI_IMAGE_MODEL']!.trim()
              : 'gemini-2.5-flash-image');

  static int get port =>
      int.tryParse(Platform.environment['PORT'] ?? '') ?? 3002;

  static String get credentialsPath {
    final fromEnv = Platform.environment['GOOGLE_APPLICATION_CREDENTIALS']?.trim();
    if (fromEnv != null && fromEnv.isNotEmpty) return fromEnv;
    return 'service-account.json';
  }

  static String? get newsApiKey {
    for (final k in [
      'NEWSAPI_KEY',
      'REACT_APP_NEWSAPI',
      'NEWSAPI_API_KEY',
    ]) {
      final v = Platform.environment[k]?.trim();
      if (v != null && v.isNotEmpty) return v;
    }
    return null;
  }

  static String? get youtubeApiKey {
    for (final k in ['YOUTUBE_API_KEY', 'REACT_APP_YOUTUBE_API_KEY']) {
      final v = Platform.environment[k]?.trim();
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
      final v = Platform.environment[k]?.trim();
      if (v != null && v.isNotEmpty) return v;
    }
    return '${firestoreProjectId}.appspot.com';
  }

  static String? get openAiApiKey {
    final v = Platform.environment['OPENAI_API_KEY']?.trim();
    if (v != null && v.isNotEmpty) return v;
    return Platform.environment['REACT_APP_OPENAI_API_KEY']?.trim();
  }

  static String get linkedInClientId =>
      Platform.environment['LINKEDIN_CLIENT_ID']?.trim() ?? '';

  static String get linkedInClientSecret =>
      Platform.environment['LINKEDIN_CLIENT_SECRET']?.trim() ?? '';

  static const linkedInRedirectUri =
      'https://deitedatabase.firebaseapp.com/auth/linkedin/callback';

  static List<String> get vertexTextModelFallbacks => [
        vertexModel,
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
        'gemini-1.5-flash-002',
        'gemini-1.5-flash',
      ];
}
