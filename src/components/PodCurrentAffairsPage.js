import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { getNewsApiKey, fetchNewsApiTopHeadlinesRaw, normalizeArticles } from '../lib/podTopicNewsShared';

const GEMINI_MODEL = 'gemini-3-flash-preview';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const FALLBACK_WHY = [
  'Staying informed helps you see how distant events ripple into jobs, prices, travel, and safety where you live.',
  'Headlines move fast; understanding the “why” behind them makes it easier to spot noise, bias, and what actually affects your decisions.',
  'When communities share a clearer picture of the world, civic conversation, volunteering, and policy engagement tend to stay grounded in facts.',
].join(' ');

export default function PodCurrentAffairsPage() {
  const navigate = useNavigate();
  const { isDarkMode } = useTheme();
  const [trending, setTrending] = useState([]);
  const [isLoadingNews, setIsLoadingNews] = useState(false);
  const [newsError, setNewsError] = useState('');
  const [whyItMatters, setWhyItMatters] = useState('');
  const [isLoadingWhy, setIsLoadingWhy] = useState(false);
  const [whyError, setWhyError] = useState('');

  const EXPLORE = [
    { label: 'World News', slug: 'world-news' },
    { label: 'Politics', slug: 'politics' },
    { label: 'Economy', slug: 'economy' },
    { label: 'Climate', slug: 'climate' },
    { label: 'Conflicts', slug: 'conflicts' },
  ];

  useEffect(() => {
    const apiKey = getNewsApiKey();
    let cancelled = false;

    const fallbackTrending = [
      { title: 'Global leaders meet on coordinated response to emerging crises', source: 'World Desk', image: null },
      { title: 'Markets weigh commodity shifts after latest supply chain updates', source: 'Economy Watch', image: null },
      { title: 'UN agencies highlight humanitarian needs in multiple regions', source: 'Global Affairs', image: null },
      { title: 'Scientists publish new findings on extreme weather patterns', source: 'Climate Brief', image: null },
    ];

    const load = async () => {
      setIsLoadingNews(true);
      setNewsError('');
      try {
        if (!apiKey) {
          setTrending(fallbackTrending);
          setNewsError('Set REACT_APP_NEWSAPI in .env to load live headlines.');
          return;
        }
        const articles = await fetchNewsApiTopHeadlinesRaw({
          category: 'general',
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
        if (!cancelled) setIsLoadingNews(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const googleKey = (process.env.REACT_APP_GOOGLE_API_KEY || process.env.GOOGLE_API_KEY || '').trim();

    const loadWhy = async () => {
      setIsLoadingWhy(true);
      setWhyError('');
      if (!googleKey) {
        setWhyItMatters(FALLBACK_WHY);
        setIsLoadingWhy(false);
        return;
      }

      try {
        const prompt =
          'Write one cohesive "Why it matters" explainer for a general news reader (not alarmist). ' +
          '3 short paragraphs, plain language, 120–180 words total. No bullet points, no title line, no hashtags.';

        const res = await fetch(
          `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(googleKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.65, maxOutputTokens: 500 },
            }),
          }
        );
        if (!res.ok) throw new Error(`Gemini ${res.status}`);
        const data = await res.json();
        const text =
          (data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '').trim();
        if (!cancelled) {
          if (text.length > 40) setWhyItMatters(text);
          else {
            setWhyItMatters(FALLBACK_WHY);
            setWhyError('Showing a curated explainer.');
          }
        }
      } catch {
        if (!cancelled) {
          setWhyItMatters(FALLBACK_WHY);
          setWhyError('Showing a curated explainer while AI is unavailable.');
        }
      } finally {
        if (!cancelled) setIsLoadingWhy(false);
      }
    };

    loadWhy();
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

  const newsGradients = [
    'linear-gradient(135deg,#0c1929 0%,#1e3a5f 50%,#0f172a 100%)',
    'linear-gradient(135deg,#1c1917 0%,#44403c 50%,#1c1917 100%)',
    'linear-gradient(135deg,#134e4a 0%,#115e59 50%,#0f172a 100%)',
    'linear-gradient(135deg,#312e81 0%,#1e1b4b 50%,#0f172a 100%)',
    'linear-gradient(135deg,#1e293b 0%,#334155 50%,#0f172a 100%)',
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
                <p className="text-sm pr-4" style={{ color: HUB.textSecondary }}>Loading global headlines...</p>
              ) : (
                <>
                  <div
                    className="flex gap-3 overflow-x-auto overflow-y-hidden pb-2 pr-4 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    style={{ WebkitOverflowScrolling: 'touch' }}
                    role="region"
                    aria-label="Trending current affairs headlines"
                  >
                    {trending.slice(0, 10).map((item, idx) => {
                      const bg = item.image
                        ? `linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.15) 40%, transparent 60%), url(${item.image}) center/cover no-repeat`
                        : newsGradients[idx % newsGradients.length];
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

          <div className="rounded-2xl overflow-hidden" style={cardStyle}>
            <div className="flex items-center justify-between px-4 py-4" style={{ borderBottom: `1px solid ${HUB.divider}` }}>
              <h2 className="text-base font-semibold" style={{ color: HUB.text }}>
                <span className="mr-1.5" aria-hidden>🧠</span>
                Why It Matters
              </h2>
            </div>
            <div className="px-4 py-3">
              {isLoadingWhy ? (
                <p className="text-sm" style={{ color: HUB.textSecondary }}>Preparing perspective...</p>
              ) : (
                <>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: HUB.text }}>
                    {whyItMatters}
                  </p>
                  {!!whyError && (
                    <p className="text-xs mt-2" style={{ color: HUB.textSecondary }}>{whyError}</p>
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
                  onClick={() => navigate(`/pod/explore/current-affairs/${row.slug}`)}
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
