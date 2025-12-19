import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { ArrowLeft, Sparkles, Check, Calendar, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { getCurrentUser } from '../services/authService';
import firestoreService from '../services/firestoreService';
import { formatDateForDisplay, getDateId } from '../utils/dateUtils';
import CalendarPopup from './CalendarPopup';

export default function AllReflectionsPage() {
  const navigate = useNavigate();
  const { isDarkMode } = useTheme();
  const [reflections, setReflections] = useState([]);
  const [filteredReflections, setFilteredReflections] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [reflectionDays, setReflectionDays] = useState([]);

  // Format date for display (e.g., "8 October 2025 • Wed, 3:54 pm")
  const formatReflectionDate = (reflectionItem) => {
    if (!reflectionItem) return '';
    try {
      // Use createdAt if available (has actual time), otherwise use dateObj or date
      let date = reflectionItem.createdAt || reflectionItem.dateObj;
      
      if (!date) {
        // Fallback to parsing date string
        const dateString = reflectionItem.date;
        if (dateString && dateString.includes('-')) {
          const [year, month, day] = dateString.split('-');
          date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        } else if (dateString) {
          date = new Date(dateString);
        } else {
          return '';
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

  // Load all reflections
  useEffect(() => {
    const loadReflections = async () => {
      const user = getCurrentUser();
      if (!user) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        
        const allReflections = [];
        
        // Get all pod reflections from podReflections collection
        const podReflectionsResult = await firestoreService.getAllPodReflections(user.uid);
        if (podReflectionsResult.success && podReflectionsResult.reflections) {
          podReflectionsResult.reflections.forEach(ref => {
            let reflectionDate;
            try {
              if (ref.dateId && ref.dateId.includes('-')) {
                const [year, month, day] = ref.dateId.split('-');
                reflectionDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
              } else {
                reflectionDate = ref.createdAt || new Date();
              }
            } catch (e) {
              reflectionDate = ref.createdAt || new Date();
            }
            
            allReflections.push({
              id: ref.id,
              date: ref.dateId || (ref.createdAt ? getDateId(ref.createdAt) : getDateId(new Date())),
              dateObj: reflectionDate,
              reflection: ref.reflection,
              createdAt: ref.createdAt || reflectionDate
            });
          });
        }
        
        // Also get all pods with reflections (as backup/alternative source)
        const result = await firestoreService.getAllPods(user.uid);
        if (result.success && result.pods) {
          // Process pods with reflections
          result.pods
            .filter(pod => pod.reflection && pod.startDate)
            .forEach(pod => {
              // Check if this reflection already exists from podReflections
              const exists = allReflections.some(r => r.date === pod.startDate);
              if (!exists) {
              // Create date object from startDate
              let reflectionDate;
              try {
                if (pod.startDate.includes('-')) {
                  const [year, month, day] = pod.startDate.split('-');
                  reflectionDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                } else {
                  reflectionDate = new Date(pod.startDate);
                }
              } catch (e) {
                reflectionDate = new Date();
              }
                
                // Handle createdAt timestamp properly
                let createdAt = pod.createdAt;
                if (createdAt && typeof createdAt.toDate === 'function') {
                  createdAt = createdAt.toDate();
                } else if (!createdAt || !(createdAt instanceof Date)) {
                  createdAt = reflectionDate;
                }
              
              allReflections.push({
                id: pod.id || pod.startDate,
                date: pod.startDate,
                dateObj: reflectionDate,
                reflection: pod.reflection,
                  createdAt: createdAt
              });
              }
            });
        }
          
        // Also get current reflection if it exists and not already in list
          const currentReflectionResult = await firestoreService.getPodReflection(user.uid);
          if (currentReflectionResult.success && currentReflectionResult.reflection) {
            const today = new Date();
          const todayId = getDateId(today);
            
            // Check if today's reflection is already in the list
            const todayExists = allReflections.some(r => r.date === todayId);
            if (!todayExists) {
            let createdAt = currentReflectionResult.createdAt;
            if (createdAt && typeof createdAt.toDate === 'function') {
              createdAt = createdAt.toDate();
            } else if (!createdAt) {
              createdAt = today;
            }
            
              allReflections.push({
                id: 'current',
              date: currentReflectionResult.dateId || todayId,
                dateObj: today,
                reflection: currentReflectionResult.reflection,
              createdAt: createdAt
              });
          }
        }
        
        // Sort by date (newest first)
        allReflections.sort((a, b) => {
          const dateA = a.createdAt?.getTime() || a.dateObj?.getTime() || 0;
          const dateB = b.createdAt?.getTime() || b.dateObj?.getTime() || 0;
          return dateB - dateA;
        });
        
        // Extract reflection days for calendar
        const daysWithReflections = allReflections.map(r => ({
          date: r.date,
          hasReflection: true
        }));
        setReflectionDays(daysWithReflections);
        
        setReflections(allReflections);
        setFilteredReflections(allReflections);
      } catch (error) {
        console.error('Error loading reflections:', error);
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

  const handleDateSelect = (date) => {
    setSelectedDate(date);
    setIsCalendarOpen(false);
  };

  const handleClearDateFilter = () => {
    setSelectedDate(null);
  };

  const getCurrentReflectionIndex = () => {
    if (!selectedDate || reflections.length === 0) return -1;
    const currentDateId = getDateId(selectedDate);
    return reflections.findIndex(r => r.date === currentDateId);
  };

  const handlePreviousDate = () => {
    const currentIndex = getCurrentReflectionIndex();
    if (currentIndex > 0) {
      const prevReflection = reflections[currentIndex - 1];
      if (prevReflection && prevReflection.dateObj) {
        setSelectedDate(prevReflection.dateObj);
      }
    }
  };

  const handleNextDate = () => {
    const currentIndex = getCurrentReflectionIndex();
    if (currentIndex >= 0 && currentIndex < reflections.length - 1) {
      const nextReflection = reflections[currentIndex + 1];
      if (nextReflection && nextReflection.dateObj) {
        setSelectedDate(nextReflection.dateObj);
      }
    }
  };

  const canGoPrevious = () => {
    const currentIndex = getCurrentReflectionIndex();
    return currentIndex > 0;
  };

  const canGoNext = () => {
    const currentIndex = getCurrentReflectionIndex();
    return currentIndex >= 0 && currentIndex < reflections.length - 1;
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
            onClick={() => navigate('/pod')}
            className={`w-10 h-10 rounded-full flex items-center justify-center ${
              isDarkMode ? 'hover:bg-gray-800/50' : 'hover:bg-gray-100'
            } transition-colors`}
          >
            <ArrowLeft className={`w-5 h-5 ${isDarkMode ? 'text-white' : 'text-gray-800'}`} />
          </button>
          <div className="flex items-center space-x-2">
            <Sparkles className={`w-5 h-5 ${isDarkMode ? 'text-[#FDD663]' : 'text-[#E6B3BA]'}`} />
            <h1 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
              Reflections
            </h1>
          </div>
        </div>
        <p className={`text-sm ml-14 mb-3 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          All your crew reflections
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

        {/* Date Navigation (when date is selected) */}
        {selectedDate && filteredReflections.length > 0 && (
          <div className="ml-14 mb-4 flex items-center justify-center space-x-4">
            <button
              onClick={handlePreviousDate}
              disabled={!canGoPrevious()}
              className={`p-2 rounded-full transition-opacity ${
                canGoPrevious()
                  ? `hover:opacity-80 ${isDarkMode ? 'hover:bg-gray-800/50' : 'hover:bg-gray-100'}`
                  : 'opacity-30 cursor-not-allowed'
              }`}
            >
              <ChevronLeft className={`w-5 h-5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`} />
            </button>
            <div className={`text-base font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
              {formatDateForDisplay(selectedDate)}
            </div>
            <button
              onClick={handleNextDate}
              disabled={!canGoNext()}
              className={`p-2 rounded-full transition-opacity ${
                canGoNext()
                  ? `hover:opacity-80 ${isDarkMode ? 'hover:bg-gray-800/50' : 'hover:bg-gray-100'}`
                  : 'opacity-30 cursor-not-allowed'
              }`}
            >
              <ChevronRight className={`w-5 h-5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`} />
            </button>
          </div>
        )}
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
            {selectedDate ? 'No reflection found for the selected date.' : 'No reflections yet. Start chatting in your crew to generate reflections!'}
          </p>
        </div>
      ) : (
        <div className="space-y-3 max-w-sm mx-auto">
          {filteredReflections.map((reflection) => (
            <div
              key={reflection.id}
              className={`rounded-2xl p-4 relative overflow-hidden ${
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
                  <div className={`text-xs font-medium mb-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    {formatReflectionDate(reflection)}
                  </div>
                  <p className={`text-sm leading-relaxed whitespace-pre-wrap break-words ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
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
    </div>
  );
}

