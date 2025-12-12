import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, Users, UserCircle, Heart } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

export default function BottomNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isDarkMode } = useTheme();

  const isHomeActive = location.pathname === '/dashboard';
  const isPodActive = location.pathname === '/pod';
  const isCommunityActive = location.pathname === '/community';
  const isWellbeingActive = location.pathname === '/wellbeing';

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div
        className={`flex items-center justify-around ${
          isDarkMode ? 'backdrop-blur-lg' : 'bg-white'
        }`}
        style={isDarkMode ? {
          backgroundColor: "#262626",
          boxShadow: "0 -2px 8px rgba(0, 0, 0, 0.2)",
          borderTop: "1px solid rgba(255, 255, 255, 0.08)",
          height: '56px',
        } : {
          boxShadow: "0 -1px 6px rgba(0, 0, 0, 0.08)",
          borderTop: "1px solid rgba(0, 0, 0, 0.05)",
          height: '56px',
        }}
      >
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center justify-center flex-1 h-full transition-all duration-200 active:opacity-70"
        >
          <svg
            className="w-7 h-7"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
              stroke={isHomeActive 
                ? (isDarkMode ? '#8AB4F8' : '#87A96B')
                : (isDarkMode ? '#9CA3AF' : '#6B7280')
              }
              strokeWidth={isHomeActive ? 2.5 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            {isHomeActive && (
              <path
                d="M9 21v-6a1 1 0 011-1h4a1 1 0 011 1v6"
                fill="#FFFFFF"
              />
            )}
          </svg>
        </button>

        <button
          onClick={() => navigate('/wellbeing')}
          className="flex items-center justify-center flex-1 h-full transition-all duration-200 active:opacity-70"
        >
          <svg
            className="w-7 h-7"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"
              stroke={isWellbeingActive 
                ? '#FFFFFF'
                : (isDarkMode ? '#9CA3AF' : '#6B7280')
              }
              strokeWidth={isWellbeingActive ? 2.5 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill={isWellbeingActive ? (isDarkMode ? '#8AB4F8' : '#87A96B') : 'none'}
            />
          </svg>
        </button>

        <button
          onClick={() => navigate('/pod')}
          className="flex items-center justify-center flex-1 h-full transition-all duration-200 active:opacity-70"
        >
          <img
            src="/crew-icon.png"
            alt="Crew"
            className="w-9 h-9 object-contain"
            style={{
              opacity: isPodActive ? 1 : (isDarkMode ? 0.6 : 0.5),
              filter: isPodActive 
                ? 'brightness(0) invert(1)'
                : 'none',
              WebkitFilter: isPodActive 
                ? 'brightness(0) invert(1)'
                : 'none'
            }}
          />
        </button>

        <button
          onClick={() => navigate('/community')}
          className="flex items-center justify-center flex-1 h-full transition-all duration-200 active:opacity-70"
        >
          <img
            src="/hub-icon.png"
            alt="HUB"
            className="w-9 h-9 object-contain"
            style={{
              opacity: isCommunityActive ? 1 : (isDarkMode ? 0.6 : 0.5),
              filter: isCommunityActive 
                ? 'brightness(0) invert(1)'
                : 'none',
              WebkitFilter: isCommunityActive 
                ? 'brightness(0) invert(1)'
                : 'none'
            }}
          />
        </button>
      </div>
    </div>
  );
}

