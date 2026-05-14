import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

const HUB = {
  bg: '#0F0F0F',
  bgSecondary: '#121212',
  text: '#FFFFFF',
  textSecondary: '#A0A0A0',
  divider: '#1E1E1E',
  accent: '#A855F7',
  accentHighlight: '#C084FC',
};

const WHATSAPP_NUMBER = '9195361381320';

const OBJECTIVE_OPTIONS = [
  { id: 'feature', label: 'Request Feature' },
  { id: 'bug', label: 'Report a Bug' },
];

export default function HelpImproveDeitePage() {
  const navigate = useNavigate();
  const { isDarkMode } = useTheme();
  const [objectiveId, setObjectiveId] = useState('feature');
  const [message, setMessage] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const objectiveLabel = OBJECTIVE_OPTIONS.find((o) => o.id === objectiveId)?.label ?? 'Request Feature';
  const canSend = message.trim().length > 0;

  const openWhatsApp = () => {
    if (!canSend) return;
    const body = `Objective: ${objectiveLabel}\n\nMessage:\n${message.trim()}`;
    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(body)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className="min-h-screen max-w-lg mx-auto px-4 pb-10"
      style={{
        backgroundColor: HUB.bg,
        color: HUB.text,
        paddingTop: 'max(12px, env(safe-area-inset-top, 0px))',
      }}
    >
      <header className="flex items-center gap-3 py-3 mb-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7]"
          aria-label="Go back"
        >
          <ArrowLeft className="h-6 w-6" strokeWidth={2} style={{ color: HUB.text }} />
        </button>
        <h1 className="text-lg font-bold tracking-tight" style={{ color: HUB.text }}>
          ✨ Help Improve Deite
        </h1>
      </header>

      <div className="flex gap-2 mb-5">
        {OBJECTIVE_OPTIONS.map((opt) => {
          const active = objectiveId === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setObjectiveId(opt.id)}
              className="flex-1 rounded-2xl px-3 py-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7]"
              style={{
                color: active ? HUB.accent : HUB.textSecondary,
                backgroundColor: active ? 'rgba(168,85,247,0.18)' : HUB.bgSecondary,
                border: `1px solid ${active ? 'rgba(168,85,247,0.45)' : HUB.divider}`,
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <label htmlFor="help-improve-message" className="sr-only">
        Describe your idea or issue
      </label>
      <textarea
        id="help-improve-message"
        ref={inputRef}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={6}
        placeholder="Describe your idea or issue…"
        className="w-full resize-y rounded-2xl border px-4 py-3 text-[15px] leading-relaxed outline-none transition focus:ring-2 focus:ring-[#A855F7]/35"
        style={{
          minHeight: 140,
          backgroundColor: isDarkMode ? HUB.bgSecondary : '#1a1a1a',
          borderColor: HUB.divider,
          color: HUB.text,
          caretColor: HUB.accent,
        }}
      />

      <button
        type="button"
        disabled={!canSend}
        onClick={openWhatsApp}
        className="mt-5 w-full rounded-2xl py-3.5 text-[15px] font-bold transition enabled:active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7]"
        style={{
          color: '#fff',
          background: canSend
            ? `linear-gradient(135deg, ${HUB.accent} 0%, ${HUB.accentHighlight} 100%)`
            : HUB.divider,
          boxShadow: canSend ? '0 10px 28px rgba(168, 85, 247, 0.28)' : 'none',
        }}
      >
        Send on WhatsApp
      </button>

      <p
        className="mt-8 text-center text-xs font-medium"
        style={{ color: HUB.textSecondary }}
      >
        We read every suggestion ❤️
      </p>
    </div>
  );
}
