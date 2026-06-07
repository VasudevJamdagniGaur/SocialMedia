/// Whether [url] is a Reddit discussion permalink (with or without /r/sub/ prefix).
bool isRedditDiscussionUrl(String? url) {
  try {
    final u = Uri.parse((url ?? '').trim());
    var host = u.host.toLowerCase();
    if (host.startsWith('www.')) host = host.substring(4);
    if (host.startsWith('np.')) host = host.substring(3);
    if (host.startsWith('old.')) host = host.substring(4);
    if (host.startsWith('m.')) host = host.substring(2);
    if (host != 'reddit.com' && !host.endsWith('.reddit.com')) return false;
    return RegExp(r'/comments/[a-z0-9]+', caseSensitive: false).hasMatch(u.path);
  } catch (_) {
    return false;
  }
}

/// Build Reddit `.json` URL for a thread permalink.
String? buildRedditThreadJsonUrl(String discussionUrl) {
  try {
    final trimmed = discussionUrl.trim().replaceAll(RegExp(r'/\?.*$'), '').replaceAll(RegExp(r'/$'), '');
    if (trimmed.isEmpty) return null;
    final u = Uri.parse(trimmed);
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

Map<String, dynamic>? parseRedditThreadPayload(dynamic threadJson, {String? seedUrl}) {
  if (threadJson is! List || threadJson.isEmpty) return null;

  final listing0 = threadJson[0];
  final children = (listing0 is Map &&
          listing0['data'] is Map &&
          (listing0['data'] as Map)['children'] is List)
      ? (listing0['data'] as Map)['children'] as List
      : null;
  final firstChild = (children != null && children.isNotEmpty && children.first is Map)
      ? children.first as Map
      : null;
  final post = (firstChild != null && firstChild['data'] is Map) ? firstChild['data'] as Map : null;
  if (post == null || post['title'] is! String) return null;

  final title = (post['title'] as String).trim();
  final permalinkRaw = (post['permalink'] is String) ? (post['permalink'] as String).trim() : '';
  final permalink = permalinkRaw.isNotEmpty
      ? 'https://www.reddit.com${permalinkRaw.startsWith('/') ? '' : '/'}$permalinkRaw'
      : (seedUrl ?? '').trim();
  final selftext = (post['selftext'] is String) ? (post['selftext'] as String).trim() : '';
  final subreddit = (post['subreddit_name_prefixed'] is String)
      ? (post['subreddit_name_prefixed'] as String).trim()
      : '';

  final comments = <Map<String, String>>[];
  if (threadJson.length > 1) {
    final second = threadJson[1];
    final secondChildren = (second is Map &&
            second['data'] is Map &&
            (second['data'] as Map)['children'] is List)
        ? (second['data'] as Map)['children'] as List
        : null;
    if (secondChildren != null) {
      for (final child in secondChildren) {
        if (comments.length >= 8) break;
        if (child is! Map || child['kind'] != 't1') continue;
        final data = child['data'];
        if (data is! Map) continue;
        final body = (data['body'] as String?)?.trim() ?? '';
        if (body.isEmpty || body == '[removed]' || body == '[deleted]') continue;
        comments.add({
          'author': (data['author'] ?? 'unknown').toString(),
          'body': body,
        });
      }
    }
  }

  String? image;
  try {
    final preview = post['preview'];
    if (preview is Map && preview['images'] is List && (preview['images'] as List).isNotEmpty) {
      final src = ((preview['images'] as List).first as Map?)?['source'];
      if (src is Map && src['url'] is String) {
        final u = (src['url'] as String).trim();
        if (u.startsWith('http')) image = u.replaceAll('&amp;', '&');
      }
    }
  } catch (_) {}
  final link = (post['url'] as String?)?.trim() ?? '';
  if (image == null && RegExp(r'\.(jpe?g|png|gif|webp)(\?|$)', caseSensitive: false).hasMatch(link.split('?').first)) {
    image = link;
  }
  final thumb = (post['thumbnail'] as String?)?.trim() ?? '';
  if (image == null &&
      thumb.startsWith('http') &&
      !{'self', 'default', 'nsfw', 'spoiler'}.contains(thumb)) {
    image = thumb;
  }

  final gossipParts = <String>[];
  if (selftext.isNotEmpty && selftext != '[removed]' && selftext != '[deleted]') {
    gossipParts.add(selftext.replaceAll(RegExp(r'\s+'), ' ').trim());
  }
  for (final c in comments.take(4)) {
    final b = c['body']!.replaceAll(RegExp(r'\s+'), ' ').trim();
    if (b.length > 20) gossipParts.add(b);
  }
  var gossip = gossipParts.join(' ').trim();
  if (gossip.isEmpty) gossip = title;

  final chunks = <String>[];
  if (subreddit.isNotEmpty) chunks.add('Subreddit: $subreddit');
  chunks.add('Title: $title');
  if (selftext.isNotEmpty) chunks.add('Post body:\n$selftext');
  if (comments.isNotEmpty) {
    chunks.add(
      'Top comments:\n${comments.map((c) => 'Comment by u/${c['author']}: ${c['body']}').join('\n\n')}',
    );
  }
  final text = chunks.join('\n\n').trim();
  if (text.length < 12) return null;

  return {
    'title': title,
    'url': permalink,
    'image': image,
    'selftext': selftext.replaceAll(RegExp(r'\s+'), ' ').trim(),
    'gossip': gossip,
    'description': gossip,
    'source': subreddit.isNotEmpty ? subreddit : 'Reddit',
    'text': text.length > 16000 ? text.substring(0, 16000) : text,
    'thread': threadJson,
  };
}
