import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/** Same palette as Community (Threads-style). */
const THREADS = {
  bg: '#0F0F0F',
  bgSecondary: '#121212',
  text: '#FFFFFF',
  textSecondary: '#A0A0A0',
  divider: '#1E1E1E',
  accent: '#A855F7',
  accentHighlight: '#C084FC',
  accentShadow: '#7E22CE',
};

const WHATSAPP_NUMBER = '9195361381320';

const OBJECTIVE_OPTIONS = [
  { id: 'feature', label: 'Request feature' },
  { id: 'bug', label: 'Report a bug' },
];

export default function HelpImproveDeitePage() {
  const navigate = useNavigate();
  const [objectiveId, setObjectiveId] = useState('feature');
  const [message, setMessage] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const objectiveLabel = objectiveId === 'feature' ? 'Request Feature' : 'Report a Bug';
  const canSend = message.trim().length > 0;

  const openWhatsApp = () => {
    if (!canSend) return;
    const body = `Objective: ${objectiveLabel}\n\nMessage:\n${message.trim()}`;
    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(body)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className="min-h-[100dvh] flex flex-col"
      style={{
        backgroundColor: THREADS.bgSecondary,
        color: THREADS.text,
        paddingTop: 'max(14px, env(safe-area-inset-top, 0px))',
      }}
    >
      <div className="relative z-10 mx-auto flex min-h-0 w-full max-w-[600px] flex-1 flex-col px-4 sm:px-5">
        {/* Threads-style top bar */}
        <header
          className="flex shrink-0 items-center justify-between border-b pb-4 pt-1"
          style={{ borderColor: THREADS.divider }}
        >
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7]"
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5" strokeWidth={2} style={{ color: THREADS.textSecondary }} />
          </button>
          <h1
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-center text-[17px] font-semibold tracking-tight"
            style={{ color: THREADS.text }}
          >
            Help improve{' '}
            <span style={{ color: THREADS.accent }} aria-hidden>
              ✨
            </span>
          </h1>
          <div className="h-9 w-9 shrink-0" aria-hidden />
        </header>

        {/* Scrollable body (composer-first, like “New thread”) */}
        <div
          className="min-h-0 flex-1 space-y-6 overflow-y-auto pb-4 pt-5"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          <div>
            <p className="mb-3 text-[13px] font-medium" style={{ color: THREADS.text }}>
              What are you sending?
            </p>
            <div
              className="flex rounded-full p-1"
              style={{
                background: '#1A1A1A',
                border: `1px solid ${THREADS.divider}`,
              }}
              role="tablist"
              aria-label="Feedback type"
            >
              {OBJECTIVE_OPTIONS.map((opt) => {
                const active = objectiveId === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setObjectiveId(opt.id)}
                    className="min-h-[40px] flex-1 rounded-full px-3 text-[13px] font-semibold tracking-tight transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#A855F7]"
                    style={{
                      color: active ? '#fff' : THREADS.textSecondary,
                      background: active ? THREADS.accent : 'transparent',
                      boxShadow: active ? `0 4px 14px ${THREADS.accentShadow}55` : 'none',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-[13px] font-medium" style={{ color: THREADS.text }}>
                Your message
              </p>
              <span className="text-[11px] font-medium tabular-nums" style={{ color: THREADS.textSecondary }}>
                {(message || '').length}
              </span>
            </div>
            <label htmlFor="help-improve-message" className="sr-only">
              Describe your idea or issue
            </label>
            <div
              className="rounded-2xl p-4"
              style={{
                background: '#1A1A1A',
                border: `1px solid ${THREADS.divider}`,
              }}
            >
              <textarea
                id="help-improve-message"
                ref={inputRef}
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 4000))}
                rows={8}
                placeholder="Describe your idea or issue…"
                className="w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:opacity-55"
                style={{ color: THREADS.text, minHeight: 168, caretColor: THREADS.accent }}
              />
            </div>
            <p className="mt-2 text-[12px] leading-snug" style={{ color: THREADS.textSecondary }}>
              We&apos;ll open WhatsApp with your text filled in — you can edit before sending.
            </p>
          </div>
        </div>

        {/* Sticky bottom bar (Threads-style primary action) */}
        <div
          className="sticky bottom-0 z-10 shrink-0 space-y-3 border-t px-0 pb-[max(16px,env(safe-area-inset-bottom,0px))] pt-4"
          style={{
            borderColor: THREADS.divider,
            background: THREADS.bgSecondary,
          }}
        >
          <button
            type="button"
            disabled={!canSend}
            onClick={openWhatsApp}
            className="flex h-[50px] w-full items-center justify-center rounded-2xl text-[15px] font-semibold transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7] focus-visible:ring-offset-2 focus-visible:ring-offset-[#121212] disabled:cursor-not-allowed disabled:opacity-45"
            style={{
              color: '#fff',
              background: canSend
                ? `linear-gradient(135deg, ${THREADS.accent} 0%, ${THREADS.accentHighlight} 100%)`
                : THREADS.divider,
              boxShadow: canSend ? `0 10px 30px rgba(168, 85, 247, 0.25)` : 'none',
            }}
          >
            Send on WhatsApp
          </button>
          <p className="text-center text-[11px] font-medium leading-relaxed" style={{ color: THREADS.textSecondary }}>
            We read every suggestion ❤️
          </p>
        </div>
      </div>
    </div>
  );
}
