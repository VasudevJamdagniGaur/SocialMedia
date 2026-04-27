import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Flame } from 'lucide-react';
import { filterPosts } from '../lib/redditPostFilter';
import CardSkeleton from './skeleton/CardSkeleton';

const REDDIT_HOT_URL =
  'https://www.reddit.com/r/BollyBlindsNGossip/hot.json?limit=50&raw_json=1';

const __TEA_TRENDING_URLS_KEY = 'deite_tea_trending_urls_v1';
const __SHARE_NEWS_CARD_CACHE_KEY = 'deite_share_news_card_cache_v1';

function safeReadJsonFromLocalStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeWriteJsonToLocalStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / storage full */
  }
}

function writeTrendingTeaUrlsAndPruneShareCache(items) {
  try {
    const urls = (items || [])
      .map((x) => (typeof x?.url === 'string' ? x.url.trim() : ''))
      .filter(Boolean);
    safeWriteJsonToLocalStorage(__TEA_TRENDING_URLS_KEY, urls);

    const cache = safeReadJsonFromLocalStorage(__SHARE_NEWS_CARD_CACHE_KEY);
    if (!cache || typeof cache !== 'object') return;
    const keep = new Set(urls);
    let changed = false;
    for (const [k, v] of Object.entries(cache)) {
      const kind = typeof v?.kind === 'string' ? v.kind : '';
      if (kind === 'tea' && !keep.has(k)) {
        delete cache[k];
        changed = true;
      }
    }
    if (changed) safeWriteJsonToLocalStorage(__SHARE_NEWS_CARD_CACHE_KEY, cache);
  } catch {
    /* ignore */
  }
}

function withTimeoutSignal(ms, outerSignal) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  const onAbort = () => ctrl.abort();
  if (outerSignal) {
    if (outerSignal.aborted) ctrl.abort();
    else outerSignal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    cleanup: () => {
      clearTimeout(tid);
      if (outerSignal) outerSignal.removeEventListener('abort', onAbort);
    },
  };
}

async function fetchRedditJsonViaProxies(targetUrl, { signal } = {}) {
  const encoded = encodeURIComponent(targetUrl);
  const attempts = [
    `https://api.codetabs.com/v1/proxy?quest=${encoded}`,
    `https://corsproxy.io/?${encoded}`,
    `https://api.allorigins.win/get?url=${encoded}`,
  ];
  for (const proxyUrl of attempts) {
    try {
      const res = await fetch(proxyUrl, {
        method: 'GET',
        signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) continue;
      if (proxyUrl.includes('allorigins')) {
        const j = await res.json().catch(() => null);
        const txt = typeof j?.contents === 'string' ? j.contents : '';
        if (!txt) continue;
        const parsed = JSON.parse(txt);
        if (parsed && typeof parsed === 'object') return parsed;
        continue;
      }
      const json = await res.json().catch(() => null);
      if (json && typeof json === 'object') return json;
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      /* try next proxy */
    }
  }
  return null;
}

/** Reddit post `url` field points to a direct image file */
function isDirectImageUrl(postUrl) {
  if (typeof postUrl !== 'string' || !postUrl.trim()) return false;
  const path = postUrl.trim().split('?')[0].split('#')[0];
  return /\.(jpe?g|png|gif|webp)$/i.test(path);
}

function mapRedditChildToTea(child) {
  const d = child?.data;
  if (!d) return null;
  const permalink = typeof d.permalink === 'string' ? d.permalink : '';
  const url = permalink
    ? `https://www.reddit.com${permalink.startsWith('/') ? '' : '/'}${permalink}`
    : '';
  const postUrl = typeof d.url === 'string' ? d.url : '';
  return {
    id: d.id || d.name || String(Math.random()),
    title: typeof d.title === 'string' ? d.title : '',
    score: typeof d.score === 'number' ? d.score : 0,
    num_comments: typeof d.num_comments === 'number' ? d.num_comments : 0,
    author: typeof d.author === 'string' && d.author.length ? d.author : 'unknown',
    url,
    postUrl,
    thumbnail: typeof d.thumbnail === 'string' ? d.thumbnail : '',
  };
}

/** Image URL for share-suggestions hero (same rules as card preview). */
function getTeaHeroImageUrl(item) {
  const isValidThumbnail =
    typeof item.thumbnail === 'string' && item.thumbnail.trim().startsWith('http');
  if (isDirectImageUrl(item.postUrl)) return item.postUrl.trim();
  if (isValidThumbnail) return item.thumbnail.trim();
  return null;
}

const TEA_HERO_GRADIENTS = [
  'linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)',
  'linear-gradient(135deg,#2d132c 0%,#801336 50%,#c72c41 100%)',
  'linear-gradient(135deg,#0f2027 0%,#203a43 50%,#2c5364 100%)',
  'linear-gradient(135deg,#1e3c72 0%,#2a5298 50%,#7e8ba3 100%)',
  'linear-gradient(135deg,#232526 0%,#414345 100%)',
];

/**
 * Horizontal card — hero image + title overlay (matches Hub trending swipe cards).
 */
function TeaTrendingCard({ item, idx, HUB, onSelect }) {
  const isValidThumbnail =
    typeof item.thumbnail === 'string' && item.thumbnail.trim().startsWith('http');
  const isDirectImage = isDirectImageUrl(item.postUrl);

  let displayImage = null;
  if (isDirectImage) displayImage = item.postUrl.trim();
  else if (isValidThumbnail) displayImage = item.thumbnail.trim();

  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [item.postUrl, item.thumbnail]);

  const showImage = Boolean(displayImage) && !imgFailed;

  const cardClassName =
    'relative flex-shrink-0 w-[min(260px,78vw)] snap-start snap-always rounded-xl overflow-hidden border transition-transform active:scale-[0.98] hover:opacity-95';

  const cardStyle = {
    borderColor: HUB.divider,
    minHeight: 200,
  };

  const inner = (
    <>
      {showImage ? (
        <img
          src={displayImage}
          alt=""
          className="absolute inset-0 z-[1] h-full w-full object-cover pointer-events-none"
          loading="lazy"
          decoding="async"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div
          className="absolute inset-0 z-[1] pointer-events-none flex items-center justify-center text-4xl leading-none select-none"
          style={{ background: TEA_HERO_GRADIENTS[idx % TEA_HERO_GRADIENTS.length] }}
          aria-hidden
        >
          ☕
        </div>
      )}
      {showImage ? (
        <div
          className="absolute inset-0 z-[2] pointer-events-none"
          style={{
            background:
              'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.15) 40%, transparent 60%)',
          }}
        />
      ) : (
        <div className="absolute inset-0 z-[2] pointer-events-none bg-gradient-to-t from-black/88 via-black/25 to-transparent" />
      )}
      <div className="absolute inset-x-0 bottom-0 z-[3] p-3 pt-8 bg-gradient-to-t from-black via-black/80 to-transparent pointer-events-none">
        <p className="text-sm font-semibold leading-snug line-clamp-4" style={{ color: '#fff' }}>
          {item.title}
        </p>
      </div>
    </>
  );

  return (
    <div className={cardClassName} style={cardStyle}>
      <button
        type="button"
        onClick={() => onSelect(item)}
        disabled={!item.url}
        className="absolute inset-0 z-[4] cursor-pointer border-0 bg-transparent p-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0F0F0F] focus-visible:ring-[#A855F7] disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={item.title}
      />
      {inner}
    </div>
  );
}

/**
 * Detea — trending gossip from r/BollyBlindsNGossip (public Reddit JSON, no API key).
 */
export default function TrendingTea() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search || ''}`;

  const [teaData, setTeaData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const openShareSuggestions = useCallback(
    (item) => {
      if (!item.url) return;
      navigate('/share-suggestions', {
        state: {
          newsArticle: {
            title: item.title,
            url: item.url,
            description: '',
            image: getTeaHeroImageUrl(item),
            source: 'r/BollyBlindsNGossip',
          },
          returnTo,
          platform: 'linkedin',
        },
      });
    },
    [navigate, returnTo]
  );

  const HUB = {
    bg: '#0F0F0F',
    text: '#FFFFFF',
    textSecondary: '#A0A0A0',
    divider: '#1E1E1E',
    accent: '#A855F7',
  };

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;

    const run = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const t = withTimeoutSignal(9000, ac.signal);
        let json = null;
        try {
          const res = await fetch(REDDIT_HOT_URL, {
            signal: t.signal,
            headers: { Accept: 'application/json' },
            cache: 'no-store',
          });
          if (res.ok) {
            json = await res.json().catch(() => null);
          } else {
            // If Reddit responds but is blocked/limited, fall back to proxy attempt.
            json = await fetchRedditJsonViaProxies(REDDIT_HOT_URL, { signal: t.signal });
            if (!json) throw new Error(`Could not load tea (${res.status})`);
          }
        } catch (e) {
          if (e?.name === 'AbortError') throw e;
          // Network/CORS/adblock failures: retry via public proxies.
          json = await fetchRedditJsonViaProxies(REDDIT_HOT_URL, { signal: t.signal });
          if (!json) throw e;
        } finally {
          t.cleanup();
        }

        const children = json?.data?.children;
        if (!Array.isArray(children)) {
          throw new Error('Unexpected response from Reddit');
        }
        const rawPosts = children.map((c) => c?.data).filter(Boolean);
        const filteredPosts = filterPosts(rawPosts);
        const mapped = filteredPosts
          .map((d) => mapRedditChildToTea({ data: d }))
          .filter(Boolean)
          .slice(0, 10);
        if (!cancelled) {
          setTeaData(mapped);
          writeTrendingTeaUrlsAndPruneShareCache(mapped);
        }
      } catch (e) {
        if (e.name === 'AbortError') return;
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Something went wrong');
          setTeaData([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, []);

  const cardClass = 'rounded-2xl overflow-hidden';
  const cardStyle = { background: HUB.bg, border: `1px solid ${HUB.divider}` };
  const headerBorder = { borderBottom: `1px solid ${HUB.divider}` };

  return (
    <div className={cardClass} style={cardStyle}>
      <div className="flex items-center justify-between px-4 py-4" style={headerBorder}>
        <div className="flex items-center space-x-3 min-w-0">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${HUB.accent}30` }}
          >
            <Flame className="w-4 h-4" style={{ color: HUB.accent }} strokeWidth={2} />
          </div>
          <h2 className="text-lg font-semibold truncate min-w-0" style={{ color: HUB.text }}>
            Tea
          </h2>
        </div>
      </div>

      <div className="py-3 pl-4">
        {isLoading && <CardSkeleton count={4} />}

        {!isLoading && error && (
          <div
            className="rounded-xl px-3 py-4 text-sm text-center mr-4"
            style={{
              background: 'rgba(239, 68, 68, 0.12)',
              color: '#FCA5A5',
              border: '1px solid rgba(239, 68, 68, 0.25)',
            }}
            role="alert"
          >
            {error}
          </div>
        )}

        {!isLoading && !error && teaData.length === 0 && (
          <p className="text-sm text-center py-8 pr-4" style={{ color: HUB.textSecondary }}>
            No posts right now.
          </p>
        )}

        {!isLoading && !error && teaData.length > 0 && (
          <div
            className="flex gap-3 overflow-x-auto overflow-y-hidden pb-2 pr-4 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ WebkitOverflowScrolling: 'touch' }}
            role="region"
            aria-label="Tea gossip carousel"
          >
            {teaData.map((item, idx) => (
              <TeaTrendingCard
                key={item.id}
                item={item}
                idx={idx}
                HUB={HUB}
                onSelect={openShareSuggestions}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
