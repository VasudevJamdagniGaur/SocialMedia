import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../components/trending_tea.dart';
import '../router/app_router.dart';
import '../services/cached_news_service.dart';
import '../services/tea_multi_source_service.dart';
import '../services/tea_news_refresh_mode.dart';
import '../services/youtube_tea_service.dart';
import '../utils/hub_carousel_ai_image.dart';
import '../utils/hub_carousel_image_store.dart';
import '../utils/hub_colors.dart';
import '../utils/reddit_thread_comments.dart';
import '../utils/share_news_cache.dart';
import '../utils/tea_content_extraction.dart';
import '../utils/tea_event_topics.dart';
import '../utils/tea_story_cluster.dart';
import '../utils/tea_topic_context.dart';
import '../utils/tea_watchlist_storage.dart';

const _hubMuted = Color(0x9EFFFFFF);
const _hubDivider = Color(0x14FFFFFF);
const _hubPillBg = Color(0x38A855F7);

const _fallbackGradients = <List<Color>>[
  [Color(0xFF1A1A2E), Color(0xFF16213E), Color(0xFF0F3460)],
  [Color(0xFF2D132C), Color(0xFF801336), Color(0xFFC72C41)],
  [Color(0xFF0F2027), Color(0xFF203A43), Color(0xFF2C5364)],
  [Color(0xFF1E3C72), Color(0xFF2A5298), Color(0xFF7E8BA3)],
  [Color(0xFF232526), Color(0xFF414345)],
];

const _quickEmojis = ['❤️', '🔥', '👏', '😂', '✨', '😮'];
const _usernameMax = 17;

String _teaLaneLabel(TeaItem item) {
  final url = item.url.toLowerCase();
  final author = item.author.toLowerCase();
  if (item.eventId.isNotEmpty) return 'EVENT';
  if (item.isBreaking) return 'NEWS';
  if (url.contains('reddit.com') || author.startsWith('r/')) return 'REDDIT';
  if (url.contains('youtube.com') || url.contains('youtu.be')) return 'SOCIAL';
  return 'TEA';
}

class _CommentEntry {
  _CommentEntry({this.status = 'idle', this.comments = const [], this.error});

  String status;
  List<RedditComment> comments;
  String? error;
}

class TeaFeedPage extends StatefulWidget {
  const TeaFeedPage({super.key});

  @override
  State<TeaFeedPage> createState() => _TeaFeedPageState();
}

class _TeaFeedPageState extends State<TeaFeedPage> {
  List<TeaItem> _rawItems = [];
  String _returnTo = AppRoutes.dashboard;
  bool _parsedExtra = false;
  bool _sectionLoading = false;
  String? _sectionError;

  TeaFeedSection _tab = TeaFeedSection.forYou;
  final Map<TeaFeedSection, List<TeaItem>> _sectionCache = {};
  final Set<String> _liked = {};
  final Set<String> _watchlisted = {};
  final Map<String, _CommentEntry> _commentsByPostId = {};
  final PageController _pageController = PageController();
  int _imageHydrateGen = 0;

  List<TeaItem> get _displayItems {
    final items = teaItemsWithResolvedHeroes(_rawItems);
    if (_tab == TeaFeedSection.trending || _tab == TeaFeedSection.breaking) {
      items.sort((a, b) => b.score.compareTo(a.score));
    }
    if (_tab == TeaFeedSection.forYou && _watchlisted.isNotEmpty) {
      items.sort((a, b) {
        final aw = _watchlisted.contains(a.id) ? 1 : 0;
        final bw = _watchlisted.contains(b.id) ? 1 : 0;
        if (aw != bw) return bw.compareTo(aw);
        return b.score.compareTo(a.score);
      });
    }
    return items;
  }

  bool _applyLaunchHandoff() {
    final handoff = takeTeaFeedLaunchItems();
    if (handoff == null || handoff.isEmpty) return false;
    _rawItems = teaItemsWithResolvedHeroes(handoff);
    return true;
  }

  List<TeaItem> _mergeWithMemoryTeaCache(List<TeaItem> items) {
    final mem = memoryTeaCacheSnapshot;
    if (mem == null || mem.isEmpty) return items;
    final richByUrl = {
      for (final row in teaItemsWithResolvedHeroes(mem))
        if (row.url.trim().isNotEmpty) normalizeUrlKey(row.url): row,
    };
    if (richByUrl.isEmpty) return items;
    return items.map((item) {
      if (teaHeroImageUrl(item) != null) return item;
      final rich = richByUrl[normalizeUrlKey(item.url)];
      if (rich == null || teaHeroImageUrl(rich) == null) return item;
      return _copyTeaItem(item, thumbnail: teaHeroImageUrl(rich)!);
    }).toList();
  }

  @override
  void initState() {
    super.initState();
    if (_applyLaunchHandoff()) {
      _rawItems = _mergeWithMemoryTeaCache(_rawItems);
    }
  }

  @override
  void activate() {
    super.activate();
    if (_applyLaunchHandoff()) {
      setState(() => _rawItems = _mergeWithMemoryTeaCache(_rawItems));
    }
    if (_parsedExtra) {
      unawaited(_hydrateTeaFeedImages());
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_parsedExtra) return;
    _parsedExtra = true;
    unawaited(_bootstrapTeaFeed());
  }

  Future<void> _bootstrapTeaFeed() async {
    if (_rawItems.isEmpty) {
      _applyLaunchHandoff();
    }

    final extra = GoRouterState.of(context).extra;
    if (extra is Map) {
      _returnTo = extra['returnTo'] as String? ?? AppRoutes.dashboard;
      if (!_returnTo.startsWith('/')) _returnTo = AppRoutes.dashboard;
      if (_rawItems.isEmpty) {
        final raw = extra['teaItems'];
        if (raw is List) {
          _rawItems = raw.map(_parseTeaItem).whereType<TeaItem>().toList();
        }
      }
    }
    _rawItems = _mergeWithMemoryTeaCache(_rawItems);
    _rawItems = teaItemsWithResolvedHeroes(_rawItems);

    if (_rawItems.isEmpty && !kManualTeaNewsRefreshOnly) {
      await _loadSection(TeaFeedSection.forYou, force: false);
    } else {
      _sectionCache[TeaFeedSection.forYou] = List<TeaItem>.from(_rawItems);
    }
    if (!mounted) return;
    setState(() {});
    await _refreshWatchlistIds();
    await _hydrateTeaFeedImages();
  }

  Future<void> _loadSection(TeaFeedSection section, {bool force = false}) async {
    if (!force && _sectionCache[section] != null && _sectionCache[section]!.isNotEmpty) {
      setState(() {
        _tab = section;
        _rawItems = List<TeaItem>.from(_sectionCache[section]!);
        _sectionError = null;
      });
      return;
    }
    setState(() {
      _tab = section;
      _sectionLoading = true;
      _sectionError = null;
    });
    try {
      final rows = await fetchTeaSectionRows(section, forceRefresh: force);
      final items = rows
          .map((r) => _parseTeaItem({
                ...r,
                'id': hubNewsDocIdFromUrl('${r['url'] ?? ''}'),
                'postUrl': r['url'],
                'thumbnail': r['image'] ?? r['thumbnail'],
                'num_comments': r['num_comments'] ?? 0,
              }))
          .whereType<TeaItem>()
          .toList();
      if (!mounted) return;
      _sectionCache[section] = items;
      setState(() {
        _rawItems = items;
        _sectionLoading = false;
        if (items.isEmpty) {
          _sectionError =
              'No accessible stories for ${section.label} right now. Pull to refresh later.';
        }
      });
      await _hydrateTeaFeedImages();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _sectionLoading = false;
        _sectionError = 'Could not refresh ${section.label}.';
      });
      debugPrint('[TeaFeed] section ${section.id} failed: $e');
    }
  }

  Future<void> _openEventDetail(String eventId) async {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0C0C0C),
      builder: (ctx) => _TeaEventDetailSheet(
        eventId: eventId,
        onGeneratePost: (cluster) {
          Navigator.of(ctx).pop();
          final item = _parseTeaItem(cluster.toTeaRow());
          if (item != null) unawaited(_openShareSuggestions(item));
        },
      ),
    );
  }

  Future<void> _hydrateTeaFeedImages() async {
    if (_rawItems.isEmpty) return;
    final token = ++_imageHydrateGen;
    var changed = false;
    final updated = <TeaItem>[];

    for (final item in _rawItems) {
      final immediate = teaHeroImageUrl(item);
      if (immediate != null) {
        updated.add(_copyTeaItem(item, thumbnail: immediate));
        if (immediate != item.thumbnail) changed = true;
        continue;
      }

      final ytFallback = youtubeTeaThumbnailFromUrl(item.url);
      if (ytFallback != null) {
        updated.add(_copyTeaItem(item, thumbnail: ytFallback));
        changed = true;
        continue;
      }

      String? cached;
      for (final fallbackId in _teaImageFallbackIds(item)) {
        cached = await resolveHubCarouselImageFast(
          url: item.url,
          title: item.title,
          fallbackId: fallbackId,
          kind: HubCarouselImageKind.tea,
        );
        if (cached != null) break;
      }
      if (cached != null) {
        updated.add(_copyTeaItem(item, thumbnail: cached));
        changed = true;
      } else {
        updated.add(item);
      }
    }

    if (changed && mounted && token == _imageHydrateGen) {
      setState(() => _rawItems = updated);
    }

  }

  TeaItem _copyTeaItem(TeaItem item, {String? thumbnail}) {
    return item.copyWith(thumbnail: thumbnail);
  }

  TeaItem? _parseTeaItem(dynamic e) {
    if (e is TeaItem) return e;
    if (e is Map) {
      final m = Map<String, dynamic>.from(e);
      final title = m['title'] as String? ?? '';
      return TeaItem(
        id: '${m['id'] ?? ''}',
        title: title,
        url: m['url'] as String? ?? '',
        postUrl: m['postUrl'] as String? ?? '',
        thumbnail: '${m['thumbnail'] ?? m['image'] ?? ''}',
        gossip: cleanFeedSnippetForDisplay(
          '${m['gossip'] ?? m['description'] ?? ''}',
          title: title,
        ),
        author: m['author'] as String? ?? m['source'] as String? ?? 'unknown',
        score: (m['score'] as num?)?.toInt() ?? 0,
        numComments: (m['num_comments'] as num?)?.toInt() ?? 0,
        contextLevel: '${m['contextLevel'] ?? ''}',
        contextSummary: cleanFeedSnippetForDisplay(
          '${m['contextSummary'] ?? ''}',
          title: title,
        ),
        eventId: '${m['eventId'] ?? ''}',
        isBreaking: m['isBreaking'] == true,
      );
    }
    return null;
  }

  Future<void> _refreshWatchlistIds() async {
    final list = await getTeaWatchlist();
    if (!mounted) return;
    setState(() {
      _watchlisted
        ..clear()
        ..addAll(list.map((e) => e.id));
    });
  }

  void _goBack() {
    context.go(_returnTo);
  }

  void _toggleLike(String id) {
    setState(() {
      if (_liked.contains(id)) {
        _liked.remove(id);
      } else {
        _liked.add(id);
      }
    });
  }

  Future<void> _toggleWatchlist(TeaItem item) async {
    if (item.url.isEmpty) return;
    await toggleTeaWatchlistItem(item.toJson());
    await _refreshWatchlistIds();
  }

  void _requestComments(TeaItem item) {
    final postId = item.id;
    if (postId.isEmpty || item.url.isEmpty) return;
    final cur = _commentsByPostId[postId];
    if (cur != null && (cur.status == 'loading' || cur.status == 'loaded')) return;

    setState(() => _commentsByPostId[postId] = _CommentEntry(status: 'loading'));

    fetchTeaThreadComments(item.url).then((res) {
      if (!mounted) return;
      setState(() {
        final existing = _commentsByPostId[postId];
        if (existing?.status == 'loaded') return;
        if (res.ok) {
          _commentsByPostId[postId] = _CommentEntry(status: 'loaded', comments: res.comments);
        } else {
          _commentsByPostId[postId] = _CommentEntry(status: 'error', error: res.error ?? 'Failed');
        }
      });
    });
  }

  void _onPageChanged(int index) {
    final items = _displayItems;
    if (index >= 0 && index < items.length) {
      _requestComments(items[index]);
    }
  }

  Future<void> _openShareSuggestions(TeaItem item) async {
    if (item.url.isEmpty) return;
    final extracted = await resolveTeaPostContent({
      'title': item.title,
      'url': item.url,
      'gossip': item.gossip,
      'description': item.gossip,
      'selftext': item.gossip,
      'image': teaHeroImageUrl(item) ?? item.thumbnail,
      'author': item.author,
      'source': isYouTubeTeaUrl(item.url) ? 'YouTube' : 'Tea',
      'contextLevel': item.contextLevel,
      'contextSummary': item.contextSummary,
    });
    final seed = extracted.toArticleSeed();
    seed['image'] = teaHeroImageUrl(item) ?? item.thumbnail;
    final ctx = peekTeaTopicContext(item.url, item.title) ??
        await enrichTeaTopicContext(seed);
    seed.addAll(ctx.toArticleFields());
    if (extracted.diagnostic.isNotEmpty) {
      seed['extractionDiagnostic'] = extracted.diagnostic;
    }
    final payload = {
      'newsArticle': seed,
      'returnTo': AppRoutes.teaFeed,
      // Land on Share Suggestions with LinkedIn / X / Instagram picker first.
      // Do not auto-open the "Edit before sharing" panel.
      'platform': 'linkedin',
    };
    await prepareShareSuggestionsRoute(payload);
    if (!mounted) return;
    await context.push(AppRoutes.shareSuggestions, extra: payload);
  }

  Future<void> _openTopicContext(TeaItem item) async {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0C0C0C),
      barrierColor: Colors.black54,
      builder: (ctx) => _TeaTopicContextSheet(
        item: item,
        onGeneratePost: () {
          Navigator.of(ctx).pop();
          unawaited(_openShareSuggestions(item));
        },
      ),
    );
  }

  void _openComments(TeaItem item) {
    if (item.id.isEmpty || item.url.isEmpty) return;
    _requestComments(item);
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0C0C0C),
      barrierColor: Colors.black54,
      builder: (ctx) => _TeaCommentsSheet(
        item: item,
        initialEntry: _commentsByPostId[item.id],
        onCacheUpdate: (entry) {
          setState(() => _commentsByPostId[item.id] = entry);
        },
      ),
    );
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final items = _displayItems;
    final topPad = MediaQuery.paddingOf(context).top;

    return Scaffold(
      backgroundColor: Colors.black,
      body: Column(
        children: [
          _TeaFeedHeader(
            topPadding: topPad,
            tab: _tab,
            loading: _sectionLoading,
            lastRefresh: lastTeaRefreshAt,
            onBack: _goBack,
            onSelectSection: (s) => unawaited(_loadSection(s)),
            onRefresh: () => unawaited(_loadSection(_tab, force: true)),
            onOpenEvents: () {
              final id = teaEventTopics.isNotEmpty ? teaEventTopics.first.eventId : '';
              if (id.isNotEmpty) unawaited(_openEventDetail(id));
            },
          ),
          if (_sectionError != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Text(
                _sectionError!,
                style: TextStyle(color: Colors.white.withValues(alpha: 0.7), fontSize: 12),
              ),
            ),
          Expanded(
            child: _sectionLoading && items.isEmpty
                ? const Center(child: CircularProgressIndicator(color: HubColors.accent))
                : items.isEmpty
                ? _TeaEmptyState(onBack: _goBack)
                : PageView.builder(
                    key: ValueKey(_tab),
                    controller: _pageController,
                    scrollDirection: Axis.vertical,
                    pageSnapping: true,
                    onPageChanged: _onPageChanged,
                    itemCount: items.length,
                    itemBuilder: (context, index) {
                      if (index == 0) {
                        WidgetsBinding.instance.addPostFrameCallback((_) => _onPageChanged(0));
                      }
                      final item = items[index];
                      return _TeaSlide(
                        key: ValueKey('${item.id}|${item.thumbnail}|${teaHeroImageUrl(item) ?? ''}'),
                        item: item,
                        index: index,
                        liked: _liked.contains(item.id),
                        watchlisted: _watchlisted.contains(item.id),
                        onToggleLike: () => _toggleLike(item.id),
                        onOpenComments: () => _openComments(item),
                        onToggleWatchlist: () => _toggleWatchlist(item),
                        onOpenShare: () => _openShareSuggestions(item),
                        onOpenContext: () => unawaited(_openTopicContext(item)),
                        onOpenEvent: item.eventId.isNotEmpty
                            ? () => unawaited(_openEventDetail(item.eventId))
                            : null,
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

class _TeaFeedHeader extends StatelessWidget {
  const _TeaFeedHeader({
    required this.topPadding,
    required this.tab,
    required this.loading,
    required this.lastRefresh,
    required this.onBack,
    required this.onSelectSection,
    required this.onRefresh,
    required this.onOpenEvents,
  });

  final double topPadding;
  final TeaFeedSection tab;
  final bool loading;
  final DateTime? lastRefresh;
  final VoidCallback onBack;
  final ValueChanged<TeaFeedSection> onSelectSection;
  final VoidCallback onRefresh;
  final VoidCallback onOpenEvents;

  @override
  Widget build(BuildContext context) {
    final refreshLabel = lastRefresh == null
        ? ''
        : 'Updated ${_fmtAgo(lastRefresh!)}';
    return Container(
      padding: EdgeInsets.fromLTRB(8, topPadding + 4, 8, 10),
      decoration: const BoxDecoration(
        color: Color(0xB80A080E),
        border: Border(bottom: BorderSide(color: _hubDivider)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              IconButton(
                onPressed: onBack,
                icon: const Icon(Icons.arrow_back, color: Colors.white, size: 24),
                style: IconButton.styleFrom(
                  minimumSize: const Size(40, 40),
                  shape: const CircleBorder(),
                ),
              ),
              const Expanded(
                child: Text(
                  'Tea',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.3,
                  ),
                ),
              ),
              IconButton(
                onPressed: onOpenEvents,
                tooltip: 'Open featured event',
                icon: const Icon(Icons.campaign_outlined, color: Colors.white70, size: 22),
              ),
              IconButton(
                onPressed: loading ? null : onRefresh,
                tooltip: 'Refresh',
                icon: loading
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2, color: HubColors.accent),
                      )
                    : const Icon(Icons.refresh, color: Colors.white70, size: 22),
              ),
            ],
          ),
          SizedBox(
            height: 36,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: [
                for (final s in TeaFeedSection.values) ...[
                  _TabChip(
                    label: s.label,
                    selected: tab == s,
                    onTap: () => onSelectSection(s),
                  ),
                  const SizedBox(width: 6),
                ],
              ],
            ),
          ),
          if (refreshLabel.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 6, left: 8),
              child: Text(
                refreshLabel,
                style: TextStyle(color: Colors.white.withValues(alpha: 0.45), fontSize: 11),
              ),
            ),
        ],
      ),
    );
  }

  static String _fmtAgo(DateTime t) {
    final d = DateTime.now().difference(t);
    if (d.inMinutes < 1) return 'just now';
    if (d.inMinutes < 60) return '${d.inMinutes}m ago';
    if (d.inHours < 24) return '${d.inHours}h ago';
    return '${d.inDays}d ago';
  }
}

class _TabChip extends StatelessWidget {
  const _TabChip({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? _hubPillBg : Colors.transparent,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          child: Text(
            label,
            style: TextStyle(
              color: selected ? HubColors.accent : _hubMuted,
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ),
    );
  }
}

class _TeaEmptyState extends StatelessWidget {
  const _TeaEmptyState({required this.onBack});

  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text(
              'No tea stories to show yet. Pull to refresh the dashboard and try again.',
              textAlign: TextAlign.center,
              style: TextStyle(color: _hubMuted, fontSize: 16, fontWeight: FontWeight.w500),
            ),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: onBack,
              style: FilledButton.styleFrom(
                backgroundColor: HubColors.accent.withValues(alpha: 0.35),
                foregroundColor: Colors.white,
                side: const BorderSide(color: _hubDivider),
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
              ),
              child: const Text('Go back', style: TextStyle(fontWeight: FontWeight.w600)),
            ),
          ],
        ),
      ),
    );
  }
}

List<String> _teaImageFallbackIds(TeaItem item) => [
      item.id,
      hubCarouselImageCacheKey(item.url, item.id),
      hubCarouselImageCacheKey(item.url, item.title),
      if (item.title.trim().isNotEmpty) hubCarouselImageCacheKey('', item.title),
    ];

class _TeaHeroBackground extends StatefulWidget {
  const _TeaHeroBackground({
    required this.item,
    required this.index,
    this.onTap,
  });

  final TeaItem item;
  final int index;
  final VoidCallback? onTap;

  @override
  State<_TeaHeroBackground> createState() => _TeaHeroBackgroundState();
}

class _TeaHeroBackgroundState extends State<_TeaHeroBackground> {
  String? _resolvedUrl;
  final Set<String> _failedUrls = {};
  int _resolveGen = 0;

  @override
  void initState() {
    super.initState();
    _resolvedUrl = _bestCandidate();
    unawaited(_resolveHeroImage());
  }

  @override
  void didUpdateWidget(covariant _TeaHeroBackground oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.item.id != widget.item.id ||
        oldWidget.item.thumbnail != widget.item.thumbnail ||
        oldWidget.item.url != widget.item.url) {
      _failedUrls.clear();
      _resolvedUrl = _bestCandidate();
      unawaited(_resolveHeroImage());
    }
  }

  String? _bestCandidate() {
    for (final candidate in _candidateUrls(includeResolved: true)) {
      if (candidate != null &&
          isValidHubCarouselImageUrl(candidate) &&
          !_failedUrls.contains(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  List<String?> _candidateUrls({bool includeResolved = true}) => [
        teaHeroImageUrl(widget.item),
        if (includeResolved) _resolvedUrl,
        youtubeTeaThumbnailFromUrl(widget.item.url),
      ];

  void _onImageFailed(String failedUrl) {
    if (!_failedUrls.add(failedUrl)) return;
    if (!mounted) return;
    setState(() {
      if (_resolvedUrl == failedUrl) _resolvedUrl = null;
    });
    unawaited(_resolveHeroImage());
  }

  Future<void> _resolveHeroImage() async {
    final token = ++_resolveGen;
    final item = widget.item;

    final immediate = _bestCandidate();
    if (immediate != null) {
      if (mounted && token == _resolveGen) setState(() => _resolvedUrl = immediate);
      return;
    }

    for (final fallbackId in _teaImageFallbackIds(item)) {
      final cached = await resolveHubCarouselImageFast(
        url: item.url,
        title: item.title,
        fallbackId: fallbackId,
        kind: HubCarouselImageKind.tea,
      );
      if (cached != null &&
          isValidHubCarouselImageUrl(cached) &&
          !_failedUrls.contains(cached)) {
        if (mounted && token == _resolveGen) setState(() => _resolvedUrl = cached);
        return;
      }
    }

  }

  @override
  Widget build(BuildContext context) {
    final heroUrl = _bestCandidate();
    return Stack(
      fit: StackFit.expand,
      children: [
        Positioned.fill(child: _FallbackHero(index: widget.index)),
        if (heroUrl != null)
          Positioned.fill(
            child: GestureDetector(
              onTap: widget.onTap,
              child: _TeaHeroImage(
                imageUrl: heroUrl,
                onFailed: () => _onImageFailed(heroUrl),
                errorWidget: _FallbackHero(index: widget.index),
              ),
            ),
          ),
      ],
    );
  }
}

class _TeaHeroImage extends StatefulWidget {
  const _TeaHeroImage({
    required this.imageUrl,
    required this.onFailed,
    required this.errorWidget,
  });

  final String imageUrl;
  final VoidCallback onFailed;
  final Widget errorWidget;

  @override
  State<_TeaHeroImage> createState() => _TeaHeroImageState();
}

class _TeaHeroImageState extends State<_TeaHeroImage> {
  var _failed = false;

  @override
  void didUpdateWidget(covariant _TeaHeroImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.imageUrl != widget.imageUrl) {
      _failed = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_failed) return widget.errorWidget;

    final url = widget.imageUrl.trim();
    if (!isHubCarouselDisplayImage(url)) return widget.errorWidget;

    if (url.startsWith('data:image')) {
      final bytes = decodeDataImageUrlBytes(url, logTag: '[TeaFeed]');
      if (bytes != null) {
        return Image.memory(bytes, fit: BoxFit.cover);
      }
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && !_failed) {
          setState(() => _failed = true);
          widget.onFailed();
        }
      });
      return widget.errorWidget;
    }

    return Image.network(
      url,
      fit: BoxFit.cover,
      gaplessPlayback: true,
      errorBuilder: (_, __, ___) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted && !_failed) {
            setState(() => _failed = true);
            widget.onFailed();
          }
        });
        return widget.errorWidget;
      },
    );
  }
}

class _TeaSlide extends StatelessWidget {
  const _TeaSlide({
    super.key,
    required this.item,
    required this.index,
    required this.liked,
    required this.watchlisted,
    required this.onToggleLike,
    required this.onOpenComments,
    required this.onToggleWatchlist,
    required this.onOpenShare,
    required this.onOpenContext,
    this.onOpenEvent,
  });

  final TeaItem item;
  final int index;
  final bool liked;
  final bool watchlisted;
  final VoidCallback onToggleLike;
  final VoidCallback onOpenComments;
  final VoidCallback onToggleWatchlist;
  final VoidCallback onOpenShare;
  final VoidCallback onOpenContext;
  final VoidCallback? onOpenEvent;

  @override
  Widget build(BuildContext context) {
    final bottomPad = MediaQuery.paddingOf(context).bottom;

    return Stack(
      fit: StackFit.expand,
      children: [
        // Tap hero → topic context. Share icon opens platform picker (LinkedIn/X/IG).
        _TeaHeroBackground(item: item, index: index, onTap: onOpenContext),
        IgnorePointer(
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.bottomCenter,
                end: const Alignment(0, -0.28),
                colors: [
                  Colors.black.withValues(alpha: 0.94),
                  Colors.black.withValues(alpha: 0.35),
                  Colors.transparent,
                ],
                stops: const [0.0, 0.45, 0.72],
              ),
            ),
          ),
        ),
        Positioned(
          right: 12,
          bottom: 80 + bottomPad,
          child: Column(
            children: [
              _ActionButton(
                icon: liked ? Icons.favorite : Icons.favorite_border,
                iconColor: liked ? const Color(0xE6EF4444) : Colors.white,
                filled: liked,
                onPressed: onToggleLike,
                semanticLabel: liked ? 'Unlike' : 'Like',
              ),
              const SizedBox(height: 20),
              _ActionButton(
                icon: Icons.chat_bubble_outline,
                onPressed: item.url.isEmpty ? null : onOpenComments,
                semanticLabel: item.numComments > 0 ? 'Comments, ${item.numComments} total' : 'Comments',
              ),
              const SizedBox(height: 20),
              _ActionButton(
                icon: watchlisted ? Icons.bookmark : Icons.bookmark_border,
                iconColor: watchlisted ? HubColors.accentHighlight : Colors.white,
                filled: watchlisted,
                onPressed: item.url.isEmpty ? null : onToggleWatchlist,
                semanticLabel: watchlisted ? 'Remove from watchlist' : 'Save to watchlist',
              ),
              const SizedBox(height: 20),
              _ActionButton(
                icon: Icons.ios_share_rounded,
                onPressed: item.url.isEmpty ? null : onOpenShare,
                semanticLabel: 'Share to LinkedIn, X, or Reddit',
              ),
              const SizedBox(height: 20),
              _ActionButton(
                icon: Icons.info_outline_rounded,
                onPressed: onOpenContext,
                semanticLabel: 'View topic context and sources',
              ),
            ],
          ),
        ),
        Positioned(
          left: 16,
          right: 80,
          bottom: 20 + bottomPad,
          child: GestureDetector(
            onTap: onOpenContext,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                      decoration: BoxDecoration(
                        color: _hubPillBg,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: HubColors.accent.withValues(alpha: 0.35)),
                      ),
                      child: Text(
                        _teaLaneLabel(item),
                        style: const TextStyle(
                          color: HubColors.accent,
                          fontSize: 12,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 0.6,
                        ),
                      ),
                    ),
                    if (item.isBreaking)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: Colors.red.withValues(alpha: 0.25),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: const Text(
                          'BREAKING',
                          style: TextStyle(
                            color: Color(0xFFFF8A80),
                            fontSize: 11,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    if (item.eventId.isNotEmpty)
                      GestureDetector(
                        onTap: onOpenEvent,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: HubColors.accent.withValues(alpha: 0.22),
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(color: HubColors.accent.withValues(alpha: 0.45)),
                          ),
                          child: const Text(
                            'EVENT',
                            style: TextStyle(
                              color: HubColors.accentHighlight,
                              fontSize: 11,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ),
                    if (item.contextLevel == 'headlineOnly' ||
                        (item.gossip.isEmpty && item.contextSummary.isEmpty))
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(
                          'Limited context',
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.85),
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  item.title,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 24,
                    fontWeight: FontWeight.w800,
                    height: 1.2,
                    letterSpacing: -0.4,
                    shadows: [Shadow(color: Colors.black54, blurRadius: 8)],
                  ),
                ),
                if (item.author.isNotEmpty && item.author != 'unknown') ...[
                  const SizedBox(height: 4),
                  Text(
                    item.author,
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.65),
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
                if (item.gossip.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(
                    item.gossip,
                    maxLines: 4,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.88),
                      fontSize: 15,
                      fontWeight: FontWeight.w500,
                      height: 1.35,
                      shadows: const [Shadow(color: Colors.black54, blurRadius: 6)],
                    ),
                  ),
                ],
                const SizedBox(height: 6),
                Text(
                  'Tap for sources & context',
                  style: TextStyle(
                    color: HubColors.accent.withValues(alpha: 0.9),
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _TeaTopicContextSheet extends StatefulWidget {
  const _TeaTopicContextSheet({
    required this.item,
    required this.onGeneratePost,
  });

  final TeaItem item;
  final VoidCallback onGeneratePost;

  @override
  State<_TeaTopicContextSheet> createState() => _TeaTopicContextSheetState();
}

class _TeaTopicContextSheetState extends State<_TeaTopicContextSheet> {
  TeaTopicContext? _ctx;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final ctx = await enrichTeaTopicContext({
        'title': widget.item.title,
        'url': widget.item.url,
        'gossip': widget.item.gossip,
        'description': widget.item.gossip,
        'source': widget.item.author,
        'image': widget.item.thumbnail,
        'contextLevel': widget.item.contextLevel,
        'contextSummary': widget.item.contextSummary,
      });
      if (!mounted) return;
      setState(() {
        _ctx = ctx;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not load context.';
        _loading = false;
      });
    }
  }

  Future<void> _openUrl(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.paddingOf(context).bottom;
    final ctx = _ctx;
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.62,
      minChildSize: 0.4,
      maxChildSize: 0.92,
      builder: (context, scrollController) {
        return Padding(
          padding: EdgeInsets.fromLTRB(20, 12, 20, 16 + bottom),
          child: ListView(
            controller: scrollController,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.white24,
                    borderRadius: BorderRadius.circular(99),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                widget.item.title,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  height: 1.25,
                ),
              ),
              const SizedBox(height: 8),
              if (_loading)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 24),
                  child: Center(child: CircularProgressIndicator(color: HubColors.accent)),
                )
              else if (_error != null)
                Text(_error!, style: const TextStyle(color: Colors.white70))
              else if (ctx != null) ...[
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: ctx.isLimited
                        ? Colors.orange.withValues(alpha: 0.18)
                        : HubColors.accent.withValues(alpha: 0.18),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    ctx.contextLevelLabel,
                    style: TextStyle(
                      color: ctx.isLimited ? Colors.orange.shade200 : HubColors.accent,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                if (ctx.publisher.isNotEmpty)
                  Text(
                    'Source: ${ctx.publisher}',
                    style: const TextStyle(color: Colors.white70, fontSize: 13),
                  ),
                const SizedBox(height: 12),
                Text(
                  'Context',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.9),
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  ctx.displaySummary.isNotEmpty
                      ? ctx.displaySummary
                      : 'Only the headline is available for this topic.',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.85),
                    fontSize: 14,
                    height: 1.4,
                  ),
                ),
                if (ctx.relatedSources.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  Text(
                    'Supporting sources',
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.9),
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 8),
                  ...ctx.relatedSources.take(5).map(
                        (s) => ListTile(
                          contentPadding: EdgeInsets.zero,
                          dense: true,
                          title: Text(
                            s.title,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: Colors.white, fontSize: 13),
                          ),
                          subtitle: Text(
                            s.publisher,
                            style: const TextStyle(color: Colors.white54, fontSize: 12),
                          ),
                          trailing: s.url.isEmpty
                              ? null
                              : IconButton(
                                  icon: const Icon(Icons.open_in_new, color: Colors.white54, size: 18),
                                  onPressed: () => unawaited(_openUrl(s.url)),
                                ),
                        ),
                      ),
                ],
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: widget.onGeneratePost,
                    style: FilledButton.styleFrom(
                      backgroundColor: HubColors.accent,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                    child: const Text('Generate personalized post'),
                  ),
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _TeaEventDetailSheet extends StatefulWidget {
  const _TeaEventDetailSheet({
    required this.eventId,
    required this.onGeneratePost,
  });

  final String eventId;
  final void Function(TeaStoryCluster cluster) onGeneratePost;

  @override
  State<_TeaEventDetailSheet> createState() => _TeaEventDetailSheetState();
}

class _TeaEventDetailSheetState extends State<_TeaEventDetailSheet> {
  TeaStoryCluster? _cluster;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final bundle = await fetchEventStoryBundle(widget.eventId);
      if (!mounted) return;
      setState(() {
        _cluster = bundle;
        _loading = false;
        if (bundle == null) {
          _error =
              'No accessible public coverage found yet for this event. Sources may be delayed or blocked.';
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Failed to load event coverage.';
      });
    }
  }

  Future<void> _openUrl(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.paddingOf(context).bottom;
    final topic = teaEventTopicById(widget.eventId);
    final c = _cluster;
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.78,
      minChildSize: 0.45,
      maxChildSize: 0.95,
      builder: (context, scrollController) {
        return Padding(
          padding: EdgeInsets.fromLTRB(20, 12, 20, 16 + bottom),
          child: ListView(
            controller: scrollController,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.white24,
                    borderRadius: BorderRadius.circular(99),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              Text(
                topic?.label ?? 'Event',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              if (_loading)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 32),
                  child: Center(child: CircularProgressIndicator(color: HubColors.accent)),
                )
              else if (_error != null)
                Text(_error!, style: const TextStyle(color: Colors.white70))
              else if (c != null) ...[
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: HubColors.accent.withValues(alpha: 0.18),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    '${c.relatedSources.length} sources · ${c.contextLevel} · '
                    '${c.isDeveloping ? 'Developing' : 'Update'}',
                    style: const TextStyle(
                      color: HubColors.accent,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                const Text(
                  'Summary',
                  style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 6),
                Text(
                  c.summary.isNotEmpty
                      ? c.summary
                      : 'Coverage is still gathering from accessible sources.',
                  style: TextStyle(color: Colors.white.withValues(alpha: 0.85), height: 1.4),
                ),
                if (c.verifiedFacts.isNotEmpty) ...[
                  const SizedBox(height: 14),
                  const Text(
                    'Supported points',
                    style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 6),
                  ...c.verifiedFacts.map(
                    (f) => Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Text('• $f', style: const TextStyle(color: Colors.white70, fontSize: 13)),
                    ),
                  ),
                ],
                if (c.unverifiedClaims.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  const Text(
                    'Unresolved / single-source',
                    style: TextStyle(color: Colors.orangeAccent, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 6),
                  ...c.unverifiedClaims.map(
                    (f) => Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Text('• $f', style: const TextStyle(color: Colors.white60, fontSize: 13)),
                    ),
                  ),
                ],
                const SizedBox(height: 14),
                const Text(
                  'Timeline & related coverage',
                  style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 8),
                ...c.relatedSources.take(12).map(
                      (s) => ListTile(
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                        title: Text(
                          s['title'] ?? '',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: Colors.white, fontSize: 13),
                        ),
                        subtitle: Text(
                          '${s['publisher'] ?? ''} · ${s['sourceType'] ?? 'news'}',
                          style: const TextStyle(color: Colors.white54, fontSize: 11),
                        ),
                        trailing: IconButton(
                          icon: const Icon(Icons.open_in_new, color: Colors.white54, size: 18),
                          onPressed: () => unawaited(_openUrl(s['url'] ?? '')),
                        ),
                      ),
                    ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: () => widget.onGeneratePost(c),
                    style: FilledButton.styleFrom(
                      backgroundColor: HubColors.accent,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                    child: const Text('Generate personalized post'),
                  ),
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _FallbackHero extends StatelessWidget {
  const _FallbackHero({required this.index});

  final int index;

  @override
  Widget build(BuildContext context) {
    final colors = _fallbackGradients[index % _fallbackGradients.length];
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: colors,
        ),
      ),
      alignment: Alignment.center,
      child: const Text('☕', style: TextStyle(fontSize: 56), textAlign: TextAlign.center),
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({
    required this.icon,
    required this.onPressed,
    required this.semanticLabel,
    this.iconColor = Colors.white,
    this.filled = false,
  });

  final IconData icon;
  final VoidCallback? onPressed;
  final String semanticLabel;
  final Color iconColor;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: semanticLabel,
      child: Material(
        color: Colors.white.withValues(alpha: 0.1),
        shape: const CircleBorder(side: BorderSide(color: Color(0x1AFFFFFF))),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onPressed,
          customBorder: const CircleBorder(),
          child: SizedBox(
            width: 48,
            height: 48,
            child: Icon(
              icon,
              color: iconColor,
              size: 26,
              fill: filled ? 1.0 : 0.0,
            ),
          ),
        ),
      ),
    );
  }
}

class _TeaCommentsSheet extends StatefulWidget {
  const _TeaCommentsSheet({
    required this.item,
    required this.initialEntry,
    required this.onCacheUpdate,
  });

  final TeaItem item;
  final _CommentEntry? initialEntry;
  final ValueChanged<_CommentEntry> onCacheUpdate;

  @override
  State<_TeaCommentsSheet> createState() => _TeaCommentsSheetState();
}

class _TeaCommentsSheetState extends State<_TeaCommentsSheet> {
  final _draftController = TextEditingController();
  final Map<String, bool> _likedComments = {};
  late _CommentEntry _entry;

  @override
  void initState() {
    super.initState();
    _entry = widget.initialEntry ?? _CommentEntry();
    _loadCommentsIfNeeded();
  }

  @override
  void dispose() {
    _draftController.dispose();
    super.dispose();
  }

  void _loadCommentsIfNeeded() {
    if (_entry.status == 'loading' || _entry.status == 'loaded') return;
    setState(() => _entry = _CommentEntry(status: 'loading'));
    widget.onCacheUpdate(_entry);
    fetchTeaThreadComments(widget.item.url).then((res) {
      if (!mounted) return;
      setState(() {
        if (res.ok) {
          _entry = _CommentEntry(status: 'loaded', comments: res.comments);
        } else {
          _entry = _CommentEntry(status: 'error', error: res.error ?? 'Failed');
        }
        widget.onCacheUpdate(_entry);
      });
    });
  }

  List<RedditComment> _textOnlyComments(List<RedditComment> comments) {
    return comments.where((c) {
      if (c.body.trim().isEmpty) return false;
      if (commentBodyHasLinkLikeContent(c.body)) return false;
      return compactCommentBody(c.body).trim().isNotEmpty;
    }).toList();
  }

  Future<void> _openReddit() async {
    final uri = Uri.tryParse(widget.item.url);
    if (uri == null) return;
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final status = _entry.status;
    final allComments = _entry.comments;
    final textOnly = _textOnlyComments(allComments);
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.58,
      minChildSize: 0.32,
      maxChildSize: 0.92,
      snap: true,
      snapSizes: const [0.32, 0.58, 0.92],
      builder: (context, scrollController) {
        return Padding(
          padding: EdgeInsets.only(bottom: bottomInset),
          child: Column(
            children: [
              const SizedBox(height: 8),
              Container(
                width: 44,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.28),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 10),
              const Text(
                'Comments',
                style: TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 8),
              const Divider(height: 1, color: _hubDivider),
              Expanded(
                child: _buildCommentBody(status, allComments, textOnly, scrollController),
              ),
              _CommentsComposer(
                controller: _draftController,
                onEmoji: (e) {
                  _draftController.text = '${_draftController.text}$e';
                  _draftController.selection = TextSelection.collapsed(offset: _draftController.text.length);
                },
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildCommentBody(
    String status,
    List<RedditComment> allComments,
    List<RedditComment> textOnly,
    ScrollController scrollController,
  ) {
    if (status == 'loading' || status == 'idle') {
      return const Center(
        child: Text('Loading comments…', style: TextStyle(color: _hubMuted, fontSize: 14, fontWeight: FontWeight.w500)),
      );
    }
    if (status == 'error') {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Couldn’t load comments.',
                style: TextStyle(color: _hubMuted, fontSize: 14, fontWeight: FontWeight.w500),
              ),
              if (widget.item.url.isNotEmpty) ...[
                const SizedBox(height: 12),
                TextButton(
                  onPressed: _openReddit,
                  child: const Text(
                    'View on Reddit',
                    style: TextStyle(color: HubColors.accent, fontWeight: FontWeight.w700, decoration: TextDecoration.underline),
                  ),
                ),
              ],
            ],
          ),
        ),
      );
    }
    if (allComments.isEmpty) {
      return const Center(
        child: Text('No comments to show.', style: TextStyle(color: _hubMuted, fontSize: 14, fontWeight: FontWeight.w500)),
      );
    }
    if (textOnly.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'No plain-text comments to show here. Open Reddit for the full thread.',
                textAlign: TextAlign.center,
                style: TextStyle(color: _hubMuted, fontSize: 14, fontWeight: FontWeight.w500),
              ),
              if (widget.item.url.isNotEmpty) ...[
                const SizedBox(height: 12),
                TextButton(
                  onPressed: _openReddit,
                  child: const Text(
                    'View on Reddit',
                    style: TextStyle(color: HubColors.accent, fontWeight: FontWeight.w700),
                  ),
                ),
              ],
            ],
          ),
        ),
      );
    }

    return ListView.separated(
      controller: scrollController,
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
      itemCount: textOnly.length + 1,
      separatorBuilder: (_, __) => const Divider(height: 1, color: Color(0x12FFFFFF)),
      itemBuilder: (context, i) {
        if (i == textOnly.length) {
          return const Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: Text(
              'View replies on Reddit',
              textAlign: TextAlign.center,
              style: TextStyle(color: Color(0x47FFFFFF), fontSize: 11, fontWeight: FontWeight.w500),
            ),
          );
        }
        final c = textOnly[i];
        return _TeaCommentRow(
          comment: c,
          liked: _likedComments[c.id] ?? false,
          onToggleLike: () => setState(() => _likedComments[c.id] = !(_likedComments[c.id] ?? false)),
        );
      },
    );
  }
}

class _TeaCommentRow extends StatelessWidget {
  const _TeaCommentRow({
    required this.comment,
    required this.liked,
    required this.onToggleLike,
  });

  final RedditComment comment;
  final bool liked;
  final VoidCallback onToggleLike;

  @override
  Widget build(BuildContext context) {
    final label = _formatTeaUsername(comment.author);
    final when = _shortRelativeTime(comment.createdUtc);
    final score = comment.score;
    final scoreLabel = score > 999 ? '${(score / 1000).toStringAsFixed(1)}k' : '$score';

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            radius: 18,
            backgroundColor: Colors.white.withValues(alpha: 0.07),
            child: Text(
              _avatarInitials(comment.author),
              style: const TextStyle(color: Color(0xA6FFFFFF), fontSize: 11, fontWeight: FontWeight.w700),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(label, style: const TextStyle(color: Color(0x6BFFFFFF), fontSize: 12, fontWeight: FontWeight.w500)),
                    if (when.isNotEmpty) ...[
                      const Text(' · ', style: TextStyle(color: Color(0x38FFFFFF), fontSize: 11)),
                      Text(when, style: const TextStyle(color: Color(0x4DFFFFFF), fontSize: 10, fontWeight: FontWeight.w500)),
                    ],
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  compactCommentBody(comment.body),
                  style: const TextStyle(color: Color(0xF5F1F5F9), fontSize: 15, height: 1.45),
                ),
                const SizedBox(height: 8),
                Text(
                  'Reply',
                  style: TextStyle(color: Colors.white.withValues(alpha: 0.32), fontSize: 12, fontWeight: FontWeight.w600),
                ),
              ],
            ),
          ),
          Column(
            children: [
              IconButton(
                onPressed: onToggleLike,
                icon: Icon(
                  liked ? Icons.favorite : Icons.favorite_border,
                  size: 18,
                  color: liked ? const Color(0xE0F43F5E) : const Color(0x61FFFFFF),
                ),
              ),
              Text(scoreLabel, style: const TextStyle(color: Color(0x59FFFFFF), fontSize: 10, fontWeight: FontWeight.w600)),
            ],
          ),
        ],
      ),
    );
  }
}

class _CommentsComposer extends StatefulWidget {
  const _CommentsComposer({required this.controller, required this.onEmoji});

  final TextEditingController controller;
  final ValueChanged<String> onEmoji;

  @override
  State<_CommentsComposer> createState() => _CommentsComposerState();
}

class _CommentsComposerState extends State<_CommentsComposer> {
  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onDraftChanged);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onDraftChanged);
    super.dispose();
  }

  void _onDraftChanged() => setState(() {});

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.paddingOf(context).bottom;
    final canPost = widget.controller.text.trim().isNotEmpty;
    return Container(
      decoration: const BoxDecoration(
        color: Color(0xFF090909),
        border: Border(top: BorderSide(color: _hubDivider)),
      ),
      padding: EdgeInsets.fromLTRB(12, 8, 12, bottom > 0 ? bottom : 10),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            height: 40,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _quickEmojis.length,
              separatorBuilder: (_, __) => const SizedBox(width: 6),
              itemBuilder: (_, i) {
                final emo = _quickEmojis[i];
                return Material(
                  color: Colors.white.withValues(alpha: 0.05),
                  shape: const CircleBorder(side: BorderSide(color: Color(0x1AFFFFFF))),
                  child: InkWell(
                    onTap: () => widget.onEmoji(emo),
                    customBorder: const CircleBorder(),
                    child: SizedBox(width: 36, height: 36, child: Center(child: Text(emo, style: const TextStyle(fontSize: 18)))),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 8),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: TextField(
                  controller: widget.controller,
                  style: const TextStyle(color: Colors.white, fontSize: 15),
                  decoration: InputDecoration(
                    hintText: 'Add a comment…',
                    hintStyle: TextStyle(color: Colors.white.withValues(alpha: 0.35)),
                    filled: true,
                    fillColor: Colors.white.withValues(alpha: 0.06),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(16),
                      borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.12)),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(16),
                      borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.12)),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(16),
                      borderSide: BorderSide(color: HubColors.accent.withValues(alpha: 0.45)),
                    ),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  ),
                  maxLines: 3,
                  minLines: 1,
                ),
              ),
              const SizedBox(width: 8),
              FilledButton(
                onPressed: canPost ? () {} : null,
                style: FilledButton.styleFrom(
                  backgroundColor: HubColors.accent.withValues(alpha: 0.9),
                  disabledBackgroundColor: HubColors.accent.withValues(alpha: 0.35),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                ),
                child: const Text('Post', style: TextStyle(fontWeight: FontWeight.w800)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

String _formatTeaUsername(String raw) {
  var s = raw.trim();
  if (s.isEmpty || s == '[deleted]') return 'unknown';
  s = s.replaceFirst(RegExp(r'^u/', caseSensitive: false), '');
  s = s.replaceAll(RegExp(r'-(\d{2,})$', caseSensitive: false), '');
  s = s.replaceAll(RegExp(r'_(\d{2,})$', caseSensitive: false), '');
  s = s.replaceAll('-', '');
  if (s.length <= _usernameMax) return s;
  return '${s.substring(0, _usernameMax - 1)}…';
}

String _avatarInitials(String name) {
  final t = _formatTeaUsername(name).replaceAll(RegExp(r'[^a-zA-Z0-9]'), ' ');
  final parts = t.split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  final single = parts.isNotEmpty ? parts[0] : '?';
  return single.length >= 2 ? single.substring(0, 2).toUpperCase() : single.toUpperCase();
}

String _shortRelativeTime(double? createdUtc) {
  if (createdUtc == null || !createdUtc.isFinite) return '';
  final sec = (DateTime.now().millisecondsSinceEpoch / 1000 - createdUtc).clamp(0, double.infinity);
  if (sec < 60) return 'now';
  if (sec < 3600) return '${(sec / 60).floor()}m';
  if (sec < 86400) return '${(sec / 3600).floor()}h';
  if (sec < 86400 * 7) return '${(sec / 86400).floor()}d';
  return '${(sec / (86400 * 30)).floor()}mo';
}
