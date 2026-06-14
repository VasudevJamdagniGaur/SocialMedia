import 'dart:async';

import '../components/hub_trending_feed.dart';
import '../components/trending_tea.dart';

/// Load Tea + News disk caches into memory before the Pod tab opens.
Future<void> warmPodHubCachesFromDisk() async {
  await Future.wait([
    warmTeaCacheFromDisk(),
    warmHubNewsCacheFromDisk(),
  ]);
}

/// Warm caches, then refresh stale data in the background (non-blocking).
Future<void> prefetchPodHubContent() async {
  await warmPodHubCachesFromDisk();
  unawaited(refreshPodHubContentInBackground());
}

Future<void> refreshPodHubContentInBackground() async {
  await Future.wait([
    refreshTrendingTeaInBackground().catchError((_) {}),
    refreshHubNewsInBackground().catchError((_) {}),
  ]);
}
