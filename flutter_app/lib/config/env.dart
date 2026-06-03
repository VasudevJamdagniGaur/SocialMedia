/// Compile-time environment configuration via `--dart-define`.
class Env {
  Env._();

  static const String openAiApiKey = String.fromEnvironment('OPENAI_API_KEY');
  static const String grokApiKey = String.fromEnvironment('GROK_API_KEY');
  static const String backendUrl = String.fromEnvironment(
    'BACKEND_URL',
    defaultValue: 'https://detea-backend.onrender.com',
  );
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

  static String get baseUrl =>
      backendUrl.trim().isNotEmpty ? backendUrl.trim() : 'https://detea-backend.onrender.com';
}
