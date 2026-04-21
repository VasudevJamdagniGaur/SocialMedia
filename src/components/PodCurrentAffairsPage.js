import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { googleNewsSearchUrl } from '../lib/podTopicNewsShared';
import { prefetchExploreTopicRaw } from '../lib/podExploreTopicPrefetchCache';
import { fetchCurrentAffairsHubTrendingCarouselItems } from '../lib/podCurrentAffairsTopicFeed';
import { getCurrentUser } from '../services/authService';
import { recordHubNewsClick } from '../services/hubNewsService';
import { recordHubVerticalDwell } from '../services/hubVerticalPersonalizationService';

/**
 * Tap opens share suggestions (same flow as Sports hub trending), not the raw Reddit URL.
 */
function CurrentAffairsTrendingCard({ item, idx, HUB, navigate, returnTo }) {
  const [heroFailed, setHeroFailed] = useState(false);

  const gradients = [
    'linear-gradient(135deg,#0c1929 0%,#1e3a5f 50%,#0f172a 100%)',
    'linear-gradient(135deg,#1c1917 0%,#44403c 50%,#1c1917 100%)',
    'linear-gradient(135deg,#134e4a 0%,#115e59 50%,#0f172a 100%)',
    'linear-gradient(135deg,#312e81 0%,#1e1b4b 50%,#0f172a 100%)',
    'linear-gradient(135deg,#1e293b 0%,#334155 50%,#0f172a 100%)',
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
      const cat = String(item.exploreTopic || 'general').trim() || 'general';
      void recordHubNewsClick(u.uid, cat);
    }
    navigate('/share-suggestions', {
      state: {
        newsArticle: {
          title: item.title,
          url: item.url,
          description: item.description || '',
          image: item.image || null,
          source: 'News',
        },
        returnTo,
      },
    });
  }, [item, navigate, returnTo]);

  return (
    <div
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
      <div className="absolute inset-x-0 bottom-0 z-[3] p-3 pt-8 bg-gradient-to-t from-black via-black/80 to-transparent pointer-events-none">
        <p className="text-sm font-semibold leading-snug line-clamp-4" style={{ color: '#fff' }}>
          {item.title}
        </p>
      </div>
    </div>
  );
}

export default function PodCurrentAffairsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search || ''}`;
  const { isDarkMode } = useTheme();
  const [trending, setTrending] = useState([]);
  const [isLoadingNews, setIsLoadingNews] = useState(false);
  const [newsError, setNewsError] = useState('');
  const EXPLORE = [
    { label: 'World News', slug: 'world-news' },
    { label: 'Politics', slug: 'politics' },
    { label: 'Economy', slug: 'economy' },
    { label: 'Climate', slug: 'climate' },
  ];

  useEffect(() => {
    recordHubVerticalDwell('current-affairs', 0, 1);
    let start = Date.now();
    const flush = () => {
      const sec = Math.min(900, Math.round((Date.now() - start) / 1000));
      start = Date.now();
      if (sec >= 3) recordHubVerticalDwell('current-affairs', sec, 0);
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

  useEffect(() => {
    let cancelled = false;

    const fallbackTrending = [
      {
        title: 'Global leaders meet on coordinated response to emerging crises',
        image: null,
        url: googleNewsSearchUrl('world news international'),
        description: '',
        exploreTopic: 'world-news',
      },
      {
        title: 'Markets weigh commodity shifts after latest supply chain updates',
        image: null,
        url: googleNewsSearchUrl('economy news'),
        description: '',
        exploreTopic: 'economy',
      },
      {
        title: 'UN agencies highlight humanitarian needs in multiple regions',
        image: null,
        url: googleNewsSearchUrl('world politics'),
        description: '',
        exploreTopic: 'politics',
      },
      {
        title: 'Scientists publish new findings on extreme weather patterns',
        image: null,
        url: googleNewsSearchUrl('climate change news'),
        description: '',
        exploreTopic: 'climate',
      },
    ];

    const load = async () => {
      setIsLoadingNews(true);
      setNewsError('');
      try {
        const articles = await fetchCurrentAffairsHubTrendingCarouselItems();
        if (cancelled) return;
        const normalized = (articles || []).map((a) => ({
          title: a.title,
          url: a.url,
          image: a.image,
          description: a.description || '',
          exploreTopic: a.exploreTopic || 'world-news',
        }));
        setTrending(normalized.length ? normalized : fallbackTrending);
        if (!normalized.length) {
          setNewsError('Could not load Reddit. Showing placeholder headlines.');
        }
      } catch {
        if (!cancelled) {
          setTrending(fallbackTrending);
          setNewsError('Could not load Reddit, showing top picks.');
        }
      } finally {
        if (!cancelled) setIsLoadingNews(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

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
            onClick={() => navigate('/pod')}
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={cardStyle}
            aria-label="Back to Crew"
          >
            <ArrowLeft className="w-5 h-5" style={{ color: HUB.text }} />
          </button>
          <h1 className="text-xl font-bold" style={{ color: HUB.text }}>Current Affairs</h1>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl overflow-hidden" style={cardStyle}>
            <div className="flex items-center justify-between px-4 py-4" style={{ borderBottom: `1px solid ${HUB.divider}` }}>
              <h2 className="text-base font-semibold" style={{ color: HUB.text }}>
                <span className="mr-1.5" aria-hidden>🔥</span>
                Trending
              </h2>
            </div>
            <div className="py-3 pl-4">
              {isLoadingNews ? (
                <p className="text-sm pr-4" style={{ color: HUB.textSecondary }}>Loading from Reddit...</p>
              ) : (
                <>
                  <div
                    className="flex gap-3 overflow-x-auto overflow-y-hidden pb-2 pr-4 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    style={{ WebkitOverflowScrolling: 'touch' }}
                    role="region"
                    aria-label="Trending posts ranked by engagement and your explore usage"
                  >
                    {trending.slice(0, 10).map((item, idx) => (
                      <CurrentAffairsTrendingCard
                        key={`${item.title}-${idx}`}
                        item={item}
                        idx={idx}
                        HUB={HUB}
                        navigate={navigate}
                        returnTo={returnTo}
                      />
                    ))}
                  </div>
                  {!!newsError && (
                    <p className="text-xs mt-2 pr-4" style={{ color: HUB.textSecondary }}>{newsError}</p>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="rounded-2xl overflow-hidden" style={cardStyle}>
            <div className="flex items-center justify-between px-4 py-4" style={{ borderBottom: `1px solid ${HUB.divider}` }}>
              <h2 className="text-base font-semibold" style={{ color: HUB.text }}>
                <span className="mr-1.5" aria-hidden>✨</span>
                Explore
              </h2>
            </div>
            <div className="px-4 py-2">
              {EXPLORE.map((row, index) => (
                <button
                  key={row.slug}
                  type="button"
                  onClick={() => {
                    navigate(`/pod/explore/current-affairs/${row.slug}`);
                    void prefetchExploreTopicRaw('current-affairs', row.slug, 'international').catch(() => {});
                  }}
                  className="w-full flex items-center justify-between py-3 text-left transition-opacity hover:opacity-90"
                  style={{
                    borderTop: index === 0 ? 'none' : `1px solid ${HUB.divider}`,
                  }}
                >
                  <span className="text-sm font-medium" style={{ color: HUB.text }}>{row.label}</span>
                  <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: HUB.textSecondary }} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
