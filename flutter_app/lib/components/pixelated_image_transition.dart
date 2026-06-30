import 'package:flutter/material.dart';

import '../utils/hub_carousel_ai_image.dart';

/// Pixelates an image while [isLoading], then reveals a new [imageUrl] when loading ends.
class PixelatedImageTransition extends StatefulWidget {
  const PixelatedImageTransition({
    super.key,
    required this.imageUrl,
    required this.isLoading,
    this.fit = BoxFit.cover,
  });

  final String? imageUrl;
  final bool isLoading;
  final BoxFit fit;

  @override
  State<PixelatedImageTransition> createState() => _PixelatedImageTransitionState();
}

class _PixelatedImageTransitionState extends State<PixelatedImageTransition>
    with SingleTickerProviderStateMixin {
  static const _duration = Duration(milliseconds: 500);

  late final AnimationController _controller;
  String? _displayUrl;
  bool _regenerating = false;

  @override
  void initState() {
    super.initState();
    _displayUrl = _normalizedUrl(widget.imageUrl);
    _controller = AnimationController(vsync: this, duration: _duration)
      ..addStatusListener((status) {
        if (status == AnimationStatus.dismissed) {
          _controller.value = 0;
        }
      });
  }

  @override
  void didUpdateWidget(PixelatedImageTransition oldWidget) {
    super.didUpdateWidget(oldWidget);

    final url = _normalizedUrl(widget.imageUrl);
    final oldUrl = _normalizedUrl(oldWidget.imageUrl);
    final loadingStarted = widget.isLoading && !oldWidget.isLoading;
    final loadingEnded = !widget.isLoading && oldWidget.isLoading;

    if (loadingStarted) {
      final hadImage = (_displayUrl ?? url)?.isNotEmpty == true;
      if (hadImage) {
        _regenerating = true;
        _controller.forward(from: 0);
      }
    }

    if (widget.isLoading && url != null && url != oldUrl && url != _displayUrl) {
      setState(() => _displayUrl = url);
      if (_regenerating) {
        _controller.value = 1;
      }
    }

    if (loadingEnded && _regenerating) {
      if (url != null) {
        setState(() => _displayUrl = url);
      }
      _regenerating = false;
      _controller.reverse(from: 1);
    } else if (!widget.isLoading && url != null && url != _displayUrl) {
      setState(() => _displayUrl = url);
      if (_controller.value > 0) {
        _controller.reverse(from: _controller.value);
      }
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  String? _normalizedUrl(String? value) {
    final trimmed = value?.trim();
    if (trimmed == null || trimmed.isEmpty) return null;
    return trimmed;
  }

  Widget _pixelatedChild(Widget child, double amount, double width, double height) {
    final framed = SizedBox(
      width: width,
      height: height,
      child: ClipRect(child: child),
    );
    if (amount <= 0.001) return framed;

    final blocks = 1 + amount * 31;
    return SizedBox(
      width: width,
      height: height,
      child: ClipRect(
        child: FittedBox(
          fit: BoxFit.fill,
          clipBehavior: Clip.hardEdge,
          child: SizedBox(
            width: width / blocks,
            height: height / blocks,
            child: FittedBox(
              fit: BoxFit.fill,
              child: SizedBox(width: width, height: height, child: child),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final url = _displayUrl;
    if (url == null || url.isEmpty) {
      return const SizedBox.shrink();
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final height = constraints.maxHeight;
        if (!width.isFinite || !height.isFinite || width <= 0 || height <= 0) {
          return HubCarouselHeroImage(imageUrl: url, fit: widget.fit);
        }

        return AnimatedBuilder(
          animation: _controller,
          builder: (context, _) {
            return _pixelatedChild(
              HubCarouselHeroImage(imageUrl: url, fit: widget.fit),
              _controller.value,
              width,
              height,
            );
          },
        );
      },
    );
  }
}
