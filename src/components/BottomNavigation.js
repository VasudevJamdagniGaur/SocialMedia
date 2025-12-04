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
          backgroundColor: "rgba(42, 42, 45, 0.95)",
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
          className="flex flex-col items-center justify-center flex-1 h-full transition-all duration-200 active:opacity-70"
        >
          <svg
            className="w-5 h-5 mb-0.5"
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
          <span
            className={`text-[10px] font-medium transition-colors leading-tight ${
              isHomeActive
                ? isDarkMode
                  ? 'text-[#8AB4F8]'
                  : 'text-[#87A96B]'
                : isDarkMode
                ? 'text-gray-400'
                : 'text-gray-500'
            }`}
          >
            Home
          </span>
        </button>

        <button
          onClick={() => navigate('/wellbeing')}
          className="flex flex-col items-center justify-center flex-1 h-full transition-all duration-200 active:opacity-70"
        >
          <svg
            className="w-5 h-5 mb-0.5"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"
              stroke={isWellbeingActive 
                ? (isDarkMode ? '#8AB4F8' : '#87A96B')
                : (isDarkMode ? '#9CA3AF' : '#6B7280')
              }
              strokeWidth={isWellbeingActive ? 2.5 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill={isWellbeingActive ? '#FFFFFF' : 'none'}
            />
          </svg>
          <span
            className={`text-[10px] font-medium transition-colors leading-tight ${
              isWellbeingActive
                ? isDarkMode
                  ? 'text-[#8AB4F8]'
                  : 'text-[#87A96B]'
                : isDarkMode
                ? 'text-gray-400'
                : 'text-gray-500'
            }`}
          >
            Wellbeing
          </span>
        </button>

        <button
          onClick={() => navigate('/pod')}
          className="flex flex-col items-center justify-center flex-1 h-full transition-all duration-200 active:opacity-70"
        >
          <svg
            className="w-5 h-5 mb-0.5"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"
              stroke={isPodActive 
                ? (isDarkMode ? '#8AB4F8' : '#87A96B')
                : (isDarkMode ? '#9CA3AF' : '#6B7280')
              }
              strokeWidth={isPodActive ? 2.5 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            <circle
              cx="9"
              cy="7"
              r="4"
              stroke={isPodActive 
                ? (isDarkMode ? '#8AB4F8' : '#87A96B')
                : (isDarkMode ? '#9CA3AF' : '#6B7280')
              }
              strokeWidth={isPodActive ? 2.5 : 2}
              fill={isPodActive ? '#FFFFFF' : 'none'}
            />
            <path
              d="M23 21v-2a4 4 0 00-3-3.87"
              stroke={isPodActive 
                ? (isDarkMode ? '#8AB4F8' : '#87A96B')
                : (isDarkMode ? '#9CA3AF' : '#6B7280')
              }
              strokeWidth={isPodActive ? 2.5 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            <path
              d="M16 3.13a4 4 0 010 7.75"
              stroke={isPodActive 
                ? (isDarkMode ? '#8AB4F8' : '#87A96B')
                : (isDarkMode ? '#9CA3AF' : '#6B7280')
              }
              strokeWidth={isPodActive ? 2.5 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            {isPodActive && (
              <>
                <circle cx="9" cy="7" r="2" fill="#FFFFFF" />
                <path
                  d="M17 19v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"
                  fill="#FFFFFF"
                />
              </>
            )}
          </svg>
          <span
            className={`text-[10px] font-medium transition-colors leading-tight ${
              isPodActive
                ? isDarkMode
                  ? 'text-[#8AB4F8]'
                  : 'text-[#87A96B]'
                : isDarkMode
                ? 'text-gray-400'
                : 'text-gray-500'
            }`}
          >
            Pod
          </span>
        </button>

        <button
          onClick={() => navigate('/community')}
          className="flex flex-col items-center justify-center flex-1 h-full transition-all duration-200 active:opacity-70"
        >
          <svg
            className="w-5 h-5 mb-0.5"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke={isCommunityActive 
                ? (isDarkMode ? '#8AB4F8' : '#87A96B')
                : (isDarkMode ? '#9CA3AF' : '#6B7280')
              }
              strokeWidth={isCommunityActive ? 2.5 : 2}
              fill="none"
            />
            <circle
              cx="12"
              cy="8"
              r="3"
              fill={isCommunityActive ? '#FFFFFF' : (isDarkMode ? '#9CA3AF' : '#6B7280')}
            />
            <path
              d="M6 21c0-3.314 2.686-6 6-6s6 2.686 6 6"
              stroke={isCommunityActive ? '#FFFFFF' : (isDarkMode ? '#9CA3AF' : '#6B7280')}
              strokeWidth={isCommunityActive ? 2.5 : 2}
              strokeLinecap="round"
              fill="none"
            />
          </svg>
          <span
            className={`text-[10px] font-medium transition-colors leading-tight ${
              isCommunityActive
                ? isDarkMode
                  ? 'text-[#8AB4F8]'
                  : 'text-[#87A96B]'
                : isDarkMode
                ? 'text-gray-400'
                : 'text-gray-500'
            }`}
          >
            Community
          </span>
        </button>
      </div>
    </div>
  );
}

