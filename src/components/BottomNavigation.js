import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, Users, UserCircle } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

export default function BottomNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isDarkMode } = useTheme();

  const isHomeActive = location.pathname === '/dashboard';
  const isPodActive = location.pathname === '/pod';
  const isCommunityActive = location.pathname === '/community';

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
          <Home
            className={`w-5 h-5 mb-0.5 transition-colors ${
              isHomeActive
                ? isDarkMode
                  ? 'text-[#8AB4F8]'
                  : 'text-[#87A96B]'
                : isDarkMode
                ? 'text-gray-400'
                : 'text-gray-500'
            }`}
            strokeWidth={isHomeActive ? 2.5 : 2}
            fill={isHomeActive ? (isDarkMode ? '#8AB4F8' : '#87A96B') : 'none'}
          />
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
          onClick={() => navigate('/pod')}
          className="flex flex-col items-center justify-center flex-1 h-full transition-all duration-200 active:opacity-70"
        >
          <Users
            className={`w-5 h-5 mb-0.5 transition-colors ${
              isPodActive
                ? isDarkMode
                  ? 'text-[#8AB4F8]'
                  : 'text-[#87A96B]'
                : isDarkMode
                ? 'text-gray-400'
                : 'text-gray-500'
            }`}
            strokeWidth={isPodActive ? 2.5 : 2}
            fill={isPodActive ? (isDarkMode ? '#8AB4F8' : '#87A96B') : 'none'}
          />
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
          <UserCircle
            className={`w-5 h-5 mb-0.5 transition-colors ${
              isCommunityActive
                ? isDarkMode
                  ? 'text-[#8AB4F8]'
                  : 'text-[#87A96B]'
                : isDarkMode
                ? 'text-gray-400'
                : 'text-gray-500'
            }`}
            strokeWidth={isCommunityActive ? 2.5 : 2}
            fill={isCommunityActive ? (isDarkMode ? '#8AB4F8' : '#87A96B') : 'none'}
          />
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

