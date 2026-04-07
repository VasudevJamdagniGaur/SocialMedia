import React, { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { getCurrentUser, signOutUser } from '../services/authService';
import firestoreService from '../services/firestoreService';
import { updateProfile, deleteUser } from 'firebase/auth';
import { auth } from '../firebase/config';
import Cropper from 'react-easy-crop';
import {
  ArrowLeft,
  User,
  Calendar,
  Mail,
  Edit3,
  Save,
  X,
  Heart,
  Sparkles,
  Star,
  Trash2,
  AlertTriangle,
  LogOut,
  Shield,
  Settings,
  Phone,
  MessageCircle,
  Camera,
  Image as ImageIcon,
  Gift,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Share2,
  Download
} from 'lucide-react';

// Theme matching Dashboard / Community / Pod (HUB)
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

export default function ProfilePage() {
  const navigate = useNavigate();
  const { isDarkMode } = useTheme();
  const [user, setUser] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showFullDeleteConfirm, setShowFullDeleteConfirm] = useState(false);
  const [fullDeleteLoading, setFullDeleteLoading] = useState(false);
  const [profilePicture, setProfilePicture] = useState(null);
  const [pendingPicture, setPendingPicture] = useState(null);
  const [showPicturePreview, setShowPicturePreview] = useState(false);
  const [showCropModal, setShowCropModal] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [isCropping, setIsCropping] = useState(false);
  const [bioLastUpdated, setBioLastUpdated] = useState(null);
  const [isBioUpdating, setIsBioUpdating] = useState(false);
  const [showBirthdayCalendar, setShowBirthdayCalendar] = useState(false);
  const [birthdayDate, setBirthdayDate] = useState(null);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [helpExpanded, setHelpExpanded] = useState(false);
  const [showPhotoPreviewModal, setShowPhotoPreviewModal] = useState(false);
  const [previewImgSize, setPreviewImgSize] = useState({ w: 0, h: 0 });
  const [showPhotoEditMenu, setShowPhotoEditMenu] = useState(false);
  const [showPhotoShareMenu, setShowPhotoShareMenu] = useState(false);
  const fileInputRef = useRef(null);
  
  // Helper function to format date for display
  const formatDateDisplay = (dateString) => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return '';
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    } catch (error) {
      return '';
    }
  };
  
  // Calculate age from birthday
  const calculateAgeFromBirthday = (birthdayString) => {
    if (!birthdayString) return '';
    try {
      const birthDate = new Date(birthdayString);
      if (isNaN(birthDate.getTime())) return '';
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      return age.toString();
    } catch (error) {
      console.error('Error calculating age:', error);
      return '';
    }
  };
  
  // Convert birthday string to Date object
  const getBirthdayDate = () => {
    if (!editData.birthday) return null;
    try {
      const date = new Date(editData.birthday);
      if (isNaN(date.getTime())) return null;
      return date;
    } catch (error) {
      return null;
    }
  };
  const [editData, setEditData] = useState({
    displayName: '',
    age: '',
    gender: '',
    bio: '',
    birthday: ''
  });

  useEffect(() => {
    const currentUser = getCurrentUser();
    if (currentUser) {
      setUser(currentUser);
      const savedBirthday = localStorage.getItem(`user_birthday_${currentUser.uid}`) || '';
      // Calculate age from birthday if available, otherwise use saved age
      const calculatedAge = savedBirthday ? calculateAgeFromBirthday(savedBirthday) : (localStorage.getItem(`user_age_${currentUser.uid}`) || '');
      const savedDisplayName = localStorage.getItem(`user_display_name_${currentUser.uid}`) || currentUser.displayName || '';
      setEditData({
        displayName: savedDisplayName,
        age: calculatedAge,
        gender: localStorage.getItem(`user_gender_${currentUser.uid}`) || '',
        bio: localStorage.getItem(`user_bio_${currentUser.uid}`) || '',
        birthday: savedBirthday
      });
      // Initialize birthdayDate from saved birthday string
      if (savedBirthday) {
        try {
          const date = new Date(savedBirthday);
          if (!isNaN(date.getTime())) {
            setBirthdayDate(date);
          }
        } catch (error) {
          console.error('Error parsing birthday:', error);
        }
      }
      // Load profile picture from Firestore first, then fallback to localStorage
      const loadProfilePicture = async () => {
        try {
          const result = await firestoreService.getUser(currentUser.uid);
          if (result.success && result.data?.profilePicture) {
            const firestorePicture = result.data.profilePicture;
            setProfilePicture(firestorePicture);
            // Also save to localStorage for faster access
            localStorage.setItem(`user_profile_picture_${currentUser.uid}`, firestorePicture);
            console.log('✅ Avatar loaded from Firestore');
          } else {
            // Fallback to localStorage
            const savedPicture = localStorage.getItem(`user_profile_picture_${currentUser.uid}`);
            if (savedPicture) {
              setProfilePicture(savedPicture);
            }
          }
        } catch (error) {
          console.error('Error loading avatar from Firestore:', error);
          // Fallback to localStorage
          const savedPicture = localStorage.getItem(`user_profile_picture_${currentUser.uid}`);
          if (savedPicture) {
            setProfilePicture(savedPicture);
          }
        }
      };
      loadProfilePicture();

      const savedBioUpdated = localStorage.getItem(`user_bio_updated_${currentUser.uid}`);
      if (savedBioUpdated) {
        setBioLastUpdated(savedBioUpdated);
      }
    } else {
      navigate('/signup');
    }
  }, [navigate]);

  useEffect(() => {
    if (!user) return;
    const run = async () => {
      await ensureDailyBioSummary();
    };
    run();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let timer;
    const schedule = () => {
      const now = new Date();
      const nextWindow = getNext2AM();
      const delay = Math.max(nextWindow.getTime() - now.getTime(), 0);
      timer = setTimeout(async () => {
        const summary = await generateAutoBioSummary();
        if (summary) {
          persistBioSummary(summary);
        }
        schedule();
      }, delay);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [user, editData.age, editData.gender]);

  const handleBack = () => {
    navigate('/dashboard');
  };

  const handleSave = async () => {
    if (!user) return;

    setLoading(true);
    try {
      // Update display name in Firebase Auth if it changed
      if (editData.displayName && editData.displayName.trim() !== user.displayName) {
        try {
          const currentUser = auth.currentUser;
          if (currentUser) {
            await updateProfile(currentUser, {
              displayName: editData.displayName.trim()
            });
            // Update local user state
            setUser({ ...user, displayName: editData.displayName.trim() });
            console.log('✅ Display name updated in Firebase Auth');
          }
        } catch (error) {
          console.error('Error updating display name:', error);
          // Continue with other saves even if this fails
        }
      }

      // Always calculate age from birthday if birthday is provided, otherwise use existing age
      let ageToSave = editData.age;
      if (editData.birthday) {
        ageToSave = calculateAgeFromBirthday(editData.birthday);
      }

      // Save to localStorage
      if (editData.displayName) {
        localStorage.setItem(`user_display_name_${user.uid}`, editData.displayName.trim());
      }
      localStorage.setItem(`user_age_${user.uid}`, ageToSave);
      localStorage.setItem(`user_gender_${user.uid}`, editData.gender);
      localStorage.setItem(`user_bio_${user.uid}`, editData.bio);
      if (editData.birthday) {
        localStorage.setItem(`user_birthday_${user.uid}`, editData.birthday);
      }
      
      // Update editData with calculated age
      setEditData(prev => ({ ...prev, age: ageToSave }));
      
      // Save profile picture if it exists
      if (profilePicture) {
        localStorage.setItem(`user_profile_picture_${user.uid}`, profilePicture);
        console.log('✅ Profile picture saved to localStorage');
      } else {
        // If profile picture was removed, clear it from localStorage
        localStorage.removeItem(`user_profile_picture_${user.uid}`);
        console.log('✅ Profile picture removed from localStorage');
      }

      // Update Firestore with display name, profile picture, and other profile data (compress image to stay under 1MB)
      try {
        let pictureForFirestore = profilePicture || null;
        if (profilePicture && profilePicture.startsWith('data:')) {
          try {
            pictureForFirestore = await compressDataUrlForStorage(profilePicture, 800);
          } catch (_) {
            pictureForFirestore = profilePicture;
          }
        }
        await firestoreService.ensureUser(user.uid, {
          displayName: editData.displayName.trim() || user.displayName || 'User',
          email: user.email,
          profilePicture: pictureForFirestore
        });
        console.log('✅ Profile data updated in Firestore');
      } catch (error) {
        console.error('Error updating Firestore:', error);
        // Don't block save if Firestore update fails
      }

      // Trigger a custom event to notify other components (like Dashboard) of the change
      window.dispatchEvent(new Event('profilePictureUpdated'));

      setIsEditing(false);
      alert('Profile saved successfully!');
    } catch (error) {
      console.error('Error updating profile:', error);
      alert('Error updating profile. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    const savedBirthday = localStorage.getItem(`user_birthday_${user?.uid}`) || '';
    const calculatedAge = savedBirthday ? calculateAgeFromBirthday(savedBirthday) : (localStorage.getItem(`user_age_${user?.uid}`) || '');
    const savedDisplayName = localStorage.getItem(`user_display_name_${user?.uid}`) || user?.displayName || '';
    setEditData({
      displayName: savedDisplayName,
      age: calculatedAge,
      gender: localStorage.getItem(`user_gender_${user?.uid}`) || '',
      bio: localStorage.getItem(`user_bio_${user?.uid}`) || '',
      birthday: savedBirthday
    });
    // Reset profile picture to saved version
    const savedPicture = localStorage.getItem(`user_profile_picture_${user?.uid}`);
    setProfilePicture(savedPicture || null);
    if (user) {
      const savedUpdated = localStorage.getItem(`user_bio_updated_${user.uid}`);
      setBioLastUpdated(savedUpdated || null);
    }
    setIsEditing(false);
  };

  const avatars = [
    { name: 'Apple', path: '/apple-avatar.png' },
    { name: 'Pineapple', path: '/pineapple-avatar.png' },
    { name: 'Carrot', path: '/carrot-avatar.png' },
    { name: 'Banana', path: '/banana-avatar.png' },
    { name: 'Strawberry', path: '/strawberry-avatar.png' },
    { name: 'Broccoli', path: '/broccoli-avatar.png' },
  ];

  const handleAvatarSelect = async (avatarPath) => {
    setProfilePicture(avatarPath);
    if (user) {
      // Save to localStorage for immediate use
      localStorage.setItem(`user_profile_picture_${user.uid}`, avatarPath);
      
      // Save to Firestore for persistence across devices
      try {
        await firestoreService.ensureUser(user.uid, {
          profilePicture: avatarPath
        });
        console.log('✅ Avatar saved to Firestore');
      } catch (error) {
        console.error('Error saving avatar to Firestore:', error);
        // Continue even if Firestore save fails
      }
      
      window.dispatchEvent(new Event('profilePictureUpdated'));
    }
    setShowAvatarModal(false);
  };

  const handleUploadFromGallery = () => {
    setShowAvatarModal(false);
    // Trigger file input click
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleProfilePictureChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
      }
      
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        alert('Image size should be less than 5MB');
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setPendingPicture(reader.result);
        setShowCropModal(true);
        setShowPicturePreview(false);
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setCroppedAreaPixels(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveProfilePicture = async () => {
    setProfilePicture(null);
    if (user) {
      localStorage.removeItem(`user_profile_picture_${user.uid}`);
      try {
        await firestoreService.ensureUser(user.uid, { profilePicture: null });
      } catch (err) {
        console.error('Error removing profile picture from Firestore:', err);
      }
      window.dispatchEvent(new Event('profilePictureUpdated'));
    }
  };

  const getLast2AM = () => {
    const now = new Date();
    const last2AM = new Date(now);
    last2AM.setHours(2, 0, 0, 0);
    if (now < last2AM) {
      last2AM.setDate(last2AM.getDate() - 1);
    }
    return last2AM;
  };

  const getNext2AM = () => {
    const base = getLast2AM();
    base.setDate(base.getDate() + 1);
    return base;
  };

const TOPIC_CATEGORIES = [
  { name: 'work or studies', keywords: ['work', 'office', 'project', 'deadline', 'study', 'exam', 'college', 'school'] },
  { name: 'relationships', keywords: ['friend', 'family', 'mom', 'dad', 'partner', 'relationship', 'love', 'together'] },
  { name: 'wellbeing', keywords: ['health', 'anxiety', 'stress', 'therapy', 'sleep', 'rest', 'mind', 'wellbeing'] },
  { name: 'self-growth', keywords: ['goal', 'growth', 'improve', 'habit', 'plan', 'learn', 'progress'] },
  { name: 'creativity', keywords: ['music', 'art', 'draw', 'paint', 'write', 'creative', 'photography'] },
  { name: 'career decisions', keywords: ['career', 'job', 'interview', 'opportunity', 'startup'] },
];

const MOOD_KEYWORDS = {
  hopeful: ['hope', 'optimistic', 'excited', 'grateful', 'happy', 'joy'],
  stressed: ['stress', 'worried', 'anxious', 'tired', 'exhausted', 'overwhelmed'],
  reflective: ['thinking', 'reflect', 'ponder', 'journal', 'consider', 'realize'],
  determined: ['determined', 'driven', 'focused', 'ambition', 'goal'],
  overwhelmed: ['too much', 'can\'t handle', 'pressure', 'burnt', 'burned', 'burnout'],
};

  const canUpdateBioSummary = () => {
    // Always allow updates - no time restriction
    return true;
  };

  const generateAutoBioSummary = async () => {
    const firstName = user?.displayName?.split(' ')[0] || 'You';
    const age = editData.age || localStorage.getItem(`user_age_${user?.uid}`) || '';
    const gender = editData.gender || localStorage.getItem(`user_gender_${user?.uid}`) || '';

    let summarySentence = null;
    if (user) {
      const insights = await analyzeUserChatHistory(user.uid);
      let socialHabitSentence = null;
      try {
        const sharesRes = await firestoreService.getSocialSharesByUser(user.uid);
        const shares = sharesRes?.success && Array.isArray(sharesRes.shares) ? sharesRes.shares : [];
        if (shares.length) {
          const byPlatform = {};
          const byDate = {};
          for (const s of shares) {
            const p = (s?.platform || 'other').toLowerCase();
            byPlatform[p] = (byPlatform[p] || 0) + 1;
            const d = (s?.reflectionDate || '').slice(0, 10);
            if (d) byDate[d] = true;
          }
          const ranked = Object.entries(byPlatform).sort((a, b) => b[1] - a[1]);
          const top = ranked.slice(0, 2).map(([p]) => p);
          const totalDaysShared = Object.keys(byDate).length;

          const label = (p) => (
            p === 'x' ? 'X' :
            p === 'linkedin' ? 'LinkedIn' :
            p === 'reddit' ? 'Reddit' :
            p === 'whatsapp' ? 'WhatsApp' :
            p === 'native' ? 'share sheet' :
            p
          );
          const topText = top.length === 2 ? `${label(top[0])} and ${label(top[1])}` : (top[0] ? label(top[0]) : null);
          if (topText) {
            socialHabitSentence =
              totalDaysShared >= 6
                ? `often shares reflections to ${topText} and likes to make your day visible.`
                : `has started sharing reflections to ${topText}, especially on days that feel meaningful.`;
          }
        }
      } catch {
        socialHabitSentence = null;
      }

      if (insights && insights.psychologicalInsights) {
        const psych = insights.psychologicalInsights;
        
        // Build sentences in priority order: emotional nature, overall vibe, thought patterns, coping style, core motivations, relationship style
        const orderedSentences = [
          psych.emotionalNature ? `${firstName} ${psych.emotionalNature}.` : null,
          psych.overallVibe ? `${firstName} ${psych.overallVibe}.` : null,
          psych.thoughtPatterns ? `${firstName} ${psych.thoughtPatterns}.` : null,
          psych.copingStyle ? `${firstName} ${psych.copingStyle}.` : null,
          psych.coreMotivations ? `${firstName} ${psych.coreMotivations}.` : null,
          psych.relationshipStyle ? `${firstName} ${psych.relationshipStyle}.` : null,
          socialHabitSentence ? `${firstName} ${socialHabitSentence}` : null,
          (Array.isArray(insights.topTopics) && insights.topTopics.length)
            ? `${firstName} tends to reflect most on ${insights.topTopics.slice(0, 2).join(' and ')}.`
            : null
        ].filter(Boolean);

        // Select top 2-3 most relevant insights
        if (orderedSentences.length > 0) {
          const selectedSentences = orderedSentences.slice(0, Math.min(5, orderedSentences.length));
          summarySentence = selectedSentences.join(' ');
        }
      }
    }

    if (summarySentence) {
      return summarySentence;
    }

    // Fallback if no insights available
    const moods = [
      'feel calm and reflective today',
      'are focused on steady growth',
      'are hopeful and optimistic',
      'are taking things one step at a time',
      'are balancing ambition with self-care',
      'are thoughtful and kind in your interactions',
      'bring grounded energy into conversations',
      'are ready to explore new ideas gently',
    ];
    const toneIndex = new Date().getDate() % moods.length;
    const tone = moods[toneIndex];
    const agePart = age ? `At ${age}, ` : '';
    const genderPart = gender ? `${gender} ` : '';
    return `${agePart}${firstName} (${genderPart.trim() || 'they'}) ${tone}.`;
  };

  const persistBioSummary = (summary) => {
    if (!user) return;
    const timestamp = new Date().toISOString();
    localStorage.setItem(`user_bio_${user.uid}`, summary);
    localStorage.setItem(`user_bio_updated_${user.uid}`, timestamp);
    setBioLastUpdated(timestamp);
    setEditData((prev) => ({ ...prev, bio: summary }));
  };

  const ensureDailyBioSummary = async () => {
    if (!user) return;
    const updatedKey = `user_bio_updated_${user.uid}`;
    const lastUpdatedISO = localStorage.getItem(updatedKey);
    if (lastUpdatedISO) {
      setBioLastUpdated(lastUpdatedISO);
    }
    const needsRefresh =
      lastUpdatedISO ? new Date(lastUpdatedISO) < getLast2AM() : false;
    if (needsRefresh) {
      const summary = await generateAutoBioSummary();
      if (summary) {
        persistBioSummary(summary);
      }
    }
  };

  const handleManualBioUpdate = async () => {
    setIsBioUpdating(true);
    const summary = await generateAutoBioSummary();
    if (summary) {
      persistBioSummary(summary);
    }
    setIsBioUpdating(false);
  };

  const handleConfirmPicture = async () => {
    if (!pendingPicture) return;
    setProfilePicture(pendingPicture);
    if (user) {
      localStorage.setItem(`user_profile_picture_${user.uid}`, pendingPicture);
      try {
        const toStore = await compressDataUrlForStorage(pendingPicture, 800);
        await firestoreService.ensureUser(user.uid, { profilePicture: toStore });
      } catch (err) {
        console.error('Error saving profile picture to Firestore:', err);
      }
      window.dispatchEvent(new Event('profilePictureUpdated'));
    }
    setPendingPicture(null);
    setShowPicturePreview(false);
  };

  const handleCancelPictureSelection = () => {
    setPendingPicture(null);
    setShowPicturePreview(false);
  };

  const onCropComplete = (_, areaPixels) => {
    setCroppedAreaPixels(areaPixels);
  };

  const handleApplyCrop = async (e) => {
    if (e) e.stopPropagation();
    if (!pendingPicture) return;

    // On native (APK) we skip the canvas crop step, which can fail in WebView,
    // and instead use the original captured image so the user is never blocked.
    if (Capacitor?.isNativePlatform?.() === true) {
      try {
        setIsCropping(true);
        const finalImage = pendingPicture;
        setProfilePicture(finalImage);
        if (user) {
          localStorage.setItem(`user_profile_picture_${user.uid}`, finalImage);
          try {
            const toStore = await compressDataUrlForStorage(finalImage, 800);
            await firestoreService.ensureUser(user.uid, { profilePicture: toStore });
          } catch (err) {
            console.error('Error saving native profile picture to Firestore:', err);
          }
          window.dispatchEvent(new Event('profilePictureUpdated'));
        }
        setPendingPicture(null);
        setShowCropModal(false);
        setCroppedAreaPixels(null);
        setZoom(1);
        setCrop({ x: 0, y: 0 });
      } finally {
        setIsCropping(false);
      }
      return;
    }

    setIsCropping(true);
    try {
      const croppedImage = await getCroppedImg(pendingPicture, croppedAreaPixels);
      const finalImage = croppedImage || pendingPicture;
      if (!finalImage) {
        alert('Could not process the image. Please try again.');
        return;
      }
      setProfilePicture(finalImage);
      if (user) {
        localStorage.setItem(`user_profile_picture_${user.uid}`, finalImage);
        try {
          const toStore = await compressDataUrlForStorage(finalImage, 800);
          await firestoreService.ensureUser(user.uid, { profilePicture: toStore });
        } catch (err) {
          console.error('Error saving profile picture to Firestore:', err);
          // UI still shows new picture from localStorage; other pages will use it via event
        }
        window.dispatchEvent(new Event('profilePictureUpdated'));
      }
      setPendingPicture(null);
      setShowCropModal(false);
      setCroppedAreaPixels(null);
      setZoom(1);
      setCrop({ x: 0, y: 0 });
    } catch (err) {
      console.error('Crop failed:', err);
      alert('Failed to crop image. We used the original photo instead.');
      // Fallback: still try to save the original pending picture so the user is not blocked
      if (pendingPicture) {
        try {
          setProfilePicture(pendingPicture);
          if (user) {
            localStorage.setItem(`user_profile_picture_${user.uid}`, pendingPicture);
            try {
              const toStore = await compressDataUrlForStorage(pendingPicture, 800);
              await firestoreService.ensureUser(user.uid, { profilePicture: toStore });
            } catch (saveErr) {
              console.error('Error saving fallback profile picture to Firestore:', saveErr);
            }
            window.dispatchEvent(new Event('profilePictureUpdated'));
          }
        } catch (fallbackErr) {
          console.error('Fallback profile picture save failed:', fallbackErr);
        }
      }
    } finally {
      setIsCropping(false);
    }
  };

  const handleCancelCrop = () => {
    setShowCropModal(false);
    setPendingPicture(null);
    setCroppedAreaPixels(null);
    setZoom(1);
    setCrop({ x: 0, y: 0 });
  };

  const formatDate = (date) => {
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const handleBirthdaySelect = (date) => {
    setBirthdayDate(date);
    const birthdayString = formatDate(date);
    const calculatedAge = calculateAgeFromBirthday(birthdayString);
    setEditData({ ...editData, birthday: birthdayString, age: calculatedAge });
    setShowBirthdayCalendar(false);
  };

const analyzeUserChatHistory = async (uid) => {
  try {
    const daysResult = await firestoreService.getAllChatDays(uid);
    if (!daysResult.success || !daysResult.chatDays?.length) {
      return null;
    }

    const sortedDays = [...daysResult.chatDays].sort((a, b) => {
      const da = (a.date || a.id || '').replace(/-/g, '');
      const db = (b.date || b.id || '').replace(/-/g, '');
      return db.localeCompare(da);
    });

    const daysToProcess = sortedDays.slice(0, 90);
    const topicCounts = TOPIC_CATEGORIES.reduce((acc, cat) => ({ ...acc, [cat.name]: 0 }), {});
    const moodCounts = Object.keys(MOOD_KEYWORDS).reduce((acc, mood) => ({ ...acc, [mood]: 0 }), {});
    
    // Psychological pattern analysis
    let totalMessages = 0;
    let totalWords = 0;
    let questionCount = 0;
    let selfReflectionCount = 0;
    let futureOrientedCount = 0;
    let pastOrientedCount = 0;
    let uncertaintyCount = 0;
    let certaintyCount = 0;
    let problemSolvingCount = 0;
    let emotionalDepthCount = 0;
    let relationshipMentionCount = 0;
    let allUserMessages = [];

    for (const day of daysToProcess) {
      const dateId = day.date || day.id;
      if (!dateId) continue;
      const messagesResult = await firestoreService.getChatMessagesNew(uid, dateId);
      if (!messagesResult?.success || !messagesResult.messages?.length) continue;

      for (const message of messagesResult.messages) {
        if (message.sender !== 'user' || !message.text) continue;
        totalMessages += 1;
        const text = message.text;
        const lower = text.toLowerCase();
        const words = text.split(/\s+/).filter(w => w.length > 0);
        totalWords += words.length;
        allUserMessages.push(text);

        // Topic and mood analysis
        TOPIC_CATEGORIES.forEach((cat) => {
          if (cat.keywords.some(keyword => lower.includes(keyword))) {
            topicCounts[cat.name] += 1;
          }
        });

        Object.entries(MOOD_KEYWORDS).forEach(([mood, keywords]) => {
          if (keywords.some(keyword => lower.includes(keyword))) {
            moodCounts[mood] += 1;
          }
        });

        // Psychological pattern detection
        if (text.includes('?') || text.includes('wonder') || text.includes('curious') || text.includes('why') || text.includes('how')) {
          questionCount += 1;
        }

        if (lower.includes('i feel') || lower.includes('i think') || lower.includes('i realize') || lower.includes('i notice') || 
            lower.includes('i wonder') || lower.includes('i\'m') || lower.includes('myself') || lower.includes('self')) {
          selfReflectionCount += 1;
        }

        if (lower.includes('will') || lower.includes('going to') || lower.includes('plan') || lower.includes('future') || 
            lower.includes('hope') || lower.includes('want to') || lower.includes('goal')) {
          futureOrientedCount += 1;
        }

        if (lower.includes('was') || lower.includes('were') || lower.includes('remember') || lower.includes('past') || 
            lower.includes('used to') || lower.includes('before')) {
          pastOrientedCount += 1;
        }

        if (lower.includes('maybe') || lower.includes('perhaps') || lower.includes('might') || lower.includes('could') || 
            lower.includes('uncertain') || lower.includes('not sure') || lower.includes('doubt')) {
          uncertaintyCount += 1;
        }

        if (lower.includes('definitely') || lower.includes('certain') || lower.includes('sure') || lower.includes('know') || 
            lower.includes('always') || lower.includes('never')) {
          certaintyCount += 1;
        }

        if (lower.includes('solve') || lower.includes('fix') || lower.includes('handle') || lower.includes('deal with') || 
            lower.includes('manage') || lower.includes('approach') || lower.includes('strategy')) {
          problemSolvingCount += 1;
        }

        if (lower.includes('deep') || lower.includes('intense') || lower.includes('profound') || lower.includes('meaningful') || 
            lower.includes('significant') || lower.includes('powerful') || lower.includes('overwhelming')) {
          emotionalDepthCount += 1;
        }

        if (lower.includes('friend') || lower.includes('family') || lower.includes('partner') || lower.includes('relationship') || 
            lower.includes('people') || lower.includes('others') || lower.includes('they') || lower.includes('we')) {
          relationshipMentionCount += 1;
        }
      }
    }

    if (totalMessages < 5) {
      return null;
    }

    const topTopics = Object.entries(topicCounts)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => name);

    const moodRanking = Object.entries(moodCounts)
      .sort((a, b) => b[1] - a[1])
      .filter(([, count]) => count > 0);

    // Calculate psychological insights
    const avgWordsPerMessage = totalWords / totalMessages;
    const questionRatio = questionCount / totalMessages;
    const selfReflectionRatio = selfReflectionCount / totalMessages;
    const futureRatio = futureOrientedCount / totalMessages;
    const pastRatio = pastOrientedCount / totalMessages;
    const uncertaintyRatio = uncertaintyCount / totalMessages;
    const problemSolvingRatio = problemSolvingCount / totalMessages;
    const emotionalDepthRatio = emotionalDepthCount / totalMessages;
    const relationshipRatio = relationshipMentionCount / totalMessages;

    // Determine psychological patterns
    const psychologicalInsights = {
      emotionalNature: determineEmotionalNature(moodRanking, emotionalDepthRatio, moodCounts),
      thoughtPatterns: determineThoughtPatterns(questionRatio, selfReflectionRatio, avgWordsPerMessage, uncertaintyRatio),
      copingStyle: determineCopingStyle(problemSolvingRatio, moodRanking, moodCounts),
      coreMotivations: determineCoreMotivations(topTopics, futureRatio, pastRatio),
      relationshipStyle: determineRelationshipStyle(relationshipRatio, selfReflectionRatio),
      overallVibe: determineOverallVibe(moodRanking, emotionalDepthRatio, problemSolvingRatio, futureRatio)
    };

    return {
      topTopics,
      moodRanking,
      psychologicalInsights
    };
  } catch (error) {
    console.error('Error analyzing chat history:', error);
    return null;
  }
};

// Helper functions to determine psychological patterns
const determineEmotionalNature = (moodRanking, emotionalDepthRatio, moodCounts) => {
  if (moodRanking.length === 0) return null;
  
  const topMood = moodRanking[0][0];
  const isDeep = emotionalDepthRatio > 0.15;
  const isStressed = (moodCounts.stressed || 0) > (moodCounts.hopeful || 0);
  const isReflective = (moodCounts.reflective || 0) > 0;

  if (isDeep && isReflective) {
    return 'tends to experience emotions deeply and reflect on their inner world with thoughtful awareness';
  } else if (topMood === 'hopeful' && !isStressed) {
    return 'maintains a generally optimistic and forward-looking emotional outlook';
  } else if (topMood === 'stressed' || topMood === 'overwhelmed') {
    return 'is candid about emotional challenges and navigates stress with openness';
  } else if (topMood === 'reflective') {
    return 'approaches emotions with introspection and thoughtful consideration';
  } else if (topMood === 'determined') {
    return 'channels emotions into focused determination and growth-oriented energy';
  }
  return 'expresses emotions authentically and navigates feelings with genuine awareness';
};

const determineThoughtPatterns = (questionRatio, selfReflectionRatio, avgWordsPerMessage, uncertaintyRatio) => {
  const isCurious = questionRatio > 0.2;
  const isIntrospective = selfReflectionRatio > 0.3;
  const isDetailed = avgWordsPerMessage > 15;
  const isUncertain = uncertaintyRatio > 0.15;

  if (isCurious && isIntrospective) {
    return 'thinks through questions with curiosity and self-awareness, often exploring ideas from multiple angles';
  } else if (isCurious && !isIntrospective) {
    return 'approaches thinking with an inquisitive mind, seeking to understand the world around them';
  } else if (isIntrospective && isDetailed) {
    return 'engages in deep, reflective thinking with attention to nuance and detail';
  } else if (isUncertain && isIntrospective) {
    return 'thinks with openness to complexity, comfortable with uncertainty and multiple perspectives';
  } else if (isDetailed) {
    return 'thinks in a thorough and considered manner, paying attention to details and context';
  }
  return 'thinks with clarity and directness, processing experiences thoughtfully';
};

const determineCopingStyle = (problemSolvingRatio, moodRanking, moodCounts) => {
  const isProblemSolver = problemSolvingRatio > 0.2;
  const isStressed = (moodCounts.stressed || 0) > 0;
  const isResilient = (moodCounts.overwhelmed || 0) > 0 && (moodCounts.determined || 0) > 0;

  if (isProblemSolver && isResilient) {
    return 'copes by actively seeking solutions while maintaining resilience through challenges';
  } else if (isProblemSolver) {
    return 'copes by taking an action-oriented approach, focusing on practical solutions';
  } else if (isResilient) {
    return 'copes with challenges by staying resilient and finding strength in difficult moments';
  } else if (isStressed) {
    return 'copes by being open about difficulties and processing stress through expression';
  }
  return 'copes with life\'s challenges through thoughtful reflection and adaptive responses';
};

const determineCoreMotivations = (topTopics, futureRatio, pastRatio) => {
  const isFutureFocused = futureRatio > pastRatio + 0.1;
  const isPastReflective = pastRatio > futureRatio + 0.1;
  const hasGrowthTopics = topTopics.some(t => t === 'self-growth' || t === 'career decisions');

  if (isFutureFocused && hasGrowthTopics) {
    return 'is driven by growth and forward momentum, actively working toward future goals';
  } else if (isFutureFocused) {
    return 'is motivated by future possibilities and maintaining a sense of forward direction';
  } else if (isPastReflective) {
    return 'draws motivation from reflection on past experiences and learning from them';
  } else if (hasGrowthTopics) {
    return 'is motivated by personal development and continuous improvement';
  }
  return 'finds motivation in meaningful connections and authentic experiences';
};

const determineRelationshipStyle = (relationshipRatio, selfReflectionRatio) => {
  const isSocial = relationshipRatio > 0.3;
  const isSelfAware = selfReflectionRatio > 0.25;

  if (isSocial && isSelfAware) {
    return 'navigates relationships with self-awareness and thoughtful consideration of others';
  } else if (isSocial) {
    return 'values connections with others and invests in meaningful relationships';
  } else if (isSelfAware) {
    return 'has a strong relationship with self, engaging in regular self-reflection and inner awareness';
  }
  return 'balances connection with others and personal inner work';
};

const determineOverallVibe = (moodRanking, emotionalDepthRatio, problemSolvingRatio, futureRatio) => {
  if (moodRanking.length === 0) return null;
  
  const topMood = moodRanking[0][0];
  const isDeep = emotionalDepthRatio > 0.15;
  const isProactive = problemSolvingRatio > 0.2;
  const isForwardLooking = futureRatio > 0.25;

  if (topMood === 'hopeful' && isForwardLooking && isProactive) {
    return 'carries an optimistic and proactive energy, moving forward with hope and intention';
  } else if (topMood === 'reflective' && isDeep) {
    return 'maintains a thoughtful and introspective vibe, engaging deeply with inner experiences';
  } else if (topMood === 'determined' && isProactive) {
    return 'radiates focused determination and purposeful energy';
  } else if (isDeep && topMood !== 'stressed') {
    return 'brings depth and authenticity to emotional experiences';
  } else if (topMood === 'hopeful') {
    return 'maintains a hopeful and forward-looking perspective';
  }
  return 'brings genuine presence and authentic engagement to life\'s experiences';
};

const buildListSentence = (items) => {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  const start = items.slice(0, -1).join(', ');
  return `${start}, and ${items[items.length - 1]}`;
};

const createImage = (url) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (error) => reject(error));
    // Only set crossOrigin for remote HTTP(S) URLs; data URLs and blobs don't need it
    if (typeof url === 'string' && /^https?:/i.test(url)) {
      image.setAttribute('crossOrigin', 'anonymous');
    }
    image.src = url;
  });

const getCroppedImg = async (imageSrc, pixelCrop) => {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  const crop = pixelCrop || (() => {
    // Default to a centered square (matches mobile app behavior)
    const size = Math.min(image.width, image.height);
    const offsetX = Math.max((image.width - size) / 2, 0);
    const offsetY = Math.max((image.height - size) / 2, 0);
    return {
      x: offsetX,
      y: offsetY,
      width: size,
      height: size,
    };
  })();

  canvas.width = crop.width;
  canvas.height = crop.height;

  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height
  );

  return canvas.toDataURL('image/png');
};

/** Compress a data URL image to stay under Firestore size limit (~1MB). Returns JPEG data URL. */
const compressDataUrlForStorage = (dataUrl, maxSizeKb = 800) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxDim = 480;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      let quality = 0.85;
      let result = canvas.toDataURL('image/jpeg', quality);
      while (result.length > maxSizeKb * 1024 && quality > 0.2) {
        quality -= 0.1;
        result = canvas.toDataURL('image/jpeg', quality);
      }
      resolve(result);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
};

  const handleSignOut = async () => {
    try {
      await signOutUser();
      navigate('/landing');
    } catch (error) {
      console.error('Error signing out:', error);
      alert('Error signing out. Please try again.');
    }
  };

  const handleDeleteAccount = async () => {
    if (!user) return;

    setDeleteLoading(true);
    try {
      // Clear local storage data
      localStorage.removeItem(`user_age_${user.uid}`);
      localStorage.removeItem(`user_gender_${user.uid}`);
      localStorage.removeItem(`user_bio_${user.uid}`);
      localStorage.removeItem(`user_profile_picture_${user.uid}`);
      
      // Sign out and redirect
      await signOutUser();
      alert('Account data cleared successfully.');
      navigate('/landing');
    } catch (error) {
      console.error('Error deleting account:', error);
      alert('Error deleting account. Please try again.');
    } finally {
      setDeleteLoading(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleFullDeleteAccount = async () => {
    if (!user) return;
    setFullDeleteLoading(true);
    try {
      const uid = user.uid;

      // Clear all localStorage for this user
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes(uid)) keysToRemove.push(key);
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));

      // Delete Firestore user documents
      try {
        const { doc, deleteDoc } = await import('firebase/firestore');
        const { db } = await import('../firebase/config');
        await deleteDoc(doc(db, `users/${uid}`)).catch(() => {});
        await deleteDoc(doc(db, `usersMetadata/${uid}`)).catch(() => {});
      } catch (e) {
        console.warn('Could not delete Firestore docs:', e.message);
      }

      // Delete the Firebase Auth account
      const currentAuthUser = auth.currentUser;
      if (currentAuthUser) {
        await deleteUser(currentAuthUser);
      }

      navigate('/landing');
    } catch (error) {
      console.error('Error deleting account:', error);
      if (error.code === 'auth/requires-recent-login') {
        alert('For security, please sign out and sign back in before deleting your account.');
      } else {
        alert('Error deleting account. Please try again.');
      }
    } finally {
      setFullDeleteLoading(false);
      setShowFullDeleteConfirm(false);
    }
  };

  const getGenderEmoji = (gender) => {
    switch (gender) {
      case 'female': return '👩';
      case 'male': return '👨';
      case 'other': return '🌈';
      default: return '👤';
    }
  };

  const getInitials = (name) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  };

  const formatBirthdayDisplay = (birthdayString) => {
    if (!birthdayString) return 'Not set';
    try {
      const date = new Date(birthdayString);
      if (isNaN(date.getTime())) return 'Not set';
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    } catch (error) {
      return 'Not set';
    }
  };

  if (!user) return null;

  const ROW_STYLE = { borderBottom: `1px solid ${isDarkMode ? HUB.divider : 'rgba(0,0,0,0.06)'}` };

  return (
    <>
    <div
      className="min-h-screen"
      style={{ background: isDarkMode ? HUB.bg : '#F5F5F5' }}
    >
      <div className="max-w-lg mx-auto" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))', paddingBottom: 'max(2rem, env(safe-area-inset-bottom, 0px))' }}>

        {/* Header — clean, like Threads Settings */}
        <div className="flex items-center gap-4 px-4 py-3">
          <button onClick={handleBack} className="p-1 hover:opacity-70 transition-opacity">
            <ArrowLeft className="w-6 h-6" style={{ color: isDarkMode ? HUB.text : '#111' }} strokeWidth={2} />
          </button>
          <h1 className="text-xl font-bold" style={{ color: isDarkMode ? HUB.text : '#111' }}>
            Settings
          </h1>
        </div>

        {/* Profile summary row */}
        <div className="flex items-center gap-4 px-5 py-5" style={ROW_STYLE}>
          <div className="relative flex-shrink-0">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-lg font-bold overflow-hidden cursor-pointer"
              style={{ backgroundColor: HUB.divider }}
              onClick={() => profilePicture ? setShowPhotoPreviewModal(true) : setShowAvatarModal(true)}
            >
              {profilePicture ? (
                <img src={profilePicture} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                getInitials(user.displayName)
              )}
            </div>
            <button
              className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full flex items-center justify-center"
              style={{ backgroundColor: HUB.accent, border: `2px solid ${isDarkMode ? HUB.bg : '#F5F5F5'}` }}
              title="Change picture"
              onClick={() => setShowAvatarModal(true)}
            >
              <Camera className="w-3 h-3" style={{ color: '#fff' }} />
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleProfilePictureChange} className="hidden" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold truncate" style={{ color: isDarkMode ? HUB.text : '#111' }}>
              {user.displayName || 'User'}
            </p>
            <p className="text-sm truncate" style={{ color: HUB.textSecondary }}>{user.email}</p>
          </div>
          <button
            onClick={() => setIsEditing(true)}
            className="px-4 py-1.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80"
            style={{ border: `1px solid ${isDarkMode ? HUB.divider : 'rgba(0,0,0,0.15)'}`, color: isDarkMode ? HUB.text : '#111' }}
          >
            Edit
          </button>
        </div>

        {/* Menu rows */}
        <div className="mt-2">
          {/* Help & Support — collapsible */}
          <div style={ROW_STYLE}>
            <button
              onClick={() => setHelpExpanded((v) => !v)}
              className="w-full flex items-center gap-4 px-5 py-4 text-left transition-opacity hover:opacity-70"
            >
              <Shield className="w-6 h-6 flex-shrink-0" style={{ color: isDarkMode ? HUB.text : '#111' }} strokeWidth={1.5} />
              <span className="flex-1 text-[15px]" style={{ color: isDarkMode ? HUB.text : '#111' }}>Help & Support</span>
              <ChevronDown
                className="w-5 h-5 flex-shrink-0 transition-transform duration-200"
                style={{ color: HUB.textSecondary, transform: helpExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                strokeWidth={1.5}
              />
            </button>
            {helpExpanded && (
              <div>
                <button
                  onClick={() => window.open('tel:9536138120', '_self')}
                  className="w-full flex items-center gap-4 pl-14 pr-5 py-3.5 text-left transition-opacity hover:opacity-70"
                  style={{ borderTop: `1px solid ${isDarkMode ? HUB.divider : 'rgba(0,0,0,0.04)'}` }}
                >
                  <Phone className="w-5 h-5 flex-shrink-0" style={{ color: HUB.textSecondary }} strokeWidth={1.5} />
                  <span className="text-[14px]" style={{ color: isDarkMode ? HUB.text : '#111' }}>Call Support</span>
                </button>
                <button
                  onClick={() => window.open('https://wa.me/919536138120', '_blank')}
                  className="w-full flex items-center gap-4 pl-14 pr-5 py-3.5 text-left transition-opacity hover:opacity-70"
                  style={{ borderTop: `1px solid ${isDarkMode ? HUB.divider : 'rgba(0,0,0,0.04)'}` }}
                >
                  <MessageCircle className="w-5 h-5 flex-shrink-0" style={{ color: HUB.textSecondary }} strokeWidth={1.5} />
                  <span className="text-[14px]" style={{ color: isDarkMode ? HUB.text : '#111' }}>WhatsApp Support</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Log out */}
        <div className="mt-6 px-5">
          <button
            onClick={handleSignOut}
            className="text-[15px] font-medium transition-opacity hover:opacity-70"
            style={{ color: '#3B82F6' }}
          >
            Log out
          </button>
        </div>

        {/* Danger Zone — GitHub-style bordered section */}
        <div className="mt-8 mx-5">
          <h3 className="text-base font-semibold mb-3" style={{ color: isDarkMode ? HUB.text : '#111' }}>
            Danger Zone
          </h3>
          <div
            className="rounded-lg overflow-hidden"
            style={{ border: `1px solid ${isDarkMode ? 'rgba(239,68,68,0.4)' : 'rgba(239,68,68,0.35)'}` }}
          >
            {/* Delete account row */}
            <div className="flex items-center justify-between gap-4 px-4 py-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color: isDarkMode ? HUB.text : '#111' }}>
                  Delete account
                </p>
                <p className="text-xs mt-0.5" style={{ color: HUB.textSecondary }}>
                  Permanently delete your account and all associated data. This cannot be undone.
                </p>
              </div>
              {!showFullDeleteConfirm ? (
                <button
                  onClick={() => setShowFullDeleteConfirm(true)}
                  className="flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-opacity hover:opacity-80"
                  style={{
                    color: isDarkMode ? '#f87171' : '#dc2626',
                    border: `1px solid ${isDarkMode ? 'rgba(239,68,68,0.4)' : 'rgba(239,68,68,0.35)'}`,
                    backgroundColor: isDarkMode ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.05)',
                  }}
                >
                  Delete account
                </button>
              ) : (
                <div className="flex-shrink-0 flex items-center gap-2">
                  <button
                    onClick={handleFullDeleteAccount}
                    disabled={fullDeleteLoading}
                    className="px-3 py-1.5 rounded-md text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                    style={{
                      color: '#fff',
                      backgroundColor: isDarkMode ? 'rgba(239,68,68,0.8)' : '#dc2626',
                    }}
                  >
                    {fullDeleteLoading ? 'Deleting...' : 'Confirm delete'}
                  </button>
                  <button
                    onClick={() => setShowFullDeleteConfirm(false)}
                    className="px-3 py-1.5 rounded-md text-xs font-medium"
                    style={{
                      color: HUB.textSecondary,
                      border: `1px solid ${isDarkMode ? HUB.divider : 'rgba(0,0,0,0.15)'}`,
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>

    {/* Edit Profile — full-screen Threads-style */}
    {isEditing && (
      <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: HUB.bg, zIndex: 999 }}>
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 flex-shrink-0"
          style={{ paddingTop: 'max(14px, env(safe-area-inset-top, 14px))', paddingBottom: '14px' }}
        >
          <button onClick={handleCancel} className="p-1" style={{ color: HUB.text }}>
            <X className="w-6 h-6" />
          </button>
          <span className="text-base font-bold" style={{ color: HUB.text }}>Edit profile</span>
          <button
            onClick={handleSave}
            disabled={loading}
            className="text-base font-semibold disabled:opacity-50"
            style={{ color: HUB.accent }}
          >
            {loading ? 'Saving...' : 'Done'}
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 pb-8">
          {/* Card container — like Threads edit profile card */}
          <div
            className="rounded-2xl overflow-hidden mt-6"
            style={{
              backgroundColor: isDarkMode ? HUB.bgSecondary : '#fff',
              border: `1px solid ${isDarkMode ? HUB.divider : 'rgba(0,0,0,0.08)'}`,
            }}
          >
            {/* Name + profile picture */}
            <div
              className="flex items-start px-4 py-4"
              style={{ borderBottom: `1px solid ${isDarkMode ? HUB.divider : 'rgba(0,0,0,0.06)'}` }}
            >
              <div className="flex-1 min-w-0">
                <span className="text-sm font-bold block" style={{ color: isDarkMode ? HUB.text : '#111' }}>Name</span>
                <input
                  type="text"
                  value={editData.displayName}
                  onChange={(e) => setEditData({ ...editData, displayName: e.target.value })}
                  placeholder="Enter display name"
                  className="w-full bg-transparent text-sm mt-1 focus:outline-none placeholder-gray-500"
                  style={{ color: HUB.textSecondary }}
                />
              </div>
              <button
                className="ml-4 flex-shrink-0 w-14 h-14 rounded-full overflow-hidden flex items-center justify-center"
                style={{ backgroundColor: isDarkMode ? HUB.divider : '#e5e7eb' }}
                onClick={() => profilePicture ? setShowPhotoPreviewModal(true) : setShowAvatarModal(true)}
                title="View profile picture"
              >
                {profilePicture ? (
                  <img src={profilePicture} alt="" className="w-full h-full object-cover" />
                ) : (
                  <User className="w-7 h-7" style={{ color: HUB.textSecondary }} />
                )}
              </button>
            </div>

            {/* Bio */}
            <div
              className="px-4 py-4"
              style={{ borderBottom: `1px solid ${isDarkMode ? HUB.divider : 'rgba(0,0,0,0.06)'}` }}
            >
              <span className="text-sm font-bold block" style={{ color: isDarkMode ? HUB.text : '#111' }}>Bio</span>
              <p className="text-sm mt-1" style={{ color: HUB.textSecondary }}>
                {editData.bio || '+ Write bio'}
              </p>
            </div>

            {/* Age */}
            <div
              className="px-4 py-4"
              style={{ borderBottom: `1px solid ${isDarkMode ? HUB.divider : 'rgba(0,0,0,0.06)'}` }}
            >
              <span className="text-sm font-bold block" style={{ color: isDarkMode ? HUB.text : '#111' }}>Age</span>
              <span className="text-sm mt-1 block" style={{ color: HUB.textSecondary }}>
                {editData.birthday
                  ? `${calculateAgeFromBirthday(editData.birthday) || 'Calculating...'} years old`
                  : editData.age
                    ? `${editData.age} years old`
                    : 'Set your birthday below'}
              </span>
            </div>

            {/* Birthday */}
            <button
              type="button"
              onClick={() => {
                const date = getBirthdayDate();
                setBirthdayDate(date);
                setShowBirthdayCalendar(true);
              }}
              className="w-full text-left px-4 py-4 flex items-center justify-between"
              style={{ borderBottom: `1px solid ${isDarkMode ? HUB.divider : 'rgba(0,0,0,0.06)'}` }}
            >
              <div>
                <span className="text-sm font-bold block" style={{ color: isDarkMode ? HUB.text : '#111' }}>Birthday</span>
                <span className="text-sm mt-1 block" style={{ color: HUB.textSecondary }}>
                  {formatDateDisplay(editData.birthday) || '+ Set birthday'}
                </span>
              </div>
              <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: HUB.textSecondary }} />
            </button>

            {/* Gender */}
            <div className="px-4 py-4">
              <span className="text-sm font-bold block mb-3" style={{ color: isDarkMode ? HUB.text : '#111' }}>Gender</span>
              <div className="flex gap-2">
                {[
                  { value: 'female', label: 'Female', emoji: '👩' },
                  { value: 'male', label: 'Male', emoji: '👨' },
                  { value: 'other', label: 'Other', emoji: '🌈' },
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setEditData({ ...editData, gender: option.value })}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all"
                    style={{
                      backgroundColor: editData.gender === option.value ? `${HUB.accent}25` : 'transparent',
                      border: `1.5px solid ${editData.gender === option.value ? HUB.accent : (isDarkMode ? HUB.divider : 'rgba(0,0,0,0.12)')}`,
                      color: editData.gender === option.value ? HUB.accent : HUB.textSecondary,
                    }}
                  >
                    {option.emoji} {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Remove profile picture — below the card */}
          {profilePicture && (
            <button
              onClick={handleRemoveProfilePicture}
              className="mt-5 px-4 text-sm font-medium"
              style={{ color: 'rgba(242, 139, 130, 0.9)' }}
            >
              Remove profile picture
            </button>
          )}
        </div>
      </div>
    )}

    {/* Full-screen profile photo viewer (WhatsApp style) */}
    {showPhotoPreviewModal && profilePicture && (
      <div
        className="fixed inset-0 z-50 flex flex-col"
        style={{ backgroundColor: '#000', zIndex: 1001 }}
      >
        {/* Top bar: back arrow, name, pencil, share */}
        <div
          className="flex items-center gap-3 px-3 flex-shrink-0"
          style={{ paddingTop: 'max(10px, env(safe-area-inset-top, 10px))', paddingBottom: '10px' }}
        >
          <button
            onClick={() => { setShowPhotoPreviewModal(false); setShowPhotoEditMenu(false); setShowPhotoShareMenu(false); }}
            className="p-2"
            style={{ color: '#fff' }}
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <span className="flex-1 text-base font-medium truncate" style={{ color: '#fff' }}>
            {editData.displayName || user?.displayName || 'Profile Photo'}
          </span>
          <div className="relative">
            <button
              onClick={() => setShowPhotoEditMenu((v) => !v)}
              className="p-2"
              style={{ color: '#fff' }}
            >
              <Edit3 className="w-5 h-5" />
            </button>
            {/* Pencil dropdown: Camera / Gallery / Remove */}
            {showPhotoEditMenu && (
              <div
                className="absolute right-0 top-full mt-1 rounded-xl py-1 min-w-[160px] z-10"
                style={{
                  backgroundColor: HUB.bgSecondary,
                  border: `1px solid ${HUB.divider}`,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                }}
              >
                <button
                  onClick={() => {
                    setShowPhotoEditMenu(false);
                    setShowPhotoPreviewModal(false);
                    if (fileInputRef.current) {
                      fileInputRef.current.setAttribute('capture', 'environment');
                      fileInputRef.current.click();
                      setTimeout(() => fileInputRef.current?.removeAttribute('capture'), 500);
                    }
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left transition-opacity hover:opacity-70"
                >
                  <Camera className="w-5 h-5" style={{ color: '#fff' }} />
                  <span className="text-sm" style={{ color: '#fff' }}>Camera</span>
                </button>
                <button
                  onClick={() => {
                    setShowPhotoEditMenu(false);
                    setShowPhotoPreviewModal(false);
                    if (fileInputRef.current) {
                      fileInputRef.current.removeAttribute('capture');
                      fileInputRef.current.click();
                    }
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left transition-opacity hover:opacity-70"
                  style={{ borderTop: `1px solid ${HUB.divider}` }}
                >
                  <ImageIcon className="w-5 h-5" style={{ color: '#fff' }} />
                  <span className="text-sm" style={{ color: '#fff' }}>Gallery</span>
                </button>
                <button
                  onClick={() => {
                    setShowPhotoEditMenu(false);
                    handleRemoveProfilePicture();
                    setShowPhotoPreviewModal(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left transition-opacity hover:opacity-70"
                  style={{ borderTop: `1px solid ${HUB.divider}` }}
                >
                  <Trash2 className="w-5 h-5" style={{ color: '#f87171' }} />
                  <span className="text-sm" style={{ color: '#f87171' }}>Remove photo</span>
                </button>
              </div>
            )}
          </div>
          <div className="relative">
            <button
              onClick={() => { setShowPhotoShareMenu((v) => !v); setShowPhotoEditMenu(false); }}
              className="p-2"
              style={{ color: '#fff' }}
            >
              <Share2 className="w-5 h-5" />
            </button>
            {showPhotoShareMenu && (
              <div
                className="absolute right-0 top-full mt-1 rounded-xl py-1 min-w-[180px] z-10"
                style={{
                  backgroundColor: HUB.bgSecondary,
                  border: `1px solid ${HUB.divider}`,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                }}
              >
                <button
                  onClick={() => {
                    setShowPhotoShareMenu(false);
                    try {
                      const link = document.createElement('a');
                      link.href = profilePicture;
                      link.download = `profile-photo-${Date.now()}.jpg`;
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                    } catch (e) {
                      console.warn('Download failed:', e.message);
                    }
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left transition-opacity hover:opacity-70"
                >
                  <Download className="w-5 h-5" style={{ color: '#fff' }} />
                  <span className="text-sm" style={{ color: '#fff' }}>Save to device</span>
                </button>
                <button
                  onClick={async () => {
                    setShowPhotoShareMenu(false);
                    try {
                      if (navigator.share) {
                        const blob = await fetch(profilePicture).then((r) => r.blob());
                        const file = new File([blob], 'profile.jpg', { type: blob.type || 'image/jpeg' });
                        await navigator.share({ files: [file], title: 'Profile Photo' });
                      } else {
                        const link = document.createElement('a');
                        link.href = profilePicture;
                        link.download = `profile-photo-${Date.now()}.jpg`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                      }
                    } catch (e) {
                      console.warn('Share failed:', e.message);
                    }
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left transition-opacity hover:opacity-70"
                  style={{ borderTop: `1px solid ${HUB.divider}` }}
                >
                  <Share2 className="w-5 h-5" style={{ color: '#fff' }} />
                  <span className="text-sm" style={{ color: '#fff' }}>Share to...</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Full-screen image */}
        <div
          className="flex-1 flex items-center justify-center"
          onClick={() => { setShowPhotoEditMenu(false); setShowPhotoShareMenu(false); }}
        >
          <img
            src={profilePicture}
            alt="Profile"
            className="w-full h-full object-contain"
            style={{ display: 'block' }}
          />
        </div>
      </div>
    )}

    {showCropModal && pendingPicture && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-black/70"
          onClick={handleCancelCrop}
        />
        <div
          className="relative z-10 w-full max-w-xl rounded-3xl p-6 space-y-6"
          style={{
            backgroundColor: `${HUB.bgSecondary}F2`,
            border: `1px solid ${HUB.divider}`,
            boxShadow: "0 25px 50px -12px rgba(0,0,0,0.7)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-xl font-semibold text-center" style={{ color: HUB.text }}>Adjust your photo</h3>
          <p className="text-center text-sm" style={{ color: HUB.textSecondary }}>
            Drag the image to position it. Pinch with two fingers to zoom in or out. Everything inside the circle will appear on your profile.
          </p>
          <div className="relative w-full h-72 bg-black rounded-2xl overflow-hidden">
            <Cropper
              image={pendingPicture}
              crop={crop}
              zoom={zoom}
              aspect={1}
              showGrid={false}
              cropShape="round"
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              restrictPosition={false}
            />
          </div>
          <div className="flex gap-4">
            <button
              onClick={handleCancelCrop}
              className="flex-1 py-3 rounded-2xl font-semibold transition-all duration-200"
              style={{
                color: HUB.text,
                border: `1px solid ${HUB.divider}`,
                backgroundColor: HUB.bgSecondary,
              }}
            >
              Retake
            </button>
            <button
              type="button"
              onClick={handleApplyCrop}
              disabled={isCropping}
              className="flex-1 py-3 rounded-2xl font-semibold text-black disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                backgroundColor: HUB.accent,
                boxShadow: `0 10px 20px ${HUB.accentShadow}59`,
              }}
            >
              {isCropping ? 'Processing...' : 'Crop & Continue'}
            </button>
          </div>
        </div>
      </div>
    )}

    {showAvatarModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-black/70"
          onClick={() => setShowAvatarModal(false)}
        />
        <div
          className="relative z-10 w-full max-w-md rounded-3xl p-6 space-y-6"
          style={{
            backgroundColor: `${HUB.bgSecondary}F2`,
            border: `1px solid ${HUB.divider}`,
            boxShadow: "0 25px 50px -12px rgba(0,0,0,0.7)",
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-semibold" style={{ color: HUB.text }}>Select Profile Picture</h3>
            <button
              onClick={() => setShowAvatarModal(false)}
              className="p-2 rounded-full transition-all"
              style={{ color: HUB.textSecondary }}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <div className="space-y-4">
            <p className="text-sm" style={{ color: HUB.textSecondary }}>Choose an avatar:</p>
            <div className="grid grid-cols-3 gap-4">
              {avatars.map((avatar, index) => (
                <button
                  key={index}
                  onClick={() => handleAvatarSelect(avatar.path)}
                  className="flex flex-col items-center p-3 rounded-xl transition-all group"
                  style={{ border: '2px solid transparent' }}
                >
                  <div
                    className="w-20 h-20 rounded-full overflow-hidden border-2 border-transparent transition-all mb-2"
                    style={{ borderColor: 'transparent' }}
                  >
                    <img
                      src={avatar.path}
                      alt={avatar.name}
                      className="w-full h-full object-cover group-hover:opacity-90"
                    />
                  </div>
                  <span className="text-xs transition-colors" style={{ color: HUB.textSecondary }}>
                    {avatar.name}
                  </span>
                </button>
              ))}
            </div>
            
            <div className="pt-4 border-t" style={{ borderColor: HUB.divider }}>
              <button
                onClick={handleUploadFromGallery}
                className="w-full py-3 px-4 rounded-xl font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-all"
                style={{
                  backgroundColor: HUB.accent,
                  color: '#FFFFFF',
                  boxShadow: `0 10px 20px ${HUB.accentShadow}59`,
                }}
              >
                <ImageIcon className="w-5 h-5" />
                Upload from Gallery
              </button>
            </div>
          </div>
        </div>
      </div>
    )}

    {showPicturePreview && pendingPicture && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-black/70"
          onClick={handleCancelPictureSelection}
        />
        <div
          className="relative z-10 w-full max-w-md rounded-3xl p-6 space-y-6"
          style={{
            backgroundColor: `${HUB.bgSecondary}F2`,
            border: `1px solid ${HUB.divider}`,
            boxShadow: "0 25px 50px -12px rgba(0,0,0,0.7)",
          }}
        >
          <h3 className="text-xl font-semibold text-center" style={{ color: HUB.text }}>Preview your photo</h3>
          <p className="text-center text-sm" style={{ color: HUB.textSecondary }}>
            Everything inside the circle will appear on your profile.
          </p>
          <div className="flex justify-center">
            <div
              className="w-48 h-48 rounded-full overflow-hidden border-4 border-white/30 shadow-2xl"
              style={{
                boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
              }}
            >
              <img
                src={pendingPicture}
                alt="Preview"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
          <div className="flex gap-4">
            <button
              onClick={handleCancelPictureSelection}
              className="flex-1 py-3 rounded-2xl font-semibold transition-all duration-200"
              style={{
                color: HUB.text,
                border: `1px solid ${HUB.divider}`,
                backgroundColor: HUB.bgSecondary,
              }}
            >
              Retake
            </button>
            <button
              onClick={handleConfirmPicture}
              className="flex-1 py-3 rounded-2xl font-semibold text-black"
              style={{
                backgroundColor: HUB.accent,
                boxShadow: `0 10px 20px ${HUB.accentShadow}59`,
              }}
            >
              Use Photo
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Birthday Calendar Modal */}
    {showBirthdayCalendar && (
      <BirthdayCalendar
        selectedDate={birthdayDate}
        onDateSelect={handleBirthdaySelect}
        onClose={() => setShowBirthdayCalendar(false)}
      />
    )}
    </>
  );
}

// Birthday Calendar Component
const BirthdayCalendar = ({ selectedDate, onDateSelect, onClose }) => {
  const [currentMonth, setCurrentMonth] = useState(selectedDate || new Date());
  const [isAnimating, setIsAnimating] = useState(false);
  const [viewMode, setViewMode] = useState('calendar'); // 'calendar', 'year', 'month'
  const [selectedYear, setSelectedYear] = useState(null);
  
  // Year picker scroll state
  const [yearScrollPosition, setYearScrollPosition] = useState(0);
  const yearScrollContainerRef = useRef(null);
  
  // Month picker scroll state
  const [monthScrollPosition, setMonthScrollPosition] = useState(0);
  const monthScrollContainerRef = useRef(null);

  // Initialize selected year
  useEffect(() => {
    const today = new Date();
    const maxYear = today.getFullYear() - 13;
    const minYear = today.getFullYear() - 120;
    
    if (selectedDate) {
      const year = Math.min(Math.max(selectedDate.getFullYear(), minYear), maxYear);
      setCurrentMonth(new Date(year, selectedDate.getMonth(), 1));
      setSelectedYear(year);
    } else {
      const defaultYear = Math.min(Math.max(2005, minYear), maxYear);
      setSelectedYear(defaultYear);
    }
  }, [selectedDate]);

  // Scroll to current year when year picker opens
  useEffect(() => {
    if (
      viewMode === 'year' &&
      yearScrollContainerRef.current
    ) {
      const years = getYearRange();
      const targetYear = selectedYear ?? years[years.length - 1];
      const currentYearIndex = years.findIndex(y => y === targetYear);
      if (currentYearIndex >= 0) {
        const itemHeight = 50;
        const scrollTo = currentYearIndex * itemHeight;
        setTimeout(() => {
          if (yearScrollContainerRef.current) {
            yearScrollContainerRef.current.scrollTop = scrollTo;
            setYearScrollPosition(scrollTo);
          }
        }, 100);
      }
    }
  }, [viewMode, selectedYear]);

  // Scroll to current month when month picker opens
  useEffect(() => {
    if (viewMode === 'month' && monthScrollContainerRef.current) {
      const currentMonthIndex = currentMonth.getMonth();
      const itemHeight = 50;
      const scrollTo = currentMonthIndex * itemHeight;
      setTimeout(() => {
        if (monthScrollContainerRef.current) {
          monthScrollContainerRef.current.scrollTop = scrollTo;
          setMonthScrollPosition(scrollTo);
        }
      }, 100);
    }
  }, [viewMode, currentMonth]);

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days = [];
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }
    return days;
  };

  const handlePreviousMonth = () => {
    setIsAnimating(true);
    setTimeout(() => {
      setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
      setIsAnimating(false);
    }, 150);
  };

  const handleNextMonth = () => {
    setIsAnimating(true);
    setTimeout(() => {
      setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
      setIsAnimating(false);
    }, 150);
  };

  const handleDateClick = (date) => {
    // Don't allow future dates
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (date > today) {
      return;
    }
    onDateSelect(date);
  };

  const isSelected = (date) => {
    return date && selectedDate &&
           date.getDate() === selectedDate.getDate() &&
           date.getMonth() === selectedDate.getMonth() &&
           date.getFullYear() === selectedDate.getFullYear();
  };

  const isFuture = (date) => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return date > today;
  };

  const handleHeaderClick = () => {
    if (viewMode === 'calendar') {
      setViewMode('year');
    } else if (viewMode === 'year') {
      setViewMode('calendar');
    } else if (viewMode === 'month') {
      setViewMode('year');
    }
  };

  const handleYearSelect = (year) => {
    setSelectedYear(year);
    setCurrentMonth(new Date(year, currentMonth.getMonth(), 1));
    setViewMode('month');
  };

  const handleMonthSelect = (monthIndex) => {
    setCurrentMonth(new Date(selectedYear, monthIndex, 1));
    setViewMode('calendar');
  };

  const getYearRange = () => {
    const today = new Date();
    const maxYear = today.getFullYear() - 13; // At least 13 years old
    const minYear = today.getFullYear() - 120; // Max 120 years old
    const years = [];
    // Newest year first (scroll up to go to lower years)
    for (let year = maxYear; year >= minYear; year--) {
      years.push(year);
    }
    return years;
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const days = getDaysInMonth(currentMonth);
  const today = new Date();
  const maxDate = new Date(today.getFullYear() - 13, today.getMonth(), today.getDate()); // At least 13 years old
  const minDate = new Date(today.getFullYear() - 120, today.getMonth(), today.getDate()); // Max 120 years old

  // Helper functions for year picker
  const handleYearScroll = (e) => {
    const scrollTop = e.target.scrollTop;
    setYearScrollPosition(scrollTop);
  };

  const getYearItemOpacity = (index) => {
    const itemHeight = 50;
    const centerIndex = Math.round(yearScrollPosition / itemHeight);
    const distance = Math.abs(index - centerIndex);
    if (distance === 0) return 1;
    if (distance === 1) return 0.6;
    if (distance === 2) return 0.4;
    return 0.2;
  };

  const getYearItemScale = (index) => {
    const itemHeight = 50;
    const centerIndex = Math.round(yearScrollPosition / itemHeight);
    const distance = Math.abs(index - centerIndex);
    if (distance === 0) return 1;
    if (distance === 1) return 0.9;
    return 0.8;
  };

  // Helper functions for month picker
  const handleMonthScroll = (e) => {
    const scrollTop = e.target.scrollTop;
    setMonthScrollPosition(scrollTop);
  };

  const getMonthItemOpacity = (index) => {
    const itemHeight = 50;
    const centerIndex = Math.round(monthScrollPosition / itemHeight);
    const distance = Math.abs(index - centerIndex);
    if (distance === 0) return 1;
    if (distance === 1) return 0.6;
    if (distance === 2) return 0.4;
    return 0.2;
  };

  const getMonthItemScale = (index) => {
    const itemHeight = 50;
    const centerIndex = Math.round(monthScrollPosition / itemHeight);
    const distance = Math.abs(index - centerIndex);
    if (distance === 0) return 1;
    if (distance === 1) return 0.9;
    return 0.8;
  };

  // Year Picker View - Wheel picker
  if (viewMode === 'year') {
    const years = getYearRange();
    const currentYear = selectedYear || currentMonth.getFullYear();
    const itemHeight = 50;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ zIndex: 1000 }}>
        <div 
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />
        <div
          className="relative rounded-2xl p-6 max-w-sm w-full backdrop-blur-lg animate-in zoom-in-95 duration-300"
          style={{
            backgroundColor: HUB.bgSecondary,
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
            border: `1px solid ${HUB.divider}`,
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <div className="flex items-center justify-center mb-4 pb-4 border-b" style={{ borderColor: HUB.divider }}>
            <button
              onClick={handleHeaderClick}
              className="text-lg font-semibold hover:opacity-80 transition-opacity cursor-pointer"
              style={{ color: HUB.text }}
            >
              Select Year
            </button>
          </div>

          {/* Wheel Picker Container */}
          <div className="relative" style={{ height: '250px', overflow: 'hidden' }}>
            {/* Selection indicator lines */}
            <div 
              className="absolute left-0 right-0 pointer-events-none"
              style={{
                top: '50%',
                transform: 'translateY(-50%)',
                height: `${itemHeight}px`,
                borderTop: '1px solid rgba(255, 255, 255, 0.2)',
                borderBottom: '1px solid rgba(255, 255, 255, 0.2)',
                zIndex: 1
              }}
            />
            
            {/* Scrollable list */}
            <div
              ref={yearScrollContainerRef}
              onScroll={handleYearScroll}
              className="overflow-y-scroll h-full"
              style={{
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
                scrollSnapType: 'y mandatory',
                WebkitOverflowScrolling: 'touch'
              }}
            >
              <style>{`
                div::-webkit-scrollbar {
                  display: none;
                }
              `}</style>
              
              {/* Top padding for centering */}
              <div style={{ height: '100px' }} />
              
              {/* Year items */}
              {years.map((year, index) => {
                const opacity = getYearItemOpacity(index);
                const scale = getYearItemScale(index);
                const isCenter = Math.round(yearScrollPosition / itemHeight) === index;
                
                return (
                  <div
                    key={year}
                    onClick={() => {
                      handleYearSelect(year);
                    }}
                    className="flex items-center justify-center cursor-pointer transition-all duration-150"
                    style={{
                      height: `${itemHeight}px`,
                      opacity: opacity,
                      transform: `scale(${scale})`,
                      color: isCenter ? HUB.text : HUB.textSecondary,
                      fontWeight: isCenter ? '600' : '400',
                      fontSize: isCenter ? '20px' : '18px',
                      scrollSnapAlign: 'center'
                    }}
                  >
                    {year}
                  </div>
                );
              })}
              
              {/* Bottom padding for centering */}
              <div style={{ height: '100px' }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Month Picker View - Wheel picker
  if (viewMode === 'month') {
    const itemHeight = 50;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ zIndex: 1000 }}>
        <div 
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />
        <div
          className="relative rounded-2xl p-6 max-w-sm w-full backdrop-blur-lg animate-in zoom-in-95 duration-300"
          style={{
            backgroundColor: HUB.bgSecondary,
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
            border: `1px solid ${HUB.divider}`,
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <div className="flex items-center justify-center mb-4 pb-4 border-b" style={{ borderColor: HUB.divider }}>
            <button
              onClick={handleHeaderClick}
              className="text-lg font-semibold hover:opacity-80 transition-opacity cursor-pointer"
              style={{ color: HUB.text }}
            >
              {selectedYear}
            </button>
          </div>
          
          {/* Wheel Picker Container */}
          <div className="relative" style={{ height: '250px', overflow: 'hidden' }}>
            {/* Selection indicator lines */}
            <div 
              className="absolute left-0 right-0 pointer-events-none"
              style={{
                top: '50%',
                transform: 'translateY(-50%)',
                height: `${itemHeight}px`,
                borderTop: '1px solid rgba(255, 255, 255, 0.2)',
                borderBottom: '1px solid rgba(255, 255, 255, 0.2)',
                zIndex: 1
              }}
            />
            
            {/* Scrollable list */}
            <div
              ref={monthScrollContainerRef}
              onScroll={handleMonthScroll}
              className="overflow-y-scroll h-full"
              style={{
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
                scrollSnapType: 'y mandatory',
                WebkitOverflowScrolling: 'touch'
              }}
            >
              <style>{`
                div::-webkit-scrollbar {
                  display: none;
                }
              `}</style>
              
              {/* Top padding for centering */}
              <div style={{ height: '100px' }} />
              
              {/* Month items */}
              {monthNames.map((month, index) => {
                const opacity = getMonthItemOpacity(index);
                const scale = getMonthItemScale(index);
                const isCenter = Math.round(monthScrollPosition / itemHeight) === index;
                
                return (
                  <div
                    key={index}
                    onClick={() => {
                      handleMonthSelect(index);
                    }}
                    className="flex items-center justify-center cursor-pointer transition-all duration-150"
                    style={{
                      height: `${itemHeight}px`,
                      opacity: opacity,
                      transform: `scale(${scale})`,
                      color: isCenter ? HUB.text : HUB.textSecondary,
                      fontWeight: isCenter ? '600' : '400',
                      fontSize: isCenter ? '20px' : '18px',
                      scrollSnapAlign: 'center'
                    }}
                  >
                    {month}
                  </div>
                );
              })}
              
              {/* Bottom padding for centering */}
              <div style={{ height: '100px' }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Calendar View (default)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ zIndex: 1000 }}>
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Calendar */}
      <div
        className="relative rounded-2xl p-6 max-w-sm w-full backdrop-blur-lg animate-in zoom-in-95 duration-300"
        style={{
          backgroundColor: HUB.bgSecondary,
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
          border: `1px solid ${HUB.divider}`,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={handlePreviousMonth}
            className="w-10 h-10 rounded-full flex items-center justify-center transition-colors"
            style={{ color: HUB.text }}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          
          <div className="text-center">
            <button
              onClick={handleHeaderClick}
              className={`text-lg font-semibold transition-opacity duration-150 hover:opacity-80 cursor-pointer ${
                isAnimating ? 'opacity-0' : 'opacity-100'
              }`}
              style={{ color: HUB.text }}
            >
              {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
            </button>
          </div>
          
          <button
            onClick={handleNextMonth}
            className="w-10 h-10 rounded-full flex items-center justify-center transition-colors"
            style={{ color: HUB.text }}
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Day names */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {dayNames.map((day) => (
            <div key={day} className="text-center py-2">
              <span className="text-xs font-medium" style={{ color: HUB.textSecondary }}>{day}</span>
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className={`grid grid-cols-7 gap-1 transition-opacity duration-150 ${
          isAnimating ? 'opacity-0' : 'opacity-100'
        }`}>
          {days.map((date, index) => (
            <div key={index} className="aspect-square">
              {date ? (
                <button
                  onClick={() => handleDateClick(date)}
                  disabled={isFuture(date)}
                  className={`w-full h-full rounded-lg flex items-center justify-center text-sm font-medium transition-all duration-200 ${
                    !isSelected(date) && !isFuture(date) ? 'hover:opacity-80' : ''
                  }`}
                  style={
                    isSelected(date)
                      ? {
                          backgroundColor: HUB.accent,
                          color: '#FFFFFF',
                          fontWeight: 'bold',
                          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
                          border: `1px solid ${HUB.divider}`,
                        }
                      : isFuture(date)
                      ? { color: HUB.textSecondary, cursor: 'not-allowed', opacity: 0.3 }
                      : { color: HUB.text }
                  }
                >
                  {date.getDate()}
                </button>
              ) : (
                <div className="w-full h-full" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
