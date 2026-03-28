import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import {
  googleNewsSearchUrl,
  getNewsApiKey,
  fetchNewsApiEverythingNormalized,
  filterNewsRowsIndiaLocal,
  enrichNewsItemsWithOgImages,
  NewsFeedRow,
} from '../lib/podTopicNewsShared';

/** Map explore section → parent pod hub path (back button). */
export const POD_EXPLORE_SECTION_HOME = {
  'ai-tech': '/pod/ai-tech',
  entrepreneurship: '/pod/entrepreneurship',
  'current-affairs': '/pod/current-affairs',
};

/**
 * label: UI title
 * q: NewsAPI everything query
 * google: Google News RSS search (use when:7d for recency)
 */
const EXPLORE_TOPICS = {
  'ai-tech': {
    'ai-models': {
      label: 'AI Models',
      q: '("large language model" OR LLM OR GPT OR Claude OR Gemini OR Llama OR "foundation model" OR Mistral OR OpenAI)',
      google: '("large language model" OR GPT-4 OR Claude OR Gemini OR Llama) when:7d',
    },
    startups: {
      label: 'Startups',
      q: '("AI startup" OR "tech startup" AND (funding OR raises OR launches) OR "seed round" OR "Series A" AI)',
      qInternational:
        '("AI startup" OR "tech startup" AND (funding OR raises OR launches) OR "seed round" OR "Series A" AI)',
      qLocal:
        '((India OR Indian OR Bharat OR Bengaluru OR Bangalore OR Mumbai OR Delhi OR Hyderabad OR Pune OR Chennai) AND ("AI startup" OR "tech startup" OR "machine learning startup" OR "GenAI startup")) AND (funding OR seed OR Series OR launch OR raises)',
      google: '(AI startup OR machine learning startup OR tech startup funding) when:7d',
      googleLocal: '(India AI startup OR Bengaluru tech startup funding OR Indian startup AI) when:7d',
      googleInternational: '(AI startup OR machine learning startup OR tech startup funding) when:7d',
    },
    tools: {
      label: 'Tools',
      q: '(MLOps OR "machine learning" API OR "Hugging Face" OR LangChain OR "vector database" OR "AI SDK")',
      google: '(AI developer tools OR MLOps OR LangChain OR Hugging Face) when:7d',
    },
    insights: {
      label: 'Insights',
      q: '(AI ethics OR "artificial intelligence" regulation OR AGI OR "AI safety" OR benchmark OR "AI policy")',
      google: '(AI ethics OR artificial intelligence regulation OR AI safety research) when:7d',
    },
    'big-tech': {
      label: 'Big Tech',
      q: '((Microsoft OR Google OR Meta OR Apple OR Amazon OR Nvidia) AND (AI OR chip OR Copilot OR Gemini OR LLM))',
      google: '(Microsoft AI OR Google AI OR Meta AI OR Nvidia AI) when:7d',
    },
  },
  entrepreneurship: {
    startups: {
      label: 'Startups',
      q: '(startup OR unicorn OR "Series A" OR "Series B" OR accelerator OR "Y Combinator" OR venture)',
      qInternational:
        '(startup OR unicorn OR "Series A" OR "Series B" OR accelerator OR "Y Combinator" OR venture)',
      qLocal:
        '((India OR Indian OR Bharat OR Mumbai OR Delhi OR Bengaluru OR Bangalore OR Hyderabad OR Pune OR Chennai OR Noida OR Gurugram OR "Startup India" OR SME IPO OR BSE OR NSE OR SEBI) AND (startup OR unicorn OR funding OR "Series A" OR "Series B" OR VC OR accelerator OR IPO OR incubat OR "seed round"))',
      google: '(startup funding OR Y Combinator OR venture capital startup) when:7d',
      googleLocal: '("India startup" OR "Indian startup" funding OR India unicorn OR Mumbai Bengaluru startup Series A) when:7d',
      googleInternational: '(startup funding OR Y Combinator OR venture capital startup) when:7d',
    },
    founders: {
      label: 'Founders',
      q: '(founder OR "founder story" OR entrepreneur OR bootstrapping OR CEO startup)',
      google: '(startup founder OR entrepreneur CEO interview) when:7d',
    },
    growth: {
      label: 'Growth',
      q: '(startup growth OR SaaS growth OR "go to market" OR GTM OR "product-led growth" OR scaling startup)',
      google: '(startup growth strategy OR SaaS scaling) when:7d',
    },
    funding: {
      label: 'Funding',
      q: '("venture capital" OR VC OR "seed funding" OR "Series A" OR IPO OR valuation OR "investment round")',
      google: '(venture capital funding OR startup investment round) when:7d',
    },
    mindset: {
      label: 'Mindset',
      q: '("founder mindset" OR leadership entrepreneur OR "startup advice" OR resilience founder)',
      google: '(founder mindset OR entrepreneur leadership advice) when:7d',
    },
  },
  'current-affairs': {
    'world-news': {
      label: 'World News',
      q: '(international news OR United Nations OR diplomacy OR "global affairs" OR world leaders)',
      google: '(world news OR international breaking news) when:7d',
    },
    politics: {
      label: 'Politics',
      q: '(election OR parliament OR congress OR political OR government OR campaign)',
      google: '(political news OR election government) when:7d',
    },
    economy: {
      label: 'Economy',
      q: '(economy OR inflation OR GDP OR "Federal Reserve" OR "interest rates" OR recession OR "jobs report")',
      google: '(economy news inflation Federal Reserve jobs) when:7d',
    },
    climate: {
      label: 'Climate',
      q: '("climate change" OR COP OR "renewable energy" OR emissions OR IPCC OR "extreme weather")',
      google: '(climate change news renewable energy IPCC) when:7d',
    },
    conflicts: {
      label: 'Conflicts',
      q: '(war OR conflict OR military OR ceasefire OR "peace talks" OR NATO OR Ukraine OR Gaza)',
      google: '(war conflict military news ceasefire) when:7d',
    },
  },
};

function isStartupsRegionTopic(section, topicId) {
  return topicId === 'startups' && (section === 'entrepreneurship' || section === 'ai-tech');
}

function resolveExploreNewsQuery(cfg, startupRegion) {
  if (!cfg) return '';
  if (cfg.qInternational && cfg.qLocal) {
    return startupRegion === 'local' ? cfg.qLocal : cfg.qInternational;
  }
  return cfg.q || '';
}

function resolveExploreGoogleQuery(cfg, startupRegion) {
  if (!cfg) return '';
  if (cfg.googleInternational && cfg.googleLocal) {
    return startupRegion === 'local' ? cfg.googleLocal : cfg.googleInternational;
  }
  return cfg.google || '';
}

function browseGoogleQuery(googleRssQuery) {
  return googleNewsSearchUrl((googleRssQuery || '').replace(/\s+when:\d+d$/i, '').trim());
}

function buildFallbackRows(label, googleQuery) {
  const baseUrl = browseGoogleQuery(googleQuery || 'news');
  const now = new Date().toISOString();
  return Array.from({ length: 6 }, (_, i) => ({
    title: `${label} update ${i + 1}`,
    source: 'News',
    url: baseUrl,
    image: null,
    description: `${label} roundup`,
    publishedAt: now,
    sourceSiteUrl: '',
    publisherUrl: '',
  }));
}

export default function PodExploreTopicPage() {
  const { section, topicId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { isDarkMode } = useTheme();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [pullProgress, setPullProgress] = useState(0);
  const [startupRegion, setStartupRegion] = useState('international');

  const pullStartYRef = useRef(null);
  const pullDistanceRef = useRef(0);
  const loadTokenRef = useRef(0);
  const isMountedRef = useRef(true);

  const topicConfig = EXPLORE_TOPICS[section]?.[topicId];
  const title = topicConfig?.label ?? 'Explore';
  const backTo = POD_EXPLORE_SECTION_HOME[section] || '/pod';
  const browseGoogleForTopic = resolveExploreGoogleQuery(topicConfig, startupRegion);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadNews = async ({ initialLoad }) => {
    const cfg = EXPLORE_TOPICS[section]?.[topicId];
    if (!cfg) {
      if (initialLoad) setItems([]);
      return;
    }

    const token = ++loadTokenRef.current;

    if (initialLoad) {
      setLoading(true);
      setError('');
    } else {
      setRefreshing(true);
      setError('');
    }

    try {
      /** @type {Array<{title:string,source:string,url:string,image:null|string,description:string,publishedAt?:string|null,sourceSiteUrl?:string}>|null} */
      let rows = null;

      const newsQ = resolveExploreNewsQuery(cfg, startupRegion);
      const googleQ = resolveExploreGoogleQuery(cfg, startupRegion);

      const apiKey = getNewsApiKey();
      if (!apiKey) {
        const msg =
          'Add REACT_APP_NEWSAPI to your .env file and restart the dev server. Showing browse links only.';
        const fallbackRows = buildFallbackRows(title, googleQ);
        if (isMountedRef.current && token === loadTokenRef.current) {
          setItems(fallbackRows);
          setError(msg);
        }
        return;
      }

      if (newsQ) {
        const pageSize =
          isStartupsRegionTopic(section, topicId) && startupRegion === 'local' ? 50 : 30;
        rows = await fetchNewsApiEverythingNormalized({ q: newsQ, pageSize });
        if (rows?.length) {
          if (isStartupsRegionTopic(section, topicId) && startupRegion === 'local') {
            rows = filterNewsRowsIndiaLocal(rows);
          }
          rows = rows.slice(0, 30);
        }
      }

      if (!rows?.length) {
        const msg =
          'NewsAPI returned no articles (check your key, plan limits, or query). Showing quick fallback headlines.';
        const fallbackRows = buildFallbackRows(title, googleQ);
        if (isMountedRef.current && token === loadTokenRef.current) {
          setItems(fallbackRows);
          setError(msg);
        }
        return;
      }

      const enriched = await enrichNewsItemsWithOgImages(rows, { enableOgFallback: true });
      if (isMountedRef.current && token === loadTokenRef.current) {
        setItems(enriched);
        setError('');
      }
    } catch {
      const msg = 'Live sources unavailable. Showing quick fallback headlines.';
      const fallbackGoogle = resolveExploreGoogleQuery(topicConfig, startupRegion);
      const fallbackRows = buildFallbackRows(title, fallbackGoogle || '');
      if (isMountedRef.current && token === loadTokenRef.current) {
        setItems(fallbackRows);
        setError(msg);
      }
    } finally {
      if (!isMountedRef.current || token !== loadTokenRef.current) return;
      if (initialLoad) setLoading(false);
      else setRefreshing(false);
      setPullProgress(0);
    }
  };

  useEffect(() => {
    loadNews({ initialLoad: true });
  }, [section, topicId, startupRegion]);

  const HUB = {
    bg: '#0F0F0F',
    text: '#FFFFFF',
    textSecondary: '#A0A0A0',
    divider: '#1E1E1E',
    accent: '#A855F7',
  };
  const cardStyle = { background: HUB.bg, border: `1px solid ${HUB.divider}` };

  const getScrollTop = () => {
    const se = document.scrollingElement;
    if (se) return se.scrollTop || 0;
    return window.scrollY || document.documentElement.scrollTop || 0;
  };

  const isAtTop = () => getScrollTop() <= 0;

  const onTouchStart = (e) => {
    if (loading || refreshing) return;
    if (!isAtTop()) return;
    if (!e.touches || e.touches.length !== 1) return;
    pullStartYRef.current = e.touches[0].clientY;
    pullDistanceRef.current = 0;
    setPullProgress(0);
  };

  const onTouchMove = (e) => {
    if (loading || refreshing) return;
    if (!isAtTop()) return;
    if (pullStartYRef.current == null) return;
    if (!e.touches || e.touches.length !== 1) return;

    const currentY = e.touches[0].clientY;
    const delta = currentY - pullStartYRef.current;
    if (delta <= 0) return;

    pullDistanceRef.current = delta;
    const progress = Math.max(0, Math.min(1, delta / 80));
    setPullProgress(progress);
  };

  const onTouchEnd = () => {
    if (loading || refreshing) return;
    if (pullStartYRef.current == null) return;

    const delta = pullDistanceRef.current;
    pullStartYRef.current = null;
    pullDistanceRef.current = 0;

    if (isAtTop() && delta >= 70) {
      loadNews({ initialLoad: false });
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
            onClick={() => navigate(backTo)}
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={cardStyle}
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" style={{ color: HUB.text }} />
          </button>
          <h1 className="text-xl font-bold" style={{ color: HUB.text }}>{title}</h1>
        </div>

        {isStartupsRegionTopic(section, topicId) ? (
          <div
            className="mb-4 flex rounded-xl p-1 gap-1"
            style={{ background: HUB.bg, border: `1px solid ${HUB.divider}` }}
            role="tablist"
            aria-label="Startup news region"
          >
            {(['local', 'international']).map((key) => {
              const active = startupRegion === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setStartupRegion(key)}
                  className="flex-1 py-2.5 text-sm font-semibold rounded-lg transition-colors"
                  style={{
                    background: active ? `${HUB.accent}33` : 'transparent',
                    color: active ? HUB.text : HUB.textSecondary,
                  }}
                >
                  {key === 'local' ? 'Local' : 'International'}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="rounded-2xl overflow-hidden" style={cardStyle}>
          <div
            className="h-8 flex items-center justify-center px-4 text-sm"
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
          <div className="px-4 py-4" style={{ borderBottom: `1px solid ${HUB.divider}` }}>
            <h2 className="text-base font-semibold" style={{ color: HUB.text }}>
              <span className="mr-1.5" aria-hidden>🔥</span>
              Latest
            </h2>
          </div>
          <div className="py-0">
            {loading ? (
              <p className="text-sm px-4 py-6" style={{ color: HUB.textSecondary }}>Loading…</p>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm leading-relaxed" style={{ color: HUB.textSecondary }}>
                  {error || 'No stories to show yet.'}
                </p>
                {browseGoogleForTopic ? (
                  <a
                    href={browseGoogleQuery(browseGoogleForTopic)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-4 text-sm font-semibold underline underline-offset-2"
                    style={{ color: HUB.accent }}
                  >
                    Open {title} on Google News
                  </a>
                ) : null}
              </div>
            ) : (
              <div role="feed" aria-label={`${title} news`}>
                {items.slice(0, 25).map((item, idx, arr) => (
                  <NewsFeedRow
                    key={`${item.url}-${idx}`}
                    item={item}
                    hub={HUB}
                    isLast={idx === arr.length - 1}
                    onOpenShare={(row) =>
                      navigate('/share-suggestions', {
                        state: {
                          newsArticle: {
                            title: row.title,
                            url: row.url,
                            description: row.description || '',
                            image: row.image || null,
                            source: row.source || '',
                          },
                          returnTo: `${location.pathname}${location.search || ''}`,
                        },
                      })
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
