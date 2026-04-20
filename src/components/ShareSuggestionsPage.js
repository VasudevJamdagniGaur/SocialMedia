import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Linkedin, Pencil } from 'lucide-react';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Clipboard } from '@capacitor/clipboard';
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
import xLogoImg from '../assets/images/x-logo.png';
import redditLogoImg from '../assets/images/reddit-logo.png';

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

/** Normalize suggestion/caption text for stable "posted" matching across reloads. */
const normSuggestionPost = (s) => (s || '').replace(/\s+/g, ' ').trim();

const SHARE_POSTED_STORAGE_PREFIX = 'share_suggestions_posted_v1';

const sharePostedLocalKey = (uid, dateStr, platform) => {
  const u = uid || 'anon';
  return `${SHARE_POSTED_STORAGE_PREFIX}::${u}::${dateStr || 'nodate'}::${platform || 'unknown'}`;
};

const readSharePostedState = (key) => {
  try {
    if (typeof localStorage === 'undefined') {
      return { reflectionHash: null, postedTexts: [], captionOverrides: {} };
    }
    const raw = localStorage.getItem(key);
    if (!raw) return { reflectionHash: null, postedTexts: [], captionOverrides: {} };
    const o = JSON.parse(raw);
    const arr = Array.isArray(o.postedTexts) ? o.postedTexts.filter((x) => typeof x === 'string') : [];
    const captionOverrides =
      o.captionOverrides && typeof o.captionOverrides === 'object' && !Array.isArray(o.captionOverrides)
        ? o.captionOverrides
        : {};
    return {
      reflectionHash: o.reflectionHash || null,
      postedTexts: arr.map(normSuggestionPost).filter(Boolean),
      captionOverrides,
    };
  } catch {
    return { reflectionHash: null, postedTexts: [], captionOverrides: {} };
  }
};

const writeSharePostedState = (key, reflectionHash, postedTexts, captionOverrides = {}) => {
  try {
    if (typeof localStorage === 'undefined') return;
    const unique = [...new Set(postedTexts.map(normSuggestionPost).filter(Boolean))];
    const co = {};
    Object.keys(captionOverrides || {}).forEach((k) => {
      const nk = normSuggestionPost(k);
      const v = captionOverrides[k];
      if (nk && typeof v === 'string' && v.trim()) co[nk] = v.trim();
    });
    localStorage.setItem(key, JSON.stringify({ reflectionHash, postedTexts: unique, captionOverrides: co }));
  } catch {
    // ignore quota / private mode
  }
};

/**
 * If reflection text changed (e.g. user chatted more with Detea), clear posted markers so cards show in color again.
 * Otherwise return a Set of post texts that were already shared for this reflection + date + platform.
 */
const getPostedStateForLoadedReflection = (reflectionText, storageKey) => {
  const currentHash = firestoreService.hashForReflectionCache(reflectionText);
  const stored = readSharePostedState(storageKey);
  if (!stored.reflectionHash || stored.reflectionHash !== currentHash) {
    writeSharePostedState(storageKey, currentHash, [], {});
    return { postedSet: new Set(), captionOverrides: {} };
  }
  return {
    postedSet: new Set(stored.postedTexts),
    captionOverrides: stored.captionOverrides || {},
  };
};

const mergePostedIntoSuggestions = (posts, postedSet, captionOverrides = {}) => {
  if (!Array.isArray(posts) || !postedSet?.size) return posts;
  return posts.map((item) => {
    const post = typeof item === 'object' && item?.post != null ? item.post : String(item || '');
    const n = normSuggestionPost(post);
    const displayCaption = (n && captionOverrides[n]) || post;
    const nDisplay = normSuggestionPost(displayCaption);
    const isPosted =
      (n && postedSet.has(n)) ||
      (nDisplay && postedSet.has(nDisplay)) ||
      (n && captionOverrides[n] && postedSet.has(normSuggestionPost(captionOverrides[n])));
    if (!isPosted) return item;
    if (typeof item === 'object') return { ...item, post: displayCaption, posted: true };
    return { eventLabel: 'Reflection', post: displayCaption, posted: true };
  });
};

const appendPostedTextsForShare = (storageKey, reflectionText, textsToAdd, captionOverrideEntry = null) => {
  const currentHash = firestoreService.hashForReflectionCache(reflectionText);
  const stored = readSharePostedState(storageKey);
  let postedTexts =
    stored.reflectionHash === currentHash ? [...stored.postedTexts] : [];
  let captionOverrides =
    stored.reflectionHash === currentHash ? { ...(stored.captionOverrides || {}) } : {};
  textsToAdd.forEach((t) => {
    const n = normSuggestionPost(t);
    if (n) postedTexts.push(n);
  });
  postedTexts = [...new Set(postedTexts.map(normSuggestionPost).filter(Boolean))];
  if (captionOverrideEntry?.original != null && captionOverrideEntry?.final != null) {
    const no = normSuggestionPost(captionOverrideEntry.original);
    const nf = String(captionOverrideEntry.final).trim();
    if (no && nf && no !== normSuggestionPost(nf)) captionOverrides[no] = nf;
  }
  writeSharePostedState(storageKey, currentHash, postedTexts, captionOverrides);
};

const getLastChatImageForDate = async (dateId) => {
  try {
    if (!dateId) return null;

    // 1) Prefer localStorage (works even when Firestore omits large images)
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(`chatMessages_${dateId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (let i = parsed.length - 1; i >= 0; i--) {
            const img = parsed[i]?.image;
            // Chat images can be stored as `data:image/...`, blob URLs, or HTTPS URLs.
            // We accept any non-empty string so we can reuse the real photo and avoid
            // unnecessary Gemini image generation.
            if (typeof img === 'string' && img.trim()) return img;
          }
        }
      }
    }

    // 2) Fallback: Firestore messages for the day (only if image was small enough to store)
    const user = getCurrentUser();
    if (!user?.uid) return null;
    const res = await firestoreService.getChatMessagesNew(user.uid, dateId);
    const msgs = Array.isArray(res?.messages) ? res.messages : [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const img = msgs[i]?.image;
      if (typeof img === 'string' && img.trim()) return img;
    }
    return null;
  } catch {
    return null;
  }
};

const isNative = () =>
  typeof window !== 'undefined' &&
  typeof Capacitor !== 'undefined' &&
  typeof Capacitor.isNativePlatform === 'function' &&
  Capacitor.isNativePlatform();

const guessMimeFromHeaders = (headers) => {
  if (!headers) return null;
  try {
    const keys = Object.keys(headers);
    const ctKey = keys.find((k) => k.toLowerCase() === 'content-type');
    const v = ctKey ? headers[ctKey] : null;
    return typeof v === 'string' ? v.split(';')[0].trim() : null;
  } catch {
    return null;
  }
};

const formatShareError = (e) => {
  try {
    if (!e) return 'unknown';
    if (typeof e === 'string') return e;
    if (e instanceof Error) return e.message || 'Error';
    // Some plugins throw event-like objects
    if (typeof e?.message === 'string' && e.message.trim()) return e.message.trim();
    if (typeof e?.error === 'string' && e.error.trim()) return e.error.trim();
    if (typeof e?.error?.message === 'string' && e.error.message.trim()) return e.error.message.trim();
    if (typeof e?.type === 'string') return `Event(${e.type})`;
    // Try JSON
    try {
      const s = JSON.stringify(e);
      if (s && s !== '{}' && s !== 'null') return s.slice(0, 160);
    } catch {
      // ignore
    }
    return String(e);
  } catch {
    return 'unknown';
  }
};

/**
 * Share ONLY the image (native share sheet) and copy the text to clipboard.
 * @param {string} base64Image - data URL or raw base64 (png/jpg) string
 * @param {string} text - text to copy to clipboard (NOT included in share payload)
 * @returns {Promise<{ shared: boolean; copied: boolean; fileUri?: string | null }>}
 */
async function shareImageOnlyAndCopyText(base64Image, text) {
  const safeText = (text || '').trim();
  let copied = false;
  let fileUri = null;
  let error = null;

  // Copy text first so user can paste immediately in the destination app
  try {
    if (safeText) {
      await Clipboard.write({ string: safeText });
      copied = true;
    }
  } catch {
    copied = false;
  }

  // Write image file to cache and share only the image
  try {
    if (!base64Image || typeof base64Image !== 'string') {
      return { shared: false, copied, fileUri: null, error: 'Missing base64 image' };
    }

    // Remove the "data:image/...;base64," prefix if present
    const header = base64Image.startsWith('data:') ? base64Image.split(',')[0] : '';
    const mimeMatch = header.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64$/);
    const mime = (mimeMatch && mimeMatch[1]) ? mimeMatch[1] : 'image/png';
    const ext =
      mime.includes('png') ? 'png' :
      (mime.includes('jpeg') || mime.includes('jpg')) ? 'jpg' :
      mime.includes('webp') ? 'webp' : 'png';

    const base64Data = base64Image.includes(',') ? base64Image.split(',').slice(1).join(',') : base64Image;
    if (!base64Data) return { shared: false, copied, fileUri: null, error: 'Invalid base64 data' };

    const path = `share-only-${Date.now()}.${ext}`;
    await Filesystem.writeFile({
      path,
      data: base64Data,
      directory: Directory.Cache,
      recursive: false,
    });
    const uriResult = await Filesystem.getUri({ directory: Directory.Cache, path });
    fileUri = uriResult?.uri || null;
    if (!fileUri) return { shared: false, copied, fileUri: null, error: 'Could not get file URI' };

    // Share ONLY the image. Do not include text in payload.
    await Share.share({
      // Use url for widest Android compatibility; do not include text
      url: fileUri,
      title: 'Share image',
      dialogTitle: 'Share',
    });

    return { shared: true, copied, fileUri, error: null };
    // Share ONLY the image. Do not include text in payload.
    // Some Android targets accept `files`, others accept `url`. Try both.
    try {
      await Share.share({
        text: '',
        files: [fileUri],
        title: 'Share image',
        dialogTitle: 'Share',
      });
    } catch (e1) {
      const msg1 = (e1 && (e1.message || String(e1))) ? (e1.message || String(e1)) : 'unknown';
      try {
        await Share.share({
          text: '',
          url: fileUri,
          title: 'Share image',
          dialogTitle: 'Share',
        });
      } catch (e2) {
        const msg2 = (e2 && (e2.message || String(e2))) ? (e2.message || String(e2)) : 'unknown';
        return { shared: false, copied, fileUri, error: `Share failed (files: ${msg1}) (url: ${msg2})` };
      }
    }

    return { shared: true, copied, fileUri, error: null };
  } catch (e) {
    const msg = (e && (e.message || String(e))) ? (e.message || String(e)) : 'unknown';
    error = `Share image failed: ${msg}`;
    return { shared: false, copied, fileUri, error };
  }
}

/**
 * Share ONLY the image (native share sheet). No clipboard, no text.
 * @param {string} base64Image - data URL or raw base64 (png/jpg) string
 * @returns {Promise<{ shared: boolean; fileUri?: string | null; error?: string | null }>}
 */
async function shareImageOnly(base64Image) {
  let fileUri = null;
  try {
    if (!base64Image || typeof base64Image !== 'string') {
      return { shared: false, fileUri: null, error: 'Missing base64 image' };
    }

    const header = base64Image.startsWith('data:') ? base64Image.split(',')[0] : '';
    const mimeMatch = header.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64$/);
    const mime = (mimeMatch && mimeMatch[1]) ? mimeMatch[1] : 'image/png';
    const ext =
      mime.includes('png') ? 'png' :
      (mime.includes('jpeg') || mime.includes('jpg')) ? 'jpg' :
      mime.includes('webp') ? 'webp' : 'png';

    const base64Data = base64Image.includes(',') ? base64Image.split(',').slice(1).join(',') : base64Image;
    if (!base64Data) return { shared: false, fileUri: null, error: 'Invalid base64 data' };

    const path = `share-only-${Date.now()}.${ext}`;
    await Filesystem.writeFile({
      path,
      data: base64Data,
      directory: Directory.Cache,
      recursive: false,
    });
    const uriResult = await Filesystem.getUri({ directory: Directory.Cache, path });
    fileUri = uriResult?.uri || null;
    if (!fileUri) return { shared: false, fileUri: null, error: 'Could not get file URI' };

    // Some Android targets accept `files`, others accept `url`. Try both.
    try {
      await Share.share({
        text: '',
        files: [fileUri],
        title: 'Share image',
        dialogTitle: 'Share',
      });
    } catch (e1) {
      try {
        await Share.share({
          text: '',
          url: fileUri,
          title: 'Share image',
          dialogTitle: 'Share',
        });
      } catch (e2) {
        return { shared: false, fileUri, error: `Share failed: ${formatShareError(e2)}` };
      }
    }

    return { shared: true, fileUri, error: null };
  } catch (e) {
    return { shared: false, fileUri, error: `Share image failed: ${formatShareError(e)}` };
  }
}

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

function normalizeNewsArticle(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title || '').trim();
  const url = String(raw.url || '').trim();
  if (!title || !url) return null;
  return {
    title,
    url,
    description: String(raw.description || '').trim(),
    image: typeof raw.image === 'string' && raw.image.trim() ? raw.image.trim() : null,
    source: String(raw.source || '').trim(),
  };
}

function buildNewsSharePromptContext(n) {
  return [
    'The user wants social posts based on this NEWS ARTICLE (not a personal diary).',
    `Headline: ${n.title}`,
    n.source ? `Source: ${n.source}` : '',
    n.description ? `Summary: ${n.description}` : '',
    `Article URL: ${n.url}`,
    '',
    'Write posts that react to, summarize, or add concise professional commentary on this story. Ground posts only in the headline and summary; do not invent specific facts not implied there.',
  ]
    .filter(Boolean)
    .join('\n');
}

export default function ShareSuggestionsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isDarkMode } = useTheme();
  const state = location.state || {};
  const reflectionFromState = (state.reflection ?? '').trim();
  const newsArticleFromState = normalizeNewsArticle(state.newsArticle);
  const isNewsShareMode = !!newsArticleFromState;
  const [newsArticleDetails, setNewsArticleDetails] = useState(null);
  const [isLoadingNewsDetails, setIsLoadingNewsDetails] = useState(isNewsShareMode);
  const [newsCardSummary, setNewsCardSummary] = useState('');

  const buildLocalNewsCardSummary = useCallback((details) => {
    try {
      if (!details) return '';
      const title = String(details?.title || '').trim();
      const description = String(details?.description || '').trim();
      const text = String(details?.text || '').trim();

      // Reddit thread bundles (post + comments) are for model context only — never show raw in the card.
      if (/Subreddit:\s*r\/|Top comments:|Comment by u\//i.test(text)) {
        return '';
      }

      const maxWords = 78;
      const titleNorm = title.replace(/\s+/g, ' ').trim().toLowerCase();
      const descNorm = description.replace(/\s+/g, ' ').trim().toLowerCase();
      const descIsHeadline =
        !description ||
        descNorm === titleNorm ||
        (titleNorm.length > 12 && (titleNorm.includes(descNorm) || descNorm.includes(titleNorm)));

      if (!title) return '';
      if (text.length < 280) return '';

      const body = text.replace(/\s+/g, ' ').trim();
      const extra = !descIsHeadline && description ? ` ${description}` : '';
      const combined = `${body}${extra}`.replace(/\s+/g, ' ').trim();
      const words = combined.split(/\s+/).filter(Boolean);
      const limited = words.slice(0, maxWords).join(' ');
      const out = limited.replace(/\s+/g, ' ').trim();
      const outNorm = out.replace(/\s+/g, ' ').trim().toLowerCase();
      if (!out || outNorm === titleNorm) return '';
      return out;
    } catch {
      return '';
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!isNewsShareMode || !newsArticleFromState?.url) {
      setNewsArticleDetails(null);
      setIsLoadingNewsDetails(false);
      setNewsCardSummary('');
      return () => {
        cancelled = true;
      };
    }

    setIsLoadingNewsDetails(true);
    chatService
      .fetchNewsArticleDetails(newsArticleFromState, { minTextLength: 350, resolveGoogleNews: true })
      .then(async (d) => {
        if (cancelled) return;
        // Only treat as "details loaded" if we got something useful back.
        const looksUseful = d && (d.title || d.description || d.text || d.image || d.source);
        const details = looksUseful ? d : null;
        setNewsArticleDetails(details);
        setNewsCardSummary('');
        if (details) {
          const summary = await chatService.summarizeNewsArticle(details, { minWords: 60, maxWords: 80 });
          if (!cancelled && summary) {
            setNewsCardSummary(summary);
          } else if (!cancelled) {
            const local = buildLocalNewsCardSummary(details);
            setNewsCardSummary(local);
          }
        }
      })
      .catch(() => {
        if (cancelled) return;
        setNewsArticleDetails(null);
        setNewsCardSummary('');
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingNewsDetails(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isNewsShareMode, newsArticleFromState?.url, buildLocalNewsCardSummary]);

  const effectiveNewsArticle = isNewsShareMode ? (newsArticleDetails || newsArticleFromState) : null;
  // While fetch + Gemini summary run, do not fall back to buildLocalNewsCardSummary — it would flash raw article/thread text.
  const effectiveNewsCardText =
    isNewsShareMode
      ? isLoadingNewsDetails
        ? ''
        : newsCardSummary || buildLocalNewsCardSummary(effectiveNewsArticle)
      : '';

  const suggestionPromptText = isNewsShareMode
    ? buildNewsSharePromptContext({ ...effectiveNewsArticle, description: effectiveNewsCardText })
    : reflectionFromState;
  const baselineShareText = isNewsShareMode
    ? [effectiveNewsArticle.title, effectiveNewsCardText].filter(Boolean).join('\n\n') ||
      effectiveNewsArticle.title
    : reflectionFromState;
  const eventLabelDefault = isNewsShareMode ? 'News' : 'Reflection';
  const shareReturnTo =
    typeof state.returnTo === 'string' && state.returnTo.startsWith('/') ? state.returnTo : '/dashboard';
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
  const [aiEditImageOpen, setAiEditImageOpen] = useState(false);
  const [aiEditInstruction, setAiEditInstruction] = useState('');
  const [aiEditLoading, setAiEditLoading] = useState(false);
  const [aiEditError, setAiEditError] = useState('');
  const [linkedInCaptionToastVisible, setLinkedInCaptionToastVisible] = useState(false);
  const [linkedInToastMessage, setLinkedInToastMessage] = useState('caption'); // 'caption' | 'connect' | 'success' | 'error'
  const [linkedInErrorText, setLinkedInErrorText] = useState('');
  const [xShareToastVisible, setXShareToastVisible] = useState(false);
  const [xShareToastMessage, setXShareToastMessage] = useState(''); // 'opening' | 'choose_x' | 'downloaded' | 'error'
  const [shareConfirmation, setShareConfirmation] = useState({ open: false, index: null, platform: null });
  const [shareErrorToast, setShareErrorToast] = useState(false);
  const [shareErrorToastMessage, setShareErrorToastMessage] = useState('');
  const [pendingMyPresenceShare, setPendingMyPresenceShare] = useState(null);
  // Tracks whether suggestionImageUrls[idx] comes from a real photo sent in chat.
  // Used so we can persist the exact same image (no extra compression) into My Presence.
  const [suggestionImagesFromChat, setSuggestionImagesFromChat] = useState([]);
  const imageReplaceInputRef = useRef(null);
  const tweetCardRef = useRef(null);
  const tweetCardExportRef = useRef(null);
  const [xExportImageDataUrl, setXExportImageDataUrl] = useState(null);
  const [xExportProfileImageDataUrl, setXExportProfileImageDataUrl] = useState(null);
  /** Bumps when opening the share panel so prep cache never matches a previous session. */
  const sharePanelSessionRef = useRef(0);
  /**
   * Pre-built share payload (Capacitor: cache file URI + data URL for My Presence; web: File for navigator.share).
   * Populated while "Edit before sharing" is open so Share tap does not await heavy work.
   */
  const preparedShareRef = useRef({
    key: '',
    nativeImageUri: null,
    preparedImageDataUrl: null,
    webShareFile: null,
  });
  const [sharePanelPrepStatus, setSharePanelPrepStatus] = useState({ status: 'idle', error: null });

  useEffect(() => {
    if (!sharePanelOpen) {
      setAiEditImageOpen(false);
      setAiEditInstruction('');
      setAiEditError('');
      setAiEditLoading(false);
    }
  }, [sharePanelOpen]);

  /**
   * X + Reddit: share image via native share sheet and copy caption.
   * - X: uses the TweetShareCard render when available.
   * - Reddit: shares the generated image directly.
   */
  const handleShareImageToXOrReddit = async () => {
    try {
      const t =
        (sharePanelOpen ? ((editableShareText || '').trim() || selectedText) : selectedText) || '';
      const rawImage = suggestionImageUrls[selectedIndex] || null;
      const prepKey = getSharePrepKey();
      const prep = preparedShareRef.current;

      // Pre-built file from background prep — open share sheet immediately (no toPng / write on tap).
      if (prep.key === prepKey && prep.nativeImageUri && isNative()) {
        try {
          if (selectedPlatform === 'reddit') {
            const safeText = (t || '').trim();
            if (safeText) {
              try {
                await Clipboard.write({ string: safeText });
              } catch {
                // ignore
              }
              setShareErrorToastMessage('Caption copied. Paste it after sharing.');
              setShareErrorToast(true);
              setTimeout(() => setShareErrorToast(false), 2500);
            }
          }
          await Share.share({
            url: prep.nativeImageUri,
            title: 'Share image',
            dialogTitle: 'Share',
          });
          const imageForStorage = prep.preparedImageDataUrl || rawImage || null;
          setPendingMyPresenceShare({
            plat: selectedPlatform || 'other',
            caption: t,
            imageDataUrlForStorage: imageForStorage,
            skipCompression: suggestionImagesFromChat[selectedIndex],
          });
          triggerPostShareConfirmation();
          setSharePanelOpen(false);
          return;
        } catch (e) {
          // fall through to slow path
        }
      }

      if (
        prep.key === prepKey &&
        prep.webShareFile &&
        !isNative() &&
        typeof navigator !== 'undefined' &&
        navigator.share
      ) {
        try {
          const file = prep.webShareFile;
          if (selectedPlatform === 'x') {
            if (navigator.canShare && !navigator.canShare({ files: [file] })) {
              throw new Error('Web Share cannot attach this file');
            }
            await navigator.share({ files: [file] });
          } else {
            const payload = { text: (t || '').trim(), files: [file] };
            if (navigator.canShare && !navigator.canShare(payload)) {
              await navigator.share({ files: [file] });
            } else {
              await navigator.share(payload);
            }
          }
          const imageForStorage = prep.preparedImageDataUrl || rawImage || null;
          setPendingMyPresenceShare({
            plat: selectedPlatform || 'other',
            caption: t,
            imageDataUrlForStorage: imageForStorage,
            skipCompression: suggestionImagesFromChat[selectedIndex],
          });
          triggerPostShareConfirmation();
          setSharePanelOpen(false);
          return;
        } catch (e) {
          if (e?.name === 'AbortError') return;
          // fall through to slow path
        }
      }

      setShareErrorToastMessage(`Starting image share for ${selectedPlatform === 'x' ? 'X' : 'Reddit'}…`);
      setShareErrorToast(true);
      setTimeout(() => setShareErrorToast(false), 4000);

      let imageDataUrl = null;

      if (selectedPlatform === 'x') {
        if (!xExportImageDataUrl) {
          setShareErrorToastMessage('Preparing X image… Please try again in a moment.');
          setShareErrorToast(true);
          setTimeout(() => setShareErrorToast(false), 3000);
          return;
        }
        // When user is editing, export from the visible card so typography/wrapping
        // matches the UI preview exactly.
        const exportNode =
          tweetCardExportRef.current ||
          tweetCardRef.current;
        if (!exportNode) {
          setShareErrorToastMessage('X share is still preparing. Please try again.');
          setShareErrorToast(true);
          setTimeout(() => setShareErrorToast(false), 3000);
          return;
        }

        const exportRect = exportNode.getBoundingClientRect?.();
        const exportWidth = exportRect?.width ? Math.round(exportRect.width) : 360;
        const exportHeight = exportRect?.height ? Math.round(exportRect.height) : Math.round((exportWidth * 10) / 7);

        try {
          imageDataUrl = await toPng(exportNode, {
            width: exportWidth,
            height: exportHeight,
            pixelRatio: 2,
            skipFonts: false,
            cacheBust: true,
          });

        } catch (e) {
          setShareErrorToastMessage(`X image export failed: ${formatShareError(e)}`);
          setShareErrorToast(true);
          setTimeout(() => setShareErrorToast(false), 6000);
          return;
        }
      } else if (rawImage && typeof rawImage === 'string') {
        if (rawImage.startsWith('data:image')) {
          imageDataUrl = rawImage;
        } else if (rawImage.startsWith('blob:')) {
          imageDataUrl = await blobUrlToDataUrl(rawImage);
        } else if (rawImage.startsWith('https://') || rawImage.startsWith('http://')) {
          if (isNative() && CapacitorHttp && typeof CapacitorHttp.get === 'function') {
            const resp = await CapacitorHttp.get({ url: rawImage, responseType: 'arraybuffer' });
            const mime = guessMimeFromHeaders(resp?.headers) || 'image/png';
            const base64Bytes = typeof resp?.data === 'string' ? resp.data : null;
            if (base64Bytes) imageDataUrl = `data:${mime};base64,${base64Bytes}`;
          } else {
            imageDataUrl = await getImageAsDataUrl(rawImage);
          }
        }
      }

      if (!imageDataUrl || typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image')) {
        setShareErrorToastMessage('Could not prepare image for sharing. Please try again.');
        setShareErrorToast(true);
        setTimeout(() => setShareErrorToast(false), 3500);
        return;
      }

      setShareErrorToastMessage('Image ready. Opening share sheet…');
      setShareErrorToast(true);
      setTimeout(() => setShareErrorToast(false), 4000);

      // X requirement: share ONLY the image (no clipboard, no text).
      // Reddit: share image + copy caption for easy pasting.
      const result = selectedPlatform === 'x'
        ? await shareImageOnly(imageDataUrl)
        : await shareImageOnlyAndCopyText(imageDataUrl, t);

      const shared = !!result?.shared;
      const copied = selectedPlatform === 'x' ? false : !!result?.copied;
      const error = result?.error;

      if (copied) {
        setShareErrorToastMessage('Caption copied. Paste it after sharing.');
        setShareErrorToast(true);
        setTimeout(() => setShareErrorToast(false), 2500);
      }
      if (!shared) {
        setShareErrorToastMessage(`Image share failed${error ? `: ${String(error)}` : ''}`);
        setShareErrorToast(true);
        setTimeout(() => setShareErrorToast(false), 4000);
        return;
      }

      const imageForStorage = imageDataUrl || rawImage || null;
      // Defer "My Presence" persistence until user confirms.
      setPendingMyPresenceShare({
        plat: selectedPlatform || 'other',
                    caption: t,
                    imageDataUrlForStorage: imageForStorage,
                    skipCompression: suggestionImagesFromChat[selectedIndex],
      });
      triggerPostShareConfirmation();
      setSharePanelOpen(false);
    } catch (e) {
      setShareErrorToastMessage(`Share failed: ${formatShareError(e)}`);
      setShareErrorToast(true);
      setTimeout(() => setShareErrorToast(false), 4000);
    }
  };

  const reflectionDate = state.selectedDate ? (state.selectedDate instanceof Date ? state.selectedDate : new Date(state.selectedDate)) : new Date();
  const dateStr = reflectionDate instanceof Date ? getDateId(reflectionDate) : getDateId(new Date(reflectionDate));

  // For X export: ensure the embedded photo is an inline data URL (avoid toPng CORS/canvas taint).
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!sharePanelOpen || selectedPlatform !== 'x') return;

      const rawPhoto = suggestionImageUrls[selectedIndex] || null;
      const rawProfile = tweetProfileImage || null;

      const convertToDataUrl = async (value) => {
        if (!value || typeof value !== 'string') return null;
        if (value.startsWith('data:image')) return value;
        if (value.startsWith('blob:')) return blobUrlToDataUrl(value);
        if (value.startsWith('https://') || value.startsWith('http://')) {
          if (isNative() && CapacitorHttp && typeof CapacitorHttp.get === 'function') {
            try {
              const resp = await CapacitorHttp.get({ url: value, responseType: 'arraybuffer' });
              const mime = guessMimeFromHeaders(resp?.headers) || 'image/png';
              const base64Bytes = typeof resp?.data === 'string' ? resp.data : null;
              return base64Bytes ? `data:${mime};base64,${base64Bytes}` : null;
            } catch {
              return null;
            }
          }
          return getImageAsDataUrl(value);
        }
        return null;
      };

      const [photoDataUrl, profileDataUrl] = await Promise.all([
        convertToDataUrl(rawPhoto),
        convertToDataUrl(rawProfile),
      ]);

      if (!cancelled) {
        setXExportImageDataUrl(photoDataUrl);
        setXExportProfileImageDataUrl(profileDataUrl);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [sharePanelOpen, selectedPlatform, selectedIndex, suggestionImageUrls]);

  // When user selects a platform (from state or by tapping an icon), fetch that platform's suggestions only
  useEffect(() => {
    if (!selectedPlatform || !suggestionPromptText) return;
    if (isNewsShareMode && isLoadingNewsDetails) return;
    let cancelled = false;
    setIsLoadingSuggestions(true);
    setSuggestionError(null);
    setSuggestionImageUrls([]);
    const suggestionsPromise = isNewsShareMode
      ? chatService.generateNewsArticleShareSuggestions(effectiveNewsArticle, selectedPlatform)
      : chatService.generateSocialPostSuggestions(suggestionPromptText, selectedPlatform);

    suggestionsPromise.then(async (list) => {
        if (cancelled) return;
        const postsRaw =
          Array.isArray(list) && list.length
            ? list
            : [{ eventLabel: eventLabelDefault, post: baselineShareText }];
        const posts = isNewsShareMode
          ? postsRaw.map((item) =>
              typeof item === 'object' && item?.post != null
                ? { ...item, eventLabel: 'News' }
                : { eventLabel: 'News', post: String(item || baselineShareText) }
            )
          : postsRaw;
        const userForPosted = getCurrentUser();
        const postedKey = sharePostedLocalKey(userForPosted?.uid, dateStr, selectedPlatform);
        const { postedSet, captionOverrides } = getPostedStateForLoadedReflection(
          suggestionPromptText,
          postedKey
        );
        setPlatformSuggestions(mergePostedIntoSuggestions(posts, postedSet, captionOverrides));
        setSelectedIndex(0);
        setIsLoadingSuggestions(false);
        // For LinkedIn, X, and Reddit: Prefer Firebase cache (no API re-calls), then localStorage, then Gemini; save to Firebase after generation
        const postsWithText = posts.map((item) =>
          (typeof item === 'object' && item?.post != null ? item.post : String(item || '')).trim()
        );

        if (isNewsShareMode) {
          const img = effectiveNewsArticle?.image || null;
          setSuggestionImageUrls(postsWithText.map(() => img));
          setSuggestionImagesFromChat(postsWithText.map(() => false));
          setIsLoadingImages(false);
          return;
        }

        const user = getCurrentUser();
        const reflectionKey = firestoreService.hashForReflectionCache(suggestionPromptText);
        const dateIdForChat = getDateId(reflectionDate);
        const chatImage = await getLastChatImageForDate(dateIdForChat);

        // 1) Single round: Firebase by index only (fast), then localStorage – no second round of text-based reads
        const preferredPlatforms = ['linkedin', 'x', 'reddit'];
        const platformsToTry = [
          selectedPlatform,
          ...preferredPlatforms.filter((p) => p !== selectedPlatform),
        ].filter(Boolean);

        const firebaseUrls = user
          ? await Promise.all(
              postsWithText.map(async (_, idx) => {
                for (const p of platformsToTry) {
                  const url = await firestoreService.getReflectionImageUrlByIndex(
                    user.uid,
                    p,
                    reflectionKey,
                    idx
                  );
                  if (url) return url;
                }
                return null;
              })
            )
          : postsWithText.map(() => null);

        // If user shared a real photo while chatting about the day,
        // use that same photo for all platforms instead of generating an AI image.
        const cachedImages = postsWithText.map((text, idx) =>
          chatImage || firebaseUrls[idx] || getCachedImageForPost(text)
        );

        setSuggestionImageUrls(cachedImages);
        setSuggestionImagesFromChat(postsWithText.map(() => !!chatImage));

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
          const userForPosted = getCurrentUser();
          const postedKey = sharePostedLocalKey(userForPosted?.uid, dateStr, selectedPlatform);
          const { postedSet, captionOverrides } = getPostedStateForLoadedReflection(
            suggestionPromptText,
            postedKey
          );
          const fallbackPosts = [{ eventLabel: eventLabelDefault, post: baselineShareText }];
          setPlatformSuggestions(mergePostedIntoSuggestions(fallbackPosts, postedSet, captionOverrides));
          setSelectedIndex(0);
          if (isNewsShareMode) {
            const img = effectiveNewsArticle?.image || null;
            setSuggestionImageUrls([img]);
          } else {
            setSuggestionImageUrls([]);
          }
          setIsLoadingSuggestions(false);
        }
      });
    return () => { cancelled = true; };
  }, [selectedPlatform, suggestionPromptText, dateStr, isLoadingNewsDetails, newsArticleDetails]);

  const fallbackSuggestions = buildFallbackSuggestions(
    isNewsShareMode ? baselineShareText : reflectionFromState
  );
  const selectedFallbackId = fallbackSuggestions[selectedIndex]?.id ?? 'original';
  const selectedText = selectedPlatform
    ? (platformSuggestions[selectedIndex]?.post ?? platformSuggestions[0]?.post ?? baselineShareText)
    : (fallbackSuggestions[selectedIndex]?.text ?? baselineShareText);

  /** Stable key so pre-built share files match the current panel state (session, caption, image, X card readiness). */
  const getSharePrepKey = useCallback(() => {
    const caption = normSuggestionPost(
      ((editableShareText || '').trim() || (selectedText || '')).trim()
    );
    const raw = suggestionImageUrls[selectedIndex] || null;
    const rawSig =
      !raw ? 'n' :
      typeof raw !== 'string' ? 'x' :
      raw.startsWith('http://') || raw.startsWith('https://') ? raw :
      raw.startsWith('data:image') ? `d:${raw.length}` :
      raw.startsWith('blob:') ? `b:${raw.slice(0, 96)}` :
      `o:${String(raw).slice(0, 48)}`;
    const xCardReady =
      selectedPlatform === 'x' && raw
        ? (xExportImageDataUrl ? '1' : '0')
        : 'na';
    return `${sharePanelSessionRef.current}|${selectedPlatform}|${selectedIndex}|${caption}|${rawSig}|${xCardReady}`;
  }, [
    editableShareText,
    selectedText,
    selectedPlatform,
    selectedIndex,
    suggestionImageUrls,
    xExportImageDataUrl,
  ]);

  /**
   * Persist share to Firestore so the post stays in My Presence after app reopen.
   * Dual-image pipeline: high-quality image is used for sharing; compressed copy is uploaded and only the URL is stored.
   * @param {string} plat - Platform: 'linkedin' | 'x' | 'reddit' | 'other'
   * @param {string} text - Caption text
   * @param {{
   *   imageDataUrlForStorage?: string | null;
   *   skipCompression?: boolean;
   *   suggestionImageUrlSnapshot?: string | null;
   *   reflectionImageLookupTexts?: string[];
   * }} [options] - Image + cache hints; use snapshot fields when firing recordShare after optimistic UI updates
   */
  const recordShare = async (plat, text, options = {}) => {
    const user = getCurrentUser();
    const content = (text || selectedText || '').trim();
    if (!user?.uid || !content) return;
    const skipCompression = !!options.skipCompression;

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
      'suggestionImageUrlSnapshot' in options
        ? options.suggestionImageUrlSnapshot
        : Array.isArray(suggestionImageUrls) && suggestionImageUrls[selectedIndex]
          ? suggestionImageUrls[selectedIndex]
          : null;
    const imageToStore = options.imageDataUrlForStorage ?? imageForPost;

    // 2) Prepare image: File for upload to Storage at posts/{uid}/{postId}.jpg, or existing URL
    let imageFile = null;
    let imageUrl = null;
    if (imageToStore && typeof imageToStore === 'string') {
      if (imageToStore.startsWith('data:image')) {
        if (skipCompression) {
          // Upload the original bytes so My Presence matches the exact shared image.
          imageUrl = await firestoreService.uploadPostImage(user.uid, imageToStore);
        } else {
          const compressed = await compressImageForStorage(imageToStore);
          if (compressed) {
            imageFile = compressed;
          } else {
            imageUrl = await firestoreService.uploadPostImage(user.uid, imageToStore);
          }
        }
      } else if (imageToStore.startsWith('http://') || imageToStore.startsWith('https://')) {
        imageUrl = imageToStore;
      }
    }
    if (!imageUrl && content) {
      const lookupList = Array.isArray(options.reflectionImageLookupTexts)
        ? [...new Set(options.reflectionImageLookupTexts.filter(Boolean))]
        : null;
      if (lookupList?.length) {
        for (const key of lookupList) {
          const cached = await firestoreService.getReflectionImageUrl(user.uid, key);
          if (cached) {
            imageUrl = cached;
            break;
          }
        }
      } else {
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

  // Reserved for flows that defer My Presence until after "Yes, I posted!" (e.g. if a backend pre-created the asset).
  const persistMyPresenceOnly = async ({ plat, caption, imageUrl }) => {
    const user = getCurrentUser();
    const content = (caption || '').trim();
    if (!user?.uid || !content) return;

    await firestoreService.saveSocialShare(user.uid, {
      platform: plat,
      reflectionDate: dateStr,
      reflectionSnippet: content.slice(0, 200) || undefined,
    });

    const profileImage =
      (typeof localStorage !== 'undefined' && localStorage.getItem(`user_profile_picture_${user.uid}`)) || null;

    const postData = {
      author: user.displayName || 'Anonymous',
      authorId: user.uid,
      content,
      createdAt: serverTimestamp(),
      likes: 0,
      comments: [],
      profilePicture: profileImage,
      image: imageUrl || null,
      source: 'social_share',
      sharedPlatform: plat,
      reflectionDate: (() => {
        try {
          const d = typeof dateStr === 'string' ? new Date(dateStr) : reflectionDate;
          return (d || new Date()).toISOString();
        } catch {
          return new Date().toISOString();
        }
      })(),
    };

    await addDoc(collection(db, 'communityPosts'), postData);
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

  const openSharePanel = (text) => {
    sharePanelSessionRef.current += 1;
    preparedShareRef.current = {
      key: '',
      nativeImageUri: null,
      preparedImageDataUrl: null,
      webShareFile: null,
    };
    setSharePanelPrepStatus({ status: 'idle', error: null });
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

  const handleEditWithAi = () => {
    setImageEditMenuOpen(false);
    setAiEditInstruction('');
    setAiEditError('');
    setAiEditImageOpen(true);
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
    setSuggestionImagesFromChat((prev) => {
      const next = [...(prev || [])];
      next[selectedIndex] = false;
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
        // Replaced image is no longer guaranteed to be the original chat image.
        setSuggestionImagesFromChat((prev) => {
          const next = [...(prev || [])];
          next[selectedIndex] = false;
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

  const handleApplyAiEdit = async () => {
    const instr = (aiEditInstruction || '').trim();
    if (!instr) {
      setAiEditError('Describe the change you want.');
      return;
    }
    const raw = suggestionImageUrls[selectedIndex];
    if (!raw || typeof raw !== 'string') return;
    setAiEditLoading(true);
    setAiEditError('');
    try {
      let source = raw;
      if (raw.startsWith('http://') || raw.startsWith('https://')) {
        const data = await getImageAsDataUrl(raw);
        if (!data) {
          throw new Error('Could not load this image URL. Try “Replace photo” with a file from your device, then edit with AI.');
        }
        source = data;
      }
      const out = await chatService.editImageWithInstruction(instr, source);
      if (!out) {
        throw new Error(
          'No image returned. Image generation may require server-side support. Ensure REACT_APP_BACKEND_URL (preferred) or REACT_APP_VERTEX_BACKEND_URL / REACT_APP_VERTEX_GEMINI_URL points at your backend, or try again later.'
        );
      }
      setSuggestionImageUrls((prev) => {
        const next = [...(prev || [])];
        next[selectedIndex] = out;
        return next;
      });
      setSuggestionImagesFromChat((prev) => {
        const next = [...(prev || [])];
        next[selectedIndex] = false;
        return next;
      });
      setAiEditImageOpen(false);
      setAiEditInstruction('');
    } catch (e) {
      setAiEditError(e?.message || 'Edit failed');
    } finally {
      setAiEditLoading(false);
    }
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

      await Filesystem.writeFile({
        path,
        data: base64Data,
        directory: Directory.Cache,
        recursive: false,
      });

      // Android Share expects a real URI (file:// or content://). getUri normalizes this.
      const uriResult = await Filesystem.getUri({ directory: Directory.Cache, path });
      const uri = uriResult?.uri || null;
      return uri;
    } catch (e) {
      return null;
    }
  };

  // While "Edit before sharing" is open, build compressed image + native cache URI / web File so Share opens instantly.
  useEffect(() => {
    if (!sharePanelOpen) return;

    const sessionAtStart = sharePanelSessionRef.current;
    let cancelled = false;

    const run = async () => {
      const raw = suggestionImageUrls[selectedIndex];
      if (!raw || typeof raw !== 'string') {
        if (!cancelled && sharePanelSessionRef.current === sessionAtStart) {
          preparedShareRef.current = {
            key: getSharePrepKey(),
            nativeImageUri: null,
            preparedImageDataUrl: null,
            webShareFile: null,
          };
          setSharePanelPrepStatus({ status: 'ready', error: null });
        }
        return;
      }

      setSharePanelPrepStatus({ status: 'preparing', error: null });

      await new Promise((r) => setTimeout(r, 400));
      if (cancelled || sharePanelSessionRef.current !== sessionAtStart) return;

      const targetKey = getSharePrepKey();

      try {
        let imageDataUrl = null;

        if (selectedPlatform === 'x') {
          if (!xExportImageDataUrl) {
            if (!cancelled && sharePanelSessionRef.current === sessionAtStart) {
              setSharePanelPrepStatus({ status: 'preparing', error: null });
            }
            return;
          }
          let exportNode = tweetCardExportRef.current || tweetCardRef.current;
          let attempts = 0;
          while (!exportNode && attempts < 35 && !cancelled && sharePanelSessionRef.current === sessionAtStart) {
            await new Promise((r) => setTimeout(r, 100));
            exportNode = tweetCardExportRef.current || tweetCardRef.current;
            attempts += 1;
          }
          if (!exportNode) {
            if (!cancelled && sharePanelSessionRef.current === sessionAtStart) {
              setSharePanelPrepStatus({
                status: 'error',
                error: 'Share preview not ready. You can still share — it may take a moment.',
              });
            }
            return;
          }
          const exportRect = exportNode.getBoundingClientRect?.();
          const exportWidth = exportRect?.width ? Math.round(exportRect.width) : 360;
          const exportHeight = exportRect?.height
            ? Math.round(exportRect.height)
            : Math.round((exportWidth * 10) / 7);
          imageDataUrl = await toPng(exportNode, {
            width: exportWidth,
            height: exportHeight,
            pixelRatio: 2,
            skipFonts: false,
            cacheBust: true,
          });
        } else {
          if (raw.startsWith('data:image')) {
            imageDataUrl = raw;
          } else if (raw.startsWith('blob:')) {
            imageDataUrl = await blobUrlToDataUrl(raw);
          } else if (raw.startsWith('https://') || raw.startsWith('http://')) {
            if (isNative() && CapacitorHttp && typeof CapacitorHttp.get === 'function') {
              try {
                const resp = await CapacitorHttp.get({ url: raw, responseType: 'arraybuffer' });
                const mime = guessMimeFromHeaders(resp?.headers) || 'image/png';
                const base64Bytes = typeof resp?.data === 'string' ? resp.data : null;
                if (base64Bytes) imageDataUrl = `data:${mime};base64,${base64Bytes}`;
              } catch {
                imageDataUrl = null;
              }
            }
            if (!imageDataUrl) {
              imageDataUrl = await getImageAsDataUrl(raw);
            }
          }
        }

        if (cancelled || sharePanelSessionRef.current !== sessionAtStart) return;
        if (getSharePrepKey() !== targetKey) return;

        if (!imageDataUrl || typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image')) {
          throw new Error('Could not prepare image');
        }

        const compressedFile = await compressReflectionImage(imageDataUrl);
        let preparedDataUrl = imageDataUrl;
        if (compressedFile) {
          preparedDataUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () =>
              resolve(typeof reader.result === 'string' ? reader.result : imageDataUrl);
            reader.onerror = () => resolve(imageDataUrl);
            reader.readAsDataURL(compressedFile);
          });
        }

        if (cancelled || sharePanelSessionRef.current !== sessionAtStart) return;
        if (getSharePrepKey() !== targetKey) return;

        let nativeImageUri = null;
        let webShareFile = null;
        if (isNative()) {
          nativeImageUri = await writeImageToCacheFile(preparedDataUrl);
        } else {
          webShareFile = dataURLtoFile(preparedDataUrl, 'share-post.png');
        }

        if (cancelled || sharePanelSessionRef.current !== sessionAtStart) return;
        if (getSharePrepKey() !== targetKey) return;

        preparedShareRef.current = {
          key: targetKey,
          nativeImageUri,
          preparedImageDataUrl: preparedDataUrl,
          webShareFile,
        };
        setSharePanelPrepStatus({ status: 'ready', error: null });
      } catch (e) {
        if (!cancelled && sharePanelSessionRef.current === sessionAtStart) {
          preparedShareRef.current = {
            key: '',
            nativeImageUri: null,
            preparedImageDataUrl: null,
            webShareFile: null,
          };
          setSharePanelPrepStatus({ status: 'error', error: formatShareError(e) });
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [
    sharePanelOpen,
    getSharePrepKey,
    selectedPlatform,
    selectedIndex,
    editableShareText,
    selectedText,
    suggestionImageUrls,
    xExportImageDataUrl,
  ]);

  const handleShareToSelectedPlatform = async () => {
    // Use edited text when in panel; fall back to selected suggestion text when edited is empty
    const t = (sharePanelOpen ? ((editableShareText || '').trim() || selectedText) : selectedText) || '';
    if (!t.trim()) return;

    const rawImage = suggestionImageUrls[selectedIndex] || null;
    const prepKey = getSharePrepKey();
    const prep = preparedShareRef.current;

    // Prefer session-cached compressed image so share sheet skips network re-fetch when possible
    let imageDataUrl = null;
    if (rawImage && typeof rawImage === 'string') {
      if (prep.key === prepKey && prep.preparedImageDataUrl) {
        imageDataUrl = prep.preparedImageDataUrl;
      } else if (rawImage.startsWith('data:image')) {
        imageDataUrl = rawImage;
      } else {
        imageDataUrl = await getImageAsDataUrl(rawImage);
      }
    }
    const isDataUrl =
      imageDataUrl && typeof imageDataUrl === 'string' && imageDataUrl.startsWith('data:image');

    try {
      // LinkedIn: use the same native / web share sheet as other platforms (no backend API — faster UX).

      // 1) Native share via Capacitor – open phone share menu (text only or text + image)
      if (isNative()) {
        const hasAnyImage = !!(rawImage && typeof rawImage === 'string');

        // Pre-built file from background prep (instant share sheet)
        if (hasAnyImage && prep.key === prepKey && prep.nativeImageUri && isDataUrl) {
          try {
            let copied = false;
            const safeText = (t || '').trim();
            if (safeText) {
              try {
                await Clipboard.write({ string: safeText });
                copied = true;
              } catch {
                copied = false;
              }
            }
            if (copied) {
              setShareErrorToastMessage('Caption copied. Paste it after sharing.');
              setShareErrorToast(true);
              setTimeout(() => setShareErrorToast(false), 2500);
            }
            await Share.share({
              url: prep.nativeImageUri,
              title: 'Share image',
              dialogTitle: 'Share',
            });
            const imageForStorage = prep.preparedImageDataUrl || imageDataUrl || rawImage || null;
            setPendingMyPresenceShare({
              plat: selectedPlatform || 'other',
              caption: t,
              imageDataUrlForStorage: imageForStorage,
              skipCompression: suggestionImagesFromChat[selectedIndex],
            });
            triggerPostShareConfirmation();
            setSharePanelOpen(false);
            return;
          } catch (e) {
            // fall through to legacy path
          }
        }

        // If we have an HTTPS image but couldn't convert to data URL (CORS), download natively and share the file.
        if (!isDataUrl && rawImage && typeof rawImage === 'string' && (rawImage.startsWith('https://') || rawImage.startsWith('http://'))) {
          try {
            const safeText = (t || '').trim();
            if (safeText) {
              await Clipboard.write({ string: safeText });
              setShareErrorToastMessage('Caption copied. Paste it after sharing.');
              setShareErrorToast(true);
              setTimeout(() => setShareErrorToast(false), 2500);
            }

            if (prep.key === prepKey && prep.nativeImageUri) {
              await Share.share({
                url: prep.nativeImageUri,
                title: 'Share image',
                dialogTitle: 'Share',
              });
              const imageForStorage = prep.preparedImageDataUrl || rawImage || null;
              setPendingMyPresenceShare({
                plat: selectedPlatform || 'other',
                caption: t,
                imageDataUrlForStorage: imageForStorage,
                skipCompression: suggestionImagesFromChat[selectedIndex],
              });
              triggerPostShareConfirmation();
              setSharePanelOpen(false);
              return;
            }

            let fileUri = null;
            // Filesystem.downloadFile can throw "Unsupported url" on some builds.
            // Use CapacitorHttp (native) to fetch bytes and then write to cache.
            if (CapacitorHttp && typeof CapacitorHttp.get === 'function') {
              const resp = await CapacitorHttp.get({ url: rawImage, responseType: 'arraybuffer' });
              const mime = guessMimeFromHeaders(resp?.headers) || 'image/png';
              const base64Bytes = typeof resp?.data === 'string' ? resp.data : null;
              if (base64Bytes) {
                const dataUrl = `data:${mime};base64,${base64Bytes}`;
                fileUri = await writeImageToCacheFile(dataUrl);
              }
            }
            if (!fileUri) {
              // Fallback: try to fetch as blob (may still fail on CORS) then write as base64
              const maybeDataUrl = await getImageAsDataUrl(rawImage);
              if (maybeDataUrl && typeof maybeDataUrl === 'string' && maybeDataUrl.startsWith('data:image')) {
                fileUri = await writeImageToCacheFile(maybeDataUrl);
              }
            }

            // (debug toast removed)

            if (fileUri) {
              await Share.share({
                url: fileUri,
                title: 'Share image',
                dialogTitle: 'Share',
              });
              const imageForStorage = imageDataUrl || rawImage || null;
              // Defer "My Presence" persistence until user confirms.
              setPendingMyPresenceShare({
                plat: selectedPlatform || 'other',
                  caption: t,
                  imageDataUrlForStorage: imageForStorage,
                  skipCompression: suggestionImagesFromChat[selectedIndex],
              });
              triggerPostShareConfirmation();
              setSharePanelOpen(false);
              return;
            }
            // We had an image but couldn't obtain a shareable URI — do NOT fall back to text-only share.
            setShareErrorToastMessage('Could not attach image to share. Please try again.');
            setShareErrorToast(true);
            setTimeout(() => setShareErrorToast(false), 4000);
            return;
          } catch (e) {
            // (debug toast removed)
            if (hasAnyImage) {
              setShareErrorToastMessage('Could not attach image to share. Please try again.');
              setShareErrorToast(true);
              setTimeout(() => setShareErrorToast(false), 4000);
              return;
            }
          }
        }

        // Requirement: share ONLY the image; copy text to clipboard (do not include in share payload)
        if (isDataUrl) {
          const { shared, copied, fileUri, error } = await shareImageOnlyAndCopyText(imageDataUrl, t);
          if (copied) {
            setShareErrorToastMessage('Caption copied. Paste it after sharing.');
            setShareErrorToast(true);
            setTimeout(() => setShareErrorToast(false), 2500);
          }
          if (shared) {
            const imageForStorage = imageDataUrl || rawImage || null;
            // Defer "My Presence" persistence until user confirms.
            setPendingMyPresenceShare({
              plat: selectedPlatform || 'other',
                    caption: t,
                    imageDataUrlForStorage: imageForStorage,
                    skipCompression: suggestionImagesFromChat[selectedIndex],
            });
            triggerPostShareConfirmation();
            setSharePanelOpen(false);
            return;
          }
          // Image share failed — do NOT fall back to text-only if we have an image.
          setShareErrorToastMessage('Could not attach image to share. Please try again.');
          setShareErrorToast(true);
          setTimeout(() => setShareErrorToast(false), 4000);
          return;
        }

        // If we have an image but couldn't prepare it, stop here instead of sharing text-only.
        if (hasAnyImage) {
          setShareErrorToastMessage('Image is not ready to share yet. Please wait a moment and try again.');
          setShareErrorToast(true);
          setTimeout(() => setShareErrorToast(false), 4000);
          return;
        }

        const options = {
          text: t,
          title: 'Share reflection',
          dialogTitle: 'Share',
        };

        try {
          await Share.share(options);
        } catch (e) {
          const msg = (e && (e.message || String(e))) ? (e.message || String(e)) : 'unknown';
          setShareErrorToastMessage(`Native Share failed: ${msg}`);
          setShareErrorToast(true);
          setTimeout(() => setShareErrorToast(false), 6000);
          throw e;
        }
        const imageForStorage = imageDataUrl || rawImage || null;
        // Defer "My Presence" persistence until user confirms.
        setPendingMyPresenceShare({
          plat: selectedPlatform || 'other',
          caption: t,
          imageDataUrlForStorage: imageForStorage,
          skipCompression: suggestionImagesFromChat[selectedIndex],
        });
        triggerPostShareConfirmation();
        setSharePanelOpen(false);
        return;
      }

      // 2) Web Share API (PWA / mobile browser) – share text, and image when supported
      if (typeof navigator !== 'undefined' && navigator.share) {
        if (
          rawImage &&
          prep.key === prepKey &&
          prep.webShareFile &&
          navigator.canShare &&
          navigator.canShare({ text: t, files: [prep.webShareFile] })
        ) {
          await navigator.share({ text: t, files: [prep.webShareFile] });
          const imageForStorage = prep.preparedImageDataUrl || imageDataUrl || rawImage || null;
          setPendingMyPresenceShare({
            plat: selectedPlatform || 'other',
            caption: t,
            imageDataUrlForStorage: imageForStorage,
            skipCompression: suggestionImagesFromChat[selectedIndex],
          });
          triggerPostShareConfirmation();
          setSharePanelOpen(false);
          return;
        }

        const shareOptions = { text: t };
        if (isDataUrl && navigator.canShare) {
          const file = dataURLtoFile(imageDataUrl);
          if (file && navigator.canShare({ text: t, files: [file] })) {
            shareOptions.files = [file];
          }
        }
        await navigator.share(shareOptions);
        const imageForStorage = imageDataUrl || rawImage || null;
        // Defer "My Presence" persistence until user confirms.
        setPendingMyPresenceShare({
          plat: selectedPlatform || 'other',
          caption: t,
          imageDataUrlForStorage: imageForStorage,
          skipCompression: suggestionImagesFromChat[selectedIndex],
        });
        triggerPostShareConfirmation();
        setSharePanelOpen(false);
        return;
      }

      // 3) Fallback: download image (if present) and copy text to clipboard
      if (isDataUrl) {
        try {
          const a = document.createElement('a');
          a.href = imageDataUrl;
          a.download = 'post-image.png';
          a.click();
        } catch {
          // ignore download errors
        }
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(t);
        } catch {
          // ignore clipboard failures
        }
      }
      const imageForStorage = imageDataUrl || rawImage || null;
      // Defer "My Presence" persistence until user confirms.
      setPendingMyPresenceShare({
        plat: selectedPlatform || 'other',
        caption: t,
        imageDataUrlForStorage: imageForStorage,
        skipCompression: suggestionImagesFromChat[selectedIndex],
      });
      triggerPostShareConfirmation();
      setSharePanelOpen(false);
      setShareErrorToastMessage(isDataUrl ? 'Text copied. Image downloaded.' : 'Text copied to clipboard.');
      setShareErrorToast(true);
      setTimeout(() => setShareErrorToast(false), 3000);
    } catch (err) {
      console.error('Share failed:', err);
      const msg = (err && (err.message || String(err))) ? (err.message || String(err)) : 'unknown';
      setShareErrorToastMessage(`Share failed: ${msg}`);
      setShareErrorToast(true);
      setTimeout(() => setShareErrorToast(false), 4000);
    }
  };

  if (!reflectionFromState && !isNewsShareMode) {
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
    'Detea User';
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
        <div className="fixed inset-x-0 bottom-6 flex justify-center pointer-events-none z-[9999]">
          <div
            className="px-4 py-2 rounded-full shadow-md text-sm pointer-events-auto max-w-[90vw] text-center"
            style={{
              background: isDarkMode ? 'rgba(15,23,42,0.95)' : 'rgba(17,24,39,0.95)',
              color: '#FFFFFF',
            }}
          >
            {linkedInToastMessage === 'connect'
              ? '🔗 Connect LinkedIn first — opening sign-in…'
              : linkedInToastMessage === 'success'
              ? '✅ Successfully posted to LinkedIn!'
              : linkedInToastMessage === 'error'
              ? (linkedInErrorText || 'LinkedIn share failed.')
              : '📋 Caption copied! Paste it in LinkedIn'}
          </div>
        </div>
      )}
      {/* Share failed toast */}
      {shareErrorToast && (
        <div className="fixed inset-x-0 bottom-6 flex justify-center pointer-events-none z-[9999]">
          <div
            className="px-4 py-2 rounded-full shadow-md text-sm pointer-events-auto"
            style={{
              background: isDarkMode ? 'rgba(15,23,42,0.95)' : 'rgba(17,24,39,0.95)',
              color: '#FFFFFF',
            }}
          >
            {shareErrorToastMessage || 'Share cancelled or unavailable.'}
          </div>
        </div>
      )}
      {/* X share sheet toast */}
      {xShareToastVisible && (
        <div className="fixed inset-x-0 bottom-6 flex justify-center pointer-events-none z-[9999]">
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
        <div className="fixed inset-x-0 bottom-20 flex justify-center pointer-events-none z-[9999]">
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
            <div className="flex gap-2 justify-end flex-wrap">
              <button
                type="button"
                className="text-xs sm:text-sm px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 transition-colors"
                onClick={() => {
                  // User has not posted yet – just close the confirmation and keep everything as-is
                  setShareConfirmation({ open: false, index: null, platform: null });
                  setPendingMyPresenceShare(null);
                }}
              >
                No, I have not posted
              </button>
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
                  setPendingMyPresenceShare(null);
                }}
              >
                Oops, try again
              </button>
              <button
                type="button"
                className="text-xs sm:text-sm px-3 py-1.5 rounded-full bg-white text-gray-900 font-medium hover:bg-gray-100 transition-colors"
                onClick={() => {
                  const idx = shareConfirmation.index ?? 0;
                  const itemAtIdx = platformSuggestions[idx];
                  const suggestionPostText =
                    typeof itemAtIdx === 'object' && itemAtIdx?.post != null
                      ? itemAtIdx.post
                      : String(itemAtIdx || '');
                  const confirmedCaption = (pendingMyPresenceShare?.caption || '').trim();
                  const finalCaption =
                    confirmedCaption || normSuggestionPost(suggestionPostText);

                  const pending = pendingMyPresenceShare;
                  const platFromConfirm = shareConfirmation.platform || selectedPlatform;
                  const suggestionImageSnapshot = suggestionImageUrls[idx] ?? null;
                  const reflectionImageLookupTexts = [
                    normSuggestionPost(suggestionPostText),
                    normSuggestionPost(finalCaption),
                    normSuggestionPost(confirmedCaption),
                  ].filter(Boolean);

                  // Close UI and update lists immediately; persistence runs in background (no await on click).
                  setShareConfirmation({ open: false, index: null, platform: null });
                  setPendingMyPresenceShare(null);

                  if (pending?.plat && pending?.caption) {
                    const persistPromise =
                      pending.mode === 'myPresenceOnly'
                        ? persistMyPresenceOnly({
                            plat: pending.plat,
                            caption: pending.caption,
                            imageUrl: pending.imageUrl || null,
                          })
                        : recordShare(pending.plat, pending.caption, {
                            imageDataUrlForStorage: pending.imageDataUrlForStorage,
                            skipCompression: pending.skipCompression,
                            suggestionImageUrlSnapshot: suggestionImageSnapshot,
                            reflectionImageLookupTexts,
                          });

                    void persistPromise.catch((e) => {
                      console.error('Failed to persist My Presence after confirmation:', e);
                      setShareErrorToastMessage(
                        `Could not post to My Presence: ${e?.message ? String(e.message) : 'Unknown error'}`
                      );
                      setShareErrorToast(true);
                      setTimeout(() => setShareErrorToast(false), 4500);
                    });
                  }

                  // Remember shared posts across refresh; cleared when reflection text changes (new Detea chat).
                  const userPosted = getCurrentUser();
                  const platKey = platFromConfirm;
                  const postedKey = sharePostedLocalKey(userPosted?.uid, dateStr, platKey);
                  appendPostedTextsForShare(
                    postedKey,
                    suggestionPromptText,
                    [suggestionPostText, confirmedCaption, finalCaption].filter(Boolean),
                    { original: suggestionPostText, final: finalCaption }
                  );

                  setPlatformSuggestions((prev) => {
                    if (!prev || idx < 0 || idx >= prev.length) return prev;
                    const next = [...prev];
                    const [item] = next.splice(idx, 1);
                    const normalized =
                      typeof item === 'object'
                        ? { ...item, post: finalCaption, posted: true }
                        : { eventLabel: eventLabelDefault, post: finalCaption, posted: true };
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
              ref={tweetCardExportRef}
              width={360} // match "edit before sharing" preview card width
              displayName={tweetDisplayName}
              username={tweetUsername}
              text={sharePanelOpen ? ((editableShareText || '').trim() || selectedText || baselineShareText) : (selectedText || baselineShareText)}
              imageUrl={xExportImageDataUrl || null}
              profileImageUrl={
                xExportProfileImageDataUrl ||
                (typeof tweetProfileImage === 'string' && tweetProfileImage.startsWith('data:image') ? tweetProfileImage : null)
              }
            />
          </div>
        )}

        <div className="flex items-center gap-3 pt-2 pb-4">
          <button
            type="button"
            onClick={() => navigate(shareReturnTo)}
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
          <p
            className="text-sm font-medium"
            style={{ color: isNewsShareMode ? (isDarkMode ? HUB.accentHighlight : '#7C3AED') : isDarkMode ? HUB.textSecondary : '#666' }}
          >
            {isNewsShareMode ? 'News' : 'Your reflection'}
          </p>
          {isNewsShareMode ? (
            <>
              <a
                href={effectiveNewsArticle?.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[15px] font-semibold leading-snug mt-2 block hover:underline"
                style={{ color: isDarkMode ? HUB.text : '#1A1A1A' }}
              >
                {effectiveNewsArticle?.title}
              </a>
              {effectiveNewsCardText ? (
                <p className="text-[15px] leading-relaxed mt-2" style={{ color: isDarkMode ? HUB.text : '#1A1A1A' }}>
                  {effectiveNewsCardText}
                </p>
              ) : isLoadingNewsDetails ? (
                <p className="text-[15px] leading-relaxed mt-2" style={{ color: isDarkMode ? HUB.textSecondary : '#666' }}>
                  Loading full article text and generating a 60–80 word summary…
                </p>
              ) : (
                <p className="text-[15px] leading-relaxed mt-2" style={{ color: isDarkMode ? HUB.textSecondary : '#666' }}>
                  We couldn&apos;t pull enough article text from this link to summarize it here. Tap the headline to read the full story on the publisher site.
                </p>
              )}
            </>
          ) : (
            <p className="text-[15px] leading-relaxed mt-1" style={{ color: isDarkMode ? HUB.text : '#1A1A1A' }}>
              {reflectionFromState}
            </p>
          )}
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
            <img src={xLogoImg} alt="X" className="object-contain" style={{ width: '45px', height: '45px' }} />
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
            <img src={redditLogoImg} alt="Reddit" className="object-contain" style={{ width: '45px', height: '45px' }} />
          </button>
        </div>

        {selectedPlatform && (
          <>
            <p className="text-sm font-medium mb-3" style={{ color: isDarkMode ? HUB.text : '#1A1A1A' }}>
              Choose a post to share
            </p>
            {platformSuggestions.length > 0 && !isLoadingSuggestions ? (
              <p className="text-xs mb-2" style={{ color: isDarkMode ? HUB.textSecondary : '#666' }}>
                Showing all {platformSuggestions.length} post{platformSuggestions.length !== 1 ? 's' : ''}{' '}
                {isNewsShareMode ? 'based on this story' : 'for events from your day'}
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
                    {isNewsShareMode ? 'Using article text after' : 'Using reflection after'}: {suggestionError}
                  </p>
                )}
              </div>
            ) : (
              suggestionError ? (
                <p className="text-xs mb-8" style={{ color: isDarkMode ? HUB.textSecondary : '#888' }}>
                  {isNewsShareMode ? 'Using article text after' : 'Using reflection after'}: {suggestionError}
                </p>
              ) : null
            )}
          </>
        )}

        {sharePanelOpen && (
          <>
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
                            className="mt-1 py-1 rounded-lg shadow-xl border min-w-[176px]"
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
                              onClick={handleEditWithAi}
                              className="w-full text-left px-4 py-2.5 text-sm hover:opacity-90 border-t"
                              style={{
                                color: isDarkMode ? HUB.accentHighlight : '#7C3AED',
                                borderColor: isDarkMode ? HUB.divider : 'rgba(0,0,0,0.08)',
                              }}
                            >
                              Edit with AI
                            </button>
                            <button
                              type="button"
                              onClick={handleRemoveImage}
                              className="w-full text-left px-4 py-2.5 text-sm hover:opacity-90 border-t"
                              style={{
                                color: isDarkMode ? HUB.text : '#1A1A1A',
                                borderColor: isDarkMode ? HUB.divider : 'rgba(0,0,0,0.08)',
                              }}
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
                        This image will be shared with your post. Tap the pencil to replace it, remove it, or edit it with AI when your app backend supports it.
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
                    (selectedPlatform === 'x' || selectedPlatform === 'reddit') && suggestionImageUrls[selectedIndex]
                      ? handleShareImageToXOrReddit
                      : handleShareToSelectedPlatform
                  }
                  disabled={
                    !selectedPlatform ||
                    (
                      // X with image: allow image-only sharing even when text is empty
                      !(selectedPlatform === 'x' && !!suggestionImageUrls[selectedIndex]) &&
                      (!(editableShareText || '').trim() && !(selectedText || '').trim())
                    ) ||
                    (
                      sharePanelOpen &&
                      !!suggestionImageUrls[selectedIndex] &&
                      (selectedPlatform === 'x' || selectedPlatform === 'reddit') &&
                      sharePanelPrepStatus.status === 'preparing'
                    )
                  }
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
                    ? sharePanelOpen &&
                      !!suggestionImageUrls[selectedIndex] &&
                      (selectedPlatform === 'x' || selectedPlatform === 'reddit') &&
                      sharePanelPrepStatus.status === 'preparing'
                      ? 'Preparing…'
                      : 'Share'
                    : 'Select a platform above'}
                </button>
              </div>
            </div>
          </div>
          {aiEditImageOpen ? (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center p-4"
              style={{ background: 'rgba(0,0,0,0.72)' }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="ai-edit-image-title"
              onClick={() => {
                if (!aiEditLoading) setAiEditImageOpen(false);
              }}
            >
              <div
                className="w-full max-w-md rounded-2xl border p-4 shadow-2xl"
                style={{
                  background: isDarkMode ? HUB.bgSecondary : '#FFFFFF',
                  borderColor: isDarkMode ? HUB.divider : 'rgba(0,0,0,0.1)',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <h3
                  id="ai-edit-image-title"
                  className="text-base font-semibold mb-1"
                  style={{ color: isDarkMode ? HUB.text : '#111' }}
                >
                  Edit with AI
                </h3>
                <p className="text-xs mb-3" style={{ color: isDarkMode ? HUB.textSecondary : '#666' }}>
                  Describe how you want the image changed (e.g. &quot;warmer lighting&quot;, &quot;crop to the person&quot;, &quot;more contrast&quot;). Requires multimodal support on your Vertex backend; set{' '}
                  <code className="text-[11px]">REACT_APP_VERTEX_GEMINI_URL</code>.
                </p>
                <textarea
                  value={aiEditInstruction}
                  onChange={(e) => setAiEditInstruction(e.target.value)}
                  placeholder="What should change?"
                  rows={3}
                  disabled={aiEditLoading}
                  className="w-full rounded-xl p-3 text-sm resize-none border outline-none focus:ring-2 mb-2"
                  style={{
                    background: isDarkMode ? HUB.bg : '#F5F5F5',
                    borderColor: isDarkMode ? HUB.divider : 'rgba(0,0,0,0.12)',
                    color: isDarkMode ? HUB.text : '#1A1A1A',
                  }}
                />
                {aiEditError ? (
                  <p className="text-xs mb-2" style={{ color: '#f87171' }}>
                    {aiEditError}
                  </p>
                ) : null}
                <div className="flex gap-2 justify-end mt-2">
                  <button
                    type="button"
                    disabled={aiEditLoading}
                    onClick={() => {
                      if (!aiEditLoading) {
                        setAiEditImageOpen(false);
                        setAiEditError('');
                      }
                    }}
                    className="px-4 py-2 rounded-xl text-sm font-medium transition-opacity disabled:opacity-50"
                    style={{
                      background: isDarkMode ? HUB.divider : '#E5E7EB',
                      color: isDarkMode ? HUB.text : '#111',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={aiEditLoading || !(aiEditInstruction || '').trim()}
                    onClick={handleApplyAiEdit}
                    className="px-4 py-2 rounded-xl text-sm font-medium transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: HUB.accent, color: '#FFF' }}
                  >
                    {aiEditLoading ? 'Working…' : 'Apply'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          </>
        )}
      </div>
    </div>
  );
}
