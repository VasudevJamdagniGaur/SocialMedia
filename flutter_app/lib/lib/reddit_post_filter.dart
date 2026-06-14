/// Reddit listing filters — port of src/lib/redditPostFilter.js

const defaultExcludedTitleKeywords = [
  'subreddit',
  'moderator',
  'mods',
  'rules',
  'banned',
  'removed',
  'fanclub',
  'announcement',
  'meta',
  'policy',
];

const bollywoodTeaTopicKeywords = [
  'bollywood',
  'movie',
  'film',
  'actor',
  'actress',
  'box office',
  'trailer',
  'release',
  'cricket',
  'ipl',
  'football',
  'soccer',
  'celebrity',
  'gossip',
  'scandal',
  'controversy',
  'viral',
  'trending',
  'hindi',
  'tollywood',
  'kollywood',
  'bigg boss',
];

int normalizeUps(Map<String, dynamic> post) {
  final ups = post['ups'];
  if (ups is num) return ups.toInt();
  final score = post['score'];
  if (score is num) return score.toInt();
  return 0;
}

bool titleHasExcludedKeyword(
  String title, [
  List<String> excludedKeywords = defaultExcludedTitleKeywords,
]) {
  final t = title.toLowerCase();
  return excludedKeywords.any((kw) => t.contains(kw.toLowerCase()));
}

bool isValidPost(
  Map<String, dynamic>? post, {
  List<String>? excludedTitleKeywords,
}) {
  if (post == null) return false;
  if (post['stickied'] == true) return false;

  final title = post['title'] is String ? post['title'] as String : '';
  final excluded = excludedTitleKeywords ?? defaultExcludedTitleKeywords;
  if (titleHasExcludedKeyword(title, excluded)) return false;

  if (normalizeUps(post) < 10) return false;

  final selftext = '${post['selftext'] ?? ''}'.trim();
  final isSelf = post['is_self'] == true;
  if (isSelf && selftext.length < 20) return false;

  return true;
}

bool isRelevantPost(Map<String, dynamic>? post, List<String> topicKeywords) {
  if (topicKeywords.isEmpty) return false;
  final title = '${post?['title'] ?? ''}'.toLowerCase();
  final body = '${post?['selftext'] ?? ''}'.toLowerCase();
  final haystack = '$title $body';
  return topicKeywords
      .any((kw) => haystack.contains(kw.toLowerCase()));
}

List<Map<String, dynamic>> filterPosts(
  List<Map<String, dynamic>> posts, [
  List<String> topicKeywords = bollywoodTeaTopicKeywords,
  List<String>? excludedTitleKeywords,
]) {
  return posts
      .where(
        (p) =>
            isValidPost(p, excludedTitleKeywords: excludedTitleKeywords) &&
            isRelevantPost(p, topicKeywords),
      )
      .toList();
}
