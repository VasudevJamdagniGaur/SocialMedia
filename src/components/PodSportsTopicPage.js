import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import chatService from '../services/chatService';
import {
  googleNewsSearchUrl,
  getNewsApiKey,
  fetchNewsApiEverythingNormalized,
  fetchNewsApiTopHeadlinesNormalized,
  enrichNewsItemsWithOgImages,
  NewsFeedRow,
} from '../lib/podTopicNewsShared';

/** Google News browse queries (for “Open on Google News” links only). */
const GOOGLE_BROWSE_QUERY = {
  cricket: 'cricket OR IPL OR T20 OR Ashes',
  football: '"Major League Soccer" OR MLS OR NWSL OR USMNT OR USWNT OR "US Soccer"',
  f1: '"Formula 1" OR F1 OR "Grand Prix"',
  chess: 'chess OR FIDE OR grandmaster OR Candidates',
  others: 'sports',
};

/** Keep only articles that clearly belong to the sports tab (NewsAPI “everything” often returns noise). */
function sportArticleMatchesTopic(topicId, item) {
  const blob = `${item?.title || ''} ${item?.description || ''}`;
  if (!blob.trim()) return false;
  switch (topicId) {
    case 'cricket':
      return (
        /\b(cricket|cricketer|cricketers|cricketing)\b/i.test(blob) ||
        /\b(ipl|wpl|psl|bbl|cpl|ilt20|sa20)\b/i.test(blob) ||
        /\b(ashes|wicket|wickets|super over|follow[- ]on)\b/i.test(blob) ||
        /\b(t20|t-20|twenty-?20)\b/i.test(blob) ||
        /\b(odi|one[- ]day international|one[- ]dayers)\b/i.test(blob) ||
        /\b(test match|test series|pink[- ]ball|day[- ]night test)\b/i.test(blob) ||
        /\b(bcci|pcb\b|slc|nzc)\b/i.test(blob) ||
        /\b(batsman|batsmen|batters?|bowlers?|stumping|lbw|googly|yorker|bouncer|maiden)\b/i.test(blob)
      );
    case 'football': {
      // American soccer only: MLS / NWSL / US national teams / USSF / US-based clubs — not NFL, not random int'l friendlies.
      if (
        /\b(nfl|super bowl|touchdown|quarterback|ncaa football|nfl draft|afc championship|nfc championship|gridiron)\b/i.test(
          blob
        ) &&
        !/\b(soccer|mls|nwsl|fifa|goalkeeper|usmnt|uswnt)\b/i.test(blob)
      ) {
        return false;
      }
      const mlsNwslFed =
        /\b(mls|nwsl|major league soccer|national women's soccer league)\b/i.test(blob) ||
        /\b(usmnt|uswnt)\b/i.test(blob) ||
        /\b(us soccer|u\.s\. soccer|ussf|united states soccer federation)\b/i.test(blob);
      const usNatTeam =
        /\bsoccer\b/i.test(blob) &&
        /\b(united states|u\.s\.|usa)\b/i.test(blob) &&
        /\b(men'?s national|women'?s national|national team)\b/i.test(blob);
      const mlsClub =
        /\b(inter miami|lafc|la galaxy|atlanta united|seattle sounders|portland timbers|orlando city|philadelphia union|austin fc|st\.?\s*louis city sc|columbus crew|sporting kansas city|new york city fc|nycfc|dc united|chicago fire|minnesota united|houston dynamo|fc dallas|colorado rapids|real salt lake|san jose earthquakes|vancouver whitecaps|toronto fc|cf montreal|new england revolution|nashville sc|charlotte fc|red bulls|rb ny)\b/i.test(
          blob
        );
      const usCup =
        /\b(leagues cup|gold cup)\b/i.test(blob) &&
        /\b(united states|u\.s\.|usa|usmnt|uswnt|american)\b/i.test(blob);
      const soccerInAmerica =
        /\bsoccer\b/i.test(blob) &&
        /\b(united states|u\.s\.|usa|american|mls|nwsl|usmnt|uswnt)\b/i.test(blob);
      return !!(mlsNwslFed || usNatTeam || mlsClub || usCup || soccerInAmerica);
    }
    case 'f1':
      return (
        /\b(formula\s*1|formula one|\bf1\b)\b/i.test(blob) ||
        /\b(grand prix|qualifying|paddock|constructor|pit stop|pole position)\b/i.test(blob) ||
        /\b(verstappen|hamilton|leclerc|norris|red bull racing|ferrari f1|mclaren f1|mercedes f1)\b/i.test(blob)
      );
    case 'chess':
      return (
        /\b(chess|fide|grandmaster|grandmasters|lichess|chess\.com)\b/i.test(blob) ||
        /\b(carlsen|nakamura|firouzja|ding liren|gukesh|praggnanandhaa)\b/i.test(blob) ||
        /\b(fide candidates|candidates tournament|tata steel chess|grand chess tour)\b/i.test(blob)
      );
    default:
      return true;
  }
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
    q: '("Major League Soccer" OR MLS OR NWSL OR USMNT OR USWNT OR "US Soccer" OR "U.S. Soccer" OR "Inter Miami" OR LAFC OR "LA Galaxy" OR "Atlanta United" OR "Seattle Sounders" OR "Leagues Cup")',
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
  const q = GOOGLE_BROWSE_QUERY[topicId] || GOOGLE_BROWSE_QUERY.others;
  return googleNewsSearchUrl(q.trim());
}

function buildFallbackRows(topicId, label) {
  const q = GOOGLE_BROWSE_QUERY[topicId] || GOOGLE_BROWSE_QUERY.others;
  const baseUrl = googleNewsSearchUrl(q.trim());
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

export default function PodSportsTopicPage() {
  const { topicId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { isDarkMode } = useTheme();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [pullProgress, setPullProgress] = useState(0);

  const pullStartYRef = useRef(null);
  const pullDistanceRef = useRef(0);
  const loadTokenRef = useRef(0);
  const isMountedRef = useRef(true);

  const configForTitle = TOPIC_META[topicId];
  const title = configForTitle?.label ?? 'Sports';

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadNews = async ({ initialLoad }) => {
    const config = TOPIC_META[topicId];
    if (!config) {
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

      const apiKey = getNewsApiKey();
      if (!apiKey) {
        const msg =
          'Add REACT_APP_NEWSAPI to your .env file and restart the dev server. Showing browse links only.';
        const fallbackRows = buildFallbackRows(topicId, title);
        if (isMountedRef.current && token === loadTokenRef.current) {
          setItems(fallbackRows);
          setError(msg);
        }
        return;
      }

      if (topicId === 'others') {
        const normalized = await fetchNewsApiTopHeadlinesNormalized({
          category: 'sports',
          language: 'en',
          pageSize: 100,
        });
        const filtered = normalized.filter((a) => {
          const blob = `${a.title} ${a.description || ''}`;
          return !matchesMainTopic(blob);
        });
        if (filtered.length) rows = filtered.slice(0, 30);
      } else if (config.q) {
        const fetched = await fetchNewsApiEverythingNormalized({ q: config.q, pageSize: 100 });
        const onTopic = (fetched || []).filter((a) => sportArticleMatchesTopic(topicId, a));
        rows = onTopic.slice(0, 30);
      }

      if (!rows?.length) {
        const msg =
          'NewsAPI returned no articles (check your key, plan limits, or query). Showing quick fallback headlines.';
        const fallbackRows = buildFallbackRows(topicId, title);
        if (isMountedRef.current && token === loadTokenRef.current) {
          setItems(fallbackRows);
          setError(msg);
        }
        return;
      }

      const enriched = await enrichNewsItemsWithOgImages(rows, { enableOgFallback: true });
      if (isMountedRef.current && token === loadTokenRef.current) {
        // 1) De-dupe stories by near-duplicate TITLE (not just URL).
        const normWords = (s) =>
          String(s || '')
            .toLowerCase()
            .replace(/https?:\/\/\S+/g, ' ')
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(Boolean)
            .filter((w) => w.length > 2);
        const jaccard = (a, b) => {
          const A = new Set(normWords(a));
          const B = new Set(normWords(b));
          if (!A.size || !B.size) return 0;
          let inter = 0;
          for (const w of A) if (B.has(w)) inter++;
          const uni = A.size + B.size - inter;
          return uni ? inter / uni : 0;
        };
        const deduped = [];
        for (const it of enriched) {
          if (!it?.title) continue;
          const already = deduped.some((x) => jaccard(x.title, it.title) >= 0.62);
          if (!already) deduped.push(it);
        }

        // 2) Rewrite headlines with OpenAI, enforce uniqueness, retry conflicts once.
        const extractMustMention = (titleText) => {
          const t = String(titleText || '');
          const out = [];
          const push = (w) => {
            const s = String(w || '').trim();
            if (!s) return;
            if (out.includes(s)) return;
            out.push(s);
          };
          // Proper nouns / acronyms
          for (const m of t.matchAll(/\b[A-Z]{2,}\b/g)) push(m[0]);
          for (const m of t.matchAll(/\b[A-Z][a-z]{2,}\b/g)) push(m[0]);
          // Money/number signals (keep short)
          for (const m of t.matchAll(/\$?\d[\d.,]*\s?(?:B|BN|M|million|billion|crore)?\b/g)) push(m[0]);
          // Remove generic tokens
          const generic = new Set(['The', 'A', 'An', 'And', 'For', 'With', 'From', 'Into', 'Over', 'After', 'More', 'New', 'Team', 'Teams', 'Sold', 'Buy', 'Buys', 'Deal']);
          return out.filter((x) => !generic.has(x)).slice(0, 6);
        };

        const extractFactTokens = (titleText, descriptionText) => {
          const t = `${String(titleText || '')} ${String(descriptionText || '')}`;
          const out = [];
          const push = (w) => {
            const s = String(w || '').trim();
            if (!s) return;
            if (out.includes(s)) return;
            out.push(s);
          };
          // Dates/months
          for (const m of t.matchAll(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/gi)) push(m[0]);
          for (const m of t.matchAll(/\b\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/gi)) push(m[0]);
          // Numbers with context / money / percentages
          for (const m of t.matchAll(/\b(?:₹|\$|€|£)\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|bn|b|crore|lakh|million|billion)?\b/gi)) push(m[0]);
          for (const m of t.matchAll(/\b\d[\d,]*(?:\.\d+)?\s?(?:k|m|bn|b|crore|lakh|million|billion|%)\b/gi)) push(m[0]);
          // Scores like 3-1, 212/4
          for (const m of t.matchAll(/\b\d{1,3}\s?[-–]\s?\d{1,3}\b/g)) push(m[0]);
          for (const m of t.matchAll(/\b\d{1,3}\/\d{1,2}\b/g)) push(m[0]);
          return out.slice(0, 6);
        };

        const payload = deduped.map((x) => ({
          title: x.title,
          url: x.url,
          description: x.description || '',
          mustMention: extractMustMention(x.title),
          factTokens: extractFactTokens(x.title, x.description || ''),
        }));
        const headings1 = await chatService.rewriteNewsHeadlines(payload, {
          maxHeadlines: Math.min(30, payload.length),
        });
        const normalizedKey = (h) =>
          String(h || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        const used = new Set();
        const conflicts = [];
        const finalHeadings = headings1.map((h, idx) => {
          const cleaned = String(h || '').trim();
          const key = normalizedKey(cleaned);
          const must = Array.isArray(payload[idx]?.mustMention) ? payload[idx].mustMention : [];
          const hasMust =
            !must.length ||
            must.some((tok) => cleaned.toLowerCase().includes(String(tok).toLowerCase()));
          const facts = Array.isArray(payload[idx]?.factTokens) ? payload[idx].factTokens : [];
          const hasFact =
            !facts.length ||
            facts.some((tok) => cleaned.toLowerCase().includes(String(tok).toLowerCase()));
          const bannedTemplate = /\b(all you need to know|everything you need to know|here(?:’|')?s what we know|explained)\b/i.test(cleaned);
          if (!cleaned || !key || used.has(key) || !hasMust || !hasFact || bannedTemplate) {
            conflicts.push(idx);
            return '';
          }
          used.add(key);
          return cleaned;
        });

        if (conflicts.length) {
          const avoidHeadings = Array.from(used).slice(0, 60);
          const conflictItems = conflicts.map((idx) => payload[idx]);
          const headings2 = await chatService.rewriteNewsHeadlines(conflictItems, {
            maxHeadlines: conflictItems.length,
            avoidHeadings,
          });
          for (let i = 0; i < conflicts.length; i++) {
            const idx = conflicts[i];
            const candidate = String(headings2?.[i] || '').trim();
            const key = normalizedKey(candidate);
            const must = Array.isArray(payload[idx]?.mustMention) ? payload[idx].mustMention : [];
            const hasMust =
              !must.length ||
              must.some((tok) => candidate.toLowerCase().includes(String(tok).toLowerCase()));
            const facts = Array.isArray(payload[idx]?.factTokens) ? payload[idx].factTokens : [];
            const hasFact =
              !facts.length ||
              facts.some((tok) => candidate.toLowerCase().includes(String(tok).toLowerCase()));
            const bannedTemplate = /\b(all you need to know|everything you need to know|here(?:’|')?s what we know|explained)\b/i.test(candidate);
            if (candidate && key && !used.has(key) && hasMust && hasFact && !bannedTemplate) {
              used.add(key);
              finalHeadings[idx] = candidate;
            } else {
              // Deterministic last resort: fall back to original title (still unique after title-dedupe).
              finalHeadings[idx] = payload[idx].title;
            }
          }
        }

        const rewritten = deduped.map((x, idx) => ({ ...x, title: finalHeadings[idx] || x.title }));
        setItems(rewritten);
        setError('');
      }
    } catch {
      const msg = 'Live sources unavailable. Showing quick fallback headlines.';
      const fallbackRows = buildFallbackRows(topicId, title);
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
  }, [topicId]);

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
