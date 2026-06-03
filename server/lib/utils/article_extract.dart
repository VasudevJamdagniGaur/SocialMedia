import 'package:html/dom.dart';
import 'package:html/parser.dart' show parse;
import 'package:http/http.dart' as http;

const _userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

/// Normalized article payload for share generation.
typedef ArticlePayload = Map<String, String>;

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
    if (h.endsWith('google.com') || h == 'gstatic.com' || h.endsWith('.gstatic.com')) {
      return true;
    }
    return false;
  } catch (_) {
    return true;
  }
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

String extractReadableTextFromHtml(String html) {
  final doc = parse(html);
  for (final tag in ['script', 'style', 'noscript', 'svg', 'nav', 'header', 'footer', 'aside', 'form']) {
    for (final el in doc.querySelectorAll(tag).toList()) {
      el.remove();
    }
  }

  final candidates = [
    doc.querySelector('article'),
    doc.querySelector('main'),
    doc.querySelector('[role="main"]'),
    doc.body,
  ];
  for (final el in candidates) {
    if (el == null) continue;
    final text = _normalizeBodyText(el.text);
    if (text.length >= 200) return text;
  }
  return _normalizeBodyText(doc.body?.text ?? '');
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

/// Port of handleArticleExtract in legacy functions/src/index.ts.
Future<ArticlePayload> extractArticleFromUrl(String rawUrl) async {
  final resolved = decodeMaybeWrappedNewsUrl(rawUrl);
  if (resolved.isEmpty || !RegExp(r'^https?://', caseSensitive: false).hasMatch(resolved)) {
    throw ArgumentError('Missing or invalid url');
  }

  final response = await fetchArticleHtml(resolved);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw ArticleFetchException('Could not fetch article (${response.statusCode})');
  }

  var finalUrl = response.request?.url.toString() ?? resolved;
  var html = response.body;

  if (isGoogleNewsArticleUrl(finalUrl)) {
    final publisher = extractLikelyPublisherUrlFromGoogleNewsPageHtml(html);
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

  final text = cleanArticleText(extractReadableTextFromHtml(html));

  var source = '';
  try {
    source = Uri.parse(finalUrl).host.replaceFirst(RegExp(r'^www\.'), '');
  } catch (_) {
    // ignore
  }

  return {
    'url': resolved,
    'sourceUrl': finalUrl,
    'title': title,
    'image': image,
    'text': text,
    'source': source,
    'description': description,
  };
}

class ArticleFetchException implements Exception {
  ArticleFetchException(this.message);
  final String message;
  @override
  String toString() => message;
}
