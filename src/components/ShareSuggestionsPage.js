import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Linkedin, Twitter, Share2 } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { getCurrentUser } from '../services/authService';
import firestoreService from '../services/firestoreService';
import chatService from '../services/chatService';
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

const REDDIT_COLOR = '#FF4500';

const PLATFORM_LABELS = {
  linkedin: 'LinkedIn',
  x: 'X (Twitter)',
  reddit: 'Reddit',
};

function buildFallbackSuggestions(original) {
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
  const platformFromState = state.platform; // 'linkedin' | 'x' | 'reddit' when from Dashboard icons

  // Selected platform: from navigation state or from tapping an icon (LinkedIn / X / Reddit)
  const [selectedPlatform, setSelectedPlatform] = useState(platformFromState || 'linkedin');
  const [platformSuggestions, setPlatformSuggestions] = useState([]);
  const [suggestionImageUrls, setSuggestionImageUrls] = useState([]); // one image per suggestion (Gemini entities → Gemini image model)
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(true);
  const [suggestionError, setSuggestionError] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [sharePanelOpen, setSharePanelOpen] = useState(false);
  const [editableShareText, setEditableShareText] = useState('');

  const reflectionDate = state.selectedDate ? (state.selectedDate instanceof Date ? state.selectedDate : new Date(state.selectedDate)) : new Date();
  const dateStr = reflectionDate instanceof Date ? getDateId(reflectionDate) : getDateId(new Date(reflectionDate));

  // When user selects a platform (from state or by tapping an icon), fetch that platform's suggestions only
  useEffect(() => {
    if (!selectedPlatform || !reflectionFromState) return;
    let cancelled = false;
    setIsLoadingSuggestions(true);
    setSuggestionError(null);
    setSuggestionImageUrls([]);
    chatService
      .generateSocialPostSuggestions(reflectionFromState, selectedPlatform)
      .then((list) => {
        if (cancelled) return;
        const posts = Array.isArray(list) && list.length ? list : [{ eventLabel: 'Reflection', post: reflectionFromState }];
        setPlatformSuggestions(posts);
        setSelectedIndex(0);
        setIsLoadingSuggestions(false);
        // For each suggestion: Gemini extracts entities → Gemini image model generates one image → show with that post
        setIsLoadingImages(true);
        Promise.all(
          posts.map((item) => {
            const postText = typeof item === 'object' && item?.post != null ? item.post : String(item);
            return chatService.fetchImageForReflection(postText).catch(() => null);
          })
        ).then((urls) => {
          if (!cancelled) {
            setSuggestionImageUrls(Array.isArray(urls) ? urls : []);
            setIsLoadingImages(false);
          }
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setSuggestionError(err.message || 'Could not generate suggestions');
          setPlatformSuggestions([{ eventLabel: 'Reflection', post: reflectionFromState }]);
          setSelectedIndex(0);
          setSuggestionImageUrls([]);
          setIsLoadingSuggestions(false);
        }
      });
    return () => { cancelled = true; };
  }, [selectedPlatform, reflectionFromState]);

  const fallbackSuggestions = buildFallbackSuggestions(reflectionFromState);
  const selectedFallbackId = fallbackSuggestions[selectedIndex]?.id ?? 'original';
  const selectedText = selectedPlatform
    ? (platformSuggestions[selectedIndex]?.post ?? platformSuggestions[0]?.post ?? reflectionFromState)
    : (fallbackSuggestions[selectedIndex]?.text ?? reflectionFromState);

  const recordShare = (plat, text) => {
    const user = getCurrentUser();
    if (user?.uid) {
      firestoreService.saveSocialShare(user.uid, {
        platform: plat,
        reflectionDate: dateStr,
        reflectionSnippet: (text || selectedText || '').slice(0, 200) || undefined,
      });
    }
  };

  const textToShare = (sharePanelOpen && editableShareText !== '') ? editableShareText : selectedText;

  const shareToLinkedIn = (text) => {
    const t = text ?? textToShare;
    if (!t) return;
    const url = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://deite.app';
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`, '_blank', 'noopener,noreferrer');
    recordShare('linkedin', t);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(t);
  };

  const shareToTwitter = (text) => {
    const t = text ?? textToShare;
    if (!t) return;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(t)}`, '_blank', 'noopener,noreferrer');
    recordShare('x', t);
  };

  const shareToReddit = (text) => {
    const t = text ?? textToShare;
    if (!t) return;
    window.open(
      `https://www.reddit.com/submit?title=${encodeURIComponent('My reflection')}&selftext=${encodeURIComponent(t)}`,
      '_blank',
      'noopener,noreferrer'
    );
    recordShare('reddit', t);
  };

  const openSharePanel = (text) => {
    setEditableShareText(text ?? selectedText ?? '');
    setSharePanelOpen(true);
  };

  const handleShareToSelectedPlatform = () => {
    const t = (sharePanelOpen ? editableShareText : selectedText) || '';
    if (!t) return;
    if (selectedPlatform === 'linkedin') shareToLinkedIn(t);
    else if (selectedPlatform === 'x') shareToTwitter(t);
    else if (selectedPlatform === 'reddit') shareToReddit(t);
    setSharePanelOpen(false);
  };

  if (!reflectionFromState) {
    navigate('/dashboard', { replace: true });
    return null;
  }

  const title = selectedPlatform ? `Suggestions for ${PLATFORM_LABELS[selectedPlatform]}` : 'Suggestions for your post';
  const cardStyle = {
    background: isDarkMode ? HUB.bgSecondary : '#FFFFFF',
    border: `1px solid ${isDarkMode ? HUB.divider : 'rgba(0,0,0,0.08)'}`,
  };

  return (
    <div
      className="min-h-screen flex flex-col px-4 py-6 pb-10"
      style={{ background: isDarkMode ? HUB.bg : '#F5F5F5' }}
    >
      <div className="max-w-md w-full mx-auto flex flex-col flex-1">
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
          <h1 className="text-lg font-semibold" style={{ color: isDarkMode ? HUB.text : '#1A1A1A' }}>
            {title}
          </h1>
        </div>

        <div className="rounded-xl p-4 mb-6" style={cardStyle}>
          <p className="text-sm" style={{ color: isDarkMode ? HUB.textSecondary : '#666' }}>Your reflection</p>
          <p className="text-[15px] leading-relaxed mt-1" style={{ color: isDarkMode ? HUB.text : '#1A1A1A' }}>
            {reflectionFromState}
          </p>
        </div>

        <div className="flex items-center justify-center gap-6 mb-3">
          <button
            type="button"
            onClick={() => setSelectedPlatform('linkedin')}
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all hover:opacity-100"
            style={{
              background: selectedPlatform === 'linkedin' ? 'rgba(10, 102, 194, 0.35)' : 'rgba(10, 102, 194, 0.2)',
              border: `2px solid ${selectedPlatform === 'linkedin' ? '#0A66C2' : 'rgba(10, 102, 194, 0.4)'}`,
              opacity: selectedPlatform === null || selectedPlatform === 'linkedin' ? 1 : 0.7,
            }}
            title="LinkedIn – get LinkedIn-style post suggestions"
          >
            <Linkedin className="w-5 h-5" style={{ color: '#0A66C2' }} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => setSelectedPlatform('x')}
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all hover:opacity-100"
            style={{
              background: selectedPlatform === 'x' ? 'rgba(29, 155, 240, 0.35)' : 'rgba(29, 155, 240, 0.2)',
              border: `2px solid ${selectedPlatform === 'x' ? '#1D9BF0' : 'rgba(29, 155, 240, 0.4)'}`,
              opacity: selectedPlatform === null || selectedPlatform === 'x' ? 1 : 0.7,
            }}
            title="X (Twitter) – get X-style post suggestions"
          >
            <Twitter className="w-5 h-5" style={{ color: '#1D9BF0' }} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => setSelectedPlatform('reddit')}
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all hover:opacity-100"
            style={{
              background: selectedPlatform === 'reddit' ? 'rgba(255, 69, 0, 0.35)' : 'rgba(255, 69, 0, 0.2)',
              border: `2px solid ${selectedPlatform === 'reddit' ? REDDIT_COLOR : 'rgba(255, 69, 0, 0.4)'}`,
              opacity: selectedPlatform === null || selectedPlatform === 'reddit' ? 1 : 0.7,
            }}
            title="Reddit – get Reddit-style post suggestions"
          >
            <Share2 className="w-5 h-5" style={{ color: REDDIT_COLOR }} strokeWidth={2} />
          </button>
        </div>

        {selectedPlatform && (
          <>
            <p className="text-sm font-medium mb-3" style={{ color: isDarkMode ? HUB.text : '#1A1A1A' }}>
              Choose a post to share
            </p>
            {isLoadingSuggestions ? (
              <div className="rounded-xl p-6 flex flex-col items-center justify-center mb-8" style={cardStyle}>
                <div className="flex space-x-1.5 mb-3">
                  <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: HUB.accent, animationDelay: '0ms' }} />
                  <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: HUB.accent, animationDelay: '150ms' }} />
                  <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: HUB.accent, animationDelay: '300ms' }} />
                </div>
                <p className="text-sm" style={{ color: isDarkMode ? HUB.textSecondary : '#666' }}>
                  Creating {PLATFORM_LABELS[selectedPlatform]}-style suggestions...
                </p>
              </div>
            ) : platformSuggestions.length > 0 ? (
              <div className="space-y-3 mb-8">
                {platformSuggestions.map((item, idx) => {
                  const eventLabel = typeof item === 'object' && item?.eventLabel != null ? item.eventLabel : 'Moment';
                  const postText = typeof item === 'object' && item?.post != null ? item.post : String(item);
                  const imageUrl = suggestionImageUrls[idx] || null;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setSelectedIndex(idx);
                        const postText = typeof item === 'object' && item?.post != null ? item.post : String(item);
                        openSharePanel(postText);
                      }}
                      className="w-full text-left rounded-xl overflow-hidden transition-all"
                      style={{
                        background: selectedIndex === idx ? (isDarkMode ? `${HUB.accent}20` : 'rgba(168, 85, 247, 0.12)') : (isDarkMode ? HUB.bgSecondary : '#FFFFFF'),
                        border: `1px solid ${selectedIndex === idx ? HUB.accent : (isDarkMode ? HUB.divider : 'rgba(0,0,0,0.08)')}`,
                      }}
                    >
                      {imageUrl && (
                        <div className="w-full aspect-video bg-black/20 flex-shrink-0">
                          <img
                            src={imageUrl}
                            alt=""
                            className="w-full h-full object-cover"
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              console.warn('[Suggestions] Image failed to load:', imageUrl?.slice(0, 60));
                              e.target.style.display = 'none';
                            }}
                          />
                        </div>
                      )}
                      {isLoadingImages && !imageUrl && (
                        <div className="w-full aspect-video flex items-center justify-center flex-shrink-0" style={{ background: isDarkMode ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.06)' }}>
                          <div className="flex space-x-1.5">
                            <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: HUB.accent, animationDelay: '0ms' }} />
                            <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: HUB.accent, animationDelay: '150ms' }} />
                            <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: HUB.accent, animationDelay: '300ms' }} />
                          </div>
                        </div>
                      )}
                      <div className="p-4">
                        {eventLabel ? <p className="text-xs font-semibold mb-1" style={{ color: HUB.accent }}>{eventLabel}</p> : null}
                        <p className="text-[14px] leading-relaxed" style={{ color: isDarkMode ? HUB.text : '#333' }}>{postText}</p>
                      </div>
                    </button>
                  );
                })}
                {suggestionError && (
                  <p className="text-xs" style={{ color: isDarkMode ? HUB.textSecondary : '#888' }}>Using reflection after: {suggestionError}</p>
                )}
              </div>
            ) : (
              suggestionError ? (
                <p className="text-xs mb-8" style={{ color: isDarkMode ? HUB.textSecondary : '#888' }}>Using reflection after: {suggestionError}</p>
              ) : null
            )}
          </>
        )}

        {sharePanelOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.5)' }}
            onClick={() => setSharePanelOpen(false)}
            aria-hidden={!sharePanelOpen}
          >
            <div
              className="rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col p-4 overflow-y-auto"
              style={{
                background: isDarkMode ? HUB.bgSecondary : '#FFFFFF',
                border: `1px solid ${isDarkMode ? HUB.divider : 'rgba(0,0,0,0.08)'}`,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-sm font-medium mb-2 flex-shrink-0" style={{ color: isDarkMode ? HUB.text : '#1A1A1A' }}>
                Edit before sharing
              </p>
              <textarea
                value={editableShareText}
                onChange={(e) => setEditableShareText(e.target.value)}
                placeholder="Your post..."
                rows={5}
                className="w-full rounded-xl p-3 text-[15px] leading-relaxed resize-none border outline-none focus:ring-2"
                style={{
                  background: isDarkMode ? HUB.bg : '#F5F5F5',
                  borderColor: isDarkMode ? HUB.divider : 'rgba(0,0,0,0.12)',
                  color: isDarkMode ? HUB.text : '#1A1A1A',
                }}
              />
              <div className="flex gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => setSharePanelOpen(false)}
                  className="flex-1 py-3 rounded-xl font-medium transition-opacity hover:opacity-90"
                  style={{ background: isDarkMode ? HUB.divider : '#E5E5E5', color: isDarkMode ? HUB.text : '#333' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleShareToSelectedPlatform}
                  disabled={!selectedPlatform || !editableShareText.trim()}
                  className="flex-1 py-3 rounded-xl font-medium transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    background: selectedPlatform === 'linkedin' ? '#0A66C2' : selectedPlatform === 'x' ? '#1D9BF0' : selectedPlatform === 'reddit' ? REDDIT_COLOR : (isDarkMode ? HUB.divider : '#CCC'),
                    color: '#FFFFFF',
                  }}
                >
                  {selectedPlatform
                    ? `Share to ${PLATFORM_LABELS[selectedPlatform]}`
                    : 'Select a platform above'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
