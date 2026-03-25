import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

/** When there is no direct article URL, open a relevant Google News search (still a real navigation). */
function googleNewsSearchUrl(query) {
  const q = (query || 'sports').trim() || 'sports';
  return `https://news.google.com/search?q=${encodeURIComponent(q)}&hl=en&gl=US&ceid=US:en`;
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
    /** NewsAPI everything `q` — scoped to the sport */
    q: '(cricket OR IPL OR "test cricket" OR T20 OR BBL OR PSL OR Ashes OR wicket)',
    fallbacks: [
      {
        title: 'International cricket boards finalize next championship window',
        source: 'Cricket Desk',
        image: null,
        url: googleNewsSearchUrl('international cricket championship news'),
      },
      {
        title: 'T20 leagues see record streaming numbers across regions',
        source: 'Sports Media',
        image: null,
        url: googleNewsSearchUrl('T20 cricket leagues streaming'),
      },
      {
        title: 'Injury updates shift line-ups ahead of key bilateral series',
        source: 'Team Reports',
        image: null,
        url: googleNewsSearchUrl('cricket team injury news'),
      },
    ],
  },
  football: {
    label: 'Football',
    q: '(soccer OR NFL OR FIFA OR UEFA OR "Premier League" OR "Champions League" OR "La Liga" OR Bundesliga OR MLS OR "World Cup")',
    fallbacks: [
      {
        title: 'European leagues enter the decisive stretch of the season',
        source: 'Football Weekly',
        image: null,
        url: googleNewsSearchUrl('European football league news'),
      },
      {
        title: 'NFL playoff picture tightens after weekend results',
        source: 'Gridiron',
        image: null,
        url: googleNewsSearchUrl('NFL playoff standings news'),
      },
      {
        title: 'Transfer talk intensifies as windows approach',
        source: 'Rumour Mill',
        image: null,
        url: googleNewsSearchUrl('football transfer window rumors'),
      },
    ],
  },
  f1: {
    label: 'F1',
    q: '("Formula 1" OR "Formula One" OR F1 OR "Grand Prix" OR qualifying OR pitwall OR constructors)',
    fallbacks: [
      {
        title: 'Teams bring aero updates ahead of the next race weekend',
        source: 'Motorsport',
        image: null,
        url: googleNewsSearchUrl('Formula 1 aero updates race weekend'),
      },
      {
        title: 'Championship battle narrows after latest circuit results',
        source: 'F1 Briefing',
        image: null,
        url: googleNewsSearchUrl('F1 championship standings'),
      },
      {
        title: 'Sprint format and tyre strategy stay in focus for team principals',
        source: 'Paddock',
        image: null,
        url: googleNewsSearchUrl('F1 sprint format tyre strategy'),
      },
    ],
  },
  chess: {
    label: 'Chess',
    q: '(chess OR FIDE OR grandmaster OR Carlsen OR Nakamura OR Candidates OR lichess OR Chess.com)',
    fallbacks: [
      {
        title: 'Elite rapid events draw record online audiences',
        source: 'Chess Chronicle',
        image: null,
        url: googleNewsSearchUrl('chess rapid tournament streaming'),
      },
      {
        title: 'FIDE calendar adds hybrid classical-rapid stops',
        source: 'Federation Wire',
        image: null,
        url: googleNewsSearchUrl('FIDE chess calendar'),
      },
      {
        title: 'Young talents climb rankings after major open victories',
        source: 'Ratings Watch',
        image: null,
        url: googleNewsSearchUrl('chess rankings young grandmasters'),
      },
    ],
  },
  others: {
    label: 'Other sports',
    q: null,
    fallbacks: [
      {
        title: 'Olympic sports see renewed investment in grassroots programs',
        source: 'Olympic Desk',
        image: null,
        url: googleNewsSearchUrl('Olympic sports grassroots programs'),
      },
      {
        title: 'Tennis and basketball lead weekend arena attendance',
        source: 'Arena Digest',
        image: null,
        url: googleNewsSearchUrl('tennis basketball sports attendance'),
      },
      {
        title: 'Combat sports cards announce cross-promotion showcases',
        source: 'Combat Wire',
        image: null,
        url: googleNewsSearchUrl('combat sports boxing UFC news'),
      },
    ],
  },
};

function normalizeArticles(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((a) => a?.title)
    .map((a) => {
      const direct = typeof a.url === 'string' ? a.url.trim() : '';
      return {
        title: a.title,
        source: a?.source?.name || 'News',
        url: direct || googleNewsSearchUrl(a.title),
        image: a.urlToImage || null,
        description: a.description || '',
      };
    });
}

export default function PodSportsTopicPage() {
  const { topicId } = useParams();
  const navigate = useNavigate();
  const { isDarkMode } = useTheme();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const meta = TOPIC_META[topicId] || TOPIC_META.cricket;
  const title = meta.label;

  const apiKey = useMemo(
    () => process.env.REACT_APP_NEWSAPI || process.env.NEWSAPI || '',
    []
  );

  useEffect(() => {
    const config = TOPIC_META[topicId];
    if (!config) {
      setItems(TOPIC_META.cricket.fallbacks);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        if (!apiKey) {
          setItems(config.fallbacks);
          return;
        }

        if (topicId === 'others') {
          const res = await fetch(
            `https://newsapi.org/v2/top-headlines?category=sports&language=en&pageSize=100&apiKey=${encodeURIComponent(apiKey)}`
          );
          if (!res.ok) throw new Error(`News API ${res.status}`);
          const data = await res.json();
          const raw = Array.isArray(data?.articles) ? data.articles : [];
          const normalized = normalizeArticles(raw);
          const filtered = normalized.filter((a) => {
            const blob = `${a.title} ${a.description || ''}`;
            return !matchesMainTopic(blob);
          });
          if (!cancelled) {
            setItems(filtered.length ? filtered.slice(0, 30) : config.fallbacks);
            if (!filtered.length) setError('No non-main sports stories right now — showing samples.');
          }
          return;
        }

        const q = config.q;
        const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=en&sortBy=publishedAt&pageSize=30&apiKey=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`News API ${res.status}`);
        const data = await res.json();
        const raw = Array.isArray(data?.articles) ? data.articles : [];
        const normalized = normalizeArticles(raw);
        if (!cancelled) {
          setItems(normalized.length ? normalized : config.fallbacks);
          if (!normalized.length) setError('No recent articles matched — showing samples.');
        }
      } catch {
        if (!cancelled) {
          setItems(config.fallbacks);
          setError('Could not load live news — showing offline picks.');
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

  const gradients = [
    'linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)',
    'linear-gradient(135deg,#2d132c 0%,#801336 50%,#c72c41 100%)',
    'linear-gradient(135deg,#0f2027 0%,#203a43 50%,#2c5364 100%)',
    'linear-gradient(135deg,#1e3c72 0%,#2a5298 50%,#7e8ba3 100%)',
    'linear-gradient(135deg,#232526 0%,#414345 100%)',
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
              Latest <span className="font-normal" style={{ color: HUB.textSecondary }}>(Swipe)</span>
            </h2>
            {topicId === 'others' && (
              <p className="text-xs mt-1" style={{ color: HUB.textSecondary }}>
                Sports outside Cricket, Football, F1 &amp; Chess
              </p>
            )}
          </div>
          <div className="py-3 pl-4">
            {loading ? (
              <p className="text-sm pr-4" style={{ color: HUB.textSecondary }}>Loading…</p>
            ) : (
              <>
                <div
                  className="flex gap-3 overflow-x-auto overflow-y-hidden pb-2 pr-4 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  style={{ WebkitOverflowScrolling: 'touch' }}
                  role="region"
                  aria-label={`${title} news`}
                >
                  {items.slice(0, 20).map((item, idx) => {
                    const bg = item.image
                      ? `linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.15) 40%, transparent 60%), url(${item.image}) center/cover no-repeat`
                      : gradients[idx % gradients.length];
                    return (
                      <a
                        key={`${item.title}-${idx}`}
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
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
                {!!error && (
                  <p className="text-xs mt-2 pr-4" style={{ color: HUB.textSecondary }}>{error}</p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
