import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { canFetchLiveNews, fetchNewsApiTopHeadlinesRaw, normalizeArticles } from '../lib/podTopicNewsShared';

const GEMINI_MODEL = 'gemini-3-flash-preview';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export default function PodEntrepreneurshipPage() {
  const navigate = useNavigate();
  const { isDarkMode } = useTheme();
  const [trending, setTrending] = useState([]);
  const [isLoadingNews, setIsLoadingNews] = useState(false);
  const [newsError, setNewsError] = useState('');
  const [founderPosts, setFounderPosts] = useState([]);
  const [isLoadingFounder, setIsLoadingFounder] = useState(false);
  const [founderError, setFounderError] = useState('');

  const EXPLORE = [
    { label: 'Startups', slug: 'startups' },
    { label: 'Founders', slug: 'founders' },
    { label: 'Growth', slug: 'growth' },
    { label: 'Funding', slug: 'funding' },
    { label: 'Mindset', slug: 'mindset' },
  ];

  const FALLBACK_FOUNDER = [
    'Your first 10 customers teach you more than any pitch deck. Talk to them weekly, write down objections, and let that shape the roadmap—not the other way around.',
    'Runway is a strategy: shorten decision cycles, cut meetings that do not ship, and keep one “boring” revenue line healthy while you experiment on the side.',
    'Hiring before product–market clarity often compounds chaos. Stay small until repeatability shows up in metrics, then scale the playbook—not the headcount guess.',
  ];

  // Trending: business / startup headlines
  useEffect(() => {
    let cancelled = false;

    const fallbackTrending = [
      { title: 'Early-stage funds tighten diligence as valuations reset', source: 'Venture Brief', image: null },
      { title: 'SMB software startups lean into AI-assisted onboarding', source: 'Business Desk', image: null },
      { title: 'Founders share playbooks for extending runway without layoffs', source: 'Founder Weekly', image: null },
      { title: 'Regional accelerators report stronger applicant quality this quarter', source: 'Startup Wire', image: null },
    ];

    const load = async () => {
      setIsLoadingNews(true);
      setNewsError('');
      try {
        if (!canFetchLiveNews()) {
          setTrending(fallbackTrending);
          setNewsError(
            'Set REACT_APP_NEWSAPI in .env (web) or NEWSAPI_KEY on Firebase Functions (app) to load live headlines.'
          );
          return;
        }
        const articles = await fetchNewsApiTopHeadlinesRaw({
          category: 'business',
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

  // Founder Take: Gemini-generated short posts
  useEffect(() => {
    let cancelled = false;
    const googleKey = (process.env.REACT_APP_GOOGLE_API_KEY || process.env.GOOGLE_API_KEY || '').trim();

    const loadFounder = async () => {
      setIsLoadingFounder(true);
      setFounderError('');
      if (!googleKey) {
        setFounderPosts(FALLBACK_FOUNDER);
        setIsLoadingFounder(false);
        return;
      }

      try {
        const prompt =
          'You write for a mobile app "Founder Take" feed. Output exactly 3 separate founder insight posts. ' +
          'Each post is 2–4 sentences, practical and specific (no hashtags). ' +
          'Separate posts ONLY with the delimiter ||| (three pipe characters). No numbering or labels.';

        const res = await fetch(
          `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(googleKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.75, maxOutputTokens: 600 },
            }),
          }
        );
        if (!res.ok) throw new Error(`Gemini ${res.status}`);
        const data = await res.json();
        const text =
          data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ||
          '';
        const parts = text
          .split('|||')
          .map((s) => s.trim())
          .filter(Boolean);
        const posts = parts.length >= 3 ? parts.slice(0, 3) : parts.length > 0 ? parts : null;
        if (!cancelled) {
          if (posts && posts.length >= 3) setFounderPosts(posts.slice(0, 3));
          else if (posts && posts.length > 0) setFounderPosts([...posts, ...FALLBACK_FOUNDER].slice(0, 3));
          else setFounderPosts(FALLBACK_FOUNDER);
        }
      } catch {
        if (!cancelled) {
          setFounderPosts(FALLBACK_FOUNDER);
          setFounderError('Showing curated insights while AI is unavailable.');
        }
      } finally {
        if (!cancelled) setIsLoadingFounder(false);
      }
    };

    loadFounder();
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

  const startupGradients = [
    'linear-gradient(135deg,#2c1810 0%,#5c3d2e 50%,#1a1a1a 100%)',
    'linear-gradient(135deg,#1a2a1a 0%,#2d4a2d 50%,#1e1e1e 100%)',
    'linear-gradient(135deg,#1e1b4b 0%,#312e81 50%,#1e1e1e 100%)',
    'linear-gradient(135deg,#422006 0%,#78350f 50%,#1c1917 100%)',
    'linear-gradient(135deg,#0c4a6e 0%,#164e63 50%,#0f172a 100%)',
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
          <h1 className="text-xl font-bold" style={{ color: HUB.text }}>Entrepreneurship</h1>
        </div>

        <div className="space-y-4">
          {/* Trending (swipe) — startup / business cards */}
          <div className="rounded-2xl overflow-hidden" style={cardStyle}>
            <div className="flex items-center justify-between px-4 py-4" style={{ borderBottom: `1px solid ${HUB.divider}` }}>
              <h2 className="text-base font-semibold" style={{ color: HUB.text }}>
                <span className="mr-1.5" aria-hidden>🔥</span>
                Trending
              </h2>
            </div>
            <div className="py-3 pl-4">
              {isLoadingNews ? (
                <p className="text-sm pr-4" style={{ color: HUB.textSecondary }}>Loading startup headlines...</p>
              ) : (
                <>
                  <div
                    className="flex gap-3 overflow-x-auto overflow-y-hidden pb-2 pr-4 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    style={{ WebkitOverflowScrolling: 'touch' }}
                    role="region"
                    aria-label="Trending business and startup headlines"
                  >
                    {trending.slice(0, 10).map((item, idx) => {
                      const bg = item.image
                        ? `linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.15) 40%, transparent 60%), url(${item.image}) center/cover no-repeat`
                        : startupGradients[idx % startupGradients.length];
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

          {/* Founder Take */}
          <div className="rounded-2xl overflow-hidden" style={cardStyle}>
            <div className="flex items-center justify-between px-4 py-4" style={{ borderBottom: `1px solid ${HUB.divider}` }}>
              <h2 className="text-base font-semibold" style={{ color: HUB.text }}>
                <span className="mr-1.5" aria-hidden>🧠</span>
                Founder Take
              </h2>
            </div>
            <div className="px-4 py-3 space-y-3">
              {isLoadingFounder ? (
                <p className="text-sm" style={{ color: HUB.textSecondary }}>Generating founder insights...</p>
              ) : (
                <>
                  {founderPosts.map((post, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl px-3 py-3"
                      style={{ background: '#151515', border: `1px solid ${HUB.divider}` }}
                    >
                      <p className="text-sm leading-relaxed" style={{ color: HUB.text }}>
                        {post}
                      </p>
                    </div>
                  ))}
                  {!!founderError && (
                    <p className="text-xs" style={{ color: HUB.textSecondary }}>{founderError}</p>
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
                  onClick={() => navigate(`/pod/explore/entrepreneurship/${row.slug}`)}
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
