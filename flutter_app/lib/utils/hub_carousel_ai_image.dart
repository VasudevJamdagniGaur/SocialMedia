import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../services/chat_service.dart';
import '../services/vertex_api_client.dart';
import 'hub_carousel_image_store.dart';
import 'share_news_cache.dart';

const maxHubCarouselAiGenerationsPerPass = 10;

final Map<String, String> _memoryAiImageCache = {};

String hubCarouselImageCacheKey(String url, [String fallback = '']) {
  final normalized = normalizeUrlKey(url);
  if (normalized.isNotEmpty) return normalized;
  return fallback.trim();
}

/// True for http(s) hero URLs and locally cached/generated data URLs.
bool isHubCarouselDisplayImage(String? url) {
  final s = '${url ?? ''}'.trim();
  return s.startsWith('http://') ||
      s.startsWith('https://') ||
      s.startsWith('data:image');
}

/// Decode a `data:image/...;base64,...` URL to bytes. Logs success/failure.
Uint8List? decodeDataImageUrlBytes(String? url, {String logTag = '[ImageGen]'}) {
  final s = '${url ?? ''}'.trim();
  if (!s.startsWith('data:image')) return null;
  try {
    final base64String = s.contains(',') ? s.split(',').last : s;
    final bytes = base64Decode(base64String);
    debugPrint('$logTag base64 conversion success bytes=${bytes.length}');
    return bytes;
  } catch (e) {
    debugPrint('$logTag base64 conversion failed: $e');
    return null;
  }
}

/// Rejects truncated or corrupt data URLs that would render as a black frame.
bool isValidHubCarouselImageUrl(String? url) {
  final s = '${url ?? ''}'.trim();
  if (!isHubCarouselDisplayImage(s)) return false;
  if (!s.startsWith('data:image')) return true;
  try {
    final comma = s.indexOf(',');
    if (comma == -1) return false;
    final base64 = s.substring(comma + 1).trim();
    if (base64.length < 48) return false;
    base64Decode(base64);
    return true;
  } catch (_) {
    return false;
  }
}

String? peekHubCarouselMemory(String cacheKey) {
  final key = hubCarouselImageCacheKey(cacheKey);
  if (key.isEmpty) return null;
  final hit = _memoryAiImageCache[key];
  if (hit != null && isHubCarouselDisplayImage(hit)) return hit;
  return null;
}

Future<String?> readCachedHubCarouselImage(String cacheKey) async {
  final key = hubCarouselImageCacheKey(cacheKey);
  if (key.isEmpty) return null;
  final mem = peekHubCarouselMemory(key);
  if (mem != null) return mem;
  final index = await readHubCarouselImageIndex();
  final hit = index[key];
  if (hit != null && isHubCarouselDisplayImage(hit)) {
    rememberHubCarouselImageInMemory(key, hit);
    return hit;
  }
  return null;
}

void rememberHubCarouselImageInMemory(String cacheKey, String imageUrl) {
  final key = hubCarouselImageCacheKey(cacheKey);
  if (key.isEmpty || !isHubCarouselDisplayImage(imageUrl)) return;
  _memoryAiImageCache[key] = imageUrl.trim();
}

/// Resolve a carousel image from memory/disk/server using url, id, or headline keys.
Future<String?> resolveCachedHubCarouselImage({
  required String url,
  required String title,
  String fallbackId = '',
  HubCarouselImageKind kind = HubCarouselImageKind.news,
}) {
  return resolveHubCarouselImageFast(
    url: url,
    title: title,
    fallbackId: fallbackId,
    kind: kind,
  );
}

Future<String?> getOrGenerateHubCarouselImage({
  required String cacheKey,
  required String headline,
  String storyText = '',
  String articleUrl = '',
  HubCarouselImageKind kind = HubCarouselImageKind.news,
}) async {
  final key = hubCarouselImageCacheKey('$cacheKey#refphoto1', headline);
  final title = headline.trim();
  if (key.isEmpty || title.isEmpty) return null;

  final url = articleUrl.trim().isNotEmpty ? articleUrl.trim() : key;

  final cached = await resolveHubCarouselImageFast(
    url: url,
    title: title,
    fallbackId: key,
    kind: kind,
  );
  if (cached != null) return cached;

  if (!isVertexBackendConfigured()) return null;

  try {
    debugPrint('[ImageGen] hub carousel generation start headlineLen=${title.length}');
    final generated = await ChatService.instance.fetchSingleNewsShareIllustrationImage({
      'headline': title,
      if (storyText.trim().isNotEmpty) 'storyText': stripHtmlBoilerplate(storyText),
    });
    debugPrint(
      '[ImageGen] hub carousel generation done hasImage=${generated != null} len=${generated?.length ?? 0}',
    );
    if (generated == null || !generated.startsWith('data:image')) return null;

    await persistHubCarouselImage(
      url: url,
      title: title,
      imageUrl: generated,
      kind: kind,
      fallbackId: key,
    );
    return generated;
  } catch (e) {
    debugPrint('[HubCarouselAI] image generation failed: $e');
    return null;
  }
}

/// Generate AI illustrations for carousel slots that lack a hero image.
Future<void> enrichCarouselSlotsWithAiImages({
  required int slotCount,
  required bool Function(int index) needsImage,
  required Future<String?> Function(int index) generateForIndex,
  required void Function(int index, String imageUrl) applyImage,
  int maxGenerate = maxHubCarouselAiGenerationsPerPass,
}) async {
  final indices = <int>[];
  for (var i = 0; i < slotCount; i++) {
    if (needsImage(i)) indices.add(i);
  }
  final todo = indices.take(maxGenerate).toList();
  const batchSize = 2;
  for (var start = 0; start < todo.length; start += batchSize) {
    final batch = todo.skip(start).take(batchSize).toList();
    await Future.wait(batch.map((i) async {
      final img = await generateForIndex(i);
      if (img != null && img.isNotEmpty) applyImage(i, img);
    }));
  }
}

/// Network or data-URL hero for hub carousels.
class HubCarouselHeroImage extends StatelessWidget {
  const HubCarouselHeroImage({
    super.key,
    required this.imageUrl,
    this.fit = BoxFit.cover,
    this.errorWidget,
  });

  final String? imageUrl;
  final BoxFit fit;
  final Widget? errorWidget;

  @override
  Widget build(BuildContext context) {
    final url = '${imageUrl ?? ''}'.trim();
    if (!isHubCarouselDisplayImage(url)) {
      return errorWidget ?? const SizedBox.shrink();
    }
    if (url.startsWith('data:image')) {
      final bytes = decodeDataImageUrlBytes(url, logTag: '[ImageGen] render');
      if (bytes != null) {
        debugPrint('[ImageGen] widget render success (HubCarouselHeroImage)');
        return Image.memory(bytes, fit: fit);
      }
      return errorWidget ?? const SizedBox.shrink();
    }
    return Image.network(
      url,
      fit: fit,
      gaplessPlayback: true,
      loadingBuilder: (context, child, progress) {
        if (progress == null) return child;
        return Stack(
          fit: StackFit.expand,
          children: [
            child,
            Center(
              child: CircularProgressIndicator(
                value: progress.expectedTotalBytes != null
                    ? progress.cumulativeBytesLoaded / progress.expectedTotalBytes!
                    : null,
                strokeWidth: 2,
                color: Colors.white54,
              ),
            ),
          ],
        );
      },
      errorBuilder: (_, __, ___) => errorWidget ?? const SizedBox.shrink(),
    );
  }
}
