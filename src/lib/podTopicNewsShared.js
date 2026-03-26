import React from 'react';

const __NEWS_FALLBACK_IMAGE_URL =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
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
    </svg>`
  );

function ensureNonEmptyImageUrl(url) {
  const u = typeof url === 'string' ? url.trim() : '';
  // Hide low-value Google News thumbnail icons (e.g. lh3.googleusercontent ... s0-w300).
  if (/^https?:\/\/lh[0-9]\.googleusercontent\.com\/.+(?:=s0-w|s0-w)\d+/i.test(u)) {
    return __NEWS_FALLBACK_IMAGE_URL;
  }
  return u || __NEWS_FALLBACK_IMAGE_URL;
}

/** When there is no direct article URL, open a relevant Google News search. */
export function googleNewsSearchUrl(query) {
  const q = (query || 'news').trim() || 'news';
  return `https://news.google.com/search?q=${encodeURIComponent(q)}&hl=en&gl=US&ceid=US:en`;
}

export function buildGoogleNewsRssUrl(searchQuery) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}&hl=en-US&gl=US&ceid=US:en`;
}

async function fetchRssXmlViaProxies(targetUrl) {
  const attempts = [
    async () => {
      const res = await fetch(
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`
      );
      if (!res.ok) return '';
      return await res.text();
    },
    async () => {
      const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(targetUrl)}`);
      if (!res.ok) return '';
      return await res.text();
    },
    async () => {
      const res = await fetch(
        `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`
      );
      if (!res.ok) return '';
      let data;
      try {
        data = await res.json();
      } catch {
        return '';
      }
      return typeof data.contents === 'string' ? data.contents : '';
    },
  ];

  for (const run of attempts) {
    try {
      const xml = await run();
      if (xml && xml.includes('<item')) return xml;
    } catch {
      /* next proxy */
    }
  }
  return '';
}

function firstImageUrlFromHtml(html) {
  if (!html || typeof html !== 'string') return null;
  // Instead of taking the very first image, pick the "best" one from the HTML blob.
  // Google News RSS descriptions often contain multiple Googleusercontent thumbs where
  // the first one is frequently the branding/logo.
  const candidates = new Set();
  const absRe = /src=["'](https?:\/\/[^"'>\s]+)["']/gi;
  const protoRe = /src=["'](\/\/[^"'>\s]+)["']/gi;
  let m;
  while ((m = absRe.exec(html)) !== null) {
    if (m?.[1]) candidates.add(m[1]);
  }
  while ((m = protoRe.exec(html)) !== null) {
    if (m?.[1]) candidates.add(`https:${m[1]}`);
  }

  // Fallback: legacy single-match behavior.
  if (!candidates.size) {
    const abs = html.match(/src=["'](https?:[^"'>\s]+)["']/i);
    if (abs?.[1] && /^https?:\/\//i.test(abs[1])) return abs[1];
    const proto = html.match(/src=["'](\/\/[^"'>\s]+)["']/i);
    if (proto?.[1]) return `https:${proto[1]}`;
    return null;
  }

  const score = (url) => {
    const s = String(url).toLowerCase();
    const w = s.match(/(?:s0-w|=s0-w)(\d+)/i)?.[1];
    const wi = w ? parseInt(w, 10) : null;
    if (wi && Number.isFinite(wi)) return wi;
    if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?.*)?$/i.test(s)) return 1000;
    return s.length;
  };

  let best = null;
  let bestScore = -Infinity;
  let bestNonBad = null;
  let bestNonBadScore = -Infinity;

  for (const u of candidates) {
    const sc = score(u);
    if (sc > bestScore) {
      best = u;
      bestScore = sc;
    }
    if (!isBadHeroImageUrl(u) && sc > bestNonBadScore) {
      bestNonBad = u;
      bestNonBadScore = sc;
    }
  }

  return bestNonBad || best;
}

function decodeGoogleWrappedUrl(href) {
  if (!href || typeof href !== 'string') return null;
  try {
    const u = new URL(href, 'https://news.google.com');
    const inner = u.searchParams.get('url') || u.searchParams.get('q');
    if (inner && /^https?:\/\//i.test(inner) && !isBlockedOutboundHost(inner)) return inner;
    const m = href.match(/[?&](?:url|q)=(https%3A%2F%2F[^&]+)/i);
    if (m) {
      const decoded = decodeURIComponent(m[1]);
      if (decoded && /^https?:\/\//i.test(decoded) && !isBlockedOutboundHost(decoded)) return decoded;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Decode a Google News `.../articles/<id>` URL into the real publisher URL.
 *
 * Evidence-driven goal: avoid scraping Google News HTML altogether.
 */
export function decodeGoogleNewsUrl(inputUrl) {
  const raw = typeof inputUrl === 'string' ? inputUrl.trim() : '';
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (!/news\.google\.com$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/\/articles\/([^/?#]+)/i);
    const id = m?.[1];
    if (!id) return null;

    // The article id is a base64-ish blob. Decode and search for embedded URLs.
    const b64 = id.replace(/-/g, '+').replace(/_/g, '/');
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    let bin = '';
    try {
      bin = atob(b64 + pad);
    } catch {
      return null;
    }
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const isUrlCharByte = (b) => {
      // Conservative ASCII subset for URLs.
      return (
        (b >= 0x30 && b <= 0x39) || // 0-9
        (b >= 0x41 && b <= 0x5a) || // A-Z
        (b >= 0x61 && b <= 0x7a) || // a-z
        b === 0x3a || // :
        b === 0x2f || // /
        b === 0x2e || // .
        b === 0x3f || // ?
        b === 0x23 || // #
        b === 0x26 || // &
        b === 0x25 || // %
        b === 0x3d || // =
        b === 0x2d || // -
        b === 0x5f || // _
        b === 0x7e || // ~
        b === 0x2b || // +
        b === 0x40 || // @
        b === 0x21 || // !
        b === 0x24 || // $
        b === 0x2a || // *
        b === 0x27 || // '
        b === 0x28 || // (
        b === 0x29 || // )
        b === 0x2c || // ,
        b === 0x3b || // ;
        b === 0x5b || // [
        b === 0x5d // ]
      );
    };

    const extractAsciiUrlsFromBytes = (buf) => {
      const out = [];
      const n = buf.length;
      // Look for "http" ASCII sequence.
      for (let i = 0; i + 4 < n; i++) {
        if (buf[i] !== 0x68 || buf[i + 1] !== 0x74 || buf[i + 2] !== 0x74 || buf[i + 3] !== 0x70)
          continue;
        let j = i;
        let s = '';
        while (j < n && isUrlCharByte(buf[j]) && s.length < 2000) {
          s += String.fromCharCode(buf[j]);
          j++;
        }
        if (/^https?:\/\//i.test(s) && s.length >= 12) out.push(s);
        i = j;
      }
      return out;
    };

    const urls = extractAsciiUrlsFromBytes(bytes);

    for (const cand of urls) {
      const unwrapped = decodeGoogleWrappedUrl(cand) || cand;
      if (!unwrapped) continue;
      if (isBlockedOutboundHost(unwrapped)) continue;
      if (!looksLikePublisherPageUrl(unwrapped)) continue;
      return unwrapped;
    }
  } catch {
    return null;
  }
  return null;
}

/** Google News RSS often wraps the real story in <a href="..."> or google/url?q=... */
function extractPublisherUrlFromRssItemHtml(html) {
  if (!html || typeof html !== 'string') return null;
  const candidates = new Set();

  // Common case: <a href="..."> wrappers inside the description HTML.
  const reA = /<a[^>]+href=["'](https?:\/\/[^"']+)["']/gi;
  let m;
  while ((m = reA.exec(html)) !== null) {
    if (m?.[1]) candidates.add(m[1]);
  }

  // Sometimes the wrapped link appears without a literal <a> tag.
  // Google wrappers typically look like: https://www.google.com/url?q=https%3A%2F%2Fexample.com%2F...
  const reWrapped = /https?:\/\/[^"'\s<>]+(?:[?&](?:url|q)=(?:https%3A%2F%2F|http%3A%2F%2F)[^&"'\s<>]+)[^"'\s<>]*/gi;
  while ((m = reWrapped.exec(html)) !== null) {
    if (m?.[0]) candidates.add(m[0]);
  }

  let best = null;
  let bestScore = 0;
  for (const rawHref of candidates) {
    let u = decodeMetaUrl(rawHref);
    const unwrapped = decodeGoogleWrappedUrl(u);
    if (unwrapped) u = unwrapped;
    if (!u) {
      continue;
    }
    if (isBlockedOutboundHost(u)) {
      continue;
    }
    if (looksLikeImageAssetUrl(u)) {
      continue;
    }
    try {
      const p = new URL(u);
      // Prefer "real" publisher deep pages over short paths.
      const score = p.pathname.length + (p.search ? 8 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = u;
      }
    } catch {
      /* skip */
    }
  }

  return best;
}

function isBlockedOutboundHost(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h === 'news.google.com' || h.endsWith('.news.google.com')) return true;
    if (h === 'play.google.com' || h.endsWith('.play.google.com')) return true;
    if (h.endsWith('google.com') || h === 'gstatic.com' || h.endsWith('.gstatic.com')) return true;
    if (h === 'youtube.com' || h.endsWith('.youtube.com')) return true;
    // Treat googleusercontent as non-publisher (it’s usually images/assets for our use-case).
    if (h === 'googleusercontent.com') return true;
    return false;
  } catch {
    return true;
  }
}

function isGoogleNewsArticleUrl(url) {
  return typeof url === 'string' && /news\.google\.com\/(rss\/)?articles\//i.test(url);
}

function looksLikeImageAssetUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const s = url.toLowerCase();
  if (/^data:/i.test(s)) return true;
  // Google News thumbnails often come from `lh*.googleusercontent.com` with varying size params.
  if (/lh[0-9]\.googleusercontent\.com/i.test(url)) return true;
  if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?.*)?$/i.test(s)) return true;
  return false;
}

function looksLikePublisherPageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (looksLikeImageAssetUrl(url)) return false;
  try {
    const p = new URL(url);
    const host = p.hostname.toLowerCase();

    // Common Google shell "noise" endpoints; not publisher pages.
    if (host === 'googletagmanager.com' || host.endsWith('.googletagmanager.com')) return false;
    if (host === 'google-analytics.com' || host.endsWith('.google-analytics.com')) return false;
    if (host === 'doubleclick.net' || host.endsWith('.doubleclick.net')) return false;
    if (host === 'w3.org' || host.endsWith('.w3.org')) return false;

    const path = p.pathname.toLowerCase();
    const last = path.split('/').filter(Boolean).pop() || '';

    // Reject asset-like URLs.
    if (/\.(js|css|json|xml|rss|atom|txt|map|ico)(\?.*)?$/.test(path)) return false;
    if (last === 'js' || last === 'css' || last === 'json' || last === 'xml') return false;
    if (path.includes('/gtag/') && (last === 'js' || path.endsWith('/gtag/js'))) return false;

    return true;
  } catch {
    return false;
  }
}

/** Microlink / RSS sometimes return Google branding, not the story photo. */
export function isBadHeroImageUrl(url) {
  if (!url || typeof url !== 'string') return true;
  return /^data:/i.test(url.trim());
}

function looksLikeGoogleNewsBrandingThumb(url) {
  if (!url || typeof url !== 'string') return false;
  const s = url.toLowerCase();
  // Google News often uses `lh3.googleusercontent.com` for thumbnails; many of these are just
  // Google branding (not the publisher's article photo).
  if (!s.includes('googleusercontent.com')) return false;
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!/^lh[0-9]\.googleusercontent\.com$/.test(host) && !host.includes('lh3.googleusercontent.com')) {
    return false;
  }
  // Most branding thumbs use the `s0-w###` sizing convention.
  if (s.includes('s0-w') || s.includes('=s0-w')) return true;
  return false;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanPublisherSuffixFromTitle(rawTitle, sourceName) {
  const t = (rawTitle || '').replace(/\s+/g, ' ').trim();
  const s = (sourceName || '').replace(/\s+/g, ' ').trim();
  if (!t || !s) return t;
  const re = new RegExp(`\\s*[-–—|]\\s*${escapeRegExp(s)}\\s*$`, 'i');
  const cut = t.replace(re, '').trim();
  return cut.length >= 12 ? cut : t;
}

function normalizeSourceLabel(rawSource) {
  const s = (rawSource || '').replace(/\s+/g, ' ').trim();
  if (!s) return 'News';
  // rss2json feed title for Google RSS often contains the literal query.
  if (/google news/i.test(s)) return 'Google News';
  if (/^".+"\s*-\s*google news$/i.test(s)) return 'Google News';
  return s;
}

function parseRssPubDate(pubDateStr) {
  if (!pubDateStr) return null;
  const d = new Date(pubDateStr);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function formatRelativeTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  let sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 0) sec = 0;
  if (sec < 60) return 'Just now';
  if (sec < 3600) return `${Math.floor(sec / 60)} minutes ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} hours ago`;
  if (sec < 172800) return 'Yesterday';
  return `${Math.floor(sec / 86400)} days ago`;
}

function hostnameForFavicon(item) {
  if (item.sourceSiteUrl) {
    try {
      return new URL(item.sourceSiteUrl).hostname.replace(/^www\./, '');
    } catch {
      /* ignore */
    }
  }
  if (item.url && typeof item.url === 'string' && !/news\.google\./i.test(item.url)) {
    try {
      return new URL(item.url).hostname.replace(/^www\./, '');
    } catch {
      /* ignore */
    }
  }
  return '';
}

function faviconUrl(item) {
  const host = hostnameForFavicon(item);
  if (!host) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

function parseGoogleNewsRssXml(xml) {
  if (!xml || !xml.includes('<item')) return [];
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) return [];
  const out = [];
  const items = doc.getElementsByTagName('item');
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const rawTitle = item.getElementsByTagName('title')[0]?.textContent?.replace(/\s+/g, ' ').trim();
    const linkEl = item.getElementsByTagName('link')[0];
    const link =
      linkEl?.textContent?.trim() ||
      linkEl?.getAttribute('href')?.trim() ||
      item.getElementsByTagName('guid')[0]?.textContent?.trim();
    if (!rawTitle || !link) continue;
    const sourceNode = item.getElementsByTagName('source')[0];
    const source = normalizeSourceLabel(sourceNode?.textContent?.trim() || 'Google News');
    const sourceSiteUrl = sourceNode?.getAttribute('url')?.trim() || '';
    const pubDateRaw = item.getElementsByTagName('pubDate')[0]?.textContent?.trim();
    const publishedAt = parseRssPubDate(pubDateRaw);
    const rawDesc = item.getElementsByTagName('description')[0]?.textContent || '';
    const description = rawDesc.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    let image = firstImageUrlFromHtml(rawDesc);
    if (!image) image = null;
    const publisherUrl = extractPublisherUrlFromRssItemHtml(rawDesc);
    const decoded = isGoogleNewsArticleUrl(link) ? decodeGoogleNewsUrl(link) : null;
    const finalUrl = decoded || publisherUrl || link;
    const title = cleanPublisherSuffixFromTitle(rawTitle, source);
    out.push({
      title,
      source,
      url: finalUrl,
      image,
      description,
      publishedAt,
      sourceSiteUrl,
      publisherUrl: decoded || publisherUrl || '',
    });
  }
  return out;
}

async function fetchItemsThroughRss2Json(rssUrl) {
  try {
    const api = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`;
    const res = await fetch(api);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.status !== 'ok' || !Array.isArray(data.items)) return [];
    return data.items
      .map((it) => {
        const rawTitle = it.title?.replace(/\s+/g, ' ').trim();
        const url = typeof it.link === 'string' ? it.link.trim() : '';
        if (!rawTitle || !url) return null;
        const source = normalizeSourceLabel(it.author || data.feed?.title || 'Google News');
        const htmlBlob = [it.content, it.description, it.contentSnippet].filter(Boolean).join(' ');
        const description = (it.contentSnippet || '')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        let image =
          (it.enclosure?.link && /^https?:/i.test(it.enclosure.link) ? it.enclosure.link : null) ||
          firstImageUrlFromHtml(htmlBlob);
        if (!image) image = null;
        const decoded = isGoogleNewsArticleUrl(url) ? decodeGoogleNewsUrl(url) : null;
        const publisherUrl = decoded || extractPublisherUrlFromRssItemHtml(htmlBlob) || '';
        const publishedAt = parseRssPubDate(it.pubDate);
        const title = cleanPublisherSuffixFromTitle(rawTitle, source);
        return {
          title,
          source,
          url: decoded || url,
          image,
          description,
          publishedAt,
          sourceSiteUrl: '',
          publisherUrl,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Google News RSS by raw search string (include when:7d etc. as needed). */
export async function fetchLiveFromGoogleRssByQuery(googleRssQuery) {
  const q = (googleRssQuery || '').trim();
  if (!q) return [];
  const rssUrl = buildGoogleNewsRssUrl(q);
  let items = await fetchItemsThroughRss2Json(rssUrl);
  if (!items.length) {
    const xml = await fetchRssXmlViaProxies(rssUrl);
    items = parseGoogleNewsRssXml(xml);
  }
  return items;
}

export function normalizeArticles(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((a) => a?.title)
    .map((a) => {
      const direct = typeof a.url === 'string' ? a.url.trim() : '';
      const source = a?.source?.name || 'News';
      const publishedAt =
        typeof a.publishedAt === 'string' && a.publishedAt ? a.publishedAt : null;
      const rawTitle = a.title;
      let img = a.urlToImage || firstImageUrlFromHtml(a.description || '') || null;
      if (!img) img = null;
      const pubFromDesc = extractPublisherUrlFromRssItemHtml(a.description || '');
      return {
        title: cleanPublisherSuffixFromTitle(rawTitle, source),
        source,
        url: direct || googleNewsSearchUrl(rawTitle),
        image: img,
        description: a.description || '',
        publishedAt,
        sourceSiteUrl: '',
        publisherUrl: pubFromDesc || '',
      };
    });
}

function decodeMetaUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let u = raw.trim().replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  if (u.startsWith('//')) u = `https:${u}`;
  return /^https?:\/\//i.test(u) ? u : null;
}

/** Extract Open Graph / Twitter image from raw HTML (best-effort). */
export function parseOgImageFromHtml(html) {
  if (!html || typeof html !== 'string') return null;
  const patterns = [
    /<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/gi,
    /<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/gi,
    /<meta\s+[^>]*property=["']og:image:url["'][^>]*content=["']([^"']+)["']/gi,
    /<meta\s+[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/gi,
    /<meta\s+[^>]*name=["']twitter:image:src["'][^>]*content=["']([^"']+)["']/gi,
    /<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/gi,
  ];

  const candidates = new Set();
  for (const re of patterns) {
    for (const m of html.matchAll(re)) {
      const raw = m?.[1];
      const d = decodeMetaUrl(raw);
      if (d) candidates.add(d);
    }
  }

  if (!candidates.size) return null;

  const score = (url) => {
    const s = String(url).toLowerCase();
    // Prefer the biggest size variant when Googleusercontent thumbs are present.
    const m = s.match(/(?:s0-w|=s0-w)(\d+)/i);
    const w = m?.[1] ? parseInt(m[1], 10) : null;
    if (w && Number.isFinite(w)) return w;
    return s.length;
  };

  // Prefer a non-"bad" candidate if present. This avoids picking generic Google branding images.
  let bestNonBad = null;
  let bestNonBadScore = -Infinity;
  let best = null;
  let bestScore = -Infinity;

  for (const u of candidates) {
    const sc = score(u);
    if (!isBadHeroImageUrl(u) && sc > bestNonBadScore) {
      bestNonBadScore = sc;
      bestNonBad = u;
    }
    if (sc > bestScore) {
      bestScore = sc;
      best = u;
    }
  }

  return bestNonBad || best;
}

function extractBestGoogleThumbFromHtml(html) {
  if (!html || typeof html !== 'string') return null;
  // Google News shells frequently embed thumbnail URLs directly in HTML.
  // We specifically look for `lh*.googleusercontent.com/...=s0-w####`.
  const re = /https?:\/\/lh\d+\.googleusercontent\.com\/[^"' >]+?=s0-w(\d+)[^"' >]*/gi;
  let m;
  let best = null;
  let bestW = -1;
  while ((m = re.exec(html)) !== null) {
    const url = m?.[0];
    const w = m?.[1] ? parseInt(m[1], 10) : NaN;
    if (!url || !Number.isFinite(w)) continue;
    if (w > bestW) {
      bestW = w;
      best = url;
    }
  }
  return best;
}

async function fetchPageHtmlViaProxies(pageUrl) {
  const encoded = encodeURIComponent(pageUrl);
  const attempts = [
    `https://api.codetabs.com/v1/proxy?quest=${encoded}`,
    `https://corsproxy.io/?${encoded}`,
    `https://api.allorigins.win/get?url=${encoded}`,
  ];
  for (const apiUrl of attempts) {
    try {
      const res = await fetch(apiUrl);
      if (!res.ok) continue;
      if (apiUrl.includes('allorigins')) {
        const j = await res.json();
        const c = typeof j.contents === 'string' ? j.contents : '';
        if (c && c.length > 150) return c;
      } else {
        const t = await res.text();
        if (t && t.length > 150) return t;
      }
    } catch {
      /* next proxy */
    }
  }
  return '';
}

async function tryHeroImageFromPublisherPage(targetUrl) {
  const u = typeof targetUrl === 'string' ? targetUrl.trim() : '';
  if (!u || !/^https?:\/\//i.test(u) || isBlockedOutboundHost(u)) return null;

  try {
    const ml = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(u)}`);
    if (ml.ok) {
      const j = await ml.json().catch(() => null);
      const fixed = decodeMetaUrl(j?.data?.image?.url);
      if (fixed && !isBadHeroImageUrl(fixed)) return fixed;
    }
  } catch {
    /* og fallback */
  }

  const html = await fetchPageHtmlViaProxies(u);
  const og = parseOgImageFromHtml(html);
  if (og && !isBadHeroImageUrl(og)) return og;
  return null;
}

function getApiBaseCandidates() {
  const origin =
    typeof window !== 'undefined' && window.location && typeof window.location.origin === 'string'
      ? window.location.origin
      : '';
  const originLooksLocal =
    !origin ||
    origin.includes('localhost') ||
    origin.startsWith('capacitor://') ||
    origin.startsWith('ionic://') ||
    origin.startsWith('file://');
  if (originLooksLocal) {
    const list = [];
    if (origin && origin.startsWith('http')) list.push(origin);
    list.push('https://deitedatabase.web.app');
    list.push('https://deitedatabase.firebaseapp.com');
    return list;
  }
  return [origin, 'https://deitedatabase.web.app', 'https://deitedatabase.firebaseapp.com'];
}

async function tryHeroImageFromBackend(articleUrl) {
  const u = typeof articleUrl === 'string' ? articleUrl.trim() : '';
  if (!u || !/^https?:\/\//i.test(u)) return null;
  if (looksLikeImageAssetUrl(u)) return null;

  let lastErr = null;
  for (const apiBase of getApiBaseCandidates()) {
    try {
      const apiUrl = `${apiBase}/api/linkedin/article?url=${encodeURIComponent(u)}`;
      const res = await fetch(apiUrl, { method: 'GET' });
      if (!res.ok) continue;
      const data = await res.json().catch(() => null);
      const img = data && typeof data.image === 'string' ? data.image.trim() : '';
      if (img && !isBadHeroImageUrl(img)) return img;
    } catch (e) {
      // next candidate
      lastErr = e;
    }
  }
  // Helpful when debugging locally (prevents silent "black thumbnails").
  // Keep it lightweight: only log for obvious failures (no network or parsing).
  if (typeof window !== 'undefined' && window?.location?.hostname === 'localhost' && lastErr) {
    console.warn('[news] backend hero-image extraction failed; falling back to proxies');
  }
  return null;
}

async function tryResolvePublisherAndImageViaMicrolink(googleNewsUrl) {
  const u = typeof googleNewsUrl === 'string' ? googleNewsUrl.trim() : '';
  if (!u || !/^https?:\/\//i.test(u)) return { realUrl: null, image: null };
  try {
    const ml = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(u)}`);
    if (!ml.ok) return { realUrl: null, image: null };
    const j = await ml.json().catch(() => null);
    const realUrl = decodeMetaUrl(j?.data?.url) || decodeMetaUrl(j?.data?.publisher?.url) || null;
    const image = decodeMetaUrl(j?.data?.image?.url) || null;
    return { realUrl, image };
  } catch {
    return { realUrl: null, image: null };
  }
}

/**
 * Hero image for a story. Google News links need the publisher URL (from RSS &lt;a&gt; or unpacked HTML);
 * Microlink on google.com alone often returns the Google News logo — those URLs are rejected.
 */
export async function resolveArticleHeroImage(pageUrl, options = {}) {
  const u = typeof pageUrl === 'string' ? pageUrl.trim() : '';
  if (!u || !/^https?:\/\//i.test(u)) return ensureNonEmptyImageUrl(null);

  const skipDecode = options.skipGoogleDecode === true;
  const publisherHint =
    typeof options.publisherUrl === 'string' ? options.publisherUrl.trim() : '';

  // Google News URLs: decode to publisher URL and stop here (no Google HTML scraping).
  if (!skipDecode && isGoogleNewsArticleUrl(u)) {
    const realUrl = decodeGoogleNewsUrl(u);
    if (realUrl && !isBlockedOutboundHost(realUrl) && !looksLikeImageAssetUrl(realUrl)) {
      const img = await resolveArticleHeroImage(realUrl, { ...options, skipGoogleDecode: true });
      return ensureNonEmptyImageUrl(img);
    }

    // If decode failed, let Microlink resolve to publisher + image (no Google HTML scraping).
    const ml = await tryResolvePublisherAndImageViaMicrolink(u);
    if (ml?.image && !isBadHeroImageUrl(ml.image)) return ensureNonEmptyImageUrl(ml.image);
    if (ml?.realUrl && !isBlockedOutboundHost(ml.realUrl) && !looksLikeImageAssetUrl(ml.realUrl)) {
      const img = await resolveArticleHeroImage(ml.realUrl, { ...options, skipGoogleDecode: true });
      return ensureNonEmptyImageUrl(img);
    }

    return ensureNonEmptyImageUrl(null);
  }

  // Prefer backend extraction (server-side). Avoids browser CORS/proxy failures.
  let fromBackend = null;
  if (publisherHint && !isBlockedOutboundHost(publisherHint) && !looksLikeImageAssetUrl(publisherHint)) {
    fromBackend = await tryHeroImageFromBackend(publisherHint);
    if (fromBackend) return ensureNonEmptyImageUrl(fromBackend);
  }
  fromBackend = await tryHeroImageFromBackend(u);
  if (fromBackend) return ensureNonEmptyImageUrl(fromBackend);

  if (publisherHint && !isBlockedOutboundHost(publisherHint) && !looksLikeImageAssetUrl(publisherHint)) {
    const fromHint = await tryHeroImageFromPublisherPage(publisherHint);
    if (fromHint) return ensureNonEmptyImageUrl(fromHint);
  }
  const img = await tryHeroImageFromPublisherPage(u);
  return ensureNonEmptyImageUrl(img);
}

/**
 * Fills missing `item.image` by resolving publisher og:image (concurrency-limited).
 */
export async function enrichNewsItemsWithOgImages(items, options = {}) {
  const enableOgFallback = options.enableOgFallback === true;
  const maxResolve = typeof options.maxResolve === 'number' ? options.maxResolve : 18;
  const concurrency = typeof options.concurrency === 'number' ? options.concurrency : 4;
  if (!Array.isArray(items) || !items.length) return items;

  if (!enableOgFallback) {
    return items.map((it) => ({ ...it, image: ensureNonEmptyImageUrl(it?.image || null) }));
  }

  const slots = items
    .map((it, i) => ({ i, it }))
    .filter(({ it }) => {
      if (!it || typeof it.url !== 'string' || !/^https?:\/\//i.test(it.url.trim())) return false;
      const missing = !it.image;
      const fromGoogleNews = isGoogleNewsArticleUrl(it.url);
      const googleNewsBrandingThumb = fromGoogleNews && it.image && looksLikeGoogleNewsBrandingThumb(it.image);
      return missing || googleNewsBrandingThumb;
    })
    .slice(0, maxResolve);

  if (!slots.length) return items.map((it) => ({ ...it, image: ensureNonEmptyImageUrl(it?.image || null) }));

  const out = items.map((it) => ({ ...it }));
  let job = 0;
  const runWorker = async () => {
    while (true) {
      const k = job++;
      if (k >= slots.length) return;
      const { i } = slots[k];
      try {
        const img = await resolveArticleHeroImage(out[i].url, {
          publisherUrl: out[i].publisherUrl || '',
        });
        if (img && !isBadHeroImageUrl(img)) out[i] = { ...out[i], image: img };
      } catch {
        /* ignore */
      }
    }
  };
  const workers = Math.min(concurrency, slots.length);
  await Promise.all(Array.from({ length: workers }, () => runWorker()));
  return out.map((it) => ({ ...it, image: ensureNonEmptyImageUrl(it?.image || null) }));
}

export function NewsFeedRow({ item, hub, isLast, onOpenShare }) {
  const rel = formatRelativeTime(item.publishedAt);

  const inner = (
    <>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <p className="text-base leading-snug font-semibold tracking-tight line-clamp-4" style={{ color: hub.text }}>
          {item.title}
        </p>
        {rel ? (
          <span className="text-xs pt-0.5" style={{ color: hub.textSecondary }}>
            {rel}
          </span>
        ) : null}
      </div>
    </>
  );

  const rowStyle = { borderBottom: isLast ? 'none' : `1px solid ${hub.divider}` };

  if (typeof onOpenShare === 'function') {
    return (
      <button
        type="button"
        onClick={() => onOpenShare(item)}
        className="flex gap-3 py-4 px-4 w-full text-left transition-opacity hover:opacity-90 active:opacity-80"
        style={rowStyle}
      >
        {inner}
      </button>
    );
  }

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 py-4 px-4 text-left transition-opacity hover:opacity-90 active:opacity-80"
      style={rowStyle}
    >
      {inner}
    </a>
  );
}
