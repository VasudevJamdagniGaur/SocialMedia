import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Sparkles, ChevronRight, Heart, Flame } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { onAuthStateChange, getCurrentUser } from '../services/authService';
import firestoreService from '../services/firestoreService';
import { googleNewsSearchUrl } from '../lib/podTopicNewsShared';
import {
  prefetchAllSportsExploreTopicsNow,
  prefetchSportsTopicRaw,
} from '../lib/podSportsTopicPrefetchCache';
import {
  isLikelySportsTrendingItem,
  classifyExploreSlugForTrending,
} from '../lib/sportsTrendingPersonalization';
import {
  getSportsPersonalizationWeights,
  recordSportsSurfaceSeconds,
} from '../services/sportsPersonalizationService';
import { recordHubVerticalDwell } from '../services/hubVerticalPersonalizationService';
import { recordHubNewsClick } from '../services/hubNewsService';
import { getNewsWithLiveFallback } from '../services/cachedNewsService';

/** Engagement rank plus same-city boost (Firestore `trendingScore` is likes×3 + shares×5 + views). */
function effectiveSportsTrendRank(item, userCityNorm) {
  const base = Number(item.trendingScore) || 0;
  const ic = String(item.city || '').trim().toLowerCase();
  const boost = userCityNorm && ic && ic === userCityNorm ? 50 : 0;
  return base + boost;
}

/**
 * Carousel card — tap opens share suggestions; optional like when signed in.
 */
function SportsTrendingCard({ item, idx, HUB, isSignedIn, navigate, returnTo }) {
  const rootRef = useRef(null);
  const [liked, setLiked] = useState(() =>
    item.firestoreId ? sessionStorage.getItem(`st_liked_${item.firestoreId}`) === '1' : false
  );
  const [heroFailed, setHeroFailed] = useState(false);

  const gradients = [
    'linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)',
    'linear-gradient(135deg,#2d132c 0%,#801336 50%,#c72c41 100%)',
    'linear-gradient(135deg,#0f2027 0%,#203a43 50%,#2c5364 100%)',
    'linear-gradient(135deg,#1e3c72 0%,#2a5298 50%,#7e8ba3 100%)',
    'linear-gradient(135deg,#232526 0%,#414345 100%)',
  ];

  const src = typeof item.image === 'string' ? item.image.trim() : '';
  const showImg = Boolean(src && (/^https?:\/\//i.test(src) || src.startsWith('data:')));

  useEffect(() => {
    setHeroFailed(false);
  }, [src]);

  const openShareSuggestions = useCallback(() => {
    if (!item.url) return;
    const u = getCurrentUser();
    if (u?.uid) {
      const cat = classifyExploreSlugForTrending(item);
      void recordHubNewsClick(u.uid, cat);
    }
    navigate('/share-suggestions', {
      state: {
        newsArticle: {
          title: item.title,
          url: item.url,
          description: item.description || '',
          image: item.image || null,
          source: item.source || '',
        },
        returnTo,
      },
    });
  }, [item, navigate, returnTo]);

  useEffect(() => {
    if (!isSignedIn || !item.firestoreId) return;
    const key = `st_view_${item.firestoreId}`;
    if (sessionStorage.getItem(key)) return;
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (e?.isIntersecting && e.intersectionRatio >= 0.45) {
          sessionStorage.setItem(key, '1');
          firestoreService.incrementSportsTrendingEngagement(item.firestoreId, 'view');
          io.disconnect();
        }
      },
      { threshold: [0.45, 0.9] }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [isSignedIn, item.firestoreId]);

  const onLike = useCallback(
    async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isSignedIn || !item.firestoreId) return;
      if (sessionStorage.getItem(`st_liked_${item.firestoreId}`)) return;
      sessionStorage.setItem(`st_liked_${item.firestoreId}`, '1');
      setLiked(true);
      await firestoreService.incrementSportsTrendingEngagement(item.firestoreId, 'like');
    },
    [isSignedIn, item.firestoreId]
  );

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
      {showImg && !heroFailed ? (
        <img
          src={src}
          alt=""
          className="absolute inset-0 z-[1] h-full w-full object-cover pointer-events-none"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setHeroFailed(true)}
        />
      ) : (
        <div
          className="absolute inset-0 z-[1] pointer-events-none"
          style={{ background: gradients[idx % gradients.length] }}
        />
      )}
      {showImg && !heroFailed ? (
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
      {isSignedIn && item.firestoreId ? (
        <div className="absolute top-2 right-2 z-[4] flex gap-1 pointer-events-auto">
          <button
            type="button"
            onClick={onLike}
            className="w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-sm border border-white/15"
            style={{ background: 'rgba(0,0,0,0.45)', color: liked ? '#f472b6' : 'rgba(255,255,255,0.9)' }}
            aria-label={liked ? 'Liked' : 'Like story'}
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

const HUB_COLORS = {
  bg: '#0F0F0F',
  text: '#FFFFFF',
  textSecondary: '#A0A0A0',
  divider: '#1E1E1E',
  accent: '#A855F7',
};

export default function PodSportsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search || ''}`;
  const { isDarkMode } = useTheme();
  const [sportsTrending, setSportsTrending] = useState([]);
  const [isLoadingSportsNews, setIsLoadingSportsNews] = useState(false);
  const [sportsNewsError, setSportsNewsError] = useState('');
  const [trendingRegionLabel, setTrendingRegionLabel] = useState('');
  const [userId, setUserId] = useState(() => getCurrentUser()?.uid || null);
  const [refreshing, setRefreshing] = useState(false);
  const [pullProgress, setPullProgress] = useState(0);

  const loadTokenRef = useRef(0);
  const pullStartYRef = useRef(null);
  const pullDistanceRef = useRef(0);

  const SPORTS_EXPLORE = [
    { label: 'Cricket', slug: 'cricket' },
    { label: 'Football', slug: 'football' },
    { label: 'F1', slug: 'f1' },
    { label: 'Chess', slug: 'chess' },
    { label: 'Others', slug: 'others' },
  ];

  useEffect(() => {
    const unsub = onAuthStateChange((u) => setUserId(u?.uid || null));
    return () => unsub();
  }, []);

  /** Eager-load all Explore feeds in parallel when Sports hub opens. */
  useEffect(() => {
    void prefetchAllSportsExploreTopicsNow();
  }, []);

  useEffect(() => {
    recordHubVerticalDwell('sports', 0, 1);
  }, []);

  const loadSportsNews = useCallback(async (opts = {}) => {
    const skipLoadingBar = !!opts.skipLoadingBar;
    const token = ++loadTokenRef.current;

    if (!skipLoadingBar) {
      setIsLoadingSportsNews(true);
      setSportsNewsError('');
    }

    setTrendingRegionLabel('Server-cached feed');

    const fallbackTrending = [
      {
        title: 'Global football season enters decisive phase',
        source: 'Sports Desk',
        image: null,
        url: googleNewsSearchUrl('football soccer news'),
      },
      {
        title: 'Cricket boards announce major tournament updates',
        source: 'Sports Desk',
        image: null,
        url: googleNewsSearchUrl('cricket news'),
      },
      {
        title: 'F1 teams prepare new aero packages for upcoming races',
        source: 'Motorsport Wire',
        image: null,
        url: googleNewsSearchUrl('Formula 1 news'),
      },
      {
        title: 'Top chess stars set for high-stakes rapid events',
        source: 'Chess Chronicle',
        image: null,
        url: googleNewsSearchUrl('chess grandmaster news'),
      },
    ];

    try {
      const { success, articles, error, fallbackError } = await getNewsWithLiveFallback('sports');
      if (token !== loadTokenRef.current) return;
      if (!success) {
        setSportsTrending(fallbackTrending);
        setSportsNewsError(
          fallbackError || error || 'Could not load sports headlines (Firestore or NewsAPI).'
        );
        return;
      }

      const user = getCurrentUser();
      const userCityNorm = '';

      let merged = articles.map((a) => ({
        title: a.title,
        source: a.source,
        url: a.url,
        image: a.image,
        publishedAt: a.publishedAt,
        description: a.description || '',
        city: null,
        firestoreId: null,
        trendingScore: 0,
        likes: 0,
        shares: 0,
        views: 0,
      }));

      const filtered = merged.filter(isLikelySportsTrendingItem);
      if (filtered.length >= 4) merged = filtered;

      const weights = await getSportsPersonalizationWeights(user?.uid || null);
      merged.sort((a, b) => {
        const clsA = classifyExploreSlugForTrending(a);
        const clsB = classifyExploreSlugForTrending(b);
        const ra = effectiveSportsTrendRank(a, userCityNorm) + (weights[clsA] || 0);
        const rb = effectiveSportsTrendRank(b, userCityNorm) + (weights[clsB] || 0);
        if (rb !== ra) return rb - ra;
        const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
        const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
        if (tb !== ta) return tb - ta;
        return (b.createdAtMs || 0) - (a.createdAtMs || 0);
      });

      if (token !== loadTokenRef.current) return;
      const baseRows = merged.length ? merged.slice(0, 10) : fallbackTrending;
      setSportsTrending(baseRows);
      setSportsNewsError(
        merged.length
          ? ''
          : fallbackError ||
              'No sports headlines. Set REACT_APP_NEWSAPI in .env for local dev, or deploy newsIngestScheduler with keys on Functions.'
      );
    } catch (e) {
      if (token !== loadTokenRef.current) return;
      setSportsTrending(fallbackTrending);
      setSportsNewsError(e?.message || 'Could not load cached headlines.');
    } finally {
      if (token === loadTokenRef.current && !skipLoadingBar) {
        setIsLoadingSportsNews(false);
      }
    }
  }, []);

  useEffect(() => {
    loadSportsNews();
    return () => {
      loadTokenRef.current += 1;
    };
  }, [loadSportsNews]);

  useEffect(() => {
    let start = Date.now();
    const flush = () => {
      const sec = Math.min(900, Math.round((Date.now() - start) / 1000));
      start = Date.now();
      if (sec >= 4) {
        recordSportsSurfaceSeconds(sec);
        recordHubVerticalDwell('sports', sec, 0);
      }
    };
    const onVis = () => {
      if (document.hidden) flush();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      flush();
    };
  }, []);

  const HUB = {
    bg: HUB_COLORS.bg,
    text: HUB_COLORS.text,
    textSecondary: HUB_COLORS.textSecondary,
    divider: HUB_COLORS.divider,
    accent: HUB_COLORS.accent,
  };
  const cardStyle = { background: HUB.bg, border: `1px solid ${HUB.divider}` };

  const getScrollTop = () => {
    const se = document.scrollingElement;
    if (se) return se.scrollTop || 0;
    return window.scrollY || document.documentElement.scrollTop || 0;
  };

  const isAtTop = () => getScrollTop() <= 0;

  const runHardRefresh = useCallback(async () => {
    setRefreshing(true);
    setPullProgress(0);
    try {
      await loadSportsNews({ skipLoadingBar: true });
    } finally {
      setRefreshing(false);
      setPullProgress(0);
    }
  }, [loadSportsNews]);

  const onTouchStart = (e) => {
    if (isLoadingSportsNews || refreshing) return;
    if (!isAtTop()) return;
    if (!e.touches || e.touches.length !== 1) return;
    pullStartYRef.current = e.touches[0].clientY;
    pullDistanceRef.current = 0;
    setPullProgress(0);
  };

  const onTouchMove = (e) => {
    if (isLoadingSportsNews || refreshing) return;
    if (!isAtTop()) return;
    if (pullStartYRef.current == null) return;
    if (!e.touches || e.touches.length !== 1) return;
    const currentY = e.touches[0].clientY;
    const delta = currentY - pullStartYRef.current;
    if (delta <= 0) return;
    pullDistanceRef.current = delta;
    setPullProgress(Math.max(0, Math.min(1, delta / 80)));
  };

  const onTouchEnd = () => {
    if (isLoadingSportsNews || refreshing) return;
    if (pullStartYRef.current == null) return;
    const delta = pullDistanceRef.current;
    pullStartYRef.current = null;
    pullDistanceRef.current = 0;
    if (isAtTop() && delta >= 70) {
      void runHardRefresh();
    } else {
      setPullProgress(0);
    }
  };

  return (
    <div
      className="min-h-screen px-6 relative overflow-hidden slide-up"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
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
            onClick={() => navigate('/pod')}
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={cardStyle}
            aria-label="Back to Crew"
          >
            <ArrowLeft className="w-5 h-5" style={{ color: HUB.text }} />
          </button>
          <h1 className="text-xl font-bold" style={{ color: HUB.text }}>Sports</h1>
        </div>

        <div
          className="h-8 flex items-center justify-center text-sm -mt-2 mb-2"
          style={{ color: HUB.textSecondary }}
          aria-live="polite"
        >
          {refreshing
            ? 'Refreshing…'
            : pullProgress > 0
              ? pullProgress >= 0.9
                ? 'Release to refresh'
                : 'Pull to refresh'
              : null}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl overflow-hidden mb-1" style={cardStyle}>
            <div className="flex items-center gap-2 px-4 py-4" style={{ borderBottom: `1px solid ${HUB.divider}` }}>
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ backgroundColor: `${HUB.accent}30` }}
              >
                <Flame className="w-4 h-4" style={{ color: HUB.accent }} strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold" style={{ color: HUB.text }}>Trending</h2>
                {trendingRegionLabel ? (
                  <p className="text-xs mt-0.5 truncate" style={{ color: HUB.textSecondary }}>
                    {trendingRegionLabel}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="py-3 pl-4">
              {isLoadingSportsNews ? (
                <p className="text-sm pr-4" style={{ color: HUB.textSecondary }}>
                  Loading cached sports headlines…
                </p>
              ) : (
                <>
                  <div
                    className="flex gap-3 overflow-x-auto overflow-y-hidden pb-2 pr-4 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    style={{ WebkitOverflowScrolling: 'touch' }}
                    role="region"
                    aria-label={
                      trendingRegionLabel
                        ? `Trending sports headlines in ${trendingRegionLabel}`
                        : 'Trending sports headlines'
                    }
                  >
                    {sportsTrending.slice(0, 10).map((item, idx) => (
                      <SportsTrendingCard
                        key={`${item.firestoreId || item.url}-${idx}`}
                        item={item}
                        idx={idx}
                        HUB={HUB}
                        isSignedIn={!!userId}
                        navigate={navigate}
                        returnTo={returnTo}
                      />
                    ))}
                  </div>
                  {!!sportsNewsError && (
                    <p className="text-xs mt-2 pr-4" style={{ color: HUB.textSecondary }}>{sportsNewsError}</p>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="rounded-2xl overflow-hidden" style={cardStyle}>
            <div className="flex items-center justify-between px-4 py-4" style={{ borderBottom: `1px solid ${HUB.divider}` }}>
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" style={{ color: HUB.accent }} />
                <h2 className="text-base font-semibold" style={{ color: HUB.text }}>Explore</h2>
              </div>
            </div>
            <div className="px-4 py-2">
              {SPORTS_EXPLORE.map((row, index) => (
                <button
                  key={row.slug}
                  type="button"
                  onClick={() => {
                    navigate(`/pod/sports/topic/${row.slug}`);
                    // Warm cache in background — never block navigation on prefetch (stalled/hung requests
                    // from hub-wide prefetch would otherwise prevent navigate from ever running).
                    void prefetchSportsTopicRaw(row.slug).catch(() => {});
                  }}
                  className="w-full flex items-center justify-between py-3 text-left transition-opacity hover:opacity-90"
                  style={{
                    borderTop: index === 0 ? 'none' : `1px solid ${HUB.divider}`,
                  }}
                >
                  <span className="text-sm font-medium" style={{ color: HUB.text }}>{row.label}</span>
                  <ChevronRight className="w-4 h-4" style={{ color: HUB.textSecondary }} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
