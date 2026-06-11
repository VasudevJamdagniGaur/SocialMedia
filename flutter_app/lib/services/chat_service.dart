import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../config/env.dart';
import '../lib/pod_reddit_hot.dart';
import '../utils/date_utils.dart';
import '../utils/decode_google_news_url.dart';
import '../utils/reddit_thread_comments.dart';
import '../utils/share_news_cache.dart';
import '../models/chat_message.dart';
import 'auth_service.dart';
import 'firestore_service.dart';
import 'vertex_api_client.dart';

typedef ApiProvider = String; // openai | gemini | grok
typedef ShareSuggestion = Map<String, String>;

class ChatService extends ChangeNotifier {
  ChatService._() {
    openaiApiKey = Env.openAiApiKey;
    grokApiKey = Env.grokApiKey;
    debugPrint('ðŸ”‘ API Keys loaded:');
    debugPrint(
      '  OpenAI: ${openaiApiKey.isNotEmpty ? '${openaiApiKey.substring(0, openaiApiKey.length < 10 ? openaiApiKey.length : 10)}... (${openaiApiKey.length} chars)' : 'NOT SET'}',
    );
    debugPrint(
      '  Gemini (Vertex backend): ${isVertexBackendConfigured() ? getVertexBackendBaseUrl() : 'NOT SET (REACT_APP_BACKEND_URL / REACT_APP_VERTEX_BACKEND_URL / REACT_APP_VERTEX_GEMINI_URL)'}',
    );
    debugPrint(
      '  Grok: ${grokApiKey.isNotEmpty ? '${grokApiKey.substring(0, grokApiKey.length < 10 ? grokApiKey.length : 10)}... (${grokApiKey.length} chars)' : 'NOT SET'}',
    );
    debugPrint('ðŸ” Environment variables check:');
    debugPrint('  REACT_APP_GROK_API_KEY exists: ${Env.grokApiKey.isNotEmpty}');
    debugPrint(
      '  REACT_APP_GROK_API_KEY value: ${Env.grokApiKey.isNotEmpty ? '${Env.grokApiKey.substring(0, Env.grokApiKey.length < 10 ? Env.grokApiKey.length : 10)}...' : 'undefined'}',
    );
  }

  static final ChatService instance = ChatService._();

  String openaiApiKey = '';
  String grokApiKey = '';
  ApiProvider apiProvider = 'openai';
  String openaiBaseURL = 'https://api.openai.com/v1';
  String grokBaseURL = 'https://api.x.ai/v1';
  String openaiModelName = 'gpt-4o';
  String geminiModelName = 'vertex-backend';
  String grokModelName = 'grok-3';
  String visionModelName = 'gpt-4o';

  static const String _providerKey = 'chat_api_provider';

  Future<void> loadSavedProvider() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_providerKey) ?? 'openai';
    setApiProvider(saved);
  }

  Future<void> persistProvider(String provider) async {
    setApiProvider(provider);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_providerKey, provider);
  }

  Future<String> cycleProvider() async {
    final nextProvider = apiProvider == 'openai'
        ? 'gemini'
        : (apiProvider == 'gemini' ? 'grok' : 'openai');
    await persistProvider(nextProvider);
    return nextProvider;
  }

  void setApiProvider(String provider) {
    if (provider == 'openai' || provider == 'gemini' || provider == 'grok') {
      apiProvider = provider;
      debugPrint('ðŸ”„ API Provider switched to: $provider');
      notifyListeners();
    } else {
      debugPrint('âš ï¸ Invalid API provider: $provider');
    }
  }

  String getApiKey() {
    if (apiProvider == 'openai') return openaiApiKey;
    if (apiProvider == 'gemini') return '';
    if (apiProvider == 'grok') return grokApiKey;
    return openaiApiKey;
  }

  String getBaseURL() {
    if (apiProvider == 'openai') return openaiBaseURL;
    if (apiProvider == 'gemini') return getVertexBackendBaseUrl();
    if (apiProvider == 'grok') return grokBaseURL;
    return openaiBaseURL;
  }

  String getModelName() {
    if (apiProvider == 'openai') return openaiModelName;
    if (apiProvider == 'gemini') return geminiModelName;
    if (apiProvider == 'grok') return grokModelName;
    return openaiModelName;
  }

  String getVertexGeminiUrl() {
    return getVertexBackendBaseUrl();
  }

  Future<String> callVertexGenerateContent({
    required String prompt,
    double temperature = 0.65,
    int maxOutputTokens = 1024,
    Object? signal,
  }) async {
    return vertexGenerateContent(
      prompt: prompt,
      temperature: temperature,
      maxOutputTokens: maxOutputTokens,
    );
  }

  String _buildReflectionShareSuggestionsPrompt(
    String? reflection,
    String platform,
  ) {
    final platformLabel = platform == 'x'
        ? 'X (Twitter)'
        : (platform.isEmpty
              ? ''
              : '${platform.substring(0, 1).toUpperCase()}${platform.substring(1)}');

    final platformStyleGuide = <String, String>{
      'linkedin': '''LINKEDIN STYLE (strict â€” follow all):

UNIQUE INSIGHT (do not merely summarize the day):
- Derive a sharp insight from what they wrote: client or colleague questions, building in public, tensions, tradeoffs, or lessons learned.
- Personal backstory or biography: ONLY if the user explicitly said it in the reflection below. Paraphrase only facts they stated. If nothing relevant appears, omit backstory entirely â€” never invent or assume a past.

ONE POST = ONE IDEA (journalist mindset):
- Each post has one clear angle and one main takeaway, like a strong lead â€” not a laundry list of unrelated points.

STRUCTURE (skimmable):
- Write for skimmers: short paragraphs, optional bullet points, or a tight framework when it fits (e.g. Problem â†’ tension â†’ lesson, or a short story arc to one point). Plain, simple language.

HOOK (first ~2 lines are critical):
- Open with something that earns the scroll: a number, direct address ("you"), a striking detail from THEIR reflection, or a sharp question. The hook must match the single idea.

DELIVER + CLOSE:
- The body must fulfill the hookâ€™s promise. End with a clear call to action (one question, comment prompt, or one concrete next step).

POLISH:
- First person where natural. 0â€“3 relevant hashtags (e.g. #Learning). No meta ("hereâ€™s my LinkedIn post"). Emoji only if light and natural.''',
      'x': '''X (TWITTER) STYLE (strict):
- Very concise. Each post MUST be under 220 characters (count them).
- Punchy, direct. Use 2–4 short lines with real line breaks between them.
- End with 0–2 hashtags on the last line when natural.
- Can be witty, candid, or reflective. Emoji sparingly if at all.''',
      'reddit': '''REDDIT STYLE (strict):
- Casual, conversational, like r/CasualConversation or a personal story sub.
- First-person, relatable, authentic. Can be self-deprecating or funny.
- Natural paragraph flow. No corporate speak. Feels like talking to a friend.''',
    };

    final styleGuide = platformStyleGuide[platform] ?? platformStyleGuide['linkedin']!;
    final linkedinReflectionExtra = platform == 'linkedin'
        ? '''
LinkedIn (extra â€” every post):
- Again: no invented personal history. Backstory only when the reflection explicitly contains it.
- Hook in the opening lines; skimmable middle; explicit CTA at the end.
'''
        : '';

    final linkedInPerEventLine = platform == 'linkedin'
        ? '''
- For LinkedIn: one clear angle per post; strong hook in the first two lines; skimmable structure (short paragraphs and/or bullets); deliver on the hook; end with a CTA; never fabricate backstory not present in the reflection'''
        : '';

    return '''You are turning a day's reflection into separate social posts. You MUST create one standalone post for EACH distinct event or moment mentioned in the reflection.

PLATFORM: $platformLabel. Write EVERY post in that platform's native style so it reads like a real $platformLabel post.

$styleGuide
$linkedinReflectionExtra
Step 1 â€“ List EVERY main event/moment in the reflection. Include ALL of these when present:
- Embarrassing or funny moments (e.g. wrong door, mix-up, mistake)
- Books, articles, or media mentioned by name (e.g. "The Three-Body Problem", "Source Code", "Crime and Punishment")
- People you met or talked about
- Places you went (e.g. library, office, college)
- Work or projects you did (e.g. deep work, project in the library)
Do not skip any major event. If the user mentions a book, there must be a post about that book. If they mention a mix-up and a book, output two posts (one per event).

Step 2 â€“ For EACH event you listed, write ONE complete, standalone post that:
- Focuses only on that single event
- Expands on the thoughts, emotions, or insights from that moment
- Feels natural and reflective, like a real social post (not a dry summary)$linkedInPerEventLine
- Is written EXACTLY in the $platformLabel style described above (tone, length, structure)

Output format (strict):
- For each post, first write exactly: EVENT: <short event label>
- Then on the next lines write the full post text.
- Separate each post with a line that contains only: ---
- Do NOT use "Option 1", "Option 2", or any option labels. Only EVENT: and the post content.

Example format (reflection mentioned a mix-up AND a book):
EVENT: The Director's office mix-up
[Full post about that moment only.]

---
EVENT: Reading The Three-Body Problem
[Full post about the book and your thoughts only.]

Reflection:
${(reflection ?? '').trim()}''';
  }

  List<ShareSuggestion> _parseShareSuggestionModelOutput(
    String? trimmed,
    String? reflection,
  ) {
    final reflectionTrim = (reflection ?? '').trim();
    if ((trimmed ?? '').isEmpty) {
      return [
        {'eventLabel': 'Reflection', 'post': reflectionTrim},
      ];
    }

    var blocks = (trimmed ?? '')
        .split(RegExp(r'\n *--- *\n'))
        .map((s) => s.trim())
        .where((s) => s.isNotEmpty)
        .toList();

    if (blocks.length <= 1 &&
        RegExp(r'EVENT:\s*', caseSensitive: false).allMatches(trimmed ?? '').length >= 2) {
      final eventParts =
          (trimmed ?? '').split(RegExp(r'\s*EVENT:\s*', caseSensitive: false));
      blocks = eventParts
          .map((p) => p.trim())
          .where((p) => p.isNotEmpty)
          .map((p) => RegExp(r'^EVENT:', caseSensitive: false).hasMatch(p) ? p : 'EVENT: $p')
          .toList();
    }

    final result = <ShareSuggestion>[];
    for (final block in blocks) {
      final eventMatch =
          RegExp(r'^EVENT:\s*(.+?)(?:\n|$)', caseSensitive: false).firstMatch(block);
      final eventLabel = eventMatch != null ? (eventMatch.group(1) ?? '').trim() : '';
      final post = eventMatch != null
          ? block.substring(block.indexOf('\n') + 1).trim()
          : block.trim();
      if (post.isNotEmpty) {
        result.add({'eventLabel': eventLabel.isEmpty ? 'Moment' : eventLabel, 'post': post});
      }
    }

    if (result.isEmpty) {
      return [
        {'eventLabel': 'Reflection', 'post': reflectionTrim},
      ];
    }
    return result;
  }

  bool hasUrl(String message) {
    final urlPattern =
        RegExp(r'(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}[^\s]*)', caseSensitive: false);
    return urlPattern.hasMatch(message);
  }

  List<String> extractUrls(String message) {
    final urlPattern = RegExp(
      r'(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}[^\s]*)',
      caseSensitive: false,
    );
    return urlPattern.allMatches(message).map((m) => m.group(0) ?? '').where((u) => u.isNotEmpty).toList();
  }

  Future<String> imageToBase64(dynamic file) async {
    if (file is Uint8List) {
      return base64Encode(file);
    }
    if (file is String) {
      if (file.contains(',')) return file.split(',')[1];
      return file;
    }
    throw Exception('Unsupported file type for imageToBase64');
  }

  Future<Map<String, dynamic>?> fetchUrlMetadata(String url) async {
    try {
      final decodedGoogleUrl = decodeGoogleNewsUrl(url);
      final normalizedUrl = decodedGoogleUrl ?? url;
      debugPrint('ðŸ”— Fetching metadata from URL: $normalizedUrl');

      final proxyUrl =
          'https://api.allorigins.win/get?url=${Uri.encodeComponent(normalizedUrl)}';
      final response = await _httpGet(proxyUrl, timeout: const Duration(seconds: 15));

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception('Failed to fetch page');
      }

      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final htmlContent = (data['contents'] ?? '').toString();

      final metadata = <String, dynamic>{
        'title': null,
        'description': null,
        'image': null,
        'videoUrl': null,
        'siteName': null,
      };

      final ogTitleMatch =
          RegExp(r'<meta\s+property="og:title"\s+content="([^"]+)"', caseSensitive: false)
              .firstMatch(htmlContent);
      final titleMatch =
          RegExp(r'<title>([^<]+)<\/title>', caseSensitive: false).firstMatch(htmlContent);
      if (ogTitleMatch != null) {
        metadata['title'] = ogTitleMatch.group(1);
      } else if (titleMatch != null) {
        metadata['title'] = titleMatch.group(1);
      }

      final descMatch = RegExp(
        r'<meta\s+property="og:description"\s+content="([^"]+)"',
        caseSensitive: false,
      ).firstMatch(htmlContent) ??
          RegExp(
            r'<meta\s+name="description"\s+content="([^"]+)"',
            caseSensitive: false,
          ).firstMatch(htmlContent);
      if (descMatch != null) {
        metadata['description'] = descMatch.group(1);
      }

      final videoMatch =
          RegExp(r'<meta\s+property="og:video"\s+content="([^"]+)"', caseSensitive: false)
              .firstMatch(htmlContent) ??
              RegExp(
                r'<meta\s+property="og:video:url"\s+content="([^"]+)"',
                caseSensitive: false,
              ).firstMatch(htmlContent);
      if (videoMatch != null) {
        metadata['videoUrl'] = videoMatch.group(1);
      }

      final imageMatch =
          RegExp(r'<meta\s+property="og:image"\s+content="([^"]+)"', caseSensitive: false)
              .firstMatch(htmlContent);
      if (imageMatch != null) {
        metadata['image'] = imageMatch.group(1);
      }

      final siteMatch =
          RegExp(r'<meta\s+property="og:site_name"\s+content="([^"]+)"', caseSensitive: false)
              .firstMatch(htmlContent);
      if (siteMatch != null) {
        metadata['siteName'] = siteMatch.group(1);
      }

      debugPrint('ðŸ”— Metadata extracted: $metadata');
      return metadata;
    } catch (error) {
      debugPrint('âŒ Error fetching URL metadata: $error');
      return null;
    }
  }

  bool isInstagramLink(String url) {
    final instagramPatterns = <RegExp>[
      RegExp(r'instagram\.com\/(reel|p|tv|stories)\/', caseSensitive: false),
      RegExp(r'instagram\.com\/[^\/]+\/(reel|p|tv)\/', caseSensitive: false),
    ];
    return instagramPatterns.any((pattern) => pattern.hasMatch(url));
  }

  bool isSocialMediaLink(String url) {
    final socialPatterns = <RegExp>[
      RegExp(r'instagram\.com\/(reel|p|tv)\/', caseSensitive: false),
      RegExp(r'twitter\.com\/', caseSensitive: false),
      RegExp(r'x\.com\/', caseSensitive: false),
      RegExp(r'tiktok\.com\/', caseSensitive: false),
      RegExp(r'reddit\.com\/', caseSensitive: false),
      RegExp(r'youtube\.com\/', caseSensitive: false),
      RegExp(r'youtu\.be\/', caseSensitive: false),
      RegExp(r'facebook\.com\/', caseSensitive: false),
      RegExp(r'imgur\.com\/', caseSensitive: false),
      RegExp(r'9gag\.com\/', caseSensitive: false),
    ];
    return socialPatterns.any((pattern) => pattern.hasMatch(url));
  }

  Future<Map<String, dynamic>?> fetchInstagramPostData(String instagramUrl) async {
    try {
      debugPrint('ðŸ“¸ Fetching Instagram post data from Ensemble Data API: $instagramUrl');

      final apiUrl =
          'https://api.ensembledata.com/instagram/post?url=${Uri.encodeComponent(instagramUrl)}';
      final response = await _httpGet(
        apiUrl,
        headers: {'X-API-Key': 'XxrDGV8x0zDWIg2Y'},
        timeout: const Duration(seconds: 20),
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        final errorText = response.body;
        debugPrint('âŒ Ensemble Data API error: ${response.statusCode} $errorText');
        throw Exception('API request failed: ${response.statusCode}');
      }

      final data = jsonDecode(response.body) as Map<String, dynamic>;
      debugPrint('âœ… Instagram post data received from API');
      final serialized = jsonEncode(data);
      debugPrint(
        'ðŸ“¸ Full API response structure: ${serialized.substring(0, serialized.length.clamp(0, 1000).toInt())}',
      );

      final postData = <String, dynamic>{
        'caption': data['caption'] ?? data['description'] ?? data['text'],
        'comments': <Map<String, dynamic>>[],
        'user': {
          'username': (data['user'] is Map ? (data['user'] as Map)['username'] : null) ??
              data['username'] ??
              (data['author'] is Map ? (data['author'] as Map)['username'] : null) ??
              (data['owner'] is Map ? (data['owner'] as Map)['username'] : null),
          'profilePicture': (data['user'] is Map
                  ? ((data['user'] as Map)['profile_picture'] ??
                      (data['user'] as Map)['profile_pic_url'])
                  : null) ??
              data['profile_picture'] ??
              data['profile_pic_url'],
          'followers': (data['user'] is Map
                  ? ((data['user'] as Map)['followers'] ??
                      (data['user'] as Map)['follower_count'])
                  : null) ??
              data['followers'],
        },
        'images': <dynamic>[],
        'videos': <dynamic>[],
        'type': data['type'] ?? data['media_type'] ?? 'unknown',
      };

      if (data['images'] is List) {
        postData['images'] = (data['images'] as List).take(3).toList();
      } else if (data['image'] != null) {
        postData['images'] = [data['image']];
      } else if (data['thumbnail'] != null) {
        postData['images'] = [data['thumbnail']];
      } else if (data['display_url'] != null) {
        postData['images'] = [data['display_url']];
      } else if (data['media'] is List) {
        final mediaUrls = (data['media'] as List)
            .where((item) => item is Map && (item['type'] == 'image' || item['type'] == 'photo'))
            .map((item) => (item as Map)['url'] ?? item['display_url'] ?? item['thumbnail_url'])
            .where((item) => item != null)
            .take(3)
            .toList();
        postData['images'] = mediaUrls;
      }

      if (data['videos'] is List) {
        postData['videos'] = (data['videos'] as List).take(3).toList();
      } else if (data['video'] != null) {
        postData['videos'] = [data['video']];
      } else if (data['video_url'] != null) {
        postData['videos'] = [data['video_url']];
      } else if (data['media'] is List) {
        final videoUrls = (data['media'] as List)
            .where((item) => item is Map && item['type'] == 'video')
            .map((item) => (item as Map)['url'] ?? item['video_url'])
            .where((item) => item != null)
            .take(3)
            .toList();
        postData['videos'] = videoUrls;
      }

      if (data['comments'] is List) {
        postData['comments'] = (data['comments'] as List).map<Map<String, dynamic>>((comment) {
          if (comment is String) {
            return {'text': comment, 'username': 'unknown', 'likes': 0};
          }
          if (comment is Map) {
            final userMap = comment['user'] is Map ? comment['user'] as Map : null;
            final authorMap = comment['author'] is Map ? comment['author'] as Map : null;
            final ownerMap = comment['owner'] is Map ? comment['owner'] as Map : null;
            return {
              'text': comment['text'] ??
                  comment['comment'] ??
                  comment['body'] ??
                  comment['content'] ??
                  comment.toString(),
              'username': comment['username'] ??
                  userMap?['username'] ??
                  authorMap?['username'] ??
                  ownerMap?['username'] ??
                  'unknown',
              'likes': comment['likes'] ?? comment['like_count'] ?? comment['likes_count'] ?? 0,
            };
          }
          return {'text': comment.toString(), 'username': 'unknown', 'likes': 0};
        }).toList();
      } else if (data['comments'] is Map) {
        final commentsMap = data['comments'] as Map;
        final commentsArray = commentsMap['data'] ?? commentsMap['comments'] ?? <dynamic>[];
        if (commentsArray is List) {
          postData['comments'] = commentsArray.map<Map<String, dynamic>>((comment) {
            if (comment is Map) {
              final userMap = comment['user'] is Map ? comment['user'] as Map : null;
              final authorMap = comment['author'] is Map ? comment['author'] as Map : null;
              return {
                'text': comment['text'] ??
                    comment['comment'] ??
                    comment['body'] ??
                    comment['content'] ??
                    comment.toString(),
                'username':
                    comment['username'] ?? userMap?['username'] ?? authorMap?['username'] ?? 'unknown',
                'likes': comment['likes'] ?? comment['like_count'] ?? 0,
              };
            }
            return {'text': comment.toString(), 'username': 'unknown', 'likes': 0};
          }).toList();
        }
      }

      debugPrint(
        'ðŸ“¸ Extracted post data: ${jsonEncode({
          'hasCaption': (postData['caption'] ?? '').toString().isNotEmpty,
          'captionPreview': postData['caption'] == null
              ? 'none'
              : (postData['caption'] as String).substring(
                  0,
                  (postData['caption'] as String).length.clamp(0, 100).toInt(),
                ),
          'commentsCount': (postData['comments'] as List).length,
          'commentsPreview': (postData['comments'] as List)
              .take(2)
              .map(
                (c) => ((c is Map ? c['text'] : '') ?? '')
                    .toString()
                    .substring(
                      0,
                      ((c is Map ? c['text'] : '') ?? '')
                          .toString()
                          .length
                          .clamp(0, 50)
                          .toInt(),
                    ),
              )
              .toList(),
          'imagesCount': (postData['images'] as List).length,
          'username': (postData['user'] as Map)['username'],
          'type': postData['type'],
        })}',
      );

      return postData;
    } catch (error, stackTrace) {
      debugPrint('âŒ Error fetching Instagram post data: $error');
      debugPrint('âŒ Error details: $error $stackTrace');
      return null;
    }
  }

  Future<String?> fetchImageAsBase64(String imageUrl) async {
    try {
      debugPrint('ðŸ“¸ Fetching image from URL: $imageUrl');

      final proxyUrl =
          'https://api.allorigins.win/get?url=${Uri.encodeComponent(imageUrl)}';
      final response = await _httpGet(proxyUrl, timeout: const Duration(seconds: 15));

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception('Failed to fetch image');
      }

      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final htmlContent = (data['contents'] ?? '').toString();
      final imgMatch = RegExp(
        r'<meta\s+property="og:image"\s+content="([^"]+)"',
        caseSensitive: false,
      ).firstMatch(htmlContent) ??
          RegExp(r'<img[^>]+src="([^"]+)"', caseSensitive: false).firstMatch(htmlContent);

      if (imgMatch != null && (imgMatch.group(1) ?? '').isNotEmpty) {
        final actualImageUrl = imgMatch.group(1)!;
        final imageResponse = await _httpGet(actualImageUrl, timeout: const Duration(seconds: 20));
        return base64Encode(imageResponse.bodyBytes);
      }

      final imageResponse = await _httpGet(imageUrl, timeout: const Duration(seconds: 20));
      return base64Encode(imageResponse.bodyBytes);
    } catch (error) {
      debugPrint('âŒ Error fetching image: $error');
      return null;
    }
  }

  bool isEntertainmentTopic(String message) {
    final entertainmentKeywords = <String>[
      'show',
      'tv',
      'series',
      'movie',
      'film',
      'celebrity',
      'actor',
      'actress',
      'director',
      'episode',
      'season',
      'netflix',
      'hulu',
      'disney',
      'hbo',
      'amazon prime',
      'streaming',
      'gossip',
      'rumor',
      'news',
      'entertainment',
      'hollywood',
      'bollywood',
      'trailer',
      'premiere',
      'release',
      'award',
      'oscar',
      'grammy',
      'emmy',
      'star',
      'famous',
      'influencer',
      'youtuber',
      'tiktok',
      'instagram',
      'social media',
      'trending',
      'viral',
      'singer',
      'rapper',
      'artist',
      'musician',
      'comedian',
      'host',
      'anchor',
      'reporter',
      'model',
      'fashion',
      'red carpet',
      'awards show',
      'premiere',
      'debut',
      'album',
      'song',
      'track',
      'music video',
      'podcast',
      'interview',
    ];

    final lowerMessage = message.toLowerCase();
    final hasKeyword = entertainmentKeywords.any((keyword) => lowerMessage.contains(keyword));
    final celebrityPatterns = <RegExp>[
      RegExp(r'^(who is|what about|tell me about|do you know)', caseSensitive: false),
      RegExp(
        r'\b(he|she|they)\s+(is|was|are|were)\s+(a|an|the)\s+(actor|actress|singer|star|celebrity)',
        caseSensitive: false,
      ),
    ];
    final hasCelebrityPattern = celebrityPatterns.any((pattern) => pattern.hasMatch(message));
    return hasKeyword || hasCelebrityPattern;
  }

  String extractSearchQuery(String message) {
    final instagramHandlePattern =
        RegExp(r'(@\w+|[\w_]+\.writes|writes|instagram|insta)', caseSensitive: false);
    final hasSpecificIdentifier = instagramHandlePattern.hasMatch(message);
    final stopWords = <String>[
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
      'about',
      'what',
      'who',
      'where',
      'when',
      'why',
      'how',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'must',
      'can',
      'this',
      'that',
      'these',
      'those',
      'i',
      'you',
      'he',
      'she',
      'it',
      'we',
      'they',
      'me',
      'him',
      'her',
      'us',
      'them',
    ];

    if (hasSpecificIdentifier) {
      final words = message
          .toLowerCase()
          .replaceAll(RegExp(r'[^\w\s@._]'), ' ')
          .split(RegExp(r'\s+'))
          .where((word) => word.isNotEmpty)
          .toList();

      final identifierIndex = words.indexWhere(
        (w) => w.contains('writes') || w.contains('insta') || w.contains('@') || w.contains('_') || w.contains('.'),
      );

      if (identifierIndex > 0) {
        final name = words
            .sublist(0, identifierIndex)
            .where((w) => !stopWords.contains(w))
            .join(' ');
        final identifier = words.sublist(identifierIndex).join(' ');
        final query = '$name $identifier'.trim();
        debugPrint('ðŸ” Extracted search query with identifier: $query');
        return query;
      } else if (identifierIndex == 0) {
        final query = words.join(' ').trim();
        debugPrint('ðŸ” Extracted search query with identifier at start: $query');
        return query;
      }
    }

    final words = message
        .toLowerCase()
        .replaceAll(RegExp(r'[^\w\s]'), ' ')
        .split(RegExp(r'\s+'))
        .where((word) => word.length > 2 && !stopWords.contains(word))
        .toList();

    final keyTerms = words.take(7).toList();
    final query = keyTerms.isNotEmpty ? keyTerms.join(' ') : message;
    debugPrint('ðŸ” Extracted search query: $query');
    return query;
  }

  Future<List<Map<String, dynamic>>> searchWeb(String query) async {
    try {
      debugPrint('ðŸ” Searching web for: $query');
      try {
        final enhancedQuery = enhanceEntertainmentQuery(query);
        final ddgUrl =
            'https://api.duckduckgo.com/?q=${Uri.encodeComponent(enhancedQuery)}&format=json&no_html=1&skip_disambig=1';

        final response = await _httpGet(ddgUrl, timeout: const Duration(seconds: 5));
        if (response.statusCode >= 200 && response.statusCode < 300) {
          final data = jsonDecode(response.body) as Map<String, dynamic>;
          final results = <Map<String, dynamic>>[];

          final abstractText = (data['AbstractText'] ?? '').toString();
          if (abstractText.isNotEmpty) {
            results.add({
              'title': (data['Heading'] ?? query).toString(),
              'snippet': abstractText.substring(0, abstractText.length.clamp(0, 300).toInt()),
              'link': (data['AbstractURL'] ?? '').toString(),
            });
          }

          if (data['RelatedTopics'] is List && (data['RelatedTopics'] as List).isNotEmpty) {
            final topics = (data['RelatedTopics'] as List).take(3);
            for (final topic in topics) {
              if (topic is Map && topic['Text'] != null) {
                final topicText = topic['Text'].toString();
                final parts = topicText.split(' - ');
                final snippet = topicText.length > 300
                    ? '${topicText.substring(0, 300)}...'
                    : topicText;
                results.add({
                  'title': parts.isNotEmpty && parts.first.isNotEmpty
                      ? parts.first
                      : topicText.substring(0, topicText.length.clamp(0, 60).toInt()),
                  'snippet': snippet,
                  'link': (topic['FirstURL'] ?? '').toString(),
                });
              }
            }
          }

          final answer = (data['Answer'] ?? '').toString();
          if (answer.isNotEmpty && answer != abstractText) {
            results.add({
              'title': (data['Heading'] ?? 'Quick Answer').toString(),
              'snippet': answer.substring(0, answer.length.clamp(0, 300).toInt()),
              'link': (data['AbstractURL'] ?? '').toString(),
            });
          }

          final definition = (data['Definition'] ?? '').toString();
          if (definition.isNotEmpty && definition != abstractText) {
            results.add({
              'title': (data['Heading'] ?? 'Definition').toString(),
              'snippet': definition.substring(0, definition.length.clamp(0, 300).toInt()),
              'link': (data['AbstractURL'] ?? '').toString(),
            });
          }

          final uniqueResults = <Map<String, dynamic>>[];
          final seenSnippets = <String>{};
          for (final result in results) {
            final snippet = (result['snippet'] ?? '').toString();
            if (snippet.isEmpty || seenSnippets.contains(snippet)) continue;
            seenSnippets.add(snippet);
            uniqueResults.add(result);
            if (uniqueResults.length >= 4) break;
          }

          if (uniqueResults.isNotEmpty) {
            debugPrint('âœ… Web search results (DuckDuckGo): ${uniqueResults.length} results found');
            return uniqueResults;
          }
        }
      } catch (ddgError) {
        if (ddgError is! TimeoutException) {
          debugPrint('âš ï¸ DuckDuckGo search failed: $ddgError');
        }
      }

      debugPrint('âš ï¸ Web search unavailable, proceeding without search results');
      return [];
    } catch (error) {
      debugPrint('âŒ Error in web search: $error');
      return [];
    }
  }

  String enhanceEntertainmentQuery(String query) {
    final lowerQuery = query.toLowerCase();
    final hasSpecificIdentifier = RegExp(r'(writes|insta|instagram|@|_|\.writes|\._)', caseSensitive: false)
        .hasMatch(query);
    final indianContexts = <String>[
      'india',
      'indian',
      'bollywood',
      'tollywood',
      'kollywood',
      'mollywood',
      'south indian',
    ];
    final hasIndianContext = indianContexts.any((ctx) => lowerQuery.contains(ctx));
    final entertainmentContexts = <String>[
      'news',
      'latest',
      'recent',
      'update',
      'gossip',
      'rumor',
      'celebrity',
      'actor',
      'actress',
      'show',
      'series',
      'movie',
    ];
    final hasContext = entertainmentContexts.any((ctx) => lowerQuery.contains(ctx));

    var enhancedQuery = query;
    if (!hasIndianContext && !hasSpecificIdentifier) {
      final isEntertainmentQuery = isEntertainmentTopic(query) ||
          lowerQuery.contains('who') ||
          lowerQuery.contains('celebrity') ||
          lowerQuery.contains('actor') ||
          lowerQuery.contains('actress') ||
          lowerQuery.contains('singer') ||
          lowerQuery.contains('star');
      if (isEntertainmentQuery) {
        enhancedQuery = '$query India Indian Bollywood';
      }
    } else if (hasSpecificIdentifier) {
      if (!lowerQuery.contains('instagram') &&
          !lowerQuery.contains('insta') &&
          !lowerQuery.contains('social media')) {
        enhancedQuery = '$query Instagram social media';
      }
    }

    if (!hasContext && !hasSpecificIdentifier && (lowerQuery.contains('who') || lowerQuery.length < 20)) {
      return '$enhancedQuery news latest';
    }

    if (!hasContext &&
        (lowerQuery.contains('show') ||
            lowerQuery.contains('movie') ||
            lowerQuery.contains('series'))) {
      return '$enhancedQuery updates news';
    }

    return enhancedQuery;
  }

  Future<List<dynamic>> checkModelsAvailable() async {
    try {
      final response = await _httpGet(
        '${getBaseURL()}/api/tags',
        timeout: const Duration(seconds: 10),
      );
      if (response.statusCode >= 200 && response.statusCode < 300) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        final models = data['models'] is List ? data['models'] as List : <dynamic>[];
        debugPrint(
          'ðŸ“‹ Available models: ${models.map((m) => m is Map ? m['name'] : '').toList()}',
        );
        return models;
      }
    } catch (error) {
      debugPrint('âŒ Could not check available models: $error');
    }
    return [];
  }

  Future<Map<String, dynamic>?> getUserProfileContext() async {
    try {
      final dynamic user = AuthService.instance.getCurrentUser();
      if (user is! User || user.uid.isEmpty) {
        return null;
      }

      final prefs = await SharedPreferences.getInstance();
      final birthdayString = prefs.getString('user_birthday_${user.uid}');
      String? birthday;
      String? birthdayFormatted;

      if (birthdayString != null && birthdayString.isNotEmpty) {
        try {
          final date = DateTime.tryParse(birthdayString);
          if (date != null) {
            birthday = birthdayString;
            const monthNames = <String>[
              'January',
              'February',
              'March',
              'April',
              'May',
              'June',
              'July',
              'August',
              'September',
              'October',
              'November',
              'December',
            ];
            birthdayFormatted = '${monthNames[date.month - 1]} ${date.day}, ${date.year}';
          }
        } catch (error) {
          debugPrint('Error parsing birthday: $error');
        }
      }

      final profileContext = <String, dynamic>{
        'name': user.displayName,
        'age': prefs.getString('user_age_${user.uid}'),
        'gender': prefs.getString('user_gender_${user.uid}'),
        'bio': prefs.getString('user_bio_${user.uid}'),
        'birthday': birthday,
        'birthdayFormatted': birthdayFormatted,
      };

      final hasAny = (profileContext['name'] ?? '').toString().isNotEmpty ||
          (profileContext['age'] ?? '').toString().isNotEmpty ||
          (profileContext['gender'] ?? '').toString().isNotEmpty ||
          (profileContext['bio'] ?? '').toString().isNotEmpty ||
          (profileContext['birthday'] ?? '').toString().isNotEmpty;
      if (hasAny) {
        return profileContext;
      }
      return null;
    } catch (error) {
      debugPrint('âŒ Error getting user profile context: $error');
      return null;
    }
  }

  Future<String> analyzeImageWithVision(
    String? imageBase64, [
    String userMessage = '',
  ]) async {
    try {
      debugPrint('ðŸ‘ï¸ VISION: Analyzing image with vision model...');
      debugPrint('ðŸ‘ï¸ VISION: Image base64 length: ${imageBase64?.length ?? 0}');
      debugPrint('ðŸ‘ï¸ VISION: Using model: $visionModelName');

      var cleanBase64 = imageBase64 ?? '';
      if (cleanBase64.contains(',')) {
        cleanBase64 = cleanBase64.split(',')[1];
      }

      if (cleanBase64.isEmpty || cleanBase64.length < 100) {
        throw Exception('Invalid or too small base64 image');
      }

      const visionPrompt = '''Analyze this image in COMPLETE DETAIL. Describe:
- What you see (objects, people, text, scenes, colors, layout)
- The context and setting
- Any text visible in the image (exact words if readable)
- The mood, tone, or emotion conveyed
- If it's a meme, explain the joke, format, and why it's funny
- If it's a screenshot, describe what's on screen
- Any cultural references, trends, or context
- Every detail that would help someone understand what this image is about

Be thorough and detailed. This description will be used to generate a response.''';

      final visionApiKey = openaiApiKey;
      if (visionApiKey.trim().isEmpty) {
        throw Exception('OpenAI API key is required for vision analysis.');
      }

      final apiUrl = '$openaiBaseURL/chat/completions';
      final requestBody = <String, dynamic>{
        'model': visionModelName,
        'messages': [
          {
            'role': 'user',
            'content': [
              {'type': 'text', 'text': visionPrompt},
              {
                'type': 'image_url',
                'image_url': {'url': 'data:image/jpeg;base64,$cleanBase64'},
              },
            ],
          },
        ],
        'temperature': 0.3,
        'max_tokens': 500,
      };

      debugPrint('ðŸ‘ï¸ VISION: Sending request to: $apiUrl');
      debugPrint('ðŸ‘ï¸ VISION: Request body keys: ${requestBody.keys.toList()}');

      final response = await _httpPost(
        apiUrl,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $visionApiKey',
        },
        body: jsonEncode(requestBody),
        timeout: const Duration(seconds: 30),
      );

      debugPrint('ðŸ‘ï¸ VISION: Response status: ${response.statusCode}');

      if (response.statusCode < 200 || response.statusCode >= 300) {
        final errorText = response.body;
        debugPrint('âŒ VISION: Error response: $errorText');
        throw Exception('Vision model failed: ${response.statusCode} - $errorText');
      }

      final data = jsonDecode(response.body) as Map<String, dynamic>;
      debugPrint('ðŸ‘ï¸ VISION: Response keys: ${data.keys.toList()}');

      var imageDescription = '';
      if (data['choices'] is List &&
          (data['choices'] as List).isNotEmpty &&
          (data['choices'] as List).first is Map &&
          ((data['choices'] as List).first as Map)['message'] is Map &&
          ((((data['choices'] as List).first as Map)['message'] as Map)['content'] != null)) {
        imageDescription =
            ((((data['choices'] as List).first as Map)['message'] as Map)['content'] ?? '')
                .toString();
      }

      if (imageDescription.trim().isEmpty) {
        throw Exception('Empty description from vision model');
      }

      debugPrint('âœ… VISION: Image analysis complete');
      debugPrint('ðŸ“ VISION: Description length: ${imageDescription.length}');
      debugPrint(
        'ðŸ“ VISION: Description preview: ${imageDescription.substring(0, imageDescription.length.clamp(0, 200).toInt())}',
      );

      return imageDescription;
    } catch (error, stackTrace) {
      debugPrint('âŒ VISION: Error analyzing image: $error');
      debugPrint('âŒ VISION: Error details: $error $stackTrace');
      rethrow;
    }
  }

  Future<String> _completeWithCurrentProvider(String prompt, {int maxTokens = 1024}) async {
    final key = apiProvider == 'openai' ? openaiApiKey : grokApiKey;
    if (key.trim().isEmpty) {
      if (isVertexBackendConfigured()) {
        return vertexGenerateContent(prompt: prompt, maxOutputTokens: maxTokens);
      }
      throw Exception('No AI provider configured.');
    }
    final base = apiProvider == 'openai' ? openaiBaseURL : grokBaseURL;
    final model = apiProvider == 'openai' ? openaiModelName : grokModelName;
    final res = await _httpPost(
      '$base/chat/completions',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $key',
      },
      body: jsonEncode({
        'model': model,
        'messages': [
          {'role': 'user', 'content': prompt},
        ],
        'temperature': 0.65,
        'max_tokens': maxTokens,
      }),
      timeout: const Duration(seconds: 60),
    );
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw Exception('AI request failed (${res.statusCode})');
    }
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    final choices = data['choices'];
    if (choices is List && choices.isNotEmpty) {
      final first = choices.first;
      if (first is Map && first['message'] is Map) {
        final content = (first['message'] as Map)['content'];
        if (content is String) return content.trim();
      }
    }
    return '';
  }

  Future<http.Response> _httpGet(
    String url, {
    Map<String, String>? headers,
    Duration timeout = const Duration(seconds: 30),
  }) {
    return http.get(Uri.parse(url), headers: headers).timeout(timeout);
  }

  Future<http.Response> _httpPost(
    String url, {
    Map<String, String>? headers,
    String? body,
    Duration timeout = const Duration(seconds: 30),
  }) {
    return http.post(Uri.parse(url), headers: headers, body: body).timeout(timeout);
  }

  Future<String> sendMessage(
    String userMessage, {
    List<ChatMessage> conversationHistory = const [],
    void Function(String token)? onToken,
    Uint8List? imageBytes,
    String? imageMimeType,
    dynamic imageFile,
    String? imageBase64,
  }) async {
    openaiApiKey = Env.openAiApiKey.trim().isNotEmpty ? Env.openAiApiKey.trim() : openaiApiKey;
    grokApiKey = Env.grokApiKey.trim().isNotEmpty ? Env.grokApiKey.trim() : grokApiKey;

    final vertexForGemini = apiProvider == 'gemini' && isVertexBackendConfigured();
    final apiKey = '${getApiKey() ?? ''}';
    if (apiProvider == 'gemini' && !vertexForGemini) {
      throw Exception(
        'Gemini uses your backend only. Set REACT_APP_BACKEND_URL (preferred) or REACT_APP_VERTEX_BACKEND_URL / REACT_APP_VERTEX_GEMINI_URL and restart the dev server.',
      );
    }
    if (!vertexForGemini && apiKey.trim().isEmpty) {
      final providerName = apiProvider == 'openai' ? 'OpenAI' : 'Grok';
      final envKeyName = apiProvider == 'openai' ? 'REACT_APP_OPENAI_API_KEY' : 'REACT_APP_GROK_API_KEY';
      throw Exception(
        '$providerName API key is not configured. Set $envKeyName in .env and restart the dev server.',
      );
    }

    try {
      var hasImage = false;
      var finalImageBase64 = imageBase64 ?? '';
      String? imageDescription;

      if (imageBytes != null && imageBytes.isNotEmpty) {
        finalImageBase64 = base64Encode(imageBytes);
        hasImage = true;
        try {
          imageDescription = await analyzeImageWithVision(finalImageBase64, userMessage);
        } catch (_) {
          imageDescription = null;
        }
      } else if (imageFile != null) {
        finalImageBase64 = await imageToBase64(imageFile);
        hasImage = true;
      } else if (imageBase64 != null && imageBase64.isNotEmpty) {
        hasImage = true;
      } else if (hasUrl(userMessage)) {
        final urls = extractUrls(userMessage);

        String? instagramUrl;
        for (final url in urls) {
          if (isInstagramLink(url)) {
            instagramUrl = url;
            break;
          }
        }

        if (instagramUrl != null) {
          final instagramData = await fetchInstagramPostData(instagramUrl) ?? <String, dynamic>{};
          final caption = '${instagramData['caption'] ?? ''}'.trim();
          final comments = instagramData['comments'] is List ? List<dynamic>.from(instagramData['comments']) : <dynamic>[];
          final user = instagramData['user'] is Map ? Map<String, dynamic>.from(instagramData['user']) : <String, dynamic>{};
          final hasValidData =
              caption.isNotEmpty || comments.isNotEmpty || ('${user['username'] ?? ''}'.trim().isNotEmpty);

          if (hasValidData) {
            final isReel = '${instagramData['type'] ?? ''}' == 'video' ||
                instagramUrl.contains('/reel/') ||
                instagramUrl.contains('/tv/');
            final accountUsername = '${user['username'] ?? 'unknown'}'.trim().isEmpty
                ? 'unknown'
                : '${user['username']}'.trim();

            var linkDescription =
                "The user shared a MEME (an Instagram ${isReel ? 'reel' : 'post'}) from @$accountUsername's account. This is NOT the user's own content - they found and shared this meme from @$accountUsername. ";

            if (caption.isNotEmpty) {
              linkDescription += 'MEME CAPTION: "$caption". ';
            } else {
              linkDescription += '(No caption available for this meme). ';
            }

            linkDescription += "This meme is from @$accountUsername's account. ";
            final followers = user['followers'];
            if (followers != null && '$followers'.trim().isNotEmpty && '$followers' != '0') {
              linkDescription += '@$accountUsername has $followers followers. ';
            }

            if (comments.isNotEmpty) {
              final sortedComments = comments
                  .whereType<Map>()
                  .map((c) => Map<String, dynamic>.from(c))
                  .where((c) => '${c['text'] ?? ''}'.trim().isNotEmpty)
                  .toList()
                ..sort((a, b) {
                  final aLikes = a['likes'] is num ? (a['likes'] as num).toInt() : 0;
                  final bLikes = b['likes'] is num ? (b['likes'] as num).toInt() : 0;
                  return bLikes.compareTo(aLikes);
                });
              final topComments = sortedComments.take(5).toList();

              linkDescription += 'TOP COMMENTS (${comments.length} total): ';
              for (var i = 0; i < topComments.length; i++) {
                final comment = topComments[i];
                final text = '${comment['text'] ?? ''}';
                if (text.trim().isNotEmpty) {
                  final username = '${comment['username'] ?? ''}';
                  final likes = comment['likes'] is num ? (comment['likes'] as num).toInt() : 0;
                  linkDescription += 'Comment ${i + 1}: "@$username" said "$text" ($likes likes). ';
                }
              }
            } else {
              linkDescription += '(No comments available). ';
            }

            final images = instagramData['images'] is List ? List<dynamic>.from(instagramData['images']) : <dynamic>[];
            if (images.isNotEmpty) {
              try {
                final imageDescriptions = <String>[];
                final maxCount = images.length < 3 ? images.length : 3;
                for (var i = 0; i < maxCount; i++) {
                  final imageUrl = '${images[i] ?? ''}'.trim();
                  if (imageUrl.isEmpty) continue;
                  final thumbnailBase64 = await fetchImageAsBase64(imageUrl);
                  if (thumbnailBase64 != null && thumbnailBase64.isNotEmpty) {
                    final imgDescription = await analyzeImageWithVision(thumbnailBase64, userMessage);
                    final descText = imgDescription;
                    if (descText.trim().isNotEmpty) {
                      imageDescriptions.add(descText);
                    }
                  }
                }
                if (imageDescriptions.isNotEmpty) {
                  linkDescription += 'Visual content: ${imageDescriptions.join(' | ')}';
                }
              } catch (_) {
                // Ignore visual analysis failure and continue with available text metadata.
              }
            }

            imageDescription = linkDescription;
            hasImage = true;
          } else {
            imageDescription = 'EMOJI_ONLY_RESPONSE';
            hasImage = true;
          }
        } else {
          String? socialMediaUrl;
          for (final url in urls) {
            if (isSocialMediaLink(url)) {
              socialMediaUrl = url;
              break;
            }
          }

          if (socialMediaUrl != null) {
            final urlMetadata = await fetchUrlMetadata(socialMediaUrl);
            if (urlMetadata != null && urlMetadata.isNotEmpty) {
              var linkDescription = 'The user shared a link from ${urlMetadata['siteName'] ?? 'social media'}. ';
              if ('${urlMetadata['title'] ?? ''}'.trim().isNotEmpty) {
                linkDescription += 'Title: "${urlMetadata['title']}". ';
              }
              if ('${urlMetadata['description'] ?? ''}'.trim().isNotEmpty) {
                linkDescription += 'Description: "${urlMetadata['description']}". ';
              }
              if ('${urlMetadata['videoUrl'] ?? ''}'.trim().isNotEmpty ||
                  socialMediaUrl.contains('/reel/') ||
                  socialMediaUrl.contains('/tv/')) {
                linkDescription += 'This is a video/reel. ';
              }

              if ('${urlMetadata['image'] ?? ''}'.trim().isNotEmpty) {
                try {
                  final thumbnailBase64 = await fetchImageAsBase64('${urlMetadata['image']}');
                  if (thumbnailBase64 != null && thumbnailBase64.isNotEmpty) {
                    final thumbnailDescription = await analyzeImageWithVision(thumbnailBase64, userMessage);
                    final thumbText = thumbnailDescription;
                    if (thumbText.trim().isNotEmpty) {
                      linkDescription += 'Visual content from thumbnail: $thumbText';
                    }
                  }
                } catch (_) {
                  // Keep metadata-only fallback.
                }
              }

              imageDescription = linkDescription;
              hasImage = true;
            } else {
              final fetchedImage = await fetchImageAsBase64(socialMediaUrl);
              if (fetchedImage != null && fetchedImage.isNotEmpty) {
                finalImageBase64 = fetchedImage;
                hasImage = true;
              }
            }
          } else {
            for (final url in urls) {
              final fetchedImage = await fetchImageAsBase64(url);
              if (fetchedImage != null && fetchedImage.isNotEmpty) {
                finalImageBase64 = fetchedImage;
                hasImage = true;
                break;
              }
            }
          }
        }
      }

      if (hasImage && finalImageBase64.isNotEmpty && (imageDescription == null || imageDescription.isEmpty)) {
        try {
          final analyzed = await analyzeImageWithVision(finalImageBase64, userMessage);
          imageDescription = analyzed;
          if (imageDescription == null || imageDescription.trim().isEmpty) {
            imageDescription = null;
          }
        } catch (_) {
          imageDescription = null;
        }
      }

      final modelToUse = getModelName();
      final hasImageContext = imageDescription != null && imageDescription.isNotEmpty;
      final userProfile = await getUserProfileContext();

      final isEntertainment = !hasImageContext && isEntertainmentTopic(userMessage);
      var webSearchResults = <Map<String, dynamic>>[];
      if (isEntertainment) {
        final searchQuery = extractSearchQuery(userMessage);
        webSearchResults = await searchWeb(searchQuery);
        if (webSearchResults.isEmpty) {
          webSearchResults = await searchWeb(userMessage);
        }
      }

      var conversationContext = '';
      if (conversationHistory.isNotEmpty) {
        final recentMessages = conversationHistory.length > 3
            ? conversationHistory.sublist(conversationHistory.length - 3)
            : conversationHistory;
        conversationContext = recentMessages.map((msg) {
          return msg.sender == 'user' ? 'Human: ${msg.text}' : 'Assistant: ${msg.text}';
        }).join('\n');
        conversationContext += '\n';
      }

      var searchContext = '';
      if (isEntertainment && webSearchResults.isNotEmpty) {
        final hasSpecificIdentifier = RegExp(r'(writes|insta|instagram|@|_|\.writes|\._)', caseSensitive: false)
            .hasMatch(userMessage);

        searchContext = '\n\nðŸ“° REAL-TIME INFORMATION FROM THE INTERNET:\n';
        for (var i = 0; i < webSearchResults.length; i++) {
          final result = webSearchResults[i];
          searchContext += '${i + 1}. ${result['title'] ?? ''}: ${result['snippet'] ?? ''}\n';
        }
        searchContext += '\nIMPORTANT THERAPEUTIC GUIDELINES FOR ENTERTAINMENT TOPICS:';
        searchContext += '\n- Use this REAL information to stay grounded and accurate';
        searchContext += '\n- Reflect on how these facts might make the user feel or why they shared them';
        searchContext += '\n- Offer gentle validation, curious observations, and supportive coping ideas';
        searchContext += '\n- Keep the tone calm, non-judgmental, and emotionally safe';
        searchContext += '\n- Avoid gossip or roastsâ€”focus on empathy and psychological insight';
        searchContext += '\n- Integrate the facts naturally without sounding like a news report';

        if (hasSpecificIdentifier) {
          searchContext +=
              '\n- CRITICAL: The user mentioned a specific identifier (Instagram handle, username like "tee writes", "tee_.writes", etc.)';
          searchContext += '\n- PRIORITIZE search results that match that EXACT identifier the user mentioned';
          searchContext +=
              '\n- If search results mention different people with the same name, use ONLY the one that matches the specific identifier the user mentioned';
          searchContext += '\n- Do NOT confuse with other people who have the same name but different identifiers';
        } else {
          searchContext +=
              '\n- PRIORITIZE INDIAN CONTEXT: Focus on Indian celebrities, Bollywood, Indian shows, Indian entertainment unless the search results clearly indicate international/Western context';
          searchContext +=
              '\n- If search results mention Indian celebrities or Indian entertainment, emphasize that in your response';
        }
      } else if (isEntertainment) {
        searchContext = '\n\nNOTE: This appears to be an entertainment topic, but no current information was found.';
        searchContext += '\n- Still respond with warmth and curiosity';
        searchContext += '\n- Be transparent that no current info was found while keeping focus on the user';
        searchContext += '\n- Invite the user to share what resonates or how they feel about the topic';
        searchContext += '\n- Assume Indian context (Bollywood, Indian celebrities) unless user specifies otherwise';
      }

      var userContext = '';
      if (userProfile != null) {
        userContext = '\n\nðŸ‘¤ USER PROFILE INFORMATION:\n';
        if ('${userProfile['name'] ?? ''}'.trim().isNotEmpty) {
          userContext += '- Name: ${userProfile['name']}\n';
        }
        if ('${userProfile['age'] ?? ''}'.trim().isNotEmpty) {
          userContext += '- Age: ${userProfile['age']} years old\n';
        }
        if ('${userProfile['gender'] ?? ''}'.trim().isNotEmpty) {
          userContext += '- Gender: ${userProfile['gender']}\n';
        }
        if ('${userProfile['birthdayFormatted'] ?? ''}'.trim().isNotEmpty) {
          userContext += '- Birthday: ${userProfile['birthdayFormatted']}\n';
        }
        if ('${userProfile['bio'] ?? ''}'.trim().isNotEmpty) {
          userContext += '- About: ${userProfile['bio']}\n';
        }
        final userName = '${userProfile['name'] ?? ''}'.trim().isNotEmpty ? '${userProfile['name']}' : 'they';
        userContext +=
            "\nIMPORTANT: Use the user's name ($userName) naturally in conversations when appropriate. Reference their age, gender, birthday, or bio context when relevant to make responses more personalized and meaningful. Remember their birthday (${userProfile['birthdayFormatted'] ?? 'not provided'}) and use it when they ask about it or when it's relevant to the conversation.";
      }

      late final String simplePrompt;
      if (hasImageContext && imageDescription != null && imageDescription.isNotEmpty) {
        if (imageDescription == 'EMOJI_ONLY_RESPONSE') {
          simplePrompt =
              """You are Detea, a compassionate therapist-like companion who prioritizes emotional safety and validation.$userContext

The user just shared an Instagram link, but the content could not be accessed. Even without seeing the media, respond in 3-4 gentle sentences that:
- Acknowledge you couldn't view the link while keeping focus on the user
- Reflect what sharing a meme/reel might signal about their mood or needs
- Offer grounding reassurance or a coping idea tied to their possible feelings
- Ask ONE open-ended question inviting them to describe the content or share what resonated
- Maintain a calm, empathetic, non-judgmental tone with no jokes or roasts

${conversationContext}Human: ${userMessage.isNotEmpty ? userMessage : 'Check this out!'}
Assistant:""";
        } else {
          final isInstagramData =
              imageDescription.contains('Instagram') && (imageDescription.contains('Comments') || imageDescription.contains('@'));
          if (isInstagramData) {
            simplePrompt =
                """You are Detea, a calm, empathetic therapist-like friend. The user just shared an Instagram post/reel, and here's what it contains:$userContext

ðŸ“¸ INSTAGRAM POST DATA:
$imageDescription

${userMessage.isNotEmpty ? '\nUser\'s message: "$userMessage"' : ''}

THERAPEUTIC RESPONSE GUIDELINES FOR SHARED POSTS:
- Assume the user resonated with this post emotionallyâ€”mirror the themes you see in the caption/comments
- Validate any feelings the content might stir (humor, stress relief, longing, frustration, pride, etc.)
- Offer a gentle insight or coping reframe that connects to the post details
- Invite the user to share what part of the post hit home for them with ONE caring question
- Keep the tone grounded, warm, and judgement-freeâ€”no roasts, sarcasm, or slangy reactions
- Stay within 3-4 thoughtful sentences, prioritizing emotional safety over hype

${conversationContext}Human: ${userMessage.isNotEmpty ? userMessage : 'Check this out!'}
Assistant:""";
          } else {
            simplePrompt =
                """You are Detea, a supportive therapist-like confidante. The user just shared an image/meme, and here's what it contains:$userContext

ðŸ“¸ IMAGE ANALYSIS:
$imageDescription

${userMessage.isNotEmpty ? '\nUser\'s message: "$userMessage"' : ''}

THERAPEUTIC RESPONSE GUIDELINES FOR VISUAL CONTENT:
- Reflect the emotions, story, or theme described in the analysis above
- Validate why someone might share or connect with this specific meme/image
- Offer a gentle observation or grounding reminder tied to what you see
- Ask ONE soft, curious question that invites the user to open up about their reaction
- Use warm, calm language (3-4 sentences) and avoid jokes, roasting, or slang

${conversationContext}Human: ${userMessage.isNotEmpty ? userMessage : 'Check this out!'}
Assistant:""";
          }
        }
      } else {
        simplePrompt =
            """You are Detea, a compassionate therapist-like companion who offers a safe, validating space.$userContext

CORE THERAPIST GUIDELINES:
- Listen for the emotion beneath the words and name it with care
- Validate the userâ€™s lived experience without judgment or sarcasm
- Offer one gentle insight, reframing, or coping strategy rooted in what they shared
- Ask ONE open-ended, non-leading question to invite deeper sharing
- Keep responses to 3-5 sentences, warm, grounded, and trauma-informed
- Prioritize Indian cultural context when relevant (Bollywood, local realities, family dynamics) while honoring the userâ€™s specific cues

$searchContext
${conversationContext}Human: $userMessage
Assistant:""";
      }

      String? apiUrl;
      Map<String, dynamic>? requestBody;
      Map<String, String>? headers;

      if (apiProvider == 'openai') {
        apiUrl = '$openaiBaseURL/chat/completions';
        requestBody = {
          'model': openaiModelName,
          'messages': [
            {'role': 'user', 'content': simplePrompt},
          ],
          'temperature': 0.65,
          'max_tokens': 500,
        };
        headers = {'Content-Type': 'application/json', 'Authorization': 'Bearer $apiKey'};
      } else if (apiProvider == 'grok') {
        apiUrl = '$grokBaseURL/chat/completions';
        requestBody = {
          'model': grokModelName,
          'messages': [
            {'role': 'user', 'content': simplePrompt},
          ],
          'temperature': 0.65,
          'max_tokens': 500,
        };
        headers = {'Content-Type': 'application/json', 'Authorization': 'Bearer $apiKey'};
      } else if (vertexForGemini) {
        try {
          final aiText = await vertexChat(
            simplePrompt,
            timeout: const Duration(seconds: 60),
            temperature: 0.65,
            maxOutputTokens: 1024,
          );
          if (aiText.trim().isEmpty) {
            throw Exception('Empty response from Vertex backend.');
          }
          if (onToken != null) {
            onToken(aiText.trim());
          }
          return aiText.trim();
        } on TimeoutException {
          throw Exception('Request timed out. The Vertex backend may be slow or unavailable. Please try again.');
        } catch (fetchError) {
          final msg = fetchError.toString();
          if (msg.contains('Failed to fetch') || msg.contains('NetworkError')) {
            throw Exception(
              'Unable to connect to the backend. Check REACT_APP_BACKEND_URL (preferred) or REACT_APP_VERTEX_BACKEND_URL / REACT_APP_VERTEX_GEMINI_URL.',
            );
          }
          rethrow;
        }
      } else {
        throw Exception('Unsupported API provider: $apiProvider');
      }

      http.Response response;
      try {
        response = await http
            .post(
              Uri.parse(apiUrl!),
              headers: headers!,
              body: jsonEncode(requestBody),
            )
            .timeout(const Duration(seconds: 60));
      } on TimeoutException {
        throw Exception('Request timed out. The AI server may be slow or unavailable. Please try again.');
      } catch (fetchError) {
        final msg = fetchError.toString();
        if (msg.contains('Failed to fetch') || msg.contains('NetworkError')) {
          throw Exception('Unable to connect to the AI server. Please check your internet connection and try again.');
        }
        rethrow;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        final errorText = response.body;
        final providerName = apiProvider == 'openai' ? 'OpenAI' : 'Grok';
        final envKeyName = apiProvider == 'openai' ? 'REACT_APP_OPENAI_API_KEY' : 'REACT_APP_GROK_API_KEY';

        final short200 = errorText.length > 200 ? errorText.substring(0, 200) : errorText;
        if (response.statusCode == 400) {
          if (errorText.contains('API key') || errorText.contains('invalid') || errorText.contains('permission')) {
            throw Exception(
              'Invalid or missing $providerName API key. Please check your $envKeyName in the .env file and make sure it\'s correct.',
            );
          }
          throw Exception('Bad request: $short200');
        } else if (response.statusCode == 401 || response.statusCode == 403) {
          throw Exception(
            'API key authentication failed. Please check your $envKeyName in the .env file. Make sure the key is valid and has the necessary permissions.',
          );
        } else if (response.statusCode == 404) {
          throw Exception('AI model not found. Please check if the model is available.');
        } else if (response.statusCode == 500 ||
            response.statusCode == 502 ||
            response.statusCode == 503) {
          throw Exception('AI server is temporarily unavailable. Please try again in a moment.');
        } else if (response.statusCode == 504) {
          throw Exception('Request timed out. The AI server is taking too long to respond.');
        }

        final reason = response.reasonPhrase ?? '';
        throw Exception('Model $modelToUse failed: ${response.statusCode} $reason. $short200');
      }

      final data = jsonDecode(response.body) as Map<String, dynamic>;
      String aiResponse = '';
      final choices = data['choices'];
      if (choices is List && choices.isNotEmpty) {
        final first = choices.first;
        if (first is Map &&
            first['message'] is Map &&
            (first['message'] as Map)['content'] is String) {
          aiResponse = ((first['message'] as Map)['content'] as String);
        }
      }

      if (aiResponse.trim().isEmpty) {
        if (data['error'] is Map) {
          final errorMap = Map<String, dynamic>.from(data['error']);
          throw Exception(
            '${apiProvider == 'openai' ? 'OpenAI' : 'Grok'} API Error: ${errorMap['message'] ?? jsonEncode(errorMap)}',
          );
        }
        throw Exception(
          'Unexpected response format from ${apiProvider == 'openai' ? 'OpenAI' : 'Grok'} API. Please check your API key and try again.',
        );
      }

      final trimmed = aiResponse.trim();
      if (onToken != null) {
        onToken(trimmed);
      }
      return trimmed;
    } catch (error) {
      rethrow;
    }
  }

  Future<String> editTextWithAI(String text, String instruction) async {
    await loadSavedProvider();

    openaiApiKey = Env.openAiApiKey.trim().isNotEmpty ? Env.openAiApiKey.trim() : openaiApiKey;
    grokApiKey = Env.grokApiKey.trim().isNotEmpty ? Env.grokApiKey.trim() : grokApiKey;

    final vertexForGemini = apiProvider == 'gemini' && isVertexBackendConfigured();
    final apiKey = '${getApiKey() ?? ''}';
    if (apiProvider == 'gemini' && !vertexForGemini) {
      throw Exception(
        'Gemini uses your backend only. Set REACT_APP_BACKEND_URL (preferred) or REACT_APP_VERTEX_BACKEND_URL / REACT_APP_VERTEX_GEMINI_URL in .env.',
      );
    }
    if (!vertexForGemini && apiKey.trim().isEmpty) {
      final providerName = apiProvider == 'openai' ? 'OpenAI' : 'Grok';
      final envKeyName = apiProvider == 'openai' ? 'REACT_APP_OPENAI_API_KEY' : 'REACT_APP_GROK_API_KEY';
      throw Exception('$providerName API key is not set. Add $envKeyName in .env.');
    }

    final prompt = """Apply the following edit to the text below. Return ONLY the edited text, no quotes, no explanation, no preamble.

Edit instruction: $instruction

Text:
$text""";

    String? apiUrl;
    Map<String, dynamic>? requestBody;
    Map<String, String>? headers;

    if (apiProvider == 'openai') {
      apiUrl = '$openaiBaseURL/chat/completions';
      requestBody = {
        'model': openaiModelName,
        'messages': [
          {'role': 'user', 'content': prompt},
        ],
        'temperature': 0.3,
        'max_tokens': 1000,
      };
      headers = {'Content-Type': 'application/json', 'Authorization': 'Bearer $apiKey'};
    } else if (apiProvider == 'grok') {
      apiUrl = '$grokBaseURL/chat/completions';
      requestBody = {
        'model': grokModelName,
        'messages': [
          {'role': 'user', 'content': prompt},
        ],
        'temperature': 0.3,
        'max_tokens': 1000,
      };
      headers = {'Content-Type': 'application/json', 'Authorization': 'Bearer $apiKey'};
    } else if (vertexForGemini) {
      final edited = await vertexGenerateContent(
        prompt: prompt,
        temperature: 0.3,
        maxOutputTokens: 1000,
        timeout: const Duration(seconds: 30),
      );
      return edited.trim();
    } else {
      throw Exception('Unsupported API provider for edit: $apiProvider');
    }

    final response = await http
        .post(
          Uri.parse(apiUrl!),
          headers: headers!,
          body: jsonEncode(requestBody),
        )
        .timeout(const Duration(seconds: 30));

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final errText = response.body;
      final short150 = errText.length > 150 ? errText.substring(0, 150) : errText;
      throw Exception('AI edit failed: ${response.statusCode} $short150');
    }

    final data = jsonDecode(response.body) as Map<String, dynamic>;
    var edited = '';
    final choices = data['choices'];
    if (choices is List && choices.isNotEmpty) {
      final first = choices.first;
      if (first is Map &&
          first['message'] is Map &&
          (first['message'] as Map)['content'] is String) {
        edited = (first['message'] as Map)['content'] as String;
      }
    }
    return edited.trim();
  }

  /// Prefer Deitea Render backend, then Firebase Hosting rewrites, then web origin.
  List<String> _shareSuggestionsApiBases() {
    final seen = <String>{};
    final bases = <String>[];

    void add(String? raw) {
      final b = (raw ?? '').trim().replaceAll(RegExp(r'/$'), '');
      if (b.isEmpty || !seen.add(b)) return;
      bases.add(b);
    }

    add(getVertexBackendBaseUrl());
    add(Env.baseUrl);

    var origin = '';
    if (kIsWeb) {
      try {
        origin = Uri.base.origin;
      } catch (_) {
        origin = Uri.base.toString();
      }
    }
    final originLooksLocal = origin.isEmpty ||
        origin.contains('localhost') ||
        origin.startsWith('capacitor://') ||
        origin.startsWith('ionic://') ||
        origin.startsWith('file://');
    if (!originLooksLocal) add(origin);
    add('https://deitedatabase.web.app');
    add('https://deitedatabase.firebaseapp.com');
    return bases;
  }

  Future<List<Map<String, String>>> generateSocialPostSuggestions(String reflection, String platform) async {
    try {
      final trimmed = reflection.trim();
      if (trimmed.isEmpty) return [];

      if (platform == 'x') {
        return _generateXContentSuggestions(
          userContent: _buildXReflectionSuggestionsUserContent(trimmed),
          fallback: [
            {'eventLabel': 'Reflection', 'post': trimmed},
          ],
        );
      }

      final candidates = _shareSuggestionsApiBases();

      Exception? lastErr;
      for (final apiBase in candidates) {
        if (apiBase.isEmpty) continue;
        try {
          final res = await http
              .post(
                Uri.parse('$apiBase/api/linkedin/suggestions'),
                headers: {'Content-Type': 'application/json'},
                body: jsonEncode({'reflection': reflection.trim(), 'platform': platform}),
              )
              .timeout(const Duration(seconds: 45));

          if (res.statusCode >= 200 && res.statusCode < 300) {
            Map<String, dynamic>? data;
            try {
              final decoded = jsonDecode(res.body);
              if (decoded is Map<String, dynamic>) {
                data = decoded;
              } else if (decoded is Map) {
                data = Map<String, dynamic>.from(decoded);
              }
            } catch (_) {}

            final posts = data?['posts'];
            if (posts is List && posts.isNotEmpty) {
              final normalized = <Map<String, String>>[];
              for (final item in posts) {
                if (item is Map) {
                  final row = Map<String, dynamic>.from(item);
                  final post = '${row['post'] ?? ''}'.trim();
                  if (post.isEmpty) continue;
                  normalized.add({
                    'eventLabel': '${row['eventLabel'] ?? 'Moment'}',
                    'post': post,
                  });
                }
              }
              if (normalized.isNotEmpty) return normalized;
            }

            final txt = res.body;
            final short120 = txt.length > 120 ? txt.substring(0, 120) : txt;
            lastErr = Exception(
              'Suggestions backend returned OK but no posts. URL=$apiBase/api/linkedin/suggestions Body=$short120',
            );
            continue;
          }

          final t = res.body;
          final short150 = t.length > 150 ? t.substring(0, 150) : t;
          lastErr = Exception(
            'Suggestions backend failed: ${res.statusCode} $short150. URL=$apiBase/api/linkedin/suggestions',
          );
        } catch (e) {
          final msg = e.toString();
          lastErr = Exception('Suggestions backend unreachable: $msg. URL=$apiBase/api/linkedin/suggestions');
          continue;
        }
      }

      if (getVertexGeminiUrl().isNotEmpty) {
        try {
          final sharePrompt = _buildReflectionShareSuggestionsPrompt(reflection, platform);
          final raw = await callVertexGenerateContent(
            prompt: sharePrompt,
            temperature: 0.5,
            maxOutputTokens: 4096,
          ).timeout(const Duration(seconds: 45));
          return _parseShareSuggestionModelOutput(raw.trim(), reflection);
        } catch (vertexErr) {
          lastErr = vertexErr is Exception ? vertexErr : Exception(vertexErr.toString());
        }
      }

      // In native/local: backend can be unreachable due to network/CORS.
      // Do NOT immediately fall back to echoing the reflection â€” try Vertex/OpenAI fallback below first.
      if (lastErr != null) {
        // Keep parity with JS flow by continuing to OpenAI fallback.
      }
    } catch (e) {
      final msg = e.toString();
      throw Exception('Suggestions failed: $msg');
    }

    openaiApiKey = Env.openAiApiKey.trim().isNotEmpty ? Env.openAiApiKey.trim() : openaiApiKey;
    final apiKey = openaiApiKey.trim();
    if (apiKey.isEmpty) {
      final trimmed = reflection.trim();
      if (trimmed.isNotEmpty) {
        return [
          {'eventLabel': 'Reflection', 'post': trimmed},
        ];
      }
      throw Exception(
        'OpenAI API key is not set. Add REACT_APP_OPENAI_API_KEY to .env for share suggestions, or set REACT_APP_BACKEND_URL (preferred) / REACT_APP_VERTEX_BACKEND_URL / REACT_APP_VERTEX_GEMINI_URL to use your backend instead.',
      );
    }

    final prompt = _buildReflectionShareSuggestionsPrompt(reflection, platform);
    final apiUrl = '$openaiBaseURL/chat/completions';
    final requestBody = {
      'model': openaiModelName,
      'messages': [
        {'role': 'user', 'content': prompt},
      ],
      'temperature': 0.5,
      'max_tokens': 2400,
    };
    const headers = {'Content-Type': 'application/json'};

    http.Response response;
    try {
      response = await http
          .post(
            Uri.parse(apiUrl),
            headers: {...headers, 'Authorization': 'Bearer $apiKey'},
            body: jsonEncode(requestBody),
          )
          .timeout(const Duration(seconds: 45));
    } catch (e) {
      final name = e.runtimeType.toString();
      final msg = e.toString();
      throw Exception('Suggestions request failed ($name): $msg. URL=$apiUrl');
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final errText = response.body;
      final short200 = errText.length > 200 ? errText.substring(0, 200) : errText;
      throw Exception('Suggestions failed: ${response.statusCode} $short200. URL=$apiUrl');
    }

    final data = jsonDecode(response.body) as Map<String, dynamic>;
    var raw = '';
    final choices = data['choices'];
    if (choices is List && choices.isNotEmpty) {
      final first = choices.first;
      if (first is Map &&
          first['message'] is Map &&
          (first['message'] as Map)['content'] is String) {
        raw = (first['message'] as Map)['content'] as String;
      }
    }
    return _parseShareSuggestionModelOutput(raw.trim(), reflection);
  }

  Future<List<Map<String, String>>> generateSocialPostSuggestionsStream(
    String reflection,
    String platform, {
    void Function(String text)? onDelta,
  }) async {
    if (platform == 'x') {
      return generateSocialPostSuggestions(reflection, platform);
    }

    final candidates = _shareSuggestionsApiBases();
    var origin = '';
    if (kIsWeb) {
      try {
        origin = Uri.base.origin;
      } catch (_) {
        origin = Uri.base.toString();
      }
    }
    final originLooksLocal = origin.isEmpty ||
        origin.contains('localhost') ||
        origin.startsWith('capacitor://') ||
        origin.startsWith('ionic://') ||
        origin.startsWith('file://');

    Exception? lastErr;
    for (final apiBase in candidates) {
      if (apiBase.isEmpty) continue;
      final client = http.Client();
      try {
        final request = http.Request(
          'POST',
          Uri.parse('$apiBase/api/linkedin/suggestions?stream=1'),
        )
          ..headers['Content-Type'] = 'application/json'
          ..headers['Accept'] = 'text/event-stream'
          ..body = jsonEncode({'reflection': reflection.trim(), 'platform': platform});

        final res = await client.send(request).timeout(const Duration(seconds: 60));
        if (res.statusCode < 200 || res.statusCode >= 300) {
          final body = await res.stream.bytesToString();
          final short160 = body.length > 160 ? body.substring(0, 160) : body;
          lastErr = Exception(
            'Suggestions stream failed: ${res.statusCode} $short160. URL=$apiBase/api/linkedin/suggestions?stream=1',
          );
          continue;
        }

        var buf = '';
        var fullRaw = '';

        void emitDelta(String s) {
          if (s.isEmpty) return;
          fullRaw += s;
          if (onDelta != null) onDelta(s);
        }

        await for (final chunk in res.stream.transform(utf8.decoder)) {
          buf += chunk.replaceAll('\r\n', '\n');

          var idx = buf.indexOf('\n\n');
          while (idx != -1) {
            final frame = buf.substring(0, idx);
            buf = buf.substring(idx + 2);

            final lines = frame.split('\n');
            var eventName = '';
            var dataLine = '';
            for (final line in lines) {
              if (line.startsWith('event:')) eventName = line.substring(6).trim();
              if (line.startsWith('data:')) dataLine += line.substring(5).trim();
            }
            if (dataLine.isEmpty) {
              idx = buf.indexOf('\n\n');
              continue;
            }
            try {
              final payload = jsonDecode(dataLine);
              if (payload is Map) {
                if (eventName == 'delta' && payload['text'] is String) {
                  emitDelta(payload['text'] as String);
                } else if (eventName == 'done') {
                  final raw = payload['raw'] is String ? payload['raw'] as String : fullRaw;
                  final parsed = _parseShareSuggestionModelOutput(raw.trim(), reflection);
                  if (parsed.isNotEmpty) return parsed;
                  return [
                    {'eventLabel': 'Reflection', 'post': reflection.trim()},
                  ];
                }
              }
            } catch (_) {
              // Ignore malformed frames.
            }

            idx = buf.indexOf('\n\n');
          }
        }

        final parsed = _parseShareSuggestionModelOutput(fullRaw.trim(), reflection);
        if (parsed.isNotEmpty) return parsed;
        return [
          {'eventLabel': 'Reflection', 'post': reflection.trim()},
        ];
      } catch (e) {
        final msg = e.toString();
        lastErr = Exception(
          'Suggestions stream unreachable: $msg. URL=$apiBase/api/linkedin/suggestions?stream=1',
        );
        continue;
      } finally {
        client.close();
      }
    }

    if (originLooksLocal && lastErr != null) {
      try {
        return await generateSocialPostSuggestions(reflection, platform);
      } catch (_) {
        final trimmed = reflection.trim();
        if (trimmed.isNotEmpty) {
          return [
            {'eventLabel': 'Reflection', 'post': trimmed},
          ];
        }
        throw lastErr;
      }
    }
    return generateSocialPostSuggestions(reflection, platform);
  }

  bool _isGoogleNewsArticleUrl(String? url) {
    final value = (url ?? '').trim();
    return RegExp(r'news\.google\.com/(rss/)?articles/', caseSensitive: false).hasMatch(value);
  }

  bool _isRedditThreadUrl(String? url) {
    try {
      final u = Uri.parse((url ?? '').trim());
      var host = u.host.toLowerCase();
      if (host.startsWith('www.')) host = host.substring(4);
      if (host.startsWith('np.')) host = host.substring(3);
      if (host.startsWith('old.')) host = host.substring(4);
      if (host.startsWith('m.')) host = host.substring(2);
      if (host != 'reddit.com' && !host.endsWith('.reddit.com')) return false;
      return RegExp(r'/comments/[a-z0-9]+', caseSensitive: false).hasMatch(u.path);
    } catch (_) {
      return false;
    }
  }

  String? _buildRedditJsonUrl(String? permalink) {
    try {
      final u = Uri.parse((permalink ?? '').trim());
      var host = u.host.toLowerCase();
      if (host.startsWith('np.') || host.startsWith('old.')) host = 'www.reddit.com';
      if (!host.endsWith('reddit.com')) return null;

      var path = u.path;
      if (path.endsWith('/')) path = path.substring(0, path.length - 1);
      if (!RegExp(r'/comments/[a-z0-9]+', caseSensitive: false).hasMatch(path)) return null;

      final jsonPath = path.endsWith('.json') ? path : '$path.json';
      final query = Map<String, String>.from(u.queryParameters);
      query['raw_json'] = '1';
      query['limit'] = '500';
      return Uri(
        scheme: u.scheme.isEmpty ? 'https' : u.scheme,
        host: host,
        path: jsonPath,
        queryParameters: query,
      ).toString();
    } catch (_) {
      return null;
    }
  }

  String? _redditHeroImageFromPost(dynamic post) {
    if (post is! Map) return null;
    try {
      final preview = post['preview'];
      if (preview is Map) {
        final images = preview['images'];
        if (images is List && images.isNotEmpty && images.first is Map) {
          final source = (images.first as Map)['source'];
          if (source is Map) {
            final src = source['url'];
            if (src is String && src.startsWith('http')) {
              return src.replaceAll('&amp;', '&').trim();
            }
          }
        }
      }
    } catch (_) {
      // ignore
    }

    final link = (post['url'] is String) ? (post['url'] as String).trim() : '';
    final linkNoQuery = link.split('?').first;
    if (RegExp(r'^https?://', caseSensitive: false).hasMatch(link) &&
        RegExp(r'\.(jpe?g|png|gif|webp)(\?|$)', caseSensitive: false).hasMatch(linkNoQuery)) {
      return link;
    }

    final thumbnail = (post['thumbnail'] is String) ? (post['thumbnail'] as String).trim() : '';
    if (thumbnail.startsWith('http')) return thumbnail;
    return null;
  }

  void _collectRedditComments(
    List<dynamic>? children,
    List<Map<String, String>> out,
    int depth,
    int maxDepth,
    int maxCount,
  ) {
    if (children == null || out.length >= maxCount || depth > maxDepth) return;
    for (final child in children) {
      if (out.length >= maxCount) break;
      if (child is! Map) continue;
      if (child['kind'] == 'more') continue;
      if (child['kind'] != 't1') continue;
      final data = child['data'];
      if (data is! Map) continue;

      final body = (data['body'] is String) ? (data['body'] as String).trim() : '';
      if (body.isEmpty || body == '[removed]' || body == '[deleted]') continue;
      out.add({
        'author': (data['author'] ?? 'unknown').toString(),
        'body': body,
      });

      if (depth < maxDepth) {
        final replies = data['replies'];
        if (replies is Map &&
            replies['data'] is Map &&
            (replies['data'] as Map)['children'] is List) {
          _collectRedditComments(
            ((replies['data'] as Map)['children'] as List).cast<dynamic>(),
            out,
            depth + 1,
            maxDepth,
            maxCount,
          );
        }
      }
    }
  }

  Future<Map<String, dynamic>?> _fetchRedditThreadPayload(
    String permalink,
    Map<String, dynamic> seed,
  ) async {
    try {
      final details = await fetchRedditThreadDetails(permalink, seed: seed);
      if (details == null) return null;
      final text = '${details['text'] ?? ''}'.trim();
      final gossip = '${details['gossip'] ?? details['description'] ?? ''}'.trim();
      if (text.length >= 12 || gossip.length >= 12) return details;
      return null;
    } catch (_) {
      return null;
    }
  }

  Future<String> _fetchReadableTextViaJina(String targetUrl) async {
    final path = targetUrl.replaceFirst(RegExp(r'^https?://', caseSensitive: false), '').trim();
    if (path.isEmpty) return '';
    final readerUrls = ['https://r.jina.ai/https://$path', 'https://r.jina.ai/http://$path'];

    var best = '';
    for (final readerUrl in readerUrls) {
      try {
        final res = await http.get(Uri.parse(readerUrl)).timeout(const Duration(seconds: 20));
        if (res.statusCode < 200 || res.statusCode >= 300) continue;
        final cleaned = res.body.replaceAll(RegExp(r'\s+'), ' ').trim();
        if (cleaned.length > best.length && cleaned.length > 200) {
          best = cleaned;
        }
      } catch (_) {
        // ignore and try next reader URL
      }
    }
    return best.length > 12000 ? best.substring(0, 12000) : best;
  }

  Future<Map<String, dynamic>> _fetchArticlePayloadForUrl(
    String targetUrl,
    Map<String, dynamic> seed,
    List<String> apiBases,
  ) async {
    var out = <String, dynamic>{
      'title': (seed['title'] ?? '').toString().trim(),
      'url': targetUrl.trim(),
      'description': (seed['description'] ?? '').toString().trim(),
      'image': seed['image'],
      'source': (seed['source'] ?? '').toString().trim(),
      'text': '',
    };

    // Reddit blocks scrapers; Jina often returns 403 boilerplate - thread text comes from .json API instead.
    if (_isRedditThreadUrl(targetUrl)) return out;

    for (final base in apiBases) {
      final apiBase = base.trim();
      if (apiBase.isEmpty) continue;
      try {
        final apiUrl = '$apiBase/api/linkedin/article?url=${Uri.encodeComponent(targetUrl)}';
        final res = await http.get(Uri.parse(apiUrl)).timeout(const Duration(seconds: 20));
        if (res.statusCode < 200 || res.statusCode >= 300) continue;
        dynamic data;
        try {
          data = jsonDecode(res.body);
        } catch (_) {
          continue;
        }
        if (data is! Map) continue;
        final text = (data['text'] ?? '').toString().trim();
        final prevText = (out['text'] ?? '').toString();
        if (text.length > prevText.length) {
          out = {
            'title': (data['title'] ?? out['title'] ?? '').toString().trim(),
            'url': (data['sourceUrl'] ?? data['url'] ?? targetUrl).toString().trim(),
            'description': (data['description'] ?? out['description'] ?? '').toString().trim(),
            'image': (data['image'] is String && (data['image'] as String).trim().isNotEmpty)
                ? (data['image'] as String).trim()
                : out['image'],
            'source': (data['source'] ?? out['source'] ?? '').toString().trim(),
            'text': text,
          };
        }
      } catch (_) {
        // try next backend
      }
    }

    final jina = await _fetchReadableTextViaJina(targetUrl);
    if (jina.length > (out['text'] ?? '').toString().length) {
      out = {...out, 'text': jina};
    }
    return out;
  }

  Future<Map<String, dynamic>> fetchNewsArticleDetails(
    Map<String, dynamic>? article, [
    Map<String, dynamic> options = const {},
  ]) async {
    final minTextLen = options['minTextLength'] is num ? (options['minTextLength'] as num).toInt() : 400;
    final title = (article?['title'] ?? '').toString().trim();
    final url = (article?['url'] ?? '').toString().trim();
    final description = (article?['description'] ?? '').toString().trim();
    final image = (article?['image'] ?? '').toString().trim();
    final source = (article?['source'] ?? '').toString().trim();

    final base = <String, dynamic>{
      'title': title,
      'url': url,
      'description': description,
      'image': image.isNotEmpty ? image : null,
      'source': source,
      'text': '',
    };
    if (url.isEmpty) return base;

    final maybeText = (article?['text'] is String) ? (article!['text'] as String).trim() : '';
    if (maybeText.isNotEmpty && maybeText.length >= minTextLen) {
      return {...base, 'text': maybeText};
    }

    final preGossip =
        (article?['gossip'] ?? article?['description'] ?? '').toString().trim();
    if (_isRedditThreadUrl(url) && preGossip.length >= 12) {
      return {
        ...base,
        'description': preGossip,
        'gossip': preGossip,
        'selftext': preGossip,
        'text': maybeText.isNotEmpty ? maybeText : preGossip,
      };
    }

    final seed = <String, dynamic>{
      'title': title,
      'description': description,
      'image': image.isNotEmpty ? image : null,
      'source': source,
    };

    if (_isRedditThreadUrl(url)) {
      final reddit = await _fetchRedditThreadPayload(url, seed);
      if (reddit != null && (reddit['text'] is String) && (reddit['text'] as String).length >= 12) {
        return {
          'title': (reddit['title'] ?? title).toString(),
          'url': (reddit['url'] ?? url).toString(),
          'description': (reddit['description'] ?? reddit['gossip'] ?? description).toString(),
          'gossip': (reddit['gossip'] ?? reddit['description'] ?? '').toString(),
          'selftext': (reddit['selftext'] ?? '').toString(),
          'image': reddit['image'] ?? (image.isNotEmpty ? image : null),
          'source': (reddit['source'] ?? source).toString(),
          'text': (reddit['text'] ?? '').toString(),
        };
      }
    }

    final apiBases = <String>[
      Env.backendUrl.trim(),
      'https://deitedatabase.web.app',
      'https://deitedatabase.firebaseapp.com',
    ].where((e) => e.isNotEmpty).toList();

    var best = await _fetchArticlePayloadForUrl(url, seed, apiBases);
    final shouldResolveGoogle = options['resolveGoogleNews'] != false;
    if ((best['text'] ?? '').toString().length < minTextLen &&
        _isGoogleNewsArticleUrl(url) &&
        shouldResolveGoogle) {
      final publisherUrl = decodeGoogleNewsUrl(url);
      if (publisherUrl != null && publisherUrl != url) {
        final second = await _fetchArticlePayloadForUrl(publisherUrl, seed, apiBases);
        if ((second['text'] ?? '').toString().length > (best['text'] ?? '').toString().length) {
          best = {...second, 'url': (second['url'] ?? publisherUrl).toString()};
        }
      }
    }

    return {
      'title': (best['title'] ?? title).toString(),
      'url': (best['url'] ?? url).toString(),
      'description': ((best['description'] ?? '').toString().isNotEmpty ? best['description'] : description).toString(),
      'image': best['image'] ?? (image.isNotEmpty ? image : null),
      'source': ((best['source'] ?? '').toString().isNotEmpty ? best['source'] : source).toString(),
      'text': ((best['text'] ?? '').toString().isNotEmpty ? best['text'] : maybeText).toString(),
    };
  }

  String _newsAngleTypeToEventLabel(String? type) {
    final t = (type ?? '').trim().toLowerCase();
    const map = {
      'insight': 'Insight / Learning',
      'contrarian': 'Contrarian / Debate',
      'actionable': 'Actionable / What next',
      'business': 'Business / Startup perspective',
      'leadership': 'Leadership angle',
      'prediction': 'Future prediction',
      'ethical': 'Ethical concern',
    };
    if (map.containsKey(t)) return map[t]!;
    if (t.isEmpty) return '';
    final words = t.replaceAll('_', ' ').trim();
    if (words.isEmpty) return '';
    return 'Other perspective: ${words[0].toUpperCase()}${words.substring(1)}';
  }

  String _teaAngleTypeToEventLabel(String? type) {
    final t = (type ?? '').trim().toLowerCase();
    const map = {
      'hot_take': 'Hot take',
      'real_talk': 'Real talk',
      'question': 'Question',
      'different_angle': 'Different angle',
      'insight': 'Hot take',
      'contrarian': 'Different angle',
    };
    if (map.containsKey(t)) return map[t]!;
    if (t.isEmpty) return '';
    final words = t.replaceAll('_', ' ').trim();
    if (words.isEmpty) return '';
    return words[0].toUpperCase() + words.substring(1);
  }

  String _teaPromptSourceLine(String source) {
    if (isTeaSourceLabel(source) || source.trim().toLowerCase() == 'reddit') return '';
    return source.isNotEmpty ? 'From: $source\n' : '';
  }

  String _buildLinkedInTeaSuggestionsUserContent(Map<String, dynamic> ctx) {
    final title = (ctx['title'] ?? '').toString().trim();
    final description = (ctx['description'] ?? '').toString().trim();
    final source = (ctx['source'] ?? '').toString().trim();
    final articleText = (ctx['articleText'] ?? '').toString().trim();
    final sourceLine = _teaPromptSourceLine(source);
    final summaryLine = description.isNotEmpty ? 'Discussion summary:\n$description\n' : '';
    final articleSection = articleText.isNotEmpty
        ? '\nThread highlights:\n${articleText.length > 5000 ? articleText.substring(0, 5000) : articleText}\n'
        : '';
    return '''You write LinkedIn posts about celebrity/gossip tea — like a real person sharing their take, NOT a news bot or scraper.

GOAL: 4 distinct, human-sounding posts someone would actually publish on LinkedIn.

Requirements:
1. Generate exactly 4 posts with these angle types (use exact "type" values):
   - hot_take — bold reaction to the drama
   - real_talk — honest, grounded take
   - question — invite discussion with a genuine question
   - different_angle — a less obvious read on the story

2. Each post MUST:
   - Sound like a real human wrote it (first person, conversational, opinionated but fair)
   - Use short paragraphs with line breaks
   - Be 60–120 words
   - NEVER include URLs, "Source -", "Read more", usernames like /u/..., subreddit names (r/...), or raw scraped metadata
   - NEVER paste long quotes or dump comment threads — synthesize the vibe in your own words
   - Base only on the context below; do not invent facts

3. Tone: LinkedIn-appropriate gossip — curious, witty, thoughtful. Not tabloid screaming.

Context (for your eyes only — do not copy verbatim into posts):
Title: $title
${sourceLine}${summaryLine}${articleSection}

Output — return ONLY valid JSON (no markdown fences):
{"posts":[{"type":"hot_take","content":"Full post text only"}]}

Rules:
- Exactly 4 posts, one per type listed above.
- "content" is ONLY publishable LinkedIn text. No labels inside content.''';
  }

  String _buildLinkedInNewsArticleSuggestionsUserContent(Map<String, dynamic> ctx) {
    final title = (ctx['title'] ?? '').toString().trim();
    final url = (ctx['url'] ?? '').toString().trim();
    final description = (ctx['description'] ?? '').toString().trim();
    final source = (ctx['source'] ?? '').toString().trim();
    final articleText = (ctx['articleText'] ?? '').toString().trim();
    final sourceLine = source.isNotEmpty ? 'Source: $source\n' : '';
    final summaryLine = description.isNotEmpty ? 'Summary: $description\n' : '';
    final articleSection = articleText.isNotEmpty
        ? '\nArticle / thread text:\n${articleText.length > 6000 ? articleText.substring(0, 6000) : articleText}\n'
        : '';
    final urlLine = 'URL: $url\n';
    return '''You are generating LinkedIn post suggestions from a news story.

GOAL:
Create high-quality, diverse, thought-provoking LinkedIn posts.

Requirements:

1. Generate between 3 and 6 posts (choose a natural count for this story â€” vary count when appropriate, do not always output the same number).

2. Each post MUST follow a DISTINCT angle. Choose from ONLY these angle types (use these exact "type" string values):
   - insight â€” Insight / Learning
   - contrarian â€” Contrarian / Debate
   - actionable â€” Actionable / What next
   - business â€” Business / Startup perspective
   - leadership â€” Leadership angle
   - prediction â€” Future prediction
   - ethical â€” Ethical concern

3. Process: First plan distinct angles (one line each), then write the full posts. Include both steps in your JSON.

4. Each post MUST:
   - Start with a strong professional hook
   - Be insightful and structured; sound like a real human expert (not AI)
   - Use a different professional mindset per post (e.g. founder, analyst, operator, leader) â€” do NOT repeat the same framing
   - Include light formatting (line breaks between short paragraphs)
   - Optionally end with a thoughtful question or crisp takeaway

5. Tone: Professional, intelligent, slightly analytical.

6. Length: Each post "content" field must be 80â€“150 words.

7. Ground truth â€” base only on the story below; do not invent facts, names, numbers, or events.

8. Do not write meta lines ("This article", "According to the piece", "Here's my LinkedIn post"). No wire-service recap voice.

Story context:
Title: $title
${sourceLine}${summaryLine}${urlLine}${articleSection}

Output â€” return ONLY valid JSON (no markdown code fences). Use this exact shape:
{"angles":[{"type":"insight","brief":"One-line plan for this angle only"}],"posts":[{"type":"insight","content":"Full post text only"}]}

Rules for JSON:
- "angles": 3â€“6 objects; each "type" must be one of the allowed slugs above; each "brief" is a single planning line (not the post).
- "posts": same count as angles; order should match your plan; each "type" must match its angle and be unique across posts (no duplicate type).
- "content" is only the text someone would publish on LinkedIn (no labels like "Post 1:" inside content).''';
  }

  String _xNewsStyleTypeToEventLabel(String? type) {
    final t = (type ?? '').trim().toLowerCase();
    const map = {
      'funny': 'Funny',
      'sarcastic': 'Sarcastic',
      'supportive': 'Supportive',
      'critical': 'Critical / skeptical',
      'relatable': 'Relatable',
      'shock': 'Shock reaction',
      'meme': 'Meme-style',
      'insight': 'Short insight',
      'question': 'Question',
    };
    if (map.containsKey(t)) return map[t]!;
    if (t.isEmpty) return '';
    final words = t.replaceAll('_', ' ').trim();
    if (words.isEmpty) return '';
    return 'Other: ${words[0].toUpperCase()}${words.substring(1)}';
  }

  String _buildXTeaSuggestionsUserContent(Map<String, dynamic> ctx) {
    final title = (ctx['title'] ?? '').toString().trim();
    final description = (ctx['description'] ?? '').toString().trim();
    final source = (ctx['source'] ?? '').toString().trim();
    final articleText = (ctx['articleText'] ?? '').toString().trim();
    final sourceLine = _teaPromptSourceLine(source);
    final summaryLine = description.isNotEmpty ? 'Discussion summary:\n$description\n' : '';
    final articleSection = articleText.isNotEmpty
        ? '\nThread highlights:\n${articleText.length > 5000 ? articleText.substring(0, 5000) : articleText}\n'
        : '';
    return '''You write X (Twitter) posts about celebrity/gossip tea — like a real person reacting, NOT a scraper.

GOAL: 5–8 distinct, human-sounding tweets someone would actually post.

Requirements:
1. Generate 5–8 tweets with these style types (use exact "type" values, each once):
   funny, sarcastic, supportive, critical, relatable, shock, meme, insight, question

2. Each tweet MUST:
   - Focus on ONE reaction or angle — not a full recap
   - Be 220 characters or fewer (including line breaks and hashtags)
   - Use 2–4 SHORT lines separated by real line breaks (\\n), not a single block of text
   - End with 0–2 hashtags on the last line when natural
   - Sound like a real human (first person, casual, opinionated)
   - NEVER include URLs, "Source -", usernames like /u/..., subreddit names (r/...), or raw scraped metadata
   - NEVER paste long quotes or dump comment threads — synthesize in your own words
   - Base only on the context below; do not invent facts

3. Tone: Internet-native gossip — witty, reactive, slightly dramatic. Not tabloid screaming.

Context (for your eyes only — do not copy verbatim into tweets):
Title: $title
${sourceLine}${summaryLine}${articleSection}

Output — return ONLY valid JSON (no markdown fences):
{"posts":[{"eventLabel":"3-6 word hook","type":"funny","content":"line1\\nline2\\n#Tag"}]}

Rules:
- 5–8 posts; each "type" from the list above at most once.
- "eventLabel": short card title (3–6 words) for the angle
- "content": ONLY publishable tweet text with \\n line breaks. Under 220 characters each.''';
  }

  String _buildXReflectionSuggestionsUserContent(String reflection) {
    final text = reflection.trim();
    return '''You are generating X (Twitter) posts from someone's personal reflection.

GOAL:
Create short, punchy, personality-driven tweets — same format as our news X suggestions.

CORE RULE:
Each tweet = ONE thought, ONE reaction, ONE moment. Do NOT dump the whole reflection into one tweet.

---

Requirements:

1. Generate between 3 and 6 tweets (one per distinct moment or angle in the reflection).

2. Each tweet MUST use a DIFFERENT style/tone. Use these exact "type" values (each at most once):
   funny, sarcastic, supportive, critical, relatable, shock, meme, insight, question

3. Each tweet MUST:
   - Focus on ONE small slice of the reflection
   - Be 220 characters or fewer (including line breaks and hashtags)
   - Use 2–4 SHORT lines separated by real line breaks (\\n), not a single block of text
   - End with 0–2 hashtags on the last line when natural (e.g. #Cricket #CricketTwitter)
   - Sound natural and human — first person, internet-native, reactive
   - Start with a strong hook on line 1

4. Example CONTENT shape (not the topic — match this structure):
That Arjun Tendulkar 50 was just incredible!
Pure class under pressure.
What a knock!
#Cricket #ArjunTendulkar

5. Ground truth — only what the reflection supports; do not invent facts.

Reflection:
$text

Output — return ONLY valid JSON (no markdown fences):
{"posts":[{"eventLabel":"3-6 word hook title","type":"insight","content":"line1\\nline2\\nline3\\n#Tag"}]}

Rules:
- "eventLabel": short purple-card title (3–6 words) naming the moment, e.g. "Arjun Tendulkar's 50"
- "content": ONLY publishable tweet text with \\n line breaks. Under 220 characters each.''';
  }

  String _buildXNewsArticleSuggestionsUserContent(Map<String, dynamic> ctx) {
    final title = (ctx['title'] ?? '').toString().trim();
    final url = (ctx['url'] ?? '').toString().trim();
    final description = (ctx['description'] ?? '').toString().trim();
    final source = (ctx['source'] ?? '').toString().trim();
    final articleText = (ctx['articleText'] ?? '').toString().trim();
    final sourceLine = source.isNotEmpty ? 'Source: $source\n' : '';
    final summaryLine = description.isNotEmpty ? 'Summary: $description\n' : '';
    final urlLine = 'URL: $url\n';
    final articleSection = articleText.isNotEmpty
        ? '\nArticle / thread text:\n${articleText.length > 6000 ? articleText.substring(0, 6000) : articleText}\n'
        : '';
    return '''You are generating X (Twitter) posts from a news story.

GOAL:
Create short, punchy, personality-driven tweets.
Each tweet should focus on ONE specific idea, reaction, or angle â€” NOT the full story.

CORE RULE:
Each tweet = ONE thought, ONE reaction, ONE punch.
Do NOT try to explain the whole news.

---

Requirements:

1. Generate between 5 and 10 tweets (pick a natural count for this story â€” vary it; do not always output the same number).

2. Each tweet MUST use a DIFFERENT style/tone. Use these exact "type" string values (one tweet per type you use; no duplicate types in your list):
   - funny â€” Funny
   - sarcastic â€” Sarcastic
   - supportive â€” Supportive
   - critical â€” Critical / skeptical
   - relatable â€” Relatable
   - shock â€” Shock reaction
   - meme â€” Meme-style
   - insight â€” Short insight
   - question â€” Question

3. Each tweet MUST:
   - Focus on ONE small slice of the news (not a summary of the whole piece)
   - Be 220 characters or fewer (count characters including line breaks; stay under the limit)
   - Use 2–4 SHORT lines separated by real line breaks (\\n), not a single block of text
   - End with 0–2 hashtags on the last line when natural (e.g. #Cricket #ArjunTendulkar)
   - Start with a strong hook on line 1
   - Feel natural and human (not AI-generated)
   - Avoid repeating the same idea across tweets (different angles, different people's vibes)

4. Example CONTENT shape (match this structure, not the topic):
That Arjun Tendulkar 50 was just incredible!
Pure class under pressure.
What a knock!
#Cricket #ArjunTendulkar

5. Tone: Casual, internet-native, slightly edgy but not offensive, hateful, or targeting protected groups.

6. Style: Short sentences; emojis optional and sparse; rhetorical questions allowed.

6. Good moves: react to one detail only; joke; question one decision; highlight irony; meme-like observation â€” never a thread that explains the article.

7. Ground truth — only what the story supports; do not invent facts, quotes, or numbers.

8. Do not summarize the news. Do not open with "In the news" or "According to reports."

Story context:
Title: $title
${sourceLine}${summaryLine}${urlLine}${articleSection}

Output â€” return ONLY valid JSON (no markdown code fences). Root must be an object with this exact shape:
{"posts":[{"eventLabel":"3-6 word hook","type":"funny","content":"line1\\nline2\\n#Tag"}]}

Rules:
- "posts": 5â€“10 objects; each "type" is one of the allowed slugs; each "type" appears at most once.
- "eventLabel": short card title (3–6 words) for the angle, e.g. "Arjun Tendulkar's 50"
- "content": ONLY publishable tweet text with real line breaks (\\n). Under 220 characters each.''';
  }

  Future<String> _fetchSuggestionContentRaw(
    String userContent, {
    bool isXNews = false,
    bool isLinkedInNews = false,
  }) async {
    var raw = '';
    if (getVertexGeminiUrl().trim().isNotEmpty) {
      try {
        raw = await callVertexGenerateContent(
          prompt: userContent,
          temperature: isLinkedInNews
              ? 0.68
              : isXNews
                  ? 0.78
                  : 0.62,
          maxOutputTokens: isLinkedInNews
              ? 8192
              : isXNews
                  ? 6144
                  : 4096,
        ).timeout(const Duration(seconds: 45));
      } catch (e) {
        debugPrint('Vertex suggestions failed: $e');
        raw = '';
      }
    }

    final apiKey = Env.openAiApiKey.trim();
    if (raw.trim().isEmpty && apiKey.isNotEmpty) {
      try {
        final response = await http
            .post(
              Uri.parse('$openaiBaseURL/chat/completions'),
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer $apiKey',
              },
              body: jsonEncode({
                'model': openaiModelName,
                'messages': [
                  {'role': 'user', 'content': userContent},
                ],
                'temperature': isLinkedInNews
                    ? 0.68
                    : isXNews
                        ? 0.78
                        : 0.62,
                'max_tokens': isLinkedInNews
                    ? 4500
                    : isXNews
                        ? 3500
                        : 2000,
                if (isXNews) 'response_format': {'type': 'json_object'},
              }),
            )
            .timeout(const Duration(seconds: 45));
        if (response.statusCode >= 200 && response.statusCode < 300) {
          dynamic data;
          try {
            data = jsonDecode(response.body);
          } catch (_) {
            data = null;
          }
          raw = (data is Map &&
                  data['choices'] is List &&
                  (data['choices'] as List).isNotEmpty &&
                  ((data['choices'] as List).first is Map))
              ? ((((data['choices'] as List).first as Map)['message'] as Map?)?['content'] ?? '')
                  .toString()
              : '';
        }
      } catch (_) {
        raw = '';
      }
    }
    return raw.trim();
  }

  List<ShareSuggestion> _parseXContentSuggestionsJson(
    String raw,
    String platform, {
    required List<ShareSuggestion> fallback,
    bool isTea = false,
  }) {
    if (raw.isEmpty) return fallback;

    dynamic parsed;
    final rawTrim = raw.trim();
    try {
      parsed = jsonDecode(rawTrim);
    } catch (_) {
      final fence = RegExp(r'```(?:json)?\s*([\s\S]*?)```', caseSensitive: false).firstMatch(rawTrim);
      final inner = (fence?.group(1) ?? rawTrim).trim();
      final objectMatch =
          RegExp(r'\{[\s\S]*"posts"[\s\S]*\}', caseSensitive: false, dotAll: true).firstMatch(inner);
      final arrayMatch = RegExp(
        r'\[[\s\S]*\{[\s\S]*"type"[\s\S]*"content"[\s\S]*\}[\s\S]*\]',
        caseSensitive: false,
        dotAll: true,
      ).firstMatch(inner);
      final candidate = objectMatch?.group(0) ?? arrayMatch?.group(0);
      if (candidate == null) return fallback;
      try {
        parsed = jsonDecode(candidate);
      } catch (_) {
        return fallback;
      }
    }

    List<dynamic> list = <dynamic>[];
    if (parsed is List) {
      list = parsed;
    } else if (parsed is Map && parsed['posts'] is List) {
      list = (parsed['posts'] as List).cast<dynamic>();
    }

    bool looksLikeInternalPrompt(String text) {
      final t = text;
      return RegExp(r'The user wants social posts based on this NEWS ARTICLE', caseSensitive: false).hasMatch(t) ||
          RegExp(r'Ground posts only in the headline and summary', caseSensitive: false).hasMatch(t) ||
          RegExp(r'Your job is to turn news into a tweet', caseSensitive: false).hasMatch(t) ||
          RegExp(r'\bCRITICAL RULES\b', caseSensitive: false).hasMatch(t) ||
          RegExp(r'\bHUMAN STYLE\b', caseSensitive: false).hasMatch(t) ||
          RegExp(r'\bCONTENT STYLE\b', caseSensitive: false).hasMatch(t) ||
          RegExp(r'\bIMPORTANT\b', caseSensitive: false).hasMatch(t) ||
          RegExp(r'Create high-quality, diverse, thought-provoking LinkedIn posts', caseSensitive: false)
              .hasMatch(t) ||
          RegExp(r'You are generating X \(Twitter\) posts', caseSensitive: false).hasMatch(t);
    }

    String stripPromptLeak(String text) {
      final t = text.trim();
      if (t.isEmpty) return '';
      const cutMarkers = <String>[
        '\n\nYour job is to turn news into a tweet',
        '\nYour job is to turn news into a tweet',
        '\n\nCRITICAL RULES:',
        '\nCRITICAL RULES:',
        '\n\nHUMAN STYLE:',
        '\nHUMAN STYLE:',
        '\n\nCONTENT STYLE',
        '\nCONTENT STYLE',
      ];
      var cutAt = -1;
      final lower = t.toLowerCase();
      for (final marker in cutMarkers) {
        final idx = lower.indexOf(marker.toLowerCase());
        if (idx >= 0 && (cutAt < 0 || idx < cutAt)) cutAt = idx;
      }
      return (cutAt >= 0 ? t.substring(0, cutAt) : t).trim();
    }

    final out = <ShareSuggestion>[];
    for (final row in list) {
      if (row is! Map) continue;
      final postFromContent = row['content'] is String ? (row['content'] as String).trim() : '';
      final postFromLegacy = row['post'] is String ? (row['post'] as String).trim() : '';
      var post = stripPromptLeak(postFromContent.isNotEmpty ? postFromContent : postFromLegacy);
      if (post.contains(r'\n')) {
        post = post.replaceAll(r'\n', '\n');
      }
      if (platform == 'x' && post.length > 220) {
        post = post.substring(0, 220).trimRight();
      }
      final minPostLen = platform == 'x' ? 5 : 8;
      if (post.isEmpty || post.length < minPostLen || looksLikeInternalPrompt(post)) continue;

      final angleType = row['type'] is String ? (row['type'] as String).trim() : '';
      var eventLabel = row['eventLabel'] is String ? (row['eventLabel'] as String).trim() : '';
      if (eventLabel.isEmpty) {
        if (platform == 'x') {
          eventLabel = _xNewsStyleTypeToEventLabel(angleType);
        } else if (platform == 'linkedin') {
          eventLabel = isTea
              ? _teaAngleTypeToEventLabel(angleType)
              : _newsAngleTypeToEventLabel(angleType);
        }
        if (eventLabel.isEmpty) eventLabel = 'News';
      }
      if (isTea) {
        post = sanitizeTeaSharePostForDisplay(post);
      }
      if (post.isEmpty || post.length < minPostLen) continue;
      out.add({'eventLabel': eventLabel, 'post': post});
    }

    if (out.isEmpty) return fallback;
    return out;
  }

  Future<List<ShareSuggestion>> _generateXContentSuggestions({
    required String userContent,
    required List<ShareSuggestion> fallback,
    bool isTea = false,
  }) async {
    final raw = await _fetchSuggestionContentRaw(userContent, isXNews: true);
    return _parseXContentSuggestionsJson(raw, 'x', fallback: fallback, isTea: isTea);
  }

  Future<List<ShareSuggestion>> generateNewsArticleShareSuggestions(
    Map<String, dynamic> article,
    String platform, {
    Map<String, dynamic>? prefetchedDetails,
    bool isTeaGossip = false,
  }) async {
    Map<String, dynamic> details;
    if (prefetchedDetails != null && prefetchedDetails.isNotEmpty) {
      details = Map<String, dynamic>.from(prefetchedDetails);
    } else {
      try {
        details = await fetchNewsArticleDetails(article)
            .timeout(const Duration(seconds: 12));
      } catch (_) {
        details = {
          'title': (article['title'] ?? '').toString(),
          'url': (article['url'] ?? '').toString(),
          'description': (article['description'] ?? article['gossip'] ?? '').toString(),
          'gossip': (article['gossip'] ?? article['description'] ?? '').toString(),
          'text': (article['text'] ?? '').toString(),
          'source': (article['source'] ?? '').toString(),
          'image': article['image'],
        };
      }
    }
    final url = (details['url'] ?? '').toString().trim();
    final source = (details['source'] ?? '').toString().trim();
    final isTea = isTeaGossip || isTeaSourceLabel(source) || isRedditThreadUrl(url);
    if (isTea) {
      details = prepareTeaArticleContextForAi(details);
    }

    final title = (details['title'] ?? '').toString().trim();
    final description = stripUrlsAndSourceNoise((details['description'] ?? details['gossip'] ?? '').toString());
    final articleText = stripUrlsAndSourceNoise((details['text'] ?? '').toString());

    final localTeaFallback = isTea
        ? buildLocalTeaShareSuggestions(details, platform)
        : <ShareSuggestion>[];
    final fallbackPost = stripUrlsAndSourceNoise(
      [title, description].where((s) => s.isNotEmpty).join('\n\n'),
    );
    final fallback = isTea && localTeaFallback.isNotEmpty
        ? localTeaFallback
        : <ShareSuggestion>[
            {
              'eventLabel': 'News',
              'post': fallbackPost.isNotEmpty ? fallbackPost : title,
            },
          ];
    if (title.isEmpty) return fallback;

    final apiKey = Env.openAiApiKey.trim();
    final platformLabel = platform == 'x'
        ? 'X (Twitter)'
        : (platform.isEmpty ? 'LinkedIn' : '${platform[0].toUpperCase()}${platform.substring(1)}');

    const platformStyleGuide = <String, String>{
      'linkedin': '''LINKEDIN - write like YOU, not a news desk:
- You just came across this in your news / feed / timeline - say that naturally (e.g. "Saw thisâ€¦", "Been reading aboutâ€¦", "This popped up in my news todayâ€¦"). Do NOT sound like you're filing a report or summarizing an article for an editor.
- Share what stuck with you and your honest take: surprise, skepticism, warmth, debate - one clear angle per post.
- First person ("I", "my") is expected. Sound human and opinionated, still fair - no invented facts; only what the story/thread supports.
- Not allowed: wire-service tone, "This article discussesâ€¦", "According to reportsâ€¦", "In recent newsâ€¦", or neutral third-person recap unless it's one short beat before your reaction.
- Short paragraphs or a tight hook + 2-3 lines; optional 0-3 hashtags. End with a question or invite to disagree if it fits.''',
      'x': 'X: First person. You\'re reacting to something you saw in the news - hot take or quick gut reaction, not a summary. Under 280 characters. 0-2 hashtags. No "breaking:" headline voice.',
      'reddit':
          'REDDIT: You read the story / thread and you\'re chiming in like a real user - opinion + vibe, not a Wikipedia summary. Casual, first-person, can be blunt or funny.',
    };
    final style = platformStyleGuide[platform] ?? platformStyleGuide['linkedin']!;

    final isLinkedInNews = platform == 'linkedin';
    final isXNews = platform == 'x';
    final userContent = isLinkedInNews && isTea
        ? _buildLinkedInTeaSuggestionsUserContent({
            'title': title,
            'description': description,
            'source': source,
            'articleText': articleText,
          })
        : isLinkedInNews
        ? _buildLinkedInNewsArticleSuggestionsUserContent({
            'title': title,
            'url': url,
            'description': description,
            'source': source,
            'articleText': articleText,
          })
        : isXNews && isTea
            ? _buildXTeaSuggestionsUserContent({
                'title': title,
                'description': description,
                'source': source,
                'articleText': articleText,
              })
        : isXNews
            ? _buildXNewsArticleSuggestionsUserContent({
                'title': title,
                'url': url,
                'description': description,
                'source': source,
                'articleText': articleText,
              })
            : '''Write social posts for $platformLabel as if the poster just learned this from their news (feed, Reddit, alerts - whatever fits) and is sharing their reaction and opinion - NOT writing a news summary or explainer.

$style

Story context (ground truth - do not invent beyond this):
Title: $title
${source.isNotEmpty ? 'Source: $source\n' : ''}${description.isNotEmpty ? 'Summary: $description\n' : ''}URL: $url
${articleText.isNotEmpty ? '\nArticle / thread text:\n${articleText.length > 6000 ? articleText.substring(0, 6000) : articleText}\n' : ''}

Rules:
- Output 1 to 3 posts. Each "post" is ONLY the text someone would publish - no instructions, no labels like "Post 1:", no JSON explanation.
- Each post must feel like a real person's post: what they noticed + how they feel about it. Never sound like a journalist briefing readers.
- Base reactions only on the story context above; do not invent facts.
- Do not repeat this prompt or system rules in the output.

Return ONLY valid JSON with this exact shape (no markdown fences):
{"posts":[{"eventLabel":"News","post":"..."}]}''';

    if (isXNews) {
      return _generateXContentSuggestions(
        userContent: userContent,
        fallback: fallback,
        isTea: isTea,
      );
    }

    final raw = await _fetchSuggestionContentRaw(
      userContent,
      isLinkedInNews: isLinkedInNews,
    );
    if (raw.isEmpty) return fallback;
    return _parseXContentSuggestionsJson(
      raw,
      platform,
      fallback: fallback,
      isTea: isTea,
    );
  }

  Future<String> summarizeNewsArticle(
    Map<String, dynamic>? details, [
    Map<String, dynamic> options = const {},
  ]) async {
    final title = (details?['title'] ?? '').toString().trim();
    final description = (details?['description'] ?? '').toString().trim();
    final text = (details?['text'] ?? '').toString().trim();
    final minWords = options['minWords'] is num ? (options['minWords'] as num).toInt() : 60;
    final maxWords = options['maxWords'] is num ? (options['maxWords'] as num).toInt() : 80;
    final isTeaGossip = options['isTeaGossip'] == true;
    if (title.isEmpty) return '';

    final titleNorm = title.replaceAll(RegExp(r'\s+'), ' ').trim().toLowerCase();
    final descNorm = description.replaceAll(RegExp(r'\s+'), ' ').trim().toLowerCase();
    final descIsMostlyHeadline = description.isNotEmpty &&
        (descNorm == titleNorm ||
            (titleNorm.length > 12 &&
                (descNorm == titleNorm || titleNorm.contains(descNorm) || descNorm.contains(titleNorm))));

    final bodyForModel = text.length > 10000 ? text.substring(0, 10000) : text;
    final sourceText = [description, text].where((s) => s.isNotEmpty).join('\n\n');
    final clippedSourceText = sourceText.length > 12000 ? sourceText.substring(0, 12000) : sourceText;
    if (clippedSourceText.trim().isEmpty) return '';

    final isRedditThreadBundle =
        RegExp(r'Top comments:|Comment by u/', caseSensitive: false).hasMatch(text);
    final hasEnoughForSummary = bodyForModel.length >= 200 ||
        (description.isNotEmpty && !descIsMostlyHeadline && description.length >= 80) ||
        (isRedditThreadBundle && bodyForModel.length >= 60);
    if (!hasEnoughForSummary && bodyForModel.length < 280 && (description.isEmpty || descIsMostlyHeadline)) {
      return '';
    }

    final userContent = isTeaGossip
        ? '''Write a news-style brief about this entertainment story in at most $maxWords words (hard limit — never exceed $maxWords words).

Rules:
- One short paragraph, plain text only — explain the subject like a news recap, not a headline repost.
- The headline is context only; do NOT repeat, paraphrase, or wrap the headline. Explain what actually happened and why people care.
- Cover: the controversy or announcement, who is involved, the specific criticism/praise/comparison, and the main takeaway.
- Synthesize the post and top comments; do NOT copy sentences verbatim from the input.
- Use neutral third person. No URLs, links, usernames, emojis, or filler like "iykyk".
- Do NOT mention Reddit, subreddit names (r/...), social platforms, threads, or where the discussion happened.
- Do NOT write filler like "people are reacting" without substantive detail.
- Include only the most important names, titles, and plot beats stated in the input.
- Do NOT add facts not stated or clearly implied by the input.
- No intro like "This post discusses". No hashtags.
- Target $minWords-$maxWords words; if you must choose, stay under $maxWords words.

Return ONLY valid JSON (no markdown) with this exact shape:
{"summary":"..."}

Input:
Title: $title
${description.isNotEmpty && !descIsMostlyHeadline ? 'Description: $description\n' : ''}${bodyForModel.isNotEmpty ? 'Thread text:\n$bodyForModel\n' : ''}'''
            .trim()
        : '''Summarize this news event in $minWords-$maxWords words.

Rules:
- One paragraph, plain text only.
- Base the summary primarily on the article text; use the description only as extra context.
- If the input is a Reddit thread (post plus comments), synthesize the announcement or question in the post and the most informative replies into one neutral summary of what is being discussed.
- Include the key "what happened" plus the most important concrete details (names, dates, amounts, scores, locations) that are present in the input.
- Do NOT add anything not stated or clearly implied by the input.
- Do NOT repeat or lightly rephrase only the headline - include details from the article body or thread.
- Ignore boilerplate like HTTP errors, "403 Forbidden", or reader paywalls if they appear in the input; use only real post and comment content.
- No intro like "In this article". No hashtags. No emojis.

Return ONLY valid JSON (no markdown) with this exact shape:
{"summary":"..."}

Input:
Title: $title
${description.isNotEmpty && !descIsMostlyHeadline ? 'Description: $description\n' : ''}${bodyForModel.isNotEmpty ? 'Article text:\n$bodyForModel\n' : ''}'''
            .trim();

    String parseJsonSummary(String raw) {
      var s = raw.trim();
      final fence = RegExp(r'```(?:json)?\s*([\s\S]*?)```', caseSensitive: false).firstMatch(s);
      if (fence != null && fence.group(1) != null) s = fence.group(1)!.trim();
      dynamic parsed;
      try {
        parsed = s.isNotEmpty ? jsonDecode(s) : null;
      } catch (_) {
        final m = RegExp(r'\{[\s\S]*"summary"[\s\S]*\}', caseSensitive: false, dotAll: true).firstMatch(s);
        if (m != null) {
          try {
            parsed = jsonDecode(m.group(0)!);
          } catch (_) {
            parsed = null;
          }
        }
      }
      final summary = (parsed is Map && parsed['summary'] is String) ? (parsed['summary'] as String).trim() : '';
      return summary.replaceAll(RegExp(r'\s+'), ' ').replaceAll(RegExp(r'\s+\.\s+'), '. ').trim();
    }

    String applyQualityGates(String cleaned) {
      if (cleaned.isEmpty) return '';
      final words = cleaned.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
      final limited = words.take(maxWords).join(' ');
      final out = limited.replaceAll(RegExp(r'\s+'), ' ').trim();
      if (isTeaGossip) {
        if (teaCardSummaryLooksLikeTitleOnly(out, title)) return '';
        return out;
      }
      final outNorm = out.replaceAll(RegExp(r'\s+'), ' ').trim().toLowerCase();
      final tit = title.replaceAll(RegExp(r'\s+'), ' ').trim().toLowerCase();
      if (outNorm == tit ||
          (tit.length > 8 &&
              outNorm.length <= tit.length + 12 &&
              tit.contains(outNorm.substring(0, outNorm.length < 24 ? outNorm.length : 24)))) {
        return '';
      }
      final titleTokens = tit.split(RegExp(r'\s+')).where((w) => w.length > 2).toList();
      if (titleTokens.length >= 3) {
        final hits = titleTokens.where(outNorm.contains).length;
        final outWordCount = out.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).length;
        final titleWordCount = title.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).length;
        if (hits / titleTokens.length > 0.9 && outWordCount <= titleWordCount + 6) {
          return '';
        }
      }
      return out;
    }

    if (getVertexGeminiUrl().trim().isNotEmpty) {
      try {
        final raw = await callVertexGenerateContent(
          prompt: userContent,
          temperature: 0.35,
          maxOutputTokens: 512,
        ).timeout(const Duration(seconds: 35));
        final gated = applyQualityGates(parseJsonSummary(raw));
        if (gated.isNotEmpty) return gated;
      } catch (e) {
        debugPrint('Vertex news summary failed: $e');
      }
    }

    final apiKey = Env.openAiApiKey.trim();
    if (apiKey.isEmpty) return '';
    try {
      final response = await http
          .post(
            Uri.parse('$openaiBaseURL/chat/completions'),
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $apiKey',
            },
            body: jsonEncode({
              'model': openaiModelName,
              'messages': [
                {'role': 'user', 'content': userContent},
              ],
              'temperature': 0.35,
              'max_tokens': 260,
              'response_format': {'type': 'json_object'},
            }),
          )
          .timeout(const Duration(seconds: 30));
      if (response.statusCode < 200 || response.statusCode >= 300) return '';
      dynamic data;
      try {
        data = jsonDecode(response.body);
      } catch (_) {
        return '';
      }
      final raw = (data is Map &&
              data['choices'] is List &&
              (data['choices'] as List).isNotEmpty &&
              ((data['choices'] as List).first is Map))
          ? ((((data['choices'] as List).first as Map)['message'] as Map?)?['content'] ?? '').toString()
          : '';
      return applyQualityGates(parseJsonSummary(raw));
    } catch (_) {
      return '';
    }
  }

  Future<String> generateNewsShareCardHeadline(Map<String, dynamic>? details) async {
    final title = (details?['title'] ?? '').toString().trim();
    final description = (details?['description'] ?? '').toString().trim();
    final text = (details?['text'] ?? '').toString().trim();
    if (title.isEmpty) return '';

    final titleNorm = title.replaceAll(RegExp(r'\s+'), ' ').trim().toLowerCase();
    final descNorm = description.replaceAll(RegExp(r'\s+'), ' ').trim().toLowerCase();
    final descIsMostlyHeadline = description.isNotEmpty &&
        (descNorm == titleNorm ||
            (titleNorm.length > 12 &&
                (descNorm == titleNorm || titleNorm.contains(descNorm) || descNorm.contains(titleNorm))));

    final bodyForModel = text.length > 12000 ? text.substring(0, 12000) : text;
    final sourceText = [description, text].where((s) => s.isNotEmpty).join('\n\n');
    final clipped = sourceText.length > 14000 ? sourceText.substring(0, 14000) : sourceText;
    if (clipped.trim().isEmpty) return '';

    final isRedditThreadBundle =
        RegExp(r'Top comments:|Comment by u/', caseSensitive: false).hasMatch(text);
    final hasEnough = bodyForModel.length >= 120 ||
        (description.isNotEmpty && !descIsMostlyHeadline && description.length >= 60) ||
        (isRedditThreadBundle && bodyForModel.length >= 60);
    if (!hasEnough && bodyForModel.length < 200 && (description.isEmpty || descIsMostlyHeadline)) {
      return '';
    }

    final userContent = '''You write a single DISPLAY HEADLINE for a news / gossip share card.

Rules:
- Read the original post title AND the full article or thread text below. The headline must reflect what is actually discussed (names, event, stakes) - do NOT merely repeat or lightly rephrase the original post title.
- Style: entertainment / industry coverage - confident, readable, with a hint of intrigue or "what this really means" without being vague. You may withhold one non-essential detail to create a little mystery, but do not mislead or invent facts.
- Length: 7-14 words (one line). Plain text. Optional: at most ONE tasteful emoji at the very end if it truly fits; otherwise no emojis.
- No quotes around the headline. No hashtags. No "Breaking:", "Exclusive:", or "You won't believe".

Return ONLY valid JSON (no markdown) with this exact shape:
{"headline":"..."}

Original post title (for context - write something NEW, not a copy):
$title

Content to ground the headline in:
${description.isNotEmpty && !descIsMostlyHeadline ? 'Short description: $description\n' : ''}${bodyForModel.isNotEmpty ? 'Full text:\n$bodyForModel\n' : ''}'''
        .trim();

    String parseHeadline(String raw) {
      var s = raw.trim();
      final fence = RegExp(r'```(?:json)?\s*([\s\S]*?)```', caseSensitive: false).firstMatch(s);
      if (fence != null && fence.group(1) != null) s = fence.group(1)!.trim();
      dynamic parsed;
      try {
        parsed = s.isNotEmpty ? jsonDecode(s) : null;
      } catch (_) {
        final m = RegExp(r'\{[\s\S]*"headline"[\s\S]*\}', caseSensitive: false, dotAll: true).firstMatch(s);
        if (m != null) {
          try {
            parsed = jsonDecode(m.group(0)!);
          } catch (_) {
            parsed = null;
          }
        }
      }
      var h = (parsed is Map && parsed['headline'] is String) ? (parsed['headline'] as String).trim() : '';
      h = h
          .replaceAll(RegExp(r'^[\u201C\u201D"\x27]+|[\u201C\u201D"\x27]+$'), '')
          .replaceAll(RegExp(r'\s+'), ' ')
          .trim();
      if (h.length > 160) {
        h = '${h.substring(0, 157).trim()}â€¦';
      }
      return h;
    }

    String headlineQuality(String h) {
      if (h.isEmpty || h.length < 8) return '';
      final hn = h.replaceAll(RegExp(r'\s+'), ' ').trim().toLowerCase();
      if (hn == titleNorm) return '';
      final tw = titleNorm.split(RegExp(r'\s+')).where((w) => w.length > 2).toList();
      final hw = hn.split(RegExp(r'\s+')).where((w) => w.length > 2).toList();
      if (tw.length >= 4 && hw.length >= 4) {
        final overlap = tw.where(hn.contains).length;
        if (overlap / tw.length > 0.95 && (hw.length - tw.length).abs() <= 2) {
          return '';
        }
      }
      return h;
    }

    if (getVertexGeminiUrl().trim().isNotEmpty) {
      try {
        final raw = await callVertexGenerateContent(
          prompt: userContent,
          temperature: 0.72,
          maxOutputTokens: 256,
        ).timeout(const Duration(seconds: 35));
        final h = headlineQuality(parseHeadline(raw));
        if (h.isNotEmpty) return h;
      } catch (e) {
        debugPrint('Vertex share-card headline failed: $e');
      }
    }

    final apiKey = Env.openAiApiKey.trim();
    if (apiKey.isEmpty) return '';
    try {
      final response = await http
          .post(
            Uri.parse('$openaiBaseURL/chat/completions'),
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $apiKey',
            },
            body: jsonEncode({
              'model': openaiModelName,
              'messages': [
                {'role': 'user', 'content': userContent},
              ],
              'temperature': 0.72,
              'max_tokens': 200,
              'response_format': {'type': 'json_object'},
            }),
          )
          .timeout(const Duration(seconds: 30));
      if (response.statusCode < 200 || response.statusCode >= 300) return '';
      dynamic data;
      try {
        data = jsonDecode(response.body);
      } catch (_) {
        return '';
      }
      final raw = (data is Map &&
              data['choices'] is List &&
              (data['choices'] as List).isNotEmpty &&
              ((data['choices'] as List).first is Map))
          ? ((((data['choices'] as List).first as Map)['message'] as Map?)?['content'] ?? '').toString()
          : '';
      return headlineQuality(parseHeadline(raw));
    } catch (_) {
      return '';
    }
  }

  Future<List<String>> rewriteNewsHeadlines(
    List<dynamic> items, [
    Map<String, dynamic> options = const {},
  ]) async {
    final maxHeadlines = options['maxHeadlines'] is num ? (options['maxHeadlines'] as num).toInt() : 30;
    final avoid = options['avoidHeadings'] is List ? (options['avoidHeadings'] as List) : const <dynamic>[];
    final list = items.take(maxHeadlines).toList();
    if (list.isEmpty) return <String>[];

    List<String> fallbackTitles() {
      return list
          .map((x) => (x is Map && x['title'] != null) ? x['title'].toString().trim() : '')
          .where((s) => s.isNotEmpty)
          .toList();
    }

    final apiKey = Env.openAiApiKey.trim();
    if (apiKey.isEmpty) return fallbackTitles();

    final payloadItems = <Map<String, dynamic>>[];
    for (var i = 0; i < list.length; i++) {
      final row = list[i];
      final map = row is Map ? row : const <String, dynamic>{};
      payloadItems.add({
        'id': i,
        'title': (map['title'] ?? '').toString().trim(),
        'url': (map['url'] ?? '').toString().trim(),
        'description': (map['description'] ?? '').toString().trim(),
        'mustMention': map['mustMention'] is List ? (map['mustMention'] as List).take(6).toList() : <dynamic>[],
      });
    }

    final userContent = '''You are rewriting news titles into punchy "Today's News" headings like a viral feed.

Input: a list of stories with {id,title,url,description,mustMention}.

Rules:
- Output exactly ${payloadItems.length} headings, one per id, in the same order.
- Each heading must be UNIQUE (no duplicates or near-duplicates).
- Each heading MUST mention at least 1 specific identifier from the input title (team/company/person/place), not generic placeholders like "a team" or "a company".
- If the input includes mustMention tokens, include at least ONE of them verbatim in the heading.
- Include at least ONE concrete detail from title/description when available (a date/month, number, score, amount, rank, location). Make it feel like "what happened" not "what to know".
- Do NOT repeat the outlet name or "Google News".
- Keep it short: 6-14 words. Title-case is OK but not required.
- Make it spicy / human: attitude, tension, humor, but do NOT invent facts.
- No emojis. No hashtags. No quotes.
- Banned templates: "All you need to know", "Everything you need to know", "Here's what we know", "Explained".
- Do NOT reuse any of these existing headings (even partially): ${avoid.isNotEmpty ? jsonEncode(avoid.take(40).toList()) : '[]'}

Return ONLY valid JSON (no markdown) with shape:
{"headings":[{"id":0,"heading":"..."}]}

Stories:
${jsonEncode(payloadItems)}''';

    try {
      final response = await http
          .post(
            Uri.parse('$openaiBaseURL/chat/completions'),
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $apiKey',
            },
            body: jsonEncode({
              'model': openaiModelName,
              'messages': [
                {'role': 'user', 'content': userContent},
              ],
              'temperature': 0.8,
              'max_tokens': 1800,
              'response_format': {'type': 'json_object'},
            }),
          )
          .timeout(const Duration(seconds: 30));
      if (response.statusCode < 200 || response.statusCode >= 300) return fallbackTitles();

      dynamic data;
      try {
        data = jsonDecode(response.body);
      } catch (_) {
        return fallbackTitles();
      }
      final raw = (data is Map &&
              data['choices'] is List &&
              (data['choices'] as List).isNotEmpty &&
              ((data['choices'] as List).first is Map))
          ? ((((data['choices'] as List).first as Map)['message'] as Map?)?['content'] ?? '').toString()
          : '';
      dynamic parsed;
      try {
        parsed = jsonDecode(raw.trim());
      } catch (_) {
        return fallbackTitles();
      }
      final headings = (parsed is Map && parsed['headings'] is List) ? (parsed['headings'] as List) : const <dynamic>[];
      final byId = <int, String>{};
      for (final row in headings) {
        if (row is! Map) continue;
        final id = row['id'] is num ? (row['id'] as num).toInt() : -1;
        final heading = (row['heading'] ?? '').toString().trim();
        if (id >= 0 && heading.isNotEmpty) byId[id] = heading;
      }
      return payloadItems
          .map((x) => (byId[x['id']] ?? x['title']).toString().trim())
          .where((s) => s.isNotEmpty)
          .toList();
    } catch (_) {
      return fallbackTitles();
    }
  }

  Future<Map<String, List<String>>> _detectFamousEntities(String postText) async {
    final text = postText.trim();
    const empty = <String, List<String>>{
      'personality': <String>[],
      'event': <String>[],
      'place': <String>[],
      'brand': <String>[],
      'object': <String>[],
    };
    if (text.isEmpty || !isVertexBackendConfigured()) return empty;

    final prompt = '''Extract ONLY famous or well-known entities from the text. Return STRICT JSON, no markdown.

Rules:
- personality: famous people (celebrities, leaders, authors, historical figures). NOT personal contacts or friends.
- event: famous events, named books, films, conferences, awards (e.g. "The Three-Body Problem", "Source Code" book, "Oscars").
- place: famous or iconic places, landmarks, cities, venues.
- brand: famous brands, companies, products.
- object: famous objects, artworks, monuments (e.g. Mona Lisa, Eiffel Tower as object).

Return format (use exactly):
{"personality":[],"event":[],"place":[],"brand":[],"object":[]}

If nothing famous, return empty arrays. Output only the JSON.

Text:
${text.substring(0, text.length > 1000 ? 1000 : text.length)}''';

    List<String> toCleanList(dynamic value, {int max = 3}) {
      if (value is! List) return <String>[];
      return value
          .map((e) => e?.toString().trim() ?? '')
          .where((e) => e.isNotEmpty)
          .take(max)
          .toList(growable: false);
    }

    try {
      var raw = (await vertexGenerateContent(
        prompt: prompt,
        temperature: 0.1,
        maxOutputTokens: 300,
      ))
          .trim();
      raw = raw.replaceAll(RegExp(r'```json?', caseSensitive: false), '').replaceAll('```', '').trim();
      final jsonMatch = RegExp(r'\{[\s\S]*\}').firstMatch(raw);
      if (jsonMatch == null) return empty;
      final parsed = jsonDecode(jsonMatch.group(0)!) as Map<String, dynamic>;
      return <String, List<String>>{
        'personality': toCleanList(parsed['personality']),
        'event': toCleanList(parsed['event']),
        'place': toCleanList(parsed['place']),
        'brand': toCleanList(parsed['brand']),
        'object': toCleanList(parsed['object']),
      };
    } catch (e) {
      debugPrint('[Image] Famous entity detection failed: $e');
      return empty;
    }
  }

  Future<String?> _buildStructuredPromptForNoFamous(
    String postText, [
    Map<String, dynamic>? userContext,
  ]) async {
    final text = postText.trim();
    if (text.isEmpty || !isVertexBackendConfigured()) return null;

    final age = (userContext?['age']?.toString().trim().isNotEmpty ?? false)
        ? userContext!['age'].toString().trim()
        : '30';
    final gender = (userContext?['gender']?.toString().trim().isNotEmpty ?? false)
        ? userContext!['gender'].toString().trim()
        : 'person';
    final skinTone = (userContext?['skinTone']?.toString().trim().isNotEmpty ?? false)
        ? userContext!['skinTone'].toString().trim()
        : 'natural';
    final hairstyle = (userContext?['hairstyle']?.toString().trim().isNotEmpty ?? false)
        ? userContext!['hairstyle'].toString().trim()
        : 'natural';
    final clothingStyle = (userContext?['clothingStyle']?.toString().trim().isNotEmpty ?? false)
        ? userContext!['clothingStyle'].toString().trim()
        : 'context-appropriate';
    final profession = (userContext?['profession']?.toString().trim().isNotEmpty ?? false)
        ? userContext!['profession'].toString().trim()
        : 'not specified';
    final profileImageUrl = userContext?['profileImageUrl']?.toString().trim() ?? '';

    final extractPrompt = '''Analyze this post and extract context for a single realistic photograph. Return STRICT JSON only, no markdown.

Extract from the FULL post text. Use the same extraction logic for every platform (no difference for LinkedIn vs X).
Include specific items mentioned: book titles (e.g. "The Three-Body Problem"), place names (e.g. director's office, college office), and the actual situation.
Prefer the SPECIFIC situation: e.g. for "wrong door" story use mainActivity like "standing in a corridor between two office doors, moment of realization" and environment like "college corridor with Director's Office and College Office doors"; for "reading The Three-Body Problem" use mainActivity like "reading the book The Three-Body Problem at a desk or by a window" and environment like "indoor by window" or "cafe" - not a generic "sitting thoughtfully" or "indoor".

Keys (short phrases; empty string if not clear):
- mainActivity: the specific situation and action, including any named items (e.g. "standing in corridor between two doors, wrong-door moment", "reading the book The Three-Body Problem at a desk", "reading at a table by a window")
- environment: the specific location (e.g. "college corridor with two labeled doors", "quiet library", "cafe or room by a window", "home")
- emotionalTone: mood (e.g. "focused", "embarrassed", "calm", "reflective")
- timeOfDay: "morning" or "afternoon" or "evening" or ""
- professionalOrCasual: "professional" or "casual" or "mixed" or ""
- bodyLanguage: body language cues (e.g. "relaxed posture", "slightly embarrassed", "focused on task") or ""
- contextualOutfit: clothing that fits the scene (e.g. "casual", "smart casual", "professional attire") or ""

Format: {"mainActivity":"","environment":"","emotionalTone":"","timeOfDay":"","professionalOrCasual":"","bodyLanguage":"","contextualOutfit":""}

Use the FULL post below (including any paragraphs) to extract context. Capture the specific story, place, and moment (e.g. wrong door, director's office, college corridor, embarrassed relief).

Post:
${text.substring(0, text.length > 2000 ? 2000 : text.length)}''';

    try {
      var raw = (await vertexGenerateContent(
        prompt: extractPrompt,
        temperature: 0.2,
        maxOutputTokens: 350,
      ))
          .trim();
      raw = raw.replaceAll(RegExp(r'```json?', caseSensitive: false), '').replaceAll('```', '').trim();
      final jsonMatch = RegExp(r'\{[\s\S]*\}').firstMatch(raw);
      if (jsonMatch == null) return null;
      final context = jsonDecode(jsonMatch.group(0)!) as Map<String, dynamic>;

      final activity = (context['mainActivity']?.toString().trim().isNotEmpty ?? false)
          ? context['mainActivity'].toString().trim()
          : 'sitting thoughtfully';
      final environment = (context['environment']?.toString().trim().isNotEmpty ?? false)
          ? context['environment'].toString().trim()
          : 'neutral indoor setting';
      final tone = (context['emotionalTone']?.toString().trim().isNotEmpty ?? false)
          ? context['emotionalTone'].toString().trim()
          : 'natural';
      final outfit = (context['contextualOutfit']?.toString().trim().isNotEmpty ?? false)
          ? context['contextualOutfit'].toString().trim()
          : clothingStyle;

      final instructions = '''You are generating a realistic, context-aware photograph based strictly on the story provided.

PRIORITY - DEPICT THE SITUATION; SAME LOGIC FOR ALL PLATFORMS (LINKEDIN AND X):
- Do NOT focus on or center the user's face. Do NOT generate a face-close-up, headshot, or portrait-style image.
- Use the same composition for every platform: show the SCENE and SITUATION with the person in context (medium or wide shot). The environment, location, and activity are the focus - not the face.
- The image MUST describe the SITUATION from the post: show the environment, the location, and the moment. Examples: "Director's office mix-up" -> corridor with two doors, person in that hallway; "Reading The Three-Body Problem" -> person reading that book in a setting (e.g. by a window, at a table), book and environment visible - not a face close-up.
- Extract and use the full post text. Include specific titles (e.g. book names), places, and the actual story. Same calculations and extraction as used for X post creation.

Your only priority is to visually represent the events, emotions, and environment described in the text.

CRITICAL: The image must reflect the SPECIFIC story and setting from the post. Use the full content below:
- If the post describes a mix-up (e.g. wrong door, director's office vs college office), show that setting (e.g. corridor, doors, moment of realization).
- If it names a place (library, office, college), show that environment.
- If it describes an emotion (embarrassed, relieved, laughing at myself), show that in expression and body language within the situation.
Do NOT create a generic or unrelated scene. The photograph must look like a candid moment from THIS story.

Do NOT consider:
- The platform where this will be posted
- Social media aesthetics
- Branding
- Marketing tone

Focus only on accurately visualizing the story.

Post (use entire content for context):
"""
${text.substring(0, text.length > 2800 ? 2800 : text.length)}
"""

User profile:
- Age: $age
- Gender: $gender
- Skin tone: $skinTone
- Hairstyle: $hairstyle
- Clothing style preference: $clothingStyle
- Profession (if known): $profession
- Profile image URL (if available): ${profileImageUrl.isEmpty ? 'none' : profileImageUrl}

IMAGE GENERATION RULES:

1. If the story implies the user is the subject, generate a person resembling the user.
2. If a profile image is available, use it as visual reference for appearance consistency.
3. Do NOT replicate the face exactly.
4. Do NOT generate any celebrity resemblance.
5. The scene must directly reflect the narrative.
6. No random animals or unrelated objects.
7. Avoid generic stock-photo style.
8. Use natural lighting.
9. Use subtle, realistic expressions.
10. No text overlay in the image.
11. No logos unless explicitly mentioned in the story.

Output strictly as a detailed photographic scene description in this format:''';

      final structuredPrompt =
          'A realistic high-detail photograph of a $age-year-old $gender with $skinTone skin tone and $hairstyle, '
          'resembling the user\'s profile appearance, wearing $outfit, $activity, in a $environment, natural body language '
          'reflecting $tone, natural lighting, shallow depth of field, realistic proportions, authentic candid moment, '
          'not staged, not stock photo style. Medium or wide shot showing the scene and environment; do not crop to face '
          'only or create a portrait.';

      return '$instructions\n\n"$structuredPrompt"';
    } catch (e) {
      debugPrint('[Image] Context extraction failed: $e');
      return null;
    }
  }

  Future<String?> _getImagePromptFromContent(
    String postText, [
    Map<String, dynamic>? userContext,
  ]) async {
    final text = postText.trim();
    if (text.isEmpty || !isVertexBackendConfigured()) return null;

    final nationality = (userContext?['nationality']?.toString().trim().isNotEmpty ?? false)
        ? userContext!['nationality'].toString().trim()
        : 'Indian';
    final displayName = userContext?['displayName']?.toString().trim() ?? '';
    final age = userContext?['age']?.toString().trim() ?? '';
    final userHint = (displayName.isNotEmpty || age.isNotEmpty)
        ? ' When the image includes a person (not a famous celebrity), describe them as $nationality'
            '${displayName.isNotEmpty ? ', similar to a person named $displayName' : ''}'
            '${age.isNotEmpty ? ', around $age years old' : ''}.'
        : ' When the image includes a person (not a famous celebrity), describe them as $nationality.';

    final prompt = '''Read this social media post and describe in ONE short sentence an image that would illustrate it.

IMPORTANT: The image must reflect the SPECIFIC content discussed in the post. Use the actual subjects mentioned:
- If the post discusses a specific book (e.g. "The Three-Body Problem", "Source Code", "Crime and Punishment"), the image should include that book or clearly show someone reading it, or the book's theme (e.g. sci-fi for Three-Body Problem).
- If the post discusses a place (e.g. library, director's office, college), include that setting.
- If the post discusses an event or moment (e.g. mix-up, meeting someone), show that context.
Do NOT describe a generic person in a generic setting. Always reference the specific book title, place, or topic from the post so the image matches what is discussed. Do not mention famous celebrity names.$userHint

Output only that one sentence, nothing else. No quotes.

Post:
${text.substring(0, text.length > 800 ? 800 : text.length)}''';

    try {
      final raw = (await vertexGenerateContent(
        prompt: prompt,
        temperature: 0.3,
        maxOutputTokens: 80,
      ))
          .trim();
      final sentence = raw.replaceAll(RegExp("^[\"']+|[\"']+\$"), '').trim();
      if (sentence.isEmpty) return null;
      return sentence.length > 200 ? sentence.substring(0, 200) : sentence;
    } catch (e) {
      debugPrint('[Image prompt] Content prompt failed: $e');
      return null;
    }
  }

  Future<Map<String, List<String>>> extractEntitiesWithNER(String postText) async {
    const empty = <String, List<String>>{
      'persons': <String>[],
      'places': <String>[],
      'events': <String>[],
    };
    final text = postText.trim();
    if (text.isEmpty || !isVertexBackendConfigured()) return empty;

    final prompt = '''You are an entity extraction system.

Extract real-world named entities from the text below.

Rules:
- persons: ONLY famous or well-known public figures (celebrities, leaders, authors, historical figures). Examples: Bill Gates, Sam Altman, Elon Musk. Do NOT include personal contacts, friends, family, or acquaintances (e.g. "my friend Sumit" or "I met John" -> leave persons empty).
- places: specific locations or venues (cities, institutions, buildings).
- events: named events, or named works like books (e.g. "Source Code" as a book title). Put book titles in events if they are clearly named.
- Include only real identifiable entities. Do NOT include abstract concepts or hashtags.
- Return STRICT JSON only. No explanation. No markdown. No commentary.

Return format (use this exact structure):
{"persons":[],"places":[],"events":[]}

Examples:
- "I caught up with my friend Sumit today" -> {"persons":[],"places":[],"events":[]}
- "Reading Bill Gates' Source Code" -> {"persons":["Bill Gates"],"places":[],"events":["Source Code"]}

Text:
$text''';

    List<String> toCleanList(dynamic value) {
      if (value is! List) return <String>[];
      return value
          .map((e) => e?.toString().trim() ?? '')
          .where((e) => e.isNotEmpty && e.length < 80)
          .toList(growable: false);
    }

    try {
      debugPrint(
        '[Entity extraction] Input length: ${text.length}, Preview: '
        '${text.substring(0, text.length > 120 ? 120 : text.length)}${text.length > 120 ? '...' : ''}',
      );
      var raw = (await vertexGenerateContent(
        prompt: prompt,
        temperature: 0.1,
        maxOutputTokens: 350,
      ))
          .trim();
      debugPrint('Raw entity extraction output: $raw');
      raw = raw.replaceAll(RegExp(r'```json', caseSensitive: false), '').replaceAll('```', '').trim();

      final jsonMatch = RegExp(r'\{[\s\S]*\}').firstMatch(raw);
      if (jsonMatch == null) {
        debugPrint('[Entity extraction] No JSON object in response, using fallback');
        return _fallbackEntityExtraction(text);
      }

      Map<String, dynamic> parsed;
      try {
        parsed = jsonDecode(jsonMatch.group(0)!) as Map<String, dynamic>;
      } catch (parseErr) {
        debugPrint('[Entity extraction] JSON parse failed: $parseErr. Using fallback');
        return _fallbackEntityExtraction(text);
      }

      final result = <String, List<String>>{
        'persons': toCleanList(parsed['persons']),
        'places': toCleanList(parsed['places']),
        'events': toCleanList(parsed['events']),
      };
      if ((result['persons']?.isEmpty ?? true) &&
          (result['places']?.isEmpty ?? true) &&
          (result['events']?.isEmpty ?? true)) {
        final fallback = _fallbackEntityExtraction(text);
        if ((fallback['persons']?.isNotEmpty ?? false) ||
            (fallback['places']?.isNotEmpty ?? false) ||
            (fallback['events']?.isNotEmpty ?? false)) {
          debugPrint('[Entity extraction] Gemini returned empty, using fallback: $fallback');
          return fallback;
        }
      }
      return result;
    } catch (e) {
      debugPrint('Entity extraction failed: $e');
      return _fallbackEntityExtraction(text);
    }
  }

  Map<String, List<String>> _fallbackEntityExtraction(String text) {
    final result = <String, List<String>>{
      'persons': <String>[],
      'places': <String>[],
      'events': <String>[],
    };
    if (text.trim().isEmpty) return result;

    final trimmed = text.trim();
    final famousOnly = <String>{'Bill Gates', 'Sam Altman', 'Elon Musk'};
    if (RegExp(r'\bBill\s+Gates\b', caseSensitive: false).hasMatch(trimmed)) {
      result['persons']!.add('Bill Gates');
    }
    if (RegExp(r'\bSam\s+Altman\b', caseSensitive: false).hasMatch(trimmed)) {
      result['persons']!.add('Sam Altman');
    }
    if (RegExp(r'\bElon\s+Musk\b', caseSensitive: false).hasMatch(trimmed)) {
      result['persons']!.add('Elon Musk');
    }

    final possessivePattern = RegExp(
      r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)['\u2019\u2018\u0022]\s*(?:Source\s+Code|[\w\s]+)",
    );
    final possessiveMatches = possessivePattern.allMatches(trimmed);
    for (final match in possessiveMatches) {
      final name = (match.group(1) ?? '').trim();
      if (name.length > 1 && name.length < 50 && famousOnly.contains(name)) {
        result['persons']!.add(name);
      }
    }
    result['persons'] = result['persons']!.toSet().toList(growable: false);

    if (RegExp(r'\bSource\s+Code\b', caseSensitive: false).hasMatch(trimmed) &&
        !result['events']!.contains('Source Code')) {
      result['events']!.add('Source Code');
    }
    return result;
  }

  String? _getImagePromptFromEntities(Map<String, List<String>> entities) {
    final person = (entities['persons']?.isNotEmpty ?? false) ? entities['persons']!.first.trim() : '';
    final place = (entities['places']?.isNotEmpty ?? false) ? entities['places']!.first.trim() : '';
    final event = (entities['events']?.isNotEmpty ?? false) ? entities['events']!.first.trim() : '';
    const styleSuffix = 'Professional LinkedIn-style thumbnail, minimal text on image, high quality, engaging.';

    if (person.isNotEmpty && event.isNotEmpty) {
      return '$person with the book "$event", featured together in one image. $styleSuffix';
    }
    if (person.isNotEmpty && place.isNotEmpty) {
      return '$person at $place, featured together. $styleSuffix';
    }
    if (person.isNotEmpty) {
      return '$person, professional LinkedIn-style thumbnail, engaging and dynamic, not a plain headshot. $styleSuffix';
    }
    if (place.isNotEmpty) {
      return '$place, professional LinkedIn-style thumbnail. $styleSuffix';
    }
    if (event.isNotEmpty) {
      return '"$event" featured prominently, professional LinkedIn-style thumbnail, minimal text. $styleSuffix';
    }
    return null;
  }

  Future<String?> fetchImageForReflection(
    String postText, [
    Map<String, dynamic>? userContext,
    String platform = 'x',
  ]) async {
    if (postText.trim().isEmpty) return null;
    final fullText = postText.trim();
    final keyText = fullText.length > 300 ? fullText.substring(0, 300) : fullText;
    final cacheKey = 'post_image_cache_v2::$keyText';
    final prefs = await SharedPreferences.getInstance();

    try {
      final raw = prefs.getString(cacheKey);
      if (raw != null && raw.isNotEmpty) {
        try {
          final parsed = jsonDecode(raw);
          if (parsed is Map &&
              parsed['text'] == fullText &&
              parsed['image'] is String &&
              (parsed['image'] as String).isNotEmpty) {
            return parsed['image'] as String;
          }
        } catch (_) {
          if (raw.startsWith('data:image')) return raw;
        }
      }
    } catch (e) {
      debugPrint('[Image] Failed to read image cache: $e');
    }

    if (!isVertexBackendConfigured()) {
      debugPrint('[Image] Vertex backend URL not set; image generation requires the backend.');
      return null;
    }

    final platformName = platform.trim().isEmpty ? 'x' : platform.trim().toLowerCase();
    Map<String, String>? referenceImage;
    if ((userContext?['profileImageUrl']?.toString().trim().isNotEmpty ?? false)) {
      referenceImage = await _getProfileImageAsBase64(userContext!['profileImageUrl'].toString().trim());
    }

    final imagePrompt = await _buildStructuredPromptForNoFamous(fullText, userContext);
    if (imagePrompt == null || imagePrompt.trim().isEmpty) {
      final pieces = fullText.split(RegExp(r'[.!?]')).where((e) => e.trim().isNotEmpty).toList();
      final firstSentence = pieces.isNotEmpty ? pieces.first.trim() : fullText;
      final clipped = firstSentence.length > 100 ? firstSentence.substring(0, 100) : firstSentence;
      if (clipped.isEmpty) return null;
      final age = (userContext?['age']?.toString().trim().isNotEmpty ?? false)
          ? userContext!['age'].toString().trim()
          : '30';
      final gender = (userContext?['gender']?.toString().trim().isNotEmpty ?? false)
          ? userContext!['gender'].toString().trim().toLowerCase()
          : 'person';
      final nationality = (userContext?['nationality']?.toString().trim().isNotEmpty ?? false)
          ? userContext!['nationality'].toString().trim()
          : 'Indian';
      final fallback =
          'A realistic photograph of a $age year old $gender ($nationality), $clipped, natural lighting, high detail, not a celebrity, not stock.';
      final generated = await _generateImageWithGemini(fallback, referenceImage);
      if (generated != null && generated.isNotEmpty) {
        try {
          final payload = jsonEncode(<String, String>{'text': fullText, 'image': generated});
          if (payload.length <= 2 * 1024 * 1024) {
            await prefs.setString(cacheKey, payload);
          }
        } catch (_) {
          // Ignore cache write failures (quota or serialization issues).
        }
      }
      return generated;
    }

    final strictRules =
        'STRICT: Same image logic for all platforms including $platformName. Depict the SITUATION from the post '
        '(e.g. director\'s office mix-up = corridor with doors; reading a book = person in setting with the book visible). '
        'Do NOT focus on the face - use a medium or wide shot with scene and environment. '
        'No portrait or face-close-up. No animals unless mentioned. Avoid famous faces. High realism.';
    final fullPrompt = '$imagePrompt $strictRules';
    final generated = await _generateImageWithGemini(fullPrompt, referenceImage);
    if (generated != null && generated.isNotEmpty) {
      try {
        final payload = jsonEncode(<String, String>{'text': fullText, 'image': generated});
        if (payload.length <= 2 * 1024 * 1024) {
          await prefs.setString(cacheKey, payload);
        }
      } catch (_) {
        // Ignore cache write failures (quota or serialization issues).
      }
    }
    return generated;
  }

  Future<String?> fetchSingleNewsShareIllustrationImage([
    Map<String, dynamic> opts = const <String, dynamic>{},
  ]) async {
    final headline = (opts['headline'] ?? '').toString().trim();
    final storyText = (opts['storyText'] ?? '').toString().trim();
    if (headline.isEmpty && storyText.isEmpty) return null;

    final promptLines = <String>[
      'One editorial news illustration for social posts (same image for all variants).',
      'Symbolic or environmental; tasteful; avoid graphic violence; no identifiable private individuals.',
      if (headline.isNotEmpty) 'Headline: $headline',
      if (storyText.isNotEmpty)
        'Story: ${storyText.length > 4500 ? storyText.substring(0, 4500) : storyText}',
    ];
    final prompt = promptLines.join('\n\n');
    return _generateImageWithGemini(prompt);
  }

  Future<Map<String, String>?> _getProfileImageAsBase64(String urlOrDataUrl) async {
    final source = urlOrDataUrl.trim();
    if (source.isEmpty) return null;

    final allowedMime = RegExp(r'^image/(jpeg|jpg|png|gif|webp)$');
    try {
      if (source.startsWith('data:')) {
        final match = RegExp(r'^data:([^;]+);base64,(.+)$').firstMatch(source);
        if (match == null) return null;
        final mimeType = match.group(1)!.trim().toLowerCase();
        final base64Data = match.group(2)!.replaceAll(RegExp(r'\s+'), '');
        if (base64Data.isEmpty || !allowedMime.hasMatch(mimeType)) return null;
        return <String, String>{'base64': base64Data, 'mimeType': mimeType};
      }

      final uri = Uri.tryParse(source);
      if (uri == null || !(uri.scheme == 'http' || uri.scheme == 'https')) return null;
      final response = await http.get(uri);
      if (response.statusCode < 200 || response.statusCode >= 300) return null;

      final rawContentType = (response.headers['content-type'] ?? 'image/jpeg').toLowerCase();
      final mimeType = rawContentType.split(';').first.trim();
      if (!allowedMime.hasMatch(mimeType)) return null;
      final base64Data = base64Encode(response.bodyBytes);
      if (base64Data.isEmpty) return null;
      return <String, String>{'base64': base64Data, 'mimeType': mimeType};
    } catch (e) {
      debugPrint('[Image] Could not load profile image as reference: $e');
      return null;
    }
  }

  Future<String?> _generateImageWithGemini(
    String prompt, [
    Map<String, String>? referenceImage,
  ]) async {
    final p = prompt.trim();
    if (p.isEmpty || !isVertexBackendConfigured()) return null;
    try {
      // Current backend route accepts prompt-only image generation.
      if (referenceImage != null) {
        debugPrint('[Image] Reference image provided; prompt-only backend will ignore binary reference for now.');
      }
      return await vertexGenerateNewsImage(p);
    } catch (e) {
      debugPrint('[Image] Vertex image generation failed: $e');
      return null;
    }
  }

  Future<String?> editImageWithInstruction(String instruction, String imageUrlOrDataUrl) async {
    final instr = instruction.trim();
    if (instr.isEmpty) return null;
    if (!isVertexBackendConfigured()) {
      debugPrint('[Image edit] Vertex backend URL not set');
      return null;
    }

    final source = await _getProfileImageAsBase64(imageUrlOrDataUrl);
    if (source == null) {
      debugPrint('[Image edit] Could not load source image (CORS or invalid URL)');
      return null;
    }

    final prompt = [
      'TASK: Edit the image attached above according to the user instruction.',
      'USER INSTRUCTION: $instr',
      'OUTPUT REQUIREMENTS: Return exactly one edited image. Preserve subject identity and scene coherence unless the instruction explicitly asks to remove or replace them. Match photorealistic style unless the user requests otherwise.',
    ].join('\n\n');

    return _generateImageWithGeminiEdit(prompt, '', source);
  }

  Future<String?> _generateImageWithGeminiEdit(
    String prompt,
    String apiKey,
    Map<String, String> sourceImage,
  ) async {
    final _ = <Object>[prompt, apiKey, sourceImage];
    debugPrint('[Image edit] Multimodal image edit is not available via the current Vertex text backend.');
    return null;
  }

  Future<Map<String, List<String>>> getImageSearchQueryForPost(String postText) async {
    final searchQuery = await _getImagePromptFromContent(postText);
    return <String, List<String>>{
      'queries': searchQuery == null || searchQuery.isEmpty ? <String>[] : <String>[searchQuery],
    };
  }

  Future<Map<String, List<String>>> getImageSearchQuery(String reflection) async {
    return getImageSearchQueryForPost(reflection);
  }

  Future<String> generateDayDescription(
    Map<String, dynamic> dayData,
    String type,
    String periodText, [
    int? userCharacterCount,
  ]) async {
    try {
      debugPrint('Generating $type day description for ${dayData['date']}');

      var actualUserCharacterCount = userCharacterCount;
      if (actualUserCharacterCount == null && dayData['date'] != null) {
        try {
          final user = AuthService.instance.getCurrentUser();
          if (user != null) {
            String dateId;
            final rawDate = dayData['date'];
            if (rawDate is DateTime) {
              dateId = getDateId(rawDate);
            } else if (rawDate is String) {
              if (RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(rawDate)) {
                dateId = rawDate;
              } else {
                final parsed = DateTime.tryParse(rawDate);
                dateId = getDateId(parsed ?? DateTime.now());
              }
            } else if (dayData['timestamp'] != null) {
              final ts = dayData['timestamp'];
              DateTime parsedTimestamp;
              if (ts is DateTime) {
                parsedTimestamp = ts;
              } else if (ts is num) {
                parsedTimestamp = DateTime.fromMillisecondsSinceEpoch(ts.toInt());
              } else {
                parsedTimestamp = DateTime.tryParse(ts.toString()) ?? DateTime.now();
              }
              dateId = getDateId(parsedTimestamp);
            } else {
              final parsed = DateTime.tryParse(rawDate.toString());
              dateId = getDateId(parsed ?? DateTime.now());
            }

            final messagesResult = await FirestoreService.instance.getChatMessagesNew(user.uid, dateId);
            if (messagesResult['success'] == true && messagesResult['messages'] is List) {
              final messages = List<Map<String, dynamic>>.from(messagesResult['messages'] as List);
              actualUserCharacterCount = messages
                  .where((msg) => (msg['sender'] ?? '').toString() == 'user' && msg['text'] != null)
                  .fold<int>(
                    0,
                    (total, msg) => total + (msg['text'] as String).length,
                  );
              debugPrint(
                'User wrote $actualUserCharacterCount characters on ${dayData['date']} (dateId: $dateId)',
              );
            }
          }
        } catch (error) {
          debugPrint('Could not fetch user messages for character count: $error');
        }
      }

      final maxReflectionCharacters =
          actualUserCharacterCount != null ? actualUserCharacterCount * 2 : null;
      if (maxReflectionCharacters != null) {
        debugPrint(
          'Reflection limit: $maxReflectionCharacters characters (2x user input: $actualUserCharacterCount)',
        );
      }

      final estimatedMaxTokens =
          maxReflectionCharacters != null ? (maxReflectionCharacters / 3).floor() : 200;
      final characterLimitInstruction = maxReflectionCharacters != null
          ? '\n\nCRITICAL CHARACTER LIMIT: The response must NEVER exceed $maxReflectionCharacters characters '
              '(which is 2x the $actualUserCharacterCount characters the user wrote on this day). '
              'Always stay within this strict character limit.'
          : '';

      final prompt = '''You are Detea - a compassionate AI therapist and emotional analyst.
You are analyzing a user's emotional wellbeing based on their daily reflections, moods, and emotional summaries.

${type == 'best' ? '''
Analyze the BEST MOOD DAY and explain why this day felt so positive.
- Focus on what made it special: achievements, positive connections, self-growth, calmness, or healing
- Be specific about the emotional cause
- Avoid generic phrases like "this was likely due to" or "you might have felt"
- Use direct reasoning: "You felt emotionally elevated because you overcame self-doubt during your project presentation, proving to yourself that persistence pays off."
''' : '''
Analyze the MOST CHALLENGING DAY and explain why it was emotionally difficult.
- Identify emotional triggers, inner conflicts, or moments of overwhelm
- Offer gentle insight into their coping process or emotional growth
- Avoid robotic summaries like "multiple pressures" - make it sound human, like a therapist's reflection
- Be specific about the emotional cause
'''}

Date: ${dayData['date'] ?? 'Unknown'}
Mood: ${dayData['happiness'] ?? 0}% happiness, ${dayData['energy'] ?? 0}% energy
Stress: ${dayData['stress'] ?? 0}% stress, ${dayData['anxiety'] ?? 0}% anxiety

${(dayData['summary'] ?? '').toString().trim().isNotEmpty ? 'Summary from that day: ${dayData['summary']}' : 'No daily summary available for this day.'}

Keep the response warm, natural, and empathetic (3-5 sentences). Focus on meaning and emotional cause, not numbers.$characterLimitInstruction''';

      final response = (apiProvider == 'gemini' && isVertexBackendConfigured())
          ? await vertexGenerateContent(
              prompt: prompt,
              temperature: 0.65,
              maxOutputTokens: estimatedMaxTokens,
            )
          : await _completeWithCurrentProvider(prompt, maxTokens: estimatedMaxTokens);

      var description = response.trim();
      if (maxReflectionCharacters != null && description.length > maxReflectionCharacters) {
        debugPrint(
          'Generated description (${description.length} chars) exceeds limit ($maxReflectionCharacters chars). Truncating...',
        );
        description = description.substring(0, maxReflectionCharacters);
        final lastSentenceEnd = [
          description.lastIndexOf('.'),
          description.lastIndexOf('!'),
          description.lastIndexOf('?'),
        ].reduce((a, b) => a > b ? a : b);
        if (lastSentenceEnd >= 0 && lastSentenceEnd > (maxReflectionCharacters * 0.7).floor()) {
          description = description.substring(0, lastSentenceEnd + 1);
        }
        debugPrint(
          'Truncated description to ${description.length} characters (within $maxReflectionCharacters limit)',
        );
      }

      debugPrint(
        'Generated $type day description: ${description.length} characters'
        '${maxReflectionCharacters != null ? ' (limit: $maxReflectionCharacters)' : ''}',
      );
      return description;
    } catch (error) {
      debugPrint('Error generating $type day description: $error');
      return 'You experienced ${type == 'best' ? 'a significantly positive day' : 'a challenging emotional period'} '
          'during $periodText. Reflect on what contributed to this experience and how it relates to your ongoing emotional journey.';
    }
  }
}

final chatService = ChatService.instance;
