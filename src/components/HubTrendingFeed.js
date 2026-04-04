import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Flame, Heart } from 'lucide-react';
import { getCurrentUser, onAuthStateChange } from '../services/authService';
import {
  fetchHubPersonalizedFeed,
  incrementHubNewsEngagement,
  recordHubNewsClick,
} from '../services/hubNewsService';
import { resolveArticleHeroImage } from '../lib/podTopicNewsShared';

function isDisplayableImageSrc(u) {
  const s = typeof u === 'string' ? u.trim() : '';
  return Boolean(s && (/^https?:\/\//i.test(s) || s.startsWith('data:')));
}

/**
 * Horizontal swipe card — same image rules as Sports `SportsTrendingCard` (NewsAPI urlToImage + data URLs).
 */
function HubTrendingCard({ item, idx, HUB, userId, engagementEnabled, navigate, returnTo, scrollRootRef }) {
  const rootRef = useRef(null);
  const src = typeof item.image === 'string' ? item.image.trim() : '';
  const showApiImg = Boolean(src && (/^https?:\/\//i.test(src) || src.startsWith('data:')));
  const [heroFailed, setHeroFailed] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState(null);
  const [liked, setLiked] = useState(() =>
    item.id ? sessionStorage.getItem(`hn_like_${item.id}`) === '1' : false
  );

  useEffect(() => {
    setHeroFailed(false);
    setResolvedUrl(null);
  }, [item.id, item.url, item.image]);

  useEffect(() => {
    if (!item.url) return;
    if (showApiImg && !heroFailed) return;
    if (resolvedUrl) return;

    const el = rootRef.current;
    let cancelled = false;

    const applyResolved = (u) => {
      const s = typeof u === 'string' ? u.trim() : '';
      if (cancelled) return;
      if (/^https?:\/\//i.test(s) && !/^data:/i.test(s)) {
        setResolvedUrl(s);
        setHeroFailed(false);
      } else if (isDisplayableImageSrc(s)) {
        setResolvedUrl(s);
      }
    };

    const runResolve = () => {
      resolveArticleHeroImage(String(item.url).trim(), {
        publisherUrl: String(item.publisherUrl || '').trim(),
      }).then(applyResolved);
    };

    if (idx < 8) {
      runResolve();
      return () => {
        cancelled = true;
      };
    }

    if (!el || typeof IntersectionObserver === 'undefined') {
      runResolve();
      return () => {
        cancelled = true;
      };
    }

    const root = scrollRootRef?.current || null;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (!e?.isIntersecting || cancelled) return;
        io.disconnect();
        runResolve();
      },
      {
        root: root && root instanceof Element ? root : null,
        rootMargin: '80px 200px 80px 200px',
        threshold: 0.01,
      }
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [item.url, item.publisherUrl, showApiImg, heroFailed, resolvedUrl, idx, scrollRootRef]);

  const displaySrc =
    showApiImg && !heroFailed ? src : resolvedUrl && isDisplayableImageSrc(resolvedUrl) ? resolvedUrl : '';
  const showImg = Boolean(displaySrc);

  useEffect(() => {
    if (!engagementEnabled || !userId || !item.id) return;
    const key = `hn_view_${item.id}`;
    if (sessionStorage.getItem(key)) return;
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (e?.isIntersecting && e.intersectionRatio >= 0.4) {
          sessionStorage.setItem(key, '1');
          incrementHubNewsEngagement(item.id, 'view');
          io.disconnect();
        }
      },
      { threshold: [0.4, 0.9] }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [engagementEnabled, userId, item.id]);

  const onLike = useCallback(
    async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!engagementEnabled || !userId || !item.id) return;
      if (sessionStorage.getItem(`hn_like_${item.id}`)) return;
      sessionStorage.setItem(`hn_like_${item.id}`, '1');
      setLiked(true);
      await incrementHubNewsEngagement(item.id, 'like');
    },
    [engagementEnabled, userId, item.id]
  );

  const openShareSuggestions = useCallback(() => {
    if (!item.url) return;
    if (userId && item.category) recordHubNewsClick(userId, item.category);
    const shareImage =
      showImg && /^https?:\/\//i.test(displaySrc)
        ? displaySrc
        : /^https?:\/\//i.test(String(item.image || '').trim())
          ? String(item.image).trim()
          : null;
    navigate('/share-suggestions', {
      state: {
        newsArticle: {
          title: item.title,
          url: item.url,
          description: item.description || '',
          image: shareImage,
          source: item.source || '',
        },
        returnTo,
      },
    });
  }, [item, userId, navigate, returnTo, showImg, displaySrc]);

  const gradients = [
    'linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)',
    'linear-gradient(135deg,#2d132c 0%,#801336 50%,#c72c41 100%)',
    'linear-gradient(135deg,#0f2027 0%,#203a43 50%,#2c5364 100%)',
    'linear-gradient(135deg,#1e3c72 0%,#2a5298 50%,#7e8ba3 100%)',
    'linear-gradient(135deg,#232526 0%,#414345 100%)',
  ];
  return (
    <div
      ref={rootRef}
      className="relative flex-shrink-0 w-[min(260px,78vw)] snap-start snap-always rounded-xl overflow-hidden border transition-transform active:scale-[0.98] hover:opacity-95"
      style={{
        borderColor: HUB.divider,
        minHeight: 200,
      }}
    >
      <button
        type="button"
        onClick={openShareSuggestions}
        disabled={!item.url}
        className="absolute inset-0 z-0 cursor-pointer border-0 bg-transparent p-0 text-left disabled:cursor-not-allowed disabled:opacity-60"
        aria-label={item.title}
      />
      {showImg ? (
        <img
          src={displaySrc}
          alt=""
          className="absolute inset-0 z-[1] h-full w-full object-cover pointer-events-none"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => {
            setHeroFailed(true);
            setResolvedUrl(null);
          }}
        />
      ) : (
        <div
          className="absolute inset-0 z-[1] pointer-events-none"
          style={{ background: gradients[idx % gradients.length] }}
        />
      )}
      {showImg ? (
        <div
          className="absolute inset-0 z-[2] pointer-events-none"
          style={{
            background:
              'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.15) 40%, transparent 60%)',
          }}
        />
      ) : (
        <div className="absolute inset-0 z-[2] pointer-events-none bg-gradient-to-t from-black/88 via-black/25 to-transparent" />
      )}
      {engagementEnabled && userId ? (
        <div className="absolute top-2 right-2 z-[4] flex gap-1 pointer-events-auto">
          <button
            type="button"
            onClick={onLike}
            className="w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-sm border border-white/15"
            style={{ background: 'rgba(0,0,0,0.45)', color: liked ? '#f472b6' : 'rgba(255,255,255,0.9)' }}
            aria-label={liked ? 'Liked' : 'Like'}
          >
            <Heart className="w-4 h-4" fill={liked ? 'currentColor' : 'none'} strokeWidth={2} />
          </button>
        </div>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 z-[3] p-3 pt-8 bg-gradient-to-t from-black via-black/80 to-transparent pointer-events-none">
        <p className="text-sm font-semibold leading-snug line-clamp-4" style={{ color: '#fff' }}>
          {item.title}
        </p>
      </div>
    </div>
  );
}

/**
 * Hub (Crew home) personalized trending — horizontal swipe carousel (matches Sports trending).
 */
export default function HubTrendingFeed({ isDarkMode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search || ''}`;
  const [userId, setUserId] = useState(() => getCurrentUser()?.uid || null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [insightLines, setInsightLines] = useState([]);
  const loadGenRef = useRef(0);

  useEffect(() => {
    const unsub = onAuthStateChange((u) => setUserId(u?.uid || null));
    return () => unsub();
  }, []);

  const load = useCallback(async () => {
    const uid = getCurrentUser()?.uid;
    if (!uid) {
      setItems([]);
      setInsightLines([]);
      setLoading(false);
      setError('');
      return;
    }
    const gen = ++loadGenRef.current;
    setLoading(true);
    setError('');
    try {
      const res = await fetchHubPersonalizedFeed(uid, { targetSize: 20 });
      if (gen !== loadGenRef.current) return;
      if (!res.success) {
        setItems([]);
        setInsightLines([]);
        setError(res.error || 'Could not load feed');
        return;
      }
      setItems(res.items || []);
      setInsightLines(Array.isArray(res.insights?.lines) ? res.insights.lines : []);
    } catch (e) {
      if (gen !== loadGenRef.current) return;
      setItems([]);
      setInsightLines([]);
      setError(e?.message || 'Could not load feed');
    } finally {
      if (gen !== loadGenRef.current) return;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [userId, load]);

  const HUB = {
    bg: '#0F0F0F',
    text: '#FFFFFF',
    textSecondary: '#A0A0A0',
    divider: '#1E1E1E',
    accent: '#A855F7',
  };

  const cardStyle = {
    background: isDarkMode ? HUB.bg : '#FFFFFF',
    border: `1px solid ${isDarkMode ? HUB.divider : '#E5E7EB'}`,
  };
  const headerBorder = { borderBottom: `1px solid ${isDarkMode ? HUB.divider : '#E5E7EB'}` };

  const carouselItems = items.slice(0, 15);
  const carouselScrollRef = useRef(null);

  return (
    <div className="rounded-2xl overflow-hidden mb-4" style={cardStyle}>
      <div className="flex items-center gap-2 px-4 py-4" style={headerBorder}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${HUB.accent}30` }}>
          <Flame className="w-4 h-4" style={{ color: HUB.accent }} strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Trending</h2>
          {userId && insightLines.length > 0 ? (
            <ul className="mt-2 space-y-1 list-none p-0 m-0">
              {insightLines.map((line, i) => (
                <li
                  key={i}
                  className={`text-[11px] leading-snug ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}
                >
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      <div className="py-3 pl-4">
        {!userId ? (
          <p className={`text-sm pr-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Trending mixes what people engage with near you—not just what&apos;s newest. Sign in to see your feed.
          </p>
        ) : loading ? (
          <p className={`text-sm pr-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Loading your feed…</p>
        ) : error ? (
          <p className={`text-sm pr-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>{error}</p>
        ) : items.length === 0 ? (
          <p className={`text-sm pr-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            No stories yet. Open Sports or add a News API key—new articles will appear here for your region.
          </p>
        ) : (
          <div
            ref={carouselScrollRef}
            className="flex gap-3 overflow-x-auto overflow-y-hidden pb-2 pr-4 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ WebkitOverflowScrolling: 'touch' }}
            role="region"
            aria-label="Trending news carousel"
          >
            {carouselItems.map((item, idx) => (
              <HubTrendingCard
                key={item.id ? String(item.id) : `trend-${idx}-${item.url || ''}`}
                item={item}
                idx={idx}
                HUB={HUB}
                userId={userId}
                engagementEnabled={userId && !item.fromNewsApiFallback}
                navigate={navigate}
                returnTo={returnTo}
                scrollRootRef={carouselScrollRef}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
