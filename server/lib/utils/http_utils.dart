import 'dart:convert';

import 'package:shelf/shelf.dart';

Response jsonOk(Object? body, {int status = 200, Map<String, String>? headers}) =>
    Response(
      status,
      body: body == null ? null : jsonEncode(body),
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...?headers,
      },
    );

Response jsonError(int status, String message, {Object? details}) => jsonOk(
      {
        'error': message,
        if (details != null) 'details': details,
      },
      status: status,
    );

Future<Map<String, dynamic>?> readJsonBody(Request req) async {
  try {
    final text = await req.readAsString();
    if (text.trim().isEmpty) return {};
    final v = jsonDecode(text);
    if (v is Map<String, dynamic>) return v;
    if (v is Map) return Map<String, dynamic>.from(v);
    return null;
  } catch (_) {
    return null;
  }
}

String? queryParam(Request req, String key) {
  final v = req.url.queryParameters[key];
  return v?.trim().isNotEmpty == true ? v!.trim() : null;
}
