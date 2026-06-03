import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../components/calendar_popup.dart';
import '../components/hub_theme.dart';
import '../components/hub_widgets.dart';
import '../contexts/theme_context.dart';
import '../router/app_router.dart';
import '../services/auth_service.dart';
import '../utils/date_utils.dart';

class _DayReflectionItem {
  _DayReflectionItem({
    required this.id,
    required this.date,
    required this.reflection,
    required this.dateObj,
    required this.createdAt,
  });

  final String id;
  final String date;
  final String reflection;
  final DateTime dateObj;
  final DateTime createdAt;
}

class _MoodData {
  const _MoodData({this.happiness = 0, this.anxiety = 0, this.stress = 0, this.energy = 0});
  final int happiness;
  final int anxiety;
  final int stress;
  final int energy;
}

/// Mirrors src/components/AllDayReflectionsPage.js
class AllDayReflectionsPage extends StatefulWidget {
  const AllDayReflectionsPage({super.key});

  @override
  State<AllDayReflectionsPage> createState() => _AllDayReflectionsPageState();
}

class _AllDayReflectionsPageState extends State<AllDayReflectionsPage> {
  static const _dateKey = 'dashboard_selected_date_iso';

  List<_DayReflectionItem> _reflections = [];
  List<_DayReflectionItem> _filtered = [];
  bool _loading = true;
  DateTime _selectedDate = DateTime.now();
  bool _calendarOpen = false;
  List<CalendarDayMarker> _reflectionDays = [];
  _DayReflectionItem? _selectedReflection;
  _MoodData? _moodData;
  bool _loadingMood = false;

  @override
  void initState() {
    super.initState();
    _loadSavedDate();
    _loadReflections();
  }

  Future<void> _loadSavedDate() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_dateKey);
    if (saved != null) {
      final d = DateTime.tryParse(saved);
      if (d != null) setState(() => _selectedDate = d);
    }
  }

  Future<void> _loadReflections() async {
    final user = AuthService().getCurrentUser();
    if (user == null) {
      setState(() => _loading = false);
      return;
    }

    final cacheKey = 'all_day_reflections_${user.uid}';
    final prefs = await SharedPreferences.getInstance();
    final cached = prefs.getString(cacheKey);
    if (cached != null) {
      try {
        final parsed = jsonDecode(cached) as List;
        final items = parsed.map((r) {
          final m = Map<String, dynamic>.from(r as Map);
          return _DayReflectionItem(
            id: m['id'] as String? ?? '',
            date: m['date'] as String? ?? '',
            reflection: m['reflection'] as String? ?? '',
            dateObj: DateTime.parse(m['dateObj'] as String? ?? m['date'] as String? ?? DateTime.now().toIso8601String()),
            createdAt: DateTime.parse(m['createdAt'] as String? ?? DateTime.now().toIso8601String()),
          );
        }).toList()
          ..sort((a, b) => b.dateObj.compareTo(a.dateObj));
        setState(() {
          _reflections = items;
          _filtered = items;
          _reflectionDays = items.map((r) => CalendarDayMarker(date: r.date)).toList();
          _loading = false;
        });
        _applyDateFilter();
      } catch (_) {}
    }

    try {
      final all = <_DayReflectionItem>[];
      final daysSnap = await FirebaseFirestore.instance.collection('users/${user.uid}/days').get();

      for (final dayDoc in daysSnap.docs) {
        final dateId = dayDoc.id;
        final refSnap = await FirebaseFirestore.instance.doc('users/${user.uid}/days/$dateId/reflection/meta').get();
        if (!refSnap.exists) continue;
        final data = refSnap.data() ?? {};
        final text = data['summary'] ?? data['reflection'] ?? data['text'];
        if (text == null || '$text'.isEmpty) continue;
        DateTime reflectionDate;
        try {
          final p = dateId.split('-');
          reflectionDate = DateTime(int.parse(p[0]), int.parse(p[1]), int.parse(p[2]));
        } catch (_) {
          reflectionDate = DateTime.now();
        }
        var createdAt = reflectionDate;
        final ca = data['createdAt'] ?? data['updatedAt'];
        if (ca is Timestamp) createdAt = ca.toDate();
        all.add(_DayReflectionItem(
          id: dateId,
          date: dateId,
          reflection: '$text',
          dateObj: reflectionDate,
          createdAt: createdAt,
        ));
      }

      try {
        final oldSnap = await FirebaseFirestore.instance.collection('users/${user.uid}/dayReflections').get();
        for (final doc in oldSnap.docs) {
          if (all.any((r) => r.date == doc.id)) continue;
          final data = doc.data();
          final text = data['summary'] ?? data['reflection'] ?? data['text'];
          if (text == null) continue;
          DateTime reflectionDate;
          try {
            final p = doc.id.split('-');
            reflectionDate = DateTime(int.parse(p[0]), int.parse(p[1]), int.parse(p[2]));
          } catch (_) {
            reflectionDate = DateTime.now();
          }
          all.add(_DayReflectionItem(
            id: doc.id,
            date: doc.id,
            reflection: '$text',
            dateObj: reflectionDate,
            createdAt: reflectionDate,
          ));
        }
      } catch (_) {}

      final keys = prefs.getKeys().where((k) => k.startsWith('reflection_') && !k.startsWith('all_day_reflections_'));
      for (final key in keys) {
        final dateId = key.replaceFirst('reflection_', '');
        if (all.any((r) => r.date == dateId)) continue;
        final text = prefs.getString(key);
        if (text == null || text.isEmpty) continue;
        DateTime reflectionDate;
        try {
          final p = dateId.split('-');
          reflectionDate = DateTime(int.parse(p[0]), int.parse(p[1]), int.parse(p[2]));
        } catch (_) {
          reflectionDate = DateTime.now();
        }
        all.add(_DayReflectionItem(
          id: dateId,
          date: dateId,
          reflection: text,
          dateObj: reflectionDate,
          createdAt: reflectionDate,
        ));
      }

      all.sort((a, b) => b.dateObj.compareTo(a.dateObj));
      await prefs.setString(
        cacheKey,
        jsonEncode(all.map((r) => {
              'id': r.id,
              'date': r.date,
              'reflection': r.reflection,
              'dateObj': r.dateObj.toIso8601String(),
              'createdAt': r.createdAt.toIso8601String(),
            }).toList()),
      );

      setState(() {
        _reflections = all;
        _reflectionDays = all.map((r) => CalendarDayMarker(date: r.date)).toList();
        _loading = false;
      });
      _applyDateFilter();
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _applyDateFilter() {
    final id = getDateId(_selectedDate);
    setState(() => _filtered = _reflections.where((r) => r.date == id).toList());
  }

  Future<void> _loadMood(String dateId) async {
    final user = AuthService().getCurrentUser();
    if (user == null) return;
    setState(() => _loadingMood = true);
    try {
      final snap = await FirebaseFirestore.instance.doc('users/${user.uid}/days/$dateId/moodChart/daily').get();
      if (snap.exists) {
        final d = snap.data() ?? {};
        setState(() => _moodData = _MoodData(
              happiness: (d['happiness'] as num?)?.toInt() ?? 0,
              anxiety: (d['anxiety'] as num?)?.toInt() ?? 0,
              stress: (d['stress'] as num?)?.toInt() ?? 0,
              energy: (d['energy'] as num?)?.toInt() ?? 0,
            ));
      } else {
        setState(() => _moodData = null);
      }
    } catch (_) {
      setState(() => _moodData = null);
    } finally {
      if (mounted) setState(() => _loadingMood = false);
    }
  }

  Future<void> _onDateSelect(DateTime date) async {
    setState(() => _selectedDate = date);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_dateKey, date.toIso8601String());
    _applyDateFilter();
    final id = getDateId(date);
    final match = _reflections.where((r) => r.date == id).firstOrNull;
    if (match != null) {
      setState(() => _selectedReflection = match);
      await _loadMood(id);
    } else {
      setState(() {
        _selectedReflection = null;
        _moodData = null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = context.watch<ThemeNotifier>().isDarkMode;

    return Scaffold(
      backgroundColor: isDark ? HubTheme.bg : HubTheme.lightScaffold,
      body: Stack(
        children: [
          SafeArea(
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                  child: Row(
                    children: [
                      IconButton(
                        icon: Icon(LucideIcons.arrowLeft, color: isDark ? HubTheme.text : const Color(0xFF374151)),
                        onPressed: () => context.go(AppRoutes.dashboard),
                      ),
                      Icon(LucideIcons.zap, color: isDark ? HubTheme.accent : const Color(0xFF87A96B), size: 20),
                      const SizedBox(width: 8),
                      Text("Day's Reflect", style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: isDark ? HubTheme.text : const Color(0xFF1f2937))),
                      const Spacer(),
                      IconButton(
                        icon: Icon(LucideIcons.calendar, color: isDark ? HubTheme.accent : const Color(0xFF87A96B)),
                        onPressed: () => setState(() => _calendarOpen = true),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text('All your day reflections', style: TextStyle(fontSize: 14, color: isDark ? HubTheme.textSecondary : const Color(0xFF6b7280))),
                  ),
                ),
                Expanded(
                  child: _loading
                      ? const ListSkeleton(count: 5)
                      : _filtered.isEmpty
                          ? Center(
                              child: Text(
                                'No reflection found for the selected date.',
                                style: TextStyle(color: isDark ? HubTheme.textSecondary : const Color(0xFF6b7280)),
                              ),
                            )
                          : ListView.builder(
                              padding: const EdgeInsets.symmetric(horizontal: 16),
                              itemCount: _filtered.length,
                              itemBuilder: (_, i) {
                                final r = _filtered[i];
                                return InkWell(
                                  onTap: () async {
                                    setState(() => _selectedReflection = r);
                                    await _loadMood(r.date);
                                  },
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(vertical: 16),
                                    decoration: BoxDecoration(
                                      border: Border(top: i == 0 ? BorderSide.none : const BorderSide(color: HubTheme.divider)),
                                    ),
                                    child: Row(
                                      children: [
                                        Icon(LucideIcons.check, color: isDark ? HubTheme.accent : const Color(0xFF22c55e), size: 18),
                                        const SizedBox(width: 12),
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              Text(formatReflectionDateTime(r.createdAt, dateFallback: r.date), style: TextStyle(fontSize: 12, color: isDark ? HubTheme.textSecondary : const Color(0xFF6b7280))),
                                              const SizedBox(height: 4),
                                              Text(r.reflection, maxLines: 3, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 15, color: isDark ? HubTheme.text : const Color(0xFF1f2937))),
                                            ],
                                          ),
                                        ),
                                        IconButton(
                                          icon: Icon(LucideIcons.share2, color: HubTheme.accent, size: 18),
                                          onPressed: () => context.push(AppRoutes.shareReflection, extra: {'reflectionToShare': {'reflection': r.reflection, 'date': r.date}}),
                                        ),
                                      ],
                                    ),
                                  ),
                                );
                              },
                            ),
                ),
              ],
            ),
          ),
          CalendarPopup(
            isOpen: _calendarOpen,
            onClose: () => setState(() => _calendarOpen = false),
            selectedDate: _selectedDate,
            chatDays: _reflectionDays,
            onDateSelect: (d) {
              setState(() => _calendarOpen = false);
              _onDateSelect(d);
            },
          ),
          if (_selectedReflection != null) _DetailModal(
            reflection: _selectedReflection!,
            mood: _moodData,
            loadingMood: _loadingMood,
            isDark: isDark,
            onClose: () => setState(() {
              _selectedReflection = null;
              _moodData = null;
            }),
            onShare: () => context.push(AppRoutes.shareReflection, extra: {'reflectionToShare': _selectedReflection}),
          ),
        ],
      ),
    );
  }
}

extension on Iterable<_DayReflectionItem> {
  _DayReflectionItem? get firstOrNull {
    final it = iterator;
    if (!it.moveNext()) return null;
    return it.current;
  }
}

class _DetailModal extends StatelessWidget {
  const _DetailModal({
    required this.reflection,
    required this.mood,
    required this.loadingMood,
    required this.isDark,
    required this.onClose,
    required this.onShare,
  });

  final _DayReflectionItem reflection;
  final _MoodData? mood;
  final bool loadingMood;
  final bool isDark;
  final VoidCallback onClose;
  final VoidCallback onShare;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onClose,
      child: ColoredBox(
        color: Colors.black54,
        child: Center(
          child: GestureDetector(
            onTap: () {},
            child: Container(
              margin: const EdgeInsets.all(24),
              padding: const EdgeInsets.all(24),
              constraints: const BoxConstraints(maxWidth: 400, maxHeight: 500),
              decoration: BoxDecoration(
                color: isDark ? HubTheme.bgSecondary : Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: HubTheme.divider),
              ),
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      children: [
                        const Icon(LucideIcons.zap, color: HubTheme.accent, size: 20),
                        const SizedBox(width: 8),
                        Text("Day's Reflect", style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: isDark ? HubTheme.text : const Color(0xFF1f2937))),
                        const Spacer(),
                        IconButton(icon: const Icon(LucideIcons.x), onPressed: onClose),
                      ],
                    ),
                    Text(formatReflectionDateTime(reflection.createdAt, dateFallback: reflection.date), style: const TextStyle(fontSize: 12, color: HubTheme.textSecondary)),
                    const SizedBox(height: 16),
                    if (loadingMood)
                      const Center(child: CircularProgressIndicator(color: HubTheme.accent))
                    else if (mood != null) ...[
                      const Text('Emotional Metrics', style: TextStyle(fontWeight: FontWeight.w600, color: HubTheme.text)),
                      const SizedBox(height: 12),
                      _MoodBar(label: 'Happiness', value: mood!.happiness),
                      _MoodBar(label: 'Energy', value: mood!.energy),
                      _MoodBar(label: 'Anxiety', value: mood!.anxiety),
                      _MoodBar(label: 'Stress', value: mood!.stress),
                    ] else
                      const Text('No emotional metrics available for this date', style: TextStyle(fontSize: 12, color: HubTheme.textSecondary)),
                    const SizedBox(height: 16),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.06),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(reflection.reflection, style: TextStyle(fontSize: 14, color: isDark ? HubTheme.text : const Color(0xFF374151))),
                    ),
                    const SizedBox(height: 12),
                    FilledButton.icon(
                      onPressed: onShare,
                      icon: const Icon(LucideIcons.share2, size: 18),
                      label: const Text('Share to HUB'),
                      style: FilledButton.styleFrom(backgroundColor: HubTheme.accent),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _MoodBar extends StatelessWidget {
  const _MoodBar({required this.label, required this.value});
  final String label;
  final int value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(label, style: const TextStyle(fontSize: 12, color: HubTheme.textSecondary)),
              Text('$value%', style: const TextStyle(fontWeight: FontWeight.bold, color: HubTheme.accent)),
            ],
          ),
          const SizedBox(height: 4),
          LinearProgressIndicator(value: value / 100, color: HubTheme.accent, backgroundColor: HubTheme.divider),
        ],
      ),
    );
  }
}
