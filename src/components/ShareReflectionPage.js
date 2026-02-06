import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { User, Pencil, Share2, ArrowLeft, Sparkles, Image as ImageIcon, FileText } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { getCurrentUser } from '../services/authService';
import firestoreService from '../services/firestoreService';
import chatService from '../services/chatService';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/config';

export default function ShareReflectionPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isDarkMode } = useTheme();
  const state = location.state || {};

  const reflectionFromState = state.reflection ?? state.reflectionToShare?.reflection ?? '';
  const initialText = (typeof reflectionFromState === 'string' ? reflectionFromState : '').trim();
  const fromReflections = !!state.reflectionToShare;

  const [sharePreviewText, setSharePreviewText] = useState(initialText);
  const [shareEditMode, setShareEditMode] = useState(false);
  const [isSharingPost, setIsSharingPost] = useState(false);
  const [profilePicture, setProfilePicture] = useState(null);
  const [showAiEditModal, setShowAiEditModal] = useState(false);
  const [aiEditInstruction, setAiEditInstruction] = useState('');
  const [isAiEditing, setIsAiEditing] = useState(false);
  const [shareAs, setShareAs] = useState('text'); // 'text' | 'image'
  const [isCapturingImage, setIsCapturingImage] = useState(false);
  const cardRef = useRef(null);
  const tweetStyleCardRef = useRef(null);

  useEffect(() => {
    if (!initialText) {
      navigate(state.from === 'reflections' ? '/reflections' : '/dashboard', { replace: true });
      return;
    }
    setSharePreviewText(initialText);
  }, [initialText, navigate, state.from]);

  useEffect(() => {
    const loadProfilePicture = async () => {
      const user = getCurrentUser();
      if (!user?.uid) return;
      try {
        const url = await firestoreService.getProfilePictureUrl(user.uid);
        setProfilePicture(url);
      } catch (e) {
        // ignore
      }
    };
    loadProfilePicture();
  }, []);

  const getReflectionDate = () => {
    if (state.selectedDate) {
      const d = state.selectedDate;
      return d instanceof Date ? d : new Date(d);
    }
    if (state.reflectionToShare) {
      const r = state.reflectionToShare;
      const raw = r.dateObj || r.createdAt || r.date;
      return raw instanceof Date ? raw : new Date(raw);
    }
    return new Date();
  };

  const handleShareToHub = async () => {
    const contentToShare = sharePreviewText.trim();
    const user = getCurrentUser();
    if (!user || !contentToShare) {
      if (!user) alert('Please sign in to share.');
      return;
    }
    setIsSharingPost(true);
    try {
      const reflectionDate = getReflectionDate();
      const postData = {
        author: user.displayName || 'Anonymous',
        authorId: user.uid,
        content: contentToShare,
        createdAt: serverTimestamp(),
        likes: 0,
        comments: [],
        profilePicture: profilePicture || null,
        image: null,
        source: 'day_reflect',
        reflectionDate: reflectionDate instanceof Date ? reflectionDate.toISOString() : new Date(reflectionDate).toISOString(),
      };
      await addDoc(collection(db, 'communityPosts'), postData);
      navigate('/community');
    } catch (err) {
      console.error('Error sharing reflection to HUB:', err);
      alert('Failed to share to HUB. Please try again.');
    } finally {
      setIsSharingPost(false);
    }
  };

  const formatTweetDate = (d) => {
    const date = d instanceof Date ? d : new Date(d);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getHandleFromName = (name) => {
    if (!name) return 'deite';
    return '@' + name.replace(/\s+/g, '').toLowerCase().slice(0, 20);
  };

  const captureCardAsImage = async () => {
    const node = tweetStyleCardRef.current;
    if (!node) {
      alert('Could not capture the card. Please try again.');
      return null;
    }
    try {
      const { toPng } = await import('html-to-image');
      const dataUrl = await toPng(node, {
        backgroundColor: isDarkMode ? '#000000' : '#ffffff',
        pixelRatio: 2,
        cacheBust: true,
      });
      return dataUrl;
    } catch (err) {
      console.error('Image capture failed:', err);
      alert('Could not create image. Try sharing as text instead, or run npm install html-to-image.');
      return null;
    }
  };

  const dataUrlToFile = (dataUrl, filename = 'reflection.png') => {
    const arr = dataUrl.split(',');
    const mime = (arr[0].match(/:(.*?);/) || [])[1] || 'image/png';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    return new File([u8arr], filename, { type: mime });
  };

  const handleShareAsImage = async () => {
    setIsCapturingImage(true);
    try {
      const dataUrl = await captureCardAsImage();
      if (!dataUrl) return;
      const file = dataUrlToFile(dataUrl, 'my-reflection.png');
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({
          title: 'This is what I lived today.',
          files: [file],
        });
      } else {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = 'my-reflection.png';
        a.click();
        alert('Image saved. Share it from your photos or files.');
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Share image failed:', err);
        alert('Sharing failed. You can download the image instead.');
      }
    } finally {
      setIsCapturingImage(false);
    }
  };

  const handleDownloadImage = async () => {
    setIsCapturingImage(true);
    try {
      const dataUrl = await captureCardAsImage();
      if (!dataUrl) return;
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'my-reflection.png';
      a.click();
    } finally {
      setIsCapturingImage(false);
    }
  };

  const handleMainShare = () => {
    if (shareAs === 'image') {
      handleShareAsImage();
    } else {
      handleShareToHub();
    }
  };

  const getSocialShareText = () => sharePreviewText.trim();

  const handleApplyAiEdit = async () => {
    const instruction = (aiEditInstruction || '').trim();
    if (!instruction) {
      alert('Please describe what change to make (e.g. "make it more formal", "fix grammar").');
      return;
    }
    if (!sharePreviewText.trim()) return;
    setIsAiEditing(true);
    try {
      const edited = await chatService.editTextWithAI(sharePreviewText, instruction);
      if (edited) setSharePreviewText(edited);
      setShowAiEditModal(false);
      setAiEditInstruction('');
    } catch (err) {
      console.error('AI edit failed:', err);
      alert(err.message || 'AI edit failed. Check your API key in Chat settings and try again.');
    } finally {
      setIsAiEditing(false);
    }
  };

  const shareToX = () => {
    const text = getSocialShareText();
    if (!text) return;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };

  const shareToWhatsApp = () => {
    const text = getSocialShareText();
    if (!text) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };

  const shareWithNative = async () => {
    const text = getSocialShareText();
    if (!text) return;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'My day reflection', text });
      } catch (err) {
        if (err.name !== 'AbortError') console.error('Native share failed:', err);
      }
    } else {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        alert('Copied to clipboard! Paste it anywhere to share.');
      } else {
        alert('Sharing not supported in this browser. Try X or WhatsApp.');
      }
    }
  };

  const handleMaybeLater = () => {
    if (isSharingPost) return;
    navigate(fromReflections ? '/reflections' : '/dashboard');
  };

  if (!initialText) return null;

  const displayName = getCurrentUser()?.displayName || 'You';
  const handle = getHandleFromName(displayName);
  const tweetDate = formatTweetDate(getReflectionDate());

  return (
    <div
      className="min-h-screen flex flex-col px-4 py-6 pb-10"
      style={{ background: isDarkMode ? '#131313' : '#FAFAF8' }}
    >
      {/* Hidden tweet-style card for image capture only (same UI/structure as reference) */}
      <div
        ref={tweetStyleCardRef}
        style={{
          position: 'fixed',
          left: '-9999px',
          top: 0,
          width: 420,
          background: isDarkMode ? '#000000' : '#ffffff',
          border: `1px solid ${isDarkMode ? '#2f3336' : '#cfd9de'}`,
          borderRadius: 16,
          overflow: 'hidden',
          padding: '12px 16px',
          boxSizing: 'border-box',
        }}
      >
        {/* Header: avatar | name + check + handle · date | dots */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          {profilePicture ? (
            <img
              src={profilePicture}
              alt=""
              style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
            />
          ) : (
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: isDarkMode ? '#333639' : '#e7e9ea',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <User
                style={{ width: 20, height: 20, color: isDarkMode ? '#71767b' : '#536471' }}
                strokeWidth={2}
              />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, color: isDarkMode ? '#e7e9ea' : '#0f1419', fontSize: 15 }}>
                {displayName}
              </span>
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: '#1d9bf0',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width={10} height={10} viewBox="0 0 24 24" stroke="white" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              </span>
              <span style={{ color: isDarkMode ? '#71767b' : '#536471', fontSize: 15 }}>
                {handle} · {tweetDate}
              </span>
            </div>
          </div>
          <div style={{ color: isDarkMode ? '#71767b' : '#536471', padding: '4px 0 0 0' }}>
            <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 12c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2zm9 2c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm7 0c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z" />
            </svg>
          </div>
        </div>
        {/* Content */}
        <div
          style={{
            color: isDarkMode ? '#e7e9ea' : '#0f1419',
            fontSize: 15,
            lineHeight: 1.35,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            marginBottom: 12,
          }}
        >
          {sharePreviewText}
        </div>
        {/* Interaction bar: comment, retweet, like, views, share (Twitter/X style) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            maxWidth: 380,
            color: isDarkMode ? '#71767b' : '#536471',
            fontSize: 13,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor">
              <path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.15 6.138 6.183L8.88 14.15v2.65l5.013-2.78c2.387-1.324 3.965-4.02 3.965-6.94 0-3.31-2.69-6-6.002-6z" />
            </svg>
            0
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor">
              <path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z" />
            </svg>
            0
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            0
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor">
              <path d="M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7.5h2V21h-2z" />
            </svg>
            0
          </span>
          <span style={{ display: 'flex', alignItems: 'center' }}>
            <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 19 3 17.88 3 16.5V15h2v1.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z" />
            </svg>
          </span>
        </div>
      </div>

      <div className="max-w-md w-full mx-auto flex flex-col flex-1">
        {/* Back + Header */}
        <div className="flex items-center gap-3 pt-2 pb-4">
          <button
            type="button"
            onClick={handleMaybeLater}
            className={`p-2 -ml-2 rounded-full transition-opacity hover:opacity-90 ${isDarkMode ? 'text-gray-400 hover:bg-white/5' : 'text-gray-500 hover:bg-black/5'}`}
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" strokeWidth={2} />
          </button>
          <p className={`text-lg font-medium ${isDarkMode ? 'text-[#7DD3C0]' : 'text-[#87A96B]'}`}>
            This is what you lived today.
          </p>
        </div>

        {/* Card (ref for image capture) */}
        <div
          ref={cardRef}
          className={`rounded-2xl overflow-hidden flex-1 ${
            isDarkMode ? 'bg-[#262626]' : 'bg-white'
          }`}
          style={isDarkMode ? {
            border: '1px solid rgba(255, 255, 255, 0.06)',
            boxShadow: '0 4px 24px rgba(0, 0, 0, 0.2)',
          } : {
            border: '1px solid rgba(0, 0, 0, 0.06)',
            boxShadow: '0 4px 24px rgba(0, 0, 0, 0.06)',
          }}
        >
          <div
            className={`rounded-2xl overflow-hidden ${isDarkMode ? 'bg-[#1e1e1e]' : 'bg-gray-50/90'}`}
            style={isDarkMode ? {
              border: '1px solid rgba(255, 255, 255, 0.06)',
              boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.02)',
            } : {
              border: '1px solid rgba(0, 0, 0, 0.04)',
            }}
          >
            <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: isDarkMode ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(0,0,0,0.06)' }}>
              {profilePicture ? (
                <img
                  src={profilePicture}
                  alt="You"
                  className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: isDarkMode ? 'rgba(125, 211, 192, 0.25)' : 'rgba(134, 169, 107, 0.2)' }}
                >
                  <User className={`w-4 h-4 ${isDarkMode ? 'text-[#7DD3C0]' : 'text-[#87A96B]'}`} strokeWidth={2} />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <span className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {getCurrentUser()?.displayName || 'You'}
                </span>
                <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  {' · Just now'}
                </span>
              </div>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => setShareEditMode(true)}
                  className={`p-2 rounded-full transition-opacity hover:opacity-90 ${
                    isDarkMode ? 'text-gray-500 hover:bg-white/5' : 'text-gray-400 hover:bg-black/5'
                  }`}
                  title="Edit text"
                >
                  <Pencil className="w-3.5 h-3.5" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowAiEditModal(true)}
                  className={`p-2 rounded-full transition-opacity hover:opacity-90 ${
                    isDarkMode ? 'text-[#7DD3C0]/90 hover:bg-white/5' : 'text-[#87A96B] hover:bg-black/5'
                  }`}
                  title="Edit with AI (describe the change)"
                >
                  <Sparkles className="w-3.5 h-3.5" strokeWidth={2} />
                </button>
              </div>
            </div>
            <div className="p-5 pt-4">
              {shareEditMode ? (
                <>
                  <textarea
                    value={sharePreviewText}
                    onChange={(e) => setSharePreviewText(e.target.value)}
                    className={`w-full rounded-xl px-4 py-3 text-[15px] leading-relaxed border min-h-[120px] resize-y focus:outline-none focus:ring-2 ${
                      isDarkMode
                        ? 'bg-black/20 text-white border-white/15 focus:ring-[#7DD3C0]/40 placeholder-gray-500'
                        : 'bg-white text-gray-800 border-gray-200/80 focus:ring-[#87A96B]/40 placeholder-gray-400'
                    }`}
                    placeholder="Edit what you'll share..."
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShareEditMode(false)}
                    className={`mt-3 text-sm font-medium ${isDarkMode ? 'text-[#7DD3C0]' : 'text-[#87A96B]'}`}
                  >
                    Done
                  </button>
                </>
              ) : (
                <p className={`text-[15px] leading-[1.6] ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                  {sharePreviewText}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Share as: Text | Image */}
        <div className="mt-6 flex flex-col gap-3">
          <p className={`text-xs font-medium ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            Share as
          </p>
          <div
            className={`flex rounded-xl p-1 w-full ${
              isDarkMode ? 'bg-[#262626] border border-white/10' : 'bg-gray-100 border border-gray-200'
            }`}
          >
            <button
              type="button"
              onClick={() => setShareAs('text')}
              className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 font-medium text-sm transition-all ${
                shareAs === 'text'
                  ? isDarkMode
                    ? 'bg-white/10 text-[#7DD3C0]'
                    : 'bg-white text-gray-800 shadow-sm'
                  : isDarkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <FileText className="w-4 h-4" strokeWidth={2} />
              Text
            </button>
            <button
              type="button"
              onClick={() => setShareAs('image')}
              className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 font-medium text-sm transition-all ${
                shareAs === 'image'
                  ? isDarkMode
                    ? 'bg-white/10 text-[#7DD3C0]'
                    : 'bg-white text-gray-800 shadow-sm'
                  : isDarkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <ImageIcon className="w-4 h-4" strokeWidth={2} />
              Image
            </button>
          </div>

          <button
            type="button"
            onClick={handleMainShare}
            disabled={shareAs === 'text' ? isSharingPost : isCapturingImage}
            className="w-full rounded-2xl py-3.5 font-medium text-[15px] text-white disabled:opacity-50 transition-all hover:opacity-95 active:scale-[0.99]"
            style={{
              background: isDarkMode
                ? 'linear-gradient(135deg, #7DD3C0 0%, #5fb8a8 100%)'
                : 'linear-gradient(135deg, #87A96B 0%, #7a9a5c 100%)',
              boxShadow: isDarkMode ? '0 4px 20px rgba(125, 211, 192, 0.35)' : '0 4px 16px rgba(134, 169, 107, 0.3)',
            }}
          >
            {shareAs === 'text' && (isSharingPost ? 'Sharing…' : 'Share this moment')}
            {shareAs === 'image' && (isCapturingImage ? 'Creating image…' : 'Share this moment')}
          </button>

          {shareAs === 'text' && (
            <div className="flex flex-col gap-2">
              <p className={`text-xs font-medium ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                Share to social
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={shareToX}
                  disabled={!getSocialShareText()}
                  className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 font-medium text-sm transition-all hover:opacity-90 disabled:opacity-50 ${
                    isDarkMode ? 'bg-[#373D3D] text-[#6ADFBB] border border-white/10' : 'bg-gray-100 text-gray-700 border border-gray-200'
                  }`}
                  title="Share on X (Twitter)"
                >
                  <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  X
                </button>
                <button
                  type="button"
                  onClick={shareToWhatsApp}
                  disabled={!getSocialShareText()}
                  className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 font-medium text-sm transition-all hover:opacity-90 disabled:opacity-50 ${
                    isDarkMode ? 'bg-[#373D3D] text-[#6ADFBB] border border-white/10' : 'bg-gray-100 text-gray-700 border border-gray-200'
                  }`}
                  title="Share on WhatsApp"
                >
                  <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.865 9.865 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                  </svg>
                  WhatsApp
                </button>
                <button
                  type="button"
                  onClick={shareWithNative}
                  disabled={!getSocialShareText()}
                  className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 font-medium text-sm transition-all hover:opacity-90 disabled:opacity-50 ${
                    isDarkMode ? 'bg-[#373D3D] text-[#6ADFBB] border border-white/10' : 'bg-gray-100 text-gray-700 border border-gray-200'
                  }`}
                  title="More apps (share sheet or copy)"
                >
                  <Share2 className="w-4 h-4 flex-shrink-0" strokeWidth={2} />
                  More
                </button>
              </div>
            </div>
          )}

          {shareAs === 'image' && (
            <div className="flex flex-col gap-2">
              <p className={`text-xs font-medium ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                Image options
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleDownloadImage}
                  disabled={isCapturingImage}
                  className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 font-medium text-sm transition-all hover:opacity-90 disabled:opacity-50 ${
                    isDarkMode ? 'bg-[#373D3D] text-[#6ADFBB] border border-white/10' : 'bg-gray-100 text-gray-700 border border-gray-200'
                  }`}
                  title="Download image"
                >
                  <ImageIcon className="w-4 h-4 flex-shrink-0" strokeWidth={2} />
                  Download image
                </button>
                <button
                  type="button"
                  onClick={handleShareAsImage}
                  disabled={isCapturingImage}
                  className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 font-medium text-sm transition-all hover:opacity-90 disabled:opacity-50 ${
                    isDarkMode ? 'bg-[#373D3D] text-[#6ADFBB] border border-white/10' : 'bg-gray-100 text-gray-700 border border-gray-200'
                  }`}
                  title="Share image (native share or save)"
                >
                  <Share2 className="w-4 h-4 flex-shrink-0" strokeWidth={2} />
                  Share image
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleMaybeLater}
            disabled={isSharingPost}
            className={`w-full rounded-2xl py-3 font-medium text-sm disabled:opacity-50 transition-opacity ${
              isDarkMode ? 'text-gray-400 hover:text-gray-300 hover:bg-white/5' : 'text-gray-500 hover:text-gray-700 hover:bg-black/5'
            }`}
          >
            Maybe later
          </button>
        </div>
      </div>

      {/* AI Edit modal – describe change, uses Gemini/Grok/OpenAI */}
      {showAiEditModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
          onClick={() => !isAiEditing && setShowAiEditModal(false)}
        >
          <div
            className={`w-full max-w-sm rounded-2xl p-5 shadow-xl ${
              isDarkMode ? 'bg-[#262626] border border-white/10' : 'bg-white border border-gray-200'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className={`w-5 h-5 flex-shrink-0 ${isDarkMode ? 'text-[#7DD3C0]' : 'text-[#87A96B]'}`} strokeWidth={2} />
              <h3 className={`text-base font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                Edit with AI
              </h3>
            </div>
            <p className={`text-sm mb-3 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Describe the change you want (e.g. &quot;make it more formal&quot;, &quot;fix grammar&quot;, &quot;shorten&quot;). Uses the same AI as Chat (Gemini, Grok, or OpenAI).
            </p>
            <input
              type="text"
              value={aiEditInstruction}
              onChange={(e) => setAiEditInstruction(e.target.value)}
              placeholder="e.g. make it shorter and more positive"
              className={`w-full rounded-xl px-4 py-3 text-[15px] border focus:outline-none focus:ring-2 ${
                isDarkMode
                  ? 'bg-black/20 text-white border-white/15 focus:ring-[#7DD3C0]/40 placeholder-gray-500'
                  : 'bg-gray-50 text-gray-800 border-gray-200 focus:ring-[#87A96B]/40 placeholder-gray-400'
              }`}
              disabled={isAiEditing}
              onKeyDown={(e) => e.key === 'Enter' && handleApplyAiEdit()}
            />
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => !isAiEditing && setShowAiEditModal(false)}
                disabled={isAiEditing}
                className={`flex-1 rounded-xl py-2.5 font-medium text-sm ${
                  isDarkMode ? 'text-gray-400 hover:bg-white/5' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyAiEdit}
                disabled={isAiEditing || !aiEditInstruction.trim()}
                className="flex-1 rounded-xl py-2.5 font-medium text-sm text-white disabled:opacity-50 transition-opacity"
                style={{
                  background: isDarkMode
                    ? 'linear-gradient(135deg, #7DD3C0 0%, #5fb8a8 100%)'
                    : 'linear-gradient(135deg, #87A96B 0%, #7a9a5c 100%)',
                }}
              >
                {isAiEditing ? 'Applying…' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
