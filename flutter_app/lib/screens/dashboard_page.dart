import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../components/hub_theme.dart';
import '../components/share_platform_selector.dart';
import '../contexts/theme_context.dart';
import '../router/app_router.dart';
import '../services/auth_service.dart';
import '../services/chat_service.dart';
import '../services/firestore_result.dart';
import '../services/firestore_service.dart';
import '../services/reflection_service.dart';
import '../utils/date_utils.dart';
import '../utils/profile_picture_helper.dart';
import '../utils/hub_carousel_ai_image.dart';
import '../utils/share_news_cache.dart';
import '../utils/tea_watchlist_storage.dart';
import 'profile_page.dart';

const _cardBg = Color(0xFF161616);
const _cardBorder = Color(0xFF252525);
const _muted = Color(0xFF9CA3AF);

const _composerMaxChars = 1000;

/// Home dashboard — greeting, composer, stats, journey shortcuts, post suggestions.
class DashboardPage extends StatefulWidget {
  const DashboardPage({super.key});

  @override
  State<DashboardPage> createState() => _DashboardPageState();
}

class _DashboardPageState extends State<DashboardPage> {
  static const _dateKey = 'dashboard_selected_date_iso';

  DateTime _selectedDate = DateTime.now();
  String _reflection = '';
  List<CalendarDayMarker> _chatDays = [];
  String? _profilePicture;
  String _displayName = 'there';

  int _dayStreak = 0;
  int _teasShared = 0;
  int _bookmarks = 0;

  final _mindController = TextEditingController();
  String _platform = 'linkedin';
  final List<String> _composerMedia = [];
  final _imagePicker = ImagePicker();

  List<Map<String, String>> _postSuggestions = [];
  bool _suggestionsLoading = false;
  String? _suggestionsSourceKey;
  String? _postSuggestionImageUrl;

  @override
  void initState() {
    super.initState();
    ProfilePictureNotifier.instance.revision.addListener(_onProfilePictureUpdated);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadSavedDate();
      _ensureUser();
      _loadProfilePicture();
      _loadDisplayName();
      _loadCalendarData();
      _loadReflection();
      _loadStats();
    });
  }

  @override
  void dispose() {
    ProfilePictureNotifier.instance.revision.removeListener(_onProfilePictureUpdated);
    _mindController.dispose();
    super.dispose();
  }

  void _onProfilePictureUpdated() => _loadProfilePicture();

  String _greetingLine() {
    final h = DateTime.now().hour;
    if (h < 12) return 'Good morning,';
    if (h < 17) return 'Good afternoon,';
    return 'Good evening,';
  }

  Future<void> _loadSavedDate() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_dateKey);
    if (saved != null) {
      final d = DateTime.tryParse(saved);
      if (d != null && mounted) setState(() => _selectedDate = d);
    }
  }

  Future<void> _ensureUser() async {
    final user = AuthService().getCurrentUser();
    if (user == null) return;
    await FirestoreService.instance.ensureUser(user.uid, {
      'email': user.email,
      'displayName': user.displayName ?? 'User',
      'createdAt': DateTime.now().toIso8601String(),
    });
  }

  Future<void> _loadDisplayName() async {
    final user = AuthService().getCurrentUser();
    if (user == null) return;
    var name = user.displayName?.trim() ?? '';
    if (name.isEmpty) {
      try {
        final result = await FirestoreService.instance.getUser(user.uid);
        name = '${result.data?['displayName'] ?? ''}'.trim();
      } catch (_) {}
    }
    if (name.isEmpty && user.email != null) {
      name = user.email!.split('@').first;
    }
    final first = name.split(RegExp(r'\s+')).firstWhere((s) => s.isNotEmpty, orElse: () => 'there');
    if (mounted) setState(() => _displayName = first);
  }

  Future<void> _loadProfilePicture() async {
    final user = AuthService().getCurrentUser();
    if (user == null) return;
    try {
      final result = await FirestoreService.instance.getUser(user.uid);
      if (result.success && result.data != null && result.data!['profilePicture'] != null) {
        final pic = result.data!['profilePicture'] as String;
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('user_profile_picture_${user.uid}', pic);
        if (mounted) setState(() => _profilePicture = pic);
        return;
      }
    } catch (_) {}
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString('user_profile_picture_${user.uid}');
    if (mounted) setState(() => _profilePicture = saved);
  }

  Future<void> _loadCalendarData() async {
    final user = AuthService().getCurrentUser();
    if (user == null) return;
    final result = await FirestoreService.instance.getAllChatDays(user.uid);
    if (result.success && mounted) {
      setState(() => _chatDays = result.chatDays);
      _dayStreak = _computeDayStreak(_chatDays);
    }
  }

  Future<void> _loadStats() async {
    final user = AuthService().getCurrentUser();
    var teas = 0;
    if (user != null) {
      try {
        final shares = await FirestoreService.instance.getSocialSharesByUser(user.uid);
        if (shares['success'] == true && shares['shares'] is List) {
          teas = (shares['shares'] as List).length;
        }
      } catch (_) {}
      try {
        final posts = await FirestoreService.instance.getCommunityPostsByAuthorIds([user.uid], 50);
        if (posts['success'] == true && posts['posts'] is List) {
          teas += (posts['posts'] as List).length;
        }
      } catch (_) {}
    }
    final watchlist = await getTeaWatchlist();
    if (mounted) {
      setState(() {
        _teasShared = teas;
        _bookmarks = watchlist.length;
        _dayStreak = _computeDayStreak(_chatDays);
      });
    }
  }

  int _computeDayStreak(List<CalendarDayMarker> chatDays) {
    final ids = <String>{};
    for (final d in chatDays) {
      final id = d.date.trim();
      if (id.isNotEmpty) ids.add(id);
      final alt = d.id?.trim() ?? '';
      if (alt.isNotEmpty) ids.add(alt);
    }
    if (ids.isEmpty) return 0;

    var streak = 0;
    var cursor = DateTime.now();
    for (var i = 0; i < 400; i++) {
      final id = getDateId(cursor);
      if (ids.contains(id)) {
        streak++;
        cursor = cursor.subtract(const Duration(days: 1));
      } else if (i == 0) {
        cursor = cursor.subtract(const Duration(days: 1));
      } else {
        break;
      }
    }
    return streak;
  }

  Future<void> _loadReflection() async {
    final dateId = getDateId(_selectedDate);
    final user = AuthService().getCurrentUser();
    if (user == null) {
      final local = await getReflectionFromLocalStorage(dateId);
      if (mounted) {
        setState(() => _reflection = local);
        await _loadPostSuggestions();
      }
      return;
    }
    try {
      final result = await ReflectionService.instance.getReflection(user.uid, dateId);
      var text = result.reflection ?? '';
      if (text.isEmpty) text = await getReflectionFromLocalStorage(dateId);
      if (text.isEmpty && dateId == getDateId(DateTime.now())) {
        text = await _reflectionFromTodayChat(user.uid, dateId);
      }
      if (mounted) {
        setState(() => _reflection = text);
        await _loadPostSuggestions();
      }
    } catch (_) {
      final local = await getReflectionFromLocalStorage(dateId);
      if (mounted) {
        setState(() => _reflection = local);
        await _loadPostSuggestions();
      }
    }
  }

  Future<String> _reflectionFromTodayChat(String uid, String dateId) async {
    try {
      final result = await FirestoreService.instance.getChatMessagesNew(uid, dateId);
      if (result['success'] != true) return '';
      final raw = (result['messages'] as List?)?.cast<Map<String, dynamic>>() ?? [];
      final chatRows = raw
          .where((m) =>
              m['sender'] != 'system' &&
              '${m['text'] ?? ''}'.trim().isNotEmpty &&
              m['isWhisperSession'] != true)
          .toList();
      if (chatRows.length < 2) return '';
      return (await ReflectionService.instance.generateReflection(chatRows)).trim();
    } catch (_) {
      return '';
    }
  }

  Future<void> _loadPostSuggestions() async {
    final reflection = _reflection.trim();
    final cacheKey = '${getDateId(_selectedDate)}|$_platform|${reflection.hashCode}';
    if (reflection.isEmpty) {
      if (mounted) {
        setState(() {
          _postSuggestions = [];
          _suggestionsLoading = false;
          _suggestionsSourceKey = null;
          _postSuggestionImageUrl = null;
        });
      }
      return;
    }
    if (_suggestionsSourceKey == cacheKey && _postSuggestions.isNotEmpty) return;

    if (mounted) setState(() => _suggestionsLoading = true);
    try {
      final items = await ChatService.instance
          .generateSocialPostSuggestions(reflection, _platform)
          .timeout(const Duration(seconds: 90));
      String? imageUrl;
      try {
        imageUrl = await ChatService.instance
            .fetchImageForReflection(reflection, null, _platform)
            .timeout(const Duration(seconds: 120));
      } catch (_) {
        imageUrl = null;
      }
      if (!mounted) return;
      setState(() {
        _postSuggestions = items.take(3).toList();
        _postSuggestionImageUrl = imageUrl;
        _suggestionsLoading = false;
        _suggestionsSourceKey = cacheKey;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _postSuggestions = [];
        _suggestionsLoading = false;
        _suggestionsSourceKey = null;
        _postSuggestionImageUrl = null;
      });
    }
  }

  Future<void> _openPostSuggestions({Map<String, String>? focus}) async {
    final reflection = _reflection.trim();
    if (reflection.isEmpty) {
      context.push(AppRoutes.reflections);
      return;
    }
    final payload = {
      'reflection': reflection,
      'platform': _platform,
      'selectedDate': _selectedDate.toIso8601String(),
      'returnTo': AppRoutes.dashboard,
      if (focus != null) 'postDraft': focus['post'],
    };
    await prepareShareSuggestionsRoute(payload);
    if (!mounted) return;
    await context.push(AppRoutes.shareSuggestions, extra: payload);
  }

  void _navigateChat() {
    context.push(
      AppRoutes.chat,
      extra: {
        'selectedDate': _selectedDate.toIso8601String(),
        'isWhisperMode': false,
      },
    );
  }

  Future<void> _pickComposerImages() async {
    final files = await _imagePicker.pickMultiImage(imageQuality: 85);
    if (files.isEmpty) return;
    await _addComposerImageFiles(files);
  }

  Future<void> _pickComposerCamera() async {
    final file = await _imagePicker.pickImage(source: ImageSource.camera, imageQuality: 85);
    if (file == null) return;
    await _addComposerImageFiles([file]);
  }

  Future<void> _addComposerImageFiles(List<XFile> files) async {
    for (final file in files) {
      final bytes = await file.readAsBytes();
      if (bytes.length > 10 * 1024 * 1024) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Each image must be less than 10MB')),
          );
        }
        continue;
      }
      final src = 'data:image/jpeg;base64,${base64Encode(bytes)}';
      if (!mounted) return;
      setState(() {
        _composerMedia.insert(0, src);
        if (_composerMedia.length > 6) {
          _composerMedia.removeRange(6, _composerMedia.length);
        }
      });
    }
  }

  void _removeComposerImage(int index) {
    if (index < 0 || index >= _composerMedia.length) return;
    setState(() => _composerMedia.removeAt(index));
  }

  Future<void> _openComposerSubmit() async {
    final text = _mindController.text.trim();
    if (text.isEmpty && _composerMedia.isEmpty) return;

    final payload = {
      'reflection': text.isEmpty ? ' ' : text,
      'platform': _platform,
      'selectedDate': _selectedDate.toIso8601String(),
      'returnTo': AppRoutes.dashboard,
      if (_composerMedia.isNotEmpty) 'media': _composerMedia.take(6).toList(),
    };
    await prepareShareSuggestionsRoute(payload);
    if (!mounted) return;
    await context.push(AppRoutes.shareSuggestions, extra: payload);
    if (!mounted) return;
    _mindController.clear();
    setState(() => _composerMedia.clear());
  }

  Future<void> _openDaysReflect() async {
    await _openPostSuggestions();
  }

  @override
  Widget build(BuildContext context) {
    context.watch<ThemeNotifier>();
    final bottomPad = MediaQuery.paddingOf(context).bottom;

    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(20, 8, 20, 88 + bottomPad),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _DashboardHeader(
                greeting: _greetingLine(),
                name: _displayName,
                profilePicture: _profilePicture,
                onHelp: () => context.push(
                  AppRoutes.helpImprove,
                  extra: {'returnTo': AppRoutes.dashboard},
                ),
                onProfile: () => context.push(AppRoutes.profile),
              ),
              const SizedBox(height: 20),
              _MindComposerCard(
                controller: _mindController,
                platform: _platform,
                mediaUrls: _composerMedia,
                onPlatformChanged: (p) {
                  setState(() => _platform = p);
                  _loadPostSuggestions();
                },
                onPickGallery: _pickComposerImages,
                onPickCamera: _pickComposerCamera,
                onRemovePhoto: _removeComposerImage,
                onSubmit: _openComposerSubmit,
                onTextChanged: () => setState(() {}),
              ),
              const SizedBox(height: 16),
              _StatsRow(
                dayStreak: _dayStreak,
                teasShared: _teasShared,
                bookmarks: _bookmarks,
                onBookmarksTap: () async {
                  await context.push(AppRoutes.watchlist);
                  if (mounted) _loadStats();
                },
              ),
              const SizedBox(height: 28),
              const _SectionHeader(title: 'Continue your journey'),
              const SizedBox(height: 12),
              _JourneyTile(
                icon: LucideIcons.bookOpen,
                title: "Day's Reflect",
                subtitle: 'A quiet moment for this day',
                onTap: _openDaysReflect,
              ),
              const SizedBox(height: 10),
              _JourneyTile(
                icon: LucideIcons.coffee,
                title: "Spill day's tea",
                subtitle: 'Write freely, share openly',
                onTap: _navigateChat,
              ),
              const SizedBox(height: 28),
              _SectionHeader(
                title: 'Post suggestions',
                actionLabel: _reflection.trim().isNotEmpty ? 'View all' : null,
                onAction: _reflection.trim().isNotEmpty ? () => _openPostSuggestions() : null,
              ),
              const SizedBox(height: 12),
              if (_suggestionsLoading)
                const _PostSuggestionsLoading()
              else if (_reflection.trim().isEmpty)
                const _PostSuggestionsPlaceholder(hasReflection: false)
              else if (_postSuggestions.isEmpty)
                const _PostSuggestionsPlaceholder(hasReflection: true)
              else
                Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Text(
                        "Based on today's reflect · ${sharePlatformLabel(_platform)}",
                        style: const TextStyle(color: _muted, fontSize: 12, fontWeight: FontWeight.w500),
                      ),
                    ),
                    for (var i = 0; i < _postSuggestions.length; i++) ...[
                      if (i > 0) const SizedBox(height: 10),
                      _PostSuggestionCard(
                        suggestion: _postSuggestions[i],
                        platform: _platform,
                        imageUrl: _postSuggestionImageUrl,
                        onTap: () => _openPostSuggestions(focus: _postSuggestions[i]),
                      ),
                    ],
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DashboardHeader extends StatelessWidget {
  const _DashboardHeader({
    required this.greeting,
    required this.name,
    required this.profilePicture,
    required this.onHelp,
    required this.onProfile,
  });

  final String greeting;
  final String name;
  final String? profilePicture;
  final VoidCallback onHelp;
  final VoidCallback onProfile;

  static const double _headerHeight = 64;
  static const double _logoSize = 40;
  static const double _profileSize = 40;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: _headerHeight,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Center(
            child: Image.asset(
              'assets/images/DEITECIrc-192.webp',
              width: _logoSize,
              height: _logoSize,
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => const Icon(
                LucideIcons.coffee,
                color: HubTheme.accent,
                size: 28,
              ),
            ),
          ),
          Positioned.fill(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        greeting,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: _muted, fontSize: 15, height: 1.2),
                      ),
                      Text(
                        name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 26,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.5,
                          height: 1.1,
                        ),
                      ),
                    ],
                  ),
                ),
                SizedBox(width: _logoSize + 8),
                Expanded(
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      Material(
                        color: Colors.transparent,
                        child: InkWell(
                          onTap: onProfile,
                          customBorder: const CircleBorder(),
                          child: Container(
                            width: _profileSize,
                            height: _profileSize,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              border: Border.all(color: HubTheme.accent.withValues(alpha: 0.35)),
                              boxShadow: [
                                BoxShadow(
                                  color: HubTheme.accent.withValues(alpha: 0.2),
                                  blurRadius: 12,
                                ),
                              ],
                            ),
                            child: ClipOval(
                              child: profilePicture != null
                                  ? buildProfilePicture(
                                      picture: profilePicture,
                                      size: _profileSize,
                                      backgroundColor: _cardBg,
                                    )
                                  : const ColoredBox(
                                      color: _cardBg,
                                      child: Icon(
                                        LucideIcons.user,
                                        color: HubTheme.accent,
                                        size: 22,
                                      ),
                                    ),
                            ),
                          ),
                        ),
                      ),
                      IconButton(
                        onPressed: onHelp,
                        tooltip: 'Help improve SociTea',
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
                        icon: const Text('✨', style: TextStyle(fontSize: 18)),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MindComposerCard extends StatefulWidget {
  const _MindComposerCard({
    required this.controller,
    required this.platform,
    required this.mediaUrls,
    required this.onPlatformChanged,
    required this.onPickGallery,
    required this.onPickCamera,
    required this.onRemovePhoto,
    required this.onSubmit,
    required this.onTextChanged,
  });

  final TextEditingController controller;
  final String platform;
  final List<String> mediaUrls;
  final ValueChanged<String> onPlatformChanged;
  final VoidCallback onPickGallery;
  final VoidCallback onPickCamera;
  final ValueChanged<int> onRemovePhoto;
  final VoidCallback onSubmit;
  final VoidCallback onTextChanged;

  @override
  State<_MindComposerCard> createState() => _MindComposerCardState();
}

class _MindComposerCardState extends State<_MindComposerCard> {
  final _addButtonKey = GlobalKey();

  bool get _canSubmit => widget.controller.text.trim().isNotEmpty || widget.mediaUrls.isNotEmpty;

  int get _charCount => widget.controller.text.characters.length;

  bool get _showCharCount => _charCount >= 400;

  Future<void> _showAddContentMenu(BuildContext context) async {
    final overlay = Overlay.of(context).context.findRenderObject() as RenderBox?;
    final box = _addButtonKey.currentContext?.findRenderObject() as RenderBox?;
    if (overlay == null || box == null) return;

    final offset = box.localToGlobal(Offset.zero, ancestor: overlay);
    final selected = await showMenu<String>(
      context: context,
      color: const Color(0xFF1C1C1C),
      elevation: 8,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: Colors.white.withValues(alpha: 0.08)),
      ),
      position: RelativeRect.fromLTRB(
        offset.dx - 160,
        offset.dy + box.size.height + 6,
        offset.dx + box.size.width,
        offset.dy + box.size.height + 6,
      ),
      items: const [
        _ComposerMenuItem(value: 'photo', icon: LucideIcons.image, label: 'Photo / Video'),
        _ComposerMenuItem(value: 'camera', icon: LucideIcons.camera, label: 'Camera'),
        _ComposerMenuItem(value: 'gif', icon: LucideIcons.imagePlay, label: 'GIF'),
        _ComposerMenuItem(value: 'poll', icon: LucideIcons.chartNoAxesColumn, label: 'Poll'),
        _ComposerMenuItem(value: 'link', icon: LucideIcons.link, label: 'Add link'),
        _ComposerMenuItem(value: 'location', icon: LucideIcons.mapPin, label: 'Location'),
      ],
    );

    if (selected == null) return;
    if (!context.mounted) return;
    switch (selected) {
      case 'photo':
        widget.onPickGallery();
      case 'camera':
        widget.onPickCamera();
      default:
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Coming soon')),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 14),
      decoration: BoxDecoration(
        color: _cardBg,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: _cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.22),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Colors.white.withValues(alpha: 0.06)),
            ),
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                Padding(
                  padding: EdgeInsets.fromLTRB(12, 12, 48, _showCharCount ? 28 : 12),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Padding(
                        padding: EdgeInsets.only(top: 2),
                        child: Icon(LucideIcons.penLine, color: _muted, size: 18),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: TextField(
                          controller: widget.controller,
                          onChanged: (_) => widget.onTextChanged(),
                          style: const TextStyle(color: Colors.white, fontSize: 16, height: 1.45),
                          maxLines: 8,
                          minLines: 2,
                          maxLength: _composerMaxChars,
                          buildCounter: (_, {required currentLength, required isFocused, maxLength}) => null,
                          decoration: const InputDecoration(
                            isDense: true,
                            border: InputBorder.none,
                            hintText: "What's on your mind?",
                            hintStyle: TextStyle(color: Color(0xFF6B7280), fontSize: 16),
                            contentPadding: EdgeInsets.zero,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                Positioned(
                  top: 10,
                  right: 10,
                  child: _ComposerPlusButton(
                    key: _addButtonKey,
                    onTap: () => _showAddContentMenu(context),
                  ),
                ),
                if (_showCharCount)
                  Positioned(
                    right: 12,
                    bottom: 8,
                    child: Text(
                      '$_charCount/$_composerMaxChars',
                      style: TextStyle(
                        color: _charCount >= _composerMaxChars
                            ? Colors.red.shade300
                            : const Color(0xFF6B7280),
                        fontSize: 11,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          if (widget.mediaUrls.isNotEmpty) ...[
            const SizedBox(height: 12),
            SizedBox(
              height: 72,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: widget.mediaUrls.length + (widget.mediaUrls.length < 6 ? 1 : 0),
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (_, i) {
                  if (i < widget.mediaUrls.length) {
                    return _ComposerPhotoThumb(
                      src: widget.mediaUrls[i],
                      onRemove: () => widget.onRemovePhoto(i),
                    );
                  }
                  return _ComposerAddMoreTile(
                    onTap: () => _showAddContentMenu(context),
                  );
                },
              ),
            ),
          ],
          const SizedBox(height: 14),
          Row(
            children: [
              SharePlatformSelector(
                platform: widget.platform,
                compact: true,
                onChanged: widget.onPlatformChanged,
              ),
              const Spacer(),
              Material(
                color: _canSubmit ? HubTheme.accent : HubTheme.accent.withValues(alpha: 0.35),
                borderRadius: BorderRadius.circular(999),
                elevation: 0,
                child: InkWell(
                  onTap: _canSubmit ? widget.onSubmit : null,
                  borderRadius: BorderRadius.circular(999),
                  child: Container(
                    width: 44,
                    height: 44,
                    alignment: Alignment.center,
                    child: const Icon(LucideIcons.arrowUp, color: Colors.white, size: 22),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ComposerPlusButton extends StatelessWidget {
  const _ComposerPlusButton({super.key, required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          width: 36,
          height: 36,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: HubTheme.accent.withValues(alpha: 0.85), width: 1.5),
            color: Colors.black.withValues(alpha: 0.35),
          ),
          child: const Icon(LucideIcons.plus, color: Colors.white, size: 18),
        ),
      ),
    );
  }
}

class _ComposerAddMoreTile extends StatelessWidget {
  const _ComposerAddMoreTile({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: CustomPaint(
          painter: _DashedRectPainter(
            color: HubTheme.accent.withValues(alpha: 0.5),
            radius: 12,
          ),
          child: Container(
            width: 64,
            height: 64,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              color: HubTheme.accent.withValues(alpha: 0.06),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(LucideIcons.plus, color: HubTheme.accent.withValues(alpha: 0.9), size: 20),
                const SizedBox(height: 2),
                Text(
                  'Add more',
                  style: TextStyle(
                    color: HubTheme.accent.withValues(alpha: 0.85),
                    fontSize: 9,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _DashedRectPainter extends CustomPainter {
  _DashedRectPainter({required this.color, required this.radius});

  final Color color;
  final double radius;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5;
    final path = Path()..addRRect(RRect.fromRectAndRadius(Offset.zero & size, Radius.circular(radius)));
    for (final metric in path.computeMetrics()) {
      var distance = 0.0;
      while (distance < metric.length) {
        final next = distance + 5;
        canvas.drawPath(metric.extractPath(distance, next.clamp(0, metric.length)), paint);
        distance = next + 4;
      }
    }
  }

  @override
  bool shouldRepaint(covariant _DashedRectPainter oldDelegate) =>
      oldDelegate.color != color || oldDelegate.radius != radius;
}

class _ComposerMenuItem extends PopupMenuEntry<String> {
  const _ComposerMenuItem({
    required this.value,
    required this.icon,
    required this.label,
  });

  final String value;
  final IconData icon;
  final String label;

  @override
  double get height => 44;

  @override
  bool represents(String? value) => this.value == value;

  @override
  State<_ComposerMenuItem> createState() => _ComposerMenuItemState();
}

class _ComposerMenuItemState extends State<_ComposerMenuItem> {
  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => Navigator.pop(context, widget.value),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Row(
          children: [
            Icon(widget.icon, color: Colors.white.withValues(alpha: 0.88), size: 18),
            const SizedBox(width: 12),
            Text(
              widget.label,
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.92),
                fontSize: 14,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ComposerPhotoThumb extends StatelessWidget {
  const _ComposerPhotoThumb({
    required this.src,
    required this.onRemove,
  });

  final String src;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: SizedBox(
            width: 64,
            height: 64,
            child: _composerImageFromSrc(src),
          ),
        ),
        Positioned(
          top: -6,
          right: -6,
          child: Material(
            color: Colors.black87,
            shape: const CircleBorder(),
            child: InkWell(
              onTap: onRemove,
              customBorder: const CircleBorder(),
              child: const Padding(
                padding: EdgeInsets.all(4),
                child: Icon(LucideIcons.x, color: Colors.white, size: 14),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

Widget _composerImageFromSrc(String src) {
  if (src.startsWith('data:image')) {
    final comma = src.indexOf(',');
    if (comma >= 0) {
      try {
        return Image.memory(
          base64Decode(src.substring(comma + 1)),
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => const ColoredBox(color: _cardBorder),
        );
      } catch (_) {}
    }
  }
  if (src.startsWith('http://') || src.startsWith('https://')) {
    return Image.network(src, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const ColoredBox(color: _cardBorder));
  }
  return const ColoredBox(color: _cardBorder);
}

class _StatsRow extends StatelessWidget {
  const _StatsRow({
    required this.dayStreak,
    required this.teasShared,
    required this.bookmarks,
    this.onBookmarksTap,
  });

  final int dayStreak;
  final int teasShared;
  final int bookmarks;
  final VoidCallback? onBookmarksTap;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _StatCard(
            icon: LucideIcons.droplet,
            value: '$dayStreak',
            label: 'Day streak',
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _StatCard(
            icon: LucideIcons.coffee,
            value: '$teasShared',
            label: 'Teas shared',
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _StatCard(
            icon: LucideIcons.bookmark,
            value: '$bookmarks',
            label: 'Bookmarks',
            onTap: onBookmarksTap,
          ),
        ),
      ],
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.icon,
    required this.value,
    required this.label,
    this.onTap,
  });

  final IconData icon;
  final String value;
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final card = Container(
      padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 10),
      decoration: BoxDecoration(
        color: _cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _cardBorder),
      ),
      child: Column(
        children: [
          Icon(icon, color: HubTheme.accent, size: 20),
          const SizedBox(height: 8),
          Text(
            value,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.w800,
              height: 1,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            textAlign: TextAlign.center,
            style: const TextStyle(color: _muted, fontSize: 11, fontWeight: FontWeight.w500),
          ),
        ],
      ),
    );

    if (onTap == null) return card;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: card,
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.title,
    this.actionLabel,
    this.onAction,
  });

  final String title;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            title,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.3,
            ),
          ),
        ),
        if (actionLabel != null && onAction != null)
          TextButton(
            onPressed: onAction,
            style: TextButton.styleFrom(
              foregroundColor: HubTheme.accent,
              padding: const EdgeInsets.symmetric(horizontal: 8),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
            children: [
              Text(actionLabel!, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
              const SizedBox(width: 2),
              const Icon(LucideIcons.chevronRight, size: 16),
            ],
          ),
        ),
      ],
    );
  }
}

class _JourneyTile extends StatelessWidget {
  const _JourneyTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: _cardBg,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: _cardBorder),
          ),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: HubTheme.accent.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: HubTheme.accent, size: 22),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: const TextStyle(color: _muted, fontSize: 13, fontWeight: FontWeight.w500),
                    ),
                  ],
                ),
              ),
              const Icon(LucideIcons.chevronRight, color: Color(0xFF4B5563), size: 20),
            ],
          ),
        ),
      ),
    );
  }
}

class _PostSuggestionCard extends StatelessWidget {
  const _PostSuggestionCard({
    required this.suggestion,
    required this.platform,
    this.imageUrl,
    required this.onTap,
  });

  final Map<String, String> suggestion;
  final String platform;
  final String? imageUrl;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final eventLabel = suggestion['eventLabel'] ?? 'Post';
    final post = suggestion['post'] ?? '';

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: _cardBg,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: _cardBorder),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (imageUrl != null && isValidHubCarouselImageUrl(imageUrl)) ...[
                ClipRRect(
                  borderRadius: const BorderRadius.vertical(top: Radius.circular(15)),
                  child: AspectRatio(
                    aspectRatio: 16 / 9,
                    child: HubCarouselHeroImage(imageUrl: imageUrl, fit: BoxFit.cover),
                  ),
                ),
                const SizedBox(height: 12),
              ],
              Row(
                children: [
                  Text(
                    eventLabel,
                    style: const TextStyle(
                      color: HubTheme.accent,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const Spacer(),
                  Text(
                    sharePlatformLabel(platform),
                    style: const TextStyle(color: _muted, fontSize: 11, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
              if (post.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  post,
                  maxLines: 5,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 14,
                    height: 1.45,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
              const SizedBox(height: 10),
              Row(
                children: [
                  Text(
                    'Tap to share',
                    style: TextStyle(
                      color: HubTheme.accent.withValues(alpha: 0.85),
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const Spacer(),
                  Icon(LucideIcons.chevronRight, color: Colors.white.withValues(alpha: 0.35), size: 18),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PostSuggestionsLoading extends StatelessWidget {
  const _PostSuggestionsLoading();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 28, horizontal: 20),
      decoration: BoxDecoration(
        color: _cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _cardBorder),
      ),
      child: const Center(
        child: SizedBox(
          width: 24,
          height: 24,
          child: CircularProgressIndicator(strokeWidth: 2, color: HubTheme.accent),
        ),
      ),
    );
  }
}

class _PostSuggestionsPlaceholder extends StatelessWidget {
  const _PostSuggestionsPlaceholder({required this.hasReflection});

  final bool hasReflection;

  @override
  Widget build(BuildContext context) {
    final text = hasReflection
        ? "Couldn't load suggestions right now. Tap View all to try again."
        : "Spill some tea with SociTea today to build your Day's Reflect — post suggestions will show up here.";

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: _cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _cardBorder),
      ),
      child: Text(
        text,
        textAlign: TextAlign.center,
        style: const TextStyle(color: _muted, fontSize: 14, height: 1.45, fontWeight: FontWeight.w500),
      ),
    );
  }
}
