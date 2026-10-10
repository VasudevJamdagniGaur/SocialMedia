import 'package:flutter/foundation.dart';

import '../services/cached_news_service.dart';
import '../services/chat_service.dart';
import '../services/youtube_tea_service.dart';
import 'reddit_thread_comments.dart';
import 'share_news_cache.dart';

/// How complete Tea post extraction was for a source URL.
enum TeaExtractionStatus {
  /// Title + substantial body available.
  complete,

  /// Some body/caption beyond the title, but incomplete.
  partial,

  /// Only headline/title (or empty body).
  titleOnly,

  /// Source unreachable / blocked / no usable fields.
  unavailable,
}

/// Structured Tea/news post content carried through share + image pipelines.
class ExtractedTeaContent {
  const ExtractedTeaContent({
    required this.platform,
    required this.url,
    required this.title,
    required this.body,
    required this.extractionStatus,
    this.postId = '',
    this.author = '',
    this.publishedAt = '',
    this.description = '',
    this.contentStatus = '',
    this.hashtags = const [],
    this.mentions = const [],
    this.media = const [],
    this.missingFields = const [],
    this.diagnostic = '',
  });

  final String platform;
  final String url;
  final String postId;
  final String title;
  /// Full article/post body (never title-filled).
  final String body;
  /// Short snippet/meta description — kept separate from [body].
  final String description;
  final String author;
  final String publishedAt;
  /// Backend `contentStatus` when present (`complete`/`partial`/`unavailable`).
  final String contentStatus;
  final List<String> hashtags;
  final List<String> mentions;
  final List<String> media;
  final TeaExtractionStatus extractionStatus;
  final List<String> missingFields;
  final String diagnostic;

  bool get hasSubstantialBody {
    final b = sanitizeTeaCardSummary(stripHtmlBoilerplate(body)).trim();
    return b.length >= 40 &&
        !teaTextLooksLikeTitleEcho(b, title) &&
        !isFeedMarkupOrUrlOnly(b);
  }

  String get storyTextForAi {
    final cleaned = sanitizeTeaCardSummary(stripHtmlBoilerplate(body)).trim();
    if (cleaned.isEmpty || isFeedMarkupOrUrlOnly(cleaned)) return '';
    if (teaTextLooksLikeTitleEcho(cleaned, title) && cleaned.length < 80) {
      return '';
    }
    if (hasSubstantialBody) return cleaned;
    if (cleaned.isNotEmpty && cleaned != title.trim()) return cleaned;
    return '';
  }

  Map<String, dynamic> toJson() => {
        'platform': platform,
        'url': url,
        'postId': postId,
        'title': title,
        'body': body,
        'description': description,
        'author': author,
        'publishedAt': publishedAt,
        'contentStatus': contentStatus.isNotEmpty
            ? contentStatus
            : extractionStatus.name,
        'hashtags': hashtags,
        'mentions': mentions,
        'media': media,
        'extractionStatus': extractionStatus.name,
        'missingFields': missingFields,
        if (diagnostic.isNotEmpty) 'diagnostic': diagnostic,
      };

  Map<String, dynamic> toArticleSeed() => {
        'title': title,
        'url': url,
        'description': description.isNotEmpty ? description : body,
        'gossip': body,
        'selftext': body,
        'text': body,
        'bodyText': body,
        'author': author,
        'source': platform,
        if (media.isNotEmpty) 'image': media.first,
        'extractionStatus': extractionStatus.name,
        'contentStatus': contentStatus.isNotEmpty
            ? contentStatus
            : extractionStatus.name,
        'missingFields': missingFields,
      };
}

String detectTeaPlatform(String url) {
  final u = url.trim().toLowerCase();
  if (isYouTubeTeaUrl(u)) return 'youtube';
  if (isRedditThreadUrl(u)) return 'reddit';
  if (u.contains('linkedin.com')) return 'linkedin';
  if (u.contains('instagram.com')) return 'instagram';
  if (u.contains('twitter.com') || u.contains('x.com')) return 'x';
  if (u.contains('news.google.com')) return 'google_news';
  if (u.startsWith('http')) return 'article';
  return 'unknown';
}

List<String> _extractHashtags(String text) => RegExp(r'#([A-Za-z0-9_]+)')
    .allMatches(text)
    .map((m) => m.group(1)!)
    .toSet()
    .toList();

List<String> _extractMentions(String text) => RegExp(r'@([A-Za-z0-9_.]+)')
    .allMatches(text)
    .map((m) => m.group(1)!)
    .toSet()
    .toList();

String _pickBody(Map<String, dynamic> row) {
  for (final key in ['bodyText', 'body', 'selftext', 'text', 'gossip', 'caption']) {
    final raw = '${row[key] ?? ''}'.trim();
    if (raw.isEmpty || isFeedMarkupOrUrlOnly(raw)) continue;
    final v = sanitizeTeaCardSummary(stripHtmlBoilerplate(raw)).trim();
    if (v.isNotEmpty && !isFeedMarkupOrUrlOnly(v)) return v;
  }
  // Description only as last resort when it is real prose (not feed markup).
  final desc = '${row['description'] ?? ''}'.trim();
  if (desc.isNotEmpty && !isFeedMarkupOrUrlOnly(desc)) {
    final v = sanitizeTeaCardSummary(stripHtmlBoilerplate(desc)).trim();
    if (v.isNotEmpty) return v;
  }
  return '';
}

String _pickDescription(Map<String, dynamic> row, String title) {
  for (final key in ['description', 'gossip']) {
    final cleaned = cleanFeedSnippetForDisplay('${row[key] ?? ''}', title: title);
    if (cleaned.isNotEmpty) return cleaned;
  }
  return '';
}

TeaExtractionStatus _statusFromContentStatus(String? raw) {
  switch ('${raw ?? ''}'.trim().toLowerCase()) {
    case 'complete':
      return TeaExtractionStatus.complete;
    case 'partial':
      return TeaExtractionStatus.partial;
    case 'unavailable':
      return TeaExtractionStatus.unavailable;
    case 'titleonly':
    case 'title_only':
      return TeaExtractionStatus.titleOnly;
    default:
      return TeaExtractionStatus.titleOnly;
  }
}

ExtractedTeaContent extractedTeaContentFromRow(Map<String, dynamic> row) {
  final url = '${row['url'] ?? row['postUrl'] ?? ''}'.trim();
  final title = cleanTeaCardTitle('${row['title'] ?? ''}');
  var body = _pickBody(row);
  if (teaTextLooksLikeTitleEcho(body, title)) body = '';
  final description = _pickDescription(row, title);
  final author = '${row['author'] ?? row['source'] ?? ''}'.trim();
  final platform = detectTeaPlatform(url);
  final contentStatus = '${row['contentStatus'] ?? row['extractionStatus'] ?? ''}'.trim();
  final media = <String>[];
  for (final key in ['image', 'thumbnail', 'sourceImageUrl', 'imageUrl']) {
    final m = '${row[key] ?? ''}'.trim();
    if (m.startsWith('http') && !media.contains(m)) media.add(m);
  }

  final missing = <String>[];
  if (title.isEmpty) missing.add('title');
  if (body.isEmpty) missing.add('body');
  if (author.isEmpty) missing.add('author');

  TeaExtractionStatus status;
  String diagnostic = '${row['extractionError'] ?? row['diagnostic'] ?? ''}'.trim();
  if (contentStatus.isNotEmpty && body.isEmpty && contentStatus.toLowerCase() == 'unavailable') {
    status = TeaExtractionStatus.unavailable;
    if (diagnostic.isEmpty) diagnostic = 'Backend reported content unavailable';
  } else if (url.isEmpty && title.isEmpty) {
    status = TeaExtractionStatus.unavailable;
    diagnostic = 'No URL or title on tea row';
  } else if (body.isEmpty) {
    status = contentStatus.isNotEmpty
        ? _statusFromContentStatus(contentStatus)
        : TeaExtractionStatus.titleOnly;
    if (status == TeaExtractionStatus.complete) {
      status = TeaExtractionStatus.titleOnly;
    }
    if (diagnostic.isEmpty) {
      diagnostic = 'Row only has headline; body/caption missing';
    }
  } else if (body.length < 80) {
    status = TeaExtractionStatus.partial;
    if (diagnostic.isEmpty) {
      diagnostic = 'Short caption/snippet only (${body.length} chars)';
    }
  } else if (contentStatus.toLowerCase() == 'complete' || body.length >= 400) {
    status = TeaExtractionStatus.complete;
  } else {
    status = TeaExtractionStatus.partial;
  }

  return ExtractedTeaContent(
    platform: platform,
    url: url,
    postId: '${row['id'] ?? hubNewsDocIdFromUrl(url)}',
    title: title,
    body: body,
    description: description,
    author: author,
    publishedAt: '${row['publishedAt'] ?? ''}'.trim(),
    contentStatus: contentStatus.isNotEmpty ? contentStatus : status.name,
    hashtags: _extractHashtags(body),
    mentions: _extractMentions(body),
    media: media,
    extractionStatus: status,
    missingFields: missing,
    diagnostic: diagnostic,
  );
}

/// Fetch full post/article body when the row is title-only or partial.
Future<ExtractedTeaContent> resolveTeaPostContent(
  Map<String, dynamic> seed, {
  Duration timeout = const Duration(seconds: 22),
}) async {
  final initial = extractedTeaContentFromRow(seed);
  if (initial.extractionStatus == TeaExtractionStatus.complete) {
    debugPrint(
      '[TeaExtract] complete platform=${initial.platform} '
      'bodyLen=${initial.body.length} url=${initial.url}',
    );
    return initial;
  }

  final url = initial.url;
  if (url.isEmpty) {
    debugPrint('[TeaExtract] unavailable: empty url title="${initial.title}"');
    return initial;
  }

  final merged = Map<String, dynamic>.from(seed);
  var diagnostic = initial.diagnostic;

  try {
    if (isRedditThreadUrl(url)) {
      final details = await fetchRedditThreadDetails(url, seed: seed)
          .timeout(timeout);
      if (details != null) {
        for (final k in ['title', 'gossip', 'description', 'selftext', 'text', 'image', 'author']) {
          final v = details[k];
          if (v == null) continue;
          if (v is String && v.trim().isEmpty) continue;
          merged[k] = v;
        }
      } else {
        diagnostic = 'Reddit thread details unavailable (blocked or empty)';
      }
    } else if (isYouTubeTeaUrl(url)) {
      final yt = await fetchYouTubeTeaVideoContext(url).timeout(timeout);
      if (yt != null) {
        merged.addAll(yt);
      } else {
        diagnostic =
            'YouTube description unavailable (missing YOUTUBE_API_KEY or API error)';
      }
    } else {
      final details = await ChatService.instance
          .fetchNewsArticleDetails(
            seed,
            {'minTextLength': 80, 'resolveGoogleNews': true},
          )
          .timeout(timeout);
      for (final k in [
        'title',
        'description',
        'text',
        'bodyText',
        'image',
        'imageUrl',
        'source',
        'contentStatus',
        'extractionError',
      ]) {
        final v = details[k];
        if (v == null) continue;
        if (v is String && v.trim().isEmpty) continue;
        merged[k] = v;
      }
      final text =
          '${details['bodyText'] ?? details['text'] ?? ''}'.trim();
      final cleaned = sanitizeTeaCardSummary(stripHtmlBoilerplate(text));
      if (cleaned.length >= 40 && !isFeedMarkupOrUrlOnly(cleaned)) {
        merged['gossip'] =
            cleaned.length > 800 ? '${cleaned.substring(0, 800)}…' : cleaned;
        merged['selftext'] = cleaned;
        merged['body'] = cleaned;
        merged['bodyText'] = cleaned;
      } else if (cleaned.isEmpty) {
        diagnostic = '${details['extractionError'] ?? ''}'.trim().isNotEmpty
            ? '${details['extractionError']}'
            : 'Article extractor returned no body (paywall, JS-only page, or blocked)';
      }
    }
  } catch (e) {
    diagnostic = 'Extraction failed: $e';
    debugPrint('[TeaExtract] resolve failed url=$url err=$e');
  }

  final resolved = extractedTeaContentFromRow(merged);
  final withDiag = ExtractedTeaContent(
    platform: resolved.platform,
    url: resolved.url,
    postId: resolved.postId,
    title: resolved.title.isNotEmpty ? resolved.title : initial.title,
    body: resolved.body,
    description: resolved.description.isNotEmpty
        ? resolved.description
        : initial.description,
    author: resolved.author.isNotEmpty ? resolved.author : initial.author,
    publishedAt: resolved.publishedAt,
    contentStatus: resolved.contentStatus,
    hashtags: resolved.hashtags,
    mentions: resolved.mentions,
    media: resolved.media.isNotEmpty ? resolved.media : initial.media,
    extractionStatus: resolved.extractionStatus,
    missingFields: resolved.missingFields,
    diagnostic: resolved.extractionStatus == TeaExtractionStatus.complete
        ? ''
        : (diagnostic.isNotEmpty ? diagnostic : resolved.diagnostic),
  );

  debugPrint(
    '[TeaExtract] status=${withDiag.extractionStatus.name} '
    'platform=${withDiag.platform} bodyLen=${withDiag.body.length} '
    'missing=${withDiag.missingFields} diag=${withDiag.diagnostic}',
  );
  return withDiag;
}

/// Lightweight subject analysis for image prompts (body-grounded).
class TeaVisualContext {
  const TeaVisualContext({
    required this.mainSubject,
    required this.centralClaim,
    required this.visualConcept,
    required this.peopleCentral,
    required this.tone,
    required this.bodyGrounded,
  });

  final String mainSubject;
  final String centralClaim;
  final String visualConcept;
  final List<String> peopleCentral;
  final String tone;
  final bool bodyGrounded;

  String toImagePromptBlock() {
    final buf = StringBuffer();
    buf.writeln('MAIN SUBJECT: $mainSubject');
    if (centralClaim.isNotEmpty) buf.writeln('CENTRAL CLAIM: $centralClaim');
    if (peopleCentral.isNotEmpty) {
      buf.writeln('CENTRAL PEOPLE (only if essential to the scene): ${peopleCentral.join(', ')}');
    } else {
      buf.writeln('CENTRAL PEOPLE: none — do not invent or feature unrelated celebrities.');
    }
    buf.writeln('TONE: $tone');
    buf.writeln('VISUAL CONCEPT: $visualConcept');
    if (!bodyGrounded) {
      buf.writeln(
        'WARNING: Full post body was unavailable. Stay symbolic for the headline topic; '
        'do not invent biographical scenes or claim specific events.',
      );
    }
    return buf.toString().trim();
  }
}

TeaVisualContext analyzeTeaVisualContext(ExtractedTeaContent content) {
  final title = content.title.trim();
  final body = content.storyTextForAi;
  final grounded = content.hasSubstantialBody;
  final blob = '$title\n$body'.trim();
  final lower = blob.toLowerCase();

  // People mentioned: capitalized multi-word names (lightweight; not a celeb list).
  final nameRe = RegExp(r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b');
  final titleNames = nameRe
      .allMatches(title)
      .map((m) => m.group(1)!.trim())
      .where((n) => n.toLowerCase() != 'google news')
      .toSet();
  final bodyNames = nameRe
      .allMatches(body)
      .map((m) => m.group(1)!.trim())
      .where((n) => n.toLowerCase() != 'google news')
      .toSet();

  bool nameAppearsInBody(String n) {
    final lower = n.toLowerCase();
    if (body.toLowerCase().contains(lower)) return true;
    // "Sourav Ganguly Net Worth" title vs "Sourav Ganguly" in body.
    for (final bn in bodyNames) {
      if (bn.toLowerCase().contains(lower) || lower.contains(bn.toLowerCase())) {
        return true;
      }
    }
    return false;
  }

  // A person is "central" only if in title AND (in body, or body missing).
  final centralPeople = <String>[];
  for (final n in titleNames) {
    final inBody = nameAppearsInBody(n);
    if (!grounded || inBody || body.isEmpty) {
      // Prefer the shorter real person name from the body when title appended junk words.
      final preferred = bodyNames.cast<String?>().firstWhere(
            (bn) =>
                bn != null &&
                (n.toLowerCase().contains(bn.toLowerCase()) ||
                    bn.toLowerCase().contains(n.toLowerCase())),
            orElse: () => null,
          ) ??
          n;
      if (RegExp(r'net worth|biography|profile|career|wealth', caseSensitive: false)
              .hasMatch(title) ||
          inBody) {
        if (!centralPeople.contains(preferred)) centralPeople.add(preferred);
      }
    }
  }

  String subject = title.isNotEmpty ? title : 'trending social story';
  if (centralPeople.isNotEmpty &&
      RegExp(r'net worth', caseSensitive: false).hasMatch(title)) {
    subject = '${centralPeople.first} wealth / career profile';
  } else if (grounded) {
    final firstSentence = body.split(RegExp(r'(?<=[.!?])\s+')).first.trim();
    if (firstSentence.length >= 24) subject = firstSentence;
  }

  var tone = 'editorial social';
  if (RegExp(r'gossip|scandal|drama|affair', caseSensitive: false).hasMatch(lower)) {
    tone = 'entertainment gossip';
  } else if (RegExp(r'net worth|crore|wealth|business', caseSensitive: false).hasMatch(lower)) {
    tone = 'business profile';
  } else if (RegExp(r'cricket|match|ipl|football', caseSensitive: false).hasMatch(lower)) {
    tone = 'sports';
  }

  var visual = 'Symbolic editorial scene matching the story topic';
  if (tone == 'business profile' && centralPeople.isNotEmpty) {
    visual =
        'Professional editorial portrait context about career and wealth — '
        'boardroom, stadium suite, or profile feature aesthetic; '
        'feature ${centralPeople.first} only if a verified reference is attached';
  } else if (tone == 'sports') {
    visual = 'Sports editorial atmosphere tied to the match/career story';
  } else if (tone == 'entertainment gossip') {
    visual = 'Entertainment magazine-style scene matching the gossip topic';
  }

  final claim = grounded
      ? (body.length > 220 ? '${body.substring(0, 220).trimRight()}…' : body)
      : title;

  return TeaVisualContext(
    mainSubject: subject,
    centralClaim: claim,
    visualConcept: visual,
    peopleCentral: centralPeople,
    tone: tone,
    bodyGrounded: grounded,
  );
}
