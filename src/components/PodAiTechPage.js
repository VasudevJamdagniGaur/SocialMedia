import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { getNewsApiKey, fetchNewsApiTopHeadlinesRaw, normalizeArticles } from '../lib/podTopicNewsShared';

export default function PodAiTechPage() {
  const navigate = useNavigate();
  const { isDarkMode } = useTheme();
  const [trending, setTrending] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newsError, setNewsError] = useState('');

  const EXPLORE = [
    { label: 'AI Models', slug: 'ai-models' },
    { label: 'Startups', slug: 'startups' },
    { label: 'Tools', slug: 'tools' },
    { label: 'Insights', slug: 'insights' },
    { label: 'Big Tech', slug: 'big-tech' },
  ];

  useEffect(() => {
    const apiKey = getNewsApiKey();
    let cancelled = false;

    const fallbackTrending = [
      { title: 'Major cloud providers expand AI chip and region capacity', source: 'Tech Wire', image: null },
      { title: 'Developers adopt smaller open models for edge deployment', source: 'Dev Digest', image: null },
      { title: 'Startups race to ship copilots for vertical workflows', source: 'Startup Brief', image: null },
      { title: 'Big Tech earnings highlight AI revenue mix shifts', source: 'Markets Desk', image: null },
    ];

    const load = async () => {
      setIsLoading(true);
      setNewsError('');
      try {
        if (!apiKey) {
          setTrending(fallbackTrending);
          setNewsError('Set REACT_APP_NEWSAPI in .env to load live headlines.');
          return;
        }
        const articles = await fetchNewsApiTopHeadlinesRaw({
          category: 'technology',
          language: 'en',
          pageSize: 10,
        });
        const normalized = normalizeArticles(articles).map((a) => ({
          title: a.title,
          source: a.source,
          url: a.url,
          image: a.image,
        }));
        if (!cancelled) setTrending(normalized.length ? normalized : fallbackTrending);
      } catch {
        if (!cancelled) {
          setTrending(fallbackTrending);
          setNewsError('Could not load live headlines, showing top picks.');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
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
                Trending <span className="font-normal" style={{ color: HUB.textSecondary }}>(Swipe)</span>
              </h2>
            </div>
            <div className="py-3 pl-4">
              {isLoading ? (
                <p className="text-sm pr-4" style={{ color: HUB.textSecondary }}>Loading trending tech news...</p>
              ) : (
                <>
                  <div
                    className="flex gap-3 overflow-x-auto overflow-y-hidden pb-2 pr-4 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    style={{ WebkitOverflowScrolling: 'touch' }}
                    role="region"
                    aria-label="Trending technology headlines"
                  >
                    {trending.slice(0, 10).map((item, idx) => {
                      const bg = item.image
                        ? `linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.15) 40%, transparent 60%), url(${item.image}) center/cover no-repeat`
                        : techGradients[idx % techGradients.length];
                      return (
                        <a
                          key={`${item.title}-${idx}`}
                          href={item.url || undefined}
                          target={item.url ? '_blank' : undefined}
                          rel={item.url ? 'noopener noreferrer' : undefined}
                          className="relative flex-shrink-0 w-[min(260px,78vw)] snap-start snap-always rounded-xl overflow-hidden border transition-transform active:scale-[0.98] hover:opacity-95"
                          style={{
                            borderColor: HUB.divider,
                            minHeight: 200,
                            background: bg,
                            backgroundSize: item.image ? 'cover' : 'auto',
                            backgroundPosition: item.image ? 'center' : undefined,
                          }}
                        >
                          <div className="absolute inset-x-0 bottom-0 p-3 pt-10 bg-gradient-to-t from-black via-black/80 to-transparent">
                            <p className="text-sm font-semibold leading-snug line-clamp-3" style={{ color: '#fff' }}>
                              {item.title}
                            </p>
                            <p className="text-[11px] mt-1.5 font-medium uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.65)' }}>
                              {item.source}
                            </p>
                          </div>
                        </a>
                      );
                    })}
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
                  onClick={() => navigate(`/pod/explore/ai-tech/${row.slug}`)}
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
