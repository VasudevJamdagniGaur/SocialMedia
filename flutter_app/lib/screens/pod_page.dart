import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../components/hub_theme.dart';
import '../components/hub_trending_feed.dart';
import '../components/trending_tea.dart';
import '../contexts/theme_context.dart';
import '../router/app_router.dart';
import '../services/auth_service.dart';
import '../services/hub_personalization_service.dart';
import '../services/pod_news_service.dart';

/// Mirrors src/components/PodPage.js
class PodPage extends StatefulWidget {
  const PodPage({super.key});

  @override
  State<PodPage> createState() => _PodPageState();
}

class _PodPageState extends State<PodPage> {
  String? _profilePicture;

  @override
  void initState() {
    super.initState();
    Future.delayed(const Duration(milliseconds: 900), prefetchAllSportsExploreTopicsNow);
    _loadProfilePicture();
  }

  Future<void> _loadProfilePicture() async {
    final user = AuthService().getCurrentUser();
    if (user == null) return;
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString('user_profile_picture_${user.uid}');
    if (mounted) setState(() => _profilePicture = saved);
  }

  @override
  Widget build(BuildContext context) {
    final isDark = context.watch<ThemeNotifier>().isDarkMode;

    return Scaffold(
      backgroundColor: HubTheme.scaffoldBg(isDark),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 16, 24, 100),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Column(
                children: [
                  _PodHeader(
                    isDark: isDark,
                    profilePicture: _profilePicture,
                    onThemeToggle: () => context.read<ThemeNotifier>().toggleTheme(),
                    onHelp: () => context.push(AppRoutes.helpImprove),
                    onProfile: () => context.push(AppRoutes.profile),
                  ),
                  const TrendingTea(),
                  HubTrendingFeed(isDarkMode: isDark),
                  _CategoriesCard(
                    onCategory: (cat) {
                      switch (cat) {
                        case 'Sports':
                          recordHubVerticalClick('sports');
                          context.push(AppRoutes.podSports);
                          break;
                        case 'AI & Tech':
                          recordHubVerticalClick('ai-tech');
                          context.push(AppRoutes.podAiTech);
                          break;
                        case 'Entrepreneurship':
                          recordHubVerticalClick('entrepreneurship');
                          context.push(AppRoutes.podEntrepreneurship);
                          break;
                        case 'Current Affairs':
                          recordHubVerticalClick('current-affairs');
                          context.push(AppRoutes.podCurrentAffairs);
                          break;
                      }
                    },
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _PodHeader extends StatelessWidget {
  const _PodHeader({
    required this.isDark,
    required this.profilePicture,
    required this.onThemeToggle,
    required this.onHelp,
    required this.onProfile,
  });

  final bool isDark;
  final String? profilePicture;
  final VoidCallback onThemeToggle;
  final VoidCallback onHelp;
  final VoidCallback onProfile;

  @override
  Widget build(BuildContext context) {
    Widget circle({required Widget child, required VoidCallback onTap}) => Material(
          color: isDark ? HubTheme.bgSecondary : Colors.white,
          shape: const CircleBorder(),
          child: InkWell(customBorder: const CircleBorder(), onTap: onTap, child: SizedBox(width: 40, height: 40, child: Center(child: child))),
        );

    return Padding(
      padding: const EdgeInsets.only(bottom: 24),
      child: Row(
        children: [
          circle(
            onTap: onThemeToggle,
            child: Icon(isDark ? LucideIcons.moon : LucideIcons.sun, color: HubTheme.accent, size: 22),
          ),
          Expanded(
            child: Text(
              'Tea',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: isDark ? Colors.white : const Color(0xFF1f2937),
                fontSize: 20,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
          circle(onTap: onHelp, child: const Text('✨', style: TextStyle(fontSize: 17))),
          const SizedBox(width: 8),
          circle(
            onTap: onProfile,
            child: profilePicture != null
                ? ClipOval(child: CachedNetworkImage(imageUrl: profilePicture!, width: 36, height: 36, fit: BoxFit.cover))
                : const Icon(LucideIcons.user, color: HubTheme.accent, size: 22),
          ),
        ],
      ),
    );
  }
}

class _CategoriesCard extends StatelessWidget {
  const _CategoriesCard({required this.onCategory});
  final void Function(String) onCategory;

  static const _categories = ['Sports', 'AI & Tech', 'Entrepreneurship', 'Current Affairs'];

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: HubTheme.hubCard(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(color: HubTheme.accent.withValues(alpha: 0.3), shape: BoxShape.circle),
                  child: const Icon(LucideIcons.sparkles, color: HubTheme.accent, size: 18),
                ),
                const SizedBox(width: 12),
                const Text('Categories', style: TextStyle(color: HubTheme.text, fontSize: 18, fontWeight: FontWeight.w600)),
              ],
            ),
          ),
          const Divider(height: 1, color: HubTheme.divider),
          ...List.generate(_categories.length, (i) {
            final cat = _categories[i];
            return InkWell(
              onTap: () => onCategory(cat),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                decoration: BoxDecoration(
                  border: i == 0 ? null : const Border(top: BorderSide(color: HubTheme.divider)),
                ),
                child: Row(
                  children: [
                    Expanded(child: Text(cat, style: const TextStyle(color: HubTheme.text, fontSize: 15))),
                    const Icon(LucideIcons.chevronRight, color: HubTheme.textSecondary, size: 20),
                  ],
                ),
              ),
            );
          }),
        ],
      ),
    );
  }
}
