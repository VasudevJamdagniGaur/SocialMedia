import 'dart:convert';
import 'dart:io';

import 'package:googleapis_auth/auth_io.dart';
import 'package:http/http.dart' as http;

import '../config.dart';

/// Firebase admin service — Firestore REST + Firebase Storage REST.
/// Uses a service account with `cloud-platform` scope (covers both Firestore and Storage).
class FirebaseAdminService {
  FirebaseAdminService({http.Client? httpClient}) : _http = httpClient ?? http.Client();

  final http.Client _http;
  AutoRefreshingAuthClient? _authClient;

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  Future<AutoRefreshingAuthClient?> _client() async {
    if (_authClient != null) return _authClient;
    final path = ServerConfig.credentialsPath;
    if (!File(path).existsSync()) return null;
    try {
      final creds = ServiceAccountCredentials.fromJson(
        jsonDecode(await File(path).readAsString()) as Map<String, dynamic>,
      );
      _authClient = await clientViaServiceAccount(creds, [
        'https://www.googleapis.com/auth/cloud-platform',
      ]);
      return _authClient;
    } catch (_) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Hash — must match Flutter's FirestoreService.hashForNewsUrlCache()
  // ---------------------------------------------------------------------------

  static String hashForUrl(String url) {
    final trimmed = url.trim();
    final raw = trimmed.length > 900 ? trimmed.substring(0, 900) : trimmed;
    final s = raw.replaceAll(RegExp(r'\s+'), ' ').trim();
    if (s.isEmpty) return '';
    var h = 0;
    for (var i = 0; i < s.length; i++) {
      h = _toInt32((h << 5) - h + s.codeUnitAt(i));
    }
    return h.abs().toRadixString(36);
  }

  static int _toInt32(int v) {
    const mask = 0xFFFFFFFF;
    final x = v & mask;
    return x > 0x7FFFFFFF ? x - 0x100000000 : x;
  }

  // ---------------------------------------------------------------------------
  // Firestore helpers
  // ---------------------------------------------------------------------------

  String get _firestoreBase =>
      'https://firestore.googleapis.com/v1/projects/${ServerConfig.firestoreProjectId}/databases/(default)/documents';

  Map<String, dynamic> _stringField(String v) => {'stringValue': v};
  Map<String, dynamic> _boolField(bool v) => {'booleanValue': v};
  Map<String, dynamic> _intField(int v) => {'integerValue': '$v'};

  String? _extractString(Map<String, dynamic>? field) => field?['stringValue'] as String?;

  Future<String?> getHubCarouselImageUrl(String articleUrl) async {
    final url = articleUrl.trim();
    if (url.isEmpty) return null;
    final key = hashForUrl(url);
    if (key.isEmpty) return null;

    final client = await _client();
    if (client == null) return null;

    try {
      final res = await client
          .get(Uri.parse('$_firestoreBase/hubCarouselImageCache/$key'))
          .timeout(const Duration(seconds: 10));
      if (res.statusCode == 404) return null;
      if (res.statusCode < 200 || res.statusCode >= 300) return null;
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final fields = data['fields'] as Map<String, dynamic>?;
      final imageUrl = _extractString(fields?['imageUrl'] as Map<String, dynamic>?);
      if (imageUrl != null && imageUrl.startsWith('https://')) return imageUrl;
    } catch (_) {}
    return null;
  }

  /// Returns {aiImageUrl, sourceImageUrl} from Firestore. Both may be null.
  Future<({String? aiImageUrl, String? sourceImageUrl})> getHubCarouselBothUrls(String articleUrl) async {
    final url = articleUrl.trim();
    if (url.isEmpty) return (aiImageUrl: null, sourceImageUrl: null);
    final key = hashForUrl(url);
    if (key.isEmpty) return (aiImageUrl: null, sourceImageUrl: null);

    final client = await _client();
    if (client == null) return (aiImageUrl: null, sourceImageUrl: null);

    try {
      final res = await client
          .get(Uri.parse('$_firestoreBase/hubCarouselImageCache/$key'))
          .timeout(const Duration(seconds: 10));
      if (res.statusCode == 404) return (aiImageUrl: null, sourceImageUrl: null);
      if (res.statusCode < 200 || res.statusCode >= 300) return (aiImageUrl: null, sourceImageUrl: null);
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final fields = data['fields'] as Map<String, dynamic>?;
      // Accept both new field (aiImageUrl) and legacy field (imageUrl).
      final aiUrl = _extractString(fields?['aiImageUrl'] as Map<String, dynamic>?) ??
          _extractString(fields?['imageUrl'] as Map<String, dynamic>?);
      final srcUrl = _extractString(fields?['sourceImageUrl'] as Map<String, dynamic>?);
      return (
        aiImageUrl: (aiUrl != null && aiUrl.startsWith('https://')) ? aiUrl : null,
        sourceImageUrl: (srcUrl != null && srcUrl.startsWith('https://')) ? srcUrl : null,
      );
    } catch (_) {}
    return (aiImageUrl: null, sourceImageUrl: null);
  }

  Future<void> saveHubCarouselImageRecord({
    required String articleUrl,
    required String imageUrl,
    required String kind,
    required String storagePath,
    String headline = '',
    String? sourceImageUrl,
  }) async {
    final url = articleUrl.trim();
    if (url.isEmpty || imageUrl.isEmpty) return;
    final key = hashForUrl(url);
    if (key.isEmpty) return;

    final client = await _client();
    if (client == null) return;

    final now = DateTime.now().millisecondsSinceEpoch;
    final fields = <String, dynamic>{
      'articleUrl': _stringField(url.length > 1200 ? url.substring(0, 1200) : url),
      // Write to both new aiImageUrl and legacy imageUrl fields for backwards compatibility.
      'aiImageUrl': _stringField(imageUrl),
      'imageUrl': _stringField(imageUrl),
      'kind': _stringField(kind),
      'imageGenerated': _boolField(true),
      'lastSeenAt': _intField(now),
      if (storagePath.isNotEmpty) 'storagePath': _stringField(storagePath),
      if (headline.trim().isNotEmpty) 'headline': _stringField(headline.trim()),
      if (sourceImageUrl != null && sourceImageUrl.trim().startsWith('http'))
        'sourceImageUrl': _stringField(sourceImageUrl.trim()),
    };

    try {
      await client
          .patch(
            Uri.parse('$_firestoreBase/hubCarouselImageCache/$key'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'fields': fields}),
          )
          .timeout(const Duration(seconds: 10));
    } catch (e) {
      stderr.writeln('[FirebaseAdmin] Firestore write failed: $e');
    }
  }

  // ---------------------------------------------------------------------------
  // Firebase Storage upload
  // ---------------------------------------------------------------------------

  String get _storageBucket => ServerConfig.storageBucket;

  /// Upload raw bytes to Firebase Storage and return a stable download URL.
  Future<String?> uploadImage({
    required String objectPath,
    required List<int> bytes,
    String contentType = 'image/png',
  }) async {
    final client = await _client();
    if (client == null) return null;

    final encodedPath = Uri.encodeComponent(objectPath);
    final uploadUri = Uri.parse(
      'https://firebasestorage.googleapis.com/v0/b/${Uri.encodeComponent(_storageBucket)}/o'
      '?name=${Uri.encodeComponent(objectPath)}&uploadType=media',
    );

    try {
      final res = await client
          .post(
            uploadUri,
            headers: {'Content-Type': contentType},
            body: bytes,
          )
          .timeout(const Duration(seconds: 60));
      if (res.statusCode < 200 || res.statusCode >= 300) {
        stderr.writeln('[FirebaseAdmin] Storage upload failed ${res.statusCode}: ${res.body.substring(0, res.body.length.clamp(0, 200))}');
        return null;
      }
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final token = (data['downloadTokens'] ?? '').toString().trim();
      if (token.isEmpty) {
        // Fall back to unauthenticated public URL (requires Storage public read)
        return 'https://firebasestorage.googleapis.com/v0/b/${Uri.encodeComponent(_storageBucket)}/o/$encodedPath?alt=media';
      }
      return 'https://firebasestorage.googleapis.com/v0/b/${Uri.encodeComponent(_storageBucket)}/o/$encodedPath?alt=media&token=$token';
    } catch (e) {
      stderr.writeln('[FirebaseAdmin] Storage upload exception: $e');
      return null;
    }
  }

  /// Upload a `data:image/...;base64,...` URL to Firebase Storage.
  /// Returns a stable https download URL or null on failure.
  Future<({String imageUrl, String storagePath})?> uploadDataUrl({
    required String key,
    required String dataUrl,
  }) async {
    if (!dataUrl.startsWith('data:image')) return null;
    try {
      final mimeMatch = RegExp(r'data:([^;]+);base64,(.+)', dotAll: true).firstMatch(dataUrl);
      if (mimeMatch == null) return null;
      final mime = mimeMatch.group(1)!.trim();
      final b64 = mimeMatch.group(2)!.replaceAll(RegExp(r'\s'), '');
      final bytes = base64Decode(b64);
      final ext = mime.contains('jpeg') ? 'jpg' : 'png';
      final objectPath = 'hubCarouselCache/$key.$ext';
      final downloadUrl = await uploadImage(
        objectPath: objectPath,
        bytes: bytes,
        contentType: mime,
      );
      if (downloadUrl == null) return null;
      return (imageUrl: downloadUrl, storagePath: objectPath);
    } catch (e) {
      stderr.writeln('[FirebaseAdmin] uploadDataUrl failed: $e');
      return null;
    }
  }

  void close() {
    _authClient?.close();
    _http.close();
  }
}
