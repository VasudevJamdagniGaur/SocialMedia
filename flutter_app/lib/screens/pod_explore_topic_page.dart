import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../components/hub_theme.dart';
import '../components/hub_widgets.dart';
import '../contexts/theme_context.dart';
import 'package:deite/lib/pod_topic_news_shared.dart' hide NewsFeedRow;
import '../services/hub_personalization_service.dart';
import '../services/pod_news_service.dart';

/// Mirrors src/components/PodExploreTopicPage.js
class PodExploreTopicPage extends StatefulWidget {
  const PodExploreTopicPage({
    super.key,
    required this.section,
    required this.topicId,
  });

  final String section;
  final String topicId;

  @override
  State<PodExploreTopicPage> createState() => _PodExploreTopicPageState();
}

class _PodExploreTopicPageState extends State<PodExploreTopicPage> {
  List<NewsArticle> _items = [];
  bool _loading = true;
  String _error = '';
  String _startupRegion = 'international';
  int _loadToken = 0;

  String get _title => getExploreTopicConfig(widget.section, widget.topicId)?['label'] ?? 'Explore';
  String get _backTo => exploreSectionHomeRoute(widget.section);

  @override
  void initState() {
    super.initState();
    _recordVisit();
    final key = exploreTopicCacheKey(widget.section, widget.topicId, _startupRegion);
    final cached = getExploreTopicFeedCache(key);
    if (cached != null && cached.isNotEmpty) {
      _items = cached;
      _loading = false;
    }
    _load(initial: true, force: false);
  }

  void _recordVisit() {
    final id = widget.topicId;
    if (widget.section == 'ai-tech') recordAiTechExploreDwell(id, 0, 1);
    if (widget.section == 'entrepreneurship') recordEntrepreneurshipExploreDwell(id, 0, 1);
    if (widget.section == 'current-affairs') recordCurrentAffairsExploreDwell(id, 0, 1);
  }

  Future<void> _load({required bool initial, required bool force}) async {
    final token = ++_loadToken;
    final key = exploreTopicCacheKey(widget.section, widget.topicId, _startupRegion);
    if (force) invalidateExploreTopicFeedCache(key);

    if (!force && initial) {
      final cached = getExploreTopicFeedCache(key);
      if (cached != null && cached.isNotEmpty) {
        setState(() {
          _items = cached;
          _loading = false;
        });
        return;
      }
    }

    if (initial) {
      setState(() => _loading = true);
    }

    try {
      final result = await fetchExploreTopicFeed(
        section: widget.section,
        topicId: widget.topicId,
        startupRegion: _startupRegion,
      );
      if (token != _loadToken) return;
      setExploreTopicFeedCache(key, result.items);
      setState(() {
        _items = result.items;
        _error = result.error;
      });
    } finally {
      if (token == _loadToken && mounted) {
        setState(() => _loading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = context.watch<ThemeNotifier>().isDarkMode;
    final returnTo = GoRouterState.of(context).uri.path;
    final cfg = getExploreTopicConfig(widget.section, widget.topicId);
    final googleQ = cfg?['q'] ?? widget.topicId;

    return Scaffold(
      backgroundColor: HubTheme.scaffoldBg(isDark),
      body: RefreshIndicator(
        onRefresh: () => _load(initial: false, force: true),
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
                    HubBackHeader(title: _title, onBack: () => context.go(_backTo)),
                    if (isStartupsRegionTopic(widget.section, widget.topicId))
                      Container(
                        margin: const EdgeInsets.only(bottom: 16),
                        padding: const EdgeInsets.all(4),
                        decoration: HubTheme.hubCard(),
                        child: Row(
                          children: ['local', 'international'].map((key) {
                            final active = _startupRegion == key;
                            return Expanded(
                              child: TextButton(
                                onPressed: () {
                                  setState(() => _startupRegion = key);
                                  _load(initial: true, force: false);
                                },
                                style: TextButton.styleFrom(
                                  backgroundColor: active ? HubTheme.accent.withValues(alpha: 0.2) : null,
                                  foregroundColor: active ? HubTheme.text : HubTheme.textSecondary,
                                ),
                                child: Text(key == 'local' ? 'Local' : 'International'),
                              ),
                            );
                          }).toList(),
                        ),
                      ),
                    Container(
                      decoration: HubTheme.hubCard(),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const Padding(
                            padding: EdgeInsets.all(16),
                            child: Text('🔥 Latest', style: TextStyle(color: HubTheme.text, fontSize: 16, fontWeight: FontWeight.w600)),
                          ),
                          const Divider(height: 1, color: HubTheme.divider),
                          if (_loading)
                            const Padding(padding: EdgeInsets.all(16), child: ListSkeleton(count: 5))
                          else if (_items.isEmpty)
                            Padding(
                              padding: const EdgeInsets.all(24),
                              child: Column(
                                children: [
                                  Text(_error.isNotEmpty ? _error : 'No stories to show yet.', style: const TextStyle(color: HubTheme.textSecondary)),
                                  TextButton(
                                    onPressed: () => launchUrl(Uri.parse(googleNewsSearchUrl(googleQ))),
                                    child: Text('Open $_title on Google News'),
                                  ),
                                ],
                              ),
                            )
                          else
                            ..._items.take(25).toList().asMap().entries.map((e) {
                              return NewsFeedRow(
                                item: e.value,
                                isLast: e.key == _items.length - 1 || e.key == 24,
                                onOpenShare: () => openNewsShare(context, e.value, returnTo),
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
