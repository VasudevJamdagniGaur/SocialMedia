import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { Users, MessageCircle, Heart, TrendingUp, User, Sun, Moon, Send, X } from 'lucide-react';
import { getCurrentUser } from '../services/authService';

export default function CommunityPage() {
  const navigate = useNavigate();
  const { isDarkMode, toggleTheme } = useTheme();
  const [profilePicture, setProfilePicture] = useState(null);
  const [likes, setLikes] = useState(24);
  const [isLiked, setIsLiked] = useState(false);
  const [comments, setComments] = useState([
    { id: 1, author: 'Alex', text: 'Great post! Keep it up! 🌟', time: '1 hour ago' },
    { id: 2, author: 'Sam', text: 'Mindfulness has changed my life too!', time: '45 mins ago' },
  ]);
  const [showComments, setShowComments] = useState(false);
  const [newComment, setNewComment] = useState('');

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

  const handleLike = () => {
    if (isLiked) {
      setLikes(likes - 1);
      setIsLiked(false);
    } else {
      setLikes(likes + 1);
      setIsLiked(true);
    }
  };

  const handleCommentClick = () => {
    setShowComments(!showComments);
  };

  const handleAddComment = () => {
    if (newComment.trim()) {
      const user = getCurrentUser();
      const author = user?.displayName || 'You';
      const newCommentObj = {
        id: comments.length + 1,
        author: author,
        text: newComment.trim(),
        time: 'Just now'
      };
      setComments([...comments, newCommentObj]);
      setNewComment('');
    }
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
                  backgroundColor: isDarkMode ? "#8AB4F8" : "#87A96B",
                  boxShadow: isDarkMode ? "0 4px 16px rgba(138, 180, 248, 0.3)" : "0 4px 12px rgba(134, 169, 107, 0.25)",
                }}
              >
                <Users className="w-6 h-6 text-white" strokeWidth={2} />
              </div>
              <h1 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                Community
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
            Connect with others on their wellness journey
          </p>
        </div>

        {/* Community Cards */}
        <div className="space-y-4">
          {/* Community Stats Card */}
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
              Community Stats
            </h2>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <div className={`text-2xl font-bold ${isDarkMode ? 'text-[#8AB4F8]' : 'text-[#87A96B]'}`}>
                  1.2K
                </div>
                <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Active Members
                </div>
              </div>
              <div className="text-center">
                <div className={`text-2xl font-bold ${isDarkMode ? 'text-[#7DD3C0]' : 'text-[#E6B3BA]'}`}>
                  456
                </div>
                <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Posts Today
                </div>
              </div>
              <div className="text-center">
                <div className={`text-2xl font-bold ${isDarkMode ? 'text-[#FDD663]' : 'text-[#B19CD9]'}`}>
                  89
                </div>
                <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Existing Pods
                </div>
              </div>
            </div>
          </div>

          {/* Featured Post Card */}
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
            <div className="flex items-start space-x-3 mb-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                style={{
                  backgroundColor: isDarkMode ? "#7DD3C0" : "#E6B3BA",
                }}
              >
                <span className="text-lg">👤</span>
              </div>
              <div className="flex-1">
                <div className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                  Wellness Warrior
                </div>
                <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  2 hours ago
                </div>
              </div>
            </div>
            <p className={`text-sm leading-relaxed mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              "Today I practiced mindfulness for 10 minutes and it made such a difference in my day. Remember, small steps lead to big changes! 🌿"
            </p>
            <div className="flex items-center space-x-4">
              <button 
                onClick={handleLike}
                className="flex items-center space-x-1 transition-colors hover:opacity-80"
              >
                <Heart 
                  className={`w-4 h-4 transition-colors ${
                    isLiked 
                      ? (isDarkMode ? 'text-red-500 fill-red-500' : 'text-red-500 fill-red-500')
                      : (isDarkMode ? 'text-gray-400' : 'text-gray-500')
                  }`} 
                />
                <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {likes}
                </span>
              </button>
              <button 
                onClick={handleCommentClick}
                className="flex items-center space-x-1 transition-colors hover:opacity-80"
              >
                <MessageCircle className={`w-4 h-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {comments.length}
                </span>
              </button>
            </div>

            {/* Comments Section */}
            {showComments && (
              <div className="mt-4 pt-4 border-t" style={{ borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)' }}>
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                      Comments ({comments.length})
                    </h3>
                    <button
                      onClick={() => setShowComments(false)}
                      className={`p-1 rounded-full hover:opacity-80 transition-opacity ${
                        isDarkMode ? 'hover:bg-gray-800/50' : 'hover:bg-gray-100'
                      }`}
                    >
                      <X className={`w-4 h-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                    </button>
                  </div>
                  
                  {/* Comments List */}
                  <div className="space-y-3 max-h-48 overflow-y-auto mb-3" style={{ scrollbarWidth: 'thin' }}>
                    {comments.map((comment) => (
                      <div key={comment.id} className="flex items-start space-x-2">
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs"
                          style={{
                            backgroundColor: isDarkMode ? "#7DD3C0" + '30' : "#E6B3BA" + '20',
                          }}
                        >
                          <span>👤</span>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-1">
                            <span className={`text-xs font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                              {comment.author}
                            </span>
                            <span className={`text-[10px] ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                              {comment.time}
                            </span>
                          </div>
                          <p className={`text-xs leading-relaxed ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            {comment.text}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Add Comment Input */}
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          handleAddComment();
                        }
                      }}
                      placeholder="Add a comment..."
                      className={`flex-1 rounded-lg px-3 py-2 text-xs border-none outline-none ${
                        isDarkMode 
                          ? 'bg-gray-800/50 text-white placeholder-gray-500' 
                          : 'bg-gray-100 text-gray-800 placeholder-gray-500'
                      }`}
                    />
                    <button
                      onClick={handleAddComment}
                      disabled={!newComment.trim()}
                      className={`w-8 h-8 rounded-lg flex items-center justify-center transition-opacity ${
                        newComment.trim()
                          ? (isDarkMode ? 'bg-[#8AB4F8]' : 'bg-[#87A96B]')
                          : (isDarkMode ? 'bg-gray-700 opacity-50' : 'bg-gray-300 opacity-50')
                      }`}
                    >
                      <Send className="w-3 h-3 text-white" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Trending Topics Card */}
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
              <TrendingUp className={`w-5 h-5 ${isDarkMode ? 'text-[#FDD663]' : 'text-[#87A96B]'}`} />
              <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                Hot Tea ☕🔥
              </h2>
            </div>
            <div className="space-y-2">
              {['Mindfulness Tips', 'Daily Gratitude', 'Stress Management', 'Self-Care Routines'].map((topic, index) => (
                <div
                  key={index}
                  className={`px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                    isDarkMode ? 'hover:bg-gray-800/30' : 'hover:bg-gray-50'
                  }`}
                >
                  <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    #{topic}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

