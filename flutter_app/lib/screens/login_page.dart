import 'dart:async';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../router/app_router.dart';
import '../services/auth_service.dart';

/// Mirrors src/components/LoginPage.js
class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _forgotEmailController = TextEditingController();

  bool _isLoaded = false;
  bool _isSubmitting = false;
  String _error = '';
  bool _showForgotPassword = false;
  bool _forgotSent = false;
  StreamSubscription? _authSub;

  @override
  void initState() {
    super.initState();
    _authSub = AuthService.instance.onAuthStateChange().listen((user) {
      if (user != null && mounted) context.go(AppRoutes.dashboard);
    });
    Future.microtask(() => setState(() => _isLoaded = true));
  }

  @override
  void dispose() {
    _authSub?.cancel();
    _emailController.dispose();
    _passwordController.dispose();
    _forgotEmailController.dispose();
    super.dispose();
  }

  Future<void> _handleLogin() async {
    setState(() => _error = '');
    final email = _emailController.text.trim();
    final password = _passwordController.text;
    if (email.isEmpty || password.isEmpty) {
      setState(() => _error = 'Please enter your email and password.');
      return;
    }
    setState(() => _isSubmitting = true);
    try {
      final result = await AuthService.instance.signInUser(email, password);
      if (result.success && mounted) {
        context.go(AppRoutes.dashboard);
        return;
      }
      final code = result.user?['errorCode'] as String?;
      if (code == 'invalid-credential' || code == 'wrong-password') {
        setState(() => _error = 'Invalid email or password. Please try again.');
      } else {
        setState(() => _error = result.error ?? 'Sign in failed. Please try again.');
      }
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _handleForgotPassword() async {
    setState(() => _error = '');
    final email = _forgotEmailController.text.trim();
    if (email.isEmpty) {
      setState(() => _error = 'Please enter your email address.');
      return;
    }
    setState(() => _isSubmitting = true);
    try {
      final result = await AuthService.instance.sendPasswordReset(email);
      if (result.success) {
        setState(() => _forgotSent = true);
      } else {
        setState(() => _error = result.error ?? 'Failed to send reset email.');
      }
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  InputDecoration _inputDecoration(String hint) => InputDecoration(
        hintText: hint,
        hintStyle: const TextStyle(color: Color(0xFF6B7280)),
        filled: true,
        fillColor: Colors.white.withValues(alpha: 0.06),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.1)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.1)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFF8AB4F8)),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      );

  @override
  Widget build(BuildContext context) {
    return AnimatedOpacity(
      opacity: _isLoaded ? 1 : 0,
      duration: const Duration(milliseconds: 1000),
      child: Scaffold(
        body: Container(
          decoration: const BoxDecoration(
            gradient: RadialGradient(
              center: Alignment(0, 1),
              radius: 1.2,
              colors: [Color(0xFF1B2735), Color(0xFF090A0F)],
            ),
          ),
          child: Stack(
            children: [
              const _StarField(count: 80),
              SafeArea(
                child: Center(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 400),
                      child: Column(
                        children: [
                          Container(
                            width: 72,
                            height: 72,
                            decoration: BoxDecoration(
                              color: const Color(0xFF262626),
                              shape: BoxShape.circle,
                              border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
                            ),
                            child: ClipOval(
                              child: Image.asset(
                                'assets/images/DEITECIrc-192.webp',
                                fit: BoxFit.cover,
                                errorBuilder: (_, __, ___) =>
                                    const Icon(Icons.psychology, color: Color(0xFFA855F7), size: 36),
                              ),
                            ),
                          ),
                          const SizedBox(height: 32),
                          const Text('Log in', style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w600)),
                          const SizedBox(height: 4),
                          const Text('Use your email and password', style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 14)),
                          const SizedBox(height: 24),
                          if (_showForgotPassword) _buildForgotForm() else _buildLoginForm(),
                          const SizedBox(height: 24),
                          if (!_showForgotPassword)
                            TextButton(
                              onPressed: () => context.go(AppRoutes.signup),
                              child: const Text('Back to sign up', style: TextStyle(color: Color(0xFF8AB4F8))),
                            ),
                        ],
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

  Widget _buildLoginForm() {
    return Column(
      children: [
        TextField(
          controller: _emailController,
          keyboardType: TextInputType.emailAddress,
          style: const TextStyle(color: Colors.white),
          decoration: _inputDecoration('Email'),
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _passwordController,
          obscureText: true,
          style: const TextStyle(color: Colors.white),
          decoration: _inputDecoration('Password'),
        ),
        if (_error.isNotEmpty) ...[
          const SizedBox(height: 12),
          Text(_error, style: const TextStyle(color: Color(0xFFF87171), fontSize: 14)),
        ],
        const SizedBox(height: 16),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: _isSubmitting ? null : _handleLogin,
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFF8AB4F8),
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            child: Text(_isSubmitting ? 'Signing in…' : 'Log in', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w500)),
          ),
        ),
        TextButton(
          onPressed: () => setState(() { _showForgotPassword = true; _error = ''; }),
          child: const Text('Forgot password?', style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 14)),
        ),
      ],
    );
  }

  Widget _buildForgotForm() {
    if (_forgotSent) {
      return Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          children: [
            const Text(
              'Check your email for a link to reset your password.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white, fontSize: 14),
            ),
            const SizedBox(height: 12),
            TextButton(
              onPressed: () => setState(() {
                _showForgotPassword = false;
                _forgotSent = false;
                _forgotEmailController.clear();
              }),
              child: const Text('Back to log in', style: TextStyle(color: Color(0xFF8AB4F8))),
            ),
          ],
        ),
      );
    }
    return Column(
      children: [
        TextField(
          controller: _forgotEmailController,
          keyboardType: TextInputType.emailAddress,
          style: const TextStyle(color: Colors.white),
          decoration: _inputDecoration('Email'),
        ),
        if (_error.isNotEmpty) ...[
          const SizedBox(height: 12),
          Text(_error, style: const TextStyle(color: Color(0xFFF87171), fontSize: 14)),
        ],
        const SizedBox(height: 16),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: _isSubmitting ? null : _handleForgotPassword,
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFF8AB4F8),
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            child: Text(_isSubmitting ? 'Sending…' : 'Send reset link', style: const TextStyle(color: Colors.white)),
          ),
        ),
        TextButton(
          onPressed: () => setState(() { _showForgotPassword = false; _error = ''; }),
          child: const Text('Back to log in', style: TextStyle(color: Color(0xFF9CA3AF))),
        ),
      ],
    );
  }
}

class _StarField extends StatelessWidget {
  const _StarField({required this.count});
  final int count;

  @override
  Widget build(BuildContext context) {
    final rng = Random(7);
    final size = MediaQuery.sizeOf(context);
    return Stack(
      children: List.generate(count, (i) {
        final w = rng.nextDouble() * 3 + 1;
        return Positioned(
          left: rng.nextDouble() * size.width,
          top: rng.nextDouble() * size.height,
          child: Container(
            width: w,
            height: w,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: rng.nextDouble() * 0.7 + 0.3),
              shape: BoxShape.circle,
              boxShadow: [BoxShadow(color: Colors.white.withValues(alpha: 0.5), blurRadius: rng.nextDouble() * 10 + 2)],
            ),
          ),
        );
      }),
    );
  }
}
