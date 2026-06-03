import '../services/firestore_service.dart';

const topicCategories = [
  (name: 'work or studies', keywords: ['work', 'office', 'project', 'deadline', 'study', 'exam', 'college', 'school']),
  (name: 'relationships', keywords: ['friend', 'family', 'mom', 'dad', 'partner', 'relationship', 'love', 'together']),
  (name: 'wellbeing', keywords: ['health', 'anxiety', 'stress', 'therapy', 'sleep', 'rest', 'mind', 'wellbeing']),
  (name: 'self-growth', keywords: ['goal', 'growth', 'improve', 'habit', 'plan', 'learn', 'progress']),
  (name: 'creativity', keywords: ['music', 'art', 'draw', 'paint', 'write', 'creative', 'photography']),
  (name: 'career decisions', keywords: ['career', 'job', 'interview', 'opportunity', 'startup']),
];

const moodKeywords = {
  'hopeful': ['hope', 'optimistic', 'excited', 'grateful', 'happy', 'joy'],
  'stressed': ['stress', 'worried', 'anxious', 'tired', 'exhausted', 'overwhelmed'],
  'reflective': ['thinking', 'reflect', 'ponder', 'journal', 'consider', 'realize'],
  'determined': ['determined', 'driven', 'focused', 'ambition', 'goal'],
  'overwhelmed': ['too much', "can't handle", 'pressure', 'burnt', 'burned', 'burnout'],
};

class PsychologicalInsights {
  const PsychologicalInsights({
    this.emotionalNature,
    this.thoughtPatterns,
    this.copingStyle,
    this.coreMotivations,
    this.relationshipStyle,
    this.overallVibe,
  });

  final String? emotionalNature;
  final String? thoughtPatterns;
  final String? copingStyle;
  final String? coreMotivations;
  final String? relationshipStyle;
  final String? overallVibe;
}

class ChatInsights {
  const ChatInsights({
    required this.topTopics,
    required this.moodRanking,
    required this.psychologicalInsights,
  });

  final List<String> topTopics;
  final List<(String, int)> moodRanking;
  final PsychologicalInsights psychologicalInsights;
}

Future<ChatInsights?> analyzeUserChatHistory(String uid) async {
  try {
    final daysResult = await FirestoreService.instance.getAllChatDays(uid);
    if (daysResult['success'] != true) return null;
    final chatDays = daysResult['chatDays'];
    if (chatDays is! List || chatDays.isEmpty) return null;

    final sortedDays = List<Map<String, dynamic>>.from(
      chatDays.map((d) => Map<String, dynamic>.from(d as Map)),
    )..sort((a, b) {
        final da = '${a['date'] ?? a['id'] ?? ''}'.replaceAll('-', '');
        final db = '${b['date'] ?? b['id'] ?? ''}'.replaceAll('-', '');
        return db.compareTo(da);
      });

    final daysToProcess = sortedDays.take(90);
    final topicCounts = {for (final c in topicCategories) c.name: 0};
    final moodCounts = {for (final k in moodKeywords.keys) k: 0};

    var totalMessages = 0;
    var totalWords = 0;
    var questionCount = 0;
    var selfReflectionCount = 0;
    var futureOrientedCount = 0;
    var pastOrientedCount = 0;
    var uncertaintyCount = 0;
    var problemSolvingCount = 0;
    var emotionalDepthCount = 0;
    var relationshipMentionCount = 0;

    for (final day in daysToProcess) {
      final dateId = '${day['date'] ?? day['id'] ?? ''}';
      if (dateId.isEmpty) continue;
      final messagesResult = await FirestoreService.instance.getChatMessagesNew(uid, dateId);
      if (messagesResult['success'] != true) continue;
      final messages = messagesResult['messages'];
      if (messages is! List) continue;

      for (final raw in messages) {
        final message = Map<String, dynamic>.from(raw as Map);
        if (message['sender'] != 'user') continue;
        final text = '${message['text'] ?? ''}';
        if (text.isEmpty) continue;

        totalMessages++;
        final lower = text.toLowerCase();
        final words = text.split(RegExp(r'\s+')).where((w) => w.isNotEmpty);
        totalWords += words.length;

        for (final cat in topicCategories) {
          if (cat.keywords.any(lower.contains)) {
            topicCounts[cat.name] = (topicCounts[cat.name] ?? 0) + 1;
          }
        }
        for (final entry in moodKeywords.entries) {
          if (entry.value.any(lower.contains)) {
            moodCounts[entry.key] = (moodCounts[entry.key] ?? 0) + 1;
          }
        }

        if (text.contains('?') || lower.contains('wonder') || lower.contains('curious') || lower.contains('why') || lower.contains('how')) {
          questionCount++;
        }
        if (RegExp(r"i feel|i think|i realize|i notice|i wonder|i'm|myself|self").hasMatch(lower)) {
          selfReflectionCount++;
        }
        if (RegExp(r'will|going to|plan|future|hope|want to|goal').hasMatch(lower)) {
          futureOrientedCount++;
        }
        if (RegExp(r'was|were|remember|past|used to|before').hasMatch(lower)) {
          pastOrientedCount++;
        }
        if (RegExp(r'maybe|perhaps|might|could|uncertain|not sure|doubt').hasMatch(lower)) {
          uncertaintyCount++;
        }
        if (RegExp(r'solve|fix|handle|deal with|manage|approach|strategy').hasMatch(lower)) {
          problemSolvingCount++;
        }
        if (RegExp(r'deep|intense|profound|meaningful|significant|powerful|overwhelming').hasMatch(lower)) {
          emotionalDepthCount++;
        }
        if (RegExp(r'friend|family|partner|relationship|people|others|they|we').hasMatch(lower)) {
          relationshipMentionCount++;
        }
      }
    }

    if (totalMessages < 5) return null;

    final topTopics = topicCounts.entries
        .where((e) => e.value > 0)
        .toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    final topTopicNames = topTopics.take(3).map((e) => e.key).toList();

    final moodRanking = moodCounts.entries.where((e) => e.value > 0).toList()
      ..sort((a, b) => b.value.compareTo(a.value));

    final avgWordsPerMessage = totalWords / totalMessages;
    final questionRatio = questionCount / totalMessages;
    final selfReflectionRatio = selfReflectionCount / totalMessages;
    final futureRatio = futureOrientedCount / totalMessages;
    final pastRatio = pastOrientedCount / totalMessages;
    final uncertaintyRatio = uncertaintyCount / totalMessages;
    final problemSolvingRatio = problemSolvingCount / totalMessages;
    final emotionalDepthRatio = emotionalDepthCount / totalMessages;
    final relationshipRatio = relationshipMentionCount / totalMessages;

    return ChatInsights(
      topTopics: topTopicNames,
      moodRanking: moodRanking.map((e) => (e.key, e.value)).toList(),
      psychologicalInsights: PsychologicalInsights(
        emotionalNature: _determineEmotionalNature(moodRanking, emotionalDepthRatio, moodCounts),
        thoughtPatterns: _determineThoughtPatterns(questionRatio, selfReflectionRatio, avgWordsPerMessage, uncertaintyRatio),
        copingStyle: _determineCopingStyle(problemSolvingRatio, moodRanking, moodCounts),
        coreMotivations: _determineCoreMotivations(topTopicNames, futureRatio, pastRatio),
        relationshipStyle: _determineRelationshipStyle(relationshipRatio, selfReflectionRatio),
        overallVibe: _determineOverallVibe(moodRanking, emotionalDepthRatio, problemSolvingRatio, futureRatio),
      ),
    );
  } catch (_) {
    return null;
  }
}

String? _determineEmotionalNature(List<MapEntry<String, int>> moodRanking, double emotionalDepthRatio, Map<String, int> moodCounts) {
  if (moodRanking.isEmpty) return null;
  final topMood = moodRanking.first.key;
  final isDeep = emotionalDepthRatio > 0.15;
  final isStressed = (moodCounts['stressed'] ?? 0) > (moodCounts['hopeful'] ?? 0);
  final isReflective = (moodCounts['reflective'] ?? 0) > 0;

  if (isDeep && isReflective) {
    return 'tends to experience emotions deeply and reflect on their inner world with thoughtful awareness';
  }
  if (topMood == 'hopeful' && !isStressed) {
    return 'maintains a generally optimistic and forward-looking emotional outlook';
  }
  if (topMood == 'stressed' || topMood == 'overwhelmed') {
    return 'is candid about emotional challenges and navigates stress with openness';
  }
  if (topMood == 'reflective') {
    return 'approaches emotions with introspection and thoughtful consideration';
  }
  if (topMood == 'determined') {
    return 'channels emotions into focused determination and growth-oriented energy';
  }
  return 'expresses emotions authentically and navigates feelings with genuine awareness';
}

String? _determineThoughtPatterns(double questionRatio, double selfReflectionRatio, double avgWordsPerMessage, double uncertaintyRatio) {
  final isCurious = questionRatio > 0.2;
  final isIntrospective = selfReflectionRatio > 0.3;
  final isDetailed = avgWordsPerMessage > 15;
  final isUncertain = uncertaintyRatio > 0.15;

  if (isCurious && isIntrospective) {
    return 'thinks through questions with curiosity and self-awareness, often exploring ideas from multiple angles';
  }
  if (isCurious && !isIntrospective) {
    return 'approaches thinking with an inquisitive mind, seeking to understand the world around them';
  }
  if (isIntrospective && isDetailed) {
    return 'engages in deep, reflective thinking with attention to nuance and detail';
  }
  if (isUncertain && isIntrospective) {
    return 'thinks with openness to complexity, comfortable with uncertainty and multiple perspectives';
  }
  if (isDetailed) {
    return 'thinks in a thorough and considered manner, paying attention to details and context';
  }
  return 'thinks with clarity and directness, processing experiences thoughtfully';
}

String? _determineCopingStyle(double problemSolvingRatio, List<MapEntry<String, int>> moodRanking, Map<String, int> moodCounts) {
  final isProblemSolver = problemSolvingRatio > 0.2;
  final isStressed = (moodCounts['stressed'] ?? 0) > 0;
  final isResilient = (moodCounts['overwhelmed'] ?? 0) > 0 && (moodCounts['determined'] ?? 0) > 0;

  if (isProblemSolver && isResilient) {
    return 'copes by actively seeking solutions while maintaining resilience through challenges';
  }
  if (isProblemSolver) {
    return 'copes by taking an action-oriented approach, focusing on practical solutions';
  }
  if (isResilient) {
    return 'copes with challenges by staying resilient and finding strength in difficult moments';
  }
  if (isStressed) {
    return 'copes by being open about difficulties and processing stress through expression';
  }
  return "copes with life's challenges through thoughtful reflection and adaptive responses";
}

String? _determineCoreMotivations(List<String> topTopics, double futureRatio, double pastRatio) {
  final isFutureFocused = futureRatio > pastRatio + 0.1;
  final isPastReflective = pastRatio > futureRatio + 0.1;
  final hasGrowthTopics = topTopics.any((t) => t == 'self-growth' || t == 'career decisions');

  if (isFutureFocused && hasGrowthTopics) {
    return 'is driven by growth and forward momentum, actively working toward future goals';
  }
  if (isFutureFocused) {
    return 'is motivated by future possibilities and maintaining a sense of forward direction';
  }
  if (isPastReflective) {
    return 'draws motivation from reflection on past experiences and learning from them';
  }
  if (hasGrowthTopics) {
    return 'is motivated by personal development and continuous improvement';
  }
  return 'finds motivation in meaningful connections and authentic experiences';
}

String? _determineRelationshipStyle(double relationshipRatio, double selfReflectionRatio) {
  final isSocial = relationshipRatio > 0.3;
  final isSelfAware = selfReflectionRatio > 0.25;

  if (isSocial && isSelfAware) {
    return 'navigates relationships with self-awareness and thoughtful consideration of others';
  }
  if (isSocial) {
    return 'values connections with others and invests in meaningful relationships';
  }
  if (isSelfAware) {
    return 'has a strong relationship with self, engaging in regular self-reflection and inner awareness';
  }
  return 'balances connection with others and personal inner work';
}

String? _determineOverallVibe(List<MapEntry<String, int>> moodRanking, double emotionalDepthRatio, double problemSolvingRatio, double futureRatio) {
  if (moodRanking.isEmpty) return null;
  final topMood = moodRanking.first.key;
  final isDeep = emotionalDepthRatio > 0.15;
  final isProactive = problemSolvingRatio > 0.2;
  final isForwardLooking = futureRatio > 0.25;

  if (topMood == 'hopeful' && isForwardLooking && isProactive) {
    return 'carries an optimistic and proactive energy, moving forward with hope and intention';
  }
  if (topMood == 'reflective' && isDeep) {
    return 'maintains a thoughtful and introspective vibe, engaging deeply with inner experiences';
  }
  if (topMood == 'determined' && isProactive) {
    return 'radiates focused determination and purposeful energy';
  }
  if (isDeep && topMood != 'stressed') {
    return 'brings depth and authenticity to emotional experiences';
  }
  if (topMood == 'hopeful') {
    return 'maintains a hopeful and forward-looking perspective';
  }
  return "brings genuine presence and authentic engagement to life's experiences";
}

String _platformLabel(String platform) {
  switch (platform.toLowerCase()) {
    case 'x':
      return 'X';
    case 'linkedin':
      return 'LinkedIn';
    case 'reddit':
      return 'Reddit';
    case 'whatsapp':
      return 'WhatsApp';
    case 'native':
      return 'share sheet';
    default:
      return platform;
  }
}

Future<String?> generateAutoBioSummary({
  required String uid,
  required String? displayName,
  required String age,
  required String gender,
}) async {
  final firstName = (displayName ?? 'You').split(' ').first;
  String? summarySentence;

  final insights = await analyzeUserChatHistory(uid);
  String? socialHabitSentence;

  try {
    final sharesRes = await FirestoreService.instance.getSocialSharesByUser(uid);
    if (sharesRes['success'] == true && sharesRes['shares'] is List) {
      final shares = sharesRes['shares'] as List;
      if (shares.isNotEmpty) {
        final byPlatform = <String, int>{};
        final byDate = <String, bool>{};
        for (final raw in shares) {
          final s = Map<String, dynamic>.from(raw as Map);
          final p = '${s['platform'] ?? 'other'}'.toLowerCase();
          byPlatform[p] = (byPlatform[p] ?? 0) + 1;
          final rd = '${s['reflectionDate'] ?? ''}';
          final d = rd.length >= 10 ? rd.substring(0, 10) : rd;
          if (d.isNotEmpty) byDate[d] = true;
        }
        final ranked = byPlatform.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
        final top = ranked.take(2).map((e) => e.key).toList();
        final totalDaysShared = byDate.length;
        final topText = top.length == 2
            ? '${_platformLabel(top[0])} and ${_platformLabel(top[1])}'
            : (top.isNotEmpty ? _platformLabel(top.first) : null);
        if (topText != null) {
          socialHabitSentence = totalDaysShared >= 6
              ? 'often shares reflections to $topText and likes to make your day visible.'
              : 'has started sharing reflections to $topText, especially on days that feel meaningful.';
        }
      }
    }
  } catch (_) {}

  if (insights != null) {
    final psych = insights.psychologicalInsights;
    final orderedSentences = [
      if (psych.emotionalNature != null) '$firstName ${psych.emotionalNature}.',
      if (psych.overallVibe != null) '$firstName ${psych.overallVibe}.',
      if (psych.thoughtPatterns != null) '$firstName ${psych.thoughtPatterns}.',
      if (psych.copingStyle != null) '$firstName ${psych.copingStyle}.',
      if (psych.coreMotivations != null) '$firstName ${psych.coreMotivations}.',
      if (psych.relationshipStyle != null) '$firstName ${psych.relationshipStyle}.',
      if (socialHabitSentence != null) '$firstName $socialHabitSentence',
      if (insights.topTopics.length >= 2)
        '$firstName tends to reflect most on ${insights.topTopics.take(2).join(' and ')}.',
    ].where((s) => s.isNotEmpty).toList();

    if (orderedSentences.isNotEmpty) {
      summarySentence = orderedSentences.take(5).join(' ');
    }
  }

  if (summarySentence != null && summarySentence.isNotEmpty) return summarySentence;

  const moods = [
    'feel calm and reflective today',
    'are focused on steady growth',
    'are hopeful and optimistic',
    'are taking things one step at a time',
    'are balancing ambition with self-care',
    'are thoughtful and kind in your interactions',
    'bring grounded energy into conversations',
    'are ready to explore new ideas gently',
  ];
  final tone = moods[DateTime.now().day % moods.length];
  final agePart = age.isNotEmpty ? 'At $age, ' : '';
  final genderPart = gender.isNotEmpty ? '$gender ' : '';
  return '${agePart}$firstName (${genderPart.trim().isEmpty ? 'they' : genderPart.trim()}) $tone.';
}

DateTime getLast2Am() {
  final now = DateTime.now();
  var last2Am = DateTime(now.year, now.month, now.day, 2);
  if (now.isBefore(last2Am)) {
    last2Am = last2Am.subtract(const Duration(days: 1));
  }
  return last2Am;
}
