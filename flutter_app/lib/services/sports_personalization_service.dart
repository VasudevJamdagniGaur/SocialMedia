import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../services/auth_service.dart';
import '../services/firestore_service.dart';

const List<String> podSportsExploreSlugs = [
  'cricket',
  'football',
  'f1',
  'chess',
  'others',
];

const String lsExploreStats = 'pod_sports_explore_stats_v1';
const String lsSportsSurfaceSec = 'pod_sports_surface_seconds_v1';

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
  return _safeParseJson(prefs.getString(lsExploreStats) ?? '{}', {});
}

Future<void> _writeLocalExploreStats(Map<String, dynamic> stats) async {
  try {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(lsExploreStats, jsonEncode(stats));
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

Future<Map<String, dynamic>> getMergedExploreStats(String? uid) async {
  final local = await _readLocalExploreStats();
  if (uid == null || uid.isEmpty) return local;
  try {
    final cloud = await FirestoreService.instance.getSportsExploreStats(uid);
    final out = Map<String, dynamic>.from(local);
    for (final slug in podSportsExploreSlugs) {
      final l = local[slug] is Map ? local[slug] as Map : {};
      final c = cloud[slug] is Map ? cloud[slug] as Map : {};
      out[slug] = {
        'seconds': [
          (l['seconds'] as num?)?.toInt() ?? 0,
          (c['seconds'] as num?)?.toInt() ?? 0,
        ].reduce((a, b) => a > b ? a : b),
        'visits': [
          (l['visits'] as num?)?.toInt() ?? 0,
          (c['visits'] as num?)?.toInt() ?? 0,
        ].reduce((a, b) => a > b ? a : b),
      };
    }
    return out;
  } catch (_) {
    return local;
  }
}

Future<Map<String, int>> getSportsPersonalizationWeights(String? uid) async {
  final stats = await getMergedExploreStats(uid);
  final raw = <String, num>{};
  var total = 0.0;
  for (final slug in podSportsExploreSlugs) {
    final s = stats[slug] is Map ? stats[slug] as Map : {};
    final sec = (s['seconds'] as num?)?.toInt() ?? 0;
    final v = (s['visits'] as num?)?.toInt() ?? 0;
    raw[slug] = sec + v * 45;
    total += raw[slug]!;
  }
  final weights = <String, int>{};
  if (total < 90) {
    for (final slug in podSportsExploreSlugs) {
      weights[slug] = 0;
    }
    return weights;
  }
  for (final slug in podSportsExploreSlugs) {
    weights[slug] = ((raw[slug]! / total) * 55).round();
  }
  return weights;
}

Future<void> recordSportsExploreDwell(
  String slug,
  num secondsDelta,
  num visitInc,
) async {
  if (!podSportsExploreSlugs.contains(slug)) return;
  final sd = secondsDelta.round().clamp(0, 900);
  final vi = visitInc.round().clamp(0, 50);
  if (sd == 0 && vi == 0) return;

  final local = await _readLocalExploreStats();
  await _writeLocalExploreStats(_mergeLocalSlug(local, slug, sd, vi));

  final u = AuthService.instance.getCurrentUser();
  if (u != null) {
    await FirestoreService.instance.mergeSportsExploreStats(
      u.uid,
      slug,
      secondsDelta: sd,
      visitInc: vi,
    );
  }
}

Future<void> recordSportsSurfaceSeconds(num deltaSec) async {
  final d = deltaSec.round().clamp(0, 3600);
  if (d < 2) return;
  try {
    final prefs = await SharedPreferences.getInstance();
    final prev = prefs.getInt(lsSportsSurfaceSec) ?? 0;
    await prefs.setInt(lsSportsSurfaceSec, prev + d);
  } catch (_) {
    /* ignore */
  }
  final u = AuthService.instance.getCurrentUser();
  if (u != null) {
    await FirestoreService.instance.mergeSportsSurfaceSeconds(u.uid, d);
  }
}
