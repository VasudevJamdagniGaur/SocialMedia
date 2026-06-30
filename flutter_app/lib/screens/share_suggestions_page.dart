import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import 'package:image_picker_android/image_picker_android.dart';
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:screenshot/screenshot.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../components/skeleton/list_skeleton.dart';
import '../components/skeleton/skeleton.dart';
import '../components/tweet_share_card.dart';
import '../contexts/theme_context.dart';
import '../router/app_router.dart';
import '../services/chat_service.dart';
import '../services/firestore_service.dart';
import '../services/youtube_tea_service.dart';
import '../utils/date_utils.dart';
import '../utils/hub_colors.dart';
import '../services/render_backend_queue.dart';
import '../utils/hub_carousel_ai_image.dart';
import '../utils/hub_carousel_image_store.dart';
import '../utils/reddit_thread_comments.dart';
import '../utils/share_news_cache.dart';

enum _XShareMode {
  cardImage,
  imageAndCaption,
}

class ShareSuggestionsPage extends StatefulWidget {
  const ShareSuggestionsPage({super.key});

  static const _linkedInShareChannel = MethodChannel('therapist.deite.app/linkedin_share');

  @override
  State<ShareSuggestionsPage> createState() => _ShareSuggestionsPageState();
}

class _ShareSuggestionsPageState extends State<ShareSuggestionsPage> {
  static const _platformLabels = {
    'linkedin': 'LinkedIn',
    'x': 'X',
    'reddit': 'Reddit',
  };

  String _platform = 'linkedin';
  String _returnTo = AppRoutes.dashboard;
  bool _suggestionsOnly = false;
  String _reflection = '';
  Map<String, dynamic>? _newsArticle;
  List<String> _media = [];

  List<Map<String, String>> _suggestions = [];
  bool _loading = true;
  bool _loadingNewsDetails = false;
  String _newsCardHeadline = '';
  String _newsCardSummary = '';
  Map<String, dynamic>? _newsArticleDetails;
  String? _error;
  int _selectedIndex = 0;

  bool _routeParsed = false;
  bool _routeInitializing = true;
  String? _routeInitError;
  bool _shareConfirmOpen = false;
  bool _sharePanelOpen = false;
  bool _savedToMyDeeds = false;
  bool _xSharePreparing = false;
  bool _xShareAssetsLoading = false;
  String? _xShareImageDataUrl;
  String? _xShareProfileDataUrl;
  final _xShareScreenshotController = ScreenshotController();
  bool _autoOpenSharePanel = false;
  String? _pendingShareText;
  String _editableShareText = '';
  // AI-generated illustration (primary image for Tea/News shares).
  String? _generatedShareImageUrl;
  // Original source thumbnail from YouTube / article (optional alternative).
  String? _sourceImageUrl;
  bool _loadingShareImage = false;
  String? _lastImagePrompt;

  final TextEditingController _reflectionController = TextEditingController();
  final FocusNode _reflectionFocusNode = FocusNode();

  bool get _isNewsMode => _newsArticle != null;

  String? get _shareSuggestionImageUrl {
    if (_media.isNotEmpty) return _media.first;
    if (isValidHubCarouselImageUrl(_generatedShareImageUrl)) {
      return _generatedShareImageUrl;
    }
    final fromArticle = _newsArticle?['image'] as String?;
    if (isValidHubCarouselImageUrl(fromArticle)) return fromArticle!.trim();
    return _generatedShareImageUrl;
  }

  bool get _isTeaArticleShare =>
      _isNewsMode &&
      (isTeaSourceLabel(_newsArticle?['source'] as String?) ||
          isRedditTeaThreadUrl(_newsArticle?['url'] as String?) ||
          isYouTubeTeaUrl(_newsArticle?['url'] as String?));

  @override
  void initState() {
    super.initState();
    _reflectionFocusNode.addListener(_onReflectionFocusChanged);
    // Safety: never leave the page blank if async route init stalls.
    Future<void>.delayed(const Duration(seconds: 4), () {
      if (!mounted || !_routeInitializing) return;
      setState(() {
        _routeInitializing = false;
        _routeInitError ??= 'Loading timed out — tap back to return';
      });
      if (_reflection.isNotEmpty || _isNewsMode) {
        if (_suggestions.isEmpty) unawaited(_bootstrapSharePage());
      }
    });
  }

  @override
  void dispose() {
    RenderBackendQueue.instance.endPostCreationSession();
    _reflectionFocusNode.removeListener(_onReflectionFocusChanged);
    _reflectionController.dispose();
    _reflectionFocusNode.dispose();
    super.dispose();
  }

  void _onReflectionFocusChanged() {
    if (_reflectionFocusNode.hasFocus) return;
    _syncReflectionController(restoreIfEmpty: true);
  }

  void _syncReflectionController({bool force = false, bool restoreIfEmpty = false}) {
    if (_isNewsMode || _reflection.isEmpty) return;

    final controllerEmpty = _reflectionController.text.trim().isEmpty;
    if (restoreIfEmpty && controllerEmpty) {
      _reflectionController.text = _reflection;
      return;
    }

    if (force || controllerEmpty) {
      if (_reflectionController.text != _reflection) {
        _reflectionController.text = _reflection;
      }
    }
  }

  Map<String, dynamic>? _resolveRoutePayload() {
    final staged = takePendingShareSuggestionsRoute();
    if (staged != null) {
      return staged;
    }

    final extra = GoRouterState.of(context).extra;
    if (extra is Map) {
      return Map<String, dynamic>.from(extra);
    }

    return null;
  }

  void _finishRouteInit(Map<String, dynamic> payload) {
    if (!RenderBackendQueue.instance.isPostCreationActive) {
      RenderBackendQueue.instance.beginPostCreationSession();
    }
    _applyRoutePayload(payload);
    unawaited(persistShareSuggestionsRouteState(payload));

    if (_reflection.isEmpty && !_isNewsMode) {
      setState(() {
        _routeInitializing = false;
        _routeInitError ??= 'No content available for sharing';
      });
      return;
    }

    setState(() => _routeInitializing = false);
    unawaited(_bootstrapSharePage());
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_routeParsed) return;
    _routeParsed = true;

    final payload = _resolveRoutePayload();
    if (payload != null) {
      _finishRouteInit(payload);
      return;
    }

    unawaited(_initializeRouteFromPrefs());
  }

  void _applyRoutePayload(Map<String, dynamic> extra) {
      _reflection = (extra['reflection'] as String? ?? '').trim();
      _syncReflectionController(force: true);
      _platform = extra['platform'] as String? ?? 'linkedin';
      _returnTo = extra['returnTo'] as String? ?? AppRoutes.dashboard;
      _suggestionsOnly = extra['suggestionsOnly'] == true;
      _autoOpenSharePanel = extra['autoOpenSharePanel'] == true;

      final mediaRaw = extra['media'];
      if (mediaRaw is List) {
        _media = mediaRaw
            .whereType<String>()
            .map((s) => s.trim())
            .where((s) =>
                s.startsWith('data:image') ||
                s.startsWith('http://') ||
                s.startsWith('https://'))
            .take(6)
            .toList();
      }

      if (extra['newsArticle'] is Map) {
        _newsArticle = Map<String, dynamic>.from(extra['newsArticle'] as Map);
      _sanitizeNewsArticleFields();
      final headline = '${_newsArticle?['title'] ?? ''}'.trim();
      if (headline.isNotEmpty) _newsCardHeadline = headline;
    }
  }

  void _sanitizeNewsArticleFields() {
    if (_newsArticle == null) return;
    final cleanedDesc = stripHtmlBoilerplate('${_newsArticle!['description'] ?? ''}');
    if (cleanedDesc != '${_newsArticle!['description'] ?? ''}') {
      _newsArticle = {
        ...Map<String, dynamic>.from(_newsArticle!),
        'description': cleanedDesc,
      };
    }
  }

  Future<void> _initializeRouteFromPrefs() async {
    Map<String, dynamic>? payload;
    try {
      payload = await restoreShareSuggestionsRouteState()
          .timeout(const Duration(seconds: 3));
    } catch (e) {
      _routeInitError = e.toString();
    }

    if (!mounted) return;

    if (payload != null) {
      _applyRoutePayload(payload);
    }

    if (_reflection.isEmpty && !_isNewsMode) {
      setState(() {
        _routeInitializing = false;
        _routeInitError ??= 'No saved share content found';
      });
      return;
    }

    setState(() => _routeInitializing = false);
    unawaited(_bootstrapSharePage());
  }

  Future<void> _bootstrapSharePage() async {
    try {
      await _bootstrapSharePageInner().timeout(const Duration(seconds: 90));
    } catch (_) {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _bootstrapSharePageInner() async {
    if (_isNewsMode) {
      await Future.wait([
        _loadNewsCardDetails(),
        _loadSuggestions(),
      ]);
      await _ensureNewsShareImage();
    } else {
      await _loadSuggestions();
      await _ensureReflectionShareImage();
    }
  }

  Future<void> _ensureReflectionShareImage() async {
    if (_isNewsMode || _media.isNotEmpty) return;
    if (isValidHubCarouselImageUrl(_generatedShareImageUrl)) return;

    if (mounted) setState(() => _loadingShareImage = true);

    try {
      var text = _selectedPostText.trim();
      if (text.isEmpty) {
        text = _reflection.trim();
        if (text.isEmpty && _suggestions.isNotEmpty) {
          text = (_suggestions.first['post'] ?? '').trim();
        }
      }
      if (text.isEmpty) return;

      debugPrint('[ImageGen] reflection share image request textLen=${text.length}');
      final prompt = await ChatService.instance.resolveShareImagePrompt(text, platform: _platform);
      final generated = await ChatService.instance.fetchImageForReflection(text, null, _platform);
      debugPrint(
        '[ImageGen] reflection share image stored hasImage=${generated != null} len=${generated?.length ?? 0}',
      );
      if (generated == null || !mounted) return;

      setState(() {
        _generatedShareImageUrl = generated;
        if (prompt != null && prompt.trim().isNotEmpty) _lastImagePrompt = prompt.trim();
      });
    } finally {
      if (mounted) setState(() => _loadingShareImage = false);
    }
  }

  Future<void> _ensureNewsShareImage() async {
    if (!_isNewsMode || _media.isNotEmpty) return;
    if (isValidHubCarouselImageUrl(_generatedShareImageUrl)) return;

    if (mounted) setState(() => _loadingShareImage = true);

    try {
      final url = '${_newsArticle?['url'] ?? ''}'.trim();
      final headline = _displayNewsHeadline.trim().isNotEmpty
          ? _displayNewsHeadline.trim()
          : '${_newsArticle?['title'] ?? ''}'.trim();
      if (headline.isEmpty) return;

      final kind = _isTeaArticleShare ? HubCarouselImageKind.tea : HubCarouselImageKind.news;

      // 1. Fast path: try local cache first (no network).
      final cachedFast = await resolveHubCarouselImageFast(
        url: url,
        title: headline,
        fallbackId: hubCarouselImageCacheKey(url, headline),
        kind: kind,
      );
      if (cachedFast != null && isHubCarouselDisplayImage(cachedFast)) {
        if (!mounted) return;
        // Also try to get sourceImageUrl from Firestore in background.
        unawaited(FirestoreService.instance.getHubCarouselBothUrls(url).then((both) {
          if (mounted && both.sourceImageUrl != null) {
            setState(() => _sourceImageUrl = both.sourceImageUrl);
          }
        }));
        setState(() {
          _generatedShareImageUrl = cachedFast;
          _newsArticle = {
            ...Map<String, dynamic>.from(_newsArticle ?? {}),
            'image': cachedFast,
          };
        });
        return;
      }

      // 2. Try Firestore for both AI image and source image (one call).
      if (url.isNotEmpty) {
        final both = await FirestoreService.instance.getHubCarouselBothUrls(url);
        if (both.aiImageUrl != null && isHubCarouselDisplayImage(both.aiImageUrl!)) {
          await persistHubCarouselImage(
            url: url,
            title: headline,
            imageUrl: both.aiImageUrl!,
            kind: kind,
          );
          if (!mounted) return;
          setState(() {
            _generatedShareImageUrl = both.aiImageUrl;
            _sourceImageUrl = both.sourceImageUrl;
            _newsArticle = {
              ...Map<String, dynamic>.from(_newsArticle ?? {}),
              'image': both.aiImageUrl!,
            };
          });
          return;
        }
      }

      // 3. Per-user share image cache.
      final uid = FirebaseAuth.instance.currentUser?.uid;
      if (uid != null && url.isNotEmpty) {
        final cached = await FirestoreService.instance.getNewsShareImageUrl(uid, url);
        if (cached != null && isHubCarouselDisplayImage(cached)) {
          await persistHubCarouselImage(
            url: url,
            title: headline,
            imageUrl: cached,
            kind: _isTeaArticleShare ? HubCarouselImageKind.tea : HubCarouselImageKind.news,
          );
          if (!mounted) return;
          setState(() {
            _generatedShareImageUrl = cached;
            _newsArticle = {
              ...Map<String, dynamic>.from(_newsArticle ?? {}),
              'image': cached,
            };
          });
          return;
        }
      }

      // 4. Generate AI image via the centralized server pipeline.
      //    Pass the existing article image as sourceImageUrl so it gets stored alongside.
      final storyParts = <String>[
        if (_displayNewsSummary.trim().isNotEmpty) _displayNewsSummary.trim(),
        stripHtmlBoilerplate('${_newsArticle?['description'] ?? ''}'),
      ].where((s) => s.isNotEmpty).toList();
      final storyText = storyParts.join('\n\n');

      final existingImg = ('${_newsArticle?['image'] ?? ''}').trim();
      final result = await getOrGenerateHubCarouselImageFull(
        cacheKey: hubCarouselImageCacheKey(url, headline),
        headline: headline,
        storyText: storyText,
        articleUrl: url,
        kind: _isTeaArticleShare ? HubCarouselImageKind.tea : HubCarouselImageKind.news,
        sourceImageUrl: existingImg.startsWith('http') ? existingImg : null,
        priority: HubCarouselImagePriority.shareScreen,
      );
      if (result == null || !mounted) return;

      debugPrint('[ImageGen] news share image stored len=${result.aiImageUrl.length}');
      setState(() {
        _generatedShareImageUrl = result.aiImageUrl;
        if (result.sourceImageUrl != null) _sourceImageUrl = result.sourceImageUrl;
        _newsArticle = {
          ...Map<String, dynamic>.from(_newsArticle ?? {}),
          'image': result.aiImageUrl,
        };
      });

      if (uid != null && url.isNotEmpty && result.aiImageUrl.startsWith('http')) {
        unawaited(FirestoreService.instance.saveNewsShareImageUrl(uid, url, result.aiImageUrl));
      }
    } finally {
      if (mounted) setState(() => _loadingShareImage = false);
    }
  }

  Map<String, dynamic> _articleForSuggestions() {
    final merged = Map<String, dynamic>.from(_newsArticle ?? {});
    final details = _newsArticleDetails;
    if (details != null) {
      for (final entry in details.entries) {
        final v = entry.value;
        if (v == null) continue;
        if (v is String && v.trim().isEmpty) continue;
        merged[entry.key] = v;
      }
    }
    return merged;
  }

  Future<void> _loadNewsCardDetails() async {
    final rawUrl = '${_newsArticle?['url'] ?? ''}'.trim();
    final url = normalizeRedditDiscussionUrl(rawUrl) ?? rawUrl;
    if (url.isEmpty) return;
    if (url != rawUrl && _newsArticle != null) {
      _newsArticle = {...Map<String, dynamic>.from(_newsArticle!), 'url': url};
    }

    final isTea = _isTeaArticleShare;
    final preTitle = '${_newsArticle?['title'] ?? ''}'.trim();

    if (mounted) {
      setState(() {
        _loadingNewsDetails = true;
        if (preTitle.isNotEmpty) _newsCardHeadline = preTitle;
      });
    }

    try {
      await _enrichNewsCardDetails(url, isTea).timeout(const Duration(seconds: 35));
    } catch (_) {
      // Card enrichment is optional; suggestions can still load from article stub.
    } finally {
      if (mounted) setState(() => _loadingNewsDetails = false);
    }
  }

  Future<void> _enrichNewsCardDetails(String url, bool isTea) async {
    final source = _newsArticle?['source'] as String?;
    Map<String, dynamic>? redditDetails;

    if (isRedditThreadUrl(url)) {
      try {
        redditDetails = await fetchRedditThreadDetails(
          url,
          seed: _newsArticle,
        ).timeout(const Duration(seconds: 25));
      } catch (_) {}
    }

    final cached = await getCachedNewsCardForUrl(url);

    if (cached != null) {
      var summary = cached['summary'] is String ? cached['summary'] as String : '';
      final headline = cached['headline'] is String ? cached['headline'] as String : '';
      final cachedDetails = cached['details'] is Map
          ? Map<String, dynamic>.from(cached['details'] as Map)
          : null;
      final cacheUsable = !isTea ||
          (summary.trim().length >= 40 &&
              !teaCardSummaryHasDisplayIssues(
                summary,
                cachedDetails,
                headline.isNotEmpty ? headline : cleanTeaCardTitle('${_newsArticle?['title'] ?? ''}'),
              ));
      if (cacheUsable) {
        if (isTea) {
          summary = sanitizeTeaCardSummary(summary);
          if (isScrapeBlockedBoilerplate(summary)) summary = '';
          if (summary.isNotEmpty) {
            await upsertCachedNewsCard(
              url: url,
              headline: headline,
              summary: summary,
              details: cachedDetails,
              source: source,
            );
          }
        }
        if (!mounted) return;
        setState(() {
          _newsArticleDetails = cachedDetails;
          _newsCardSummary = summary;
          _newsCardHeadline = isScrapeBlockedBoilerplate(headline)
              ? cleanTeaCardTitle('${_newsArticle?['title'] ?? ''}')
              : headline;
        });
        return;
      }
    }

    Map<String, dynamic>? effective;
    if (redditDetails != null) {
      effective = redditDetails;
    } else {
      final details = await ChatService.instance
          .fetchNewsArticleDetails(
            _newsArticle,
            {
              'minTextLength': isTea ? 80 : 350,
              'resolveGoogleNews': !isTea,
            },
          )
          .timeout(const Duration(seconds: 22));
      final looksUseful = details['title'] != null ||
          details['description'] != null ||
          details['text'] != null ||
          details['image'] != null;
      effective = looksUseful ? details : null;
    }

    effective ??= _newsArticle != null &&
            '${_newsArticle?['title'] ?? ''}'.trim().isNotEmpty
        ? Map<String, dynamic>.from(_newsArticle!)
        : null;

    if (effective == null) return;
    final articleDetails = effective;

    final gossipFallback = isTea ? '' : buildRedditGossipSummary(articleDetails);
    final headlineFallback = _newsCardHeadline.isNotEmpty
        ? _newsCardHeadline
        : cleanTeaCardTitle('${_newsArticle?['title'] ?? ''}');
    final localTeaFallback = isTea
        ? buildLocalTeaCardSummary(articleDetails, headlineFallback: headlineFallback)
        : '';
    final aiArticleDetails = isTea
        ? prepareTeaArticleContextForAi(articleDetails)
        : articleDetails;

    final results = await Future.wait<String>([
      ChatService.instance
          .summarizeNewsArticle(
            aiArticleDetails,
            {
              'minWords': isTea ? 35 : 60,
              'maxWords': isTea ? teaCardSummaryMaxWords : 80,
              'isTeaGossip': isTea,
            },
          )
          .timeout(
            const Duration(seconds: 30),
            onTimeout: () => localTeaFallback.isNotEmpty ? localTeaFallback : gossipFallback,
          ),
      ChatService.instance
          .generateNewsShareCardHeadline(articleDetails)
          .timeout(
            const Duration(seconds: 12),
            onTimeout: () => '${articleDetails['title'] ?? _newsArticle?['title'] ?? ''}'.trim(),
          ),
    ]);
    if (!mounted) return;

    final rawSummary = results[0].trim();
    final localFallback = isTea ? localTeaFallback : buildLocalNewsCardSummary(articleDetails);
    var finalSummary = rawSummary.isNotEmpty
        ? rawSummary
        : (localFallback.isNotEmpty ? localFallback : gossipFallback);
    if (isTea &&
        finalSummary.isNotEmpty &&
        (teaCardSummaryHasDisplayIssues(finalSummary, articleDetails, headlineFallback) ||
            teaCardSummaryLooksLikeTitleOnly(finalSummary, headlineFallback))) {
      finalSummary = localTeaFallback;
    }
    if (isScrapeBlockedBoilerplate(finalSummary)) {
      finalSummary = '';
    }
    if (isTea && finalSummary.isNotEmpty) {
      finalSummary = sanitizeTeaCardSummary(finalSummary);
    }
    var finalHeadline = results[1].trim();
    if (finalHeadline.isEmpty) {
      finalHeadline = cleanTeaCardTitle(
        '${articleDetails['title'] ?? _newsArticle?['title'] ?? ''}',
      );
    } else {
      finalHeadline = cleanTeaCardTitle(finalHeadline);
    }
    if (finalHeadline.isEmpty) {
      finalHeadline = headlineFallback;
    }
    if (isScrapeBlockedBoilerplate(finalHeadline)) {
      finalHeadline = headlineFallback;
    }
    if (!isTea && finalSummary.isEmpty && finalHeadline.isNotEmpty) {
      finalSummary = (await ChatService.instance
              .summarizeNewsFromHeadline(finalHeadline)
              .timeout(const Duration(seconds: 22)))
          .trim();
    }

    setState(() {
      _newsArticleDetails = articleDetails;
      if (finalSummary.isNotEmpty) _newsCardSummary = finalSummary;
      if (finalHeadline.isNotEmpty) _newsCardHeadline = finalHeadline;
      _newsArticle = {
        ...Map<String, dynamic>.from(_newsArticle ?? {}),
        if (articleDetails['text'] != null) 'text': articleDetails['text'],
        if (articleDetails['selftext'] != null) 'selftext': articleDetails['selftext'],
        if (finalSummary.isNotEmpty) ...{
          'description': finalSummary,
          'gossip': finalSummary,
        },
        if (articleDetails['image'] is String && (articleDetails['image'] as String).isNotEmpty)
          'image': articleDetails['image'],
      };
    });

    if (finalSummary.isNotEmpty) {
      await upsertCachedNewsCard(
        url: url,
        headline: finalHeadline,
        summary: finalSummary,
        details: articleDetails,
        source: source,
      );
    }
  }

  String get _displayNewsHeadline {
    if (!_isNewsMode) return '';
    final seed = cleanTeaCardTitle('${_newsArticle?['title'] ?? ''}');
    if (_newsCardHeadline.isNotEmpty) {
      return resolveTeaDisplayTitle(_newsCardHeadline, seed);
    }
    return seed;
  }

  String get _displayNewsSummary {
    if (!_isNewsMode) return '';
    if (_loadingNewsDetails) return '';
    if (isScrapeBlockedBoilerplate(_newsCardSummary)) return '';
    if (_newsCardSummary.isNotEmpty) {
      if (_isTeaArticleShare &&
          teaCardSummaryHasDisplayIssues(
            _newsCardSummary,
            _newsArticleDetails ?? _newsArticle,
            _newsCardHeadline.isNotEmpty
                ? _newsCardHeadline
                : cleanTeaCardTitle('${_newsArticle?['title'] ?? ''}'),
          )) {
        return '';
      }
      return _isTeaArticleShare
          ? sanitizeTeaCardSummary(_newsCardSummary)
          : _newsCardSummary;
    }
    if (_isTeaArticleShare) {
      return buildLocalTeaCardSummary(
        _newsArticleDetails ?? _newsArticle,
        headlineFallback: _newsCardHeadline.isNotEmpty
            ? _newsCardHeadline
            : cleanTeaCardTitle('${_newsArticle?['title'] ?? ''}'),
      );
    }
    return buildLocalNewsCardSummary(_newsArticleDetails ?? _newsArticle);
  }

  String get _baselineText {
    if (_isNewsMode) {
      final title = _newsArticle?['title'] as String? ?? '';
      final desc = _newsArticle?['description'] as String? ?? '';
      return [title, desc].where((s) => s.trim().isNotEmpty).join('\n\n');
    }
    return _reflection;
  }

  String get _selectedPostText {
    if (_suggestions.isEmpty) return sanitizeSocialPostText(_baselineText);
    final item = _suggestions[_selectedIndex.clamp(0, _suggestions.length - 1)];
    return sanitizeSocialPostText(item['post'] ?? _baselineText);
  }

  String get _headerTitle {
    if (_platform.isEmpty) return 'Suggestions for your post';
    return 'Suggestions for ${_platformLabels[_platform] ?? _platform}';
  }

  void _goBack() {
    if (context.canPop()) {
      context.pop();
      return;
    }
    final path = _returnTo.startsWith('/') ? _returnTo : AppRoutes.dashboard;
    context.go(path);
  }

  Future<void> _loadSuggestions() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      List<Map<String, String>> items;
      if (_isNewsMode) {
        var url = normalizeRedditDiscussionUrl('${_newsArticle?['url'] ?? ''}'.trim()) ??
            '${_newsArticle?['url'] ?? ''}'.trim();
        final isTea = _isTeaArticleShare;
        var article = _articleForSuggestions();

        if (isRedditThreadUrl(url) && extractRedditContentSnippets(article).isEmpty) {
          try {
            final reddit = await fetchRedditThreadDetails(url, seed: article)
                .timeout(const Duration(seconds: 30));
            if (reddit != null && mounted) {
              setState(() {
                _newsArticleDetails = reddit;
                _newsArticle = {
                  ...Map<String, dynamic>.from(_newsArticle ?? {}),
                  'url': url,
                  'text': reddit['text'],
                  'selftext': reddit['selftext'],
                  if (reddit['image'] is String && (reddit['image'] as String).isNotEmpty)
                    'image': reddit['image'],
                };
              });
              article = _articleForSuggestions();
            }
          } catch (_) {}
        }

        var cached = url.isNotEmpty
            ? await getCachedShareSuggestionsForUrl(url, _platform)
            : null;
        if (cached != null && cached.isNotEmpty && isTea) {
          if (teaSuggestionPostsLookLikeRawScrape(cached)) cached = null;
        }
        if (cached != null && cached.isNotEmpty) {
          items = cleanCachedNewsSuggestions(cached, isTea: isTea);
      } else {
          final aiArticle = isTea ? prepareTeaArticleContextForAi(article) : article;
          final localFallback = isTea
              ? buildLocalTeaShareSuggestions(aiArticle, _platform)
              : <Map<String, String>>[
                  {
                    'eventLabel': 'News',
                    'post': _baselineText,
                  },
                ];
          try {
            items = await ChatService.instance
                .generateNewsArticleShareSuggestions(
                  aiArticle,
          _platform,
                  prefetchedDetails: aiArticle,
                  isTeaGossip: isTea,
                )
                .timeout(const Duration(seconds: 45));
            if (items.isEmpty) {
              items = localFallback;
            }
          } catch (_) {
            items = localFallback;
          }
          if (url.isNotEmpty && items.isNotEmpty) {
            final toCache = isTea
                ? cleanCachedNewsSuggestions(items, isTea: true)
                : items;
            await setCachedShareSuggestionsForUrl(url, _platform, toCache);
          }
        }
      } else {
        items = await ChatService.instance
            .generateSocialPostSuggestions(_reflection, _platform)
            .timeout(const Duration(seconds: 90));
      }

      if (!mounted) return;
      setState(() {
        _suggestions = _sanitizeSuggestionItems(
          items.isNotEmpty
              ? items
              : [
                  {
                    'eventLabel': _isNewsMode ? 'News' : 'Reflection',
                    'post': _baselineText,
                  },
                ],
        );
        _selectedIndex = 0;
        _loading = false;
      });
      _maybeAutoOpenSharePanel();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _suggestions = _sanitizeSuggestionItems([
          {
            'eventLabel': _isNewsMode ? 'News' : 'Reflection',
            'post': _baselineText,
          },
        ]);
        _selectedIndex = 0;
        _loading = false;
      });
      _maybeAutoOpenSharePanel();
    }
  }

  void _maybeAutoOpenSharePanel() {
    if (!_autoOpenSharePanel || _sharePanelOpen) return;
    _autoOpenSharePanel = false;
    if (_suggestions.isEmpty) return;
    final post = _suggestions[_selectedIndex.clamp(0, _suggestions.length - 1)]['post'] ??
        _baselineText;
    if (post.trim().isEmpty) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _openSharePanel(post);
    });
  }

  List<Map<String, String>> _sanitizeSuggestionItems(List<Map<String, String>> items) {
    return items
        .map((item) => {
              'eventLabel': item['eventLabel'] ?? 'Post',
              'post': sanitizeSocialPostText(item['post'] ?? ''),
              if ((item['posted'] ?? '').isNotEmpty) 'posted': item['posted']!,
            })
        .where((item) => (item['post'] ?? '').trim().isNotEmpty)
        .toList();
  }

  void _onPlatformChanged(String platform) {
    if (_platform == platform) return;
    setState(() {
      _platform = platform;
      _generatedShareImageUrl = null;
      _invalidateXShareAssets();
    });
    unawaited(() async {
      await _loadSuggestions();
      if (!mounted || _isNewsMode) return;
      await _ensureReflectionShareImage();
    }());
  }

  Future<void> _onReflectionRegenerate() async {
    if (_isNewsMode || _loading) return;

    var next = _reflectionController.text.trim();
    if (next.isEmpty) {
      _syncReflectionController(restoreIfEmpty: true);
      next = _reflection.trim();
    }
    if (next.isEmpty) return;

    _reflectionFocusNode.unfocus();
    setState(() {
      _reflection = next;
      _generatedShareImageUrl = null;
      _lastImagePrompt = null;
      _selectedIndex = 0;
      _error = null;
    });

    await _loadSuggestions();
    if (!mounted || _isNewsMode) return;
    await _ensureReflectionShareImage();
  }

  void _openSharePanel(String text) {
    setState(() {
      _editableShareText = sanitizeSocialPostText(text);
      _sharePanelOpen = true;
      if (_platform == 'x' && _hasShareableLinkedInImage()) {
        _xShareImageDataUrl = null;
        _xShareProfileDataUrl = null;
      }
    });
    if (_platform == 'x' && _hasShareableLinkedInImage()) {
      unawaited(_prepareXShareAssets());
    }
  }

  void _invalidateXShareAssets() {
    _xShareImageDataUrl = null;
    _xShareProfileDataUrl = null;
  }

  Future<void> _prepareXShareAssets() async {
    if (!mounted) return;
    setState(() => _xShareAssetsLoading = true);
    try {
      final imageDataUrl = await _imageDataUrlForCapture();
      final tweetUser = await _loadTweetUserInfo();
      final profileDataUrl = await _profileImageDataUrl(tweetUser.profilePicture);
      if (!mounted) return;

      if (imageDataUrl != null && imageDataUrl.startsWith('data:image')) {
        final bytes = decodeDataImageUrlBytes(imageDataUrl, logTag: '[XShare]');
        if (bytes != null) {
          try {
            await precacheImage(MemoryImage(bytes), context);
          } catch (_) {}
        }
      }

      if (profileDataUrl != null && profileDataUrl.startsWith('data:image')) {
        final bytes = decodeDataImageUrlBytes(profileDataUrl, logTag: '[XShare]');
        if (bytes != null) {
          try {
            await precacheImage(MemoryImage(bytes), context);
          } catch (_) {}
        }
      }

      try {
        await precacheImage(const AssetImage('assets/images/DEITECIrc-192.webp'), context);
      } catch (_) {}

      if (!mounted) return;
      setState(() {
        _xShareImageDataUrl = imageDataUrl;
        _xShareProfileDataUrl = profileDataUrl ?? tweetUser.profilePicture;
      });

      await WidgetsBinding.instance.endOfFrame;
      await WidgetsBinding.instance.endOfFrame;
    } finally {
      if (mounted) setState(() => _xShareAssetsLoading = false);
    }
  }

  void _syncSelectedSuggestionPost(String text) {
    if (_suggestions.isEmpty) return;
    final idx = _selectedIndex.clamp(0, _suggestions.length - 1);
    _suggestions[idx] = {
      ..._suggestions[idx],
      'post': text,
    };
  }

  Future<String> _magicPencilEditShareText(String text, String instruction) async {
    final platformLabel = _platformLabels[_platform] ?? _platform;
    final prompt = '''$instruction

Keep this as a real $platformLabel post the user would publish as-is.
Plain text only: no **bold**, no markdown bullets, no em dashes (—). Use a plain hyphen (-) when needed.''';

    final edited = await ChatService.instance.editTextWithAI(text, prompt);
    return sanitizeSocialPostText(edited);
  }

  String get _panelShareText {
    final edited = _editableShareText.trim();
    if (_sharePanelOpen && edited.isNotEmpty) return edited;
    return _selectedPostText.trim();
  }

  String get _imagePromptSourceText {
    if (_reflection.trim().isNotEmpty) return _reflection.trim();
    return _panelShareText;
  }

  Future<void> _showShareImageEditOptions(String currentPostCaption) async {
    final isDarkMode = context.read<ThemeNotifier>().isDarkMode;
    final captionForImage = currentPostCaption.trim().isNotEmpty
        ? currentPostCaption.trim()
        : _selectedPostText.trim();

    final hasSourceImage = isValidHubCarouselImageUrl(_sourceImageUrl);
    final hasAiImage = isValidHubCarouselImageUrl(_generatedShareImageUrl);

    final action = await showModalBottomSheet<_ShareImageEditAction>(
      context: context,
      isDismissible: true,
      enableDrag: true,
      isScrollControlled: true,
      backgroundColor: isDarkMode ? HubColors.bgSecondary : Colors.white,
      barrierColor: Colors.black54,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) {
        final primary = isDarkMode ? HubColors.text : const Color(0xFF1A1A1A);
        final secondary = isDarkMode ? HubColors.textSecondary : const Color(0xFF666666);
        final accent = HubColors.accent;
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(8, 12, 8, 8),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  child: Text(
                    'Image options',
                    style: TextStyle(color: primary, fontSize: 16, fontWeight: FontWeight.w600),
                  ),
                ),
                // Option 1 (default): SociTea AI image
                ListTile(
                  leading: Icon(LucideIcons.sparkles, color: accent),
                  title: Text('SociTea AI image', style: TextStyle(color: primary)),
                  subtitle: Text(
                    'Use the unique AI-generated illustration',
                    style: TextStyle(color: secondary, fontSize: 12),
                  ),
                  trailing: hasAiImage
                      ? Icon(Icons.check_circle, color: accent, size: 18)
                      : null,
                  onTap: () => Navigator.pop(ctx, _ShareImageEditAction.useAiImage),
                ),
                // Option 2: Original source thumbnail (if available)
                if (hasSourceImage)
                  ListTile(
                    leading: Icon(LucideIcons.image, color: primary),
                    title: Text('Original thumbnail', style: TextStyle(color: primary)),
                    subtitle: Text(
                      'Use the source YouTube / article image',
                      style: TextStyle(color: secondary, fontSize: 12),
                    ),
                    onTap: () => Navigator.pop(ctx, _ShareImageEditAction.useSourceImage),
                  ),
                ListTile(
                  leading: Icon(LucideIcons.pencil, color: primary),
                  title: Text('Change image', style: TextStyle(color: primary)),
                  subtitle: Text(
                    'Pick a photo from your gallery',
                    style: TextStyle(color: secondary, fontSize: 12),
                  ),
                  onTap: () => Navigator.pop(ctx, _ShareImageEditAction.replace),
                ),
                ListTile(
                  leading: Icon(LucideIcons.penLine, color: primary),
                  title: Text('Magic pencil', style: TextStyle(color: primary)),
                  subtitle: Text(
                    'Edit the AI prompt and regenerate',
                    style: TextStyle(color: secondary, fontSize: 12),
                  ),
                  onTap: () => Navigator.pop(ctx, _ShareImageEditAction.magicPencil),
                ),
                ListTile(
                  leading: Icon(LucideIcons.sparkles, color: primary),
                  title: Text('Magic wand', style: TextStyle(color: primary)),
                  subtitle: Text(
                    'Remake image to match this post caption',
                    style: TextStyle(color: secondary, fontSize: 12),
                  ),
                  onTap: () => Navigator.pop(ctx, _ShareImageEditAction.magicWand),
                ),
                // Option 3: Remove image
                ListTile(
                  leading: Icon(LucideIcons.trash2, color: Colors.red.shade400),
                  title: Text('Remove image', style: TextStyle(color: Colors.red.shade400)),
                  subtitle: Text(
                    'Share without any image',
                    style: TextStyle(color: secondary, fontSize: 12),
                  ),
                  onTap: () => Navigator.pop(ctx, _ShareImageEditAction.delete),
                ),
              ],
            ),
          ),
        );
      },
    );

    if (!mounted || action == null) return;
    switch (action) {
      case _ShareImageEditAction.useAiImage:
        // Already the default — no-op if AI image is showing; regenerate if missing.
        if (!isValidHubCarouselImageUrl(_generatedShareImageUrl)) {
          setState(() => _loadingShareImage = true);
          await _ensureNewsShareImage();
        }
      case _ShareImageEditAction.useSourceImage:
        if (isValidHubCarouselImageUrl(_sourceImageUrl)) {
          setState(() {
            _media = [_sourceImageUrl!];
          });
        }
      case _ShareImageEditAction.replace:
        await _pickShareImage();
      case _ShareImageEditAction.magicPencil:
        await _editShareImagePromptAndRegenerate();
      case _ShareImageEditAction.magicWand:
        await _regenerateShareImageFromPostCaption(captionForImage);
      case _ShareImageEditAction.delete:
        _deleteShareImage();
    }
  }

  void _deleteShareImage() {
    setState(() {
      _media = [];
      _generatedShareImageUrl = null;
      _lastImagePrompt = null;
      _sourceImageUrl = null;
      if (_newsArticle != null) {
        final updated = Map<String, dynamic>.from(_newsArticle!);
        updated.remove('image');
        updated.remove('thumbnail');
        _newsArticle = updated;
      }
    });
  }

  Future<void> _editShareImagePromptAndRegenerate() async {
    if (!mounted) return;

    final instruction = await showDialog<String>(
      context: context,
      builder: (ctx) => _ImagePromptEditDialog(
        isDarkMode: context.read<ThemeNotifier>().isDarkMode,
      ),
    );
    if (instruction == null || instruction.trim().isEmpty || !mounted) return;

    if (mounted) setState(() => _loadingShareImage = true);
    String? updatedPrompt;
    try {
      var basePrompt = _lastImagePrompt?.trim();
      basePrompt ??= await ChatService.instance.resolveShareImagePrompt(
        _imagePromptSourceText,
        platform: _platform,
      );
      if (basePrompt == null || basePrompt.trim().isEmpty) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Could not update image — try again')),
          );
        }
        return;
      }

      updatedPrompt = await _magicPencilEditImagePrompt(basePrompt, instruction.trim());
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not update image: $e')),
        );
      }
      return;
    } finally {
      if (mounted) setState(() => _loadingShareImage = false);
    }

    if (updatedPrompt.trim().isEmpty || !mounted) return;
    await _applyGeneratedShareImage(customPrompt: updatedPrompt.trim());
  }

  Future<String> _magicPencilEditImagePrompt(String basePrompt, String instruction) async {
    final edited = await ChatService.instance.editTextWithAI(
      basePrompt,
      '''Apply the user's image changes to this generation prompt. Return ONLY the full updated prompt ready for image generation, no quotes or explanation.

User changes: $instruction''',
    );
    return edited.trim();
  }

  Future<void> _regenerateShareImageFromPostCaption(String postText) async {
    final caption = sanitizeSocialPostText(postText).trim();
    if (caption.isEmpty) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Post caption is empty')),
      );
      return;
    }
    debugPrint('[ImageGen] magic wand caption textLen=${caption.length}');
    await _applyGeneratedShareImage(sourceText: caption, skipCache: true);
  }

  Future<void> _applyGeneratedShareImage({
    String? sourceText,
    String? customPrompt,
    bool skipCache = false,
  }) async {
    if (mounted) {
      setState(() {
        _loadingShareImage = true;
        _media = [];
      });
    }

    try {
      String? image;
      String? promptUsed;
      if (customPrompt != null && customPrompt.trim().isNotEmpty) {
        promptUsed = customPrompt.trim();
        image = await ChatService.instance.generateShareImageFromPrompt(promptUsed);
      } else if (sourceText != null && sourceText.trim().isNotEmpty) {
        promptUsed = await ChatService.instance.resolveShareImagePrompt(sourceText, platform: _platform);
        image = await ChatService.instance.fetchImageForReflection(
          sourceText,
          null,
          _platform,
          skipCache,
        );
      }

      if (!mounted) return;
      if (image == null || image.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not generate image — try again')),
        );
        return;
      }

      setState(() {
        _generatedShareImageUrl = image;
        _media = [];
        if (promptUsed != null && promptUsed.isNotEmpty) {
          _lastImagePrompt = promptUsed;
        }
      });
    } finally {
      if (mounted) setState(() => _loadingShareImage = false);
    }
  }

  Future<void> _pickShareImage() async {
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      final impl = ImagePickerPlatform.instance;
      if (impl is ImagePickerAndroid) {
        // Legacy gallery intent dismisses on outside tap / back; Photo Picker sheet often does not.
        impl.useAndroidPhotoPicker = false;
      }
    }

    final picker = ImagePicker();
    final file = await picker.pickImage(
      source: ImageSource.gallery,
      maxWidth: 1920,
      imageQuality: 85,
    );
    if (file == null || !mounted) return;

    final bytes = await file.readAsBytes();
    if (bytes.length > 10 * 1024 * 1024) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Image must be less than 10MB')),
      );
      return;
    }

    final ext = file.path.split('.').last.toLowerCase();
    final mime = ext == 'png'
        ? 'image/png'
        : ext == 'webp'
            ? 'image/webp'
            : 'image/jpeg';
    final dataUrl = 'data:$mime;base64,${base64Encode(bytes)}';

    if (!mounted) return;
    setState(() {
      _media = [dataUrl];
      _generatedShareImageUrl = dataUrl;
    });
  }

  Future<bool> _tryLaunchShareUri(Uri uri) async {
    try {
      return await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (e) {
      debugPrint('[Share] launchUrl failed for $uri: $e');
      return false;
    }
  }

  Future<({Uint8List bytes, String mimeType, String fileName})?> _resolveShareImagePayload() async {
    final imageUrl = _shareSuggestionImageUrl?.trim();
    if (imageUrl == null || imageUrl.isEmpty) return null;

    if (imageUrl.startsWith('data:image')) {
      final bytes = decodeDataImageUrlBytes(imageUrl, logTag: '[Share]');
      if (bytes == null) return null;
      final mimeType = imageUrl.contains('webp')
          ? 'image/webp'
          : imageUrl.contains('png')
              ? 'image/png'
              : 'image/jpeg';
      final ext = mimeType == 'image/png'
          ? 'png'
          : mimeType == 'image/webp'
              ? 'webp'
              : 'jpg';
      return (bytes: bytes, mimeType: mimeType, fileName: 'socitea_share.$ext');
    }

    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      try {
        final response = await http.get(Uri.parse(imageUrl));
        if (response.statusCode != 200) return null;
        final mimeType = (response.headers['content-type'] ?? 'image/jpeg').split(';').first.trim();
        final ext = mimeType.contains('png')
            ? 'png'
            : mimeType.contains('webp')
                ? 'webp'
                : 'jpg';
        return (bytes: response.bodyBytes, mimeType: mimeType, fileName: 'socitea_share.$ext');
      } catch (e) {
        debugPrint('[Share] image download failed: $e');
        return null;
      }
    }

    return null;
  }

  Future<File?> _writeShareImageToTempFile() async {
    final payload = await _resolveShareImagePayload();
    if (payload == null) return null;
    final dir = await getTemporaryDirectory();
    final file = File('${dir.path}/${payload.fileName}');
    await file.writeAsBytes(payload.bytes, flush: true);
    return file;
  }

  bool _hasShareableLinkedInImage() {
    final url = _shareSuggestionImageUrl?.trim();
    if (url == null || url.isEmpty) return false;
    return url.startsWith('data:image') ||
        url.startsWith('http://') ||
        url.startsWith('https://');
  }

  /// Share image via native sheet; copy caption to clipboard when present.
  Future<bool> _openImageWithCaptionShare(
    String text, {
    required String platformLabel,
  }) async {
    final payload = await _resolveShareImagePayload();

    if (payload == null) {
      if (text.trim().isEmpty) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Add some text before sharing')),
          );
        }
        return false;
      }

      if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
        try {
          final opened = await ShareSuggestionsPage._linkedInShareChannel.invokeMethod<bool>(
            'shareText',
            {'text': text},
          );
          if (opened == true) return true;
        } catch (e) {
          debugPrint('[Share] direct text share failed: $e');
        }
      }

      try {
        await Share.share(text);
        return true;
      } catch (e) {
        debugPrint('[Share] text share failed: $e');
        return false;
      }
    }

    if (text.trim().isNotEmpty) {
      await Clipboard.setData(ClipboardData(text: text));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Caption copied — paste it after the image loads in $platformLabel'),
          ),
        );
      }
    }

    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      try {
        final file = await _writeShareImageToTempFile();
        if (file != null) {
          final opened = await ShareSuggestionsPage._linkedInShareChannel.invokeMethod<bool>(
            'shareImage',
            {
              'path': file.path,
              'mimeType': payload.mimeType,
            },
          );
          if (opened == true) return true;
        }
      } catch (e) {
        debugPrint('[Share] direct image share failed: $e');
      }
    }

    try {
      await Share.shareXFiles(
        [XFile.fromData(payload.bytes, mimeType: payload.mimeType, name: payload.fileName)],
      );
      return true;
    } catch (e) {
      debugPrint('[Share] image share sheet failed: $e');
      return false;
    }
  }

  Future<bool> _openLinkedInNativeShare(String text) async {
    return _openImageWithCaptionShare(text, platformLabel: 'LinkedIn');
  }

  Future<bool> _openXImageAndCaptionShare(String text) async {
    return _openImageWithCaptionShare(text, platformLabel: 'X');
  }

  Future<void> _shareViaNativeSheet(String text) async {
    final imageUrl = _shareSuggestionImageUrl?.trim();
    if (imageUrl != null && imageUrl.startsWith('data:image')) {
      final bytes = decodeDataImageUrlBytes(imageUrl, logTag: '[Share]');
      if (bytes != null) {
        await Share.shareXFiles(
          [XFile.fromData(bytes, mimeType: 'image/png', name: 'socitea_share.png')],
          text: text,
        );
        return;
      }
    }
    await Share.share(text);
  }

  Future<String?> _imageDataUrlForCapture() async {
    final imageUrl = _shareSuggestionImageUrl?.trim();
    if (imageUrl == null || imageUrl.isEmpty) return null;
    if (imageUrl.startsWith('data:image')) return imageUrl;

    final payload = await _resolveShareImagePayload();
    if (payload == null) return null;
    return 'data:${payload.mimeType};base64,${base64Encode(payload.bytes)}';
  }

  Future<String?> _profileImageDataUrl(String? profileUrl) async {
    final url = profileUrl?.trim();
    if (url == null || url.isEmpty) return null;
    if (url.startsWith('data:image')) return url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) return null;

    try {
      final response = await http.get(Uri.parse(url));
      if (response.statusCode != 200) return null;
      final mimeType = (response.headers['content-type'] ?? 'image/jpeg').split(';').first.trim();
      return 'data:$mimeType;base64,${base64Encode(response.bodyBytes)}';
    } catch (e) {
      debugPrint('[Share] profile image download failed: $e');
      return null;
    }
  }

  Future<Uint8List?> _captureXCardPng(String text) async {
    await _prepareXShareAssets();
    if (!mounted || _xShareImageDataUrl == null) return null;

    await Future<void>.delayed(const Duration(milliseconds: 250));
    await WidgetsBinding.instance.endOfFrame;
    await WidgetsBinding.instance.endOfFrame;
    await WidgetsBinding.instance.endOfFrame;

    return _renderXCardOffscreen(text);
  }

  Future<File?> _writeXCardPngToTempFile(Uint8List bytes) async {
    try {
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/deite_x_post_${DateTime.now().millisecondsSinceEpoch}.png');
      await file.writeAsBytes(bytes, flush: true);
      return file;
    } catch (e) {
      debugPrint('[Share] failed to write X card temp file: $e');
      return null;
    }
  }

  Future<Uint8List?> _renderXCardOffscreen(String text) async {
    final tweetUser = await _loadTweetUserInfo();
    final imageDataUrl = _xShareImageDataUrl ?? await _imageDataUrlForCapture();
    if (imageDataUrl == null) return null;

    final profileDataUrl =
        _xShareProfileDataUrl ?? await _profileImageDataUrl(tweetUser.profilePicture);
    if (!mounted) return null;

    try {
      await precacheImage(
        const AssetImage('assets/images/DEITECIrc-192.webp'),
        context,
      );
    } catch (_) {}

    final controller = ScreenshotController();
    final overlayState = Overlay.of(context, rootOverlay: true);
    late OverlayEntry entry;

    entry = OverlayEntry(
      builder: (_) => IgnorePointer(
        child: Opacity(
          opacity: 0.01,
          child: Align(
            alignment: Alignment.topCenter,
            child: Material(
              type: MaterialType.transparency,
              child: Screenshot(
                controller: controller,
                child: TweetShareCard(
                  width: 360,
                  displayName: tweetUser.displayName,
                  username: tweetUser.username,
                  text: text,
                  imageUrl: imageDataUrl,
                  profileImageUrl: profileDataUrl ?? tweetUser.profilePicture,
                ),
              ),
            ),
          ),
        ),
      ),
    );

    overlayState.insert(entry);
    try {
      await Future<void>.delayed(const Duration(milliseconds: 400));
      await WidgetsBinding.instance.endOfFrame;
      await WidgetsBinding.instance.endOfFrame;
      await WidgetsBinding.instance.endOfFrame;
      return controller.capture(
        pixelRatio: 3,
        delay: const Duration(milliseconds: 150),
      );
    } finally {
      entry.remove();
    }
  }

  Future<bool> _openXCardShare(String text) async {
    if (!mounted) return false;
    setState(() => _xSharePreparing = true);
    try {
      final pngBytes = await _captureXCardPng(text);
      if (pngBytes == null || pngBytes.isEmpty) return false;

      final file = await _writeXCardPngToTempFile(pngBytes);
      if (file != null) {
        await Share.shareXFiles(
          [XFile(file.path, mimeType: 'image/png', name: 'deite_x_post.png')],
        );
      } else {
        await Share.shareXFiles(
          [XFile.fromData(pngBytes, mimeType: 'image/png', name: 'deite_x_post.png')],
        );
      }
      return true;
    } catch (e) {
      debugPrint('[Share] X card share failed: $e');
      return false;
    } finally {
      if (mounted) setState(() => _xSharePreparing = false);
    }
  }

  Future<void> _openPlatformShare([_XShareMode xShareMode = _XShareMode.cardImage]) async {
    final text = _panelShareText;
    final isLinkedIn = _platform != 'x' && _platform != 'reddit';

    if (isLinkedIn) {
      if (text.trim().isEmpty && !_hasShareableLinkedInImage()) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Add text or an image to share on LinkedIn')),
          );
        }
        return;
      }
    } else if (text.isEmpty) {
      final allowImageOnly = _platform == 'x' && _hasShareableLinkedInImage();
      if (!allowImageOnly) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Add some text before sharing')),
          );
        }
        return;
      }
    }

    var opened = false;
    try {
      switch (_platform) {
        case 'x':
          if (_hasShareableLinkedInImage()) {
            if (_xShareAssetsLoading) {
              await _prepareXShareAssets();
            }
            if (xShareMode == _XShareMode.imageAndCaption) {
              opened = await _openXImageAndCaptionShare(text);
            } else {
              opened = await _openXCardShare(text);
            }
          } else {
            opened = await _tryLaunchShareUri(
              Uri.parse('https://twitter.com/intent/tweet?text=${Uri.encodeComponent(text)}'),
            );
          }
          break;
        case 'reddit':
          opened = await _tryLaunchShareUri(
            Uri.parse(
              'https://www.reddit.com/submit?title=${Uri.encodeComponent('My reflection')}&selftext=${Uri.encodeComponent(text)}',
            ),
          );
          break;
        default:
          opened = await _openLinkedInNativeShare(text);
          break;
      }
    } catch (e) {
      debugPrint('[Share] platform share failed: $e');
    }

    if (!opened && !isLinkedIn) {
      try {
        if (_platform == 'x' && _hasShareableLinkedInImage()) {
          if (xShareMode == _XShareMode.imageAndCaption) {
            opened = await _openXImageAndCaptionShare(text);
          } else {
            opened = await _openXCardShare(text);
          }
        } else {
          await _shareViaNativeSheet(text);
          opened = true;
        }
        if (opened && mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Opened system share sheet')),
          );
        }
      } catch (e) {
        debugPrint('[Share] native share failed: $e');
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Could not share: $e')),
          );
        }
        return;
      }
    }

    if (!opened && isLinkedIn) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not share image to LinkedIn')),
        );
      }
      return;
    }

    if (!opened && _platform == 'x' && _hasShareableLinkedInImage()) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not prepare X post image')),
        );
      }
      return;
    }

    if (!mounted) return;
    setState(() {
      _pendingShareText = text;
      _shareConfirmOpen = true;
    });
    unawaited(_savePostToMyDeeds(text));
  }

  Future<String?> _resolveMyDeedsImageUrl(String uid) async {
    final rawImage = _shareSuggestionImageUrl?.trim();
    if (rawImage == null || rawImage.isEmpty) return null;
    if (rawImage.startsWith('data:image')) {
      final uploaded = await FirestoreService.instance.uploadPostImage(uid, rawImage);
      return uploaded ?? rawImage;
    }
    if (rawImage.startsWith('http://') || rawImage.startsWith('https://')) {
      return rawImage;
    }
    return null;
  }

  Future<void> _savePostToMyDeeds(String text) async {
    if (_savedToMyDeeds) return;

    final user = FirebaseAuth.instance.currentUser;
    final content = text.trim();
    final hasImage = _hasShareableLinkedInImage();
    if (user == null || (content.isEmpty && !hasImage)) return;

    try {
      final prefs = await SharedPreferences.getInstance();
      final displayName =
          prefs.getString('user_display_name_${user.uid}') ?? user.displayName ?? 'Anonymous';
      final profilePicture = prefs.getString('user_profile_picture_${user.uid}');
      final imageUrl = await _resolveMyDeedsImageUrl(user.uid);

      await FirestoreService.instance.addCommunityPost({
        'author': displayName,
        'authorId': user.uid,
        'content': content,
        'createdAt': FieldValue.serverTimestamp(),
        'likes': 0,
        'comments': [],
        'profilePicture': profilePicture,
        'image': imageUrl,
        'sharedPlatform': _platform,
        'source': _suggestionsOnly ? 'create_post' : 'share_suggestions',
      });
      _savedToMyDeeds = true;
    } catch (e) {
      debugPrint('[Share] Failed to save post to My Deeds: $e');
    }
  }

  Future<void> _confirmShareRecorded() async {
    final user = FirebaseAuth.instance.currentUser;
    final text = (_pendingShareText ?? _selectedPostText).trim();
    if (user != null && text.isNotEmpty) {
      await FirestoreService.instance.saveSocialShare(user.uid, {
        'platform': _platform,
        'reflectionDate': getDateId(),
        'reflectionSnippet': text.length > 200 ? text.substring(0, 200) : text,
      });
    }
    await _savePostToMyDeeds(text);
    if (!mounted) return;
    setState(() {
      _shareConfirmOpen = false;
      _pendingShareText = null;
    });
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          _returnTo == AppRoutes.community ? 'Post saved to My Deeds' : 'Share recorded',
        ),
      ),
    );
    if (_returnTo == AppRoutes.community) {
      context.go(AppRoutes.community);
    }
  }

  Future<_TweetUserInfo> _loadTweetUserInfo() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      return const _TweetUserInfo(displayName: 'SociTea User', username: 'socitea_user');
    }
    final prefs = await SharedPreferences.getInstance();
    final displayName =
        prefs.getString('user_display_name_${user.uid}') ?? user.displayName ?? 'SociTea User';
    final username = (user.email ?? '').split('@').first;
    final profilePicture = prefs.getString('user_profile_picture_${user.uid}');
    return _TweetUserInfo(
      displayName: displayName,
      username: username.isNotEmpty ? username : 'socitea_user',
      profilePicture: profilePicture,
    );
  }

  Widget _loadingScaffold({
    required bool isDarkMode,
    required String message,
    bool showBack = true,
    bool showSpinner = true,
  }) {
    final bg = isDarkMode ? HubColors.bg : const Color(0xFFF5F5F5);
    final textColor = isDarkMode ? HubColors.textSecondary : const Color(0xFF666666);
    return Scaffold(
      backgroundColor: bg,
      body: SafeArea(
        child: Column(
          children: [
            if (showBack)
              Align(
                alignment: Alignment.centerLeft,
                child: IconButton(
                  onPressed: _goBack,
                  icon: Icon(LucideIcons.arrowLeft, color: textColor, size: 20),
                ),
              ),
            Expanded(
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (showSpinner) ...[
                      const CircularProgressIndicator(color: HubColors.accent),
                      const SizedBox(height: 16),
                    ],
                    Text(
                      message,
                      style: TextStyle(color: textColor, fontSize: 14),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDarkMode = context.watch<ThemeNotifier>().isDarkMode;

    if (_routeInitializing) {
      return _loadingScaffold(
        isDarkMode: isDarkMode,
        message: 'Loading suggestions…',
      );
    }

    if (_reflection.isEmpty && !_isNewsMode) {
      return _loadingScaffold(
        isDarkMode: isDarkMode,
        message: _routeInitError ?? 'No content available for sharing. Tap back to return.',
        showBack: true,
        showSpinner: false,
      );
    }

    final scaffoldBg = isDarkMode ? HubColors.bg : const Color(0xFFF5F5F5);
    final cardBg = isDarkMode ? HubColors.bgSecondary : Colors.white;
    final cardBorder = isDarkMode ? HubColors.divider : const Color(0x14000000);
    final primaryText = isDarkMode ? HubColors.text : const Color(0xFF1A1A1A);
    final secondaryText = isDarkMode ? HubColors.textSecondary : const Color(0xFF666666);

    _syncReflectionController(restoreIfEmpty: true);

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) {
          if (_sharePanelOpen) {
            setState(() => _sharePanelOpen = false);
          } else {
            _goBack();
          }
        }
      },
      child: Scaffold(
        backgroundColor: scaffoldBg,
        body: SafeArea(
          child: Stack(
            children: [
              Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 448),
                  child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(4, 8, 16, 0),
                    child: Row(
                      children: [
                        IconButton(
                          onPressed: _goBack,
                              icon: Icon(LucideIcons.arrowLeft, color: secondaryText, size: 20),
                        ),
                        Expanded(
                          child: Text(
                            _headerTitle,
                            style: TextStyle(
                              color: primaryText,
                              fontSize: 18,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                      children: [
                        _SourceCard(
                          isDarkMode: isDarkMode,
                          isNewsMode: _isNewsMode,
                              isTeaArticle: _isTeaArticleShare,
                          reflection: _reflection,
                          reflectionController: _isNewsMode ? null : _reflectionController,
                          reflectionFocusNode: _isNewsMode ? null : _reflectionFocusNode,
                          onReflectionSubmitted: _isNewsMode ? null : _onReflectionRegenerate,
                          newsArticle: _newsArticle,
                              newsHeadline: _displayNewsHeadline,
                              newsSummary: _displayNewsSummary,
                              loadingNewsDetails: _loadingNewsDetails,
                          suggestionsOnly: _suggestionsOnly,
                        ),
                            const SizedBox(height: 24),
                        _PlatformSelector(
                          platform: _platform,
                          isDarkMode: isDarkMode,
                          onChanged: _onPlatformChanged,
                        ),
                            const SizedBox(height: 12),
                        Text(
                          'Choose a post to share',
                          style: TextStyle(
                            color: primaryText,
                            fontSize: 14,
                                fontWeight: FontWeight.w500,
                          ),
                        ),
                        const SizedBox(height: 12),
                        if (_loading)
                          const ListSkeleton(count: 3)
                            else if (_loadingShareImage &&
                                !isValidHubCarouselImageUrl(_shareSuggestionImageUrl)) ...[
                              const AspectRatio(
                                aspectRatio: 16 / 9,
                                child: Skeleton(variant: SkeletonVariant.image),
                              ),
                              const SizedBox(height: 12),
                              const ListSkeleton(count: 2),
                            ] else ...[
                          if (_error != null)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 8),
                              child: Text(
                                    '${_isNewsMode ? 'Using article text' : 'Using reflection'} after: $_error',
                                style: TextStyle(color: secondaryText, fontSize: 12),
                              ),
                            ),
                              FutureBuilder<_TweetUserInfo>(
                                future: _loadTweetUserInfo(),
                                builder: (context, userSnap) {
                                  final tweetUser = userSnap.data ??
                                      const _TweetUserInfo(
                                        displayName: 'SociTea User',
                                        username: 'socitea_user',
                                      );
                                  final imageUrl = _shareSuggestionImageUrl;

                                  return Column(
                                    children: List.generate(_suggestions.length, (index) {
                                final item = _suggestions[index];
                                final eventLabel = item['eventLabel'] ?? 'Post';
                                final post = item['post'] ?? '';
                                final isSelected = index == _selectedIndex;
                                      final isPosted = item['posted'] == 'true';

                                return Padding(
                                        padding: const EdgeInsets.only(bottom: 12),
                                  child: _SuggestionCard(
                                    eventLabel: eventLabel,
                                    post: post,
                                    imageUrl: imageUrl,
                                          platform: _platform,
                                    isSelected: isSelected,
                                          isPosted: isPosted,
                                    isDarkMode: isDarkMode,
                                    cardBg: cardBg,
                                    cardBorder: cardBorder,
                                          tweetUser: tweetUser,
                                    onTap: () {
                                            setState(() => _selectedIndex = index);
                                            _openSharePanel(post);
                                          },
                                        ),
                                      );
                                    }),
                                  );
                                },
                              ),
                            ],
                          ],
                        ),
                      ),
                      ],
                    ),
                  ),
              ),
              if (_sharePanelOpen)
                _SharePanelOverlay(
                  platform: _platform,
                  isDarkMode: isDarkMode,
                  text: _editableShareText,
                  imageUrl: _shareSuggestionImageUrl,
                  xCardImageUrl: _xShareImageDataUrl ?? _shareSuggestionImageUrl,
                  xCardProfileUrl: _xShareProfileDataUrl,
                  imageLoading: _loadingShareImage || _xShareAssetsLoading,
                  xScreenshotController: _xShareScreenshotController,
                  loadTweetUser: _loadTweetUserInfo,
                  onTextChanged: (v) => setState(() {
                    _editableShareText = v;
                    _syncSelectedSuggestionPost(v);
                  }),
                  onMagicPencilText: _magicPencilEditShareText,
                  onEditImage: _showShareImageEditOptions,
                  onClose: () => setState(() => _sharePanelOpen = false),
                  onSharePlatform: _openPlatformShare,
                ),
              if (_shareConfirmOpen)
                _ShareConfirmBanner(
                platform: _platform,
                onDismiss: () => setState(() {
                  _shareConfirmOpen = false;
                  _pendingShareText = null;
                }),
                onConfirm: _confirmShareRecorded,
              ),
              if (_xSharePreparing)
                const ColoredBox(
                  color: Color(0x88000000),
                  child: Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        CircularProgressIndicator(color: HubColors.accent),
                        SizedBox(height: 16),
                        Text(
                          'Preparing X post…',
                          style: TextStyle(color: Colors.white, fontSize: 14),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TweetUserInfo {
  const _TweetUserInfo({
    required this.displayName,
    required this.username,
    this.profilePicture,
  });

  final String displayName;
  final String username;
  final String? profilePicture;
}

class _SourceCard extends StatelessWidget {
  const _SourceCard({
    required this.isDarkMode,
    required this.isNewsMode,
    required this.isTeaArticle,
    required this.reflection,
    this.reflectionController,
    this.reflectionFocusNode,
    this.onReflectionSubmitted,
    required this.newsArticle,
    required this.newsHeadline,
    required this.newsSummary,
    required this.loadingNewsDetails,
    required this.suggestionsOnly,
  });

  final bool isDarkMode;
  final bool isNewsMode;
  final bool isTeaArticle;
  final String reflection;
  final TextEditingController? reflectionController;
  final FocusNode? reflectionFocusNode;
  final Future<void> Function()? onReflectionSubmitted;
  final Map<String, dynamic>? newsArticle;
  final String newsHeadline;
  final String newsSummary;
  final bool loadingNewsDetails;
  final bool suggestionsOnly;

  @override
  Widget build(BuildContext context) {
    final cardBg = isDarkMode ? HubColors.bgSecondary : Colors.white;
    final border = isDarkMode ? HubColors.divider : const Color(0x14000000);
    final primary = isDarkMode ? HubColors.text : const Color(0xFF1A1A1A);
    final secondary = isDarkMode ? HubColors.textSecondary : const Color(0xFF666666);
    final badgeColor = isNewsMode
        ? (isDarkMode ? HubColors.accentHighlight : const Color(0xFF7C3AED))
        : secondary;

    final badge = isNewsMode
        ? (isTeaArticle ? 'Tea' : (suggestionsOnly ? 'Post' : 'News'))
        : 'Create post';
    final showBadge = isNewsMode || suggestionsOnly;

    final seedTitle = cleanTeaCardTitle('${newsArticle?['title'] ?? ''}');
    final resolvedHeadline = resolveTeaDisplayTitle(
      newsHeadline.isNotEmpty ? newsHeadline : seedTitle,
      seedTitle,
    );
    final discussionUrl =
        normalizeRedditDiscussionUrl('${newsArticle?['url'] ?? ''}'.trim()) ??
            '${newsArticle?['url'] ?? ''}'.trim();
    final showBlockedRedditFallback = isTeaArticle &&
        isRedditThreadUrl(discussionUrl) &&
        !loadingNewsDetails &&
        teaCardContentIsBlocked(
          headline: newsHeadline,
          summary: newsSummary,
          description: newsArticle?['description'] as String?,
          bodyText: '${newsArticle?['text'] ?? newsArticle?['selftext'] ?? ''}',
        );
    final showYouTubeSourceFallback = isTeaArticle &&
        isYouTubeTeaUrl(discussionUrl) &&
        !loadingNewsDetails &&
        newsSummary.trim().isEmpty &&
        stripHtmlBoilerplate(newsArticle?['description'] as String?).trim().isEmpty;
    final showNewsSourceFallback = !isTeaArticle &&
        isNewsMode &&
        !loadingNewsDetails &&
        newsSummary.trim().isEmpty &&
        stripHtmlBoilerplate(newsArticle?['description'] as String?).trim().isEmpty &&
        discussionUrl.isNotEmpty;
    final publisherLabel = '${newsArticle?['source'] ?? ''}'.trim().isNotEmpty
        ? '${newsArticle?['source']}'.trim()
        : 'Publisher';

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (showBadge)
            Text(
              badge,
              style: TextStyle(
                color: badgeColor,
                fontSize: 14,
                fontWeight: FontWeight.w500,
              ),
            ),
          if (isNewsMode) ...[
            if (loadingNewsDetails &&
                newsSummary.trim().isEmpty &&
                newsHeadline.trim().isEmpty &&
                (newsArticle?['title'] as String? ?? '').trim().isEmpty) ...[
              const SizedBox(height: 12),
              const Skeleton(variant: SkeletonVariant.text, height: 16, width: 280),
              const SizedBox(height: 8),
              const Skeleton(variant: SkeletonVariant.text, height: 14, width: double.infinity),
              const SizedBox(height: 8),
              const Skeleton(variant: SkeletonVariant.text, height: 14, width: 240),
            ] else ...[
              if (resolvedHeadline.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  resolvedHeadline,
                  style: TextStyle(
                    color: primary,
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    height: 1.35,
                  ),
                ),
              ],
              if (showBlockedRedditFallback) ...[
                const SizedBox(height: 8),
                Text(
                  'Source: Reddit',
                  style: TextStyle(color: secondary, fontSize: 14, height: 1.45),
                ),
                const SizedBox(height: 4),
                InkWell(
                  onTap: () async {
                    final uri = Uri.tryParse(discussionUrl);
                    if (uri == null) return;
                    if (await canLaunchUrl(uri)) {
                      await launchUrl(uri, mode: LaunchMode.externalApplication);
                    }
                  },
                  child: Text(
                    'Tap to view the original discussion →',
                    style: TextStyle(
                      color: isDarkMode ? HubColors.accentHighlight : const Color(0xFF7C3AED),
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                      height: 1.45,
                    ),
                  ),
                ),
              ] else if (showYouTubeSourceFallback) ...[
                const SizedBox(height: 8),
                Text(
                  'Source: YouTube',
                  style: TextStyle(color: secondary, fontSize: 14, height: 1.45),
                ),
                const SizedBox(height: 4),
                InkWell(
                  onTap: () async {
                    final uri = Uri.tryParse(discussionUrl);
                    if (uri == null) return;
                    if (await canLaunchUrl(uri)) {
                      await launchUrl(uri, mode: LaunchMode.externalApplication);
                    }
                  },
                  child: Text(
                    'Tap to watch the original video →',
                    style: TextStyle(
                      color: isDarkMode ? HubColors.accentHighlight : const Color(0xFF7C3AED),
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                      height: 1.45,
                    ),
                  ),
                ),
              ] else if (showNewsSourceFallback) ...[
                const SizedBox(height: 8),
                Text(
                  'Source: $publisherLabel',
                  style: TextStyle(color: secondary, fontSize: 14, height: 1.45),
                ),
                const SizedBox(height: 4),
                InkWell(
                  onTap: () async {
                    final uri = Uri.tryParse(discussionUrl);
                    if (uri == null) return;
                    if (await canLaunchUrl(uri)) {
                      await launchUrl(uri, mode: LaunchMode.externalApplication);
                    }
                  },
                  child: Text(
                    'Tap to read the full story →',
                    style: TextStyle(
                      color: isDarkMode ? HubColors.accentHighlight : const Color(0xFF7C3AED),
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                      height: 1.45,
                    ),
                  ),
                ),
              ] else if (loadingNewsDetails && newsSummary.trim().isEmpty) ...[
                const SizedBox(height: 8),
                const Skeleton(variant: SkeletonVariant.text, height: 14, width: double.infinity),
                const SizedBox(height: 8),
                const Skeleton(variant: SkeletonVariant.text, height: 14, width: double.infinity),
                const SizedBox(height: 8),
                const Skeleton(variant: SkeletonVariant.text, height: 14, width: 220),
              ] else if (newsSummary.trim().isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                  newsSummary,
                  style: TextStyle(color: primary, fontSize: 15, height: 1.45),
                ),
              ] else if (!isTeaArticle &&
                  stripHtmlBoilerplate(newsArticle?['description'] as String?).isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  stripHtmlBoilerplate(newsArticle?['description'] as String?),
                style: TextStyle(color: primary, fontSize: 15, height: 1.45),
              ),
            ],
            ],
          ] else if (reflectionController != null) ...[
            _EditableReflectionField(
              reflection: reflection,
              controller: reflectionController!,
              focusNode: reflectionFocusNode,
              onSubmitted: onReflectionSubmitted,
              textStyle: TextStyle(color: primary, fontSize: 15, height: 1.45),
            ),
          ] else ...[
            Text(
              reflection,
              style: TextStyle(color: primary, fontSize: 15, height: 1.45),
            ),
          ],
        ],
      ),
    );
  }
}

class _EditableReflectionField extends StatefulWidget {
  const _EditableReflectionField({
    required this.reflection,
    required this.controller,
    required this.textStyle,
    this.focusNode,
    this.onSubmitted,
  });

  final String reflection;
  final TextEditingController controller;
  final FocusNode? focusNode;
  final Future<void> Function()? onSubmitted;
  final TextStyle textStyle;

  @override
  State<_EditableReflectionField> createState() => _EditableReflectionFieldState();
}

class _EditableReflectionFieldState extends State<_EditableReflectionField> {
  @override
  void initState() {
    super.initState();
    _seedControllerFromReflection(force: true);
  }

  @override
  void didUpdateWidget(_EditableReflectionField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.reflection != oldWidget.reflection) {
      _seedControllerFromReflection(force: widget.controller.text.trim().isEmpty);
    }
  }

  void _seedControllerFromReflection({bool force = false}) {
    final source = widget.reflection.trim();
    if (source.isEmpty) return;
    if (force || widget.controller.text.trim().isEmpty) {
      if (widget.controller.text != source) {
        widget.controller.text = source;
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      onKeyEvent: (node, event) {
        if (widget.onSubmitted == null) return KeyEventResult.ignored;
        if (event is! KeyDownEvent) return KeyEventResult.ignored;
        if (event.logicalKey != LogicalKeyboardKey.enter) return KeyEventResult.ignored;
        if (HardwareKeyboard.instance.isShiftPressed) return KeyEventResult.ignored;
        unawaited(widget.onSubmitted!());
        return KeyEventResult.handled;
      },
      child: TextField(
        controller: widget.controller,
        focusNode: widget.focusNode,
        maxLines: null,
        minLines: 1,
        style: widget.textStyle,
        decoration: const InputDecoration(
          border: InputBorder.none,
          isDense: true,
          contentPadding: EdgeInsets.zero,
        ),
        textInputAction: TextInputAction.done,
        onSubmitted: (_) => unawaited(widget.onSubmitted?.call()),
      ),
    );
  }
}

class _PlatformSelector extends StatelessWidget {
  const _PlatformSelector({
    required this.platform,
    required this.isDarkMode,
    required this.onChanged,
  });

  final String platform;
  final bool isDarkMode;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        _PlatformButton(
          id: 'linkedin',
          selected: platform == 'linkedin',
          isDarkMode: isDarkMode,
          onTap: () => onChanged('linkedin'),
          child: Text(
            'in',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.92),
              fontSize: 24,
              fontWeight: FontWeight.w600,
              height: 1,
            ),
          ),
        ),
        const SizedBox(width: 20),
        _PlatformButton(
          id: 'x',
          selected: platform == 'x',
          isDarkMode: isDarkMode,
          onTap: () => onChanged('x'),
          child: CustomPaint(
            size: const Size(18, 18),
            painter: _XLogoPainter(color: Colors.white.withValues(alpha: 0.92)),
          ),
        ),
        const SizedBox(width: 20),
        _PlatformButton(
          id: 'reddit',
          selected: platform == 'reddit',
          isDarkMode: isDarkMode,
          onTap: () => onChanged('reddit'),
          child: ColorFiltered(
            colorFilter: const ColorFilter.matrix([
              0.2126, 0.7152, 0.0722, 0, 0,
              0.2126, 0.7152, 0.0722, 0, 0,
              0.2126, 0.7152, 0.0722, 0, 0,
              0, 0, 0, 0.92, 0,
            ]),
            child: Image.asset(
              'assets/images/reddit-logo-mono.webp',
              width: 31,
              height: 31,
              fit: BoxFit.contain,
            ),
          ),
        ),
      ],
    );
  }
}

class _PlatformButton extends StatelessWidget {
  const _PlatformButton({
    required this.id,
    required this.selected,
    required this.isDarkMode,
    required this.onTap,
    required this.child,
  });

  final String id;
  final bool selected;
  final bool isDarkMode;
  final VoidCallback onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          width: 48,
          height: 48,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: selected
                ? HubColors.accent.withValues(alpha: 0.16)
                : Colors.white.withValues(alpha: isDarkMode ? 0.04 : 0.8),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: selected
                  ? HubColors.accent
                  : Colors.white.withValues(alpha: isDarkMode ? 0.06 : 0.12),
              width: 2,
            ),
            boxShadow: selected
                ? [
                    BoxShadow(
                      color: HubColors.accent.withValues(alpha: 0.18),
                      blurRadius: 0,
                      spreadRadius: 3,
                    ),
                  ]
                : null,
          ),
          child: Opacity(
            opacity: selected ? 1 : 0.72,
            child: child,
          ),
        ),
      ),
    );
  }
}

class _XLogoPainter extends CustomPainter {
  _XLogoPainter({required this.color});

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = color;
    final scale = size.width / 24;
    final path = Path()
      ..moveTo(18.244 * scale, 2 * scale)
      ..lineTo(21.62 * scale, 2 * scale)
      ..lineTo(14.24 * scale, 10.436 * scale)
      ..lineTo(22.92 * scale, 22 * scale)
      ..lineTo(16.12 * scale, 22 * scale)
      ..lineTo(10.8 * scale, 15.04 * scale)
      ..lineTo(4.69 * scale, 22 * scale)
      ..lineTo(1.31 * scale, 22 * scale)
      ..lineTo(9.21 * scale, 12.96 * scale)
      ..lineTo(1.08 * scale, 2 * scale)
      ..lineTo(8.05 * scale, 2 * scale)
      ..lineTo(12.86 * scale, 8.3 * scale)
      ..close();
    canvas.drawPath(path, paint);

    final path2 = Path()
      ..moveTo(17.054 * scale, 20 * scale)
      ..lineTo(18.924 * scale, 20 * scale)
      ..lineTo(6.99 * scale, 3.95 * scale)
      ..lineTo(4.98 * scale, 3.95 * scale)
      ..close();
    canvas.drawPath(path2, paint);
  }

  @override
  bool shouldRepaint(covariant _XLogoPainter oldDelegate) => oldDelegate.color != color;
}

class _SuggestionCard extends StatelessWidget {
  const _SuggestionCard({
    required this.eventLabel,
    required this.post,
    required this.imageUrl,
    required this.platform,
    required this.isSelected,
    required this.isPosted,
    required this.isDarkMode,
    required this.cardBg,
    required this.cardBorder,
    required this.tweetUser,
    required this.onTap,
  });

  final String eventLabel;
  final String post;
  final String? imageUrl;
  final String platform;
  final bool isSelected;
  final bool isPosted;
  final bool isDarkMode;
  final Color cardBg;
  final Color cardBorder;
  final _TweetUserInfo tweetUser;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final borderColor = isSelected
        ? (isDarkMode ? HubColors.accentHighlight : const Color(0xFF7C3AED))
        : cardBorder;

    Widget cardContent;
    if (platform == 'x' && imageUrl != null && imageUrl!.isNotEmpty) {
      cardContent = Padding(
        padding: const EdgeInsets.all(12),
          child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              eventLabel,
              style: TextStyle(
                color: isDarkMode ? HubColors.accentHighlight : const Color(0xFF7C3AED),
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.topCenter,
                child: TweetShareCard(
                  width: 360,
                  displayName: tweetUser.displayName,
                  username: tweetUser.username,
                  text: post,
                  imageUrl: imageUrl,
                  profileImageUrl: tweetUser.profilePicture,
                ),
              ),
            ),
          ],
        ),
      );
    } else {
      cardContent = Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (imageUrl != null && imageUrl!.isNotEmpty)
            AspectRatio(
                    aspectRatio: 16 / 9,
                    child: _SuggestionImage(url: imageUrl!, isDarkMode: isDarkMode),
                  ),
          Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        eventLabel,
                        style: const TextStyle(
                          color: HubColors.accent,
                          fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                            post,
                            style: TextStyle(
                              color: isDarkMode ? HubColors.text : const Color(0xFF333333),
                              fontSize: 14,
                              height: 1.5,
                            ),
                          ),
              ],
                        ),
                      ),
                    ],
      );
    }

    return AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      transform: Matrix4.translationValues(0, isSelected ? -2 : 0, 0),
      child: Material(
        color: cardBg,
        borderRadius: BorderRadius.circular(12),
        elevation: isSelected ? 8 : 0,
        shadowColor: Colors.black.withValues(alpha: 0.45),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: borderColor,
                width: isSelected ? 1.5 : 1,
              ),
              boxShadow: isSelected
                  ? [
                      BoxShadow(
                        color: HubColors.accent.withValues(alpha: 0.5),
                        blurRadius: 0,
                        spreadRadius: 0.5,
                      ),
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.6),
                        blurRadius: 30,
                        offset: const Offset(0, 12),
                      ),
                    ]
                  : null,
            ),
            child: ColorFiltered(
              colorFilter: isPosted
                  ? const ColorFilter.matrix([
                      0.2126, 0.7152, 0.0722, 0, 0,
                      0.2126, 0.7152, 0.0722, 0, 0,
                      0.2126, 0.7152, 0.0722, 0, 0,
                      0, 0, 0, 1, 0,
                    ])
                  : const ColorFilter.matrix([
                      1, 0, 0, 0, 0,
                      0, 1, 0, 0, 0,
                      0, 0, 1, 0, 0,
                      0, 0, 0, 1, 0,
                    ]),
              child: Opacity(
                opacity: isPosted && !isSelected ? 0.7 : 1,
                child: cardContent,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SuggestionImage extends StatelessWidget {
  const _SuggestionImage({required this.url, required this.isDarkMode});

  final String url;
  final bool isDarkMode;

  @override
  Widget build(BuildContext context) {
    if (url.startsWith('data:image')) {
      final bytes = decodeDataImageUrlBytes(url, logTag: '[ImageGen] render');
      if (bytes != null) {
        debugPrint('[ImageGen] widget render success (_SuggestionImage)');
        return Image.memory(bytes, fit: BoxFit.cover);
      }
      return _placeholder();
    }
    return Image.network(
      url,
      fit: BoxFit.cover,
      errorBuilder: (_, __, ___) => _placeholder(),
    );
  }

  Widget _placeholder() {
    return Container(
      color: isDarkMode ? Colors.black26 : Colors.black12,
      alignment: Alignment.center,
      child: Icon(Icons.image_outlined, color: HubColors.textSecondary.withValues(alpha: 0.5)),
    );
  }
}

enum _ShareImageEditAction { useAiImage, useSourceImage, replace, magicPencil, magicWand, delete }

enum _ShareTextEditAction { edit, magicPencil }

class _SharePanelOverlay extends StatefulWidget {
  const _SharePanelOverlay({
    required this.platform,
    required this.isDarkMode,
    required this.text,
    required this.imageUrl,
    required this.xCardImageUrl,
    required this.xCardProfileUrl,
    required this.imageLoading,
    required this.xScreenshotController,
    required this.loadTweetUser,
    required this.onTextChanged,
    required this.onMagicPencilText,
    required this.onEditImage,
    required this.onClose,
    required this.onSharePlatform,
  });

  final String platform;
  final bool isDarkMode;
  final String text;
  final String? imageUrl;
  final String? xCardImageUrl;
  final String? xCardProfileUrl;
  final bool imageLoading;
  final ScreenshotController xScreenshotController;
  final Future<_TweetUserInfo> Function() loadTweetUser;
  final ValueChanged<String> onTextChanged;
  final Future<String> Function(String text, String instruction) onMagicPencilText;
  final void Function(String currentCaption) onEditImage;
  final VoidCallback onClose;
  final void Function([_XShareMode mode]) onSharePlatform;

  @override
  State<_SharePanelOverlay> createState() => _SharePanelOverlayState();
}

class _SharePanelOverlayState extends State<_SharePanelOverlay> {
  late final TextEditingController _controller;
  bool _textMagicPencilLoading = false;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.text);
  }

  @override
  void didUpdateWidget(_SharePanelOverlay oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.text != oldWidget.text && widget.text != _controller.text) {
      _controller.text = widget.text;
    }
  }

  Future<void> _openTextMagicPencil() async {
    if (_textMagicPencilLoading) return;

    final instruction = await showDialog<String>(
      context: context,
      builder: (ctx) => _TextMagicPencilDialog(
        isDarkMode: widget.isDarkMode,
      ),
    );
    if (instruction == null || instruction.trim().isEmpty || !mounted) return;

    setState(() => _textMagicPencilLoading = true);
    try {
      final edited = await widget.onMagicPencilText(
        _controller.text,
        instruction.trim(),
      );
      if (!mounted) return;
      if (edited.trim().isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not rewrite text — try again')),
        );
        return;
      }
      _controller.text = edited;
      _controller.selection = TextSelection.collapsed(offset: edited.length);
      widget.onTextChanged(edited);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Text edit failed: $e')),
      );
    } finally {
      if (mounted) setState(() => _textMagicPencilLoading = false);
    }
  }

  Future<void> _openDirectTextEditDialog() async {
    final updated = await showDialog<String>(
      context: context,
      builder: (ctx) => _ShareTextEditDialog(
        isDarkMode: widget.isDarkMode,
        initialText: _controller.text,
      ),
    );
    if (updated == null || !mounted) return;
    final trimmed = updated.trim();
    if (trimmed.isEmpty) return;
    _controller.text = trimmed;
    _controller.selection = TextSelection.collapsed(offset: trimmed.length);
    widget.onTextChanged(trimmed);
  }

  Future<void> _showShareTextEditOptions() async {
    final action = await showModalBottomSheet<_ShareTextEditAction>(
      context: context,
      isDismissible: true,
      enableDrag: true,
      backgroundColor: widget.isDarkMode ? HubColors.bgSecondary : Colors.white,
      barrierColor: Colors.black54,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) {
        final primary = widget.isDarkMode ? HubColors.text : const Color(0xFF1A1A1A);
        final secondary = widget.isDarkMode ? HubColors.textSecondary : const Color(0xFF666666);
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(8, 12, 8, 8),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  child: Text(
                    'Text options',
                    style: TextStyle(color: primary, fontSize: 16, fontWeight: FontWeight.w600),
                  ),
                ),
                ListTile(
                  leading: Icon(LucideIcons.pencil, color: primary),
                  title: Text('Edit text', style: TextStyle(color: primary)),
                  subtitle: Text(
                    'Type your caption directly',
                    style: TextStyle(color: secondary, fontSize: 12),
                  ),
                  onTap: () => Navigator.pop(ctx, _ShareTextEditAction.edit),
                ),
                ListTile(
                  leading: Icon(LucideIcons.penLine, color: primary),
                  title: Text('Magic pencil', style: TextStyle(color: primary)),
                  subtitle: Text(
                    'Rewrite with AI instructions',
                    style: TextStyle(color: secondary, fontSize: 12),
                  ),
                  onTap: () => Navigator.pop(ctx, _ShareTextEditAction.magicPencil),
                ),
              ],
            ),
          ),
        );
      },
    );

    if (!mounted || action == null) return;
    switch (action) {
      case _ShareTextEditAction.edit:
        await _openDirectTextEditDialog();
      case _ShareTextEditAction.magicPencil:
        await _openTextMagicPencil();
    }
  }

  Widget _buildXCardEditButton({
    required VoidCallback? onPressed,
    required String tooltip,
    required IconData icon,
    double iconRotation = 0,
  }) {
    return Material(
      color: Colors.black.withValues(alpha: 0.55),
      shape: const CircleBorder(),
      clipBehavior: Clip.antiAlias,
      child: IconButton(
        onPressed: onPressed,
        tooltip: tooltip,
        icon: Transform.rotate(
          angle: iconRotation,
          child: Icon(icon, color: Colors.white, size: 18),
        ),
        visualDensity: VisualDensity.compact,
        padding: const EdgeInsets.all(8),
        constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
      ),
    );
  }

  double _xCardTextHeight(String text, double cardWidth) {
    const textStyle = TextStyle(fontSize: 16, height: 1.45, color: Color(0xFF0F1419));
    final painter = TextPainter(
      text: TextSpan(text: text, style: textStyle),
      textDirection: TextDirection.ltr,
      maxLines: null,
    )..layout(maxWidth: cardWidth - 40);
    return painter.height;
  }

  Widget _buildXCardPreview(_TweetUserInfo tweetUser) {
    const cardWidth = 360.0;
    const cardPadding = 20.0;
    const headerHeight = 48.0;
    const headerTextGap = 12.0;
    const textImageGap = 16.0;
    const textTop = cardPadding + headerHeight + headerTextGap;
    final textHeight = _xCardTextHeight(_controller.text, cardWidth);
    final hasImage = widget.xCardImageUrl != null && widget.xCardImageUrl!.trim().isNotEmpty;
    final imageWidth = cardWidth - 40;
    final imageHeight = imageWidth * 9 / 16;
    final imageTop = textTop + textHeight + (hasImage ? textImageGap : 0);

    return Expanded(
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  Screenshot(
                    controller: widget.xScreenshotController,
                    child: TweetShareCard(
                      width: cardWidth,
                      displayName: tweetUser.displayName,
                      username: tweetUser.username,
                      text: _controller.text,
                      imageUrl: widget.xCardImageUrl,
                      profileImageUrl: widget.xCardProfileUrl ?? tweetUser.profilePicture,
                    ),
                  ),
                  Positioned(
                    top: textTop,
                    right: 8,
                    child: _buildXCardEditButton(
                      onPressed: _textMagicPencilLoading ? null : _showShareTextEditOptions,
                      tooltip: 'Edit text',
                      icon: LucideIcons.pencil,
                    ),
                  ),
                  if (hasImage)
                    Positioned(
                      top: imageTop + 10,
                      right: 28,
                      child: _buildXCardEditButton(
                        onPressed: widget.imageLoading
                            ? null
                            : () => widget.onEditImage(_controller.text),
                        tooltip: 'Edit image',
                        icon: LucideIcons.pencil,
                        iconRotation: -0.45,
                      ),
                    ),
                  if (_textMagicPencilLoading)
                    Positioned(
                      top: textTop,
                      left: cardPadding,
                      right: cardPadding,
                      height: textHeight,
                      child: Container(
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.25),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        alignment: Alignment.center,
                        child: const SizedBox(
                          width: 28,
                          height: 28,
                          child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
                        ),
                      ),
                    ),
                  if (widget.imageLoading && hasImage)
                    Positioned(
                      top: imageTop,
                      left: cardPadding,
                      width: imageWidth,
                      height: imageHeight,
                      child: Container(
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.35),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        alignment: Alignment.center,
                        child: const SizedBox(
                          width: 28,
                          height: 28,
                          child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Color get _shareButtonColor {
    switch (widget.platform) {
      case 'linkedin':
        return const Color(0xFF0A66C2);
      case 'x':
        return const Color(0xFF1D9BF0);
      case 'reddit':
        return const Color(0xFFFF4500);
      default:
        return HubColors.divider;
    }
  }

  bool get _isXCardShare =>
      widget.platform == 'x' &&
      widget.imageUrl != null &&
      widget.imageUrl!.trim().isNotEmpty;

  Widget _buildCaptionEditor(Color primary) {
    return Stack(
      children: [
        TextField(
          controller: _controller,
          onChanged: widget.onTextChanged,
          maxLines: _isXCardShare ? 4 : null,
          expands: !_isXCardShare,
          readOnly: _textMagicPencilLoading,
          style: TextStyle(color: primary, fontSize: 15, height: 1.45),
          decoration: InputDecoration(
            hintText: 'Your post...',
            filled: true,
            fillColor: widget.isDarkMode ? HubColors.bg : const Color(0xFFF5F5F5),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(
                color: widget.isDarkMode ? HubColors.divider : const Color(0x1F000000),
              ),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(
                color: widget.isDarkMode ? HubColors.divider : const Color(0x1F000000),
              ),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: HubColors.accent, width: 2),
            ),
          ),
        ),
        Positioned(
          top: 8,
          right: 8,
          child: Material(
            color: Colors.black.withValues(alpha: 0.55),
            shape: const CircleBorder(),
            clipBehavior: Clip.antiAlias,
            child: IconButton(
              onPressed: _textMagicPencilLoading ? null : _openTextMagicPencil,
              tooltip: 'Magic pencil',
              icon: const Icon(LucideIcons.penLine, color: Colors.white, size: 18),
              visualDensity: VisualDensity.compact,
              padding: const EdgeInsets.all(8),
              constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
            ),
          ),
        ),
        if (_textMagicPencilLoading)
          Positioned.fill(
            child: Container(
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.35),
                borderRadius: BorderRadius.circular(12),
              ),
              alignment: Alignment.center,
              child: const SizedBox(
                width: 28,
                height: 28,
                child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
              ),
            ),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final bg = widget.isDarkMode ? HubColors.bgSecondary : Colors.white;
    final primary = widget.isDarkMode ? HubColors.text : const Color(0xFF1A1A1A);

    return Material(
      color: Colors.black.withValues(alpha: 0.5),
      child: SafeArea(
        child: Container(
          width: double.infinity,
          height: double.infinity,
          color: bg,
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  IconButton(
                    onPressed: widget.onClose,
                    icon: Icon(LucideIcons.arrowLeft, color: primary),
                  ),
                  Text(
                    _isXCardShare ? 'Preview before sharing' : 'Edit before sharing',
                    style: TextStyle(
                      color: primary,
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
              if (_isXCardShare)
                FutureBuilder<_TweetUserInfo>(
                  future: widget.loadTweetUser(),
                  builder: (context, snap) {
                    final tweetUser = snap.data ??
                        const _TweetUserInfo(
                          displayName: 'SociTea User',
                          username: 'socitea_user',
                        );
                    if (widget.imageLoading &&
                        (widget.xCardImageUrl == null || !widget.xCardImageUrl!.startsWith('data:image'))) {
                      return const Expanded(
                        child: Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              CircularProgressIndicator(color: HubColors.accent),
                              SizedBox(height: 12),
                              Text(
                                'Loading image for share preview…',
                                style: TextStyle(color: HubColors.textSecondary, fontSize: 13),
                              ),
                            ],
                          ),
                        ),
                      );
                    }
                    return _buildXCardPreview(tweetUser);
                  },
                )
              else ...[
                if (widget.imageUrl != null && widget.imageUrl!.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Stack(
                    alignment: Alignment.topRight,
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(12),
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(maxHeight: 220),
                          child: _SuggestionImage(
                            url: widget.imageUrl!,
                            isDarkMode: widget.isDarkMode,
                          ),
                        ),
                      ),
                      Positioned(
                        top: 8,
                        right: 8,
                        child: Material(
                          color: Colors.black.withValues(alpha: 0.55),
                          shape: const CircleBorder(),
                          clipBehavior: Clip.antiAlias,
                          child: IconButton(
                            onPressed: widget.imageLoading
                                ? null
                                : () => widget.onEditImage(_controller.text),
                            tooltip: 'Edit image',
                            icon: const Icon(LucideIcons.pencil, color: Colors.white, size: 18),
                            visualDensity: VisualDensity.compact,
                            padding: const EdgeInsets.all(8),
                            constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
                          ),
                        ),
                      ),
                      if (widget.imageLoading)
                        Positioned.fill(
                          child: Container(
                            decoration: BoxDecoration(
                              color: Colors.black.withValues(alpha: 0.45),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            alignment: Alignment.center,
                            child: const SizedBox(
                              width: 28,
                              height: 28,
                              child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
                            ),
                          ),
                        ),
                    ],
                  ),
                ],
                const SizedBox(height: 12),
                Expanded(child: _buildCaptionEditor(primary)),
              ],
              const SizedBox(height: 16),
              if (_isXCardShare) ...[
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: () => widget.onSharePlatform(_XShareMode.cardImage),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _shareButtonColor,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: const Text(
                      'Share as card image',
                      style: TextStyle(fontWeight: FontWeight.w500),
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton(
                    onPressed: () => widget.onSharePlatform(_XShareMode.imageAndCaption),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: _shareButtonColor,
                      side: BorderSide(color: _shareButtonColor),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: const Text(
                      'Share image + copy text',
                      style: TextStyle(fontWeight: FontWeight.w500),
                    ),
                  ),
                ),
              ] else
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: () => widget.onSharePlatform(),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _shareButtonColor,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: const Text('Share', style: TextStyle(fontWeight: FontWeight.w500)),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ShareConfirmBanner extends StatelessWidget {
  const _ShareConfirmBanner({
    required this.platform,
    required this.onDismiss,
    required this.onConfirm,
  });

  final String platform;
  final VoidCallback onDismiss;
  final VoidCallback onConfirm;

  String get _platformName {
    switch (platform) {
      case 'linkedin':
        return 'LinkedIn';
      case 'x':
        return 'X';
      case 'reddit':
        return 'Reddit';
      default:
        return platform;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Positioned(
      left: 16,
      right: 16,
      bottom: 24,
      child: Material(
        color: const Color(0xF2111827),
        borderRadius: BorderRadius.circular(16),
        elevation: 8,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Did that look good on $_platformName?',
                style: const TextStyle(color: Colors.white, fontSize: 13),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: TextButton(
                      onPressed: onDismiss,
                      child: const Text(
                        'Not yet',
                        style: TextStyle(color: Colors.white70, fontSize: 12),
                      ),
                    ),
                  ),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: onConfirm,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.white,
                        foregroundColor: Colors.black87,
                        padding: const EdgeInsets.symmetric(vertical: 10),
                      ),
                      child: const Text('Yes, I posted!', style: TextStyle(fontSize: 12)),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ImagePromptEditDialog extends StatefulWidget {
  const _ImagePromptEditDialog({
    required this.isDarkMode,
  });

  final bool isDarkMode;

  @override
  State<_ImagePromptEditDialog> createState() => _ImagePromptEditDialogState();
}

class _ImagePromptEditDialogState extends State<_ImagePromptEditDialog> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final primary = widget.isDarkMode ? HubColors.text : const Color(0xFF1A1A1A);
    final fill = widget.isDarkMode ? HubColors.bg : const Color(0xFFF5F5F5);
    final border = widget.isDarkMode ? HubColors.divider : const Color(0x1F000000);

    return AlertDialog(
      backgroundColor: widget.isDarkMode ? HubColors.bgSecondary : Colors.white,
      title: Text('Magic pencil', style: TextStyle(color: primary, fontSize: 18)),
      content: SizedBox(
        width: double.maxFinite,
        child: TextField(
          controller: _controller,
          autofocus: true,
          maxLines: 4,
          minLines: 2,
          style: TextStyle(color: primary, fontSize: 14, height: 1.4),
          decoration: InputDecoration(
            hintText: 'e.g. Zoom in on the product, warmer lighting…',
            filled: true,
            fillColor: fill,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: border)),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: border)),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: HubColors.accent, width: 2),
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text('Cancel', style: TextStyle(color: primary.withValues(alpha: 0.7))),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, _controller.text),
          style: FilledButton.styleFrom(backgroundColor: HubColors.accent),
          child: const Text('Regenerate'),
        ),
      ],
    );
  }
}

class _TextMagicPencilDialog extends StatefulWidget {
  const _TextMagicPencilDialog({required this.isDarkMode});

  final bool isDarkMode;

  @override
  State<_TextMagicPencilDialog> createState() => _TextMagicPencilDialogState();
}

class _TextMagicPencilDialogState extends State<_TextMagicPencilDialog> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final primary = widget.isDarkMode ? HubColors.text : const Color(0xFF1A1A1A);
    final fill = widget.isDarkMode ? HubColors.bg : const Color(0xFFF5F5F5);
    final border = widget.isDarkMode ? HubColors.divider : const Color(0x1F000000);

    return AlertDialog(
      backgroundColor: widget.isDarkMode ? HubColors.bgSecondary : Colors.white,
      title: Text('Magic pencil', style: TextStyle(color: primary, fontSize: 18)),
      content: SizedBox(
        width: double.maxFinite,
        child: TextField(
          controller: _controller,
          autofocus: true,
          maxLines: 4,
          minLines: 2,
          style: TextStyle(color: primary, fontSize: 14, height: 1.4),
          decoration: InputDecoration(
            hintText: 'e.g. Make it shorter, more casual, add humor…',
            filled: true,
            fillColor: fill,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: border)),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: border)),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: HubColors.accent, width: 2),
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text('Cancel', style: TextStyle(color: primary.withValues(alpha: 0.7))),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, _controller.text),
          style: FilledButton.styleFrom(backgroundColor: HubColors.accent),
          child: const Text('Apply'),
        ),
      ],
    );
  }
}

class _ShareTextEditDialog extends StatefulWidget {
  const _ShareTextEditDialog({
    required this.isDarkMode,
    required this.initialText,
  });

  final bool isDarkMode;
  final String initialText;

  @override
  State<_ShareTextEditDialog> createState() => _ShareTextEditDialogState();
}

class _ShareTextEditDialogState extends State<_ShareTextEditDialog> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initialText);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final primary = widget.isDarkMode ? HubColors.text : const Color(0xFF1A1A1A);
    final fill = widget.isDarkMode ? HubColors.bg : const Color(0xFFF5F5F5);
    final border = widget.isDarkMode ? HubColors.divider : const Color(0x1F000000);

    return AlertDialog(
      backgroundColor: widget.isDarkMode ? HubColors.bgSecondary : Colors.white,
      title: Text('Edit text', style: TextStyle(color: primary, fontSize: 18)),
      content: SizedBox(
        width: double.maxFinite,
        child: TextField(
          controller: _controller,
          autofocus: true,
          maxLines: 6,
          minLines: 3,
          style: TextStyle(color: primary, fontSize: 15, height: 1.45),
          decoration: InputDecoration(
            hintText: 'Your post...',
            filled: true,
            fillColor: fill,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: border)),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: border)),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: HubColors.accent, width: 2),
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text('Cancel', style: TextStyle(color: primary.withValues(alpha: 0.7))),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, _controller.text),
          style: FilledButton.styleFrom(backgroundColor: HubColors.accent),
          child: const Text('Save'),
        ),
      ],
    );
  }
}
