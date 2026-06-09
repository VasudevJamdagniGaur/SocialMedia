import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../contexts/theme_context.dart';
import '../services/auth_service.dart';
import 'auth_refresh.dart';
import '../screens/splash_screen.dart';
import '../screens/landing_page.dart';
import '../screens/welcome_page.dart';
import '../screens/signup_page.dart';
import '../screens/login_page.dart';
import '../screens/profile_details_page.dart';
import '../screens/dashboard_page.dart';
import '../screens/pod_page.dart';
import '../screens/pod_sports_page.dart';
import '../screens/pod_sports_topic_page.dart';
import '../screens/pod_ai_tech_page.dart';
import '../screens/pod_entrepreneurship_page.dart';
import '../screens/pod_current_affairs_page.dart';
import '../screens/pod_explore_topic_page.dart';
import '../screens/pod_group_chat_page.dart';
import '../screens/all_reflections_page.dart';
import '../screens/all_day_reflections_page.dart';
import '../screens/share_reflection_page.dart';
import '../screens/share_suggestions_page.dart';
import '../screens/tea_feed_page.dart';
import '../screens/help_improve_deite_page.dart';
import '../screens/community_page.dart';
import '../screens/watchlist_page.dart';
import '../screens/chat_page.dart';
import '../screens/emotional_wellbeing_page.dart';
import '../screens/profile_page.dart';
import '../screens/user_profile_page.dart';
import '../components/bottom_navigation.dart';

/// Route paths â€” mirror src/App.js exactly.
class AppRoutes {
  static const splash = '/';
  static const landing = '/landing';
  static const welcome = '/welcome';
  static const signup = '/signup';
  static const login = '/login';
  static const profileDetails = '/signup/profile-details';
  static const dashboard = '/dashboard';
  static const pod = '/pod';
  static const podSports = '/pod/sports';
  static const podSportsTopic = '/pod/sports/topic/:topicId';
  static const podExplore = '/pod/explore/:section/:topicId';
  static const podAiTech = '/pod/ai-tech';
  static const podEntrepreneurship = '/pod/entrepreneurship';
  static const podCurrentAffairs = '/pod/current-affairs';
  static const podChat = '/pod/chat';
  static const podReflections = '/pod/reflections';
  static const reflections = '/reflections';
  static const shareReflection = '/share-reflection';
  static const shareSuggestions = '/share-suggestions';
  static const teaFeed = '/tea-feed';
  static const helpImprove = '/help-improve-deite';
  static const community = '/community';
  static const watchlist = '/watchlist';
  static const chat = '/chat';
  static const wellbeing = '/wellbeing';
  static const profile = '/profile';
  static const userProfile = '/user/:userId';
}

GoRouter? _appRouter;

String _initialLocation() {
  final user = AuthService.instance.getCurrentUser();
  return user != null ? AppRoutes.dashboard : AppRoutes.signup;
}

String? _authRedirect(GoRouterState state) {
  if (state.uri.path == AppRoutes.splash) return _initialLocation();
  return null;
}

GoRouter createAppRouter() {
  _appRouter = _buildAppRouter();
  return _appRouter!;
}

GoRouter _buildAppRouter() {
  final rootKey = GlobalKey<NavigatorState>();

  return GoRouter(
    navigatorKey: rootKey,
    initialLocation: _initialLocation(),
    refreshListenable: authRefreshListenable,
    redirect: (context, state) => _authRedirect(state),
    routes: [
      ShellRoute(
        builder: (context, state, child) => _AppShell(child: child),
        routes: [
          GoRoute(path: AppRoutes.splash, builder: (_, __) => const SplashScreen()),
          GoRoute(path: AppRoutes.landing, builder: (_, __) => const LandingPage()),
          GoRoute(path: AppRoutes.welcome, builder: (_, __) => const WelcomePage()),
          GoRoute(path: AppRoutes.signup, builder: (_, __) => const SignupPage()),
          GoRoute(path: AppRoutes.login, builder: (_, __) => const LoginPage()),
          GoRoute(path: AppRoutes.profileDetails, builder: (_, __) => const ProfileDetailsPage()),
          GoRoute(path: AppRoutes.dashboard, builder: (_, __) => const DashboardPage()),
          GoRoute(path: AppRoutes.pod, builder: (_, __) => const PodPage()),
          GoRoute(
            path: '/pod/sports/topic/:topicId',
            builder: (_, state) => PodSportsTopicPage(topicId: state.pathParameters['topicId']!),
          ),
          GoRoute(path: AppRoutes.podSports, builder: (_, __) => const PodSportsPage()),
          GoRoute(
            path: '/pod/explore/:section/:topicId',
            builder: (_, state) => PodExploreTopicPage(
              key: ValueKey('${state.pathParameters['section']}-${state.pathParameters['topicId']}'),
              section: state.pathParameters['section']!,
              topicId: state.pathParameters['topicId']!,
            ),
          ),
          GoRoute(path: AppRoutes.podAiTech, builder: (_, __) => const PodAiTechPage()),
          GoRoute(path: AppRoutes.podEntrepreneurship, builder: (_, __) => const PodEntrepreneurshipPage()),
          GoRoute(path: AppRoutes.podCurrentAffairs, builder: (_, __) => const PodCurrentAffairsPage()),
          GoRoute(path: AppRoutes.podChat, builder: (_, __) => const PodGroupChatPage()),
          GoRoute(path: AppRoutes.podReflections, builder: (_, __) => const AllReflectionsPage()),
          GoRoute(path: AppRoutes.reflections, builder: (_, __) => const AllDayReflectionsPage()),
          GoRoute(path: AppRoutes.shareReflection, builder: (_, __) => const ShareReflectionPage()),
          GoRoute(path: AppRoutes.shareSuggestions, builder: (_, __) => const ShareSuggestionsPage()),
          GoRoute(path: AppRoutes.teaFeed, builder: (_, __) => const TeaFeedPage()),
          GoRoute(path: AppRoutes.helpImprove, builder: (_, __) => const HelpImproveDeitePage()),
          GoRoute(path: AppRoutes.community, builder: (_, __) => const CommunityPage()),
          GoRoute(path: AppRoutes.watchlist, builder: (_, __) => const WatchlistPage()),
          GoRoute(path: AppRoutes.chat, builder: (_, __) => const ChatPage()),
          GoRoute(path: AppRoutes.wellbeing, builder: (_, __) => const EmotionalWellbeingPage()),
          GoRoute(path: AppRoutes.profile, builder: (_, __) => const ProfilePage()),
          GoRoute(
            path: '/user/:userId',
            builder: (_, state) => UserProfilePage(userId: state.pathParameters['userId']!),
          ),
        ],
      ),
    ],
  );
}

/// Shell with fade transitions + bottom nav â€” mirrors App.js AppContent.
class _AppShell extends StatefulWidget {
  const _AppShell({required this.child});
  final Widget child;

  @override
  State<_AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<_AppShell> {
  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).uri.path;
    final showBottomNav = location == AppRoutes.dashboard ||
        location == AppRoutes.pod ||
        location == AppRoutes.community ||
        location == AppRoutes.wellbeing;

    final instantRoute = location == AppRoutes.teaFeed ||
        location == AppRoutes.shareSuggestions ||
        location == AppRoutes.shareReflection;
    final routeChild = instantRoute
        ? widget.child
        : AnimatedSwitcher(
            duration: const Duration(milliseconds: 200),
            switchInCurve: Curves.easeInOut,
            switchOutCurve: Curves.easeInOut,
            transitionBuilder: (child, animation) =>
                FadeTransition(opacity: animation, child: child),
            child: KeyedSubtree(
              key: ValueKey(location),
              child: widget.child,
            ),
          );

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        _handleAndroidBack(context, location);
      },
      child: ColoredBox(
        color: AppColors.scaffoldBackground,
        child: Stack(
          fit: StackFit.expand,
          children: [
            Positioned.fill(child: routeChild),
            if (showBottomNav) const Positioned(left: 0, right: 0, bottom: 0, child: BottomNavigation()),
          ],
        ),
      ),
    );
  }

  void _handleAndroidBack(BuildContext context, String path) {
    final router = GoRouter.of(context);
    final extra = GoRouterState.of(context).extra;

    if (path == AppRoutes.chat) return; // ChatPage handles its own back
    if (path == AppRoutes.wellbeing) {
      router.go(AppRoutes.dashboard);
      return;
    }
    if (path == AppRoutes.profile) {
      router.go(AppRoutes.dashboard);
      return;
    }
    if (path == AppRoutes.helpImprove) {
      router.go(AppRoutes.dashboard);
      return;
    }
    if (path == AppRoutes.shareSuggestions || path == AppRoutes.shareReflection) {
      if (router.canPop()) {
        router.pop();
        return;
      }
      final ret = extra is Map ? extra['returnTo'] as String? : null;
      router.go(ret != null && ret.startsWith('/') ? ret : AppRoutes.dashboard);
      return;
    }
    if (path == AppRoutes.teaFeed) {
      final ret = extra is Map ? extra['returnTo'] as String? : null;
      router.go(ret != null && ret.startsWith('/') ? ret : AppRoutes.dashboard);
      return;
    }
    if (path.startsWith('/user/')) {
      router.pop();
      return;
    }
    if (path == AppRoutes.podChat) {
      router.go(AppRoutes.pod);
      return;
    }
    if (path == AppRoutes.podReflections) {
      router.go(AppRoutes.pod);
      return;
    }
    if (path.startsWith('/pod/sports/topic/')) {
      router.go(AppRoutes.podSports);
      return;
    }
    if (path.startsWith('/pod/explore/')) {
      final parts = path.split('/').where((s) => s.isNotEmpty).toList();
      final sec = parts.length > 2 ? parts[2] : '';
      final home = sec == 'ai-tech'
          ? AppRoutes.podAiTech
          : sec == 'entrepreneurship'
              ? AppRoutes.podEntrepreneurship
              : sec == 'current-affairs'
                  ? AppRoutes.podCurrentAffairs
                  : AppRoutes.pod;
      router.go(home);
      return;
    }
    if (path == AppRoutes.podSports) {
      router.go(AppRoutes.pod);
      return;
    }
    if (path == AppRoutes.podAiTech ||
        path == AppRoutes.podEntrepreneurship ||
        path == AppRoutes.podCurrentAffairs) {
      router.go(AppRoutes.pod);
      return;
    }
    if (path == AppRoutes.pod) {
      router.go(AppRoutes.dashboard);
      return;
    }
    if (path == AppRoutes.watchlist) {
      router.go(AppRoutes.community);
      return;
    }
    if (path == AppRoutes.community) {
      router.go(AppRoutes.dashboard);
      return;
    }
    if (path == AppRoutes.splash) {
      final user = AuthService.instance.getCurrentUser();
      router.go(user != null ? AppRoutes.dashboard : AppRoutes.signup);
      return;
    }
    if (path == AppRoutes.dashboard || path == AppRoutes.landing) {
      return;
    }
    if (path == AppRoutes.login) {
      router.go(AppRoutes.signup);
      return;
    }
    router.go(AppRoutes.dashboard);
  }
}
