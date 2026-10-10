import 'dart:collection';
import 'dart:convert';
import 'dart:typed_data';

import 'package:html/dom.dart';
import 'package:html/parser.dart' show parse;
import 'package:http/http.dart' as http;

const _userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

/// Normalized article payload for share generation.
typedef ArticlePayload = Map<String, String>;

const _cacheTtl = Duration(minutes: 45);
const _cacheMaxEntries = 80;

class _CacheEntry {
  _CacheEntry(this.payload, this.expiresAt);
  final ArticlePayload payload;
  final DateTime expiresAt;
}

final LinkedHashMap<String, _CacheEntry> _articleCache = LinkedHashMap();

void clearArticleExtractCache() => _articleCache.clear();

String _cacheKey(String url) => url.trim().toLowerCase();

ArticlePayload? _cacheGet(String url) {
  final key = _cacheKey(url);
  final entry = _articleCache[key];
  if (entry == null) return null;
  if (DateTime.now().isAfter(entry.expiresAt)) {
    _articleCache.remove(key);
    return null;
  }
  // LRU: move to end
  _articleCache.remove(key);
  _articleCache[key] = entry;
  return Map<String, String>.from(entry.payload);
}

void _cachePut(String url, ArticlePayload payload) {
  final key = _cacheKey(url);
  _articleCache.remove(key);
  while (_articleCache.length >= _cacheMaxEntries) {
    _articleCache.remove(_articleCache.keys.first);
  }
  _articleCache[key] = _CacheEntry(
    Map<String, String>.from(payload),
    DateTime.now().add(_cacheTtl),
  );
}

String decodeMaybeWrappedNewsUrl(String rawUrl) {
  final trimmed = rawUrl.trim();
  if (trimmed.isEmpty) return '';
  try {
    final u = Uri.parse(trimmed);
    final qUrl = u.queryParameters['url'] ?? u.queryParameters['q'];
    if (qUrl != null && RegExp(r'^https?://', caseSensitive: false).hasMatch(qUrl)) {
      return qUrl;
    }
  } catch (_) {
    // ignore
  }
  return trimmed;
}

String? decodeMetaUrl(String raw) {
  if (raw.trim().isEmpty) return null;
  var u = raw.trim().replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
  if (u.startsWith('//')) u = 'https:$u';
  return RegExp(r'^https?://', caseSensitive: false).hasMatch(u) ? u : null;
}

String? decodeGoogleWrappedUrl(String href) {
  if (href.trim().isEmpty) return null;
  try {
    final u = Uri.parse(href.startsWith('http') ? href : 'https://news.google.com$href');
    final inner = u.queryParameters['url'] ?? u.queryParameters['q'];
    if (inner != null && RegExp(r'^https?://', caseSensitive: false).hasMatch(inner)) {
      return inner;
    }
  } catch (_) {
    // ignore
  }
  final m = RegExp(r'[?&](?:url|q)=(https%3A%2F%2F[^&]+)', caseSensitive: false).firstMatch(href);
  if (m != null) {
    try {
      final decoded = Uri.decodeComponent(m.group(1)!);
      if (RegExp(r'^https?://', caseSensitive: false).hasMatch(decoded)) return decoded;
    } catch (_) {
      // ignore
    }
  }
  return null;
}

bool isBlockedOutboundHost(String url) {
  try {
    final h = Uri.parse(url).host.toLowerCase();
    if (h == 'news.google.com' || h.endsWith('.news.google.com')) return true;
    if (h == 'play.google.com' || h.endsWith('.play.google.com')) return true;
    if (h.endsWith('google.com') || h == 'gstatic.com' || h.endsWith('.gstatic.com')) {
      return true;
    }
    if (h == 'youtube.com' || h.endsWith('.youtube.com')) return true;
    if (h == 'googleusercontent.com') return true;
    return false;
  } catch (_) {
    return true;
  }
}

bool _looksLikeImageAssetUrl(String url) {
  final s = url.toLowerCase();
  if (s.startsWith('data:')) return true;
  if (RegExp(r'lh[0-9]\.googleusercontent\.com', caseSensitive: false).hasMatch(url)) {
    return true;
  }
  if (RegExp(r'\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?.*)?$', caseSensitive: false).hasMatch(s)) {
    return true;
  }
  return false;
}

bool _looksLikePublisherPageUrl(String url) {
  if (url.isEmpty || _looksLikeImageAssetUrl(url)) return false;
  try {
    final p = Uri.parse(url);
    final host = p.host.toLowerCase();
    if (host == 'googletagmanager.com' || host.endsWith('.googletagmanager.com')) {
      return false;
    }
    if (host == 'google-analytics.com' || host.endsWith('.google-analytics.com')) {
      return false;
    }
    if (host == 'doubleclick.net' || host.endsWith('.doubleclick.net')) return false;
    if (host == 'w3.org' || host.endsWith('.w3.org')) return false;

    final path = p.path.toLowerCase();
    final segments = path.split('/').where((s) => s.isNotEmpty).toList();
    final last = segments.isEmpty ? '' : segments.last;

    if (RegExp(r'\.(js|css|json|xml|rss|atom|txt|map|ico)(\?.*)?$').hasMatch(path)) {
      return false;
    }
    if (last == 'js' || last == 'css' || last == 'json' || last == 'xml') return false;
    if (path.contains('/gtag/') && (last == 'js' || path.endsWith('/gtag/js'))) {
      return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}

bool _isUrlCharByte(int b) {
  return (b >= 0x30 && b <= 0x39) ||
      (b >= 0x41 && b <= 0x5a) ||
      (b >= 0x61 && b <= 0x7a) ||
      b == 0x3a ||
      b == 0x2f ||
      b == 0x2e ||
      b == 0x3f ||
      b == 0x23 ||
      b == 0x26 ||
      b == 0x25 ||
      b == 0x3d ||
      b == 0x2d ||
      b == 0x5f ||
      b == 0x7e ||
      b == 0x2b ||
      b == 0x40 ||
      b == 0x21 ||
      b == 0x24 ||
      b == 0x2a ||
      b == 0x27 ||
      b == 0x28 ||
      b == 0x29 ||
      b == 0x2c ||
      b == 0x3b ||
      b == 0x5b ||
      b == 0x5d;
}

List<String> _extractAsciiUrlsFromBytes(Uint8List buf) {
  final out = <String>[];
  final n = buf.length;
  for (var i = 0; i + 4 < n; i++) {
    if (buf[i] != 0x68 || buf[i + 1] != 0x74 || buf[i + 2] != 0x74 || buf[i + 3] != 0x70) {
      continue;
    }
    var j = i;
    final sb = StringBuffer();
    while (j < n && _isUrlCharByte(buf[j]) && sb.length < 2000) {
      sb.writeCharCode(buf[j]);
      j++;
    }
    final s = sb.toString();
    if (RegExp(r'^https?://', caseSensitive: false).hasMatch(s) && s.length >= 12) {
      out.add(s);
    }
    i = j;
  }
  return out;
}

/// Decode a Google News `.../articles/<id>` URL into the real publisher URL.
String? decodeGoogleNewsArticleIdUrl(String? inputUrl) {
  final raw = (inputUrl ?? '').trim();
  if (raw.isEmpty) return null;
  try {
    final u = Uri.parse(raw);
    if (!RegExp(r'news\.google\.com$', caseSensitive: false).hasMatch(u.host)) {
      return null;
    }
    final m = RegExp(r'/articles/([^/?#]+)', caseSensitive: false).firstMatch(u.path);
    final id = m?.group(1);
    if (id == null || id.isEmpty) return null;

    var b64 = id.replaceAll('-', '+').replaceAll('_', '/');
    final pad = '=' * ((4 - (b64.length % 4)) % 4);
    late Uint8List bytes;
    try {
      bytes = base64Decode(b64 + pad);
    } catch (_) {
      return null;
    }

    final urls = _extractAsciiUrlsFromBytes(bytes);
    for (final cand in urls) {
      final unwrapped = decodeGoogleWrappedUrl(cand) ?? cand;
      if (isBlockedOutboundHost(unwrapped)) continue;
      if (!_looksLikePublisherPageUrl(unwrapped)) continue;
      return unwrapped;
    }
  } catch (_) {
    return null;
  }
  return null;
}

bool isGoogleNewsArticleUrl(String url) =>
    RegExp(r'news\.google\.com/(rss/)?articles/', caseSensitive: false).hasMatch(url);

String? extractLikelyPublisherUrlFromGoogleNewsPageHtml(String html) {
  if (html.length < 200) return null;
  final re = RegExp(
    r'https?://[a-z0-9][-a-z0-9.]*[a-z0-9](?::\d+)?/[^"\s<>)]{12,900}',
    caseSensitive: false,
  );
  String? best;
  var bestScore = 0;
  for (final m in re.allMatches(html)) {
    var u = m.group(0)!.replaceAll(RegExp(r'[),.;]+$'), '');
    final decodedMeta = decodeMetaUrl(u);
    if (decodedMeta != null) u = decodedMeta;
    final unwrapped = decodeGoogleWrappedUrl(u);
    if (unwrapped != null) u = unwrapped;
    if (u.isEmpty || isBlockedOutboundHost(u)) continue;
    if (!_looksLikePublisherPageUrl(u)) continue;
    try {
      final p = Uri.parse(u);
      final score = p.path.length + (p.query.isNotEmpty ? 8 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = u;
      }
    } catch (_) {
      // ignore
    }
  }
  return best;
}

String pickMetaContent(Document doc, List<String> selectors) {
  for (final s in selectors) {
    final el = doc.querySelector(s);
    final c = el?.attributes['content']?.trim() ?? '';
    if (c.isNotEmpty) return c;
  }
  return '';
}

String cleanArticleText(String raw) {
  final t = raw.replaceAll('\r', '\n').replaceAll(RegExp(r'[ \t]+\n'), '\n').trim();
  return t.length > 16000 ? '${t.substring(0, 16000).trim()}\n...' : t;
}

String _normalizeBodyText(String raw) {
  return raw
      .replaceAll('\r', '\n')
      .replaceAll(RegExp(r'\n{3,}'), '\n\n')
      .replaceAll(RegExp(r'[ \t]+'), ' ')
      .trim();
}

bool _titleEcho(String body, String title) {
  final b = body.toLowerCase().replaceAll(RegExp(r'\s+'), ' ').trim();
  final t = title.toLowerCase().replaceAll(RegExp(r'\s+'), ' ').trim();
  if (t.isEmpty || b.isEmpty) return false;
  if (b == t) return true;
  if (b.length <= t.length + 12 && b.contains(t)) return true;
  return false;
}

double _linkDensity(Element el) {
  final textLen = el.text.trim().length;
  if (textLen == 0) return 1;
  var linkLen = 0;
  for (final a in el.querySelectorAll('a')) {
    linkLen += a.text.trim().length;
  }
  return linkLen / textLen;
}

String _textFromElementPreferringParagraphs(Element el) {
  final parts = <String>[];
  for (final node in el.querySelectorAll('h1, h2, h3, h4, p, li')) {
    final t = node.text.replaceAll(RegExp(r'\s+'), ' ').trim();
    if (t.length >= 25) parts.add(t);
  }
  if (parts.isEmpty) return _normalizeBodyText(el.text);
  return _normalizeBodyText(parts.join('\n\n'));
}

void _stripBoilerplate(Document doc) {
  for (final tag in [
    'script',
    'style',
    'noscript',
    'svg',
    'nav',
    'header',
    'footer',
    'aside',
    'form',
    'iframe',
  ]) {
    for (final el in doc.querySelectorAll(tag).toList()) {
      el.remove();
    }
  }
  // Common cookie / subscribe / related chrome by class/id substring.
  final junkRe = RegExp(
    r'(cookie|subscribe|newsletter|related|share|social|comment|sidebar|advert|promo|paywall)',
    caseSensitive: false,
  );
  for (final el in doc.querySelectorAll('[class], [id]').toList()) {
    final cls = el.attributes['class'] ?? '';
    final id = el.attributes['id'] ?? '';
    if (junkRe.hasMatch(cls) || junkRe.hasMatch(id)) {
      // Keep large article-like nodes even if class mentions "share".
      if (el.localName == 'article' || el.localName == 'main') continue;
      if (el.text.trim().length > 1200) continue;
      el.remove();
    }
  }
}

/// Readability-like extraction: score candidates by paragraph density and link sparsity.
String extractReadableTextFromHtml(String html) {
  final doc = parse(html);
  _stripBoilerplate(doc);

  final candidates = <Element>[];
  for (final sel in ['article', 'main', '[role="main"]']) {
    candidates.addAll(doc.querySelectorAll(sel));
  }
  for (final el in doc.querySelectorAll('div, section')) {
    final text = el.text.trim();
    if (text.length >= 280) candidates.add(el);
  }
  if (doc.body != null) candidates.add(doc.body!);

  Element? best;
  var bestScore = -1e9;
  for (final el in candidates) {
    final text = _textFromElementPreferringParagraphs(el);
    if (text.length < 80) continue;
    final paras = el.querySelectorAll('p').where((p) => p.text.trim().length >= 40).length;
    final density = _linkDensity(el);
    final score = text.length * 0.15 + paras * 120 - density * 800;
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }

  if (best != null) {
    return _textFromElementPreferringParagraphs(best);
  }
  return _normalizeBodyText(doc.body?.text ?? '');
}

/// Classify extraction completeness. Never promotes title into body.
String classifyContentStatus({
  required String title,
  required String bodyText,
  required String description,
}) {
  final body = bodyText.trim();
  if (body.isEmpty) {
    final desc = description.trim();
    if (desc.isNotEmpty && !_titleEcho(desc, title) && desc.length >= 40) {
      return 'partial';
    }
    return 'unavailable';
  }
  if (_titleEcho(body, title)) return 'unavailable';
  if (body.length >= 400) return 'complete';
  if (body.length >= 80) return 'partial';
  return 'partial';
}

ArticlePayload _unavailablePayload({
  required String url,
  String sourceUrl = '',
  String title = '',
  String image = '',
  String source = '',
  String description = '',
  String error = '',
}) {
  return {
    'url': url,
    'sourceUrl': sourceUrl.isNotEmpty ? sourceUrl : url,
    'title': title,
    'image': image,
    'imageUrl': image,
    'source': source,
    'publishedAt': '',
    'description': description,
    'bodyText': '',
    'text': '',
    'contentStatus': 'unavailable',
    'extractionError': error,
  };
}

Future<http.Response> fetchArticleHtml(String url) {
  return http.get(
    Uri.parse(url),
    headers: {
      'User-Agent': _userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  ).timeout(const Duration(seconds: 25));
}

/// Port of handleArticleExtract — returns structured contentStatus / bodyText.
Future<ArticlePayload> extractArticleFromUrl(String rawUrl) async {
  final resolved = decodeMaybeWrappedNewsUrl(rawUrl);
  if (resolved.isEmpty || !RegExp(r'^https?://', caseSensitive: false).hasMatch(resolved)) {
    throw ArgumentError('Missing or invalid url');
  }

  final cached = _cacheGet(resolved);
  if (cached != null) return cached;

  // Prefer structured Google News article-id decode before fetching the shell page.
  var fetchUrl = resolved;
  if (isGoogleNewsArticleUrl(resolved)) {
    final decoded = decodeGoogleNewsArticleIdUrl(resolved);
    if (decoded != null && decoded.isNotEmpty && !isBlockedOutboundHost(decoded)) {
      fetchUrl = decoded;
    }
  }

  http.Response response;
  try {
    response = await fetchArticleHtml(fetchUrl);
  } catch (e) {
    final payload = _unavailablePayload(
      url: resolved,
      sourceUrl: fetchUrl,
      error: 'fetch_failed: timeout or network error',
    );
    _cachePut(resolved, payload);
    return payload;
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    final payload = _unavailablePayload(
      url: resolved,
      sourceUrl: fetchUrl,
      error: 'Could not fetch article (${response.statusCode})',
    );
    _cachePut(resolved, payload);
    return payload;
  }

  final contentType = response.headers['content-type'] ?? '';
  if (contentType.isNotEmpty &&
      !contentType.toLowerCase().contains('html') &&
      !contentType.toLowerCase().contains('xml') &&
      !contentType.toLowerCase().contains('text/plain')) {
    final payload = _unavailablePayload(
      url: resolved,
      sourceUrl: fetchUrl,
      error: 'unsupported_content_type',
    );
    _cachePut(resolved, payload);
    return payload;
  }

  var finalUrl = response.request?.url.toString() ?? fetchUrl;
  var html = response.body;

  if (isGoogleNewsArticleUrl(finalUrl)) {
    final publisher = decodeGoogleNewsArticleIdUrl(finalUrl) ??
        extractLikelyPublisherUrlFromGoogleNewsPageHtml(html);
    if (publisher != null && publisher != finalUrl && !isBlockedOutboundHost(publisher)) {
      try {
        final pubRes = await fetchArticleHtml(publisher);
        if (pubRes.statusCode >= 200 && pubRes.statusCode < 300) {
          finalUrl = pubRes.request?.url.toString() ?? publisher;
          html = pubRes.body;
        }
      } catch (_) {
        // keep shell HTML
      }
    }
  }

  if (isBlockedOutboundHost(finalUrl) && isGoogleNewsArticleUrl(finalUrl)) {
    final payload = _unavailablePayload(
      url: resolved,
      sourceUrl: finalUrl,
      error: 'google_news_publisher_unresolved',
    );
    _cachePut(resolved, payload);
    return payload;
  }

  final doc = parse(html);
  final title = pickMetaContent(doc, [
        'meta[property="og:title"]',
        'meta[name="twitter:title"]',
      ]).isNotEmpty
      ? pickMetaContent(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]'])
      : (doc.querySelector('h1')?.text.trim().isNotEmpty == true
          ? doc.querySelector('h1')!.text.trim()
          : doc.querySelector('title')?.text.trim() ?? '');

  final image = pickMetaContent(doc, [
    'meta[property="og:image"]',
    'meta[property="og:image:url"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]',
  ]);

  final description = pickMetaContent(doc, [
    'meta[property="og:description"]',
    'meta[name="description"]',
    'meta[name="twitter:description"]',
  ]);

  var bodyText = cleanArticleText(extractReadableTextFromHtml(html));
  // Never silently replace missing body with title.
  if (_titleEcho(bodyText, title)) {
    bodyText = '';
  }

  var source = '';
  try {
    source = Uri.parse(finalUrl).host.replaceFirst(RegExp(r'^www\.'), '');
  } catch (_) {
    // ignore
  }

  final status = classifyContentStatus(
    title: title,
    bodyText: bodyText,
    description: description,
  );

  // For partial: allow meta description as short description only; body stays real body.
  final effectiveBody = bodyText;
  String extractionError = '';
  if (status == 'unavailable') {
    extractionError = bodyText.isEmpty
        ? 'body_unavailable_or_blocked'
        : 'body_echoes_title';
  }

  final payload = <String, String>{
    'url': resolved,
    'sourceUrl': finalUrl,
    'title': title,
    'image': image,
    'imageUrl': image,
    'source': source,
    'publishedAt': '',
    'description': description,
    'bodyText': effectiveBody,
    'text': effectiveBody,
    'contentStatus': status,
    'extractionError': extractionError,
  };

  // Also cache under final publisher URL for reuse.
  _cachePut(resolved, payload);
  if (finalUrl != resolved) _cachePut(finalUrl, payload);
  return payload;
}

class ArticleFetchException implements Exception {
  ArticleFetchException(this.message);
  final String message;
  @override
  String toString() => message;
}
