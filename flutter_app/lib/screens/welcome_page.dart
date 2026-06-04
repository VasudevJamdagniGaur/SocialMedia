import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';

import '../contexts/theme_context.dart';
import '../router/app_router.dart';

const _kDeteaAvatar = 'assets/images/DEITECIrc-192.webp';

class WelcomePage extends StatefulWidget {
  const WelcomePage({super.key});

  @override
  State<WelcomePage> createState() => _WelcomePageState();
}

class _WelcomePageState extends State<WelcomePage> with SingleTickerProviderStateMixin {
  late final AnimationController _slideController;
  late final Animation<Offset> _slideAnimation;

  @override
  void initState() {
    super.initState();
    _slideController = AnimationController(vsync: this, duration: const Duration(milliseconds: 600))..forward();
    _slideAnimation = Tween<Offset>(begin: const Offset(0, 0.08), end: Offset.zero)
        .animate(CurvedAnimation(parent: _slideController, curve: Curves.easeOut));
  }

  @override
  void dispose() {
    _slideController.dispose();
    super.dispose();
  }

  void _handleGo() {
    context.go(AppRoutes.signup);
  }

  @override
  Widget build(BuildContext context) {
    context.watch<ThemeNotifier>();
    final width = MediaQuery.sizeOf(context).width;
    final isWide = width >= 768;

    return Scaffold(
      backgroundColor: AppColors.hubBackground,
      body: SlideTransition(
        position: _slideAnimation,
        child: Stack(
          children: [
            const _WelcomeDecorations(),
            SafeArea(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 48),
                child: Column(
                  children: [
                    Container(
                      width: 80,
                      height: 80,
                      decoration: BoxDecoration(
                        color: const Color(0xFF121212),
                        shape: BoxShape.circle,
                        border: Border.all(color: const Color(0x4DA855F7)),
                        boxShadow: const [
                          BoxShadow(color: Color(0x59C084FC), blurRadius: 20),
                          BoxShadow(color: Color(0x667E22CE), blurRadius: 16, offset: Offset(0, 4)),
                        ],
                      ),
                      child: ClipOval(
                        child: Image.asset(
                          _kDeteaAvatar,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) =>
                              const Icon(Icons.psychology, color: AppColors.accentPurple, size: 40),
                        ),
                      ),
                    ),
                    const SizedBox(height: 32),
                    const Text(
                      'Welcome to Detea',
                      style: TextStyle(
                        fontSize: 30,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 32),
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 672),
                      child: Wrap(
                        spacing: 24,
                        runSpacing: 24,
                        alignment: WrapAlignment.center,
                        children: [
                          SizedBox(
                            width: isWide ? (672 - 24) / 2 : double.infinity,
                            child: _FeatureCard(
                              icon: LucideIcons.shield,
                              title: 'Private and Secure',
                              description:
                                  'Your emotional journey is protected with end-to-end encryption',
                              iconBg: const Color(0xCCA855F7),
                              cardBg: AppColors.bottomNavDark,
                              borderColor: const Color(0x14FFFFFF),
                              boxShadow: const [
                                BoxShadow(color: Color(0x26000000), blurRadius: 16, offset: Offset(0, 4)),
                              ],
                            ),
                          ),
                          SizedBox(
                            width: isWide ? (672 - 24) / 2 : double.infinity,
                            child: _FeatureCard(
                              icon: LucideIcons.trendingUp,
                              title: 'Track emotional growth',
                              description:
                                  'Monitor your progress and celebrate your emotional milestones',
                              iconBg: const Color(0xCCC084FC),
                              cardBg: const Color(0x4D1C1F2E),
                              borderColor: const Color(0x2EC084FC),
                              boxShadow: const [
                                BoxShadow(color: Color(0x1FC084FC), blurRadius: 40, spreadRadius: -12),
                              ],
                              insetGlow: true,
                            ),
                          ),
                          SizedBox(
                            width: isWide ? (672 - 24) / 2 : double.infinity,
                            child: _FeatureCard(
                              icon: LucideIcons.bookOpen,
                              title: 'Journaling',
                              description:
                                  'Express your thoughts and feelings in a safe, private space',
                              iconBg: const Color(0xCCA855F7),
                              cardBg: const Color(0x4D1C1F2E),
                              borderColor: const Color(0x2EA855F7),
                              boxShadow: const [
                                BoxShadow(color: Color(0x1FA855F7), blurRadius: 40, spreadRadius: -12),
                              ],
                              insetGlow: true,
                            ),
                          ),
                          SizedBox(
                            width: isWide ? (672 - 24) / 2 : double.infinity,
                            child: _FeatureCard(
                              icon: LucideIcons.users,
                              title: 'Mental Support',
                              description:
                                  'Access resources and guidance for your mental wellness journey',
                              iconBg: const Color(0xCC7E22CE),
                              cardBg: AppColors.bottomNavDark,
                              borderColor: const Color(0x14FFFFFF),
                              boxShadow: const [
                                BoxShadow(color: Color(0x26000000), blurRadius: 16, offset: Offset(0, 4)),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 32),
                    Material(
                      color: Colors.transparent,
                      child: InkWell(
                        onTap: _handleGo,
                        borderRadius: BorderRadius.circular(999),
                        child: Ink(
                          decoration: BoxDecoration(
                            color: AppColors.accentPurple,
                            borderRadius: BorderRadius.circular(999),
                            border: Border.all(color: const Color(0x80A855F7)),
                            boxShadow: const [
                              BoxShadow(color: Color(0x4DC084FC), blurRadius: 20),
                              BoxShadow(color: Color(0x667E22CE), blurRadius: 16, offset: Offset(0, 4)),
                            ],
                          ),
                          child: const Padding(
                            padding: EdgeInsets.symmetric(horizontal: 48, vertical: 12),
                            child: Text(
                              'Go',
                              style: TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w600,
                                fontSize: 16,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FeatureCard extends StatelessWidget {
  const _FeatureCard({
    required this.icon,
    required this.title,
    required this.description,
    required this.iconBg,
    required this.cardBg,
    required this.borderColor,
    required this.boxShadow,
    this.insetGlow = false,
  });

  final IconData icon;
  final String title;
  final String description;
  final Color iconBg;
  final Color cardBg;
  final Color borderColor;
  final List<BoxShadow> boxShadow;
  final bool insetGlow;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: borderColor),
        boxShadow: boxShadow,
      ),
      child: Column(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: iconBg,
              shape: BoxShape.circle,
              border: Border.all(color: iconBg.withValues(alpha: 0.5)),
              boxShadow: [
                BoxShadow(
                  color: AppColors.accentPurple.withValues(alpha: insetGlow ? 0.25 : 0.35),
                  blurRadius: 16,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Icon(icon, color: Colors.white, size: 24),
          ),
          const SizedBox(height: 16),
          Text(
            title,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w600,
              color: Colors.white,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text(
            description,
            style: const TextStyle(fontSize: 14, color: Color(0xFFD1D5DB)),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

class _WelcomeDecorations extends StatelessWidget {
  const _WelcomeDecorations();

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    return Stack(
      children: [
        _BouncingIcon(
          icon: LucideIcons.heart,
          color: const Color(0xFFC084FC),
          size: 16,
          opacity: 0.14,
          left: size.width * 0.12,
          top: size.height * 0.2,
          delay: const Duration(milliseconds: 300),
          duration: const Duration(seconds: 4),
        ),
        _BouncingIcon(
          icon: LucideIcons.heart,
          color: AppColors.accentPurple,
          size: 12,
          opacity: 0.17,
          right: size.width * 0.16,
          top: size.height * 0.66,
          delay: const Duration(seconds: 2),
          duration: const Duration(milliseconds: 3500),
        ),
        _PulsingIcon(
          icon: LucideIcons.star,
          color: AppColors.accentPurple,
          size: 12,
          opacity: 0.2,
          right: size.width * 0.25,
          top: size.height * 0.12,
          delay: const Duration(milliseconds: 800),
          duration: const Duration(milliseconds: 2800),
        ),
        _PulsingIcon(
          icon: LucideIcons.star,
          color: const Color(0xFFC084FC),
          size: 16,
          opacity: 0.16,
          left: size.width * 0.2,
          bottom: size.height * 0.33,
          delay: const Duration(milliseconds: 2500),
          duration: const Duration(milliseconds: 3200),
        ),
      ],
    );
  }
}

class _BouncingIcon extends StatefulWidget {
  const _BouncingIcon({
    required this.icon,
    required this.color,
    required this.size,
    required this.opacity,
    required this.delay,
    required this.duration,
    this.left,
    this.right,
    this.top,
    this.bottom,
  });

  final IconData icon;
  final Color color;
  final double size;
  final double opacity;
  final Duration delay;
  final Duration duration;
  final double? left;
  final double? right;
  final double? top;
  final double? bottom;

  @override
  State<_BouncingIcon> createState() => _WelcomeBouncingIconState();
}

class _WelcomeBouncingIconState extends State<_BouncingIcon> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: widget.duration);
    Future.delayed(widget.delay, () {
      if (mounted) _controller.repeat(reverse: true);
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Positioned(
      left: widget.left,
      right: widget.right,
      top: widget.top,
      bottom: widget.bottom,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, child) => Transform.translate(
          offset: Offset(0, -8 * _controller.value),
          child: child,
        ),
        child: Opacity(
          opacity: widget.opacity,
          child: Icon(widget.icon, color: widget.color, size: widget.size),
        ),
      ),
    );
  }
}

class _PulsingIcon extends StatefulWidget {
  const _PulsingIcon({
    required this.icon,
    required this.color,
    required this.size,
    required this.opacity,
    required this.delay,
    required this.duration,
    this.left,
    this.right,
    this.top,
    this.bottom,
  });

  final IconData icon;
  final Color color;
  final double size;
  final double opacity;
  final Duration delay;
  final Duration duration;
  final double? left;
  final double? right;
  final double? top;
  final double? bottom;

  @override
  State<_PulsingIcon> createState() => _WelcomePulsingIconState();
}

class _WelcomePulsingIconState extends State<_PulsingIcon> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: widget.duration);
    Future.delayed(widget.delay, () {
      if (mounted) _controller.repeat(reverse: true);
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Positioned(
      left: widget.left,
      right: widget.right,
      top: widget.top,
      bottom: widget.bottom,
      child: FadeTransition(
        opacity: Tween<double>(begin: 0.35, end: 1).animate(
          CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
        ),
        child: Opacity(
          opacity: widget.opacity,
          child: Icon(widget.icon, color: widget.color, size: widget.size),
        ),
      ),
    );
  }
}
