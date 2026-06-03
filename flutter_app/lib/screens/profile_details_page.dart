import 'dart:math' as math;

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../contexts/theme_context.dart';
import '../router/app_router.dart';
import '../services/auth_service.dart';

const _kLaserGreen = Color(0xFF8BC34A);
const _kErrorRed = Color(0xFFF28B82);
const _kSelectedGreen = Color(0xE681C995);

class ProfileDetailsPage extends StatefulWidget {
  const ProfileDetailsPage({super.key});

  @override
  State<ProfileDetailsPage> createState() => _ProfileDetailsPageState();
}

class _ProfileDetailsPageState extends State<ProfileDetailsPage> {
  final _nameController = TextEditingController();
  final _aboutController = TextEditingController();

  DateTime? _birthday;
  String _birthdayDisplay = '';
  bool _showCalendar = false;
  String _gender = '';
  bool _isSubmitting = false;
  String _error = '';

  String? _email;
  String? _password;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _readRouteExtra());
  }

  void _readRouteExtra() {
    final extra = GoRouterState.of(context).extra;
    if (extra is Map) {
      _email = extra['email'] as String?;
      _password = extra['password'] as String?;
    }
    if (_email == null || _password == null) {
      context.go(AppRoutes.signup);
    } else {
      setState(() {});
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _aboutController.dispose();
    super.dispose();
  }

  int _calculateAge(DateTime birthDate) {
    final today = DateTime.now();
    var age = today.year - birthDate.year;
    final monthDiff = today.month - birthDate.month;
    if (monthDiff < 0 || (monthDiff == 0 && today.day < birthDate.day)) {
      age--;
    }
    return age;
  }

  String _formatDate(DateTime date) {
    final year = date.year.toString().padLeft(4, '0');
    final month = date.month.toString().padLeft(2, '0');
    final day = date.day.toString().padLeft(2, '0');
    return '$year-$month-$day';
  }

  String _formatDateDisplay(DateTime date) {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    return '${months[date.month - 1]} ${date.day}, ${date.year}';
  }

  String? _validate() {
    final name = _nameController.text.trim();
    if (name.isEmpty) return 'Please enter your name.';
    if (_birthday == null) return 'Please select your birthday.';
    final age = _calculateAge(_birthday!);
    if (age < 13) return 'You must be at least 13 years old to use this service.';
    if (age > 120) return 'Please enter a valid birthday.';
    if (_gender.isEmpty) return 'Please select your gender.';
    if (_aboutController.text.trim().isEmpty) return 'Please tell us about yourself.';
    return null;
  }

  Future<void> _ensureUserDocument(User user, String displayName) async {
    try {
      await FirebaseFirestore.instance.collection('users').doc(user.uid).set(
        {
          'createdAt': FieldValue.serverTimestamp(),
          'email': user.email,
          'displayName': user.displayName ?? displayName,
        },
        SetOptions(merge: true),
      );
      debugPrint('✅ User document created in Firestore');
    } catch (error) {
      debugPrint('Error creating user document: $error');
    }
  }

  Future<void> _saveProfileLocally(User user, int age) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('user_age_${user.uid}', age.toString());
    await prefs.setString('user_birthday_${user.uid}', _formatDate(_birthday!));
    await prefs.setString('user_gender_${user.uid}', _gender);
    await prefs.setString('user_bio_${user.uid}', _aboutController.text.trim());
  }

  Future<void> _handleSubmit() async {
    if (_email == null || _password == null) {
      setState(() => _error = 'Missing email or password. Please go back and try again.');
      context.go(AppRoutes.signup);
      return;
    }

    final message = _validate();
    if (message != null) {
      setState(() => _error = message);
      return;
    }

    setState(() {
      _isSubmitting = true;
      _error = '';
    });

    try {
      final result = await AuthService().signUpUser(
        _email!,
        _password!,
        _nameController.text.trim(),
      );

      if (!mounted) return;

      if (result.success) {
        final user = AuthService().getCurrentUser();
        if (user != null) {
          await _ensureUserDocument(user, _nameController.text.trim());
          final age = _calculateAge(_birthday!);
          await _saveProfileLocally(user, age);
          debugPrint('✅ Profile data saved');
        }
        if (mounted) context.go(AppRoutes.dashboard);
      } else {
        setState(() => _error = result.error ?? 'Sign up failed. Please try again.');
      }
    } catch (err) {
      if (mounted) {
        setState(() => _error = err.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    context.watch<ThemeNotifier>();

    if (_email == null || _password == null) {
      return const Scaffold(
        backgroundColor: Color(0xFF090A0F),
        body: Center(child: CircularProgressIndicator(color: _kLaserGreen)),
      );
    }

    return Scaffold(
      body: Stack(
        fit: StackFit.expand,
        children: [
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: RadialGradient(
                center: Alignment(0, 1),
                radius: 1.4,
                colors: [Color(0xFF1B2735), Color(0xFF090A0F)],
              ),
            ),
          ),
          const _ProfileLaserBackground(),
          const _ProfileTwinklingStars(),
          SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 448),
                  child: Container(
                    padding: const EdgeInsets.all(24),
                    margin: const EdgeInsets.only(bottom: 32),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.7),
                      borderRadius: BorderRadius.circular(24),
                      border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
                      boxShadow: const [
                        BoxShadow(color: Color(0x4D000000), blurRadius: 32, offset: Offset(0, 8)),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Text(
                          'Tell us about yourself',
                          style: TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w600,
                            color: Colors.white,
                          ),
                        ),
                        const SizedBox(height: 24),
                        _buildLabel('Name'),
                        _MobileInput(
                          controller: _nameController,
                          hint: 'Your full name',
                          autofillHints: const [AutofillHints.name],
                        ),
                        const SizedBox(height: 20),
                        _buildLabel('Birthday'),
                        GestureDetector(
                          onTap: () => setState(() => _showCalendar = true),
                          child: AbsorbPointer(
                            child: _MobileInput(
                              controller: TextEditingController(text: _birthdayDisplay),
                              hint: 'Select your birthday',
                              suffix: const Icon(LucideIcons.calendar, color: Color(0xFFCBD5E1), size: 20),
                            ),
                          ),
                        ),
                        const SizedBox(height: 20),
                        _buildLabel('Gender'),
                        const SizedBox(height: 12),
                        ...[
                          ('female', 'Female 👩'),
                          ('male', 'Male 👨'),
                          ('other', 'Other 🌈'),
                        ].map((option) {
                          final selected = _gender == option.$1;
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: Material(
                              color: Colors.transparent,
                              child: InkWell(
                                onTap: () => setState(() => _gender = option.$1),
                                borderRadius: BorderRadius.circular(12),
                                child: AnimatedContainer(
                                  duration: const Duration(milliseconds: 300),
                                  padding: const EdgeInsets.symmetric(vertical: 12),
                                  decoration: BoxDecoration(
                                    color: selected
                                        ? const Color(0x3381C995)
                                        : AppColors.bottomNavDark,
                                    borderRadius: BorderRadius.circular(12),
                                    border: Border.all(
                                      color: selected
                                          ? const Color(0xFFC084FC)
                                          : const Color(0xFF4B5563),
                                      width: 2,
                                    ),
                                  ),
                                  child: Text(
                                    option.$2,
                                    textAlign: TextAlign.center,
                                    style: TextStyle(
                                      color: selected ? Colors.white : const Color(0xFFD1D5DB),
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          );
                        }),
                        const SizedBox(height: 20),
                        _buildLabel('About you'),
                        _MobileInput(
                          controller: _aboutController,
                          hint: 'How are you feeling these days?',
                          maxLines: 4,
                          minHeight: 100,
                        ),
                        if (_error.isNotEmpty) ...[
                          const SizedBox(height: 12),
                          Text(_error, style: const TextStyle(color: _kErrorRed, fontSize: 14)),
                        ],
                        const SizedBox(height: 20),
                        _GlassButton(
                          label: _isSubmitting ? 'Creating account…' : 'Create account',
                          onPressed: _isSubmitting ? null : _handleSubmit,
                          filled: true,
                          opacity: _isSubmitting ? 0.7 : 1,
                        ),
                        const SizedBox(height: 12),
                        _GlassButton(
                          label: 'Back',
                          onPressed: () => context.go(AppRoutes.signup),
                          filled: false,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
          if (_showCalendar)
            BirthdayCalendar(
              selectedDate: _birthday,
              onDateSelect: (date) {
                setState(() {
                  _birthday = date;
                  _birthdayDisplay = _formatDateDisplay(date);
                  _showCalendar = false;
                });
              },
              onClose: () => setState(() => _showCalendar = false),
            ),
        ],
      ),
    );
  }

  Widget _buildLabel(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(text, style: const TextStyle(color: Color(0xFFCBD5E1), fontSize: 14)),
    );
  }
}

class _MobileInput extends StatelessWidget {
  const _MobileInput({
    required this.controller,
    required this.hint,
    this.suffix,
    this.maxLines = 1,
    this.minHeight = 48,
    this.autofillHints,
  });

  final TextEditingController controller;
  final String hint;
  final Widget? suffix;
  final int maxLines;
  final double minHeight;
  final Iterable<String>? autofillHints;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: BoxConstraints(minHeight: minHeight),
      decoration: BoxDecoration(
        color: AppColors.bottomNavDark,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0x14FFFFFF)),
        boxShadow: const [
          BoxShadow(color: Color(0x26000000), blurRadius: 16, offset: Offset(0, 4)),
        ],
      ),
      child: TextField(
        controller: controller,
        maxLines: maxLines,
        autofillHints: autofillHints,
        style: const TextStyle(color: Colors.white, fontSize: 16),
        decoration: InputDecoration(
          hintText: hint,
          hintStyle: const TextStyle(color: Color(0xFF9CA3AF)),
          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          border: InputBorder.none,
          suffixIcon: suffix != null
              ? Padding(padding: const EdgeInsets.only(right: 12), child: suffix)
              : null,
          suffixIconConstraints: const BoxConstraints(minWidth: 32, minHeight: 32),
        ),
      ),
    );
  }
}

class _GlassButton extends StatelessWidget {
  const _GlassButton({
    required this.label,
    required this.onPressed,
    required this.filled,
    this.opacity = 1,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool filled;
  final double opacity;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: opacity,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onPressed,
          borderRadius: BorderRadius.circular(16),
          child: Ink(
            decoration: BoxDecoration(
              color: filled ? Colors.white.withValues(alpha: 0.1) : Colors.transparent,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: filled
                    ? Colors.white.withValues(alpha: 0.2)
                    : Colors.white.withValues(alpha: 0.3),
              ),
              boxShadow: filled
                  ? [BoxShadow(color: Colors.black.withValues(alpha: 0.1), blurRadius: 8, offset: const Offset(0, 2))]
                  : null,
            ),
            child: Container(
              constraints: const BoxConstraints(minHeight: 48),
              alignment: Alignment.center,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              child: Text(
                label,
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.9),
                  fontWeight: FontWeight.w600,
                  fontSize: 16,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ProfileLaserBackground extends StatefulWidget {
  const _ProfileLaserBackground();

  @override
  State<_ProfileLaserBackground> createState() => _ProfileLaserBackgroundState();
}

class _ProfileLaserBackgroundState extends State<_ProfileLaserBackground>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: const Duration(seconds: 4))..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) => CustomPaint(
        painter: _ProfileLaserPainter(progress: _controller.value),
        size: Size.infinite,
      ),
    );
  }
}

class _ProfileLaserPainter extends CustomPainter {
  _ProfileLaserPainter({required this.progress});

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final centerX = size.width * 0.5;
    final baseY = size.height * 0.4;
    final beamHeight = size.height * 1.4;
    final beamWidth = size.width * 0.08;
    final pulse = 0.7 + 0.3 * math.sin(progress * math.pi * 2);
    final rect = Rect.fromCenter(
      center: Offset(centerX, baseY + beamHeight * 0.35),
      width: beamWidth * pulse,
      height: beamHeight,
    );
    final paint = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [
          _kLaserGreen.withValues(alpha: 0),
          _kLaserGreen.withValues(alpha: 0.15 * pulse),
          _kLaserGreen.withValues(alpha: 0.55 * pulse),
          _kLaserGreen.withValues(alpha: 0.25 * pulse),
          _kLaserGreen.withValues(alpha: 0),
        ],
        stops: const [0.0, 0.25, 0.5, 0.75, 1.0],
      ).createShader(rect)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 24);
    canvas.drawRect(rect, paint);
  }

  @override
  bool shouldRepaint(covariant _ProfileLaserPainter oldDelegate) =>
      oldDelegate.progress != progress;
}

class _ProfileTwinklingStars extends StatelessWidget {
  const _ProfileTwinklingStars();

  @override
  Widget build(BuildContext context) {
    final random = math.Random(99);
    final size = MediaQuery.sizeOf(context);
    return Stack(
      children: List.generate(80, (i) {
        final starSize = random.nextDouble() * 3 + 1;
        return Positioned(
          left: random.nextDouble() * size.width,
          top: random.nextDouble() * size.height,
          child: Container(
            width: starSize,
            height: starSize,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: Colors.white.withValues(alpha: random.nextDouble() * 0.7 + 0.3),
            ),
          ),
        );
      }),
    );
  }
}

enum _CalendarViewMode { calendar, year, month }

class BirthdayCalendar extends StatefulWidget {
  const BirthdayCalendar({
    super.key,
    required this.selectedDate,
    required this.onDateSelect,
    required this.onClose,
  });

  final DateTime? selectedDate;
  final ValueChanged<DateTime> onDateSelect;
  final VoidCallback onClose;

  @override
  State<BirthdayCalendar> createState() => _BirthdayCalendarState();
}

class _BirthdayCalendarState extends State<BirthdayCalendar> {
  static const _dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  static const _monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  late DateTime _currentMonth;
  int? _selectedYear;
  _CalendarViewMode _viewMode = _CalendarViewMode.calendar;
  bool _isAnimating = false;

  final _yearScrollController = ScrollController();
  final _monthScrollController = ScrollController();
  double _yearScrollPosition = 0;
  double _monthScrollPosition = 0;

  @override
  void initState() {
    super.initState();
    _initDates();
  }

  void _initDates() {
    final today = DateTime.now();
    final maxYear = today.year - 13;
    final minYear = today.year - 120;

    if (widget.selectedDate != null) {
      final year = widget.selectedDate!.year.clamp(minYear, maxYear);
      _currentMonth = DateTime(year, widget.selectedDate!.month, 1);
      _selectedYear = year;
    } else {
      _selectedYear = 2005.clamp(minYear, maxYear);
      _currentMonth = DateTime(_selectedYear!, 1, 1);
    }
  }

  @override
  void dispose() {
    _yearScrollController.dispose();
    _monthScrollController.dispose();
    super.dispose();
  }

  List<int> _getYearRange() {
    final today = DateTime.now();
    final maxYear = today.year - 13;
    final minYear = today.year - 120;
    return [for (var y = maxYear; y >= minYear; y--) y];
  }

  List<DateTime?> _getDaysInMonth(DateTime date) {
    final firstDay = DateTime(date.year, date.month, 1);
    final lastDay = DateTime(date.year, date.month + 1, 0);
    final daysInMonth = lastDay.day;
    final startingDayOfWeek = firstDay.weekday % 7;

    final days = <DateTime?>[];
    for (var i = 0; i < startingDayOfWeek; i++) {
      days.add(null);
    }
    for (var day = 1; day <= daysInMonth; day++) {
      days.add(DateTime(date.year, date.month, day));
    }
    return days;
  }

  bool _isFuture(DateTime date) {
    final today = DateTime.now();
    return date.isAfter(DateTime(today.year, today.month, today.day, 23, 59, 59, 999));
  }

  bool _isSelected(DateTime date) {
    final selected = widget.selectedDate;
    if (selected == null) return false;
    return date.year == selected.year &&
        date.month == selected.month &&
        date.day == selected.day;
  }

  void _handlePreviousMonth() {
    setState(() => _isAnimating = true);
    Future.delayed(const Duration(milliseconds: 150), () {
      if (!mounted) return;
      setState(() {
        _currentMonth = DateTime(_currentMonth.year, _currentMonth.month - 1, 1);
        _isAnimating = false;
      });
    });
  }

  void _handleNextMonth() {
    setState(() => _isAnimating = true);
    Future.delayed(const Duration(milliseconds: 150), () {
      if (!mounted) return;
      setState(() {
        _currentMonth = DateTime(_currentMonth.year, _currentMonth.month + 1, 1);
        _isAnimating = false;
      });
    });
  }

  void _handleHeaderClick() {
    setState(() {
      if (_viewMode == _CalendarViewMode.calendar) {
        _viewMode = _CalendarViewMode.year;
        WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToYear());
      } else if (_viewMode == _CalendarViewMode.year) {
        _viewMode = _CalendarViewMode.calendar;
      } else {
        _viewMode = _CalendarViewMode.year;
        WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToYear());
      }
    });
  }

  void _scrollToYear() {
    final years = _getYearRange();
    final targetYear = _selectedYear ?? years.first;
    final index = years.indexOf(targetYear);
    if (index >= 0 && _yearScrollController.hasClients) {
      Future.delayed(const Duration(milliseconds: 100), () {
        if (_yearScrollController.hasClients) {
          _yearScrollController.jumpTo(index * 50.0);
          setState(() => _yearScrollPosition = index * 50.0);
        }
      });
    }
  }

  void _scrollToMonth() {
    final index = _currentMonth.month - 1;
    if (_monthScrollController.hasClients) {
      Future.delayed(const Duration(milliseconds: 100), () {
        if (_monthScrollController.hasClients) {
          _monthScrollController.jumpTo(index * 50.0);
          setState(() => _monthScrollPosition = index * 50.0);
        }
      });
    }
  }

  void _handleYearSelect(int year) {
    setState(() {
      _selectedYear = year;
      _currentMonth = DateTime(year, _currentMonth.month, 1);
      _viewMode = _CalendarViewMode.month;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToMonth());
  }

  void _handleMonthSelect(int monthIndex) {
    setState(() {
      _currentMonth = DateTime(_selectedYear!, monthIndex + 1, 1);
      _viewMode = _CalendarViewMode.calendar;
    });
  }

  double _wheelOpacity(int index, double scrollPosition) {
    const itemHeight = 50.0;
    final centerIndex = (scrollPosition / itemHeight).round();
    final distance = (index - centerIndex).abs();
    if (distance == 0) return 1;
    if (distance == 1) return 0.6;
    if (distance == 2) return 0.4;
    return 0.2;
  }

  double _wheelScale(int index, double scrollPosition) {
    const itemHeight = 50.0;
    final centerIndex = (scrollPosition / itemHeight).round();
    final distance = (index - centerIndex).abs();
    if (distance == 0) return 1;
    if (distance == 1) return 0.9;
    return 0.8;
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: Stack(
        children: [
          GestureDetector(
            onTap: widget.onClose,
            child: Container(color: Colors.black.withValues(alpha: 0.5)),
          ),
          Center(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 384, maxHeight: 500),
                child: _buildCalendarCard(),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCalendarCard() {
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 300),
      child: switch (_viewMode) {
        _CalendarViewMode.year => _buildYearPicker(),
        _CalendarViewMode.month => _buildMonthPicker(),
        _CalendarViewMode.calendar => _buildCalendarView(),
      },
    );
  }

  BoxDecoration get _cardDecoration => BoxDecoration(
        color: AppColors.bottomNavDark,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0x14FFFFFF)),
        boxShadow: const [
          BoxShadow(color: Color(0x4D000000), blurRadius: 32, offset: Offset(0, 8)),
        ],
      );

  Widget _buildYearPicker() {
    final years = _getYearRange();
    const itemHeight = 50.0;

    return Container(
      key: const ValueKey('year'),
      padding: const EdgeInsets.all(24),
      decoration: _cardDecoration,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          InkWell(
            onTap: _handleHeaderClick,
            child: const Text(
              'Select Year',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: Colors.white),
            ),
          ),
          const Divider(color: Color(0x80374151), height: 32),
          SizedBox(
            height: 250,
            child: Stack(
              children: [
                Positioned(
                  left: 0,
                  right: 0,
                  top: 100,
                  height: itemHeight,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      border: Border(
                        top: BorderSide(color: Colors.white.withValues(alpha: 0.2)),
                        bottom: BorderSide(color: Colors.white.withValues(alpha: 0.2)),
                      ),
                    ),
                  ),
                ),
                NotificationListener<ScrollNotification>(
                  onNotification: (notification) {
                    if (notification is ScrollUpdateNotification) {
                      setState(() => _yearScrollPosition = _yearScrollController.offset);
                    }
                    return false;
                  },
                  child: ListView.builder(
                    controller: _yearScrollController,
                    itemExtent: itemHeight,
                    padding: const EdgeInsets.symmetric(vertical: 100),
                    itemCount: years.length,
                    itemBuilder: (context, index) {
                      final year = years[index];
                      final isCenter = (_yearScrollPosition / itemHeight).round() == index;
                      return GestureDetector(
                        onTap: () => _handleYearSelect(year),
                        child: Transform.scale(
                          scale: _wheelScale(index, _yearScrollPosition),
                          child: Opacity(
                            opacity: _wheelOpacity(index, _yearScrollPosition),
                            child: Center(
                              child: Text(
                                '$year',
                                style: TextStyle(
                                  color: isCenter ? Colors.white : const Color(0xFF9CA3AF),
                                  fontWeight: isCenter ? FontWeight.w600 : FontWeight.w400,
                                  fontSize: isCenter ? 20 : 18,
                                ),
                              ),
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMonthPicker() {
    const itemHeight = 50.0;

    return Container(
      key: const ValueKey('month'),
      padding: const EdgeInsets.all(24),
      decoration: _cardDecoration,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          InkWell(
            onTap: _handleHeaderClick,
            child: Text(
              '${_selectedYear ?? _currentMonth.year}',
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: Colors.white),
            ),
          ),
          const Divider(color: Color(0x80374151), height: 32),
          SizedBox(
            height: 250,
            child: Stack(
              children: [
                Positioned(
                  left: 0,
                  right: 0,
                  top: 100,
                  height: itemHeight,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      border: Border(
                        top: BorderSide(color: Colors.white.withValues(alpha: 0.2)),
                        bottom: BorderSide(color: Colors.white.withValues(alpha: 0.2)),
                      ),
                    ),
                  ),
                ),
                NotificationListener<ScrollNotification>(
                  onNotification: (notification) {
                    if (notification is ScrollUpdateNotification) {
                      setState(() => _monthScrollPosition = _monthScrollController.offset);
                    }
                    return false;
                  },
                  child: ListView.builder(
                    controller: _monthScrollController,
                    itemExtent: itemHeight,
                    padding: const EdgeInsets.symmetric(vertical: 100),
                    itemCount: 12,
                    itemBuilder: (context, index) {
                      final isCenter = (_monthScrollPosition / itemHeight).round() == index;
                      return GestureDetector(
                        onTap: () => _handleMonthSelect(index),
                        child: Transform.scale(
                          scale: _wheelScale(index, _monthScrollPosition),
                          child: Opacity(
                            opacity: _wheelOpacity(index, _monthScrollPosition),
                            child: Center(
                              child: Text(
                                _monthNames[index],
                                style: TextStyle(
                                  color: isCenter ? Colors.white : const Color(0xFF9CA3AF),
                                  fontWeight: isCenter ? FontWeight.w600 : FontWeight.w400,
                                  fontSize: isCenter ? 20 : 18,
                                ),
                              ),
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCalendarView() {
    final days = _getDaysInMonth(_currentMonth);

    return Container(
      key: const ValueKey('calendar'),
      padding: const EdgeInsets.all(24),
      decoration: _cardDecoration,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              IconButton(
                onPressed: _handlePreviousMonth,
                icon: const Icon(LucideIcons.chevronLeft, color: Color(0xFFD1D5DB)),
              ),
              Expanded(
                child: InkWell(
                  onTap: _handleHeaderClick,
                  child: AnimatedOpacity(
                    opacity: _isAnimating ? 0 : 1,
                    duration: const Duration(milliseconds: 150),
                    child: Text(
                      '${_monthNames[_currentMonth.month - 1]} ${_currentMonth.year}',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ),
              ),
              IconButton(
                onPressed: _handleNextMonth,
                icon: const Icon(LucideIcons.chevronRight, color: Color(0xFFD1D5DB)),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: _dayNames
                .map(
                  (day) => Expanded(
                    child: Center(
                      child: Text(
                        day,
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                          color: Color(0xFF9CA3AF),
                        ),
                      ),
                    ),
                  ),
                )
                .toList(),
          ),
          const SizedBox(height: 8),
          AnimatedOpacity(
            opacity: _isAnimating ? 0 : 1,
            duration: const Duration(milliseconds: 150),
            child: GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 7,
                mainAxisSpacing: 4,
                crossAxisSpacing: 4,
              ),
              itemCount: days.length,
              itemBuilder: (context, index) {
                final date = days[index];
                if (date == null) return const SizedBox.shrink();
                final selected = _isSelected(date);
                final future = _isFuture(date);
                return Material(
                  color: Colors.transparent,
                  child: InkWell(
                    onTap: future ? null : () => widget.onDateSelect(date),
                    borderRadius: BorderRadius.circular(8),
                    child: Container(
                      alignment: Alignment.center,
                      decoration: selected
                          ? BoxDecoration(
                              color: _kSelectedGreen,
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: const Color(0x14FFFFFF)),
                              boxShadow: const [
                                BoxShadow(color: Color(0x4D000000), blurRadius: 20, offset: Offset(0, 4)),
                              ],
                            )
                          : null,
                      child: Text(
                        '${date.day}',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: selected ? FontWeight.bold : FontWeight.w500,
                          color: selected
                              ? Colors.black
                              : future
                                  ? const Color(0xFF4B5563)
                                  : const Color(0xFFD1D5DB),
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
