import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  Bookmark,
  Heart,
  MessageCircle,
} from 'lucide-react';
import { compactCommentBody, fetchTeaThreadComments } from '../lib/redditThreadComments';
import { getTeaWatchlist, toggleTeaWatchlistItem } from '../lib/teaWatchlistStorage';

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

function TeaCommentsSheet({ item, entry, onClose }) {
  const status = entry?.status ?? 'idle';
  const comments = entry?.comments ?? [];

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col justify-end bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tea-comments-title"
      onClick={onClose}
    >
      <div
        className="max-h-[min(88dvh,900px)] w-full overflow-hidden rounded-t-3xl border border-white/10 bg-[#0c0c0c] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 id="tea-comments-title" className="pr-8 text-base font-extrabold text-white">
            Comments
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3 py-1.5 text-sm font-semibold text-white/80 transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7]"
          >
            Close
          </button>
        </div>
        <div className="max-h-[min(72dvh,720px)] overflow-y-auto px-4 py-3 [-webkit-overflow-scrolling:touch]">
          {status === 'loading' || status === 'idle' ? (
            <p className="py-8 text-center text-sm font-medium" style={{ color: HUB.muted }}>
              Loading comments…
            </p>
          ) : null}
          {status === 'error' ? (
            <div className="py-6 text-center text-sm" style={{ color: HUB.muted }}>
              <p className="mb-3 font-medium">Couldn’t load comments.</p>
              {item?.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold underline decoration-white/30 underline-offset-2"
                  style={{ color: HUB.accent }}
                >
                  View on Reddit
                </a>
              ) : null}
            </div>
          ) : null}
          {status === 'loaded' && comments.length === 0 ? (
            <p className="py-8 text-center text-sm font-medium" style={{ color: HUB.muted }}>
              No comments to show.
            </p>
          ) : null}
          {status === 'loaded' &&
            comments.map((c) => (
              <div
                key={c.id}
                className="mb-3 rounded-xl border border-white/8 bg-white/[0.04] px-3 py-2.5 last:mb-0"
              >
                <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-[12px] font-semibold">
                  <span className="text-white/90">u/{c.author}</span>
                  <span style={{ color: HUB.muted }}>{c.score} pts</span>
                </div>
                <p className="whitespace-pre-wrap text-left text-[14px] leading-relaxed text-white/88">
                  {compactCommentBody(c.body, 2000)}
                </p>
              </div>
            ))}
        </div>
        {item?.url ? (
          <div className="border-t border-white/10 px-4 py-3">
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full rounded-xl py-2.5 text-center text-sm font-bold"
              style={{
                color: HUB.accent,
                backgroundColor: 'rgba(168,85,247,0.15)',
                border: '1px solid rgba(168,85,247,0.35)',
              }}
            >
              Open full thread on Reddit
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TeaSlide({
  item,
  idx,
  liked,
  onToggleLike,
  scrollRootRef,
  commentEntry,
  onRequestComments,
  onOpenComments,
  watchlisted,
  onToggleWatchlist,
}) {
  const sectionRef = useRef(null);
  const url = heroImageForItem(item);
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = Boolean(url) && !imgFailed;

  useEffect(() => {
    const el = sectionRef.current;
    if (!el || !item.url) return;
    const root = scrollRootRef?.current ?? null;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.42);
        if (hit) onRequestComments(item);
      },
      { root, threshold: [0, 0.25, 0.42, 0.6, 1], rootMargin: '0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [item, item.id, item.url, onRequestComments, scrollRootRef]);

  const commentsStatus = commentEntry?.status ?? 'idle';
  const comments = commentEntry?.comments ?? [];
  const topPreview = comments.length > 0 ? comments[0] : null;

  return (
    <section
      ref={sectionRef}
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
          onClick={() => onOpenComments(item)}
          disabled={!item.url}
          className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/10 backdrop-blur-sm transition active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7] disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`Comments${item.num_comments != null ? `, ${item.num_comments} total` : ''}`}
        >
          <MessageCircle className="h-6 w-6 text-white" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={() => onToggleWatchlist(item)}
          disabled={!item.url}
          className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/10 backdrop-blur-sm transition active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7] disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={watchlisted ? 'Remove from watchlist' : 'Save to watchlist'}
          aria-pressed={watchlisted}
        >
          <Bookmark
            className="h-6 w-6"
            strokeWidth={2}
            style={{
              color: '#fff',
              fill: watchlisted ? 'rgba(168,85,247,0.45)' : 'transparent',
              stroke: watchlisted ? '#C084FC' : '#fff',
            }}
          />
        </button>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-[2] px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] pt-24 pointer-events-none">
        <div className="pointer-events-auto max-w-[calc(100vw-5rem)] space-y-2.5">
          {item.url && commentsStatus === 'loaded' && topPreview ? (
            <button
              type="button"
              key={`preview-${item.id}-${topPreview.id}`}
              onClick={() => onOpenComments(item)}
              className="group relative z-[1] mb-1 w-full max-w-full rounded-full border border-white/18 bg-black/50 px-5 py-3.5 text-left shadow-[0_-8px_32px_rgba(0,0,0,0.45)] backdrop-blur-md transition active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7]"
              aria-label="Open comments"
            >
              <p className="line-clamp-2 text-left text-[13px] font-medium leading-snug text-white/90">
                {compactCommentBody(topPreview.body, 160)}
              </p>
            </button>
          ) : null}

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
  const [watchlistedIds, setWatchlistedIds] = useState(
    () => new Set(getTeaWatchlist().map((x) => String(x.id)))
  );
  /** @type {Record<string, { status: string, comments: Array<{id:string,author:string,body:string,score:number}>, error: string|null }>} */
  const [commentsByPostId, setCommentsByPostId] = useState({});
  const feedScrollRef = useRef(null);

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

  const refreshWatchlistIds = useCallback(() => {
    setWatchlistedIds(new Set(getTeaWatchlist().map((x) => String(x.id))));
  }, []);

  useEffect(() => {
    const onUpdate = () => refreshWatchlistIds();
    window.addEventListener('teaWatchlistUpdated', onUpdate);
    window.addEventListener('storage', onUpdate);
    return () => {
      window.removeEventListener('teaWatchlistUpdated', onUpdate);
      window.removeEventListener('storage', onUpdate);
    };
  }, [refreshWatchlistIds]);

  const toggleWatchlist = useCallback((item) => {
    if (!item?.url) return;
    toggleTeaWatchlistItem(item);
    refreshWatchlistIds();
    try {
      window.dispatchEvent(new CustomEvent('teaWatchlistUpdated'));
    } catch (_) {
      /* ignore */
    }
  }, [refreshWatchlistIds]);

  const requestComments = useCallback((item) => {
    const postId = item?.id;
    if (!postId || !item?.url) return;
    setCommentsByPostId((prev) => {
      const cur = prev[postId];
      if (cur?.status === 'loading' || cur?.status === 'loaded') return prev;
      return { ...prev, [postId]: { status: 'loading', comments: [], error: null } };
    });

    (async () => {
      const res = await fetchTeaThreadComments(item.url);
      setCommentsByPostId((prev) => {
        const cur = prev[postId];
        if (cur?.status === 'loaded') return prev;
        if (res.error === 'aborted') return prev;
        if (res.ok) {
          return { ...prev, [postId]: { status: 'loaded', comments: res.comments, error: null } };
        }
        return { ...prev, [postId]: { status: 'error', comments: [], error: res.error || 'Failed' } };
      });
    })();
  }, []);

  const [commentsModalPostId, setCommentsModalPostId] = useState(null);
  const commentsModalItem = useMemo(
    () => items.find((i) => i.id === commentsModalPostId) ?? null,
    [items, commentsModalPostId]
  );

  const openCommentsModal = useCallback(
    (item) => {
      if (!item?.id || !item.url) return;
      setCommentsModalPostId(item.id);
      requestComments(item);
    },
    [requestComments]
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
          ref={feedScrollRef}
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
              scrollRootRef={feedScrollRef}
              commentEntry={commentsByPostId[item.id]}
              onRequestComments={requestComments}
              onOpenComments={openCommentsModal}
              watchlisted={watchlistedIds.has(String(item.id))}
              onToggleWatchlist={toggleWatchlist}
            />
          ))}
        </div>
      )}

      {commentsModalItem ? (
        <TeaCommentsSheet
          item={commentsModalItem}
          entry={commentsByPostId[commentsModalItem.id]}
          onClose={() => setCommentsModalPostId(null)}
        />
      ) : null}
    </div>
  );
}
