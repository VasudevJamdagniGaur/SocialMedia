import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Linkedin, Twitter, Share2 } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { getCurrentUser } from '../services/authService';
import firestoreService from '../services/firestoreService';
import { getDateId } from '../utils/dateUtils';

const HUB = {
  bg: '#0F0F0F',
  bgSecondary: '#121212',
  text: '#FFFFFF',
  textSecondary: '#A0A0A0',
  divider: '#1E1E1E',
  accent: '#A855F7',
  accentHighlight: '#C084FC',
  accentShadow: '#7E22CE',
};

// Reddit brand color for icon
const REDDIT_COLOR = '#FF4500';

function buildSuggestions(original) {
  const t = (original || '').trim();
  if (!t) return [];
  const short = t.length > 120 ? t.slice(0, 117).trim() + '...' : t;
  const asQuestion = t.endsWith('.') ? t.slice(0, -1) + '?' : t + '?';
  return [
    { id: 'original', label: 'Use as-is', text: t },
    { id: 'short', label: 'Short version', text: short },
    { id: 'question', label: 'As a question', text: asQuestion },
  ];
}

export default function ShareSuggestionsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isDarkMode } = useTheme();
  const state = location.state || {};
  const reflectionFromState = (state.reflection ?? '').trim();

  const [selectedSuggestionId, setSelectedSuggestionId] = useState('original');
  const suggestions = buildSuggestions(reflectionFromState);
  const selectedText = suggestions.find((s) => s.id === selectedSuggestionId)?.text ?? reflectionFromState;

  const reflectionDate = state.selectedDate ? (state.selectedDate instanceof Date ? state.selectedDate : new Date(state.selectedDate)) : new Date();
  const dateStr = reflectionDate instanceof Date ? getDateId(reflectionDate) : getDateId(new Date(reflectionDate));

  const recordShare = (platform) => {
    const user = getCurrentUser();
    if (user?.uid) {
      firestoreService.saveSocialShare(user.uid, {
        platform,
        reflectionDate: dateStr,
        reflectionSnippet: (selectedText || '').slice(0, 200) || undefined,
      });
    }
  };

  const shareToLinkedIn = () => {
    if (!selectedText) return;
    const url = typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://deite.app';
    const shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
    window.open(shareUrl, '_blank', 'noopener,noreferrer');
    recordShare('linkedin');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(selectedText);
    }
  };

  const shareToTwitter = () => {
    if (!selectedText) return;
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(selectedText)}`,
      '_blank',
      'noopener,noreferrer'
    );
    recordShare('x');
  };

  const shareToReddit = () => {
    if (!selectedText) return;
    const title = 'My reflection';
    window.open(
      `https://www.reddit.com/submit?title=${encodeURIComponent(title)}&selftext=${encodeURIComponent(selectedText)}`,
      '_blank',
      'noopener,noreferrer'
    );
    recordShare('reddit');
  };

  if (!reflectionFromState) {
    navigate('/dashboard', { replace: true });
    return null;
  }

  return (
    <div
      className="min-h-screen flex flex-col px-4 py-6 pb-10"
      style={{ background: isDarkMode ? HUB.bg : '#F5F5F5' }}
    >
      <div className="max-w-md w-full mx-auto flex flex-col flex-1">
        {/* Back + Header */}
        <div className="flex items-center gap-3 pt-2 pb-4">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="p-2 -ml-2 rounded-full transition-opacity hover:opacity-90"
            style={{ color: isDarkMode ? HUB.textSecondary : '#666' }}
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" strokeWidth={2} />
          </button>
          <h1
            className="text-lg font-semibold"
            style={{ color: isDarkMode ? HUB.text : '#1A1A1A' }}
          >
            Suggestions for your post
          </h1>
        </div>

        {/* Reflection preview */}
        <div
          className="rounded-xl p-4 mb-6"
          style={{
            background: isDarkMode ? HUB.bgSecondary : '#FFFFFF',
            border: `1px solid ${isDarkMode ? HUB.divider : 'rgba(0,0,0,0.08)'}`,
          }}
        >
          <p
            className="text-sm leading-relaxed"
            style={{ color: isDarkMode ? HUB.textSecondary : '#666' }}
          >
            Your reflection
          </p>
          <p
            className="text-[15px] leading-relaxed mt-1"
            style={{ color: isDarkMode ? HUB.text : '#1A1A1A' }}
          >
            {reflectionFromState}
          </p>
        </div>

        {/* Suggestion options */}
        <p
          className="text-sm font-medium mb-3"
          style={{ color: isDarkMode ? HUB.text : '#1A1A1A' }}
        >
          Choose a version to share
        </p>
        <div className="space-y-3 mb-8">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedSuggestionId(s.id)}
              className="w-full text-left rounded-xl p-4 transition-all"
              style={{
                background: selectedSuggestionId === s.id
                  ? (isDarkMode ? `${HUB.accent}20` : 'rgba(168, 85, 247, 0.12)')
                  : (isDarkMode ? HUB.bgSecondary : '#FFFFFF'),
                border: `1px solid ${selectedSuggestionId === s.id ? HUB.accent : (isDarkMode ? HUB.divider : 'rgba(0,0,0,0.08)')}`,
              }}
            >
              <p
                className="text-xs font-semibold mb-1"
                style={{ color: HUB.accent }}
              >
                {s.label}
              </p>
              <p
                className="text-[14px] leading-relaxed"
                style={{ color: isDarkMode ? HUB.text : '#333' }}
              >
                {s.text}
              </p>
            </button>
          ))}
        </div>

        {/* Share to: LinkedIn, Twitter, Reddit */}
        <p
          className="text-sm font-medium mb-3"
          style={{ color: isDarkMode ? HUB.text : '#1A1A1A' }}
        >
          Share to
        </p>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={shareToLinkedIn}
            className="flex items-center gap-4 rounded-xl px-5 py-4 transition-opacity hover:opacity-90"
            style={{
              background: isDarkMode ? HUB.bgSecondary : '#FFFFFF',
              border: `1px solid ${isDarkMode ? HUB.divider : 'rgba(0,0,0,0.08)'}`,
            }}
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(10, 102, 194, 0.2)' }}
            >
              <Linkedin className="w-5 h-5" style={{ color: '#0A66C2' }} strokeWidth={2} />
            </div>
            <span className="font-medium" style={{ color: isDarkMode ? HUB.text : '#1A1A1A' }}>
              LinkedIn
            </span>
          </button>

          <button
            type="button"
            onClick={shareToTwitter}
            className="flex items-center gap-4 rounded-xl px-5 py-4 transition-opacity hover:opacity-90"
            style={{
              background: isDarkMode ? HUB.bgSecondary : '#FFFFFF',
              border: `1px solid ${isDarkMode ? HUB.divider : 'rgba(0,0,0,0.08)'}`,
            }}
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(29, 155, 240, 0.2)' }}
            >
              <Twitter className="w-5 h-5" style={{ color: '#1D9BF0' }} strokeWidth={2} />
            </div>
            <span className="font-medium" style={{ color: isDarkMode ? HUB.text : '#1A1A1A' }}>
              X (Twitter)
            </span>
          </button>

          <button
            type="button"
            onClick={shareToReddit}
            className="flex items-center gap-4 rounded-xl px-5 py-4 transition-opacity hover:opacity-90"
            style={{
              background: isDarkMode ? HUB.bgSecondary : '#FFFFFF',
              border: `1px solid ${isDarkMode ? HUB.divider : 'rgba(0,0,0,0.08)'}`,
            }}
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(255, 69, 0, 0.2)' }}
            >
              <Share2 className="w-5 h-5" style={{ color: REDDIT_COLOR }} strokeWidth={2} />
            </div>
            <span className="font-medium" style={{ color: isDarkMode ? HUB.text : '#1A1A1A' }}>
              Reddit
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
