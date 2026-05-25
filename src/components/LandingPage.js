import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser, onAuthStateChange } from '../services/authService';
import SpaceBackground from './SpaceBackground';

export default function LandingPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const checkAuth = () => {
      const user = getCurrentUser();
      if (user) {
        navigate('/dashboard', { replace: true });
      }
    };

    checkAuth();

    const unsubscribe = onAuthStateChange((user) => {
      if (user) {
        navigate('/dashboard', { replace: true });
      }
    });

    return () => unsubscribe();
  }, [navigate]);

  const handleGetStarted = () => {
    navigate('/signup');
  };

  return (
    <div
      className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden px-6 slide-up"
      style={{
        background: '#030308',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <SpaceBackground nebulaCenterY="42%" />

      <div className="relative z-10 flex flex-col items-center space-y-8 text-center">
        <div className="relative">
          <div
            className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-full backdrop-blur-lg"
            style={{
              backgroundColor: '#121212',
              boxShadow:
                '0 0 24px rgba(192, 132, 252, 0.35), 0 4px 20px rgba(126, 34, 206, 0.4)',
              border: '1px solid rgba(168, 85, 247, 0.3)',
            }}
          >
            <img
              src="/DEITECIrc.webp"
              alt="Detea"
              className="relative z-10 h-full w-full object-cover"
            />
          </div>
        </div>

        <div className="space-y-4">
          <h1 className="text-4xl font-bold text-white">Detea</h1>
          <p className="max-w-md text-lg text-gray-300">Your Social Tea</p>
        </div>

        <div className="mt-12">
          <button
            type="button"
            onClick={handleGetStarted}
            className="relative overflow-hidden rounded-full px-8 py-3 font-semibold text-white backdrop-blur-lg transition-all duration-300 hover:scale-105 hover:shadow-lg"
            style={{
              backgroundColor: '#A855F7',
              boxShadow:
                '0 0 20px rgba(192, 132, 252, 0.3), 0 4px 16px rgba(126, 34, 206, 0.4)',
              border: '1px solid rgba(168, 85, 247, 0.5)',
            }}
          >
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
}
