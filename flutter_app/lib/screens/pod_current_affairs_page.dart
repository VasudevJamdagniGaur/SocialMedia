import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
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

/// Mirrors src/components/PodCurrentAffairsPage.js
class PodCurrentAffairsPage extends StatefulWidget {
  const PodCurrentAffairsPage({super.key});

  @override
  State<PodCurrentAffairsPage> createState() => _PodCurrentAffairsPageState();
}

class _PodCurrentAffairsPageState extends State<PodCurrentAffairsPage> {
  final _explore = const [
    ('World News', 'world-news'),
    ('Politics', 'politics'),
    ('Economy', 'economy'),
    ('Climate', 'climate'),
  ];

  List<NewsArticle> _trending = [];
  bool _loading = true;
  String _error = '';
  int _loadToken = 0;
  int _aiImageGen = 0;

  @override
  void initState() {
    super.initState();
    recordHubVerticalDwell('current-affairs', 0, 1);
    _load();
  }

  Future<void> _load({bool skipBar = false}) async {
    final token = ++_loadToken;
    if (!skipBar && _trending.isEmpty) setState(() => _loading = true);

    final fallback = [
      NewsArticle(title: 'Global leaders meet on coordinated crisis response', source: 'News', url: googleNewsSearchUrl('world news international'), exploreTopic: 'world-news'),
      NewsArticle(title: 'Markets weigh commodity shifts', source: 'News', url: googleNewsSearchUrl('economy news'), exploreTopic: 'economy'),
      NewsArticle(title: 'UN agencies highlight humanitarian needs', source: 'News', url: googleNewsSearchUrl('world politics'), exploreTopic: 'politics'),
      NewsArticle(title: 'Scientists publish extreme weather findings', source: 'News', url: googleNewsSearchUrl('climate change news'), exploreTopic: 'climate'),
    ];

    try {
      var rows = <NewsArticle>[];
      try {
        rows = await fetchCurrentAffairsTrendingAll(maxKeep: 10);
      } catch (e) {
        debugPrint('[CurrentAffairs] trending fetch failed: $e');
      }

      if (token != _loadToken) return;

      if (rows.length < 3) {
        var reddit = <NewsArticle>[];
        try {
          reddit = await fetchCurrentAffairsHubTrendingCarouselItems();
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
          final news = await getNewsWithLiveFallback('current_affairs');
          if (token != _loadToken) return;
          final newsMerged = news.articles
              .map((a) => NewsArticle(
                    title: a.title,
                    source: a.source,
                    url: a.url,
                    image: a.image,
                    description: a.description,
                    publishedAt: a.publishedAt,
                  ))
              .toList();
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
      unawaited(_patchImages());
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
            exploreTopic: item.exploreTopic,
            sourceSiteUrl: item.sourceSiteUrl,
            publisherUrl: item.publisherUrl,
            trendingScore: item.trendingScore,
            firestoreId: item.firestoreId,
          );
          _trending = updated;
        });
      },
    );
  }

  Future<void> _patchImages() async {
    final user = AuthService().getCurrentUser();
    if (user == null) return;
    final missing = <int>[];
    for (var i = 0; i < _trending.length && i < 10; i++) {
      if (_trending[i].url.isNotEmpty && !hasUsableHubImage(_trending[i].image)) {
        missing.add(i);
      }
    }
    if (missing.isEmpty) return;
    FirestoreService.instance.cleanupNewsShareImages(
      user.uid,
      _trending.map((x) => x.url).where((u) => u.isNotEmpty).toList(),
    );
    final next = List<NewsArticle>.from(_trending);
    var changed = false;
    for (final idx in missing) {
      final url = await FirestoreService.instance.getNewsShareImageUrl(user.uid, next[idx].url);
      if (url != null && url.isNotEmpty) {
        next[idx] = NewsArticle(
          title: next[idx].title,
          source: next[idx].source,
          url: next[idx].url,
          image: url,
          description: next[idx].description,
          exploreTopic: next[idx].exploreTopic,
        );
        changed = true;
      }
    }
    if (changed && mounted) setState(() => _trending = next);
  }

  @override
  Widget build(BuildContext context) {
    final isDark = context.watch<ThemeNotifier>().isDarkMode;
    final returnTo = GoRouterState.of(context).uri.path;

    return Scaffold(
      backgroundColor: HubTheme.scaffoldBg(isDark),
      body: RefreshIndicator(
        onRefresh: () => _load(skipBar: true),
        child: SafeArea(
          child: SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: HubTheme.screenPadding(context),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 400),
                child: Column(
                  children: [
                    HubBackHeader(title: 'Current Affairs', onBack: () => context.go(AppRoutes.pod)),
                    Container(
                      decoration: HubTheme.hubCard(),
                      child: Column(
                        children: [
                          const Padding(
                            padding: EdgeInsets.all(16),
                            child: Align(
                              alignment: Alignment.centerLeft,
                              child: Text(
                                '🔥 Trending',
                                style: TextStyle(color: HubTheme.text, fontSize: 16, fontWeight: FontWeight.w600),
                              ),
                            ),
                          ),
                          const Divider(height: 1, color: HubTheme.divider),
                          if (_loading && _trending.isEmpty)
                            const CardSkeletonRow()
                          else
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
                                  showSource: true,
                                ),
                              ),
                            ),
                          if (_error.isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.all(12),
                              child: Text(_error, style: const TextStyle(color: HubTheme.textSecondary, fontSize: 12)),
                            ),
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
                            child: Align(
                              alignment: Alignment.centerLeft,
                              child: Text('✨ Explore', style: TextStyle(color: HubTheme.text, fontSize: 16, fontWeight: FontWeight.w600)),
                            ),
                          ),
                          const Divider(height: 1, color: HubTheme.divider),
                          ..._explore.map((row) => ListTile(
                                title: Text(row.$1, style: const TextStyle(color: HubTheme.text)),
                                trailing: const Icon(Icons.chevron_right, color: HubTheme.textSecondary),
                                onTap: () {
                                  prefetchExploreTopicRaw('current-affairs', row.$2, 'international');
                                  context.push('/pod/explore/current-affairs/${row.$2}');
                                },
                              )),
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
