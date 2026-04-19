import React, { useEffect, useState } from 'react';
import { Loader2, Flame } from 'lucide-react';

const REDDIT_HOT_URL =
  'https://www.reddit.com/r/BollyBlindsNGossip/hot.json?limit=10';

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

/**
 * Resolves preview image + handles load failures (broken icons).
 */
function TeaPostMedia({ postUrl, thumbnail, isDarkMode }) {
  const isValidThumbnail =
    typeof thumbnail === 'string' && thumbnail.trim().startsWith('http');
  const isDirectImage = isDirectImageUrl(postUrl);

  let displayImage = null;
  if (isDirectImage) displayImage = postUrl.trim();
  else if (isValidThumbnail) displayImage = thumbnail.trim();

  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [postUrl, thumbnail]);

  const showImage = Boolean(displayImage) && !imgFailed;

  const placeholderBg = isDarkMode ? 'rgba(30, 30, 30, 0.95)' : 'rgba(55, 55, 55, 0.35)';
  const placeholderBorder = isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';

  return (
    <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg">
      {showImage ? (
        <img
          src={displayImage}
          alt="Tea preview"
          className="h-14 w-14 object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div
          className="flex h-14 w-14 items-center justify-center rounded-lg text-xl leading-none select-none"
          style={{
            backgroundColor: placeholderBg,
            border: `1px solid ${placeholderBorder}`,
          }}
          role="img"
          aria-label="Text-only gossip, no preview"
        >
          ☕
        </div>
      )}
    </div>
  );
}

/**
 * Detea — trending gossip from r/BollyBlindsNGossip (public Reddit JSON, no API key).
 */
export default function TrendingTea({ isDarkMode }) {
  const [teaData, setTeaData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

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
        const res = await fetch(REDDIT_HOT_URL, {
          signal: ac.signal,
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          throw new Error(`Could not load tea (${res.status})`);
        }
        const json = await res.json();
        const children = json?.data?.children;
        if (!Array.isArray(children)) {
          throw new Error('Unexpected response from Reddit');
        }
        const mapped = children
          .map(mapRedditChildToTea)
          .filter(Boolean);
        if (!cancelled) setTeaData(mapped);
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
        {isLoading && (
          <div
            className="flex items-center justify-center gap-2 py-10 pr-4"
            style={{ color: HUB.textSecondary }}
            role="status"
            aria-live="polite"
          >
            <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" aria-hidden />
            <span className="text-sm">Steeping the latest tea…</span>
          </div>
        )}

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
            {teaData.map((item) => (
              <article
                key={item.id}
                className="flex-shrink-0 w-[min(260px,78vw)] snap-start snap-always rounded-xl p-3 transition-opacity hover:opacity-95"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: `1px solid ${HUB.divider}`,
                  minHeight: 200,
                }}
              >
                <div className="flex h-full min-h-0 flex-col gap-3">
                  <div className="flex gap-3">
                    <TeaPostMedia
                      postUrl={item.postUrl}
                      thumbnail={item.thumbnail}
                      isDarkMode={isDarkMode}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-[15px] font-bold leading-snug line-clamp-4"
                        style={{ color: HUB.text }}
                      >
                        {item.title}
                      </p>
                    </div>
                  </div>
                  <div
                    className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
                    style={{ color: HUB.textSecondary }}
                  >
                    <span className="inline-flex items-center gap-1">
                      <span aria-hidden>🔥</span>
                      <span>{item.score}</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span aria-hidden>💬</span>
                      <span>{item.num_comments}</span>
                    </span>
                    <span
                      className={`truncate max-w-full ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}
                    >
                      @{item.author}
                    </span>
                  </div>
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex w-full justify-center text-sm font-medium rounded-lg px-3 py-2 transition-colors active:scale-[0.98]"
                      style={{
                        background: `${HUB.accent}22`,
                        color: HUB.accent,
                      }}
                    >
                      Read Full Tea
                    </a>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
