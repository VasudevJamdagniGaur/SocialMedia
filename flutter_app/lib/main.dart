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

  await pruneSharedPreferencesOnStartup();

  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  await FirebaseAnalytics.instance.setAnalyticsCollectionEnabled(true);
  initAuthRefreshNotifier();

  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(statusBarColor: Colors.transparent),
  );
  final themeNotifier = await ThemeNotifier.load();
  final router = createAppRouter();
  unawaited(prefetchPodHubContent());
  runApp(DeiteApp(themeNotifier: themeNotifier, router: router));
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
