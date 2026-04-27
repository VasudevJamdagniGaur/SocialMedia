import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { ArrowLeft, Zap, Check, Calendar, X, Share2, Sun, Moon } from 'lucide-react';
import { getCurrentUser } from '../services/authService';
import firestoreService from '../services/firestoreService';
import { getDateId, formatDateForDisplay } from '../utils/dateUtils';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import CalendarPopup from './CalendarPopup';
import ListSkeleton from './skeleton/ListSkeleton';
import Skeleton from './skeleton/Skeleton';

export default function AllDayReflectionsPage() {
  const navigate = useNavigate();
  const { isDarkMode, toggleTheme } = useTheme();
  const [reflections, setReflections] = useState([]);
  const [filteredReflections, setFilteredReflections] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const SELECTED_DATE_SESSION_KEY = 'dashboard_selected_date_iso';
  const [selectedDate, setSelectedDate] = useState(() => {
    try {
      if (typeof sessionStorage !== 'undefined') {
        const saved = sessionStorage.getItem(SELECTED_DATE_SESSION_KEY);
        if (saved) {
          const d = new Date(saved);
          if (!Number.isNaN(d.getTime())) return d;
        }
      }
    } catch {
      // ignore
    }
    return new Date();
  });
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [reflectionDays, setReflectionDays] = useState([]);
  const [selectedReflection, setSelectedReflection] = useState(null);
  const [moodData, setMoodData] = useState(null);
  const [isLoadingMood, setIsLoadingMood] = useState(false);
  const [profilePicture, setProfilePicture] = useState(null);

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

    // Persist so Dashboard keeps the same selected date after user navigates back.
    try {
      if (typeof sessionStorage !== 'undefined' && date) {
        sessionStorage.setItem(SELECTED_DATE_SESSION_KEY, date.toISOString());
      }
    } catch (_) {
      // ignore
    }
    
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
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(SELECTED_DATE_SESSION_KEY);
      }
    } catch (_) {
      // ignore
    }
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

  return (
    <div
      className="min-h-screen relative overflow-hidden"
      style={{
        background: isDarkMode ? THREADS.bg : '#B5C4AE',
        paddingTop: 0,
        paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div className="relative z-10 mx-auto w-full max-w-[600px] px-4 sm:px-5">
        {/* Sticky header - same layout as Community: Theme | Logo/Title | Profile */}
        <header
          className="sticky top-0 z-20 flex items-center justify-between px-1 py-3 min-h-[52px]"
          style={{
            paddingTop: 'max(12px, env(safe-area-inset-top, 0px))',
            background: isDarkMode ? THREADS.bg : 'rgba(250,250,248,0.95)',
            borderBottom: `1px solid ${isDarkMode ? THREADS.divider : 'rgba(0,0,0,0.08)'}`,
          }}
        >
          <button
            onClick={() => navigate('/dashboard')}
            className="w-10 h-10 rounded-full flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity flex-shrink-0"
            style={isDarkMode ? { background: THREADS.bgSecondary } : { background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" style={{ color: isDarkMode ? THREADS.text : '#374151' }} strokeWidth={1.5} />
          </button>
          <div className="flex items-center justify-center gap-2 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: isDarkMode ? THREADS.bgSecondary : '#fff', boxShadow: isDarkMode ? 'none' : '0 2px 6px rgba(0,0,0,0.06)' }}>
              <Zap className="w-4 h-4" style={{ color: isDarkMode ? THREADS.accent : '#87A96B' }} strokeWidth={1.5} />
            </div>
            <h1 className="text-lg font-semibold truncate" style={{ color: isDarkMode ? THREADS.text : '#1f2937' }}>
              Day's Reflect
            </h1>
          </div>
          <button
            onClick={handleCalendarClick}
            className="w-10 h-10 rounded-full flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity flex-shrink-0"
            style={isDarkMode ? { background: THREADS.bgSecondary } : { background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
            aria-label="Search by date"
          >
            <Calendar className="w-5 h-5" style={{ color: isDarkMode ? THREADS.accent : '#87A96B' }} strokeWidth={1.5} />
          </button>
        </header>

        {/* Subtitle - no search bar, date filter via header calendar icon */}
        <p className="text-sm py-2 px-1" style={{ color: isDarkMode ? THREADS.textSecondary : '#6b7280' }}>
          All your day reflections
        </p>

      {/* Reflections List - Community-style flat cards with dividers */}
      {isLoading ? (
        <div className="py-2">
          <ListSkeleton count={5} />
        </div>
      ) : filteredReflections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 px-4">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
            style={{ background: isDarkMode ? THREADS.bgSecondary : 'rgba(255,255,255,0.8)', border: `1px solid ${isDarkMode ? THREADS.divider : 'rgba(0,0,0,0.08)'}` }}
          >
            <Zap className="w-8 h-8" style={{ color: isDarkMode ? THREADS.accent : '#87A96B' }} />
          </div>
          <p className="text-sm text-center" style={{ color: isDarkMode ? THREADS.textSecondary : '#6b7280' }}>
            {selectedDate ? 'No reflection found for the selected date.' : 'No reflections yet. Start chatting with Detea to generate reflections!'}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ background: isDarkMode ? THREADS.bg : '#fff', border: `1px solid ${isDarkMode ? THREADS.divider : 'rgba(0,0,0,0.08)'}` }}>
          {filteredReflections.map((reflection, index) => (
            <div
              key={reflection.id}
              onClick={() => handleReflectionClick(reflection)}
              className="px-4 py-4 cursor-pointer transition-[background] duration-150 hover:bg-white/[0.03] active:bg-white/[0.05]"
              style={{
                borderTop: index === 0 ? 'none' : `1px solid ${THREADS.divider}`,
              }}
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  <Check className="w-4 h-4" style={{ color: isDarkMode ? THREADS.accent : '#22c55e' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium mb-1" style={{ color: isDarkMode ? THREADS.textSecondary : '#6b7280' }}>
                    {formatReflectionDate(reflection)}
                  </div>
                  <p className="text-[15px] leading-snug line-clamp-3" style={{ color: isDarkMode ? THREADS.text : '#1f2937' }}>
                    {reflection.reflection}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); navigate('/share-reflection', { state: { reflectionToShare: reflection } }); }}
                  className="flex-shrink-0 p-2 rounded-full transition-opacity hover:opacity-80"
                  title="Share to HUB"
                >
                  <Share2 className="w-4 h-4" style={{ color: THREADS.accent }} strokeWidth={2} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      </div>

      {/* Calendar Popup */}
      <CalendarPopup
        isOpen={isCalendarOpen}
        onClose={() => setIsCalendarOpen(false)}
        selectedDate={selectedDate || new Date()}
        onDateSelect={handleDateSelect}
        chatDays={reflectionDays}
      />

      {/* Reflection Detail Modal - Community-style */}
      {selectedReflection && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
          onClick={() => {
            setSelectedReflection(null);
            setMoodData(null);
          }}
        >
          <div
            className="rounded-2xl p-6 w-full max-w-sm relative max-h-[90vh] overflow-y-auto"
            style={{
              background: isDarkMode ? THREADS.bgSecondary : '#fff',
              border: `1px solid ${isDarkMode ? THREADS.divider : 'rgba(0,0,0,0.08)'}`,
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ background: isDarkMode ? THREADS.accent + '30' : 'rgba(135,169,107,0.2)' }}
                >
                  <Zap className="w-4 h-4" style={{ color: isDarkMode ? THREADS.accent : '#87A96B' }} />
                </div>
                <h2 className="text-lg font-semibold" style={{ color: isDarkMode ? THREADS.text : '#1f2937' }}>
                  Day's Reflect
                </h2>
              </div>
              <button
                onClick={() => { setSelectedReflection(null); setMoodData(null); }}
                className="p-1.5 rounded-full hover:opacity-80 transition-opacity"
                style={{ color: isDarkMode ? THREADS.textSecondary : '#6b7280' }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Date */}
            <div className="text-xs font-medium mb-4" style={{ color: isDarkMode ? THREADS.textSecondary : '#6b7280' }}>
              {formatReflectionDate(selectedReflection)}
            </div>

            {/* Mood Metrics */}
            {isLoadingMood ? (
              <div className="mb-4 py-2">
                <Skeleton variant="text" className="h-3 w-32 mx-auto rounded-full" />
              </div>
            ) : moodData ? (
              <div className="mb-6 space-y-3">
                <h3 className="text-sm font-semibold mb-3" style={{ color: isDarkMode ? THREADS.text : '#374151' }}>
                  Emotional Metrics
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {/* Happiness */}
                  <div className="p-3 rounded-lg" style={{ background: isDarkMode ? 'rgba(255,255,255,0.06)' : '#f3f4f6' }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium" style={{ color: isDarkMode ? THREADS.textSecondary : '#6b7280' }}>Happiness</span>
                      <span className="text-sm font-bold" style={{ color: THREADS.accent }}>{moodData.happiness}%</span>
                    </div>
                    <div className="h-2 rounded-full" style={{ background: isDarkMode ? THREADS.divider : '#e5e7eb' }}>
                      <div className="h-2 rounded-full transition-all" style={{ width: `${moodData.happiness}%`, backgroundColor: THREADS.accent }} />
                    </div>
                  </div>
                  {/* Energy */}
                  <div className="p-3 rounded-lg" style={{ background: isDarkMode ? 'rgba(255,255,255,0.06)' : '#f3f4f6' }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium" style={{ color: isDarkMode ? THREADS.textSecondary : '#6b7280' }}>Energy</span>
                      <span className="text-sm font-bold" style={{ color: THREADS.accent }}>{moodData.energy}%</span>
                    </div>
                    <div className="h-2 rounded-full" style={{ background: isDarkMode ? THREADS.divider : '#e5e7eb' }}>
                      <div className="h-2 rounded-full transition-all" style={{ width: `${moodData.energy}%`, backgroundColor: THREADS.accent }} />
                    </div>
                  </div>
                  {/* Anxiety */}
                  <div className="p-3 rounded-lg" style={{ background: isDarkMode ? 'rgba(255,255,255,0.06)' : '#f3f4f6' }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium" style={{ color: isDarkMode ? THREADS.textSecondary : '#6b7280' }}>Anxiety</span>
                      <span className="text-sm font-bold" style={{ color: THREADS.accent }}>{moodData.anxiety}%</span>
                    </div>
                    <div className="h-2 rounded-full" style={{ background: isDarkMode ? THREADS.divider : '#e5e7eb' }}>
                      <div className="h-2 rounded-full transition-all" style={{ width: `${moodData.anxiety}%`, backgroundColor: THREADS.accent }} />
                    </div>
                  </div>
                  {/* Stress */}
                  <div className="p-3 rounded-lg" style={{ background: isDarkMode ? 'rgba(255,255,255,0.06)' : '#f3f4f6' }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium" style={{ color: isDarkMode ? THREADS.textSecondary : '#6b7280' }}>Stress</span>
                      <span className="text-sm font-bold" style={{ color: THREADS.accent }}>{moodData.stress}%</span>
                    </div>
                    <div className="h-2 rounded-full" style={{ background: isDarkMode ? THREADS.divider : '#e5e7eb' }}>
                      <div className="h-2 rounded-full transition-all" style={{ width: `${moodData.stress}%`, backgroundColor: THREADS.accent }} />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mb-6 p-3 rounded-lg" style={{ background: isDarkMode ? 'rgba(255,255,255,0.04)' : '#f3f4f6' }}>
                <p className="text-xs text-center" style={{ color: THREADS.textSecondary }}>No emotional metrics available for this date</p>
              </div>
            )}

            {/* Reflection Content */}
            <div className="mb-4">
              <h3 className="text-sm font-semibold mb-2" style={{ color: isDarkMode ? THREADS.text : '#374151' }}>Reflection</h3>
              <div className="p-4 rounded-lg" style={{ background: isDarkMode ? 'rgba(255,255,255,0.06)' : '#f3f4f6', border: `1px solid ${isDarkMode ? THREADS.divider : 'rgba(0,0,0,0.08)'}` }}>
                <p className="text-sm leading-relaxed" style={{ color: isDarkMode ? THREADS.text : '#374151' }}>{selectedReflection.reflection}</p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/share-reflection', { state: { reflectionToShare: selectedReflection } })}
                className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl py-3 px-4 text-sm font-semibold transition-all hover:opacity-90"
                style={{ background: THREADS.accent, color: '#fff', border: `1px solid ${THREADS.accent}` }}
              >
                <Share2 className="w-4 h-4" strokeWidth={2} />
                Share to HUB
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

