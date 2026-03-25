import React from 'react';

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
  const abs = html.match(/src=["'](https?:[^"'>\s]+)["']/i);
  if (abs?.[1] && /^https?:\/\//i.test(abs[1])) return abs[1];
  const proto = html.match(/src=["'](\/\/[^"'>\s]+)["']/i);
  if (proto?.[1]) return `https:${proto[1]}`;
  return null;
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

/** Google News RSS often wraps the real story in <a href="..."> or google/url?q=... */
function extractPublisherUrlFromRssItemHtml(html) {
  if (!html || typeof html !== 'string') return null;
  const re = /<a[^>]+href=["'](https?:\/\/[^"']+)["']/gi;
  let m;
  let best = null;
  let bestLen = 0;
  while ((m = re.exec(html)) !== null) {
    let u = decodeMetaUrl(m[1]);
    const unwrapped = decodeGoogleWrappedUrl(u);
    if (unwrapped) u = unwrapped;
    if (!u || isBlockedOutboundHost(u)) continue;
    try {
      const len = new URL(u).pathname.length;
      if (len > bestLen) {
        bestLen = len;
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
    if (h === 'googleusercontent.com' && /\/(icons?|branding|static\/images)/i.test(url)) return true;
    return false;
  } catch {
    return true;
  }
}

function isGoogleNewsArticleUrl(url) {
  return typeof url === 'string' && /news\.google\.com\/(rss\/)?articles\//i.test(url);
}

/**
 * Pull a likely publisher article URL from a proxied Google News article HTML shell.
 */
function extractLikelyPublisherUrlFromGoogleNewsPageHtml(html) {
  if (!html || typeof html !== 'string' || html.length < 200) return null;
  const re = /https?:\/\/[a-z0-9][-a-z0-9.]*[a-z0-9](?::\d+)?\/[^"'\\\s<>)]{12,900}/gi;
  let m;
  let best = null;
  let bestScore = 0;
  while ((m = re.exec(html)) !== null) {
    let u = m[0].replace(/[),.;]+$/g, '');
    u = decodeMetaUrl(u);
    const unwrapped = decodeGoogleWrappedUrl(u);
    if (unwrapped) u = unwrapped;
    if (!u || isBlockedOutboundHost(u)) continue;
    try {
      const p = new URL(u);
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

/** Microlink / RSS sometimes return Google branding, not the story photo. */
export function isBadHeroImageUrl(url) {
  if (!url || typeof url !== 'string') return true;
  const s = url.toLowerCase();
  if (s.includes('google.com/s2/favicons')) return true;
  if (s.includes('gstatic.com/images/branding')) return true;
  if (s.includes('gstatic.com/images/icons')) return true;
  if (/news\.google\.com\/.{0,120}(icon|logo|favicon)/i.test(url)) return true;
  if ((s.includes('logo') || s.includes('icon')) && (s.includes('google') || s.includes('gstatic'))) return true;
  if (/googleusercontent\.com\/.{0,100}(icon|logo|favicon|branding)/i.test(url)) return true;
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
    const source = sourceNode?.textContent?.trim() || 'Google News';
    const sourceSiteUrl = sourceNode?.getAttribute('url')?.trim() || '';
    const pubDateRaw = item.getElementsByTagName('pubDate')[0]?.textContent?.trim();
    const publishedAt = parseRssPubDate(pubDateRaw);
    const rawDesc = item.getElementsByTagName('description')[0]?.textContent || '';
    const description = rawDesc.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    let image = firstImageUrlFromHtml(rawDesc);
    if (isBadHeroImageUrl(image)) image = null;
    const publisherUrl = extractPublisherUrlFromRssItemHtml(rawDesc);
    const title = cleanPublisherSuffixFromTitle(rawTitle, source);
    out.push({
      title,
      source,
      url: link,
      image,
      description,
      publishedAt,
      sourceSiteUrl,
      publisherUrl: publisherUrl || '',
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
        const source = it.author || data.feed?.title || 'Google News';
        const htmlBlob = [it.content, it.description, it.contentSnippet].filter(Boolean).join(' ');
        const description = (it.contentSnippet || '')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        let image =
          (it.enclosure?.link && /^https?:/i.test(it.enclosure.link) ? it.enclosure.link : null) ||
          firstImageUrlFromHtml(htmlBlob);
        if (isBadHeroImageUrl(image)) image = null;
        const publisherUrl = extractPublisherUrlFromRssItemHtml(htmlBlob) || '';
        const publishedAt = parseRssPubDate(it.pubDate);
        const title = cleanPublisherSuffixFromTitle(rawTitle, source);
        return {
          title,
          source,
          url,
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
      if (isBadHeroImageUrl(img)) img = null;
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
  const res = [
    /<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
    /<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
    /<meta\s+[^>]*property=["']og:image:url["'][^>]*content=["']([^"']+)["']/i,
    /<meta\s+[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
    /<meta\s+[^>]*name=["']twitter:image:src["'][^>]*content=["']([^"']+)["']/i,
    /<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i,
  ];
  for (const re of res) {
    const m = html.match(re);
    const d = decodeMetaUrl(m?.[1]);
    if (d) return d;
  }
  return null;
}

async function fetchPageHtmlViaProxies(pageUrl) {
  const encoded = encodeURIComponent(pageUrl);
  // Google News shells often load better via allorigins first (some proxies block Google).
  const attempts = /news\.google\.com/i.test(pageUrl)
    ? [
        `https://api.allorigins.win/get?url=${encoded}`,
        `https://api.codetabs.com/v1/proxy?quest=${encoded}`,
        `https://corsproxy.io/?${encoded}`,
      ]
    : [
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
        if (c && c.length > 400) return c;
      } else {
        const t = await res.text();
        if (t && t.length > 400) return t;
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

/**
 * Hero image for a story. Google News links need the publisher URL (from RSS &lt;a&gt; or unpacked HTML);
 * Microlink on google.com alone often returns the Google News logo — those URLs are rejected.
 */
export async function resolveArticleHeroImage(pageUrl, options = {}) {
  const u = typeof pageUrl === 'string' ? pageUrl.trim() : '';
  if (!u || !/^https?:\/\//i.test(u)) return null;

  const skipUnpack = options.skipGoogleUnpack === true;
  const publisherHint =
    typeof options.publisherUrl === 'string' ? options.publisherUrl.trim() : '';

  if (publisherHint && !isBlockedOutboundHost(publisherHint)) {
    const fromHint = await tryHeroImageFromPublisherPage(publisherHint);
    if (fromHint) return fromHint;
  }

  if (!skipUnpack && isGoogleNewsArticleUrl(u)) {
    const shellHtml = await fetchPageHtmlViaProxies(u);
    const extracted = extractLikelyPublisherUrlFromGoogleNewsPageHtml(shellHtml);
    if (extracted && extracted !== u && !isBlockedOutboundHost(extracted)) {
      const fromPublisher = await resolveArticleHeroImage(extracted, {
        skipGoogleUnpack: true,
        publisherUrl: '',
      });
      if (fromPublisher) return fromPublisher;
    }
    const shellImg = await tryHeroImageFromPublisherPage(u);
    if (shellImg && !isBadHeroImageUrl(shellImg)) return shellImg;
    return null;
  }

  return tryHeroImageFromPublisherPage(u);
}

/**
 * Fills missing `item.image` by resolving publisher og:image (concurrency-limited).
 */
export async function enrichNewsItemsWithOgImages(items, options = {}) {
  const maxResolve = typeof options.maxResolve === 'number' ? options.maxResolve : 18;
  const concurrency = typeof options.concurrency === 'number' ? options.concurrency : 4;
  if (!Array.isArray(items) || !items.length) return items;

  const slots = items
    .map((it, i) => ({ i, it }))
    .filter(({ it }) => {
      if (!it || typeof it.url !== 'string' || !/^https?:\/\//i.test(it.url.trim())) return false;
      const missing = !it.image;
      const badGoogleThumb = it.image && isBadHeroImageUrl(it.image);
      return missing || badGoogleThumb;
    })
    .slice(0, maxResolve);

  if (!slots.length) return items;

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
  return out;
}

export function NewsFeedRow({ item, hub, isLast, onOpenShare }) {
  const icon = faviconUrl(item);
  const rel = formatRelativeTime(item.publishedAt);

  const inner = (
    <>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center gap-2 min-w-0">
          {icon ? (
            <img
              src={icon}
              alt=""
              className="w-[18px] h-[18px] rounded-sm flex-shrink-0 bg-white/10"
              width={18}
              height={18}
              loading="lazy"
            />
          ) : (
            <span
              className="w-[18px] h-[18px] rounded-sm flex-shrink-0 flex items-center justify-center text-[9px] font-bold bg-white/10"
              style={{ color: hub.textSecondary }}
              aria-hidden
            >
              {(item.source || '?').slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="text-xs truncate font-medium" style={{ color: hub.textSecondary }}>
            {item.source}
          </span>
        </div>
        <p className="text-base leading-snug font-semibold tracking-tight line-clamp-4" style={{ color: hub.text }}>
          {item.title}
        </p>
        {rel ? (
          <span className="text-xs pt-0.5" style={{ color: hub.textSecondary }}>
            {rel}
          </span>
        ) : null}
      </div>
      <div className="flex-shrink-0 w-[4.5rem] h-[4.5rem] rounded-lg overflow-hidden bg-black/25">
        {item.image ? (
          <img
            src={item.image}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
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
