import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'vertex_api_client.dart';

/// Resolved notable person with an optional verified visual reference.
class ResolvedPublicFigure {
  const ResolvedPublicFigure({
    required this.displayName,
    required this.confidence,
    required this.source,
    this.description,
    this.wikipediaTitle,
    this.thumbnailUrl,
    this.imageBase64,
    this.mimeType,
    this.ambiguous = false,
    this.alternateCandidates = const [],
  });

  final String displayName;
  final double confidence;
  final String source;
  final String? description;
  final String? wikipediaTitle;
  final String? thumbnailUrl;
  final String? imageBase64;
  final String? mimeType;
  final bool ambiguous;
  final List<String> alternateCandidates;

  bool get hasReferenceImage =>
      (imageBase64 ?? '').trim().isNotEmpty && (mimeType ?? '').trim().isNotEmpty;

  Map<String, String>? get referenceImage {
    if (!hasReferenceImage) return null;
    return {'base64': imageBase64!, 'mimeType': mimeType!};
  }
}

/// Result of scanning user text for public figures.
class PublicFigureScanResult {
  const PublicFigureScanResult({
    required this.figures,
    this.notice,
  });

  final List<ResolvedPublicFigure> figures;
  /// User-facing notice (ambiguity / no reference found).
  final String? notice;

  ResolvedPublicFigure? get primary => figures.isEmpty ? null : figures.first;
}

/// Reusable identity resolution + Wikipedia reference fetch (no hardcoded celebs).
class PublicFigureService {
  PublicFigureService._();
  static final PublicFigureService instance = PublicFigureService._();

  static const _wikiUa = 'SociTeaApp/1.0 (https://deitedatabase.web.app; public-figure)';
  static const _cachePrefix = 'public_figure_ref_v1::';
  static const _memoryTtl = Duration(hours: 6);

  final Map<String, _CacheEntry> _memory = {};

  /// Extract + resolve notable people from [text]. Caps network work for UX.
  Future<PublicFigureScanResult> scanAndResolve(
    String text, {
    Duration timeout = const Duration(seconds: 14),
    int maxPeople = 2,
  }) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty) {
      return const PublicFigureScanResult(figures: []);
    }

    try {
      return await _scanAndResolveInner(
        trimmed,
        maxPeople: maxPeople,
      ).timeout(timeout);
    } on TimeoutException {
      debugPrint('[PublicFigure] scan timed out after ${timeout.inSeconds}s');
      return const PublicFigureScanResult(
        figures: [],
        notice: 'Public-figure lookup timed out — generating without a verified face reference.',
      );
    } catch (e, st) {
      debugPrint('[PublicFigure] scan failed: $e\n$st');
      return const PublicFigureScanResult(figures: []);
    }
  }

  Future<PublicFigureScanResult> _scanAndResolveInner(
    String text, {
    required int maxPeople,
  }) async {
    final candidates = await _extractCandidateNames(text);
    if (candidates.isEmpty) {
      return const PublicFigureScanResult(figures: []);
    }

    final resolved = <ResolvedPublicFigure>[];
    String? notice;

    for (final name in candidates.take(maxPeople + 2)) {
      final person = await _resolvePerson(name, contextText: text);
      if (person == null) continue;
      if (person.ambiguous) {
        notice =
            'Multiple people match "${person.displayName}". '
            'Add a clue (profession/event) or we generate without that face.';
        // Do not use an ambiguous identity as a face reference.
        continue;
      }
      if (!person.hasReferenceImage) {
        notice ??=
            'Could not find a verified photo for ${person.displayName} — generating without that face reference.';
        continue;
      }
      resolved.add(person);
      if (resolved.length >= maxPeople) break;
    }

    debugPrint(
      '[PublicFigure] candidates=$candidates resolved=${resolved.map((e) => e.displayName).toList()} notice=$notice',
    );
    return PublicFigureScanResult(figures: resolved, notice: notice);
  }

  Future<List<String>> _extractCandidateNames(String text) async {
    final found = <String>[];
    final seen = <String>{};

    void add(String? raw) {
      final n = _normalizeName(raw);
      if (n == null) return;
      final key = n.toLowerCase();
      if (!seen.add(key)) return;
      // Skip very common non-person phrases.
      if (_isBlockedName(n)) return;
      found.add(n);
    }

    // 1) Vertex JSON extract (famous personalities only) — best quality.
    if (isVertexBackendConfigured()) {
      try {
        final fromVertex = await _extractViaVertex(text)
            .timeout(const Duration(seconds: 8));
        for (final n in fromVertex) {
          add(n);
        }
      } catch (e) {
        debugPrint('[PublicFigure] Vertex extract skipped: $e');
      }
    }

    // 2) Capitalized multi-word names as fallback candidates.
    for (final n in _extractCapitalizedNames(text)) {
      add(n);
    }

    return found;
  }

  Future<List<String>> _extractViaVertex(String text) async {
    final clip = text.length > 900 ? text.substring(0, 900) : text;
    final prompt = '''
Extract ONLY notable public figures (celebrities, politicians, athletes, entrepreneurs,
influencers, historical figures) mentioned in the text. Ignore ordinary friends,
fictional characters unless globally famous, and organizations.

Return STRICT JSON only:
{"people":[{"name":"Full Name","role":"short role or empty","mainSubject":true}]}

If none, return {"people":[]}.

Text:
$clip
''';
    final raw = await vertexGenerateContentDirect(
      prompt: prompt,
      temperature: 0.1,
      maxOutputTokens: 400,
      timeout: const Duration(seconds: 8),
    );
    final jsonStr = _extractJsonObject(raw);
    if (jsonStr == null) return const [];
    final decoded = jsonDecode(jsonStr);
    if (decoded is! Map) return const [];
    final people = decoded['people'];
    if (people is! List) return const [];

    // Prefer mainSubject first.
    final mains = <String>[];
    final others = <String>[];
    for (final row in people) {
      if (row is! Map) continue;
      final name = (row['name'] ?? '').toString().trim();
      if (name.isEmpty) continue;
      final main = row['mainSubject'] == true;
      if (main) {
        mains.add(name);
      } else {
        others.add(name);
      }
    }
    return [...mains, ...others];
  }

  Future<ResolvedPublicFigure?> _resolvePerson(
    String name, {
    required String contextText,
  }) async {
    final cached = await _readCache(name);
    if (cached != null) return cached;

    // Direct title hit.
    var summary = await _wikipediaSummary(name);
    // Search if needed.
    List<String> searchTitles = const [];
    if (summary == null) {
      searchTitles = await _wikipediaSearchTitles(name, limit: 5);
      for (final title in searchTitles) {
        summary = await _wikipediaSummary(title);
        if (summary != null) break;
      }
    }

    if (summary == null) {
      debugPrint('[PublicFigure] no Wikipedia page for "$name"');
      return null;
    }

    final pageTitle = summary['title'] ?? name;
    final description = summary['description'] ?? summary['extract'] ?? '';
    final thumb = summary['thumbnail'];

    // Ambiguity: several search hits that look like different people.
    final ambiguous = _looksAmbiguous(name, searchTitles, pageTitle, description);
    if (ambiguous) {
      final figure = ResolvedPublicFigure(
        displayName: name,
        confidence: 0.35,
        source: 'wikipedia-search',
        description: description,
        wikipediaTitle: pageTitle,
        ambiguous: true,
        alternateCandidates: searchTitles.take(4).toList(),
      );
      return figure;
    }

    // Notability gate: prefer pages with a description / extract.
    if (description.trim().isEmpty && thumb == null) {
      return null;
    }

    final candidateUrls = <String>[];
    void addUrl(String? u) {
      var url = (u ?? '').trim();
      if (!url.startsWith('http')) return;
      // Drop tracking query params from MediaWiki REST URLs.
      url = url.split('?').first;
      if (!candidateUrls.contains(url)) candidateUrls.add(url);
    }

    addUrl(summary['originalImage']);
    addUrl(thumb);
    // Prefer a larger Commons derivative when Wikipedia serves thumbnails.
    if (thumb != null && thumb.contains('/thumb/')) {
      addUrl(thumb.replaceAll(RegExp(r'/(\d+)px-'), '/640px-'));
    }

    String? thumbUrl;
    Map<String, String>? encoded;
    for (final url in candidateUrls) {
      encoded = await _downloadImageAsBase64(url);
      if (encoded != null) {
        thumbUrl = url;
        break;
      }
    }

    final figure = ResolvedPublicFigure(
      displayName: pageTitle,
      confidence: encoded != null ? 0.85 : 0.55,
      source: 'wikipedia',
      description: description,
      wikipediaTitle: pageTitle,
      thumbnailUrl: thumbUrl ?? thumb,
      imageBase64: encoded?['base64'],
      mimeType: encoded?['mimeType'],
      ambiguous: false,
    );
    if (encoded != null) {
      await _writeCache(name, figure);
    }
    return figure;
  }

  bool _looksAmbiguous(
    String query,
    List<String> searchTitles,
    String chosenTitle,
    String description,
  ) {
    final d = description.toLowerCase();
    if (d.contains('may refer to') || chosenTitle.toLowerCase().contains('disambiguation')) {
      return true;
    }
    // Common short names (First Last) with many distinct hits → careful.
    final parts = query.trim().split(RegExp(r'\s+'));
    if (parts.length != 2) return false;
    if (searchTitles.length < 3) return false;
    // Count titles that look like people pages for the same name (contain both tokens).
    final related = searchTitles.where((t) {
      final tl = t.toLowerCase();
      return tl.contains(parts[0].toLowerCase()) && tl.contains(parts[1].toLowerCase());
    }).length;
    // Several different people pages, or many unrelated hits → ask for clarification.
    if (related >= 3) return true;
    if (related <= 1 && searchTitles.length >= 4) return true;
    // Exact common-name match with no clarifying role in the user query context
    // is handled by requiring description; still treat multi-hit lists as ambiguous.
    if (related >= 2 && searchTitles.length >= 4) return true;
    return false;
  }

  Future<Map<String, String>?> _wikipediaSummary(String title) async {
    final t = title.trim();
    if (t.isEmpty) return null;
    final fromRest = await _wikipediaRestSummary(t);
    if (fromRest != null) return fromRest;
    return _wikipediaActionSummary(t);
  }

  Future<_HttpResult> _get(Uri uri, {Map<String, String>? headers}) async {
    final client = HttpClient();
    client.userAgent = _wikiUa;
    client.connectionTimeout = const Duration(seconds: 10);
    try {
      final req = await client.getUrl(uri).timeout(const Duration(seconds: 10));
      req.headers.set(HttpHeaders.acceptHeader, headers?['Accept'] ?? '*/*');
      req.headers.set(HttpHeaders.userAgentHeader, _wikiUa);
      for (final e in (headers ?? const <String, String>{}).entries) {
        if (e.key.toLowerCase() == 'user-agent' || e.key.toLowerCase() == 'accept') {
          continue;
        }
        req.headers.set(e.key, e.value);
      }
      final res = await req.close().timeout(const Duration(seconds: 12));
      final bytes = await res.fold<List<int>>(
        <int>[],
        (prev, chunk) => prev..addAll(chunk),
      );
      return _HttpResult(res.statusCode, bytes, res.headers.contentType?.mimeType);
    } finally {
      client.close(force: true);
    }
  }

  Future<Map<String, String>?> _wikipediaRestSummary(String title) async {
    try {
      final pathTitle = Uri.encodeComponent(title.replaceAll(' ', '_'));
      final uri = Uri.parse(
        'https://en.wikipedia.org/api/rest_v1/page/summary/$pathTitle',
      );
      final res = await _get(uri, headers: {'Accept': 'application/json'});
      if (res.statusCode != 200) {
        debugPrint('[PublicFigure] REST summary HTTP ${res.statusCode} for "$title"');
        return null;
      }
      final data = jsonDecode(utf8.decode(res.bodyBytes));
      if (data is! Map) return null;
      final pageTitle = (data['title'] ?? title).toString();
      final description = (data['description'] ?? '').toString().trim();
      final extract = (data['extract'] ?? '').toString().trim();
      String? thumb;
      String? original;
      final thumbnail = data['thumbnail'];
      if (thumbnail is Map) {
        thumb = (thumbnail['source'] ?? '').toString().trim();
        if (thumb.isEmpty) thumb = null;
      }
      final originalImage = data['originalimage'];
      if (originalImage is Map) {
        original = (originalImage['source'] ?? '').toString().trim();
        if (original.isEmpty) original = null;
      }
      final type = (data['type'] ?? '').toString();
      if (type == 'disambiguation') return null;
      return {
        'title': pageTitle,
        'description': description.isNotEmpty ? description : extract,
        'extract': extract,
        if (thumb != null) 'thumbnail': thumb,
        if (original != null) 'originalImage': original,
      };
    } catch (e) {
      debugPrint('[PublicFigure] REST summary failed for "$title": $e');
      return null;
    }
  }

  /// Fallback via MediaWiki Action API (pageimages + description).
  Future<Map<String, String>?> _wikipediaActionSummary(String title) async {
    try {
      final uri = Uri.parse('https://en.wikipedia.org/w/api.php').replace(
        queryParameters: {
          'action': 'query',
          'titles': title,
          'prop': 'pageimages|description|extracts',
          'pithumbsize': '800',
          'exintro': '1',
          'explaintext': '1',
          'redirects': '1',
          'format': 'json',
        },
      );
      final res = await _get(uri, headers: {'Accept': 'application/json'});
      if (res.statusCode != 200) {
        debugPrint('[PublicFigure] Action API HTTP ${res.statusCode} for "$title"');
        return null;
      }
      final data = jsonDecode(utf8.decode(res.bodyBytes));
      final pages = data is Map && data['query'] is Map ? data['query']['pages'] : null;
      if (pages is! Map) return null;
      for (final entry in pages.values) {
        if (entry is! Map) continue;
        if (entry['missing'] != null) continue;
        final pageTitle = (entry['title'] ?? title).toString();
        final description = (entry['description'] ?? '').toString().trim();
        final extract = (entry['extract'] ?? '').toString().trim();
        String? thumb;
        final thumbnail = entry['thumbnail'];
        if (thumbnail is Map) {
          thumb = (thumbnail['source'] ?? '').toString().trim();
          if (thumb.isEmpty) thumb = null;
        }
        if (description.isEmpty && extract.isEmpty && thumb == null) continue;
        return {
          'title': pageTitle,
          'description': description.isNotEmpty ? description : extract,
          'extract': extract,
          if (thumb != null) 'thumbnail': thumb,
        };
      }
      return null;
    } catch (e) {
      debugPrint('[PublicFigure] Action API summary failed for "$title": $e');
      return null;
    }
  }

  Future<List<String>> _wikipediaSearchTitles(String query, {int limit = 5}) async {
    try {
      final uri = Uri.parse('https://en.wikipedia.org/w/api.php').replace(
        queryParameters: {
          'action': 'query',
          'list': 'search',
          'srsearch': query,
          'format': 'json',
          'srlimit': '$limit',
        },
      );
      final res = await _get(uri, headers: {'Accept': 'application/json'});
      if (res.statusCode != 200) return const [];
      final data = jsonDecode(utf8.decode(res.bodyBytes));
      final search = data is Map ? (data['query'] is Map ? data['query']['search'] : null) : null;
      if (search is! List) return const [];
      return search
          .whereType<Map>()
          .map((m) => (m['title'] ?? '').toString().trim())
          .where((t) => t.isNotEmpty)
          .toList();
    } catch (e) {
      debugPrint('[PublicFigure] search failed for "$query": $e');
      return const [];
    }
  }

  Future<Map<String, String>?> _downloadImageAsBase64(String url) async {
    try {
      final res = await _get(
        Uri.parse(url),
        headers: {'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'},
      );
      if (res.statusCode < 200 || res.statusCode >= 300) {
        debugPrint('[PublicFigure] image HTTP ${res.statusCode} for $url');
        return null;
      }
      if (res.bodyBytes.isEmpty || res.bodyBytes.length > 5 * 1024 * 1024) return null;

      var mime = (res.contentType ?? '').toLowerCase().split(';').first.trim();
      // Commons sometimes returns octet-stream; sniff from URL / magic bytes.
      if (!RegExp(r'^image/(jpeg|jpg|png|gif|webp)$').hasMatch(mime)) {
        final lower = url.toLowerCase();
        if (lower.contains('.png')) {
          mime = 'image/png';
        } else if (lower.contains('.webp')) {
          mime = 'image/webp';
        } else if (lower.contains('.gif')) {
          mime = 'image/gif';
        } else if (lower.contains('.jpg') ||
            lower.contains('.jpeg') ||
            _looksLikeJpeg(res.bodyBytes)) {
          mime = 'image/jpeg';
        } else if (_looksLikePng(res.bodyBytes)) {
          mime = 'image/png';
        } else {
          debugPrint('[PublicFigure] unsupported content-type="$mime" for $url');
          return null;
        }
      }
      return {
        'base64': base64Encode(res.bodyBytes),
        'mimeType': mime == 'image/jpg' ? 'image/jpeg' : mime,
      };
    } catch (e) {
      debugPrint('[PublicFigure] image download failed: $e');
      return null;
    }
  }

  bool _looksLikeJpeg(List<int> bytes) =>
      bytes.length > 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF;

  bool _looksLikePng(List<int> bytes) =>
      bytes.length > 8 &&
      bytes[0] == 0x89 &&
      bytes[1] == 0x50 &&
      bytes[2] == 0x4E &&
      bytes[3] == 0x47;

  List<String> _extractCapitalizedNames(String text) {
    final re = RegExp(r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b');
    return re.allMatches(text).map((m) => m.group(1)!.trim()).toList();
  }

  String? _normalizeName(String? raw) {
    if (raw == null) return null;
    var n = raw.trim().replaceAll(RegExp(r'\s+'), ' ');
    n = n.replaceAll(RegExp(r'^[^A-Za-z]+|[^A-Za-z.\s-]+$'), '');
    if (n.length < 3 || n.length > 60) return null;
    final parts = n.split(' ');
    if (parts.length < 2) return null; // require at least first+last for reliability
    return n;
  }

  bool _isBlockedName(String name) {
    final lower = name.toLowerCase();
    const blocked = {
      'united states',
      'new york',
      'prime minister',
      'world cup',
      'artificial intelligence',
      'silicon valley',
      'social media',
    };
    return blocked.contains(lower);
  }

  String? _extractJsonObject(String raw) {
    final t = raw.trim();
    final start = t.indexOf('{');
    final end = t.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    return t.substring(start, end + 1);
  }

  Future<ResolvedPublicFigure?> _readCache(String name) async {
    final key = name.toLowerCase();
    final mem = _memory[key];
    if (mem != null && DateTime.now().difference(mem.at) < _memoryTtl) {
      return mem.figure;
    }
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString('$_cachePrefix$key');
      if (raw == null || raw.isEmpty) return null;
      final map = jsonDecode(raw);
      if (map is! Map) return null;
      final figure = ResolvedPublicFigure(
        displayName: (map['displayName'] ?? name).toString(),
        confidence: (map['confidence'] is num) ? (map['confidence'] as num).toDouble() : 0.7,
        source: (map['source'] ?? 'cache').toString(),
        description: map['description']?.toString(),
        wikipediaTitle: map['wikipediaTitle']?.toString(),
        thumbnailUrl: map['thumbnailUrl']?.toString(),
        imageBase64: map['imageBase64']?.toString(),
        mimeType: map['mimeType']?.toString(),
        ambiguous: map['ambiguous'] == true,
        alternateCandidates: map['alternateCandidates'] is List
            ? (map['alternateCandidates'] as List).map((e) => e.toString()).toList()
            : const [],
      );
      _memory[key] = _CacheEntry(figure, DateTime.now());
      return figure;
    } catch (_) {
      return null;
    }
  }

  Future<void> _writeCache(String name, ResolvedPublicFigure figure) async {
    final key = name.toLowerCase();
    _memory[key] = _CacheEntry(figure, DateTime.now());
    try {
      final prefs = await SharedPreferences.getInstance();
      // Cap base64 size in prefs (~200KB encoded).
      final b64 = figure.imageBase64;
      final storeB64 = (b64 != null && b64.length <= 280000) ? b64 : null;
      await prefs.setString(
        '$_cachePrefix$key',
        jsonEncode({
          'displayName': figure.displayName,
          'confidence': figure.confidence,
          'source': figure.source,
          'description': figure.description,
          'wikipediaTitle': figure.wikipediaTitle,
          'thumbnailUrl': figure.thumbnailUrl,
          if (storeB64 != null) 'imageBase64': storeB64,
          if (storeB64 != null) 'mimeType': figure.mimeType,
          'ambiguous': figure.ambiguous,
          'alternateCandidates': figure.alternateCandidates,
        }),
      );
    } catch (e) {
      debugPrint('[PublicFigure] cache write skipped: $e');
    }
  }
}

class _CacheEntry {
  _CacheEntry(this.figure, this.at);
  final ResolvedPublicFigure figure;
  final DateTime at;
}

class _HttpResult {
  _HttpResult(this.statusCode, this.bodyBytes, this.contentType);
  final int statusCode;
  final List<int> bodyBytes;
  final String? contentType;
}
