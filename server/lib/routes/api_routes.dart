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
  if (platform == 'x') {
    return '''You are generating X (Twitter) posts from someone's personal reflection.

GOAL:
Create short, punchy, personality-driven tweets — same format as our news X suggestions.

CORE RULE:
Each tweet = ONE thought, ONE reaction, ONE moment. Do NOT dump the whole reflection into one tweet.

Requirements:

1. Generate between 3 and 6 tweets (one per distinct moment or angle in the reflection).

2. Each tweet MUST use a DIFFERENT style/tone. Use these exact "type" values (each at most once):
   funny, sarcastic, supportive, critical, relatable, shock, meme, insight, question

3. Each tweet MUST:
   - Focus on ONE small slice of the reflection
   - Be 220 characters or fewer (including line breaks and hashtags)
   - Use 2–4 SHORT lines separated by real line breaks (\\n), not a single block of text
   - End with 0–2 hashtags on the last line when natural
   - Sound natural and human — first person, internet-native, reactive
   - Start with a strong hook on line 1

4. Ground truth — only what the reflection supports; do not invent facts.

Reflection:
$reflection

Output — return ONLY valid JSON (no markdown fences):
{"posts":[{"eventLabel":"3-6 word hook title","type":"insight","content":"line1\\nline2\\nline3\\n#Tag"}]}

Rules:
- "eventLabel": short purple-card title (3–6 words) naming the moment
- "content": ONLY publishable tweet text with \\n line breaks. Under 220 characters each.''';
  }

  final platformLabel =
      platform == 'x' ? 'X (Twitter)' : platform[0].toUpperCase() + platform.substring(1);

  if (platform == 'reddit') {
    return '''You are generating Reddit post suggestions from someone's personal reflection.

GOAL:
Create 3–5 distinct, authentic Reddit-style posts the user could publish.

QUANTITY (required):
- Output between 3 and 5 posts. Never only one unless the reflection is under ~15 words.

ANGLES (each post must feel different):
- vent / rant, funny / self-deprecating, advice-seeking, thoughtful take, community discussion starter

Each post:
- First person, casual, conversational — like r/CasualConversation or a personal story sub
- One clear angle per post; no corporate speak
- Ground truth only — do not invent facts beyond the reflection

Output format (strict):
- For each post: EVENT: <short angle label, 3–6 words>
- Then the full post text on following lines
- Separate posts with a line containing only: ---

Reflection:
$reflection''';
  }

  return '''You are generating $platformLabel post suggestions from someone's personal reflection.

GOAL:
Create 3–5 high-quality, diverse posts the user could publish on $platformLabel.

QUANTITY (required):
- Generate between 3 and 5 posts. Pick a natural count.
- Never output only one post unless the reflection is extremely short (under ~15 words).
- Even for a single topic, use different angles (personal reaction, insight/lesson, contrarian take, practical tip, question/CTA).

MULTIPLE EVENTS:
- If the reflection mentions several distinct moments, spread posts across them — do not merge unrelated events into one post.

Each post MUST:
- Use a distinct angle and hook — no near-duplicates
- Sound like a real $platformLabel post (professional for LinkedIn; not meta like "here's my post")
- Ground truth only — paraphrase facts from the reflection; do not invent personal history

Output format (strict):
- For each post: EVENT: <short angle or moment label, 3–6 words>
- Then the full post text on following lines
- Separate posts with a line containing only: ---

Reflection:
$reflection''';
}

List<Map<String, String>> _parseXContentSuggestionsJson(String raw, String reflection) {
  if (raw.trim().isEmpty) {
    return [
      {'eventLabel': 'Reflection', 'post': reflection},
    ];
  }

  dynamic parsed;
  final rawTrim = raw.trim();
  try {
    parsed = jsonDecode(rawTrim);
  } catch (_) {
    final fence = RegExp(r'```(?:json)?\s*([\s\S]*?)```', caseSensitive: false).firstMatch(rawTrim);
    final inner = (fence?.group(1) ?? rawTrim).trim();
    final objectMatch =
        RegExp(r'\{[\s\S]*"posts"[\s\S]*\}', caseSensitive: false, dotAll: true).firstMatch(inner);
    if (objectMatch == null) {
      return _parseSuggestionPosts(raw, reflection);
    }
    try {
      parsed = jsonDecode(objectMatch.group(0)!);
    } catch (_) {
      return _parseSuggestionPosts(raw, reflection);
    }
  }

  final list = parsed is List
      ? parsed
      : (parsed is Map && parsed['posts'] is List)
          ? parsed['posts'] as List
          : <dynamic>[];

  final posts = <Map<String, String>>[];
  for (final row in list) {
    if (row is! Map) continue;
    final content = row['content'] is String ? (row['content'] as String).trim() : '';
    final legacy = row['post'] is String ? (row['post'] as String).trim() : '';
    var post = content.isNotEmpty ? content : legacy;
    if (post.contains(r'\n')) {
      post = post.replaceAll(r'\n', '\n');
    }
    if (post.length > 220) {
      post = post.substring(0, 220).trimRight();
    }
    if (post.length < 5) continue;

    var eventLabel = row['eventLabel'] is String ? (row['eventLabel'] as String).trim() : '';
    if (eventLabel.isEmpty) eventLabel = 'Moment';
    posts.add({'eventLabel': eventLabel, 'post': post});
  }

  return posts.isNotEmpty
      ? posts
      : [
          {'eventLabel': 'Reflection', 'post': reflection},
        ];
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
  final isX = platform == 'x';

  if (wantsStream && !isX) {
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
        'temperature': isX ? 0.78 : 0.5,
        'max_tokens': isX ? 3500 : 2400,
        if (isX) 'response_format': {'type': 'json_object'},
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
    final posts = isX
        ? _parseXContentSuggestionsJson(raw, reflection)
        : _parseSuggestionPosts(raw, reflection);
    return jsonOk({'posts': posts});
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
