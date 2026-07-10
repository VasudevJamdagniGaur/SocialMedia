import 'package:firebase_ai/firebase_ai.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

/// Gemini via Firebase AI Logic (deitedatabase) — no Render / API-key credits required.
class FirebaseGeminiClient {
  FirebaseGeminiClient._();

  static final FirebaseGeminiClient instance = FirebaseGeminiClient._();

  static const List<String> _textModels = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
  ];

  Future<String> generateText({
    required String prompt,
    double temperature = 0.65,
    int maxOutputTokens = 1024,
  }) async {
    final trimmed = prompt.trim();
    if (trimmed.isEmpty) {
      throw ArgumentError('prompt must be non-empty');
    }

    final ai = FirebaseAI.googleAI(auth: FirebaseAuth.instance);
    Object? lastErr;

    for (final modelName in _textModels) {
      try {
        final model = ai.generativeModel(
          model: modelName,
          generationConfig: GenerationConfig(
            temperature: temperature,
            maxOutputTokens: maxOutputTokens,
          ),
        );
        final response = await model.generateContent([Content.text(trimmed)]);
        final text = response.text?.trim() ?? '';
        if (text.isEmpty) {
          throw Exception('Firebase AI ($modelName) returned empty text');
        }
        return text;
      } catch (e) {
        lastErr = e;
        final msg = e.toString().toLowerCase();
        if (msg.contains('not found') || msg.contains('not supported')) {
          debugPrint('[FirebaseGemini] Model $modelName unavailable, trying next');
          continue;
        }
        rethrow;
      }
    }

    throw Exception('Firebase AI text generation failed: $lastErr');
  }
}
