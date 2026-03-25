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
    const image = firstImageUrlFromHtml(rawDesc);
    const title = cleanPublisherSuffixFromTitle(rawTitle, source);
    out.push({
      title,
      source,
      url: link,
      image,
      description,
      publishedAt,
      sourceSiteUrl,
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
        const image =
          (it.enclosure?.link && /^https?:/i.test(it.enclosure.link) ? it.enclosure.link : null) ||
          firstImageUrlFromHtml(htmlBlob);
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
      return {
        title: cleanPublisherSuffixFromTitle(rawTitle, source),
        source,
        url: direct || googleNewsSearchUrl(rawTitle),
        image: a.urlToImage || firstImageUrlFromHtml(a.description || '') || null,
        description: a.description || '',
        publishedAt,
        sourceSiteUrl: '',
      };
    });
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
          <img src={item.image} alt="" className="w-full h-full object-cover" loading="lazy" />
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
