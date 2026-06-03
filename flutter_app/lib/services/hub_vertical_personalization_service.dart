import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// Crew hub verticals (top-level categories) â€” time, visits, and taps drive trending mix + copy.

const List<String> hubVerticalIds = [
  'sports',
  'ai-tech',
  'entrepreneurship',
  'current-affairs',
];

const Map<String, String> hubVerticalLabels = {
  'sports': 'Sports',
  'ai-tech': 'AI & Tech',
  'entrepreneurship': 'Entrepreneurship',
  'current-affairs': 'Current Affairs',
};

const String _lsKey = 'pod_hub_vertical_stats_v1';

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

Future<Map<String, dynamic>> _readLocal() async {
  final prefs = await SharedPreferences.getInstance();
  return _safeParseJson(prefs.getString(_lsKey) ?? '{}', {});
}

Future<void> _writeLocal(Map<String, dynamic> stats) async {
  try {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_lsKey, jsonEncode(stats));
  } catch (_) {
    /* quota */
  }
}

Map<String, dynamic> _mergeSlug(
  Map<String, dynamic> stats,
  String id,
  int secondsDelta,
  int visitInc,
  int clickInc,
) {
  if (!hubVerticalIds.contains(id)) return stats;
  final next = Map<String, dynamic>.from(stats);
  final cur = next[id] is Map
      ? Map<String, dynamic>.from(next[id] as Map)
      : {'seconds': 0, 'visits': 0, 'clicks': 0};
  final sec = ((cur['seconds'] as num?)?.toInt() ?? 0) +
      secondsDelta.clamp(0, 86400);
  final vis = ((cur['visits'] as num?)?.toInt() ?? 0) + visitInc.clamp(0, 999999);
  final clk = ((cur['clicks'] as num?)?.toInt() ?? 0) + clickInc.clamp(0, 999999);
  next[id] = {'seconds': sec, 'visits': vis, 'clicks': clk};
  return next;
}

Future<void> recordHubVerticalDwell(
  String verticalId,
  num secondsDelta,
  num visitInc,
) async {
  final sd = secondsDelta.round().clamp(0, 900);
  final vi = visitInc.round().clamp(0, 80);
  if (sd == 0 && vi == 0) return;
  final local = await _readLocal();
  await _writeLocal(_mergeSlug(local, verticalId, sd, vi, 0));
}

Future<void> recordHubVerticalClick(String verticalId) async {
  if (!hubVerticalIds.contains(verticalId)) return;
  final local = await _readLocal();
  await _writeLocal(_mergeSlug(local, verticalId, 0, 0, 1));
}

Future<Map<String, Map<String, int>>> getHubVerticalStats() async {
  final s = await _readLocal();
  final out = <String, Map<String, int>>{};
  for (final id in hubVerticalIds) {
    final x = s[id] is Map ? s[id] as Map : {};
    out[id] = {
      'seconds': ((x['seconds'] as num?) ?? 0).toInt().clamp(0, 999999),
      'visits': ((x['visits'] as num?) ?? 0).toInt().clamp(0, 999999),
      'clicks': ((x['clicks'] as num?) ?? 0).toInt().clamp(0, 999999),
    };
  }
  return out;
}

Future<Map<String, int>> getHubVerticalWeights() async {
  final stats = await getHubVerticalStats();
  final raw = <String, num>{};
  var total = 0.0;
  for (final id in hubVerticalIds) {
    final sec = stats[id]?['seconds'] ?? 0;
    final vis = stats[id]?['visits'] ?? 0;
    final clk = stats[id]?['clicks'] ?? 0;
    raw[id] = sec + vis * 45 + clk * 22;
    total += raw[id]!;
  }
  final weights = <String, int>{};
  if (total < 72) {
    for (final id in hubVerticalIds) {
      weights[id] = 0;
    }
    return weights;
  }
  for (final id in hubVerticalIds) {
    weights[id] = ((raw[id]! / total) * 50).round();
  }
  return weights;
}

String inferHubVerticalForNewsItem(Map<String, dynamic> item) {
  final hv = item['hubVertical'] as String?;
  if (hv != null && hubVerticalIds.contains(hv)) return hv;
  final cat = (item['category'] as String? ?? '').toLowerCase();
  if (['cricket', 'football', 'f1', 'chess', 'others'].contains(cat)) {
    return 'sports';
  }
  if (cat == 'technology') return 'ai-tech';
  if (cat == 'business') return 'entrepreneurship';
  if (['general', 'politics', 'economy', 'climate'].contains(cat)) {
    return 'current-affairs';
  }
  return 'current-affairs';
}

List<Map<String, dynamic>> rankHubLiveItemsByPersonalization(
  List<Map<String, dynamic>> items,
  Map<String, int>? verticalWeights,
) {
  final vw = verticalWeights ?? {};
  final scored = items.map((it) {
    final v = inferHubVerticalForNewsItem(it);
    final vb = vw[v] ?? 0;
    final eng = ((it['likes'] as num?) ?? 0).toInt() * 3 +
        ((it['shares'] as num?) ?? 0).toInt() * 5 +
        ((it['views'] as num?) ?? 0).toInt();
    var pub = 0;
    final t = it['publishedAt'];
    if (t is String) {
      final n = DateTime.tryParse(t)?.millisecondsSinceEpoch;
      if (n != null) pub = n;
    }
    return {'it': it, 's': vb * 1400 + eng * 4 + pub / 50000};
  }).toList();

  scored.sort((a, b) {
    final d = (b['s'] as num) - (a['s'] as num);
    if (d.abs() > 0.5) return d.sign.toInt();
    final pa = a['it'] is Map ? (a['it'] as Map)['publishedAt'] : null;
    final pb = b['it'] is Map ? (b['it'] as Map)['publishedAt'] : null;
    final ta = pa is String ? DateTime.tryParse(pa)?.millisecondsSinceEpoch ?? 0 : 0;
    final tb = pb is String ? DateTime.tryParse(pb)?.millisecondsSinceEpoch ?? 0 : 0;
    return tb.compareTo(ta);
  });

  return scored.map((x) => x['it'] as Map<String, dynamic>).toList();
}

String _formatDurationShort(int sec) {
  final s = sec.clamp(0, 999999);
  if (s < 60) return '${s}s';
  final m = (s / 60).round();
  if (m < 120) return '${m}m';
  final h = (m / 60).round();
  return '${h}h';
}

Future<Map<String, List<String>>> buildHubTrendingInsightLines(
  Map<String, dynamic>? profile,
) async {
  final stats = await getHubVerticalStats();
  final lines = <String>[];

  final city = (profile?['city'] as String? ?? '').trim();
  final ctry = (profile?['country'] as String? ?? '').trim().toUpperCase();
  if (city.isNotEmpty && ctry.length == 2) {
    lines.add('Near $city Â· $ctry');
  } else if (ctry.length == 2) {
    lines.add('Region: $ctry');
  }

  String? bestId;
  var bestScore = -1;
  for (final id in hubVerticalIds) {
    final sec = stats[id]?['seconds'] ?? 0;
    final vis = stats[id]?['visits'] ?? 0;
    final clk = stats[id]?['clicks'] ?? 0;
    final score = sec + vis * 50 + clk * 35;
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }

  if (bestId != null && bestScore >= 45) {
    final label = hubVerticalLabels[bestId] ?? bestId;
    lines.add(
      'Most time in $label (${_formatDurationShort(stats[bestId]!['seconds'] ?? 0)} on hub pages)',
    );
  }

  final behaviorParts = <String>[];
  for (final id in hubVerticalIds) {
    final sec = stats[id]?['seconds'] ?? 0;
    final vis = stats[id]?['visits'] ?? 0;
    final clk = stats[id]?['clicks'] ?? 0;
    if (sec < 30 && vis < 1 && clk < 1) continue;
    final lb = hubVerticalLabels[id] ?? id;
    final bits = <String>[];
    if (sec >= 30) bits.add(_formatDurationShort(sec));
    if (vis > 0) bits.add('$vis visit${vis == 1 ? '' : 's'}');
    if (clk > 0) bits.add('$clk open${clk == 1 ? '' : 's'}');
    if (bits.isNotEmpty) behaviorParts.add('$lb: ${bits.join(' Â· ')}');
  }

  if (behaviorParts.isNotEmpty) {
    lines.add('Your behavior: ${behaviorParts.take(3).join(' Â· ')}');
  }

  lines.add(
    'Social signal: stories with more likes, shares, and reads rank higher when we have data.',
  );

  return {'lines': lines};
}
