import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'reddit_thread_comments.dart';
import 'tea_trending_storage.dart';

const shareNewsSuggestionsCacheKey = 'deite_share_news_suggestions_cache_v1';
const shareSuggestionsRouteStateKey = 'deite_share_suggestions_route_state_v1';
const shareNewsCardCacheTtlMs = 7 * 24 * 60 * 60 * 1000;
const shareNewsSuggestionsTtlMs = 7 * 24 * 60 * 60 * 1000;

Map<String, dynamic>? _pendingShareRouteExtra;

/// Synchronous in-memory staging — survives GoRouter extra loss on ShellRoute push.
void stageShareSuggestionsRoute(Map<String, dynamic> extra) {
  _pendingShareRouteExtra = Map<String, dynamic>.from(extra);
}

Map<String, dynamic>? takePendingShareSuggestionsRoute() {
  final staged = _pendingShareRouteExtra;
  _pendingShareRouteExtra = null;
  if (staged == null) return null;
  return Map<String, dynamic>.from(staged);
}

/// Stage in memory and prefs before navigating to share suggestions.
Future<void> prepareShareSuggestionsRoute(Map<String, dynamic> extra) async {
  stageShareSuggestionsRoute(extra);
  await persistShareSuggestionsRouteState(extra);
}

/// Persist share-page route payload so hot restart / lost GoRouter extra can recover.
Future<void> persistShareSuggestionsRouteState(Map<String, dynamic> extra) async {
  try {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(shareSuggestionsRouteStateKey, jsonEncode(extra));
  } catch (_) {}
}

Future<Map<String, dynamic>?> restoreShareSuggestionsRouteState() async {
  try {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(shareSuggestionsRouteStateKey);
    if (raw == null || raw.isEmpty) return null;
    final decoded = jsonDecode(raw);
    if (decoded is Map) return Map<String, dynamic>.from(decoded);
  } catch (_) {}
  return null;
}

Future<Map<String, dynamic>> _readJsonMap(String key) async {
  try {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(key);
    if (raw == null || raw.isEmpty) return {};
    final decoded = jsonDecode(raw);
    if (decoded is Map) return Map<String, dynamic>.from(decoded);
  } catch (_) {}
  return {};
}

Future<void> _writeJsonMap(String key, Map<String, dynamic> value) async {
  try {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(key, jsonEncode(value));
  } catch (_) {}
}

String normalizeUrlKey(String? url) => url?.trim() ?? '';

/// True when scrape/readers returned HTTP block pages instead of article content.
bool isScrapeBlockedBoilerplate(String? text) {
  final s = '${text ?? ''}'.trim();
  if (s.isEmpty) return false;
  final lower = s.toLowerCase().replaceAll(RegExp(r'\s+'), ' ');
  return RegExp(
    r'403\s*:?\s*forbidden|target url returned error|you.?ve been blocked|network security|access denied|use your developer token|file a ticket below',
    caseSensitive: false,
  ).hasMatch(lower);
}

/// Prefer a clean seed title when enrichment returned scrape/block boilerplate.
String resolveTeaDisplayTitle(String headline, [String? seedTitle]) {
  final head = cleanTeaCardTitle(headline);
  final seed = cleanTeaCardTitle(seedTitle);
  if (head.isNotEmpty && !isScrapeBlockedBoilerplate(head)) return head;
  if (seed.isNotEmpty && !isScrapeBlockedBoilerplate(seed)) return seed;
  return head.isNotEmpty ? head : seed;
}

bool teaCardContentIsBlocked({
  String? headline,
  String? summary,
  String? description,
  String? bodyText,
}) {
  return isScrapeBlockedBoilerplate(headline) ||
      isScrapeBlockedBoilerplate(summary) ||
      isScrapeBlockedBoilerplate(description) ||
      isScrapeBlockedBoilerplate(bodyText);
}

/// Strip HTML tags from RSS / scrape descriptions for display and AI prompts.
String stripHtmlBoilerplate(String? text) {
  var s = '${text ?? ''}';
  if (s.isEmpty) return '';
  s = s.replaceAll(RegExp(r'<[^>]+>'), ' ');
  s = s.replaceAll(RegExp(r'&nbsp;', caseSensitive: false), ' ');
  s = s.replaceAll(RegExp(r'&amp;', caseSensitive: false), '&');
  s = s.replaceAll(RegExp(r'&lt;', caseSensitive: false), '<');
  s = s.replaceAll(RegExp(r'&gt;', caseSensitive: false), '>');
  s = s.replaceAll(RegExp(r'&quot;', caseSensitive: false), '"');
  s = s.replaceAll(RegExp(r'&#39;', caseSensitive: false), "'");
  return s.replaceAll(RegExp(r'\s+'), ' ').trim();
}

bool isTeaSourceLabel(String? source) {
  final s = (source ?? '').trim();
  return RegExp(r'^r/', caseSensitive: false).hasMatch(s);
}

/// Neutral source label for share payloads — keeps Tea mode via URL, hides subreddit names.
String publicTeaSourceLabel([String? source]) {
  if (isTeaSourceLabel(source) || '${source ?? ''}'.trim().toLowerCase() == 'reddit') {
    return 'Tea';
  }
  final s = '${source ?? ''}'.trim();
  return s.isEmpty ? 'Tea' : s;
}

String stripSubredditMentionsFromText(String? text) {
  var s = '${text ?? ''}';
  s = s.replaceAll(RegExp(r'\bSubreddit:\s*r/[A-Za-z0-9_]+\b', caseSensitive: false), '');
  s = s.replaceAll(RegExp(r'\br/[A-Za-z0-9_]+\b'), '');
  s = s.replaceAll(RegExp(r'\bsubreddit\b', caseSensitive: false), '');
  return s.replaceAll(RegExp(r'\s+'), ' ').trim();
}

bool isRedditTeaThreadUrl(String? url) => isRedditThreadUrl(url);

/// Remove URLs and scrape metadata from text shown in share posts.
String stripUrlsAndSourceNoise(String? text) {
  var s = stripRedditDisplayBoilerplate(text);
  s = s.replaceAll(RegExp(r'https?://[^\s\])<>"{}|\\^`]+', caseSensitive: false), ' ');
  s = s.replaceAll(RegExp(r'\bSource\s*[-:]\s*', caseSensitive: false), '');
  s = s.replaceAll(RegExp(r'\bRead more:\s*', caseSensitive: false), '');
  s = s.replaceAll(RegExp(r'\s+'), ' ').trim();
  return s;
}

/// Final polish for Tea card summaries — no links, no Reddit/platform mentions.
String sanitizeTeaCardSummary(String? text) {
  var s = stripUrlsAndSourceNoise(text);
  if (s.isEmpty) return '';

  s = s
      .replaceAll(RegExp(r'\br/[A-Za-z0-9_]+\b'), '')
      .replaceAll(RegExp(r'\bPeople on Reddit\b', caseSensitive: false), 'People')
      .replaceAll(RegExp(r'\bReddit users?\b', caseSensitive: false), 'People')
      .replaceAll(RegExp(r'\b(?:on|from|in|via)\s+Reddit\b', caseSensitive: false), '')
      .replaceAll(RegExp(r'\bReddit\b', caseSensitive: false), '')
      .replaceAll(RegExp(r'\bsubreddit\b', caseSensitive: false), '')
      .replaceAll(RegExp(r'\bReddit community\b', caseSensitive: false), '')
      .replaceAll(RegExp(r'\bonline discussion\b', caseSensitive: false), 'buzz')
      .replaceAll(RegExp(r'\bonline discussions\b', caseSensitive: false), 'buzz')
      .replaceAll(RegExp(r'\bURL Source\b', caseSensitive: false), '')
      .replaceAll(RegExp(r'https?://[^\s\])<>"{}|\\^`]+', caseSensitive: false), '')
      .replaceAll(RegExp(r'\s+,', caseSensitive: false), ',')
      .replaceAll(RegExp(r'\s+\.', caseSensitive: false), '.')
      .replaceAll(RegExp(r'\s{2,}'), ' ')
      .trim();

  s = s.replaceFirst(RegExp(r'^,\s*'), '');
  s = s.replaceFirst(RegExp(r'^\.\s*'), '');
  return clampTeaCardSummaryWords(s);
}

bool teaTextLooksLikeTitleEcho(String text, String title) {
  final n = text.replaceAll(RegExp(r'\s+'), ' ').trim().toLowerCase();
  final t = title.replaceAll(RegExp(r'\s+'), ' ').trim().toLowerCase();
  if (t.isEmpty || n.isEmpty) return false;
  if (n == t) return true;
  if (t.length >= 20 && n.contains(t)) return true;
  if (n.length <= t.length + 24 && t.contains(n)) return true;
  return false;
}

/// True when the summary only repeats the headline with filler, not real substance.
bool teaCardSummaryLooksLikeTitleOnly(String summary, [String? headline]) {
  final head = cleanTeaCardTitle(headline);
  if (head.isEmpty) return false;
  final sum = summary.replaceAll(RegExp(r'\s+'), ' ').trim();
  if (sum.isEmpty) return false;
  if (teaTextLooksLikeTitleEcho(sum, head)) return true;
  final sumLower = sum.toLowerCase();
  final headLower = head.toLowerCase();
  if (!sumLower.contains(headLower)) return false;
  if (RegExp(
    r'^people are (reacting|debating)\b',
    caseSensitive: false,
  ).hasMatch(sum)) {
    return teaCardSummaryWordCount(sum) <= 45;
  }
  final stripped = sumLower
      .replaceAll(headLower, '')
      .replaceAll(RegExp(r'people are reacting to\s*'), '')
      .replaceAll(RegExp(r'people are debating\s*'), '')
      .replaceAll(RegExp(r'and sharing mixed takes on what stood out\.?'), '')
      .replaceAll(RegExp(r', comparing it to other films and questioning whether key scenes were borrowed\.?'), '')
      .trim();
  return stripped.length < 28;
}

bool teaCardSummaryHasDisplayIssues(
  String summary, [
  Map<String, dynamic>? details,
  String? headline,
]) {
  final head = headline ?? cleanTeaCardTitle('${details?['title'] ?? ''}');
  return isScrapeBlockedBoilerplate(summary) ||
      teaCardSummaryTooLong(summary) ||
      teaCardSummaryLooksLikeRawScrape(summary, details) ||
      teaCardSummaryLooksLikeTitleOnly(summary, head) ||
      RegExp(r'https?://', caseSensitive: false).hasMatch(summary) ||
      RegExp(r'\bReddit\b', caseSensitive: false).hasMatch(summary) ||
      RegExp(r'\br/[A-Za-z0-9_]+\b', caseSensitive: false).hasMatch(summary) ||
      RegExp(r'\bSubreddit\b', caseSensitive: false).hasMatch(summary) ||
      RegExp(r'URL Source', caseSensitive: false).hasMatch(summary);
}

/// Final polish for Tea suggestion card text — no links or scrape noise.
String sanitizeTeaSharePostForDisplay(String? text) {
  var s = stripUrlsAndSourceNoise(text);
  s = sanitizeTeaShareText(s);
  s = s.replaceAll(RegExp(r'https?://[^\s\])<>"{}|\\^`]+', caseSensitive: false), '');
  s = s.replaceAll(RegExp(r'\bRead more:\s*', caseSensitive: false), '');
  return s.replaceAll(RegExp(r'\s+'), ' ').trim();
}

bool teaSuggestionPostsLookLikeRawScrape(List<Map<String, String>> posts) {
  for (final item in posts) {
    final post = '${item['post'] ?? ''}';
    if (RegExp(r'https?://', caseSensitive: false).hasMatch(post)) return true;
    if (RegExp(r'\bSource\s*[-:]', caseSensitive: false).hasMatch(post)) return true;
    if (post.contains('The discourse on this is wild')) return true;
    if (post.contains('And the replies are saying:')) return true;
  }
  return false;
}

const int teaCardSummaryMaxWords = 60;

int teaCardSummaryWordCount(String text) =>
    text.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).length;

bool teaCardSummaryTooLong(String summary, [int maxWords = teaCardSummaryMaxWords]) =>
    teaCardSummaryWordCount(summary) > maxWords;

String clampTeaCardSummaryWords(String? text, [int maxWords = teaCardSummaryMaxWords]) {
  final words = '${text ?? ''}'.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
  if (words.isEmpty) return '';
  if (words.length <= maxWords) return words.join(' ');
  return '${words.take(maxWords).join(' ').trimRight()}…';
}

/// True when a Tea card summary looks like a pasted post/comment, not an AI explainer.
bool teaCardSummaryLooksLikeRawScrape(String summary, [Map<String, dynamic>? details]) {
  final s = summary.trim();
  if (s.isEmpty) return false;
  if (RegExp(r'https?://', caseSensitive: false).hasMatch(s)) return true;
  if (RegExp(r'\bSource\s*[-:]', caseSensitive: false).hasMatch(s)) return true;
  if (RegExp(r'Comment by u/', caseSensitive: false).hasMatch(s)) return true;
  if (RegExp(r'\bSubreddit:\s*r/', caseSensitive: false).hasMatch(s)) return true;
  if (details != null) {
    final snippets = extractRedditContentSnippets(details);
    final sumNorm = s.replaceAll(RegExp(r'\s+'), ' ').trim().toLowerCase();
    for (final snippet in snippets) {
      final norm = snippet.replaceAll(RegExp(r'\s+'), ' ').trim().toLowerCase();
      if (norm.length < 36) continue;
      final probeLen = norm.length > 96 ? 96 : norm.length;
      final probe = norm.substring(0, probeLen);
      if (sumNorm.contains(probe)) return true;
    }
  }
  return false;
}

/// Clean Reddit/Tea article fields before sending to AI or local templates.
Map<String, dynamic> prepareTeaArticleContextForAi(Map<String, dynamic> article) {
  final title = cleanTeaCardTitle('${article['title'] ?? ''}');
  final snippets = extractRedditContentSnippets(article)
      .map(stripUrlsAndSourceNoise)
      .where((s) => s.length >= 20)
      .toList();
  final gossip = stripSubredditMentionsFromText(
    stripUrlsAndSourceNoise(
      snippets.isNotEmpty
          ? snippets.take(3).join('\n\n')
          : '${article['gossip'] ?? article['description'] ?? ''}',
    ),
  );
  final articleText = snippets.isEmpty
      ? stripSubredditMentionsFromText(stripUrlsAndSourceNoise('${article['text'] ?? ''}'))
      : [
          'Thread title: $title',
          'What people are saying:',
          ...snippets.take(4).map((s) => '• $s'),
        ].join('\n');
  return {
    ...article,
    'description': gossip,
    'gossip': gossip,
    'text': articleText,
  };
}

/// Extract post body + top comment snippets for share suggestions.
List<String> extractRedditContentSnippets(Map<String, dynamic>? article, {int maxParts = 4}) {
  if (article == null) return [];
  final title = '${article['title'] ?? ''}'.trim();
  final seen = <String>{};
  final parts = <String>[];

  void add(String? raw, {int minLen = 20}) {
    final s = stripRedditDisplayBoilerplate(raw);
    if (s.length < minLen) return;
    if (s == title) return;
    final key = s.toLowerCase();
    if (seen.contains(key)) return;
    seen.add(key);
    parts.add(s);
  }

  add('${article['selftext'] ?? ''}', minLen: 12);
  add('${article['gossip'] ?? ''}');
  add('${article['description'] ?? ''}');

  final text = '${article['text'] ?? ''}'.trim();
  final postBody = RegExp(r'Post body:\s*(.+?)(?=\n\n|\Z)', dotAll: true)
      .firstMatch(text)
      ?.group(1)
      ?.replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  add(postBody);

  final re = RegExp(
    r'Comment by u/[^:]+:\s*(.+?)(?=\n\nComment by u/|\Z)',
    dotAll: true,
    caseSensitive: false,
  );
  for (final m in re.allMatches(text)) {
    add(m.group(1));
    if (parts.length >= maxParts) break;
  }

  return parts.take(maxParts).toList();
}

/// Instant share suggestions when AI / scraping is slow or unavailable.
List<Map<String, String>> buildLocalTeaShareSuggestions(
  Map<String, dynamic> article,
  String platform,
) {
  final title = '${article['title'] ?? ''}'.trim();
  final snippets = extractRedditContentSnippets(article)
      .map(stripUrlsAndSourceNoise)
      .where((s) => s.length >= 12)
      .toList();
  final body = snippets.isNotEmpty ? snippets.first : title;
  final second = snippets.length > 1 ? snippets[1] : '';
  final third = snippets.length > 2 ? snippets[2] : '';
  final maxLen = platform == 'x' ? 220 : 650;

  String clip(String s) {
    final clean = stripUrlsAndSourceNoise(s);
    if (clean.isEmpty) return '';
    return clean.length <= maxLen ? clean : '${clean.substring(0, maxLen).trimRight()}…';
  }

  final posts = <Map<String, String>>[
    {
      'eventLabel': 'Hot take',
      'post': clip(
        second.isNotEmpty
            ? 'Okay but the internet is not holding back on this one.\n\n$title\n\nThe part that got me: $second'
            : 'Hot take: $title\n\n$body',
      ),
    },
    {
      'eventLabel': 'Real talk',
      'post': clip(
        second.isNotEmpty
            ? 'Real talk on "$title" — the conversation keeps circling one point: people think the setup does not quite add up, and the replies are split on whether it is sloppy writing or intentional.'
            : 'Real talk: "$title" is getting a lot of traction — worth reading the thread before you pick a side.',
      ),
    },
    {
      'eventLabel': 'Question',
      'post': clip(
        second.isNotEmpty
            ? '$title\n\nSomeone said: "$second"\n\nGenuine question — do you agree with that read?'
            : '$title\n\nCurious where you all land on this.',
      ),
    },
    {
      'eventLabel': 'Different angle',
      'post': clip(
        third.isNotEmpty
            ? 'Everyone is stuck on the headline, but this take changed my read:\n\n"$third"'
            : second.isNotEmpty
                ? 'Less about the drama, more about this point:\n\n"$second"'
                : 'Unpopular angle on "$title" — worth a real conversation.',
      ),
    },
  ];

  return posts.where((p) => (p['post'] ?? '').trim().isNotEmpty).take(4).toList();
}

String clampText(String? s, int maxLen) {
  final t = s?.trim() ?? '';
  if (t.isEmpty) return '';
  if (t.length <= maxLen) return t;
  return '${t.substring(0, maxLen - 1).trimRight()}…';
}

Map<String, dynamic>? buildCacheableArticleDetails(Map<String, dynamic>? details) {
  if (details == null) return null;
  final url = '${details['url'] ?? ''}'.trim();
  final title = '${details['title'] ?? ''}'.trim();
  if (url.isEmpty || title.isEmpty) return null;
  return {
    'title': title,
    'url': url,
    'description': clampText('${details['description'] ?? ''}', 600),
    'image': details['image'] is String && '${details['image']}'.trim().isNotEmpty
        ? '${details['image']}'.trim()
        : null,
    'source': '${details['source'] ?? ''}'.trim(),
    'publisherUrl': '${details['publisherUrl'] ?? ''}'.trim(),
    'text': clampText('${details['text'] ?? ''}', 8000),
  };
}

Future<Map<String, dynamic>?> getCachedNewsCardForUrl(String url) async {
  final key = normalizeUrlKey(url);
  if (key.isEmpty) return null;
  final cache = await _readJsonMap(shareNewsCardCacheKey);
  final entry = cache[key];
  if (entry is! Map) return null;
  final ts = entry['ts'] is num ? (entry['ts'] as num).toInt() : 0;
  if (ts == 0 || DateTime.now().millisecondsSinceEpoch - ts > shareNewsCardCacheTtlMs) {
    return null;
  }
  return Map<String, dynamic>.from(entry);
}

Future<void> upsertCachedNewsCard({
  required String url,
  String headline = '',
  String summary = '',
  Map<String, dynamic>? details,
  String? source,
}) async {
  final key = normalizeUrlKey(url);
  if (key.isEmpty) return;
  final h = headline.trim();
  final s = summary.trim();
  final d = buildCacheableArticleDetails(details);
  if (h.isEmpty && s.isEmpty && d == null) return;

  final cache = await _readJsonMap(shareNewsCardCacheKey);
  cache[key] = {
    'ts': DateTime.now().millisecondsSinceEpoch,
    'kind': isTeaSourceLabel(source) ? 'tea' : 'news',
    'headline': h,
    'summary': s,
    'details': d,
  };
  await _writeJsonMap(shareNewsCardCacheKey, cache);
}

Future<List<Map<String, String>>?> getCachedShareSuggestionsForUrl(
  String url,
  String platform,
) async {
  final key = normalizeUrlKey(url);
  final p = platform.trim().toLowerCase();
  if (key.isEmpty || p.isEmpty) return null;

  final cache = await _readJsonMap(shareNewsSuggestionsCacheKey);
  final byUrl = cache[key];
  if (byUrl is! Map) return null;
  final entry = byUrl[p];
  if (entry is! Map) return null;
  final ts = entry['ts'] is num ? (entry['ts'] as num).toInt() : 0;
  if (ts == 0 || DateTime.now().millisecondsSinceEpoch - ts > shareNewsSuggestionsTtlMs) {
    return null;
  }
  final posts = entry['posts'];
  if (posts is! List || posts.isEmpty) return null;

  return posts.map((x) {
    if (x is Map) {
      return {
        'eventLabel': '${x['eventLabel'] ?? 'News'}',
        'post': '${x['post'] ?? ''}',
      };
    }
    return {'eventLabel': 'News', 'post': '$x'};
  }).toList();
}

Future<void> setCachedShareSuggestionsForUrl(
  String url,
  String platform,
  List<Map<String, String>> posts,
) async {
  final key = normalizeUrlKey(url);
  final p = platform.trim().toLowerCase();
  if (key.isEmpty || p.isEmpty || posts.isEmpty) return;

  final cache = await _readJsonMap(shareNewsSuggestionsCacheKey);
  final prev = cache[key] is Map ? Map<String, dynamic>.from(cache[key] as Map) : <String, dynamic>{};
  prev[p] = {
    'ts': DateTime.now().millisecondsSinceEpoch,
    'posts': posts,
  };
  cache[key] = prev;
  await _writeJsonMap(shareNewsSuggestionsCacheKey, cache);
}

/// Port of sanitizeTeaShareText in ShareSuggestionsPage.js
String sanitizeTeaShareText(String? text) {
  var s = stripRedditDisplayBoilerplate(text);
  s = s.replaceAll(RegExp(r'\s+'), ' ').trim();
  if (s.isEmpty) return '';

  final protectedUrls = <String>[];
  s = s.replaceAllMapped(RegExp(r'https?://[^\s\])<>"{}|\\^`]+', caseSensitive: false), (m) {
    final idx = protectedUrls.length;
    protectedUrls.add(m.group(0)!);
    return '<<TEA_URL_$idx>>';
  });

  s = s
      .replaceAll(RegExp(r'\br/[A-Za-z0-9_]+\b'), '')
      .replaceAll(RegExp(r'(?<![\w./])reddit(?![\w.])', caseSensitive: false), '')
      .replaceAll(RegExp(r'\bsubreddit\b', caseSensitive: false), '')
      .replaceAll(RegExp(r'\bReddit community\b', caseSensitive: false), '')
      .replaceAll(RegExp(r'\bthread\b', caseSensitive: false), 'discussion')
      .replaceAll(RegExp(r'\bcommunity\b', caseSensitive: false), 'people')
      .replaceAll(RegExp(r'\busers\b', caseSensitive: false), 'people');

  s = s.replaceFirst(RegExp(r'^in (?:a|an) discussion on,\s*', caseSensitive: false), "Here's the tea: ");
  s = s.replaceFirst(RegExp(r'^in (?:a|an) discussion,\s*', caseSensitive: false), "Here's the tea: ");

  s = s
      .replaceAll(RegExp(r'\bdiscussions on\s*\.', caseSensitive: false), 'chatter.')
      .replaceAll(RegExp(r'\bdiscussions on\s*,', caseSensitive: false), 'chatter,')
      .replaceAll(RegExp(r'\bonline discussions\b', caseSensitive: false), 'chatter')
      .replaceAll(RegExp(r'\bonline discussion\b', caseSensitive: false), 'chatter')
      .replaceAll(RegExp(r'\bsparking discussions on [,.:]', caseSensitive: false), 'stirring up chatter ')
      .replaceAll(RegExp(r'\bsparking online discussions [,.:]?', caseSensitive: false), 'stirring up chatter ')
      .replaceAll(RegExp(r'\bsparking discussions\b', caseSensitive: false), 'stirring up chatter')
      .replaceAll(RegExp(r'\bstirring up chatter people\b', caseSensitive: false), 'stirring up chatter')
      .replaceAll(RegExp(r'\s+,'), ',')
      .replaceAll(RegExp(r'\s+\.'), '.')
      .replaceAll(RegExp(r'\s+;'), ';')
      .replaceAll(RegExp(r'\s+:'), ':')
      .replaceAll(RegExp(r'\(\s*\)'), '')
      .replaceAll(RegExp(r'\s{2,}'), ' ')
      .trim();

  s = s.replaceFirst(RegExp(r'^the (?:discussion|chatter)', caseSensitive: false), "Here's the tea");
  s = s.replaceFirst(RegExp(r'^people (?:speculated|discussed)', caseSensitive: false), 'The buzz is');
  s = s.replaceFirstMapped(RegExp(r'([.!?]\s+)people\b'), (m) => '${m[1]}People');

  for (var i = 0; i < protectedUrls.length; i++) {
    s = s.replaceAll('<<TEA_URL_$i>>', protectedUrls[i]);
  }

  return s;
}

List<Map<String, String>> cleanCachedNewsSuggestions(
  List<Map<String, String>> posts, {
  required bool isTea,
}) {
  return posts.map((item) {
    var post = item['post'] ?? '';
    if (isTea) post = sanitizeTeaSharePostForDisplay(post);
    return {
      'eventLabel': item['eventLabel'] ?? 'News',
      'post': post,
    };
  }).toList();
}

/// Readable gossip blurb for Tea cards from Reddit thread/article details.
String buildRedditGossipSummary(Map<String, dynamic>? details) {
  if (details == null) return '';
  final title = '${details['title'] ?? ''}'.trim();
  final gossip = '${details['gossip'] ?? details['description'] ?? ''}'.trim();
  if (gossip.isNotEmpty && gossip != title) return sanitizeTeaShareText(gossip);

  final selftext = '${details['selftext'] ?? ''}'.trim();
  if (selftext.isNotEmpty && selftext != title) return sanitizeTeaShareText(selftext);

  final snippets = extractRedditContentSnippets(details);
  if (snippets.isNotEmpty) return sanitizeTeaShareText(snippets.join(' '));

  final text = '${details['text'] ?? ''}'.trim();
  if (text.isEmpty) return '';

  final commentBodies = <String>[];
  final re = RegExp(
    r'Comment by u/[^:]+:\s*(.+?)(?=\n\nComment by u/|\Z)',
    dotAll: true,
    caseSensitive: false,
  );
  for (final m in re.allMatches(text)) {
    final body = (m.group(1) ?? '').replaceAll(RegExp(r'\s+'), ' ').trim();
    if (body.length > 24) commentBodies.add(body);
    if (commentBodies.length >= 3) break;
  }

  if (commentBodies.isNotEmpty) {
    return sanitizeTeaShareText(commentBodies.join(' '));
  }

  final postBody = RegExp(r'Post body:\s*(.+?)(?=\n\n|\Z)', dotAll: true)
      .firstMatch(text)
      ?.group(1)
      ?.replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  if (postBody != null && postBody.length > 20) {
    return sanitizeTeaShareText(postBody);
  }

  return '';
}

/// Compress thread snippets into a short news-style Tea card summary.
String buildLocalTeaCardSummary(
  Map<String, dynamic>? details, {
  String? headlineFallback,
}) {
  var title = cleanTeaCardTitle('${details?['title'] ?? ''}');
  if (title.isEmpty) title = cleanTeaCardTitle(headlineFallback);

  final snippets = extractRedditContentSnippets(details, maxParts: 5)
      .map(stripUrlsAndSourceNoise)
      .where((s) => s.length >= 24 && !teaTextLooksLikeTitleEcho(s, title))
      .toList();

  var source = snippets.take(3).join(' ');
  if (source.isEmpty) {
    source = stripUrlsAndSourceNoise(
      [
        details?['selftext'],
        details?['gossip'],
        details?['description'],
      ].whereType<String>().join(' '),
    ).trim();
    if (teaTextLooksLikeTitleEcho(source, title)) source = '';
  }
  if (source.isEmpty) return '';

  final sentences = source
      .split(RegExp(r'(?<=[.!?])\s+'))
      .map((s) => s.replaceAll(RegExp(r'\s+'), ' ').trim())
      .where((s) => s.length >= 16 && !teaTextLooksLikeTitleEcho(s, title))
      .toList();

  final buffer = StringBuffer();
  var wordCount = 0;
  for (final sentence in sentences) {
    final w = teaCardSummaryWordCount(sentence);
    if (wordCount > 0 && wordCount + w > teaCardSummaryMaxWords) break;
    if (buffer.isNotEmpty) buffer.write(' ');
    buffer.write(sentence);
    wordCount += w;
    if (wordCount >= 28) break;
  }

  var out = buffer.toString().trim();
  if (out.isEmpty) {
    final words = source.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
    out = words.take(teaCardSummaryMaxWords).join(' ');
  }

  final cleaned = sanitizeTeaCardSummary(out);
  if (cleaned.isEmpty || teaCardSummaryLooksLikeTitleOnly(cleaned, title)) return '';
  return cleaned;
}

/// Local fallback when AI summary is unavailable — port of ShareSuggestionsPage.js
String buildLocalNewsCardSummary(Map<String, dynamic>? details) {
  try {
    if (details == null) return '';
    final title = '${details['title'] ?? ''}'.trim();
    final text = '${details['text'] ?? ''}'.trim();
    final isRedditThread = RegExp(
      r'Subreddit:\s*r/|Top comments:|Comment by u/',
      caseSensitive: false,
    ).hasMatch(text);
    if (isRedditThread) return buildLocalTeaCardSummary(details);

    final redditGossip = buildRedditGossipSummary(details);
    if (redditGossip.isNotEmpty) return redditGossip;

    final description = '${details['description'] ?? ''}'.trim();

    const maxWords = 78;
    final titleNorm = title.replaceAll(RegExp(r'\s+'), ' ').trim().toLowerCase();
    final descNorm = description.replaceAll(RegExp(r'\s+'), ' ').trim().toLowerCase();
    final descIsHeadline = description.isEmpty ||
        descNorm == titleNorm ||
        (titleNorm.length > 12 &&
            (titleNorm.contains(descNorm) || descNorm.contains(titleNorm)));

    if (title.isEmpty) return '';
    if (text.length < 280) return '';

    final body = text.replaceAll(RegExp(r'\s+'), ' ').trim();
    final extra = !descIsHeadline && description.isNotEmpty ? ' $description' : '';
    final combined = '$body$extra'.replaceAll(RegExp(r'\s+'), ' ').trim();
    final words = combined.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
    final limited = words.take(maxWords).join(' ');
    final out = limited.replaceAll(RegExp(r'\s+'), ' ').trim();
    final outNorm = out.toLowerCase();
    if (out.isEmpty || outNorm == titleNorm) return '';
    return out;
  } catch (_) {
    return '';
  }
}
