import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bookmark, Trash2 } from 'lucide-react';
import { getTeaWatchlist, removeTeaWatchlistById } from '../lib/teaWatchlistStorage';

const BG = '#0F0F0F';
const DIVIDER = '#1E1E1E';
const MUTED = 'rgba(255,255,255,0.62)';
function isDirectImageUrl(postUrl) {
  if (typeof postUrl !== 'string' || !postUrl.trim()) return false;
  const path = postUrl.trim().split('?')[0].split('#')[0];
  return /\.(jpe?g|png|gif|webp)$/i.test(path);
}

function watchlistHeroUrl(row) {
  const isValidThumbnail =
    typeof row.thumbnail === 'string' && row.thumbnail.trim().startsWith('http');
  if (isDirectImageUrl(row.postUrl)) return row.postUrl.trim();
  if (isValidThumbnail) return row.thumbnail.trim();
  return null;
}

/**
 * Tea posts saved from the Tea fullscreen feed (bookmark). Persisted in localStorage.
 */
export default function WatchlistPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState(() => getTeaWatchlist());

  const reload = useCallback(() => {
    setItems(getTeaWatchlist());
  }, []);

  useEffect(() => {
    const onUpdate = () => reload();
    window.addEventListener('teaWatchlistUpdated', onUpdate);
    window.addEventListener('storage', onUpdate);
    return () => {
      window.removeEventListener('teaWatchlistUpdated', onUpdate);
      window.removeEventListener('storage', onUpdate);
    };
  }, [reload]);

  const remove = useCallback(
    (id) => {
      removeTeaWatchlistById(id);
      reload();
      try {
        window.dispatchEvent(new CustomEvent('teaWatchlistUpdated'));
      } catch (_) {
        /* ignore */
      }
    },
    [reload]
  );

  return (
    <div
      className="min-h-screen"
      style={{
        background: BG,
        color: '#fff',
        paddingTop: 'max(12px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
      }}
    >
      <header
        className="flex items-center gap-2 px-3 py-3 border-b"
        style={{ borderColor: DIVIDER }}
      >
        <button
          type="button"
          onClick={() => navigate('/community', { replace: true })}
          className="flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7]"
          aria-label="Back to Community"
        >
          <ArrowLeft className="h-6 w-6" strokeWidth={2} />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <Bookmark className="h-5 w-5 flex-shrink-0 text-[#A855F7]" strokeWidth={2} aria-hidden />
          <h1 className="text-[17px] font-extrabold tracking-tight truncate">Watchlist</h1>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[600px] px-4 sm:px-5 py-4 space-y-3">
        {items.length === 0 ? (
          <p className="py-12 text-center text-[15px] font-medium" style={{ color: MUTED }}>
            Save posts from Tea with the bookmark button. They will show up here.
          </p>
        ) : (
          items.map((row) => {
            const img = watchlistHeroUrl(row);
            return (
              <div
                key={row.id}
                className="flex gap-3 rounded-2xl border p-3 overflow-hidden"
                style={{
                  borderColor: DIVIDER,
                  background: '#121212',
                }}
              >
                <div
                  className="w-[88px] h-[88px] rounded-xl flex-shrink-0 overflow-hidden"
                  style={{ background: '#1a1a1a' }}
                >
                  {img ? (
                    <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-2xl select-none">
                      ☕
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 flex flex-col gap-2">
                  <a
                    href={row.url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[15px] font-semibold leading-snug text-white hover:underline decoration-white/30 underline-offset-2"
                  >
                    {row.title || 'Tea post'}
                  </a>
                  {row.url ? (
                    <button
                      type="button"
                      onClick={() => remove(row.id)}
                      className="self-start inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition hover:opacity-90 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7]"
                      style={{
                        color: MUTED,
                        border: `1px solid ${DIVIDER}`,
                        background: 'rgba(255,255,255,0.04)',
                      }}
                      aria-label="Remove from watchlist"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
