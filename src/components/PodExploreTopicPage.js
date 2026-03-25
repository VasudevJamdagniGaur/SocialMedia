import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import {
  googleNewsSearchUrl,
  fetchLiveFromGoogleRssByQuery,
  normalizeArticles,
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
      google: '(AI startup OR machine learning startup OR tech startup funding) when:7d',
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
      google: '(startup funding OR Y Combinator OR venture capital startup) when:7d',
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

function browseGoogleQuery(googleRssQuery) {
  return googleNewsSearchUrl((googleRssQuery || '').replace(/\s+when:\d+d$/i, '').trim());
}

export default function PodExploreTopicPage() {
  const { section, topicId } = useParams();
  const navigate = useNavigate();
  const { isDarkMode } = useTheme();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const topicConfig = EXPLORE_TOPICS[section]?.[topicId];
  const title = topicConfig?.label ?? 'Explore';
  const backTo = POD_EXPLORE_SECTION_HOME[section] || '/pod';

  const apiKey = useMemo(
    () => process.env.REACT_APP_NEWSAPI || process.env.NEWSAPI || '',
    []
  );

  useEffect(() => {
    const cfg = EXPLORE_TOPICS[section]?.[topicId];
    if (!cfg) {
      setItems([]);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        /** @type {Array<{title:string,source:string,url:string,image:null|string,description:string,publishedAt?:string|null,sourceSiteUrl?:string}>|null} */
        let rows = null;

        if (apiKey && cfg.q) {
          try {
            const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(cfg.q)}&language=en&sortBy=publishedAt&pageSize=30&apiKey=${encodeURIComponent(apiKey)}`;
            const res = await fetch(url);
            const data = await res.json();
            if (res.ok && data.status === 'ok' && Array.isArray(data.articles)) {
              const normalized = normalizeArticles(data.articles);
              if (normalized.length) rows = normalized;
            }
          } catch {
            /* RSS below */
          }
        }

        if (!rows?.length && cfg.google) {
          const rss = await fetchLiveFromGoogleRssByQuery(cfg.google);
          if (rss.length) rows = rss.slice(0, 30);
        }

        if (!cancelled) {
          if (rows?.length) {
            setItems(rows);
            setError('');
          } else {
            setItems([]);
            setError('Could not load stories. Check your connection or try opening Google News below.');
          }
        }
      } catch {
        if (!cancelled) {
          setItems([]);
          setError('Could not load stories. Check your connection or try opening Google News below.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [section, topicId, apiKey]);

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
            onClick={() => navigate(backTo)}
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={cardStyle}
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" style={{ color: HUB.text }} />
          </button>
          <h1 className="text-xl font-bold" style={{ color: HUB.text }}>{title}</h1>
        </div>

        <div className="rounded-2xl overflow-hidden" style={cardStyle}>
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
                {topicConfig?.google ? (
                  <a
                    href={browseGoogleQuery(topicConfig.google)}
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
