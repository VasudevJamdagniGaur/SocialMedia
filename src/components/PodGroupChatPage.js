import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { ArrowLeft, Send, Users, User, Image as ImageIcon, X } from 'lucide-react';
import { getCurrentUser } from '../services/authService';

export default function PodGroupChatPage() {
  const navigate = useNavigate();
  const { isDarkMode } = useTheme();
  const [inputMessage, setInputMessage] = useState('');
  const [profilePicture, setProfilePicture] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

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

  const user = getCurrentUser();
  const userName = user?.displayName || 'You';
  
  const groupMembers = [
    { 
      name: userName, 
      emoji: '👤', 
      color: isDarkMode ? '#8AB4F8' : '#87A96B',
      isCurrentUser: true,
      profilePicture: profilePicture
    },
    { name: 'Alex', emoji: '👤', color: '#7DD3C0' },
    { name: 'Sam', emoji: '👤', color: '#FDD663' },
    { name: 'Jordan', emoji: '👤', color: '#8AB4F8' },
    { name: 'Taylor', emoji: '👤', color: '#E6B3BA' },
    { name: 'AI', emoji: '🤖', color: '#B19CD9', avatar: '/ai-avatar.png' },
  ];

  const messages = [
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
  ];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleImageSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        alert('Image size should be less than 10MB');
        e.target.value = '';
        return;
      }
      
      if (!file.type.startsWith('image/')) {
        alert('Please select a valid image file');
        e.target.value = '';
        return;
      }
      
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result;
        if (result) {
          setSelectedImage(result);
        }
      };
      reader.onerror = () => {
        alert('Failed to read image file');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSend = () => {
    if (inputMessage.trim() || selectedImage) {
      // Handle send message logic here
      // You can add the message with image to your messages array or send to backend
      console.log('Sending message:', { text: inputMessage, image: selectedImage });
      setInputMessage('');
      setSelectedImage(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col relative overflow-hidden"
      style={{
        background: isDarkMode
          ? "#131313"
          : "#FAFAF8"
      }}
    >
      {/* Header */}
      <div
        className={`sticky top-0 z-10 px-4 py-3 flex items-center space-x-3 ${
          isDarkMode ? 'backdrop-blur-lg' : 'bg-white'
        }`}
        style={isDarkMode ? {
          backgroundColor: "#262626",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        } : {
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)",
          borderBottom: "1px solid rgba(0, 0, 0, 0.05)",
        }}
      >
        <button
          onClick={() => navigate('/pod')}
          className={`w-10 h-10 rounded-full flex items-center justify-center ${
            isDarkMode ? 'hover:bg-gray-800/50' : 'hover:bg-gray-100'
          } transition-colors`}
        >
          <ArrowLeft className={`w-5 h-5 ${isDarkMode ? 'text-white' : 'text-gray-800'}`} />
        </button>
        <div className="flex items-center space-x-2 flex-1">
          <Users className={`w-5 h-5 ${isDarkMode ? 'text-[#8AB4F8]' : 'text-[#87A96B]'}`} />
          <h1 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
            Crew's Sphere
          </h1>
        </div>
      </div>

      {/* Group Members Bar */}
      <div
        className={`px-4 py-3 flex items-center space-x-3 overflow-x-auto ${
          isDarkMode ? 'bg-gray-900/50' : 'bg-gray-50'
        }`}
        style={{ scrollbarWidth: 'thin' }}
      >
        {groupMembers.map((member, index) => (
          <div
            key={index}
            className="flex flex-col items-center flex-shrink-0"
            title={member.name}
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm mb-1 overflow-hidden"
              style={{
                backgroundColor: (member.isCurrentUser && member.profilePicture) || member.avatar
                  ? "transparent" 
                  : (isDarkMode ? member.color + '30' : member.color + '20'),
                border: (member.isCurrentUser && member.profilePicture) || member.avatar
                  ? "none" 
                  : `2px solid ${member.color}40`,
              }}
            >
              {member.avatar ? (
                <img 
                  src={member.avatar} 
                  alt={member.name} 
                  className="w-full h-full object-cover"
                />
              ) : member.isCurrentUser && member.profilePicture ? (
                <img 
                  src={member.profilePicture} 
                  alt={member.name} 
                  className="w-full h-full object-cover"
                />
              ) : member.isCurrentUser ? (
                <User className="w-5 h-5" style={{ color: member.color }} />
              ) : (
                <span>{member.emoji}</span>
              )}
            </div>
            <span className={`text-[10px] ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {member.name}
            </span>
          </div>
        ))}
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-20" style={{ scrollbarWidth: 'thin' }}>
        <div className="space-y-4 max-w-sm mx-auto">
          {messages.map((msg, index) => (
            <div
              key={index}
              className={`flex items-start space-x-2 ${
                msg.sender === 'AI' ? 'bg-opacity-20' : ''
              }`}
              style={msg.sender === 'AI' ? {
                backgroundColor: isDarkMode ? 'rgba(177, 156, 217, 0.15)' : 'rgba(177, 156, 217, 0.1)',
                padding: '12px',
                borderRadius: '16px',
              } : {}}
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs flex-shrink-0 overflow-hidden"
                style={{
                  backgroundColor: msg.sender === 'AI' ? "transparent" : (isDarkMode ? msg.color + '30' : msg.color + '20'),
                  border: msg.sender === 'AI' ? "none" : `2px solid ${msg.color}40`,
                }}
              >
                {msg.sender === 'AI' ? (
                  <img 
                    src="/ai-avatar.png" 
                    alt="AI" 
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span>{msg.emoji}</span>
                )}
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
                {msg.image && (
                  <div className="mb-2 rounded-lg overflow-hidden">
                    <img 
                      src={msg.image} 
                      alt="Message attachment" 
                      className="w-full max-h-64 object-cover"
                    />
                  </div>
                )}
                {msg.message && (
                  <p className={`text-sm leading-relaxed ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    {msg.message}
                  </p>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div
        className={`sticky bottom-0 px-4 py-3 ${
          isDarkMode ? 'backdrop-blur-lg' : 'bg-white'
        }`}
        style={isDarkMode ? {
          backgroundColor: "#262626",
          boxShadow: "0 -2px 8px rgba(0, 0, 0, 0.2)",
          borderTop: "1px solid rgba(255, 255, 255, 0.08)",
        } : {
          boxShadow: "0 -2px 8px rgba(0, 0, 0, 0.1)",
          borderTop: "1px solid rgba(0, 0, 0, 0.05)",
        }}
      >
        {/* Image Preview */}
        {selectedImage && (
          <div className="max-w-sm mx-auto mb-3 relative">
            <div className="relative rounded-lg overflow-hidden" style={{ maxHeight: '200px' }}>
              <img 
                src={selectedImage} 
                alt="Preview" 
                className="w-full h-auto object-contain"
                style={{ maxHeight: '200px' }}
              />
              <button
                onClick={() => {
                  setSelectedImage(null);
                  if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                  }
                }}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 hover:bg-black/70 transition-all"
              >
                <X className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center space-x-2 max-w-sm mx-auto">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageSelect}
            className="hidden"
            id="image-input"
          />
          <label
            htmlFor="image-input"
            className="w-10 h-10 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-300 hover:opacity-80"
            style={{
              backgroundColor: selectedImage ? (isDarkMode ? "rgba(129, 201, 149, 0.3)" : "rgba(129, 201, 149, 0.2)") : (isDarkMode ? "#262626" : "#F3F4F6"),
              border: selectedImage 
                ? (isDarkMode ? "1px solid rgba(129, 201, 149, 0.5)" : "1px solid rgba(129, 201, 149, 0.3)")
                : (isDarkMode ? "1px solid rgba(255, 255, 255, 0.08)" : "1px solid rgba(0, 0, 0, 0.05)"),
            }}
          >
            <ImageIcon 
              className="w-5 h-5" 
              style={{ color: selectedImage ? (isDarkMode ? "#81C995" : "#87A96B") : (isDarkMode ? "#8AB4F8" : "#87A96B") }} 
              strokeWidth={1.5} 
            />
          </label>
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleSend();
              }
            }}
            placeholder="Type a message..."
            className={`flex-1 rounded-lg px-4 py-2 text-sm ${
              isDarkMode ? 'bg-gray-800/50 text-white placeholder-gray-400' : 'bg-gray-100 text-gray-800 placeholder-gray-500'
            } border-none outline-none`}
          />
          <button
            onClick={handleSend}
            disabled={!inputMessage.trim() && !selectedImage}
            className={`w-10 h-10 rounded-lg flex items-center justify-center transition-opacity ${
              (inputMessage.trim() || selectedImage)
                ? isDarkMode ? 'bg-[#8AB4F8]' : 'bg-[#87A96B]'
                : isDarkMode ? 'bg-gray-700 opacity-50' : 'bg-gray-300 opacity-50'
            }`}
            style={{
              boxShadow: (inputMessage.trim() || selectedImage)
                ? (isDarkMode ? "0 2px 8px rgba(138, 180, 248, 0.3)" : "0 2px 8px rgba(134, 169, 107, 0.3)")
                : 'none',
            }}
          >
            <Send className="w-5 h-5 text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}

