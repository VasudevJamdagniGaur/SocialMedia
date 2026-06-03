import 'package:firebase_auth/firebase_auth.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../components/skeleton/list_skeleton.dart';
import '../contexts/theme_context.dart';
import '../services/firestore_service.dart';
import '../utils/hub_colors.dart';

class EmotionalWellbeingPage extends StatefulWidget {
  const EmotionalWellbeingPage({super.key});

  @override
  State<EmotionalWellbeingPage> createState() => _EmotionalWellbeingPageState();
}

class _EmotionalWellbeingPageState extends State<EmotionalWellbeingPage> {
  bool _loading = true;
  int _selectedPeriod = 7;
  List<Map<String, dynamic>> _moodData = [];
  List<Map<String, dynamic>> _balanceData = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      setState(() => _loading = false);
      return;
    }
    setState(() => _loading = true);
    final mood = await firestoreService.getMoodChartDataNew(user.uid, _selectedPeriod);
    final balance = await firestoreService.getEmotionalBalanceDataNew(user.uid, _selectedPeriod);
    if (!mounted) return;
    setState(() {
      _moodData = (mood['moodData'] as List?)?.cast<Map<String, dynamic>>() ?? [];
      _balanceData = (balance['balanceData'] as List?)?.cast<Map<String, dynamic>>() ?? [];
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final isDark = context.watch<ThemeNotifier>().isDarkMode;

    return Scaffold(
      backgroundColor: isDark ? HubColors.bg : HubColors.lightScaffold,
      body: SafeArea(
        child: _loading
            ? const Padding(padding: EdgeInsets.all(16), child: ListSkeleton())
            : RefreshIndicator(
                onRefresh: _load,
                color: HubColors.accent,
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 40,
                          height: 40,
                          decoration: BoxDecoration(
                            color: isDark ? HubColors.bgSecondary : Colors.white,
                            shape: BoxShape.circle,
                            border: Border.all(color: HubColors.divider),
                          ),
                          child: Icon(Icons.favorite, color: isDark ? HubColors.accent : HubColors.sage, size: 22),
                        ),
                        const SizedBox(width: 12),
                        const Expanded(
                          child: Text('Emotional Wellbeing', style: TextStyle(color: HubColors.text, fontSize: 20, fontWeight: FontWeight.w600)),
                        ),
                        IconButton(
                          onPressed: _load,
                          icon: Icon(Icons.refresh, color: isDark ? HubColors.accent : HubColors.sage),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    const Text('Track your mood patterns over time', style: TextStyle(color: HubColors.textSecondary)),
                    const SizedBox(height: 16),
                    SegmentedButton<int>(
                      segments: const [
                        ButtonSegment(value: 7, label: Text('7d')),
                        ButtonSegment(value: 15, label: Text('15d')),
                        ButtonSegment(value: 30, label: Text('30d')),
                      ],
                      selected: {_selectedPeriod},
                      onSelectionChanged: (s) {
                        setState(() => _selectedPeriod = s.first);
                        _load();
                      },
                    ),
                    const SizedBox(height: 24),
                    _sectionTitle('Mood trends'),
                    const SizedBox(height: 12),
                    SizedBox(
                      height: 220,
                      child: _moodData.isEmpty
                          ? _emptyCard('Chat with Detea to generate mood insights.')
                          : LineChart(_buildMoodChart()),
                    ),
                    const SizedBox(height: 24),
                    _sectionTitle('Emotional balance'),
                    const SizedBox(height: 12),
                    if (_balanceData.isEmpty)
                      _emptyCard('No balance data yet.')
                    else
                      ..._balanceData.reversed.take(3).map((b) {
                        final pos = (b['positive'] as num?)?.toDouble() ?? 0;
                        final neg = (b['negative'] as num?)?.toDouble() ?? 0;
                        final neu = (b['neutral'] as num?)?.toDouble() ?? 0;
                        return Container(
                          margin: const EdgeInsets.only(bottom: 12),
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: HubColors.bgSecondary,
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(color: HubColors.divider),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('${b['date']}', style: const TextStyle(color: HubColors.textSecondary, fontSize: 12)),
                              const SizedBox(height: 8),
                              _balanceBar('Positive', pos, Colors.greenAccent),
                              _balanceBar('Negative', neg, Colors.redAccent),
                              _balanceBar('Neutral', neu, Colors.blueGrey),
                            ],
                          ),
                        );
                      }),
                    const SizedBox(height: 24),
                    _insightCards(),
                    const SizedBox(height: 80),
                  ],
                ),
              ),
      ),
    );
  }

  Widget _sectionTitle(String t) => Text(t, style: const TextStyle(color: HubColors.text, fontSize: 16, fontWeight: FontWeight.w600));

  Widget _emptyCard(String msg) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: HubColors.bgSecondary,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: HubColors.divider),
        ),
        child: Text(msg, textAlign: TextAlign.center, style: const TextStyle(color: HubColors.textSecondary)),
      );

  LineChartData _buildMoodChart() {
    final spots = <FlSpot>[];
    for (var i = 0; i < _moodData.length; i++) {
      spots.add(FlSpot(i.toDouble(), (_moodData[i]['happiness'] as num?)?.toDouble() ?? 50));
    }
    return LineChartData(
      gridData: FlGridData(show: true, drawVerticalLine: false, getDrawingHorizontalLine: (_) => FlLine(color: HubColors.divider, strokeWidth: 1)),
      titlesData: FlTitlesData(
        leftTitles: AxisTitles(sideTitles: SideTitles(showTitles: true, reservedSize: 28, getTitlesWidget: (v, _) => Text('${v.toInt()}', style: const TextStyle(color: HubColors.textSecondary, fontSize: 10)))),
        bottomTitles: AxisTitles(sideTitles: SideTitles(showTitles: true, getTitlesWidget: (v, _) {
          final idx = v.toInt();
          if (idx < 0 || idx >= _moodData.length) return const SizedBox.shrink();
          final d = _moodData[idx]['date'] as String? ?? '';
          return Text(d.length > 5 ? d.substring(5) : d, style: const TextStyle(color: HubColors.textSecondary, fontSize: 10));
        })),
        topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
        rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
      ),
      borderData: FlBorderData(show: false),
      minY: 0,
      maxY: 100,
      lineBarsData: [
        LineChartBarData(
          spots: spots,
          isCurved: true,
          color: HubColors.accent,
          barWidth: 3,
          dotData: const FlDotData(show: true),
          belowBarData: BarAreaData(show: true, color: HubColors.accent.withValues(alpha: 0.15)),
        ),
      ],
    );
  }

  Widget _balanceBar(String label, double pct, Color color) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: [
          SizedBox(width: 72, child: Text(label, style: const TextStyle(color: HubColors.textSecondary, fontSize: 12))),
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(value: pct / 100, minHeight: 8, color: color, backgroundColor: HubColors.divider),
            ),
          ),
          const SizedBox(width: 8),
          Text('${pct.round()}%', style: const TextStyle(color: HubColors.text, fontSize: 12)),
        ],
      ),
    );
  }

  Widget _insightCards() {
    if (_moodData.isEmpty) return const SizedBox.shrink();
    final latest = _moodData.last;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionTitle('Latest scores'),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            _scoreChip('Happiness', latest['happiness'], Colors.amber),
            _scoreChip('Energy', latest['energy'], Colors.lightGreen),
            _scoreChip('Anxiety', latest['anxiety'], Colors.orange),
            _scoreChip('Stress', latest['stress'], Colors.redAccent),
          ],
        ),
      ],
    );
  }

  Widget _scoreChip(String label, dynamic value, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Column(
        children: [
          Text(label, style: TextStyle(color: color, fontSize: 12)),
          Text('${value ?? '-'}', style: const TextStyle(color: HubColors.text, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
}
