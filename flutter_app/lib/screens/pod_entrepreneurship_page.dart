import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../components/hub_theme.dart';
import '../components/hub_widgets.dart';
import '../contexts/theme_context.dart';
import '../router/app_router.dart';
import '../services/cached_news_service.dart';
import '../services/hub_personalization_service.dart';
import '../services/hub_youtube_trending_service.dart';
import '../services/pod_news_service.dart';

/// Mirrors src/components/PodEntrepreneurshipPage.js
class PodEntrepreneurshipPage extends StatefulWidget {
  const PodEntrepreneurshipPage({super.key});

  @override
  State<PodEntrepreneurshipPage> createState() => _PodEntrepreneurshipPageState();
}

class _PodEntrepreneurshipPageState extends State<PodEntrepreneurshipPage> {
  static List<NewsArticle>? _cache;
  final _explore = const [('Startups', 'startups'), ('Founders', 'founders')];
  List<NewsArticle> _trending = [];
  bool _loading = true;
  String _error = '';

  static const _gradients = [
    [Color(0xFF2c1810), Color(0xFF1a1a1a)],
    [Color(0xFF1a2a1a), Color(0xFF1e1e1e)],
    [Color(0xFF1e1b4b), Color(0xFF1e1e1e)],
    [Color(0xFF422006), Color(0xFF1c1917)],
    [Color(0xFF0c4a6e), Color(0xFF0f172a)],
  ];

  @override
  void initState() {
    super.initState();
    recordHubVerticalDwell('entrepreneurship', 0, 1);
    if (_cache != null) {
      _trending = List.from(_cache!);
      _loading = false;
    }
    _load();
  }

  Future<void> _load() async {
    final fallback = [
      const NewsArticle(title: 'Early-stage funds tighten diligence', source: 'Venture Brief', url: ''),
      const NewsArticle(title: 'SMB software startups lean into AI', source: 'Business Desk', url: ''),
      const NewsArticle(title: 'Founders share runway playbooks', source: 'Founder Weekly', url: ''),
      const NewsArticle(title: 'Regional accelerators report stronger applicants', source: 'Startup Wire', url: ''),
    ];
    if (_trending.isEmpty) setState(() => _loading = true);
    try {
      var youtube = <NewsArticle>[];
      try {
        youtube = await fetchHubVerticalTrendingArticles('entrepreneurship');
      } catch (_) {}

      var reddit = <NewsArticle>[];
      try {
        reddit = await fetchEntrepreneurshipHubTrendingCarouselItems();
      } catch (_) {}
      final news = await getNewsWithLiveFallback('entrepreneurship');
      var newsMerged = news.articles
          .map((a) => NewsArticle(title: a.title, source: a.source, url: a.url, image: a.image, description: a.description, publishedAt: a.publishedAt))
          .toList();
      final filtered = newsMerged.where(isLikelyEntrepreneurshipTrendingItem).toList();
      if (filtered.length >= 3) newsMerged = filtered;
      final weights = await getEntrepreneurshipPersonalizationWeights();
      final others = [...reddit, ...newsMerged];
      others.sort((a, b) {
        final ra = (weights[classifyExploreSlugForEntrepreneurshipTrending(a)] ?? 0) * 2000 + (a.trendingScore ?? 0);
        final rb = (weights[classifyExploreSlugForEntrepreneurshipTrending(b)] ?? 0) * 2000 + (b.trendingScore ?? 0);
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
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = context.watch<ThemeNotifier>().isDarkMode;

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
                  HubBackHeader(title: 'Entrepreneurship', onBack: () => context.go(AppRoutes.pod)),
                  Container(
                    decoration: HubTheme.hubCard(),
                    child: Column(
                      children: [
                        const Padding(
                          padding: EdgeInsets.all(16),
                          child: Align(alignment: Alignment.centerLeft, child: Text('🔥 Trending', style: TextStyle(color: HubTheme.text, fontSize: 16, fontWeight: FontWeight.w600))),
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
                              itemBuilder: (_, i) {
                                final item = _trending[i];
                                final g = _gradients[i % _gradients.length];
                                return SizedBox(
                                  width: 240,
                                  child: Material(
                                    color: Colors.transparent,
                                    child: InkWell(
                                      onTap: item.url.isNotEmpty ? () {} : null,
                                      borderRadius: BorderRadius.circular(12),
                                      child: Ink(
                                        height: 200,
                                        decoration: BoxDecoration(
                                          borderRadius: BorderRadius.circular(12),
                                          border: Border.all(color: HubTheme.divider),
                                          gradient: LinearGradient(colors: g),
                                        ),
                                        padding: const EdgeInsets.all(12),
                                        child: Align(
                                          alignment: Alignment.bottomLeft,
                                          child: Text(item.title, maxLines: 3, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                                        ),
                                      ),
                                    ),
                                  ),
                                );
                              },
                            ),
                          ),
                        if (_error.isNotEmpty)
                          Padding(padding: const EdgeInsets.all(12), child: Text(_error, style: const TextStyle(color: HubTheme.textSecondary, fontSize: 12))),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  Container(
                    decoration: HubTheme.hubCard(),
                    child: Column(
                      children: [
                        const Padding(padding: EdgeInsets.all(16), child: Align(alignment: Alignment.centerLeft, child: Text('✨ Explore', style: TextStyle(color: HubTheme.text, fontSize: 16, fontWeight: FontWeight.w600)))),
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
    );
  }
}
