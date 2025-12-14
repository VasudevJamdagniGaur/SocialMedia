import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { ArrowLeft, Sparkles, Check } from 'lucide-react';
import { getCurrentUser } from '../services/authService';
import firestoreService from '../services/firestoreService';
import { formatDateForDisplay, getDateId } from '../utils/dateUtils';

export default function AllReflectionsPage() {
  const navigate = useNavigate();
  const { isDarkMode } = useTheme();
  const [reflections, setReflections] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

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
        
        setReflections(allReflections);
      } catch (error) {
        console.error('Error loading reflections:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadReflections();
  }, []);

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
        <p className={`text-sm ml-14 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          All your crew reflections
        </p>
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
      ) : reflections.length === 0 ? (
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
            No reflections yet. Start chatting in your crew to generate reflections!
          </p>
        </div>
      ) : (
        <div className="space-y-3 max-w-sm mx-auto">
          {reflections.map((reflection) => (
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
    </div>
  );
}

