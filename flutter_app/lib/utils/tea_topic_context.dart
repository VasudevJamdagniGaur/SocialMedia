import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../lib/pod_topic_news_shared.dart';
import '../services/chat_service.dart';
import '../services/reddit_tea_service.dart';
import 'reddit_thread_comments.dart';
import 'share_news_cache.dart';

/// How much evidence backs a Tea topic (independent of full-article scrape).
enum TeaContextLevel {
  /// Headline (+ optional publisher/URL) only.
  headlineOnly,

  /// Headline plus a short snippet or single-source description.
  snippetBased,

  /// Multiple corroborating sources / social threads.
  multiSource,
}

class TeaRelatedSource {
  const TeaRelatedSource({
    required this.title,
    required this.url,
    this.publisher = '',
    this.snippet = '',
  });

  final String title;
  final String url;
  final String publisher;
  final String snippet;

  Map<String, dynamic> toJson() => {
        'title': title,
        'url': url,
        'publisher': publisher,
        'snippet': snippet,
      };

  factory TeaRelatedSource.fromJson(Map<String, dynamic> m) => TeaRelatedSource(
        title: '${m['title'] ?? ''}',
        url: '${m['url'] ?? ''}',
        publisher: '${m['publisher'] ?? m['source'] ?? ''}',
        snippet: '${m['snippet'] ?? m['description'] ?? ''}',
      );
}

/// Structured, inspectable evidence for Tea text + image generation.
class TeaTopicContext {
  const TeaTopicContext({
    required this.headline,
    required this.sourceUrl,
    required this.publisher,
    required this.availableSnippet,
    required this.relatedSources,
    required this.verifiedFacts,
    required this.unverifiedClaims,
    required this.contextSummary,
    required this.contextLevel,
    required this.confidence,
    required this.generatedAt,
    this.publishedAt = '',
    this.thumbnail = '',
  });

  final String headline;
  final String sourceUrl;
  final String publisher;
  final String availableSnippet;
  final List<TeaRelatedSource> relatedSources;
  final List<String> verifiedFacts;
  final List<String> unverifiedClaims;
  final String contextSummary;
  final TeaContextLevel contextLevel;
  final double confidence;
  final DateTime generatedAt;
  final String publishedAt;
  final String thumbnail;

  bool get isLimited =>
      contextLevel == TeaContextLevel.headlineOnly ||
      (contextLevel == TeaContextLevel.snippetBased && confidence < 0.45);

  String get contextLevelLabel {
    switch (contextLevel) {
      case TeaContextLevel.headlineOnly:
        return 'Limited context — headline only';
      case TeaContextLevel.snippetBased:
        return 'Partial context — snippet available';
      case TeaContextLevel.multiSource:
        return 'Corroborated across sources';
    }
  }

  /// Text suitable for card overlays (never HTML/URLs).
  String get displaySummary {
    final s = cleanFeedSnippetForDisplay(contextSummary, title: headline);
    if (s.isNotEmpty) return s;
    final snip = cleanFeedSnippetForDisplay(availableSnippet, title: headline);
    if (snip.isNotEmpty) return snip;
    return '';
  }

  /// Story text for image / AI — evidence-grounded only.
  String get storyTextForAi {
    final buf = StringBuffer();
    buf.writeln('CONTEXT LEVEL: ${contextLevel.name}');
    buf.writeln('CONFIDENCE: ${confidence.toStringAsFixed(2)}');
    buf.writeln('HEADLINE: $headline');
    if (publisher.isNotEmpty) buf.writeln('PUBLISHER: $publisher');
    if (contextSummary.isNotEmpty) {
      buf.writeln('CONTEXT SUMMARY:\n$contextSummary');
    }
    if (verifiedFacts.isNotEmpty) {
      buf.writeln('SUPPORTED POINTS:');
      for (final f in verifiedFacts.take(6)) {
        buf.writeln('- $f');
      }
    }
    if (unverifiedClaims.isNotEmpty) {
      buf.writeln('UNVERIFIED (do not present as fact):');
      for (final c in unverifiedClaims.take(4)) {
        buf.writeln('- $c');
      }
    }
    if (relatedSources.isNotEmpty) {
      buf.writeln('RELATED SOURCES:');
      for (final s in relatedSources.take(5)) {
        buf.writeln('- ${s.publisher.isNotEmpty ? s.publisher : 'Source'}: ${s.title}');
      }
    }
    if (contextLevel == TeaContextLevel.headlineOnly) {
      buf.writeln(
        'RULE: Only the headline is confirmed. Generate discussion/opinion reactions. '
        'Do NOT invent quotes, stats, dates, relationships, or claim the full story was read.',
      );
    }
    return buf.toString().trim();
  }

  Map<String, dynamic> toJson() => {
        'headline': headline,
        'sourceUrl': sourceUrl,
        'publisher': publisher,
        'availableSnippet': availableSnippet,
        'relatedSources': relatedSources.map((e) => e.toJson()).toList(),
        'verifiedFacts': verifiedFacts,
        'unverifiedClaims': unverifiedClaims,
        'contextSummary': contextSummary,
        'contextLevel': contextLevel.name,
        'confidence': confidence,
        'generatedAt': generatedAt.toIso8601String(),
        'publishedAt': publishedAt,
        'thumbnail': thumbnail,
      };

  factory TeaTopicContext.fromJson(Map<String, dynamic> m) {
    final levelRaw = '${m['contextLevel'] ?? 'headlineOnly'}';
    final level = TeaContextLevel.values.firstWhere(
      (e) => e.name == levelRaw,
      orElse: () => TeaContextLevel.headlineOnly,
    );
    final related = <TeaRelatedSource>[];
    final rawRel = m['relatedSources'];
    if (rawRel is List) {
      for (final e in rawRel) {
        if (e is Map) related.add(TeaRelatedSource.fromJson(Map<String, dynamic>.from(e)));
      }
    }
    return TeaTopicContext(
      headline: '${m['headline'] ?? ''}',
      sourceUrl: '${m['sourceUrl'] ?? ''}',
      publisher: '${m['publisher'] ?? ''}',
      availableSnippet: '${m['availableSnippet'] ?? ''}',
      relatedSources: related,
      verifiedFacts: (m['verifiedFacts'] is List)
          ? (m['verifiedFacts'] as List).map((e) => '$e').where((s) => s.isNotEmpty).toList()
          : const [],
      unverifiedClaims: (m['unverifiedClaims'] is List)
          ? (m['unverifiedClaims'] as List).map((e) => '$e').where((s) => s.isNotEmpty).toList()
          : const [],
      contextSummary: '${m['contextSummary'] ?? ''}',
      contextLevel: level,
      confidence: (m['confidence'] is num) ? (m['confidence'] as num).toDouble() : 0,
      generatedAt: DateTime.tryParse('${m['generatedAt'] ?? ''}') ?? DateTime.now(),
      publishedAt: '${m['publishedAt'] ?? ''}',
      thumbnail: '${m['thumbnail'] ?? ''}',
    );
  }

  /// Merge into share / enrich article maps.
  Map<String, dynamic> toArticleFields() {
    final summary = displaySummary;
    return {
      'title': headline,
      'url': sourceUrl,
      'source': publisher.isNotEmpty ? publisher : 'Tea',
      'description': summary,
      'gossip': summary,
      if (summary.isNotEmpty) 'selftext': summary,
      'teaContext': toJson(),
      'contextLevel': contextLevel.name,
      'contextSummary': contextSummary,
      'contentStatus': contextLevel == TeaContextLevel.multiSource
          ? 'complete'
          : (contextLevel == TeaContextLevel.snippetBased ? 'partial' : 'titleOnly'),
    };
  }
}

const _cacheKey = 'deite_tea_topic_context_v1';
const _cacheTtl = Duration(hours: 6);
const _cacheMax = 60;

final Map<String, TeaTopicContext> _memoryCtx = {};

String teaTopicCacheKey(String url, String headline) {
  final u = normalizeUrlKey(url);
  if (u.isNotEmpty) return u;
  return 'h_${headline.trim().toLowerCase().hashCode.toRadixString(36)}';
}

TeaTopicContext? peekTeaTopicContext(String url, String headline) {
  return _memoryCtx[teaTopicCacheKey(url, headline)];
}

Future<void> _persistContext(String key, TeaTopicContext ctx) async {
  _memoryCtx[key] = ctx;
  try {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_cacheKey);
    final map = <String, dynamic>{};
    if (raw != null && raw.isNotEmpty) {
      final decoded = jsonDecode(raw);
      if (decoded is Map) {
        for (final e in decoded.entries) {
          map['${e.key}'] = e.value;
        }
      }
    }
    map[key] = {
      ...ctx.toJson(),
      'cachedAt': DateTime.now().toIso8601String(),
    };
    while (map.length > _cacheMax) {
      map.remove(map.keys.first);
    }
    await prefs.setString(_cacheKey, jsonEncode(map));
  } catch (_) {}
}

Future<TeaTopicContext?> _loadCachedContext(String key) async {
  final mem = _memoryCtx[key];
  if (mem != null && DateTime.now().difference(mem.generatedAt) < _cacheTtl) {
    return mem;
  }
  try {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_cacheKey);
    if (raw == null || raw.isEmpty) return null;
    final decoded = jsonDecode(raw);
    if (decoded is! Map) return null;
    final entry = decoded[key];
    if (entry is! Map) return null;
    final cachedAt = DateTime.tryParse('${entry['cachedAt'] ?? entry['generatedAt'] ?? ''}');
    if (cachedAt == null || DateTime.now().difference(cachedAt) > _cacheTtl) {
      return null;
    }
    final ctx = TeaTopicContext.fromJson(Map<String, dynamic>.from(entry));
    _memoryCtx[key] = ctx;
    return ctx;
  } catch (_) {
    return null;
  }
}

double _titleSimilarity(String a, String b) {
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
  final inter = ta.intersection(tb).length;
  final union = ta.union(tb).length;
  return union == 0 ? 0 : inter / union;
}

Future<List<TeaRelatedSource>> _relatedFromGoogleRss(String headline) async {
  final q = cleanTeaCardTitle(headline);
  if (q.length < 8) return [];
  try {
    final rows = await fetchLiveFromGoogleRssByQueryFast(
      '"$q" when:14d',
      timeoutMs: 7000,
    ).timeout(const Duration(seconds: 8), onTimeout: () => []);
    final out = <TeaRelatedSource>[];
    for (final r in rows.take(8)) {
      final title = '${r['title'] ?? ''}'.trim();
      final url = '${r['url'] ?? ''}'.trim();
      if (title.isEmpty || url.isEmpty) continue;
      if (_titleSimilarity(headline, title) < 0.28) continue;
      final snip = cleanFeedSnippetForDisplay('${r['description'] ?? ''}', title: title);
      out.add(TeaRelatedSource(
        title: title,
        url: url,
        publisher: '${r['source'] ?? 'News'}',
        snippet: snip,
      ));
    }
    return out;
  } catch (e) {
    debugPrint('[TeaContext] RSS related failed: $e');
    return [];
  }
}

Future<List<TeaRelatedSource>> _relatedFromNewsApi(String headline) async {
  final q = cleanTeaCardTitle(headline);
  if (q.length < 8) return [];
  try {
    final rows = await fetchNewsApiEverythingNormalized(
      q: q,
      pageSize: 5,
    ).timeout(const Duration(seconds: 8), onTimeout: () => []);
    final out = <TeaRelatedSource>[];
    for (final r in rows.take(5)) {
      final title = '${r['title'] ?? ''}'.trim();
      final url = '${r['url'] ?? ''}'.trim();
      if (title.isEmpty || url.isEmpty) continue;
      if (_titleSimilarity(headline, title) < 0.25) continue;
      out.add(TeaRelatedSource(
        title: title,
        url: url,
        publisher: '${r['source'] ?? 'News'}',
        snippet: cleanFeedSnippetForDisplay('${r['description'] ?? ''}', title: title),
      ));
    }
    return out;
  } catch (e) {
    debugPrint('[TeaContext] NewsAPI related failed: $e');
    return [];
  }
}

Future<List<TeaRelatedSource>> _relatedFromServerContext(
  String headline,
  String url,
) async {
  final bases = redditProxyBaseUrls();
  for (final base in bases.take(2)) {
    try {
      final api =
          '$base/api/tea/context?headline=${Uri.encodeComponent(headline)}&url=${Uri.encodeComponent(url)}';
      final res = await http.get(Uri.parse(api)).timeout(const Duration(seconds: 10));
      if (res.statusCode < 200 || res.statusCode >= 300) continue;
      final data = jsonDecode(res.body);
      if (data is! Map) continue;
      final list = data['relatedSources'];
      if (list is! List) continue;
      return list
          .whereType<Map>()
          .map((m) => TeaRelatedSource.fromJson(Map<String, dynamic>.from(m)))
          .where((s) => s.title.isNotEmpty && s.url.isNotEmpty)
          .take(6)
          .toList();
    } catch (e) {
      debugPrint('[TeaContext] server context failed: $e');
    }
  }
  return [];
}

Future<List<TeaRelatedSource>> _relatedFromWebSearch(String headline) async {
  try {
    final results = await ChatService.instance
        .searchWeb(cleanTeaCardTitle(headline))
        .timeout(const Duration(seconds: 6), onTimeout: () => []);
    final out = <TeaRelatedSource>[];
    for (final r in results.take(4)) {
      final title = '${r['title'] ?? ''}'.trim();
      final link = '${r['link'] ?? ''}'.trim();
      final snip = cleanFeedSnippetForDisplay('${r['snippet'] ?? ''}', title: title);
      if (title.isEmpty) continue;
      if (_titleSimilarity(headline, title) < 0.18 && snip.isEmpty) continue;
      out.add(TeaRelatedSource(
        title: title,
        url: link,
        publisher: 'Web',
        snippet: snip,
      ));
    }
    return out;
  } catch (e) {
    debugPrint('[TeaContext] web search failed: $e');
    return [];
  }
}

List<TeaRelatedSource> _dedupeSources(List<TeaRelatedSource> input) {
  final seen = <String>{};
  final out = <TeaRelatedSource>[];
  for (final s in input) {
    final key = normalizeUrlKey(s.url).isNotEmpty
        ? normalizeUrlKey(s.url)
        : s.title.toLowerCase();
    if (key.isEmpty || seen.contains(key)) continue;
    seen.add(key);
    out.add(s);
  }
  return out;
}

TeaTopicContext _buildContextFromParts({
  required String headline,
  required String sourceUrl,
  required String publisher,
  required String snippet,
  required String publishedAt,
  required String thumbnail,
  required List<TeaRelatedSource> related,
  String? seedBody,
}) {
  final cleanedSnippet = cleanFeedSnippetForDisplay(snippet, title: headline);
  final body = cleanFeedSnippetForDisplay(seedBody ?? '', title: headline);
  final corroborating = related
      .where((s) => _titleSimilarity(headline, s.title) >= 0.35 || s.snippet.length >= 40)
      .toList();

  final facts = <String>[];
  final unverified = <String>[];

  // Headline is always a reportable claim, not a verified event detail.
  if (headline.isNotEmpty) {
    facts.add('Reported headline: $headline');
  }
  if (publisher.isNotEmpty) {
    facts.add('Attributed publisher: $publisher');
  }

  final snippetPool = <String>[
    if (body.isNotEmpty) body,
    if (cleanedSnippet.isNotEmpty) cleanedSnippet,
    ...corroborating.map((s) => s.snippet).where((s) => s.length >= 40),
  ];

  // A snippet becomes a "supported point" only when mirrored by another source
  // or when we already have a substantial seed body (Reddit/YouTube).
  for (final snip in snippetPool) {
    final short = snip.length > 220 ? '${snip.substring(0, 220).trim()}…' : snip;
    final mirrored = snippetPool
            .where((o) => o != snip && _titleSimilarity(snip, o) >= 0.35)
            .length >=
        1;
    if (mirrored || body.length >= 80) {
      if (!facts.any((f) => _titleSimilarity(f, short) > 0.7)) {
        facts.add(short);
      }
    } else if (snip == cleanedSnippet && cleanedSnippet.isNotEmpty) {
      unverified.add('Single-source snippet (unconfirmed): $short');
    }
  }

  TeaContextLevel level;
  double confidence;
  if (corroborating.length >= 2 || (body.length >= 80 && corroborating.isNotEmpty)) {
    level = TeaContextLevel.multiSource;
    confidence = (0.55 + corroborating.length * 0.1 + (body.length >= 80 ? 0.15 : 0))
        .clamp(0.55, 0.95);
  } else if (cleanedSnippet.isNotEmpty || body.length >= 40) {
    level = TeaContextLevel.snippetBased;
    confidence = body.length >= 80 ? 0.55 : 0.4;
  } else {
    level = TeaContextLevel.headlineOnly;
    confidence = 0.2;
  }

  String summary;
  switch (level) {
    case TeaContextLevel.multiSource:
      final bits = <String>[
        if (cleanedSnippet.isNotEmpty) cleanedSnippet,
        ...corroborating.take(2).map((s) => s.snippet).where((s) => s.isNotEmpty),
        if (body.isNotEmpty && body != cleanedSnippet) body,
      ];
      summary = bits.isEmpty
          ? 'Multiple outlets are covering "$headline". Details beyond the headline remain limited.'
          : bits.first.length > 320
              ? '${bits.first.substring(0, 320).trim()}…'
              : bits.first;
      if (corroborating.length >= 2) {
        summary =
            '$summary\n\nAlso covered by ${corroborating.take(3).map((s) => s.publisher).where((p) => p.isNotEmpty).toSet().join(', ')}.';
      }
      break;
    case TeaContextLevel.snippetBased:
      summary = cleanedSnippet.isNotEmpty
          ? cleanedSnippet
          : (body.isNotEmpty
              ? body
              : 'Only a short blurb is available for "$headline". Treat details as incomplete.');
      break;
    case TeaContextLevel.headlineOnly:
      summary = publisher.isNotEmpty
          ? 'Limited context: only the headline is available from $publisher. Full article text was not accessible.'
          : 'Limited context: only the headline is available. Full article text was not accessible.';
      break;
  }

  return TeaTopicContext(
    headline: headline,
    sourceUrl: sourceUrl,
    publisher: publisher,
    availableSnippet: cleanedSnippet.isNotEmpty ? cleanedSnippet : body,
    relatedSources: corroborating.take(6).toList(),
    verifiedFacts: facts.take(8).toList(),
    unverifiedClaims: unverified.take(6).toList(),
    contextSummary: summary.trim(),
    contextLevel: level,
    confidence: confidence,
    generatedAt: DateTime.now(),
    publishedAt: publishedAt,
    thumbnail: thumbnail,
  );
}

/// Headline-first enrichment — scrape is never required.
/// Pass any already-known body/snippet on [seed]; related sources are fetched
/// from Google News RSS, NewsAPI, optional server `/api/tea/context`, and DDG.
Future<TeaTopicContext> enrichTeaTopicContext(
  Map<String, dynamic> seed, {
  bool forceRefresh = false,
}) async {
  final headline = cleanTeaCardTitle('${seed['title'] ?? seed['headline'] ?? ''}');
  final sourceUrl = '${seed['url'] ?? seed['sourceUrl'] ?? ''}'.trim();
  final publisher =
      '${seed['source'] ?? seed['publisher'] ?? seed['author'] ?? ''}'.trim();
  final publishedAt = '${seed['publishedAt'] ?? ''}'.trim();
  final thumbnail = '${seed['image'] ?? seed['thumbnail'] ?? ''}'.trim();
  final seedSnippet = cleanFeedSnippetForDisplay(
    '${seed['gossip'] ?? seed['description'] ?? seed['availableSnippet'] ?? ''}',
    title: headline,
  );

  final key = teaTopicCacheKey(sourceUrl, headline);
  if (!forceRefresh) {
    final cached = await _loadCachedContext(key);
    if (cached != null) return cached;
  }

  // Prefer existing Reddit / YouTube / extracted body already on the seed.
  final seedBody = cleanFeedSnippetForDisplay(
    '${seed['bodyText'] ?? seed['body'] ?? seed['selftext'] ?? seed['text'] ?? ''}',
    title: headline,
  );

  final results = await Future.wait([
    _relatedFromGoogleRss(headline),
    _relatedFromNewsApi(headline),
    _relatedFromServerContext(headline, sourceUrl),
    _relatedFromWebSearch(headline),
  ]);

  final related = _dedupeSources([
    ...results[0],
    ...results[1],
    ...results[2],
    ...results[3],
  ]).where((s) {
    final sameUrl = normalizeUrlKey(s.url) == normalizeUrlKey(sourceUrl) &&
        normalizeUrlKey(sourceUrl).isNotEmpty;
    return !sameUrl || s.snippet.isNotEmpty;
  }).toList();

  final ctx = _buildContextFromParts(
    headline: headline,
    sourceUrl: sourceUrl,
    publisher: publisher,
    snippet: seedSnippet,
    publishedAt: publishedAt,
    thumbnail: thumbnail,
    related: related,
    seedBody: seedBody,
  );

  await _persistContext(key, ctx);
  debugPrint(
    '[TeaContext] level=${ctx.contextLevel.name} conf=${ctx.confidence.toStringAsFixed(2)} '
    'sources=${ctx.relatedSources.length} headline="${headline.length > 48 ? headline.substring(0, 48) : headline}"',
  );
  return ctx;
}

/// Attach context fields onto a tea/share seed map.
Future<Map<String, dynamic>> attachTeaTopicContext(
  Map<String, dynamic> seed,
) async {
  final ctx = await enrichTeaTopicContext(seed);
  return {
    ...seed,
    ...ctx.toArticleFields(),
    if ('${seed['image'] ?? ''}'.isEmpty && ctx.thumbnail.isNotEmpty)
      'image': ctx.thumbnail,
  };
}
