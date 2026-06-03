import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';

import '../components/calendar_popup.dart';
import '../components/hub_theme.dart';
import '../components/hub_widgets.dart';
import '../contexts/theme_context.dart';
import '../router/app_router.dart';
import '../services/auth_service.dart';
import '../services/firestore_service.dart';
import '../services/firestore_result.dart';
import '../utils/date_utils.dart';

class _ReflectionItem {
  _ReflectionItem({
    required this.id,
    required this.date,
    required this.reflection,
    this.dateObj,
    this.createdAt,
  });

  final String id;
  final String date;
  final String reflection;
  final DateTime? dateObj;
  final DateTime? createdAt;
}

/// Mirrors src/components/AllReflectionsPage.js
class AllReflectionsPage extends StatefulWidget {
  const AllReflectionsPage({super.key});

  @override
  State<AllReflectionsPage> createState() => _AllReflectionsPageState();
}

class _AllReflectionsPageState extends State<AllReflectionsPage> {
  List<_ReflectionItem> _reflections = [];
  List<_ReflectionItem> _filtered = [];
  bool _loading = true;
  DateTime? _selectedDate;
  bool _calendarOpen = false;
  List<CalendarDayMarker> _reflectionDays = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final user = AuthService().getCurrentUser();
    if (user == null) {
      setState(() => _loading = false);
      return;
    }
    setState(() => _loading = true);
    final all = <_ReflectionItem>[];

    final podRefs = await FirestoreService.instance.getAllPodReflections(user.uid);
    if (podRefs.success) {
      final refs = podRefs['reflections'] as List? ?? [];
      for (final raw in refs) {
        final ref = Map<String, dynamic>.from(raw as Map);
        DateTime? reflectionDate;
        final dateId = ref['dateId'] as String?;
        if (dateId != null && dateId.contains('-')) {
          final p = dateId.split('-');
          reflectionDate = DateTime(int.parse(p[0]), int.parse(p[1]), int.parse(p[2]));
        } else {
          reflectionDate = ref['createdAt'] is DateTime ? ref['createdAt'] as DateTime : DateTime.now();
        }
        all.add(_ReflectionItem(
          id: ref['id'] as String? ?? '',
          date: dateId ?? getDateId(reflectionDate),
          dateObj: reflectionDate,
          reflection: ref['reflection'] as String? ?? '',
          createdAt: reflectionDate,
        ));
      }
    }

    final pods = await FirestoreService.instance.getAllPods(user.uid);
    if (pods.success) {
      final podList = pods['pods'] as List? ?? [];
      for (final raw in podList) {
        final pod = Map<String, dynamic>.from(raw as Map);
        final reflection = pod['reflection'] as String? ?? '';
        final startDate = pod['startDate'] as String? ?? '';
        if (reflection.isEmpty || startDate.isEmpty) continue;
        if (all.any((r) => r.date == startDate)) continue;
        DateTime reflectionDate;
        try {
          final p = startDate.split('-');
          reflectionDate = DateTime(int.parse(p[0]), int.parse(p[1]), int.parse(p[2]));
        } catch (_) {
          reflectionDate = pod['createdAt'] is DateTime ? pod['createdAt'] as DateTime : DateTime.now();
        }
        all.add(_ReflectionItem(
          id: pod['id'] as String? ?? startDate,
          date: startDate,
          dateObj: reflectionDate,
          reflection: reflection,
          createdAt: reflectionDate,
        ));
      }
    }

    final current = await FirestoreService.instance.getPodReflection(user.uid);
    if (current.success && (current.reflection ?? '').isNotEmpty) {
      final todayId = getDateId();
      if (!all.any((r) => r.date == todayId)) {
        all.add(_ReflectionItem(
          id: 'current',
          date: current['dateId'] as String? ?? todayId,
          dateObj: DateTime.now(),
          reflection: current.reflection ?? '',
          createdAt: current['createdAt'] is DateTime ? current['createdAt'] as DateTime : DateTime.now(),
        ));
      }
    }

    all.sort((a, b) => (b.createdAt ?? DateTime(0)).compareTo(a.createdAt ?? DateTime(0)));
    setState(() {
      _reflections = all;
      _filtered = all;
      _reflectionDays = all.map((r) => CalendarDayMarker(date: r.date)).toList();
      _loading = false;
    });
    _applyFilter();
  }

  void _applyFilter() {
    if (_selectedDate == null) {
      setState(() => _filtered = _reflections);
      return;
    }
    final id = getDateId(_selectedDate);
    setState(() => _filtered = _reflections.where((r) => r.date == id).toList());
  }

  int _currentIndex() {
    if (_selectedDate == null) return -1;
    return _reflections.indexWhere((r) => r.date == getDateId(_selectedDate));
  }

  @override
  Widget build(BuildContext context) {
    final isDark = context.watch<ThemeNotifier>().isDarkMode;

    return Scaffold(
      backgroundColor: HubTheme.scaffoldBg(isDark),
      body: Stack(
        children: [
          SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      IconButton(
                        icon: Icon(LucideIcons.arrowLeft, color: isDark ? Colors.white : Colors.grey.shade800),
                        onPressed: () => context.go(AppRoutes.pod),
                      ),
                      Icon(LucideIcons.sparkles, color: isDark ? const Color(0xFFFDD663) : const Color(0xFFE6B3BA)),
                      const SizedBox(width: 8),
                      Text('Reflections', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: isDark ? Colors.white : Colors.grey.shade800)),
                    ],
                  ),
                  Padding(
                    padding: const EdgeInsets.only(left: 56, bottom: 12),
                    child: Text('All your crew reflections', style: TextStyle(color: isDark ? Colors.grey.shade400 : Colors.grey.shade600, fontSize: 14)),
                  ),
                  Padding(
                    padding: const EdgeInsets.only(left: 56, bottom: 16),
                    child: InkWell(
                      onTap: () => setState(() => _calendarOpen = true),
                      child: Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: isDark ? const Color(0xFF262626) : Colors.white,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Row(
                          children: [
                            Icon(LucideIcons.calendar, color: isDark ? const Color(0xFF7DD3C0) : const Color(0xFF87A96B), size: 18),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    _selectedDate != null ? formatDateForDisplay(_selectedDate) : 'Search by date',
                                    style: TextStyle(fontWeight: FontWeight.w500, color: isDark ? Colors.white : Colors.grey.shade800),
                                  ),
                                  Text(_selectedDate != null ? 'Tap to change date' : 'Tap to select a date', style: TextStyle(fontSize: 12, color: Colors.grey)),
                                ],
                              ),
                            ),
                            if (_selectedDate != null)
                              IconButton(
                                icon: const Icon(LucideIcons.x, size: 18),
                                onPressed: () {
                                  setState(() => _selectedDate = null);
                                  _applyFilter();
                                },
                              ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  if (_selectedDate != null && _filtered.isNotEmpty)
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        IconButton(
                          onPressed: _currentIndex() > 0
                              ? () {
                                  final prev = _reflections[_currentIndex() - 1];
                                  setState(() => _selectedDate = prev.dateObj);
                                  _applyFilter();
                                }
                              : null,
                          icon: const Icon(LucideIcons.chevronLeft),
                        ),
                        Text(formatDateForDisplay(_selectedDate), style: TextStyle(fontWeight: FontWeight.w600, color: isDark ? Colors.white : Colors.grey.shade800)),
                        IconButton(
                          onPressed: _currentIndex() >= 0 && _currentIndex() < _reflections.length - 1
                              ? () {
                                  final next = _reflections[_currentIndex() + 1];
                                  setState(() => _selectedDate = next.dateObj);
                                  _applyFilter();
                                }
                              : null,
                          icon: const Icon(LucideIcons.chevronRight),
                        ),
                      ],
                    ),
                  if (_loading)
                    const ListSkeleton(count: 5)
                  else if (_filtered.isEmpty)
                    Padding(
                      padding: const EdgeInsets.all(32),
                      child: Center(
                        child: Text(
                          _selectedDate != null ? 'No reflection found for the selected date.' : 'No reflections yet. Start chatting in your crew to generate reflections!',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: isDark ? Colors.grey.shade400 : Colors.grey.shade600),
                        ),
                      ),
                    )
                  else
                    ..._filtered.map((r) => Container(
                          margin: const EdgeInsets.only(bottom: 12),
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: isDark ? const Color(0xFF262626) : Colors.white,
                            borderRadius: BorderRadius.circular(16),
                          ),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(LucideIcons.check, color: isDark ? const Color(0xFF81C995) : const Color(0xFF87A96B), size: 18),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(formatReflectionDateTime(r.createdAt, dateFallback: r.date), style: TextStyle(fontSize: 12, color: Colors.grey)),
                                    const SizedBox(height: 8),
                                    Text(r.reflection, style: TextStyle(fontSize: 14, height: 1.5, color: isDark ? Colors.grey.shade300 : Colors.grey.shade700)),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        )),
                ],
              ),
            ),
          ),
          CalendarPopup(
            isOpen: _calendarOpen,
            onClose: () => setState(() => _calendarOpen = false),
            selectedDate: _selectedDate ?? DateTime.now(),
            chatDays: _reflectionDays,
            onDateSelect: (d) {
              setState(() => _selectedDate = d);
              _applyFilter();
            },
          ),
        ],
      ),
    );
  }
}
