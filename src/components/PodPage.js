import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { Users, MessageCircle, Heart, TrendingUp, User, Sun, Moon, Bot } from 'lucide-react';
import { getCurrentUser } from '../services/authService';

export default function PodPage() {
  const navigate = useNavigate();
  const { isDarkMode, toggleTheme } = useTheme();
  const [profilePicture, setProfilePicture] = useState(null);

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

    // Listen for storage changes and custom events (when profile picture is updated from ProfilePage)
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
    
    // Also check on focus and visibility change (when returning from ProfilePage)
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

  const handleProfileClick = () => {
    navigate('/profile');
  };

  return (
    <div
      className="min-h-screen px-6 py-8 pb-20 relative overflow-hidden slide-up"
      style={{
        background: isDarkMode
          ? "#202124"
          : "#FAFAF8"
      }}
    >
      <div className="absolute inset-0 overflow-hidden">
        {isDarkMode ? (
          // Dark mode decorative elements
          <>
            <div className="absolute top-20 left-16 opacity-15">
              <svg width="60" height="30" viewBox="0 0 60 30" fill="none" stroke="#7DD3C0" strokeWidth="0.5">
                <path d="M8 18c0-6 4-10 10-10s10 4 10 10c0 3-2 6-5 8H13c-3-2-5-5-5-8z" />
                <path d="M25 15c0-4 3-7 7-7s7 3 7 7c0 2-1 4-3 5H28c-2-1-3-3-3-5z" />
                <path d="M40 12c0-3 2-5 5-5s5 2 5 5c0 1.5-0.5 3-2 4H42c-1.5-1-2-2.5-2-4z" />
              </svg>
            </div>
            <div className="absolute top-40 right-20 opacity-12">
              <svg width="80" height="25" viewBox="0 0 80 25" fill="none" stroke="#D4AF37" strokeWidth="0.4">
                <path d="M5 15c0-5 3-8 8-8s8 3 8 8c0 2.5-1.5 5-4 6.5H9c-2.5-1.5-4-4-4-6.5z" />
                <path d="M20 12c0-4 2.5-6 6-6s6 2 6 6c0 2-1 4-2.5 5H22.5c-1.5-1-2.5-3-2.5-5z" />
              </svg>
            </div>
          </>
        ) : (
          // Light mode decorative elements
          <>
            <div className="absolute top-16 left-12 opacity-20">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#87A96B" strokeWidth="1">
                <path d="M12 2c-4 0-8 4-8 8 0 2 1 4 3 5l5-5V2z" />
                <path d="M12 2c4 0 8 4 8 8 0 2-1 4-3 5l-5-5V2z" />
              </svg>
            </div>
            <div className="absolute top-32 right-16 opacity-15">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#E6B3BA" strokeWidth="1">
                <ellipse cx="12" cy="8" rx="6" ry="4" />
                <path d="M12 12v8" />
              </svg>
            </div>
          </>
        )}
      </div>

      <div className="relative z-10 max-w-sm mx-auto">
        {/* Title Section with Profile */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-3">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{
                  backgroundColor: isDarkMode ? "#7DD3C0" : "#87A96B",
                  boxShadow: isDarkMode ? "0 4px 16px rgba(125, 211, 192, 0.3)" : "0 4px 12px rgba(134, 169, 107, 0.25)",
                }}
              >
                <Users className="w-6 h-6 text-white" strokeWidth={2} />
              </div>
              <h1 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                Pod
              </h1>
            </div>
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
          <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Your personal wellness pod
          </p>
        </div>

        {/* Pod Content */}
        <div className="space-y-4">
          {/* Welcome Card */}
          <div
            className={`rounded-2xl p-5 relative overflow-hidden ${
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
            <h2 className={`text-lg font-semibold mb-3 ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
              Welcome to Your Pod
            </h2>
            <p className={`text-sm leading-relaxed ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              This is your personal space for wellness and growth. Connect with your inner self and track your journey.
            </p>
          </div>

          {/* Quick Actions */}
          <div
            className={`rounded-2xl p-5 relative overflow-hidden ${
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
            <h2 className={`text-lg font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
              Quick Actions
            </h2>
            <div className="space-y-3">
              {[
                { icon: Heart, label: 'Daily Check-in', color: isDarkMode ? '#FDD663' : '#E6B3BA' },
                { icon: TrendingUp, label: 'View Progress', color: isDarkMode ? '#7DD3C0' : '#87A96B' },
                { icon: MessageCircle, label: 'Reflections', color: isDarkMode ? '#8AB4F8' : '#B19CD9' },
              ].map((action, index) => (
                <div
                  key={index}
                  className={`flex items-center space-x-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                    isDarkMode ? 'hover:bg-gray-800/30' : 'hover:bg-gray-50'
                  }`}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: action.color + '20' }}
                  >
                    <action.icon className="w-4 h-4" style={{ color: action.color }} />
                  </div>
                  <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    {action.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Group Message Section */}
          <div
            className={`rounded-2xl p-5 relative overflow-hidden ${
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
            <div className="flex items-center space-x-2 mb-4">
              <Users className={`w-5 h-5 ${isDarkMode ? 'text-[#8AB4F8]' : 'text-[#87A96B]'}`} />
              <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                Pod Group Chat
              </h2>
            </div>
            
            {/* Group Members */}
            <div className="flex items-center space-x-2 mb-4 pb-4 border-b" style={{ borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)' }}>
              {[
                { name: 'Alex', emoji: '👤', color: '#7DD3C0' },
                { name: 'Sam', emoji: '👤', color: '#FDD663' },
                { name: 'Jordan', emoji: '👤', color: '#8AB4F8' },
                { name: 'Taylor', emoji: '👤', color: '#E6B3BA' },
                { name: 'Casey', emoji: '👤', color: '#81C995' },
                { name: 'AI', emoji: '🤖', color: '#B19CD9' },
              ].map((member, index) => (
                <div
                  key={index}
                  className="flex flex-col items-center"
                  title={member.name}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs mb-1"
                    style={{
                      backgroundColor: isDarkMode ? member.color + '30' : member.color + '20',
                      border: `2px solid ${member.color}40`,
                    }}
                  >
                    {member.emoji}
                  </div>
                  <span className={`text-[10px] ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {member.name}
                  </span>
                </div>
              ))}
            </div>

            {/* Chat Messages */}
            <div className="space-y-3 max-h-64 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              {[
                { 
                  sender: 'Alex', 
                  message: 'Hey everyone! How are you all doing today? 🌟', 
                  time: '10:30 AM',
                  emoji: '👤',
                  color: '#7DD3C0'
                },
                { 
                  sender: 'AI', 
                  message: 'Hello! I\'m here to support everyone in their wellness journey. How can I help today?', 
                  time: '10:31 AM',
                  emoji: '🤖',
                  color: '#B19CD9'
                },
                { 
                  sender: 'Sam', 
                  message: 'I\'ve been practicing mindfulness this week and it\'s been amazing! 🧘‍♀️', 
                  time: '10:32 AM',
                  emoji: '👤',
                  color: '#FDD663'
                },
                { 
                  sender: 'Jordan', 
                  message: 'That\'s awesome Sam! I\'ve been struggling with stress lately. Any tips?', 
                  time: '10:33 AM',
                  emoji: '👤',
                  color: '#8AB4F8'
                },
                { 
                  sender: 'AI', 
                  message: 'Great question Jordan! Deep breathing exercises and short breaks can help. Would you like me to guide you through a quick 5-minute stress relief exercise?', 
                  time: '10:34 AM',
                  emoji: '🤖',
                  color: '#B19CD9'
                },
                { 
                  sender: 'Taylor', 
                  message: 'I\'d love to join that too! 🙋‍♀️', 
                  time: '10:35 AM',
                  emoji: '👤',
                  color: '#E6B3BA'
                },
                { 
                  sender: 'Casey', 
                  message: 'Count me in! This pod is so supportive 💚', 
                  time: '10:36 AM',
                  emoji: '👤',
                  color: '#81C995'
                },
              ].map((msg, index) => (
                <div
                  key={index}
                  className={`flex items-start space-x-2 ${
                    msg.sender === 'AI' ? 'bg-opacity-20' : ''
                  }`}
                  style={msg.sender === 'AI' ? {
                    backgroundColor: isDarkMode ? 'rgba(177, 156, 217, 0.15)' : 'rgba(177, 156, 217, 0.1)',
                    padding: '8px',
                    borderRadius: '12px',
                  } : {}}
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs flex-shrink-0"
                    style={{
                      backgroundColor: isDarkMode ? msg.color + '30' : msg.color + '20',
                      border: `2px solid ${msg.color}40`,
                    }}
                  >
                    {msg.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-1">
                      <span className={`text-xs font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                        {msg.sender}
                      </span>
                      <span className={`text-[10px] ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                        {msg.time}
                      </span>
                    </div>
                    <p className={`text-sm leading-relaxed ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      {msg.message}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Input Area */}
            <div className="mt-4 pt-4 border-t" style={{ borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)' }}>
              <div className="flex items-center space-x-2">
                <div
                  className={`flex-1 rounded-lg px-3 py-2 ${
                    isDarkMode ? 'bg-gray-800/50' : 'bg-gray-100'
                  }`}
                >
                  <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Type a message...
                  </span>
                </div>
                <button
                  className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    isDarkMode ? 'bg-[#8AB4F8]' : 'bg-[#87A96B]'
                  }`}
                  style={{
                    boxShadow: isDarkMode ? "0 2px 8px rgba(138, 180, 248, 0.3)" : "0 2px 8px rgba(134, 169, 107, 0.3)",
                  }}
                >
                  <MessageCircle className="w-5 h-5 text-white" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

