import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../services/chat_service.dart';
import '../services/cached_news_service.dart';
import '../services/render_backend_queue.dart';
import '../services/vertex_api_client.dart';
import '../services/youtube_tea_service.dart';
import 'hub_carousel_image_store.dart';
import 'share_news_cache.dart';

export '../services/render_backend_queue.dart' show HubCarouselImagePriority;

const maxHubCarouselAiGenerationsPerPass = 15;

final Map<String, String> _memoryAiImageCache = {};
final Map<String, Future<HubCarouselImageResult?>> _inFlightHubCarouselImages = {};

bool isVertexRateLimitError(Object error) {
  final msg = error.toString().toLowerCase();
  return msg.contains('429') ||
      msg.contains('resource exhausted') ||
      msg.contains('rate limit') ||
      msg.contains('rate limited') ||
      msg.contains('quota');
}

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

/// URLs that typically load in the app (not hotlink-blocked RSS redirects).
bool isReliableCarouselImageUrl(String? url) {
  final s = '${url ?? ''}'.trim();
  if (!isValidHubCarouselImageUrl(s)) return false;
  if (s.startsWith('data:image')) return true;
  if (s.contains('firebasestorage.googleapis.com') ||
      s.contains('ytimg.com') ||
      s.contains('redd.it') ||
      s.contains('imgur.com') ||
      s.contains('i.ibb.co')) {
    return true;
  }
  return RegExp(r'\.(jpe?g|png|gif|webp)(\?|#|$)', caseSensitive: false).hasMatch(s);
}

bool teaRowHasReliableImage(Map<String, dynamic> row) {
  final url = '${row['url'] ?? ''}'.trim();
  if (isYouTubeTeaUrl(url) && youtubeTeaThumbnailFromUrl(url) != null) return true;

  final thumb = '${row['image'] ?? row['thumbnail'] ?? ''}'.trim();
  if (isReliableCarouselImageUrl(thumb)) return true;

  for (final key in [
    hubCarouselImageCacheKey(url, ''),
    if (url.isNotEmpty) hubCarouselImageCacheKey(url, hubNewsDocIdFromUrl(url)),
  ]) {
    final mem = peekHubCarouselMemory(key);
    if (mem != null && isReliableCarouselImageUrl(mem)) return true;
  }
  return false;
}

bool hubNewsRowHasReliableImage(Map<String, dynamic> row) {
  final url = '${row['url'] ?? ''}'.trim();
  final thumb = '${row['image'] ?? row['thumbnail'] ?? ''}'.trim();
  if (isReliableCarouselImageUrl(thumb)) return true;
  if (isYouTubeTeaUrl(url) && youtubeTeaThumbnailFromUrl(url) != null) return true;

  for (final key in [
    hubCarouselImageCacheKey(url, ''),
    if (url.isNotEmpty) hubCarouselImageCacheKey(url, hubNewsDocIdFromUrl(url)),
  ]) {
    final mem = peekHubCarouselMemory(key);
    if (mem != null && isReliableCarouselImageUrl(mem)) return true;
  }
  return false;
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

/// Result from the centralized image pipeline containing both the AI-generated
/// image URL and the optional original source thumbnail.
class HubCarouselImageResult {
  const HubCarouselImageResult({
    required this.aiImageUrl,
    this.sourceImageUrl,
    this.fromCache = false,
  });

  final String aiImageUrl;
  final String? sourceImageUrl;
  final bool fromCache;
}

Future<String?> getOrGenerateHubCarouselImage({
  required String cacheKey,
  required String headline,
  String storyText = '',
  String articleUrl = '',
  HubCarouselImageKind kind = HubCarouselImageKind.news,
  String? sourceImageUrl,
  HubCarouselImagePriority priority = HubCarouselImagePriority.background,
}) async {
  final result = await getOrGenerateHubCarouselImageFull(
    cacheKey: cacheKey,
    headline: headline,
    storyText: storyText,
    articleUrl: articleUrl,
    kind: kind,
    sourceImageUrl: sourceImageUrl,
    priority: priority,
  );
  return result?.aiImageUrl;
}

/// Full pipeline: always generates AI image immediately via the Render backend.
/// Returns both the AI image URL and the original source image URL (if available).
Future<HubCarouselImageResult?> getOrGenerateHubCarouselImageFull({
  required String cacheKey,
  required String headline,
  String storyText = '',
  String articleUrl = '',
  HubCarouselImageKind kind = HubCarouselImageKind.news,
  String? sourceImageUrl,
  HubCarouselImagePriority priority = HubCarouselImagePriority.background,
}) async {
  final key = hubCarouselImageCacheKey('$cacheKey#refphoto1', headline);
  final title = headline.trim();
  if (key.isEmpty || title.isEmpty) return null;

  final url = articleUrl.trim().isNotEmpty ? articleUrl.trim() : key;
  final dedupeKey = hubCarouselImageCacheKey(url, key);

  final localCached = await resolveHubCarouselImageFast(
    url: url,
    title: title,
    fallbackId: key,
    kind: kind,
  );
  if (localCached != null) {
    final src = sourceImageUrl?.trim();
    return HubCarouselImageResult(
      aiImageUrl: localCached,
      sourceImageUrl: src?.startsWith('http') == true ? src : null,
      fromCache: true,
    );
  }

  final inFlight = _inFlightHubCarouselImages[dedupeKey];
  if (inFlight != null) return inFlight;

  final future = _getOrGenerateHubCarouselImageFullImpl(
    key: key,
    title: title,
    url: url,
    storyText: storyText,
    kind: kind,
    sourceImageUrl: sourceImageUrl,
    priority: priority,
  );
  _inFlightHubCarouselImages[dedupeKey] = future;
  try {
    return await future;
  } finally {
    _inFlightHubCarouselImages.remove(dedupeKey);
  }
}

Future<HubCarouselImageResult?> _getOrGenerateHubCarouselImageFullImpl({
  required String key,
  required String title,
  required String url,
  String storyText = '',
  HubCarouselImageKind kind = HubCarouselImageKind.news,
  String? sourceImageUrl,
  HubCarouselImagePriority priority = HubCarouselImagePriority.background,
}) async {
  // 1. Check local memory + disk cache first (instant, no network).
  final localCached = await resolveHubCarouselImageFast(
    url: url,
    title: title,
    fallbackId: key,
    kind: kind,
  );
  if (localCached != null) {
    // Even if locally cached, check Firestore for sourceImageUrl non-blocking.
    final src = sourceImageUrl?.trim();
    return HubCarouselImageResult(
      aiImageUrl: localCached,
      sourceImageUrl: src?.startsWith('http') == true ? src : null,
      fromCache: true,
    );
  }

  if (!isVertexBackendConfigured()) return null;

  // 2. Call /api/tea/ensure-image on the Render backend.
  //    - Server checks Firestore first (cache hit) and returns instantly.
  //    - On cache miss, generates AI image, uploads to Storage, persists, returns URL.
  try {
    debugPrint('[ImageGen] ensure-image: headlineLen=${title.length} url=${url.length > 60 ? url.substring(0, 60) : url}');
    final effSource = sourceImageUrl?.trim();
    final response = await VertexApiClient.instance.fetchJson(
      '/api/tea/ensure-image',
      body: {
        'articleUrl': url,
        'title': title,
        if (storyText.trim().isNotEmpty) 'storyText': stripHtmlBoilerplate(storyText),
        'kind': kind.name,
        if (effSource != null && effSource.startsWith('http')) 'sourceImageUrl': effSource,
      },
      timeout: const Duration(seconds: 90),
      priority: RenderBackendQueue.instance.isPostCreationActive
          ? RenderBackendPriority.postCreation
          : hubCarouselPriorityToRender(priority),
    );
    final aiImageUrl = (response['aiImageUrl'] ?? response['imageUrl']) as String?;
    final srcUrl = response['sourceImageUrl'] as String?;
    final fromCache = response['cached'] == true;
    debugPrint('[ImageGen] ensure-image done cached=$fromCache hasUrl=${aiImageUrl != null}');
    if (aiImageUrl == null || aiImageUrl.isEmpty) return null;

    await persistHubCarouselImage(
      url: url,
      title: title,
      imageUrl: aiImageUrl,
      kind: kind,
      fallbackId: key,
    );
    return HubCarouselImageResult(
      aiImageUrl: aiImageUrl,
      sourceImageUrl: srcUrl?.isNotEmpty == true ? srcUrl : effSource,
      fromCache: fromCache,
    );
  } catch (e) {
    debugPrint('[ImageGen] ensure-image failed: $e');
    if (isVertexRateLimitError(e)) {
      debugPrint('[ImageGen] rate limited — skipping duplicate fallback generation');
      return null;
    }
    debugPrint('[ImageGen] ensure-image failed, falling back to local generation: $e');
  }

  // 3. Fallback when the server is unreachable — not when quota is exhausted.
  try {
    final generated = await ChatService.instance.fetchSingleNewsShareIllustrationImage({
      'headline': title,
      if (storyText.trim().isNotEmpty) 'storyText': stripHtmlBoilerplate(storyText),
    });
    if (generated == null || !generated.startsWith('data:image')) return null;
    await persistHubCarouselImage(
      url: url,
      title: title,
      imageUrl: generated,
      kind: kind,
      fallbackId: key,
    );
    final src = sourceImageUrl?.trim();
    return HubCarouselImageResult(
      aiImageUrl: generated,
      sourceImageUrl: src?.startsWith('http') == true ? src : null,
    );
  } catch (e) {
    debugPrint('[HubCarouselAI] fallback image generation failed: $e');
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
  const batchSize = 1;
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
    this.alignment = Alignment.center,
    this.errorWidget,
  });

  final String? imageUrl;
  final BoxFit fit;
  final Alignment alignment;
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
        return Image.memory(
          bytes,
          fit: fit,
          width: double.infinity,
          height: double.infinity,
          alignment: alignment,
        );
      }
      return errorWidget ?? const SizedBox.shrink();
    }
    return Image.network(
      url,
      fit: fit,
      width: double.infinity,
      height: double.infinity,
      alignment: alignment,
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

List<String> hubCarouselImageFallbackIds({
  required String url,
  required String title,
  String fallbackId = '',
}) {
  final ids = <String>[];
  void add(String? value) {
    final v = '${value ?? ''}'.trim();
    if (v.isNotEmpty && !ids.contains(v)) ids.add(v);
  }

  add(hubCarouselImageCacheKey(url, fallbackId));
  add(hubCarouselImageCacheKey(url, ''));
  if (title.trim().isNotEmpty) add(hubCarouselImageCacheKey('', title));
  return ids;
}

/// Carousel hero that retries YouTube thumbs, cache, and optionally AI when the initial URL fails.
class HubCarouselResolvingHero extends StatefulWidget {
  const HubCarouselResolvingHero({
    super.key,
    this.initialUrl,
    required this.articleUrl,
    required this.title,
    this.storyText = '',
    this.fallbackId = '',
    this.fallbackIds = const [],
    required this.kind,
    required this.errorWidget,
    this.fit = BoxFit.cover,
    this.onResolved,
    this.tryYouTubeThumbnail = false,
    this.imagePriority = HubCarouselImagePriority.background,
    this.generateAiImage = true,
  });

  final String? initialUrl;
  final String articleUrl;
  final String title;
  final String storyText;
  final String fallbackId;
  final List<String> fallbackIds;
  final HubCarouselImageKind kind;
  final Widget errorWidget;
  final BoxFit fit;
  final ValueChanged<String>? onResolved;
  final bool tryYouTubeThumbnail;
  final HubCarouselImagePriority imagePriority;
  final bool generateAiImage;

  @override
  State<HubCarouselResolvingHero> createState() => _HubCarouselResolvingHeroState();
}

class _HubCarouselResolvingHeroState extends State<HubCarouselResolvingHero> {
  final Set<String> _failedUrls = {};
  String? _resolvedUrl;
  int _resolveGen = 0;

  @override
  void initState() {
    super.initState();
    _resolvedUrl = _bestCandidate();
    unawaited(_resolveHeroImage());
  }

  @override
  void didUpdateWidget(covariant HubCarouselResolvingHero oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.initialUrl != widget.initialUrl ||
        oldWidget.articleUrl != widget.articleUrl ||
        oldWidget.title != widget.title ||
        oldWidget.fallbackId != widget.fallbackId) {
      _failedUrls.clear();
      _resolvedUrl = _bestCandidate();
      unawaited(_resolveHeroImage());
    }
  }

  List<String?> _candidateUrls({bool includeResolved = true}) {
    final candidates = <String?>[
      widget.initialUrl?.trim(),
      if (includeResolved) _resolvedUrl,
      if (widget.tryYouTubeThumbnail) youtubeTeaThumbnailFromUrl(widget.articleUrl),
    ];
    return candidates;
  }

  String? _bestCandidate() {
    for (final candidate in _candidateUrls(includeResolved: true)) {
      if (candidate != null &&
          isValidHubCarouselImageUrl(candidate) &&
          !_failedUrls.contains(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  void _onImageFailed(String failedUrl) {
    if (!_failedUrls.add(failedUrl)) return;
    if (!mounted) return;
    setState(() {
      if (_resolvedUrl == failedUrl) _resolvedUrl = null;
    });
    unawaited(_resolveHeroImage());
  }

  void _applyResolved(String url) {
    if (!mounted) return;
    setState(() => _resolvedUrl = url);
    widget.onResolved?.call(url);
  }

  Future<void> _resolveHeroImage() async {
    final token = ++_resolveGen;
    final immediate = _bestCandidate();
    if (immediate != null) {
      if (mounted && token == _resolveGen) _applyResolved(immediate);
      // Reliable URLs (RSS, YouTube, Firebase AI cache) do not need generation.
      if (isReliableCarouselImageUrl(immediate)) return;
    }

    final ids = [
      ...widget.fallbackIds,
      ...hubCarouselImageFallbackIds(
        url: widget.articleUrl,
        title: widget.title,
        fallbackId: widget.fallbackId,
      ),
    ];
    for (final fallbackId in ids) {
      final cached = await resolveHubCarouselImageFast(
        url: widget.articleUrl,
        title: widget.title,
        fallbackId: fallbackId,
        kind: widget.kind,
      );
      if (cached != null &&
          isValidHubCarouselImageUrl(cached) &&
          !_failedUrls.contains(cached)) {
        if (mounted && token == _resolveGen) _applyResolved(cached);
        return;
      }
    }

    if (!widget.generateAiImage) return;

    final generated = await getOrGenerateHubCarouselImage(
      cacheKey: hubCarouselImageCacheKey(widget.articleUrl, widget.fallbackId),
      headline: widget.title,
      storyText: widget.storyText,
      articleUrl: widget.articleUrl,
      kind: widget.kind,
      priority: widget.imagePriority,
    );
    if (!mounted || token != _resolveGen) return;
    if (generated != null &&
        isValidHubCarouselImageUrl(generated) &&
        !_failedUrls.contains(generated)) {
      _applyResolved(generated);
    }
  }

  @override
  Widget build(BuildContext context) {
    final heroUrl = _bestCandidate();
    return Stack(
      fit: StackFit.expand,
      children: [
        Positioned.fill(child: widget.errorWidget),
        if (heroUrl != null)
          Positioned.fill(
            child: _CarouselHeroImage(
              imageUrl: heroUrl,
              fit: widget.fit,
              onFailed: () => _onImageFailed(heroUrl),
              errorWidget: widget.errorWidget,
            ),
          ),
      ],
    );
  }
}

class _CarouselHeroImage extends StatefulWidget {
  const _CarouselHeroImage({
    required this.imageUrl,
    required this.onFailed,
    required this.errorWidget,
    this.fit = BoxFit.cover,
  });

  final String imageUrl;
  final VoidCallback onFailed;
  final Widget errorWidget;
  final BoxFit fit;

  @override
  State<_CarouselHeroImage> createState() => _CarouselHeroImageState();
}

class _CarouselHeroImageState extends State<_CarouselHeroImage> {
  var _failed = false;

  @override
  void didUpdateWidget(covariant _CarouselHeroImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.imageUrl != widget.imageUrl) _failed = false;
  }

  @override
  Widget build(BuildContext context) {
    if (_failed) return widget.errorWidget;

    final url = widget.imageUrl.trim();
    if (!isHubCarouselDisplayImage(url)) return widget.errorWidget;

    if (url.startsWith('data:image')) {
      final bytes = decodeDataImageUrlBytes(url, logTag: '[HubCarousel]');
      if (bytes != null) {
        return Image.memory(bytes, fit: widget.fit);
      }
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && !_failed) {
          setState(() => _failed = true);
          widget.onFailed();
        }
      });
      return widget.errorWidget;
    }

    return Image.network(
      url,
      fit: widget.fit,
      gaplessPlayback: true,
      loadingBuilder: (context, child, progress) {
        if (progress == null) return child;
        return Stack(
          fit: StackFit.expand,
          children: [
            widget.errorWidget,
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
      errorBuilder: (_, __, ___) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted && !_failed) {
            setState(() => _failed = true);
            widget.onFailed();
          }
        });
        return widget.errorWidget;
      },
    );
  }
}
