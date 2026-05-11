import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  Bookmark,
  Heart,
  Share2,
} from 'lucide-react';

function isDirectImageUrl(postUrl) {
  if (typeof postUrl !== 'string' || !postUrl.trim()) return false;
  const path = postUrl.trim().split('?')[0].split('#')[0];
  return /\.(jpe?g|png|gif|webp)$/i.test(path);
}

function heroImageForItem(item) {
  const isValidThumbnail =
    typeof item.thumbnail === 'string' && item.thumbnail.trim().startsWith('http');
  if (isDirectImageUrl(item.postUrl)) return item.postUrl.trim();
  if (isValidThumbnail) return item.thumbnail.trim();
  return null;
}

const FALLBACK_GRADIENTS = [
  'linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)',
  'linear-gradient(135deg,#2d132c 0%,#801336 50%,#c72c41 100%)',
  'linear-gradient(135deg,#0f2027 0%,#203a43 50%,#2c5364 100%)',
  'linear-gradient(135deg,#1e3c72 0%,#2a5298 50%,#7e8ba3 100%)',
  'linear-gradient(135deg,#232526 0%,#414345 100%)',
];

const HUB = {
  bg: '#000000',
  text: '#FFFFFF',
  muted: 'rgba(255,255,255,0.62)',
  accent: '#A855F7',
  divider: 'rgba(255,255,255,0.08)',
  pillBg: 'rgba(168,85,247,0.22)',
};

function TeaSlide({ item, idx, liked, onToggleLike, onShare }) {
  const url = heroImageForItem(item);
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = Boolean(url) && !imgFailed;

  const description = `${item.num_comments ?? 0} comments · ${item.score ?? 0} upvotes`;

  return (
    <section
      className="relative h-[100dvh] w-full shrink-0 snap-start snap-always overflow-hidden bg-black"
      aria-roledescription="slide"
    >
      {showImg ? (
        <img
          src={url}
          alt=""
          className="absolute inset-0 h-full w-full object-contain object-center"
          loading={idx < 2 ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div
          className="absolute inset-0 flex items-center justify-center text-5xl select-none"
          style={{ background: FALLBACK_GRADIENTS[idx % FALLBACK_GRADIENTS.length] }}
          aria-hidden
        >
          ☕
        </div>
      )}

      <div
        className="absolute inset-0 pointer-events-none z-[1]"
        style={{
          background:
            'linear-gradient(to top, rgba(0,0,0,0.94) 0%, rgba(0,0,0,0.35) 45%, transparent 72%)',
        }}
      />

      <div className="absolute right-3 bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] z-[3] flex flex-col gap-5 pointer-events-auto">
        <button
          type="button"
          onClick={() => onToggleLike(item.id)}
          className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/10 backdrop-blur-sm transition active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7]"
          aria-label={liked ? 'Unlike' : 'Like'}
          aria-pressed={liked}
        >
          <Heart
            className="h-6 w-6"
            strokeWidth={2}
            style={{
              color: '#fff',
              fill: liked ? 'rgba(239,68,68,0.9)' : 'transparent',
              stroke: liked ? 'rgba(239,68,68,0.95)' : '#fff',
            }}
          />
        </button>
        <button
          type="button"
          className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/10 backdrop-blur-sm transition active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7]"
          aria-label="Bookmark"
        >
          <Bookmark className="h-6 w-6 text-white" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={onShare}
          className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/10 backdrop-blur-sm transition active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7]"
          aria-label="Share"
        >
          <Share2 className="h-6 w-6 text-white" strokeWidth={2} />
        </button>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-[2] px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] pt-24 pointer-events-none">
        <div className="pointer-events-auto max-w-[calc(100vw-5rem)] space-y-2.5">
          <span
            className="inline-block rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide"
            style={{
              color: HUB.accent,
              backgroundColor: HUB.pillBg,
              border: '1px solid rgba(168,85,247,0.35)',
            }}
          >
            Gossip
          </span>
          <h1 className="text-2xl font-extrabold leading-tight tracking-tight text-white drop-shadow-md">
            {item.title}
          </h1>
          <p className="line-clamp-2 text-[15px] font-medium leading-snug" style={{ color: HUB.muted }}>
            {description}
          </p>
          <div className="flex items-center gap-2 pt-1 text-[13px] font-semibold" style={{ color: HUB.muted }}>
            <span>r/BollyBlindsNGossip</span>
            <span aria-hidden>·</span>
            <span>u/{item.author}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Fullscreen vertical snap feed (swipe / scroll up for next card), TikTok-style.
 */
export default function TeaFeedPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo =
    typeof location.state?.returnTo === 'string' && location.state.returnTo.startsWith('/')
      ? location.state.returnTo
      : '/dashboard';

  const rawItems = Array.isArray(location.state?.teaItems) ? location.state.teaItems : [];

  const [tab, setTab] = useState('forYou');
  const [liked, setLiked] = useState(() => new Set());

  const items = useMemo(() => {
    if (tab === 'trending') {
      return [...rawItems].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    }
    return rawItems;
  }, [rawItems, tab]);

  const goBack = useCallback(() => {
    navigate(returnTo, { replace: true });
  }, [navigate, returnTo]);

  const toggleLike = useCallback((id) => {
    setLiked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const shareItem = useCallback(
    (item) => {
      const url = item.url || '';
      const title = item.title || 'Tea';
      if (navigator.share && url) {
        navigator.share({ title, url }).catch(() => {});
      } else if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    },
    []
  );

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <header
        className="relative z-[110] flex shrink-0 items-center justify-between gap-2 border-b px-3 pb-3 pt-1"
        style={{
          borderColor: HUB.divider,
          background: 'rgba(10,8,14,0.72)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <button
          type="button"
          onClick={goBack}
          className="flex h-10 w-10 items-center justify-center rounded-full text-white transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7]"
          aria-label="Go back"
        >
          <ArrowLeft className="h-6 w-6" strokeWidth={2} />
        </button>

        <h1 className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[17px] font-extrabold tracking-tight text-white">
          Tea
        </h1>

        <div className="flex min-w-[10.5rem] justify-end gap-1">
          <button
            type="button"
            onClick={() => setTab('forYou')}
            className="rounded-full px-2.5 py-1.5 text-xs font-bold transition"
            style={{
              color: tab === 'forYou' ? HUB.accent : HUB.muted,
              backgroundColor: tab === 'forYou' ? 'rgba(168,85,247,0.22)' : 'transparent',
            }}
          >
            For You
          </button>
          <button
            type="button"
            onClick={() => setTab('trending')}
            className="rounded-full px-2.5 py-1.5 text-xs font-bold transition"
            style={{
              color: tab === 'trending' ? HUB.accent : HUB.muted,
              backgroundColor: tab === 'trending' ? 'rgba(168,85,247,0.22)' : 'transparent',
            }}
          >
            Trending
          </button>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-base font-medium" style={{ color: HUB.muted }}>
            No tea stories to show yet. Pull to refresh the dashboard and try again.
          </p>
          <button
            type="button"
            onClick={goBack}
            className="rounded-full px-5 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98]"
            style={{ backgroundColor: 'rgba(168,85,247,0.35)', border: `1px solid ${HUB.divider}` }}
          >
            Go back
          </button>
        </div>
      ) : (
        <div
          key={tab}
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden snap-y snap-mandatory scroll-smooth [-webkit-overflow-scrolling:touch]"
          role="feed"
          aria-label="Tea vertical feed, swipe up for next"
        >
          {items.map((item, idx) => (
            <TeaSlide
              key={item.id}
              item={item}
              idx={idx}
              liked={liked.has(item.id)}
              onToggleLike={toggleLike}
              onShare={() => shareItem(item)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
