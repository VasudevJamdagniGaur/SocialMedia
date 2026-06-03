import 'dart:async';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';

const _allowedEventTypes = {
  'impression',
  'view',
  'scroll',
  'like',
  'comment',
  'share',
  'save',
};

String _getDeviceType() {
  if (kIsWeb) return 'web';
  if (Platform.isIOS) return 'ios';
  if (Platform.isAndroid) return 'android';
  return 'web';
}

int _unixSecondsNow() => DateTime.now().millisecondsSinceEpoch ~/ 1000;

String _createSessionId() {
  try {
    return const Uuid().v4();
  } catch (_) {
    return 'sess_${DateTime.now().millisecondsSinceEpoch}_${DateTime.now().microsecond.toRadixString(16)}';
  }
}

/// User interaction event tracking for feed recommendation signals.
class UserEventService {
  UserEventService._();

  static final UserEventService instance = UserEventService._();

  factory UserEventService() => instance;

  String? _sessionId;
  final String _deviceType = _getDeviceType();
  final List<Map<String, dynamic>> _queue = [];
  Timer? _flushTimer;
  final Set<String> _impressionDedup = {};
  static const int _maxBatch = 25;
  static const int _flushIntervalMs = 1200;

  String startSession() {
    _sessionId = _createSessionId();
    _impressionDedup.clear();
    return _sessionId!;
  }

  String getSessionId() => _sessionId ?? startSession();

  void logEvent(Map<String, dynamic> payload) {
    final userId = (payload['user_id'] as String? ?? '').trim();
    final postId = (payload['post_id'] as String? ?? '').trim();
    final eventType = (payload['event_type'] as String? ?? '').trim();

    if (userId.isEmpty || postId.isEmpty) return;
    if (!_allowedEventTypes.contains(eventType)) return;

    final sessionId = getSessionId();

    if (eventType == 'impression') {
      final key = '$sessionId:$postId';
      if (_impressionDedup.contains(key)) return;
      _impressionDedup.add(key);
    }

    final dwellTimeMs = eventType == 'view'
        ? ((payload['dwell_time_ms'] as num?) ?? 0).toInt().clamp(0, 999999999)
        : null;

    final positionInFeed = payload['position_in_feed'] == null
        ? null
        : ((payload['position_in_feed'] as num).toInt()).clamp(1, 999999);

    _queue.add({
      'user_id': userId,
      'post_id': postId,
      'event_type': eventType,
      'timestamp': _unixSecondsNow(),
      'dwell_time_ms': dwellTimeMs,
      'session_id': sessionId,
      'device_type': _deviceType,
      'position_in_feed': positionInFeed,
    });

    _scheduleFlush();
  }

  void _scheduleFlush() {
    if (_queue.length >= _maxBatch) {
      flush();
      return;
    }
    _flushTimer ??= Timer(
      const Duration(milliseconds: _flushIntervalMs),
      () {
        _flushTimer = null;
        flush();
      },
    );
  }

  Future<void> flush() async {
    if (_queue.isEmpty) return;
    final events = _queue.take(_maxBatch).toList();
    _queue.removeRange(0, events.length);

    unawaited(() async {
      try {
        final batch = FirebaseFirestore.instance.batch();
        final colRef = FirebaseFirestore.instance.collection('user_events');
        for (final e in events) {
          final ref = colRef.doc();
          batch.set(ref, {
            'id': ref.id,
            ...e,
            'createdAt': FieldValue.serverTimestamp(),
          });
        }
        await batch.commit();
      } catch (err) {
        debugPrint('[user_events] flush failed: $err');
      }
    }());
  }
}

final userEventService = UserEventService.instance;

const userEventSchema = {
  'collection': 'user_events',
  'fields': [
    'id',
    'user_id',
    'post_id',
    'event_type',
    'timestamp',
    'dwell_time_ms',
    'session_id',
    'device_type',
    'position_in_feed',
  ],
  'allowed_event_type_values': _allowedEventTypes,
};
