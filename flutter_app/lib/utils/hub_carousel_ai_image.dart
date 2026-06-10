import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/chat_service.dart';
import '../services/vertex_api_client.dart';

const _hubCarouselAiCachePrefix = 'hub_carousel_ai_img_v1::';
const _maxCarouselAiGenerationsPerPass = 4;

/// True for http(s) hero URLs and locally cached/generated data URLs.
bool isHubCarouselDisplayImage(String? url) {
  final s = '${url ?? ''}'.trim();
  return s.startsWith('http://') ||
      s.startsWith('https://') ||
      s.startsWith('data:image');
}

Future<String?> getOrGenerateHubCarouselImage({
  required String cacheKey,
  required String headline,
  String storyText = '',
}) async {
  final key = cacheKey.trim();
  final title = headline.trim();
  if (key.isEmpty || title.isEmpty) return null;
  if (!isVertexBackendConfigured()) return null;

  final prefsKey = '$_hubCarouselAiCachePrefix${key.hashCode.abs()}';
  try {
    final prefs = await SharedPreferences.getInstance();
    final cached = prefs.getString(prefsKey);
    if (cached != null && cached.startsWith('data:image')) return cached;
  } catch (_) {}

  try {
    final generated = await ChatService.instance.fetchSingleNewsShareIllustrationImage({
      'headline': title,
      if (storyText.trim().isNotEmpty) 'storyText': storyText.trim(),
    });
    if (generated == null || !generated.startsWith('data:image')) return null;

    if (generated.length <= 900000) {
      try {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString(prefsKey, generated);
      } catch (_) {}
    }
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
  int maxGenerate = _maxCarouselAiGenerationsPerPass,
}) async {
  var generated = 0;
  for (var i = 0; i < slotCount && generated < maxGenerate; i++) {
    if (!needsImage(i)) continue;
    final img = await generateForIndex(i);
    if (img == null || img.isEmpty) continue;
    applyImage(i, img);
    generated++;
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
      try {
        final base64 = url.contains(',') ? url.split(',').last : url;
        final bytes = base64Decode(base64);
        return Image.memory(bytes, fit: fit);
      } catch (_) {
        return errorWidget ?? const SizedBox.shrink();
      }
    }
    return Image.network(
      url,
      fit: fit,
      errorBuilder: (_, __, ___) => errorWidget ?? const SizedBox.shrink(),
    );
  }
}
