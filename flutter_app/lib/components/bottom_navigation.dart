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
    final isTeaActive = location == AppRoutes.pod;
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
                  asset: 'assets/icons/tea-nav-inactive.webp',
                  activeAsset: 'assets/icons/tea-nav-active.webp',
                  size: 48,
                  active: isTeaActive,
                  isDarkMode: isDarkMode,
                  frameSize: 56,
                  activeScale: 1.08,
                ),
              ),
              _NavButton(
                onTap: () => context.go(AppRoutes.community),
                child: _NavRasterIcon(
                  asset: 'assets/icons/Gemini_Generated_Image_enm22aenm22aenm2.png',
                  size: 48,
                  active: isCommunityActive,
                  isDarkMode: isDarkMode,
                  frameSize: 56,
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

/// PNG nav icons — mirrors React `BottomNavigation.js` filters.
///
/// Dark inactive: no filter, 40% opacity (original artwork).
/// Dark active: tint to solid white (React `brightness(0) invert(1)` look).
/// Light inactive: grayscale. Light active: black silhouette.
class _NavRasterIcon extends StatelessWidget {
  const _NavRasterIcon({
    required this.asset,
    required this.size,
    required this.active,
    required this.isDarkMode,
    this.activeAsset,
    this.frameSize,
    this.activeScale = 1,
  });

  final String asset;
  /// When set, used instead of [asset] while [active] is true (pre-rendered states).
  final String? activeAsset;
  final double size;
  final bool active;
  final bool isDarkMode;
  /// Optional square frame (React `w-14` community wrapper).
  final double? frameSize;
  final double activeScale;

  bool get _usesDualAssets => activeAsset != null;

  static const ColorFilter _brightnessZero = ColorFilter.matrix(<double>[
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, 0, 1, 0,
  ]);

  static const ColorFilter _grayscale = ColorFilter.matrix(<double>[
    0.2126, 0.7152, 0.0722, 0, 0,
    0.2126, 0.7152, 0.0722, 0, 0,
    0.2126, 0.7152, 0.0722, 0, 0,
    0, 0, 0, 1, 0,
  ]);

  static const ColorFilter _solidWhite = ColorFilter.mode(
    Colors.white,
    BlendMode.srcIn,
  );

  Widget _applyFilters(Widget child) {
    if (_usesDualAssets) {
      return child;
    }
    if (isDarkMode) {
      if (active) {
        // Selected: same artwork, forced to solid white (React active look).
        return ColorFiltered(colorFilter: _solidWhite, child: child);
      }
      return child;
    }
    if (active) {
      return ColorFiltered(colorFilter: _brightnessZero, child: child);
    }
    return ColorFiltered(colorFilter: _grayscale, child: child);
  }

  @override
  Widget build(BuildContext context) {
    final dpr = MediaQuery.devicePixelRatioOf(context);
    final cachePx = (size * dpr).round().clamp(48, 256);

    Widget image = Image.asset(
      active && activeAsset != null ? activeAsset! : asset,
      width: size,
      height: size,
      fit: BoxFit.contain,
      filterQuality: FilterQuality.none,
      cacheWidth: cachePx,
      cacheHeight: cachePx,
      gaplessPlayback: true,
      errorBuilder: (_, __, ___) => Icon(
        Icons.broken_image_outlined,
        size: size * 0.5,
        color: isDarkMode ? const Color(0xFF9CA3AF) : const Color(0xFF6B7280),
      ),
    );

    image = _applyFilters(image);
    if (!_usesDualAssets) {
      image = Opacity(opacity: active ? 1 : 0.4, child: image);
    }

    if (activeScale != 1 && active) {
      image = Transform.scale(scale: activeScale, child: image);
    }

    final outer = frameSize ?? size;
    return SizedBox(
      width: outer,
      height: outer,
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
