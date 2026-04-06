import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { NewsFeedRow } from '../lib/podTopicNewsShared';
import {
  TOPIC_META,
  browseTopicOnGoogleNews,
  buildFallbackRows,
  getSportsTopicLabel,
  fetchSportsTopicRawItems,
  applyHeadlineRewritesToSportsItems,
} from '../lib/podSportsTopicFeed';
import {
  getSportsTopicFeedCache,
  setSportsTopicFeedCache,
  invalidateSportsTopicFeedCache,
} from '../lib/podSportsTopicPrefetchCache';
import { recordSportsExploreDwell } from '../services/sportsPersonalizationService';

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

  const loadNews = async ({ initialLoad, forceRefresh }) => {
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

    if (forceRefresh) {
      invalidateSportsTopicFeedCache(topicId);
    }

    try {
      if (!forceRefresh && initialLoad) {
        const cached = getSportsTopicFeedCache(topicId);
        if (cached?.items?.length) {
          if (isMountedRef.current && token === loadTokenRef.current) {
            setItems(cached.items);
            setError(cached.error || '');
            setLoading(false);
          }
          if (!cached.rewritten) {
            applyHeadlineRewritesToSportsItems(topicId, cached.items)
              .then((rewritten) => {
                if (!isMountedRef.current || token !== loadTokenRef.current) return;
                setItems(rewritten);
                setError('');
                setSportsTopicFeedCache(topicId, {
                  items: rewritten,
                  error: '',
                  rewritten: true,
                  fromRssPrefetch: false,
                });
              })
              .catch(() => {});
          }
          // Hub prefetch only uses Google RSS (skips NewsAPI). Upgrade in background so Latest matches API.
          if (cached.fromRssPrefetch) {
            const upgradeToken = token;
            void (async () => {
              try {
                const raw = await fetchSportsTopicRawItems(topicId);
                if (!isMountedRef.current || upgradeToken !== loadTokenRef.current) return;
                if (!raw.items?.length) return;

                setSportsTopicFeedCache(topicId, {
                  items: raw.items,
                  error: raw.error || '',
                  rewritten: raw.allowRewrite === false,
                  fromRssPrefetch: false,
                });
                if (isMountedRef.current && upgradeToken === loadTokenRef.current) {
                  setItems(raw.items);
                  setError(raw.error || '');
                }

                if (raw.allowRewrite === false) return;

                const rewritten = await applyHeadlineRewritesToSportsItems(topicId, raw.items);
                if (!isMountedRef.current || upgradeToken !== loadTokenRef.current) return;
                setItems(rewritten);
                setError('');
                setSportsTopicFeedCache(topicId, {
                  items: rewritten,
                  error: '',
                  rewritten: true,
                  fromRssPrefetch: false,
                });
              } catch {
                /* keep prefetched RSS list */
              }
            })();
          }
          return;
        }
      }

      const raw = await fetchSportsTopicRawItems(topicId);
      if (!isMountedRef.current || token !== loadTokenRef.current) return;

      if (!raw.items?.length) {
        const fallbackRows = buildFallbackRows(topicId, title);
        if (isMountedRef.current && token === loadTokenRef.current) {
          setItems(fallbackRows);
          setError(raw.error || 'Live sources unavailable. Showing quick fallback headlines.');
          setSportsTopicFeedCache(topicId, {
            items: fallbackRows,
            error: raw.error || '',
            rewritten: true,
            fromRssPrefetch: false,
          });
        }
        return;
      }

      setSportsTopicFeedCache(topicId, {
        items: raw.items,
        error: raw.error || '',
        rewritten: raw.allowRewrite === false,
        fromRssPrefetch: false,
      });
      if (isMountedRef.current && token === loadTokenRef.current) {
        setItems(raw.items);
        setError(raw.error || '');
        if (initialLoad) setLoading(false);
      }

      if (raw.allowRewrite === false) {
        return;
      }

      const rewritten = await applyHeadlineRewritesToSportsItems(topicId, raw.items);
      if (!isMountedRef.current || token !== loadTokenRef.current) return;
      setItems(rewritten);
      setError('');
      setSportsTopicFeedCache(topicId, {
        items: rewritten,
        error: '',
        rewritten: true,
        fromRssPrefetch: false,
      });
    } catch {
      const msg = 'Live sources unavailable. Showing quick fallback headlines.';
      const fallbackRows = buildFallbackRows(topicId, title);
      if (isMountedRef.current && token === loadTokenRef.current) {
        setItems(fallbackRows);
        setError(msg);
        setSportsTopicFeedCache(topicId, {
          items: fallbackRows,
          error: msg,
          rewritten: true,
          fromRssPrefetch: false,
        });
      }
    } finally {
      if (!isMountedRef.current || token !== loadTokenRef.current) return;
      if (initialLoad) setLoading(false);
      else {
        setRefreshing(false);
        setPullProgress(0);
      }
    }
  };

  useEffect(() => {
    loadNews({ initialLoad: true, forceRefresh: false });
  }, [topicId]);

  useEffect(() => {
    if (!topicId || !TOPIC_META[topicId]) return;
    const key = `pod_sports_explore_visit_${topicId}`;
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(key)) return;
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, '1');
    void recordSportsExploreDwell(topicId, 0, 1);
  }, [topicId]);

  useEffect(() => {
    if (!topicId || !TOPIC_META[topicId]) return;
    let start = Date.now();
    const flush = () => {
      const sec = Math.min(900, Math.round((Date.now() - start) / 1000));
      start = Date.now();
      if (sec >= 3) void recordSportsExploreDwell(topicId, sec, 0);
    };
    const onVis = () => {
      if (document.hidden) flush();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      flush();
    };
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
      loadNews({ initialLoad: false, forceRefresh: true });
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
                  <p
                    className="text-xs px-4 py-3"
                    style={{ color: HUB.textSecondary, borderTop: `1px solid ${HUB.divider}` }}
                  >
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
