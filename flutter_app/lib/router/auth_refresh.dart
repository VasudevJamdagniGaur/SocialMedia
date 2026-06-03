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

final authRefreshListenable = AuthRefreshNotifier();
