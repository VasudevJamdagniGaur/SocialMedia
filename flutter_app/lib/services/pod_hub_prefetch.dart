import 'dart:async';

import 'package:flutter/foundation.dart';

import '../components/hub_trending_feed.dart';
import '../components/trending_tea.dart';
import 'tea_news_refresh_mode.dart';

export 'tea_news_refresh_mode.dart';

/// Load Tea + News disk caches into memory before the Pod tab opens.
Future<void> warmPodHubCachesFromDisk() async {
  await Future.wait([
    warmTeaCacheFromDisk(),
    warmHubNewsCacheFromDisk(),
  ]);
}

/// Warm caches, then refresh stale data in the background (non-blocking).
/// Skips network refresh when [kManualTeaNewsRefreshOnly] is true.
Future<void> prefetchPodHubContent() async {
  await warmPodHubCachesFromDisk();
  if (kManualTeaNewsRefreshOnly) {
    debugPrint('[PodHub] manual-refresh-only: skipping automatic Tea/News scrape');
    return;
  }
  unawaited(refreshPodHubContentInBackground());
}

Future<void> refreshPodHubContentInBackground() async {
  await Future.wait([
    refreshTrendingTeaInBackground().catchError((_) {}),
    refreshHubNewsInBackground().catchError((_) {}),
  ]);
}

/// User-triggered scrape for Tea + News. Updates memory/disk caches and notifies UI.
Future<void> manualRefreshTeaAndNews() async {
  if (teaNewsManualRefreshing.value) return;
  teaNewsManualRefreshing.value = true;
  debugPrint('[PodHub] manual Tea/News refresh started');
  try {
    await Future.wait([
      fetchTrendingTea(allowCache: false, deferEnrich: false).then((_) {}, onError: (_) {}),
      fetchHubTrendingItems(forceRefresh: true).then((_) {}, onError: (_) {}),
    ]);
    teaNewsManualRefreshTick.value++;
    debugPrint('[PodHub] manual Tea/News refresh finished');
  } finally {
    teaNewsManualRefreshing.value = false;
  }
}
