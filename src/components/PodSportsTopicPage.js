import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

/** When there is no direct article URL, open a relevant Google News search (still a real navigation). */
function googleNewsSearchUrl(query) {
  const q = (query || 'sports').trim() || 'sports';
  return `https://news.google.com/search?q=${encodeURIComponent(q)}&hl=en&gl=US&ceid=US:en`;
}

/** Google News RSS search strings (browser-friendly; no NewsAPI key required). */
const GOOGLE_RSS_QUERY = {
  cricket: 'cricket OR IPL OR T20 OR Ashes when:7d',
  football: 'soccer OR NFL OR FIFA OR UEFA OR "Premier League" when:7d',
  f1: '"Formula 1" OR F1 OR "Grand Prix" when:7d',
  chess: 'chess OR FIDE OR grandmaster OR Candidates when:7d',
  others: 'sports when:7d',
};

function buildGoogleNewsRssUrl(searchQuery) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}&hl=en-US&gl=US&ceid=US:en`;
}

/**
 * Google News RSS has no browser CORS. AllOrigins often triggers Chrome
 * net::ERR_HTTP2_PROTOCOL_ERROR (HTTP/2 framing issues) even with 200.
 * Prefer rss2json in fetchLiveFromGoogleRss; this is only a fallback chain.
 */
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
      /* try next proxy */
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

/** Google RSS titles are often "Headline - Publisher"; show headline only when it matches. */
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

async function fetchLiveFromGoogleRss(topicId) {
  const q = GOOGLE_RSS_QUERY[topicId];
  if (!q) return [];
  const rssUrl = buildGoogleNewsRssUrl(q);
  // rss2json hits Google server-side — avoids flaky browser → AllOrigins HTTP/2 errors.
  let items = await fetchItemsThroughRss2Json(rssUrl);
  if (!items.length) {
    const xml = await fetchRssXmlViaProxies(rssUrl);
    items = parseGoogleNewsRssXml(xml);
  }
  return items;
}

/** Match article text to one of the four main Explore topics (used to strip them from “Others”). */
function matchesMainTopic(text) {
  const t = (text || '').toLowerCase();
  const cricket =
    /\b(cricket|ipl|ashes|t20|odi|bbl|psl|wicket|test match|super over)\b/i.test(t);
  const football =
    /\b(soccer|nfl|ncaa football|fifa|uefa|premier league|champions league|la liga|bundesliga|serie a|mls|world cup)\b/i.test(
      t
    ) || /\bfootball\b/i.test(t);
  const f1 =
    /\b(formula\s*1|formula one|\bf1\b|grand prix|qualifying|constructor championship|paddock)\b/i.test(t);
  const chess = /\b(chess|fide|grandmaster|carlsen|nakamura|lichess)\b/i.test(t);
  return cricket || football || f1 || chess;
}

const TOPIC_META = {
  cricket: {
    label: 'Cricket',
    /** NewsAPI everything `q` — scoped to the sport */
    q: '(cricket OR IPL OR "test cricket" OR T20 OR BBL OR PSL OR Ashes OR wicket)',
  },
  football: {
    label: 'Football',
    q: '(soccer OR NFL OR FIFA OR UEFA OR "Premier League" OR "Champions League" OR "La Liga" OR Bundesliga OR MLS OR "World Cup")',
  },
  f1: {
    label: 'F1',
    q: '("Formula 1" OR "Formula One" OR F1 OR "Grand Prix" OR qualifying OR pitwall OR constructors)',
  },
  chess: {
    label: 'Chess',
    q: '(chess OR FIDE OR grandmaster OR Carlsen OR Nakamura OR Candidates OR lichess OR Chess.com)',
  },
  others: {
    label: 'Other sports',
    q: null,
  },
};

function browseTopicOnGoogleNews(topicId) {
  const q = GOOGLE_RSS_QUERY[topicId] || GOOGLE_RSS_QUERY.others;
  return googleNewsSearchUrl(q.replace(/\s+when:\d+d$/i, '').trim());
}

function NewsFeedRow({ item, hub, isLast }) {
  const icon = faviconUrl(item);
  const rel = formatRelativeTime(item.publishedAt);

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 py-4 px-4 text-left transition-opacity hover:opacity-90 active:opacity-80"
      style={{ borderBottom: isLast ? 'none' : `1px solid ${hub.divider}` }}
    >
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
    </a>
  );
}

function normalizeArticles(list) {
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

export default function PodSportsTopicPage() {
  const { topicId } = useParams();
  const navigate = useNavigate();
  const { isDarkMode } = useTheme();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const configForTitle = TOPIC_META[topicId];
  const title = configForTitle?.label ?? 'Sports';

  const apiKey = useMemo(
    () => process.env.REACT_APP_NEWSAPI || process.env.NEWSAPI || '',
    []
  );

  useEffect(() => {
    const config = TOPIC_META[topicId];
    if (!config) {
      setItems([]);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        /** @type {Array<{title:string,source:string,url:string,image:null|string,description:string,publishedAt?:string|null,sourceSiteUrl?:string}>|null} */
        let rows = null;

        if (apiKey) {
          try {
            if (topicId === 'others') {
              const res = await fetch(
                `https://newsapi.org/v2/top-headlines?category=sports&language=en&pageSize=100&apiKey=${encodeURIComponent(apiKey)}`
              );
              const data = await res.json();
              if (data.status === 'ok' && Array.isArray(data.articles)) {
                const normalized = normalizeArticles(data.articles);
                const filtered = normalized.filter((a) => {
                  const blob = `${a.title} ${a.description || ''}`;
                  return !matchesMainTopic(blob);
                });
                if (filtered.length) rows = filtered.slice(0, 30);
              }
            } else {
              const q = config.q;
              const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=en&sortBy=publishedAt&pageSize=30&apiKey=${encodeURIComponent(apiKey)}`;
              const res = await fetch(url);
              const data = await res.json();
              if (res.ok && data.status === 'ok' && Array.isArray(data.articles)) {
                const normalized = normalizeArticles(data.articles);
                if (normalized.length) rows = normalized;
              }
            }
          } catch {
            /* try Google RSS below */
          }
        }

        if (!rows?.length) {
          let rss = await fetchLiveFromGoogleRss(topicId);
          if (topicId === 'others') {
            rss = rss.filter((a) => !matchesMainTopic(`${a.title} ${a.description || ''}`));
          }
          if (rss.length) rows = rss.slice(0, 30);
        }

        if (!cancelled) {
          if (rows?.length) {
            setItems(rows);
            setError('');
          } else {
            setItems([]);
            setError('Could not load stories. Check your connection or try opening Google News below.');
          }
        }
      } catch {
        if (!cancelled) {
          setItems([]);
          setError('Could not load stories. Check your connection or try opening Google News below.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [topicId, apiKey]);

  const HUB = {
    bg: '#0F0F0F',
    text: '#FFFFFF',
    textSecondary: '#A0A0A0',
    divider: '#1E1E1E',
    accent: '#A855F7',
  };
  const cardStyle = { background: HUB.bg, border: `1px solid ${HUB.divider}` };

  return (
    <div
      className="min-h-screen px-6 relative overflow-hidden slide-up"
      style={{
        background: isDarkMode ? '#131314' : '#B5C4AE',
        paddingTop: 'max(1.5rem, calc(env(safe-area-inset-top, 0px) + 1rem))',
        paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div className="relative z-10 max-w-sm mx-auto">
        <div className="mb-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/pod/sports')}
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={cardStyle}
            aria-label="Back to Sports"
          >
            <ArrowLeft className="w-5 h-5" style={{ color: HUB.text }} />
          </button>
          <h1 className="text-xl font-bold" style={{ color: HUB.text }}>{title}</h1>
        </div>

        <div className="rounded-2xl overflow-hidden" style={cardStyle}>
          <div className="px-4 py-4" style={{ borderBottom: `1px solid ${HUB.divider}` }}>
            <h2 className="text-base font-semibold" style={{ color: HUB.text }}>
              <span className="mr-1.5" aria-hidden>🔥</span>
              Latest
            </h2>
            {topicId === 'others' && (
              <p className="text-xs mt-1" style={{ color: HUB.textSecondary }}>
                Sports outside Cricket, Football, F1 &amp; Chess
              </p>
            )}
          </div>
          <div className="py-0">
            {loading ? (
              <p className="text-sm px-4 py-6" style={{ color: HUB.textSecondary }}>Loading…</p>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm leading-relaxed" style={{ color: HUB.textSecondary }}>
                  {error || 'No stories to show yet.'}
                </p>
                <a
                  href={browseTopicOnGoogleNews(topicId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-4 text-sm font-semibold underline underline-offset-2"
                  style={{ color: HUB.accent }}
                >
                  Open {title} on Google News
                </a>
              </div>
            ) : (
              <div role="feed" aria-label={`${title} news`}>
                {items.slice(0, 25).map((item, idx, arr) => (
                  <NewsFeedRow
                    key={`${item.url}-${idx}`}
                    item={item}
                    hub={HUB}
                    isLast={idx === arr.length - 1}
                  />
                ))}
                {!!error && (
                  <p className="text-xs px-4 py-3" style={{ color: HUB.textSecondary, borderTop: `1px solid ${HUB.divider}` }}>
                    {error}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
