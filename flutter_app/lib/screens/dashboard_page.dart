import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../components/calendar_popup.dart';
import '../components/hub_theme.dart';
import '../contexts/theme_context.dart';
import '../router/app_router.dart';
import '../services/auth_service.dart';
import '../services/firestore_result.dart';
import '../services/firestore_service.dart';
import '../services/reflection_service.dart';
import '../utils/date_utils.dart';

/// Mirrors src/components/DashboardPage.js
class DashboardPage extends StatefulWidget {
  const DashboardPage({super.key});

  @override
  State<DashboardPage> createState() => _DashboardPageState();
}

class _DashboardPageState extends State<DashboardPage> {
  static const _dateKey = 'dashboard_selected_date_iso';

  DateTime _selectedDate = DateTime.now();
  String _reflection = '';
  bool _isCalendarOpen = false;
  bool _isLoadingReflection = false;
  List<CalendarDayMarker> _chatDays = [];
  String? _profilePicture;
  bool _showFab = true;
  double _lastScrollOffset = 0;

  @override
  void initState() {
    super.initState();
    _loadSavedDate();
    _ensureUser();
    _loadProfilePicture();
    _loadCalendarData();
    _loadReflection();
  }

  Future<void> _loadSavedDate() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_dateKey);
    if (saved != null) {
      final d = DateTime.tryParse(saved);
      if (d != null && mounted) setState(() => _selectedDate = d);
    }
  }

  Future<void> _persistDate() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_dateKey, _selectedDate.toIso8601String());
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
    if (result.success && mounted) setState(() => _chatDays = result.chatDays);
  }

  Future<void> _loadReflection() async {
    final dateId = getDateId(_selectedDate);
    final user = AuthService().getCurrentUser();
    if (user == null) {
      final local = await getReflectionFromLocalStorage(dateId);
      if (mounted) setState(() => _reflection = local);
      return;
    }
    setState(() => _isLoadingReflection = true);
    try {
      final result = await ReflectionService.instance.getReflection(user.uid, dateId);
      var text = result.reflection ?? '';
      if (text.isEmpty) text = await getReflectionFromLocalStorage(dateId);
      if (mounted) setState(() => _reflection = text);
    } catch (_) {
      final local = await getReflectionFromLocalStorage(dateId);
      if (mounted) setState(() => _reflection = local);
    } finally {
      if (mounted) setState(() => _isLoadingReflection = false);
    }
  }

  void _handleScroll(double offset) {
    if (offset < _lastScrollOffset) {
      if (!_showFab) setState(() => _showFab = true);
    } else if (offset > _lastScrollOffset && offset > 100) {
      if (_showFab) setState(() => _showFab = false);
    }
    _lastScrollOffset = offset;
  }

  void _navigateChat({required bool whisper}) {
    context.push(
      AppRoutes.chat,
      extra: {
        'selectedDate': whisper ? DateTime.now().toIso8601String() : _selectedDate.toIso8601String(),
        'isWhisperMode': whisper,
        if (whisper) 'isFreshSession': true,
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = context.watch<ThemeNotifier>().isDarkMode;
    final hubText = isDark ? HubTheme.text : const Color(0xFFE5E5E5);
    final hubSecondary = isDark ? HubTheme.textSecondary : const Color(0xFFB0B0B0);
    final cardBg = isDark ? HubTheme.bgSecondary : const Color(0xFF1E1E1E);
    final cardBorder = isDark ? HubTheme.divider : const Color(0x14FFFFFF);
    final cardShadow = [
      BoxShadow(
        color: Colors.black.withValues(alpha: isDark ? 0.3 : 0.2),
        blurRadius: isDark ? 16 : 12,
        offset: const Offset(0, 4),
      ),
    ];

    return Scaffold(
      backgroundColor: HubTheme.scaffoldBg(isDark),
      body: NotificationListener<ScrollNotification>(
        onNotification: (n) {
          if (n is ScrollUpdateNotification) _handleScroll(n.metrics.pixels);
          return false;
        },
        child: Stack(
          children: [
            SafeArea(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(24, 12, 24, 100),
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 400),
                    child: Column(
                      children: [
                        _TopBar(
                          isDark: isDark,
                          profilePicture: _profilePicture,
                          onThemeToggle: () => context.read<ThemeNotifier>().toggleTheme(),
                          onHelp: () => context.push(AppRoutes.helpImprove),
                          onProfile: () => context.push(AppRoutes.profile),
                        ),
                        const SizedBox(height: 32),
                        _DateSelector(
                          cardBg: cardBg,
                          cardBorder: cardBorder,
                          cardShadow: cardShadow,
                          selectedDate: _selectedDate,
                          hubText: hubText,
                          hubSecondary: hubSecondary,
                          onPrev: () {
                            setState(() => _selectedDate = _selectedDate.subtract(const Duration(days: 1)));
                            _persistDate();
                            _loadReflection();
                          },
                          onNext: () {
                            setState(() => _selectedDate = _selectedDate.add(const Duration(days: 1)));
                            _persistDate();
                            _loadReflection();
                          },
                          onCalendar: () async {
                            setState(() => _isCalendarOpen = true);
                            await _loadCalendarData();
                          },
                        ),
                        const SizedBox(height: 24),
                        _ReflectionCard(
                          cardBg: cardBg,
                          cardBorder: cardBorder,
                          cardShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.3),
                              blurRadius: 20,
                              offset: const Offset(0, 4),
                            ),
                          ],
                          hubText: hubText,
                          hubSecondary: hubSecondary,
                          selectedDate: _selectedDate,
                          reflection: _reflection,
                          loading: _isLoadingReflection,
                          onOpenReflections: () => context.push(AppRoutes.reflections),
                          onShareSuggestions: () => context.push(
                            AppRoutes.shareSuggestions,
                            extra: {'reflection': _reflection, 'selectedDate': _selectedDate.toIso8601String()},
                          ),
                          onShareReflection: () => context.push(
                            AppRoutes.shareReflection,
                            extra: {'reflection': _reflection, 'selectedDate': _selectedDate.toIso8601String()},
                          ),
                          onChat: () => _navigateChat(whisper: false),
                        ),
                        const SizedBox(height: 8),
                        _ActionButton(
                          cardBg: cardBg,
                          cardBorder: cardBorder,
                          hubText: hubText,
                          label: "Spill day's tea",
                          onTap: () => _navigateChat(whisper: false),
                        ),
                        const SizedBox(height: 12),
                        _ActionButton(
                          cardBg: cardBg,
                          cardBorder: cardBorder,
                          hubText: hubText,
                          label: 'Whisper Session',
                          onTap: () => _navigateChat(whisper: true),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            AnimatedPositioned(
              duration: const Duration(milliseconds: 300),
              right: 16,
              bottom: _showFab ? 80 : 64,
              child: AnimatedOpacity(
                duration: const Duration(milliseconds: 300),
                opacity: _showFab ? 1 : 0,
                child: IgnorePointer(
                  ignoring: !_showFab,
                  child: Material(
                    elevation: 0,
                    color: Colors.transparent,
                    child: InkWell(
                      onTap: () => context.push(AppRoutes.community, extra: {'openCreatePost': true}),
                      customBorder: const CircleBorder(),
                      child: Container(
                        width: 56,
                        height: 56,
                        decoration: BoxDecoration(
                          color: HubTheme.accent,
                          shape: BoxShape.circle,
                          boxShadow: [
                            BoxShadow(
                              color: HubTheme.accentShadow.withValues(alpha: 0.38),
                              blurRadius: 20,
                              offset: const Offset(0, 4),
                            ),
                          ],
                        ),
                        child: const Icon(LucideIcons.plus, color: Colors.white, size: 26),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            CalendarPopup(
              isOpen: _isCalendarOpen,
              onClose: () => setState(() => _isCalendarOpen = false),
              selectedDate: _selectedDate,
              chatDays: _chatDays,
              onDateSelect: (d) {
                setState(() => _selectedDate = d);
                _persistDate();
                _loadReflection();
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({
    required this.isDark,
    required this.profilePicture,
    required this.onThemeToggle,
    required this.onHelp,
    required this.onProfile,
  });

  final bool isDark;
  final String? profilePicture;
  final VoidCallback onThemeToggle;
  final VoidCallback onHelp;
  final VoidCallback onProfile;

  BoxDecoration _circleDecoration({bool hasImage = false}) => BoxDecoration(
        color: hasImage ? Colors.transparent : (isDark ? HubTheme.bgSecondary : Colors.white),
        shape: BoxShape.circle,
        border: hasImage ? null : Border.all(color: isDark ? HubTheme.divider : Colors.transparent),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: isDark ? 0.15 : 0.08),
            blurRadius: isDark ? 16 : 8,
          ),
          if (!isDark)
            BoxShadow(
              color: const Color(0xFFB19CD9).withValues(alpha: 0.15),
              blurRadius: 8,
            ),
        ],
      );

  @override
  Widget build(BuildContext context) {
    Widget circleBtn({required Widget child, required VoidCallback onTap, bool hasImage = false}) {
      return Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          customBorder: const CircleBorder(),
          child: Container(
            width: 40,
            height: 40,
            decoration: _circleDecoration(hasImage: hasImage),
            child: Center(child: child),
          ),
        ),
      );
    }

    return SizedBox(
      height: 56,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              circleBtn(
                onTap: onThemeToggle,
                child: Icon(
                  isDark ? LucideIcons.moon : LucideIcons.sun,
                  color: HubTheme.accent,
                  size: 20,
                ),
              ),
              Row(
                children: [
                  circleBtn(
                    onTap: onHelp,
                    child: const Text('✨', style: TextStyle(fontSize: 17, height: 1)),
                  ),
                  const SizedBox(width: 8),
                  circleBtn(
                    onTap: onProfile,
                    hasImage: profilePicture != null,
                    child: profilePicture != null
                        ? ClipOval(
                            child: CachedNetworkImage(
                              imageUrl: profilePicture!,
                              width: 40,
                              height: 40,
                              fit: BoxFit.cover,
                            ),
                          )
                        : Icon(LucideIcons.user, color: HubTheme.accent, size: 20),
                  ),
                ],
              ),
            ],
          ),
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: isDark ? HubTheme.bgSecondary : Colors.white,
              shape: BoxShape.circle,
              border: Border.all(
                color: isDark ? HubTheme.divider : const Color(0x33A855F7),
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: isDark ? 0.15 : 0.1),
                  blurRadius: isDark ? 16 : 12,
                ),
                if (!isDark)
                  BoxShadow(
                    color: HubTheme.accentShadow.withValues(alpha: 0.25),
                    blurRadius: 12,
                  ),
              ],
            ),
            child: ClipOval(
              child: Image.asset(
                'assets/images/DEITECIrc-192.webp',
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => Icon(Icons.psychology, color: HubTheme.accent, size: 28),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DateSelector extends StatelessWidget {
  const _DateSelector({
    required this.cardBg,
    required this.cardBorder,
    required this.cardShadow,
    required this.selectedDate,
    required this.hubText,
    required this.hubSecondary,
    required this.onPrev,
    required this.onNext,
    required this.onCalendar,
  });

  final Color cardBg;
  final Color cardBorder;
  final List<BoxShadow> cardShadow;
  final DateTime selectedDate;
  final Color hubText;
  final Color hubSecondary;
  final VoidCallback onPrev;
  final VoidCallback onNext;
  final VoidCallback onCalendar;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: cardBorder),
        boxShadow: cardShadow,
      ),
      child: Row(
        children: [
          IconButton(
            onPressed: onPrev,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
            icon: Text('‹', style: TextStyle(fontSize: 20, color: hubSecondary, height: 1)),
          ),
          Expanded(
            child: Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: onCalendar,
                borderRadius: BorderRadius.circular(12),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
                  child: Column(
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(LucideIcons.calendar, color: HubTheme.accent, size: 16),
                          const SizedBox(width: 8),
                          Text('Selected Date', style: TextStyle(color: hubSecondary, fontSize: 14)),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        formatDateForDisplay(selectedDate),
                        textAlign: TextAlign.center,
                        style: TextStyle(color: hubText, fontWeight: FontWeight.w600, fontSize: 16),
                      ),
                      const SizedBox(height: 2),
                      Text('Click to open calendar', style: TextStyle(color: hubSecondary, fontSize: 12)),
                    ],
                  ),
                ),
              ),
            ),
          ),
          IconButton(
            onPressed: onNext,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
            icon: Text('›', style: TextStyle(fontSize: 20, color: hubSecondary, height: 1)),
          ),
        ],
      ),
    );
  }
}

class _ReflectionCard extends StatelessWidget {
  const _ReflectionCard({
    required this.cardBg,
    required this.cardBorder,
    required this.cardShadow,
    required this.hubText,
    required this.hubSecondary,
    required this.selectedDate,
    required this.reflection,
    required this.loading,
    required this.onOpenReflections,
    required this.onShareSuggestions,
    required this.onShareReflection,
    required this.onChat,
  });

  final Color cardBg;
  final Color cardBorder;
  final List<BoxShadow> cardShadow;
  final Color hubText;
  final Color hubSecondary;
  final DateTime selectedDate;
  final String reflection;
  final bool loading;
  final VoidCallback onOpenReflections;
  final VoidCallback onShareSuggestions;
  final VoidCallback onShareReflection;
  final VoidCallback onChat;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: cardBorder),
        boxShadow: cardShadow,
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 24, 24, 20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: reflection.isNotEmpty ? onShareSuggestions : onOpenReflections,
                borderRadius: BorderRadius.circular(8),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text("Day's Reflect", style: TextStyle(color: hubText, fontSize: 18, fontWeight: FontWeight.w600)),
                          const SizedBox(height: 2),
                          Text(formatDateForDisplay(selectedDate), style: const TextStyle(color: HubTheme.accent, fontSize: 14)),
                        ],
                      ),
                    ),
                    const Icon(LucideIcons.chevronRight, color: HubTheme.accent, size: 20),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),
            Container(
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.06),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: cardBorder),
              ),
              child: loading
                  ? const Padding(
                      padding: EdgeInsets.symmetric(vertical: 40),
                      child: _LoadingDots(),
                    )
                  : reflection.isNotEmpty
                      ? Padding(
                          padding: const EdgeInsets.all(20),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Text(reflection, style: TextStyle(color: hubText, fontSize: 15, height: 1.5)),
                              const SizedBox(height: 16),
                              OutlinedButton.icon(
                                onPressed: onShareReflection,
                                icon: const Icon(LucideIcons.share2, size: 18, color: Colors.white),
                                label: const Text('Share to HUB', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                                style: OutlinedButton.styleFrom(
                                  backgroundColor: HubTheme.accent.withValues(alpha: 0.2),
                                  side: BorderSide(color: HubTheme.accent.withValues(alpha: 0.5)),
                                  padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 16),
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                                ),
                              ),
                            ],
                          ),
                        )
                      : Padding(
                          padding: const EdgeInsets.fromLTRB(24, 24, 24, 28),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Text('A quiet moment for this day', style: TextStyle(color: hubSecondary, fontSize: 14)),
                              const SizedBox(height: 24),
                              FilledButton(
                                onPressed: onChat,
                                style: FilledButton.styleFrom(
                                  backgroundColor: HubTheme.accent.withValues(alpha: 0.2),
                                  foregroundColor: hubText,
                                  elevation: 0,
                                  padding: const EdgeInsets.symmetric(vertical: 14),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(12),
                                    side: BorderSide(color: HubTheme.accent.withValues(alpha: 0.5)),
                                  ),
                                ),
                                child: const Text('Look back at this day', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500)),
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
}

class _LoadingDots extends StatefulWidget {
  const _LoadingDots();

  @override
  State<_LoadingDots> createState() => _LoadingDotsState();
}

class _LoadingDotsState extends State<_LoadingDots> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: List.generate(3, (i) {
            return AnimatedBuilder(
              animation: _controller,
              builder: (context, child) {
                final t = (_controller.value + i * 0.2) % 1.0;
                final y = -4 * (t < 0.5 ? t * 2 : (1 - t) * 2);
                return Transform.translate(
                  offset: Offset(0, y),
                  child: child,
                );
              },
              child: Container(
                width: 8,
                height: 8,
                margin: const EdgeInsets.symmetric(horizontal: 3),
                decoration: const BoxDecoration(color: HubTheme.accent, shape: BoxShape.circle),
              ),
            );
          }),
        ),
        const SizedBox(height: 16),
        Text('Preparing...', style: TextStyle(color: HubTheme.textSecondary, fontSize: 14)),
      ],
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({
    required this.cardBg,
    required this.cardBorder,
    required this.hubText,
    required this.label,
    required this.onTap,
  });

  final Color cardBg;
  final Color cardBorder;
  final Color hubText;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: cardBg,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 24),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: cardBorder),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(LucideIcons.messageCircle, color: HubTheme.accent, size: 20),
              const SizedBox(width: 12),
              Text(label, style: TextStyle(color: hubText, fontWeight: FontWeight.w500, fontSize: 16)),
            ],
          ),
        ),
      ),
    );
  }
}
