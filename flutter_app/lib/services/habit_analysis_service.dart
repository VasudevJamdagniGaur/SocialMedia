import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../config/env.dart';
import '../utils/date_utils.dart';
import 'firestore_service.dart';

/// Port of `habitAnalysisService.js`.
class HabitAnalysisService {
  HabitAnalysisService._();

  static final HabitAnalysisService instance = HabitAnalysisService._();

  factory HabitAnalysisService() => instance;

  final String _apiKey = Env.openAiApiKey;
  static const String _baseUrl = 'https://api.openai.com/v1';
  static const String _modelName = 'gpt-4o';
  final int minDaysRequired = 1;
  final int minMessagesRequired = 1;

  Future<Map<String, dynamic>> getHabitAnalysis(
    String uid, {
    bool forceRefresh = false,
  }) async {
    debugPrint('ðŸ” Getting habit analysis... uid=$uid forceRefresh=$forceRefresh');
    try {
      if (!forceRefresh) {
        const cacheKeyPrefix = 'habit_analysis_';
        final prefs = await SharedPreferences.getInstance();
        final cachedData = prefs.getString('$cacheKeyPrefix$uid');
        if (cachedData != null) {
          final parsed = jsonDecode(cachedData) as Map<String, dynamic>;
          final age = DateTime.now().millisecondsSinceEpoch -
              ((parsed['timestamp'] as num?)?.toInt() ?? 0);
          if (age < 24 * 60 * 60 * 1000) {
            debugPrint('âœ… Using cached habit analysis');
            return Map<String, dynamic>.from(
              parsed['analysis'] as Map? ?? {},
            );
          }
        }
      }

      final analysis = await analyzeHabits(uid);

      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        'habit_analysis_$uid',
        jsonEncode({'analysis': analysis, 'timestamp': DateTime.now().millisecondsSinceEpoch}),
      );

      return analysis;
    } catch (error) {
      debugPrint('âŒ Error getting habit analysis: $error');
      return getDefaultHabitAnalysis();
    }
  }

  Future<Map<String, dynamic>> analyzeHabits(String uid) async {
    debugPrint('ðŸ” Starting habit analysis for 3 months...');
    try {
      final chatData = await getChatData(uid, 90);
      if (!hasEnoughData(chatData)) {
        debugPrint('âš ï¸ Not enough data for habit analysis');
        return getDefaultHabitAnalysis();
      }
      return await performHabitAnalysis(chatData);
    } catch (error) {
      debugPrint('âŒ Error in habit analysis: $error');
      return getDefaultHabitAnalysis();
    }
  }

  Future<Map<String, dynamic>> performHabitAnalysis(
    List<Map<String, dynamic>> chatData,
  ) async {
    debugPrint('ðŸ¤– Performing AI habit analysis on 3 months of chat data...');
    try {
      final conversationContext = chatData.map((day) {
        final messages = day['messages'] as List? ?? [];
        final messageTexts = messages
            .map((msg) {
              final m = msg as Map;
              return '${m['sender']}: ${m['text']}';
            })
            .join('\n');
        return '${day['date']}: $messageTexts';
      }).join('\n\n');

      const habitAnalysisPromptPrefix = '''You are an AI habit and pattern analyzer. Analyze the following conversation data to identify habits, patterns, and insights that can help improve emotional well-being.

## Your Task:
Analyze 3 months of conversation data to identify:
1. **Habits** - Specific, actionable habits that address recurring challenges
2. **Patterns** - Emotional triggers, struggles, and positive behaviors
3. **Insights** - Key challenges, emotional cycles, and opportunities

## Conversation Data:
''';

      const habitAnalysisPromptSuffix = '''

## Response Format:
Return a JSON object with this exact structure:

{
  "habits": [
    {
      "title": "Specific habit name",
      "description": "Clear, actionable description of what to do",
      "why": "Specific reason based on their patterns (e.g., 'You mentioned work stress 15 times in the last 3 months')",
      "frequency": "How often to do it (e.g., 'Daily', '3x per week', 'When feeling anxious')",
      "category": "stress_management|sleep|social|productivity|self_care|mindfulness"
    },
    {
      "title": "Second specific habit",
      "description": "Clear, actionable description",
      "why": "Specific reason based on their patterns",
      "frequency": "How often to do it",
      "category": "stress_management|sleep|social|productivity|self_care|mindfulness"
    },
    {
      "title": "Third specific habit",
      "description": "Clear, actionable description",
      "why": "Specific reason based on their patterns",
      "frequency": "How often to do it",
      "category": "stress_management|sleep|social|productivity|self_care|mindfulness"
    }
  ],
  "patterns": {
    "topStruggles": ["struggle1", "struggle2", "struggle3"],
    "emotionalTriggers": ["trigger1", "trigger2", "trigger3"],
    "positiveBehaviors": ["behavior1", "behavior2", "behavior3"]
  },
  "insights": {
    "mainChallenge": "Primary recurring challenge identified",
    "emotionalCycle": "How their emotions typically cycle",
    "keyOpportunity": "Biggest opportunity for improvement"
  }
}

IMPORTANT: 
- Maximum 3 habits, each addressing a different category
- Each habit must be based on SPECIFIC evidence from their conversations
- Be concrete and actionable, not abstract
- Focus on habits that will have the biggest impact on their most frequent struggles''';

      final habitAnalysisPrompt =
          '$habitAnalysisPromptPrefix$conversationContext$habitAnalysisPromptSuffix';

      final apiUrl = '$_baseUrl/chat/completions';
      final client = http.Client();
      try {
        final response = await client
            .post(
              Uri.parse(apiUrl),
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer $_apiKey',
              },
              body: jsonEncode({
                'model': _modelName,
                'messages': [
                  {'role': 'user', 'content': habitAnalysisPrompt},
                ],
                'temperature': 0.3,
                'max_tokens': 1000,
              }),
            )
            .timeout(const Duration(seconds: 120));

        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw Exception(
            'OpenAI API error: ${response.statusCode} ${response.body}',
          );
        }

        final data = jsonDecode(response.body) as Map<String, dynamic>;
        var responseText = '';
        final choices = data['choices'];
        if (choices is List &&
            choices.isNotEmpty &&
            choices[0] is Map &&
            choices[0]['message'] is Map) {
          responseText = choices[0]['message']['content'] as String? ?? '';
        }

        if (responseText.isNotEmpty) {
          return parseHabitAnalysisResult(responseText);
        }
        throw Exception('Invalid response format from API');
      } finally {
        client.close();
      }
    } catch (error) {
      debugPrint('âŒ Error in AI habit analysis: $error');
      return getDefaultHabitAnalysis();
    }
  }

  Future<List<Map<String, dynamic>>> getChatData(String uid, int days) async {
    final chatData = <Map<String, dynamic>>[];
    for (var i = 0; i < days; i++) {
      final dateId = getDateIdDaysAgo(i);
      final dayData = await FirestoreService.instance.getChatMessages(uid, dateId);
      if (dayData.isNotEmpty) {
        chatData.add({'date': dateId, 'messages': dayData});
      }
    }
    return chatData;
  }

  bool hasEnoughData(List<Map<String, dynamic>> chatData) {
    final totalMessages = chatData.fold<int>(
      0,
      (sum, day) => sum + ((day['messages'] as List?)?.length ?? 0),
    );
    final daysWithData = chatData.length;
    return daysWithData >= minDaysRequired && totalMessages >= minMessagesRequired;
  }

  Map<String, dynamic> getDefaultHabitAnalysis() {
    return {
      'habits': [
        {
          'title': 'Daily Reflection',
          'description': 'Take 5 minutes each evening to reflect on your day',
          'why': 'Regular reflection helps process emotions and identify patterns',
          'frequency': 'Daily',
          'category': 'mindfulness',
        },
        {
          'title': 'Stress Management',
          'description': 'Practice deep breathing when feeling overwhelmed',
          'why': 'Helps manage stress and anxiety in the moment',
          'frequency': 'When feeling stressed',
          'category': 'stress_management',
        },
        {
          'title': 'Gratitude Practice',
          'description': "Write down three things you're grateful for each day",
          'why': 'Focuses attention on positive aspects of life',
          'frequency': 'Daily',
          'category': 'self_care',
        },
      ],
      'patterns': {
        'topStruggles': ['Work stress', 'Time management', 'Self-doubt'],
        'emotionalTriggers': ['Deadlines', 'Criticism', 'Uncertainty'],
        'positiveBehaviors': [
          'Problem-solving',
          'Seeking support',
          'Learning new things',
        ],
      },
      'insights': {
        'mainChallenge': 'Balancing work demands with personal well-being',
        'emotionalCycle':
            'Stress builds up during work, relief comes from personal activities',
        'keyOpportunity': 'Developing consistent stress management routines',
      },
    };
  }

  Map<String, dynamic> parseHabitAnalysisResult(String responseText) {
    try {
      final jsonMatch = RegExp(r'\{[\s\S]*\}').firstMatch(responseText);
      if (jsonMatch != null) {
        return jsonDecode(jsonMatch.group(0)!) as Map<String, dynamic>;
      }
    } catch (error) {
      debugPrint('âŒ Error parsing habit analysis result: $error');
    }
    return getDefaultHabitAnalysis();
  }
}

final habitAnalysisService = HabitAnalysisService.instance;
