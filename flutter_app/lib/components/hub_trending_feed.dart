import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:go_router/go_router.dart';

import '../router/app_router.dart';
import '../services/cached_news_service.dart';
import '../services/youtube_tea_service.dart';
import 'package:deite/lib/pod_topic_news_shared.dart';
import '../lib/hub_trending_algorithms.dart';
import '../utils/hub_carousel_ai_image.dart';
import '../utils/hub_carousel_image_store.dart';
import '../utils/hub_colors.dart';
import '../utils/hub_news_trending_storage.dart';
import '../utils/share_news_cache.dart';
import 'skeleton/card_skeleton.dart';

class HubTrendingItem {
  HubTrendingItem({
    required this.id,
    required this.title,
    this.url = '',
    this.description = '',
    this.image = '',
    this.source = '',
    this.category = '',
  });

  final String id;
  final String title;
  final String url;
  final String description;
  final String image;
  final String source;
  final String category;
}

bool hubTrendingItemHasReliableImage(HubTrendingItem item) {
  final img = item.image.trim();
  if (!hasUsableHubImage(img)) {
    for (final key in [
      hubCarouselImageCacheKey(item.url, item.id),
      hubCarouselImageCacheKey(item.url, ''),
    ]) {
      final mem = peekHubCarouselMemory(key);
      if (mem != null && isReliableCarouselImageUrl(mem)) return true;
    }
    return isYouTubeTeaUrl(item.url) && youtubeTeaThumbnailFromUrl(item.url) != null;
  }
  return isReliableCarouselImageUrl(img);
}

Future<List<HubTrendingItem>> _hydrateHubNewsItemsFast(List<HubTrendingItem> items) async {
  if (items.isEmpty) return items;
  final hydrated = await Future.wait(items.map((item) async {
    if (hubTrendingItemHasReliableImage(item)) return item;

    final yt = youtubeTeaThumbnailFromUrl(item.url);
    if (yt != null) {
      return HubTrendingItem(
        id: item.id,
        title: item.title,
        url: item.url,
        description: item.description,
        image: yt,
        source: item.source,
        category: item.category,
      );
    }

    final cached = await resolveCachedHubCarouselImage(
      url: item.url,
      title: item.title,
      fallbackId: item.id,
      kind: HubCarouselImageKind.news,
    );
    if (cached != null) {
      return HubTrendingItem(
        id: item.id,
        title: item.title,
        url: item.url,
        description: item.description,
        image: cached,
        source: item.source,
        category: item.category,
      );
    }
    return item;
  }));
  return prioritizeWithImagesFirst(hydrated, hubTrendingItemHasReliableImage);
}

List<HubTrendingItem>? _hubCache;

const _hubNewsItemsCacheKey = 'deite_hub_news_items_cache_v1';
const _hubNewsCacheMaxAge = Duration(hours: 6);

Future<List<HubTrendingItem>> _loadHubNewsFromDisk() async {
  try {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_hubNewsItemsCacheKey);
    if (raw == null || raw.isEmpty) return [];
    final decoded = jsonDecode(raw);
    if (decoded is! Map) return [];
    final savedAt = DateTime.tryParse('${decoded['savedAt'] ?? ''}');
    if (savedAt == null || DateTime.now().difference(savedAt) > _hubNewsCacheMaxAge) {
      return [];
    }
    final items = decoded['items'];
    if (items is! List) return [];
    return items
        .whereType<Map>()
        .map((m) => HubTrendingItem(
              id: '${m['id'] ?? ''}',
              title: '${m['title'] ?? ''}',
              url: '${m['url'] ?? ''}',
              description: '${m['description'] ?? ''}',
              image: '${m['image'] ?? ''}',
              source: '${m['source'] ?? ''}',
              category: '${m['category'] ?? ''}',
            ))
        .where((t) => t.title.isNotEmpty && t.url.isNotEmpty)
        .toList();
  } catch (_) {
    return [];
  }
}

Future<void> _saveHubNewsToDisk(List<HubTrendingItem> items) async {
  try {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _hubNewsItemsCacheKey,
      jsonEncode({
        'savedAt': DateTime.now().toIso8601String(),
        'items': items
            .map((e) => {
                  'id': e.id,
                  'title': e.title,
                  'url': e.url,
                  'description': e.description,
                  'image': e.image,
                  'source': e.source,
                  'category': e.category,
                })
            .toList(),
      }),
    );
  } catch (_) {}
}

/// Hydrate in-memory News cache from disk (call at app start / before Pod tab).
Future<void> warmHubNewsCacheFromDisk() async {
  if (_hubCache != null && _hubCache!.isNotEmpty) return;
  final disk = await _loadHubNewsFromDisk();
  if (disk.isEmpty) return;
  _hubCache = prioritizeWithImagesFirst(
    disk,
    hubTrendingItemHasReliableImage,
  );
}

Future<void> refreshHubNewsInBackground() async {
  try {
    await fetchHubTrendingItems(forceRefresh: true);
  } catch (_) {}
}

List<HubTrendingItem> _hubItemsFromArticleMaps(
  Iterable<Map<String, dynamic>> articles,
  Set<String> seen, {
  String defaultSource = 'News',
  String defaultCategory = 'general',
}) {
  final items = <HubTrendingItem>[];
  for (final a in articles) {
    final url = '${a['url'] ?? ''}'.trim();
    if (url.isEmpty || seen.contains(url)) continue;
    seen.add(url);
    final img = a['image'];
    items.add(HubTrendingItem(
      id: '${a['id'] ?? hubNewsDocIdFromUrl(url)}',
      title: a['title'] as String? ?? '',
      url: url,
      description: a['description'] as String? ?? '',
      image: img is String && img.trim().startsWith('http') ? img.trim() : '',
      source: a['source'] as String? ?? defaultSource,
      category: a['category'] as String? ?? defaultCategory,
    ));
  }
  return items;
}

Future<List<HubTrendingItem>> fetchHubTrendingItems({bool forceRefresh = false}) async {
  if (!forceRefresh && _hubCache != null && _hubCache!.isNotEmpty) {
    return List<HubTrendingItem>.from(_hubCache!);
  }

  final seen = <String>{};
  final items = <HubTrendingItem>[];

  final firestoreFuture = getHubTrendingMergedFromFirestore()
      .timeout(const Duration(seconds: 7), onTimeout: () => {'success': false, 'items': []});
  final rssWorldFuture = fetchLiveFromGoogleRssByQueryFast('world news when:2d', timeoutMs: 6000);
  final rssIndiaFuture = fetchLiveFromGoogleRssByQueryFast('india news when:2d', timeoutMs: 6000);

  final results = await Future.wait([
    firestoreFuture.catchError((_) => {'success': false, 'items': []}),
    rssWorldFuture.catchError((_) => <Map<String, dynamic>>[]),
    rssIndiaFuture.catchError((_) => <Map<String, dynamic>>[]),
  ]);

  final merged = results[0] is Map
      ? Map<String, dynamic>.from(results[0] as Map)
      : <String, dynamic>{'items': <dynamic>[]};
  final rawItems = merged['items'];
  if (rawItems is List) {
    for (final a in rawItems) {
      if (a is! Map) continue;
      items.addAll(_hubItemsFromArticleMaps([Map<String, dynamic>.from(a)], seen));
    }
  }

  for (final rss in [results[1], results[2]]) {
    if (rss is List<Map<String, dynamic>>) {
      items.addAll(_hubItemsFromArticleMaps(normalizeArticles(rss), seen));
    } else if (rss is List) {
      items.addAll(_hubItemsFromArticleMaps(
        normalizeArticles(rss.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList()),
        seen,
      ));
    }
  }

  var sorted = prioritizeWithImagesFirst(
    items,
    hubTrendingItemHasReliableImage,
  );
  sorted = await _hydrateHubNewsItemsFast(sorted);
  _hubCache = sorted;
  if (sorted.isNotEmpty) {
    unawaited(writeHubNewsUrlsAndPruneImageCache(sorted.map((e) => e.url).toList()));
    unawaited(_saveHubNewsToDisk(sorted));
  }
  return sorted;
}

class HubTrendingFeed extends StatefulWidget {
  const HubTrendingFeed({super.key, required this.isDarkMode});

  final bool isDarkMode;

  @override
  State<HubTrendingFeed> createState() => _HubTrendingFeedState();
}

class _HubTrendingFeedState extends State<HubTrendingFeed> {
  List<HubTrendingItem> _items = _hubCache ?? [];
  bool _loading = _hubCache == null || _hubCache!.isEmpty;
  String _error = '';
  int _aiImageGen = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void activate() {
    super.activate();
    if (_items.isEmpty && _hubCache != null && _hubCache!.isNotEmpty && mounted) {
      setState(() {
        _items = List<HubTrendingItem>.from(_hubCache!);
        _loading = false;
      });
    }
    unawaited(_syncCachedAiImages());
  }

  Future<void> _load() async {
    if (_items.isEmpty && _hubCache != null && _hubCache!.isNotEmpty && mounted) {
      setState(() {
        _items = List<HubTrendingItem>.from(_hubCache!);
        _loading = false;
        _error = '';
      });
      unawaited(_syncCachedAiImages());
      unawaited(_enrichMissingAiImages());
      unawaited(_refreshFromNetwork());
      return;
    }

    if (_items.isNotEmpty && _hubCache != null && _hubCache!.isNotEmpty) {
      unawaited(_refreshFromNetwork());
      return;
    }

    final disk = await _loadHubNewsFromDisk();
    if (disk.isNotEmpty && mounted) {
      setState(() {
        _items = prioritizeWithImagesFirst(
          disk,
          hubTrendingItemHasReliableImage,
        );
        _loading = false;
        _error = '';
      });
      _hubCache = _items;
      final hydrated = await _hydrateHubNewsItemsFast(_items);
      if (mounted && hydrated != _items) {
        setState(() => _items = hydrated);
        _hubCache = hydrated;
      }
      unawaited(_syncCachedAiImages());
      unawaited(_enrichMissingAiImages());
      unawaited(_refreshFromNetwork());
      return;
    }

    if (_items.isEmpty) {
      setState(() => _loading = true);
    }

    await _refreshFromNetwork();
  }

  Future<void> _refreshFromNetwork() async {
    final hadItems = _items.isNotEmpty;
    try {
      final items = await fetchHubTrendingItems(forceRefresh: !hadItems || _hubCache == null);
      if (!mounted) return;
      final hydrated = await _hydrateHubNewsItemsFast(items);
      setState(() {
        _items = hydrated;
        _loading = false;
        _error = hydrated.isEmpty ? 'No headlines yet.' : '';
      });
      _hubCache = hydrated;
      unawaited(_syncCachedAiImages());
      unawaited(_enrichMissingAiImages());
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = _items.isEmpty ? 'Could not load news.' : '';
      });
    }
  }

  Future<void> _syncCachedAiImages() async {
    if (_items.isEmpty) return;
    var changed = false;
    final updated = <HubTrendingItem>[];
    for (final item in _items) {
      if (hasUsableHubImage(item.image) && hubTrendingItemHasReliableImage(item)) {
        updated.add(item);
        continue;
      }
      final cached = await resolveCachedHubCarouselImage(
        url: item.url,
        title: item.title,
        fallbackId: item.id,
        kind: HubCarouselImageKind.news,
      );
      if (cached != null) {
        updated.add(HubTrendingItem(
          id: item.id,
          title: item.title,
          url: item.url,
          description: item.description,
          image: cached,
          source: item.source,
          category: item.category,
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
          hubTrendingItemHasReliableImage,
        );
        _hubCache = _items;
      });
      unawaited(_saveHubNewsToDisk(_items));
    }
  }

  Future<void> _applyNewsImageAt(int index, String imageUrl) {
    if (index < 0 || index >= _items.length) return Future.value();
    final item = _items[index];
    if (item.image == imageUrl) return Future.value();
    if (!mounted) return Future.value();
    setState(() {
      final updated = [..._items];
      updated[index] = HubTrendingItem(
        id: item.id,
        title: item.title,
        url: item.url,
        description: item.description,
        image: imageUrl,
        source: item.source,
        category: item.category,
      );
      _items = prioritizeWithImagesFirst(updated, hubTrendingItemHasReliableImage);
      _hubCache = _items;
    });
    return _saveHubNewsToDisk(_items);
  }

  Future<void> _enrichMissingAiImages() async {
    final token = ++_aiImageGen;
    await enrichCarouselSlotsWithAiImages(
      slotCount: _items.length,
      needsImage: (i) => !hubTrendingItemHasReliableImage(_items[i]),
      generateForIndex: (i) {
        final item = _items[i];
        return getOrGenerateHubCarouselImage(
          cacheKey: hubCarouselImageCacheKey(item.url, item.id),
          headline: item.title,
          storyText: stripHtmlBoilerplate(item.description),
          articleUrl: item.url,
          kind: HubCarouselImageKind.news,
        );
      },
      applyImage: (i, imageUrl) {
        if (!mounted || token != _aiImageGen) return;
        unawaited(_applyNewsImageAt(i, imageUrl));
      },
      maxGenerate: _items.length,
    );
  }

  Future<void> _openShare(BuildContext context, HubTrendingItem item) async {
    if (item.url.isEmpty) return;
    final payload = {
      'newsArticle': {
        'title': item.title,
        'url': item.url,
        'description': item.description,
        'image': item.image,
        'source': item.source,
      },
      'returnTo': GoRouterState.of(context).uri.path,
    };
    await prepareShareSuggestionsRoute(payload);
    if (!context.mounted) return;
    context.go(AppRoutes.shareSuggestions, extra: payload);
  }

  @override
  Widget build(BuildContext context) {
    final cardColor = widget.isDarkMode ? HubColors.bg : Colors.white;
    final borderColor = widget.isDarkMode ? HubColors.divider : const Color(0xFFE5E7EB);
    final carousel = _items.take(15).toList();

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: cardColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
            child: Row(
              children: [
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    color: HubColors.accent.withValues(alpha: 0.3),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.local_fire_department, color: HubColors.accent, size: 18),
                ),
                const SizedBox(width: 8),
                Text(
                  'News',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                    color: widget.isDarkMode ? Colors.white : Colors.black87,
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(left: 16, bottom: 12),
            child: SizedBox(
              height: 200,
              child: _loading && _items.isEmpty
                  ? const CardSkeleton(count: 4)
                  : _error.isNotEmpty && _items.isEmpty
                      ? Text(_error, style: TextStyle(color: widget.isDarkMode ? Colors.white54 : Colors.black54))
                      : ListView.separated(
                          scrollDirection: Axis.horizontal,
                          itemCount: carousel.length,
                          separatorBuilder: (_, __) => const SizedBox(width: 12),
                          itemBuilder: (_, idx) {
                            final item = carousel[idx];
                            final sourceIndex = _items.indexWhere((e) => e.id == item.id && e.url == item.url);
                            final listIndex = sourceIndex >= 0 ? sourceIndex : idx;
                            return _HubTrendingCard(
                              item: item,
                              idx: idx,
                              onTap: () => _openShare(context, item),
                              onImageResolved: (url) => unawaited(_applyNewsImageAt(listIndex, url)),
                            );
                          },
                        ),
            ),
          ),
        ],
      ),
    );
  }
}

class _HubTrendingCard extends StatelessWidget {
  const _HubTrendingCard({
    required this.item,
    required this.idx,
    required this.onTap,
    this.onImageResolved,
  });

  final HubTrendingItem item;
  final int idx;
  final VoidCallback onTap;
  final ValueChanged<String>? onImageResolved;

  static const _gradients = [
    [Color(0xFF1A1A2E), Color(0xFF0F3460)],
    [Color(0xFF2D132C), Color(0xFFC72C41)],
    [Color(0xFF0F2027), Color(0xFF2C5364)],
    [Color(0xFF1E3C72), Color(0xFF7E8BA3)],
    [Color(0xFF232526), Color(0xFF414345)],
  ];

  @override
  Widget build(BuildContext context) {
    final g = _gradients[idx % _gradients.length];
    final fallback = _gradient(g);
    return GestureDetector(
      onTap: item.url.isEmpty ? null : onTap,
      child: Container(
        width: 260,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: HubColors.divider),
        ),
        clipBehavior: Clip.antiAlias,
        child: Stack(
          fit: StackFit.expand,
          children: [
            HubCarouselResolvingHero(
              initialUrl: hasUsableHubImage(item.image) ? item.image : null,
              articleUrl: item.url,
              title: item.title,
              storyText: item.description,
              fallbackId: item.id,
              kind: HubCarouselImageKind.news,
              tryYouTubeThumbnail: isYouTubeTeaUrl(item.url),
              errorWidget: fallback,
              onResolved: onImageResolved,
            ),
            Container(
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.bottomCenter,
                  end: Alignment.topCenter,
                  colors: [Colors.black87, Colors.transparent],
                  stops: [0.0, 0.6],
                ),
              ),
            ),
            Positioned(
              left: 12,
              right: 12,
              bottom: 12,
              child: Text(
                item.title,
                maxLines: 4,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w600, height: 1.3),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _gradient(List<Color> colors) => DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(colors: colors, begin: Alignment.topLeft, end: Alignment.bottomRight),
        ),
      );
}
