import 'package:flutter/material.dart';

import '../utils/hub_colors.dart';

/// LinkedIn / X / Reddit selector — matches Share Suggestions styling.
class SharePlatformSelector extends StatelessWidget {
  const SharePlatformSelector({
    super.key,
    required this.platform,
    required this.onChanged,
    this.compact = false,
    this.isDarkMode = true,
  });

  final String platform;
  final ValueChanged<String> onChanged;
  final bool compact;
  final bool isDarkMode;

  @override
  Widget build(BuildContext context) {
    final gap = compact ? 8.0 : 20.0;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        SharePlatformButton(
          id: 'linkedin',
          selected: platform == 'linkedin',
          compact: compact,
          isDarkMode: isDarkMode,
          onTap: () => onChanged('linkedin'),
          child: Text(
            'in',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.92),
              fontSize: compact ? 18 : 24,
              fontWeight: FontWeight.w600,
              height: 1,
            ),
          ),
        ),
        SizedBox(width: gap),
        SharePlatformButton(
          id: 'x',
          selected: platform == 'x',
          compact: compact,
          isDarkMode: isDarkMode,
          onTap: () => onChanged('x'),
          child: CustomPaint(
            size: Size(compact ? 14 : 18, compact ? 14 : 18),
            painter: ShareXLogoPainter(color: Colors.white.withValues(alpha: 0.92)),
          ),
        ),
        SizedBox(width: gap),
        SharePlatformButton(
          id: 'reddit',
          selected: platform == 'reddit',
          compact: compact,
          isDarkMode: isDarkMode,
          onTap: () => onChanged('reddit'),
          child: ColorFiltered(
            colorFilter: const ColorFilter.matrix([
              0.2126, 0.7152, 0.0722, 0, 0,
              0.2126, 0.7152, 0.0722, 0, 0,
              0.2126, 0.7152, 0.0722, 0, 0,
              0, 0, 0, 0.92, 0,
            ]),
            child: Image.asset(
              'assets/images/reddit-logo-mono.webp',
              width: compact ? 24 : 31,
              height: compact ? 24 : 31,
              fit: BoxFit.contain,
              errorBuilder: (_, __, ___) => Icon(
                Icons.forum,
                color: Colors.white.withValues(alpha: 0.85),
                size: compact ? 18 : 22,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class SharePlatformButton extends StatelessWidget {
  const SharePlatformButton({
    super.key,
    required this.id,
    required this.selected,
    required this.onTap,
    required this.child,
    this.compact = false,
    this.isDarkMode = true,
  });

  final String id;
  final bool selected;
  final VoidCallback onTap;
  final Widget child;
  final bool compact;
  final bool isDarkMode;

  @override
  Widget build(BuildContext context) {
    final size = compact ? 40.0 : 48.0;
    final radius = compact ? 12.0 : 16.0;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(radius),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          width: size,
          height: size,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: selected
                ? HubColors.accent.withValues(alpha: 0.16)
                : Colors.white.withValues(alpha: isDarkMode ? 0.04 : 0.8),
            borderRadius: BorderRadius.circular(radius),
            border: Border.all(
              color: selected
                  ? HubColors.accent
                  : Colors.white.withValues(alpha: isDarkMode ? 0.08 : 0.12),
              width: selected ? 2 : 1,
            ),
            boxShadow: selected
                ? [
                    BoxShadow(
                      color: HubColors.accent.withValues(alpha: 0.2),
                      blurRadius: 0,
                      spreadRadius: 2,
                    ),
                  ]
                : null,
          ),
          child: Opacity(opacity: selected ? 1 : 0.72, child: child),
        ),
      ),
    );
  }
}

class ShareXLogoPainter extends CustomPainter {
  ShareXLogoPainter({required this.color});

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = color;
    final scale = size.width / 24;
    final path = Path()
      ..moveTo(18.244 * scale, 2 * scale)
      ..lineTo(21.62 * scale, 2 * scale)
      ..lineTo(14.24 * scale, 10.436 * scale)
      ..lineTo(22.92 * scale, 22 * scale)
      ..lineTo(16.12 * scale, 22 * scale)
      ..lineTo(10.8 * scale, 15.04 * scale)
      ..lineTo(4.69 * scale, 22 * scale)
      ..lineTo(1.31 * scale, 22 * scale)
      ..lineTo(9.21 * scale, 12.96 * scale)
      ..lineTo(1.08 * scale, 2 * scale)
      ..lineTo(7.88 * scale, 2 * scale)
      ..lineTo(12.72 * scale, 8.26 * scale)
      ..lineTo(17.56 * scale, 2 * scale)
      ..close();
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant ShareXLogoPainter oldDelegate) => oldDelegate.color != color;
}

String sharePlatformLabel(String platform) {
  switch (platform.trim().toLowerCase()) {
    case 'linkedin':
      return 'LinkedIn';
    case 'x':
    case 'twitter':
      return 'X';
    case 'reddit':
      return 'Reddit';
    default:
      return platform;
  }
}
