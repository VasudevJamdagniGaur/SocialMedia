import React from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { Users, MessageCircle, Heart, TrendingUp } from 'lucide-react';

export default function PodPage() {
  const { isDarkMode } = useTheme();

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
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center space-x-3 mb-2">
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
        </div>
      </div>
    </div>
  );
}

