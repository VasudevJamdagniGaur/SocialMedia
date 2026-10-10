/// Shared personalization helpers for LinkedIn / X / Instagram content.
///
/// Decides whether the authenticated user is the visual subject, another person
/// is, or the topic is general — so we never invent a face or force the user's
/// photo into unrelated stories.

enum ContentSubjectKind {
  /// User is narrating their own experience / achievement.
  userSelf,

  /// Story is primarily about someone else.
  otherPerson,

  /// Abstract / thought-leadership / news without a personal subject.
  generalTopic,
}

class ContentSubjectAnalysis {
  const ContentSubjectAnalysis({
    required this.kind,
    required this.confidence,
    required this.reason,
  });

  final ContentSubjectKind kind;
  final double confidence;
  final String reason;

  bool get useUserFaceReference => kind == ContentSubjectKind.userSelf;
}

/// Heuristic subject analysis (no network). Prefer precision for "other person"
/// so we never paste the user's face onto a friend's story.
ContentSubjectAnalysis analyzeContentSubject(String input) {
  final text = input.trim();
  if (text.isEmpty) {
    return const ContentSubjectAnalysis(
      kind: ContentSubjectKind.generalTopic,
      confidence: 1,
      reason: 'empty',
    );
  }

  final lower = text.toLowerCase();

  // Strong signals the story is about someone else.
  final otherPatterns = <RegExp>[
    RegExp(r'\bmy (friend|brother|sister|mom|dad|mother|father|wife|husband|cousin|colleague|teammate|boss|mentor|classmate|roommate)\b'),
    RegExp(r'\b(he|she) (won|attended|got|received|started|launched|built|published|graduated)\b'),
    RegExp(r'\b(his|her) (team|project|startup|company|win|award)\b'),
    RegExp(r'\bcongrats to\b'),
    RegExp(r'\bshout ?out to\b'),
  ];
  for (final re in otherPatterns) {
    if (re.hasMatch(lower)) {
      return ContentSubjectAnalysis(
        kind: ContentSubjectKind.otherPerson,
        confidence: 0.9,
        reason: 'matched other-person pattern: ${re.pattern}',
      );
    }
  }

  // Strong first-person experience signals.
  final selfPatterns = <RegExp>[
    RegExp(r'\bi (won|attended|got|received|started|launched|built|shipped|published|graduated|joined|spoke|presented|completed|finished|cracked|cleared|met|visited|hosted)\b'),
    RegExp(r"\bi'?m (proud|excited|thrilled|grateful|honored|happy|starting|building|launching)\b"),
    RegExp(r"\bi'?ve (won|built|shipped|launched|started|joined|learned|completed|met)\b"),
    RegExp(r'\bmy (hackathon|project|startup|internship|offer|degree|talk|demo|pitch|app|product)\b'),
    RegExp(r'\btoday i\b'),
    RegExp(r'\bi just\b'),
  ];
  var selfHits = 0;
  for (final re in selfPatterns) {
    if (re.hasMatch(lower)) selfHits++;
  }
  final hasFirstPerson = RegExp(r"\b(i|i'?m|i'?ve|me|my|mine)\b").hasMatch(lower);

  if (selfHits >= 1 || (hasFirstPerson && _looksLikePersonalEvent(lower))) {
    return ContentSubjectAnalysis(
      kind: ContentSubjectKind.userSelf,
      confidence: selfHits >= 1 ? 0.85 : 0.65,
      reason: selfHits >= 1 ? 'first-person achievement/experience' : 'first-person narrative',
    );
  }

  // Abstract / general topic (no personal narrative).
  if (!hasFirstPerson) {
    return const ContentSubjectAnalysis(
      kind: ContentSubjectKind.generalTopic,
      confidence: 0.8,
      reason: 'no first-person; treat as general topic',
    );
  }

  // Soft first-person without clear event → still personal writing, but do not
  // force a face reference unless clearly experiential.
  if (hasFirstPerson) {
    return const ContentSubjectAnalysis(
      kind: ContentSubjectKind.userSelf,
      confidence: 0.45,
      reason: 'soft first-person; optional identity visual',
    );
  }

  return const ContentSubjectAnalysis(
    kind: ContentSubjectKind.generalTopic,
    confidence: 0.5,
    reason: 'fallback general',
  );
}

bool _looksLikePersonalEvent(String lower) {
  return RegExp(
    r'\b(hackathon|conference|internship|offer|graduation|launch|demo day|pitch|award|medal|trophy|workshop|meetup|interview)\b',
  ).hasMatch(lower);
}

/// Whether a stored profile picture can be used as a face reference.
/// Cartoon avatars / assets must not be sent as identity references.
bool isUsableFaceReference(String? picture) {
  if (picture == null) return false;
  final p = picture.trim();
  if (p.isEmpty) return false;
  if (p.startsWith('emoji:')) return false;
  if (p.startsWith('assets/')) return false;
  if (p.startsWith('/') && !p.startsWith('http')) return false;
  // Fruit avatar filenames stored without assets/ prefix
  if (RegExp(r'(apple|pineapple|carrot|banana|strawberry|broccoli)-avatar', caseSensitive: false)
      .hasMatch(p)) {
    return false;
  }
  return p.startsWith('data:image') ||
      p.startsWith('http://') ||
      p.startsWith('https://');
}

/// Platform image aspect ratios for the shared pipeline.
String personalizationAspectRatio({
  required String platform,
  String instagramFormat = 'story',
}) {
  final p = platform.trim().toLowerCase();
  if (p == 'instagram' || p == 'reddit') {
    return instagramFormat == 'post' ? '1:1' : '9:16';
  }
  if (p == 'linkedin') return '1:1';
  if (p == 'x') return '16:9';
  return '16:9';
}
