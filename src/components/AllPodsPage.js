import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { ArrowLeft, Users, Calendar, Sparkles, User, Sun, Moon, ChevronRight, X } from 'lucide-react';
import { getCurrentUser } from '../services/authService';
import firestoreService from '../services/firestoreService';
import CalendarPopup from './CalendarPopup';
import { getDateId, formatDateForDisplay } from '../utils/dateUtils';

export default function AllPodsPage() {
  const navigate = useNavigate();
  const { isDarkMode, toggleTheme } = useTheme();
  const [profilePicture, setProfilePicture] = useState(null);
  const [pods, setPods] = useState([]);
  const [filteredPods, setFilteredPods] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPod, setSelectedPod] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [podDays, setPodDays] = useState([]);

  // Load profile picture
  useEffect(() => {
    const loadProfilePicture = () => {
      const user = getCurrentUser();
      if (user) {
        const savedPicture = localStorage.getItem(`user_profile_picture_${user.uid}`);
        if (savedPicture) {
          setProfilePicture(savedPicture);
        } else {
          setProfilePicture(null);
        }
      }
    };

    loadProfilePicture();

    const handleStorageChange = (e) => {
      if (e.key && e.key.startsWith('user_profile_picture_')) {
        loadProfilePicture();
      }
    };

    const handleProfilePictureUpdate = () => {
      loadProfilePicture();
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('profilePictureUpdated', handleProfilePictureUpdate);
    
    const handleFocus = () => {
      loadProfilePicture();
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        loadProfilePicture();
      }
    };
    
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('profilePictureUpdated', handleProfilePictureUpdate);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Load all pods
  useEffect(() => {
    const loadPods = async () => {
      const user = getCurrentUser();
      if (!user) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        const result = await firestoreService.getAllPods(user.uid);
        if (result.success) {
          setPods(result.pods);
          setFilteredPods(result.pods);
          
          // Extract dates from pods for calendar indicators
          const daysWithPods = result.pods
            .filter(pod => pod.startDate)
            .map(pod => ({
              date: pod.startDate,
              hasReflection: !!pod.reflection
            }));
          setPodDays(daysWithPods);
        } else {
          console.error('Error loading pods:', result.error);
        }
      } catch (error) {
        console.error('Error loading pods:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadPods();
  }, []);

  // Filter pods based on selected date
  useEffect(() => {
    if (selectedDate) {
      const dateId = getDateId(selectedDate);
      const filtered = pods.filter(pod => pod.startDate === dateId);
      setFilteredPods(filtered);
    } else {
      setFilteredPods(pods);
    }
  }, [selectedDate, pods]);

  const handleProfileClick = () => {
    navigate('/profile');
  };

  const handleCalendarClick = async () => {
    setIsCalendarOpen(true);
    // Refresh pod days when opening calendar
    const user = getCurrentUser();
    if (user) {
      try {
        const result = await firestoreService.getAllPods(user.uid);
        if (result.success) {
          const daysWithPods = result.pods
            .filter(pod => pod.startDate)
            .map(pod => ({
              date: pod.startDate,
              hasReflection: !!pod.reflection
            }));
          setPodDays(daysWithPods);
        }
      } catch (error) {
        console.error('Error refreshing pod days:', error);
      }
    }
  };

  const handleDateSelect = (date) => {
    setSelectedDate(date);
    setIsCalendarOpen(false);
  };

  const handleClearDateFilter = () => {
    setSelectedDate(null);
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Ongoing';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return dateString;
    }
  };

  const formatDateRange = (startDate, endDate) => {
    const start = formatDate(startDate);
    const end = endDate ? formatDate(endDate) : 'Present';
    return `${start} - ${end}`;
  };

  const handlePodClick = (pod) => {
    setSelectedPod(pod);
  };

  const handleBackFromDetail = () => {
    setSelectedPod(null);
  };

  if (selectedPod) {
    return (
      <div
        className="min-h-screen px-6 py-8 pb-20 relative overflow-hidden slide-up"
        style={{
          background: isDarkMode ? "#202124" : "#FAFAF8"
        }}
      >
        <div className="relative z-10 max-w-sm mx-auto">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={handleBackFromDetail}
                className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  isDarkMode ? 'backdrop-blur-md' : 'bg-white'
                }`}
                style={isDarkMode ? {
                  backgroundColor: "rgba(42, 42, 45, 0.6)",
                  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                } : {
                  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
                }}
              >
                <ArrowLeft className={`w-5 h-5 ${isDarkMode ? 'text-white' : 'text-gray-800'}`} />
              </button>
              <div className="flex space-x-2">
                <div
                  onClick={toggleTheme}
                  className={`w-10 h-10 rounded-full flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity ${
                    isDarkMode ? 'backdrop-blur-md' : 'bg-white'
                  }`}
                  style={isDarkMode ? {
                    backgroundColor: "rgba(42, 42, 45, 0.6)",
                    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                  } : {
                    boxShadow: "0 2px 8px rgba(230, 179, 186, 0.15)",
                  }}
                >
                  {isDarkMode ?
                    <Sun className="w-5 h-5" style={{ color: "#8AB4F8" }} strokeWidth={1.5} /> :
                    <Moon className="w-5 h-5" style={{ color: "#E6B3BA" }} strokeWidth={1.5} />
                  }
                </div>
                <div
                  onClick={handleProfileClick}
                  className={`w-10 h-10 rounded-full flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity overflow-hidden ${
                    isDarkMode ? 'backdrop-blur-md' : 'bg-white'
                  }`}
                  style={isDarkMode ? {
                    backgroundColor: profilePicture ? "transparent" : "rgba(42, 42, 45, 0.6)",
                    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
                    border: profilePicture ? "none" : "1px solid rgba(255, 255, 255, 0.08)",
                  } : {
                    boxShadow: "0 2px 8px rgba(177, 156, 217, 0.15)",
                  }}
                >
                  {profilePicture ? (
                    <img 
                      src={profilePicture} 
                      alt="Profile" 
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-5 h-5" style={{ color: isDarkMode ? "#81C995" : "#B19CD9" }} strokeWidth={1.5} />
                  )}
                </div>
              </div>
            </div>
            <h1 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
              {selectedPod.name}
            </h1>
            <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {formatDateRange(selectedPod.startDate, selectedPod.endDate)}
            </p>
          </div>

          {/* Pod Details */}
          <div className="space-y-4">
            {/* Reflection Section */}
            {selectedPod.reflection ? (
              <div
                className={`rounded-2xl p-6 relative overflow-hidden ${
                  isDarkMode ? 'backdrop-blur-lg' : 'bg-white'
                }`}
                style={isDarkMode ? {
                  backgroundColor: "rgba(42, 42, 45, 0.6)",
                  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                } : {
                  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
                }}
              >
                <div className="flex items-center space-x-3 mb-4">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center"
                    style={{
                      backgroundColor: isDarkMode ? "#FDD663" : "#E6B3BA",
                      boxShadow: isDarkMode ? "0 4px 16px rgba(0, 0, 0, 0.15)" : "none",
                    }}
                  >
                    <Sparkles className="w-4 h-4" style={{ color: isDarkMode ? "#000" : "#fff" }} strokeWidth={2} />
                  </div>
                  <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                    Pod Reflection
                  </h2>
                </div>
                <p className={`text-sm leading-relaxed ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {selectedPod.reflection}
                </p>
              </div>
            ) : (
              <div
                className={`rounded-2xl p-6 relative overflow-hidden ${
                  isDarkMode ? 'backdrop-blur-lg' : 'bg-white'
                }`}
                style={isDarkMode ? {
                  backgroundColor: "rgba(42, 42, 45, 0.6)",
                  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                } : {
                  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
                }}
              >
                <p className={`text-sm text-center italic ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  No reflection available for this pod
                </p>
              </div>
            )}

            {/* Messages Section - Placeholder for future implementation */}
            <div
              className={`rounded-2xl p-6 relative overflow-hidden ${
                isDarkMode ? 'backdrop-blur-lg' : 'bg-white'
              }`}
              style={isDarkMode ? {
                backgroundColor: "rgba(42, 42, 45, 0.6)",
                boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
              } : {
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
              }}
            >
              <div className="flex items-center space-x-3 mb-4">
                <Users className={`w-5 h-5 ${isDarkMode ? 'text-[#8AB4F8]' : 'text-[#87A96B]'}`} />
                <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                  Pod Messages
                </h2>
              </div>
              <p className={`text-sm text-center italic ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Messages feature coming soon
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen px-6 py-8 pb-20 relative overflow-hidden slide-up"
      style={{
        background: isDarkMode ? "#202124" : "#FAFAF8"
      }}
    >
      <div className="relative z-10 max-w-sm mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => navigate('/pod')}
              className={`w-10 h-10 rounded-full flex items-center justify-center ${
                isDarkMode ? 'backdrop-blur-md' : 'bg-white'
              }`}
              style={isDarkMode ? {
                backgroundColor: "rgba(42, 42, 45, 0.6)",
                boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
              } : {
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
              }}
            >
              <ArrowLeft className={`w-5 h-5 ${isDarkMode ? 'text-white' : 'text-gray-800'}`} />
            </button>
            <div className="flex space-x-2">
              <div
                onClick={toggleTheme}
                className={`w-10 h-10 rounded-full flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity ${
                  isDarkMode ? 'backdrop-blur-md' : 'bg-white'
                }`}
                style={isDarkMode ? {
                  backgroundColor: "rgba(42, 42, 45, 0.6)",
                  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                } : {
                  boxShadow: "0 2px 8px rgba(230, 179, 186, 0.15)",
                }}
              >
                {isDarkMode ?
                  <Sun className="w-5 h-5" style={{ color: "#8AB4F8" }} strokeWidth={1.5} /> :
                  <Moon className="w-5 h-5" style={{ color: "#E6B3BA" }} strokeWidth={1.5} />
                }
              </div>
              <div
                onClick={handleProfileClick}
                className={`w-10 h-10 rounded-full flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity overflow-hidden ${
                  isDarkMode ? 'backdrop-blur-md' : 'bg-white'
                }`}
                style={isDarkMode ? {
                  backgroundColor: profilePicture ? "transparent" : "rgba(42, 42, 45, 0.6)",
                  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
                  border: profilePicture ? "none" : "1px solid rgba(255, 255, 255, 0.08)",
                } : {
                  boxShadow: "0 2px 8px rgba(177, 156, 217, 0.15)",
                }}
              >
                {profilePicture ? (
                  <img 
                    src={profilePicture} 
                    alt="Profile" 
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User className="w-5 h-5" style={{ color: isDarkMode ? "#81C995" : "#B19CD9" }} strokeWidth={1.5} />
                )}
              </div>
            </div>
          </div>
            <div className="flex items-center justify-between mb-2">
              <h1 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                All Pods
              </h1>
            </div>
            <p className={`text-sm mb-3 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              View your pod history and reflections
            </p>
            
            {/* Date Search */}
            <div className="mb-4">
              <div
                onClick={handleCalendarClick}
                className={`rounded-lg px-3 py-2 flex items-center justify-between cursor-pointer hover:opacity-80 transition-opacity ${
                  isDarkMode ? 'backdrop-blur-md' : 'bg-white'
                }`}
                style={isDarkMode ? {
                  backgroundColor: "rgba(42, 42, 45, 0.6)",
                  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                } : {
                  boxShadow: "0 2px 6px rgba(0, 0, 0, 0.08)",
                }}
              >
                <div className="flex items-center space-x-2">
                  <Calendar className="w-4 h-4" style={{ color: isDarkMode ? "#7DD3C0" : "#87A96B" }} />
                  <div>
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
                    className={`w-6 h-6 rounded-full flex items-center justify-center hover:opacity-80 transition-opacity ${
                      isDarkMode ? 'bg-gray-700' : 'bg-gray-200'
                    }`}
                  >
                    <X className={`w-3 h-3 ${isDarkMode ? 'text-white' : 'text-gray-600'}`} />
                  </button>
                )}
              </div>
            </div>
          </div>

        {/* Pods List */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="flex space-x-1 mb-3">
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
            <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Loading pods...</p>
          </div>
        ) : filteredPods.length === 0 ? (
          <div
            className={`rounded-2xl p-8 text-center ${
              isDarkMode ? 'backdrop-blur-lg' : 'bg-white'
            }`}
            style={isDarkMode ? {
              backgroundColor: "rgba(42, 42, 45, 0.6)",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            } : {
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
            }}
          >
            <Users className={`w-12 h-12 mx-auto mb-4 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`} />
            <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {selectedDate 
                ? `No pods found for ${formatDateForDisplay(selectedDate)}. Try selecting a different date.`
                : pods.length === 0
                  ? 'No pods yet. Start chatting in your pod to create your first pod entry!'
                  : 'No pods match your search criteria.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredPods.map((pod) => (
              <div
                key={pod.id}
                onClick={() => handlePodClick(pod)}
                className={`rounded-2xl p-5 relative overflow-hidden cursor-pointer transition-all hover:opacity-90 ${
                  isDarkMode ? 'backdrop-blur-lg' : 'bg-white'
                }`}
                style={isDarkMode ? {
                  backgroundColor: "rgba(42, 42, 45, 0.6)",
                  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                } : {
                  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
                }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className={`text-lg font-semibold mb-1 ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                      {pod.name}
                    </h3>
                    <div className="flex items-center space-x-2 mb-2">
                      <Calendar className={`w-4 h-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                      <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        {formatDateRange(pod.startDate, pod.endDate)}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className={`w-5 h-5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                </div>
                {pod.reflection ? (
                  <p className={`text-sm leading-relaxed line-clamp-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    {pod.reflection}
                  </p>
                ) : (
                  <p className={`text-xs italic ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    No reflection available
                  </p>
                )}
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
        chatDays={podDays}
      />
    </div>
  );
}

