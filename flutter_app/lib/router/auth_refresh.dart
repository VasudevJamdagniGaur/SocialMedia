import 'dart:async';

import 'package:flutter/foundation.dart';

import '../services/auth_service.dart';

/// Notifies [GoRouter] when Firebase auth state changes so redirects re-run.
class AuthRefreshNotifier extends ChangeNotifier {
  AuthRefreshNotifier() {
    _sub = AuthService.instance.onAuthStateChange().listen((_) {
      notifyListeners();
    });
  }

  late final StreamSubscription<dynamic> _sub;

  @override
  void dispose() {
    _sub.cancel();
    super.dispose();
  }
}

AuthRefreshNotifier? _authRefreshNotifier;

/// Call after [Firebase.initializeApp] before creating the router.
void initAuthRefreshNotifier() {
  _authRefreshNotifier ??= AuthRefreshNotifier();
}

Listenable get authRefreshListenable {
  assert(
    _authRefreshNotifier != null,
    'Call initAuthRefreshNotifier() after Firebase.initializeApp()',
  );
  return _authRefreshNotifier!;
}
