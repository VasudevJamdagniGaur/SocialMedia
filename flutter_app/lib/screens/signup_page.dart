import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../contexts/theme_context.dart';
import '../router/app_router.dart';
import '../services/auth_service.dart';

const _kDeitecLogo = 'assets/icons/Gemini_Generated_Image_enm22aenm22aenm2.png';
const _kSignupBackground = Color(0xFF030308);

class SignupPage extends StatefulWidget {
  const SignupPage({super.key});

  @override
  State<SignupPage> createState() => _SignupPageState();
}

class _SignupPageState extends State<SignupPage> with SingleTickerProviderStateMixin {
  StreamSubscription<User?>? _authSub;
  bool _isLoaded = false;
  bool _googleLoading = false;

  late final AnimationController _fadeController;

  @override
  void initState() {
    super.initState();
    _fadeController = AnimationController(vsync: this, duration: const Duration(milliseconds: 700));
    _authSub = AuthService().onAuthStateChange().listen((user) {
      if (user != null && mounted) {
        context.go(AppRoutes.dashboard);
      }
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      setState(() => _isLoaded = true);
      _fadeController.forward();
    });
  }

  @override
  void dispose() {
    _authSub?.cancel();
    _fadeController.dispose();
    super.dispose();
  }

  Future<void> _handleGoogleSignIn() async {
    if (_googleLoading) return;
    setState(() => _googleLoading = true);
    try {
      final result = await AuthService().signInWithGoogle();
      if (!mounted) return;
      if (result.success) {
        context.go(AppRoutes.dashboard);
        return;
      }
      _showAlert(result.error ?? 'Sign-in failed. Please try again.');
    } catch (err) {
      debugPrint('Google sign-in error: $err');
      if (mounted) {
        _showAlert(err.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _googleLoading = false);
    }
  }

  void _showAlert(String message) {
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Sign-in'),
        content: Text(message),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('OK')),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    context.watch<ThemeNotifier>();
    final bottomInset = MediaQuery.paddingOf(context).bottom;

    return Scaffold(
      backgroundColor: _kSignupBackground,
      body: AnimatedOpacity(
        opacity: _isLoaded ? 1 : 0,
        duration: const Duration(milliseconds: 700),
        child: Stack(
          fit: StackFit.expand,
          children: [
            const _SignupSpaceBackground(nebulaCenterY: 0.38),
            Column(
              children: [
                Expanded(
                  flex: 11,
                  child: Center(
                    child: AnimatedScale(
                      scale: _isLoaded ? 1 : 0.9,
                      duration: const Duration(milliseconds: 1000),
                      curve: Curves.easeOut,
                      child: AnimatedOpacity(
                        opacity: _isLoaded ? 1 : 0,
                        duration: const Duration(milliseconds: 1000),
                        child: Container(
                          width: 124.8,
                          height: 124.8,
                          decoration: BoxDecoration(
                            color: const Color(0xFF121212),
                            shape: BoxShape.circle,
                            border: Border.all(color: const Color(0x4DA855F7)),
                            boxShadow: const [
                              BoxShadow(color: Color(0x59C084FC), blurRadius: 24),
                              BoxShadow(color: Color(0x667E22CE), blurRadius: 20, offset: Offset(0, 4)),
                            ],
                          ),
                          child: ClipOval(
                            child: Image.asset(
                              _kDeitecLogo,
                              fit: BoxFit.cover,
                              errorBuilder: (_, __, ___) =>
                                  const Icon(Icons.spa, color: AppColors.accentPurple, size: 56),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                AnimatedSlide(
                  offset: _isLoaded ? Offset.zero : const Offset(0, 0.06),
                  duration: const Duration(milliseconds: 700),
                  curve: Curves.easeOut,
                  child: AnimatedOpacity(
                    opacity: _isLoaded ? 1 : 0,
                    duration: const Duration(milliseconds: 700),
                    child: Padding(
                      padding: EdgeInsets.fromLTRB(24, 0, 24, bottomInset > 0 ? bottomInset : 28),
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 400, minHeight: 200),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.end,
                          children: [
                            SizedBox(
                              width: double.infinity,
                              height: 52,
                              child: ElevatedButton(
                                onPressed: _googleLoading ? null : _handleGoogleSignIn,
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: Colors.white,
                                  foregroundColor: const Color(0xFF0F172A),
                                  disabledBackgroundColor: Colors.white.withValues(alpha: 0.7),
                                  elevation: 4,
                                  shadowColor: Colors.black.withValues(alpha: 0.25),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(999),
                                  ),
                                ),
                                child: _googleLoading
                                    ? const Text(
                                        'Signing in…',
                                        style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                                      )
                                    : Row(
                                        mainAxisAlignment: MainAxisAlignment.center,
                                        children: const [
                                          _GoogleLogo(size: 20),
                                          SizedBox(width: 12),
                                          Text(
                                            'Continue with Google',
                                            style: TextStyle(
                                              fontSize: 15,
                                              fontWeight: FontWeight.w600,
                                              letterSpacing: -0.2,
                                            ),
                                          ),
                                        ],
                                      ),
                              ),
                            ),
                            const SizedBox(height: 20),
                            TextButton(
                              onPressed: () => context.go(AppRoutes.login),
                              style: TextButton.styleFrom(
                                foregroundColor: Colors.white.withValues(alpha: 0.95),
                              ),
                              child: const Text(
                                'Log in with email and password',
                                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _GoogleLogo extends StatelessWidget {
  const _GoogleLogo({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(painter: _GoogleLogoPainter()),
    );
  }
}

class _GoogleLogoPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.width / 24;
    canvas.scale(scale);
    canvas.drawPath(
      Path()
        ..moveTo(22.56, 12.25)
        ..cubicTo(22.56, 11.47, 22.49, 10.72, 22.36, 10)
        ..lineTo(12, 10)
        ..lineTo(12, 14.26)
        ..lineTo(17.92, 14.26)
        ..cubicTo(17.66, 15.63, 16.88, 16.79, 15.71, 17.57)
        ..lineTo(15.71, 20.34)
        ..lineTo(19.28, 20.34)
        ..cubicTo(21.36, 18.42, 22.56, 15.6, 22.56, 12.25),
      Paint()..color = const Color(0xFF4285F4),
    );
    canvas.drawPath(
      Path()
        ..moveTo(12, 23)
        ..cubicTo(14.97, 23, 17.46, 22.02, 19.28, 20.34)
        ..lineTo(15.71, 17.57)
        ..cubicTo(14.73, 18.23, 13.48, 18.63, 12, 18.63)
        ..cubicTo(9.14, 18.63, 6.71, 16.7, 5.84, 14.09)
        ..lineTo(2.18, 14.09)
        ..lineTo(2.18, 16.93)
        ..cubicTo(3.99, 20.53, 7.7, 23, 12, 23),
      Paint()..color = const Color(0xFF34A853),
    );
    canvas.drawPath(
      Path()
        ..moveTo(5.84, 14.09)
        ..cubicTo(5.62, 13.43, 5.49, 12.73, 5.49, 12)
        ..cubicTo(5.49, 11.27, 5.62, 10.57, 5.84, 9.91)
        ..lineTo(5.84, 7.07)
        ..lineTo(2.18, 7.07)
        ..cubicTo(1.43, 8.55, 1, 10.22, 1, 12)
        ..cubicTo(1, 13.78, 1.43, 15.45, 2.18, 16.93)
        ..lineTo(5.84, 14.09),
      Paint()..color = const Color(0xFFFBBC05),
    );
    canvas.drawPath(
      Path()
        ..moveTo(12, 5.38)
        ..cubicTo(13.62, 5.38, 15.06, 5.94, 16.21, 7.02)
        ..lineTo(19.36, 3.87)
        ..cubicTo(17.45, 2.09, 14.97, 1, 12, 1)
        ..cubicTo(7.7, 1, 3.99, 3.47, 2.18, 7.07)
        ..lineTo(5.84, 9.91)
        ..cubicTo(6.71, 7.31, 9.14, 5.38, 12, 5.38),
      Paint()..color = const Color(0xFFEA4335),
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _SignupSpaceBackground extends StatefulWidget {
  const _SignupSpaceBackground({required this.nebulaCenterY});

  final double nebulaCenterY;

  @override
  State<_SignupSpaceBackground> createState() => _SignupSpaceBackgroundState();
}

class _SignupSpaceBackgroundState extends State<_SignupSpaceBackground>
    with SingleTickerProviderStateMixin {
  late final AnimationController _twinkleController;
  late final List<_StarData> _stars;

  @override
  void initState() {
    super.initState();
    _twinkleController = AnimationController(vsync: this, duration: const Duration(seconds: 4))
      ..repeat(reverse: true);
    _stars = List.generate(140, (i) {
      return _StarData(
        left: (i * 17.3) % 100 / 100,
        top: (i * 23.7 + 11) % 100 / 100,
        size: (i % 5 == 0 ? 2.5 : i % 3 == 0 ? 1.5 : 1.0) + (i % 2) * 0.5,
        opacity: 0.35 + (i % 7) * 0.08,
        delay: (i % 11) * 0.4,
        duration: 3 + (i % 5),
      );
    });
  }

  @override
  void dispose() {
    _twinkleController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final nebulaTop = size.height * widget.nebulaCenterY;

    return IgnorePointer(
      child: Stack(
        fit: StackFit.expand,
        children: [
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: RadialGradient(
                center: Alignment(0, -0.3),
                radius: 1.2,
                colors: [Color(0xFF0D1228), Color(0xFF06060F), Color(0xFF020205)],
                stops: [0.0, 0.45, 1.0],
              ),
            ),
          ),
          AnimatedBuilder(
            animation: _twinkleController,
            builder: (context, _) {
              return Stack(
                children: _stars.map((star) {
                  final phase = ((_twinkleController.value + star.delay / star.duration) % 1.0);
                  final twinkle = 0.25 + 0.75 * (phase < 0.5 ? phase * 2 : (1 - phase) * 2);
                  return Positioned(
                    left: star.left * size.width,
                    top: star.top * size.height,
                    child: Container(
                      width: star.size,
                      height: star.size,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: Colors.white.withValues(alpha: star.opacity * twinkle),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.white.withValues(alpha: 0.5),
                            blurRadius: star.size * 2,
                          ),
                        ],
                      ),
                    ),
                  );
                }).toList(),
              );
            },
          ),
          Positioned(
            left: size.width * 0.5 - (size.width * 0.92).clamp(0, 420) / 2,
            top: nebulaTop - (size.width * 0.92).clamp(0, 420) / 2,
            child: Container(
              width: (size.width * 0.92).clamp(0, 420),
              height: (size.width * 0.92).clamp(0, 420),
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [Color(0x3856BDF8), Color(0x2E581C87), Color(0x1E1E0A3C), Colors.transparent],
                  stops: [0.0, 0.28, 0.48, 0.72],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _StarData {
  const _StarData({
    required this.left,
    required this.top,
    required this.size,
    required this.opacity,
    required this.delay,
    required this.duration,
  });

  final double left;
  final double top;
  final double size;
  final double opacity;
  final double delay;
  final int duration;
}
