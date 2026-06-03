import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/env.dart';
import '../models/chat_message.dart';
import 'vertex_api_client.dart';

/// Mirrors src/services/emotionalAnalysisService.js
class EmotionalAnalysisService {
  EmotionalAnalysisService._();
  static final EmotionalAnalysisService instance = EmotionalAnalysisService._();

  Future<Map<String, int>> analyzeEmotionalScores(List<ChatMessage> messages) async {
    try {
      final conversationText = messages
          .where((m) => m.text.trim().isNotEmpty)
          .map((m) => '${m.sender == 'user' ? 'User' : 'Assistant'}: ${m.text}')
          .join('\n');
      if (conversationText.trim().isEmpty) return getDefaultScores();

      final prompt = '''Analyze the emotional state from this conversation and provide numerical scores (0-100) for:
- happiness
- energy
- anxiety
- stress

Conversation:
$conversationText

Respond ONLY with JSON: {"happiness":N,"energy":N,"anxiety":N,"stress":N}''';

      String responseText;
      if (isVertexBackendConfigured()) {
        responseText = await vertexGenerateContent(prompt: prompt, temperature: 0.3, maxOutputTokens: 300);
      } else {
        responseText = await _openAiComplete(prompt);
      }

      final match = RegExp(r'\{[\s\S]*\}').firstMatch(responseText);
      if (match != null) {
        final data = jsonDecode(match.group(0)!) as Map<String, dynamic>;
        if (_isValidAnalysisResult(data)) {
          return {
            'happiness': (data['happiness'] as num).round(),
            'energy': (data['energy'] as num).round(),
            'anxiety': (data['anxiety'] as num).round(),
            'stress': (data['stress'] as num).round(),
          };
        }
      }
      return getDefaultScores();
    } catch (_) {
      return getDefaultScores();
    }
  }

  Future<String> _openAiComplete(String prompt) async {
    final key = Env.openAiApiKey.trim();
    if (key.isEmpty) throw Exception('OpenAI key not configured');
    final res = await http.post(
      Uri.parse('https://api.openai.com/v1/chat/completions'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $key',
      },
      body: jsonEncode({
        'model': 'gpt-4o',
        'messages': [
          {'role': 'user', 'content': prompt},
        ],
        'temperature': 0.3,
        'max_tokens': 300,
      }),
    ).timeout(const Duration(seconds: 120));
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    return data['choices']?[0]?['message']?['content'] as String? ?? '';
  }

  bool _isValidAnalysisResult(Map<String, dynamic> result) {
    for (final field in ['happiness', 'energy', 'anxiety', 'stress']) {
      final v = result[field];
      if (v is! num || v < 1 || v > 100) return false;
    }
    return true;
  }

  Map<String, int> getDefaultScores() => {
        'happiness': 50,
        'energy': 50,
        'anxiety': 30,
        'stress': 30,
      };
}

final emotionalAnalysisService = EmotionalAnalysisService.instance;
