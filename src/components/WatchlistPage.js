import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bookmark } from 'lucide-react';

const BG = '#0F0F0F';
const DIVIDER = '#1E1E1E';
const MUTED = 'rgba(255,255,255,0.62)';

/**
 * Placeholder for saved / watchlisted content. Opened from Community header.
 */
export default function WatchlistPage() {
  const navigate = useNavigate();

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
      <div className="mx-auto max-w-[600px] px-4 sm:px-5 py-10 text-center text-[15px] font-medium" style={{ color: MUTED }}>
        Items you save will show up here.
      </div>
    </div>
  );
}
