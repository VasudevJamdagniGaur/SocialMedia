import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

const List<String> podAiTechExploreSlugs = [
  'ai-models',
  'startups',
  'tools',
  'vibe-coding',
  'big-tech',
];

const String lsAiTechExploreStats = 'pod_ai_tech_explore_stats_v1';

Map<String, dynamic> _safeParseJson(String raw, Map<String, dynamic> fallback) {
  try {
    final v = jsonDecode(raw);
    if (v is Map<String, dynamic>) return v;
    if (v is Map) return Map<String, dynamic>.from(v);
    return fallback;
  } catch (_) {
    return fallback;
  }
}

Future<Map<String, dynamic>> _readLocalExploreStats() async {
  final prefs = await SharedPreferences.getInstance();
  return _safeParseJson(prefs.getString(lsAiTechExploreStats) ?? '{}', {});
}

Future<void> _writeLocalExploreStats(Map<String, dynamic> stats) async {
  try {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(lsAiTechExploreStats, jsonEncode(stats));
  } catch (_) {
    /* quota */
  }
}

Map<String, dynamic> _mergeLocalSlug(
  Map<String, dynamic> stats,
  String slug,
  int secondsDelta,
  int visitInc,
) {
  final next = Map<String, dynamic>.from(stats);
  final cur = next[slug] is Map
      ? Map<String, dynamic>.from(next[slug] as Map)
      : {'seconds': 0, 'visits': 0};
  final sec = ((cur['seconds'] as num?)?.toInt() ?? 0) +
      secondsDelta.clamp(0, 86400);
  final vis = ((cur['visits'] as num?)?.toInt() ?? 0) + visitInc.clamp(0, 999999);
  next[slug] = {'seconds': sec, 'visits': vis};
  return next;
}

Future<Map<String, int>> getAiTechPersonalizationWeights() async {
  final stats = await _readLocalExploreStats();
  final raw = <String, num>{};
  var total = 0.0;
  for (final slug in podAiTechExploreSlugs) {
    final s = stats[slug] is Map ? stats[slug] as Map : {};
    final sec = (s['seconds'] as num?)?.toInt() ?? 0;
    final v = (s['visits'] as num?)?.toInt() ?? 0;
    raw[slug] = sec + v * 45;
    total += raw[slug]!;
  }
  final weights = <String, int>{};
  if (total < 90) {
    for (final slug in podAiTechExploreSlugs) {
      weights[slug] = 0;
    }
    return weights;
  }
  for (final slug in podAiTechExploreSlugs) {
    weights[slug] = ((raw[slug]! / total) * 55).round();
  }
  return weights;
}

Future<void> recordAiTechExploreDwell(
  String slug,
  num secondsDelta,
  num visitInc,
) async {
  if (!podAiTechExploreSlugs.contains(slug)) return;
  final sd = secondsDelta.round().clamp(0, 900);
  final vi = visitInc.round().clamp(0, 50);
  if (sd == 0 && vi == 0) return;

  final local = await _readLocalExploreStats();
  await _writeLocalExploreStats(_mergeLocalSlug(local, slug, sd, vi));
}
