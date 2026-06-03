import 'package:flutter/material.dart';
import 'skeleton.dart';

import 'list_skeleton.dart';

class ProfileSkeleton extends StatelessWidget {
  const ProfileSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF131314),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 8),
              Row(
                children: const [
                  Skeleton(variant: SkeletonVariant.avatar, width: 40, height: 40),
                  SizedBox(width: 12),
                  Skeleton(variant: SkeletonVariant.text, height: 20, width: 112),
                ],
              ),
              const SizedBox(height: 24),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: const Color(0xFF262626),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: Colors.white10),
                ),
                child: Column(
                  children: const [
                    Skeleton(variant: SkeletonVariant.avatar, width: 80, height: 80),
                    SizedBox(height: 12),
                    Skeleton(variant: SkeletonVariant.text, height: 24, width: 160),
                    SizedBox(height: 8),
                    Skeleton(variant: SkeletonVariant.text, height: 16, width: 96),
                    SizedBox(height: 16),
                    Skeleton(variant: SkeletonVariant.card, height: 36, width: 112),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              const Skeleton(variant: SkeletonVariant.text, height: 16, width: 112),
              const SizedBox(height: 12),
              Expanded(child: ListSkeleton(count: 3)),
            ],
          ),
        ),
      ),
    );
  }
}
