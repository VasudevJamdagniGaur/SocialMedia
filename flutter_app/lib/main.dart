import 'dart:async';

import 'package:firebase_analytics/firebase_analytics.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'config/firebase_options.dart';
import 'contexts/theme_context.dart';
import 'package:go_router/go_router.dart';
import 'router/app_router.dart';
import 'router/auth_refresh.dart';
import 'services/chat_service.dart';
import 'services/pod_hub_prefetch.dart';
import 'utils/prefs_maintenance.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  FlutterError.onError = (details) {
    FlutterError.presentError(details);
    debugPrint('FlutterError: ${details.exceptionAsString()}');
  };

  // Paint something immediately instead of a blank native window while Firebase boots.
  runApp(const SociTeaBootstrap());
}

/// Boots Firebase + router, showing a visible loader until the real app is ready.
class SociTeaBootstrap extends StatefulWidget {
  const SociTeaBootstrap({super.key});

  @override
  State<SociTeaBootstrap> createState() => _SociTeaBootstrapState();
}

class _SociTeaBootstrapState extends State<SociTeaBootstrap> {
  ThemeNotifier? _themeNotifier;
  GoRouter? _router;
  Object? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_boot());
  }

  Future<void> _boot() async {
    try {
      await pruneSharedPreferencesOnStartup();
      await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
      await FirebaseAnalytics.instance.setAnalyticsCollectionEnabled(true);
      initAuthRefreshNotifier();

      SystemChrome.setSystemUIOverlayStyle(
        const SystemUiOverlayStyle(statusBarColor: Colors.transparent),
      );

      final themeNotifier = await ThemeNotifier.load();
      final router = createAppRouter();
      if (!mounted) return;

      setState(() {
        _themeNotifier = themeNotifier;
        _router = router;
      });

      WidgetsBinding.instance.addPostFrameCallback((_) {
        unawaited(prefetchPodHubContent());
      });
    } catch (e, st) {
      debugPrint('Bootstrap failed: $e\n$st');
      if (!mounted) return;
      setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return MaterialApp(
        debugShowCheckedModeBanner: false,
        home: Scaffold(
          backgroundColor: AppColors.scaffoldBackground,
          body: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Text(
                'Failed to start app.\n$_error',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white70),
              ),
            ),
          ),
        ),
      );
    }

    final theme = _themeNotifier;
    final router = _router;
    if (theme == null || router == null) {
      return const MaterialApp(
        debugShowCheckedModeBanner: false,
        home: Scaffold(
          backgroundColor: AppColors.scaffoldBackground,
          body: Center(
            child: CircularProgressIndicator(color: AppColors.accentPurple),
          ),
        ),
      );
    }

    return DeiteApp(themeNotifier: theme, router: router);
  }
}

class DeiteApp extends StatelessWidget {
  const DeiteApp({super.key, required this.themeNotifier, required this.router});

  final ThemeNotifier themeNotifier;
  final GoRouter router;

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: themeNotifier),
        ChangeNotifierProvider.value(value: chatService),
      ],
      child: Consumer<ThemeNotifier>(
        builder: (context, theme, _) {
          return MaterialApp.router(
            title: 'SociTea',
            debugShowCheckedModeBanner: false,
            themeMode: theme.isDarkMode ? ThemeMode.dark : ThemeMode.light,
            theme: _buildTheme(Brightness.light),
            darkTheme: _buildTheme(Brightness.dark),
            routerConfig: router,
          );
        },
      ),
    );
  }

  ThemeData _buildTheme(Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    return ThemeData(
      brightness: brightness,
      scaffoldBackgroundColor: AppColors.scaffoldBackground,
      colorScheme: ColorScheme.fromSeed(
        seedColor: AppColors.accentPurple,
        brightness: brightness,
        surface: isDark ? AppColors.hubBackground : Colors.white,
      ),
      fontFamily: 'Roboto',
      useMaterial3: true,
    );
  }
}
