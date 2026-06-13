import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'hub_carousel_image_store.dart';
import 'share_news_cache.dart';
import 'tea_trending_storage.dart';

const _maxPrefsStringBytes = 256 * 1024;
const _legacyHubCarouselAiCachePrefix = 'hub_carousel_ai_img_v1::';
const _postImageCachePrefix = 'post_image_cache_v2::';

bool _isOversizedPrefsValue(String? raw) =>
    raw != null && raw.length > _maxPrefsStringBytes;

bool _containsDataImage(String? raw) =>
    raw != null && raw.contains('data:image');

/// Strip huge base64 blobs from prefs so Android can load SharedPreferences without OOM.
Future<void> pruneSharedPreferencesOnStartup() async {
  try {
    final prefs = await SharedPreferences.getInstance();
    final keys = prefs.getKeys().toList();

    for (final key in keys) {
      if (key.startsWith(_legacyHubCarouselAiCachePrefix) ||
          key.startsWith(_postImageCachePrefix)) {
        await prefs.remove(key);
        continue;
      }

      if (key == hubCarouselImageIndexKey ||
          key == shareSuggestionsRouteStateKey ||
          key == shareNewsSuggestionsCacheKey ||
          key == shareNewsCardCacheKey) {
        final raw = prefs.getString(key);
        if (_isOversizedPrefsValue(raw) || _containsDataImage(raw)) {
          if (key == hubCarouselImageIndexKey && raw != null && raw.length <= _maxPrefsStringBytes) {
            await _rewriteHubCarouselIndexWithoutDataUrls(prefs, raw);
          } else {
            await prefs.remove(key);
          }
        }
      }
    }
  } catch (e) {
    debugPrint('[Prefs] startup prune failed: $e');
  }
}

Future<void> _rewriteHubCarouselIndexWithoutDataUrls(
  SharedPreferences prefs,
  String raw,
) async {
  try {
    final decoded = jsonDecode(raw);
    if (decoded is! Map) {
      await prefs.remove(hubCarouselImageIndexKey);
      return;
    }
    final cleaned = <String, String>{};
    for (final entry in decoded.entries) {
      final value = '${entry.value ?? ''}'.trim();
      if (value.startsWith('http://') || value.startsWith('https://')) {
        cleaned['${entry.key}'] = value;
      }
    }
    if (cleaned.isEmpty) {
      await prefs.remove(hubCarouselImageIndexKey);
      return;
    }
    await prefs.setString(hubCarouselImageIndexKey, jsonEncode(cleaned));
  } catch (_) {
    await prefs.remove(hubCarouselImageIndexKey);
  }
}

bool shouldPersistGeneratedImageCache(String imageUrl) {
  final s = imageUrl.trim();
  return s.startsWith('http://') || s.startsWith('https://');
}
