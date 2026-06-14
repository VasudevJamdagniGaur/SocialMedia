import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../components/hub_theme.dart';
import '../components/hub_widgets.dart';
import '../contexts/theme_context.dart';
import '../router/app_router.dart';
import 'package:deite/lib/hub_trending_algorithms.dart';
import 'package:deite/lib/pod_topic_news_shared.dart';
import '../services/cached_news_service.dart';
import '../services/hub_personalization_service.dart';
import '../services/hub_youtube_trending_service.dart';
import '../services/pod_news_service.dart';
import '../utils/hub_carousel_ai_image.dart';
import '../utils/hub_carousel_image_store.dart';
import '../utils/share_news_cache.dart';

/// Mirrors src/components/PodEntrepreneurshipPage.js
class PodEntrepreneurshipPage extends StatefulWidget {
  const PodEntrepreneurshipPage({super.key});

  @override
  State<PodEntrepreneurshipPage> createState() => _PodEntrepreneurshipPageState();
}

class _PodEntrepreneurshipPageState extends State<PodEntrepreneurshipPage> {
  final _explore = const [('Startups', 'startups'), ('Founders', 'founders')];
  List<NewsArticle> _trending = [];
  bool _loading = true;
  String _error = '';
  int _loadToken = 0;
  int _aiImageGen = 0;

  @override
  void initState() {
    super.initState();
    recordHubVerticalDwell('entrepreneurship', 0, 1);
    _load();
  }

  Future<void> _load({bool skipBar = false}) async {
    final token = ++_loadToken;
    if (!skipBar && _trending.isEmpty) setState(() => _loading = true);

    final fallback = [
      NewsArticle(title: 'Early-stage funds tighten diligence', source: 'Venture Brief', url: googleNewsSearchUrl('startup funding news')),
      NewsArticle(title: 'SMB software startups lean into AI', source: 'Business Desk', url: googleNewsSearchUrl('SMB startup AI news')),
      NewsArticle(title: 'Founders share runway playbooks', source: 'Founder Weekly', url: googleNewsSearchUrl('founder startup playbook')),
      NewsArticle(title: 'Regional accelerators report stronger applicants', source: 'Startup Wire', url: googleNewsSearchUrl('startup accelerator news')),
    ];

    try {
      var rows = <NewsArticle>[];
      try {
        rows = await fetchEntrepreneurshipTrendingAll(maxKeep: 10);
      } catch (e) {
        debugPrint('[Entrepreneurship] trending fetch failed: $e');
      }

      if (token != _loadToken) return;

      if (rows.length < 3) {
        var reddit = <NewsArticle>[];
        try {
          reddit = await fetchEntrepreneurshipHubTrendingCarouselItems();
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
          final news = await getNewsWithLiveFallback('entrepreneurship');
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
          final filtered = newsMerged.where(isLikelyEntrepreneurshipTrendingItem).toList();
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
          priority: HubCarouselImagePriority.podVertical,
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
                    HubBackHeader(title: 'Entrepreneurship', onBack: () => context.go(AppRoutes.pod)),
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
                                  prefetchExploreTopicRaw('entrepreneurship', row.$2, 'international');
                                  context.push('/pod/explore/entrepreneurship/${row.$2}');
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
