import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';

import '../config.dart';
import '../utils/http_utils.dart';
import 'news_routes.dart';

/// Spicy Tea feed: Bollywood gossip, cricket/football drama, viral internet moments (India-first).
const _teaYouTubeQueries = [
  'bollywood gossip scandal drama india latest',
  'bollywood celebrity breakup affair controversy hindi',
  'bollywood insider tea spilled india entertainment',
  'IPL cricket gossip controversy drama india',
  'cricket team india gossip news controversy',
  'ISL indian super league football gossip news',
  'football soccer gossip viral india hindi',
  'tollywood kollywood sandalwood gossip scandal india',
  'bigg boss india drama gossip hindi',
  'india viral trend today social media famous',
  'trending india viral video meme internet',
  'indian celebrity spotted dating leaked news',
];

const _teaSpicySignals = [
  'gossip',
  'scandal',
  'controversy',
  'drama',
  'viral',
  'trending',
  'meme',
  'feud',
  'breakup',
  'affair',
  'leaked',
  'spotted',
  'dating',
  'exclusive',
  'exposed',
  'fight',
  'slams',
  'roast',
  'inside',
  'truth',
  'spicy',
  'tea',
  'rumour',
  'rumor',
];

const _internationalTeaSignals = [
  'hollywood',
  'kardashian',
  'taylor swift',
  'nba ',
  ' nfl',
  'uk royal',
  'white house',
  'fox news',
  'cnn breaking',
  'k-pop',
  'kpop',
  'marvel studios',
  'disney world',
  'eurovision',
  'grammy awards',
];

const _indianTeaSignals = [
  'bollywood',
  'india',
  'indian',
  'hindi',
  'cricket',
  'ipl',
  'bcci',
  'football',
  'soccer',
  'isl',
  'tollywood',
  'kollywood',
  'sandalwood',
  'mumbai',
  'delhi',
  'bigg boss',
  'filmfare',
  'box office',
  'crore',
  'lakh',
  'virat',
  'dhoni',
  'rohit sharma',
  'ind vs',
  'india vs',
  'star sports',
  'hotstar',
  'messi',
  'ronaldo',
  'neymar',
  'team india',
  'wicket',
  'premier league',
  'champions league',
];

const _bollywoodTeaTopicKeywords = [
  'bollywood',
  'movie',
  'film',
  'actor',
  'actress',
  'box office',
  'trailer',
  'release',
  'cricket',
  'ipl',
  'football',
  'soccer',
  'celebrity',
  'gossip',
  'scandal',
  'controversy',
  'viral',
  'trending',
  'hindi',
  'tollywood',
  'kollywood',
  'bigg boss',
];

const _hubVerticalYouTubeQueries = <String, List<String>>{
  'sports': [
    'IPL cricket highlights news india',
    'cricket gossip controversy india latest',
    'football soccer ISL news india',
    'Formula 1 F1 race highlights news',
    'chess india tournament news',
    'sports viral moments india',
  ],
  'ai-tech': [
    'artificial intelligence AI news latest',
    'ChatGPT OpenAI Google Gemini AI news',
    'tech startup news india latest',
    'coding developer programming tools news',
    'Nvidia Apple Microsoft big tech news',
    'vibe coding AI tools news',
  ],
  'entrepreneurship': [
    'startup news india funding latest',
    'entrepreneur founder story india',
    'venture capital startup unicorn news',
    'business startup success india hindi',
    'SMB founder playbook india',
  ],
  'current-affairs': [
    'india news today breaking latest',
    'world news today latest headlines',
    'india politics news latest',
    'india economy RBI news latest',
    'climate environment news india',
  ],
};

const _hubVerticalSignals = <String, List<String>>{
  'sports': [
    'cricket', 'ipl', 'football', 'soccer', 'f1', 'formula', 'chess', 'sport',
    'wicket', 'goal', 'match', 'tennis', 'badminton', 'bcci', 'isl',
  ],
  'ai-tech': [
    'ai', 'artificial intelligence', 'tech', 'startup', 'chatgpt', 'openai',
    'google', 'microsoft', 'nvidia', 'coding', 'software', 'developer', 'gemini',
    'llm', 'machine learning', 'robot',
  ],
  'entrepreneurship': [
    'startup', 'founder', 'entrepreneur', 'funding', 'venture', 'business',
    'unicorn', 'invest', 'revenue', 'ceo', 'bootstrap', 'pitch',
  ],
  'current-affairs': [
    'news', 'politic', 'econom', 'climate', 'india', 'world', 'government',
    'election', 'parliament', 'budget', 'minister', 'diplomat',
  ],
};

bool _isRelevantHubVerticalYouTubeContent(
  String vertical, {
  required String title,
  String description = '',
  String channel = '',
}) {
  if (title.trim().isEmpty) return false;
  final blob = '$title $description $channel'.toLowerCase();
  final signals = _hubVerticalSignals[vertical];
  if (signals == null || signals.isEmpty) return true;
  return signals.any((s) => blob.contains(s));
}

bool _isRelevantIndianTeaYouTubeContent({
  required String title,
  String description = '',
  String channel = '',
}) {
  final blob = '$title $description $channel'.toLowerCase();
  if (blob.trim().isEmpty) return false;

  final hasTeaLean = _indianTeaSignals.any((s) => blob.contains(s)) ||
      _bollywoodTeaTopicKeywords.any((kw) => blob.contains(kw)) ||
      _teaSpicySignals.any((s) => blob.contains(s));
  if (!hasTeaLean) return false;

  final looksInternational = _internationalTeaSignals.any((s) => blob.contains(s));
  if (looksInternational && !hasTeaLean) return false;
  return true;
}

String _teaYouTubePublishedAfter() {
  return DateTime.now()
      .toUtc()
      .subtract(const Duration(days: 14))
      .toIso8601String()
      .replaceFirst(RegExp(r'\.\d+'), '');
}

Router buildYouTubeRouter() {
  final router = Router();

  router.get('/api/youtube/tea', (Request req) async {
    if (req.method == 'OPTIONS') return Response(204, headers: apiCorsHeaders);

    final apiKey = ServerConfig.youtubeApiKey;
    if (apiKey == null || apiKey.isEmpty) {
      return jsonOk({
        'ok': false,
        'items': [],
        'error': 'youtube_not_configured',
      }, status: 503, headers: apiCorsHeaders);
    }

    final maxKeep = (int.tryParse(req.url.queryParameters['limit'] ?? '') ?? 18).clamp(6, 30);
    final seen = <String>{};
    final rows = <Map<String, dynamic>>[];
    const perQuery = 5;

    for (final query in _teaYouTubeQueries) {
      try {
        final searchUri = Uri.parse('https://www.googleapis.com/youtube/v3/search').replace(
          queryParameters: {
            'part': 'snippet',
            'type': 'video',
            'order': 'date',
            'q': query,
            'maxResults': '$perQuery',
            'regionCode': 'IN',
            'relevanceLanguage': 'hi',
            'publishedAfter': _teaYouTubePublishedAfter(),
            'key': apiKey,
          },
        );
        final searchRes = await http.get(
          searchUri,
          headers: {'Accept': 'application/json'},
        );
        if (searchRes.statusCode != 200) continue;
        final searchBody = jsonDecode(searchRes.body);
        if (searchBody is! Map) continue;
        final items = searchBody['items'];
        if (items is! List) continue;

        final videoIds = <String>[];
        for (final item in items) {
          if (item is! Map) continue;
          final idObj = item['id'];
          if (idObj is! Map) continue;
          final vid = '${idObj['videoId'] ?? ''}'.trim();
          if (vid.isEmpty || seen.contains(vid)) continue;
          videoIds.add(vid);
        }
        if (videoIds.isEmpty) continue;

        final statsUri = Uri.parse('https://www.googleapis.com/youtube/v3/videos').replace(
          queryParameters: {
            'part': 'statistics,snippet',
            'id': videoIds.join(','),
            'key': apiKey,
          },
        );
        final statsRes = await http.get(
          statsUri,
          headers: {'Accept': 'application/json'},
        );
        if (statsRes.statusCode != 200) continue;
        final statsBody = jsonDecode(statsRes.body);
        final statItems = statsBody is Map ? statsBody['items'] : null;
        if (statItems is! List) continue;

        for (final statItem in statItems) {
          if (statItem is! Map) continue;
          final vid = '${statItem['id'] ?? ''}'.trim();
          if (vid.isEmpty || seen.contains(vid)) continue;
          final snippet = statItem['snippet'];
          if (snippet is! Map) continue;
          final s = Map<String, dynamic>.from(snippet);
          final title = '${s['title'] ?? ''}'.trim();
          if (title.isEmpty) continue;

          final description = '${s['description'] ?? ''}'.trim();
          final channel = '${s['channelTitle'] ?? 'YouTube'}'.trim();
          if (!_isRelevantIndianTeaYouTubeContent(
            title: title,
            description: description,
            channel: channel,
          )) {
            continue;
          }

          final gossip = description.length > 320
              ? '${description.substring(0, 320).trimRight()}…'
              : (description.isNotEmpty ? description : title);
          final thumbs = s['thumbnails'] is Map ? s['thumbnails'] as Map : null;
          String? image;
          if (thumbs != null) {
            for (final key in ['maxres', 'high', 'medium', 'default']) {
              final entry = thumbs[key];
              if (entry is Map && '${entry['url'] ?? ''}'.startsWith('http')) {
                image = '${entry['url']}';
                break;
              }
            }
          }
          final stats = statItem['statistics'] is Map
              ? Map<String, dynamic>.from(statItem['statistics'] as Map)
              : <String, dynamic>{};
          final views = int.tryParse('${stats['viewCount'] ?? '0'}') ?? 0;
          final comments = int.tryParse('${stats['commentCount'] ?? '0'}') ?? 0;

          seen.add(vid);
          rows.add({
            'title': title,
            'url': 'https://www.youtube.com/watch?v=$vid',
            'image': image,
            'thumbnail': image,
            'score': views,
            'num_comments': comments,
            'author': channel.isNotEmpty ? channel : 'YouTube',
            'source': 'YouTube',
            'description': gossip,
            'gossip': gossip,
            'selftext': description.isNotEmpty ? description : title,
            'videoId': vid,
          });
        }
      } catch (_) {}
    }

    rows.sort((a, b) {
      final sa = a['score'] is num ? (a['score'] as num).toInt() : 0;
      final sb = b['score'] is num ? (b['score'] as num).toInt() : 0;
      return sb.compareTo(sa);
    });

    return jsonOk({
      'ok': true,
      'items': rows.take(maxKeep).toList(),
    }, headers: apiCorsHeaders);
  });

  router.get('/api/youtube/hub', (Request req) async {
    if (req.method == 'OPTIONS') return Response(204, headers: apiCorsHeaders);

    final apiKey = ServerConfig.youtubeApiKey;
    if (apiKey == null || apiKey.isEmpty) {
      return jsonOk({
        'ok': false,
        'items': [],
        'error': 'youtube_not_configured',
      }, status: 503, headers: apiCorsHeaders);
    }

    final vertical = (req.url.queryParameters['vertical'] ?? '').trim().toLowerCase();
    final queries = _hubVerticalYouTubeQueries[vertical];
    if (queries == null || queries.isEmpty) {
      return jsonOk({
        'ok': false,
        'error': 'Invalid vertical',
      }, status: 400, headers: apiCorsHeaders);
    }

    final maxKeep = (int.tryParse(req.url.queryParameters['limit'] ?? '') ?? 12).clamp(6, 30);
    final seen = <String>{};
    final rows = <Map<String, dynamic>>[];
    const perQuery = 5;

    for (final query in queries) {
      try {
        final searchUri = Uri.parse('https://www.googleapis.com/youtube/v3/search').replace(
          queryParameters: {
            'part': 'snippet',
            'type': 'video',
            'order': 'date',
            'q': query,
            'maxResults': '$perQuery',
            'regionCode': 'IN',
            'relevanceLanguage': 'en',
            'publishedAfter': _teaYouTubePublishedAfter(),
            'key': apiKey,
          },
        );
        final searchRes = await http.get(
          searchUri,
          headers: {'Accept': 'application/json'},
        );
        if (searchRes.statusCode != 200) continue;
        final searchBody = jsonDecode(searchRes.body);
        if (searchBody is! Map) continue;
        final items = searchBody['items'];
        if (items is! List) continue;

        final videoIds = <String>[];
        for (final item in items) {
          if (item is! Map) continue;
          final idObj = item['id'];
          if (idObj is! Map) continue;
          final vid = '${idObj['videoId'] ?? ''}'.trim();
          if (vid.isEmpty || seen.contains(vid)) continue;
          videoIds.add(vid);
        }
        if (videoIds.isEmpty) continue;

        final statsUri = Uri.parse('https://www.googleapis.com/youtube/v3/videos').replace(
          queryParameters: {
            'part': 'statistics,snippet',
            'id': videoIds.join(','),
            'key': apiKey,
          },
        );
        final statsRes = await http.get(
          statsUri,
          headers: {'Accept': 'application/json'},
        );
        if (statsRes.statusCode != 200) continue;
        final statsBody = jsonDecode(statsRes.body);
        final statItems = statsBody is Map ? statsBody['items'] : null;
        if (statItems is! List) continue;

        for (final statItem in statItems) {
          if (statItem is! Map) continue;
          final vid = '${statItem['id'] ?? ''}'.trim();
          if (vid.isEmpty || seen.contains(vid)) continue;
          final snippet = statItem['snippet'];
          if (snippet is! Map) continue;
          final s = Map<String, dynamic>.from(snippet);
          final title = '${s['title'] ?? ''}'.trim();
          if (title.isEmpty) continue;

          final description = '${s['description'] ?? ''}'.trim();
          final channel = '${s['channelTitle'] ?? 'YouTube'}'.trim();
          if (!_isRelevantHubVerticalYouTubeContent(
            vertical,
            title: title,
            description: description,
            channel: channel,
          )) {
            continue;
          }

          final gossip = description.length > 320
              ? '${description.substring(0, 320).trimRight()}…'
              : (description.isNotEmpty ? description : title);
          final thumbs = s['thumbnails'] is Map ? s['thumbnails'] as Map : null;
          String? image;
          if (thumbs != null) {
            for (final key in ['maxres', 'high', 'medium', 'default']) {
              final entry = thumbs[key];
              if (entry is Map && '${entry['url'] ?? ''}'.startsWith('http')) {
                image = '${entry['url']}';
                break;
              }
            }
          }
          final stats = statItem['statistics'] is Map
              ? Map<String, dynamic>.from(statItem['statistics'] as Map)
              : <String, dynamic>{};
          final views = int.tryParse('${stats['viewCount'] ?? '0'}') ?? 0;
          final comments = int.tryParse('${stats['commentCount'] ?? '0'}') ?? 0;

          seen.add(vid);
          rows.add({
            'title': title,
            'url': 'https://www.youtube.com/watch?v=$vid',
            'image': image,
            'thumbnail': image,
            'score': views,
            'num_comments': comments,
            'author': channel.isNotEmpty ? channel : 'YouTube',
            'source': 'YouTube',
            'description': gossip,
            'gossip': gossip,
            'selftext': description.isNotEmpty ? description : title,
            'videoId': vid,
          });
        }
      } catch (_) {}
    }

    rows.sort((a, b) {
      final sa = a['score'] is num ? (a['score'] as num).toInt() : 0;
      final sb = b['score'] is num ? (b['score'] as num).toInt() : 0;
      return sb.compareTo(sa);
    });

    return jsonOk({
      'ok': true,
      'items': rows.take(maxKeep).toList(),
    }, headers: apiCorsHeaders);
  });

  return router;
}
