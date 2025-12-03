import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { ArrowLeft, Send, Users } from 'lucide-react';

export default function PodGroupChatPage() {
  const navigate = useNavigate();
  const { isDarkMode } = useTheme();
  const [inputMessage, setInputMessage] = useState('');
  const messagesEndRef = useRef(null);

  const groupMembers = [
    { name: 'Alex', emoji: '👤', color: '#7DD3C0' },
    { name: 'Sam', emoji: '👤', color: '#FDD663' },
    { name: 'Jordan', emoji: '👤', color: '#8AB4F8' },
    { name: 'Taylor', emoji: '👤', color: '#E6B3BA' },
    { name: 'Casey', emoji: '👤', color: '#81C995' },
    { name: 'AI', emoji: '🤖', color: '#B19CD9' },
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
    { 
      sender: 'Casey', 
      message: 'Count me in! This pod is so supportive 💚', 
      time: '10:36 AM',
      emoji: '👤',
      color: '#81C995'
    },
  ];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (inputMessage.trim()) {
      // Handle send message logic here
      setInputMessage('');
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col relative overflow-hidden"
      style={{
        background: isDarkMode
          ? "#202124"
          : "#FAFAF8"
      }}
    >
      {/* Header */}
      <div
        className={`sticky top-0 z-10 px-4 py-3 flex items-center space-x-3 ${
          isDarkMode ? 'backdrop-blur-lg' : 'bg-white'
        }`}
        style={isDarkMode ? {
          backgroundColor: "rgba(42, 42, 45, 0.95)",
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
            Pod Group Chat
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
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm mb-1"
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
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs flex-shrink-0"
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
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div
        className={`sticky bottom-0 px-4 py-3 ${
          isDarkMode ? 'backdrop-blur-lg' : 'bg-white'
        }`}
        style={isDarkMode ? {
          backgroundColor: "rgba(42, 42, 45, 0.95)",
          boxShadow: "0 -2px 8px rgba(0, 0, 0, 0.2)",
          borderTop: "1px solid rgba(255, 255, 255, 0.08)",
        } : {
          boxShadow: "0 -2px 8px rgba(0, 0, 0, 0.1)",
          borderTop: "1px solid rgba(0, 0, 0, 0.05)",
        }}
      >
        <div className="flex items-center space-x-2 max-w-sm mx-auto">
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
            disabled={!inputMessage.trim()}
            className={`w-10 h-10 rounded-lg flex items-center justify-center transition-opacity ${
              inputMessage.trim()
                ? isDarkMode ? 'bg-[#8AB4F8]' : 'bg-[#87A96B]'
                : isDarkMode ? 'bg-gray-700 opacity-50' : 'bg-gray-300 opacity-50'
            }`}
            style={{
              boxShadow: inputMessage.trim() 
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

