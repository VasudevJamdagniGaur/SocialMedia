import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';

import '../config.dart';
import '../services/firestore_client.dart';
import '../utils/http_utils.dart';
import 'news_routes.dart' show apiCorsHeaders;

final _firestore = FirestoreClient();

/// OpenAI share suggestions — port of handleLinkedInSuggestions in functions/src/index.ts
Router buildSuggestionsRouter() {
  final router = Router();

  router.post('/api/linkedin/suggestions', _handleSuggestions);
  router.post('/suggestions', _handleSuggestions);

  return router;
}

String _buildSuggestionsPrompt(String reflection, String platform) {
  final platformLabel =
      platform == 'x' ? 'X (Twitter)' : platform[0].toUpperCase() + platform.substring(1);
  return '''You are turning a day's reflection into separate social posts. You MUST create one standalone post for EACH distinct event or moment mentioned in the reflection.

PLATFORM: $platformLabel. Write EVERY post in that platform's native style.

Cover every distinct event or moment from the reflection. Each post focuses on one event only.

Output format (strict):
- For each post, first write exactly: EVENT: <short event label>
- Then on the next lines write the full post text.
- Separate each post with a line that contains only: ---

Reflection:
$reflection''';
}

List<Map<String, String>> _parseSuggestionPosts(String raw, String reflection) {
  if (raw.trim().isEmpty) {
    return [
      {'eventLabel': 'Reflection', 'post': reflection},
    ];
  }

  var blocks = raw
      .split(RegExp(r'\n *--- *\n'))
      .map((s) => s.trim())
      .where((s) => s.isNotEmpty)
      .toList();
  if (blocks.length <= 1 && RegExp(r'EVENT:\s*', caseSensitive: false).allMatches(raw).length >= 2) {
    blocks = raw
        .split(RegExp(r'\s*EVENT:\s*', caseSensitive: false))
        .where((s) => s.trim().isNotEmpty)
        .map((p) => p.trim().startsWith('EVENT:') ? p : 'EVENT: $p')
        .toList();
  }

  final posts = <Map<String, String>>[];
  for (final block in blocks) {
    final m = RegExp(r'^EVENT:\s*(.+?)(?:\n|$)', caseSensitive: false).firstMatch(block);
    final eventLabel = m?.group(1)?.trim() ?? '';
    final post = m != null ? block.substring(block.indexOf('\n') + 1).trim() : block.trim();
    if (post.isNotEmpty) {
      posts.add({'eventLabel': eventLabel.isNotEmpty ? eventLabel : 'Moment', 'post': post});
    }
  }
  return posts.isNotEmpty
      ? posts
      : [
          {'eventLabel': 'Reflection', 'post': reflection},
        ];
}

Future<Response> _handleSuggestions(Request req) async {
  if (req.method == 'OPTIONS') return Response(204, headers: apiCorsHeaders);
  if (req.method != 'POST') return jsonError(405, 'Method not allowed');

  final body = await readJsonBody(req);
  if (body == null) return jsonError(400, 'Invalid JSON body');

  final reflection = (body['reflection'] as String? ?? '').trim();
  final platform = (body['platform'] as String? ?? 'linkedin').toLowerCase();
  if (reflection.isEmpty) return jsonError(400, 'Missing reflection');
  if (!['linkedin', 'x', 'reddit'].contains(platform)) {
    return jsonError(400, 'Invalid platform');
  }

  final apiKey = ServerConfig.openAiApiKey;
  if (apiKey == null || apiKey.isEmpty) {
    return jsonError(500, 'OPENAI_API_KEY is not set on backend');
  }

  final wantsStream = req.url.queryParameters['stream'] == '1';
  final prompt = _buildSuggestionsPrompt(reflection, platform);

  if (wantsStream) {
    return _streamSuggestions(apiKey, prompt);
  }

  try {
    final res = await http.post(
      Uri.parse('https://api.openai.com/v1/chat/completions'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $apiKey',
      },
      body: jsonEncode({
        'model': 'gpt-4o',
        'messages': [
          {'role': 'user', 'content': prompt},
        ],
        'temperature': 0.5,
        'max_tokens': 2400,
      }),
    );
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return jsonError(
        500,
        'OpenAI error ${res.statusCode}',
        details: res.body.substring(0, res.body.length.clamp(0, 150)),
      );
    }
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    final raw =
        ((data['choices'] as List?)?.first as Map?)?['message']?['content'] as String? ?? '';
    return jsonOk({'posts': _parseSuggestionPosts(raw, reflection)});
  } catch (e) {
    return jsonError(500, 'Suggestions failed', details: '$e');
  }
}

Response _streamSuggestions(String apiKey, String prompt) {
  final controller = StreamController<List<int>>();

  Future<void> run() async {
    final client = http.Client();
    try {
      controller.add(utf8.encode('event: ready\ndata: ${jsonEncode({'ok': true})}\n\n'));

      final request = http.Request('POST', Uri.parse('https://api.openai.com/v1/chat/completions'))
        ..headers['Content-Type'] = 'application/json'
        ..headers['Authorization'] = 'Bearer $apiKey'
        ..body = jsonEncode({
          'model': 'gpt-4o',
          'messages': [
            {'role': 'user', 'content': prompt},
          ],
          'temperature': 0.5,
          'max_tokens': 2400,
          'stream': true,
        });

      final res = await client.send(request);
      if (res.statusCode < 200 || res.statusCode >= 300) {
        controller.add(utf8.encode(
          'event: error\ndata: ${jsonEncode({'error': 'OpenAI error ${res.statusCode}'})}\n\n',
        ));
        return;
      }

      var buf = '';
      var full = '';
      await for (final chunk in res.stream.transform(utf8.decoder)) {
        buf += chunk;
        var idx = buf.indexOf('\n\n');
        while (idx != -1) {
          final frame = buf.substring(0, idx);
          buf = buf.substring(idx + 2);
          for (final line in frame.split('\n')) {
            final trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            final payload = trimmed.substring(5).trim();
            if (payload.isEmpty || payload == '[DONE]') {
              if (payload == '[DONE]') {
                controller.add(utf8.encode(
                  'event: done\ndata: ${jsonEncode({'raw': full.trim()})}\n\n',
                ));
              }
              continue;
            }
            try {
              final j = jsonDecode(payload) as Map<String, dynamic>;
              final choices = j['choices'];
              String? delta;
              if (choices is List && choices.isNotEmpty && choices.first is Map) {
                final choiceDelta = (choices.first as Map)['delta'];
                if (choiceDelta is Map) delta = choiceDelta['content'] as String?;
              }
              if (delta != null && delta.isNotEmpty) {
                full += delta;
                controller.add(utf8.encode(
                  'event: delta\ndata: ${jsonEncode({'text': delta})}\n\n',
                ));
              }
            } catch (_) {
              // ignore malformed frames
            }
          }
          idx = buf.indexOf('\n\n');
        }
      }

      controller.add(utf8.encode('event: done\ndata: ${jsonEncode({'raw': full.trim()})}\n\n'));
    } catch (e) {
      controller.add(utf8.encode(
        'event: error\ndata: ${jsonEncode({'error': '$e'})}\n\n',
      ));
    } finally {
      client.close();
      await controller.close();
    }
  }

  unawaited(run());

  return Response.ok(
    controller.stream,
    headers: {
      ...apiCorsHeaders,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  );
}

/// Account deletion intake — port of functions/src/deleteAccountRequest.ts.
Router buildAccountRouter() {
  final router = Router();

  router.post('/deleteAccountRequest', _deleteAccount);
  router.post('/api/delete-account', _deleteAccount);

  return router;
}

Future<Response> _deleteAccount(Request req) async {
  if (req.method == 'OPTIONS') return Response(204, headers: apiCorsHeaders);
  if (req.method != 'POST') {
    return jsonOk({'success': false, 'error': 'Method not allowed'}, status: 405);
  }
  final body = await readJsonBody(req);
  if (body == null) {
    return jsonOk({'success': false, 'error': 'Invalid JSON body'}, status: 400);
  }
  final email = (body['email'] as String? ?? '').trim().toLowerCase();
  if (email.isEmpty || !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(email)) {
    return jsonOk({'success': false, 'error': 'A valid email address is required'}, status: 400);
  }

  try {
    await _firestore.addDeleteRequest(email);
    stdout.writeln('[deleteAccountRequest] pending request stored: ${email.substring(0, 2)}***');
    return jsonOk({'success': true, 'message': 'Deletion request submitted'});
  } on StateError catch (e) {
    stdout.writeln('[deleteAccountRequest] no Firestore creds, logged only: $email ($e)');
    return jsonOk({'success': true, 'message': 'Deletion request received'});
  } catch (e) {
    stdout.writeln('[deleteAccountRequest] error: $e');
    return jsonOk(
      {'success': false, 'error': 'Could not submit your request. Please try again later.'},
      status: 500,
    );
  }
}
