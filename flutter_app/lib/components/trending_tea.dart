import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../router/app_router.dart';
import '../services/cached_news_service.dart';
import '../utils/hub_colors.dart';
import '../utils/tea_trending_storage.dart';
import 'package:deite/lib/pod_reddit_hot.dart';
import 'package:deite/lib/pod_topic_news_shared.dart';
import 'package:deite/lib/reddit_post_filter.dart';
import 'skeleton/card_skeleton.dart';

class TeaItem {
  TeaItem({
    required this.id,
    required this.title,
    required this.url,
    this.postUrl = '',
    this.thumbnail = '',
    this.author = 'unknown',
    this.score = 0,
    this.numComments = 0,
  });

  final String id;
  final String title;
  final String url;
  final String postUrl;
  final String thumbnail;
  final String author;
  final int score;
  final int numComments;

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'url': url,
        'postUrl': postUrl,
        'thumbnail': thumbnail,
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
  return TeaItem(
    id: url.isNotEmpty ? hubNewsDocIdFromUrl(url) : '${row['title']}'.hashCode.toString(),
    title: row['title'] is String ? row['title'] as String : '',
    url: url,
    postUrl: url,
    thumbnail: '${row['image'] ?? row['thumbnail'] ?? ''}',
    author: row['author'] is String ? row['author'] as String : 'unknown',
    score: row['score'] is num ? (row['score'] as num).toInt() : 0,
    numComments: row['num_comments'] is num ? (row['num_comments'] as num).toInt() : 0,
  );
}

Future<List<TeaItem>> fetchTrendingTea() async {
  var rows = await tryRedditHotRows(
    ['BollyBlindsNGossip'],
    maxPerSub: 50,
    maxKeep: 15,
    minScore: 10,
    filterPost: (post) => filterPosts([post]).isNotEmpty,
  );

  if (rows.isEmpty) {
    rows = await tryRedditHotRows(
      ['BollyBlindsNGossip'],
      maxPerSub: 50,
      maxKeep: 15,
      minScore: 5,
      filterPost: isValidPost,
    );
  }

  if (rows.isEmpty) {
    rows = await tryRedditHotRows(
      ['BollywoodGossip', 'BollywoodHot'],
      maxPerSub: 40,
      maxKeep: 12,
      minScore: 10,
    );
  }

  if (rows.isEmpty) {
    final rssItems = await fetchLiveFromGoogleRssByQuery('bollywood OR celebrity gossip when:3d');
    rows = normalizeArticles(rssItems)
        .where((a) => '${a['url'] ?? ''}'.trim().isNotEmpty)
        .map((a) => {
              'title': a['title'],
              'url': a['url'],
              'image': a['image'],
              'thumbnail': a['image'],
              'score': 0,
              'num_comments': 0,
              'author': a['source'] ?? 'News',
              'source': a['source'] ?? 'News',
            })
        .toList();
  }

  if (rows.isEmpty) {
    throw Exception('Could not load tea. Check your connection.');
  }

  final items = rows.map(_rowToTeaItem).take(10).toList();
  await writeTrendingTeaUrlsAndPruneShareCache(items.map((e) => e.url).toList());
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
  List<TeaItem> _items = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final items = await fetchTrendingTea().timeout(const Duration(seconds: 30));
      if (!mounted) return;
      setState(() {
        _items = items;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  void _openShare(TeaItem item) {
    if (item.url.isEmpty) return;
    context.go(AppRoutes.shareSuggestions, extra: {
      'newsArticle': {
        'title': item.title,
        'url': item.url,
        'description': '',
        'image': teaHeroImageUrl(item),
        'source': 'r/BollyBlindsNGossip',
      },
      'returnTo': GoRouterState.of(context).uri.path,
      'platform': 'linkedin',
    });
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
                            height: 200,
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
                                            child: Text(
                                              item.title,
                                              maxLines: 3,
                                              overflow: TextOverflow.ellipsis,
                                              style: const TextStyle(
                                                color: Colors.white,
                                                fontSize: 14,
                                                fontWeight: FontWeight.w600,
                                              ),
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
