import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { getCurrentUser } from '../services/authService';
import { recordHubNewsClick } from '../services/hubNewsService';
import { prefetchExploreTopicRaw } from '../lib/podExploreTopicPrefetchCache';
import { getNewsWithLiveFallback } from '../services/cachedNewsService';
import { recordHubVerticalDwell } from '../services/hubVerticalPersonalizationService';
import { fetchAiTechHubTrendingCarouselItems } from '../lib/podAiTechTopicFeed';
import CardSkeleton from './skeleton/CardSkeleton';
import {
  classifyExploreSlugForAiTechTrending,
  isLikelyAiTechTrendingItem,
} from '../lib/podAiTechTrendingPersonalization';
import { getAiTechPersonalizationWeights } from '../services/aiTechPersonalizationService';

/** Survives route changes so trending does not flash empty while reloading. */
let podAiTechTrendingUiCache = {
  /** @type {Array<object>|null} */
  items: null,
};

function getCachedAiTechHubTrendingRows() {
  const arr = podAiTechTrendingUiCache.items;
  return Array.isArray(arr) && arr.length > 0 ? arr : null;
}

function effectiveAiTechTrendRank(item) {
  const ts = Number(item.trendingScore) || 0;
  if (ts) return ts;
  const sc = Number(item.score) || 0;
  const nc = Number(item.num_comments) || 0;
  return sc * 3 + nc;
}

/**
 * Carousel card — tap opens share suggestions (LinkedIn / X / Reddit), same as Sports hub trending.
 */
function AiTechTrendingCard({ item, idx, HUB, techGradients, navigate, returnTo }) {
  const [heroFailed, setHeroFailed] = useState(false);
  const src = typeof item.image === 'string' ? item.image.trim() : '';
  const showImg = Boolean(src && (/^https?:\/\//i.test(src) || src.startsWith('data:')));

  useEffect(() => {
    setHeroFailed(false);
  }, [src]);

  const openShareSuggestions = useCallback(() => {
    if (!item.url) return;
    const u = getCurrentUser();
    if (u?.uid) {
      const cat = classifyExploreSlugForAiTechTrending(item);
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
          style={{ background: techGradients[idx % techGradients.length] }}
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
      <div className="absolute inset-x-0 bottom-0 z-[3] p-3 pt-10 bg-gradient-to-t from-black via-black/80 to-transparent pointer-events-none">
        <p className="text-sm font-semibold leading-snug line-clamp-3" style={{ color: '#fff' }}>
          {item.title}
        </p>
        <p
          className="text-[11px] mt-1.5 font-medium uppercase tracking-wide"
          style={{ color: 'rgba(255,255,255,0.65)' }}
        >
          {item.source}
        </p>
      </div>
    </div>
  );
}

export default function PodAiTechPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search || ''}`;
  const { isDarkMode } = useTheme();
  const [trending, setTrending] = useState(() => getCachedAiTechHubTrendingRows() || []);
  const [isLoading, setIsLoading] = useState(() => !getCachedAiTechHubTrendingRows());
  const [newsError, setNewsError] = useState('');
  const loadTokenRef = useRef(0);

  const EXPLORE = [
    { label: 'AI Models', slug: 'ai-models' },
    { label: 'Startups', slug: 'startups' },
    { label: 'Tools', slug: 'tools' },
    { label: 'Vibe Coding', slug: 'vibe-coding' },
    { label: 'Big Tech', slug: 'big-tech' },
  ];

  useEffect(() => {
    recordHubVerticalDwell('ai-tech', 0, 1);
    let start = Date.now();
    const flush = () => {
      const sec = Math.min(900, Math.round((Date.now() - start) / 1000));
      start = Date.now();
      if (sec >= 3) recordHubVerticalDwell('ai-tech', sec, 0);
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
    const fallbackTrending = [
      {
        title: 'Major cloud providers expand AI chip and region capacity',
        source: 'Tech Wire',
        image: null,
        url: '',
        description: '',
      },
      {
        title: 'Developers adopt smaller open models for edge deployment',
        source: 'Dev Digest',
        image: null,
        url: '',
        description: '',
      },
      {
        title: 'Startups race to ship copilots for vertical workflows',
        source: 'Startup Brief',
        image: null,
        url: '',
        description: '',
      },
      {
        title: 'Big Tech earnings highlight AI revenue mix shifts',
        source: 'Markets Desk',
        image: null,
        url: '',
        description: '',
      },
    ];

    const token = ++loadTokenRef.current;

    const load = async () => {
      if (!getCachedAiTechHubTrendingRows()) setIsLoading(true);
      setNewsError('');
      try {
        let redditPrimary = [];
        try {
          redditPrimary = await fetchAiTechHubTrendingCarouselItems();
        } catch {
          redditPrimary = [];
        }
        if (token !== loadTokenRef.current) return;

        const { success, articles, error, fallbackError } = await getNewsWithLiveFallback('ai_tech');
        if (token !== loadTokenRef.current) return;

        let newsMerged = (success && Array.isArray(articles) ? articles : []).map((a) => ({
          title: a.title,
          source: a.source,
          url: a.url,
          image: a.image,
          publishedAt: a.publishedAt,
          description: a.description || '',
          city: null,
          firestoreId: null,
          trendingScore: Number(a.trendingScore) || 0,
          likes: 0,
          shares: 0,
          views: 0,
        }));

        const filteredNews = newsMerged.filter(isLikelyAiTechTrendingItem);
        if (filteredNews.length >= 4) newsMerged = filteredNews;

        const weights = await getAiTechPersonalizationWeights();

        const allCandidates = [...redditPrimary, ...newsMerged];
        allCandidates.sort((a, b) => {
          const clsA = classifyExploreSlugForAiTechTrending(a);
          const clsB = classifyExploreSlugForAiTechTrending(b);
          const ra = (weights[clsA] || 0) * 2000 + effectiveAiTechTrendRank(a);
          const rb = (weights[clsB] || 0) * 2000 + effectiveAiTechTrendRank(b);
          if (rb !== ra) return rb - ra;
          const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
          const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
          return tb - ta;
        });

        const seenUrls = new Set();
        const merged = [];
        for (const row of allCandidates) {
          const u = (row?.url || '').trim();
          if (!u || seenUrls.has(u)) continue;
          seenUrls.add(u);
          merged.push(row);
          if (merged.length >= 10) break;
        }

        if (token !== loadTokenRef.current) return;

        if (!merged.length && !success) {
          podAiTechTrendingUiCache.items = fallbackTrending;
          setTrending(fallbackTrending);
          setNewsError(fallbackError || error || 'Could not load headlines.');
          return;
        }

        const baseRows = merged.length ? merged.slice(0, 10) : fallbackTrending;
        podAiTechTrendingUiCache.items = baseRows;
        setTrending(baseRows);
        if (merged.length > 0) {
          setNewsError('');
        } else {
          setNewsError(
            fallbackError ||
              'No AI & tech headlines. Set REACT_APP_NEWSAPI in .env or deploy newsIngestScheduler.'
          );
        }
      } catch {
        if (token !== loadTokenRef.current) return;
        podAiTechTrendingUiCache.items = fallbackTrending;
        setTrending(fallbackTrending);
        setNewsError('Could not load cached headlines, showing top picks.');
      } finally {
        if (token === loadTokenRef.current) setIsLoading(false);
      }
    };

    load();
  }, []);

  const HUB = {
    bg: '#0F0F0F',
    text: '#FFFFFF',
    textSecondary: '#A0A0A0',
    divider: '#1E1E1E',
    accent: '#A855F7',
  };
  const cardStyle = { background: HUB.bg, border: `1px solid ${HUB.divider}` };

  const techGradients = [
    'linear-gradient(135deg,#0f0c29 0%,#302b63 50%,#24243e 100%)',
    'linear-gradient(135deg,#141e30 0%,#243b55 100%)',
    'linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#533483 100%)',
    'linear-gradient(135deg,#0d1b2a 0%,#1b263b 50%,#415a77 100%)',
    'linear-gradient(135deg,#2c003e 0%,#512b58 50%,#1f1f3a 100%)',
  ];

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
          <h1 className="text-xl font-bold" style={{ color: HUB.text }}>AI &amp; Tech</h1>
        </div>

        <div className="space-y-4">
          {/* Trending (swipe) */}
          <div className="rounded-2xl overflow-hidden" style={cardStyle}>
            <div className="flex items-center justify-between px-4 py-4" style={{ borderBottom: `1px solid ${HUB.divider}` }}>
              <h2 className="text-base font-semibold" style={{ color: HUB.text }}>
                <span className="mr-1.5" aria-hidden>🔥</span>
                Trending
              </h2>
            </div>
            <div className="py-3 pl-4">
              {isLoading ? (
                <CardSkeleton count={4} />
              ) : (
                <>
                  <div
                    className="flex gap-3 overflow-x-auto overflow-y-hidden pb-2 pr-4 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    style={{ WebkitOverflowScrolling: 'touch' }}
                    role="region"
                    aria-label="Trending technology headlines"
                  >
                    {trending.slice(0, 10).map((item, idx) => (
                      <AiTechTrendingCard
                        key={`${item.url || item.title}-${idx}`}
                        item={item}
                        idx={idx}
                        HUB={HUB}
                        techGradients={techGradients}
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

          {/* Explore */}
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
                    navigate(`/pod/explore/ai-tech/${row.slug}`);
                    void prefetchExploreTopicRaw('ai-tech', row.slug, 'international').catch(() => {});
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
