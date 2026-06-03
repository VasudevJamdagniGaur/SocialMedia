import 'package:flutter/material.dart';
import 'skeleton.dart';

class FeedSkeleton extends StatelessWidget {
  const FeedSkeleton({super.key, this.count = 4});

  final int count;

  @override
  Widget build(BuildContext context) {
    final n = count.clamp(3, 6);
    return Column(
      children: List.generate(n, (idx) {
        return Container(
          margin: const EdgeInsets.only(bottom: 16),
          decoration: BoxDecoration(
            color: const Color(0xFF0F0F0F),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFF1E1E1E)),
          ),
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: const [
                  Skeleton(variant: SkeletonVariant.avatar, width: 40, height: 40),
                  SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Skeleton(variant: SkeletonVariant.text, height: 12, width: 128),
                        SizedBox(height: 8),
                        Skeleton(variant: SkeletonVariant.text, height: 12, width: 80),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              const Skeleton(variant: SkeletonVariant.text, height: 12, width: double.infinity),
              const SizedBox(height: 8),
              const Skeleton(variant: SkeletonVariant.text, height: 12, width: double.infinity),
              const SizedBox(height: 8),
              const Skeleton(variant: SkeletonVariant.text, height: 12, width: 220),
              const SizedBox(height: 16),
              const Skeleton(variant: SkeletonVariant.image, height: 160, width: double.infinity),
            ],
          ),
        );
      }),
    );
  }
}
