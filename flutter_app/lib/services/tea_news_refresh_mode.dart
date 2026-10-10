import 'package:flutter/foundation.dart';

/// Temporary: when true, Tea/News do not auto-fetch on app/Pod open.
/// User must tap the manual refresh button. Set to `false` to restore auto scrape.
const bool kManualTeaNewsRefreshOnly = true;

/// Bumped after a successful manual refresh so Tea/News carousels reload from cache.
final ValueNotifier<int> teaNewsManualRefreshTick = ValueNotifier<int>(0);

/// True while a manual Tea/News refresh is in flight.
final ValueNotifier<bool> teaNewsManualRefreshing = ValueNotifier<bool>(false);
