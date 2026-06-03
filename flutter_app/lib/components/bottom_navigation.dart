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
                active: isHomeActive,
                isDarkMode: isDarkMode,
                onTap: () => context.go(AppRoutes.dashboard),
                child: Icon(
                  Icons.home_outlined,
                  size: 28,
                  color: isHomeActive
                      ? (isDarkMode ? Colors.white : Colors.black)
                      : (isDarkMode ? const Color(0xFF9CA3AF) : const Color(0xFF6B7280)),
                ),
              ),
              _NavButton(
                active: isWellbeingActive,
                isDarkMode: isDarkMode,
                onTap: () => context.go(AppRoutes.wellbeing),
                child: Icon(
                  isWellbeingActive ? Icons.favorite : Icons.favorite_border,
                  size: 28,
                  color: isWellbeingActive
                      ? (isDarkMode ? Colors.white : Colors.black)
                      : (isDarkMode ? const Color(0xFF9CA3AF) : const Color(0xFF6B7280)),
                ),
              ),
              _NavButton(
                active: isPodActive,
                isDarkMode: isDarkMode,
                onTap: () => context.go(AppRoutes.pod),
                child: _NavRasterIcon(
                  asset: 'assets/icons/crew-icon.png',
                  size: 64,
                  active: isPodActive,
                  isDarkMode: isDarkMode,
                ),
              ),
              _NavButton(
                active: isCommunityActive,
                isDarkMode: isDarkMode,
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

/// PNG nav icons — matches React CSS filters (brightness/invert), not [ColorFiltered] tint.
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

  /// CSS brightness(0) — forces icon to black (hides light PNG backgrounds on dark bar).
  static const ColorFilter _brightnessZero = ColorFilter.matrix(<double>[
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, 0, 1, 0,
  ]);

  /// CSS brightness(0) saturate(0) — grayscale when inactive in light mode.
  static const ColorFilter _grayscale = ColorFilter.matrix(<double>[
    0.2126, 0.7152, 0.0722, 0, 0,
    0.2126, 0.7152, 0.0722, 0, 0,
    0.2126, 0.7152, 0.0722, 0, 0,
    0, 0, 0, 1, 0,
  ]);

  ColorFilter? _filterForState() {
    if (!active && !isDarkMode) return _grayscale;
    return _brightnessZero;
  }

  bool get _needsWhiteTint => active && isDarkMode;

  @override
  Widget build(BuildContext context) {
    final filter = _filterForState();
    final frameSize = clipCircular ? 56.0 : size;

    Widget image = Image.asset(
      asset,
      width: size,
      height: size,
      fit: BoxFit.contain,
      filterQuality: FilterQuality.medium,
      gaplessPlayback: true,
    );

    if (filter != null) {
      image = ColorFiltered(colorFilter: filter, child: image);
    }
    if (_needsWhiteTint) {
      image = ColorFiltered(
        colorFilter: const ColorFilter.mode(Colors.white, BlendMode.srcIn),
        child: image,
      );
    }

    image = Opacity(opacity: active ? 1 : 0.4, child: image);

    if (activeScale != 1 && active) {
      image = Transform.scale(scale: activeScale, child: image);
    }

    if (clipCircular) {
      image = ClipOval(
        child: SizedBox(
          width: frameSize,
          height: frameSize,
          child: Center(child: image),
        ),
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
  const _NavButton({
    required this.active,
    required this.isDarkMode,
    required this.onTap,
    required this.child,
  });

  final bool active;
  final bool isDarkMode;
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
