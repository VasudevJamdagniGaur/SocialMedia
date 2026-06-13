import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../components/hub_theme.dart';
import '../components/share_platform_selector.dart';
import '../contexts/theme_context.dart';
import '../router/app_router.dart';
import '../services/auth_service.dart';
import '../services/firestore_result.dart';
import '../services/firestore_service.dart';
import '../services/reflection_service.dart';
import '../utils/date_utils.dart';
import '../utils/profile_picture_helper.dart';
import '../utils/share_news_cache.dart';
import '../utils/tea_watchlist_storage.dart';
import 'profile_page.dart';

const _cardBg = Color(0xFF161616);
const _cardBorder = Color(0xFF252525);
const _muted = Color(0xFF9CA3AF);

/// Home dashboard — greeting, composer, stats, journey shortcuts, recent posts.
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
  int _momentsSaved = 0;

  final _mindController = TextEditingController();
  String _platform = 'linkedin';

  @override
  void initState() {
    super.initState();
    _loadSavedDate();
    _ensureUser();
    _loadProfilePicture();
    _loadDisplayName();
    _loadCalendarData();
    _loadReflection();
    _loadStats();
    ProfilePictureNotifier.instance.revision.addListener(_onProfilePictureUpdated);
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
    var moments = 0;
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
    moments = watchlist.length + _chatDays.length;
    if (mounted) {
      setState(() {
        _teasShared = teas;
        _momentsSaved = moments;
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
      if (mounted) setState(() => _reflection = local);
      return;
    }
    try {
      final result = await ReflectionService.instance.getReflection(user.uid, dateId);
      var text = result.reflection ?? '';
      if (text.isEmpty) text = await getReflectionFromLocalStorage(dateId);
      if (mounted) setState(() => _reflection = text);
    } catch (_) {
      final local = await getReflectionFromLocalStorage(dateId);
      if (mounted) setState(() => _reflection = local);
    }
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

  Future<void> _openComposerSubmit() async {
    final text = _mindController.text.trim();
    if (text.isEmpty) return;

    final payload = {
      'reflection': text,
      'platform': _platform,
      'selectedDate': _selectedDate.toIso8601String(),
      'returnTo': AppRoutes.dashboard,
    };
    await prepareShareSuggestionsRoute(payload);
    if (!mounted) return;
    await context.push(AppRoutes.shareSuggestions, extra: payload);
    if (!mounted) return;
    _mindController.clear();
    setState(() {});
  }

  Future<void> _openDaysReflect() async {
    if (_reflection.isNotEmpty) {
      final payload = {
        'reflection': _reflection,
        'selectedDate': _selectedDate.toIso8601String(),
      };
      await prepareShareSuggestionsRoute(payload);
      if (!mounted) return;
      context.push(AppRoutes.shareSuggestions, extra: payload);
      return;
    }
    context.push(AppRoutes.reflections);
  }

  @override
  Widget build(BuildContext context) {
    context.watch<ThemeNotifier>();
    final user = AuthService().getCurrentUser();
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
                onProfile: () => context.push(AppRoutes.profile),
              ),
              const SizedBox(height: 20),
              _MindComposerCard(
                controller: _mindController,
                platform: _platform,
                onPlatformChanged: (p) => setState(() => _platform = p),
                onSubmit: _openComposerSubmit,
              ),
              const SizedBox(height: 16),
              _StatsRow(
                dayStreak: _dayStreak,
                teasShared: _teasShared,
                momentsSaved: _momentsSaved,
              ),
              const SizedBox(height: 28),
              _SectionHeader(
                title: 'Continue your journey',
                actionLabel: 'View all',
                onAction: () => context.push(AppRoutes.reflections),
              ),
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
                title: 'Recent posts',
                actionLabel: 'View all',
                onAction: () => context.push(AppRoutes.community),
              ),
              const SizedBox(height: 12),
              if (user != null)
                StreamBuilder<List<Map<String, dynamic>>>(
                  stream: FirestoreService.instance.streamCommunityPosts(limitCount: 40),
                  builder: (context, snap) {
                    final all = snap.data ?? [];
                    final mine = all
                        .where((p) => p['authorId'] == user.uid)
                        .take(3)
                        .toList();
                    if (mine.isEmpty) {
                      return const _RecentPostPlaceholder();
                    }
                    return Column(
                      children: [
                        for (var i = 0; i < mine.length; i++) ...[
                          if (i > 0) const SizedBox(height: 10),
                          _RecentPostCard(post: mine[i]),
                        ],
                      ],
                    );
                  },
                )
              else
                const _RecentPostPlaceholder(),
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
    required this.onProfile,
  });

  final String greeting;
  final String name;
  final String? profilePicture;
  final VoidCallback onProfile;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(greeting, style: const TextStyle(color: _muted, fontSize: 15, height: 1.2)),
              const SizedBox(height: 2),
              Text(
                '$name ✨',
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
        Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onProfile,
            customBorder: const CircleBorder(),
            child: Container(
              width: 48,
              height: 48,
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
                        size: 48,
                        backgroundColor: _cardBg,
                      )
                    : Image.asset(
                        'assets/images/DEITECIrc-192.webp',
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => const Icon(
                          LucideIcons.coffee,
                          color: HubTheme.accent,
                          size: 22,
                        ),
                      ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _MindComposerCard extends StatelessWidget {
  const _MindComposerCard({
    required this.controller,
    required this.platform,
    required this.onPlatformChanged,
    required this.onSubmit,
  });

  final TextEditingController controller;
  final String platform;
  final ValueChanged<String> onPlatformChanged;
  final VoidCallback onSubmit;

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
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Padding(
                padding: EdgeInsets.only(top: 2),
                child: Icon(LucideIcons.penLine, color: _muted, size: 20),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextField(
                  controller: controller,
                  style: const TextStyle(color: Colors.white, fontSize: 16, height: 1.4),
                  maxLines: 3,
                  minLines: 1,
                  decoration: const InputDecoration(
                    isDense: true,
                    border: InputBorder.none,
                    hintText: "What's on your mind?",
                    hintStyle: TextStyle(color: Color(0xFF6B7280), fontSize: 16),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              SharePlatformSelector(
                platform: platform,
                compact: true,
                onChanged: onPlatformChanged,
              ),
              const Spacer(),
              Material(
                color: HubTheme.accent,
                borderRadius: BorderRadius.circular(999),
                elevation: 0,
                child: InkWell(
                  onTap: onSubmit,
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

class _StatsRow extends StatelessWidget {
  const _StatsRow({
    required this.dayStreak,
    required this.teasShared,
    required this.momentsSaved,
  });

  final int dayStreak;
  final int teasShared;
  final int momentsSaved;

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
            icon: LucideIcons.sparkles,
            value: '$momentsSaved',
            label: 'Moments saved',
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
  });

  final IconData icon;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
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
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.title,
    required this.actionLabel,
    required this.onAction,
  });

  final String title;
  final String actionLabel;
  final VoidCallback onAction;

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
              Text(actionLabel, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
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

class _RecentPostCard extends StatelessWidget {
  const _RecentPostCard({required this.post});

  final Map<String, dynamic> post;

  @override
  Widget build(BuildContext context) {
    final content = '${post['content'] ?? ''}'.trim();
    final platform = '${post['platform'] ?? post['kind'] ?? 'linkedin'}';
    final kind = sharePlatformLabel(platform);
    final createdAt = post['createdAt'];
    final likes = (post['likes'] as num?)?.toInt() ?? 0;
    final when = createdAt is DateTime ? formatTimeAgo(createdAt) : '';

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text.rich(
                  TextSpan(
                    style: const TextStyle(color: _muted, fontSize: 12, fontWeight: FontWeight.w500),
                    children: [
                      if (when.isNotEmpty) TextSpan(text: when),
                      if (when.isNotEmpty)
                        const TextSpan(text: ' • ', style: TextStyle(color: Color(0xFF4B5563))),
                      TextSpan(
                        text: kind,
                        style: const TextStyle(color: HubTheme.accent, fontWeight: FontWeight.w700),
                      ),
                    ],
                  ),
                ),
              ),
              const Icon(LucideIcons.ellipsis, color: Color(0xFF6B7280), size: 18),
            ],
          ),
          if (content.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(
              content,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 17,
                fontWeight: FontWeight.w600,
                height: 1.35,
              ),
            ),
          ],
          const SizedBox(height: 14),
          Row(
            children: [
              const Icon(LucideIcons.heart, color: HubTheme.accent, size: 18),
              const SizedBox(width: 6),
              Text(
                '$likes',
                style: const TextStyle(color: _muted, fontSize: 13, fontWeight: FontWeight.w600),
              ),
              const Spacer(),
              Icon(LucideIcons.bookmark, color: Colors.white.withValues(alpha: 0.35), size: 18),
            ],
          ),
        ],
      ),
    );
  }
}

class _RecentPostPlaceholder extends StatelessWidget {
  const _RecentPostPlaceholder();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: _cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _cardBorder),
      ),
      child: const Text(
        'Write something above, pick LinkedIn / X / Reddit, and share — your posts will show up here.',
        textAlign: TextAlign.center,
        style: TextStyle(color: _muted, fontSize: 14, height: 1.45, fontWeight: FontWeight.w500),
      ),
    );
  }
}
