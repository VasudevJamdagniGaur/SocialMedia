import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Mirrors src/contexts/ThemeContext.js â€” dark mode default, persisted in localStorage equivalent.
class ThemeNotifier extends ChangeNotifier {
  ThemeNotifier(this._isDarkMode);

  bool _isDarkMode;
  bool get isDarkMode => _isDarkMode;

  static const _storageKey = 'theme';

  static Future<ThemeNotifier> load() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_storageKey);
    bool isDark = true;
    if (saved != null) {
      if (saved == 'true' || saved == 'dark') {
        isDark = true;
      } else if (saved == 'false' || saved == 'light') {
        isDark = false;
      } else {
        try {
          isDark = saved == 'true' || (saved.contains('true'));
        } catch (_) {
          isDark = true;
        }
      }
    }
    return ThemeNotifier(isDark);
  }

  Future<void> toggleTheme() async {
    _isDarkMode = !_isDarkMode;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_storageKey, _isDarkMode.toString());
  }

  Future<void> setDarkMode(bool value) async {
    if (_isDarkMode == value) return;
    _isDarkMode = value;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_storageKey, value.toString());
  }
}

/// App color constants matching React inline styles.
class AppColors {
  static const scaffoldBackground = Color(0xFF131314);
  static const hubBackground = Color(0xFF0F0F0F);
  static const accentPurple = Color(0xFFA855F7);
  static const bottomNavDark = Color(0xFF262626);
  static const splashBackground = Color(0xFF0F0F0F);
}
