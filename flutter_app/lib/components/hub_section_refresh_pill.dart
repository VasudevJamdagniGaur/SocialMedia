import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../utils/hub_colors.dart';

/// Compact header Refresh control for Tea / News carousels.
class HubSectionRefreshPill extends StatelessWidget {
  const HubSectionRefreshPill({
    super.key,
    required this.refreshing,
    required this.onRefresh,
  });

  final bool refreshing;
  final VoidCallback? onRefresh;

  static const _bg = Color(0xFF171717);
  static const _fg = Color(0xFFC084FC); // muted lavender

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: refreshing ? null : onRefresh,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          height: 36,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: _bg,
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: HubColors.divider),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (refreshing)
                const SizedBox(
                  width: 14,
                  height: 14,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: _fg,
                  ),
                )
              else
                const Icon(LucideIcons.refreshCw, size: 14, color: _fg),
              const SizedBox(width: 6),
              Text(
                refreshing ? 'Refreshing' : 'Refresh',
                style: TextStyle(
                  color: _fg.withValues(alpha: refreshing ? 0.75 : 1),
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
