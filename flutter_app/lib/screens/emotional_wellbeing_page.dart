import 'dart:async';
import 'dart:convert';

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';

import '../contexts/theme_context.dart';
import '../services/auth_service.dart';
import '../services/firestore_service.dart';
import '../services/pattern_analysis_service.dart';
import '../services/vertex_api_client.dart';
import '../utils/hub_colors.dart';

/// Emotional Wellbeing dashboard — UI aligned with React `EmotionalWellbeing.js`.
class EmotionalWellbeingPage extends StatefulWidget {
  const EmotionalWellbeingPage({super.key});

  @override
  State<EmotionalWellbeingPage> createState() => _EmotionalWellbeingPageState();
}

class _WellbeingPalette {
  static const happiness = Color(0xFF81C995);
  static const energy = Color(0xFFFDD663);
  static const anxiety = Color(0xFF8AB4F8);
  static const stress = Color(0xFFF28B82);
  static const positive = happiness;
  static const neutral = energy;
  static const negative = stress;
}

class _EmotionalWellbeingPageState extends State<EmotionalWellbeingPage> {
  static const _chartHeight = 280.0;

  bool _isInitializing = true;
  bool _isRefreshing = false;

  int _moodPeriod = 7;
  int _balancePeriod = 7;

  List<Map<String, dynamic>> _moodData = [];
  List<Map<String, dynamic>> _balanceData = [];

  Map<String, dynamic>? _highlightsPeak;
  Map<String, dynamic>? _highlightsToughest;
  bool _highlightsLoading = false;

  Map<String, dynamic>? _patternAnalysis;
  bool _patternLoading = false;
  Map<String, List<String>> _triggers = {
    'stress': [],
    'joy': [],
    'distraction': [],
  };
  bool _hasEnoughData = true;

  Map<String, dynamic>? _selectedGuidanceTip;
  Map<String, dynamic>? _selectedDateDetails;
  Map<String, String>? _emotionExplanations;

  @override
  void initState() {
    super.initState();
    _initialize();
  }

  static const _initTimeout = Duration(seconds: 15);

  Future<void> _initialize() async {
    try {
      final user = AuthService().getCurrentUser();
    if (user == null) {
        if (mounted) setState(() => _isInitializing = false);
      return;
    }

      // Show charts ASAP — React uses cache-first; don't block on 90-day analysis.
      await _loadMoodData(_moodPeriod).timeout(
        _initTimeout,
        onTimeout: () {
          debugPrint('⚠️ Wellbeing: mood chart load timed out');
        },
      );

      if (mounted) {
        setState(() {
          _balanceData = _balanceFromMood(_moodData);
          _isInitializing = false;
        });
      }

      unawaited(_loadHighlights());
      unawaited(_loadPatterns());
    } catch (e, st) {
      debugPrint('❌ Wellbeing init error: $e\n$st');
      if (mounted) {
        setState(() {
          _isInitializing = false;
        });
      }
    }
  }

  Future<void> _refreshAll() async {
    setState(() => _isRefreshing = true);
    try {
      await _loadMoodData(_moodPeriod).timeout(_initTimeout);
      if (mounted) {
        setState(() => _balanceData = _balanceFromMood(_moodData));
      }
      await Future.wait([
        _loadHighlights().timeout(_initTimeout, onTimeout: () {}),
        _loadPatterns(forceRefresh: true).timeout(_initTimeout, onTimeout: () {}),
      ]);
    } catch (e) {
      debugPrint('❌ Wellbeing refresh error: $e');
    } finally {
      if (mounted) setState(() => _isRefreshing = false);
    }
  }

  List<Map<String, dynamic>> _applyEmotionRules(List<Map<String, dynamic>> data) {
    return data.map((day) {
      var happiness = (day['happiness'] as num?)?.toDouble() ?? 0;
      var energy = (day['energy'] as num?)?.toDouble() ?? 0;
      var anxiety = (day['anxiety'] as num?)?.toDouble() ?? 0;
      var stress = (day['stress'] as num?)?.toDouble() ?? 0;

      if ((stress >= 60 || anxiety >= 60) && happiness > 50) {
        happiness = happiness.clamp(0, 50);
      }
      if (happiness >= 70) {
        if (stress > 40) stress = 40;
        if (anxiety > 40) anxiety = 40;
      }

      return {
        ...day,
        'happiness': happiness.round(),
        'energy': energy.round(),
        'anxiety': anxiety.round(),
        'stress': stress.round(),
      };
    }).toList();
  }

  Future<List<Map<String, dynamic>>> _fetchMoodForPeriod(int period) async {
    final user = AuthService().getCurrentUser();
    if (user == null) return [];

    Map<String, dynamic> result;
    if (period == 365) {
      result = await FirestoreService.instance.getAllMoodChartDataNew(user.uid);
      if (result['success'] != true ||
          (result['moodData'] as List?)?.isEmpty != false) {
        result = await FirestoreService.instance.getMoodChartDataNew(user.uid, 30);
      }
    } else {
      result = await FirestoreService.instance.getMoodChartDataNew(user.uid, period);
    }

    if (result['success'] != true) return [];
    var list = (result['moodData'] as List<dynamic>?)
            ?.cast<Map<String, dynamic>>() ??
        [];

    list = _applyEmotionRules(list);
    list.sort((a, b) =>
        DateTime.parse(a['date'] as String).compareTo(DateTime.parse(b['date'] as String)));

    if (period != 7) {
      list = list.where((day) {
        final total = (day['happiness'] as num? ?? 0) +
            (day['energy'] as num? ?? 0) +
            (day['anxiety'] as num? ?? 0) +
            (day['stress'] as num? ?? 0);
        return total > 0;
      }).toList();
    }
    return list;
  }

  List<Map<String, dynamic>> _balanceFromMood(List<Map<String, dynamic>> mood) {
    return mood.map((dayData) {
      final h = (dayData['happiness'] as num?)?.toDouble() ?? 0;
      final e = (dayData['energy'] as num?)?.toDouble() ?? 0;
      final a = (dayData['anxiety'] as num?)?.toDouble() ?? 0;
      final s = (dayData['stress'] as num?)?.toDouble() ?? 0;
      final total = h + e + a + s;

      int positiveScore = 0;
      int negativeScore = 0;
      int neutralScore = 0;

      if (total > 0) {
        final positiveTotal = h + e;
        final negativeTotal = a + s;
        positiveScore = ((positiveTotal / total) * 100).round().clamp(0, 100);
        negativeScore = ((negativeTotal / total) * 100).round().clamp(0, 100);
        neutralScore = (100 - positiveScore - negativeScore).clamp(0, 100);
      }

      return {
        'date': dayData['date'],
        'day': dayData['day'],
        'positive': positiveScore,
        'neutral': neutralScore,
        'negative': negativeScore,
      };
    }).toList();
  }

  Future<void> _loadMoodData(int period) async {
    try {
      final data = await _fetchMoodForPeriod(period);
    if (!mounted) return;
      setState(() => _moodData = data);
    } catch (e) {
      debugPrint('❌ Wellbeing mood load error: $e');
      if (mounted) setState(() => _moodData = []);
    }
  }

  Future<void> _loadBalanceData(int period) async {
    if (period == _moodPeriod && _moodData.isNotEmpty) {
      if (mounted) setState(() => _balanceData = _balanceFromMood(_moodData));
      return;
    }
    final mood = await _fetchMoodForPeriod(period == 365 ? 365 : period);
    if (!mounted) return;
    setState(() => _balanceData = _balanceFromMood(mood));
  }

  String _cleanSummary(String? summary) {
    if (summary == null || summary.isEmpty) return '';
    var cleaned = summary;
    final unwanted = [
      RegExp(r"Here is a diary entry summarizing the (user's|user) day:?\s*", caseSensitive: false),
      RegExp(r'Analysis:?\s*', caseSensitive: false),
    ];
    for (final p in unwanted) {
      cleaned = cleaned.replaceAll(p, '');
    }
    final analysisIndex = cleaned.toLowerCase().indexOf('analysis:');
    if (analysisIndex != -1) {
      cleaned = cleaned.substring(0, analysisIndex).trim();
    }
    return cleaned.trim();
  }

  Future<void> _loadHighlights() async {
    final user = AuthService().getCurrentUser();
    if (user == null) return;

    if (mounted) {
    setState(() {
        _highlightsLoading = true;
        _highlightsPeak = null;
        _highlightsToughest = null;
      });
    }

    try {
      final result = await FirestoreService.instance
          .getMoodChartDataNew(user.uid, 90)
          .timeout(_initTimeout);
      if (result['success'] != true) {
        if (mounted) setState(() => _highlightsLoading = false);
        return;
      }

      var list = (result['moodData'] as List<dynamic>?)
              ?.cast<Map<String, dynamic>>() ??
          [];
      list = _applyEmotionRules(list);

      final valid = list.where((item) {
        final total = (item['happiness'] as num? ?? 0) +
            (item['energy'] as num? ?? 0) +
            (item['anxiety'] as num? ?? 0) +
            (item['stress'] as num? ?? 0);
        return total >= 10;
      }).toList();

      if (valid.isEmpty) {
        if (mounted) {
          setState(() {
            _highlightsPeak = {
              'title': 'Best Mood Day',
              'description':
                  'Start chatting with Detea to track your emotional journey!',
              'date': 'No data',
            };
            _highlightsToughest = {
              'title': 'Challenging Day',
              'description':
                  'Your emotional patterns will appear after chatting.',
              'date': 'No data',
            };
            _highlightsLoading = false;
          });
        }
        return;
      }

      Map<String, dynamic> best = valid.first;
      Map<String, dynamic> worst = valid.first;
      for (final day in valid) {
        final dayScore =
            ((day['happiness'] as num) + (day['energy'] as num)) / 2;
        final bestScore =
            ((best['happiness'] as num) + (best['energy'] as num)) / 2;
        final worstScore =
            ((worst['happiness'] as num) + (worst['energy'] as num)) / 2;
        if (dayScore > bestScore) best = day;
        if (dayScore < worstScore) worst = day;
      }

      if (best['date'] == worst['date'] && valid.length > 1) {
        final others = valid.where((d) => d['date'] != best['date']).toList();
        if (others.isNotEmpty) {
          worst = others.reduce((a, b) {
            final aScore =
                ((a['happiness'] as num) + (a['energy'] as num)) / 2;
            final bScore =
                ((b['happiness'] as num) + (b['energy'] as num)) / 2;
            return aScore < bScore ? a : b;
          });
        }
      }

      String formatDate(String? dateStr) {
        if (dateStr == null) return 'Unknown';
        try {
          return DateFormat.Md().format(DateTime.parse(dateStr));
        } catch (_) {
          return dateStr;
        }
      }

      String? bestSummary;
      String? worstSummary;
      try {
        final bestReflection = await FirestoreService.instance
            .getReflectionNew(user.uid, best['date'] as String)
            .timeout(const Duration(seconds: 8));
        bestSummary =
            bestReflection['reflection'] as String? ?? bestReflection['summary'] as String?;
      } catch (_) {}

      try {
        final worstReflection = await FirestoreService.instance
            .getReflectionNew(user.uid, worst['date'] as String)
            .timeout(const Duration(seconds: 8));
        worstSummary = worstReflection['reflection'] as String? ??
            worstReflection['summary'] as String?;
      } catch (_) {}

      if (!mounted) return;
      setState(() {
        final bestDesc = _cleanSummary(bestSummary);
        final worstDesc = _cleanSummary(worstSummary);
        _highlightsPeak = {
          'title': 'Best Mood Day',
          'description': bestDesc.isEmpty
              ? 'Your highest emotional peak this period.'
              : bestDesc,
          'date': formatDate(best['date'] as String?),
        };
        _highlightsToughest = {
          'title': 'Challenging Day',
          'description': worstDesc.isEmpty
              ? 'Your most challenging emotional period.'
              : worstDesc,
          'date': formatDate(worst['date'] as String?),
        };
        _highlightsLoading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _highlightsLoading = false);
    }
  }

  Future<void> _loadPatterns({bool forceRefresh = false}) async {
    final user = AuthService().getCurrentUser();
    if (user == null) return;

    if (mounted) setState(() => _patternLoading = true);
    try {
      final analysis = await PatternAnalysisService.instance
          .getPatternAnalysis(user.uid, 90, forceRefresh: forceRefresh)
          .timeout(const Duration(seconds: 20));
      if (!mounted) return;

      final triggers = analysis['triggers'] as Map<String, dynamic>? ?? {};
      setState(() {
        _patternAnalysis = analysis;
        _hasEnoughData = analysis['hasEnoughData'] == true;
        _triggers = {
          'stress': (triggers['stress'] as List<dynamic>?)
                  ?.map((e) => e.toString())
                  .toList() ??
              [],
          'joy': (triggers['joy'] as List<dynamic>?)
                  ?.map((e) => e.toString())
                  .toList() ??
              [],
          'distraction': (triggers['distraction'] as List<dynamic>?)
                  ?.map((e) => e.toString())
                  .toList() ??
              [],
        };
        _patternLoading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _patternLoading = false);
    }
  }

  Future<void> _onMoodPeriodChanged(int period) async {
    setState(() => _moodPeriod = period);
    await _loadMoodData(period);
  }

  Future<void> _onBalancePeriodChanged(int period) async {
    setState(() => _balancePeriod = period);
    if (period == _moodPeriod && _moodData.isNotEmpty) {
      setState(() => _balanceData = _balanceFromMood(_moodData));
      return;
    }
    await _loadBalanceData(period);
  }

  Future<void> _onDateTapped(Map<String, dynamic> day) async {
    setState(() {
      _selectedDateDetails = day;
      _emotionExplanations = null;
    });

    final user = AuthService().getCurrentUser();
    if (user == null) return;

    try {
      final messages = await FirestoreService.instance
          .getChatMessagesNew(user.uid, day['date'] as String);
      if (messages['success'] != true ||
          (messages['messages'] as List?)?.isEmpty != false) {
        setState(() {
          _emotionExplanations = {
            'happiness': 'Positive topics and tone from your conversation.',
            'energy': 'Engagement level reflected in your chat that day.',
            'anxiety': 'Concerns or worries mentioned during the chat.',
            'stress': 'Pressures or responsibilities discussed.',
          };
        });
        return;
      }

      final transcript = (messages['messages'] as List)
          .map((m) =>
              '${m['sender'] == 'user' ? 'User' : 'Detea'}: ${m['text']}')
          .join('\n\n');

      final prompt = '''Based on this conversation, explain why each emotion score makes sense in one short sentence each.

CONVERSATION:
$transcript

SCORES: Happiness ${day['happiness']}%, Energy ${day['energy']}%, Anxiety ${day['anxiety']}%, Stress ${day['stress']}%

Return JSON only:
{"happiness":"...","energy":"...","anxiety":"...","stress":"..."}''';

      if (isVertexBackendConfigured()) {
        final text = await vertexGenerateContent(
          prompt: prompt,
          temperature: 0.7,
          maxOutputTokens: 300,
        );
        final match = RegExp(r'\{[\s\S]*\}').firstMatch(text);
        if (match != null) {
          final parsed = jsonDecode(match.group(0)!) as Map<String, dynamic>;
          if (mounted) {
            setState(() {
              _emotionExplanations = parsed.map(
                (k, v) => MapEntry(k, v.toString()),
              );
            });
          }
          return;
        }
      }
    } catch (_) {}

    if (mounted) {
      setState(() {
        _emotionExplanations = {
          'happiness': 'Positive interactions shaped your happiness score.',
          'energy': 'Your engagement level influenced your energy score.',
          'anxiety': 'Topics discussed affected your anxiety level.',
          'stress': 'Daily pressures mentioned affected your stress score.',
        };
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = context.watch<ThemeNotifier>().isDarkMode;
    final bottomPad = 80 + MediaQuery.paddingOf(context).bottom;

    if (_isInitializing) {
    return Scaffold(
        backgroundColor: HubColors.bg,
        body: const Center(
          child: CircularProgressIndicator(color: HubColors.accent),
        ),
      );
    }

    return Scaffold(
      backgroundColor: HubColors.bg,
      body: Stack(
                  children: [
          Column(
            children: [
              _buildHeader(isDark),
              Expanded(
                child: SingleChildScrollView(
                  padding: EdgeInsets.fromLTRB(16, 16, 16, bottomPad),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _moodChartCard(),
                      const SizedBox(height: 16),
                      _balanceChartCard(),
                      const SizedBox(height: 16),
                      _highlightsCard(),
                      const SizedBox(height: 16),
                      _triggersCard(),
                      const SizedBox(height: 16),
                      _guidanceCard(),
                    ],
                  ),
                ),
              ),
            ],
          ),
          if (_selectedDateDetails != null) _emotionDetailsModal(isDark),
          if (_selectedGuidanceTip != null) _guidanceDetailModal(isDark),
        ],
      ),
    );
  }

  Widget _buildHeader(bool isDark) {
    final top = MediaQuery.paddingOf(context).top;
    return Container(
      padding: EdgeInsets.fromLTRB(24, top + 12, 24, 16),
      decoration: BoxDecoration(
        color: HubColors.bg,
        border: Border(bottom: BorderSide(color: HubColors.divider)),
      ),
      child: Row(
                      children: [
                        Container(
                          width: 40,
                          height: 40,
                          decoration: BoxDecoration(
              color: HubColors.bgSecondary,
                            shape: BoxShape.circle,
                            border: Border.all(color: HubColors.divider),
                          ),
            child: const Icon(LucideIcons.heart, color: HubColors.accent, size: 20),
                        ),
                        const SizedBox(width: 12),
                        const Expanded(
            child: Text(
              'Emotional Wellbeing',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: HubColors.text,
                fontSize: 20,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          Material(
            color: _isRefreshing ? HubColors.divider : HubColors.accent,
            borderRadius: BorderRadius.circular(12),
            child: InkWell(
              onTap: _isRefreshing ? null : _refreshAll,
              borderRadius: BorderRadius.circular(12),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (_isRefreshing)
                      const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: HubColors.text,
                        ),
                      )
                    else
                      const Icon(LucideIcons.refreshCw, color: HubColors.text, size: 16),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _hubCard({required Widget child}) {
                        return Container(
      width: double.infinity,
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: HubColors.bgSecondary,
                            borderRadius: BorderRadius.circular(16),
        border: Border.all(color: HubColors.divider.withValues(alpha: 0.5)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x26000000),
            blurRadius: 16,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: child,
    );
  }

  Widget _sectionIconHeader({
    required IconData icon,
    required String title,
    String? subtitle,
    Color? titleColor,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: HubColors.bgSecondary,
            shape: BoxShape.circle,
                            border: Border.all(color: HubColors.divider),
                          ),
          child: Icon(icon, color: HubColors.accent, size: 20),
        ),
        const SizedBox(width: 12),
        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
              Text(
                title,
                style: TextStyle(
                  color: titleColor ?? HubColors.text,
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                ),
              ),
              if (subtitle != null) ...[
                const SizedBox(height: 4),
                Text(
                  subtitle,
                  style: const TextStyle(
                    color: HubColors.textSecondary,
                    fontSize: 13,
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _periodPills({
    required List<(int days, String label)> options,
    required int selected,
    required ValueChanged<int> onChanged,
  }) {
    return Row(
      children: options.map((opt) {
        final active = selected == opt.$1;
        return Expanded(
          child: Padding(
            padding: const EdgeInsets.only(right: 8),
            child: Material(
              color: active ? HubColors.accent : const Color(0xFF1F1F1F),
              borderRadius: BorderRadius.circular(24),
              child: InkWell(
                onTap: () => onChanged(opt.$1),
                borderRadius: BorderRadius.circular(24),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  child: Text(
                    opt.$2,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: active ? HubColors.text : HubColors.textSecondary,
                      fontSize: 13,
                      fontWeight: active ? FontWeight.w600 : FontWeight.normal,
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _moodChartCard() {
    return _hubCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _sectionIconHeader(icon: LucideIcons.chartColumn, title: 'Mood Chart'),
          const SizedBox(height: 16),
          _periodPills(
            options: const [(7, '7 Days'), (15, '15 Days'), (365, 'Lifetime')],
            selected: _moodPeriod,
            onChanged: _onMoodPeriodChanged,
          ),
          const SizedBox(height: 16),
          SizedBox(
            height: _chartHeight,
            child: _moodData.isEmpty
                ? _emptyChartState(LucideIcons.heart, 'No data yet')
                : _multiLineChart(
                    data: _moodData,
                    series: const [
                      ('happiness', _WellbeingPalette.happiness, 'Happiness'),
                      ('energy', _WellbeingPalette.energy, 'Energy'),
                      ('anxiety', _WellbeingPalette.anxiety, 'Anxiety'),
                      ('stress', _WellbeingPalette.stress, 'Stress'),
                    ],
                    onSpotTap: _onDateTapped,
                  ),
          ),
          const SizedBox(height: 12),
          _legendGrid(const [
            (_WellbeingPalette.happiness, 'Happiness'),
            (_WellbeingPalette.energy, 'Energy'),
            (_WellbeingPalette.anxiety, 'Anxiety'),
            (_WellbeingPalette.stress, 'Stress'),
          ]),
        ],
      ),
    );
  }

  Widget _balanceChartCard() {
    return _hubCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _sectionIconHeader(
            icon: LucideIcons.target,
            title: 'Emotional Balance',
          ),
          const SizedBox(height: 16),
          _periodPills(
            options: const [(7, '7 Days'), (30, '30 Days'), (365, 'Lifetime')],
            selected: _balancePeriod,
            onChanged: _onBalancePeriodChanged,
          ),
          const SizedBox(height: 16),
          SizedBox(
            height: _chartHeight,
            child: _balanceData.isEmpty
                ? _emptyChartState(LucideIcons.target, 'No balance data yet')
                : _multiLineChart(
                    data: _balanceData,
                    series: const [
                      ('positive', _WellbeingPalette.positive, 'Positive'),
                      ('neutral', _WellbeingPalette.neutral, 'Neutral'),
                      ('negative', _WellbeingPalette.negative, 'Negative'),
                    ],
                  ),
          ),
          const SizedBox(height: 12),
          _legendRow(const [
            (_WellbeingPalette.positive, 'Positive'),
            (_WellbeingPalette.neutral, 'Neutral'),
            (_WellbeingPalette.negative, 'Negative'),
          ]),
        ],
      ),
    );
  }

  Widget _emptyChartState(IconData icon, String message) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 48,
            height: 48,
        decoration: BoxDecoration(
              shape: BoxShape.circle,
          color: HubColors.bgSecondary,
          border: Border.all(color: HubColors.divider),
        ),
            child: Icon(icon, color: HubColors.accent, size: 24),
          ),
          const SizedBox(height: 12),
          Text(
            message,
            style: const TextStyle(color: HubColors.textSecondary, fontSize: 14),
          ),
        ],
      ),
    );
  }

  Widget _multiLineChart({
    required List<Map<String, dynamic>> data,
    required List<(String key, Color color, String label)> series,
    void Function(Map<String, dynamic>)? onSpotTap,
  }) {
    if (data.isEmpty) return const SizedBox.shrink();

    final spotsBySeries = <String, List<FlSpot>>{};
    for (final s in series) {
      spotsBySeries[s.$1] = [];
    }

    for (var i = 0; i < data.length; i++) {
      final d = data[i];
      for (final s in series) {
        final v = (d[s.$1] as num?)?.toDouble() ?? 0;
        spotsBySeries[s.$1]!.add(FlSpot(i.toDouble(), v));
      }
    }

    final maxX = (data.length - 1).toDouble().clamp(0.0, double.infinity);

    return LineChart(
      LineChartData(
        minY: 0,
        maxY: 100,
        minX: 0,
        maxX: maxX < 1 ? 1.0 : maxX,
        gridData: FlGridData(
          show: true,
          drawVerticalLine: false,
          horizontalInterval: 25,
          getDrawingHorizontalLine: (_) => FlLine(
            color: HubColors.divider.withValues(alpha: 0.6),
            strokeWidth: 1,
          ),
        ),
      titlesData: FlTitlesData(
        rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          leftTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 32,
              interval: 25,
              getTitlesWidget: (v, _) => Text(
                v.toInt().toString(),
                style: const TextStyle(color: HubColors.textSecondary, fontSize: 10),
              ),
            ),
          ),
          bottomTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 36,
              interval: data.length > 10 ? (data.length / 5).ceilToDouble() : 1,
              getTitlesWidget: (v, _) {
                final i = v.round();
                if (i < 0 || i >= data.length) return const SizedBox.shrink();
                return Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    '${data[i]['day'] ?? ''}',
                    style: const TextStyle(
                      color: HubColors.textSecondary,
                      fontSize: 9,
                    ),
                  ),
                );
              },
            ),
          ),
      ),
      borderData: FlBorderData(show: false),
        lineTouchData: LineTouchData(
          touchCallback: (event, response) {
            if (onSpotTap == null || response?.lineBarSpots == null) return;
            if (event is! FlTapUpEvent && event is! FlLongPressEnd) return;
            final idx = response!.lineBarSpots!.first.x.round();
            if (idx >= 0 && idx < data.length) onSpotTap(data[idx]);
          },
          touchTooltipData: LineTouchTooltipData(
            getTooltipColor: (_) => HubColors.bgSecondary,
            getTooltipItems: (spots) => spots.map((s) {
              final label = series.length > s.barIndex ? series[s.barIndex].$3 : '';
              return LineTooltipItem(
                '$label: ${s.y.round()}%',
                const TextStyle(color: HubColors.text, fontSize: 12),
              );
            }).toList(),
          ),
        ),
        lineBarsData: series.map((s) {
          return LineChartBarData(
            spots: spotsBySeries[s.$1]!,
          isCurved: true,
            color: s.$2,
            barWidth: 2,
            dotData: FlDotData(
              show: data.length <= 15,
              getDotPainter: (_, __, ___, ____) => FlDotCirclePainter(
                radius: 3,
                color: s.$2,
                strokeWidth: 0,
              ),
            ),
            belowBarData: BarAreaData(show: false),
          );
        }).toList(),
      ),
      duration: const Duration(milliseconds: 200),
    );
  }

  Widget _legendGrid(List<(Color, String)> items) {
    return Wrap(
      spacing: 16,
      runSpacing: 8,
      children: items
          .map((e) => _legendDot(e.$1, e.$2))
          .toList(),
    );
  }

  Widget _legendRow(List<(Color, String)> items) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: items
          .map((e) => Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: _legendDot(e.$1, e.$2),
              ))
          .toList(),
    );
  }

  Widget _legendDot(Color color, String label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 6),
        Text(label, style: const TextStyle(color: HubColors.textSecondary, fontSize: 12)),
      ],
    );
  }

  Widget _highlightsCard() {
    final hasMood = _moodData.isNotEmpty;
    return _hubCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _sectionIconHeader(
            icon: LucideIcons.award,
            title: 'Highlights',
            subtitle: 'Last 3 months emotional journey',
          ),
          const SizedBox(height: 20),
          if (!hasMood)
            _emptyChartState(LucideIcons.award, 'Highlights will appear here')
          else
            Column(
              children: [
                _highlightTile(
                  title: _highlightsPeak?['title'] as String? ?? 'Best Mood Day',
                  description: _highlightsPeak?['description'] as String? ??
                      'Your highest emotional peak this period.',
                  date: _highlightsPeak?['date'] as String? ?? '',
                  isPositive: true,
                  loading: _highlightsLoading,
                ),
                const SizedBox(height: 12),
                _highlightTile(
                  title: _highlightsToughest?['title'] as String? ?? 'Challenging Day',
                  description: _highlightsToughest?['description'] as String? ??
                      'Your most challenging emotional period.',
                  date: _highlightsToughest?['date'] as String? ?? '',
                  isPositive: false,
                  loading: _highlightsLoading,
                ),
              ],
            ),
        ],
      ),
    );
  }

  Widget _highlightTile({
    required String title,
    required String description,
    required String date,
    required bool isPositive,
    required bool loading,
  }) {
    final green = const Color(0xFF4ADE80);
    final red = const Color(0xFFF87171);
    final accent = isPositive ? green : red;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: accent.withValues(alpha: 0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                isPositive ? LucideIcons.smile : LucideIcons.triangleAlert,
                color: accent,
                size: 18,
          ),
          const SizedBox(width: 8),
              Text(
                title,
                style: TextStyle(
                  color: accent,
                  fontWeight: FontWeight.w600,
                  fontSize: 15,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          if (loading)
            const LinearProgressIndicator(color: HubColors.accent, minHeight: 2)
          else ...[
            Text(
              description,
              style: const TextStyle(
                color: HubColors.text,
                fontSize: 14,
                height: 1.45,
              ),
            ),
            if (date.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(
                date,
                style: const TextStyle(color: HubColors.textSecondary, fontSize: 12),
              ),
            ],
          ],
        ],
      ),
    );
  }

  Widget _triggersCard() {
    final hasMood = _moodData.isNotEmpty;
    final showBanner = !_hasEnoughData &&
        _triggers['stress']!.isEmpty &&
        _triggers['joy']!.isEmpty &&
        _triggers['distraction']!.isEmpty;

    return _hubCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _sectionIconHeader(
            icon: LucideIcons.lightbulb,
            title: 'Triggers & Patterns',
            titleColor: HubColors.accent,
          ),
          const SizedBox(height: 16),
          if (!hasMood)
            _emptyChartState(LucideIcons.lightbulb, 'Patterns will appear here')
          else ...[
            if (_patternLoading)
              const Center(
                child: Padding(
                  padding: EdgeInsets.all(24),
                  child: CircularProgressIndicator(color: HubColors.accent),
                ),
              )
            else ...[
              if (showBanner) _noChatBanner(),
              const SizedBox(height: 8),
              _triggerColumn(
                'Stress Triggers',
                LucideIcons.triangleAlert,
                const Color(0xFFF87171),
                _triggers['stress']!,
                'No specific stress triggers found in conversations',
              ),
              const SizedBox(height: 16),
              _triggerColumn(
                'Joy Boosters',
                LucideIcons.heart,
                const Color(0xFF4ADE80),
                _triggers['joy']!,
                'No specific joy sources found in conversations',
              ),
              const SizedBox(height: 16),
              _triggerColumn(
                'Distractions',
                LucideIcons.zap,
                const Color(0xFFFACC15),
                _triggers['distraction']!,
                'No specific distractions found in conversations',
              ),
            ],
          ],
        ],
      ),
    );
  }

  Widget _noChatBanner() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFFDD663).withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFFDD663).withValues(alpha: 0.2)),
      ),
      child: const Row(
        children: [
          Icon(LucideIcons.triangleAlert, color: HubColors.accent, size: 18),
          SizedBox(width: 10),
          Expanded(
            child: Text(
              'No chat data available for analysis',
              style: TextStyle(color: HubColors.text, fontSize: 14),
            ),
          ),
        ],
      ),
    );
  }

  Widget _triggerColumn(
    String title,
    IconData icon,
    Color color,
    List<String> items,
    String emptyText,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(icon, color: color, size: 16),
            const SizedBox(width: 8),
            Text(
              title,
              style: TextStyle(color: color, fontWeight: FontWeight.w600, fontSize: 14),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (items.isEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFF1F1F1F),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              emptyText,
              style: const TextStyle(color: HubColors.textSecondary, fontSize: 13),
            ),
          )
        else
          ...items.map(
            (t) => Container(
              width: double.infinity,
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: color.withValues(alpha: 0.2)),
              ),
              child: Text(t, style: const TextStyle(color: HubColors.text, fontSize: 13)),
            ),
          ),
      ],
    );
  }

  Widget _guidanceCard() {
    final tips = (_patternAnalysis?['guidanceTips'] as List<dynamic>?)
            ?.cast<Map<String, dynamic>>() ??
        [];
    final hasMood = _moodData.isNotEmpty;

    return _hubCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _sectionIconHeader(
            icon: LucideIcons.bookOpen,
            title: 'Personalized Guidance',
          ),
          const SizedBox(height: 16),
          if (!hasMood)
            _emptyChartState(LucideIcons.bookOpen, 'Guidance will appear here')
          else if (_patternLoading)
            const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: CircularProgressIndicator(color: HubColors.accent),
              ),
            )
          else if (tips.isNotEmpty)
            ...tips.asMap().entries.map((e) {
              final tip = e.value;
              return Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _guidanceTipCard(index: e.key, tip: tip),
              );
            })
          else
            ..._defaultGuidanceTiles(),
        ],
      ),
    );
  }

  Widget _guidanceTipCard({required int index, required Map<String, dynamic> tip}) {
    final category = (tip['category'] as String? ?? 'insight')
        .replaceAll('_', ' ')
        .toUpperCase();

    return Material(
      color: const Color(0xFF8AB4F8).withValues(alpha: 0.08),
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: () => setState(() => _selectedGuidanceTip = tip),
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: const Color(0xFF8AB4F8).withValues(alpha: 0.15),
            ),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: const Color(0xFF8AB4F8).withValues(alpha: 0.2),
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFF8AB4F8).withValues(alpha: 0.3),
                      blurRadius: 12,
                    ),
                  ],
                ),
                alignment: Alignment.center,
                child: Text(
                  '${index + 1}',
                  style: const TextStyle(
                    color: Color(0xFF60A5FA),
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            tip['title'] as String? ?? 'Tip',
                            style: const TextStyle(
                              color: HubColors.text,
                              fontSize: 16,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: HubColors.divider,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(
                            category,
                            style: const TextStyle(
                              color: HubColors.textSecondary,
                              fontSize: 10,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _defaultGuidanceTiles() {
    return [
      _fallbackGuidance(
        LucideIcons.sun,
        'Continue Chatting',
        'Keep engaging with Detea to build more comprehensive emotional insights and patterns.',
        () => context.go('/chat'),
      ),
        const SizedBox(height: 12),
      _fallbackGuidance(
        LucideIcons.star,
        'Reflect Daily',
        'Regular conversations help create more accurate emotional tracking and better insights.',
        () => context.go('/chat'),
      ),
      const SizedBox(height: 12),
      _fallbackGuidance(
        LucideIcons.sparkles,
        'Build Patterns',
        'Share more details about your experiences to unlock personalized insights.',
        () => context.go('/chat'),
      ),
    ];
  }

  Widget _fallbackGuidance(
    IconData icon,
    String title,
    String body,
    VoidCallback onTap,
  ) {
    return Material(
      color: const Color(0xFF8AB4F8).withValues(alpha: 0.08),
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
          children: [
              Row(
                children: [
                  Container(
                    width: 32,
                    height: 32,
                    decoration: const BoxDecoration(
                      color: HubColors.accent,
                      shape: BoxShape.circle,
                    ),
                    child: Icon(icon, color: HubColors.text, size: 16),
                  ),
                  const SizedBox(width: 10),
                  Text(
                    title,
                    style: const TextStyle(
                      color: HubColors.text,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Text(
                body,
                style: const TextStyle(
                  color: HubColors.textSecondary,
                  fontSize: 14,
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _emotionDetailsModal(bool isDark) {
    final day = _selectedDateDetails!;
    return _modalScaffold(
      onClose: () => setState(() {
        _selectedDateDetails = null;
        _emotionExplanations = null;
      }),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'Emotion Details — ${day['day'] ?? day['date']}',
            style: const TextStyle(
              color: HubColors.text,
              fontSize: 18,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 16),
          if (_emotionExplanations == null)
            const Center(child: CircularProgressIndicator(color: HubColors.accent))
          else ...[
            _emotionDetailBlock(
              'Happiness',
              day['happiness'],
              _WellbeingPalette.happiness,
              LucideIcons.smile,
              _emotionExplanations!['happiness'] ?? '',
            ),
            _emotionDetailBlock(
              'Energy',
              day['energy'],
              _WellbeingPalette.energy,
              LucideIcons.zap,
              _emotionExplanations!['energy'] ?? '',
            ),
            _emotionDetailBlock(
              'Anxiety',
              day['anxiety'],
              _WellbeingPalette.anxiety,
              LucideIcons.triangleAlert,
              _emotionExplanations!['anxiety'] ?? '',
            ),
            _emotionDetailBlock(
              'Stress',
              day['stress'],
              _WellbeingPalette.stress,
              LucideIcons.target,
              _emotionExplanations!['stress'] ?? '',
            ),
          ],
        ],
      ),
    );
  }

  Widget _emotionDetailBlock(
    String label,
    dynamic value,
    Color color,
    IconData icon,
    String explanation,
  ) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: 0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color, size: 18),
              const SizedBox(width: 8),
              Text(
                '$label: $value%',
                style: const TextStyle(
                  color: HubColors.text,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            explanation,
            style: const TextStyle(color: HubColors.textSecondary, fontSize: 13),
          ),
        ],
      ),
    );
  }

  Widget _guidanceDetailModal(bool isDark) {
    final tip = _selectedGuidanceTip!;
    final category = (tip['category'] as String? ?? 'insight')
        .replaceAll('_', ' ')
        .toUpperCase();

    return _modalScaffold(
      onClose: () => setState(() => _selectedGuidanceTip = null),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              const Icon(LucideIcons.lightbulb, color: Color(0xFF60A5FA), size: 22),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  tip['title'] as String? ?? 'Guidance',
                  style: const TextStyle(
                    color: HubColors.text,
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: HubColors.divider,
        borderRadius: BorderRadius.circular(12),
            ),
            child: Text(category, style: const TextStyle(color: HubColors.textSecondary, fontSize: 11)),
          ),
          const SizedBox(height: 16),
          Text(
            tip['description'] as String? ?? '',
            style: const TextStyle(color: HubColors.textSecondary, fontSize: 15, height: 1.5),
          ),
        ],
      ),
    );
  }

  Widget _modalScaffold({required VoidCallback onClose, required Widget child}) {
    return Positioned.fill(
      child: Material(
        color: Colors.black54,
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Material(
              color: HubColors.bgSecondary,
              borderRadius: BorderRadius.circular(20),
              child: ConstrainedBox(
                constraints: BoxConstraints(
                  maxHeight: MediaQuery.sizeOf(context).height * 0.85,
                  maxWidth: 400,
                ),
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(20),
      child: Column(
                    mainAxisSize: MainAxisSize.min,
        children: [
                      Align(
                        alignment: Alignment.topRight,
                        child: IconButton(
                          onPressed: onClose,
                          icon: const Icon(Icons.close, color: HubColors.textSecondary),
                        ),
                      ),
                      child,
                      const SizedBox(height: 8),
                      TextButton(
                        onPressed: onClose,
                        child: const Text('Close', style: TextStyle(color: HubColors.text)),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
