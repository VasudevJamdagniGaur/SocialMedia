import 'package:flutter/material.dart';
import 'skeleton.dart';

class ListSkeleton extends StatelessWidget {
  const ListSkeleton({super.key, this.count = 5});

  final int count;

  @override
  Widget build(BuildContext context) {
    final n = count.clamp(3, 6);
    return Column(
      children: List.generate(n, (_) {
        return Container(
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFF0F0F0F),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFF1E1E1E)),
          ),
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
                        Skeleton(variant: SkeletonVariant.text, height: 16, width: 160),
                        SizedBox(height: 8),
                        Skeleton(variant: SkeletonVariant.text, height: 12, width: 90),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              const Skeleton(variant: SkeletonVariant.text, height: 12, width: double.infinity),
              const SizedBox(height: 8),
              const Skeleton(variant: SkeletonVariant.text, height: 12, width: double.infinity),
            ],
          ),
        );
      }),
    );
  }
}
