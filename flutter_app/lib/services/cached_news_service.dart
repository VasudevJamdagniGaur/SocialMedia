import 'package:cloud_firestore/cloud_firestore.dart';

import '../lib/pod_topic_news_shared.dart';

const String _collection = 'news';

const Map<String, String> _liveQueries = {
  'current_affairs': 'world OR politics OR global',
  'sports': 'cricket OR football OR sports',
  'ai_tech': 'AI OR artificial intelligence OR technology',
  'entrepreneurship': 'startup OR business OR entrepreneurship',
};

const Map<String, String> _rssQueries = {
  'current_affairs': 'world news when:2d',
  'sports': 'sports headlines when:2d',
  'ai_tech': 'technology OR AI when:2d',
  'entrepreneurship': 'business OR startup when:2d',
};

const Map<String, String> _headlineCategory = {
  'current_affairs': 'general',
  'sports': 'sports',
  'ai_tech': 'technology',
  'entrepreneurship': 'business',
};

String hubNewsDocIdFromUrl(String url) {
  final s = url;
  var h = 0;
  for (var i = 0; i < s.length; i++) {
    h = (31 * h + s.codeUnitAt(i)) & 0x7fffffff;
    if (h > 0x7fffffff) h = h - 0x100000000;
  }
  return 'hn_${h.abs().toRadixString(36)}';
}

class CachedArticle {
  const CachedArticle({
    required this.title,
    required this.source,
    required this.url,
    this.image,
    this.description = '',
    this.publishedAt,
  });

  final String title;
  final String source;
  final String url;
  final String? image;
  final String description;
  final String? publishedAt;

  Map<String, dynamic> toJson() => {
        'title': title,
        'source': source,
        'url': url,
        'image': image,
        'description': description,
        'publishedAt': publishedAt,
      };
}

class CachedNewsResult {
  const CachedNewsResult({
    required this.success,
    required this.articles,
    required this.lastUpdated,
    this.error,
    this.fromLiveFallback = false,
    this.fallbackError,
  });

  final bool success;
  final List<CachedArticle> articles;
  final int lastUpdated;
  final String? error;
  final bool fromLiveFallback;
  final String? fallbackError;
}

/// Hub news: prefer Firestore `news/{category}`; fallback to NewsAPI.
class CachedNewsService {
  CachedNewsService._();

  static final CachedNewsService instance = CachedNewsService._();

  factory CachedNewsService() => instance;

  Future<CachedNewsResult> getNews(String category) async {
    final id = category.trim();
    if (id.isEmpty) {
      return const CachedNewsResult(
        success: false,
        articles: [],
        lastUpdated: 0,
        error: 'missing_category',
      );
    }
    try {
      final ref = FirebaseFirestore.instance.collection(_collection).doc(id);
      final snap = await ref.get();
      if (!snap.exists) {
        return const CachedNewsResult(success: true, articles: [], lastUpdated: 0);
      }
      final d = snap.data() ?? {};
      final raw = d['articles'] is List ? d['articles'] as List : [];
      final lastUpdated =
          d['lastUpdated'] is num ? (d['lastUpdated'] as num).toInt() : 0;
      final articles = raw
          .where((a) => a is Map && a['title'] != null && a['url'] != null)
          .map((a) {
        final m = a as Map;
        final img = m['image'];
        return CachedArticle(
          title: '${m['title'] ?? ''}',
          source: '${m['source'] ?? 'News'}',
          url: '${m['url'] ?? ''}',
          image: img is String && img.trim().startsWith('http') ? img.trim() : null,
          description: '${m['description'] ?? ''}',
          publishedAt: m['publishedAt'] != null ? '${m['publishedAt']}' : null,
        );
      }).toList();
      return CachedNewsResult(
        success: true,
        articles: articles,
        lastUpdated: lastUpdated,
      );
    } catch (e) {
      return CachedNewsResult(
        success: false,
        articles: const [],
        lastUpdated: 0,
        error: e.toString(),
      );
    }
  }

  Future<CachedNewsResult> getNewsWithLiveFallback(String category) async {
    final id = category.trim();
    final base = await getNews(id);
    if (base.success && base.articles.isNotEmpty) {
      return CachedNewsResult(
        success: base.success,
        articles: base.articles,
        lastUpdated: base.lastUpdated,
        fromLiveFallback: false,
      );
    }

    final q = _liveQueries[id];
    final headCat = _headlineCategory[id];
    if (q == null || headCat == null) {
      return CachedNewsResult(
        success: base.success,
        articles: base.articles,
        lastUpdated: base.lastUpdated,
        fromLiveFallback: false,
        error: base.error,
      );
    }

    try {
      final region = await resolveUserNewsRegionForNewsApi();
      var raw = await fetchNewsApiTopHeadlinesRaw(
        category: headCat,
        country: region['code'] as String,
        language: 'en',
        pageSize: 10,
      );
      if (raw.isEmpty) {
        raw = await fetchNewsApiTopHeadlinesRaw(
          category: headCat,
          country: region['code'] as String,
          language: false,
          pageSize: 10,
        );
      }
      if (raw.isEmpty) {
        raw = await fetchNewsApiEverythingRaw(
          q: q,
          language: 'en',
          pageSize: 10,
          sortBy: 'publishedAt',
        );
      }

      final articles = normalizeArticles(raw).map((a) {
        final img = a['image'];
        return CachedArticle(
          title: a['title'] as String? ?? '',
          source: a['source'] as String? ?? 'News',
          url: a['url'] as String? ?? '',
          image: img is String && img.trim().startsWith('http') ? img.trim() : null,
          description: a['description'] as String? ?? '',
          publishedAt: a['publishedAt'] != null ? '${a['publishedAt']}' : null,
        );
      }).toList();

      if (articles.isEmpty) {
        final rssQ = _rssQueries[id];
        if (rssQ != null) {
          final rssItems = await fetchLiveFromGoogleRssByQuery(rssQ);
          for (final a in normalizeArticles(rssItems)) {
            final img = a['image'];
            articles.add(CachedArticle(
              title: a['title'] as String? ?? '',
              source: a['source'] as String? ?? 'News',
              url: a['url'] as String? ?? '',
              image: img is String && img.trim().startsWith('http') ? img.trim() : null,
              description: a['description'] as String? ?? '',
              publishedAt: a['publishedAt'] != null ? '${a['publishedAt']}' : null,
            ));
          }
        }
      }

      if (articles.isEmpty) {
        return CachedNewsResult(
          success: base.success,
          articles: base.articles,
          lastUpdated: base.lastUpdated,
          fromLiveFallback: false,
          fallbackError:
              'NewsAPI returned no articles. Check NEWSAPI_KEY and backend proxy.',
        );
      }

      return CachedNewsResult(
        success: true,
        articles: articles,
        lastUpdated: base.lastUpdated,
        fromLiveFallback: true,
      );
    } catch (e) {
      return CachedNewsResult(
        success: base.success,
        articles: base.articles,
        lastUpdated: base.lastUpdated,
        fromLiveFallback: false,
        fallbackError: e.toString(),
      );
    }
  }

  static const List<String> hubCategories = [
    'current_affairs',
    'sports',
    'ai_tech',
    'entrepreneurship',
  ];

  Future<Map<String, dynamic>> getHubTrendingMergedFromFirestore() async {
    try {
      final results = await Future.wait(
        hubCategories.map(getNewsWithLiveFallback),
      );
      final failed = results.cast<CachedNewsResult?>().firstWhere(
            (r) => !r!.success && r.error != null,
            orElse: () => null,
          );
      if (failed != null) {
        return {'success': false, 'items': [], 'error': failed.error};
      }

      final seen = <String>{};
      final items = <Map<String, dynamic>>[];

      for (var i = 0; i < hubCategories.length; i++) {
        final cat = hubCategories[i];
        for (final a in results[i].articles) {
          final u = a.url.trim();
          if (u.isEmpty || seen.contains(u)) continue;
          seen.add(u);
          items.add({
            ...a.toJson(),
            'id': hubNewsDocIdFromUrl(u),
            'category': cat,
            'fromNewsApiFallback': true,
          });
        }
      }

      items.sort((a, b) {
        final ta = DateTime.tryParse('${a['publishedAt']}')?.millisecondsSinceEpoch ?? 0;
        final tb = DateTime.tryParse('${b['publishedAt']}')?.millisecondsSinceEpoch ?? 0;
        return tb.compareTo(ta);
      });

      return {'success': true, 'items': items};
    } catch (e) {
      return {'success': false, 'items': [], 'error': e.toString()};
    }
  }
}

final cachedNewsService = CachedNewsService.instance;

Future<CachedNewsResult> getNews(String category) =>
    CachedNewsService.instance.getNews(category);

Future<CachedNewsResult> getNewsWithLiveFallback(String category) =>
    CachedNewsService.instance.getNewsWithLiveFallback(category);

Future<Map<String, dynamic>> getHubTrendingMergedFromFirestore() =>
    CachedNewsService.instance.getHubTrendingMergedFromFirestore();
