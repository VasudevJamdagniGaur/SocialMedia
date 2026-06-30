import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../utils/hub_carousel_ai_image.dart';
import 'pixelated_image_transition.dart';

/// Share-card image that keeps faces and key subjects visible by using the
/// image's natural aspect ratio, and only top-aligning when height is capped.
class ShareCardHeroImage extends StatefulWidget {
  const ShareCardHeroImage({
    super.key,
    required this.imageUrl,
    this.isLoading = false,
  });

  final String? imageUrl;
  final bool isLoading;

  /// Max display height as a fraction of width (1.0 = square).
  static const maxHeightToWidth = 1.0;

  @override
  State<ShareCardHeroImage> createState() => _ShareCardHeroImageState();
}

class _ShareCardHeroImageState extends State<ShareCardHeroImage> {
  double? _aspectRatio;

  @override
  void initState() {
    super.initState();
    unawaited(_resolveAspectRatio());
  }

  @override
  void didUpdateWidget(ShareCardHeroImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.imageUrl != oldWidget.imageUrl) {
      _aspectRatio = null;
      unawaited(_resolveAspectRatio());
    }
  }

  Future<void> _resolveAspectRatio() async {
    final url = widget.imageUrl?.trim();
    if (url == null || url.isEmpty || !mounted) return;

    try {
      ui.Image? image;
      if (url.startsWith('data:image')) {
        final bytes = decodeDataImageUrlBytes(url, logTag: '[ShareCard]');
        if (bytes != null) {
          image = await decodeImageFromList(bytes);
        }
      } else if (url.startsWith('http://') || url.startsWith('https://')) {
        image = await _loadNetworkImageDimensions(url);
      }

      if (!mounted || image == null) return;
      final w = image.width.toDouble();
      final h = image.height.toDouble();
      if (w <= 0 || h <= 0) return;
      setState(() => _aspectRatio = w / h);
    } catch (_) {
      if (mounted) setState(() => _aspectRatio = 4 / 3);
    }
  }

  Future<ui.Image?> _loadNetworkImageDimensions(String url) async {
    final provider = NetworkImage(url);
    final stream = provider.resolve(const ImageConfiguration());
    final completer = Completer<ui.Image>();

    late ImageStreamListener listener;
    listener = ImageStreamListener(
      (info, _) {
        if (!completer.isCompleted) completer.complete(info.image);
        stream.removeListener(listener);
      },
      onError: (error, stackTrace) {
        if (!completer.isCompleted) completer.completeError(error, stackTrace);
        stream.removeListener(listener);
      },
    );

    stream.addListener(listener);
    try {
      return await completer.future.timeout(const Duration(seconds: 10));
    } catch (_) {
      stream.removeListener(listener);
      return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final url = widget.imageUrl?.trim();
    if (url == null || url.isEmpty) return const SizedBox.shrink();

    final naturalAspect = _aspectRatio ?? (4 / 3);
    final minAspect = 1 / ShareCardHeroImage.maxHeightToWidth;
    final isTall = naturalAspect < minAspect;
    final displayAspect = isTall ? minAspect : naturalAspect;

    return AspectRatio(
      aspectRatio: displayAspect,
      child: DecoratedBox(
        decoration: const BoxDecoration(color: Color(0xFFEFF3F4)),
        child: PixelatedImageTransition(
          imageUrl: url,
          isLoading: widget.isLoading,
          fit: isTall ? BoxFit.cover : BoxFit.contain,
          alignment: isTall ? Alignment.topCenter : Alignment.center,
        ),
      ),
    );
  }
}
