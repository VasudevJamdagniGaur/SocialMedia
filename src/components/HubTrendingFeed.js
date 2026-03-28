import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Flame, Heart, Share2 } from 'lucide-react';
import { getCurrentUser, onAuthStateChange } from '../services/authService';
import {
  fetchHubPersonalizedFeed,
  incrementHubNewsEngagement,
  recordHubNewsClick,
} from '../services/hubNewsService';

/**
 * Horizontal swipe card — same interaction model as Sports → Trending carousel.
 */
function HubTrendingCard({ item, idx, HUB, userId, engagementEnabled }) {
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

  const onShare = useCallback(
    async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!engagementEnabled || !userId || !item.id) return;
      const url = item.url || '';
      try {
        if (url && typeof navigator !== 'undefined' && navigator.share) {
          await navigator.share({ title: item.title, url });
        }
      } catch {
        /* cancelled */
      }
      await incrementHubNewsEngagement(item.id, 'share');
    },
    [engagementEnabled, userId, item.id, item.title, item.url]
  );

  const onOpenClick = useCallback(() => {
    if (userId && item.category) recordHubNewsClick(userId, item.category);
  }, [userId, item.category]);

  const tag = item.feedTag;
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
      <a
        href={item.url || undefined}
        target={item.url ? '_blank' : undefined}
        rel={item.url ? 'noopener noreferrer' : undefined}
        onClick={onOpenClick}
        className="absolute inset-0 z-0"
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
          <button
            type="button"
            onClick={onShare}
            className="w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-sm border border-white/15"
            style={{ background: 'rgba(0,0,0,0.45)', color: 'rgba(255,255,255,0.9)' }}
            aria-label="Share"
          >
            <Share2 className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 z-[2] p-3 pt-10 bg-gradient-to-t from-black via-black/80 to-transparent pointer-events-none">
        {tag ? (
          <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: HUB.accent }}>
            <span aria-hidden>{tag.emoji}</span> {tag.label}
          </p>
        ) : null}
        <p className="text-sm font-semibold leading-snug line-clamp-3" style={{ color: '#fff' }}>
          {item.title}
        </p>
        <p
          className="text-[11px] mt-1.5 font-medium uppercase tracking-wide"
          style={{ color: 'rgba(255,255,255,0.65)' }}
        >
          {item.source}
          {item.category ? ` · ${item.category}` : ''}
          {typeof item.trendingScore === 'number' && item.trendingScore > 0 ? (
            <span className="normal-case"> · {item.trendingScore.toFixed(1)}</span>
          ) : null}
        </p>
      </div>
    </div>
  );
}

/**
 * Hub (Crew home) personalized trending — horizontal swipe carousel (matches Sports trending).
 */
export default function HubTrendingFeed({ isDarkMode }) {
  const [userId, setUserId] = useState(() => getCurrentUser()?.uid || null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState({ country: '', city: '', interests: [] });
  const [error, setError] = useState('');
  const [feedNotice, setFeedNotice] = useState('');

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
      setFeedNotice('');
      return;
    }
    setLoading(true);
    setError('');
    setFeedNotice('');
    try {
      const res = await fetchHubPersonalizedFeed(uid, { targetSize: 20 });
      if (!res.success) {
        setItems([]);
        setError(res.error || 'Could not load feed');
        return;
      }
      setItems(res.items || []);
      setFeedNotice(res.feedNotice || '');
      setMeta({
        country: res.profile?.country || '',
        city: res.profile?.city || '',
        interests: res.profile?.interests || [],
      });
    } catch (e) {
      setItems([]);
      setFeedNotice('');
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

  const carouselItems = items.slice(0, 15);

  return (
    <div className="rounded-2xl overflow-hidden mb-4" style={cardStyle}>
      <div className="flex items-center gap-2 px-4 py-4" style={headerBorder}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${HUB.accent}30` }}>
          <Flame className="w-4 h-4" style={{ color: HUB.accent }} strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Trending</h2>
          <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            {userId
              ? meta.country
                ? `Near ${meta.city ? `${meta.city}, ` : ''}${meta.country} · Ranked by engagement over time`
                : 'Personalized for your interests'
              : 'Sign in for a ranked feed by location and interests'}
          </p>
        </div>
      </div>
      {feedNotice ? (
        <p
          className={`text-[11px] leading-snug px-4 py-2 ${isDarkMode ? 'text-amber-200/90 bg-amber-950/40' : 'text-amber-900 bg-amber-50'}`}
        >
          {feedNotice}
        </p>
      ) : null}
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
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
