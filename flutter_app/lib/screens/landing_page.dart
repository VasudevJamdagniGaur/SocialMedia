import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../router/app_router.dart';
import '../services/auth_service.dart';
import '../components/space_background.dart';

/// Mirrors src/components/LandingPage.js
class LandingPage extends StatefulWidget {
  const LandingPage({super.key});

  @override
  State<LandingPage> createState() => _LandingPageState();
}

class _LandingPageState extends State<LandingPage> {
  StreamSubscription? _authSub;

  @override
  void initState() {
    super.initState();
    if (AuthService.instance.getCurrentUser() != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) context.go(AppRoutes.dashboard);
      });
    }
    _authSub = AuthService.instance.onAuthStateChange().listen((user) {
      if (user != null && mounted) context.go(AppRoutes.dashboard);
    });
  }

  @override
  void dispose() {
    _authSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF030308),
      body: Stack(
        children: [
          const SpaceBackground(nebulaCenterY: 0.42),
          Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
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
                      child: Image.asset('assets/images/DEITECIrc.webp', fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => const Icon(Icons.psychology, color: Color(0xFFA855F7), size: 48)),
                    ),
                  ),
                  const SizedBox(height: 32),
                  const Text('Detea', style: TextStyle(color: Colors.white, fontSize: 36, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 16),
                  const Text('Your Social Tea', style: TextStyle(color: Color(0xFFD1D5DB), fontSize: 18)),
                  const SizedBox(height: 48),
                  FilledButton(
                    onPressed: () => context.go(AppRoutes.signup),
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFFA855F7),
                      padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(999),
                        side: BorderSide(color: const Color(0xFFA855F7).withValues(alpha: 0.5)),
                      ),
                      elevation: 8,
                      shadowColor: const Color(0xFF7E22CE).withValues(alpha: 0.4),
                    ),
                    child: const Text('Get Started', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 16)),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
