import 'package:flutter/material.dart';

/// Hub / Crew card theme â€” mirrors React HUB inline constants.
class HubTheme {
  static const bg = Color(0xFF0F0F0F);
  static const bgSecondary = Color(0xFF121212);
  static const text = Color(0xFFFFFFFF);
  static const textSecondary = Color(0xFFA0A0A0);
  static const divider = Color(0xFF1E1E1E);
  static const accent = Color(0xFFA855F7);
  static const accentHighlight = Color(0xFFC084FC);
  static const accentShadow = Color(0xFF7E22CE);

  static const lightScaffold = Color(0xFFB5C4AE);
  static const darkScaffold = Color(0xFF131314);

  static Color scaffoldBg(bool isDark) => isDark ? bg : lightScaffold;

  static BoxDecoration hubCard({Color? background}) => BoxDecoration(
        color: background ?? bg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: divider),
      );

  static EdgeInsets screenPadding(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top;
    return EdgeInsets.fromLTRB(24, top + 16, 24, 80 + MediaQuery.paddingOf(context).bottom);
  }
}
