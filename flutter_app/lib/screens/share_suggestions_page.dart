import 'dart:async';

import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import '../components/skeleton/list_skeleton.dart';
import '../components/skeleton/skeleton.dart';
import '../components/tweet_share_card.dart';
import '../contexts/theme_context.dart';
import '../router/app_router.dart';
import '../services/chat_service.dart';
import '../services/firestore_service.dart';
import '../utils/date_utils.dart';
import '../utils/hub_colors.dart';
import '../utils/reddit_thread_comments.dart';
import '../utils/share_news_cache.dart';

class ShareSuggestionsPage extends StatefulWidget {
  const ShareSuggestionsPage({super.key});

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
  String? _pendingShareText;
  String _editableShareText = '';

  bool get _isNewsMode => _newsArticle != null;

  bool get _isTeaArticleShare =>
      _isNewsMode &&
      (isTeaSourceLabel(_newsArticle?['source'] as String?) ||
          isRedditTeaThreadUrl(_newsArticle?['url'] as String?));

  @override
  void initState() {
    super.initState();
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
    _platform = extra['platform'] as String? ?? 'linkedin';
    _returnTo = extra['returnTo'] as String? ?? AppRoutes.dashboard;
    _suggestionsOnly = extra['suggestionsOnly'] == true;

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
      final headline = '${_newsArticle?['title'] ?? ''}'.trim();
      if (headline.isNotEmpty) _newsCardHeadline = headline;
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
      final url = '${_newsArticle?['url'] ?? ''}'.trim();
      final needsRedditContent = _isTeaArticleShare || isRedditThreadUrl(url);
      if (needsRedditContent) {
        await _loadNewsCardDetails();
      }
      await _loadSuggestions();
    } else {
      await _loadSuggestions();
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
              !teaCardSummaryTooLong(summary) &&
              !teaCardSummaryLooksLikeRawScrape(summary, cachedDetails));
      if (cacheUsable) {
        if (isTea) {
          final cleaned = sanitizeTeaShareText(summary);
          if (cleaned != summary) {
            summary = cleaned;
            await upsertCachedNewsCard(
              url: url,
              headline: headline,
              summary: cleaned,
              details: cachedDetails,
              source: source,
            );
          }
        }
        if (!mounted) return;
        setState(() {
          _newsArticleDetails = cachedDetails;
          _newsCardSummary = summary;
          _newsCardHeadline = headline;
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
          .timeout(const Duration(seconds: 12));
      final looksUseful = details['title'] != null ||
          details['description'] != null ||
          details['text'] != null ||
          details['image'] != null;
      effective = looksUseful ? details : null;
    }

    if (effective == null) return;
    final articleDetails = effective;

    final gossipFallback = isTea ? '' : buildRedditGossipSummary(articleDetails);
    final localTeaFallback = isTea ? buildLocalTeaCardSummary(articleDetails) : '';

    final results = await Future.wait<String>([
      ChatService.instance
          .summarizeNewsArticle(
            articleDetails,
            {
              'minWords': isTea ? 35 : 60,
              'maxWords': isTea ? teaCardSummaryMaxWords : 80,
              'isTeaGossip': isTea,
            },
          )
          .timeout(
            const Duration(seconds: 20),
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
        teaCardSummaryLooksLikeRawScrape(finalSummary, articleDetails)) {
      finalSummary = localTeaFallback;
    }
    if (isTea) {
      finalSummary = clampTeaCardSummaryWords(sanitizeTeaShareText(finalSummary));
    }
    var finalHeadline = results[1].trim();
    if (finalHeadline.isEmpty) {
      finalHeadline =
          (articleDetails['title'] as String? ?? _newsArticle?['title'] as String? ?? '').trim();
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
    return _newsCardHeadline.isNotEmpty
        ? _newsCardHeadline
        : (_newsArticle?['title'] as String? ?? '');
  }

  String get _displayNewsSummary {
    if (!_isNewsMode) return '';
    if (_loadingNewsDetails) return '';
    if (_newsCardSummary.isNotEmpty) {
      if (_isTeaArticleShare &&
          teaCardSummaryLooksLikeRawScrape(
            _newsCardSummary,
            _newsArticleDetails ?? _newsArticle,
          )) {
        return '';
      }
      return _isTeaArticleShare
          ? clampTeaCardSummaryWords(_newsCardSummary)
          : _newsCardSummary;
    }
    if (_isTeaArticleShare) {
      return buildLocalTeaCardSummary(_newsArticleDetails ?? _newsArticle);
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
    if (_suggestions.isEmpty) return _baselineText;
    final item = _suggestions[_selectedIndex.clamp(0, _suggestions.length - 1)];
    return item['post'] ?? _baselineText;
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
        try {
          items = await ChatService.instance
              .generateSocialPostSuggestions(_reflection, _platform)
              .timeout(const Duration(seconds: 25));
        } catch (_) {
          items = [
            {
              'eventLabel': 'Reflection',
              'post': _reflection,
            },
          ];
        }
      }

      if (!mounted) return;
      setState(() {
        _suggestions = items.isNotEmpty
            ? items
            : [
                {
                  'eventLabel': _isNewsMode ? 'News' : 'Reflection',
                  'post': _baselineText,
                },
              ];
        _selectedIndex = 0;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _suggestions = [
          {
            'eventLabel': _isNewsMode ? 'News' : 'Reflection',
            'post': _baselineText,
          },
        ];
        _loading = false;
      });
    }
  }

  void _onPlatformChanged(String platform) {
    if (_platform == platform) return;
    setState(() => _platform = platform);
    _loadSuggestions();
  }

  void _openSharePanel(String text) {
    setState(() {
      _editableShareText = text;
      _sharePanelOpen = true;
    });
  }

  String get _panelShareText {
    final edited = _editableShareText.trim();
    if (_sharePanelOpen && edited.isNotEmpty) return edited;
    return _selectedPostText.trim();
  }

  Future<void> _openPlatformShare() async {
    final text = _panelShareText;
    if (text.isEmpty) return;

    final encoded = Uri.encodeComponent(text);
    late final Uri uri;
    switch (_platform) {
      case 'x':
        uri = Uri.parse('https://twitter.com/intent/tweet?text=$encoded');
        break;
      case 'reddit':
        uri = Uri.parse(
          'https://www.reddit.com/submit?title=${Uri.encodeComponent('My reflection')}&selftext=$encoded',
        );
        break;
      default:
        const appUrl = 'https://deitedatabase.firebaseapp.com';
        uri = Uri.parse(
          'https://www.linkedin.com/sharing/share-offsite/?url=${Uri.encodeComponent(appUrl)}',
        );
        if (text.isNotEmpty) {
          await Clipboard.setData(ClipboardData(text: text));
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Caption copied — paste it in LinkedIn')),
            );
          }
        }
    }

    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }

    if (!mounted) return;
    setState(() {
      _pendingShareText = text;
      _shareConfirmOpen = true;
      _sharePanelOpen = false;
    });
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
    if (!mounted) return;
    setState(() {
      _shareConfirmOpen = false;
      _pendingShareText = null;
    });
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Share recorded')),
    );
  }

  Future<_TweetUserInfo> _loadTweetUserInfo() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      return const _TweetUserInfo(displayName: 'Detea User', username: 'detea_user');
    }
    final prefs = await SharedPreferences.getInstance();
    final displayName =
        prefs.getString('user_display_name_${user.uid}') ?? user.displayName ?? 'Detea User';
    final username = (user.email ?? '').split('@').first;
    final profilePicture = prefs.getString('user_profile_picture_${user.uid}');
    return _TweetUserInfo(
      displayName: displayName,
      username: username.isNotEmpty ? username : 'detea_user',
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
                            else ...[
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
                                        displayName: 'Detea User',
                                        username: 'detea_user',
                                      );
                                  final imageUrl = _media.isNotEmpty
                                      ? _media.first
                                      : (_newsArticle?['image'] as String?);

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
                  imageUrl: _media.isNotEmpty
                      ? _media.first
                      : (_newsArticle?['image'] as String?),
                  onTextChanged: (v) => setState(() => _editableShareText = v),
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
        : (suggestionsOnly ? 'Create post' : 'Your reflection');

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
              if ((newsHeadline.isNotEmpty ? newsHeadline : (newsArticle?['title'] as String? ?? '')).isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  newsHeadline.isNotEmpty
                      ? newsHeadline
                      : (newsArticle?['title'] as String? ?? ''),
                  style: TextStyle(
                    color: primary,
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    height: 1.35,
                  ),
                ),
              ],
              if (loadingNewsDetails && newsSummary.trim().isEmpty) ...[
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
              ] else if (!loadingNewsDetails &&
                  (newsArticle?['description'] as String? ?? '').trim().isEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  isTeaArticle
                      ? "We're putting together a quick summary of this thread. Hang tight — or tap the headline to read the full post."
                      : "We couldn't pull enough article text from this link to summarize it here. Tap the headline to read the full story on the publisher site.",
                  style: TextStyle(color: secondary, fontSize: 15, height: 1.45),
                ),
              ] else if (!isTeaArticle &&
                  (newsArticle?['description'] as String? ?? '').trim().isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  newsArticle!['description'] as String,
                  style: TextStyle(color: primary, fontSize: 15, height: 1.45),
                ),
              ],
            ],
          ] else ...[
            const SizedBox(height: 4),
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
              'assets/images/reddit-logo-mono.png',
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
      try {
        final base64 = url.contains(',') ? url.split(',').last : url;
        final bytes = base64Decode(base64);
        return Image.memory(bytes, fit: BoxFit.cover);
      } catch (_) {
        return _placeholder();
      }
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

class _SharePanelOverlay extends StatefulWidget {
  const _SharePanelOverlay({
    required this.platform,
    required this.isDarkMode,
    required this.text,
    required this.imageUrl,
    required this.onTextChanged,
    required this.onClose,
    required this.onSharePlatform,
  });

  final String platform;
  final bool isDarkMode;
  final String text;
  final String? imageUrl;
  final ValueChanged<String> onTextChanged;
  final VoidCallback onClose;
  final VoidCallback onSharePlatform;

  @override
  State<_SharePanelOverlay> createState() => _SharePanelOverlayState();
}

class _SharePanelOverlayState extends State<_SharePanelOverlay> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.text);
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
                    'Edit before sharing',
                    style: TextStyle(
                      color: primary,
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
              if (widget.imageUrl != null &&
                  widget.imageUrl!.isNotEmpty &&
                  widget.platform != 'x') ...[
                const SizedBox(height: 8),
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
              ],
              const SizedBox(height: 12),
              Expanded(
                child: TextField(
                  controller: _controller,
                  onChanged: widget.onTextChanged,
                  maxLines: null,
                  expands: true,
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
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: widget.onSharePlatform,
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
