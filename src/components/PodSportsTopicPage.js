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

/** Google News RSS search strings (browser-friendly; no NewsAPI key required). */
const GOOGLE_RSS_QUERY = {
  cricket: 'cricket OR IPL OR T20 OR Ashes when:7d',
  football: 'soccer OR NFL OR FIFA OR UEFA OR "Premier League" when:7d',
  f1: '"Formula 1" OR F1 OR "Grand Prix" when:7d',
  chess: 'chess OR FIDE OR grandmaster OR Candidates when:7d',
  others: 'sports when:7d',
};

function fetchLiveFromGoogleRss(topicId) {
  const q = GOOGLE_RSS_QUERY[topicId];
  return fetchLiveFromGoogleRssByQuery(q || '');
}

/** Match article text to one of the four main Explore topics (used to strip them from “Others”). */
function matchesMainTopic(text) {
  const t = (text || '').toLowerCase();
  const cricket =
    /\b(cricket|ipl|ashes|t20|odi|bbl|psl|wicket|test match|super over)\b/i.test(t);
  const football =
    /\b(soccer|nfl|ncaa football|fifa|uefa|premier league|champions league|la liga|bundesliga|serie a|mls|world cup)\b/i.test(
      t
    ) || /\bfootball\b/i.test(t);
  const f1 =
    /\b(formula\s*1|formula one|\bf1\b|grand prix|qualifying|constructor championship|paddock)\b/i.test(t);
  const chess = /\b(chess|fide|grandmaster|carlsen|nakamura|lichess)\b/i.test(t);
  return cricket || football || f1 || chess;
}

const TOPIC_META = {
  cricket: {
    label: 'Cricket',
    q: '(cricket OR IPL OR "test cricket" OR T20 OR BBL OR PSL OR Ashes OR wicket)',
  },
  football: {
    label: 'Football',
    q: '(soccer OR NFL OR FIFA OR UEFA OR "Premier League" OR "Champions League" OR "La Liga" OR Bundesliga OR MLS OR "World Cup")',
  },
  f1: {
    label: 'F1',
    q: '("Formula 1" OR "Formula One" OR F1 OR "Grand Prix" OR qualifying OR pitwall OR constructors)',
  },
  chess: {
    label: 'Chess',
    q: '(chess OR FIDE OR grandmaster OR Carlsen OR Nakamura OR Candidates OR lichess OR Chess.com)',
  },
  others: {
    label: 'Other sports',
    q: null,
  },
};

function browseTopicOnGoogleNews(topicId) {
  const q = GOOGLE_RSS_QUERY[topicId] || GOOGLE_RSS_QUERY.others;
  return googleNewsSearchUrl(q.replace(/\s+when:\d+d$/i, '').trim());
}

export default function PodSportsTopicPage() {
  const { topicId } = useParams();
  const navigate = useNavigate();
  const { isDarkMode } = useTheme();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const configForTitle = TOPIC_META[topicId];
  const title = configForTitle?.label ?? 'Sports';

  const apiKey = useMemo(
    () => process.env.REACT_APP_NEWSAPI || process.env.NEWSAPI || '',
    []
  );

  useEffect(() => {
    const config = TOPIC_META[topicId];
    if (!config) {
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

        if (apiKey) {
          try {
            if (topicId === 'others') {
              const res = await fetch(
                `https://newsapi.org/v2/top-headlines?category=sports&language=en&pageSize=100&apiKey=${encodeURIComponent(apiKey)}`
              );
              const data = await res.json();
              if (data.status === 'ok' && Array.isArray(data.articles)) {
                const normalized = normalizeArticles(data.articles);
                const filtered = normalized.filter((a) => {
                  const blob = `${a.title} ${a.description || ''}`;
                  return !matchesMainTopic(blob);
                });
                if (filtered.length) rows = filtered.slice(0, 30);
              }
            } else {
              const q = config.q;
              const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=en&sortBy=publishedAt&pageSize=30&apiKey=${encodeURIComponent(apiKey)}`;
              const res = await fetch(url);
              const data = await res.json();
              if (res.ok && data.status === 'ok' && Array.isArray(data.articles)) {
                const normalized = normalizeArticles(data.articles);
                if (normalized.length) rows = normalized;
              }
            }
          } catch {
            /* try Google RSS below */
          }
        }

        if (!rows?.length) {
          let rss = await fetchLiveFromGoogleRss(topicId);
          if (topicId === 'others') {
            rss = rss.filter((a) => !matchesMainTopic(`${a.title} ${a.description || ''}`));
          }
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
  }, [topicId, apiKey]);

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
            onClick={() => navigate('/pod/sports')}
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={cardStyle}
            aria-label="Back to Sports"
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
            {topicId === 'others' && (
              <p className="text-xs mt-1" style={{ color: HUB.textSecondary }}>
                Sports outside Cricket, Football, F1 &amp; Chess
              </p>
            )}
          </div>
          <div className="py-0">
            {loading ? (
              <p className="text-sm px-4 py-6" style={{ color: HUB.textSecondary }}>Loading…</p>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm leading-relaxed" style={{ color: HUB.textSecondary }}>
                  {error || 'No stories to show yet.'}
                </p>
                <a
                  href={browseTopicOnGoogleNews(topicId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-4 text-sm font-semibold underline underline-offset-2"
                  style={{ color: HUB.accent }}
                >
                  Open {title} on Google News
                </a>
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
                {!!error && (
                  <p className="text-xs px-4 py-3" style={{ color: HUB.textSecondary, borderTop: `1px solid ${HUB.divider}` }}>
                    {error}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
