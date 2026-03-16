import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Linkedin, Pencil } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { toPng } from 'html-to-image';
import imageCompression from 'browser-image-compression';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { useTheme } from '../contexts/ThemeContext';
import { getCurrentUser } from '../services/authService';
import firestoreService from '../services/firestoreService';
import chatService from '../services/chatService';
import { getDateId } from '../utils/dateUtils';
import { db } from '../firebase/config';
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

const LINKEDIN_OAUTH_BASE = 'https://www.linkedin.com/oauth/v2/authorization';
const LINKEDIN_CLIENT_ID = '86ek56lm1yueyc';
const LINKEDIN_REDIRECT_URI = 'https://deitedatabase.firebaseapp.com/auth/linkedin/callback';
const LINKEDIN_SCOPE = 'openid profile email w_member_social';

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
  const [linkedInToastMessage, setLinkedInToastMessage] = useState('caption'); // 'caption' | 'connect'
  const [xShareToastVisible, setXShareToastVisible] = useState(false);
  const [xShareToastMessage, setXShareToastMessage] = useState(''); // 'opening' | 'choose_x' | 'downloaded' | 'error'
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
      .then(async (list) => {
        if (cancelled) return;
        const posts = Array.isArray(list) && list.length ? list : [{ eventLabel: 'Reflection', post: reflectionFromState }];
        setPlatformSuggestions(posts);
        setSelectedIndex(0);
        setIsLoadingSuggestions(false);
        // For LinkedIn, X, and Reddit: Prefer Firebase cache (no API re-calls), then localStorage, then Gemini; save to Firebase after generation
        const postsWithText = posts.map((item) =>
          (typeof item === 'object' && item?.post != null ? item.post : String(item || '')).trim()
        );

        const user = getCurrentUser();
        const reflectionKey = firestoreService.hashForReflectionCache(reflectionFromState);

        // 1) Single round: Firebase by index only (fast), then localStorage – no second round of text-based reads
        const firebaseUrls = user
          ? await Promise.all(
              postsWithText.map((_, idx) =>
                firestoreService.getReflectionImageUrlByIndex(user.uid, selectedPlatform, reflectionKey, idx)
              )
            )
          : postsWithText.map(() => null);

        const cachedImages = postsWithText.map((text, idx) =>
          firebaseUrls[idx] || getCachedImageForPost(text)
        );

        setSuggestionImageUrls(cachedImages);

        const indicesNeedingFetch = postsWithText
          .map((text, idx) => (cachedImages[idx] ? null : idx))
          .filter((idx) => idx !== null);

        if (!indicesNeedingFetch.length) {
          setIsLoadingImages(false);
          return;
        }

        // 2) Only for missing images: call Gemini once, then compress + save to Firebase
        setIsLoadingImages(true);
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
        ).then(async (urls) => {
          if (cancelled) return;
          const merged = [...cachedImages];
          urls.forEach((url, i) => {
            const idx = indicesNeedingFetch[i];
            if (idx != null && url) merged[idx] = url;
          });
          setSuggestionImageUrls(merged);

          // 3) Compress (< 0.6MB), upload to Storage, save URL in Firestore – next time we load from Firebase
          if (!user) {
            setIsLoadingImages(false);
            return;
          }
          for (let i = 0; i < indicesNeedingFetch.length; i++) {
            const idx = indicesNeedingFetch[i];
            const dataUrl = merged[idx];
            if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) continue;
            try {
              const file = await compressReflectionImage(dataUrl);
              if (!file) continue;
              const imageUrl = await firestoreService.uploadReflectionImageFileByIndex(
                user.uid,
                file,
                reflectionKey,
                selectedPlatform,
                idx
              );
              if (imageUrl) {
                await firestoreService.saveReflectionImageUrlByIndex(
                  user.uid,
                  selectedPlatform,
                  reflectionKey,
                  idx,
                  imageUrl
                );
              }
              const postText = postsWithText[idx];
              if (imageUrl) await firestoreService.saveReflectionImageUrl(user.uid, postText, imageUrl);
            } catch (e) {
              console.warn('Failed to save reflection image to Firebase:', e);
            }
          }
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

  /**
   * Persist share to Firestore so the post stays in My Presence after app reopen.
   * Dual-image pipeline: high-quality image is used for sharing; compressed copy is uploaded and only the URL is stored.
   * @param {string} plat - Platform: 'linkedin' | 'x' | 'reddit' | 'other'
   * @param {string} text - Caption text
   * @param {{ imageDataUrlForStorage?: string | null }} [options] - High-quality image (card or suggestion) to compress, upload, and store as URL only
   */
  const recordShare = async (plat, text, options = {}) => {
    const user = getCurrentUser();
    const content = (text || selectedText || '').trim();
    if (!user?.uid || !content) return;

    // 1) Save lightweight social share record (for platform badges in My Presence)
    await firestoreService.saveSocialShare(user.uid, {
      platform: plat,
      reflectionDate: dateStr,
      reflectionSnippet: content.slice(0, 200) || undefined,
    });

    const profileImage =
      (typeof localStorage !== 'undefined' &&
        localStorage.getItem(`user_profile_picture_${user.uid}`)) ||
      null;
    const imageForPost =
      Array.isArray(suggestionImageUrls) && suggestionImageUrls[selectedIndex]
        ? suggestionImageUrls[selectedIndex]
        : null;
    const imageToStore = options.imageDataUrlForStorage ?? imageForPost;

    // 2) Prepare image: File for upload to Storage at posts/{uid}/{postId}.jpg, or existing URL
    let imageFile = null;
    let imageUrl = null;
    if (imageToStore && typeof imageToStore === 'string') {
      if (imageToStore.startsWith('data:image')) {
        const compressed = await compressImageForStorage(imageToStore);
        if (compressed) {
          imageFile = compressed;
        } else {
          imageUrl = await firestoreService.uploadPostImage(user.uid, imageToStore);
        }
      } else if (imageToStore.startsWith('http://') || imageToStore.startsWith('https://')) {
        imageUrl = imageToStore;
      }
    }
    if (!imageUrl && content) {
      const suggestionPostText = platformSuggestions[selectedIndex]?.post;
      if (suggestionPostText) {
        const cached = await firestoreService.getReflectionImageUrl(user.uid, suggestionPostText);
        if (cached) imageUrl = cached;
      }
      if (!imageUrl) {
        const suggestionText = selectedText || content;
        const cached = await firestoreService.getReflectionImageUrl(user.uid, suggestionText);
        if (cached) imageUrl = cached;
      }
      if (!imageUrl && content !== (selectedText || '')) {
        const cachedByContent = await firestoreService.getReflectionImageUrl(user.uid, content);
        if (cachedByContent) imageUrl = cachedByContent;
      }
    }

    // 3) Create post: upload image to Storage → Firestore stores only metadata + imageUrl (posts, userPosts, shareHistory)
    const result = await firestoreService.createPostForShare({
      uid: user.uid,
      caption: content,
      imageFile: imageFile || undefined,
      imageUrl: imageUrl || undefined,
      platform: plat,
    });
    const finalImageUrl = result?.imageUrl || imageUrl || null;

    // 4) Create Community "My Presence" entry with URL only (for feed that reads from communityPosts)
    const postData = {
      author: user.displayName || 'Anonymous',
      authorId: user.uid,
      content,
      createdAt: serverTimestamp(),
      likes: 0,
      comments: [],
      profilePicture: profileImage,
      image: finalImageUrl,
      source: 'social_share',
      sharedPlatform: plat,
      reflectionDate: (() => {
        try {
          const d =
            typeof dateStr === 'string'
              ? new Date(dateStr)
              : reflectionDate instanceof Date
              ? reflectionDate
              : new Date();
          return d.toISOString();
        } catch {
          return new Date().toISOString();
        }
      })(),
    };

    try {
      await addDoc(collection(db, 'communityPosts'), postData);
    } catch (err) {
      console.error('Error creating community post from social share:', err);
      throw err;
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
      setLinkedInToastMessage('caption');
      setLinkedInCaptionToastVisible(true);
      setTimeout(() => {
        setLinkedInCaptionToastVisible(false);
      }, 2500);
    } catch {
      // Silently ignore clipboard failures
    }
  };

  /** Copies caption to clipboard, opens LinkedIn share dialog, and shows toast (user can paste caption there). */
  const shareToLinkedIn = (text) => {
    const t = ((text ?? textToShare) || '').trim();
    if (!t) return;
    copyCaptionToClipboardForLinkedIn(t);
    const appUrl = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://deitedatabase.firebaseapp.com';
    const shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(appUrl)}`;
    if (isNative()) {
      App.openUrl({ url: shareUrl }).catch(() => window.open(shareUrl, '_blank', 'noopener,noreferrer'));
    } else {
      window.open(shareUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const shareToTwitter = (text) => {
    const t = text ?? textToShare;
    if (!t) return;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(t)}`, '_blank', 'noopener,noreferrer');
  };

  const shareToReddit = (text) => {
    const t = text ?? textToShare;
    if (!t) return;
    window.open(
      `https://www.reddit.com/submit?title=${encodeURIComponent('My reflection')}&selftext=${encodeURIComponent(t)}`,
      '_blank',
      'noopener,noreferrer'
    );
  };

  /**
   * Share to LinkedIn via backend API (POST /api/linkedin/share), then open LinkedIn app.
   * Requires user to have connected LinkedIn (OAuth) first. On 401, opens OAuth URL.
   * @param {string} caption - Post text
   * @param {string|null} imageDataUrlOrUrl - Data URL, blob URL, or public HTTPS image URL
   * @returns {Promise<boolean>} - true if API share was attempted and we're done (success or 401); false to fall back to share sheet
   */
  const shareToLinkedInViaApi = async (caption, imageDataUrlOrUrl) => {
    const user = getCurrentUser();
    if (!user?.uid || !caption?.trim()) return false;

    // Resolve blob URLs to data URL so we can upload (backend needs a fetchable URL or we upload first)
    let resolvedImage = imageDataUrlOrUrl;
    if (resolvedImage && typeof resolvedImage === 'string' && resolvedImage.startsWith('blob:')) {
      resolvedImage = await blobUrlToDataUrl(resolvedImage) || null;
    }

    let imageUrl = null;
    if (resolvedImage && typeof resolvedImage === 'string') {
      if (resolvedImage.startsWith('data:image')) {
        imageUrl = await firestoreService.uploadPostImage(user.uid, resolvedImage);
      } else if (resolvedImage.startsWith('https://') || resolvedImage.startsWith('http://')) {
        imageUrl = resolvedImage;
      }
    }
    if (!imageUrl) return false;

    const result = await firestoreService.createPostForShare({
      uid: user.uid,
      caption: caption.trim(),
      imageUrl,
      platform: 'linkedin',
    });
    if (!result?.success || !result.postId || !result.imageUrl) return false;

    const apiBase = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://deitedatabase.firebaseapp.com';
    let res;
    try {
      res = await fetch(`${apiBase}/api/linkedin/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          caption: caption.trim(),
          imageUrl: result.imageUrl,
          postId: result.postId,
        }),
      });
    } catch (err) {
      console.warn('LinkedIn API share request failed:', err);
      return false;
    }

    if (res.status === 401) {
      const oauthUrl = `${LINKEDIN_OAUTH_BASE}?response_type=code&client_id=${encodeURIComponent(LINKEDIN_CLIENT_ID)}&redirect_uri=${encodeURIComponent(LINKEDIN_REDIRECT_URI)}&state=${encodeURIComponent(user.uid)}&scope=${encodeURIComponent(LINKEDIN_SCOPE)}`;
      if (isNative()) {
        try {
          await App.openUrl({ url: oauthUrl });
        } catch {
          window.open(oauthUrl, '_blank', 'noopener,noreferrer');
        }
      } else {
        window.open(oauthUrl, '_blank', 'noopener,noreferrer');
      }
      setLinkedInToastMessage('connect');
      setLinkedInCaptionToastVisible(true);
      setTimeout(() => setLinkedInCaptionToastVisible(false), 4000);
      return true;
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.warn('LinkedIn share failed', res.status, data);
      return false;
    }

    await firestoreService.saveSocialShare(user.uid, {
      platform: 'linkedin',
      reflectionDate: dateStr,
      reflectionSnippet: caption.trim().slice(0, 200) || undefined,
    });
    const profileImage = (typeof localStorage !== 'undefined' && localStorage.getItem(`user_profile_picture_${user.uid}`)) || null;
    const postData = {
      author: user.displayName || 'Anonymous',
      authorId: user.uid,
      content: caption.trim(),
      createdAt: serverTimestamp(),
      likes: 0,
      comments: [],
      profilePicture: profileImage,
      image: result.imageUrl,
      source: 'social_share',
      sharedPlatform: 'linkedin',
      reflectionDate: (() => {
        try {
          const d = typeof dateStr === 'string' ? new Date(dateStr) : reflectionDate instanceof Date ? reflectionDate : new Date();
          return d.toISOString();
        } catch {
          return new Date().toISOString();
        }
      })(),
    };
    await addDoc(collection(db, 'communityPosts'), postData);

    // Indicate success inside the app instead of forcing a redirect to LinkedIn.
    setLinkedInToastMessage('success');
    setLinkedInCaptionToastVisible(true);
    setTimeout(() => {
      setLinkedInCaptionToastVisible(false);
    }, 3500);

    return true;
  };

  const openSharePanel = (text) => {
    setEditableShareText(text ?? selectedText ?? '');
    setImageEditMenuOpen(false);
    setSharePanelOpen(true);
  };

  const handleShareToOtherPlatforms = async () => {
    const text = (editableShareText || selectedText || '').trim();
    if (!text) return;

    try {
      const imageDataUrl = suggestionImageUrls[selectedIndex] || null;
      const isDataUrl =
        imageDataUrl && typeof imageDataUrl === 'string' && imageDataUrl.startsWith('data:image');

      // 1) Prefer native share with IMAGE ONLY when running as Capacitor app
      if (isNative() && isDataUrl) {
        try {
          let fileUri = await writeImageToCacheFile(imageDataUrl);
          if (fileUri) {
            await Share.share({
              text: '',
              files: [fileUri],
              title: 'Share reflection',
              dialogTitle: 'Share to…',
            });
          }
        } catch (err) {
          console.warn('Native share (other platforms) failed:', err);
        }
      }
      // 2) Web Share API with image file (PWA / supported browsers)
      else if (
        isDataUrl &&
        typeof navigator !== 'undefined' &&
        navigator.share &&
        navigator.canShare
      ) {
        const file = dataURLtoFile(imageDataUrl);
        if (file && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file] });
          } catch (err) {
            console.warn('Web Share (other platforms) with image failed:', err);
          }
        }
      }
      // 3) Fallback: share text only if no image is available
      else if (typeof navigator !== 'undefined' && navigator.share) {
        try {
          await navigator.share({ text });
        } catch (err) {
          console.warn('Web Share (text only) failed:', err);
        }
      }

      // Copy caption and inform user
      if (selectedPlatform === 'linkedin') {
        // For LinkedIn we centralize copy + toast here
        shareToLinkedIn(text);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        alert('Text copied to clipboard. You can paste it into any app to share.');
        recordShare('other', text);
      } else {
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

  /** Convert blob URL to data URL so we can upload and use in LinkedIn API. */
  const blobUrlToDataUrl = (blobUrl) => {
    if (!blobUrl || typeof blobUrl !== 'string' || !blobUrl.startsWith('blob:')) return null;
    return new Promise((resolve) => {
      fetch(blobUrl)
        .then((r) => r.blob())
        .then((blob) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        })
        .catch(() => resolve(null));
    });
  };

  /** Get image as data URL from data URL, blob URL, or https URL (for share sheet fallback). */
  const getImageAsDataUrl = async (urlOrDataUrl) => {
    if (!urlOrDataUrl || typeof urlOrDataUrl !== 'string') return null;
    if (urlOrDataUrl.startsWith('data:image')) return urlOrDataUrl;
    if (urlOrDataUrl.startsWith('blob:')) return blobUrlToDataUrl(urlOrDataUrl);
    if (urlOrDataUrl.startsWith('https://') || urlOrDataUrl.startsWith('http://')) {
      try {
        const res = await fetch(urlOrDataUrl);
        if (!res.ok) return null;
        const blob = await res.blob();
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
      } catch {
        return null;
      }
    }
    return null;
  };

  /** Convert data URL to Blob (for shareImageToX). */
  const dataURLtoBlob = (dataUrl) => {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) return null;
    try {
      const arr = dataUrl.split(',');
      const mime = (arr[0].match(/:(.*?);/) || [])[1] || 'image/png';
      const bstr = atob(arr[1]);
      const u8arr = new Uint8Array(bstr.length);
      for (let i = 0; i < bstr.length; i++) u8arr[i] = bstr.charCodeAt(i);
      return new Blob([u8arr], { type: mime });
    } catch {
      return null;
    }
  };

  /**
   * Reusable: share an image via native device share sheet (no X API, no OAuth).
   * Opens share menu so user can select X (or LinkedIn, etc.). Fallback: download image + message.
   * @param {Blob} imageBlob - PNG or JPEG blob
   */
  const shareImageToX = async (imageBlob) => {
    if (!imageBlob || !(imageBlob instanceof Blob)) return;
    const file = new File([imageBlob], 'deite-post.png', { type: imageBlob.type || 'image/png' });

    const showToast = (message) => {
      setXShareToastMessage(message);
      setXShareToastVisible(true);
      setTimeout(() => setXShareToastVisible(false), 3500);
    };

    try {
      showToast('opening');
      if (typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'Shared from Deite',
          text: 'Posted using Deite',
          files: [file],
        });
        showToast('choose_x');
      } else {
        const url = URL.createObjectURL(imageBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'deite-post.png';
        a.click();
        URL.revokeObjectURL(url);
        showToast('downloaded');
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
      showToast('error');
    }
  };

  /** Get tweet card as image blob and share via native share sheet (Share to X button). */
  const handleShareImageToX = async () => {
    try {
      const node = tweetCardRef.current;
      if (!node) {
        setXShareToastMessage('error');
        setXShareToastVisible(true);
        setTimeout(() => setXShareToastVisible(false), 3500);
        return;
      }
      const exportWidth = 1080;
      const exportHeight = Math.round((exportWidth * 10) / 7);
      const cardDataUrl = await toPng(node, {
        width: exportWidth,
        height: exportHeight,
        pixelRatio: 2,
        skipFonts: true,
        cacheBust: false,
      });

      // Prefer true native share sheet when running as Capacitor app so X appears as a target.
      if (isNative()) {
        try {
          const fileUri = await writeImageToCacheFile(cardDataUrl);
          if (fileUri) {
            setXShareToastMessage('opening');
            setXShareToastVisible(true);
            setTimeout(() => setXShareToastVisible(false), 3500);
            await Share.share({
              text: '',
              files: [fileUri],
              title: 'Share reflection',
              dialogTitle: 'Share to X',
            });
            setXShareToastMessage('choose_x');
            setXShareToastVisible(true);
            setTimeout(() => setXShareToastVisible(false), 3500);
            return;
          }
        } catch (err) {
          // If native share fails, fall back to web share/download below.
        }
      }

      const blob = dataURLtoBlob(cardDataUrl);
      if (!blob) {
        setXShareToastMessage('error');
        setXShareToastVisible(true);
        setTimeout(() => setXShareToastVisible(false), 3500);
        return;
      }
      await shareImageToX(blob);
    } catch (err) {
      setXShareToastMessage('error');
      setXShareToastVisible(true);
      setTimeout(() => setXShareToastVisible(false), 3500);
    }
  };

  /** Compress image for Storage (dual-image pipeline: share high-quality, store compressed). */
  const compressImageForStorage = async (dataUrl) => {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) return null;
    try {
      const file = dataURLtoFile(dataUrl, 'post-image.png');
      if (!file) return null;
      const options = {
        maxSizeMB: 0.4,
        maxWidthOrHeight: 1080,
        useWebWorker: true,
      };
      const compressed = await imageCompression(file, options);
      return compressed;
    } catch (err) {
      console.warn('Image compression failed, skipping upload:', err);
      return null;
    }
  };

  /** Compress to < 0.6MB with minimal visual change (for reflection cache – no API re-calls). */
  const compressReflectionImage = async (dataUrl) => {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) return null;
    try {
      const file = dataURLtoFile(dataUrl, 'reflection-cache.png');
      if (!file) return null;
      const options = {
        maxSizeMB: 0.6,
        maxWidthOrHeight: 1080,
        useWebWorker: true,
        initialQuality: 0.92,
      };
      const compressed = await imageCompression(file, options);
      return compressed;
    } catch (err) {
      console.warn('Reflection image compression failed:', err);
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

      const result = await Filesystem.writeFile({
        path,
        data: base64Data,
        directory: Directory.Cache,
        recursive: false,
      });

      const uri = result.uri || result.path || null;
      return uri;
    } catch (e) {
      return null;
    }
  };

  const handleShareToSelectedPlatform = async () => {
    const t = (sharePanelOpen ? editableShareText : selectedText) || '';
    if (!t) return;

    // Resolve the current suggestion image (if any) to a data URL so we can share it
    const rawImage = suggestionImageUrls[selectedIndex] || null;
    let imageDataUrl = null;
    if (rawImage && typeof rawImage === 'string') {
      if (rawImage.startsWith('data:image')) {
        imageDataUrl = rawImage;
      } else {
        // Convert blob/https URL → data URL for native / Web Share API
        imageDataUrl = await getImageAsDataUrl(rawImage);
      }
    }
    const isDataUrl =
      imageDataUrl && typeof imageDataUrl === 'string' && imageDataUrl.startsWith('data:image');

    // 0) LinkedIn: API flow — OAuth → backend posts image + text via LinkedIn API → post appears on feed
    if (
      selectedPlatform === 'linkedin' &&
      (imageDataUrl || (rawImage && typeof rawImage === 'string'))
    ) {
      const done = await shareToLinkedInViaApi(t, imageDataUrl || rawImage || null);
      if (done) {
        triggerPostShareConfirmation();
        setSharePanelOpen(false);
        return;
      }
      // API failed (e.g. not connected, backend error): fallback to share sheet with image + text
      const linkedInImageSource = imageDataUrl || rawImage || null;
      const linkedInDataUrl =
        linkedInImageSource && typeof linkedInImageSource === 'string'
          ? await getImageAsDataUrl(linkedInImageSource)
          : null;
      if (linkedInDataUrl) {
        setLinkedInToastMessage('caption');
        setLinkedInCaptionToastVisible(true);
        setTimeout(() => setLinkedInCaptionToastVisible(false), 3500);
        copyCaptionToClipboardForLinkedIn(t);
        try {
          if (isNative()) {
            const fileUri = await writeImageToCacheFile(linkedInDataUrl);
            if (fileUri) {
              await Share.share({
                text: t,
                files: [fileUri],
                title: 'Share to LinkedIn',
                dialogTitle: 'Share to LinkedIn',
              });
              await recordShare('linkedin', t, { imageDataUrlForStorage: linkedInDataUrl });
              triggerPostShareConfirmation();
              setSharePanelOpen(false);
              return;
            }
          }
          if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare) {
            const file = dataURLtoFile(linkedInDataUrl);
            if (file && navigator.canShare({ text: t, files: [file] })) {
              await navigator.share({ text: t, files: [file] });
              await recordShare('linkedin', t, { imageDataUrlForStorage: linkedInDataUrl });
              triggerPostShareConfirmation();
              setSharePanelOpen(false);
              return;
            }
          }
        } catch (err) {
          if (err?.name !== 'AbortError') console.warn('LinkedIn share fallback failed', err);
        }
      }
      shareToLinkedIn(t);
      try {
        await recordShare('linkedin', t, { imageDataUrlForStorage: linkedInDataUrl || null });
      } catch (_) {}
      triggerPostShareConfirmation();
      setSharePanelOpen(false);
      return;
    }
    if (selectedPlatform === 'linkedin') {
      // No image: copy text and open LinkedIn share URL
      shareToLinkedIn(t);
      try {
        await recordShare('linkedin', t, {});
      } catch (_) {}
      triggerPostShareConfirmation();
      setSharePanelOpen(false);
      return;
    }

    // 1) Special case: X (Twitter) → generate tweet-style image card and share that,
    // but only if an AI image has been generated for the selected suggestion
    if (selectedPlatform === 'x' && isDataUrl) {
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
            skipFonts: true,
            cacheBust: false,
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
                  await recordShare('x', t, { imageDataUrlForStorage: cardDataUrl });
                  triggerPostShareConfirmation();
                  setSharePanelOpen(false);
                  return;
                }
              } catch (err) {
                // Native share failed, fall through
              }
            }

            // Web Share API with image file (PWA / mobile browser)
            if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare) {
              const file = dataURLtoFile(cardDataUrl);
              if (file && navigator.canShare({ files: [file] })) {
                try {
                  await navigator.share({ files: [file] });
                  await recordShare('x', t, { imageDataUrlForStorage: cardDataUrl });
                  triggerPostShareConfirmation();
                  setSharePanelOpen(false);
                  return;
                } catch (err) {
                  // Web Share failed, fall through to download fallback
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
            await recordShare('x', t, { imageDataUrlForStorage: cardDataUrl });
            triggerPostShareConfirmation();
            setSharePanelOpen(false);
            return;
          }
        }
      } catch (err) {
        if (err?.name === 'SecurityError' || (err?.message && err.message.includes('cssRules'))) {
          await recordShare('x', t, { imageDataUrlForStorage: imageDataUrl || null });
        }
      }

      // Absolute fallback if card generation/sharing failed: fall back to existing X text-only share
      shareToTwitter(t);
      triggerPostShareConfirmation();
      setSharePanelOpen(false);
      return;
    }

    // 1) Native share via Capacitor (Android/iOS app) – text + image
    if (isNative() && isDataUrl) {
      try {
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
        await recordShare(selectedPlatform, t, { imageDataUrlForStorage: imageDataUrl || null });
        if (selectedPlatform === 'linkedin') {
          copyCaptionToClipboardForLinkedIn(t);
        }
        triggerPostShareConfirmation();
        setSharePanelOpen(false);
        return;
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.warn('Native share failed, falling back to web share:', err);
        }
      }
    }

    // 2) Web Share API with files (PWA / supported mobile browsers)
    if (isDataUrl && typeof navigator !== 'undefined' && navigator.share && navigator.canShare) {
      const file = dataURLtoFile(imageDataUrl);
      if (file && navigator.canShare({ text: t, files: [file] })) {
        try {
          await navigator.share({ text: t, files: [file] });
          await recordShare(selectedPlatform, t, { imageDataUrlForStorage: imageDataUrl || null });
          if (selectedPlatform === 'linkedin') {
            copyCaptionToClipboardForLinkedIn(t);
          }
          triggerPostShareConfirmation();
          setSharePanelOpen(false);
          return;
        } catch (err) {
          if (err.name !== 'AbortError') console.warn('Share with image failed:', err);
        }
      }
    }

    // 3) Fallback: platform-specific share URLs (text only) + optional download
    const fallbackImage = isDataUrl ? imageDataUrl : rawImage;
    try {
      await recordShare(selectedPlatform, t, { imageDataUrlForStorage: fallbackImage });
    } catch (err) {
      console.error('Failed to save post to My Presence:', err);
    }
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
      {/* LinkedIn toast */}
      {linkedInCaptionToastVisible && (
        <div className="fixed inset-x-0 bottom-6 flex justify-center pointer-events-none z-50">
          <div
            className="px-4 py-2 rounded-full shadow-md text-sm pointer-events-auto"
            style={{
              background: isDarkMode ? 'rgba(15,23,42,0.95)' : 'rgba(17,24,39,0.95)',
              color: '#FFFFFF',
            }}
          >
            {linkedInToastMessage === 'connect'
              ? '🔗 Connect LinkedIn first — opening sign-in…'
              : linkedInToastMessage === 'success'
              ? '✅ Successfully posted to LinkedIn!'
              : '📋 Caption copied! Paste it in LinkedIn'}
          </div>
        </div>
      )}
      {/* X share sheet toast */}
      {xShareToastVisible && (
        <div className="fixed inset-x-0 bottom-6 flex justify-center pointer-events-none z-50">
          <div
            className="px-4 py-2 rounded-full shadow-md text-sm pointer-events-auto max-w-[90vw] text-center"
            style={{
              background: isDarkMode ? 'rgba(15,23,42,0.95)' : 'rgba(17,24,39,0.95)',
              color: '#FFFFFF',
            }}
          >
            {xShareToastMessage === 'opening'
              ? 'Opening share menu...'
              : xShareToastMessage === 'choose_x'
              ? 'Choose X to post your image.'
              : xShareToastMessage === 'downloaded'
              ? 'Image downloaded. Upload it on X to share.'
              : 'Unable to open share menu.'}
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
                      ref={tweetCardRef}
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
                  onClick={
                    selectedPlatform === 'x' && suggestionImageUrls[selectedIndex]
                      ? handleShareImageToX
                      : handleShareToSelectedPlatform
                  }
                  disabled={!selectedPlatform || !editableShareText.trim()}
                  className="flex-1 py-3 rounded-xl font-medium transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    background:
                      selectedPlatform === 'linkedin'
                        ? '#0A66C2'
                        : selectedPlatform === 'x'
                        ? '#1D9BF0'
                        : selectedPlatform === 'reddit'
                        ? REDDIT_COLOR
                        : isDarkMode
                        ? HUB.divider
                        : '#CCC',
                    color: '#FFFFFF',
                  }}
                >
                  {selectedPlatform
                    ? selectedPlatform === 'x' && suggestionImageUrls[selectedIndex]
                      ? 'Share to X'
                      : `Share to ${PLATFORM_LABELS[selectedPlatform]}`
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
