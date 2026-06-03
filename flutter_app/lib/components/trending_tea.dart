import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;

import '../router/app_router.dart';
import '../utils/hub_colors.dart';
import '../utils/tea_trending_storage.dart';
import 'package:deite/lib/pod_reddit_hot.dart';
import 'package:deite/lib/reddit_post_filter.dart';
import 'skeleton/card_skeleton.dart';

const _redditHotUrl =
    'https://www.reddit.com/r/BollyBlindsNGossip/hot.json?limit=50&raw_json=1';

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

TeaItem? _mapRedditChild(Map<String, dynamic>? child) {
  final d = child?['data'] as Map<String, dynamic>?;
  if (d == null) return null;
  final url = redditPermalinkUrl(d);
  final postUrl = d['url'] is String ? d['url'] as String : '';
  final hero = resolveRedditPostImage(d);
  final thumb = d['thumbnail'] is String ? d['thumbnail'] as String : '';
  return TeaItem(
    id: d['id'] as String? ?? d['name'] as String? ?? '',
    title: d['title'] as String? ?? '',
    score: (d['score'] as num?)?.toInt() ?? 0,
    numComments: (d['num_comments'] as num?)?.toInt() ?? 0,
    author: d['author'] is String && '${d['author']}'.isNotEmpty
        ? d['author'] as String
        : 'unknown',
    url: url,
    postUrl: postUrl,
    thumbnail: hero ?? (thumb.startsWith('http') ? thumb : ''),
  );
}

Future<Map<String, dynamic>?> _fetchRedditJsonViaProxies(String targetUrl) async {
  final encoded = Uri.encodeComponent(targetUrl);
  for (final proxy in [
    'https://api.codetabs.com/v1/proxy?quest=$encoded',
    'https://corsproxy.io/?$encoded',
    'https://api.allorigins.win/get?url=$encoded',
  ]) {
    try {
      final res = await http
          .get(Uri.parse(proxy), headers: {'Accept': 'application/json'})
          .timeout(const Duration(seconds: 9));
      if (res.statusCode != 200) continue;
      final body = jsonDecode(res.body);
      if (body is Map && body['contents'] is String) {
        return jsonDecode(body['contents'] as String) as Map<String, dynamic>?;
      }
      if (body is Map<String, dynamic>) return body;
    } catch (_) {}
  }
  return null;
}

Future<Map<String, dynamic>?> _fetchRedditJson(String targetUrl) async {
  try {
    final res = await http
        .get(Uri.parse(targetUrl), headers: {'Accept': 'application/json'})
        .timeout(const Duration(seconds: 9));
    if (res.statusCode == 200) {
      return jsonDecode(res.body) as Map<String, dynamic>;
    }
    return _fetchRedditJsonViaProxies(targetUrl);
  } catch (_) {
    return _fetchRedditJsonViaProxies(targetUrl);
  }
}

Future<List<TeaItem>> fetchTrendingTea() async {
  final json = await _fetchRedditJson(_redditHotUrl);
  final children = json?['data']?['children'];
  if (children is! List) throw Exception('Unexpected response from Reddit');

  final rawPosts = children
      .map((c) => c is Map ? c['data'] as Map<String, dynamic>? : null)
      .whereType<Map<String, dynamic>>()
      .toList();
  final filteredPosts = filterPosts(rawPosts);
  final items = filteredPosts
      .map((d) => _mapRedditChild({'data': d}))
      .whereType<TeaItem>()
      .take(10)
      .toList();
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
      final items = await fetchTrendingTea();
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
