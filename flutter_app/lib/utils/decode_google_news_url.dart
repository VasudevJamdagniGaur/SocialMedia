import 'dart:convert';
import 'dart:typed_data';

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
String? decodeGoogleNewsUrl(String? inputUrl) {
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
    Uint8List bytes;
    try {
      bytes = base64Decode(b64 + pad);
    } catch (_) {
      return null;
    }

    final urls = _extractAsciiUrlsFromBytes(bytes);
    for (final cand in urls) {
      final unwrapped = _decodeGoogleWrappedUrl(cand) ?? cand;
      if (_isBlockedOutboundHost(unwrapped)) continue;
      if (!_looksLikePublisherPageUrl(unwrapped)) continue;
      return unwrapped;
    }
  } catch (_) {
    return null;
  }
  return null;
}
