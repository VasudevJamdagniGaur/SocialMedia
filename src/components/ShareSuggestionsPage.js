import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Linkedin, Pencil } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { toPng } from 'html-to-image';
import { useTheme } from '../contexts/ThemeContext';
import { getCurrentUser } from '../services/authService';
import firestoreService from '../services/firestoreService';
import chatService from '../services/chatService';
import { getDateId } from '../utils/dateUtils';
import TweetShareCard from './TweetShareCard';

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
  x: 'X',
  reddit: 'Reddit',
};

// #region agent log helper
const debugLog = (hypothesisId, location, message, data = {}, runId = 'pre-fix') => {
  try {
    fetch('http://127.0.0.1:7490/ingest/9e596726-bf1d-4d61-bcc3-effd1cc37ec7', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': '6a85fb',
      },
      body: JSON.stringify({
        sessionId: '6a85fb',
        runId,
        hypothesisId,
        location,
        message,
        data,
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  } catch {
    // ignore logging failures
  }
};
// #endregion

// Local image cache key builder (must stay in sync with chatService)
const buildImageCacheKey = (text) => {
  try {
    const full = (text || '').trim();
    if (!full) return null;
    const keyText = full.length > 300 ? full.slice(0, 300) : full;
    return `post_image_cache_v2::${keyText}`;
  } catch {
    return null;
  }
};

const getCachedImageForPost = (text) => {
  if (typeof localStorage === 'undefined') return null;
  const key = buildImageCacheKey(text);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.text === (text || '').trim() && typeof parsed.image === 'string') {
        return parsed.image;
      }
      return typeof raw === 'string' ? raw : null;
    } catch {
      return raw;
    }
  } catch {
    return null;
  }
};

const isNative = () =>
  typeof window !== 'undefined' &&
  typeof Capacitor !== 'undefined' &&
  typeof Capacitor.isNativePlatform === 'function' &&
  Capacitor.isNativePlatform();

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
  const [imageEditMenuOpen, setImageEditMenuOpen] = useState(false);
  const [linkedInCaptionToastVisible, setLinkedInCaptionToastVisible] = useState(false);
  const [shareConfirmation, setShareConfirmation] = useState({ open: false, index: null, platform: null });
  const imageReplaceInputRef = useRef(null);
  const tweetCardRef = useRef(null);

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
        // Do not generate images for Reddit suggestions
        if (selectedPlatform === 'reddit') {
          setSuggestionImageUrls(posts.map(() => null));
          setIsLoadingImages(false);
          return;
        }
        // For LinkedIn/X: Try local cache first so we don't re-generate images unnecessarily
        const postsWithText = posts.map((item) =>
          (typeof item === 'object' && item?.post != null ? item.post : String(item || '')).trim()
        );

        const cachedImages = postsWithText.map((text) =>
          getCachedImageForPost(text)
        );

        setSuggestionImageUrls(cachedImages);

        const indicesNeedingFetch = postsWithText
          .map((text, idx) => (cachedImages[idx] ? null : idx))
          .filter((idx) => idx !== null);

        if (!indicesNeedingFetch.length) {
          // Everything came from cache; no need to hit the image API
          setIsLoadingImages(false);
          return;
        }

        // For LinkedIn/X: Gemini generates image only for posts without cached images
        setIsLoadingImages(true);
        const user = getCurrentUser();
        const userContext = user ? {
          displayName: localStorage.getItem(`user_display_name_${user.uid}`) || user.displayName || '',
          age: localStorage.getItem(`user_age_${user.uid}`) || '',
          nationality: localStorage.getItem(`user_nationality_${user.uid}`) || 'Indian',
          gender: localStorage.getItem(`user_gender_${user.uid}`) || '',
          skinTone: localStorage.getItem(`user_skin_tone_${user.uid}`) || '',
          hairstyle: localStorage.getItem(`user_hairstyle_${user.uid}`) || '',
          clothingStyle: localStorage.getItem(`user_clothing_style_${user.uid}`) || '',
          profession: localStorage.getItem(`user_profession_${user.uid}`) || '',
          profileImageUrl: localStorage.getItem(`user_profile_picture_${user.uid}`) || ''
        } : null;
        Promise.all(
          indicesNeedingFetch.map((idx) => {
            const postText = postsWithText[idx];
            return chatService
              .fetchImageForReflection(postText, userContext, selectedPlatform)
              .catch(() => null);
          })
        ).then((urls) => {
          if (cancelled) return;
          const merged = [...cachedImages];
          urls.forEach((url, i) => {
            const idx = indicesNeedingFetch[i];
            if (idx != null && url) {
              merged[idx] = url;
            }
          });
          setSuggestionImageUrls(merged);
          setIsLoadingImages(false);
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

  const triggerPostShareConfirmation = () => {
    if (!selectedPlatform || !['linkedin', 'x', 'reddit'].includes(selectedPlatform)) return;
    setShareConfirmation({
      open: true,
      index: selectedIndex,
      platform: selectedPlatform,
    });
  };

  const copyCaptionToClipboardForLinkedIn = async (text) => {
    if (!text) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(text);
      setLinkedInCaptionToastVisible(true);
      setTimeout(() => {
        setLinkedInCaptionToastVisible(false);
      }, 2500);
    } catch {
      // Silently ignore clipboard failures
    }
  };

  const shareToLinkedIn = (text) => {
    const t = text ?? textToShare;
    if (!t) return;
    const url = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://detea.app';
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`, '_blank', 'noopener,noreferrer');
    recordShare('linkedin', t);
    copyCaptionToClipboardForLinkedIn(t);
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
    setImageEditMenuOpen(false);
    setSharePanelOpen(true);
  };

  const handleShareToOtherPlatforms = async () => {
    const text = (editableShareText || selectedText || '').trim();
    if (!text) return;

    const shareData = { text };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        recordShare('other', text);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        alert('Text copied to clipboard. You can paste it into any app to share.');
        recordShare('other', text);
      }
    } catch (error) {
      console.error('Share to other platforms failed:', error);
    }
  };

  const handlePencilClick = () => {
    setImageEditMenuOpen((prev) => !prev);
  };

  const handleReplacePhoto = () => {
    setImageEditMenuOpen(false);
    imageReplaceInputRef.current?.click();
  };

  const handleRemoveImage = () => {
    setImageEditMenuOpen(false);
    setSuggestionImageUrls((prev) => {
      const next = [...(prev || [])];
      next[selectedIndex] = null;
      return next;
    });
  };

  const handleReplaceImageFile = (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl === 'string') {
        setSuggestionImageUrls((prev) => {
          const next = [...(prev || [])];
          next[selectedIndex] = dataUrl;
          return next;
        });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const dataURLtoFile = (dataUrl, filename = 'post-image.png') => {
    try {
      const arr = dataUrl.split(',');
      const mime = (arr[0].match(/:(.*?);/) || [])[1] || 'image/png';
      const bstr = atob(arr[1]);
      const u8arr = new Uint8Array(bstr.length);
      for (let i = 0; i < bstr.length; i++) u8arr[i] = bstr.charCodeAt(i);
      return new File([u8arr], filename, { type: mime });
    } catch {
      return null;
    }
  };

  const writeImageToCacheFile = async (dataUrl) => {
    try {
      if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
        return null;
      }
      const parts = dataUrl.split(',');
      if (parts.length < 2) return null;
      const base64Data = parts[1];
      const path = `share-post-${Date.now()}.png`;

      debugLog(
        'H4',
        'ShareSuggestionsPage.js:writeImageToCacheFile:start',
        'Writing image to Capacitor Filesystem cache',
        { path }
      );

      const result = await Filesystem.writeFile({
        path,
        data: base64Data,
        directory: Directory.Cache,
        recursive: false,
      });

      const uri = result.uri || result.path || null;
      debugLog(
        'H4',
        'ShareSuggestionsPage.js:writeImageToCacheFile:success',
        'Image written to cache',
        { hasUri: !!uri }
      );
      return uri;
    } catch (e) {
      debugLog(
        'H4',
        'ShareSuggestionsPage.js:writeImageToCacheFile:error',
        'Failed to write image to cache',
        { name: e?.name || 'Error' }
      );
      return null;
    }
  };

  const handleShareToSelectedPlatform = async () => {
    const t = (sharePanelOpen ? editableShareText : selectedText) || '';
    if (!t) return;
    const imageDataUrl = suggestionImageUrls[selectedIndex] || null;
    const isDataUrl = imageDataUrl && typeof imageDataUrl === 'string' && imageDataUrl.startsWith('data:image');

    debugLog(
      'H1',
      'ShareSuggestionsPage.js:handleShareToSelectedPlatform:entry',
      'Entered share handler',
      {
        selectedPlatform,
        hasImage: !!imageDataUrl,
        isDataUrl,
        textLength: t.length,
        isNative: isNative(),
      }
    );

    // 0) Special case: X (Twitter) → generate tweet-style image card and share that,
    // but only if an AI image has been generated for the selected suggestion
    if (selectedPlatform === 'x' && isDataUrl) {
      debugLog(
        'HX',
        'ShareSuggestionsPage.js:handleShareToSelectedPlatform:xCard:start',
        'Generating tweet-style image card for X share',
        {
          hasImage: !!imageDataUrl,
          textLength: t.length,
        }
      );

      try {
        const node = tweetCardRef.current;
        if (node) {
          // Match TweetShareCard's 7:10 aspect ratio: height = width * 10 / 7
          const exportWidth = 1080;
          const exportHeight = Math.round((exportWidth * 10) / 7);

          const cardDataUrl = await toPng(node, {
            width: exportWidth,
            height: exportHeight,
            pixelRatio: 2,
          });

          const isCardDataUrl =
            cardDataUrl && typeof cardDataUrl === 'string' && cardDataUrl.startsWith('data:image');

          if (isCardDataUrl) {
            // Prefer native share with image card when running as Capacitor app
            if (isNative()) {
              try {
                let fileUri = await writeImageToCacheFile(cardDataUrl);
                if (fileUri) {
                  await Share.share({
                    text: '',
                    files: [fileUri],
                    title: 'Share reflection',
                    dialogTitle: 'Share to…',
                  });
                  recordShare('x', t);
                  triggerPostShareConfirmation();
                  debugLog(
                    'HX',
                    'ShareSuggestionsPage.js:handleShareToSelectedPlatform:xCard:nativeSuccess',
                    'Shared tweet card via native Share'
                  );
                  setSharePanelOpen(false);
                  return;
                }
              } catch (err) {
                debugLog(
                  'HX',
                  'ShareSuggestionsPage.js:handleShareToSelectedPlatform:xCard:nativeError',
                  'Native tweet card share failed',
                  { name: err?.name || 'Error' }
                );
              }
            }

            // Web Share API with image file (PWA / mobile browser)
            if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare) {
              const file = dataURLtoFile(cardDataUrl);
              if (file && navigator.canShare({ files: [file] })) {
                try {
                  await navigator.share({ files: [file] });
                  recordShare('x', t);
                  triggerPostShareConfirmation();
                  debugLog(
                    'HX',
                    'ShareSuggestionsPage.js:handleShareToSelectedPlatform:xCard:webSuccess',
                    'Shared tweet card via Web Share'
                  );
                  setSharePanelOpen(false);
                  return;
                } catch (err) {
                  debugLog(
                    'HX',
                    'ShareSuggestionsPage.js:handleShareToSelectedPlatform:xCard:webError',
                    'Web Share tweet card failed',
                    { name: err?.name || 'Error' }
                  );
                }
              }
            }

            // Fallback: download the card image so the user can attach manually
            try {
              const a = document.createElement('a');
              a.href = cardDataUrl;
              a.download = 'tweet-card.png';
              a.click();
            } catch (_) {}
            triggerPostShareConfirmation();
            setSharePanelOpen(false);
            return;
          }
        }
      } catch (err) {
        debugLog(
          'HX',
          'ShareSuggestionsPage.js:handleShareToSelectedPlatform:xCard:renderError',
          'Failed to generate tweet card',
          { name: err?.name || 'Error' }
        );
      }

      // Absolute fallback if card generation/sharing failed: fall back to existing X text-only share
      shareToTwitter(t);
      triggerPostShareConfirmation();
      setSharePanelOpen(false);
      return;
    }

    // Special case: LinkedIn should go directly to LinkedIn (app or browser),
    // not through the generic native share sheet.
    if (selectedPlatform === 'linkedin') {
      shareToLinkedIn(t);
      triggerPostShareConfirmation();
      setSharePanelOpen(false);
      return;
    }

    // 1) Native share via Capacitor (Android/iOS app) – text + image
    if (isNative() && isDataUrl) {
      try {
        debugLog(
          'H1',
          'ShareSuggestionsPage.js:handleShareToSelectedPlatform:nativeShare',
          'Attempting native Share.share with image (using Filesystem)',
          {
            selectedPlatform,
          }
        );
        let fileUri = null;
        try {
          fileUri = await writeImageToCacheFile(imageDataUrl);
        } catch {
          fileUri = null;
        }

        if (fileUri) {
          await Share.share({
            text: t,
            files: [fileUri],
            title: 'Share reflection',
            dialogTitle: 'Share to…',
          });
        } else {
          // Fallback: share data URL directly if file could not be created
          await Share.share({
            text: t,
            url: imageDataUrl,
            title: 'Share reflection',
            dialogTitle: 'Share to…',
          });
        }
        recordShare(selectedPlatform, t);
        if (selectedPlatform === 'linkedin') {
          copyCaptionToClipboardForLinkedIn(t);
        }
        debugLog(
          'H1',
          'ShareSuggestionsPage.js:handleShareToSelectedPlatform:nativeShare:success',
          'Native share completed'
        );
        triggerPostShareConfirmation();
        setSharePanelOpen(false);
        return;
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.warn('Native share failed, falling back to web share:', err);
          debugLog(
            'H1',
            'ShareSuggestionsPage.js:handleShareToSelectedPlatform:nativeShare:error',
            'Native share threw error',
            { name: err?.name || 'UnknownError' }
          );
        }
      }
    }

    // 2) Web Share API with files (PWA / supported mobile browsers)
    if (isDataUrl && typeof navigator !== 'undefined' && navigator.share && navigator.canShare) {
      const file = dataURLtoFile(imageDataUrl);
      if (file && navigator.canShare({ text: t, files: [file] })) {
        try {
          debugLog(
            'H2',
            'ShareSuggestionsPage.js:handleShareToSelectedPlatform:webShare',
            'Attempting navigator.share with file',
            { selectedPlatform }
          );
          await navigator.share({ text: t, files: [file] });
          recordShare(selectedPlatform, t);
          if (selectedPlatform === 'linkedin') {
            copyCaptionToClipboardForLinkedIn(t);
          }
          debugLog(
            'H2',
            'ShareSuggestionsPage.js:handleShareToSelectedPlatform:webShare:success',
            'Web share completed'
          );
          triggerPostShareConfirmation();
          setSharePanelOpen(false);
          return;
        } catch (err) {
          if (err.name !== 'AbortError') console.warn('Share with image failed:', err);
          debugLog(
            'H2',
            'ShareSuggestionsPage.js:handleShareToSelectedPlatform:webShare:error',
            'Web share threw error',
            { name: err?.name || 'UnknownError' }
          );
        }
      }
    }

    // 3) Fallback: platform-specific share URLs (text only) + optional download
    debugLog(
      'H3',
      'ShareSuggestionsPage.js:handleShareToSelectedPlatform:fallback',
      'Using URL-based fallback share',
      { selectedPlatform, hasImage: !!imageDataUrl, isDataUrl }
    );
    if (selectedPlatform === 'linkedin') shareToLinkedIn(t);
    else if (selectedPlatform === 'x') shareToTwitter(t);
    else if (selectedPlatform === 'reddit') shareToReddit(t);

    if (isDataUrl) {
      try {
        const a = document.createElement('a');
        a.href = imageDataUrl;
        a.download = 'post-image.png';
        a.click();
      } catch (_) {
        // ignore download errors
      }
    }
    triggerPostShareConfirmation();
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

  const currentUser = getCurrentUser();
  const tweetDisplayName =
    (currentUser && (localStorage.getItem(`user_display_name_${currentUser.uid}`) || currentUser.displayName)) ||
    'DeTea User';
  const tweetUsername =
    (currentUser && (currentUser.email || '').split('@')[0]) ||
    'detea_user';
  const tweetProfileImage =
    (currentUser && localStorage.getItem(`user_profile_picture_${currentUser.uid}`)) || null;

  return (
    <div
      className="min-h-screen flex flex-col px-4 py-6 pb-10"
      style={{ background: isDarkMode ? HUB.bg : '#F5F5F5', position: 'relative' }}
    >
      {/* LinkedIn caption copied toast */}
      {linkedInCaptionToastVisible && (
        <div className="fixed inset-x-0 bottom-6 flex justify-center pointer-events-none z-50">
          <div
            className="px-4 py-2 rounded-full shadow-md text-sm pointer-events-auto"
            style={{
              background: isDarkMode ? 'rgba(15,23,42,0.95)' : 'rgba(17,24,39,0.95)',
              color: '#FFFFFF',
            }}
          >
            📋 Caption copied! Paste it in LinkedIn
          </div>
        </div>
      )}
      {shareConfirmation.open && (
        <div className="fixed inset-x-0 bottom-20 flex justify-center pointer-events-none z-50">
          <div
            className="rounded-2xl shadow-lg text-sm pointer-events-auto px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3"
            style={{
              background: isDarkMode ? 'rgba(15,23,42,0.98)' : 'rgba(17,24,39,0.98)',
              color: '#FFFFFF',
              maxWidth: '360px',
              width: '100%',
            }}
          >
            <span className="flex-1 text-xs sm:text-sm">
              {`Did that look good on ${
                shareConfirmation.platform === 'linkedin'
                  ? 'LinkedIn'
                  : shareConfirmation.platform === 'x'
                  ? 'X'
                  : 'Reddit'
              }?`}
            </span>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                className="text-xs sm:text-sm px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 transition-colors"
                onClick={() => {
                  // Oops, let them try again: just reopen panel for that suggestion
                  const idx = shareConfirmation.index ?? 0;
                  const item = platformSuggestions[idx];
                  const post =
                    typeof item === 'object' && item?.post != null ? item.post : String(item || '');
                  setSelectedIndex(idx);
                  openSharePanel(post);
                  setShareConfirmation({ open: false, index: null, platform: null });
                }}
              >
                Oops, try again
              </button>
              <button
                type="button"
                className="text-xs sm:text-sm px-3 py-1.5 rounded-full bg-white text-gray-900 font-medium hover:bg-gray-100 transition-colors"
                onClick={() => {
                  const idx = shareConfirmation.index ?? 0;
                  setPlatformSuggestions((prev) => {
                    if (!prev || idx < 0 || idx >= prev.length) return prev;
                    const next = [...prev];
                    const [item] = next.splice(idx, 1);
                    const normalized =
                      typeof item === 'object'
                        ? { ...item, posted: true }
                        : { eventLabel: 'Reflection', post: String(item || ''), posted: true };
                    next.push(normalized);
                    return next;
                  });
                  setSuggestionImageUrls((prev) => {
                    if (!prev || idx < 0 || idx >= prev.length) return prev;
                    const next = [...prev];
                    const [img] = next.splice(idx, 1);
                    next.push(img || null);
                    return next;
                  });
                  setSelectedIndex((prevIdx) => {
                    const total = platformSuggestions.length;
                    return total > 0 ? total - 1 : prevIdx;
                  });
                  setShareConfirmation({ open: false, index: null, platform: null });
                }}
              >
                Yes, I posted!
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="max-w-md w-full mx-auto flex flex-col flex-1">
        {/* Off-screen tweet card for X sharing – only when image has been generated */}
        {selectedPlatform === 'x' && suggestionImageUrls[selectedIndex] && (
          <div style={{ position: 'absolute', left: '-9999px', top: 0 }}>
            <TweetShareCard
              ref={tweetCardRef}
              width={1080} // height will be derived to keep 7:10 aspect ratio
              displayName={tweetDisplayName}
              username={tweetUsername}
              text={selectedText || reflectionFromState}
              imageUrl={suggestionImageUrls[selectedIndex] || null}
              profileImageUrl={tweetProfileImage}
            />
          </div>
        )}

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
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all hover:opacity-100 overflow-hidden"
            style={{
              background: selectedPlatform === 'linkedin' ? 'rgba(10, 102, 194, 0.35)' : 'rgba(10, 102, 194, 0.2)',
              border: `2px solid ${selectedPlatform === 'linkedin' ? '#0A66C2' : 'rgba(10, 102, 194, 0.4)'}`,
              opacity: selectedPlatform === null || selectedPlatform === 'linkedin' ? 1 : 0.7,
            }}
            title="LinkedIn – get LinkedIn-style post suggestions"
          >
            <Linkedin className="w-7 h-7" style={{ color: '#0A66C2' }} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => setSelectedPlatform('x')}
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all hover:opacity-100"
            style={{
              background: 'transparent',
              border: 'none',
              opacity: selectedPlatform === null || selectedPlatform === 'x' ? 1 : 0.7,
            }}
            title="X (Twitter) – get X-style post suggestions"
          >
            <img src="/x-logo.png" alt="X" className="object-contain" style={{ width: '45px', height: '45px' }} />
          </button>
          <button
            type="button"
            onClick={() => setSelectedPlatform('reddit')}
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all hover:opacity-100"
            style={{
              background: 'transparent',
              border: 'none',
              opacity: selectedPlatform === null || selectedPlatform === 'reddit' ? 1 : 0.7,
            }}
            title="Reddit – get Reddit-style post suggestions"
          >
            <img src="/reddit-logo.png" alt="Reddit" className="object-contain" style={{ width: '45px', height: '45px' }} />
          </button>
        </div>

        {selectedPlatform && (
          <>
            <p className="text-sm font-medium mb-3" style={{ color: isDarkMode ? HUB.text : '#1A1A1A' }}>
              Choose a post to share
            </p>
            {platformSuggestions.length > 0 && !isLoadingSuggestions ? (
              <p className="text-xs mb-2" style={{ color: isDarkMode ? HUB.textSecondary : '#666' }}>
                Showing all {platformSuggestions.length} post{platformSuggestions.length !== 1 ? 's' : ''} for events from your day
              </p>
            ) : null}
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
                  const eventLabel =
                    typeof item === 'object' && item?.eventLabel != null ? item.eventLabel : 'Moment';
                  const postText =
                    typeof item === 'object' && item?.post != null ? item.post : String(item);
                  const imageUrl = suggestionImageUrls[idx] || null;
                  const isSelected = idx === selectedIndex;
                  const isPosted = typeof item === 'object' && item?.posted;

                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setSelectedIndex(idx);
                        const post = typeof item === 'object' && item?.post != null ? item.post : String(item);
                        openSharePanel(post);
                      }}
                      className="w-full text-left rounded-xl overflow-hidden transition-all"
                      style={{
                        background: isDarkMode ? HUB.bgSecondary : '#FFFFFF',
                        border: `1px solid ${
                          isSelected ? (isDarkMode ? HUB.accentHighlight : '#7C3AED') : isDarkMode ? HUB.divider : 'rgba(0,0,0,0.08)'
                        }`,
                        boxShadow: isSelected
                          ? '0 0 0 1px rgba(168, 85, 247, 0.5), 0 12px 30px rgba(15, 23, 42, 0.6)'
                          : 'none',
                        transform: isSelected ? 'translateY(-2px)' : 'none',
                        filter: isPosted ? 'grayscale(100%)' : 'none',
                        opacity: isPosted && !isSelected ? 0.7 : 1,
                      }}
                    >
                      {selectedPlatform === 'x' && imageUrl ? (
                        <div className="p-3">
                          {eventLabel ? (
                            <p
                              className="text-xs font-semibold mb-2"
                              style={{ color: isDarkMode ? HUB.accentHighlight : '#7C3AED' }}
                            >
                              {eventLabel}
                            </p>
                          ) : null}
                          {/* Width can vary; height will be derived to keep 7:10 aspect ratio */}
                          <TweetShareCard
                            width={360}
                            displayName={tweetDisplayName}
                            username={tweetUsername}
                            text={postText}
                            imageUrl={imageUrl}
                            profileImageUrl={tweetProfileImage}
                          />
                        </div>
                      ) : (
                        <>
                          {imageUrl && (
                            <div className="w-full aspect-video bg-black/20 flex-shrink-0 flex items-center justify-center min-h-[140px]">
                              <img
                                src={imageUrl}
                                alt=""
                                className="w-full h-full object-contain"
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  console.warn(
                                    '[Suggestions] Image failed to load:',
                                    imageUrl?.slice(0, 60)
                                  );
                                  e.target.style.display = 'none';
                                }}
                              />
                            </div>
                          )}
                          {isLoadingImages && !imageUrl && (
                            <div
                              className="w-full aspect-video flex items-center justify-center flex-shrink-0"
                              style={{
                                background: isDarkMode
                                  ? 'rgba(0,0,0,0.2)'
                                  : 'rgba(0,0,0,0.06)',
                              }}
                            >
                              <div className="flex space-x-1.5">
                                <div
                                  className="w-2 h-2 rounded-full animate-bounce"
                                  style={{ backgroundColor: HUB.accent, animationDelay: '0ms' }}
                                />
                                <div
                                  className="w-2 h-2 rounded-full animate-bounce"
                                  style={{ backgroundColor: HUB.accent, animationDelay: '150ms' }}
                                />
                                <div
                                  className="w-2 h-2 rounded-full animate-bounce"
                                  style={{ backgroundColor: HUB.accent, animationDelay: '300ms' }}
                                />
                              </div>
                            </div>
                          )}
                          <div className="p-4">
                            {eventLabel ? (
                              <p
                                className="text-xs font-semibold mb-1"
                                style={{ color: HUB.accent }}
                              >
                                {eventLabel}
                              </p>
                            ) : null}
                            <p
                              className="text-[14px] leading-relaxed"
                              style={{ color: isDarkMode ? HUB.text : '#333' }}
                            >
                              {postText}
                            </p>
                          </div>
                        </>
                      )}
                    </button>
                  );
                })}
                {suggestionError && (
                  <p className="text-xs" style={{ color: isDarkMode ? HUB.textSecondary : '#888' }}>
                    Using reflection after: {suggestionError}
                  </p>
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
            className="fixed inset-0 z-50"
            style={{ background: 'rgba(0,0,0,0.5)' }}
            aria-hidden={!sharePanelOpen}
          >
            <div
              className="h-full w-full flex flex-col p-4 overflow-y-auto"
              style={{
                background: isDarkMode ? HUB.bgSecondary : '#FFFFFF',
              }}
            >
              <div className="flex items-center mb-3 gap-3">
                <button
                  type="button"
                  onClick={() => setSharePanelOpen(false)}
                  className="p-2 rounded-full hover:bg-white/10 focus:outline-none"
                  aria-label="Back"
                >
                  <ArrowLeft className="w-5 h-5" style={{ color: '#FFFFFF' }} />
                </button>
                <p className="text-sm font-medium flex-shrink-0" style={{ color: isDarkMode ? HUB.text : '#1A1A1A' }}>
                  Edit before sharing
                </p>
              </div>
              {/* X with image: show only the image card (no separate image, no separate text) */}
              {selectedPlatform === 'x' && suggestionImageUrls[selectedIndex] ? (
                <div className="w-full flex justify-center mb-4 flex-1 min-h-0">
                  <div className="w-full max-w-[360px] mx-auto">
                    <TweetShareCard
                      width={360}
                      displayName={tweetDisplayName}
                      username={tweetUsername}
                      text={editableShareText || selectedText || ''}
                      imageUrl={suggestionImageUrls[selectedIndex]}
                      profileImageUrl={tweetProfileImage}
                    />
                  </div>
                </div>
              ) : (
                <>
                  {suggestionImageUrls[selectedIndex] && (
                    <div className="w-full rounded-xl overflow-hidden mb-3 flex-shrink-0 bg-black/10 relative group">
                      <div className="w-full min-h-[200px] max-h-[320px] flex items-center justify-center">
                        <img
                          src={suggestionImageUrls[selectedIndex]}
                          alt="Post"
                          className="max-w-full max-h-[320px] w-auto h-auto object-contain"
                        />
                      </div>
                      <div className="absolute top-2 right-2 flex flex-col items-end">
                        <button
                          type="button"
                          onClick={handlePencilClick}
                          className="rounded-full p-2 shadow-lg transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2"
                          style={{ background: isDarkMode ? HUB.accent : '#7C3AED', color: '#FFF' }}
                          aria-label="Edit image"
                        >
                          <Pencil className="w-4 h-4" strokeWidth={2} />
                        </button>
                        {imageEditMenuOpen && (
                          <div
                            className="mt-1 py-1 rounded-lg shadow-xl border min-w-[160px]"
                            style={{
                              background: isDarkMode ? HUB.bgSecondary : '#FFF',
                              borderColor: isDarkMode ? HUB.divider : 'rgba(0,0,0,0.1)',
                            }}
                          >
                            <button
                              type="button"
                              onClick={handleReplacePhoto}
                              className="w-full text-left px-4 py-2.5 text-sm hover:opacity-90"
                              style={{ color: isDarkMode ? HUB.text : '#1A1A1A' }}
                            >
                              Replace photo
                            </button>
                            <button
                              type="button"
                              onClick={handleRemoveImage}
                              className="w-full text-left px-4 py-2.5 text-sm hover:opacity-90"
                              style={{ color: isDarkMode ? HUB.text : '#1A1A1A' }}
                            >
                              Remove image
                            </button>
                          </div>
                        )}
                      </div>
                      <input
                        ref={imageReplaceInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleReplaceImageFile}
                      />
                      <p className="text-xs mt-1" style={{ color: isDarkMode ? HUB.textSecondary : '#666' }}>
                        This image will be shared with your post. Tap the pencil to make the changes you want: replace with another photo or remove it.
                      </p>
                    </div>
                  )}
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
                </>
              )}
              <div className="flex gap-3 mt-4">
                <button
                  type="button"
                  onClick={handleShareToOtherPlatforms}
                  className="flex-1 py-3 rounded-xl font-medium transition-opacity hover:opacity-90"
                  style={{ background: isDarkMode ? HUB.divider : '#E5E5E5', color: isDarkMode ? HUB.text : '#333' }}
                >
                  Share to other platforms
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
