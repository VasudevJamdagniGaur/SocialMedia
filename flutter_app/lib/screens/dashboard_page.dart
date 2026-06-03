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
                padding: const EdgeInsets.fromLTRB(24, 16, 24, 100),
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
                        const SizedBox(height: 24),
                        _DateSelector(
                          isDark: isDark,
                          cardBg: cardBg,
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
                          isDark: isDark,
                          cardBg: cardBg,
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
                        const SizedBox(height: 12),
                        _ActionButton(
                          isDark: isDark,
                          cardBg: cardBg,
                          hubText: hubText,
                          icon: LucideIcons.messageCircle,
                          label: "Spill day's tea",
                          onTap: () => _navigateChat(whisper: false),
                        ),
                        const SizedBox(height: 12),
                        _ActionButton(
                          isDark: isDark,
                          cardBg: cardBg,
                          hubText: hubText,
                          icon: LucideIcons.messageCircle,
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
              bottom: _showFab ? 88 : 72,
              child: AnimatedOpacity(
                duration: const Duration(milliseconds: 300),
                opacity: _showFab ? 1 : 0,
                child: FloatingActionButton(
                  onPressed: () => context.push(AppRoutes.community, extra: {'openCreatePost': true}),
                  backgroundColor: HubTheme.accent,
                  child: const Icon(LucideIcons.plus, color: Colors.white),
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

  @override
  Widget build(BuildContext context) {
    Widget circleBtn({required Widget child, required VoidCallback onTap}) {
      return Material(
        color: isDark ? HubTheme.bgSecondary : Colors.white,
        shape: const CircleBorder(),
        elevation: 2,
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: SizedBox(width: 40, height: 40, child: Center(child: child)),
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
                  size: 22,
                ),
              ),
              Row(
                children: [
                  circleBtn(onTap: onHelp, child: const Text('✨', style: TextStyle(fontSize: 17))),
                  const SizedBox(width: 8),
                  circleBtn(
                    onTap: onProfile,
                    child: profilePicture != null
                        ? ClipOval(
                            child: CachedNetworkImage(imageUrl: profilePicture!, width: 40, height: 40, fit: BoxFit.cover),
                          )
                        : const Icon(LucideIcons.user, color: HubTheme.accent, size: 22),
                  ),
                ],
              ),
            ],
          ),
          Material(
            color: isDark ? HubTheme.bgSecondary : Colors.white,
            shape: const CircleBorder(),
            child: const SizedBox(
              width: 56,
              height: 56,
              child: Icon(Icons.psychology, color: HubTheme.accent, size: 28),
            ),
          ),
        ],
      ),
    );
  }
}

class _DateSelector extends StatelessWidget {
  const _DateSelector({
    required this.isDark,
    required this.cardBg,
    required this.selectedDate,
    required this.hubText,
    required this.hubSecondary,
    required this.onPrev,
    required this.onNext,
    required this.onCalendar,
  });

  final bool isDark;
  final Color cardBg;
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
        border: Border.all(color: isDark ? HubTheme.divider : Colors.white12),
      ),
      child: Row(
        children: [
          IconButton(onPressed: onPrev, icon: Text('‹', style: TextStyle(fontSize: 22, color: hubSecondary))),
          Expanded(
            child: InkWell(
              onTap: onCalendar,
              borderRadius: BorderRadius.circular(12),
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: Column(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(LucideIcons.calendar, color: HubTheme.accent, size: 16),
                        const SizedBox(width: 8),
                        Text('Selected Date', style: TextStyle(color: hubSecondary, fontSize: 13)),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(formatDateForDisplay(selectedDate),
                        style: TextStyle(color: hubText, fontWeight: FontWeight.w600)),
                    Text('Click to open calendar', style: TextStyle(color: hubSecondary, fontSize: 11)),
                  ],
                ),
              ),
            ),
          ),
          IconButton(onPressed: onNext, icon: Text('›', style: TextStyle(fontSize: 22, color: hubSecondary))),
        ],
      ),
    );
  }
}

class _ReflectionCard extends StatelessWidget {
  const _ReflectionCard({
    required this.isDark,
    required this.cardBg,
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

  final bool isDark;
  final Color cardBg;
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
        border: Border.all(color: isDark ? HubTheme.divider : Colors.white12),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            InkWell(
              onTap: reflection.isNotEmpty ? onShareSuggestions : onOpenReflections,
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text("Day's Reflect", style: TextStyle(color: hubText, fontSize: 18, fontWeight: FontWeight.w600)),
                        Text(formatDateForDisplay(selectedDate), style: const TextStyle(color: HubTheme.accent, fontSize: 14)),
                      ],
                    ),
                  ),
                  const Icon(LucideIcons.chevronRight, color: HubTheme.accent),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Container(
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.06),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: isDark ? HubTheme.divider : Colors.white12),
              ),
              child: loading
                  ? const Padding(
                      padding: EdgeInsets.all(32),
                      child: Center(child: CircularProgressIndicator(color: HubTheme.accent)),
                    )
                  : reflection.isNotEmpty
                      ? Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Text(reflection, style: TextStyle(color: hubText, fontSize: 15, height: 1.5)),
                              const SizedBox(height: 12),
                              OutlinedButton.icon(
                                onPressed: onShareReflection,
                                icon: const Icon(LucideIcons.share2, size: 18),
                                label: const Text('Share to HUB'),
                                style: OutlinedButton.styleFrom(foregroundColor: Colors.white, side: BorderSide(color: HubTheme.accent.withValues(alpha: 0.5))),
                              ),
                            ],
                          ),
                        )
                      : Padding(
                          padding: const EdgeInsets.fromLTRB(20, 24, 20, 28),
                          child: Column(
                            children: [
                              Text('A quiet moment for this day', style: TextStyle(color: hubSecondary, fontSize: 14)),
                              const SizedBox(height: 20),
                              FilledButton(
                                onPressed: onChat,
                                style: FilledButton.styleFrom(
                                  backgroundColor: HubTheme.accent.withValues(alpha: 0.2),
                                  foregroundColor: hubText,
                                ),
                                child: const Text('Look back at this day'),
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

class _ActionButton extends StatelessWidget {
  const _ActionButton({
    required this.isDark,
    required this.cardBg,
    required this.hubText,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final bool isDark;
  final Color cardBg;
  final Color hubText;
  final IconData icon;
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
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: isDark ? HubTheme.divider : Colors.white12),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: HubTheme.accent, size: 20),
              const SizedBox(width: 12),
              Text(label, style: TextStyle(color: hubText, fontWeight: FontWeight.w500)),
            ],
          ),
        ),
      ),
    );
  }
}
