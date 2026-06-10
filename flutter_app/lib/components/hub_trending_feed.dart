import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:go_router/go_router.dart';

import '../router/app_router.dart';
import '../services/cached_news_service.dart';
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

Future<List<HubTrendingItem>> fetchHubTrendingItems() async {
  if (_hubCache != null && _hubCache!.isNotEmpty) {
    final hydrated = <HubTrendingItem>[];
    for (final item in _hubCache!) {
      if (hasUsableHubImage(item.image)) {
        hydrated.add(item);
        continue;
      }
      final cached = await resolveCachedHubCarouselImage(
        url: item.url,
        title: item.title,
        fallbackId: item.id,
        kind: HubCarouselImageKind.news,
      );
      if (cached != null) {
        hydrated.add(HubTrendingItem(
          id: item.id,
          title: item.title,
          url: item.url,
          description: item.description,
          image: cached,
          source: item.source,
          category: item.category,
        ));
      } else {
        hydrated.add(item);
      }
    }
    final sorted = prioritizeWithImagesFirst(
      hydrated,
      (item) => hasUsableHubImage(item.image),
    );
    _hubCache = sorted;
    return sorted;
  }

  final seen = <String>{};
  final items = <HubTrendingItem>[];

  try {
    final merged = await getHubTrendingMergedFromFirestore()
        .timeout(const Duration(seconds: 18));
    final rawItems = merged['items'];
    if (rawItems is List) {
      for (final a in rawItems) {
        if (a is! Map) continue;
        final url = '${a['url'] ?? ''}'.trim();
        if (url.isEmpty || seen.contains(url)) continue;
        seen.add(url);
        final img = a['image'];
        items.add(HubTrendingItem(
          id: '${a['id'] ?? url.hashCode}',
          title: a['title'] as String? ?? '',
          url: url,
          description: a['description'] as String? ?? '',
          image: img is String && img.trim().startsWith('http') ? img.trim() : '',
          source: a['source'] as String? ?? '',
          category: a['category'] as String? ?? '',
        ));
      }
    }
  } catch (_) {}

  if (items.isEmpty) {
    try {
      final rss = await fetchLiveFromGoogleRssByQueryFast('world news when:2d', timeoutMs: 10000);
      for (final a in normalizeArticles(rss)) {
        final url = '${a['url'] ?? ''}'.trim();
        if (url.isEmpty || seen.contains(url)) continue;
        seen.add(url);
        final img = a['image'];
        items.add(HubTrendingItem(
          id: hubNewsDocIdFromUrl(url),
          title: a['title'] as String? ?? '',
          url: url,
          description: a['description'] as String? ?? '',
          image: img is String && '$img'.trim().startsWith('http') ? '$img'.trim() : '',
          source: a['source'] as String? ?? 'News',
          category: 'general',
        ));
      }
    } catch (_) {}
  }

  var sorted = prioritizeWithImagesFirst(
    items,
    (item) => hasUsableHubImage(item.image),
  );
  final hydrated = <HubTrendingItem>[];
  for (final item in sorted) {
    if (hasUsableHubImage(item.image)) {
      hydrated.add(item);
      continue;
    }
    final cached = await resolveCachedHubCarouselImage(
      url: item.url,
      title: item.title,
      fallbackId: item.id,
    );
    if (cached != null) {
      hydrated.add(HubTrendingItem(
        id: item.id,
        title: item.title,
        url: item.url,
        description: item.description,
        image: cached,
        source: item.source,
        category: item.category,
      ));
    } else {
      hydrated.add(item);
    }
  }
  sorted = prioritizeWithImagesFirst(
    hydrated,
    (item) => hasUsableHubImage(item.image),
  );
  _hubCache = sorted;
  await writeHubNewsUrlsAndPruneImageCache(sorted.map((e) => e.url).toList());
  unawaited(_saveHubNewsToDisk(sorted));
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
    unawaited(_syncCachedAiImages());
  }

  Future<void> _load() async {
    final disk = await _loadHubNewsFromDisk();
    if (disk.isNotEmpty && mounted) {
      setState(() {
        _items = prioritizeWithImagesFirst(
          disk,
          (item) => hasUsableHubImage(item.image),
        );
        _loading = false;
        _error = '';
      });
      _hubCache = _items;
      await _syncCachedAiImages();
      unawaited(_enrichMissingAiImages());
    } else if (_hubCache == null || _hubCache!.isEmpty) {
      setState(() => _loading = true);
    }
    try {
      final items = await fetchHubTrendingItems();
      if (!mounted) return;
      setState(() {
        _items = items;
        _loading = false;
        _error = items.isEmpty ? 'No headlines yet.' : '';
      });
      await _syncCachedAiImages();
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
      if (hasUsableHubImage(item.image)) {
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
          (item) => hasUsableHubImage(item.image),
        );
        _hubCache = _items;
      });
      unawaited(_saveHubNewsToDisk(_items));
    }
  }

  Future<void> _enrichMissingAiImages() async {
    final token = ++_aiImageGen;
    await enrichCarouselSlotsWithAiImages(
      slotCount: _items.length,
      needsImage: (i) => !hasUsableHubImage(_items[i].image),
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
        setState(() {
          final item = _items[i];
          final updated = [..._items];
          updated[i] = HubTrendingItem(
            id: item.id,
            title: item.title,
            url: item.url,
            description: item.description,
            image: imageUrl,
            source: item.source,
            category: item.category,
          );
          _items = updated;
          _hubCache = updated;
        });
        unawaited(_saveHubNewsToDisk(_items));
      },
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
                          itemBuilder: (_, idx) => _HubTrendingCard(
                            item: carousel[idx],
                            idx: idx,
                            onTap: () => _openShare(context, carousel[idx]),
                          ),
                        ),
            ),
          ),
        ],
      ),
    );
  }
}

class _HubTrendingCard extends StatelessWidget {
  const _HubTrendingCard({required this.item, required this.idx, required this.onTap});

  final HubTrendingItem item;
  final int idx;
  final VoidCallback onTap;

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
    final hasImg = isHubCarouselDisplayImage(item.image);
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
            if (hasImg)
              HubCarouselHeroImage(
                imageUrl: item.image,
                fit: BoxFit.cover,
                errorWidget: _gradient(g),
              )
            else
              _gradient(g),
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
