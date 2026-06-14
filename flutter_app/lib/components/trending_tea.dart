import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../router/app_router.dart';
import '../services/cached_news_service.dart';
import '../services/reddit_tea_service.dart';
import '../services/youtube_tea_service.dart';
import '../lib/hub_trending_algorithms.dart';
import '../utils/hub_carousel_ai_image.dart';
import '../utils/hub_carousel_image_store.dart';
import '../utils/hub_colors.dart';
import '../utils/share_news_cache.dart';
import '../utils/tea_trending_storage.dart';
import 'skeleton/card_skeleton.dart';

const _teaItemsCacheKey = 'deite_tea_items_cache_v3';
const _teaCacheMaxAge = Duration(hours: 6);

List<TeaItem>? _memoryTeaCache;
DateTime? _memoryTeaCacheAt;
List<TeaItem>? _teaFeedLaunchHandoff;

/// Full in-memory items for Tea feed (keeps AI/data-URL thumbnails out of router extra).
void stashTeaFeedLaunchItems(List<TeaItem> items) {
  _teaFeedLaunchHandoff = teaItemsWithResolvedHeroes(items);
}

List<TeaItem>? takeTeaFeedLaunchItems() {
  final handoff = _teaFeedLaunchHandoff;
  _teaFeedLaunchHandoff = null;
  return handoff == null ? null : List<TeaItem>.from(handoff);
}

/// Carousel cards can show images from memory cache while [TeaItem.thumbnail] is still empty.
List<TeaItem> teaItemsWithResolvedHeroes(Iterable<TeaItem> items) {
  return items.map((item) {
    final hero = teaHeroImageUrl(item);
    if (hero == null || hero == item.thumbnail) return item;
    return TeaItem(
      id: item.id,
      title: item.title,
      url: item.url,
      postUrl: item.postUrl,
      thumbnail: hero,
      gossip: item.gossip,
      author: item.author,
      score: item.score,
      numComments: item.numComments,
    );
  }).toList();
}

List<TeaItem>? get memoryTeaCacheSnapshot =>
    _memoryTeaCache == null ? null : List<TeaItem>.from(_memoryTeaCache!);

class TeaItem {
  TeaItem({
    required this.id,
    required this.title,
    required this.url,
    this.postUrl = '',
    this.thumbnail = '',
    this.gossip = '',
    this.author = 'unknown',
    this.score = 0,
    this.numComments = 0,
  });

  final String id;
  final String title;
  final String url;
  final String postUrl;
  final String thumbnail;
  final String gossip;
  final String author;
  final int score;
  final int numComments;

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'url': url,
        'postUrl': postUrl,
        'thumbnail': thumbnail,
        'gossip': gossip,
        'author': author,
        'score': score,
        'num_comments': numComments,
      };
}

bool _isDirectImageUrl(String? postUrl) {
  if (postUrl == null || postUrl.trim().isEmpty) return false;
  final path = postUrl.trim().split('?').first.split('#').first;
  return RegExp(r'\.(jpe?g|png|gif|webp)$', caseSensitive: false).hasMatch(path);
}

TeaItem _rowToTeaItem(Map<String, dynamic> row) {
  final url = row['url'] is String ? row['url'] as String : '';
  final gossip = '${row['gossip'] ?? row['description'] ?? row['selftext'] ?? ''}'.trim();
  var thumbnail = '${row['image'] ?? row['thumbnail'] ?? ''}'.replaceAll('&amp;', '&');
  if (!isValidHubCarouselImageUrl(thumbnail)) {
    final yt = youtubeTeaThumbnailFromUrl(url);
    if (yt != null) thumbnail = yt;
  }
  return TeaItem(
    id: url.isNotEmpty ? hubNewsDocIdFromUrl(url) : '${row['title']}'.hashCode.toString(),
    title: row['title'] is String ? row['title'] as String : '',
    url: url,
    postUrl: url,
    thumbnail: thumbnail,
    gossip: gossip,
    author: row['author'] is String ? row['author'] as String : 'unknown',
    score: row['score'] is num ? (row['score'] as num).toInt() : 0,
    numComments: row['num_comments'] is num ? (row['num_comments'] as num).toInt() : 0,
  );
}

Future<List<TeaItem>> _loadTeaFromDisk() async {
  try {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_teaItemsCacheKey);
    if (raw == null || raw.isEmpty) return [];
    final decoded = jsonDecode(raw);
    if (decoded is! Map) return [];
    final savedAt = DateTime.tryParse('${decoded['savedAt'] ?? ''}');
    if (savedAt == null || DateTime.now().difference(savedAt) > _teaCacheMaxAge) {
      return [];
    }
    final items = decoded['items'];
    if (items is! List) return [];
    return items
        .whereType<Map>()
        .map((m) => TeaItem(
              id: '${m['id'] ?? ''}',
              title: '${m['title'] ?? ''}',
              url: '${m['url'] ?? ''}',
              postUrl: '${m['postUrl'] ?? m['url'] ?? ''}',
              thumbnail: '${m['thumbnail'] ?? ''}',
              author: '${m['author'] ?? 'unknown'}',
              score: m['score'] is num ? (m['score'] as num).toInt() : 0,
              numComments: m['num_comments'] is num ? (m['num_comments'] as num).toInt() : 0,
            ))
        .where((t) => t.title.isNotEmpty && t.url.isNotEmpty)
        .toList();
  } catch (_) {
    return [];
  }
}

Future<void> _saveTeaToDisk(List<TeaItem> items) async {
  try {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _teaItemsCacheKey,
      jsonEncode({
        'savedAt': DateTime.now().toIso8601String(),
        'items': items.map((e) => e.toJson()).toList(),
      }),
    );
  } catch (_) {}
}

/// Hydrate in-memory Tea cache from disk (call at app start / before Pod tab).
Future<void> warmTeaCacheFromDisk() async {
  if (_memoryTeaCache != null && _memoryTeaCache!.isNotEmpty) return;
  final cached = await _loadTeaFromDisk();
  if (cached.isEmpty) return;
  _memoryTeaCache = prioritizeWithImagesFirst(
    cached,
    teaHasReliableHeroImage,
  );
  _memoryTeaCacheAt = DateTime.now();
}

Future<void> refreshTrendingTeaInBackground() async {
  try {
    await fetchTrendingTea(allowCache: false, deferEnrich: true);
  } catch (_) {}
}

Future<List<TeaItem>> fetchTrendingTea({
  bool allowCache = true,
  bool deferEnrich = false,
}) async {
  if (allowCache &&
      _memoryTeaCache != null &&
      _memoryTeaCache!.isNotEmpty &&
      _memoryTeaCacheAt != null &&
      DateTime.now().difference(_memoryTeaCacheAt!) < _teaCacheMaxAge) {
    return List<TeaItem>.from(_memoryTeaCache!);
  }

  final rows = await fetchTrendingTeaRows(deferEnrich: deferEnrich);
  if (rows.isEmpty) {
    throw Exception('Could not load tea. Check your connection.');
  }

  var items = prioritizeWithImagesFirst(
    rows.map(_rowToTeaItem).toList(),
    teaHasReliableHeroImage,
  ).take(10).toList();
  items = await _hydrateTeaItemsFast(items);

  _memoryTeaCache = items;
  _memoryTeaCacheAt = DateTime.now();
  await writeTrendingTeaUrlsAndPruneShareCache(items.map((e) => e.url).toList());
  unawaited(_saveTeaToDisk(items));

  if (deferEnrich) {
    unawaited(_enrichTeaRowsInBackground(rows, items));
  }

  return items;
}

String? teaHeroImageUrl(TeaItem item) {
  if (_isDirectImageUrl(item.postUrl)) {
    final u = item.postUrl.trim();
    return isValidHubCarouselImageUrl(u) ? u : null;
  }
  final thumb = item.thumbnail.trim();
  if (isValidHubCarouselImageUrl(thumb)) return thumb;

  for (final key in [
    hubCarouselImageCacheKey(item.url, item.id),
    hubCarouselImageCacheKey(item.url, ''),
    if (item.title.trim().isNotEmpty) hubCarouselImageCacheKey('', item.title),
  ]) {
    if (key.isEmpty) continue;
    final mem = peekHubCarouselMemory(key);
    if (mem != null && isValidHubCarouselImageUrl(mem)) return mem;
  }

  final yt = youtubeTeaThumbnailFromUrl(item.url);
  if (yt != null && isValidHubCarouselImageUrl(yt)) return yt;
  return null;
}

bool teaHasReliableHeroImage(TeaItem item) {
  final hero = teaHeroImageUrl(item);
  if (hero == null) return false;
  return isReliableCarouselImageUrl(hero);
}

Future<List<TeaItem>> _hydrateTeaItemsFast(List<TeaItem> items) async {
  if (items.isEmpty) return items;
  final hydrated = await Future.wait(items.map((item) async {
    if (teaHasReliableHeroImage(item)) return item;

    final yt = youtubeTeaThumbnailFromUrl(item.url);
    if (yt != null) {
      return TeaItem(
        id: item.id,
        title: item.title,
        url: item.url,
        postUrl: item.postUrl,
        thumbnail: yt,
        gossip: item.gossip,
        author: item.author,
        score: item.score,
        numComments: item.numComments,
      );
    }

    final cached = await resolveCachedHubCarouselImage(
      url: item.url,
      title: item.title,
      fallbackId: item.id,
      kind: HubCarouselImageKind.tea,
    );
    if (cached != null) {
      return TeaItem(
        id: item.id,
        title: item.title,
        url: item.url,
        postUrl: item.postUrl,
        thumbnail: cached,
        gossip: item.gossip,
        author: item.author,
        score: item.score,
        numComments: item.numComments,
      );
    }
    return item;
  }));
  return prioritizeWithImagesFirst(hydrated, teaHasReliableHeroImage);
}

Future<void> _enrichTeaRowsInBackground(
  List<Map<String, dynamic>> rows,
  List<TeaItem> baseline,
) async {
  try {
    final enriched = await enrichTeaRows(rows, maxEnrich: 10);
    if (enriched.isEmpty) return;
    var items = prioritizeWithImagesFirst(
      enriched.map(_rowToTeaItem).toList(),
      teaHasReliableHeroImage,
    ).take(10).toList();
    items = await _hydrateTeaItemsFast(items);
    if (items.isEmpty) return;
    _memoryTeaCache = items;
    _memoryTeaCacheAt = DateTime.now();
    unawaited(_saveTeaToDisk(items));
  } catch (_) {}
}

/// Lightweight payload for Tea feed navigation (omit huge inline data URLs).
Map<String, dynamic> teaItemFeedPayload(TeaItem item) {
  final json = item.toJson();
  final thumb = '${json['thumbnail'] ?? ''}';
  if (thumb.startsWith('data:image')) {
    json.remove('thumbnail');
  }
  return json;
}

class TrendingTea extends StatefulWidget {
  const TrendingTea({super.key});

  @override
  State<TrendingTea> createState() => _TrendingTeaState();
}

class _TrendingTeaState extends State<TrendingTea> {
  List<TeaItem> _items = _memoryTeaCache ?? [];
  bool _loading = _memoryTeaCache == null || _memoryTeaCache!.isEmpty;
  String? _error;
  int _aiImageGen = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void activate() {
    super.activate();
    if (_items.isEmpty && _memoryTeaCache != null && _memoryTeaCache!.isNotEmpty && mounted) {
      setState(() {
        _items = List<TeaItem>.from(_memoryTeaCache!);
        _loading = false;
      });
    }
    unawaited(_syncCachedAiImages());
  }

  Future<void> _load() async {
    if (_items.isEmpty && _memoryTeaCache != null && _memoryTeaCache!.isNotEmpty && mounted) {
      setState(() {
        _items = List<TeaItem>.from(_memoryTeaCache!);
        _loading = false;
        _error = null;
      });
      unawaited(_syncCachedAiImages());
      unawaited(_enrichMissingAiImages());
      unawaited(_refreshFromNetwork());
      return;
    }

    if (_items.isNotEmpty && _memoryTeaCache != null && _memoryTeaCache!.isNotEmpty) {
      unawaited(_refreshFromNetwork());
      return;
    }

    final cached = await _loadTeaFromDisk();
    if (cached.isNotEmpty && mounted) {
      setState(() {
        _items = prioritizeWithImagesFirst(
          cached,
          teaHasReliableHeroImage,
        );
        _loading = false;
        _error = null;
      });
      _memoryTeaCache = _items;
      _memoryTeaCacheAt = DateTime.now();
      final hydrated = await _hydrateTeaItemsFast(_items);
      if (mounted && hydrated != _items) {
        setState(() => _items = hydrated);
        _memoryTeaCache = hydrated;
      }
      unawaited(_syncCachedAiImages());
      unawaited(_enrichMissingAiImages());
      unawaited(_refreshFromNetwork());
      return;
    }

    if (_items.isEmpty) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    await _refreshFromNetwork();
  }

  Future<void> _refreshFromNetwork() async {
    final hadItems = _items.isNotEmpty;
    final stale = _memoryTeaCacheAt == null ||
        DateTime.now().difference(_memoryTeaCacheAt!) >= _teaCacheMaxAge;
    if (hadItems && !stale) return;

    try {
      final items = await fetchTrendingTea(
        allowCache: false,
        deferEnrich: false,
      );
      if (!mounted) return;
      final hydrated = await _hydrateTeaItemsFast(items);
      setState(() {
        _items = hydrated;
        _loading = false;
        _error = null;
      });
      _memoryTeaCache = hydrated;
      unawaited(_syncCachedAiImages());
      unawaited(_enrichMissingAiImages());
    } catch (e) {
      if (!mounted) return;
      if (_items.isEmpty) {
        setState(() {
          _error = 'Could not load tea. Pull to refresh or check your connection.';
          _loading = false;
        });
      }
    }
  }

  Future<void> _openShare(TeaItem item) async {
    if (item.url.isEmpty) return;
    final story = item.gossip.trim().isNotEmpty ? item.gossip.trim() : item.title.trim();
    final payload = {
      'newsArticle': {
        'title': item.title,
        'url': item.url,
        'description': story,
        'text': story,
        'gossip': story,
        'image': teaHeroImageUrl(item) ?? item.thumbnail,
        'source': isYouTubeTeaUrl(item.url) ? 'YouTube' : 'Tea',
      },
      'returnTo': GoRouterState.of(context).uri.path,
      'platform': 'linkedin',
      'autoOpenSharePanel': true,
    };
    await prepareShareSuggestionsRoute(payload);
    if (!mounted) return;
    await context.push(AppRoutes.shareSuggestions, extra: payload);
  }

  Future<void> _syncCachedAiImages() async {
    if (_items.isEmpty) return;
    var changed = false;
    final updated = <TeaItem>[];
    for (final item in _items) {
      if (teaHasReliableHeroImage(item)) {
        updated.add(item);
        continue;
      }
      final yt = youtubeTeaThumbnailFromUrl(item.url);
      if (yt != null) {
        updated.add(TeaItem(
          id: item.id,
          title: item.title,
          url: item.url,
          postUrl: item.postUrl,
          thumbnail: yt,
          gossip: item.gossip,
          author: item.author,
          score: item.score,
          numComments: item.numComments,
        ));
        changed = true;
        continue;
      }
      final cached = await resolveCachedHubCarouselImage(
        url: item.url,
        title: item.title,
        fallbackId: item.id,
        kind: HubCarouselImageKind.tea,
      );
      if (cached != null) {
        updated.add(TeaItem(
          id: item.id,
          title: item.title,
          url: item.url,
          postUrl: item.postUrl,
          thumbnail: cached,
          gossip: item.gossip,
          author: item.author,
          score: item.score,
          numComments: item.numComments,
        ));
        changed = true;
      } else {
        updated.add(item);
      }
    }
    if (changed && mounted) {
      setState(() {
        _items = prioritizeWithImagesFirst(
          updated,
          teaHasReliableHeroImage,
        );
        _memoryTeaCache = _items;
      });
      unawaited(_saveTeaToDisk(_items));
    }
  }

  Future<void> _applyTeaImageAt(int index, String imageUrl) {
    if (index < 0 || index >= _items.length) return Future.value();
    final item = _items[index];
    if (item.thumbnail == imageUrl) return Future.value();
    if (!mounted) return Future.value();
    setState(() {
      final updated = [..._items];
      updated[index] = TeaItem(
        id: item.id,
        title: item.title,
        url: item.url,
        postUrl: item.postUrl,
        thumbnail: imageUrl,
        gossip: item.gossip,
        author: item.author,
        score: item.score,
        numComments: item.numComments,
      );
      _items = prioritizeWithImagesFirst(updated, teaHasReliableHeroImage);
      _memoryTeaCache = _items;
    });
    return _saveTeaToDisk(_items);
  }

  Future<void> _enrichMissingAiImages() async {
    final token = ++_aiImageGen;
    await enrichCarouselSlotsWithAiImages(
      slotCount: _items.length,
      needsImage: (i) => !teaHasReliableHeroImage(_items[i]),
      generateForIndex: (i) {
        final item = _items[i];
        return getOrGenerateHubCarouselImage(
          cacheKey: hubCarouselImageCacheKey(item.url, item.id),
          headline: item.title,
          storyText: item.gossip,
          articleUrl: item.url,
          kind: HubCarouselImageKind.tea,
        );
      },
      applyImage: (i, imageUrl) {
        if (!mounted || token != _aiImageGen) return;
        unawaited(_applyTeaImageAt(i, imageUrl));
      },
      maxGenerate: _items.length,
    );
  }

  void _openTeaFeed() {
    stashTeaFeedLaunchItems(_items);
    context.go(AppRoutes.teaFeed, extra: {
      'teaItems': _items.map(teaItemFeedPayload).toList(),
      'returnTo': GoRouterState.of(context).uri.path,
    });
  }

  @override
  Widget build(BuildContext context) {
    const hubAccent = HubColors.accent;
    const hubText = HubColors.text;
    const hubMuted = HubColors.textSecondary;
    const hubDivider = HubColors.divider;

    return Container(
      decoration: BoxDecoration(
        color: HubColors.bg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: hubDivider),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
            child: Row(
              children: [
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    color: hubAccent.withValues(alpha: 0.19),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.local_fire_department, color: hubAccent, size: 18),
                ),
                const SizedBox(width: 12),
                const Expanded(
                  child: Text(
                    'Tea',
                    style: TextStyle(color: hubText, fontSize: 18, fontWeight: FontWeight.w600),
                  ),
                ),
                TextButton(
                  onPressed: _loading ? null : _openTeaFeed,
                  style: TextButton.styleFrom(
                    foregroundColor: hubAccent,
                    side: const BorderSide(color: hubDivider),
                    backgroundColor: hubAccent.withValues(alpha: 0.09),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
                  ),
                  child: const Text('See all', style: TextStyle(fontWeight: FontWeight.w600)),
                ),
              ],
            ),
          ),
          const Divider(height: 1, color: hubDivider),
          Padding(
            padding: const EdgeInsets.only(top: 12, left: 16, bottom: 12),
            child: _loading && _items.isEmpty
                ? const CardSkeleton(count: 4)
                : _error != null
                    ? Text(_error!, style: const TextStyle(color: hubMuted))
                    : _items.isEmpty
                        ? const Text('No tea right now.', style: TextStyle(color: hubMuted))
                        : SizedBox(
                            height: 220,
                            child: ListView.separated(
                              scrollDirection: Axis.horizontal,
                              itemCount: _items.length,
                              separatorBuilder: (_, __) => const SizedBox(width: 12),
                              itemBuilder: (context, idx) {
                                final item = _items[idx];
                                return GestureDetector(
                                  onTap: () => _openShare(item),
                                  child: Container(
                                    width: 260,
                                    decoration: BoxDecoration(
                                      borderRadius: BorderRadius.circular(12),
                                      border: Border.all(color: hubDivider),
                                    ),
                                    clipBehavior: Clip.antiAlias,
                                    child: Stack(
                                      fit: StackFit.expand,
                                      children: [
                                        HubCarouselResolvingHero(
                                          initialUrl: teaHeroImageUrl(item),
                                          articleUrl: item.url,
                                          title: item.title,
                                          storyText: item.gossip,
                                          fallbackId: item.id,
                                          kind: HubCarouselImageKind.tea,
                                          tryYouTubeThumbnail: true,
                                          errorWidget: _gradientFallback(idx),
                                          onResolved: (url) => unawaited(_applyTeaImageAt(idx, url)),
                                        ),
                                        Positioned(
                                          left: 0,
                                          right: 0,
                                          bottom: 0,
                                          child: Container(
                                            padding: const EdgeInsets.all(12),
                                            decoration: BoxDecoration(
                                              gradient: LinearGradient(
                                                begin: Alignment.topCenter,
                                                end: Alignment.bottomCenter,
                                                colors: [
                                                  Colors.transparent,
                                                  Colors.black.withValues(alpha: 0.85),
                                                ],
                                              ),
                                            ),
                                            child: Column(
                                              crossAxisAlignment: CrossAxisAlignment.start,
                                              mainAxisSize: MainAxisSize.min,
                                              children: [
                                                Text(
                                                  item.title,
                                                  maxLines: 2,
                                                  overflow: TextOverflow.ellipsis,
                                                  style: const TextStyle(
                                                    color: Colors.white,
                                                    fontSize: 14,
                                                    fontWeight: FontWeight.w600,
                                                  ),
                                                ),
                                                if (item.gossip.isNotEmpty) ...[
                                                  const SizedBox(height: 4),
                                                  Text(
                                                    item.gossip,
                                                    maxLines: 2,
                                                    overflow: TextOverflow.ellipsis,
                                                    style: TextStyle(
                                                      color: Colors.white.withValues(alpha: 0.82),
                                                      fontSize: 12,
                                                      height: 1.3,
                                                    ),
                                                  ),
                                                ],
                                              ],
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                );
                              },
                            ),
                          ),
          ),
        ],
      ),
    );
  }

  Widget _gradientFallback(int idx) {
    const gradients = [
      [Color(0xFF1A1A2E), Color(0xFF16213E), Color(0xFF0F3460)],
      [Color(0xFF2D132C), Color(0xFF801336), Color(0xFFC72C41)],
      [Color(0xFF0F2027), Color(0xFF203A43), Color(0xFF2C5364)],
      [Color(0xFF1E3C72), Color(0xFF2A5298), Color(0xFF7E8BA3)],
      [Color(0xFF232526), Color(0xFF414345)],
    ];
    final g = gradients[idx % gradients.length];
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: g,
        ),
      ),
    );
  }
}
