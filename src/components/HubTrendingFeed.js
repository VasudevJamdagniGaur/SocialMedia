import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Flame, Heart, Share2 } from 'lucide-react';
import { getCurrentUser, onAuthStateChange } from '../services/authService';
import {
  fetchHubPersonalizedFeed,
  incrementHubNewsEngagement,
  recordHubNewsClick,
} from '../services/hubNewsService';

function HubTrendingRow({ item, HUB, userId, textColor, textSecondary }) {
  const rootRef = useRef(null);
  const [liked, setLiked] = useState(() =>
    item.id ? sessionStorage.getItem(`hn_like_${item.id}`) === '1' : false
  );

  useEffect(() => {
    if (!userId || !item.id) return;
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
  }, [userId, item.id]);

  const onLike = useCallback(
    async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!userId || !item.id) return;
      if (sessionStorage.getItem(`hn_like_${item.id}`)) return;
      sessionStorage.setItem(`hn_like_${item.id}`, '1');
      setLiked(true);
      await incrementHubNewsEngagement(item.id, 'like');
    },
    [userId, item.id]
  );

  const onShare = useCallback(
    async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!userId || !item.id) return;
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
    [userId, item.id, item.title, item.url]
  );

  const openArticle = useCallback(() => {
    if (userId && item.category) recordHubNewsClick(userId, item.category);
    if (item.url) window.open(item.url, '_blank', 'noopener,noreferrer');
  }, [userId, item.category, item.url]);

  const tag = item.feedTag;

  return (
    <div
      ref={rootRef}
      className="relative rounded-xl overflow-hidden border mb-3 last:mb-0"
      style={{ borderColor: HUB.divider, background: HUB.bg }}
    >
      <button
        type="button"
        onClick={openArticle}
        className="w-full text-left relative z-0 min-h-[100px]"
        aria-label={item.title}
      >
        <div className="flex gap-3 p-3">
          <div
            className="w-24 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-black/30"
            style={{
              backgroundImage: item.image ? `url(${item.image})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
          <div className="flex-1 min-w-0 py-0.5">
            {tag ? (
              <span
                className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide mb-1"
                style={{ color: HUB.accent }}
              >
                <span aria-hidden>{tag.emoji}</span> {tag.label}
              </span>
            ) : null}
            <p className="text-sm font-semibold leading-snug line-clamp-3" style={{ color: textColor }}>
              {item.title}
            </p>
            <p className="text-[11px] mt-1.5" style={{ color: textSecondary }}>
              {item.source}
              {item.category ? ` · ${item.category}` : ''}
              {typeof item.trendingScore === 'number' ? ` · ${item.trendingScore.toFixed(1)}` : ''}
            </p>
          </div>
        </div>
      </button>
      {userId ? (
        <div className="absolute top-2 right-2 z-[2] flex gap-1">
          <button
            type="button"
            onClick={onLike}
            className="w-9 h-9 rounded-full flex items-center justify-center border"
            style={{
              background: 'rgba(0,0,0,0.5)',
              borderColor: HUB.divider,
              color: liked ? '#f472b6' : textSecondary,
            }}
            aria-label="Like"
          >
            <Heart className="w-4 h-4" fill={liked ? 'currentColor' : 'none'} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={onShare}
            className="w-9 h-9 rounded-full flex items-center justify-center border"
            style={{
              background: 'rgba(0,0,0,0.5)',
              borderColor: HUB.divider,
              color: textSecondary,
            }}
            aria-label="Share"
          >
            <Share2 className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Hub (Crew home) personalized trending: country + interests + engagement + time decay + mixed feed.
 */
export default function HubTrendingFeed({ isDarkMode }) {
  const [userId, setUserId] = useState(() => getCurrentUser()?.uid || null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState({ country: '', city: '', interests: [] });
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
        setError(res.error || 'Could not load feed');
        return;
      }
      setItems(res.items || []);
      setMeta({
        country: res.profile?.country || '',
        city: res.profile?.city || '',
        interests: res.profile?.interests || [],
      });
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

  const textColor = isDarkMode ? HUB.text : '#111827';
  const textSecondary = isDarkMode ? HUB.textSecondary : '#6B7280';

  const cardStyle = {
    background: isDarkMode ? HUB.bg : '#FFFFFF',
    border: `1px solid ${isDarkMode ? HUB.divider : '#E5E7EB'}`,
  };
  const headerBorder = { borderBottom: `1px solid ${isDarkMode ? HUB.divider : '#E5E7EB'}` };

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
      <div className="px-3 py-3">
        {!userId ? (
          <p className={`text-sm px-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Trending mixes what people engage with near you—not just what&apos;s newest. Sign in to see your feed.
          </p>
        ) : loading ? (
          <p className={`text-sm px-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Loading your feed…</p>
        ) : error ? (
          <p className={`text-sm px-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>{error}</p>
        ) : items.length === 0 ? (
          <p className={`text-sm px-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            No stories yet. Open Sports or add a News API key—new articles will appear here for your region.
          </p>
        ) : (
          items.map((item) => (
            <HubTrendingRow
              key={item.id}
              item={item}
              HUB={HUB}
              userId={userId}
              textColor={textColor}
              textSecondary={textSecondary}
            />
          ))
        )}
      </div>
    </div>
  );
}
