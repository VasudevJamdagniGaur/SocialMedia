import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';

import '../components/hub_theme.dart';
import '../components/hub_widgets.dart';
import '../contexts/theme_context.dart';
import '../router/app_router.dart';
import '../services/auth_service.dart';
import 'package:deite/lib/hub_trending_algorithms.dart';
import 'package:deite/lib/pod_topic_news_shared.dart';
import '../services/cached_news_service.dart';
import '../services/firestore_service.dart';
import '../services/hub_personalization_service.dart';
import '../services/hub_youtube_trending_service.dart';
import '../services/pod_news_service.dart';
import '../utils/hub_carousel_ai_image.dart';
import '../utils/hub_carousel_image_store.dart';
import '../utils/share_news_cache.dart';

/// Mirrors src/components/PodSportsPage.js
class PodSportsPage extends StatefulWidget {
  const PodSportsPage({super.key});

  @override
  State<PodSportsPage> createState() => _PodSportsPageState();
}

class _PodSportsPageState extends State<PodSportsPage> {
  final _sportsExplore = const [
    ('Cricket', 'cricket'),
    ('Football', 'football'),
    ('F1', 'f1'),
    ('Chess', 'chess'),
    ('Others', 'others'),
  ];

  List<NewsArticle> _trending = [];
  bool _loading = true;
  String _error = '';
  int _loadToken = 0;
  int _aiImageGen = 0;

  @override
  void initState() {
    super.initState();
    recordHubVerticalDwell('sports', 0, 1);
    prefetchAllSportsExploreTopicsNow();
    _loadNews();
  }

  Future<void> _loadNews({bool skipBar = false}) async {
    final token = ++_loadToken;
    if (!skipBar && _trending.isEmpty) setState(() => _loading = true);

    final fallback = [
      NewsArticle(title: 'Global football season enters decisive phase', source: 'Sports Desk', url: googleNewsSearchUrl('football soccer news')),
      NewsArticle(title: 'Cricket boards announce major tournament updates', source: 'Sports Desk', url: googleNewsSearchUrl('cricket news')),
      NewsArticle(title: 'F1 teams prepare new aero packages', source: 'Motorsport Wire', url: googleNewsSearchUrl('Formula 1 news')),
      NewsArticle(title: 'Top chess stars set for rapid events', source: 'Chess Chronicle', url: googleNewsSearchUrl('chess grandmaster news')),
    ];

    try {
      var rows = <NewsArticle>[];
      try {
        rows = await fetchSportsTrendingAll(maxKeep: 10);
      } catch (e) {
        debugPrint('[Sports] trending fetch failed: $e');
      }

      if (token != _loadToken) return;

      if (rows.length < 4) {
        var reddit = <NewsArticle>[];
        try {
          reddit = await fetchSportsHubTrendingCarouselItems();
        } catch (_) {}
        if (token != _loadToken) return;
        rows = mergeHubTrendingWithFallback(
          youtube: rows,
          others: reddit,
          maxItems: 10,
        );
      }

      if (rows.isEmpty) {
        try {
          final news = await getNewsWithLiveFallback('sports');
          if (token != _loadToken) return;
          var newsMerged = news.articles
              .map((a) => NewsArticle(
                    title: a.title,
                    source: a.source,
                    url: a.url,
                    image: a.image,
                    description: a.description,
                    publishedAt: a.publishedAt,
                  ))
              .toList();
          final filtered = newsMerged.where(isLikelySportsTrendingItem).toList();
          if (filtered.length >= 3) newsMerged = filtered;
          rows = mergeHubTrendingWithFallback(youtube: rows, others: newsMerged, maxItems: 10);
        } catch (_) {}
      }

      final display = rows.isNotEmpty ? rows : fallback;
      if (!mounted || token != _loadToken) return;
      setState(() {
        _trending = display;
        _error = rows.isEmpty ? 'Live feed unavailable — showing top picks.' : '';
        _loading = false;
      });
      unawaited(_enrichMissingAiImages());
    } catch (e) {
      if (token != _loadToken) return;
      if (!mounted) return;
      setState(() {
        _trending = fallback;
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _enrichMissingAiImages() async {
    final token = ++_aiImageGen;
    await enrichCarouselSlotsWithAiImages(
      slotCount: _trending.length,
      needsImage: (i) => !hasUsableHubImage(_trending[i].image),
      generateForIndex: (i) {
        final item = _trending[i];
        return getOrGenerateHubCarouselImage(
          cacheKey: hubCarouselImageCacheKey(item.url, item.title),
          headline: item.title,
          storyText: stripHtmlBoilerplate(item.description),
          articleUrl: item.url,
          kind: HubCarouselImageKind.news,
        );
      },
      applyImage: (i, imageUrl) {
        if (!mounted || token != _aiImageGen) return;
        final item = _trending[i];
        setState(() {
          final updated = [..._trending];
          updated[i] = NewsArticle(
            title: item.title,
            source: item.source,
            url: item.url,
            image: imageUrl,
            description: item.description,
            publishedAt: item.publishedAt,
            sourceSiteUrl: item.sourceSiteUrl,
            publisherUrl: item.publisherUrl,
            trendingScore: item.trendingScore,
            exploreTopic: item.exploreTopic,
            firestoreId: item.firestoreId,
          );
          _trending = updated;
        });
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = context.watch<ThemeNotifier>().isDarkMode;
    final returnTo = GoRouterState.of(context).uri.path;
    final userId = AuthService().getCurrentUser()?.uid;

    return Scaffold(
      backgroundColor: HubTheme.scaffoldBg(isDark),
      body: RefreshIndicator(
        onRefresh: () => _loadNews(skipBar: true),
        child: SafeArea(
          child: SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: HubTheme.screenPadding(context),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 400),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    HubBackHeader(title: 'Sports', onBack: () => context.go(AppRoutes.pod)),
                    Container(
                      decoration: HubTheme.hubCard(),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const Padding(
                            padding: EdgeInsets.all(16),
                            child: Row(
                              children: [
                                Icon(LucideIcons.flame, color: HubTheme.accent, size: 18),
                                SizedBox(width: 8),
                                Text('Trending', style: TextStyle(color: HubTheme.text, fontSize: 18, fontWeight: FontWeight.w600)),
                              ],
                            ),
                          ),
                          const Divider(height: 1, color: HubTheme.divider),
                          if (_loading && _trending.isEmpty)
                            const CardSkeletonRow()
                          else ...[
                            SizedBox(
                              height: 212,
                              child: ListView.separated(
                                scrollDirection: Axis.horizontal,
                                padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                                itemCount: _trending.length,
                                separatorBuilder: (_, __) => const SizedBox(width: 12),
                                itemBuilder: (_, i) => HubTrendingCarouselCard(
                                  item: _trending[i],
                                  index: i,
                                  returnTo: returnTo,
                                  isSignedIn: userId != null,
                                  onLike: userId != null && _trending[i].firestoreId != null
                                      ? () => FirestoreService.instance.incrementSportsTrendingEngagement(
                                            _trending[i].firestoreId!, 'like')
                                      : null,
                                ),
                              ),
                            ),
                            if (_error.isNotEmpty)
                              Padding(
                                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                                child: Text(_error, style: const TextStyle(color: HubTheme.textSecondary, fontSize: 12)),
                              ),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    Container(
                      decoration: HubTheme.hubCard(),
                      child: Column(
                        children: [
                          const Padding(
                            padding: EdgeInsets.all(16),
                            child: Row(
                              children: [
                                Icon(LucideIcons.sparkles, color: HubTheme.accent, size: 18),
                                SizedBox(width: 8),
                                Text('Explore', style: TextStyle(color: HubTheme.text, fontSize: 16, fontWeight: FontWeight.w600)),
                              ],
                            ),
                          ),
                          const Divider(height: 1, color: HubTheme.divider),
                          ...List.generate(_sportsExplore.length, (i) {
                            final (label, slug) = _sportsExplore[i];
                            return ListTile(
                              title: Text(label, style: const TextStyle(color: HubTheme.text)),
                              trailing: const Icon(LucideIcons.chevronRight, color: HubTheme.textSecondary, size: 18),
                              onTap: () {
                                prefetchSportsTopicRaw(slug);
                                context.push('/pod/sports/topic/$slug');
                              },
                            );
                          }),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
