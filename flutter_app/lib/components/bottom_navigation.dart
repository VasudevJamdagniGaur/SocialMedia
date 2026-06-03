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
                child: Opacity(
                  opacity: isPodActive ? 1 : 0.4,
                  child: ColorFiltered(
                    colorFilter: ColorFilter.mode(
                      isPodActive
                          ? (isDarkMode ? Colors.white : Colors.black)
                          : (isDarkMode ? Colors.white54 : Colors.grey),
                      isPodActive ? BlendMode.srcIn : BlendMode.saturation,
                    ),
                    child: Image.asset('assets/icons/crew-icon.png', width: 64, height: 64),
                  ),
                ),
              ),
              _NavButton(
                active: isCommunityActive,
                isDarkMode: isDarkMode,
                onTap: () => context.go(AppRoutes.community),
                child: Opacity(
                  opacity: isCommunityActive ? 1 : 0.4,
                  child: Transform.scale(
                    scale: isCommunityActive ? 1.08 : 1,
                    child: ColorFiltered(
                      colorFilter: ColorFilter.mode(
                        isCommunityActive
                            ? (isDarkMode ? Colors.white : Colors.black)
                            : (isDarkMode ? Colors.white54 : Colors.grey),
                        isCommunityActive ? BlendMode.srcIn : BlendMode.saturation,
                      ),
                      child: Image.asset(
                        'assets/icons/Gemini_Generated_Image_enm22aenm22aenm2.png',
                        width: 48,
                        height: 48,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
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
      child: InkWell(
        onTap: onTap,
        child: Center(child: child),
      ),
    );
  }
}
