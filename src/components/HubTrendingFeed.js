import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Flame, Heart } from 'lucide-react';
import { getCurrentUser, onAuthStateChange } from '../services/authService';
import {
  fetchHubPersonalizedFeed,
  incrementHubNewsEngagement,
  recordHubNewsClick,
} from '../services/hubNewsService';

/**
 * Horizontal swipe card — tap opens share suggestions; optional like when signed in.
 */
function HubTrendingCard({ item, idx, HUB, userId, engagementEnabled, navigate, returnTo }) {
  const rootRef = useRef(null);
  const [liked, setLiked] = useState(() =>
    item.id ? sessionStorage.getItem(`hn_like_${item.id}`) === '1' : false
  );

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
    const openedAt = Date.now();
    navigate('/share-suggestions', {
      state: {
        newsArticle: {
          title: item.title,
          url: item.url,
          description: item.description || '',
          image: item.image || null,
          source: item.source || '',
        },
        returnTo,
        hubTrendTracking:
          userId && item.category
            ? { category: item.category, url: item.url, openedAt }
            : undefined,
      },
    });
  }, [item, userId, navigate, returnTo]);

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
      <div
        className="absolute inset-0 z-[1] pointer-events-none"
        style={{
          background: bg,
          backgroundSize: item.image ? 'cover' : 'auto',
          backgroundPosition: item.image ? 'center' : undefined,
        }}
      />
      {engagementEnabled && userId ? (
        <div className="absolute top-2 right-2 z-[3] flex gap-1 pointer-events-auto">
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
      <div className="absolute inset-x-0 bottom-0 z-[2] p-3 pt-8 bg-gradient-to-t from-black via-black/80 to-transparent pointer-events-none">
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
  const [feedProfile, setFeedProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const unsub = onAuthStateChange((u) => setUserId(u?.uid || null));
    return () => unsub();
  }, []);

  const load = useCallback(async () => {
    const uid = getCurrentUser()?.uid;
    if (!uid) {
      setItems([]);
      setLoading(false);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetchHubPersonalizedFeed(uid, { targetSize: 20 });
      if (!res.success) {
        setItems([]);
        setFeedProfile(null);
        setError(res.error || 'Could not load feed');
        return;
      }
      setItems(res.items || []);
      setFeedProfile(res.profile || null);
    } catch (e) {
      setItems([]);
      setError(e?.message || 'Could not load feed');
    } finally {
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

  const carouselItems = items.slice(0, 20);

  return (
    <div className="rounded-2xl overflow-hidden mb-4" style={cardStyle}>
      <div className="flex items-center gap-2 px-4 py-4" style={headerBorder}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${HUB.accent}30` }}>
          <Flame className="w-4 h-4" style={{ color: HUB.accent }} strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Trending</h2>
          {feedProfile &&
          (feedProfile.city || feedProfile.location || (feedProfile.interests && feedProfile.interests.length)) ? (
            <p className={`text-xs mt-0.5 truncate ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
              {[
                feedProfile.city || feedProfile.location || '',
                feedProfile.interests?.length ? feedProfile.interests.slice(0, 4).join(', ') : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
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
            className="flex gap-3 overflow-x-auto overflow-y-hidden pb-2 pr-4 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ WebkitOverflowScrolling: 'touch' }}
            role="region"
            aria-label="Trending news carousel"
          >
            {carouselItems.map((item, idx) => (
              <HubTrendingCard
                key={item.id}
                item={item}
                idx={idx}
                HUB={HUB}
                userId={userId}
                engagementEnabled={userId && !item.fromNewsApiFallback}
                navigate={navigate}
                returnTo={returnTo}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
