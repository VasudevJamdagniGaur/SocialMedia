import 'package:flutter/material.dart';
import 'package:shimmer/shimmer.dart';

enum SkeletonVariant { text, avatar, card, image }

class Skeleton extends StatelessWidget {
  const Skeleton({
    super.key,
    this.variant = SkeletonVariant.text,
    this.width,
    this.height,
    this.borderRadius,
  });

  final SkeletonVariant variant;
  final double? width;
  final double? height;
  final BorderRadius? borderRadius;

  BorderRadius _defaultRadius() {
    switch (variant) {
      case SkeletonVariant.avatar:
        return BorderRadius.circular(9999);
      case SkeletonVariant.text:
        return BorderRadius.circular(10);
      case SkeletonVariant.image:
        return BorderRadius.circular(12);
      case SkeletonVariant.card:
        return BorderRadius.circular(16);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Shimmer.fromColors(
      baseColor: const Color(0xFF1E1E1E),
      highlightColor: const Color(0xFF2A2A2A),
      child: Container(
        width: width,
        height: height ?? (variant == SkeletonVariant.text ? 14 : null),
        decoration: BoxDecoration(
          color: const Color(0xFF262626),
          borderRadius: borderRadius ?? _defaultRadius(),
        ),
      ),
    );
  }
}
