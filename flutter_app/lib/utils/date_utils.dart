import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Date helpers (IST / YYYY-MM-DD dateId) â€” mirrors src/utils/dateUtils.js
String getDateId([DateTime? date]) {
  final d = date ?? DateTime.now().toUtc().add(const Duration(hours: 5, minutes: 30));
  final y = d.year.toString().padLeft(4, '0');
  final m = d.month.toString().padLeft(2, '0');
  final day = d.day.toString().padLeft(2, '0');
  return '$y-$m-$day';
}

/// Date ID for [daysAgo] days before today (mirrors getDateIdDaysAgo in dateUtils.js).
String getDateIdDaysAgo(int daysAgo) {
  final date = DateTime.now().subtract(Duration(days: daysAgo));
  return getDateId(date);
}

String formatDateForDisplay(dynamic dateInput) {
  DateTime date;
  if (dateInput is DateTime) {
    date = dateInput;
  } else {
    final s = dateInput?.toString() ?? '';
    date = DateTime.tryParse('${s}T00:00:00') ?? DateTime.now();
  }
  return DateFormat('EEEE, MMMM d, y').format(date);
}

bool isTodayDateId(String dateId) => dateId == getDateId();

Future<String> getReflectionFromLocalStorage(String dateId) async {
  final prefs = await SharedPreferences.getInstance();
  return prefs.getString('reflection_$dateId') ??
      prefs.getString('reflection_backup_$dateId') ??
      '';
}

Future<void> saveReflectionToLocalStorage(String dateId, String text) async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.setString('reflection_$dateId', text);
}

String formatTimeAgo(DateTime? date) {
  if (date == null) return '';
  final diff = DateTime.now().difference(date);
  final minutes = diff.inMinutes;
  final hours = diff.inHours;
  final days = diff.inDays;
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return '${minutes}m ago';
  if (hours < 24) return '${hours}h ago';
  return '${days}d ago';
}

String formatReflectionDateTime(dynamic createdAt, {String? dateFallback}) {
  DateTime? date;
  if (createdAt is DateTime) {
    date = createdAt;
  } else if (dateFallback != null && dateFallback.contains('-')) {
    final parts = dateFallback.split('-');
    if (parts.length == 3) {
      date = DateTime(int.parse(parts[0]), int.parse(parts[1]), int.parse(parts[2]));
    }
  }
  if (date == null) return dateFallback ?? '';
  final day = date.day;
  final month = DateFormat('MMMM').format(date);
  final year = date.year;
  final dayName = DateFormat('EEE').format(date);
  final time = DateFormat('h:mm a').format(date);
  return '$day $month $year â€¢ $dayName, $time';
}
