import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Flame, Heart } from 'lucide-react';
import { getCurrentUser, onAuthStateChange } from '../services/authService';
import { incrementHubNewsEngagement, recordHubNewsClick } from '../services/hubNewsService';
import { getHubTrendingMergedFromFirestore } from '../services/cachedNewsService';
import { resolveArticleHeroImage } from '../lib/podTopicNewsShared';
import CardSkeleton from './skeleton/CardSkeleton';

/**
 * Keeps the last successful hub merge in memory so navigating away (e.g. Sports) and back
 * does not reset to “Loading…” or block on another Firestore/NewsAPI round-trip.
 */
let hubTrendingFeedCache = {
  /** @type {Array<object>|null} */
  items: null,
};

function getCachedHubTrendingItems() {
  const arr = hubTrendingFeedCache.items;
  return Array.isArray(arr) && arr.length > 0 ? arr : null;
}

function isDisplayableImageSrc(u) {
  const s = typeof u === 'string' ? u.trim() : '';
  return Boolean(s && (/^https?:\/\//i.test(s) || s.startsWith('data:')));
}

/**
 * Horizontal swipe card — same image rules as Sports `SportsTrendingCard` (NewsAPI urlToImage + data URLs).
 */
function HubTrendingCard({ item, idx, HUB, userId, engagementEnabled, navigate, returnTo, scrollRootRef }) {
  const rootRef = useRef(null);
  const src = typeof item.image === 'string' ? item.image.trim() : '';
  const showApiImg = Boolean(src && (/^https?:\/\//i.test(src) || src.startsWith('data:')));
  const [heroFailed, setHeroFailed] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState(null);
  const [liked, setLiked] = useState(() =>
    item.id ? sessionStorage.getItem(`hn_like_${item.id}`) === '1' : false
  );

  useEffect(() => {
    setHeroFailed(false);
    setResolvedUrl(null);
  }, [item.id, item.url, item.image]);

  useEffect(() => {
    if (!item.url) return;
    if (item.fromNewsApiFallback) return;
    if (showApiImg && !heroFailed) return;
    if (resolvedUrl) return;

    const el = rootRef.current;
    let cancelled = false;

    const applyResolved = (u) => {
      const s = typeof u === 'string' ? u.trim() : '';
      if (cancelled) return;
      if (/^https?:\/\//i.test(s) && !/^data:/i.test(s)) {
        setResolvedUrl(s);
        setHeroFailed(false);
      } else if (isDisplayableImageSrc(s)) {
        setResolvedUrl(s);
      }
    };

    const runResolve = () => {
      resolveArticleHeroImage(String(item.url).trim(), {
        publisherUrl: String(item.publisherUrl || '').trim(),
      }).then(applyResolved);
    };

    if (idx < 8) {
      runResolve();
      return () => {
        cancelled = true;
      };
    }

    if (!el || typeof IntersectionObserver === 'undefined') {
      runResolve();
      return () => {
        cancelled = true;
      };
    }

    const root = scrollRootRef?.current || null;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (!e?.isIntersecting || cancelled) return;
        io.disconnect();
        runResolve();
      },
      {
        root: root && root instanceof Element ? root : null,
        rootMargin: '80px 200px 80px 200px',
        threshold: 0.01,
      }
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [item.url, item.publisherUrl, showApiImg, heroFailed, resolvedUrl, idx, scrollRootRef]);

  const displaySrc =
    showApiImg && !heroFailed ? src : resolvedUrl && isDisplayableImageSrc(resolvedUrl) ? resolvedUrl : '';
  const showImg = Boolean(displaySrc);

  useEffect(() => {
    if (!engagementEnabled || !userId || !item.id) return;
    const key = `hn_view_${item.id}`;
    if (sessionStorage.getItem(key)) return;
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (e?.isIntersecting && e.intersectionRatio >= 0.4) {
          sessionStorage.setItem(key, '1');
          incrementHubNewsEngagement(item.id, 'view');
          io.disconnect();
        }
      },
      { threshold: [0.4, 0.9] }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [engagementEnabled, userId, item.id]);

  const onLike = useCallback(
    async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!engagementEnabled || !userId || !item.id) return;
      if (sessionStorage.getItem(`hn_like_${item.id}`)) return;
      sessionStorage.setItem(`hn_like_${item.id}`, '1');
      setLiked(true);
      await incrementHubNewsEngagement(item.id, 'like');
    },
    [engagementEnabled, userId, item.id]
  );

  const openShareSuggestions = useCallback(() => {
    if (!item.url) return;
    if (userId && item.category) recordHubNewsClick(userId, item.category);
    const shareImage =
      showImg && /^https?:\/\//i.test(displaySrc)
        ? displaySrc
        : /^https?:\/\//i.test(String(item.image || '').trim())
          ? String(item.image).trim()
          : null;
    navigate('/share-suggestions', {
      state: {
        newsArticle: {
          title: item.title,
          url: item.url,
          description: item.description || '',
          image: shareImage,
          source: item.source || '',
        },
        returnTo,
      },
    });
  }, [item, userId, navigate, returnTo, showImg, displaySrc]);

  const gradients = [
    'linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)',
    'linear-gradient(135deg,#2d132c 0%,#801336 50%,#c72c41 100%)',
    'linear-gradient(135deg,#0f2027 0%,#203a43 50%,#2c5364 100%)',
    'linear-gradient(135deg,#1e3c72 0%,#2a5298 50%,#7e8ba3 100%)',
    'linear-gradient(135deg,#232526 0%,#414345 100%)',
  ];
  return (
    <div
      ref={rootRef}
      className="relative flex-shrink-0 w-[min(260px,78vw)] snap-start snap-always rounded-xl overflow-hidden border transition-transform active:scale-[0.98] hover:opacity-95"
      style={{
        borderColor: HUB.divider,
        minHeight: 200,
      }}
    >
      <button
        type="button"
        onClick={openShareSuggestions}
        disabled={!item.url}
        className="absolute inset-0 z-0 cursor-pointer border-0 bg-transparent p-0 text-left disabled:cursor-not-allowed disabled:opacity-60"
        aria-label={item.title}
      />
      {showImg ? (
        <img
          src={displaySrc}
          alt=""
          className="absolute inset-0 z-[1] h-full w-full object-cover pointer-events-none"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => {
            setHeroFailed(true);
            setResolvedUrl(null);
          }}
        />
      ) : (
        <div
          className="absolute inset-0 z-[1] pointer-events-none"
          style={{ background: gradients[idx % gradients.length] }}
        />
      )}
      {showImg ? (
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
      {engagementEnabled && userId ? (
        <div className="absolute top-2 right-2 z-[4] flex gap-1 pointer-events-auto">
          <button
            type="button"
            onClick={onLike}
            className="w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-sm border border-white/15"
            style={{ background: 'rgba(0,0,0,0.45)', color: liked ? '#f472b6' : 'rgba(255,255,255,0.9)' }}
            aria-label={liked ? 'Liked' : 'Like'}
          >
            <Heart className="w-4 h-4" fill={liked ? 'currentColor' : 'none'} strokeWidth={2} />
          </button>
        </div>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 z-[3] p-3 pt-8 bg-gradient-to-t from-black via-black/80 to-transparent pointer-events-none">
        <p className="text-sm font-semibold leading-snug line-clamp-4" style={{ color: '#fff' }}>
          {item.title}
        </p>
      </div>
    </div>
  );
}

/**
 * Hub (Crew home) personalized trending — horizontal swipe carousel (matches Sports trending).
 */
export default function HubTrendingFeed({ isDarkMode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search || ''}`;
  const [userId, setUserId] = useState(() => getCurrentUser()?.uid || null);
  const [items, setItems] = useState(() => getCachedHubTrendingItems() || []);
  const [loading, setLoading] = useState(() => !getCachedHubTrendingItems());
  const [error, setError] = useState('');
  const loadGenRef = useRef(0);
  const carouselScrollRef = useRef(null);

  useEffect(() => {
    const unsub = onAuthStateChange((u) => setUserId(u?.uid || null));
    return () => unsub();
  }, []);

  const load = useCallback(async () => {
    const gen = ++loadGenRef.current;
    const hadCached = Boolean(getCachedHubTrendingItems()?.length);
    if (!hadCached) {
      setLoading(true);
    }
    setError('');
    try {
      const res = await getHubTrendingMergedFromFirestore();
      if (gen !== loadGenRef.current) return;
      if (!res.success) {
        if (!hadCached) {
          setItems([]);
          setError(res.error || 'Could not load feed');
        }
        return;
      }
      const next = res.items || [];
      hubTrendingFeedCache.items = next;
      setItems(next);
      setError('');
    } catch (e) {
      if (gen !== loadGenRef.current) return;
      if (!hadCached) {
        setItems([]);
        setError(e?.message || 'Could not load feed');
      }
    } finally {
      if (gen !== loadGenRef.current) return;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const HUB = {
    bg: '#0F0F0F',
    text: '#FFFFFF',
    textSecondary: '#A0A0A0',
    divider: '#1E1E1E',
    accent: '#A855F7',
  };

  const cardStyle = {
    background: isDarkMode ? HUB.bg : '#FFFFFF',
    border: `1px solid ${isDarkMode ? HUB.divider : '#E5E7EB'}`,
  };
  const headerBorder = { borderBottom: `1px solid ${isDarkMode ? HUB.divider : '#E5E7EB'}` };

  const carouselItems = items.slice(0, 15);

  return (
    <div className="rounded-2xl overflow-hidden mb-4" style={cardStyle}>
      <div className="flex items-center gap-2 px-4 py-4" style={headerBorder}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${HUB.accent}30` }}>
          <Flame className="w-4 h-4" style={{ color: HUB.accent }} strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>News</h2>
        </div>
      </div>
      <div className="py-3 pl-4">
        {loading && items.length === 0 ? (
          <CardSkeleton count={4} />
        ) : error && items.length === 0 ? (
          <p className={`text-sm pr-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>{error}</p>
        ) : items.length === 0 ? (
          <p className={`text-sm pr-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            No headlines yet. The server refreshes categories on a schedule—deploy the `newsIngestScheduler` function and set API keys on Firebase Functions.
          </p>
        ) : (
          <div
            ref={carouselScrollRef}
            className="flex gap-3 overflow-x-auto overflow-y-hidden pb-2 pr-4 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ WebkitOverflowScrolling: 'touch' }}
            role="region"
            aria-label="News carousel"
          >
            {carouselItems.map((item, idx) => (
              <HubTrendingCard
                key={item.id ? String(item.id) : `trend-${idx}-${item.url || ''}`}
                item={item}
                idx={idx}
                HUB={HUB}
                userId={userId}
                engagementEnabled={userId && !item.fromNewsApiFallback}
                navigate={navigate}
                returnTo={returnTo}
                scrollRootRef={carouselScrollRef}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
