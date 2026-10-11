import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../router/app_router.dart';
import '../services/cached_news_service.dart';
import '../services/reddit_tea_service.dart';
import '../services/youtube_tea_service.dart';
import '../lib/hub_trending_algorithms.dart';
import '../lib/reddit_post_filter.dart';
import '../utils/hub_carousel_ai_image.dart';
import '../utils/hub_carousel_image_store.dart';
import '../utils/hub_colors.dart';
import '../utils/reddit_thread_comments.dart';
import '../utils/share_news_cache.dart';
import '../services/tea_news_refresh_mode.dart';
import '../utils/tea_content_extraction.dart';
import '../utils/tea_topic_context.dart';
import '../utils/tea_trending_storage.dart';
import 'hub_section_refresh_pill.dart';
import 'skeleton/card_skeleton.dart';

const _teaItemsCacheKey = 'deite_tea_items_cache_v5';
const _teaCacheMaxAge = Duration(hours: 6);

List<TeaItem> _filterExcludedTeaItems(List<TeaItem> items) {
  return items.where((t) => !titleHasExcludedKeyword(t.title)).toList();
}

List<TeaItem>? _memoryTeaCache;
DateTime? _memoryTeaCacheAt;
List<TeaItem>? _teaFeedLaunchHandoff;

/// Full in-memory items for Tea feed (keeps AI/data-URL thumbnails out of router extra).
void stashTeaFeedLaunchItems(List<TeaItem> items) {
  _teaFeedLaunchHandoff = teaItemsWithResolvedHeroes(items);
}

List<TeaItem>? takeTeaFeedLaunchItems() {
  final handoff = _teaFeedLaunchHandoff;
  _teaFeedLaunchHandoff = null;
  return handoff == null ? null : List<TeaItem>.from(handoff);
}

/// Carousel cards can show images from memory cache while [TeaItem.thumbnail] is still empty.
List<TeaItem> teaItemsWithResolvedHeroes(Iterable<TeaItem> items) {
  return items.map((item) {
    final hero = teaHeroImageUrl(item);
    if (hero == null || hero == item.thumbnail) return item;
    return item.copyWith(thumbnail: hero);
  }).toList();
}

List<TeaItem>? get memoryTeaCacheSnapshot =>
    _memoryTeaCache == null ? null : List<TeaItem>.from(_memoryTeaCache!);

class TeaItem {
  TeaItem({
    required this.id,
    required this.title,
    required this.url,
    this.postUrl = '',
    this.thumbnail = '',
    this.gossip = '',
    this.author = 'unknown',
    this.score = 0,
    this.numComments = 0,
    this.contextLevel = '',
    this.contextSummary = '',
    this.eventId = '',
    this.isBreaking = false,
  });

  final String id;
  final String title;
  final String url;
  final String postUrl;
  final String thumbnail;
  final String gossip;
  final String author;
  final int score;
  final int numComments;
  final String contextLevel;
  final String contextSummary;
  final String eventId;
  final bool isBreaking;

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'url': url,
        'postUrl': postUrl,
        'thumbnail': thumbnail,
        'gossip': gossip,
        'author': author,
        'score': score,
        'num_comments': numComments,
        if (contextLevel.isNotEmpty) 'contextLevel': contextLevel,
        if (contextSummary.isNotEmpty) 'contextSummary': contextSummary,
        if (eventId.isNotEmpty) 'eventId': eventId,
        if (isBreaking) 'isBreaking': isBreaking,
      };

  TeaItem copyWith({
    String? thumbnail,
    String? gossip,
    String? contextLevel,
    String? contextSummary,
    String? eventId,
    bool? isBreaking,
  }) {
    return TeaItem(
      id: id,
      title: title,
      url: url,
      postUrl: postUrl,
      thumbnail: thumbnail ?? this.thumbnail,
      gossip: gossip ?? this.gossip,
      author: author,
      score: score,
      numComments: numComments,
      contextLevel: contextLevel ?? this.contextLevel,
      contextSummary: contextSummary ?? this.contextSummary,
      eventId: eventId ?? this.eventId,
      isBreaking: isBreaking ?? this.isBreaking,
    );
  }
}

bool _isDirectImageUrl(String? postUrl) {
  if (postUrl == null || postUrl.trim().isEmpty) return false;
  final path = postUrl.trim().split('?').first.split('#').first;
  return RegExp(r'\.(jpe?g|png|gif|webp)$', caseSensitive: false).hasMatch(path);
}

TeaItem _rowToTeaItem(Map<String, dynamic> row) {
  final url = row['url'] is String ? row['url'] as String : '';
  final title = row['title'] is String ? row['title'] as String : '';
  // Never show feed markup / Google News link junk on cards.
  final gossip = cleanFeedSnippetForDisplay(
    '${row['gossip'] ?? row['bodyText'] ?? row['selftext'] ?? row['description'] ?? ''}',
    title: title,
  );
  var thumbnail = '${row['image'] ?? row['thumbnail'] ?? ''}'.replaceAll('&amp;', '&');
  if (!isValidHubCarouselImageUrl(thumbnail)) {
    final yt = youtubeTeaThumbnailFromUrl(url);
    if (yt != null) thumbnail = yt;
  }
  final ctx = peekTeaTopicContext(url, title);
  final contextSummary = cleanFeedSnippetForDisplay(
    '${row['contextSummary'] ?? ctx?.contextSummary ?? ''}',
    title: title,
  );
  final displayGossip = gossip.isNotEmpty
      ? gossip
      : (contextSummary.isNotEmpty &&
              '${row['contextLevel'] ?? ctx?.contextLevel.name ?? ''}' != 'headlineOnly'
          ? contextSummary
          : '');
  return TeaItem(
    id: url.isNotEmpty ? hubNewsDocIdFromUrl(url) : title.hashCode.toString(),
    title: title,
    url: url,
    postUrl: url,
    thumbnail: thumbnail,
    gossip: displayGossip,
    author: row['author'] is String ? row['author'] as String : 'unknown',
    score: row['score'] is num ? (row['score'] as num).toInt() : 0,
    numComments: row['num_comments'] is num ? (row['num_comments'] as num).toInt() : 0,
    contextLevel: '${row['contextLevel'] ?? ctx?.contextLevel.name ?? ''}',
    contextSummary: contextSummary,
    eventId: '${row['eventId'] ?? ''}',
    isBreaking: row['isBreaking'] == true,
  );
}

Future<List<TeaItem>> _loadTeaFromDisk() async {
  try {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_teaItemsCacheKey);
    if (raw == null || raw.isEmpty) return [];
    final decoded = jsonDecode(raw);
    if (decoded is! Map) return [];
    final savedAt = DateTime.tryParse('${decoded['savedAt'] ?? ''}');
    if (savedAt == null || DateTime.now().difference(savedAt) > _teaCacheMaxAge) {
      return [];
    }
    final items = decoded['items'];
    if (items is! List) return [];
    return items
        .whereType<Map>()
        .map((m) {
          final title = '${m['title'] ?? ''}';
          final gossip = cleanFeedSnippetForDisplay(
            '${m['gossip'] ?? m['description'] ?? ''}',
            title: title,
          );
          return TeaItem(
            id: '${m['id'] ?? ''}',
            title: title,
            url: '${m['url'] ?? ''}',
            postUrl: '${m['postUrl'] ?? m['url'] ?? ''}',
            thumbnail: '${m['thumbnail'] ?? ''}',
            gossip: gossip,
            author: '${m['author'] ?? 'unknown'}',
            score: m['score'] is num ? (m['score'] as num).toInt() : 0,
            numComments: m['num_comments'] is num ? (m['num_comments'] as num).toInt() : 0,
            contextLevel: '${m['contextLevel'] ?? ''}',
            contextSummary: cleanFeedSnippetForDisplay(
              '${m['contextSummary'] ?? ''}',
              title: title,
            ),
          );
        })
        .where(
          (t) =>
              t.title.isNotEmpty &&
              t.url.isNotEmpty &&
              !titleHasExcludedKeyword(t.title),
        )
        .toList();
  } catch (_) {
    return [];
  }
}

Future<void> _saveTeaToDisk(List<TeaItem> items) async {
  try {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _teaItemsCacheKey,
      jsonEncode({
        'savedAt': DateTime.now().toIso8601String(),
        'items': items.map((e) => e.toJson()).toList(),
      }),
    );
  } catch (_) {}
}

/// Hydrate in-memory Tea cache from disk (call at app start / before Pod tab).
Future<void> warmTeaCacheFromDisk() async {
  if (_memoryTeaCache != null && _memoryTeaCache!.isNotEmpty) return;
  final cached = await _loadTeaFromDisk();
  if (cached.isEmpty) return;
  _memoryTeaCache = prioritizeWithImagesFirst(
    cached,
    teaHasDisplayableHeroImage,
  );
  _memoryTeaCacheAt = DateTime.now();
}

Future<void> refreshTrendingTeaInBackground() async {
  try {
    await fetchTrendingTea(allowCache: false, deferEnrich: true);
  } catch (_) {}
}

Future<List<TeaItem>> fetchTrendingTea({
  bool allowCache = true,
  bool deferEnrich = false,
}) async {
  if (allowCache &&
      _memoryTeaCache != null &&
      _memoryTeaCache!.isNotEmpty &&
      _memoryTeaCacheAt != null &&
      DateTime.now().difference(_memoryTeaCacheAt!) < _teaCacheMaxAge) {
    final filtered = _filterExcludedTeaItems(_memoryTeaCache!);
    if (filtered.length != _memoryTeaCache!.length) {
      _memoryTeaCache = filtered;
    }
    return List<TeaItem>.from(filtered);
  }

  final rows = await fetchTrendingTeaRows(deferEnrich: deferEnrich);
  if (rows.isEmpty) {
    throw Exception('Could not load tea. Check your connection.');
  }

  var items = prioritizeWithImagesFirst(
    rows
        .map(_rowToTeaItem)
        .where((t) => !titleHasExcludedKeyword(t.title))
        .toList(),
    teaHasDisplayableHeroImage,
  ).take(10).toList();
  items = await _hydrateTeaItemsFast(items);

  _memoryTeaCache = items;
  _memoryTeaCacheAt = DateTime.now();
  await writeTrendingTeaUrlsAndPruneShareCache(items.map((e) => e.url).toList());
  unawaited(_saveTeaToDisk(items));

  if (deferEnrich) {
    unawaited(_enrichTeaRowsInBackground(rows, items));
  }

  return items;
}

String? teaHeroImageUrl(TeaItem item) {
  if (_isDirectImageUrl(item.postUrl)) {
    final u = item.postUrl.trim();
    if (isValidHubCarouselImageUrl(u)) return u;
  }

  for (final key in [
    hubCarouselImageCacheKey(item.url, item.id),
    hubCarouselImageCacheKey(item.url, ''),
    if (item.title.trim().isNotEmpty) hubCarouselImageCacheKey('', item.title),
  ]) {
    if (key.isEmpty) continue;
    final mem = peekHubCarouselMemory(key);
    if (mem != null && isValidHubCarouselImageUrl(mem)) return mem;
  }

  final thumb = item.thumbnail.trim();
  if (thumb.startsWith('data:image') || thumb.contains('firebasestorage.googleapis.com')) {
    if (isValidHubCarouselImageUrl(thumb)) return thumb;
  }
  if (isReliableCarouselImageUrl(thumb)) return thumb;

  final yt = youtubeTeaThumbnailFromUrl(item.url);
  if (yt != null && isValidHubCarouselImageUrl(yt)) return yt;

  if (isValidHubCarouselImageUrl(thumb)) return thumb;
  return null;
}

/// Carousel initial URL — only pass images that actually load (matches News carousel).
String? teaCarouselInitialUrl(TeaItem item) {
  final hero = teaHeroImageUrl(item);
  if (hero == null) return null;
  if (isReliableCarouselImageUrl(hero)) return hero;
  return null;
}

/// Prefer persisted AI / Firebase heroes for Tea home cards (not RSS / YouTube fillers).
String? teaAiHeroInitialUrl(TeaItem item) {
  final hero = teaHeroImageUrl(item);
  if (hero == null) return null;
  final h = hero.trim();
  if (h.startsWith('data:image')) return h;
  if (h.contains('firebasestorage.googleapis.com')) return h;
  // Memory/disk AI cache often lands on item.thumbnail after resolve.
  for (final key in [
    hubCarouselImageCacheKey(item.url, item.id),
    hubCarouselImageCacheKey(item.url, ''),
    if (item.title.trim().isNotEmpty) hubCarouselImageCacheKey('', item.title),
  ]) {
    final mem = peekHubCarouselMemory(key);
    if (mem != null && isReliableCarouselImageUrl(mem)) return mem;
  }
  return null;
}

String teaCardHeadline(TeaItem item) => cleanTeaCardTitle(item.title);

bool teaHasDisplayableHeroImage(TeaItem item) {
  final hero = teaHeroImageUrl(item);
  if (hero == null) return false;
  return isReliableCarouselImageUrl(hero);
}

Future<List<TeaItem>> _hydrateTeaItemsFast(List<TeaItem> items) async {
  if (items.isEmpty) return items;
  final hydrated = await Future.wait(items.map((item) async {
    if (teaHasDisplayableHeroImage(item)) return item;

    final yt = youtubeTeaThumbnailFromUrl(item.url);
    if (yt != null) {
      return item.copyWith(thumbnail: yt);
    }

    final cached = await resolveCachedHubCarouselImage(
      url: item.url,
      title: item.title,
      fallbackId: item.id,
      kind: HubCarouselImageKind.tea,
    );
    if (cached != null) {
      return item.copyWith(thumbnail: cached);
    }
    return item;
  }));
  return prioritizeWithImagesFirst(hydrated, teaHasDisplayableHeroImage);
}

Future<void> _enrichTeaRowsInBackground(
  List<Map<String, dynamic>> rows,
  List<TeaItem> baseline,
) async {
  try {
    final enriched = await enrichTeaRows(rows, maxEnrich: 10);
    if (enriched.isEmpty) return;
    var items = prioritizeWithImagesFirst(
      enriched.map(_rowToTeaItem).toList(),
      teaHasDisplayableHeroImage,
    ).take(10).toList();
    items = await _hydrateTeaItemsFast(items);
    if (items.isEmpty) return;
    _memoryTeaCache = items;
    _memoryTeaCacheAt = DateTime.now();
    unawaited(_saveTeaToDisk(items));
    // Notify hub Tea carousel / feed to pick up enriched body text.
    teaNewsManualRefreshTick.value++;
  } catch (_) {}
}

/// Lightweight payload for Tea feed navigation (omit huge inline data URLs).
Map<String, dynamic> teaItemFeedPayload(TeaItem item) {
  final json = item.toJson();
  final thumb = '${json['thumbnail'] ?? ''}';
  if (thumb.startsWith('data:image')) {
    json.remove('thumbnail');
  }
  return json;
}

class TrendingTea extends StatefulWidget {
  const TrendingTea({super.key});

  @override
  State<TrendingTea> createState() => _TrendingTeaState();
}

class _TrendingTeaState extends State<TrendingTea> {
  List<TeaItem> _items = _memoryTeaCache ?? [];
  bool _loading = _memoryTeaCache == null || _memoryTeaCache!.isEmpty;
  bool _refreshing = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    teaNewsManualRefreshTick.addListener(_onManualRefreshTick);
    _load();
  }

  @override
  void dispose() {
    teaNewsManualRefreshTick.removeListener(_onManualRefreshTick);
    super.dispose();
  }

  void _onManualRefreshTick() {
    unawaited(_applyMemoryAfterManualRefresh());
  }

  Future<void> _applyMemoryAfterManualRefresh() async {
    final snap = memoryTeaCacheSnapshot;
    if (!mounted) return;
    if (snap != null && snap.isNotEmpty) {
      final hydrated = await _hydrateTeaItemsFast(snap);
      if (!mounted) return;
      setState(() {
        _items = hydrated;
        _loading = false;
        _error = null;
      });
      unawaited(_syncCachedAiImages());
      return;
    }
    setState(() {
      _loading = false;
        _error = kManualTeaNewsRefreshOnly
          ? 'No tea yet. Tap Refresh.'
          : 'Could not load tea.';
    });
  }

  @override
  void activate() {
    super.activate();
    if (_items.isEmpty && _memoryTeaCache != null && _memoryTeaCache!.isNotEmpty && mounted) {
      setState(() {
        _items = List<TeaItem>.from(_memoryTeaCache!);
        _loading = false;
      });
    }
    unawaited(_syncCachedAiImages());
  }

  Future<void> _load() async {
    if (_items.isEmpty && _memoryTeaCache != null && _memoryTeaCache!.isNotEmpty && mounted) {
      final filtered = _filterExcludedTeaItems(_memoryTeaCache!);
      _memoryTeaCache = filtered;
      setState(() {
        _items = List<TeaItem>.from(filtered);
        _loading = false;
        _error = null;
      });
      unawaited(_syncCachedAiImages());
      if (!kManualTeaNewsRefreshOnly) {
        unawaited(_refreshFromNetwork());
      }
      return;
    }

    if (_items.isNotEmpty && _memoryTeaCache != null && _memoryTeaCache!.isNotEmpty) {
      final filtered = _filterExcludedTeaItems(_items);
      if (filtered.length != _items.length && mounted) {
        setState(() => _items = filtered);
        _memoryTeaCache = filtered;
      }
      unawaited(_syncCachedAiImages());
      if (!kManualTeaNewsRefreshOnly) {
        unawaited(_refreshFromNetwork());
      }
      return;
    }

    final cached = await _loadTeaFromDisk();
    if (cached.isNotEmpty && mounted) {
      setState(() {
        _items = prioritizeWithImagesFirst(
          cached,
          teaHasDisplayableHeroImage,
        );
        _loading = false;
        _error = null;
      });
      _memoryTeaCache = _items;
      _memoryTeaCacheAt = DateTime.now();
      final hydrated = await _hydrateTeaItemsFast(_items);
      if (mounted && hydrated != _items) {
        setState(() => _items = hydrated);
        _memoryTeaCache = hydrated;
      }
      unawaited(_syncCachedAiImages());
      if (!kManualTeaNewsRefreshOnly) {
        unawaited(_refreshFromNetwork());
      }
      return;
    }

    if (kManualTeaNewsRefreshOnly) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'No tea yet. Tap Refresh.';
      });
      return;
    }

    if (_items.isEmpty) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    await _refreshFromNetwork();
  }

  Future<void> _onHeaderRefresh() async {
    if (_refreshing) return;
    setState(() => _refreshing = true);
    try {
      final items = await fetchTrendingTea(
        allowCache: false,
        deferEnrich: false,
      );
      if (!mounted) return;
      final hydrated = await _hydrateTeaItemsFast(items);
      setState(() {
        _items = hydrated;
        _loading = false;
        _error = hydrated.isEmpty ? 'No tea right now.' : null;
      });
      _memoryTeaCache = hydrated;
      unawaited(_syncCachedAiImages());
    } catch (_) {
      if (!mounted) return;
      setState(() {
        if (_items.isEmpty) _error = 'Could not refresh tea.';
      });
    } finally {
      if (mounted) setState(() => _refreshing = false);
    }
  }

  Future<void> _refreshFromNetwork() async {
    if (kManualTeaNewsRefreshOnly) return;
    final hadItems = _items.isNotEmpty;
    final stale = _memoryTeaCacheAt == null ||
        DateTime.now().difference(_memoryTeaCacheAt!) >= _teaCacheMaxAge;
    if (hadItems && !stale) return;

    try {
      final items = await fetchTrendingTea(
        allowCache: false,
        deferEnrich: false,
      );
      if (!mounted) return;
      final hydrated = await _hydrateTeaItemsFast(items);
      setState(() {
        _items = hydrated;
        _loading = false;
        _error = null;
      });
      _memoryTeaCache = hydrated;
      unawaited(_syncCachedAiImages());
    } catch (e) {
      if (!mounted) return;
      if (_items.isEmpty) {
        setState(() {
          _error = 'Could not load tea. Pull to refresh or check your connection.';
          _loading = false;
        });
      }
    }
  }

  Future<void> _openShare(TeaItem item) async {
    if (item.url.isEmpty) return;
    // Headline-first resolve + multi-source enrichment (scrape not required).
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
    final body = extracted.storyTextForAi;
    final seed = extracted.toArticleSeed();
    seed['image'] = teaHeroImageUrl(item) ?? item.thumbnail;
    final ctx = peekTeaTopicContext(item.url, item.title) ??
        await enrichTeaTopicContext(seed);
    seed.addAll(ctx.toArticleFields());
    if (body.isEmpty && ctx.displaySummary.isNotEmpty) {
      seed['gossip'] = ctx.displaySummary;
      seed['description'] = ctx.displaySummary;
    }
    if (body.isEmpty && ctx.contextLevel == TeaContextLevel.headlineOnly) {
      seed['extractionStatus'] = 'titleOnly';
      seed['extractionDiagnostic'] = ctx.contextLevelLabel;
    }
    final payload = {
      'newsArticle': seed,
      'returnTo': GoRouterState.of(context).uri.path,
      // Land on Share Suggestions with LinkedIn / X / Instagram picker first.
      // Do not auto-open the "Edit before sharing" panel.
      'platform': 'linkedin',
    };
    await prepareShareSuggestionsRoute(payload);
    if (!mounted) return;
    await context.push(AppRoutes.shareSuggestions, extra: payload);
  }

  Future<void> _syncCachedAiImages() async {
    if (_items.isEmpty) return;
    var changed = false;
    final updated = <TeaItem>[];
    for (final item in _items) {
      final cached = await resolveCachedHubCarouselImage(
        url: item.url,
        title: item.title,
        fallbackId: item.id,
        kind: HubCarouselImageKind.tea,
      );
      if (cached != null && cached != item.thumbnail) {
        updated.add(item.copyWith(thumbnail: cached));
        changed = true;
      } else {
        updated.add(item);
      }
    }
    if (changed && mounted) {
      setState(() {
        _items = prioritizeWithImagesFirst(
          updated,
          (t) => teaAiHeroInitialUrl(t) != null,
        );
        _memoryTeaCache = _items;
      });
      unawaited(_saveTeaToDisk(_items));
    }

    // Generate missing photoreal heroes (bounded) via existing /api/tea/ensure-image pipeline.
    unawaited(enrichCarouselSlotsWithAiImages(
      slotCount: _items.length,
      maxGenerate: 6,
      needsImage: (i) => teaAiHeroInitialUrl(_items[i]) == null,
      generateForIndex: (i) async {
        final item = _items[i];
        return getOrGenerateHubCarouselImage(
          cacheKey: hubCarouselImageCacheKey(item.url, item.id),
          headline: teaCardHeadline(item),
          storyText: item.gossip,
          articleUrl: item.url,
          kind: HubCarouselImageKind.tea,
          priority: HubCarouselImagePriority.podTeaHome,
        );
      },
      applyImage: (i, url) {
        if (!mounted) return;
        unawaited(_applyTeaImageAt(i, url));
      },
    ));
  }

  Future<void> _applyTeaImageAt(int index, String imageUrl) {
    if (index < 0 || index >= _items.length) return Future.value();
    final item = _items[index];
    if (item.thumbnail == imageUrl) return Future.value();
    if (!mounted) return Future.value();
    setState(() {
      final updated = [..._items];
      updated[index] = item.copyWith(thumbnail: imageUrl);
      _items = prioritizeWithImagesFirst(updated, teaHasDisplayableHeroImage);
      _memoryTeaCache = _items;
    });
    return _saveTeaToDisk(_items);
  }

  void _openTeaFeed() {
    stashTeaFeedLaunchItems(_items);
    context.go(AppRoutes.teaFeed, extra: {
      'teaItems': _items.map(teaItemFeedPayload).toList(),
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
      margin: const EdgeInsets.only(bottom: 16),
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
                HubSectionRefreshPill(
                  refreshing: _refreshing,
                  onRefresh: () => unawaited(_onHeaderRefresh()),
                ),
                const SizedBox(width: 8),
                TextButton(
                  onPressed: _loading ? null : _openTeaFeed,
                  style: TextButton.styleFrom(
                    foregroundColor: hubAccent,
                    side: const BorderSide(color: hubDivider),
                    backgroundColor: hubAccent.withValues(alpha: 0.09),
                    visualDensity: VisualDensity.compact,
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    minimumSize: const Size(0, 36),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
                  ),
                  child: const Text('See all', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 12)),
                ),
              ],
            ),
          ),
          const Divider(height: 1, color: hubDivider),
          Padding(
            padding: const EdgeInsets.only(top: 12, left: 16, bottom: 12),
            child: _loading && _items.isEmpty
                ? const CardSkeleton(count: 4)
                : _error != null
                    ? Text(_error!, style: const TextStyle(color: hubMuted))
                    : _items.isEmpty
                        ? const Text('No tea right now.', style: TextStyle(color: hubMuted))
                        : SizedBox(
                            height: 228,
                            child: ListView.separated(
                              scrollDirection: Axis.horizontal,
                              itemCount: _items.length,
                              separatorBuilder: (_, __) => const SizedBox(width: 12),
                              itemBuilder: (context, idx) {
                                final item = _items[idx];
                                final headline = teaCardHeadline(item);
                                return GestureDetector(
                                  onTap: () => _openShare(item),
                                  child: Container(
                                    width: 268,
                                    decoration: BoxDecoration(
                                      borderRadius: BorderRadius.circular(14),
                                      border: Border.all(color: hubDivider),
                                    ),
                                    clipBehavior: Clip.antiAlias,
                                    child: Stack(
                                      fit: StackFit.expand,
                                      children: [
                                        HubCarouselResolvingHero(
                                          initialUrl: teaAiHeroInitialUrl(item),
                                          articleUrl: item.url,
                                          title: headline,
                                          storyText: item.gossip,
                                          fallbackId: item.id,
                                          kind: HubCarouselImageKind.tea,
                                          tryYouTubeThumbnail: false,
                                          imagePriority: HubCarouselImagePriority.podTeaHome,
                                          generateAiImage: true,
                                          errorWidget: const _TeaImageLoadingPlaceholder(),
                                          onResolved: (url) => unawaited(_applyTeaImageAt(idx, url)),
                                        ),
                                        Positioned(
                                          left: 0,
                                          right: 0,
                                          bottom: 0,
                                          child: Container(
                                            padding: const EdgeInsets.fromLTRB(14, 36, 14, 14),
                                            decoration: BoxDecoration(
                                              gradient: LinearGradient(
                                                begin: Alignment.topCenter,
                                                end: Alignment.bottomCenter,
                                                colors: [
                                                  Colors.transparent,
                                                  Colors.black.withValues(alpha: 0.55),
                                                  Colors.black.withValues(alpha: 0.92),
                                                ],
                                                stops: const [0.0, 0.45, 1.0],
                                              ),
                                            ),
                                            child: Text(
                                              headline,
                                              maxLines: 3,
                                              overflow: TextOverflow.ellipsis,
                                              style: const TextStyle(
                                                color: Colors.white,
                                                fontSize: 15,
                                                fontWeight: FontWeight.w700,
                                                height: 1.25,
                                                letterSpacing: -0.2,
                                                shadows: [
                                                  Shadow(
                                                    color: Colors.black87,
                                                    blurRadius: 8,
                                                    offset: Offset(0, 1),
                                                  ),
                                                ],
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
}

/// Dark loading surface while photoreal Tea images generate (not a story image).
class _TeaImageLoadingPlaceholder extends StatelessWidget {
  const _TeaImageLoadingPlaceholder();

  @override
  Widget build(BuildContext context) {
    return const ColoredBox(
      color: Color(0xFF141414),
      child: Center(
        child: SizedBox(
          width: 28,
          height: 28,
          child: CircularProgressIndicator(
            strokeWidth: 2.2,
            color: HubColors.accent,
          ),
        ),
      ),
    );
  }
}
