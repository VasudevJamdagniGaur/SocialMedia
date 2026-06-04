import 'pod_topic_news_shared.dart';

bool isDirectImageUrl(String? u) {
  final s = u?.trim() ?? '';
  if (s.isEmpty) return false;
  final path = s.split('?').first.split('#').first;
  return RegExp(r'\.(jpe?g|png|gif|webp)$', caseSensitive: false).hasMatch(path);
}

String? resolveRedditPostImage(Map<String, dynamic> post) {
  try {
    final images = post['preview']?['images'];
    if (images is List && images.isNotEmpty) {
      final src = images[0]?['source']?['url'];
      if (src is String && RegExp(r'^https?://', caseSensitive: false).hasMatch(src)) {
        return src.replaceAll('&amp;', '&').trim();
      }
    }
  } catch (_) {}
  final url = post['url'] is String ? (post['url'] as String).trim() : '';
  if (isDirectImageUrl(url)) return url;
  final thumbnail = post['thumbnail'] is String ? (post['thumbnail'] as String).trim() : '';
  if (RegExp(r'^https?://', caseSensitive: false).hasMatch(thumbnail)) {
    return thumbnail;
  }
  return null;
}

String redditPermalinkUrl(Map<String, dynamic> post) {
  final permalink = post['permalink'] is String ? (post['permalink'] as String).trim() : '';
  if (permalink.isNotEmpty) {
    final prefix = permalink.startsWith('/') ? '' : '/';
    return 'https://www.reddit.com$prefix$permalink';
  }
  final u = post['url'] is String ? (post['url'] as String).trim() : '';
  return RegExp(r'^https?://', caseSensitive: false).hasMatch(u) ? u : '';
}

String redditPublishedAt(Map<String, dynamic> post) {
  final u = post['created_utc'];
  final n = u is num ? u.toDouble() : double.tryParse('$u') ?? 0;
  if (n > 0) {
    return DateTime.fromMillisecondsSinceEpoch((n * 1000).round(), isUtc: true)
        .toIso8601String();
  }
  return DateTime.now().toUtc().toIso8601String();
}

bool hasHubCarouselHeroImage(Map<String, dynamic> row) {
  final u = '${row['image'] ?? row['thumbnail'] ?? ''}'.trim();
  return RegExp(r'^https?://', caseSensitive: false).hasMatch(u);
}

Map<String, dynamic>? pickBestHubCarouselRow(List<Map<String, dynamic>> rows) {
  if (rows.isEmpty) return null;
  final byScore = [...rows]
    ..sort((a, b) => _num(b['score']) - _num(a['score']));
  final withHero = byScore.where(hasHubCarouselHeroImage).toList();
  return withHero.isNotEmpty ? withHero.first : byScore.first;
}

int _num(dynamic v) => v is num ? v.toInt() : int.tryParse('$v') ?? 0;

typedef RedditPostFilter = bool Function(Map<String, dynamic> post);

/// Fetch hot posts from subreddits — port of tryRedditHotRows in podSportsTopicFeed.js
Future<List<Map<String, dynamic>>> tryRedditHotRows(
  List<String> subs, {
  int maxPerSub = 40,
  int maxKeep = 22,
  int minScore = 15,
  RedditPostFilter? filterPost,
}) async {
  final seenTitles = <String>{};
  final seenUrls = <String>{};
  final picked = <Map<String, dynamic>>[];

  for (final sub in subs) {
    if (picked.length >= maxKeep) break;
    final url =
        'https://www.reddit.com/r/${Uri.encodeComponent(sub)}/hot.json?limit=$maxPerSub&raw_json=1';
    List<dynamic> children = [];
    try {
      final jr = await fetchJsonGet(url, timeoutMs: 20000);
      if (jr['ok'] != true) {
        children = [];
      } else {
        final root = jr['data'];
        final listing = root is Map ? root['data'] : null;
        final ch = listing is Map ? listing['children'] : null;
        children = ch is List ? ch : [];
      }
    } catch (_) {
      children = [];
    }

    for (final child in children) {
      if (picked.length >= maxKeep) break;
      if (child is! Map) continue;
      final post = child['data'];
      if (post is! Map<String, dynamic>) continue;
      if (filterPost != null && !filterPost(post)) continue;

      final title = post['title'] is String ? (post['title'] as String).trim() : '';
      if (title.isEmpty) continue;
      final titleKey = title.toLowerCase();
      if (seenTitles.contains(titleKey)) continue;

      if (post['stickied'] == true) continue;
      if ('${post['author'] ?? ''}' == 'AutoModerator') continue;
      final score = _num(post['score']);
      if (score < minScore) continue;

      final link = redditPermalinkUrl(post);
      if (!RegExp(r'^https?://', caseSensitive: false).hasMatch(link)) continue;
      if (seenUrls.contains(link)) continue;

      final thumbnail = post['thumbnail'] is String ? (post['thumbnail'] as String).trim() : '';
      final thumb = RegExp(r'^https?://', caseSensitive: false).hasMatch(thumbnail)
          ? thumbnail
          : null;
      final image = resolveRedditPostImage(post);

      seenTitles.add(titleKey);
      seenUrls.add(link);
      picked.add({
        'title': title,
        'url': link,
        'image': image,
        'thumbnail': thumb,
        'score': score,
        'num_comments': _num(post['num_comments']),
        'author': post['author'] is String && '${post['author']}'.trim().isNotEmpty
            ? '${post['author']}'.trim()
            : 'unknown',
        'source': 'r/$sub',
        'description': '',
        'publishedAt': redditPublishedAt(post),
        'sourceSiteUrl': 'https://www.reddit.com/r/${Uri.encodeComponent(sub)}',
        'publisherUrl': '',
      });
    }
  }

  picked.sort((a, b) {
    final sc = _num(b['score']) - _num(a['score']);
    if (sc != 0) return sc;
    return _num(b['num_comments']) - _num(a['num_comments']);
  });
  return picked.take(maxKeep).toList();
}

Map<String, dynamic> hubCarouselFromRedditRow(
  Map<String, dynamic> pick, {
  required String exploreTopic,
}) {
  final hero = pick['image'] ?? pick['thumbnail'];
  return {
    'title': pick['title'],
    'url': pick['url'],
    'source': pick['source'] ?? 'Reddit',
    'image': hero,
    'description': pick['description'] ?? '',
    'publishedAt': pick['publishedAt'],
    'trendingScore': _num(pick['score']),
    'exploreTopic': exploreTopic,
  };
}

List<NewsArticle> mapsToNewsArticles(List<Map<String, dynamic>> rows) {
  return rows.map((r) {
    final m = Map<String, dynamic>.from(r);
    if (m['trendingScore'] == null && m['score'] != null) {
      m['trendingScore'] = m['score'];
    }
    return NewsArticle.fromNormalized(m);
  }).toList();
}
