import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
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

/** Primary comment body (brighter, slightly larger than meta). */
const COMMENT_BODY_PRIMARY = { color: 'rgba(241,245,249,0.96)', fontSize: '15px', lineHeight: 1.45 };

/** Fallback when Tailwind text opacity utilities fail. */
const COMMENT_BODY_FALLBACK = { color: '#e2e8f0' };

const URL_IN_TEXT = /(https?:\/\/[^\s]+)/gi;
/** Markdown-style links [label](url) — excluded from the floating comment preview. */
const MARKDOWN_LINK_RE = /\[[^\]]*\]\([^)]+\)/;

const TEA_PREVIEW_FADE_IN_MS = 150;
const TEA_PREVIEW_VISIBLE_MS = 2200;
const TEA_PREVIEW_FADE_OUT_MS = 200;
const TEA_PREVIEW_CYCLE_TOTAL_MS =
  TEA_PREVIEW_FADE_IN_MS + TEA_PREVIEW_VISIBLE_MS + TEA_PREVIEW_FADE_OUT_MS;

const USERNAME_MAX = 17;

function commentBodyHasLinkLikeContent(body) {
  if (typeof body !== 'string' || !body.trim()) return false;
  if (/https?:\/\/\S/i.test(body)) return true;
  if (/www\.\S/i.test(body)) return true;
  if (MARKDOWN_LINK_RE.test(body)) return true;
  return false;
}

/** First loaded comment safe to show in the preview chip (plain text only, no URLs). */
function firstTextOnlyCommentForPreview(comments) {
  if (!Array.isArray(comments)) return null;
  for (const c of comments) {
    const body = c?.body;
    if (typeof body !== 'string' || !body.trim()) continue;
    if (commentBodyHasLinkLikeContent(body)) continue;
    const compact = compactCommentBody(body, 2000).trim();
    if (!compact) continue;
    return c;
  }
  return null;
}

/** Instagram-ish cleanup: trim suffix noise, cap length. */
function formatTeaUsername(raw) {
  let s = typeof raw === 'string' ? raw.trim() : '';
  if (!s || s === '[deleted]') return 'unknown';
  s = s.replace(/^u\//i, '');
  s = s.replace(/-(\d{2,})$/i, '');
  s = s.replace(/_(\d{2,})$/i, '');
  s = s.replace(/-/g, '');
  if (s.length <= USERNAME_MAX) return s;
  return `${s.slice(0, USERNAME_MAX - 1)}…`;
}

function avatarInitials(name) {
  const t = formatTeaUsername(name).replace(/[^a-zA-Z0-9]/g, ' ');
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
  return (parts[0] || '?').slice(0, 2).toUpperCase();
}

function shortRelativeTime(createdUtc) {
  if (typeof createdUtc !== 'number' || !Number.isFinite(createdUtc)) return '';
  const sec = Math.max(0, Date.now() / 1000 - createdUtc);
  if (sec < 60) return 'now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}d`;
  return `${Math.floor(sec / (86400 * 30))}mo`;
}

function teaHaptic(style = 'light') {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(style === 'medium' ? [10, 4, 10] : 8);
    }
  } catch (_) {
    /* ignore */
  }
}

function hrefForDetectedUrl(raw) {
  const trimmed = raw.replace(/[),.;!?]+$/g, '');
  try {
    const u = new URL(trimmed);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch (_) {
    /* ignore */
  }
  return null;
}

function TeaCommentRichText({ text, className, paragraphStyle }) {
  const chunks = typeof text === 'string' ? text.split(URL_IN_TEXT) : [];
  return (
    <p className={className} style={{ ...COMMENT_BODY_FALLBACK, ...paragraphStyle }}>
      {chunks.map((chunk, i) => {
        if (!chunk) return null;
        const href = /^https?:\/\//i.test(chunk) ? hrefForDetectedUrl(chunk) : null;
        if (href) {
          return (
            <a
              key={i}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline decoration-white/25 underline-offset-2 hover:decoration-[#A855F7]/80"
              style={{ color: HUB.accent, wordBreak: 'break-all' }}
            >
              {chunk}
            </a>
          );
        }
        return <span key={i}>{chunk}</span>;
      })}
    </p>
  );
}

const QUICK_EMOJIS = ['❤️', '🔥', '👏', '😂', '✨', '😮'];

const TeaCommentRow = memo(function TeaCommentRow({ comment, liked, onToggleLike }) {
  const label = formatTeaUsername(comment.author);
  const when = shortRelativeTime(comment.createdUtc);
  const scoreLabel =
    typeof comment.score === 'number' && comment.score > 999
      ? `${(comment.score / 1000).toFixed(1)}k`
      : String(comment.score ?? 0);

  return (
    <div
      className="flex gap-3 border-b border-white/[0.07] py-3.5 pl-1 pr-0"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '88px' }}
    >
      <div
        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 text-[11px] font-bold text-white/65"
        style={{ backgroundColor: 'rgba(255,255,255,0.07)' }}
        aria-hidden
      >
        {avatarInitials(comment.author)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0">
          <span
            className="text-[12px] font-medium tracking-tight"
            style={{ color: 'rgba(255,255,255,0.42)' }}
          >
            {label}
          </span>
          {when ? (
            <>
              <span className="text-[11px] text-white/22" aria-hidden>
                ·
              </span>
              <span className="text-[10px] font-medium text-white/30">{when}</span>
            </>
          ) : null}
        </div>
        <TeaCommentRichText
          text={compactCommentBody(comment.body, 2000)}
          className="mt-1 whitespace-pre-wrap break-words text-left font-normal leading-snug"
          paragraphStyle={COMMENT_BODY_PRIMARY}
        />
        <button
          type="button"
          className="mt-2 text-left text-[12px] font-semibold text-white/32 transition hover:text-white/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7]/60 disabled:opacity-40"
          disabled
          title="Coming soon"
        >
          Reply
        </button>
      </div>
      <div className="flex w-11 shrink-0 flex-col items-center justify-center self-stretch py-1">
        <button
          type="button"
          onClick={() => onToggleLike(comment.id)}
          className="flex flex-col items-center gap-0.5 rounded-xl px-1 py-1 transition hover:bg-white/6 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7]/50"
          aria-pressed={liked}
          aria-label={liked ? 'Unlike comment' : 'Like comment'}
        >
          <Heart
            className="h-[18px] w-[18px]"
            strokeWidth={2}
            fill={liked ? 'rgba(244,63,94,0.88)' : 'transparent'}
            stroke={liked ? 'rgba(244,63,94,0.95)' : 'rgba(255,255,255,0.38)'}
          />
          <span
            className="text-[10px] font-semibold tabular-nums"
            style={{ color: 'rgba(255,255,255,0.35)' }}
          >
            {scoreLabel}
          </span>
        </button>
      </div>
    </div>
  );
});

const TeaCommentsPanel = forwardRef(function TeaCommentsPanel({ item, entry, onClose }, ref) {
  const status = entry?.status ?? 'idle';
  const comments = entry?.comments ?? [];

  const textOnlyComments = useMemo(
    () =>
      comments.filter((c) => {
        const body = c?.body;
        if (typeof body !== 'string' || !body.trim()) return false;
        if (commentBodyHasLinkLikeContent(body)) return false;
        return Boolean(compactCommentBody(body, 2000).trim());
      }),
    [comments]
  );

  const panelRootRef = useRef(null);
  const listRef = useRef(null);
  const [draft, setDraft] = useState('');
  const [likedMap, setLikedMap] = useState(() => ({}));
  const [keyboardPad, setKeyboardPad] = useState(0);
  const inputRef = useRef(null);

  const dragYRef = useRef(0);
  const [dragY, setDragY] = useState(0);
  const [panelTransition, setPanelTransition] = useState('');
  const dragActiveRef = useRef(false);
  const dragOriginRef = useRef({ clientY: 0, startDrag: 0 });
  const closingAnimRef = useRef(false);

  const setDrag = useCallback((y) => {
    const v = Math.max(0, y);
    dragYRef.current = v;
    setDragY(v);
  }, []);

  const beginAnimatedDismiss = useCallback(() => {
    if (closingAnimRef.current) return;
    const H = typeof window !== 'undefined' ? window.innerHeight : 800;
    closingAnimRef.current = true;
    setPanelTransition('transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)');
    requestAnimationFrame(() => setDrag(H));
    teaHaptic('medium');
  }, [setDrag]);

  useImperativeHandle(ref, () => ({ dismiss: beginAnimatedDismiss }), [beginAnimatedDismiss]);

  const onDismissPointerDown = useCallback((e) => {
    if (closingAnimRef.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragActiveRef.current = true;
    setPanelTransition('none');
    dragOriginRef.current = { clientY: e.clientY, startDrag: dragYRef.current };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onDismissPointerMove = useCallback(
    (e) => {
      if (!dragActiveRef.current) return;
      const dy = e.clientY - dragOriginRef.current.clientY;
      setDrag(Math.max(0, dragOriginRef.current.startDrag + dy));
    },
    [setDrag]
  );

  const endDismissDrag = useCallback(() => {
    dragActiveRef.current = false;
    const H = typeof window !== 'undefined' ? window.innerHeight : 800;
    const threshold = Math.max(72, H * 0.1);
    if (dragYRef.current > threshold) {
      beginAnimatedDismiss();
    } else {
      setPanelTransition('transform 0.22s ease-out');
      setDrag(0);
    }
  }, [beginAnimatedDismiss, setDrag]);

  const onDismissPointerUp = useCallback(
    (e) => {
      if (!dragActiveRef.current) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (_) {
        /* ignore */
      }
      endDismissDrag();
    },
    [endDismissDrag]
  );

  const onPanelTransitionEnd = useCallback(
    (e) => {
      if (e.target !== panelRootRef.current || e.propertyName !== 'transform') return;
      if (closingAnimRef.current) {
        closingAnimRef.current = false;
        onClose();
      }
    },
    [onClose]
  );

  const toggleCommentLike = useCallback((id) => {
    setLikedMap((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const appendEmoji = useCallback((emo) => {
    setDraft((d) => `${d}${emo}`);
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const update = () => {
      const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardPad(overlap);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return (
    <div
      ref={panelRootRef}
      className="relative flex min-h-0 flex-1 flex-col border-t border-white/10 bg-[#0c0c0c]"
      role="region"
      aria-labelledby="tea-comments-title"
      aria-describedby="tea-comments-panel-hint"
      onTransitionEnd={onPanelTransitionEnd}
      style={{
        transform: `translateY(${dragY}px)`,
        transition: panelTransition,
        willChange: panelTransition && panelTransition !== 'none' ? 'transform' : undefined,
      }}
    >
      <div
        className="relative flex shrink-0 touch-none cursor-grab select-none flex-col items-center justify-center border-b border-white/[0.08] px-3 py-3 active:cursor-grabbing"
        onPointerDown={onDismissPointerDown}
        onPointerMove={onDismissPointerMove}
        onPointerUp={onDismissPointerUp}
        onPointerCancel={onDismissPointerUp}
      >
        <div className="flex flex-col items-center gap-1.5">
          <div className="h-1 w-11 shrink-0 rounded-full bg-white/28" aria-hidden />
          <h2 id="tea-comments-title" className="text-[15px] font-bold tracking-tight text-white">
            Comments
          </h2>
        </div>
      </div>
      <p id="tea-comments-panel-hint" className="sr-only">
        Swipe down on the handle or title bar to hide comments and return to the full feed, or tap
        the post image. Press Escape to close.
      </p>

      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto px-3 [-webkit-overflow-scrolling:touch]"
      >
        {status === 'loading' || status === 'idle' ? (
          <p className="py-10 text-center text-sm font-medium" style={{ color: HUB.muted }}>
            Loading comments…
          </p>
        ) : null}
        {status === 'error' ? (
          <div className="py-8 text-center text-sm" style={{ color: HUB.muted }}>
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
          <p className="py-10 text-center text-sm font-medium" style={{ color: HUB.muted }}>
            No comments to show.
          </p>
        ) : null}
        {status === 'loaded' && comments.length > 0 && textOnlyComments.length === 0 ? (
          <p className="py-10 text-center text-sm font-medium" style={{ color: HUB.muted }}>
            No plain-text comments to show here. Open Reddit for the full thread.
          </p>
        ) : null}
        {status === 'loaded' && textOnlyComments.length > 0 ? (
          <div className="pb-2 pt-1">
            <p className="sr-only" aria-live="polite">
              {textOnlyComments.length} text comments shown
            </p>
            {textOnlyComments.map((c) => (
              <TeaCommentRow
                key={c.id}
                comment={c}
                liked={Boolean(likedMap[c.id])}
                onToggleLike={toggleCommentLike}
              />
            ))}
            <p className="py-3 text-center text-[11px] font-medium text-white/28">
              View replies on Reddit (lazy)
            </p>
          </div>
        ) : null}
      </div>

      <div
        className="shrink-0 border-t border-white/[0.08] bg-[#090909] px-3 pt-2"
        style={{
          paddingBottom: `max(env(safe-area-inset-bottom, 0px), ${keyboardPad}px, 10px)`,
        }}
      >
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {QUICK_EMOJIS.map((emo) => (
            <button
              key={emo}
              type="button"
              onClick={() => appendEmoji(emo)}
              className="flex h-9 min-w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-lg transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7]/50"
              aria-label={`Add ${emo}`}
            >
              {emo}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2 pb-2">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a comment…"
            rows={1}
            className="min-h-[44px] flex-1 resize-none rounded-2xl border border-white/12 bg-white/[0.06] px-3.5 py-2.5 text-[15px] leading-snug text-white placeholder:text-white/35 focus:border-[#A855F7]/45 focus:outline-none focus:ring-2 focus:ring-[#A855F7]/25"
            style={{ maxHeight: 120 }}
          />
          <button
            type="button"
            disabled={!draft.trim()}
            title={draft.trim() ? 'Posting from Deite is coming soon' : undefined}
            className="mb-0.5 flex h-11 shrink-0 items-center justify-center rounded-2xl bg-[#A855F7]/90 px-4 text-sm font-bold text-white shadow-lg transition enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="Send comment"
          >
            Post
          </button>
        </div>
      </div>
    </div>
  );
});

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
  splitFeed,
  commentsPanelOpen,
  commentsModalPostId,
  onDismissCommentsViaImage,
  onOpenShareSuggestions,
}) {
  const sectionRef = useRef(null);
  const url = heroImageForItem(item);
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = Boolean(url) && !imgFailed;
  const dismissCommentsOverlayActive = Boolean(
    splitFeed && commentsModalPostId && item.id === commentsModalPostId
  );
  const heroOpensShareSuggestions = Boolean(
    item.url && onOpenShareSuggestions && !dismissCommentsOverlayActive
  );

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
  const textOnlyPreview = useMemo(() => firstTextOnlyCommentForPreview(comments), [comments]);
  const [previewDismissed, setPreviewDismissed] = useState(false);

  useEffect(() => {
    setPreviewDismissed(false);
  }, [item.id]);

  useEffect(() => {
    if (commentsPanelOpen) setPreviewDismissed(true);
  }, [commentsPanelOpen]);

  const showCommentPreviewButton = Boolean(
    item.url &&
      commentsStatus === 'loaded' &&
      textOnlyPreview &&
      !commentsPanelOpen &&
      !previewDismissed
  );

  useEffect(() => {
    if (!showCommentPreviewButton) return undefined;
    const mq =
      typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (!mq?.matches) return undefined;
    const id = window.setTimeout(() => setPreviewDismissed(true), TEA_PREVIEW_CYCLE_TOTAL_MS);
    return () => window.clearTimeout(id);
  }, [showCommentPreviewButton]);

  return (
    <section
      ref={sectionRef}
      className={`relative w-full shrink-0 snap-start snap-always overflow-hidden bg-black ${
        splitFeed ? 'h-full min-h-0' : 'h-[100dvh]'
      }`}
      aria-roledescription="slide"
    >
      {showImg ? (
        <img
          src={url}
          alt=""
          className={`absolute inset-0 h-full w-full object-contain object-center ${
            heroOpensShareSuggestions ? 'cursor-pointer' : ''
          }`}
          loading={idx < 2 ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setImgFailed(true)}
          role={heroOpensShareSuggestions ? 'button' : undefined}
          tabIndex={heroOpensShareSuggestions ? 0 : undefined}
          aria-label={heroOpensShareSuggestions ? 'Open share suggestions for this post' : undefined}
          onKeyDown={
            heroOpensShareSuggestions
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenShareSuggestions(item);
                  }
                }
              : undefined
          }
          onClick={
            heroOpensShareSuggestions
              ? () => {
                  onOpenShareSuggestions(item);
                }
              : undefined
          }
        />
      ) : (
        <div
          className={`absolute inset-0 flex items-center justify-center text-5xl select-none ${
            heroOpensShareSuggestions ? 'cursor-pointer' : ''
          }`}
          style={{ background: FALLBACK_GRADIENTS[idx % FALLBACK_GRADIENTS.length] }}
          aria-hidden={!heroOpensShareSuggestions}
          role={heroOpensShareSuggestions ? 'button' : undefined}
          tabIndex={heroOpensShareSuggestions ? 0 : undefined}
          aria-label={heroOpensShareSuggestions ? 'Open share suggestions for this post' : undefined}
          onKeyDown={
            heroOpensShareSuggestions
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenShareSuggestions(item);
                  }
                }
              : undefined
          }
          onClick={heroOpensShareSuggestions ? () => onOpenShareSuggestions(item) : undefined}
        >
          ☕
        </div>
      )}

      {splitFeed && commentsModalPostId && item.id === commentsModalPostId ? (
        <button
          type="button"
          className="absolute inset-0 z-[2] cursor-pointer border-0 bg-transparent p-0 transition-colors hover:bg-white/[0.03] active:bg-white/[0.05]"
          aria-label="Hide comments and show full post"
          onClick={() => onDismissCommentsViaImage?.()}
        />
      ) : null}

      <div
        className="absolute inset-0 pointer-events-none z-[1]"
        style={{
          background: splitFeed
            ? 'linear-gradient(to top, rgba(0,0,0,0.35) 0%, transparent 55%)'
            : 'linear-gradient(to top, rgba(0,0,0,0.94) 0%, rgba(0,0,0,0.35) 45%, transparent 72%)',
        }}
      />

      {!splitFeed ? (
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
      ) : null}

      {!splitFeed ? (
        <div className="absolute inset-x-0 bottom-0 z-[2] px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] pt-24 pointer-events-none">
          <div className="pointer-events-auto max-w-[calc(100vw-5rem)] space-y-2.5">
            {showCommentPreviewButton ? (
              <button
                type="button"
                key={`preview-${item.id}-${textOnlyPreview.id}`}
                onClick={() => onOpenComments(item)}
                onAnimationEnd={(e) => {
                  if (e.animationName === 'teaCommentPreviewCycle') setPreviewDismissed(true);
                }}
                className="tea-comment-preview-cycle group relative z-[1] mb-1 w-full max-w-full rounded-full border border-white/18 bg-black/50 px-5 py-3.5 text-left shadow-[0_-8px_32px_rgba(0,0,0,0.45)] backdrop-blur-md transition-transform duration-150 active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7]"
                aria-label="Open comments"
              >
                <TeaCommentRichText
                  text={compactCommentBody(textOnlyPreview.body, 160)}
                  className="line-clamp-2 text-left text-[13px] font-medium leading-snug"
                />
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
      ) : null}
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
  /** @type {Record<string, { status: string, comments: Array<{id:string,author:string,body:string,score:number,createdUtc?:number|null}>, error: string|null }>} */
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

  const openShareSuggestionsFromTea = useCallback(
    (item) => {
      if (!item?.url) return;
      navigate('/share-suggestions', {
        state: {
          newsArticle: {
            title: item.title || '',
            url: item.url,
            description: '',
            image: heroImageForItem(item),
            source: 'r/BollyBlindsNGossip',
          },
          returnTo: '/tea-feed',
          returnState: { teaItems: rawItems, returnTo },
          platform: 'linkedin',
        },
      });
    },
    [navigate, rawItems, returnTo]
  );

  const commentsPanelRef = useRef(null);
  const dismissCommentsAnimated = useCallback(() => {
    commentsPanelRef.current?.dismiss?.();
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] flex min-h-0 flex-col bg-black"
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
      ) : commentsModalItem ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 max-h-[44dvh] flex-[0_1_38%] flex-col">
            <div
              ref={feedScrollRef}
              key={tab}
              className="h-full min-h-0 flex-1 overflow-y-auto overflow-x-hidden snap-y snap-mandatory scroll-smooth [-webkit-overflow-scrolling:touch]"
              role="feed"
              aria-label="Tea vertical feed, swipe up for next"
            >
              {items.map((item, idx) => (
                <div key={item.id} className="h-full w-full shrink-0 snap-start snap-always">
                  <TeaSlide
                    item={item}
                    idx={idx}
                    splitFeed
                    commentsPanelOpen={Boolean(commentsModalItem)}
                    commentsModalPostId={commentsModalItem.id}
                    onDismissCommentsViaImage={dismissCommentsAnimated}
                    onOpenShareSuggestions={openShareSuggestionsFromTea}
                    liked={liked.has(item.id)}
                    onToggleLike={toggleLike}
                    scrollRootRef={feedScrollRef}
                    commentEntry={commentsByPostId[item.id]}
                    onRequestComments={requestComments}
                    onOpenComments={openCommentsModal}
                    watchlisted={watchlistedIds.has(String(item.id))}
                    onToggleWatchlist={toggleWatchlist}
                  />
                </div>
              ))}
            </div>
          </div>
          <TeaCommentsPanel
            ref={commentsPanelRef}
            key={commentsModalItem.id}
            item={commentsModalItem}
            entry={commentsByPostId[commentsModalItem.id]}
            onClose={() => setCommentsModalPostId(null)}
          />
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
              commentsPanelOpen={Boolean(commentsModalItem)}
              onOpenShareSuggestions={openShareSuggestionsFromTea}
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

    </div>
  );
}
