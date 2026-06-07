import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'tea_trending_storage.dart';

const shareNewsSuggestionsCacheKey = 'deite_share_news_suggestions_cache_v1';
const shareNewsCardCacheTtlMs = 7 * 24 * 60 * 60 * 1000;
const shareNewsSuggestionsTtlMs = 7 * 24 * 60 * 60 * 1000;

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

bool isTeaSourceLabel(String? source) {
  final s = (source ?? '').trim();
  return RegExp(r'^r/', caseSensitive: false).hasMatch(s);
}

bool isRedditTeaThreadUrl(String? url) {
  final u = (url ?? '').trim();
  return RegExp(r'reddit\.com/r/[^\s/]+/comments/', caseSensitive: false).hasMatch(u);
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
  var s = (text ?? '').replaceAll(RegExp(r'\s+'), ' ').trim();
  if (s.isEmpty) return '';

  s = s
      .replaceAll(RegExp(r'\br/[A-Za-z0-9_]+\b'), '')
      .replaceAll(RegExp(r'\bReddit\b', caseSensitive: false), '')
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

  return s;
}

List<Map<String, String>> cleanCachedNewsSuggestions(
  List<Map<String, String>> posts, {
  required bool isTea,
}) {
  return posts.map((item) {
    var post = item['post'] ?? '';
    if (isTea) post = sanitizeTeaShareText(post);
    return {
      'eventLabel': item['eventLabel'] ?? 'News',
      'post': post,
    };
  }).toList();
}

/// Readable gossip blurb for Tea cards from Reddit thread/article details.
String buildRedditGossipSummary(Map<String, dynamic>? details) {
  if (details == null) return '';
  final gossip = '${details['gossip'] ?? details['description'] ?? ''}'.trim();
  if (gossip.isNotEmpty) return sanitizeTeaShareText(gossip);

  final selftext = '${details['selftext'] ?? ''}'.trim();
  if (selftext.isNotEmpty) return sanitizeTeaShareText(selftext);

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

/// Local fallback when AI summary is unavailable — port of ShareSuggestionsPage.js
String buildLocalNewsCardSummary(Map<String, dynamic>? details) {
  try {
    if (details == null) return '';
    final redditGossip = buildRedditGossipSummary(details);
    if (redditGossip.isNotEmpty) return redditGossip;

    final title = '${details['title'] ?? ''}'.trim();
    final description = '${details['description'] ?? ''}'.trim();
    final text = '${details['text'] ?? ''}'.trim();

    if (RegExp(r'Subreddit:\s*r/|Top comments:|Comment by u/', caseSensitive: false)
        .hasMatch(text)) {
      return '';
    }

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
