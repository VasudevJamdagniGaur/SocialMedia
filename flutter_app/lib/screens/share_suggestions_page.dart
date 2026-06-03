import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../components/skeleton/list_skeleton.dart';
import '../contexts/theme_context.dart';
import '../router/app_router.dart';
import '../services/chat_service.dart';
import '../services/firestore_service.dart';
import '../utils/date_utils.dart';
import '../utils/hub_colors.dart';
import '../utils/share_news_cache.dart';

class ShareSuggestionsPage extends StatefulWidget {
  const ShareSuggestionsPage({super.key});

  @override
  State<ShareSuggestionsPage> createState() => _ShareSuggestionsPageState();
}

class _ShareSuggestionsPageState extends State<ShareSuggestionsPage> {
  static const _redditColor = Color(0xFFFF4500);

  static const _platformLabels = {
    'linkedin': 'LinkedIn',
    'x': 'X',
    'reddit': 'Reddit',
  };

  static const _styleVariants = <_StyleVariant>[
    _StyleVariant(
      id: 'minimal',
      label: 'Minimal',
      emoji: '🧘',
      instruction:
          'Write a very clean, short, and concise post. Avoid fluff and unnecessary words. Keep it simple, direct, and easy to read. Focus only on the core message. HARD LIMIT: 1–3 short sentences total, no long paragraphs, no storytelling, and no hashtags unless absolutely essential (max 1).',
    ),
    _StyleVariant(
      id: 'emotional',
      label: 'Emotional',
      emoji: '💔',
      instruction:
          'Write an expressive and emotional post. Highlight feelings, gratitude, struggles, or excitement. Make it personal and relatable. Use a warm and human tone.',
    ),
    _StyleVariant(
      id: 'bold',
      label: 'Bold',
      emoji: '🔥',
      instruction:
          'Write a confident and impactful post. Use strong statements and powerful language. Make it feel assertive and attention-grabbing without sounding arrogant.',
    ),
    _StyleVariant(
      id: 'witty',
      label: 'Witty',
      emoji: '😏',
      instruction:
          'Write a clever and slightly humorous post. Use smart phrasing, light humor, or wordplay. Keep it engaging and fun without overdoing jokes.',
    ),
    _StyleVariant(
      id: 'sarcastic',
      label: 'Sarcastic',
      emoji: '😄',
      instruction:
          'Write a sarcastic and playful post. Use irony or subtle sarcasm to make the point. Keep it light and entertaining, and avoid being offensive or negative.',
    ),
    _StyleVariant(
      id: 'formal',
      label: 'Formal',
      emoji: '🏛️',
      instruction:
          'Write a polished and professional post. Use formal language, structured sentences, and a respectful tone. Avoid slang, emojis, or casual phrasing.',
    ),
  ];

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
  bool _styleLoading = false;
  String? _error;
  int _selectedIndex = 0;
  String? _activeStyleId;

  bool _routeParsed = false;
  bool _shareConfirmOpen = false;
  String? _pendingShareText;

  late final PageController _pageController;

  bool get _isNewsMode => _newsArticle != null;

  @override
  void initState() {
    super.initState();
    _pageController = PageController();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_routeParsed) return;
    _routeParsed = true;

    final extra = GoRouterState.of(context).extra;
    if (extra is Map) {
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
      }
    }

    if (_reflection.isEmpty && !_isNewsMode) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) context.go(AppRoutes.dashboard);
      });
      return;
    }

    _bootstrapSharePage();
  }

  Future<void> _bootstrapSharePage() async {
    if (_isNewsMode) {
      await _loadNewsCardDetails();
    }
    if (mounted) await _loadSuggestions();
  }

  Future<void> _loadNewsCardDetails() async {
    final url = '${_newsArticle?['url'] ?? ''}'.trim();
    if (url.isEmpty) return;

    setState(() => _loadingNewsDetails = true);
    try {
      final source = _newsArticle?['source'] as String?;
      final isTea = isTeaSourceLabel(source);
      final cached = await getCachedNewsCardForUrl(url);

      if (cached != null) {
        var summary = cached['summary'] is String ? cached['summary'] as String : '';
        final headline = cached['headline'] is String ? cached['headline'] as String : '';
        if (isTea) {
          final cleaned = sanitizeTeaShareText(summary);
          if (cleaned != summary) {
            summary = cleaned;
            await upsertCachedNewsCard(
              url: url,
              headline: headline,
              summary: cleaned,
              details: cached['details'] is Map
                  ? Map<String, dynamic>.from(cached['details'] as Map)
                  : null,
              source: source,
            );
          }
        }
        if (!mounted) return;
        setState(() {
          _newsArticleDetails = cached['details'] is Map
              ? Map<String, dynamic>.from(cached['details'] as Map)
              : null;
          _newsCardSummary = summary;
          _newsCardHeadline = headline;
        });
        return;
      }

      final details = await ChatService.instance.fetchNewsArticleDetails(
        _newsArticle,
        {'minTextLength': 350, 'resolveGoogleNews': true},
      );
      final looksUseful = details['title'] != null ||
          details['description'] != null ||
          details['text'] != null ||
          details['image'] != null;
      final effective = looksUseful ? details : null;

      if (effective != null) {
        final results = await Future.wait<String>([
          ChatService.instance.summarizeNewsArticle(
            effective,
            {'minWords': 60, 'maxWords': 80},
          ),
          ChatService.instance.generateNewsShareCardHeadline(effective),
        ]);
        if (!mounted) return;
        final rawSummary = results[0].trim();
        final localFallback = buildLocalNewsCardSummary(effective);
        var finalSummary = rawSummary.isNotEmpty ? rawSummary : localFallback;
        if (isTea) finalSummary = sanitizeTeaShareText(finalSummary);
        final finalHeadline = results[1].trim();

        setState(() {
          _newsArticleDetails = effective;
          _newsCardSummary = finalSummary;
          _newsCardHeadline = finalHeadline;
        });

        await upsertCachedNewsCard(
          url: url,
          headline: finalHeadline,
          summary: finalSummary,
          details: effective,
          source: source,
        );
      }
    } catch (_) {
      // Card enrichment is optional; suggestions can still load from article stub.
    } finally {
      if (mounted) setState(() => _loadingNewsDetails = false);
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
    if (_newsCardSummary.isNotEmpty) return _newsCardSummary;
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
    final path = _returnTo.startsWith('/') ? _returnTo : AppRoutes.dashboard;
    context.go(path);
  }

  Future<void> _loadSuggestions() async {
    setState(() {
      _loading = true;
      _error = null;
      _activeStyleId = null;
    });

    try {
      final List<Map<String, String>> items;
      if (_isNewsMode) {
        final url = '${_newsArticle?['url'] ?? ''}'.trim();
        final source = _newsArticle?['source'] as String?;
        final isTea = isTeaSourceLabel(source);
        final cached = url.isNotEmpty
            ? await getCachedShareSuggestionsForUrl(url, _platform)
            : null;
        if (cached != null && cached.isNotEmpty) {
          items = cleanCachedNewsSuggestions(cached, isTea: isTea);
        } else {
          items = await ChatService.instance.generateNewsArticleShareSuggestions(
            _newsArticle!,
            _platform,
          );
          if (url.isNotEmpty && items.isNotEmpty) {
            final toCache = isTea
                ? cleanCachedNewsSuggestions(items, isTea: true)
                : items;
            await setCachedShareSuggestionsForUrl(url, _platform, toCache);
          }
        }
      } else {
        items = await ChatService.instance.generateSocialPostSuggestions(
          _reflection,
          _platform,
        );
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
      if (_pageController.hasClients) {
        _pageController.jumpToPage(0);
      }
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

  void _updateSuggestionText(int index, String text) {
    if (index < 0 || index >= _suggestions.length) return;
    setState(() {
      _suggestions[index] = {
        ..._suggestions[index],
        'post': text,
      };
    });
  }

  Future<void> _applyStyleVariant(_StyleVariant variant) async {
    final current = _selectedPostText.trim();
    if (current.isEmpty || _styleLoading) return;

    setState(() {
      _styleLoading = true;
      _activeStyleId = variant.id;
    });

    try {
      final edited = await ChatService.instance.editTextWithAI(current, variant.instruction);
      if (!mounted) return;
      _updateSuggestionText(_selectedIndex, edited);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Style update failed: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _styleLoading = false);
    }
  }

  Future<void> _copyToClipboard() async {
    final text = _selectedPostText.trim();
    if (text.isEmpty) return;
    await Clipboard.setData(ClipboardData(text: text));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Copied to clipboard')),
    );
  }

  Future<void> _shareViaSheet() async {
    final text = _selectedPostText.trim();
    if (text.isEmpty) return;
    await Share.share(text, subject: _isNewsMode ? 'Share this story' : 'My reflection');
    if (!mounted) return;
    setState(() {
      _pendingShareText = text;
      _shareConfirmOpen = true;
    });
  }

  Future<void> _openPlatformShare() async {
    final text = _selectedPostText.trim();
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

  Future<void> _showEditDialog() async {
    final controller = TextEditingController(text: _selectedPostText);
    final edited = await showDialog<String>(
      context: context,
      builder: (ctx) {
        final isDark = context.watch<ThemeNotifier>().isDarkMode;
        return AlertDialog(
          backgroundColor: isDark ? HubColors.bgSecondary : Colors.white,
          title: Text(
            'Edit post',
            style: TextStyle(color: isDark ? HubColors.text : Colors.black87),
          ),
          content: TextField(
            controller: controller,
            maxLines: 8,
            style: TextStyle(color: isDark ? HubColors.text : Colors.black87),
            decoration: InputDecoration(
              border: const OutlineInputBorder(),
              filled: true,
              fillColor: isDark ? HubColors.bg : const Color(0xFFF5F5F5),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text('Cancel', style: TextStyle(color: isDark ? HubColors.textSecondary : Colors.black54)),
            ),
            TextButton(
              onPressed: () => Navigator.pop(ctx, controller.text.trim()),
              child: const Text('Save', style: TextStyle(color: HubColors.accent)),
            ),
          ],
        );
      },
    );
    controller.dispose();
    if (edited != null && edited.isNotEmpty) {
      _updateSuggestionText(_selectedIndex, edited);
    }
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_reflection.isEmpty && !_isNewsMode) {
      return const SizedBox.shrink();
    }

    final isDarkMode = context.watch<ThemeNotifier>().isDarkMode;
    final scaffoldBg = isDarkMode ? HubColors.bg : const Color(0xFFF5F5F5);
    final cardBg = isDarkMode ? HubColors.bgSecondary : Colors.white;
    final cardBorder = isDarkMode ? HubColors.divider : const Color(0x14000000);
    final primaryText = isDarkMode ? HubColors.text : const Color(0xFF1A1A1A);
    final secondaryText = isDarkMode ? HubColors.textSecondary : const Color(0xFF666666);

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _goBack();
      },
      child: Scaffold(
        backgroundColor: scaffoldBg,
        body: SafeArea(
          child: Stack(
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(4, 8, 16, 0),
                    child: Row(
                      children: [
                        IconButton(
                          onPressed: _goBack,
                          icon: Icon(Icons.arrow_back, color: secondaryText),
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
                          reflection: _reflection,
                          newsArticle: _newsArticle,
                          newsHeadline: _displayNewsHeadline,
                          newsSummary: _displayNewsSummary,
                          loadingNewsDetails: _loadingNewsDetails,
                          suggestionsOnly: _suggestionsOnly,
                        ),
                        const SizedBox(height: 20),
                        _PlatformSelector(
                          platform: _platform,
                          isDarkMode: isDarkMode,
                          onChanged: _onPlatformChanged,
                        ),
                        const SizedBox(height: 20),
                        Text(
                          'Choose a post to share',
                          style: TextStyle(
                            color: primaryText,
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
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
                                'Using fallback after: $_error',
                                style: TextStyle(color: secondaryText, fontSize: 12),
                              ),
                            ),
                          SizedBox(
                            height: 280,
                            child: PageView.builder(
                              controller: _pageController,
                              itemCount: _suggestions.length,
                              onPageChanged: (i) => setState(() {
                                _selectedIndex = i;
                                _activeStyleId = null;
                              }),
                              itemBuilder: (_, index) {
                                final item = _suggestions[index];
                                final eventLabel = item['eventLabel'] ?? 'Post';
                                final post = item['post'] ?? '';
                                final isSelected = index == _selectedIndex;
                                final imageUrl = _media.isNotEmpty
                                    ? _media.first
                                    : (_newsArticle?['image'] as String?);

                                return Padding(
                                  padding: const EdgeInsets.symmetric(horizontal: 4),
                                  child: _SuggestionCard(
                                    eventLabel: eventLabel,
                                    post: post,
                                    imageUrl: imageUrl,
                                    isSelected: isSelected,
                                    isDarkMode: isDarkMode,
                                    cardBg: cardBg,
                                    cardBorder: cardBorder,
                                    onTap: () {
                                      _pageController.animateToPage(
                                        index,
                                        duration: const Duration(milliseconds: 250),
                                        curve: Curves.easeOut,
                                      );
                                    },
                                  ),
                                );
                              },
                            ),
                          ),
                          const SizedBox(height: 12),
                          _PageDots(
                            count: _suggestions.length,
                            index: _selectedIndex,
                          ),
                          const SizedBox(height: 20),
                          Text(
                            'Style',
                            style: TextStyle(
                              color: primaryText,
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 8),
                          SingleChildScrollView(
                            scrollDirection: Axis.horizontal,
                            child: Row(
                              children: _styleVariants.map((variant) {
                                final selected = _activeStyleId == variant.id;
                                return Padding(
                                  padding: const EdgeInsets.only(right: 8),
                                  child: FilterChip(
                                    label: Text('${variant.label} ${variant.emoji}'),
                                    selected: selected,
                                    onSelected: _styleLoading
                                        ? null
                                        : (_) => _applyStyleVariant(variant),
                                    backgroundColor: isDarkMode
                                        ? HubColors.bgSecondary
                                        : Colors.white,
                                    selectedColor: HubColors.accent.withValues(alpha: 0.25),
                                    checkmarkColor: HubColors.accentHighlight,
                                    labelStyle: TextStyle(
                                      color: selected
                                          ? HubColors.accentHighlight
                                          : (isDarkMode ? HubColors.text : Colors.black87),
                                      fontSize: 12,
                                    ),
                                    side: BorderSide(
                                      color: selected
                                          ? HubColors.accent
                                          : (isDarkMode ? HubColors.divider : const Color(0x1A000000)),
                                    ),
                                  ),
                                );
                              }).toList(),
                            ),
                          ),
                          if (_styleLoading)
                            const Padding(
                              padding: EdgeInsets.only(top: 8),
                              child: LinearProgressIndicator(
                                minHeight: 2,
                                color: HubColors.accent,
                                backgroundColor: HubColors.divider,
                              ),
                            ),
                          const SizedBox(height: 20),
                          Row(
                            children: [
                              Expanded(
                                child: _ActionButton(
                                  icon: Icons.copy,
                                  label: 'Copy',
                                  isDarkMode: isDarkMode,
                                  onTap: _copyToClipboard,
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: _ActionButton(
                                  icon: Icons.share_outlined,
                                  label: 'Share',
                                  isDarkMode: isDarkMode,
                                  onTap: _shareViaSheet,
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: _ActionButton(
                                  icon: Icons.edit_outlined,
                                  label: 'Edit',
                                  isDarkMode: isDarkMode,
                                  onTap: _showEditDialog,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          SizedBox(
                            width: double.infinity,
                            child: ElevatedButton(
                              onPressed: _openPlatformShare,
                              style: ElevatedButton.styleFrom(
                                backgroundColor: _platform == 'linkedin'
                                    ? const Color(0xFF0A66C2)
                                    : _platform == 'x'
                                        ? const Color(0xFF1D9BF0)
                                        : _redditColor,
                                foregroundColor: Colors.white,
                                padding: const EdgeInsets.symmetric(vertical: 14),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(14),
                                ),
                              ),
                              child: Text(
                                'Open ${_platformLabels[_platform] ?? _platform}',
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
              if (_shareConfirmOpen) _ShareConfirmBanner(
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

class _StyleVariant {
  const _StyleVariant({
    required this.id,
    required this.label,
    required this.emoji,
    required this.instruction,
  });

  final String id;
  final String label;
  final String emoji;
  final String instruction;
}

class _SourceCard extends StatelessWidget {
  const _SourceCard({
    required this.isDarkMode,
    required this.isNewsMode,
    required this.reflection,
    required this.newsArticle,
    required this.newsHeadline,
    required this.newsSummary,
    required this.loadingNewsDetails,
    required this.suggestionsOnly,
  });

  final bool isDarkMode;
  final bool isNewsMode;
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
    final badgeColor = isNewsMode
        ? (isDarkMode ? HubColors.accentHighlight : const Color(0xFF7C3AED))
        : (isDarkMode ? HubColors.textSecondary : const Color(0xFF666666));

    final badge = isNewsMode
        ? (suggestionsOnly ? 'Post' : 'News')
        : (suggestionsOnly ? 'Create post' : 'Your reflection');

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            badge,
            style: TextStyle(
              color: badgeColor,
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 8),
          if (isNewsMode) ...[
            if (loadingNewsDetails)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 8),
                child: SizedBox(
                  height: 18,
                  width: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              )
            else ...[
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
              if (newsSummary.trim().isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  newsSummary,
                  style: TextStyle(color: primary, fontSize: 15, height: 1.45),
                ),
              ] else if ((newsArticle?['description'] as String? ?? '').trim().isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  newsArticle!['description'] as String,
                  style: TextStyle(color: primary, fontSize: 15, height: 1.45),
                ),
              ],
            ],
          ] else
            Text(
              reflection,
              style: TextStyle(color: primary, fontSize: 15, height: 1.45),
            ),
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
    required this.isSelected,
    required this.isDarkMode,
    required this.cardBg,
    required this.cardBorder,
    required this.onTap,
  });

  final String eventLabel;
  final String post;
  final String? imageUrl;
  final bool isSelected;
  final bool isDarkMode;
  final Color cardBg;
  final Color cardBorder;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final borderColor = isSelected
        ? (isDarkMode ? HubColors.accentHighlight : const Color(0xFF7C3AED))
        : cardBorder;

    return Material(
      color: cardBg,
      borderRadius: BorderRadius.circular(14),
      elevation: isSelected ? 6 : 0,
      shadowColor: Colors.black.withValues(alpha: 0.45),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: borderColor, width: isSelected ? 1.5 : 1),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (imageUrl != null && imageUrl!.isNotEmpty)
                ClipRRect(
                  borderRadius: const BorderRadius.vertical(top: Radius.circular(13)),
                  child: AspectRatio(
                    aspectRatio: 16 / 9,
                    child: _SuggestionImage(url: imageUrl!, isDarkMode: isDarkMode),
                  ),
                ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        eventLabel,
                        style: const TextStyle(
                          color: HubColors.accent,
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Expanded(
                        child: SingleChildScrollView(
                          child: Text(
                            post,
                            style: TextStyle(
                              color: isDarkMode ? HubColors.text : const Color(0xFF333333),
                              fontSize: 14,
                              height: 1.5,
                            ),
                          ),
                        ),
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

class _PageDots extends StatelessWidget {
  const _PageDots({required this.count, required this.index});

  final int count;
  final int index;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: List.generate(count, (i) {
        final active = i == index;
        return AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          margin: const EdgeInsets.symmetric(horizontal: 4),
          width: active ? 10 : 6,
          height: 6,
          decoration: BoxDecoration(
            color: active ? HubColors.accent : HubColors.divider,
            borderRadius: BorderRadius.circular(3),
          ),
        );
      }),
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({
    required this.icon,
    required this.label,
    required this.isDarkMode,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool isDarkMode;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: onTap,
      icon: Icon(icon, size: 18, color: isDarkMode ? HubColors.text : Colors.black87),
      label: Text(
        label,
        style: TextStyle(color: isDarkMode ? HubColors.text : Colors.black87),
      ),
      style: OutlinedButton.styleFrom(
        padding: const EdgeInsets.symmetric(vertical: 12),
        side: BorderSide(color: isDarkMode ? HubColors.divider : const Color(0x1A000000)),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
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
