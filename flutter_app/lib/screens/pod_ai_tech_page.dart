import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../components/hub_theme.dart';
import '../components/hub_widgets.dart';
import '../contexts/theme_context.dart';
import '../router/app_router.dart';
import 'package:deite/lib/pod_topic_news_shared.dart';
import '../services/cached_news_service.dart';
import '../services/hub_personalization_service.dart';
import '../services/hub_youtube_trending_service.dart';
import '../services/pod_news_service.dart';

/// Mirrors src/components/PodAiTechPage.js
class PodAiTechPage extends StatefulWidget {
  const PodAiTechPage({super.key});

  @override
  State<PodAiTechPage> createState() => _PodAiTechPageState();
}

class _PodAiTechPageState extends State<PodAiTechPage> {
  static List<NewsArticle>? _cache;

  final _explore = const [
    ('AI Models', 'ai-models'),
    ('Startups', 'startups'),
    ('Tools', 'tools'),
    ('Vibe Coding', 'vibe-coding'),
    ('Big Tech', 'big-tech'),
  ];

  List<NewsArticle> _trending = [];
  bool _loading = true;
  String _error = '';

  @override
  void initState() {
    super.initState();
    recordHubVerticalDwell('ai-tech', 0, 1);
    if (_cache != null) {
      _trending = List.from(_cache!);
      _loading = false;
    }
    _load();
  }

  Future<void> _load() async {
    final fallback = [
      const NewsArticle(title: 'Major cloud providers expand AI chip capacity', source: 'Tech Wire', url: ''),
      const NewsArticle(title: 'Developers adopt smaller open models', source: 'Dev Digest', url: ''),
      const NewsArticle(title: 'Startups race to ship copilots', source: 'Startup Brief', url: ''),
      const NewsArticle(title: 'Big Tech earnings highlight AI revenue', source: 'Markets Desk', url: ''),
    ];
    if (_trending.isEmpty) setState(() => _loading = true);
    try {
      var youtube = <NewsArticle>[];
      try {
        youtube = await fetchHubVerticalTrendingArticles('ai-tech');
      } catch (_) {}

      var reddit = <NewsArticle>[];
      try {
        reddit = await fetchAiTechHubTrendingCarouselItems();
      } catch (_) {}
      final news = await getNewsWithLiveFallback('ai_tech');
      var newsMerged = news.articles
          .map((a) => NewsArticle(title: a.title, source: a.source, url: a.url, image: a.image, description: a.description, publishedAt: a.publishedAt))
          .toList();
      final filtered = newsMerged.where(isLikelyAiTechTrendingItem).toList();
      if (filtered.length >= 4) newsMerged = filtered;
      final weights = await getAiTechPersonalizationWeights();
      final others = [...reddit, ...newsMerged];
      others.sort((a, b) {
        final ra = (weights[classifyExploreSlugForAiTechTrending(a)] ?? 0) * 2000 + (a.trendingScore ?? 0);
        final rb = (weights[classifyExploreSlugForAiTechTrending(b)] ?? 0) * 2000 + (b.trendingScore ?? 0);
        return rb.compareTo(ra);
      });
      final merged = mergeHubTrendingWithFallback(
        youtube: youtube,
        others: others,
        maxItems: 10,
      );
      final rows = merged.isNotEmpty ? merged : fallback;
      _cache = rows;
      setState(() {
        _trending = rows;
        _error = merged.isEmpty ? (news.error ?? '') : '';
        _loading = false;
      });
    } catch (_) {
      _cache = fallback;
      setState(() {
        _trending = fallback;
        _loading = false;
        _error = 'Could not load cached headlines, showing top picks.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = context.watch<ThemeNotifier>().isDarkMode;
    final returnTo = GoRouterState.of(context).uri.path;

    return Scaffold(
      backgroundColor: HubTheme.scaffoldBg(isDark),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: HubTheme.screenPadding(context),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Column(
                children: [
                  HubBackHeader(title: 'AI & Tech', onBack: () => context.go(AppRoutes.pod)),
                  _trendingSection(returnTo),
                  const SizedBox(height: 16),
                  _exploreSection(isDark),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _trendingSection(String returnTo) {
    return Container(
      decoration: HubTheme.hubCard(),
      child: Column(
        children: [
          const Padding(
            padding: EdgeInsets.all(16),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text('🔥 Trending', style: TextStyle(color: HubTheme.text, fontSize: 16, fontWeight: FontWeight.w600)),
            ),
          ),
          const Divider(height: 1, color: HubTheme.divider),
          if (_loading)
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
    );
  }

  Widget _exploreSection(bool isDark) {
    return Container(
      decoration: HubTheme.hubCard(),
      child: Column(
        children: [
          const Padding(
            padding: EdgeInsets.all(16),
            child: Align(alignment: Alignment.centerLeft, child: Text('✨ Explore', style: TextStyle(color: HubTheme.text, fontSize: 16, fontWeight: FontWeight.w600))),
          ),
          const Divider(height: 1, color: HubTheme.divider),
          ..._explore.map((row) {
            return ListTile(
              title: Text(row.$1, style: const TextStyle(color: HubTheme.text)),
              trailing: const Icon(Icons.chevron_right, color: HubTheme.textSecondary),
              onTap: () {
                prefetchExploreTopicRaw('ai-tech', row.$2, 'international');
                context.push('/pod/explore/ai-tech/${row.$2}');
              },
            );
          }),
        ],
      ),
    );
  }
}
