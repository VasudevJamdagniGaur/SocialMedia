import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../router/app_router.dart';
import '../services/cached_news_service.dart';
import '../services/reddit_tea_service.dart';
import '../lib/hub_trending_algorithms.dart';
import '../utils/hub_colors.dart';
import '../utils/share_news_cache.dart';
import '../utils/tea_trending_storage.dart';
import 'skeleton/card_skeleton.dart';

const _teaItemsCacheKey = 'deite_tea_items_cache_v2';
const _teaCacheMaxAge = Duration(hours: 6);

List<TeaItem>? _memoryTeaCache;
DateTime? _memoryTeaCacheAt;

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
  return TeaItem(
    id: url.isNotEmpty ? hubNewsDocIdFromUrl(url) : '${row['title']}'.hashCode.toString(),
    title: row['title'] is String ? row['title'] as String : '',
    url: url,
    postUrl: url,
    thumbnail: '${row['image'] ?? row['thumbnail'] ?? ''}'.replaceAll('&amp;', '&'),
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

Future<List<TeaItem>> fetchTrendingTea({bool allowCache = true}) async {
  if (allowCache &&
      _memoryTeaCache != null &&
      _memoryTeaCache!.isNotEmpty &&
      _memoryTeaCacheAt != null &&
      DateTime.now().difference(_memoryTeaCacheAt!) < _teaCacheMaxAge) {
    return prioritizeWithImagesFirst(
      _memoryTeaCache!,
      (item) => teaHeroImageUrl(item) != null,
    );
  }

  final rows = await fetchTrendingTeaRows();
  if (rows.isEmpty) {
    throw Exception('Could not load tea. Check your connection.');
  }

  final items = prioritizeWithImagesFirst(
    rows.map(_rowToTeaItem).toList(),
    (item) => teaHeroImageUrl(item) != null,
  ).take(10).toList();
  _memoryTeaCache = items;
  _memoryTeaCacheAt = DateTime.now();
  await writeTrendingTeaUrlsAndPruneShareCache(items.map((e) => e.url).toList());
  unawaited(_saveTeaToDisk(items));
  return items;
}

String? teaHeroImageUrl(TeaItem item) {
  if (_isDirectImageUrl(item.postUrl)) return item.postUrl.trim();
  if (item.thumbnail.trim().startsWith('http')) return item.thumbnail.trim();
  return null;
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

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final cached = await _loadTeaFromDisk();
    if (cached.isNotEmpty && mounted) {
      setState(() {
        _items = prioritizeWithImagesFirst(
          cached,
          (item) => teaHeroImageUrl(item) != null,
        );
        _loading = false;
        _error = null;
      });
      _memoryTeaCache = cached;
      _memoryTeaCacheAt = DateTime.now();
    } else if (_items.isEmpty) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    try {
      final items = await fetchTrendingTea(allowCache: false);
      if (!mounted) return;
      setState(() {
        _items = items;
        _loading = false;
        _error = null;
      });
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
    final payload = {
      'newsArticle': {
        'title': item.title,
        'url': item.url,
        'description': item.gossip,
        'text': item.gossip,
        'gossip': item.gossip,
        'image': teaHeroImageUrl(item),
        'source': publicTeaSourceLabel(item.author),
      },
      'returnTo': GoRouterState.of(context).uri.path,
      'platform': 'linkedin',
    };
    await prepareShareSuggestionsRoute(payload);
    if (!mounted) return;
    context.go(AppRoutes.shareSuggestions, extra: payload);
  }

  void _openTeaFeed() {
    context.go(AppRoutes.teaFeed, extra: {
      'teaItems': _items.map((e) => e.toJson()).toList(),
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
            child: _loading
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
                                final hero = teaHeroImageUrl(item);
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
                                        if (hero != null)
                                          Image.network(hero, fit: BoxFit.cover,
                                              errorBuilder: (_, __, ___) => _gradientFallback(idx))
                                        else
                                          _gradientFallback(idx),
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
