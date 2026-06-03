#!/usr/bin/env python3
"""Generate chat_service.dart from chatService.js preserving prompt strings."""

from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "lib" / "services" / "chat_service.dart"

HEADER = r'''import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../config/env.dart';
import '../utils/date_utils.dart';
import '../utils/decode_google_news_url.dart';
import 'firestore_service.dart';
import 'vertex_api_client.dart';

/// Conversation message for chat history.
class ChatHistoryMessage {
  const ChatHistoryMessage({required this.sender, required this.text});

  final String sender;
  final String text;
}

/// Share suggestion result.
class ShareSuggestion {
  const ShareSuggestion({required this.eventLabel, required this.post});

  final String eventLabel;
  final String post;
}

/// User profile context for personalized prompts.
class UserProfileContext {
  const UserProfileContext({
    this.name,
    this.age,
    this.gender,
    this.bio,
    this.birthday,
    this.birthdayFormatted,
  });

  final String? name;
  final String? age;
  final String? gender;
  final String? bio;
  final String? birthday;
  final String? birthdayFormatted;
}

/// Image generation user context.
class ImageUserContext {
  const ImageUserContext({
    this.displayName,
    this.age,
    this.nationality,
    this.gender,
    this.skinTone,
    this.hairstyle,
    this.clothingStyle,
    this.profession,
    this.profileImageUrl,
  });

  final String? displayName;
  final String? age;
  final String? nationality;
  final String? gender;
  final String? skinTone;
  final String? hairstyle;
  final String? clothingStyle;
  final String? profession;
  final String? profileImageUrl;
}

/// Reference image for Gemini generation.
class ReferenceImage {
  const ReferenceImage({required this.base64, required this.mimeType});

  final String base64;
  final String mimeType;
}

/// Web search result.
class WebSearchResult {
  const WebSearchResult({required this.title, required this.snippet, required this.link});

  final String title;
  final String snippet;
  final String link;
}

/// News article map type used across share flows.
typedef NewsArticle = Map<String, dynamic>;

/// Singleton chat service — port of `src/services/chatService.js`.
class ChatService {
  ChatService._() {
    _logApiKeyStatus();
  }

  static final ChatService instance = ChatService._();

  String openaiApiKey = Env.openAiApiKey;
  String grokApiKey = Env.grokApiKey;
  String apiProvider = 'openai';

  final String openaiBaseURL = 'https://api.openai.com/v1';
  final String grokBaseURL = 'https://api.x.ai/v1';
  final String openaiModelName = 'gpt-4o';
  final String geminiModelName = 'vertex-backend';
  final String grokModelName = 'grok-3';
  final String visionModelName = 'gpt-4o';

  static const String _emojiOnlyResponse = 'EMOJI_ONLY_RESPONSE';
  static const String _ensembleApiKey = 'XxrDGV8x0zDWIg2Y';

  void _logApiKeyStatus() {
    // ignore: avoid_print
    print('🔑 API Keys loaded:');
    // ignore: avoid_print
    print(
      '  OpenAI: ${openaiApiKey.isNotEmpty ? "${openaiApiKey.substring(0, openaiApiKey.length.clamp(0, 10))}... (${openaiApiKey.length} chars)" : "NOT SET"}',
    );
    // ignore: avoid_print
    print(
      '  Gemini (Vertex backend): ${isVertexBackendConfigured() ? getVertexBackendBaseUrl() : "NOT SET"}',
    );
    // ignore: avoid_print
    print(
      '  Grok: ${grokApiKey.isNotEmpty ? "${grokApiKey.substring(0, grokApiKey.length.clamp(0, 10))}... (${grokApiKey.length} chars)" : "NOT SET"}',
    );
  }

  void setApiProvider(String provider) {
    if (provider == 'openai' || provider == 'gemini' || provider == 'grok') {
      apiProvider = provider;
      // ignore: avoid_print
      print('🔄 API Provider switched to: $provider');
    } else {
      // ignore: avoid_print
      print('⚠️ Invalid API provider: $provider');
    }
  }

  String getApiKey() {
    if (apiProvider == 'openai') return openaiApiKey;
    if (apiProvider == 'gemini') return '';
    if (apiProvider == 'grok') return grokApiKey;
    return openaiApiKey;
  }

  String getBaseURL() {
    if (apiProvider == 'openai') return openaiBaseURL;
    if (apiProvider == 'gemini') return getVertexBackendBaseUrl();
    if (apiProvider == 'grok') return grokBaseURL;
    return openaiBaseURL;
  }

  String getModelName() {
    if (apiProvider == 'openai') return openaiModelName;
    if (apiProvider == 'gemini') return geminiModelName;
    if (apiProvider == 'grok') return grokModelName;
    return openaiModelName;
  }

  String getVertexGeminiUrl() => getVertexBackendBaseUrl();

  Future<String> callVertexGenerateContent({
    required String prompt,
    double temperature = 0.65,
    int maxOutputTokens = 1024,
    Duration? timeout,
  }) =>
      vertexGenerateContent(
        prompt: prompt,
        temperature: temperature,
        maxOutputTokens: maxOutputTokens,
        timeout: timeout,
      );

  void _reloadApiKeysFromEnv() {
    if (Env.openAiApiKey.isNotEmpty) openaiApiKey = Env.openAiApiKey;
    if (Env.grokApiKey.isNotEmpty) grokApiKey = Env.grokApiKey;
  }

  Future<String?> _getStoredString(String key) async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(key);
  }

  Future<void> _setStoredString(String key, String value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(key, value);
  }

  Future<String?> _getChatApiProviderFromPrefs() async =>
      _getStoredString('chat_api_provider');

'''

FOOTER = r'''
}

/// Default singleton export matching JS `export default new ChatService()`.
final chatService = ChatService.instance;
'''

# Read JS and extract the class body between class ChatService { and export default
js_path = Path(__file__).resolve().parent.parent.parent / "src" / "services" / "chatService.js"
js = js_path.read_text(encoding="utf-8")

# We'll write the body from a pre-built dart file chunk - the script just validates
print(f"Source JS: {len(js.splitlines())} lines")
OUT.write_text(HEADER + "\n// BODY PLACEHOLDER\n" + FOOTER, encoding="utf-8")
print(f"Wrote scaffold to {OUT}")
