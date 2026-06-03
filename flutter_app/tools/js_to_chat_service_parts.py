#!/usr/bin/env python3
"""Convert chatService.js to 4 Dart part files for Flutter."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JS = ROOT.parent / "src" / "services" / "chatService.js"
OUT_DIR = ROOT / "lib" / "services" / "chat_service_parts"

# Method start lines (1-based from grep) — split boundaries
PART1_END = 948   # through analyzeImageWithVision
PART2_START = 950
PART2_END = 1869  # through generateSocialPostSuggestionsStream
PART3_START = 1881
PART3_END = 2940  # through rewriteNewsHeadlines
PART4_START = 2949

PART1_HEADER = r'''import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../config/env.dart';
import '../utils/date_utils.dart';
import '../utils/decode_google_news_url.dart';
import '../models/chat_message.dart';
import 'auth_service.dart';
import 'firestore_service.dart';
import 'vertex_api_client.dart';

typedef ApiProvider = String; // openai | gemini | grok
typedef ShareSuggestion = Map<String, String>;

/// Mirrors src/services/chatService.js — multi-provider AI chat.
class ChatService extends ChangeNotifier {
  ChatService._();
  static final ChatService instance = ChatService._();

  ApiProvider _apiProvider = 'openai';
  ApiProvider get apiProvider => _apiProvider;

  static const _openaiBaseUrl = 'https://api.openai.com/v1';
  static const _grokBaseUrl = 'https://api.x.ai/v1';
  static const _openaiModelName = 'gpt-4o';
  static const _grokModelName = 'grok-3';
  static const _visionModelName = 'gpt-4o';
  static const _providerKey = 'chat_api_provider';

  String? get _openAiKey =>
      Env.openAiApiKey.trim().isNotEmpty ? Env.openAiApiKey.trim() : null;
  String? get _grokKey =>
      Env.grokApiKey.trim().isNotEmpty ? Env.grokApiKey.trim() : null;

  bool get _vertexForGemini =>
      _apiProvider == 'gemini' && isVertexBackendConfigured();

  Future<void> loadSavedProvider() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_providerKey) ?? 'openai';
    setApiProvider(saved);
  }

  void setApiProvider(String provider) {
    if (provider == 'openai' || provider == 'gemini' || provider == 'grok') {
      _apiProvider = provider;
      debugPrint('🔄 API Provider switched to: $provider');
      notifyListeners();
    } else {
      debugPrint('⚠️ Invalid API provider: $provider');
    }
  }

  Future<void> persistProvider(String provider) async {
    setApiProvider(provider);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_providerKey, provider);
  }

  String _nextProvider() {
    switch (_apiProvider) {
      case 'openai':
        return 'gemini';
      case 'gemini':
        return 'grok';
      default:
        return 'openai';
    }
  }

  Future<String> cycleProvider() async {
    final next = _nextProvider();
    await persistProvider(next);
    return next;
  }

  String? getApiKey() {
    if (_apiProvider == 'openai') return _openAiKey;
    if (_apiProvider == 'gemini') return '';
    if (_apiProvider == 'grok') return _grokKey;
    return _openAiKey;
  }

  String getBaseURL() {
    if (_apiProvider == 'openai') return _openaiBaseUrl;
    if (_apiProvider == 'gemini') return getVertexBackendBaseUrl();
    if (_apiProvider == 'grok') return _grokBaseUrl;
    return _openaiBaseUrl;
  }

  String getModelName() {
    if (_apiProvider == 'openai') return _openaiModelName;
    if (_apiProvider == 'gemini') return 'vertex-backend';
    if (_apiProvider == 'grok') return _grokModelName;
    return _openaiModelName;
  }

  String getVertexGeminiUrl() => getVertexBackendBaseUrl();

  Future<String> callVertexGenerateContent({
    required String prompt,
    double temperature = 0.65,
    int maxOutputTokens = 1024,
  }) =>
      vertexGenerateContent(
        prompt: prompt,
        temperature: temperature,
        maxOutputTokens: maxOutputTokens,
      );

'''


def read_js_lines() -> list[str]:
    return JS.read_text(encoding="utf-8").splitlines()


def extract_class_body(lines: list[str], start: int, end: int) -> str:
    """Extract lines start..end (1-based inclusive) from class body."""
    chunk = lines[start - 1 : end]
    return "\n".join(chunk)


def js_method_to_dart(js: str) -> str:
    """Best-effort JS method body -> Dart."""
    s = js

    # Remove JSDoc blocks
    s = re.sub(r"/\*\*[\s\S]*?\*/", "", s)

    # async methodName( -> Future<...> methodName(
    s = re.sub(
        r"async\s+(_?[a-zA-Z][a-zA-Z0-9_]*)\s*\(",
        lambda m: f"Future<dynamic> {m.group(1)}(",
        s,
    )
    s = re.sub(
        r"^\s*(_?[a-zA-Z][a-zA-Z0-9_]*)\s*\(",
        lambda m: f"{m.group(1)}(" if m.group(1).startswith("_") or m.group(1)[0].islower() else m.group(0),
        s,
        flags=re.MULTILINE,
    )

    # this. -> empty for instance methods
    s = re.sub(r"\bthis\.", "", s)

    # console.log/warn/error -> debugPrint
    s = re.sub(r"console\.(log|warn|error)\(", "debugPrint(", s)

    # process.env keys
    s = s.replace("process.env.REACT_APP_OPENAI_API_KEY", "Env.openAiApiKey")
    s = s.replace("process.env.OPENAI_API_KEY", "Env.openAiApiKey")
    s = s.replace("process.env.REACT_APP_GROK_API_KEY", "Env.grokApiKey")
    s = s.replace("process.env.GROK_API_KEY", "Env.grokApiKey")

    # API key fields
    s = re.sub(r"\bopenaiApiKey\b", "_openAiKey ?? ''", s)
    s = re.sub(r"\bgrokApiKey\b", "_grokKey ?? ''", s)
    s = re.sub(r"\bopenaiBaseURL\b", "_openaiBaseUrl", s)
    s = re.sub(r"\bgrokBaseURL\b", "_grokBaseUrl", s)
    s = re.sub(r"\bopenaiModelName\b", "_openaiModelName", s)
    s = re.sub(r"\bgrokModelName\b", "_grokModelName", s)
    s = re.sub(r"\bvisionModelName\b", "_visionModelName", s)
    s = re.sub(r"\bapiProvider\b", "_apiProvider", s)

    # Services
    s = re.sub(r"\bgetCurrentUser\(\)", "AuthService.instance.getCurrentUser()", s)
    s = re.sub(r"\bfirestoreService\.", "FirestoreService.instance.", s)
    s = re.sub(r"\bgetDateId\(", "getDateId(", s)

    # typeof checks
    s = re.sub(r"typeof\s+(\w+)\s*===\s*'string'", r"\1 is String", s)
    s = re.sub(r"typeof\s+(\w+)\s*===\s*'number'", r"\1 is num", s)
    s = re.sub(r"typeof\s+(\w+)\s*===\s*'function'", r"\1 != null", s)

    # null/undefined
    s = re.sub(r"\bundefined\b", "null", s)
    s = re.sub(r"===\s*null", "== null", s)
    s = re.sub(r"!==\s*null", "!= null", s)
    s = re.sub(r"===", "==", s)
    s = re.sub(r"!==", "!=", s)

    # JSON
    s = re.sub(r"JSON\.parse\(", "jsonDecode(", s)
    s = re.sub(r"JSON\.stringify\(", "jsonEncode(", s)

    # encodeURIComponent
    s = re.sub(r"encodeURIComponent\(", "Uri.encodeComponent(", s)

    # Array.isArray
    s = re.sub(r"Array\.isArray\(([^)]+)\)", r"\1 is List", s)

    # let/const -> var/final
    s = re.sub(r"\blet\s+", "var ", s)
    s = re.sub(r"\bconst\s+", "final ", s)

    # Optional chaining rough fix
    s = re.sub(r"(\w+)\?\.(\w+)", r"\1?.\2", s)

    # localStorage -> SharedPreferences placeholder (handled manually in key spots)
    s = s.replace("localStorage.getItem('chat_api_provider')", "null /* prefs */")
    s = s.replace("localStorage.getItem", "_prefsGetString")
    s = s.replace("localStorage.setItem", "_prefsSetString")

    # window.location
    s = re.sub(
        r"typeof window !== 'undefined' && window\.location\?\.origin \? window\.location\.origin : ''",
        "''",
        s,
    )

    # fetch -> _httpFetch placeholder
    s = re.sub(r"\bfetch\(", "_httpFetch(", s)

    # void referenceImage
    s = re.sub(r"\bvoid\s+(\w+);", r"// ignore \1", s)

    return s


def main() -> None:
    if not JS.exists():
        raise SystemExit(f"Missing JS source: {JS}")

    lines = read_js_lines()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # For reliability, emit hand-crafted Dart from known JS line ranges via embedded port modules.
    # The full port is loaded from pre-generated dart snippets written alongside this script.
    snippets = Path(__file__).with_name("chat_service_snippets")
    if snippets.exists():
        for i in range(1, 5):
            src = snippets / f"part{i}.dart"
            if src.exists():
                (OUT_DIR / f"part{i}.dart").write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"Copied snippets to {OUT_DIR}")
        return

    raise SystemExit(
        "Snippets not found. Run with embedded generator or provide chat_service_snippets/part*.dart"
    )


if __name__ == "__main__":
    main()
