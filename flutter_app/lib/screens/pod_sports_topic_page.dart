import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../components/hub_theme.dart';
import '../components/hub_widgets.dart';
import '../contexts/theme_context.dart';
import '../router/app_router.dart';
import 'package:deite/lib/pod_topic_news_shared.dart' hide NewsFeedRow;
import '../services/hub_personalization_service.dart';
import '../services/pod_news_service.dart';

/// Mirrors src/components/PodSportsTopicPage.js
class PodSportsTopicPage extends StatefulWidget {
  const PodSportsTopicPage({super.key, required this.topicId});
  final String topicId;

  @override
  State<PodSportsTopicPage> createState() => _PodSportsTopicPageState();
}

class _PodSportsTopicPageState extends State<PodSportsTopicPage> {
  List<NewsArticle> _items = [];
  bool _loading = true;
  String _error = '';
  int _loadToken = 0;

  String get _title => getSportsTopicLabel(widget.topicId);

  @override
  void initState() {
    super.initState();
    recordSportsExploreDwell(widget.topicId, 0, 1);
    _load(initial: true, force: false);
  }

  Future<void> _load({required bool initial, required bool force}) async {
    final token = ++_loadToken;
    if (force) invalidateSportsTopicFeedCache(widget.topicId);

    if (!force && initial) {
      final cached = getSportsTopicFeedCache(widget.topicId);
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
      final raw = await fetchSportsTopicRawItems(widget.topicId);
      if (token != _loadToken) return;
      if (raw.isEmpty) {
        final fallback = buildFallbackRows(widget.topicId, _title);
        setSportsTopicFeedCache(widget.topicId, fallback);
        setState(() {
          _items = fallback;
          _error = 'Live sources unavailable. Showing quick fallback headlines.';
        });
      } else {
        setSportsTopicFeedCache(widget.topicId, raw);
        setState(() {
          _items = raw;
          _error = '';
        });
      }
    } catch (_) {
      final fallback = buildFallbackRows(widget.topicId, _title);
      setState(() {
        _items = fallback;
        _error = 'Live sources unavailable. Showing quick fallback headlines.';
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
                    HubBackHeader(title: _title, onBack: () => context.go(AppRoutes.podSports)),
                    Container(
                      decoration: HubTheme.hubCard(),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('🔥 Latest', style: TextStyle(color: HubTheme.text, fontSize: 16, fontWeight: FontWeight.w600)),
                                if (widget.topicId == 'others')
                                  const Padding(
                                    padding: EdgeInsets.only(top: 4),
                                    child: Text(
                                      'Sports outside Cricket, Football, F1 & Chess',
                                      style: TextStyle(color: HubTheme.textSecondary, fontSize: 12),
                                    ),
                                  ),
                              ],
                            ),
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
                                    onPressed: () => launchUrl(Uri.parse(browseTopicOnGoogleNews(widget.topicId))),
                                    child: Text('Open $_title on Google News'),
                                  ),
                                ],
                              ),
                            )
                          else ...[
                            ..._items.take(25).toList().asMap().entries.map((e) {
                              final idx = e.key;
                              final item = e.value;
                              return NewsFeedRow(
                                item: item,
                                isLast: idx == _items.length - 1 || idx == 24,
                                onOpenShare: () => openNewsShare(context, item, returnTo),
                              );
                            }),
                            if (_error.isNotEmpty)
                              Padding(
                                padding: const EdgeInsets.all(12),
                                child: Text(_error, style: const TextStyle(color: HubTheme.textSecondary, fontSize: 12)),
                              ),
                          ],
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
