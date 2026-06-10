import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../lib/pod_reddit_hot.dart';
import '../services/reddit_tea_service.dart';

class RedditComment {
  RedditComment({
    required this.id,
    required this.author,
    required this.body,
    required this.score,
    this.createdUtc,
  });

  final String id;
  final String author;
  final String body;
  final int score;
  final double? createdUtc;
}

class RedditCommentsResult {
  RedditCommentsResult({required this.ok, this.comments = const [], this.error});

  final bool ok;
  final List<RedditComment> comments;
  final String? error;
}

/// Repair common corrupted Reddit URLs (e.g. reddit stripped from host).
String? normalizeRedditDiscussionUrl(String? url) {
  var u = (url ?? '').trim();
  if (u.isEmpty) return null;
  u = u.replaceAll(RegExp(r'www\.\.com', caseSensitive: false), 'www.reddit.com');
  u = u.replaceAll(RegExp(r'https?:///+'), 'https://');
  u = u.replaceAll('://www.reddit.com//', '://www.reddit.com/');
  if (!u.startsWith('http')) u = 'https://$u';
  try {
    final parsed = Uri.parse(u);
    final host = parsed.host.toLowerCase();
    if (!host.contains('reddit.com')) return null;
    if (!RegExp(r'/comments/[a-z0-9]+', caseSensitive: false).hasMatch(parsed.path)) {
      return null;
    }
    return u.split('?').first.replaceAll(RegExp(r'/$'), '');
  } catch (_) {
    return null;
  }
}

dynamic _safeJsonDecode(String body) {
  final t = body.trim();
  if (t.isEmpty) return null;
  if (t.startsWith('<') || t.startsWith('<!')) return null;
  try {
    return jsonDecode(t);
  } catch (_) {
    return null;
  }
}

/// Readable thread text via Jina when Reddit `.json` is blocked (returns HTML).
Future<Map<String, dynamic>?> fetchRedditThreadViaJina(
  String permalink, {
  Map<String, dynamic>? seed,
}) async {
  final normalized = normalizeRedditDiscussionUrl(permalink);
  if (normalized == null) return null;
  final path = normalized.replaceFirst(RegExp(r'^https?://', caseSensitive: false), '');
  final seedTitle = '${seed?['title'] ?? ''}'.trim();
  final endpoints = [
    'https://r.jina.ai/https://$path',
    'https://r.jina.ai/http://$path',
  ];

  for (final readerUrl in endpoints) {
    try {
      final res = await http
          .get(
            Uri.parse(readerUrl),
            headers: const {'Accept': 'text/plain', 'User-Agent': 'DeiteNews/1.0'},
          )
          .timeout(const Duration(seconds: 28));
      if (res.statusCode < 200 || res.statusCode >= 300) continue;
      var body = res.body.trim();
      if (body.length < 80) continue;
      final lower = body.toLowerCase();
      if (lower.contains('403 forbidden') || lower.contains('access denied')) continue;

      var title = seedTitle;
      final titleLine = RegExp(r'^Title:\s*(.+)$', multiLine: true).firstMatch(body);
      if (titleLine != null) title = titleLine.group(1)!.trim();
      title = cleanTeaCardTitle(title);
      if (title.isEmpty && seedTitle.isNotEmpty) title = cleanTeaCardTitle(seedTitle);

      var content = body;
      if (title.isNotEmpty) {
        final idx = body.indexOf(title);
        if (idx >= 0) {
          content = body.substring(idx + title.length).trim();
        }
      }
      content = content
          .replaceAll(RegExp(r'^URL Source:.*$', multiLine: true), '')
          .replaceAll(RegExp(r'^Markdown Content:.*$', multiLine: true), '')
          .replaceAll(RegExp(r'\s+'), ' ')
          .trim();
      if (content.length < 40) continue;

      final gossip = content.length > 1400 ? '${content.substring(0, 1400).trimRight()}…' : content;
      return {
        'title': title.isNotEmpty ? title : seedTitle,
        'url': normalized,
        'description': gossip,
        'gossip': gossip,
        'selftext': gossip,
        'text': 'Title: ${title.isNotEmpty ? title : seedTitle}\n\nPost body:\n$gossip',
        'source': '${seed?['source'] ?? 'r/BollyBlindsNGossip'}',
        'image': seed?['image'],
      };
    } catch (_) {}
  }
  return null;
}

String? buildRedditThreadRssUrl(String discussionUrl) {
  final normalized = normalizeRedditDiscussionUrl(discussionUrl);
  if (normalized == null) return null;
  final full = RegExp(
    r'^(https?://[^/]+/r/[^/]+/comments/[a-z0-9]+)',
    caseSensitive: false,
  ).firstMatch(normalized);
  if (full != null) return '${full.group(1)!}/.rss';
  final short = RegExp(
    r'^(https?://[^/]+/comments/[a-z0-9]+)',
    caseSensitive: false,
  ).firstMatch(normalized);
  if (short != null) return '${short.group(1)!}/.rss';
  return null;
}

/// Remove Reddit RSS/HTML footer noise from display text.
String stripRedditDisplayBoilerplate(String? text) {
  final rawInput = '${text ?? ''}';
  var s = rawInput;
  s = s.replaceAllMapped(RegExp(r'&#(\d+);'), (m) {
    final code = int.tryParse(m.group(1)!);
    if (code == null || code < 1 || code > 0x10FFFF) return m.group(0)!;
    return String.fromCharCode(code);
  });
  s = s.replaceAllMapped(RegExp(r'&#x([0-9a-fA-F]+);', caseSensitive: false), (m) {
    final code = int.tryParse(m.group(1)!, radix: 16);
    if (code == null || code < 1 || code > 0x10FFFF) return m.group(0)!;
    return String.fromCharCode(code);
  });
  s = s
      .replaceAll('&nbsp;', ' ')
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'");

  s = s.replaceAll(RegExp(r'\s+'), ' ').trim();
  s = s.replaceAll(
    RegExp(
      r'\s*submitted\s+by\s+/u/[A-Za-z0-9_-]+\s*(\[link\]\s*)?(\[comments\]\s*)?',
      caseSensitive: false,
    ),
    ' ',
  );
  s = s.replaceAll(RegExp(r'\[link\]', caseSensitive: false), '');
  s = s.replaceAll(RegExp(r'\[comments\]', caseSensitive: false), '');
  s = s.replaceAll(RegExp(r'\s+/u/[A-Za-z0-9_-]+\s*'), ' ');
  s = s.replaceAll(RegExp(r'\bsubmitted\s+by\b', caseSensitive: false), '');
  s = s.replaceAll(RegExp(r'URL Source:\s*[^\s]+', caseSensitive: false), ' ');
  s = s.replaceAll(RegExp(r'Markdown Content:\s*', caseSensitive: false), ' ');
  return s.replaceAll(RegExp(r'\s+'), ' ').trim();
}

/// Clean a Tea headline/title — drop URL-only scrape junk.
String cleanTeaCardTitle(String? raw) {
  var s = stripRedditDisplayBoilerplate(raw);
  s = s.replaceAll(RegExp(r'https?://[^\s\])<>"{}|\\^`]+', caseSensitive: false), ' ');
  s = s.replaceAll(RegExp(r'\bURL Source\b', caseSensitive: false), '');
  s = s.replaceAll(RegExp(r'\s+'), ' ').trim();
  if (s.isEmpty) return '';
  if (RegExp(r'^URL Source\b', caseSensitive: false).hasMatch(s)) return '';
  if (RegExp(r'^https?://', caseSensitive: false).hasMatch(s)) return '';
  if (RegExp(r'reddit\.com', caseSensitive: false).hasMatch(s) &&
      s.length < 160 &&
      !RegExp(r'\|', caseSensitive: false).hasMatch(s)) {
    return '';
  }
  return s;
}

String _decodeHtmlEntities(String text) {
  return text
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&amp;', '&');
}

String _stripHtmlToText(String html) {
  final decoded = _decodeHtmlEntities(html);
  return stripRedditDisplayBoilerplate(
    decoded
        .replaceAll(RegExp(r'<br\s*/?>', caseSensitive: false), '\n')
        .replaceAll(RegExp(r'<[^>]+>'), ' ')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim(),
  );
}

List<Map<String, String>> _parseRedditThreadRssEntries(String xml) {
  final entries = <Map<String, String>>[];
  final blocks = RegExp(r'<entry>[\s\S]*?</entry>', multiLine: true).allMatches(xml);
  for (final m in blocks) {
    final block = m.group(0) ?? '';
    final titleM = RegExp(
      r'<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?</title>',
      caseSensitive: false,
    ).firstMatch(block);
    final contentM = RegExp(
      r'<content[^>]*type="html"[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?</content>',
      caseSensitive: false,
    ).firstMatch(block);
    final authorM = RegExp(
      r'<author>\s*<name>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?</name>',
      caseSensitive: false,
    ).firstMatch(block);
    var title = titleM?.group(1)?.replaceAll(RegExp(r'\s+'), ' ').trim() ?? '';
    title = title.replaceAll('&amp;', '&');
    final rawContent = contentM?.group(1) ?? '';
    final body = _stripHtmlToText(rawContent);
    final author = authorM?.group(1)?.trim() ?? 'unknown';
    if (title.isEmpty && body.isEmpty) continue;
    entries.add({'title': title, 'body': body, 'author': author});
  }
  return entries;
}

/// Fetch thread post body + comments via Reddit Atom RSS (works when `.json` is blocked).
Future<Map<String, dynamic>?> fetchRedditThreadViaRss(
  String permalink, {
  Map<String, dynamic>? seed,
}) async {
  final rssUrl = buildRedditThreadRssUrl(permalink);
  if (rssUrl == null) return null;
  try {
    final res = await http
        .get(
          Uri.parse(rssUrl),
          headers: const {
            'Accept': 'application/atom+xml, application/xml, text/xml',
            'User-Agent': 'DeteaRedditProxy/1.0 (+https://deitedatabase.web.app)',
          },
        )
        .timeout(const Duration(seconds: 20));
    if (res.statusCode < 200 || res.statusCode >= 300) return null;
    final xml = res.body;
    if (!xml.contains('<entry>')) return null;

    final entries = _parseRedditThreadRssEntries(xml);
    if (entries.isEmpty) return null;

    final normalized = normalizeRedditDiscussionUrl(permalink)!;
    final seedTitle = '${seed?['title'] ?? ''}'.trim();
    final postEntry = entries.first;
    var title = postEntry['title'] ?? '';
    if (title.isEmpty) title = seedTitle;
    final selftext = stripRedditDisplayBoilerplate(postEntry['body'] ?? '');

    final commentLines = <String>[];
    final gossipParts = <String>[];
    if (selftext.isNotEmpty && selftext.length > 30) gossipParts.add(selftext);
    for (final e in entries.skip(1).take(10)) {
      final author = e['author'] ?? '';
      if (author == 'AutoModerator') continue;
      final body = e['body'] ?? '';
      if (body.length < 24) continue;
      if (body.toLowerCase().contains('rules reminder')) continue;
      gossipParts.add(body);
      commentLines.add('Comment by u/$author: $body');
      if (commentLines.length >= 6) break;
    }
    var gossip = gossipParts.join(' ').replaceAll(RegExp(r'\s+'), ' ').trim();
    if (gossip.isEmpty) gossip = title;

    final chunks = <String>['Title: $title'];
    if (selftext.isNotEmpty) chunks.add('Post body:\n$selftext');
    if (commentLines.isNotEmpty) chunks.add('Top comments:\n${commentLines.join('\n\n')}');
    final text = chunks.join('\n\n');

    return {
      'title': title,
      'url': normalized,
      'description': gossip,
      'gossip': gossip,
      'selftext': selftext,
      'text': text,
      'source': '${seed?['source'] ?? 'r/BollyBlindsNGossip'}',
      'image': seed?['image'],
    };
  } catch (_) {
    return null;
  }
}

String? buildRedditThreadJsonUrl(String discussionUrl) {
  final normalized = normalizeRedditDiscussionUrl(discussionUrl);
  if (normalized == null) return null;
  try {
    final u = Uri.parse(normalized);
    var host = u.host.toLowerCase();
    if (host.startsWith('np.') || host.startsWith('old.')) host = 'www.reddit.com';
    if (!host.endsWith('reddit.com')) return null;

    var path = u.path;
    if (!RegExp(r'/comments/[a-z0-9]+', caseSensitive: false).hasMatch(path)) return null;
    if (!path.endsWith('.json')) path = '$path.json';

    return Uri(
      scheme: 'https',
      host: host.startsWith('www.') ? host : 'www.reddit.com',
      path: path,
      queryParameters: const {
        'raw_json': '1',
        'limit': '120',
        'depth': '2',
        'sort': 'top',
      },
    ).toString();
  } catch (_) {
    return null;
  }
}

bool isRedditThreadUrl(String? url) => normalizeRedditDiscussionUrl(url) != null;

List<RedditComment> parseTopLevelComments(dynamic threadJson, {int limit = 40}) {
  if (threadJson is! List || threadJson.length < 2) return [];
  final listing = (threadJson[1] as Map?)?['data']?['children'];
  if (listing is! List) return [];

  final rows = <RedditComment>[];
  for (final child in listing) {
    if (child is! Map || child['kind'] != 't1') continue;
    final d = child['data'];
    if (d is! Map) continue;
    if (d['stickied'] == true) continue;
    final body = (d['body'] as String?)?.trim() ?? '';
    if (body.isEmpty || body == '[deleted]' || body == '[removed]') continue;
    rows.add(
      RedditComment(
        id: '${d['id'] ?? rows.length}',
        author: (d['author'] as String?)?.isNotEmpty == true ? d['author'] as String : 'unknown',
        body: body,
        score: (d['score'] as num?)?.toInt() ?? 0,
        createdUtc: (d['created_utc'] as num?)?.toDouble(),
      ),
    );
    if (rows.length >= limit) break;
  }
  return rows;
}

/// Loads a Reddit thread `.json` payload (backend thread API → backend proxy → CORS).
Future<dynamic> fetchRedditThreadJson(String discussionUrl) async {
  final jsonUrl = buildRedditThreadJsonUrl(discussionUrl);
  if (jsonUrl == null) return null;

  for (final base in redditProxyBaseUrls()) {
    try {
      final threadUrl =
          '$base/api/reddit/thread?${Uri(queryParameters: {'url': discussionUrl.trim()}).query}';
      final res = await http
          .get(
            Uri.parse(threadUrl),
            headers: const {
              'Accept': 'application/json',
              'User-Agent': 'DeiteNews/1.0',
            },
          )
          .timeout(const Duration(seconds: 18));
      if (res.statusCode >= 200 && res.statusCode < 300) {
        final body = jsonDecode(res.body);
        if (body is Map && body['ok'] == true) {
          if (body['thread'] != null) return body['thread'];
          if (body['gossip'] != null || body['text'] != null) return body;
        }
      }
    } catch (_) {}
  }

  try {
    final res = await http
        .get(
          Uri.parse(jsonUrl),
          headers: const {
            'User-Agent': 'Deite/1.0',
            'Accept': 'application/json',
          },
        )
        .timeout(const Duration(seconds: 15));
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return jsonDecode(res.body);
    }
  } catch (_) {}

  for (final base in redditProxyBaseUrls()) {
    try {
      final proxyUrl =
          '$base/api/news?${Uri(queryParameters: {'url': jsonUrl}).query}';
      final res = await http
          .get(
            Uri.parse(proxyUrl),
            headers: const {
              'Accept': 'application/json',
              'User-Agent': 'DeiteNews/1.0',
            },
          )
          .timeout(const Duration(seconds: 18));
      if (res.statusCode >= 200 && res.statusCode < 300) {
        final body = res.body.trim();
        if (body.isNotEmpty) return jsonDecode(body);
      }
    } catch (_) {}
  }

  return _fetchRedditJsonViaProxies(jsonUrl);
}

void _collectRedditCommentsForDetails(
  List<dynamic>? children,
  List<Map<String, String>> out,
  int depth,
  int maxDepth,
  int maxCount,
) {
  if (children == null || out.length >= maxCount || depth > maxDepth) return;
  for (final child in children) {
    if (out.length >= maxCount) break;
    if (child is! Map) continue;
    if (child['kind'] == 'more') continue;
    if (child['kind'] != 't1') continue;
    final data = child['data'];
    if (data is! Map) continue;
    final body = (data['body'] as String?)?.trim() ?? '';
    if (body.isEmpty || body == '[removed]' || body == '[deleted]') continue;
    out.add({
      'author': (data['author'] ?? 'unknown').toString(),
      'body': body,
    });
    if (depth < maxDepth) {
      final replies = data['replies'];
      if (replies is Map &&
          replies['data'] is Map &&
          (replies['data'] as Map)['children'] is List) {
        _collectRedditCommentsForDetails(
          ((replies['data'] as Map)['children'] as List).cast<dynamic>(),
          out,
          depth + 1,
          maxDepth,
          maxCount,
        );
      }
    }
  }
}

/// Parse Reddit thread JSON into article details (title, image, gossip, full text).
Map<String, dynamic>? parseRedditThreadDetails(
  dynamic threadJson, {
  Map<String, dynamic>? seed,
  String? fallbackUrl,
}) {
  if (threadJson is! List || threadJson.isEmpty) return null;

  final listing0 = threadJson[0];
  final listing0Data =
      (listing0 is Map && listing0['data'] is Map) ? listing0['data'] as Map : null;
  final listing0Children = (listing0Data != null && listing0Data['children'] is List)
      ? listing0Data['children'] as List
      : const <dynamic>[];
  final firstChild = listing0Children.isNotEmpty && listing0Children.first is Map
      ? listing0Children.first as Map
      : null;
  final post =
      (firstChild != null && firstChild['data'] is Map) ? firstChild['data'] as Map : null;
  if (post == null || post['title'] is! String) return null;

  final title = (post['title'] as String).trim();
  final permalinkRaw = (post['permalink'] is String) ? (post['permalink'] as String).trim() : '';
  final canonical = permalinkRaw.isNotEmpty
      ? 'https://www.reddit.com${permalinkRaw.startsWith('/') ? '' : '/'}$permalinkRaw'
      : (fallbackUrl ?? '').trim();

  final selftext = (post['selftext'] is String) ? (post['selftext'] as String).trim() : '';
  final subreddit = (post['subreddit_name_prefixed'] is String)
      ? (post['subreddit_name_prefixed'] as String).trim()
      : '';
  final linkOut = (post['url'] is String) ? (post['url'] as String).trim() : '';

  final commentObjs = <Map<String, String>>[];
  final second = threadJson.length > 1 ? threadJson[1] : null;
  final secondData = (second is Map && second['data'] is Map) ? second['data'] as Map : null;
  final children =
      (secondData != null && secondData['children'] is List) ? secondData['children'] : null;
  _collectRedditCommentsForDetails(
    (children is List) ? children.cast<dynamic>() : null,
    commentObjs,
    0,
    2,
    12,
  );

  final gossipParts = <String>[];
  final snippet = redditGossipSnippetFromPost(Map<String, dynamic>.from(post));
  if (snippet.isNotEmpty) gossipParts.add(snippet);
  for (final c in commentObjs.take(4)) {
    final body = compactCommentBody(c['body'] ?? '', 320);
    if (body.isNotEmpty) gossipParts.add(body);
  }
  var gossip = gossipParts.join(' ').replaceAll(RegExp(r'\s+'), ' ').trim();
  if (gossip.isEmpty && title.isNotEmpty) gossip = title;

  final chunks = <String>[];
  if (subreddit.isNotEmpty) chunks.add('Subreddit: $subreddit');
  chunks.add('Title: $title');
  if (selftext.isNotEmpty) {
    chunks.add('Post body:\n$selftext');
  } else if (linkOut.isNotEmpty &&
      RegExp(r'^https?://', caseSensitive: false).hasMatch(linkOut) &&
      !RegExp(r'/reddit\.com/', caseSensitive: false).hasMatch(linkOut)) {
    chunks.add('Linked content URL: $linkOut');
  }
  if (commentObjs.isNotEmpty) {
    final lines =
        commentObjs.map((c) => 'Comment by u/${c['author']}: ${c['body']}').join('\n\n');
    chunks.add('Top comments:\n$lines');
  }

  final text = chunks.join('\n\n').replaceAll(RegExp(r'\s+\n'), '\n').trim();
  final sliced = text.length > 16000 ? text.substring(0, 16000) : text;
  if (sliced.length < 12) return null;

  final seedMap = seed ?? const <String, dynamic>{};
  final image = resolveRedditPostImage(Map<String, dynamic>.from(post)) ??
      ((seedMap['image'] is String) ? seedMap['image'] as String : null);
  final source = subreddit.isNotEmpty
      ? subreddit
      : ((seedMap['source'] is String) ? (seedMap['source'] as String).trim() : 'Reddit');

  return {
    'title': title,
    'url': canonical.isNotEmpty ? canonical : (fallbackUrl ?? ''),
    'description': gossip,
    'gossip': gossip,
    'selftext': snippet,
    'image': (image is String && image.startsWith('http')) ? image : null,
    'source': source.isEmpty ? 'Reddit' : source,
    'text': sliced,
  };
}

/// Fetch parsed Reddit thread (title, gossip, image, comments text).
Future<Map<String, dynamic>?> fetchRedditThreadDetails(
  String discussionUrl, {
  Map<String, dynamic>? seed,
}) async {
  final trimmed = normalizeRedditDiscussionUrl(discussionUrl) ?? discussionUrl.trim();
  if (trimmed.isEmpty) return null;

  final jsonUrl = buildRedditThreadJsonUrl(trimmed);

  Map<String, dynamic>? fromParsed(dynamic raw) {
    if (raw is Map && raw['gossip'] != null) {
      return Map<String, dynamic>.from(raw);
    }
    return parseRedditThreadDetails(raw, seed: seed, fallbackUrl: trimmed);
  }

  for (final base in redditProxyBaseUrls()) {
    try {
      final url =
          '$base/api/reddit/thread?${Uri(queryParameters: {'url': trimmed}).query}';
      final res = await http
          .get(
            Uri.parse(url),
            headers: const {
              'Accept': 'application/json',
              'User-Agent': 'DeiteNews/1.0',
            },
          )
          .timeout(const Duration(seconds: 10));
      if (res.statusCode < 200 || res.statusCode >= 300) continue;
      final body = _safeJsonDecode(res.body);
      if (body is! Map || body['ok'] != true) continue;
      return Map<String, dynamic>.from(body);
    } catch (_) {}
  }

  final rss = await fetchRedditThreadViaRss(trimmed, seed: seed);
  if (rss != null) {
    return rss;
  }

  if (jsonUrl != null) {
    final proxyRaw = await _fetchRedditJsonViaProxies(jsonUrl);
    final fromProxy = fromParsed(proxyRaw);
    if (fromProxy != null) {
      return fromProxy;
    }
  }

  if (!kIsWeb && jsonUrl != null) {
    try {
      final res = await http
          .get(
            Uri.parse(jsonUrl),
            headers: const {
              'User-Agent':
                  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
              'Accept': 'application/json',
            },
          )
          .timeout(const Duration(seconds: 12));
      if (res.statusCode >= 200 && res.statusCode < 300) {
        final parsed = fromParsed(_safeJsonDecode(res.body));
        if (parsed != null) {
          return parsed;
        }
      }
    } catch (_) {}
  }

  final jina = await fetchRedditThreadViaJina(trimmed, seed: seed);
  if (jina != null) {
    return jina;
  }

  final raw = await fetchRedditThreadJson(trimmed);
  return fromParsed(raw);
}

Future<dynamic> _fetchRedditJsonViaProxies(String targetUrl) async {
  final encoded = Uri.encodeComponent(targetUrl);
  final attempts = [
    'https://api.codetabs.com/v1/proxy?quest=$encoded',
    'https://corsproxy.io/?$encoded',
    'https://api.allorigins.win/get?url=$encoded',
  ];
  for (final proxyUrl in attempts) {
    try {
      final res = await http.get(Uri.parse(proxyUrl)).timeout(const Duration(seconds: 12));
      if (res.statusCode < 200 || res.statusCode >= 300) continue;
      if (proxyUrl.contains('allorigins')) {
        final j = _safeJsonDecode(res.body) as Map<String, dynamic>?;
        final txt = j?['contents'] as String? ?? '';
        if (txt.isEmpty) continue;
        final decoded = _safeJsonDecode(txt);
        if (decoded != null) return decoded;
        continue;
      }
      final decoded = _safeJsonDecode(res.body);
      if (decoded != null) return decoded;
    } catch (_) {}
  }
  return null;
}

Future<RedditCommentsResult> fetchTeaThreadComments(String discussionUrl) async {
  final jsonUrl = buildRedditThreadJsonUrl(discussionUrl);
  if (jsonUrl == null) {
    return RedditCommentsResult(ok: false, error: 'Not a Reddit URL');
  }
  try {
    final data = await fetchRedditThreadJson(discussionUrl);
    if (data == null) {
      return RedditCommentsResult(ok: false, error: 'Failed to load comments');
    }
    return RedditCommentsResult(ok: true, comments: parseTopLevelComments(data));
  } catch (e) {
    return RedditCommentsResult(ok: false, error: e.toString());
  }
}

String compactCommentBody(String body, [int maxLen = 2000]) {
  var s = body.replaceAll(RegExp(r'\s+'), ' ').trim();
  if (s.length > maxLen) s = '${s.substring(0, maxLen)}â€¦';
  return s;
}

bool commentBodyHasLinkLikeContent(String body) {
  if (body.trim().isEmpty) return false;
  if (RegExp(r'https?://\S', caseSensitive: false).hasMatch(body)) return true;
  if (RegExp(r'www\.\S', caseSensitive: false).hasMatch(body)) return true;
  if (RegExp(r'\[[^\]]*\]\([^)]+\)').hasMatch(body)) return true;
  return false;
}
