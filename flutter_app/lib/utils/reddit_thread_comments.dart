import 'dart:convert';

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

String? buildRedditThreadJsonUrl(String discussionUrl) {
  if (discussionUrl.trim().isEmpty) return null;
  final u = discussionUrl.trim().replaceAll(RegExp(r'/\?.*$'), '').replaceAll(RegExp(r'/$'), '');
  if (!RegExp(r'reddit\.com/r/', caseSensitive: false).hasMatch(u)) return null;
  return '$u.json?raw_json=1&limit=50&depth=1&sort=top';
}

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
        if (body is Map && body['ok'] == true && body['thread'] != null) {
          return body['thread'];
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
  final trimmed = discussionUrl.trim();
  if (trimmed.isEmpty) return null;

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
          .timeout(const Duration(seconds: 20));
      if (res.statusCode < 200 || res.statusCode >= 300) continue;
      final body = jsonDecode(res.body);
      if (body is! Map || body['ok'] != true) continue;
      return Map<String, dynamic>.from(body);
    } catch (_) {}
  }

  final raw = await fetchRedditThreadJson(trimmed);
  return parseRedditThreadDetails(raw, seed: seed, fallbackUrl: trimmed);
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
      final res = await http.get(Uri.parse(proxyUrl)).timeout(const Duration(seconds: 20));
      if (res.statusCode < 200 || res.statusCode >= 300) continue;
      if (proxyUrl.contains('allorigins')) {
        final j = jsonDecode(res.body) as Map<String, dynamic>?;
        final txt = j?['contents'] as String? ?? '';
        if (txt.isEmpty) continue;
        return jsonDecode(txt);
      }
      return jsonDecode(res.body);
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
