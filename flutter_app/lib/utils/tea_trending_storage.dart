import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'hub_carousel_image_store.dart';
import 'share_news_cache.dart';

const teaTrendingUrlsKey = 'deite_tea_trending_urls_v1';
const shareNewsCardCacheKey = 'deite_share_news_card_cache_v1';

/// Persist trending tea URLs and prune stale tea entries from share card cache.
/// Port of writeTrendingTeaUrlsAndPruneShareCache in TrendingTea.js
Future<void> writeTrendingTeaUrlsAndPruneShareCache(List<String> urls) async {
  try {
    final prefs = await SharedPreferences.getInstance();
    final cleaned = urls.map((u) => normalizeUrlKey(u)).where((u) => u.isNotEmpty).toList();

    final prevRaw = prefs.getString(teaTrendingUrlsKey);
    final prev = <String>{};
    if (prevRaw != null && prevRaw.isNotEmpty) {
      final decoded = jsonDecode(prevRaw);
      if (decoded is List) {
        for (final u in decoded) {
          final s = normalizeUrlKey('$u');
          if (s.isNotEmpty) prev.add(s);
        }
      }
    }
    final next = cleaned.toSet();
    final removed = prev.difference(next);
    if (removed.isNotEmpty) {
      await pruneHubCarouselImagesForRemovedUrls(removed, kind: HubCarouselImageKind.tea);
    }

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
