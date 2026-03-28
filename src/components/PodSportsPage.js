import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Sparkles, ChevronRight } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { getNewsApiKey, fetchNewsApiTopHeadlinesRaw, normalizeArticles } from '../lib/podTopicNewsShared';

export default function PodSportsPage() {
  const navigate = useNavigate();
  const { isDarkMode } = useTheme();
  const [sportsTrending, setSportsTrending] = useState([]);
  const [isLoadingSportsNews, setIsLoadingSportsNews] = useState(false);
  const [sportsNewsError, setSportsNewsError] = useState('');

  const SPORTS_EXPLORE = [
    { label: 'Cricket', slug: 'cricket' },
    { label: 'Football', slug: 'football' },
    { label: 'F1', slug: 'f1' },
    { label: 'Chess', slug: 'chess' },
    { label: 'Others', slug: 'others' },
  ];

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
      try {
        if (!apiKey) {
          setSportsTrending(fallbackTrending);
          setSportsNewsError('Set REACT_APP_NEWSAPI in .env to load live headlines.');
          return;
        }
        const articles = await fetchNewsApiTopHeadlinesRaw({
          category: 'sports',
          language: 'en',
          pageSize: 7,
        });
        const normalized = normalizeArticles(articles).map((a) => ({
          title: a.title,
          source: a.source,
          url: a.url,
          image: a.image,
        }));
        if (!cancelled) setSportsTrending(normalized.length ? normalized : fallbackTrending);
      } catch {
        if (!cancelled) {
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
          <h1 className="text-xl font-bold" style={{ color: HUB.text }}>Sports</h1>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl overflow-hidden" style={cardStyle}>
            <div className="flex items-center justify-between px-4 py-4" style={{ borderBottom: `1px solid ${HUB.divider}` }}>
              <h2 className="text-base font-semibold" style={{ color: HUB.text }}>Trending</h2>
            </div>
            <div className="py-3 pl-4">
              {isLoadingSportsNews ? (
                <p className="text-sm pr-4" style={{ color: HUB.textSecondary }}>Loading trending sports news...</p>
              ) : (
                <>
                  <div
                    className="flex gap-3 overflow-x-auto overflow-y-hidden pb-2 pr-4 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    style={{ WebkitOverflowScrolling: 'touch' }}
                    role="region"
                    aria-label="Trending sports headlines"
                  >
                    {sportsTrending.slice(0, 10).map((item, idx) => {
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

