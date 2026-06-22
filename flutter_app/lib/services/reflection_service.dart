import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../config/env.dart';
import '../utils/date_utils.dart';
import 'firestore_result.dart';
import 'firestore_service.dart';

/// Port of `reflectionService.js`.
class ReflectionService {
  ReflectionService._();

  static final ReflectionService instance = ReflectionService._();

  factory ReflectionService() => instance;

  static const _greetings = [
    'hey',
    'hi',
    'hello',
    'hii',
    'hiii',
    'hiiii',
    'sup',
    'yo',
    "what's up",
    'wassup',
  ];

  static const _baseUrl = 'https://api.openai.com/v1';
  static const _modelName = 'gpt-4o';

  bool isSimpleGreeting(String message) {
    final cleanMsg = message.toLowerCase().trim();
    return _greetings.any(
      (greeting) =>
          cleanMsg == greeting ||
          cleanMsg == '$greeting!' ||
          cleanMsg == '$greeting.',
    );
  }

  Future<String> generateReflection(List<dynamic> messages) async {
    if (messages.isEmpty) {
      return "Had a brief chat with SociTea today.";
    }

    final userMessages = _extractUserMessages(messages);
    final aiMessages = _extractAiMessages(messages);

    if (userMessages.isEmpty) {
      return "Had a brief chat with SociTea today but didn't share much.";
    }

    try {
      return await generateAiSummary(userMessages, aiMessages);
    } catch (err) {
      debugPrint('âš ï¸ Reflection generation via API failed: $err');
      return createFallbackSummary(userMessages, aiMessages);
    }
  }

  Future<String> generateAiSummary(
    List<String> userMessages,
    List<String> aiMessages,
  ) async {
    final conversationContext = buildConversationContext(userMessages, aiMessages);
    final userCharacterCount =
        userMessages.fold<int>(0, (total, msg) => total + msg.length);
    final maxReflectionCharacters = userCharacterCount * 2;
    final totalMessages = userMessages.length;
    final estimatedMaxTokensFromChars = maxReflectionCharacters ~/ 3;

    late String sizeInstructions;
    late int maxTokens;
    if (totalMessages <= 3) {
      sizeInstructions =
          '14. REFLECTION LENGTH - CRITICAL: Write ONLY 2-3 sentences maximum. Keep it very short and concise.';
      maxTokens = [100, estimatedMaxTokensFromChars].reduce((a, b) => a < b ? a : b);
    } else if (totalMessages <= 7) {
      sizeInstructions =
          '14. REFLECTION LENGTH - Write a short reflection (3-4 sentences maximum). Keep it concise.';
      maxTokens = [150, estimatedMaxTokensFromChars].reduce((a, b) => a < b ? a : b);
    } else if (totalMessages <= 15) {
      sizeInstructions =
          '14. REFLECTION LENGTH - Write a medium reflection (4-5 sentences maximum). Still keep it concise.';
      maxTokens = [200, estimatedMaxTokensFromChars].reduce((a, b) => a < b ? a : b);
    } else {
      sizeInstructions =
          '14. REFLECTION LENGTH - Write a slightly longer reflection (5-6 sentences maximum). Keep it concise and focused.';
      maxTokens = [250, estimatedMaxTokensFromChars].reduce((a, b) => a < b ? a : b);
    }

    final characterLimitInstruction =
        '16. CHARACTER LIMIT - CRITICAL: The reflection must NEVER exceed $maxReflectionCharacters characters (which is 2x the $userCharacterCount characters the user wrote). Always stay within this strict limit.';

    final reflectionPrompt = '''Write a natural, first-person diary entry about this day. Tell the story of what happened and how it felt.

CRITICAL REQUIREMENTS:
1. WRITE IN FIRST PERSON - Use "I", "my", "me" - this is a personal diary entry
2. NO META-COMMENTARY - Do NOT say "Here is a diary entry" or "summarizing the day" or mention "user" - just tell the story directly
3. FOCUS ON WHAT HAPPENED - Write about the actual events, conversations, and experiences from the day
4. CAPTURE THE FEELING - Include emotions and how things felt, but naturally woven into the story
5. BE SPECIFIC - Mention real events, people, or activities that were discussed
6. NATURAL STORYTELLING - Write like someone naturally reflecting on their day, not like an analysis or summary
7. USE AS LITTLE TIME/SPACE AS APPROPRIATE - Keep it concise, focus on what matters most
8. NO REPEATED "SOCITEA SAID..." - Do NOT repeatedly say "SociTea said..." or "SociTea told me..." - just mention what was discussed naturally
9. NO "SOCITEA ASKED ME..." - Do NOT say "SociTea asked me..." - just write about the topics naturally
10. NO LONG DESCRIPTIONS OF SOCITEA'S ACTIONS - Do NOT write long descriptions of what SociTea did or how SociTea responded - focus on YOUR experience and reflections
11. FEEL LIKE A PERSONAL REFLECTION - The diary should feel natural and personal, like you're reflecting on your own day, not describing an AI conversation
12. AVOID DRAMATIC LINES - Do NOT use overly dramatic phrases like "It was crazy", "it gave me all the feels", "it was absolutely amazing", etc. UNLESS something truly extraordinary or life-changing happened. Keep the tone grounded and realistic - avoid too much dramatic storytelling for ordinary days.
13. NO REFLECTIVE CLOSING SENTENCES - Do NOT include reflective or moral closing sentences such as "it lifted my mood", "it made me feel seen", "it reminded me of something", "it was a good day", "it helped me realize", etc. End the diary naturally after describing the events or thoughts of the day, without summarizing emotions or giving life lessons. Just describe what happened and stop - no need to wrap it up with emotional conclusions.
14. NO POSITIVITY ABOUT TALKING TO SOCITEA - Do NOT add statements like "talking to SociTea made me feel better", "chatting with SociTea helped", "SociTea made me feel", or any positive statements about the conversation itself. ONLY summarize what the user expressed and how their day emotionally felt - do NOT comment on the conversation or its effects.
15. ONLY SUMMARIZE USER'S EXPRESSION - Focus ONLY on summarizing what the user expressed in their messages and how their day emotionally felt. Do NOT add commentary about the conversation, SociTea's responses, or how talking to SociTea affected them.
$sizeInstructions
$characterLimitInstruction

Conversation with SociTea:
$conversationContext

Write a natural diary entry about this day in first person. Just tell the story of what happened and how it felt. Focus ONLY on summarizing what the user expressed and how their day emotionally felt. Do NOT add any statements about talking to SociTea, how SociTea helped, or how the conversation made you feel. Keep it grounded and realistic, avoiding dramatic language unless something truly extraordinary happened. End naturally after describing events - do NOT add reflective closing sentences about how things made you feel or what you learned.

CRITICAL: The reflection must NEVER exceed $maxReflectionCharacters characters (2x the $userCharacterCount characters the user wrote). Always stay within this strict character limit.''';

    var summary = await _openAiComplete(reflectionPrompt, maxTokens: maxTokens, temperature: 0.5);
    if (summary.length > maxReflectionCharacters) {
      summary = summary.substring(0, maxReflectionCharacters);
      final lastSentenceEnd = [
        summary.lastIndexOf('.'),
        summary.lastIndexOf('!'),
        summary.lastIndexOf('?'),
      ].reduce((a, b) => a > b ? a : b);
      if (lastSentenceEnd > maxReflectionCharacters * 0.7) {
        summary = summary.substring(0, lastSentenceEnd + 1);
      }
    }
    return summary.trim();
  }

  String createFallbackSummary(List<String> userMessages, List<String> aiMessages) {
    final lastUser = userMessages.isNotEmpty ? userMessages.last : '';
    final firstUser = userMessages.isNotEmpty ? userMessages.first : '';
    final base = firstUser != lastUser ? '$firstUser ... $lastUser' : lastUser;
    final trimmed = base.length > 220 ? '${base.substring(0, 220)}...' : base;
    return 'Today I chatted with SociTea about: "$trimmed". It was nice to talk through my day and get some perspective.';
  }

  String buildConversationContext(
    List<String> userMessages,
    List<String> aiMessages,
  ) {
    final buf = StringBuffer();
    for (var i = 0; i < userMessages.length; i++) {
      buf.writeln('User: "${userMessages[i]}"');
      if (i < aiMessages.length) {
        final aiResponse = aiMessages[i];
        final truncated = aiResponse.length > 300 ? aiResponse.substring(0, 300) : aiResponse;
        buf.writeln(
          'SociTea: "$truncated${aiResponse.length > 300 ? '...' : ''}"',
        );
        buf.writeln();
      }
    }
    if (buf.isNotEmpty) {
      buf.writeln('---');
      buf.writeln('Please analyze this conversation carefully and identify:');
      buf.writeln('1. Key events or topics discussed (loss, grief, achievements, challenges, etc.)');
      buf.writeln('2. Emotional tone (sad, grieving, happy, stressed, anxious, etc.)');
      buf.writeln('3. Important details that should be reflected in the diary entry');
    }
    return buf.toString().trim();
  }

  Future<String> generateNarrativeDiaryStory(List<dynamic> messages) async {
    if (messages.isEmpty) {
      return 'Today was a day like any other, filled with small moments and quiet thoughts.';
    }

    final userMessages = _extractUserMessages(messages);
    final aiMessages = _extractAiMessages(messages);

    if (userMessages.isEmpty) {
      return 'Today unfolded quietly, a gentle day where thoughts drifted like clouds across a calm sky.';
    }

    try {
      return await generateAiNarrativeStory(userMessages, aiMessages);
    } catch (err) {
      debugPrint('âš ï¸ Narrative story generation via API failed: $err');
      return createFallbackNarrative(userMessages, aiMessages);
    }
  }

  Future<String> generateAiNarrativeStory(
    List<String> userMessages,
    List<String> aiMessages,
  ) async {
    final conversationContext = buildConversationContext(userMessages, aiMessages);
    final totalMessages = userMessages.length + aiMessages.length;
    final estimatedTopics = (totalMessages / 3).ceil().clamp(1, 5);

    late int maxTokens;
    late String sentenceGuidance;
    if (totalMessages <= 3) {
      maxTokens = 80;
      sentenceGuidance = '1-2 sentences';
    } else if (totalMessages <= 6) {
      maxTokens = 120;
      sentenceGuidance = '2 sentences';
    } else if (totalMessages <= 10) {
      maxTokens = 150;
      sentenceGuidance = '2-3 sentences';
    } else if (totalMessages <= 15) {
      maxTokens = 180;
      sentenceGuidance = '3 sentences';
    } else {
      maxTokens = 200;
      sentenceGuidance = '3-4 sentences';
    }

    final narrativePrompt = '''Write a SHORT, natural, first-person diary entry about this day. Keep it brief and concise - mention all key topics but don't elaborate too much.

CRITICAL REQUIREMENTS:
1. WRITE IN FIRST PERSON - Use "I", "my", "me" - this is a personal diary entry
2. NO META-COMMENTARY - Do NOT say "Here is a diary entry" or "summarizing the day" or mention "user" or "person" - just tell the story directly
3. NO ANALYSIS - Do NOT add analysis sections, bullet points, lists, or explanations - ONLY tell the story
4. BE BRIEF - Write $sentenceGuidance maximum. Keep it short and concise. Use as little time/space as appropriate - focus on what matters most.
5. COVER ALL TOPICS - Briefly mention the key events, conversations, or experiences discussed (about $estimatedTopics main topics)
6. INCLUDE EMOTIONS - Naturally weave in how things felt (sad, happy, excited, etc.) without being explicit about it
7. NATURAL STORYTELLING - Write like someone naturally reflecting on their day in a brief way
8. BE SPECIFIC BUT CONCISE - Mention real events, people, or activities, but keep descriptions brief
9. NO REPEATED "SOCITEA SAID..." - Do NOT repeatedly say "SociTea said..." or "SociTea told me..." - just mention what was discussed naturally
10. NO "SOCITEA ASKED ME..." - Do NOT say "SociTea asked me..." - just write about the topics naturally
11. NO LONG DESCRIPTIONS OF SOCITEA'S ACTIONS - Do NOT write long descriptions of what SociTea did or how SociTea responded - focus on YOUR experience and reflections
12. FEEL LIKE A PERSONAL REFLECTION - The diary should feel natural and personal, like you're reflecting on your own day, not describing an AI conversation
13. AVOID DRAMATIC LINES - Do NOT use overly dramatic phrases unless something truly extraordinary happened
14. NO REFLECTIVE CLOSING SENTENCES - End naturally after describing events

Conversation with SociTea:
$conversationContext

Write a SHORT, natural diary entry about this day in first person. Write $sentenceGuidance maximum, briefly covering all key topics and emotions.''';

    return _openAiComplete(narrativePrompt, maxTokens: maxTokens, temperature: 0.7);
  }

  String createFallbackNarrative(List<String> userMessages, List<String> aiMessages) {
    final lastUser = userMessages.isNotEmpty ? userMessages.last : '';
    final firstUser = userMessages.isNotEmpty ? userMessages.first : '';
    final combined = firstUser != lastUser ? '$firstUser ... $lastUser' : lastUser;
    final trimmed = combined.length > 200 ? '${combined.substring(0, 200)}...' : combined;
    return 'Today I found myself reflecting on $trimmed. It was a day that brought its own rhythm, its own quiet moments of thought and conversation.';
  }

  Future<Map<String, dynamic>> saveReflection(
    String userId,
    String dateId,
    String reflection,
  ) async {
    try {
      final analysis = analyzeReflection(reflection);
      final reflectionData = {
        'summary': reflection,
        'mood': analysis['mood'].toString().toLowerCase(),
        'score': analysis['score'],
        'insights': analysis['insights'],
        'source': 'auto',
      };
      final result = await FirestoreService.instance.saveReflectionNew(
        userId,
        dateId,
        reflectionData,
      );
      await saveReflectionToLocalStorage(dateId, reflection);
      return result;
    } catch (error) {
      debugPrint('âŒ Error saving reflection: $error');
      await saveReflectionToLocalStorage(dateId, reflection);
      return {'success': true};
    }
  }

  Future<void> saveReflectionLocal(String dateId, String text) async {
    await saveReflectionToLocalStorage(dateId, text);
  }

  Future<ReflectionResult> getReflection(String userId, String dateId) async {
    try {
      final result = await FirestoreService.instance.getReflectionNew(userId, dateId);
      if (result.success && result.reflection != null) {
        return result.toReflectionResult();
      }
      final localReflection = await getReflectionFromLocalStorage(dateId);
      if (localReflection.isNotEmpty) {
        return ReflectionResult(success: true, reflection: localReflection);
      }
      return ReflectionResult(success: true, reflection: null);
    } catch (error) {
      final localReflection = await getReflectionFromLocalStorage(dateId);
      return ReflectionResult(
        success: true,
        reflection: localReflection.isEmpty ? null : localReflection,
      );
    }
  }

  Map<String, dynamic> analyzeReflection(String reflection) {
    final lowerReflection = reflection.toLowerCase();
    const moodKeywords = {
      'Happy': ['happy', 'good', 'great', 'excited', 'positive', 'hopeful'],
      'Sad': ['sad', 'down', 'depressed', 'upset', 'disappointed'],
      'Anxious': ['anxious', 'worried', 'nervous', 'stressed', 'overwhelmed'],
      'Angry': ['angry', 'frustrated', 'annoyed', 'mad'],
      'Peaceful': ['calm', 'peaceful', 'relaxed', 'content'],
      'Neutral': <String>[],
    };

    var detectedMood = 'Neutral';
    var maxScore = 0;
    for (final entry in moodKeywords.entries) {
      if (entry.key == 'Neutral') continue;
      final score = entry.value.where((k) => lowerReflection.contains(k)).length;
      if (score > maxScore) {
        maxScore = score;
        detectedMood = entry.key;
      }
    }

    var score = 50;
    switch (detectedMood) {
      case 'Happy':
      case 'Peaceful':
        score = 75 + (maxScore * 5).clamp(0, 25);
      case 'Sad':
      case 'Angry':
        score = (40 - maxScore * 5).clamp(15, 40);
      case 'Anxious':
        score = (45 - maxScore * 3).clamp(25, 45);
      default:
        score = 50;
    }

    final insights = <String>[];
    if (lowerReflection.contains('work')) insights.add('Work discussion');
    if (lowerReflection.contains('relationship') ||
        lowerReflection.contains('family')) {
      insights.add('Relationship focus');
    }
    if (lowerReflection.contains('health')) insights.add('Health consideration');
    if (lowerReflection.contains('future') || lowerReflection.contains('plan')) {
      insights.add('Future planning');
    }
    if (lowerReflection.contains('stress') || lowerReflection.contains('anxiety')) {
      insights.add('Stress management');
    }

    return {
      'mood': detectedMood,
      'score': score.round(),
      'insights': insights.isNotEmpty ? insights : ['General reflection'],
    };
  }

  Future<String> generateCrewReflection(List<dynamic> crewMessages) async {
    if (crewMessages.isEmpty) {
      return 'Had a brief chat with the crew today.';
    }

    final userMessages = crewMessages
        .where((msg) {
          final m = _asMap(msg);
          return '${m['senderUid'] ?? ''}'.isNotEmpty &&
              m['sender'] != 'AI' &&
              '${m['message'] ?? ''}'.trim().isNotEmpty;
        })
        .map((msg) => '${_asMap(msg)['message']}'.trim())
        .where((text) => !isSimpleGreeting(text) && text.length > 3)
        .toList();

    final aiMessages = crewMessages
        .where((msg) => _asMap(msg)['sender'] == 'AI' && '${_asMap(msg)['message'] ?? ''}'.isNotEmpty)
        .map((msg) => '${_asMap(msg)['message']}'.trim())
        .toList();

    if (userMessages.isEmpty) {
      return "Had a brief chat with the crew today but didn't share much.";
    }

    try {
      return await generateCrewAiSummary(userMessages, aiMessages);
    } catch (err) {
      debugPrint('âš ï¸ Crew reflection generation via API failed: $err');
      return createFallbackCrewSummary(userMessages, aiMessages);
    }
  }

  Future<String> generateCrewAiSummary(
    List<String> userMessages,
    List<String> aiMessages,
  ) async {
    final conversationContext = buildCrewConversationContext(userMessages, aiMessages);
    final userCharacterCount =
        userMessages.fold<int>(0, (total, msg) => total + msg.length);
    final maxReflectionCharacters = userCharacterCount * 2;
    final totalMessages = userMessages.length;
    final estimatedMaxTokensFromChars = maxReflectionCharacters ~/ 3;

    late String sizeInstructions;
    late int maxTokens;
    if (totalMessages <= 3) {
      sizeInstructions =
          '14. REFLECTION LENGTH - CRITICAL: Write ONLY 2-3 sentences maximum. Keep it very short and concise.';
      maxTokens = [100, estimatedMaxTokensFromChars].reduce((a, b) => a < b ? a : b);
    } else if (totalMessages <= 7) {
      sizeInstructions =
          '14. REFLECTION LENGTH - Write a short reflection (3-4 sentences maximum). Keep it concise.';
      maxTokens = [150, estimatedMaxTokensFromChars].reduce((a, b) => a < b ? a : b);
    } else if (totalMessages <= 15) {
      sizeInstructions =
          '14. REFLECTION LENGTH - Write a medium reflection (4-5 sentences maximum). Still keep it concise.';
      maxTokens = [200, estimatedMaxTokensFromChars].reduce((a, b) => a < b ? a : b);
    } else {
      sizeInstructions =
          '14. REFLECTION LENGTH - Write a slightly longer reflection (5-6 sentences maximum). Keep it concise and focused.';
      maxTokens = [250, estimatedMaxTokensFromChars].reduce((a, b) => a < b ? a : b);
    }

    final characterLimitInstruction =
        '16. CHARACTER LIMIT - CRITICAL: The reflection must NEVER exceed $maxReflectionCharacters characters (which is 2x the $userCharacterCount characters the users wrote). Always stay within this strict limit.';

    final reflectionPrompt = '''Write a natural, first-person diary entry about this day's crew conversation. Tell the story of what happened in the crew's sphere chat and how it felt.

CRITICAL REQUIREMENTS:
1. WRITE IN FIRST PERSON
2. NO META-COMMENTARY
3. FOCUS ON WHAT HAPPENED
4. CAPTURE THE FEELING
5. BE SPECIFIC
6. NATURAL STORYTELLING
7. USE AS LITTLE TIME/SPACE AS APPROPRIATE
8. NO REPEATED "CREW MEMBER SAID..."
9. NO LONG DESCRIPTIONS OF OTHERS' ACTIONS
10. FEEL LIKE A PERSONAL REFLECTION
11. AVOID DRAMATIC LINES
12. NO REFLECTIVE CLOSING SENTENCES
13. NO POSITIVITY ABOUT TALKING TO CREW
14. ONLY SUMMARIZE WHAT WAS EXPRESSED
$sizeInstructions
$characterLimitInstruction

Crew's Sphere Chat:
$conversationContext

Write a natural diary entry about this day's crew conversation in first person.

CRITICAL: The reflection must NEVER exceed $maxReflectionCharacters characters.''';

    var summary = await _openAiComplete(reflectionPrompt, maxTokens: maxTokens, temperature: 0.5);
    if (summary.length > maxReflectionCharacters) {
      summary = summary.substring(0, maxReflectionCharacters);
      final lastSentenceEnd = [
        summary.lastIndexOf('.'),
        summary.lastIndexOf('!'),
        summary.lastIndexOf('?'),
      ].reduce((a, b) => a > b ? a : b);
      if (lastSentenceEnd > maxReflectionCharacters * 0.7) {
        summary = summary.substring(0, lastSentenceEnd + 1);
      }
    }
    return summary.trim();
  }

  String buildCrewConversationContext(
    List<String> userMessages,
    List<String> aiMessages,
  ) {
    final buf = StringBuffer();
    for (var i = 0; i < userMessages.length; i++) {
      buf.writeln('Crew Member: "${userMessages[i]}"');
      if (i < aiMessages.length) {
        final aiResponse = aiMessages[i];
        final truncated = aiResponse.length > 300 ? aiResponse.substring(0, 300) : aiResponse;
        buf.writeln(
          'AI: "$truncated${aiResponse.length > 300 ? '...' : ''}"',
        );
        buf.writeln();
      }
    }
    if (buf.isNotEmpty) {
      buf.writeln('---');
      buf.writeln('Please analyze this crew conversation carefully and identify:');
      buf.writeln('1. Key events or topics discussed');
      buf.writeln('2. Emotional tone');
      buf.writeln('3. Important details that should be reflected in the diary entry');
    }
    return buf.toString().trim();
  }

  String createFallbackCrewSummary(
    List<String> userMessages,
    List<String> aiMessages,
  ) {
    final lastUser = userMessages.isNotEmpty ? userMessages.last : '';
    final firstUser = userMessages.isNotEmpty ? userMessages.first : '';
    final base = firstUser != lastUser ? '$firstUser ... $lastUser' : lastUser;
    final trimmed = base.length > 220 ? '${base.substring(0, 220)}...' : base;
    return 'Today I chatted with the crew about: "$trimmed". It was nice to talk through my day with the crew and get some perspective.';
  }

  List<String> _extractUserMessages(List<dynamic> messages) {
    return messages
        .where((msg) {
          final m = _messageFields(msg);
          return m.sender == 'user' && m.isWhisperSession != true;
        })
        .map((msg) => _messageFields(msg).text.trim())
        .where((text) => !isSimpleGreeting(text) && text.length > 3)
        .toList();
  }

  List<String> _extractAiMessages(List<dynamic> messages) {
    return messages
        .where((msg) {
          final m = _messageFields(msg);
          return m.sender == 'ai' && m.isWhisperSession != true;
        })
        .map((msg) => _messageFields(msg).text.trim())
        .toList();
  }

  _MsgFields _messageFields(dynamic msg) {
    if (msg is Map) {
      return _MsgFields(
        sender: '${msg['sender'] ?? msg['role'] ?? 'ai'}',
        text: '${msg['text'] ?? ''}',
        isWhisperSession: msg['isWhisperSession'] == true,
      );
    }
    try {
      return _MsgFields(
        sender: msg.sender as String? ?? 'ai',
        text: msg.text as String? ?? '',
        isWhisperSession: msg.isWhisperSession == true,
      );
    } catch (_) {
      return const _MsgFields(sender: 'ai', text: '');
    }
  }

  Map<String, dynamic> _asMap(dynamic msg) {
    if (msg is Map<String, dynamic>) return msg;
    if (msg is Map) return Map<String, dynamic>.from(msg);
    return {};
  }

  Future<String> _openAiComplete(
    String prompt, {
    int maxTokens = 250,
    double temperature = 0.5,
  }) async {
    final key = Env.openAiApiKey.trim();
    if (key.isEmpty) throw Exception('OpenAI key not configured');
    final res = await http
        .post(
          Uri.parse('$_baseUrl/chat/completions'),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer $key',
          },
          body: jsonEncode({
            'model': _modelName,
            'messages': [
              {'role': 'user', 'content': prompt},
            ],
            'temperature': temperature,
            'max_tokens': maxTokens,
          }),
        )
        .timeout(const Duration(seconds: 120));
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw Exception('Reflection generation failed: ${res.statusCode}');
    }
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    return (data['choices']?[0]?['message']?['content'] as String? ?? '').trim();
  }
}

class _MsgFields {
  const _MsgFields({
    required this.sender,
    required this.text,
    this.isWhisperSession = false,
  });

  final String sender;
  final String text;
  final bool isWhisperSession;
}

final reflectionService = ReflectionService.instance;
