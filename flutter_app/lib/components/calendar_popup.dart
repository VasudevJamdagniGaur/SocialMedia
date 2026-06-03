import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../services/firestore_result.dart' show CalendarDayMarker;
import '../utils/date_utils.dart';
import 'hub_theme.dart';

export '../services/firestore_result.dart' show CalendarDayMarker;

/// Calendar overlay â€” mirrors src/components/CalendarPopup.js
class CalendarPopup extends StatefulWidget {
  const CalendarPopup({
    super.key,
    required this.isOpen,
    required this.onClose,
    required this.selectedDate,
    required this.onDateSelect,
    this.chatDays = const [],
  });

  final bool isOpen;
  final VoidCallback onClose;
  final DateTime selectedDate;
  final ValueChanged<DateTime> onDateSelect;
  final List<CalendarDayMarker> chatDays;

  @override
  State<CalendarPopup> createState() => _CalendarPopupState();
}

class _CalendarPopupState extends State<CalendarPopup> {
  late DateTime _currentMonth;

  @override
  void initState() {
    super.initState();
    _currentMonth = DateTime(widget.selectedDate.year, widget.selectedDate.month);
  }

  @override
  void didUpdateWidget(CalendarPopup oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.selectedDate != oldWidget.selectedDate) {
      _currentMonth = DateTime(widget.selectedDate.year, widget.selectedDate.month);
    }
  }

  bool _hasActivity(DateTime date) {
    final id = getDateId(date);
    return widget.chatDays.any((d) => d.date == id || d.id == id);
  }

  List<DateTime?> _daysInMonth(DateTime month) {
    final first = DateTime(month.year, month.month, 1);
    final last = DateTime(month.year, month.month + 1, 0);
    final days = <DateTime?>[];
    for (var i = 0; i < first.weekday % 7; i++) {
      days.add(null);
    }
    for (var d = 1; d <= last.day; d++) {
      days.add(DateTime(month.year, month.month, d));
    }
    return days;
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.isOpen) return const SizedBox.shrink();

    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    final days = _daysInMonth(_currentMonth);
    final today = DateTime.now();

    return Stack(
      children: [
        Positioned.fill(
          child: GestureDetector(
            onTap: widget.onClose,
            child: Container(color: Colors.black54),
          ),
        ),
        Center(
          child: Material(
            color: HubTheme.bgSecondary,
            borderRadius: BorderRadius.circular(16),
            child: Container(
              width: 320,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: HubTheme.divider),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      IconButton(
                        icon: const Icon(LucideIcons.chevronLeft, color: HubTheme.text),
                        onPressed: () => setState(() {
                          _currentMonth = DateTime(_currentMonth.year, _currentMonth.month - 1);
                        }),
                      ),
                      Text(
                        '${months[_currentMonth.month - 1]} ${_currentMonth.year}',
                        style: const TextStyle(
                          color: HubTheme.text,
                          fontWeight: FontWeight.w600,
                          fontSize: 16,
                        ),
                      ),
                      IconButton(
                        icon: const Icon(LucideIcons.chevronRight, color: HubTheme.text),
                        onPressed: () => setState(() {
                          _currentMonth = DateTime(_currentMonth.year, _currentMonth.month + 1);
                        }),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
                        .map((d) => Text(d, style: const TextStyle(color: HubTheme.textSecondary, fontSize: 11)))
                        .toList(),
                  ),
                  const SizedBox(height: 8),
                  GridView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 7,
                      mainAxisSpacing: 4,
                      crossAxisSpacing: 4,
                    ),
                    itemCount: days.length,
                    itemBuilder: (_, i) {
                      final date = days[i];
                      if (date == null) return const SizedBox.shrink();
                      final isSelected = date.year == widget.selectedDate.year &&
                          date.month == widget.selectedDate.month &&
                          date.day == widget.selectedDate.day;
                      final isToday = date.year == today.year &&
                          date.month == today.month &&
                          date.day == today.day;
                      final hasDot = _hasActivity(date);
                      return GestureDetector(
                        onTap: () {
                          widget.onDateSelect(date);
                          widget.onClose();
                        },
                        child: Container(
                          decoration: BoxDecoration(
                            color: isSelected ? HubTheme.accent.withValues(alpha: 0.35) : null,
                            borderRadius: BorderRadius.circular(8),
                            border: isToday ? Border.all(color: HubTheme.accent, width: 1) : null,
                          ),
                          alignment: Alignment.center,
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Text(
                                '${date.day}',
                                style: TextStyle(
                                  color: isSelected ? HubTheme.text : HubTheme.textSecondary,
                                  fontSize: 13,
                                  fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                                ),
                              ),
                              if (hasDot)
                                Container(
                                  width: 4,
                                  height: 4,
                                  margin: const EdgeInsets.only(top: 2),
                                  decoration: const BoxDecoration(
                                    color: HubTheme.accent,
                                    shape: BoxShape.circle,
                                  ),
                                ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}
