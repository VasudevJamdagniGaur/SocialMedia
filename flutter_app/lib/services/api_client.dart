import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/env.dart';

/// Mirrors src/services/apiClient.js — always uses [Env.baseUrl] (`BACKEND_URL`).
String get baseUrl => Env.baseUrl;

Future<Map<String, dynamic>> fetchJson(
  String path, {
  String method = 'POST',
  Map<String, dynamic>? body,
  Map<String, String>? headers,
  http.Client? client,
}) async {
  final finalPath = path.startsWith('/') ? path : '/$path';
  final url = Uri.parse('$baseUrl$finalPath');
  final c = client ?? http.Client();

  try {
    late http.Response res;
    final allHeaders = {'Content-Type': 'application/json', ...?headers};

    switch (method.toUpperCase()) {
      case 'GET':
        res = await c.get(url, headers: allHeaders);
        break;
      case 'PUT':
        res = await c.put(url, headers: allHeaders, body: body != null ? jsonEncode(body) : null);
        break;
      case 'DELETE':
        res = await c.delete(url, headers: allHeaders, body: body != null ? jsonEncode(body) : null);
        break;
      default:
        res = await c.post(url, headers: allHeaders, body: body != null ? jsonEncode(body) : null);
    }

    final text = res.body;
    Map<String, dynamic> data = {};
    try {
      data = text.isNotEmpty ? jsonDecode(text) as Map<String, dynamic> : {};
    } catch (_) {
      throw Exception(
        'Backend returned non-JSON (${res.statusCode}) from $url: ${text.length > 240 ? text.substring(0, 240) : text}',
      );
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      final msg = data['error'] ?? data['message'] ?? text;
      throw Exception(msg is String ? msg : jsonEncode(msg));
    }

    return data;
  } catch (e) {
    if (e is Exception) rethrow;
    throw Exception('Network error calling backend ($url): $e');
  }
}
