import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../router/app_router.dart';
import '../services/cached_news_service.dart';
import 'package:deite/lib/pod_topic_news_shared.dart';
import '../utils/hub_colors.dart';
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

Future<List<HubTrendingItem>> fetchHubTrendingItems() async {
  if (_hubCache != null && _hubCache!.isNotEmpty) return _hubCache!;

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

  _hubCache = items;
  return items;
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

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (_hubCache == null || _hubCache!.isEmpty) setState(() => _loading = true);
    try {
      final items = await fetchHubTrendingItems();
      if (!mounted) return;
      setState(() {
        _items = items;
        _loading = false;
        _error = items.isEmpty ? 'No headlines yet.' : '';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = _items.isEmpty ? 'Could not load news.' : '';
      });
    }
  }

  void _openShare(BuildContext context, HubTrendingItem item) {
    if (item.url.isEmpty) return;
    context.go(AppRoutes.shareSuggestions, extra: {
      'newsArticle': {
        'title': item.title,
        'url': item.url,
        'description': item.description,
        'image': item.image,
        'source': item.source,
      },
      'returnTo': GoRouterState.of(context).uri.path,
    });
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
    final hasImg = item.image.startsWith('http');
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
              Image.network(item.image, fit: BoxFit.cover, errorBuilder: (_, __, ___) => _gradient(g))
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
