import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { ArrowLeft, Zap, Check, Calendar, X } from 'lucide-react';
import { getCurrentUser } from '../services/authService';
import firestoreService from '../services/firestoreService';
import { getDateId, formatDateForDisplay } from '../utils/dateUtils';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

