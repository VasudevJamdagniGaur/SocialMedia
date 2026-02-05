import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { ArrowLeft, Zap, Check, Calendar, X, Share2, User, Pencil } from 'lucide-react';
import { getCurrentUser } from '../services/authService';
import firestoreService from '../services/firestoreService';
import { getDateId, formatDateForDisplay } from '../utils/dateUtils';
import { collection, getDocs, doc, getDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import CalendarPopup from './CalendarPopup';

export default function AllDayReflectionsPage() {
  const navigate = useNavigate();
  const { isDarkMode } = useTheme();
  const [reflections, setReflections] = useState([]);
  const [filteredReflections, setFilteredReflections] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [reflectionDays, setReflectionDays] = useState([]);
  const [selectedReflection, setSelectedReflection] = useState(null);
  const [moodData, setMoodData] = useState(null);
  const [isLoadingMood, setIsLoadingMood] = useState(false);
  const [reflectionToShare, setReflectionToShare] = useState(null);
  const [isSharingPost, setIsSharingPost] = useState(false);
  const [profilePicture, setProfilePicture] = useState(null);
  const [sharePreviewText, setSharePreviewText] = useState('');
  const [shareEditMode, setShareEditMode] = useState(false);

  // Format date for display (e.g., "8 October 2025 • Wed, 3:54 pm")
  const formatReflectionDate = (reflectionItem) => {
    if (!reflectionItem) return '';
    try {
      // Use createdAt if available (has actual time), otherwise use dateObj
      let date = reflectionItem.createdAt || reflectionItem.dateObj;
      
      if (!date) {
        // Fallback to parsing date string
        const dateString = reflectionItem.date;
        if (dateString.includes('-')) {
          const [year, month, day] = dateString.split('-');
          date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        } else {
          date = new Date(dateString);
        }
      }
      
      // Handle Firestore Timestamp
      if (date && typeof date.toDate === 'function') {
        date = date.toDate();
      }
      
      if (!date || isNaN(date.getTime())) {
        return reflectionItem.date || '';
      }
      
      const day = date.getDate();
      const month = date.toLocaleDateString('en-US', { month: 'long' });
      const year = date.getFullYear();
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      const time = date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      });
      
      return `${day} ${month} ${year} • ${dayName}, ${time}`;
    } catch (error) {
      console.error('Error formatting date:', error);
      return reflectionItem.date || '';
    }
  };

  // Load all day reflections
  useEffect(() => {
    const loadReflections = async () => {
      const user = getCurrentUser();
      if (!user) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        
        // STEP 1: Load from localStorage first (instant display)
        const cachedReflectionsKey = `all_day_reflections_${user.uid}`;
        const cachedReflections = localStorage.getItem(cachedReflectionsKey);
        
        if (cachedReflections) {
          try {
            const parsed = JSON.parse(cachedReflections);
            // Convert date strings back to Date objects
            const reflectionsWithDates = parsed.map(r => ({
              ...r,
              dateObj: r.date ? new Date(r.date) : new Date(r.dateObj),
              createdAt: r.createdAt ? new Date(r.createdAt) : (r.dateObj ? new Date(r.dateObj) : new Date())
            }));
            
            // Sort by date (newest first)
            reflectionsWithDates.sort((a, b) => {
              const dateA = a.dateObj?.getTime() || 0;
              const dateB = b.dateObj?.getTime() || 0;
              return dateB - dateA;
            });
            
            setReflections(reflectionsWithDates);
            setFilteredReflections(reflectionsWithDates);
            
            // Extract reflection days for calendar
            const daysWithReflections = reflectionsWithDates.map(r => ({
              date: r.date,
              hasReflection: true
            }));
            setReflectionDays(daysWithReflections);
            
            console.log(`✅ Loaded ${reflectionsWithDates.length} reflections from cache`);
            setIsLoading(false); // Show cached data immediately
          } catch (e) {
            console.error('Error parsing cached reflections:', e);
          }
        }
        
        // STEP 2: Fetch from Firebase in background and update
        console.log('🔄 Fetching reflections from Firebase in background...');
        const allReflections = [];
        
        // Method 1: Get all days from users/{uid}/days and check each for reflections
        const daysRef = collection(db, `users/${user.uid}/days`);
        const daysSnapshot = await getDocs(daysRef);
        
        console.log(`📅 Found ${daysSnapshot.docs.length} days in collection`);
        
        // Use Promise.all for parallel fetching instead of sequential
        const reflectionPromises = daysSnapshot.docs.map(async (dayDoc) => {
          const dateId = dayDoc.id;
          try {
            const reflectionRef = doc(db, `users/${user.uid}/days/${dateId}/reflection/meta`);
            const reflectionSnap = await getDoc(reflectionRef);
            
            if (reflectionSnap.exists()) {
              const reflectionData = reflectionSnap.data();
              const reflectionText = reflectionData.summary || reflectionData.reflection || reflectionData.text;
              
              if (reflectionText) {
                let reflectionDate;
                try {
                  if (dateId.includes('-')) {
                    const [year, month, dayNum] = dateId.split('-');
                    reflectionDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(dayNum));
                  } else {
                    reflectionDate = new Date(dateId);
                  }
                } catch (e) {
                  reflectionDate = new Date();
                }
                
                // Handle createdAt timestamp
                let createdAt = reflectionData.createdAt || reflectionData.updatedAt || reflectionDate;
                if (createdAt && typeof createdAt.toDate === 'function') {
                  createdAt = createdAt.toDate();
                } else if (createdAt && typeof createdAt === 'object' && !(createdAt instanceof Date)) {
                  createdAt = reflectionDate;
                } else if (!createdAt) {
                  createdAt = reflectionDate;
                }
                
                return {
                  id: dateId,
                  date: dateId,
                  dateObj: reflectionDate,
                  reflection: reflectionText,
                  createdAt: createdAt
                };
              }
            }
          } catch (error) {
            console.error(`❌ Error checking reflection for ${dateId}:`, error);
          }
          return null;
        });
        
        const reflectionResults = await Promise.all(reflectionPromises);
        const validReflections = reflectionResults.filter(r => r !== null);
        allReflections.push(...validReflections);
        
        // Method 2: Also check old structure (dayReflections collection) as fallback
        try {
          const oldReflectionsRef = collection(db, `users/${user.uid}/dayReflections`);
          const oldSnapshot = await getDocs(oldReflectionsRef);
          
          oldSnapshot.forEach((doc) => {
            const data = doc.data();
            const dateId = doc.id;
            const reflectionText = data.summary || data.reflection || data.text;
            
            if (reflectionText && !allReflections.find(r => r.date === dateId)) {
              let reflectionDate;
              try {
                if (dateId.includes('-')) {
                  const [year, month, dayNum] = dateId.split('-');
                  reflectionDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(dayNum));
                } else {
                  reflectionDate = new Date(dateId);
                }
              } catch (e) {
                reflectionDate = new Date();
              }
              
              let createdAt = data.createdAt || data.updatedAt || reflectionDate;
              if (createdAt && typeof createdAt.toDate === 'function') {
                createdAt = createdAt.toDate();
              } else if (!createdAt || (typeof createdAt === 'object' && !(createdAt instanceof Date))) {
                createdAt = reflectionDate;
              }
              
              allReflections.push({
                id: dateId,
                date: dateId,
                dateObj: reflectionDate,
                reflection: reflectionText,
                createdAt: createdAt
              });
            }
          });
        } catch (error) {
          console.log('⚠️ Old structure not found or error:', error);
        }
        
        // Also check localStorage for any individual reflections (as fallback)
        const localStorageKeys = Object.keys(localStorage);
        localStorageKeys.forEach(key => {
          if (key.startsWith('reflection_') && !key.startsWith('all_day_reflections_')) {
            const dateId = key.replace('reflection_', '');
            // Check if already in list (prefer Firebase data)
            if (!allReflections.find(r => r.date === dateId)) {
              const reflectionText = localStorage.getItem(key);
              if (reflectionText) {
                let reflectionDate;
                try {
                  if (dateId.includes('-')) {
                    const [year, month, day] = dateId.split('-');
                    reflectionDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                  } else {
                    reflectionDate = new Date(dateId);
                  }
                } catch (e) {
                  reflectionDate = new Date();
                }
                
                allReflections.push({
                  id: dateId,
                  date: dateId,
                  dateObj: reflectionDate,
                  reflection: reflectionText,
                  createdAt: reflectionDate
                });
              }
            }
          }
        });
        
        // Sort by date (newest first)
        allReflections.sort((a, b) => {
          const dateA = a.dateObj?.getTime() || 0;
          const dateB = b.dateObj?.getTime() || 0;
          return dateB - dateA;
        });
        
        console.log(`✅ Total reflections loaded from Firebase: ${allReflections.length}`);
        
        // Save to localStorage for future fast loading
        const reflectionsToCache = allReflections.map(r => ({
          ...r,
          dateObj: r.dateObj.toISOString(),
          createdAt: r.createdAt.toISOString()
        }));
        localStorage.setItem(cachedReflectionsKey, JSON.stringify(reflectionsToCache));
        console.log('💾 Saved reflections to localStorage cache');
        
        // Update state with fresh data
        setReflections(allReflections);
        setFilteredReflections(allReflections);
        
        // Extract reflection days for calendar indicators
        const daysWithReflections = allReflections.map(r => ({
          date: r.date,
          hasReflection: true
        }));
        setReflectionDays(daysWithReflections);
      } catch (error) {
        console.error('❌ Error loading reflections:', error);
        // If Firebase fails, try to use cached data if available
        const cachedReflectionsKey = `all_day_reflections_${user.uid}`;
        const cachedReflections = localStorage.getItem(cachedReflectionsKey);
        if (cachedReflections) {
          try {
            const parsed = JSON.parse(cachedReflections);
            const reflectionsWithDates = parsed.map(r => ({
              ...r,
              dateObj: new Date(r.dateObj),
              createdAt: new Date(r.createdAt)
            }));
            reflectionsWithDates.sort((a, b) => {
              const dateA = a.dateObj?.getTime() || 0;
              const dateB = b.dateObj?.getTime() || 0;
              return dateB - dateA;
            });
            setReflections(reflectionsWithDates);
            setFilteredReflections(reflectionsWithDates);
            const daysWithReflections = reflectionsWithDates.map(r => ({
              date: r.date,
              hasReflection: true
            }));
            setReflectionDays(daysWithReflections);
          } catch (e) {
            console.error('Error using cached data:', e);
            setReflections([]);
          }
        } else {
          setReflections([]);
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadReflections();
  }, []);

  // Filter reflections based on selected date
  useEffect(() => {
    if (selectedDate) {
      const dateId = getDateId(selectedDate);
      const filtered = reflections.filter(r => r.date === dateId);
      setFilteredReflections(filtered);
    } else {
      setFilteredReflections(reflections);
    }
  }, [selectedDate, reflections]);

  const handleCalendarClick = () => {
    setIsCalendarOpen(true);
  };

  const handleDateSelect = async (date) => {
    setSelectedDate(date);
    setIsCalendarOpen(false);
    
    // Find reflection for this date and load mood data
    const dateId = getDateId(date);
    const reflection = reflections.find(r => r.date === dateId);
    
    if (reflection) {
      setSelectedReflection(reflection);
      await loadMoodDataForDate(dateId);
    } else {
      setSelectedReflection(null);
      setMoodData(null);
    }
  };

  const loadMoodDataForDate = async (dateId) => {
    const user = getCurrentUser();
    if (!user) return;

    try {
      setIsLoadingMood(true);
      const moodRef = doc(db, `users/${user.uid}/days/${dateId}/moodChart/daily`);
      const snapshot = await getDoc(moodRef);
      
      if (snapshot.exists()) {
        const data = snapshot.data();
        setMoodData({
          happiness: data.happiness || 0,
          anxiety: data.anxiety || 0,
          stress: data.stress || 0,
          energy: data.energy || 0
        });
      } else {
        setMoodData(null);
      }
    } catch (error) {
      console.error('Error loading mood data:', error);
      setMoodData(null);
    } finally {
      setIsLoadingMood(false);
    }
  };

  const handleReflectionClick = async (reflection) => {
    setSelectedReflection(reflection);
    await loadMoodDataForDate(reflection.date);
  };

  const handleClearDateFilter = () => {
    setSelectedDate(null);
  };

  // Load profile picture for share preview
  useEffect(() => {
    const user = getCurrentUser();
    if (user) {
      const saved = localStorage.getItem(`user_profile_picture_${user.uid}`);
      setProfilePicture(saved || null);
    }
  }, []);

  // When share modal opens, init editable text (original Day's Reflect is never changed)
  useEffect(() => {
    if (reflectionToShare?.reflection) {
      setSharePreviewText(reflectionToShare.reflection);
      setShareEditMode(false);
    }
  }, [reflectionToShare]);

  const handleShareToHub = async () => {
    const contentToShare = (sharePreviewText || reflectionToShare?.reflection || '').trim();
    if (!contentToShare) return;
    const user = getCurrentUser();
    if (!user) {
      alert('Please sign in to share.');
      return;
    }
    setIsSharingPost(true);
    try {
      const reflectionDate = reflectionToShare.dateObj || reflectionToShare.createdAt || new Date(reflectionToShare.date);
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
      setReflectionToShare(null);
      setSelectedReflection(null);
      setMoodData(null);
      navigate('/community');
    } catch (err) {
      console.error('Error sharing reflection to HUB:', err);
      alert('Failed to share to HUB. Please try again.');
    } finally {
      setIsSharingPost(false);
    }
  };

  const getSocialShareText = () => (sharePreviewText || reflectionToShare?.reflection || '').trim();

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

  return (
    <div
      className="min-h-screen px-6 py-8 pb-20 relative overflow-hidden"
      style={{
        background: isDarkMode
          ? "#131313"
          : "#FAFAF8"
      }}
    >
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center space-x-3 mb-2">
          <button
            onClick={() => navigate('/dashboard')}
            className={`w-10 h-10 rounded-full flex items-center justify-center ${
              isDarkMode ? 'hover:bg-gray-800/50' : 'hover:bg-gray-100'
            } transition-colors`}
          >
            <ArrowLeft className={`w-5 h-5 ${isDarkMode ? 'text-white' : 'text-gray-800'}`} />
          </button>
          <div className="flex items-center space-x-2">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{
                backgroundColor: isDarkMode ? "#FDD663" : "#E6B3BA",
                boxShadow: isDarkMode ? "0 4px 16px rgba(0, 0, 0, 0.15)" : "none",
              }}
            >
              <Zap className={`w-4 h-4 ${isDarkMode ? 'text-black' : 'text-white'}`} />
            </div>
            <h1 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
              Day's Reflect
            </h1>
          </div>
        </div>
        <p className={`text-sm ml-14 mb-3 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          All your day reflections
        </p>
        
        {/* Date Search */}
        <div className="ml-14 mb-4">
          <div
            onClick={handleCalendarClick}
            className={`rounded-lg px-3 py-2 flex items-center ${selectedDate ? 'justify-between' : 'justify-center'} cursor-pointer hover:opacity-80 transition-opacity ${
              isDarkMode ? 'backdrop-blur-md' : 'bg-white'
            }`}
            style={isDarkMode ? {
              backgroundColor: "#262626",
              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            } : {
              boxShadow: "0 2px 6px rgba(0, 0, 0, 0.08)",
            }}
          >
            <div className={`flex items-center ${selectedDate ? 'space-x-2' : 'flex-col space-y-1'}`}>
              <Calendar className="w-4 h-4" style={{ color: isDarkMode ? "#7DD3C0" : "#87A96B" }} />
              <div className={selectedDate ? '' : 'text-center'}>
                <div className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                  {selectedDate ? formatDateForDisplay(selectedDate) : 'Search by date'}
                </div>
                <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {selectedDate ? 'Tap to change date' : 'Tap to select a date'}
                </div>
              </div>
            </div>
            {selectedDate && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleClearDateFilter();
                }}
                className="ml-2 p-1 rounded-full hover:opacity-80 transition-opacity"
              >
                <X className={`w-4 h-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Reflections List */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="flex space-x-1 mb-3">
            <div className={`w-2 h-2 rounded-full animate-bounce ${isDarkMode ? 'bg-gray-400' : 'bg-gray-500'}`} style={{ animationDelay: '0ms' }}></div>
            <div className={`w-2 h-2 rounded-full animate-bounce ${isDarkMode ? 'bg-gray-400' : 'bg-gray-500'}`} style={{ animationDelay: '150ms' }}></div>
            <div className={`w-2 h-2 rounded-full animate-bounce ${isDarkMode ? 'bg-gray-400' : 'bg-gray-500'}`} style={{ animationDelay: '300ms' }}></div>
          </div>
          <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            Loading reflections...
          </p>
        </div>
      ) : filteredReflections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <div
            className={`w-16 h-16 rounded-lg flex items-center justify-center mb-4 ${
              isDarkMode ? 'backdrop-blur-md' : 'bg-white'
            }`}
            style={isDarkMode ? {
              backgroundColor: "rgba(28, 31, 46, 0.5)",
              boxShadow: "inset 0 0 20px rgba(125, 211, 192, 0.12), 0 8px 32px rgba(125, 211, 192, 0.08)",
              border: "1px solid rgba(125, 211, 192, 0.18)",
            } : {
              boxShadow: "0 2px 6px rgba(0, 0, 0, 0.06)",
            }}
          >
            <span className="text-3xl">🌿</span>
          </div>
          <p className={`text-sm text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            {selectedDate ? 'No reflection found for the selected date.' : 'No reflections yet. Start chatting with Deite to generate reflections!'}
          </p>
        </div>
      ) : (
        <div className="space-y-3 max-w-sm mx-auto">
          {filteredReflections.map((reflection) => (
            <div
              key={reflection.id}
              onClick={() => handleReflectionClick(reflection)}
              className={`rounded-2xl p-4 relative overflow-hidden cursor-pointer transition-opacity hover:opacity-90 ${
                isDarkMode ? 'backdrop-blur-lg' : 'bg-white'
              }`}
              style={isDarkMode ? {
                backgroundColor: "#262626",
                boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
              } : {
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
              }}
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-1">
                  <Check className={`w-4 h-4 ${isDarkMode ? 'text-[#81C995]' : 'text-[#87A96B]'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    {formatReflectionDate(reflection)}
                  </div>
                  <p className={`text-sm leading-relaxed ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} line-clamp-3`}>
                    {reflection.reflection}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setReflectionToShare(reflection); }}
                  className={`flex-shrink-0 p-2 rounded-full transition-opacity hover:opacity-90 ${
                    isDarkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'
                  }`}
                  title="Share to HUB"
                >
                  <Share2 className={`w-4 h-4 ${isDarkMode ? 'text-[#7DD3C0]' : 'text-[#87A96B]'}`} strokeWidth={2} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Calendar Popup */}
      <CalendarPopup
        isOpen={isCalendarOpen}
        onClose={() => setIsCalendarOpen(false)}
        selectedDate={selectedDate || new Date()}
        onDateSelect={handleDateSelect}
        chatDays={reflectionDays}
      />

      {/* Reflection Detail Modal */}
      {selectedReflection && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
          onClick={() => {
            setSelectedReflection(null);
            setMoodData(null);
          }}
        >
          <div
            className={`rounded-2xl p-6 w-full max-w-sm relative max-h-[90vh] overflow-y-auto ${
              isDarkMode ? 'backdrop-blur-lg' : 'bg-white'
            }`}
            style={isDarkMode ? {
              backgroundColor: "#262626",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
            } : {
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{
                    backgroundColor: isDarkMode ? "#FDD663" : "#E6B3BA",
                    boxShadow: isDarkMode ? "0 4px 16px rgba(0, 0, 0, 0.15)" : "none",
                  }}
                >
                  <Zap className={`w-4 h-4 ${isDarkMode ? 'text-black' : 'text-white'}`} />
                </div>
                <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                  Day's Reflect
                </h2>
              </div>
              <button
                onClick={() => {
                  setSelectedReflection(null);
                  setMoodData(null);
                }}
                className={`p-1 rounded-full hover:opacity-80 transition-opacity ${
                  isDarkMode ? 'hover:bg-gray-800/50' : 'hover:bg-gray-100'
                }`}
              >
                <X className={`w-5 h-5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
              </button>
            </div>

            {/* Date */}
            <div className={`text-xs font-medium mb-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {formatReflectionDate(selectedReflection)}
            </div>

            {/* Mood Metrics */}
            {isLoadingMood ? (
              <div className="mb-4 flex items-center justify-center py-4">
                <div className="flex space-x-1">
                  <div className={`w-2 h-2 rounded-full animate-bounce ${isDarkMode ? 'bg-gray-400' : 'bg-gray-500'}`} style={{ animationDelay: '0ms' }}></div>
                  <div className={`w-2 h-2 rounded-full animate-bounce ${isDarkMode ? 'bg-gray-400' : 'bg-gray-500'}`} style={{ animationDelay: '150ms' }}></div>
                  <div className={`w-2 h-2 rounded-full animate-bounce ${isDarkMode ? 'bg-gray-400' : 'bg-gray-500'}`} style={{ animationDelay: '300ms' }}></div>
                </div>
              </div>
            ) : moodData ? (
              <div className="mb-6 space-y-3">
                <h3 className={`text-sm font-semibold mb-3 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Emotional Metrics
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {/* Happiness */}
                  <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-gray-800/50' : 'bg-gray-100'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Happiness
                      </span>
                      <span className={`text-sm font-bold ${isDarkMode ? 'text-[#81C995]' : 'text-[#87A96B]'}`}>
                        {moodData.happiness}%
                      </span>
                    </div>
                    <div className={`h-2 rounded-full ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                      <div
                        className="h-2 rounded-full transition-all"
                        style={{
                          width: `${moodData.happiness}%`,
                          backgroundColor: '#81C995'
                        }}
                      />
                    </div>
                  </div>

                  {/* Energy */}
                  <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-gray-800/50' : 'bg-gray-100'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Energy
                      </span>
                      <span className={`text-sm font-bold ${isDarkMode ? 'text-[#8AB4F8]' : 'text-[#87A96B]'}`}>
                        {moodData.energy}%
                      </span>
                    </div>
                    <div className={`h-2 rounded-full ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                      <div
                        className="h-2 rounded-full transition-all"
                        style={{
                          width: `${moodData.energy}%`,
                          backgroundColor: '#8AB4F8'
                        }}
                      />
                    </div>
                  </div>

                  {/* Anxiety */}
                  <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-gray-800/50' : 'bg-gray-100'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Anxiety
                      </span>
                      <span className={`text-sm font-bold ${isDarkMode ? 'text-[#E6B3BA]' : 'text-[#E6B3BA]'}`}>
                        {moodData.anxiety}%
                      </span>
                    </div>
                    <div className={`h-2 rounded-full ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                      <div
                        className="h-2 rounded-full transition-all"
                        style={{
                          width: `${moodData.anxiety}%`,
                          backgroundColor: '#E6B3BA'
                        }}
                      />
                    </div>
                  </div>

                  {/* Stress */}
                  <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-gray-800/50' : 'bg-gray-100'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Stress
                      </span>
                      <span className={`text-sm font-bold ${isDarkMode ? 'text-[#FDD663]' : 'text-[#FDD663]'}`}>
                        {moodData.stress}%
                      </span>
                    </div>
                    <div className={`h-2 rounded-full ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                      <div
                        className="h-2 rounded-full transition-all"
                        style={{
                          width: `${moodData.stress}%`,
                          backgroundColor: '#FDD663'
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className={`mb-6 p-3 rounded-lg ${isDarkMode ? 'bg-gray-800/30' : 'bg-gray-100'}`}>
                <p className={`text-xs text-center ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                  No emotional metrics available for this date
                </p>
              </div>
            )}

            {/* Reflection Content */}
            <div className="mb-4">
              <h3 className={`text-sm font-semibold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Reflection
              </h3>
              <div className={`p-4 rounded-lg ${isDarkMode ? 'bg-gray-800/50' : 'bg-gray-100'}`}>
                <p className={`text-sm leading-relaxed ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {selectedReflection.reflection}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReflectionToShare(selectedReflection)}
                className={`mt-3 w-full flex items-center justify-center gap-2 rounded-xl py-3 px-4 text-sm font-medium transition-all hover:opacity-90 ${
                  isDarkMode ? 'text-[#7DD3C0] bg-white/5 border border-white/10' : 'text-[#87A96B] bg-black/5 border border-black/10'
                }`}
              >
                <Share2 className="w-4 h-4" strokeWidth={2} />
                Share to HUB
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share to HUB – mirror of your day (warm, affirming) */}
      {reflectionToShare && reflectionToShare.reflection && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.55)' }}
          onClick={() => !isSharingPost && setReflectionToShare(null)}
        >
          <div
            className={`w-full max-w-sm overflow-hidden backdrop-blur-xl ${
              isDarkMode ? '' : 'bg-white'
            }`}
            style={isDarkMode ? {
              backgroundColor: 'rgba(38, 38, 38, 0.95)',
              borderRadius: '24px',
              boxShadow: '0 24px 48px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.06), 0 0 80px rgba(125, 211, 192, 0.08)',
            } : {
              borderRadius: '24px',
              boxShadow: '0 24px 48px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.04), 0 0 60px rgba(125, 211, 192, 0.06)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Deite voice */}
            <div className="px-6 pt-6 pb-2">
              <p className={`text-base font-medium ${isDarkMode ? 'text-[#7DD3C0]' : 'text-[#87A96B]'}`}>
                This is what you lived today.
              </p>
            </div>
            {/* Inner card: memory / snapshot – breathing room, soft edges, content as hero */}
            <div className="px-5 pb-5">
              <div
                className={`rounded-2xl overflow-hidden ${
                  isDarkMode ? 'bg-[#1e1e1e]' : 'bg-gray-50/90'
                }`}
                style={isDarkMode ? {
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.02)',
                } : {
                  border: '1px solid rgba(0, 0, 0, 0.04)',
                }}
              >
                {/* Identity strip – quiet support */}
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
                  <button
                    type="button"
                    onClick={() => setShareEditMode(true)}
                    className={`p-2 rounded-full transition-opacity hover:opacity-90 ${
                      isDarkMode ? 'text-gray-500 hover:bg-white/5' : 'text-gray-400 hover:bg-black/5'
                    }`}
                    title="Edit post text"
                  >
                    <Pencil className="w-3.5 h-3.5" strokeWidth={2} />
                  </button>
                </div>
                {/* Reflection content – hero */}
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
                        placeholder="Edit what you’ll share..."
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => setShareEditMode(false)}
                        className={`mt-3 text-sm font-medium ${isDarkMode ? 'text-[#7DD3C0]' : 'text-[#87A96B]'}`}
                      >
                        Done editing
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
            {/* Buttons – affirming primary, safe secondary */}
            <div className="px-5 pb-6 pt-1 flex flex-col gap-3">
              <button
                type="button"
                onClick={handleShareToHub}
                disabled={isSharingPost}
                className="w-full rounded-2xl py-3.5 font-medium text-[15px] text-white disabled:opacity-50 transition-all hover:opacity-95 active:scale-[0.99]"
                style={{
                  background: isDarkMode
                    ? 'linear-gradient(135deg, #7DD3C0 0%, #5fb8a8 100%)'
                    : 'linear-gradient(135deg, #87A96B 0%, #7a9a5c 100%)',
                  boxShadow: isDarkMode ? '0 4px 20px rgba(125, 211, 192, 0.35)' : '0 4px 16px rgba(134, 169, 107, 0.3)',
                }}
              >
                {isSharingPost ? 'Sharing…' : 'Share this moment'}
              </button>
              {/* Share to social apps */}
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
              <button
                type="button"
                onClick={() => !isSharingPost && setReflectionToShare(null)}
                disabled={isSharingPost}
                className={`w-full rounded-2xl py-3 font-medium text-sm disabled:opacity-50 transition-opacity ${
                  isDarkMode ? 'text-gray-400 hover:text-gray-300 hover:bg-white/5' : 'text-gray-500 hover:text-gray-700 hover:bg-black/5'
                }`}
              >
                Maybe later
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

