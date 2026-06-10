import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'hub_carousel_image_store.dart';
import 'share_news_cache.dart';

const hubNewsTrendingUrlsKey = 'deite_hub_news_trending_urls_v1';

/// Track active hub News URLs and prune carousel images for removed stories.
Future<void> writeHubNewsUrlsAndPruneImageCache(List<String> urls) async {
  try {
    final prefs = await SharedPreferences.getInstance();
    final cleaned = urls.map((u) => normalizeUrlKey(u)).where((u) => u.isNotEmpty).toList();

    final prevRaw = prefs.getString(hubNewsTrendingUrlsKey);
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
      await pruneHubCarouselImagesForRemovedUrls(removed, kind: HubCarouselImageKind.news);
    }

    await prefs.setString(hubNewsTrendingUrlsKey, jsonEncode(cleaned));
  } catch (_) {}
}
