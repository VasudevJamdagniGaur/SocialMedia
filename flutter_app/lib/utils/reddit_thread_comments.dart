import 'dart:convert';

import 'package:http/http.dart' as http;

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
    dynamic data;
    try {
      final res = await http.get(Uri.parse(jsonUrl), headers: {'User-Agent': 'Deite/1.0'}).timeout(const Duration(seconds: 15));
      if (res.statusCode >= 200 && res.statusCode < 300) {
        data = jsonDecode(res.body);
      }
    } catch (_) {}
    data ??= await _fetchRedditJsonViaProxies(jsonUrl);
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
