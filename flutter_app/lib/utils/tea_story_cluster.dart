import 'reddit_thread_comments.dart';
import 'share_news_cache.dart';
import 'tea_event_topics.dart';
import 'tea_topic_context.dart';

/// Unified story / cluster model for Tea 2.0 (adapts existing row maps).
class TeaStoryCluster {
  TeaStoryCluster({
    required this.storyId,
    required this.title,
    required this.summary,
    required this.category,
    required this.sourceType,
    required this.sourceName,
    required this.sourceUrl,
    required this.publishedAt,
    required this.firstSeenAt,
    required this.lastUpdatedAt,
    required this.thumbnailUrl,
    required this.relatedSources,
    required this.relatedStoryIds,
    required this.eventId,
    required this.verifiedFacts,
    required this.unverifiedClaims,
    required this.contextLevel,
    required this.engagement,
    required this.isBreaking,
    required this.isDeveloping,
    required this.contentStatus,
    this.members = const [],
  });

  final String storyId;
  final String title;
  final String summary;
  final String category;
  final String sourceType;
  final String sourceName;
  final String sourceUrl;
  final String publishedAt;
  final DateTime firstSeenAt;
  final DateTime lastUpdatedAt;
  final String thumbnailUrl;
  final List<Map<String, String>> relatedSources;
  final List<String> relatedStoryIds;
  final String eventId;
  final List<String> verifiedFacts;
  final List<String> unverifiedClaims;
  final String contextLevel;
  final int engagement;
  final bool isBreaking;
  final bool isDeveloping;
  final String contentStatus;
  final List<Map<String, dynamic>> members;

  Map<String, dynamic> toJson() => {
        'storyId': storyId,
        'title': title,
        'summary': summary,
        'category': category,
        'sourceType': sourceType,
        'sourceName': sourceName,
        'sourceUrl': sourceUrl,
        'publishedAt': publishedAt,
        'firstSeenAt': firstSeenAt.toIso8601String(),
        'lastUpdatedAt': lastUpdatedAt.toIso8601String(),
        'thumbnailUrl': thumbnailUrl,
        'relatedSources': relatedSources,
        'relatedStoryIds': relatedStoryIds,
        'eventId': eventId,
        'verifiedFacts': verifiedFacts,
        'unverifiedClaims': unverifiedClaims,
        'contextLevel': contextLevel,
        'engagement': engagement,
        'isBreaking': isBreaking,
        'isDeveloping': isDeveloping,
        'contentStatus': contentStatus,
        'members': members,
      };

  /// Representative row for TeaItem / carousel.
  Map<String, dynamic> toTeaRow() => {
        'title': title,
        'url': sourceUrl,
        'description': summary,
        'gossip': summary,
        'selftext': summary,
        'image': thumbnailUrl,
        'thumbnail': thumbnailUrl,
        'source': sourceName,
        'author': sourceName,
        'score': engagement,
        'num_comments': 0,
        'publishedAt': publishedAt,
        'storyId': storyId,
        'eventId': eventId,
        'category': category,
        'sourceType': sourceType,
        'isBreaking': isBreaking,
        'isDeveloping': isDeveloping,
        'contextLevel': contextLevel,
        'contextSummary': summary,
        'contentStatus': contentStatus,
        'relatedSources': relatedSources,
        'verifiedFacts': verifiedFacts,
        'unverifiedClaims': unverifiedClaims,
      };
}

double teaTitleSimilarity(String a, String b) {
  final ta = a
      .toLowerCase()
      .replaceAll(RegExp(r'[^a-z0-9\s]'), ' ')
      .split(RegExp(r'\s+'))
      .where((w) => w.length > 2)
      .toSet();
  final tb = b
      .toLowerCase()
      .replaceAll(RegExp(r'[^a-z0-9\s]'), ' ')
      .split(RegExp(r'\s+'))
      .where((w) => w.length > 2)
      .toSet();
  if (ta.isEmpty || tb.isEmpty) return 0;
  return ta.intersection(tb).length / ta.union(tb).length;
}

String teaStoryIdFor(String title, String url) {
  final key = normalizeUrlKey(url).isNotEmpty
      ? normalizeUrlKey(url)
      : title.trim().toLowerCase();
  return 'ts_${key.hashCode.toRadixString(36)}';
}

String _detectSourceType(Map<String, dynamic> row) {
  final url = '${row['url'] ?? ''}'.toLowerCase();
  final source = '${row['source'] ?? row['author'] ?? ''}'.toLowerCase();
  if (url.contains('reddit.com') || source.startsWith('r/')) return 'reddit';
  if (url.contains('youtube.com') || url.contains('youtu.be') || source == 'youtube') {
    return 'youtube';
  }
  if (url.contains('news.google.com')) return 'google_news';
  return 'news';
}

/// Cluster near-duplicate rows into stories. Unrelated items with a shared
/// celebrity/politician name alone are not merged (similarity threshold).
List<TeaStoryCluster> clusterTeaRows(
  List<Map<String, dynamic>> rows, {
  double similarityThreshold = 0.42,
  String eventId = '',
  String category = 'general',
  bool isBreaking = false,
}) {
  final clusters = <TeaStoryCluster>[];
  final used = <int>{};

  for (var i = 0; i < rows.length; i++) {
    if (used.contains(i)) continue;
    final seed = rows[i];
    final seedTitle = cleanTeaCardTitle('${seed['title'] ?? ''}');
    final seedUrl = '${seed['url'] ?? ''}'.trim();
    if (seedTitle.isEmpty || seedUrl.isEmpty) {
      used.add(i);
      continue;
    }

    final members = <Map<String, dynamic>>[Map<String, dynamic>.from(seed)];
    used.add(i);

    for (var j = i + 1; j < rows.length; j++) {
      if (used.contains(j)) continue;
      final other = rows[j];
      final otherTitle = cleanTeaCardTitle('${other['title'] ?? ''}');
      final otherUrl = '${other['url'] ?? ''}'.trim();
      if (otherTitle.isEmpty || otherUrl.isEmpty) continue;
      if (normalizeUrlKey(otherUrl) == normalizeUrlKey(seedUrl)) {
        members.add(Map<String, dynamic>.from(other));
        used.add(j);
        continue;
      }
      final sim = teaTitleSimilarity(seedTitle, otherTitle);
      if (sim >= similarityThreshold) {
        members.add(Map<String, dynamic>.from(other));
        used.add(j);
      }
    }

    final related = <Map<String, String>>[];
    final relatedIds = <String>[];
    var bestScore = 0;
    var best = members.first;
    final snippets = <String>[];

    for (final m in members) {
      final title = cleanTeaCardTitle('${m['title'] ?? ''}');
      final url = '${m['url'] ?? ''}'.trim();
      final publisher = '${m['source'] ?? m['author'] ?? 'Source'}'.trim();
      final snip = cleanFeedSnippetForDisplay(
        '${m['gossip'] ?? m['description'] ?? m['selftext'] ?? ''}',
        title: title,
      );
      related.add({
        'title': title,
        'url': url,
        'publisher': publisher,
        'snippet': snip,
        'sourceType': _detectSourceType(m),
      });
      relatedIds.add(teaStoryIdFor(title, url));
      final score = m['score'] is num ? (m['score'] as num).toInt() : 0;
      if (score >= bestScore) {
        bestScore = score;
        best = m;
      }
      if (snip.isNotEmpty) snippets.add(snip);
    }

    final title = cleanTeaCardTitle('${best['title'] ?? seedTitle}');
    final summary = snippets.isNotEmpty
        ? (snippets.first.length > 280
            ? '${snippets.first.substring(0, 280).trim()}…'
            : snippets.first)
        : (members.length > 1
            ? 'Coverage from ${members.length} sources on "$title".'
            : '');
    final pub = '${best['publishedAt'] ?? ''}'.trim();
    final now = DateTime.now();
    final thumb =
        '${best['image'] ?? best['thumbnail'] ?? ''}'.trim();

    clusters.add(TeaStoryCluster(
      storyId: teaStoryIdFor(title, '${best['url'] ?? seedUrl}'),
      title: title,
      summary: summary,
      category: category,
      sourceType: _detectSourceType(best),
      sourceName: '${best['source'] ?? best['author'] ?? 'Tea'}',
      sourceUrl: '${best['url'] ?? seedUrl}',
      publishedAt: pub,
      firstSeenAt: now,
      lastUpdatedAt: now,
      thumbnailUrl: thumb,
      relatedSources: related,
      relatedStoryIds: relatedIds.where((id) => id != teaStoryIdFor(title, '${best['url'] ?? seedUrl}')).toList(),
      eventId: eventId,
      verifiedFacts: [
        if (title.isNotEmpty) 'Reported headline: $title',
        if (members.length > 1)
          'Corroborated across ${members.length} accessible sources',
      ],
      unverifiedClaims: summary.isEmpty && members.length == 1
          ? ['Only a single source headline was available; details unconfirmed']
          : const [],
      contextLevel: members.length >= 2
          ? TeaContextLevel.multiSource.name
          : (summary.isNotEmpty
              ? TeaContextLevel.snippetBased.name
              : TeaContextLevel.headlineOnly.name),
      engagement: bestScore,
      isBreaking: isBreaking,
      isDeveloping: members.length >= 3 || isBreaking,
      contentStatus: members.length >= 2
          ? 'complete'
          : (summary.isNotEmpty ? 'partial' : 'titleOnly'),
      members: members,
    ));
  }

  clusters.sort((a, b) {
    if (a.isBreaking != b.isBreaking) return a.isBreaking ? -1 : 1;
    return b.engagement.compareTo(a.engagement);
  });
  return clusters;
}

/// Attach event id when title/snippet matches event keywords.
String? matchTeaEventId(String title, String text, {List<TeaEventTopic>? topics}) {
  final blob = '$title\n$text'.toLowerCase();
  for (final t in topics ?? teaEventTopics) {
    var hits = 0;
    for (final k in t.keywords) {
      if (k.length >= 3 && blob.contains(k.toLowerCase())) hits++;
    }
    if (hits >= 2) return t.eventId;
  }
  return null;
}
