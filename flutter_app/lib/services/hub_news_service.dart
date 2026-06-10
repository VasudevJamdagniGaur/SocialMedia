import 'dart:async';
import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:http/http.dart' as http;

import '../lib/hub_trending_algorithms.dart';
import '../lib/pod_topic_news_shared.dart';
import 'hub_vertical_personalization_service.dart';

const String _collection = 'news';
const int _firestoreQueryTimeoutMs = 12000;

const Map<String, String> _interestQueries = {
  'cricket': '(cricket OR IPL OR "test match")',
  'football': '(football OR soccer OR FIFA OR Premier League)',
  'f1': '(F1 OR "Formula 1" OR Grand Prix)',
  'chess': '(chess OR FIDE OR "world chess")',
  'others': '(sports OR athletics OR Olympics)',
};

/// Google News RSS per interest (no NewsAPI quota).
const Map<String, String> _hubRssByInterest = {
  'cricket': 'cricket OR IPL OR T20 when:2d',
  'football': 'soccer OR MLS OR Premier League when:2d',
  'f1': 'Formula 1 OR F1 when:2d',
  'chess': 'chess OR FIDE when:2d',
  'others': 'sports headlines when:2d',
};

int _toInt32(num v) {
  var n = v.toInt() & 0xFFFFFFFF;
  if (n >= 0x80000000) n -= 0x100000000;
  return n;
}

int _imul31(int h) => _toInt32(31 * h);

Future<QuerySnapshot<Map<String, dynamic>>> _getDocsWithTimeout(
  Query<Map<String, dynamic>> qRef,
  String label,
) {
  return Future.any([
    qRef.get(),
    Future<QuerySnapshot<Map<String, dynamic>>>.delayed(
      const Duration(milliseconds: _firestoreQueryTimeoutMs),
      () => throw Exception('firestore_timeout:$label'),
    ),
  ]);
}

String hubNewsDocIdFromUrl(String url) {
  final s = url;
  var h = 0;
  for (var i = 0; i < s.length; i++) {
    h = _toInt32(_imul31(h) + s.codeUnitAt(i));
  }
  return 'hn_${h.abs().toRadixString(36)}';
}

String _normalizeCountry(String? code) {
  final s = (code ?? '').toUpperCase().replaceAll(RegExp(r'[^A-Z]'), '');
  return s.length > 2 ? s.substring(0, 2) : s;
}

String _normalizeCategory(String? c) {
  final s = (c ?? '').toLowerCase().replaceAll(RegExp(r'[^a-z0-9_-]'), '');
  return s.length > 40 ? s.substring(0, 40) : s;
}

String _normalizeCity(String? c) {
  final s = (c ?? '').trim();
  return s.length > 80 ? s.substring(0, 80) : s;
}

Future<Map<String, dynamic>?> getUserHubFeedProfile(String? uid) async {
  if (uid == null || uid.isEmpty) return null;
  final ref = FirebaseFirestore.instance.collection('users').doc(uid);
  final snap = await ref.get();
  final d = snap.exists ? snap.data() ?? {} : <String, dynamic>{};
  var country = _normalizeCountry(d['country'] ?? d['hubCountry']);
  var city = _normalizeCity(d['city'] ?? d['hubCity']);
  var interests = (d['interests'] is List
          ? (d['interests'] as List)
              .map((x) => _normalizeCategory('$x'))
              .where((x) => x.isNotEmpty)
              .toList()
          : <String>[])
      .cast<String>();
  if (interests.isEmpty) interests = List<String>.from(hubDefaultInterests);
  interests = interests.toSet().toList().take(10).toList();
  return {
    'country': country,
    'city': city,
    'interests': interests,
    'raw': d,
  };
}

Future<Map<String, dynamic>> mergeUserHubFeedProfile(
  String? uid,
  Map<String, dynamic> partial,
) async {
  if (uid == null || uid.isEmpty) return {'success': false};
  final ref = FirebaseFirestore.instance.collection('users').doc(uid);
  final payload = <String, dynamic>{};
  if (partial.containsKey('country') && partial['country'] != null) {
    payload['country'] = _normalizeCountry('${partial['country']}');
  }
  if (partial.containsKey('city') && partial['city'] != null) {
    payload['city'] = _normalizeCity('${partial['city']}');
  }
  if (partial['interests'] is List) {
    payload['interests'] = (partial['interests'] as List)
        .map((x) => _normalizeCategory('$x'))
        .where((x) => x.isNotEmpty)
        .toSet()
        .toList()
        .take(15)
        .toList();
  }
  if (payload.isEmpty) return {'success': true};
  await ref.set(payload, SetOptions(merge: true));
  return {'success': true};
}

Future<Map<String, dynamic>> syncUserHubLocationFromIp(String? uid) async {
  if (uid == null || uid.isEmpty) return {'success': false};
  try {
    final res = await http
        .get(Uri.parse('https://ipapi.co/json/'))
        .timeout(const Duration(seconds: 5));
    Map<String, dynamic>? data;
    try {
      final decoded = jsonDecode(res.body);
      if (decoded is Map<String, dynamic>) {
        data = decoded;
      } else if (decoded is Map) {
        data = Map<String, dynamic>.from(decoded);
      }
    } catch (_) {
      data = null;
    }
    final country = _normalizeCountry(data?['country_code']);
    final city = _normalizeCity(data?['city']);
    if (country.length == 2) {
      await mergeUserHubFeedProfile(uid, {'country': country, 'city': city});
      return {'success': true, 'country': country, 'city': city};
    }
  } catch (_) {
    /* ignore */
  }
  return {'success': false};
}

Future<Map<String, dynamic>> upsertHubNewsItem({
  required String title,
  String? image,
  String? source,
  required String url,
  String? category,
  String? country,
  String? city,
}) async {
  final urlStr = url.trim();
  if (urlStr.isEmpty || title.isEmpty) {
    return {'success': false, 'error': 'missing url/title'};
  }
  final id = hubNewsDocIdFromUrl(urlStr);
  final ref = FirebaseFirestore.instance.collection(_collection).doc(id);
  final snap = await ref.get();
  final ctry = _normalizeCountry(country);
  if (ctry.length != 2) return {'success': false, 'error': 'invalid country'};
  final normalizedCat = _normalizeCategory(category);
  final cat = normalizedCat.isEmpty ? 'others' : normalizedCat;
  final nowTs = Timestamp.now();
  if (!snap.exists) {
    const likes = 0;
    const shares = 0;
    const views = 0;
    final trendingScore = computeHubTrendingScore(likes, shares, views, nowTs);
    await ref.set({
      'title': title.length > 500 ? title.substring(0, 500) : title,
      'image': image,
      'source': (source ?? 'News').length > 200
          ? (source ?? 'News').substring(0, 200)
          : (source ?? 'News'),
      'url': urlStr,
      'category': cat,
      'country': ctry,
      'city': _normalizeCity(city),
      'likes': likes,
      'shares': shares,
      'views': views,
      'trendingScore': trendingScore,
      'createdAt': nowTs,
    });
    return {'success': true, 'id': id, 'created': true};
  }
  return {'success': true, 'id': id, 'created': false};
}

Future<Map<String, dynamic>> incrementHubNewsEngagement(
  String? newsId,
  String? kind,
) async {
  final id = (newsId ?? '').trim();
  if (id.isEmpty || !['like', 'share', 'view'].contains(kind)) {
    return {'success': false};
  }
  final ref = FirebaseFirestore.instance.collection(_collection).doc(id);
  await FirebaseFirestore.instance.runTransaction((transaction) async {
    final snap = await transaction.get(ref);
    if (!snap.exists) return;
    final d = snap.data() ?? {};
    var likes = (d['likes'] as num?)?.toInt() ?? 0;
    var shares = (d['shares'] as num?)?.toInt() ?? 0;
    var views = (d['views'] as num?)?.toInt() ?? 0;
    if (kind == 'like') {
      likes += 1;
    } else if (kind == 'share') {
      shares += 1;
    } else {
      views += 1;
    }
    final trendingScore =
        computeHubTrendingScore(likes, shares, views, d['createdAt']);
    transaction.update(ref, {
      'likes': likes,
      'shares': shares,
      'views': views,
      'trendingScore': trendingScore,
    });
  });
  return {'success': true};
}

Map<String, dynamic> _mapNewsDoc(String id, Map<String, dynamic> x) {
  return {
    'id': id,
    'title': x['title'] ?? '',
    'image': x['image'],
    'source': x['source'] ?? '',
    'url': x['url'] ?? '',
    'category': x['category'] ?? '',
    'country': x['country'] ?? '',
    'city': x['city'] ?? '',
    'likes': (x['likes'] as num?)?.toInt() ?? 0,
    'shares': (x['shares'] as num?)?.toInt() ?? 0,
    'views': (x['views'] as num?)?.toInt() ?? 0,
    'trendingScore': (x['trendingScore'] as num?)?.toDouble() ?? 0,
    'createdAt': x['createdAt'],
  };
}

Future<List<Map<String, dynamic>>> _queryNewsTrending(
  String? country,
  List<String> categories,
  int maxDocs,
) async {
  final ctry = _normalizeCountry(country);
  if (ctry.length != 2 || categories.isEmpty) return [];
  final cats = categories.take(10).toList();
  try {
    final col = FirebaseFirestore.instance.collection(_collection);
    final q = col
        .where('country', isEqualTo: ctry)
        .where('category', whereIn: cats)
        .orderBy('trendingScore', descending: true)
        .limit(maxDocs > 40 ? 40 : maxDocs);
    final snap = await _getDocsWithTimeout(q, 'trending');
    return snap.docs.map((d) => _mapNewsDoc(d.id, d.data())).toList();
  } on FirebaseException catch (e) {
    if (e.code == 'permission-denied') rethrow;
    // ignore other firestore errors
    return [];
  } catch (e) {
    if ('$e'.startsWith('Exception: firestore_timeout:')) {
      // timeout
      return [];
    }
    return [];
  }
}

Future<List<Map<String, dynamic>>> _queryNewsLatest(
  String? country,
  List<String> categories,
  int maxDocs,
) async {
  final ctry = _normalizeCountry(country);
  if (ctry.length != 2 || categories.isEmpty) return [];
  final cats = categories.take(10).toList();
  try {
    final col = FirebaseFirestore.instance.collection(_collection);
    final q = col
        .where('country', isEqualTo: ctry)
        .where('category', whereIn: cats)
        .orderBy('createdAt', descending: true)
        .limit(maxDocs > 40 ? 40 : maxDocs);
    final snap = await _getDocsWithTimeout(q, 'latest');
    return snap.docs.map((d) => _mapNewsDoc(d.id, d.data())).toList();
  } on FirebaseException catch (e) {
    if (e.code == 'permission-denied') rethrow;
    return [];
  } catch (e) {
    if ('$e'.startsWith('Exception: firestore_timeout:')) {
      return [];
    }
    return [];
  }
}

String _hubFeedTitleDedupeKey(String? raw) {
  var t = (raw ?? '').trim().toLowerCase().replaceAll(RegExp(r'\s+'), ' ');
  if (t.isEmpty) return '';
  t = t.replaceAll(RegExp(r'\s*[-â€“â€”]\s*[^-â€“â€”]{1,120}$'), '').trim();
  return t.length > 140 ? t.substring(0, 140) : t;
}

bool _tryAddHubFeedItem(
  Set<String> seenUrl,
  Set<String> seenTitleKey,
  List<Map<String, dynamic>> list,
  Map<String, dynamic>? row,
  Map<String, dynamic> partial,
) {
  final url = (row?['url'] ?? '').toString().trim();
  final title = (row?['title'] ?? '').toString().trim();
  if (url.isEmpty || title.isEmpty) return false;
  if (seenUrl.contains(url)) return false;
  final tk = _hubFeedTitleDedupeKey(title);
  if (tk.isNotEmpty && seenTitleKey.contains(tk)) return false;
  seenUrl.add(url);
  if (tk.isNotEmpty) seenTitleKey.add(tk);
  list.add({
    'id': hubNewsDocIdFromUrl(url),
    'title': row!['title'],
    'image': row['image'],
    'description': row['description'] ?? '',
    'publisherUrl': row['publisherUrl'] ?? '',
    'publishedAt': row['publishedAt'],
    'source': row['source'] ?? 'News',
    'url': url,
    'likes': 0,
    'shares': 0,
    'views': 0,
    'trendingScore': 0,
    'createdAt': null,
    'fromNewsApiFallback': true,
    ...partial,
  });
  return true;
}

Future<void> _appendInterestGoogleNewsRssParallel(
  Map<String, dynamic>? profile,
  List<String> cats,
  Set<String> seenUrl,
  Set<String> seenTitleKey,
  List<Map<String, dynamic>> unique,
  int capUrls,
) async {
  final ctry = _normalizeCountry(profile?['country']);
  final sub = cats.take(5).where((c) => c.isNotEmpty).toList();
  if (sub.isEmpty) return;
  final pairs = sub
      .map((cat) => {
            'cat': cat,
            'q': _hubRssByInterest[cat] ?? '$cat news when:2d',
          })
      .toList();
  final batches = await Future.wait(
    pairs.map((p) => fetchLiveFromGoogleRssByQuery(p['q'] as String)),
  );
  for (var i = 0; i < batches.length; i++) {
    if (unique.length >= capUrls) break;
    final cat = pairs[i]['cat'] as String;
    for (final row in batches[i]) {
      if (unique.length >= capUrls) break;
      _tryAddHubFeedItem(seenUrl, seenTitleKey, unique, row, {
        'category': cat,
        'country': ctry,
        'city': profile?['city'] ?? '',
        'feedTag': {'label': 'For you', 'emoji': 'ðŸ“°'},
        'mixBucket': 'trending',
        'hubVertical': 'sports',
      });
    }
  }
}

Future<void> _appendHubGoogleNewsRss(
  Map<String, dynamic>? profile,
  Set<String> seenUrl,
  Set<String> seenTitleKey,
  List<Map<String, dynamic>> unique,
) async {
  final ctry = _normalizeCountry(profile?['country']);
  final rssQ = ctry.toUpperCase() == 'IN'
      ? 'India news OR technology OR business when:2d'
      : 'world news headlines when:2d';
  final rssItems = await fetchLiveFromGoogleRssByQuery(rssQ);
  for (final row in rssItems) {
    _tryAddHubFeedItem(seenUrl, seenTitleKey, unique, row, {
      'category': 'others',
      'country': ctry,
      'city': profile?['city'] ?? '',
      'feedTag': {'label': 'Headlines', 'emoji': 'ðŸ“°'},
      'mixBucket': 'trending',
      'hubVertical': 'current-affairs',
    });
  }
}

bool _hubItemHasRemotePhoto(Map<String, dynamic>? it) {
  final im = it?['image'];
  if (im is! String) return false;
  final s = im.trim();
  return RegExp(r'^https?://', caseSensitive: false).hasMatch(s) &&
      !RegExp(r'^data:', caseSensitive: false).hasMatch(s);
}

Future<List<Map<String, dynamic>>> buildNewsApiFallbackFeed(
  Map<String, dynamic>? profile, [
  int targetSize = 20,
  Map<String, dynamic>? options,
]) async {
  final interests = profile?['interests'];
  final cats = (interests is List && interests.isNotEmpty
          ? List<String>.from(interests)
          : List<String>.from(hubDefaultInterests))
      .take(5)
      .toList();
  if (!canFetchLiveNews()) return [];

  final seenUrl = <String>{};
  final seenTitleKey = <String>{};
  final unique = <Map<String, dynamic>>[];
  final ctry = _normalizeCountry(profile?['country']);
  final skipNewsApi = isNewsApiRateLimitedCooldown();

  if (!skipNewsApi) {
    final code = ctry.length == 2 ? ctry.toLowerCase() : 'us';

    Future<List<Map<String, dynamic>>> sportsHeadlinesForHub() async {
      var s = await fetchNewsApiTopHeadlinesNormalized(
        category: 'sports',
        country: code,
        language: 'en',
        pageSize: 22,
      );
      if (s.isEmpty) {
        s = await fetchNewsApiTopHeadlinesNormalized(
          category: 'sports',
          country: code,
          language: false,
          pageSize: 22,
        );
      }
      return s;
    }

    final thFuture = fetchNewsApiTopHeadlinesNormalized(
      country: code,
      pageSize: targetSize + 12 > 32 ? 32 : targetSize + 12,
      language: 'en',
    );
    final sportsThFuture = sportsHeadlinesForHub();
    final perCatRowsFuture = Future.wait(
      cats.map(
        (cat) => fetchNewsApiEverythingNormalized(
          q: _interestQueries[cat] ?? cat,
          pageSize: 10,
          language: 'en',
        ),
      ),
    );

    final results = await Future.wait([
      thFuture,
      sportsThFuture,
      perCatRowsFuture,
    ]);
    final th = results[0] as List<Map<String, dynamic>>;
    final sportsTh = results[1] as List<Map<String, dynamic>>;
    final perCatRows = results[2] as List<List<Map<String, dynamic>>>;

    for (final row in th) {
      _tryAddHubFeedItem(seenUrl, seenTitleKey, unique, row, {
        'category': 'others',
        'country': ctry,
        'city': profile?['city'] ?? '',
        'feedTag': {'label': 'Trending', 'emoji': 'ðŸ”¥'},
        'mixBucket': 'trending',
        'hubVertical': 'current-affairs',
      });
    }

    for (final row in sportsTh) {
      _tryAddHubFeedItem(seenUrl, seenTitleKey, unique, row, {
        'category': 'others',
        'country': ctry,
        'city': profile?['city'] ?? '',
        'feedTag': {'label': 'Sports', 'emoji': 'âš½'},
        'mixBucket': 'trending',
        'hubVertical': 'sports',
      });
    }

    for (var i = 0; i < cats.length; i++) {
      final cat = cats[i];
      for (final row in perCatRows[i]) {
        _tryAddHubFeedItem(seenUrl, seenTitleKey, unique, row, {
          'category': cat,
          'country': profile?['country'] ?? '',
          'city': profile?['city'] ?? '',
          'feedTag': {'label': 'For you', 'emoji': 'ðŸ“°'},
          'mixBucket': 'trending',
          'hubVertical': 'sports',
        });
      }
    }

    final vwOpt = options?['verticalWeights'] as Map<String, int>?;
    if (vwOpt != null && !skipNewsApi) {
      final pullTech = (vwOpt['ai-tech'] ?? 0) >= 6;
      final pullBiz = (vwOpt['entrepreneurship'] ?? 0) >= 6;
      final extra = await Future.wait([
        pullTech
            ? fetchNewsApiTopHeadlinesNormalized(
                category: 'technology',
                language: 'en',
                pageSize: 14,
              )
            : Future.value(<Map<String, dynamic>>[]),
        pullBiz
            ? fetchNewsApiTopHeadlinesNormalized(
                category: 'business',
                language: 'en',
                pageSize: 14,
              )
            : Future.value(<Map<String, dynamic>>[]),
      ]);
      for (final row in extra[0]) {
        _tryAddHubFeedItem(seenUrl, seenTitleKey, unique, row, {
          'category': 'technology',
          'country': ctry,
          'city': profile?['city'] ?? '',
          'feedTag': {'label': 'AI & Tech', 'emoji': 'ðŸ¤–'},
          'mixBucket': 'trending',
          'hubVertical': 'ai-tech',
        });
      }
      for (final row in extra[1]) {
        _tryAddHubFeedItem(seenUrl, seenTitleKey, unique, row, {
          'category': 'business',
          'country': ctry,
          'city': profile?['city'] ?? '',
          'feedTag': {'label': 'Business', 'emoji': 'ðŸ“ˆ'},
          'mixBucket': 'trending',
          'hubVertical': 'entrepreneurship',
        });
      }
    }
  }

  await _appendHubGoogleNewsRss(profile, seenUrl, seenTitleKey, unique);
  await _appendInterestGoogleNewsRssParallel(
    profile,
    cats,
    seenUrl,
    seenTitleKey,
    unique,
    48,
  );

  final vwRank =
      options?['verticalWeights'] as Map<String, int>? ?? await getHubVerticalWeights();
  final personalized = rankHubLiveItemsByPersonalization(unique, vwRank);
  final withPhoto = personalized.where(_hubItemHasRemotePhoto).toList();
  final rest = personalized.where((it) => !_hubItemHasRemotePhoto(it)).toList();
  final ranked = [...withPhoto, ...rest];
  final top = ranked.take(targetSize).toList();

  final enriched = await enrichNewsItemsWithOgImages(
    top,
    enableOgFallback: true,
    maxResolve: targetSize,
    concurrency: 4,
  );

  return enriched.map((it) {
    if (_hubItemHasRemotePhoto(it)) return it;
    final im = it['image'];
    if (im is String &&
        RegExp(r'^https?://', caseSensitive: false).hasMatch(im.trim()) &&
        !RegExp(r'^data:', caseSensitive: false).hasMatch(im.trim())) {
      return it;
    }
    return {...it, 'image': null};
  }).toList();
}

Future<Map<String, dynamic>> hydrateHubNewsFromApi(
  String? country,
  String? city,
  List<String> interests,
) async {
  final ctry = _normalizeCountry(country);
  final cit = _normalizeCity(city);
  final cats = (interests.isNotEmpty ? interests : hubDefaultInterests)
      .take(5)
      .toList();
  if (!canFetchLiveNews() || ctry.length != 2) {
    return {'success': false, 'count': 0};
  }
  if (isNewsApiRateLimitedCooldown()) {
    return {'success': true, 'count': 0};
  }

  var total = 0;
  for (final cat in cats) {
    final qExtra = _interestQueries[cat] ?? cat;
    final rows = await fetchNewsApiEverythingNormalized(
      q: qExtra,
      pageSize: 5,
      language: 'en',
    );
    for (final row in rows) {
      final url = row['url'];
      final title = row['title'];
      if (url == null || '$url'.trim().isEmpty || title == null) continue;
      final r = await upsertHubNewsItem(
        title: '$title',
        image: row['image'] as String?,
        source: row['source'] as String?,
        url: '$url',
        category: cat,
        country: ctry,
        city: cit,
      );
      if (r['success'] == true && r['created'] == true) total += 1;
    }
  }
  return {'success': true, 'count': total};
}

Future<void> recordHubNewsClick(String? uid, String? category) async {
  final cat = _normalizeCategory(category);
  if (uid == null || uid.isEmpty || cat.isEmpty) return;
  final ref = FirebaseFirestore.instance.collection('users').doc(uid);
  await FirebaseFirestore.instance.runTransaction((tx) async {
    final snap = await tx.get(ref);
    final d = snap.exists ? snap.data() ?? {} : <String, dynamic>{};
    final existing = (d['interests'] is List
            ? (d['interests'] as List)
                .map((x) => _normalizeCategory('$x'))
                .where((x) => x.isNotEmpty)
                .toList()
            : <String>[])
        .cast<String>();
    final next = [cat, ...existing.where((c) => c != cat)].take(15).toList();
    tx.set(ref, {'interests': next}, SetOptions(merge: true));
  });
}

Future<Map<String, dynamic>> fetchHubPersonalizedFeed(
  String? uid, {
  int targetSize = 20,
}) async {
  if (uid == null || uid.isEmpty) {
    return {'success': false, 'items': <Map<String, dynamic>>[], 'error': 'not_signed_in'};
  }

  final verticalWeights = await getHubVerticalWeights();

  var profile = await getUserHubFeedProfile(uid);
  try {
    final country = profile?['country'] as String? ?? '';
    if (country.isEmpty || country.length != 2) {
      await syncUserHubLocationFromIp(uid);
      profile = await getUserHubFeedProfile(uid);
    }
  } catch (_) {
    /* location merge optional */
  }

  final profileCountry = profile?['country'] as String? ?? '';
  if (profileCountry.isEmpty || profileCountry.length != 2) {
    final interests = profile?['interests'];
    profile = {
      ...?profile,
      'country': 'US',
      'city': profile?['city'] ?? '',
      'interests': (interests is List && interests.isNotEmpty)
          ? List<String>.from(interests)
          : List<String>.from(hubDefaultInterests),
    };
  }

  final interestsLower =
      ((profile?['interests'] as List?) ?? []).map((x) => '$x'.toLowerCase()).toList();
  final cats = ((profile?['interests'] as List?) ?? [])
      .map((x) => '$x')
      .take(10)
      .toList();
  if (cats.isEmpty) {
    return {
      'success': true,
      'items': <Map<String, dynamic>>[],
      'profile': profile,
    };
  }

  var liveItems = <Map<String, dynamic>>[];
  if (canFetchLiveNews()) {
    liveItems = await buildNewsApiFallbackFeed(
      profile,
      targetSize,
      {'verticalWeights': verticalWeights},
    );
  }

  if (liveItems.isEmpty && canFetchLiveNews()) {
    unawaited(
      hydrateHubNewsFromApi(
        profile?['country'] as String?,
        profile?['city'] as String?,
        cats,
      ).catchError((_) => {'success': false, 'count': 0}),
    );
  }

  if (liveItems.isNotEmpty) {
    return {
      'success': true,
      'items': liveItems,
      'profile': profile,
      'usedFirestore': false,
      'insights': await buildHubTrendingInsightLines(profile),
    };
  }

  var trending = <Map<String, dynamic>>[];
  var latest = <Map<String, dynamic>>[];

  try {
    trending = await _queryNewsTrending(profile?['country'] as String?, cats, 40);
    latest = await _queryNewsLatest(profile?['country'] as String?, cats, 40);
  } on FirebaseException catch (e) {
    trending = [];
    latest = [];
    // ignore: avoid_print
    print('[HubTrending] Firestore `news` unavailable: ${e.code.isNotEmpty ? e.code : e.message}');
  } catch (e) {
    trending = [];
    latest = [];
    // ignore: avoid_print
    print('[HubTrending] Firestore `news` unavailable: $e');
  }

  trending = List<Map<String, dynamic>>.from(trending)
    ..sort((a, b) {
      final va = inferHubVerticalForNewsItem(a);
      final vb = inferHubVerticalForNewsItem(b);
      final sa = effectiveHubRankScore(a, profile?['city'] as String?, interestsLower) +
          (verticalWeights[va] ?? 0) * 5;
      final sb = effectiveHubRankScore(b, profile?['city'] as String?, interestsLower) +
          (verticalWeights[vb] ?? 0) * 5;
      final scoreCmp = sb.compareTo(sa);
      if (scoreCmp != 0) return scoreCmp;
      final ai = hasUsableHubImage('${a['image']}');
      final bi = hasUsableHubImage('${b['image']}');
      if (ai != bi) return ai ? -1 : 1;
      return 0;
    });

  final items = mixHubFeedSegments(trending, latest, targetSize);

  return {
    'success': true,
    'items': items,
    'profile': profile,
    'usedFirestore': items.isNotEmpty,
    'insights': await buildHubTrendingInsightLines(profile),
  };
}

/// Singleton marker matching JS default export surface.
/// All operations are available as top-level functions in this library.
class HubNewsService {
  HubNewsService._();

  static final HubNewsService instance = HubNewsService._();

  factory HubNewsService() => instance;
}

final hubNewsService = HubNewsService.instance;
