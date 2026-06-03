import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

const teaTrendingUrlsKey = 'deite_tea_trending_urls_v1';
const shareNewsCardCacheKey = 'deite_share_news_card_cache_v1';

/// Persist trending tea URLs and prune stale tea entries from share card cache.
/// Port of writeTrendingTeaUrlsAndPruneShareCache in TrendingTea.js
Future<void> writeTrendingTeaUrlsAndPruneShareCache(List<String> urls) async {
  try {
    final prefs = await SharedPreferences.getInstance();
    final cleaned = urls.map((u) => u.trim()).where((u) => u.isNotEmpty).toList();
    await prefs.setString(teaTrendingUrlsKey, jsonEncode(cleaned));

    final raw = prefs.getString(shareNewsCardCacheKey);
    if (raw == null || raw.isEmpty) return;
    final decoded = jsonDecode(raw);
    if (decoded is! Map) return;

    final cache = Map<String, dynamic>.from(decoded);
    final keep = cleaned.toSet();
    var changed = false;
    for (final entry in cache.entries.toList()) {
      final v = entry.value;
      if (v is Map && v['kind'] == 'tea' && !keep.contains(entry.key)) {
        cache.remove(entry.key);
        changed = true;
      }
    }
    if (changed) {
      await prefs.setString(shareNewsCardCacheKey, jsonEncode(cache));
    }
  } catch (_) {}
}
