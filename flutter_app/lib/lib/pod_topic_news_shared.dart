import 'dart:async';
import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import '../components/hub_theme.dart';
import '../config/env.dart';
import '../utils/decode_google_news_url.dart';

export '../utils/decode_google_news_url.dart' show decodeGoogleNewsUrl;

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/// Normalized news row used across hub / pod feeds.
class NewsArticle {
  const NewsArticle({
    required this.title,
    required this.source,
    required this.url,
    this.image,
    this.description = '',
    this.publishedAt,
    this.sourceSiteUrl = '',
    this.publisherUrl = '',
    this.trendingScore,
    this.exploreTopic,
    this.firestoreId,
  });

  final String title;
  final String source;
  final String url;
  final String? image;
  final String description;
  final String? publishedAt;
  final String sourceSiteUrl;
  final String publisherUrl;
  final num? trendingScore;
  final String? exploreTopic;
  final String? firestoreId;

  Map<String, dynamic> toMap() => {
        'title': title,
        'source': source,
        'url': url,
        'image': image,
        'description': description,
        'publishedAt': publishedAt,
        'sourceSiteUrl': sourceSiteUrl,
        'publisherUrl': publisherUrl,
        if (exploreTopic != null) 'exploreTopic': exploreTopic,
        if (firestoreId != null) 'firestoreId': firestoreId,
      };

  factory NewsArticle.fromNormalized(Map<String, dynamic> m) => NewsArticle(
        title: '${m['title'] ?? ''}',
        source: '${m['source'] ?? 'News'}',
        url: '${m['url'] ?? ''}',
        image: m['image'] is String ? m['image'] as String : null,
        description: '${m['description'] ?? ''}',
        publishedAt: m['publishedAt'] != null ? '${m['publishedAt']}' : null,
        sourceSiteUrl: '${m['sourceSiteUrl'] ?? ''}',
        publisherUrl: '${m['publisherUrl'] ?? ''}',
        trendingScore: m['trendingScore'] as num?,
        firestoreId: m['firestoreId'] != null ? '${m['firestoreId']}' : (m['id'] != null ? '${m['id']}' : null),
      );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

final String _newsFallbackImageUrl =
    'data:image/svg+xml;charset=utf-8,${Uri.encodeComponent('''<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop stop-color="#0b1220"/><stop offset="1" stop-color="#111827"/>
        </linearGradient>
        <filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values=".2"/><feComponentTransfer><feFuncA type="table" tableValues="0 0.22"/></feComponentTransfer></filter>
      </defs>
      <rect width="300" height="300" rx="24" fill="url(#g)"/>
      <rect width="300" height="300" rx="24" filter="url(#n)" opacity=".35"/>
      <g fill="none" stroke="#94a3b8" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity=".9">
        <path d="M86 206l36-38 32 28 22-22 38 32"/>
        <rect x="78" y="92" width="144" height="126" rx="18"/>
        <circle cx="124" cy="130" r="10" fill="#94a3b8" stroke="none"/>
      </g>
    </svg>''')}';

const String _newsApiV2 = 'https://newsapi.org/v2';
const String _newsApiUserAgent = 'DeiteNews/1.0 (+https://deitedatabase.web.app)';
const String _newsApiCooldownKey = 'deite_newsapi_cooldown_until';
const String podTrendingCountryStorage = 'podTrendingNewsCountry';

/// Alias matching JS constant name.
const String POD_TRENDING_COUNTRY_STORAGE = podTrendingCountryStorage;

const int _newsApiRateLimitCooldownMs = 90 * 1000;
const int _newsApiQuotaCooldownMs = 30 * 60 * 1000;
const int _newsApi429RetryMs = 1600;

int _newsApiRateLimitCooldownUntil = 0;
bool _cooldownLoaded = false;

/// Lowercase ISO codes accepted by NewsAPI top-headlines `country`.
const Set<String> newsapiTopHeadlinesCountries = {
  'ae',
  'ar',
  'at',
  'au',
  'be',
  'bg',
  'br',
  'ca',
  'ch',
  'cn',
  'co',
  'cu',
  'cz',
  'de',
  'eg',
  'fr',
  'gb',
  'gr',
  'hk',
  'hu',
  'id',
  'ie',
  'il',
  'in',
  'it',
  'jp',
  'kr',
  'lt',
  'lv',
  'ma',
  'mx',
  'my',
  'ng',
  'nl',
  'no',
  'nz',
  'ph',
  'pl',
  'pt',
  'ro',
  'rs',
  'ru',
  'sa',
  'se',
  'sg',
  'si',
  'sk',
  'th',
  'tr',
  'tw',
  'ua',
  'us',
  've',
  'za',
};

/// Alias matching JS export name.
const Set<String> NEWSAPI_TOP_HEADLINES_COUNTRIES = newsapiTopHeadlinesCountries;

const Map<String, String> _regionLabels = {
  'ae': 'United Arab Emirates',
  'ar': 'Argentina',
  'at': 'Austria',
  'au': 'Australia',
  'be': 'Belgium',
  'bg': 'Bulgaria',
  'br': 'Brazil',
  'ca': 'Canada',
  'ch': 'Switzerland',
  'cn': 'China',
  'co': 'Colombia',
  'cu': 'Cuba',
  'cz': 'Czech Republic',
  'de': 'Germany',
  'eg': 'Egypt',
  'fr': 'France',
  'gb': 'United Kingdom',
  'gr': 'Greece',
  'hk': 'Hong Kong',
  'hu': 'Hungary',
  'id': 'Indonesia',
  'ie': 'Ireland',
  'il': 'Israel',
  'in': 'India',
  'it': 'Italy',
  'jp': 'Japan',
  'kr': 'South Korea',
  'lt': 'Lithuania',
  'lv': 'Latvia',
  'ma': 'Morocco',
  'mx': 'Mexico',
  'my': 'Malaysia',
  'ng': 'Nigeria',
  'nl': 'Netherlands',
  'no': 'Norway',
  'nz': 'New Zealand',
  'ph': 'Philippines',
  'pl': 'Poland',
  'pt': 'Portugal',
  'ro': 'Romania',
  'rs': 'Serbia',
  'ru': 'Russia',
  'sa': 'Saudi Arabia',
  'se': 'Sweden',
  'sg': 'Singapore',
  'si': 'Slovenia',
  'sk': 'Slovakia',
  'th': 'Thailand',
  'tr': 'Turkey',
  'tw': 'Taiwan',
  'ua': 'Ukraine',
  'us': 'United States',
  've': 'Venezuela',
  'za': 'South Africa',
};

// ---------------------------------------------------------------------------
// Public URL helpers
// ---------------------------------------------------------------------------

String googleNewsSearchUrl(String? query) {
  final q = (query ?? 'news').trim();
  final effective = q.isEmpty ? 'news' : q;
  return 'https://news.google.com/search?q=${Uri.encodeComponent(effective)}&hl=en&gl=US&ceid=US:en';
}

String buildGoogleNewsRssUrl(String searchQuery) {
  return 'https://news.google.com/rss/search?q=${Uri.encodeComponent(searchQuery)}&hl=en-US&gl=US&ceid=US:en';
}

String getNewsApiKey() => Env.newsApiKey.trim();

// ---------------------------------------------------------------------------
// HTML / entity helpers
// ---------------------------------------------------------------------------

String decodeBasicHtmlEntities(String? str) {
  if (str == null || str.isEmpty) return str ?? '';
  return str
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&apos;', "'")
      .replaceAll('&nbsp;', ' ');
}

bool isBadHeroImageUrl(String? url) {
  if (url == null || url.isEmpty) return true;
  return url.trim().toLowerCase().startsWith('data:');
}

// ---------------------------------------------------------------------------
// Cooldown / rate limit
// ---------------------------------------------------------------------------

Future<void> _ensureCooldownLoaded() async {
  if (_cooldownLoaded) return;
  _cooldownLoaded = true;
  try {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_newsApiCooldownKey);
    _newsApiRateLimitCooldownUntil = 0;
  } catch (_) {
    /* private mode */
  }
}

Future<void> _setNewsApiCooldownUntil(int ts) async {
  _newsApiRateLimitCooldownUntil = ts;
  try {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(_newsApiCooldownKey, ts);
  } catch (_) {
    /* ignore */
  }
}

bool isNewsApiRateLimitedCooldown() {
  unawaited(_ensureCooldownLoaded());
  return DateTime.now().millisecondsSinceEpoch < _newsApiRateLimitCooldownUntil;
}

bool _isNewsApiRateLimitedJsonResponse(Map<String, dynamic>? jr) {
  if (jr == null) return false;
  final data = jr['data'];
  final code = data is Map ? '${data['code'] ?? ''}' : '';
  final status = jr['status'];
  return status == 429 || code == 'rateLimited';
}

Future<void> _applyNewsApiRateLimitSignal(Map<String, dynamic>? jr) async {
  if (!_isNewsApiRateLimitedJsonResponse(jr)) return;
  final data = jr!['data'];
  final code = data is Map ? '${data['code'] ?? ''}' : '';
  final ms = code == 'rateLimited' ? _newsApiQuotaCooldownMs : _newsApiRateLimitCooldownMs;
  await _setNewsApiCooldownUntil(DateTime.now().millisecondsSinceEpoch + ms);
}

bool canFetchLiveNews() => true;

// ---------------------------------------------------------------------------
// Region resolution
// ---------------------------------------------------------------------------

String _regionLabelFromCountryCode(String? code) {
  final c = (code ?? '').toUpperCase();
  if (c.length != 2) return 'your area';
  return _regionLabels[c.toLowerCase()] ?? c;
}

String? _countryCodeFromPlatformLocales() {
  for (final locale in ui.PlatformDispatcher.instance.locales) {
    final candidate = locale.countryCode?.toLowerCase();
    if (candidate != null && newsapiTopHeadlinesCountries.contains(candidate)) {
      return candidate;
    }
  }
  return null;
}

Future<Map<String, dynamic>> resolveUserNewsRegionForNewsApi() async {
  try {
    final prefs = await SharedPreferences.getInstance();
    final stored = prefs.getString(podTrendingCountryStorage)?.trim().toLowerCase();
    if (stored != null && newsapiTopHeadlinesCountries.contains(stored)) {
      return {'code': stored, 'label': _regionLabelFromCountryCode(stored), 'city': null};
    }
  } catch (_) {
    /* private mode */
  }

  try {
    final res = await http
        .get(Uri.parse('https://ipapi.co/json/'))
        .timeout(const Duration(seconds: 5));
    if (res.statusCode == 200) {
      final data = jsonDecode(res.body);
      if (data is Map) {
        final c = '${data['country_code'] ?? ''}'.toLowerCase();
        if (c.isNotEmpty && newsapiTopHeadlinesCountries.contains(c)) {
          final nameRaw = data['country_name'];
          final name = nameRaw is String && nameRaw.trim().isNotEmpty
              ? nameRaw.trim()
              : _regionLabelFromCountryCode(c);
          final cityRaw = data['city'];
          final city = cityRaw is String ? cityRaw.trim() : '';
          return {'code': c, 'label': name, 'city': city.isEmpty ? null : city};
        }
      }
    }
  } catch (_) {
    /* offline / adblock / CORS */
  }

  final fromLang = _countryCodeFromPlatformLocales();
  if (fromLang != null) {
    return {'code': fromLang, 'label': _regionLabelFromCountryCode(fromLang), 'city': null};
  }

  return {'code': 'us', 'label': _regionLabelFromCountryCode('us'), 'city': null};
}

Future<String> resolveUserCityFromIp() async {
  try {
    final res = await http
        .get(Uri.parse('https://ipapi.co/json/'))
        .timeout(const Duration(seconds: 5));
    if (res.statusCode == 200) {
      final data = jsonDecode(res.body);
      if (data is Map) {
        final city = data['city'];
        if (city is String && city.trim().isNotEmpty) return city.trim();
      }
    }
  } catch (_) {
    /* ignore */
  }
  return '';
}

// ---------------------------------------------------------------------------
// India local filter
// ---------------------------------------------------------------------------

List<Map<String, dynamic>> filterNewsRowsIndiaLocal(List<Map<String, dynamic>> rows) {
  if (rows.isEmpty) return rows;
  final indiaSignal = RegExp(
    r'\bIndia\b|\bIndian\b|\bBharat\b|Rs\.?\s*\d[\d,]*|â‚¹|\bcrore\b|\blakh\b|\bNSE\b|\bBSE\b|\bSEBI\b|Startup India|Mumbai|Delhi|Bengaluru|Bangalore|Hyderabad|Pune|Chennai|Kolkata|Ahmedabad|Gurugram|Gurgaon|Noida|Kochi|Jaipur|Indore|Lucknow|Vadodara|Chandigarh',
    caseSensitive: false,
  );
  final neighborLean = RegExp(
    r'\bNepal\b|\bNepalese\b|\bKathmandu\b|\bBangladesh\b|\bDhaka\b|\bSri Lanka\b|\bColombo\b|\bPakistan\b|\bKarachi\b|\bLahore\b|\bIslamabad\b',
    caseSensitive: false,
  );
  return rows.where((r) {
    final blob = '${r['title'] ?? ''} ${r['description'] ?? ''}';
    if (blob.trim().isEmpty) return false;
    if (neighborLean.hasMatch(blob) && !indiaSignal.hasMatch(blob)) return false;
    return indiaSignal.hasMatch(blob);
  }).toList();
}

// ---------------------------------------------------------------------------
// Internal URL / image helpers
// ---------------------------------------------------------------------------

String _ensureNonEmptyImageUrl(String? url) {
  final u = (url ?? '').trim();
  if (RegExp(r'^https?:\/\/lh[0-9]\.googleusercontent\.com\/.+(?:=s0-w|s0-w)\d+', caseSensitive: false)
      .hasMatch(u)) {
    return _newsFallbackImageUrl;
  }
  return u.isEmpty ? _newsFallbackImageUrl : u;
}

String _escapeRegExp(String s) => s.replaceAllMapped(RegExp(r'[.*+?^${}()|[\]\\]'), (m) => '\\${m[0]}');

String? _decodeMetaUrl(String? raw) {
  if (raw == null || raw.isEmpty) return null;
  var u = raw.trim().replaceAll('&amp;', '&').replaceAll('&quot;', '"');
  if (u.startsWith('//')) u = 'https:$u';
  return RegExp(r'^https?://', caseSensitive: false).hasMatch(u) ? u : null;
}

bool _isBlockedOutboundHost(String url) {
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

bool _isGoogleNewsArticleUrl(String url) {
  return RegExp(r'news\.google\.com/(rss/)?articles/', caseSensitive: false).hasMatch(url);
}

bool _looksLikeImageAssetUrl(String url) {
  if (url.isEmpty) return false;
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

String? _decodeGoogleWrappedUrl(String href) {
  try {
    final u = Uri.parse(href);
    final inner = u.queryParameters['url'] ?? u.queryParameters['q'];
    if (inner != null &&
        RegExp(r'^https?://', caseSensitive: false).hasMatch(inner) &&
        !_isBlockedOutboundHost(inner)) {
      return inner;
    }
    final m = RegExp(r'[?&](?:url|q)=(https%3A%2F%2F[^&]+)', caseSensitive: false).firstMatch(href);
    if (m != null) {
      final decoded = Uri.decodeComponent(m.group(1)!);
      if (RegExp(r'^https?://', caseSensitive: false).hasMatch(decoded) &&
          !_isBlockedOutboundHost(decoded)) {
        return decoded;
      }
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

bool _looksLikeGoogleNewsBrandingThumb(String? url) {
  if (url == null || url.isEmpty) return false;
  final s = url.toLowerCase();
  if (!s.contains('googleusercontent.com')) return false;
  String host;
  try {
    host = Uri.parse(url).host.toLowerCase();
  } catch (_) {
    return false;
  }
  if (!RegExp(r'^lh[0-9]\.googleusercontent\.com$').hasMatch(host) &&
      !host.contains('lh3.googleusercontent.com')) {
    return false;
  }
  if (s.contains('s0-w') || s.contains('=s0-w')) return true;
  return false;
}

String? _firstImageUrlFromHtml(String? html) {
  if (html == null || html.isEmpty) return null;
  final candidates = <String>{};
  final absRe = RegExp(r'''src=["'](https?://[^"'>\s]+)["']''', caseSensitive: false);
  final protoRe = RegExp(r'''src=["'](//[^"'>\s]+)["']''', caseSensitive: false);

  for (final m in absRe.allMatches(html)) {
    if (m.group(1) != null) candidates.add(m.group(1)!);
  }
  for (final m in protoRe.allMatches(html)) {
    if (m.group(1) != null) candidates.add('https:${m.group(1)!}');
  }

  if (candidates.isEmpty) {
    final abs = RegExp(r'''src=["'](https?:[^"'>\s]+)["']''', caseSensitive: false).firstMatch(html);
    if (abs?.group(1) != null &&
        RegExp(r'^https?://', caseSensitive: false).hasMatch(abs!.group(1)!)) {
      return abs.group(1);
    }
    final proto = RegExp(r'''src=["'](//[^"'>\s]+)["']''', caseSensitive: false).firstMatch(html);
    if (proto?.group(1) != null) return 'https:${proto!.group(1)!}';
    return null;
  }

  int score(String url) {
    final s = url.toLowerCase();
    final w = RegExp(r'(?:s0-w|=s0-w)(\d+)', caseSensitive: false).firstMatch(s)?.group(1);
    final wi = w != null ? int.tryParse(w) : null;
    if (wi != null) return wi;
    if (RegExp(r'\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?.*)?$', caseSensitive: false).hasMatch(s)) {
      return 1000;
    }
    return s.length;
  }

  String? best;
  var bestScore = -999999999;
  String? bestNonBad;
  var bestNonBadScore = -999999999;

  for (final u in candidates) {
    final sc = score(u);
    if (sc > bestScore) {
      best = u;
      bestScore = sc;
    }
    if (!isBadHeroImageUrl(u) && sc > bestNonBadScore) {
      bestNonBad = u;
      bestNonBadScore = sc;
    }
  }

  return bestNonBad ?? best;
}

String? _extractPublisherUrlFromRssItemHtml(String? html) {
  if (html == null || html.isEmpty) return null;
  final candidates = <String>{};

  final reA = RegExp(r'''<a[^>]+href=["'](https?://[^"']+)["']''', caseSensitive: false);
  for (final m in reA.allMatches(html)) {
    if (m.group(1) != null) candidates.add(m.group(1)!);
  }

  final reWrapped = RegExp(
    r'''https?://[^"'\s<>]+(?:[?&](?:url|q)=(?:https%3A%2F%2F|http%3A%2F%2F)[^&"'\s<>]+)[^"'\s<>]*''',
    caseSensitive: false,
  );
  for (final m in reWrapped.allMatches(html)) {
    candidates.add(m.group(0)!);
  }

  String? best;
  var bestScore = 0;
  for (final rawHref in candidates) {
    var u = _decodeMetaUrl(rawHref);
    final unwrapped = _decodeGoogleWrappedUrl(u ?? '');
    if (unwrapped != null) u = unwrapped;
    if (u == null) continue;
    if (_isBlockedOutboundHost(u)) continue;
    if (_looksLikeImageAssetUrl(u)) continue;
    try {
      final p = Uri.parse(u);
      final sc = p.path.length + (p.query.isNotEmpty ? 8 : 0);
      if (sc > bestScore) {
        bestScore = sc;
        best = u;
      }
    } catch (_) {
      /* skip */
    }
  }
  return best;
}

String _cleanPublisherSuffixFromTitle(String rawTitle, String sourceName) {
  final t = rawTitle.replaceAll(RegExp(r'\s+'), ' ').trim();
  final s = sourceName.replaceAll(RegExp(r'\s+'), ' ').trim();
  if (t.isEmpty || s.isEmpty) return decodeBasicHtmlEntities(t);
  final re = RegExp('\\s*[-â€“â€”|]\\s*${_escapeRegExp(s)}\\s*\$', caseSensitive: false);
  final cut = t.replaceAll(re, '').trim();
  final out = cut.length >= 12 ? cut : t;
  return decodeBasicHtmlEntities(out);
}

String _normalizeSourceLabel(String? rawSource) {
  final s = (rawSource ?? '').replaceAll(RegExp(r'\s+'), ' ').trim();
  if (s.isEmpty) return 'News';
  if (RegExp(r'google news', caseSensitive: false).hasMatch(s)) return 'Google News';
  if (RegExp(r'^".+"\s*-\s*google news$', caseSensitive: false).hasMatch(s)) {
    return 'Google News';
  }
  return s;
}

String? _parseRssPubDate(String? pubDateStr) {
  if (pubDateStr == null || pubDateStr.isEmpty) return null;
  final d = DateTime.tryParse(pubDateStr);
  if (d != null) return d.toUtc().toIso8601String();
  for (final pattern in [
    'EEE, dd MMM yyyy HH:mm:ss z',
    'EEE, dd MMM yyyy HH:mm:ss Z',
    'EEE, dd MMM yyyy HH:mm:ss',
  ]) {
    try {
      return DateFormat(pattern, 'en_US').parseUtc(pubDateStr).toIso8601String();
    } catch (_) {
      try {
        return DateFormat(pattern, 'en_US').parse(pubDateStr).toUtc().toIso8601String();
      } catch (_) {
        /* try next pattern */
      }
    }
  }
  return null;
}

String _unwrapCdata(String s) {
  return s.replaceAllMapped(
    RegExp(r'<!\[CDATA\[([\s\S]*?)\]\]>', caseSensitive: false),
    (m) => m.group(1) ?? '',
  );
}

String? _xmlTagRaw(String block, String tag) {
  final m = RegExp('<$tag[^>]*>([\\s\\S]*?)</$tag>', caseSensitive: false).firstMatch(block);
  if (m == null) return null;
  return _unwrapCdata(m.group(1) ?? '').trim();
}

String? _xmlTagText(String block, String tag) {
  final raw = _xmlTagRaw(block, tag);
  if (raw == null) return null;
  return raw.replaceAll(RegExp(r'<[^>]*>'), ' ').replaceAll(RegExp(r'\s+'), ' ').trim();
}

String? _xmlSourceUrl(String block) {
  final m = RegExp('<source[^>]*url=["\']([^"\']+)["\']', caseSensitive: false).firstMatch(block);
  return m?.group(1)?.trim();
}

List<Map<String, dynamic>> _parseGoogleNewsRssXml(String xml) {
  if (xml.isEmpty || !xml.contains('<item')) return [];
  final out = <Map<String, dynamic>>[];
  final itemRe = RegExp(r'<item[^>]*>([\s\S]*?)</item>', caseSensitive: false);

  for (final match in itemRe.allMatches(xml)) {
    final block = match.group(1)!;
    final rawTitle = _xmlTagText(block, 'title');
    var link = _xmlTagText(block, 'link');
    if (link == null || link.isEmpty) {
      final linkAttr = RegExp(r'''<link[^>]*href=["']([^"']+)["']''', caseSensitive: false)
          .firstMatch(block);
      link = linkAttr?.group(1)?.trim() ?? _xmlTagText(block, 'guid');
    }
    if (rawTitle == null || rawTitle.isEmpty || link == null || link.isEmpty) continue;

    final source = _normalizeSourceLabel(_xmlTagText(block, 'source') ?? 'Google News');
    final sourceSiteUrl = _xmlSourceUrl(block) ?? '';
    final pubDateRaw = _xmlTagText(block, 'pubDate');
    final publishedAt = _parseRssPubDate(pubDateRaw);
    final rawDesc = _xmlTagRaw(block, 'description') ?? '';
    final description =
        rawDesc.replaceAll(RegExp(r'<[^>]*>'), ' ').replaceAll(RegExp(r'\s+'), ' ').trim();
    var image = _firstImageUrlFromHtml(rawDesc);
    final publisherUrl = _extractPublisherUrlFromRssItemHtml(rawDesc);
    final decoded = _isGoogleNewsArticleUrl(link) ? decodeGoogleNewsUrl(link) : null;
    final finalUrl = decoded ?? publisherUrl ?? link;
    final title = _cleanPublisherSuffixFromTitle(rawTitle, source);

    out.add({
      'title': title,
      'source': source,
      'url': finalUrl,
      'image': image,
      'description': description,
      'publishedAt': publishedAt,
      'sourceSiteUrl': sourceSiteUrl,
      'publisherUrl': decoded ?? publisherUrl ?? '',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// RSS fetch
// ---------------------------------------------------------------------------

Future<String> _fetchRssXmlViaProxies(String targetUrl) async {
  final attempts = <Future<String> Function()>[
    () async {
      final res = await http.get(
        Uri.parse('https://api.codetabs.com/v1/proxy?quest=${Uri.encodeComponent(targetUrl)}'),
      );
      if (res.statusCode != 200) return '';
      return res.body;
    },
    () async {
      final res = await http.get(Uri.parse('https://corsproxy.io/?${Uri.encodeComponent(targetUrl)}'));
      if (res.statusCode != 200) return '';
      return res.body;
    },
    () async {
      final res = await http.get(
        Uri.parse('https://api.allorigins.win/get?url=${Uri.encodeComponent(targetUrl)}'),
      );
      if (res.statusCode != 200) return '';
      try {
        final data = jsonDecode(res.body);
        if (data is Map && data['contents'] is String) return data['contents'] as String;
      } catch (_) {
        return '';
      }
      return '';
    },
  ];

  for (final run in attempts) {
    try {
      final xml = await run();
      if (xml.isNotEmpty && xml.contains('<item')) return xml;
    } catch (_) {
      /* next proxy */
    }
  }
  return '';
}

Future<List<Map<String, dynamic>>> _fetchItemsThroughRss2Json(String rssUrl) async {
  try {
    final api =
        'https://api.rss2json.com/v1/api.json?rss_url=${Uri.encodeComponent(rssUrl)}';
    final res = await http.get(Uri.parse(api));
    if (res.statusCode != 200) return [];
    final data = jsonDecode(res.body);
    if (data is! Map || data['status'] != 'ok' || data['items'] is! List) return [];

    final feedTitle = data['feed'] is Map ? '${(data['feed'] as Map)['title'] ?? ''}' : '';
    final out = <Map<String, dynamic>>[];

    for (final it in data['items'] as List) {
      if (it is! Map) continue;
      final rawTitle = '${it['title'] ?? ''}'.replaceAll(RegExp(r'\s+'), ' ').trim();
      final url = it['link'] is String ? (it['link'] as String).trim() : '';
      if (rawTitle.isEmpty || url.isEmpty) continue;

      final source = _normalizeSourceLabel('${it['author'] ?? feedTitle}'.trim().isEmpty
          ? 'Google News'
          : '${it['author'] ?? feedTitle}');
      final htmlBlob = [
        it['content'],
        it['description'],
        it['contentSnippet'],
      ].where((e) => e != null && '$e'.isNotEmpty).join(' ');
      final description = '${it['contentSnippet'] ?? ''}'
          .replaceAll(RegExp(r'<[^>]*>'), ' ')
          .replaceAll(RegExp(r'\s+'), ' ')
          .trim();

      String? image;
      final enclosure = it['enclosure'];
      if (enclosure is Map &&
          enclosure['link'] is String &&
          RegExp(r'^https?:', caseSensitive: false).hasMatch('${enclosure['link']}')) {
        image = '${enclosure['link']}';
      }
      image ??= _firstImageUrlFromHtml(htmlBlob);

      final decoded = _isGoogleNewsArticleUrl(url) ? decodeGoogleNewsUrl(url) : null;
      final publisherUrl =
          decoded ?? _extractPublisherUrlFromRssItemHtml(htmlBlob) ?? '';
      final publishedAt = _parseRssPubDate(it['pubDate'] is String ? it['pubDate'] as String : null);
      final title = _cleanPublisherSuffixFromTitle(rawTitle, source);

      out.add({
        'title': title,
        'source': source,
        'url': decoded ?? url,
        'image': image,
        'description': description,
        'publishedAt': publishedAt,
        'sourceSiteUrl': '',
        'publisherUrl': publisherUrl,
      });
    }
    return out;
  } catch (_) {
    return [];
  }
}

Future<List<Map<String, dynamic>>> fetchLiveFromGoogleRssByQuery(String googleRssQuery) async {
  final q = googleRssQuery.trim();
  if (q.isEmpty) return [];
  final rssUrl = buildGoogleNewsRssUrl(q);
  var items = await _fetchItemsThroughRss2Json(rssUrl);
  if (items.isEmpty) {
    final xml = await _fetchRssXmlViaProxies(rssUrl);
    items = _parseGoogleNewsRssXml(xml);
  }
  return items;
}

List<Map<String, dynamic>> normalizeArticles(List<dynamic> list) {
  if (list.isEmpty) return [];
  return list
      .where((a) => a is Map && a['title'] != null)
      .map((a) {
        final m = a as Map;
        final direct = m['url'] is String ? (m['url'] as String).trim() : '';
        final sourceMap = m['source'];
        final source = sourceMap is Map
            ? '${sourceMap['name'] ?? 'News'}'
            : '${m['source'] ?? 'News'}';
        final publishedAt =
            m['publishedAt'] is String && (m['publishedAt'] as String).isNotEmpty
                ? m['publishedAt'] as String
                : null;
        final rawTitle = '${m['title'] ?? ''}';
        var img = m['urlToImage'] ?? _firstImageUrlFromHtml('${m['description'] ?? ''}');
        final pubFromDesc = _extractPublisherUrlFromRssItemHtml('${m['description'] ?? ''}');
        return {
          'title': _cleanPublisherSuffixFromTitle(rawTitle, source),
          'source': source,
          'url': direct.isNotEmpty ? direct : googleNewsSearchUrl(rawTitle),
          'image': img,
          'description': '${m['description'] ?? ''}',
          'publishedAt': publishedAt,
          'sourceSiteUrl': '',
          'publisherUrl': pubFromDesc ?? '',
        };
      })
      .cast<Map<String, dynamic>>()
      .toList();
}

// ---------------------------------------------------------------------------
// NewsAPI proxy chain
// ---------------------------------------------------------------------------

bool _isNativePlatform() {
  if (kIsWeb) return false;
  return defaultTargetPlatform == TargetPlatform.android ||
      defaultTargetPlatform == TargetPlatform.iOS;
}

String _trimOrigin(String u) => u.trim().replaceAll(RegExp(r'/$'), '');

String _getNewsApiFunctionUrl() => Env.newsApiFunctionUrl.trim();

List<String> _getCandidateNewsApiFunctionUrls() {
  final explicit = _getNewsApiFunctionUrl();
  final out = <String>[];
  if (explicit.isNotEmpty) out.add(explicit);
  final pid = Env.firebaseProjectId.trim().isEmpty ? 'deitedatabase' : Env.firebaseProjectId.trim();
  const regions = ['us-central1', 'europe-west1', 'asia-south1', 'asia-east1'];
  for (final r in regions) {
    out.add('https://$r-$pid.cloudfunctions.net/newsApi');
  }
  return out.toSet().toList();
}

bool _shouldProxyNewsApi() {
  if (_isNativePlatform()) return true;
  if (!kIsWeb) return false;
  final o = Uri.base.origin;
  return o.isEmpty ||
      o.contains('localhost') ||
      o.startsWith('capacitor://') ||
      o.startsWith('ionic://') ||
      o.startsWith('file://');
}

bool _allowNewsCorsProxyFallback() {
  if (_isNativePlatform()) return true;
  if (_shouldProxyNewsApi()) return true;
  return Env.newsApiForceCorsProxy.trim() == '1';
}

bool _isFirebaseNewsHostingHostname(String hostname) {
  final h = hostname.toLowerCase();
  if (h.isEmpty) return false;
  if (h == 'deitedatabase.web.app' || h == 'deitedatabase.firebaseapp.com') return true;
  final envOrigin = _trimOrigin(Env.newsProxyOrigin);
  if (envOrigin.isEmpty) return false;
  try {
    return Uri.parse(envOrigin).host.toLowerCase() == h;
  } catch (_) {
    return false;
  }
}

List<String> _getFirebaseHostingApiBases({bool forBrowserNewsProxy = false}) {
  final envOrigin = _trimOrigin(Env.newsProxyOrigin);
  const defaultBases = [
    'https://deitedatabase.web.app',
    'https://deitedatabase.firebaseapp.com',
  ];
  final basesFromEnv = envOrigin.isNotEmpty
      ? [envOrigin, ...defaultBases.where((b) => b != envOrigin)]
      : defaultBases.toList();

  if (_isNativePlatform()) return basesFromEnv;

  final origin = kIsWeb ? Uri.base.origin : '';
  final list = <String>[];
  final trimmedOrigin =
      origin.isNotEmpty && RegExp(r'^https?://', caseSensitive: false).hasMatch(origin)
          ? _trimOrigin(origin)
          : '';

  if (trimmedOrigin.isNotEmpty) list.add(trimmedOrigin);

  if (forBrowserNewsProxy && list.isNotEmpty) {
    try {
      final host = Uri.parse(trimmedOrigin).host;
      if (!_isFirebaseNewsHostingHostname(host)) return list;
    } catch (_) {
      return list;
    }
  }

  if (list.isEmpty) return basesFromEnv.isNotEmpty ? basesFromEnv : [];

  for (final b in basesFromEnv) {
    if (!list.contains(b)) list.add(b);
  }
  return list;
}

Future<Map<String, dynamic>> _fetchJsonMaybeNative(String url, {required int timeoutMs}) async {
  final uri = Uri.parse(url);
  try {
    final res = await http
        .get(
          uri,
          headers: {'Accept': 'application/json', 'User-Agent': _newsApiUserAgent},
        )
        .timeout(Duration(milliseconds: timeoutMs));

    dynamic data;
    try {
      data = jsonDecode(res.body);
    } catch (_) {
      data = null;
    }

    return {
      'status': res.statusCode,
      'ok': res.statusCode >= 200 && res.statusCode < 300,
      'data': data,
      'headers': {'content-type': res.headers['content-type'] ?? ''},
    };
  } catch (_) {
    return {'status': 0, 'ok': false, 'data': null, 'headers': {}};
  }
}

Future<Map<String, dynamic>> fetchJsonGet(String url, {int timeoutMs = 15000}) async {
  final raw = url.trim();
  const redditWorldnewsUpstream =
      'https://www.reddit.com/r/WorldNewsHeadlines/hot.json?limit=45&raw_json=1';
  final backendBase = _trimOrigin(Env.baseUrl);
  final redditWorldnewsProxy = '$backendBase/api/news';

  final resolvedUrl = raw == redditWorldnewsUpstream ? redditWorldnewsProxy : url;
  return _fetchJsonMaybeNative(resolvedUrl, timeoutMs: timeoutMs);
}

Future<List<Map<String, dynamic>>?> _fetchNewsApiDirectFromEnv(
  String endpoint,
  Map<String, String> baseParams,
) async {
  final apiKey = getNewsApiKey();
  if (apiKey.isEmpty) return null;

  final params = Map<String, String>.from(baseParams)..['apiKey'] = apiKey;
  final url = '$_newsApiV2/$endpoint?${Uri(queryParameters: params).query}';

  try {
    final jr = await _fetchJsonMaybeNative(url, timeoutMs: 12000);
    final data = jr['data'];
    await _applyNewsApiRateLimitSignal(jr);

    if (jr['ok'] == true &&
        data is Map &&
        data['status'] == 'ok' &&
        data['articles'] is List &&
        (data['articles'] as List).isNotEmpty) {
      return (data['articles'] as List).cast<Map<String, dynamic>>();
    }
    return null;
  } catch (_) {
    return null;
  }
}

Future<List<Map<String, dynamic>>?> _fetchNewsApiThroughProxy(
  String endpoint,
  Map<String, String> baseParams,
) async {
  final p = Map<String, String>.from(baseParams)..remove('apiKey');
  p['endpoint'] = endpoint;

  for (final base in _getFirebaseHostingApiBases(forBrowserNewsProxy: true)) {
    try {
      final url = '$base/api/news/$endpoint?${Uri(queryParameters: p).query}';
      var jr = await _fetchJsonMaybeNative(url, timeoutMs: 12000);
      var data = jr['data'];
      final quotaLimited = data is Map && data['code'] == 'rateLimited';
      if (_isNewsApiRateLimitedJsonResponse(jr) && !quotaLimited) {
        await Future<void>.delayed(const Duration(milliseconds: _newsApi429RetryMs));
        jr = await _fetchJsonMaybeNative(url, timeoutMs: 12000);
        data = jr['data'];
      }
      await _applyNewsApiRateLimitSignal(jr);
      if (jr['ok'] == true &&
          data is Map &&
          data['status'] == 'ok' &&
          data['articles'] is List &&
          (data['articles'] as List).isNotEmpty) {
        return (data['articles'] as List).cast<Map<String, dynamic>>();
      }
    } catch (_) {
      /* try next base */
    }
  }
  return null;
}

Future<List<Map<String, dynamic>>?> _fetchNewsApiThroughCloudFunction(
  String endpoint,
  Map<String, String> baseParams,
) async {
  final p = Map<String, String>.from(baseParams)..['endpoint'] = endpoint;
  final urls = _getCandidateNewsApiFunctionUrls();
  if (urls.isEmpty) return null;

  for (final fnUrl in urls) {
    try {
      final url = '$fnUrl?${Uri(queryParameters: p).query}';
      var jr = await _fetchJsonMaybeNative(url, timeoutMs: 12000);
      var data = jr['data'];
      final quotaLimitedCf = data is Map && data['code'] == 'rateLimited';
      if (_isNewsApiRateLimitedJsonResponse(jr) && !quotaLimitedCf) {
        await Future<void>.delayed(const Duration(milliseconds: _newsApi429RetryMs));
        jr = await _fetchJsonMaybeNative(url, timeoutMs: 12000);
        data = jr['data'];
      }
      await _applyNewsApiRateLimitSignal(jr);
      if (jr['ok'] == true &&
          data is Map &&
          data['status'] == 'ok' &&
          data['articles'] is List &&
          (data['articles'] as List).isNotEmpty) {
        return (data['articles'] as List).cast<Map<String, dynamic>>();
      }
    } catch (_) {
      /* next candidate */
    }
  }
  return null;
}

Map<String, dynamic>? _tryParseNewsApiJson(String raw) {
  if (raw.trim().isEmpty) return null;
  try {
    final parsed = jsonDecode(raw);
    return parsed is Map<String, dynamic> ? parsed : null;
  } catch (_) {
    return null;
  }
}

Future<List<Map<String, dynamic>>> _fetchNewsApiThroughCorsProxies(
  String endpoint,
  Map<String, String> baseParams,
  String apiKey,
) async {
  final params = Map<String, String>.from(baseParams)..['apiKey'] = apiKey;
  final upstreamUrl = '$_newsApiV2/$endpoint?${Uri(queryParameters: params).query}';

  Future<List<Map<String, dynamic>>?> codetabs() async {
    try {
      final res = await http
          .get(Uri.parse(
              'https://api.codetabs.com/v1/proxy?quest=${Uri.encodeComponent(upstreamUrl)}'))
          .timeout(const Duration(seconds: 12));
      if (res.statusCode != 200) return null;
      dynamic json;
      try {
        json = jsonDecode(res.body);
      } catch (_) {
        json = null;
      }
      if (json is Map && json['status'] != null && json['articles'] is List) {
        return (json['articles'] as List).cast<Map<String, dynamic>>();
      }
      final contents = json is Map && json['contents'] is String
          ? json['contents'] as String
          : json is String
              ? json
              : null;
      if (contents != null) {
        final parsed = _tryParseNewsApiJson(contents);
        if (parsed != null && parsed['status'] != null && parsed['articles'] is List) {
          return (parsed['articles'] as List).cast<Map<String, dynamic>>();
        }
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  Future<List<Map<String, dynamic>>?> corsproxy() async {
    try {
      final res = await http
          .get(Uri.parse('https://corsproxy.io/?${Uri.encodeComponent(upstreamUrl)}'))
          .timeout(const Duration(seconds: 12));
      if (res.statusCode != 200) return null;
      dynamic json;
      try {
        json = jsonDecode(res.body);
      } catch (_) {
        try {
          json = jsonDecode(res.body);
        } catch (_) {
          json = null;
        }
      }
      if (json is Map && json['status'] != null && json['articles'] is List) {
        return (json['articles'] as List).cast<Map<String, dynamic>>();
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  Future<List<Map<String, dynamic>>?> allorigins() async {
    try {
      final res = await http
          .get(Uri.parse(
              'https://api.allorigins.win/get?url=${Uri.encodeComponent(upstreamUrl)}'))
          .timeout(const Duration(seconds: 12));
      if (res.statusCode != 200) return null;
      final data = jsonDecode(res.body);
      final contents = data is Map && data['contents'] is String ? data['contents'] as String : '';
      if (contents.isNotEmpty) {
        final parsed = _tryParseNewsApiJson(contents);
        if (parsed != null && parsed['status'] != null && parsed['articles'] is List) {
          return (parsed['articles'] as List).cast<Map<String, dynamic>>();
        }
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  for (final run in [codetabs, corsproxy, allorigins]) {
    try {
      final articles = await run();
      if (articles != null && articles.isNotEmpty) return articles;
    } catch (_) {
      /* next proxy */
    }
  }
  return [];
}

String _newsApiDefaultFromISO({int days = 7}) {
  final d = DateTime.now().toUtc().subtract(Duration(days: days));
  return d.toIso8601String().substring(0, 10);
}

Future<List<Map<String, dynamic>>> fetchNewsApiEverythingRaw({
  String q = '',
  int? pageSize,
  String? language,
  String? sortBy,
  String? from,
}) async {
  final query = q.trim();
  if (query.isEmpty) return [];

  final size = (pageSize ?? 30).clamp(1, 100);

  Map<String, String> buildParams(String fromIso) => {
        'q': query,
        'language': language ?? 'en',
        'sortBy': sortBy ?? 'publishedAt',
        'pageSize': '$size',
        'from': fromIso,
      };

  Future<List<Map<String, dynamic>>> attemptOnce(Map<String, String> baseParams) async {
    if (isNewsApiRateLimitedCooldown()) return [];

    final directEnv = await _fetchNewsApiDirectFromEnv('everything', baseParams);
    if (directEnv != null && directEnv.isNotEmpty) return directEnv;

    final direct = await _fetchNewsApiThroughCloudFunction('everything', baseParams);
    if (direct != null && direct.isNotEmpty) return direct;

    final proxied = await _fetchNewsApiThroughProxy('everything', baseParams);
    if (proxied != null && proxied.isNotEmpty) return proxied;

    final envKey = getNewsApiKey();
    if (envKey.isNotEmpty && _allowNewsCorsProxyFallback()) {
      final viaCors = await _fetchNewsApiThroughCorsProxies('everything', baseParams, envKey);
      if (viaCors.isNotEmpty) return viaCors;
    }

    return [];
  }

  final pinnedFrom = from != null && from.trim().isNotEmpty;
  final firstFrom = pinnedFrom ? from.trim() : _newsApiDefaultFromISO();
  var out = await attemptOnce(buildParams(firstFrom));
  if (out.isEmpty && !pinnedFrom) {
    out = await attemptOnce(buildParams(_newsApiDefaultFromISO(days: 30)));
  }
  return out;
}

Future<List<Map<String, dynamic>>> fetchNewsApiEverythingNormalized({
  String q = '',
  int? pageSize,
  String? language,
  String? sortBy,
  String? from,
}) async {
  final raw = await fetchNewsApiEverythingRaw(
    q: q,
    pageSize: pageSize,
    language: language,
    sortBy: sortBy,
    from: from,
  );
  return normalizeArticles(raw);
}

Future<List<Map<String, dynamic>>> fetchNewsApiTopHeadlinesRaw({
  String? category,
  String? q,
  String? country,
  int? pageSize,
  Object? language = 'en',
  String? sources,
}) async {
  final cat = (category ?? '').trim();
  final query = (q ?? '').trim();
  final src = (sources ?? '').trim();
  final countryOpt = country != null ? country.trim().toLowerCase() : '';
  final countryCode = RegExp(r'^[a-z]{2}$').hasMatch(countryOpt) ? countryOpt : '';

  if (cat.isEmpty && query.isEmpty && src.isEmpty && countryCode.isEmpty) return [];

  final size = (pageSize ?? 30).clamp(1, 100);
  final baseParams = <String, String>{'pageSize': '$size'};

  if (language == false) {
    /* omit language â€” broader in-country results */
  } else {
    final lang = language is String ? language : 'en';
    if (lang.isNotEmpty) baseParams['language'] = lang;
  }

  if (cat.isNotEmpty) baseParams['category'] = cat;
  if (query.isNotEmpty) baseParams['q'] = query;
  if (src.isNotEmpty) baseParams['sources'] = src;
  if (cat.isNotEmpty && src.isEmpty && query.isEmpty && countryCode.isEmpty) {
    baseParams['country'] = 'us';
  } else if (countryCode.isNotEmpty) {
    baseParams['country'] = countryCode;
  }

  if (isNewsApiRateLimitedCooldown()) return [];

  final directEnv = await _fetchNewsApiDirectFromEnv('top-headlines', baseParams);
  if (directEnv != null && directEnv.isNotEmpty) return directEnv;

  final direct = await _fetchNewsApiThroughCloudFunction('top-headlines', baseParams);
  if (direct != null && direct.isNotEmpty) return direct;

  final proxied = await _fetchNewsApiThroughProxy('top-headlines', baseParams);
  if (proxied != null && proxied.isNotEmpty) return proxied;

  final envKeyTh = getNewsApiKey();
  if (envKeyTh.isNotEmpty && _allowNewsCorsProxyFallback()) {
    final viaCorsTh =
        await _fetchNewsApiThroughCorsProxies('top-headlines', baseParams, envKeyTh);
    if (viaCorsTh.isNotEmpty) return viaCorsTh;
  }

  return [];
}

Future<List<Map<String, dynamic>>> fetchNewsApiTopHeadlinesNormalized({
  String? category,
  String? q,
  String? country,
  int? pageSize,
  Object? language = 'en',
  String? sources,
}) async {
  final raw = await fetchNewsApiTopHeadlinesRaw(
    category: category,
    q: q,
    country: country,
    pageSize: pageSize,
    language: language,
    sources: sources,
  );
  return normalizeArticles(raw);
}

// ---------------------------------------------------------------------------
// OG image resolution
// ---------------------------------------------------------------------------

String? parseOgImageFromHtml(String? html) {
  if (html == null || html.isEmpty) return null;
  final patterns = [
    RegExp(
      r'''<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']''',
      caseSensitive: false,
    ),
    RegExp(
      r'''<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']''',
      caseSensitive: false,
    ),
    RegExp(
      r'''<meta\s+[^>]*property=["']og:image:url["'][^>]*content=["']([^"']+)["']''',
      caseSensitive: false,
    ),
    RegExp(
      r'''<meta\s+[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']''',
      caseSensitive: false,
    ),
    RegExp(
      r'''<meta\s+[^>]*name=["']twitter:image:src["'][^>]*content=["']([^"']+)["']''',
      caseSensitive: false,
    ),
    RegExp(
      r'''<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']''',
      caseSensitive: false,
    ),
  ];

  final candidates = <String>{};
  for (final re in patterns) {
    for (final m in re.allMatches(html)) {
      final d = _decodeMetaUrl(m.group(1));
      if (d != null) candidates.add(d);
    }
  }

  if (candidates.isEmpty) return null;

  int score(String url) {
    final s = url.toLowerCase();
    final w = RegExp(r'(?:s0-w|=s0-w)(\d+)', caseSensitive: false).firstMatch(s)?.group(1);
    final wi = w != null ? int.tryParse(w) : null;
    if (wi != null) return wi;
    return s.length;
  }

  String? bestNonBad;
  var bestNonBadScore = -999999999;
  String? best;
  var bestScoreVal = -999999999;

  for (final u in candidates) {
    final sc = score(u);
    if (!isBadHeroImageUrl(u) && sc > bestNonBadScore) {
      bestNonBadScore = sc;
      bestNonBad = u;
    }
    if (sc > bestScoreVal) {
      bestScoreVal = sc;
      best = u;
    }
  }

  return bestNonBad ?? best;
}

Future<String> _fetchPageHtmlViaProxies(String pageUrl) async {
  final encoded = Uri.encodeComponent(pageUrl);
  final attempts = [
    'https://api.codetabs.com/v1/proxy?quest=$encoded',
    'https://corsproxy.io/?$encoded',
    'https://api.allorigins.win/get?url=$encoded',
  ];

  for (final apiUrl in attempts) {
    try {
      final res = await http.get(Uri.parse(apiUrl));
      if (res.statusCode != 200) continue;
      if (apiUrl.contains('allorigins')) {
        final j = jsonDecode(res.body);
        final c = j is Map && j['contents'] is String ? j['contents'] as String : '';
        if (c.length > 150) return c;
      } else {
        if (res.body.length > 150) return res.body;
      }
    } catch (_) {
      /* next proxy */
    }
  }
  return '';
}

Future<String?> _tryHeroImageFromPublisherPage(String targetUrl) async {
  final u = targetUrl.trim();
  if (u.isEmpty ||
      !RegExp(r'^https?://', caseSensitive: false).hasMatch(u) ||
      _isBlockedOutboundHost(u)) {
    return null;
  }

  try {
    final ml = await http.get(Uri.parse('https://api.microlink.io/?url=${Uri.encodeComponent(u)}'));
    if (ml.statusCode == 200) {
      final j = jsonDecode(ml.body);
      if (j is Map) {
        final data = j['data'];
        final imageUrl = data is Map ? data['image'] : null;
        final fixed = imageUrl is Map ? _decodeMetaUrl('${imageUrl['url']}') : null;
        if (fixed != null && !isBadHeroImageUrl(fixed)) return fixed;
      }
    }
  } catch (_) {
    /* og fallback */
  }

  final html = await _fetchPageHtmlViaProxies(u);
  final og = parseOgImageFromHtml(html);
  if (og != null && !isBadHeroImageUrl(og)) return og;
  return null;
}

Future<String?> _tryHeroImageFromBackend(String articleUrl) async {
  final u = articleUrl.trim();
  if (u.isEmpty || !RegExp(r'^https?://', caseSensitive: false).hasMatch(u)) return null;
  if (_looksLikeImageAssetUrl(u)) return null;

  for (final apiBase in _getFirebaseHostingApiBases()) {
    try {
      final apiUrl = '$apiBase/api/linkedin/article?url=${Uri.encodeComponent(u)}';
      final res = await http.get(Uri.parse(apiUrl));
      if (res.statusCode != 200) continue;
      final data = jsonDecode(res.body);
      if (data is Map) {
        final img = data['image'];
        if (img is String && img.trim().isNotEmpty && !isBadHeroImageUrl(img.trim())) {
          return img.trim();
        }
      }
    } catch (_) {
      /* next candidate */
    }
  }
  return null;
}

Future<({String? realUrl, String? image})> _tryResolvePublisherAndImageViaMicrolink(
  String googleNewsUrl,
) async {
  final u = googleNewsUrl.trim();
  if (u.isEmpty || !RegExp(r'^https?://', caseSensitive: false).hasMatch(u)) {
    return (realUrl: null, image: null);
  }
  try {
    final ml = await http.get(Uri.parse('https://api.microlink.io/?url=${Uri.encodeComponent(u)}'));
    if (ml.statusCode != 200) return (realUrl: null, image: null);
    final j = jsonDecode(ml.body);
    if (j is! Map) return (realUrl: null, image: null);
    final data = j['data'];
    if (data is! Map) return (realUrl: null, image: null);
    final realUrl = _decodeMetaUrl('${data['url']}') ??
        (data['publisher'] is Map ? _decodeMetaUrl('${(data['publisher'] as Map)['url']}') : null);
    final imageObj = data['image'];
    final image = imageObj is Map ? _decodeMetaUrl('${imageObj['url']}') : null;
    return (realUrl: realUrl, image: image);
  } catch (_) {
    return (realUrl: null, image: null);
  }
}

Future<String> resolveArticleHeroImage(
  String? pageUrl, {
  bool skipGoogleDecode = false,
  String publisherUrl = '',
}) async {
  final u = (pageUrl ?? '').trim();
  if (u.isEmpty || !RegExp(r'^https?://', caseSensitive: false).hasMatch(u)) {
    return _ensureNonEmptyImageUrl(null);
  }

  final publisherHint = publisherUrl.trim();

  if (!skipGoogleDecode && _isGoogleNewsArticleUrl(u)) {
    final realUrl = decodeGoogleNewsUrl(u);
    if (realUrl != null &&
        !_isBlockedOutboundHost(realUrl) &&
        !_looksLikeImageAssetUrl(realUrl)) {
      final img = await resolveArticleHeroImage(
        realUrl,
        skipGoogleDecode: true,
        publisherUrl: publisherHint,
      );
      return _ensureNonEmptyImageUrl(img);
    }

    final ml = await _tryResolvePublisherAndImageViaMicrolink(u);
    if (ml.image != null && !isBadHeroImageUrl(ml.image)) {
      return _ensureNonEmptyImageUrl(ml.image);
    }
    if (ml.realUrl != null &&
        !_isBlockedOutboundHost(ml.realUrl!) &&
        !_looksLikeImageAssetUrl(ml.realUrl!)) {
      final img = await resolveArticleHeroImage(
        ml.realUrl,
        skipGoogleDecode: true,
        publisherUrl: publisherHint,
      );
      return _ensureNonEmptyImageUrl(img);
    }

    return _ensureNonEmptyImageUrl(null);
  }

  String? fromBackend;
  if (publisherHint.isNotEmpty &&
      !_isBlockedOutboundHost(publisherHint) &&
      !_looksLikeImageAssetUrl(publisherHint)) {
    fromBackend = await _tryHeroImageFromBackend(publisherHint);
    if (fromBackend != null) return _ensureNonEmptyImageUrl(fromBackend);
  }
  fromBackend = await _tryHeroImageFromBackend(u);
  if (fromBackend != null) return _ensureNonEmptyImageUrl(fromBackend);

  if (publisherHint.isNotEmpty &&
      !_isBlockedOutboundHost(publisherHint) &&
      !_looksLikeImageAssetUrl(publisherHint)) {
    final fromHint = await _tryHeroImageFromPublisherPage(publisherHint);
    if (fromHint != null) return _ensureNonEmptyImageUrl(fromHint);
  }
  final img = await _tryHeroImageFromPublisherPage(u);
  return _ensureNonEmptyImageUrl(img);
}

Future<List<Map<String, dynamic>>> enrichNewsItemsWithOgImages(
  List<Map<String, dynamic>> items, {
  bool enableOgFallback = false,
  int maxResolve = 18,
  int concurrency = 4,
}) async {
  if (items.isEmpty) return items;

  if (!enableOgFallback) {
    return items
        .map((it) => {...it, 'image': _ensureNonEmptyImageUrl(it['image'] as String?)})
        .toList();
  }

  final slots = <({int i, Map<String, dynamic> it})>[];
  for (var i = 0; i < items.length; i++) {
    final it = items[i];
    final url = it['url'];
    if (url is! String || !RegExp(r'^https?://', caseSensitive: false).hasMatch(url.trim())) {
      continue;
    }
    final missing = it['image'] == null || '$it[image]'.trim().isEmpty;
    final fromGoogleNews = _isGoogleNewsArticleUrl(url);
    final googleNewsBrandingThumb =
        fromGoogleNews && it['image'] is String && _looksLikeGoogleNewsBrandingThumb(it['image'] as String);
    if (missing || googleNewsBrandingThumb) {
      slots.add((i: i, it: it));
    }
  }
  final limited = slots.take(maxResolve).toList();

  if (limited.isEmpty) {
    return items
        .map((it) => {...it, 'image': _ensureNonEmptyImageUrl(it['image'] as String?)})
        .toList();
  }

  final out = items.map((it) => Map<String, dynamic>.from(it)).toList();
  var job = 0;

  Future<void> runWorker() async {
    while (true) {
      final k = job++;
      if (k >= limited.length) return;
      final slot = limited[k];
      try {
        final img = await resolveArticleHeroImage(
          '${out[slot.i]['url']}',
          publisherUrl: '${out[slot.i]['publisherUrl'] ?? ''}',
        );
        if (img.isNotEmpty && !isBadHeroImageUrl(img)) {
          out[slot.i] = {...out[slot.i], 'image': img};
        }
      } catch (_) {
        /* ignore */
      }
    }
  }

  final workers = concurrency.clamp(1, limited.length);
  await Future.wait(List.generate(workers, (_) => runWorker()));

  return out
      .map((it) => {...it, 'image': _ensureNonEmptyImageUrl(it['image'] as String?)})
      .toList();
}

// ---------------------------------------------------------------------------
// NewsFeedRow widget
// ---------------------------------------------------------------------------

bool _isUsableNewsFeedThumbnailUrl(String? url) {
  final u = (url ?? '').trim();
  if (u.isEmpty ||
      !RegExp(r'^https?://', caseSensitive: false).hasMatch(u) ||
      u.toLowerCase().startsWith('data:')) {
    return false;
  }
  if (RegExp(r'^https?:\/\/lh[0-9]\.googleusercontent\.com\/.+(?:=s0-w|s0-w)\d+', caseSensitive: false)
      .hasMatch(u)) {
    return false;
  }
  return true;
}

/// Hub news list row â€” mirrors React `NewsFeedRow`.
class NewsFeedRow extends StatefulWidget {
  const NewsFeedRow({
    super.key,
    required this.item,
    this.hub,
    this.isLast = false,
    this.onOpenShare,
  });

  final NewsArticle item;
  final HubRowColors? hub;
  final bool isLast;
  final VoidCallback? onOpenShare;

  @override
  State<NewsFeedRow> createState() => _NewsFeedRowState();
}

class HubRowColors {
  const HubRowColors({required this.text, required this.divider});
  final Color text;
  final Color divider;

  factory HubRowColors.fromHubTheme() =>
      const HubRowColors(text: HubTheme.text, divider: HubTheme.divider);
}

class _NewsFeedRowState extends State<NewsFeedRow> {
  bool _thumbFailed = false;

  @override
  void didUpdateWidget(NewsFeedRow oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.item.url != widget.item.url || oldWidget.item.image != widget.item.image) {
      _thumbFailed = false;
    }
  }

  Color get _textColor => widget.hub?.text ?? HubTheme.text;
  Color get _dividerColor => widget.hub?.divider ?? HubTheme.divider;

  Future<void> _openExternal() async {
    final url = widget.item.url.trim();
    if (url.isEmpty) return;
    final uri = Uri.tryParse(url);
    if (uri != null) await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final thumbSrc =
        !_thumbFailed && _isUsableNewsFeedThumbnailUrl(widget.item.image) ? widget.item.image!.trim() : null;

    final inner = Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (thumbSrc != null)
          Container(
            width: 76,
            height: 76,
            margin: const EdgeInsets.only(right: 12),
            decoration: BoxDecoration(
              color: _dividerColor,
              borderRadius: BorderRadius.circular(12),
            ),
            clipBehavior: Clip.antiAlias,
            child: Image.network(
              thumbSrc,
              fit: BoxFit.cover,
              width: 76,
              height: 76,
              errorBuilder: (_, __, ___) {
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  if (mounted) setState(() => _thumbFailed = true);
                });
                return const SizedBox.shrink();
              },
            ),
          ),
        Expanded(
          child: Text(
            widget.item.title,
            maxLines: 4,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: _textColor,
              fontSize: 16,
              fontWeight: FontWeight.w600,
              height: 1.35,
              letterSpacing: -0.2,
            ),
          ),
        ),
      ],
    );

    final border = widget.isLast
        ? null
        : Border(bottom: BorderSide(color: _dividerColor, width: 1));

    if (widget.onOpenShare != null) {
      return Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: widget.onOpenShare,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
            decoration: BoxDecoration(border: border),
            width: double.infinity,
            alignment: Alignment.centerLeft,
            child: inner,
          ),
        ),
      );
    }

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: _openExternal,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
          decoration: BoxDecoration(border: border),
          width: double.infinity,
          alignment: Alignment.centerLeft,
          child: inner,
        ),
      ),
    );
  }
}
