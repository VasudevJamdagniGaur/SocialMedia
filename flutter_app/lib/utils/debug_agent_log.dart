import 'dart:convert';
import 'dart:io' show File, FileMode, Platform;

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

const _sessionId = '8580c3';
const _ingestPath = '/ingest/b18a3290-9ac3-4a2f-9cc9-9e626081bb59';
const _hosts = ['127.0.0.1', '10.0.2.2'];
const _workspaceLogPath = r'c:\CURSOR\THE GREAT PROJECT\debug-8580c3.log';

/// Debug-mode log — posts to local ingest (web/emulator) and prints to console.
void agentDebugLog(
  String location,
  String message,
  Map<String, dynamic> data, {
  String? hypothesisId,
  String runId = 'pre-fix',
}) {
  // #region agent log
  final payload = <String, dynamic>{
    'sessionId': _sessionId,
    'runId': runId,
    'hypothesisId': hypothesisId,
    'location': location,
    'message': message,
    'data': data,
    'timestamp': DateTime.now().millisecondsSinceEpoch,
  };
  final body = jsonEncode(payload);
  debugPrint('AGENT_LOG $body');
  if (!kIsWeb) {
    try {
      if (Platform.isWindows) {
        File(_workspaceLogPath).writeAsStringSync('$body\n', mode: FileMode.append);
      }
    } catch (_) {}
  }
  for (final host in _hosts) {
    http
        .post(
          Uri.parse('http://$host:7871$_ingestPath'),
          headers: {
            'Content-Type': 'application/json',
            'X-Debug-Session-Id': _sessionId,
          },
          body: body,
        )
        .catchError((_) => http.Response('', 500));
  }
  // #endregion
}
