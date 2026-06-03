import 'dart:convert';
import 'dart:io';

import 'package:googleapis_auth/auth_io.dart';
import 'package:http/http.dart' as http;

import '../config.dart';

/// Minimal Firestore REST client for admin writes (deleteRequests intake).
class FirestoreClient {
  FirestoreClient({http.Client? httpClient}) : _http = httpClient ?? http.Client();

  final http.Client _http;
  AutoRefreshingAuthClient? _authClient;

  Future<AutoRefreshingAuthClient?> _client() async {
    if (_authClient != null) return _authClient;
    final path = ServerConfig.credentialsPath;
    if (!File(path).existsSync()) return null;
    try {
      final creds = ServiceAccountCredentials.fromJson(
        jsonDecode(await File(path).readAsString()) as Map<String, dynamic>,
      );
      _authClient = await clientViaServiceAccount(
        creds,
        ['https://www.googleapis.com/auth/datastore'],
      );
      return _authClient;
    } catch (_) {
      return null;
    }
  }

  /// Stores a pending account deletion request — port of deleteAccountRequest.ts.
  Future<void> addDeleteRequest(String email) async {
    final client = await _client();
    if (client == null) {
      throw StateError('Firestore credentials unavailable (set GOOGLE_APPLICATION_CREDENTIALS)');
    }

    final projectId = ServerConfig.firestoreProjectId;
    final uri = Uri.parse(
      'https://firestore.googleapis.com/v1/projects/$projectId/databases/(default)/documents/deleteRequests',
    );
    final body = {
      'fields': {
        'email': {'stringValue': email},
        'status': {'stringValue': 'pending'},
        'createdAt': {'timestampValue': DateTime.now().toUtc().toIso8601String()},
      },
    };

    final res = await client.post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(body),
    );
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw Exception('Firestore write failed (${res.statusCode}): ${res.body.substring(0, res.body.length.clamp(0, 200))}');
    }
  }

  void close() {
    _authClient?.close();
    _http.close();
  }
}
