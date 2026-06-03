import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../contexts/theme_context.dart';
import '../router/app_router.dart';

/// Mirrors src/components/BottomNavigation.js
class BottomNavigation extends StatelessWidget {
  const BottomNavigation({super.key});

  @override
  Widget build(BuildContext context) {
    final isDarkMode = context.watch<ThemeNotifier>().isDarkMode;
    final location = GoRouterState.of(context).uri.path;

    final isHomeActive = location == AppRoutes.dashboard;
    final isPodActive = location == AppRoutes.pod;
    final isCommunityActive = location == AppRoutes.community;
    final isWellbeingActive = location == AppRoutes.wellbeing;

    return Material(
      color: isDarkMode ? Colors.black : Colors.white,
      child: SafeArea(
        top: false,
        minimum: const EdgeInsets.only(bottom: 12),
        child: Container(
          height: 56,
          decoration: BoxDecoration(
            color: isDarkMode ? AppColors.bottomNavDark : Colors.white,
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: isDarkMode ? 0.2 : 0.08),
                blurRadius: isDarkMode ? 8 : 6,
                offset: Offset(0, isDarkMode ? -2 : -1),
              ),
            ],
            border: Border(
              top: BorderSide(
                color: isDarkMode
                    ? Colors.white.withValues(alpha: 0.08)
                    : Colors.black.withValues(alpha: 0.05),
              ),
            ),
          ),
          child: Row(
            children: [
              _NavButton(
                onTap: () => context.go(AppRoutes.dashboard),
                child: _HomeNavIcon(active: isHomeActive, isDarkMode: isDarkMode),
              ),
              _NavButton(
                onTap: () => context.go(AppRoutes.wellbeing),
                child: _HeartNavIcon(active: isWellbeingActive, isDarkMode: isDarkMode),
              ),
              _NavButton(
                onTap: () => context.go(AppRoutes.pod),
                child: _NavRasterIcon(
                  asset: 'assets/icons/crew-icon.png',
                  size: 64,
                  active: isPodActive,
                  isDarkMode: isDarkMode,
                ),
              ),
              _NavButton(
                onTap: () => context.go(AppRoutes.community),
                child: _NavRasterIcon(
                  asset: 'assets/icons/Gemini_Generated_Image_enm22aenm22aenm2.png',
                  size: 48,
                  active: isCommunityActive,
                  isDarkMode: isDarkMode,
                  clipCircular: true,
                  activeScale: 1.08,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

Color _navStrokeColor(bool active, bool isDarkMode) {
  if (active) return isDarkMode ? Colors.white : Colors.black;
  return isDarkMode ? const Color(0xFF9CA3AF) : const Color(0xFF6B7280);
}

/// Home — outline when inactive, filled when active (React).
class _HomeNavIcon extends StatelessWidget {
  const _HomeNavIcon({required this.active, required this.isDarkMode});

  final bool active;
  final bool isDarkMode;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: active ? 1 : 0.4,
      child: Icon(
        active ? Icons.home_rounded : Icons.home_outlined,
        size: 28,
        color: _navStrokeColor(active, isDarkMode),
      ),
    );
  }
}

/// Heart — filled when active (React).
class _HeartNavIcon extends StatelessWidget {
  const _HeartNavIcon({required this.active, required this.isDarkMode});

  final bool active;
  final bool isDarkMode;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: active ? 1 : 0.4,
      child: Icon(
        active ? Icons.favorite : Icons.favorite_border,
        size: 28,
        color: _navStrokeColor(active, isDarkMode),
      ),
    );
  }
}

/// PNG nav icons — CSS filter parity:
/// - dark inactive: none (natural colors @ 0.4 opacity)
/// - dark active: brightness(0) + invert(1) → white
/// - light inactive: grayscale
/// - light active: brightness(0) → black
class _NavRasterIcon extends StatelessWidget {
  const _NavRasterIcon({
    required this.asset,
    required this.size,
    required this.active,
    required this.isDarkMode,
    this.clipCircular = false,
    this.activeScale = 1,
  });

  final String asset;
  final double size;
  final bool active;
  final bool isDarkMode;
  final bool clipCircular;
  final double activeScale;

  static const ColorFilter _brightnessZero = ColorFilter.matrix(<double>[
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, 0, 1, 0,
  ]);

  static const ColorFilter _invert = ColorFilter.matrix(<double>[
    -1, 0, 0, 0, 255,
    0, -1, 0, 0, 255,
    0, 0, -1, 0, 255,
    0, 0, 0, 1, 0,
  ]);

  static const ColorFilter _grayscale = ColorFilter.matrix(<double>[
    0.2126, 0.7152, 0.0722, 0, 0,
    0.2126, 0.7152, 0.0722, 0, 0,
    0.2126, 0.7152, 0.0722, 0, 0,
    0, 0, 0, 1, 0,
  ]);

  Widget _applyFilters(Widget child) {
    if (active && isDarkMode) {
      return ColorFiltered(
        colorFilter: _brightnessZero,
        child: ColorFiltered(colorFilter: _invert, child: child),
      );
    }
    if (active && !isDarkMode) {
      return ColorFiltered(colorFilter: _brightnessZero, child: child);
    }
    if (!active && !isDarkMode) {
      return ColorFiltered(colorFilter: _grayscale, child: child);
    }
    return child;
  }

  @override
  Widget build(BuildContext context) {
    final frameSize = clipCircular ? 56.0 : size;

    Widget image = Image.asset(
      asset,
      width: size,
      height: size,
      fit: BoxFit.contain,
      filterQuality: FilterQuality.high,
      gaplessPlayback: true,
      errorBuilder: (_, __, ___) => Icon(
        Icons.broken_image_outlined,
        size: size * 0.5,
        color: isDarkMode ? const Color(0xFF9CA3AF) : const Color(0xFF6B7280),
      ),
    );

    image = _applyFilters(image);
    image = Opacity(opacity: active ? 1 : 0.4, child: image);

    if (activeScale != 1 && active) {
      image = Transform.scale(scale: activeScale, child: image);
    }

    if (clipCircular) {
      image = SizedBox(
        width: frameSize,
        height: frameSize,
        child: Center(child: image),
      );
    }

    return SizedBox(
      width: frameSize,
      height: frameSize,
      child: Center(child: image),
    );
  }
}

class _NavButton extends StatelessWidget {
  const _NavButton({required this.onTap, required this.child});

  final VoidCallback onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          onTap: onTap,
          splashColor: Colors.transparent,
          highlightColor: Colors.transparent,
          hoverColor: Colors.transparent,
          child: Center(child: child),
        ),
      ),
    );
  }
}
