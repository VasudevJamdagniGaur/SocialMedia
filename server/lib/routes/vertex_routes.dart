import 'dart:convert';

import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';

import '../config.dart';
import '../utils/http_utils.dart';
import '../vertex/vertex_client.dart';

Router buildVertexRouter(VertexClient vertex) {
  final router = Router();

  router.get('/health', (Request req) {
    return jsonOk({
      'ok': true,
      'project': ServerConfig.projectId,
      'location': ServerConfig.vertexLocation,
      'model': ServerConfig.vertexModel,
      'runtime': 'dart',
    });
  });

  router.post('/chat', (Request req) async {
    final body = await readJsonBody(req);
    if (body == null) return jsonError(400, 'Invalid JSON body');
    final message = body['message'];
    if (message is! String || message.trim().isEmpty) {
      return jsonError(400, 'Missing or invalid "message" (non-empty string required)');
    }
    final temperature = body['temperature'] is num ? (body['temperature'] as num).toDouble() : 0.65;
    final maxOut = body['maxOutputTokens'] is num ? (body['maxOutputTokens'] as num).toInt() : 2048;
    try {
      final reply = await vertex.generateText(
        message,
        temperature: temperature,
        maxOutputTokens: maxOut,
      );
      return jsonOk({'reply': reply});
    } catch (e) {
      return jsonError(500, 'Chat generation failed', details: '$e');
    }
  });

  router.post('/reflection', (Request req) async {
    final body = await readJsonBody(req);
    if (body == null) return jsonError(400, 'Invalid JSON body');
    final conversation = body['conversation'];
    String text = '';
    if (conversation is String) {
      text = conversation.trim();
    } else if (conversation != null) {
      text = jsonEncode(conversation);
    }
    if (text.isEmpty) return jsonError(400, 'Missing or invalid "conversation"');
    final prompt =
        'You are a thoughtful coach. Read the conversation below and write a short, supportive reflection (2–4 paragraphs) on themes, emotions, and growth opportunities. Do not lecture; be warm and specific.\n\nConversation:\n$text';
    try {
      final reflection = await vertex.generateText(prompt);
      return jsonOk({'reflection': reflection});
    } catch (e) {
      return jsonError(500, 'Reflection generation failed', details: '$e');
    }
  });

  router.post('/summary', (Request req) async {
    final body = await readJsonBody(req);
    if (body == null) return jsonError(400, 'Invalid JSON body');
    final text = body['text'];
    if (text is! String || text.trim().isEmpty) {
      return jsonError(400, 'Missing or invalid "text" (non-empty string required)');
    }
    final prompt =
        'Summarize the following content in clear, concise bullet points where appropriate. Preserve key facts and names.\n\nContent:\n${text.trim()}';
    try {
      final summary = await vertex.generateText(prompt, temperature: 0.3);
      return jsonOk({'summary': summary});
    } catch (e) {
      return jsonError(500, 'Summary generation failed', details: '$e');
    }
  });

  router.post('/analyze-pattern', (Request req) async {
    final body = await readJsonBody(req);
    if (body == null) return jsonError(400, 'Invalid JSON body');
    final data = body['data'];
    String payload = '';
    if (data is String) {
      payload = data.trim();
    } else if (data != null) {
      payload = jsonEncode(data);
    }
    if (payload.isEmpty) return jsonError(400, 'Missing or invalid "data"');
    final prompt =
        'You are an analyst. Examine the structured or unstructured data below. Identify patterns, anomalies, and actionable insights. Respond with clear sections: Overview, Patterns, Recommendations.\n\nData:\n$payload';
    try {
      final result = await vertex.generateText(prompt, temperature: 0.4, maxOutputTokens: 4096);
      return jsonOk({'result': result});
    } catch (e) {
      return jsonError(500, 'Pattern analysis failed', details: '$e');
    }
  });

  router.post('/generate-news-image', (Request req) async {
    final body = await readJsonBody(req);
    if (body == null) return jsonError(400, 'Invalid JSON body');
    final prompt = body['prompt'];
    if (prompt is! String || prompt.trim().isEmpty) {
      return jsonError(400, 'Missing or invalid "prompt" (non-empty string required)');
    }
    try {
      final referenceImage = body['referenceImage'];
      final String? imageDataUrl;
      if (referenceImage is Map &&
          referenceImage['base64'] is String &&
          '${referenceImage['base64']}'.trim().isNotEmpty) {
        imageDataUrl = await vertex.generatePublicFigureIllustrationImage(
          prompt,
          referenceImageBase64: '${referenceImage['base64']}',
          mimeType: referenceImage['mimeType'] is String
              ? '${referenceImage['mimeType']}'
              : 'image/jpeg',
        );
      } else {
        imageDataUrl = await vertex.generateNewsIllustrationImage(prompt);
      }
      if (imageDataUrl == null) {
        return jsonError(502, 'Image generation returned no image', details: 'Model did not return an image part');
      }
      return jsonOk({'imageDataUrl': imageDataUrl});
    } catch (e) {
      return jsonError(500, 'Image generation failed', details: '$e');
    }
  });

  router.post('/image-description', (Request req) async {
    final body = await readJsonBody(req);
    if (body == null) return jsonError(400, 'Invalid JSON body');
    final prompt = body['prompt'];
    if (prompt is! String || prompt.trim().isEmpty) {
      return jsonError(400, 'Missing or invalid "prompt"');
    }
    final full =
        'Describe a single detailed image that could illustrate the following (text only — do not claim to generate a binary image). Be vivid but concise (under 200 words).\n\nTopic:\n${prompt.trim()}';
    try {
      final description = await vertex.generateText(full, temperature: 0.8, maxOutputTokens: 1024);
      return jsonOk({'description': description});
    } catch (e) {
      return jsonError(500, 'Image description failed', details: '$e');
    }
  });

  router.post('/generateContent', (Request req) async {
    final body = await readJsonBody(req);
    if (body == null) return jsonError(400, 'Invalid JSON body');
    final prompt = body['prompt'];
    if (prompt is! String || prompt.trim().isEmpty) {
      return jsonError(400, 'Missing required field: "prompt"');
    }
    final temperature = body['temperature'] is num ? (body['temperature'] as num).toDouble() : 0.65;
    final maxOut = body['maxOutputTokens'] is num ? (body['maxOutputTokens'] as num).toInt() : 1024;
    try {
      final text = await vertex.generateText(
        prompt,
        temperature: temperature,
        maxOutputTokens: maxOut,
      );
      return jsonOk({
        'candidates': [
          {
            'content': {
              'role': 'model',
              'parts': [
                {'text': text},
              ],
            },
          },
        ],
      });
    } catch (e) {
      return jsonError(500, 'generateContent failed', details: '$e');
    }
  });

  router.post('/generatePost', (Request req) async {
    final body = await readJsonBody(req);
    if (body == null) return jsonError(400, 'Invalid JSON body');
    final news = body['news'];
    if (news is! String || news.trim().isEmpty) {
      return jsonError(400, 'Missing required field: "news"');
    }
    final prompt = 'Convert this news into a short engaging social media post:\n\n${news.trim()}';
    try {
      final post = await vertex.generateText(prompt, temperature: 0.7, maxOutputTokens: 1024);
      return jsonOk({'post': post});
    } catch (e) {
      return jsonError(500, 'generatePost failed', details: '$e');
    }
  });

  return router;
}
