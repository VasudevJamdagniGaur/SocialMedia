import 'dart:async';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../router/app_router.dart';
import '../services/auth_service.dart';

/// Brief splash — navigation is handled by GoRouter redirect + backup below.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> with SingleTickerProviderStateMixin {
  StreamSubscription? _authSub;
  Timer? _fallbackTimer;
  bool _hasNavigated = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _navigateOnce());
    _authSub = AuthService.instance.onAuthStateChange().listen((_) {
      if (mounted) _navigateOnce();
    });
    _fallbackTimer = Timer(const Duration(milliseconds: 1200), () {
      if (mounted) _navigateOnce();
    });
  }

  void _navigateOnce() {
    if (_hasNavigated || !mounted) return;
    final location = GoRouter.of(context).state.uri.path;
    if (location != AppRoutes.splash) {
      _hasNavigated = true;
      return;
    }

    _hasNavigated = true;
    _fallbackTimer?.cancel();
    final hasUser = AuthService.instance.getCurrentUser() != null;
    context.go(hasUser ? AppRoutes.dashboard : AppRoutes.signup);
  }

  @override
  void dispose() {
    _fallbackTimer?.cancel();
    _authSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F0F0F),
      body: Stack(
        children: [
          const _SplashDecorations(),
          Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 96,
                  height: 96,
                  decoration: BoxDecoration(
                    color: const Color(0xFF121212),
                    shape: BoxShape.circle,
                    border: Border.all(color: const Color(0xFFA855F7).withValues(alpha: 0.3)),
                    boxShadow: [
                      BoxShadow(color: const Color(0xFFC084FC).withValues(alpha: 0.35), blurRadius: 24),
                      BoxShadow(color: const Color(0xFF7E22CE).withValues(alpha: 0.4), blurRadius: 20, offset: const Offset(0, 4)),
                    ],
                  ),
                  child: ClipOval(
                    child: Image.asset(
                      'assets/images/DEITECIrc-192.webp',
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => const Icon(Icons.psychology, color: Color(0xFFA855F7), size: 48),
                    ),
                  ),
                ),
                const SizedBox(height: 32),
                Container(
                  width: 32,
                  height: 4,
                  decoration: BoxDecoration(
                    color: const Color(0xFF7E22CE).withValues(alpha: 0.25),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: const _PulseBar(),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _PulseBar extends StatefulWidget {
  const _PulseBar();

  @override
  State<_PulseBar> createState() => _PulseBarState();
}

class _PulseBarState extends State<_PulseBar> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 1500))..repeat(reverse: true);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: Tween<double>(begin: 0.4, end: 1).animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut)),
      child: Container(
        decoration: BoxDecoration(color: const Color(0xFFA855F7), borderRadius: BorderRadius.circular(999)),
      ),
    );
  }
}

class _SplashDecorations extends StatelessWidget {
  const _SplashDecorations();

  @override
  Widget build(BuildContext context) {
    final rng = Random(42);
    return Stack(
      children: [
        ...List.generate(5, (i) {
          final colors = [const Color(0xFF81C995), const Color(0xFFFDD663), const Color(0xFF8AB4F8)];
          return Positioned(
            left: rng.nextDouble() * MediaQuery.sizeOf(context).width,
            top: rng.nextDouble() * MediaQuery.sizeOf(context).height * 0.8,
            child: Icon(
              i.isEven ? LucideIcons.heart : LucideIcons.star,
              size: 12 + rng.nextDouble() * 8,
              color: colors[i % 3].withValues(alpha: 0.15 + rng.nextDouble() * 0.1),
            ),
          );
        }),
      ],
    );
  }
}
