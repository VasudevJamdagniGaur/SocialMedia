import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Sparkles, ChevronRight, Heart, Share2 } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { onAuthStateChange, getCurrentUser } from '../services/authService';
import firestoreService from '../services/firestoreService';
import {
  getNewsApiKey,
  fetchNewsApiTopHeadlinesRaw,
  normalizeArticles,
  resolveUserNewsRegionForNewsApi,
} from '../lib/podTopicNewsShared';

function docIdForTrendingUrl(url) {
  return firestoreService.sportsTrendingDocIdFromUrl(url);
}

/**
 * Carousel card: link to article + optional engagement (signed-in users, Firestore-backed).
 */
function SportsTrendingCard({ item, idx, HUB, isSignedIn }) {
  const rootRef = useRef(null);
  const [liked, setLiked] = useState(() =>
    item.firestoreId ? sessionStorage.getItem(`st_liked_${item.firestoreId}`) === '1' : false
  );

  const gradients = [
    'linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)',
    'linear-gradient(135deg,#2d132c 0%,#801336 50%,#c72c41 100%)',
    'linear-gradient(135deg,#0f2027 0%,#203a43 50%,#2c5364 100%)',
    'linear-gradient(135deg,#1e3c72 0%,#2a5298 50%,#7e8ba3 100%)',
    'linear-gradient(135deg,#232526 0%,#414345 100%)',
  ];
  const bg = item.image
    ? `linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.15) 40%, transparent 60%), url(${item.image}) center/cover no-repeat`
    : gradients[idx % gradients.length];

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

  const onShare = useCallback(
    async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isSignedIn || !item.firestoreId) return;
      const url = item.url || '';
      try {
        if (url && typeof navigator !== 'undefined' && navigator.share) {
          await navigator.share({ title: item.title, url });
        }
      } catch {
        /* user cancelled or share failed */
      }
      await firestoreService.incrementSportsTrendingEngagement(item.firestoreId, 'share');
    },
    [isSignedIn, item.firestoreId, item.title, item.url]
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
      <a
        href={item.url || undefined}
        target={item.url ? '_blank' : undefined}
        rel={item.url ? 'noopener noreferrer' : undefined}
        className="absolute inset-0 z-0"
        aria-label={item.title}
      />
      <div
        className="absolute inset-0 z-[1] pointer-events-none"
        style={{
          background: bg,
          backgroundSize: item.image ? 'cover' : 'auto',
          backgroundPosition: item.image ? 'center' : undefined,
        }}
      />
      {isSignedIn && item.firestoreId ? (
        <div className="absolute top-2 right-2 z-[3] flex gap-1 pointer-events-auto">
          <button
            type="button"
            onClick={onLike}
            className="w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-sm border border-white/15"
            style={{ background: 'rgba(0,0,0,0.45)', color: liked ? '#f472b6' : 'rgba(255,255,255,0.9)' }}
            aria-label={liked ? 'Liked' : 'Like story'}
          >
            <Heart className="w-4 h-4" fill={liked ? 'currentColor' : 'none'} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={onShare}
            className="w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-sm border border-white/15"
            style={{ background: 'rgba(0,0,0,0.45)', color: 'rgba(255,255,255,0.9)' }}
            aria-label="Share story"
          >
            <Share2 className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 z-[2] p-3 pt-10 bg-gradient-to-t from-black via-black/80 to-transparent pointer-events-none">
        <p className="text-sm font-semibold leading-snug line-clamp-3" style={{ color: '#fff' }}>
          {item.title}
        </p>
        <p
          className="text-[11px] mt-1.5 font-medium uppercase tracking-wide"
          style={{ color: 'rgba(255,255,255,0.65)' }}
        >
          {item.source}
          {typeof item.trendingScore === 'number' && item.trendingScore > 0 ? (
            <span className="normal-case ml-1.5 opacity-90">· score {item.trendingScore}</span>
          ) : null}
        </p>
      </div>
    </div>
  );
}

export default function PodSportsPage() {
  const navigate = useNavigate();
  const { isDarkMode } = useTheme();
  const [sportsTrending, setSportsTrending] = useState([]);
  const [isLoadingSportsNews, setIsLoadingSportsNews] = useState(false);
  const [sportsNewsError, setSportsNewsError] = useState('');
  const [trendingRegionLabel, setTrendingRegionLabel] = useState('');
  const [userId, setUserId] = useState(() => getCurrentUser()?.uid || null);
  const [communityRanking, setCommunityRanking] = useState(false);

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

  useEffect(() => {
    const apiKey = getNewsApiKey();
    let cancelled = false;

    const fallbackTrending = [
      { title: 'Global football season enters decisive phase', source: 'Sports Desk', image: null },
      { title: 'Cricket boards announce major tournament updates', source: 'Sports Desk', image: null },
      { title: 'F1 teams prepare new aero packages for upcoming races', source: 'Motorsport Wire', image: null },
      { title: 'Top chess stars set for high-stakes rapid events', source: 'Chess Chronicle', image: null },
    ];

    const loadSportsNews = async () => {
      setIsLoadingSportsNews(true);
      setSportsNewsError('');
      setCommunityRanking(false);
      try {
        const { code: country, label: regionLabel } = await resolveUserNewsRegionForNewsApi();
        const countryUpper = String(country || 'us').toUpperCase().slice(0, 2);
        if (!cancelled) setTrendingRegionLabel(regionLabel);

        const user = getCurrentUser();

        if (!apiKey) {
          if (!cancelled) {
            setSportsTrending(fallbackTrending);
            setSportsNewsError('Set REACT_APP_NEWSAPI in .env to load live headlines.');
          }
          return;
        }

        let articles = await fetchNewsApiTopHeadlinesRaw({
          category: 'sports',
          country,
          language: 'en',
          pageSize: 12,
        });
        if (!articles.length) {
          articles = await fetchNewsApiTopHeadlinesRaw({
            category: 'sports',
            country,
            language: false,
            pageSize: 12,
          });
        }

        const newsNormalized = normalizeArticles(articles).map((a) => ({
          title: a.title,
          source: a.source,
          url: a.url,
          image: a.image,
          firestoreId: docIdForTrendingUrl(a.url),
          trendingScore: 0,
          likes: 0,
          shares: 0,
          views: 0,
        }));

        let merged = [];

        if (user) {
          await Promise.all(
            newsNormalized.map((n) =>
              firestoreService.ensureSportsTrendingNewsItem({
                title: n.title,
                source: n.source,
                url: n.url,
                image: n.image,
                category: 'sports',
                country: countryUpper,
              })
            )
          );
          const fb = await firestoreService.getSportsTrendingByCountry(countryUpper, 12);
          if (fb.success && fb.items.length) {
            merged = fb.items;
            if (!cancelled) setCommunityRanking(true);
          }
        }

        if (merged.length < 4 && newsNormalized.length) {
          const seen = new Set(merged.map((m) => m.url));
          for (const n of newsNormalized) {
            if (merged.length >= 10) break;
            if (seen.has(n.url)) continue;
            seen.add(n.url);
            merged.push({ ...n });
          }
        }

        if (!merged.length && newsNormalized.length) {
          merged = [...newsNormalized];
        }

        merged.sort((a, b) => (b.trendingScore || 0) - (a.trendingScore || 0));

        if (!cancelled) {
          setSportsTrending(merged.length ? merged.slice(0, 10) : fallbackTrending);
          if (!merged.length) {
            setSportsNewsError('No headlines available. Showing top picks.');
          }
        }
      } catch {
        if (!cancelled) {
          setTrendingRegionLabel('');
          setSportsTrending(fallbackTrending);
          setSportsNewsError('Could not load live headlines, showing top picks.');
        }
      } finally {
        if (!cancelled) setIsLoadingSportsNews(false);
      }
    };

    loadSportsNews();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const HUB = {
    bg: '#0F0F0F',
    text: '#FFFFFF',
    textSecondary: '#A0A0A0',
    divider: '#1E1E1E',
    accent: '#A855F7',
  };
  const cardStyle = { background: HUB.bg, border: `1px solid ${HUB.divider}` };

  const subtitlePrimary =
    isLoadingSportsNews && !trendingRegionLabel
      ? 'Detecting your region…'
      : trendingRegionLabel
        ? `Popular sports in ${trendingRegionLabel}${
            communityRanking && userId ? ' · Ranked by likes, shares & views' : ''
          }`
        : 'Popular sports stories near you';

  const subtitleSecondary =
    !userId && !isLoadingSportsNews
      ? ' Sign in to influence rankings with likes and shares.'
      : '';

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
            onClick={() => navigate('/pod')}
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={cardStyle}
            aria-label="Back to Crew"
          >
            <ArrowLeft className="w-5 h-5" style={{ color: HUB.text }} />
          </button>
          <h1 className="text-xl font-bold" style={{ color: HUB.text }}>Sports</h1>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl overflow-hidden" style={cardStyle}>
            <div className="px-4 py-4" style={{ borderBottom: `1px solid ${HUB.divider}` }}>
              <h2 className="text-base font-semibold" style={{ color: HUB.text }}>Trending</h2>
              <p className="text-xs mt-1 leading-snug" style={{ color: HUB.textSecondary }}>
                {subtitlePrimary}
                {subtitleSecondary ? <span>{subtitleSecondary}</span> : null}
              </p>
            </div>
            <div className="py-3 pl-4">
              {isLoadingSportsNews ? (
                <p className="text-sm pr-4" style={{ color: HUB.textSecondary }}>
                  {trendingRegionLabel
                    ? `Loading what's trending in ${trendingRegionLabel}...`
                    : 'Loading trending sports news…'}
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
                  onClick={() => navigate(`/pod/sports/topic/${row.slug}`)}
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
