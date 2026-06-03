import 'package:flutter/material.dart';
import 'skeleton.dart';

class CardSkeleton extends StatelessWidget {
  const CardSkeleton({super.key, this.count = 4});

  final int count;

  @override
  Widget build(BuildContext context) {
    final n = count.clamp(1, 6);
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: List.generate(n, (idx) {
          return Container(
            width: 260,
            height: 200,
            margin: EdgeInsets.only(right: idx == n - 1 ? 16 : 12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: const Color(0xFF1E1E1E)),
            ),
            clipBehavior: Clip.antiAlias,
            child: Stack(
              fit: StackFit.expand,
              children: [
                const Skeleton(variant: SkeletonVariant.image),
                Positioned(
                  left: 12,
                  right: 12,
                  bottom: 12,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: const [
                      Skeleton(variant: SkeletonVariant.text, height: 16, width: 220),
                      SizedBox(height: 8),
                      Skeleton(variant: SkeletonVariant.text, height: 16, width: 190),
                      SizedBox(height: 8),
                      Skeleton(variant: SkeletonVariant.text, height: 12, width: 96),
                    ],
                  ),
                ),
              ],
            ),
          );
        }),
      ),
    );
  }
}
