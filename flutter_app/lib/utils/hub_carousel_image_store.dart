import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/firestore_service.dart';
import 'hub_carousel_ai_image.dart';
import 'share_news_cache.dart';

const hubCarouselImageIndexKey = 'deite_hub_carousel_image_index_v2';
const _legacyHubCarouselAiCachePrefix = 'hub_carousel_ai_img_v1::';

enum HubCarouselImageKind { tea, news }

/// Read the local URL → image map (https preferred; data URLs for offline).
Future<Map<String, String>> readHubCarouselImageIndex() async {
  try {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(hubCarouselImageIndexKey);
    if (raw == null || raw.isEmpty) return {};
    final decoded = jsonDecode(raw);
    if (decoded is! Map) return {};
    return decoded.map((k, v) => MapEntry('$k', '$v'));
  } catch (_) {
    return {};
  }
}

Future<void> _writeHubCarouselImageIndex(Map<String, String> index) async {
  try {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(hubCarouselImageIndexKey, jsonEncode(index));
  } catch (_) {}
}

/// Save image locally and mirror to Deitea server (Storage + Firestore).
Future<void> persistHubCarouselImage({
  required String url,
  required String title,
  required String imageUrl,
  required HubCarouselImageKind kind,
  String fallbackId = '',
}) async {
  final trimmed = imageUrl.trim();
  if (!isHubCarouselDisplayImage(trimmed)) return;

  final primaryKey = hubCarouselImageCacheKey(url, fallbackId);
  final keys = <String>{
    if (primaryKey.isNotEmpty) primaryKey,
    if (title.trim().isNotEmpty) hubCarouselImageCacheKey('', title),
  };

  for (final key in keys) {
    rememberHubCarouselImageInMemory(key, trimmed);
  }

  final index = await readHubCarouselImageIndex();
  var changed = false;
  for (final key in keys) {
    if (index[key] != trimmed) {
      index[key] = trimmed;
      changed = true;
    }
  }
  if (changed) await _writeHubCarouselImageIndex(index);

  final articleUrl = url.trim();
  if (articleUrl.isEmpty) return;

  unawaited(_mirrorHubCarouselImageToServer(
    articleUrl: articleUrl,
    imageUrl: trimmed,
    kind: kind,
    title: title,
    keys: keys,
  ));
}

Future<void> _mirrorHubCarouselImageToServer({
  required String articleUrl,
  required String imageUrl,
  required HubCarouselImageKind kind,
  required String title,
  required Set<String> keys,
}) async {
  final remote = await FirestoreService.instance.saveHubCarouselImage(
    articleUrl: articleUrl,
    imageUrl: imageUrl,
    kind: kind.name,
    headline: title,
    storagePath: imageUrl.startsWith('http') ? '' : '',
  );
  if (remote == null || !remote.startsWith('http')) return;

  final index = await readHubCarouselImageIndex();
  var changed = false;
  for (final key in keys) {
    if (index[key] != remote) {
      index[key] = remote;
      changed = true;
    }
    rememberHubCarouselImageInMemory(key, remote);
  }
  if (changed) await _writeHubCarouselImageIndex(index);
}

Future<String?> readHubCarouselImageFromLocalIndex({
  required String url,
  required String title,
  String fallbackId = '',
}) async {
  final keys = <String>{
    hubCarouselImageCacheKey(url, fallbackId),
    if (title.trim().isNotEmpty) hubCarouselImageCacheKey('', title),
  };

  for (final key in keys) {
    if (key.isEmpty) continue;
    final mem = peekHubCarouselMemory(key);
    if (mem != null) return mem;
  }

  final index = await readHubCarouselImageIndex();
  for (final key in keys) {
    if (key.isEmpty) continue;
    final hit = index[key];
    if (hit != null && isHubCarouselDisplayImage(hit)) {
      rememberHubCarouselImageInMemory(key, hit);
      return hit;
    }
  }

  for (final key in keys) {
    if (key.isEmpty) continue;
    final legacy = await _readLegacyPrefsImage(key);
    if (legacy != null) {
      await persistHubCarouselImage(
        url: url,
        title: title,
        imageUrl: legacy,
        kind: HubCarouselImageKind.news,
        fallbackId: fallbackId,
      );
      return legacy;
    }
  }
  return null;
}

Future<String?> _readLegacyPrefsImage(String key) async {
  try {
    final prefs = await SharedPreferences.getInstance();
    final prefsKey = '$_legacyHubCarouselAiCachePrefix${key.hashCode.abs()}';
    final cached = prefs.getString(prefsKey);
    if (cached != null && cached.startsWith('data:image')) return cached;
  } catch (_) {}
  return null;
}

/// Local + server lookup (no generation).
Future<String?> resolveHubCarouselImageFast({
  required String url,
  required String title,
  String fallbackId = '',
  HubCarouselImageKind kind = HubCarouselImageKind.news,
}) async {
  final local = await readHubCarouselImageFromLocalIndex(
    url: url,
    title: title,
    fallbackId: fallbackId,
  );
  if (local != null) return local;

  final articleUrl = url.trim();
  if (articleUrl.isEmpty) return null;
  try {
    final server = await FirestoreService.instance.getHubCarouselImageUrl(articleUrl);
    if (server != null && isHubCarouselDisplayImage(server)) {
      await persistHubCarouselImage(
        url: url,
        title: title,
        imageUrl: server,
        kind: kind,
        fallbackId: fallbackId,
      );
      return server;
    }
  } catch (e) {
    debugPrint('[HubCarouselStore] server read failed: $e');
  }
  return null;
}

/// Remove cached images for URLs no longer in Tea/News feeds.
Future<void> pruneHubCarouselImagesForRemovedUrls(
  Iterable<String> removedUrls, {
  HubCarouselImageKind? kind,
}) async {
  final removed = removedUrls
      .map((u) => normalizeUrlKey(u))
      .where((u) => u.isNotEmpty)
      .toSet();
  if (removed.isEmpty) return;

  final index = await readHubCarouselImageIndex();
  var indexChanged = false;
  for (final entry in index.entries.toList()) {
    if (removed.contains(entry.key)) {
      index.remove(entry.key);
      indexChanged = true;
    }
  }
  if (indexChanged) await _writeHubCarouselImageIndex(index);

  try {
    final prefs = await SharedPreferences.getInstance();
    for (final url in removed) {
      final legacyKey = '$_legacyHubCarouselAiCachePrefix${url.hashCode.abs()}';
      await prefs.remove(legacyKey);
      unawaited(FirestoreService.instance.deleteHubCarouselImage(url));
    }
  } catch (_) {}
}
