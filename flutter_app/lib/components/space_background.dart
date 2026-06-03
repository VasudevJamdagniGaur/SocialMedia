import 'dart:math';
import 'package:flutter/material.dart';

/// Mirrors src/components/SpaceBackground.js (simplified starfield + nebula).
class SpaceBackground extends StatelessWidget {
  const SpaceBackground({super.key, this.nebulaCenterY = 0.5});

  final double nebulaCenterY;

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final rng = Random(11);
    return Stack(
      children: [
        Positioned.fill(
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: RadialGradient(
                center: Alignment(0, nebulaCenterY * 2 - 1),
                radius: 0.8,
                colors: [
                  const Color(0xFF1a1033).withValues(alpha: 0.6),
                  const Color(0xFF030308),
                ],
              ),
            ),
          ),
        ),
        ...List.generate(120, (i) {
          final w = rng.nextDouble() * 2 + 0.5;
          return Positioned(
            left: rng.nextDouble() * size.width,
            top: rng.nextDouble() * size.height,
            child: Container(
              width: w,
              height: w,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: rng.nextDouble() * 0.6 + 0.2),
                shape: BoxShape.circle,
              ),
            ),
          );
        }),
      ],
    );
  }
}
