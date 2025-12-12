import React, { useEffect } from "react";
import { useNavigate } from 'react-router-dom';
import { Brain, Heart, Star } from "lucide-react";
import { getCurrentUser, onAuthStateChange } from '../services/authService';

export default function LandingPage() {
  const navigate = useNavigate();

  // Redirect to dashboard if user is already logged in
  useEffect(() => {
    const checkAuth = () => {
      const user = getCurrentUser();
      if (user) {
        console.log('✅ User is logged in on LandingPage - redirecting to dashboard');
        navigate('/dashboard', { replace: true });
      }
    };

    // Check immediately
    checkAuth();

    // Also listen for auth state changes (in case user logs in while on this page)
    const unsubscribe = onAuthStateChange((user) => {
      if (user) {
        console.log('✅ Auth state changed - user logged in, redirecting to dashboard');
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
      className="min-h-screen flex flex-col items-center justify-center px-6 relative overflow-hidden slide-up"
      style={{
        background: "#131313",
      }}
    >
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-20 left-16 opacity-10">
          <svg width="150" height="75" viewBox="0 0 150 75" fill="none" stroke="#81C995" strokeWidth="0.4">
            <path d="M20 45c0-15 10-25 25-25s25 10 25 45c0 7.5-5 15-12.5 20H32.5c-7.5-5-12.5-12.5-12.5-20z" />
            <path d="M60 35c0-10 7.5-17.5 17.5-17.5s17.5 7.5 17.5 35c0 5-2.5 10-7.5 12.5H67.5c-5-2.5-7.5-7.5-7.5-12.5z" />
            <path d="M100 27c0-7.5 5-12.5 12.5-12.5s12.5 5 12.5 27c0 3.75-1.25 7.5-5 10H105c-3.75-2.5-5-6.25-5-10z" />
          </svg>
        </div>

        <div className="absolute top-60 right-24 opacity-8">
          <svg width="120" height="50" viewBox="0 0 120 50" fill="none" stroke="#FDD663" strokeWidth="0.3">
            <path d="M15 30c0-12.5 7.5-20 20-20s20 7.5 20 30c0 6.25-3.75 12.5-10 16.25H25c-6.25-3.75-10-10-10-16.25z" />
            <path d="M50 25c0-10 6.25-15 15-15s15 5 15 25c0 5-2.5 10-6.25 12.5H56.25c-3.75-2.5-6.25-7.5-6.25-12.5z" />
            <path d="M87.5 20c0-7.5 5-12.5 12.5-12.5s12.5 5 12.5 20c0 3.75-1.25 7.5-5 10H92.5c-3.75-2.5-5-6.25-5-10z" />
          </svg>
        </div>

        <div className="absolute bottom-40 left-20 opacity-9">
          <svg width="100" height="40" viewBox="0 0 100 40" fill="none" stroke="#8AB4F8" strokeWidth="0.4">
            <path d="M12 24c0-10 6-16 16-16s16 6 16 24c0 5-3 10-8 13H20c-5-3-8-8-8-13z" />
            <path d="M40 20c0-8 5-12 12-12s12 4 12 20c0 4-2 8-5 10H45c-3-2-5-6-5-10z" />
            <path d="M70 16c0-6 4-10 10-10s10 4 10 16c0 3-1 6-4 8H74c-3-2-4-5-4-8z" />
          </svg>
        </div>

        <div className="absolute top-80 left-12 opacity-7">
          <svg width="200" height="20" viewBox="0 0 200 20" fill="none" stroke="#81C995" strokeWidth="0.5">
            <path d="M4 10c16-5 32 5 48-5s32 5 48-5s32 5 48-5s32 5 48 5" />
            <path d="M10 6c12-3 24 3 36-3s24 3 36-3s24 3 36-3s24 3 36 3" opacity="0.4" />
            <circle cx="30" cy="7" r="0.8" fill="#81C995" opacity="0.3" />
            <circle cx="90" cy="13" r="0.8" fill="#81C995" opacity="0.3" />
            <circle cx="150" cy="8" r="0.8" fill="#81C995" opacity="0.3" />
          </svg>
        </div>

        <div className="absolute bottom-60 right-20 opacity-6">
          <svg width="180" height="25" viewBox="0 0 180 25" fill="none" stroke="#FDD663" strokeWidth="0.4">
            <path d="M6 12.5c14-4 28 4 42-4s28 4 42-4s28 4 42-4s28 4 42 4" />
            <path d="M16 8c10-2.5 20 2.5 30-2.5s20 2.5 30-2.5s20 2.5 30-2.5s20 2.5 30 2.5" opacity="0.5" />
            <circle cx="50" cy="10" r="0.6" fill="#FDD663" opacity="0.4" />
            <circle cx="110" cy="15" r="0.6" fill="#FDD663" opacity="0.4" />
          </svg>
        </div>

        <Heart
          className="absolute top-1/5 left-1/8 w-4 h-4 animate-bounce opacity-15"
          style={{ color: "#81C995", animationDelay: "0.3s", animationDuration: "4s" }}
        />
        <Heart
          className="absolute top-2/3 right-1/6 w-3 h-3 animate-bounce opacity-18"
          style={{ color: "#FDD663", animationDelay: "2s", animationDuration: "3.5s" }}
        />
        <Heart
          className="absolute bottom-1/4 right-3/4 w-5 h-5 animate-bounce opacity-16"
          style={{ color: "#8AB4F8", animationDelay: "1.2s", animationDuration: "3.8s" }}
        />
        <Heart
          className="absolute top-1/2 right-1/8 w-3 h-3 animate-bounce opacity-14"
          style={{ color: "#81C995", animationDelay: "3.5s", animationDuration: "4.2s" }}
        />
        <Heart
          className="absolute top-1/8 left-2/3 w-4 h-4 animate-bounce opacity-17"
          style={{ color: "#FDD663", animationDelay: "0.7s", animationDuration: "3.9s" }}
        />
        <Heart
          className="absolute bottom-1/8 left-1/3 w-3 h-3 animate-bounce opacity-13"
          style={{ color: "#8AB4F8", animationDelay: "4.5s", animationDuration: "4.1s" }}
        />

        <Star
          className="absolute top-1/8 right-1/4 w-3 h-3 animate-pulse opacity-20"
          style={{ color: "#FDD663", animationDelay: "0.8s", animationDuration: "2.8s" }}
        />
        <Star
          className="absolute bottom-1/3 left-1/5 w-4 h-4 animate-pulse opacity-16"
          style={{ color: "#8AB4F8", animationDelay: "2.5s", animationDuration: "3.2s" }}
        />
        <Star
          className="absolute top-3/4 left-2/3 w-3 h-3 animate-pulse opacity-18"
          style={{ color: "#81C995", animationDelay: "1.7s", animationDuration: "2.5s" }}
        />
        <Star
          className="absolute bottom-1/6 right-1/3 w-4 h-4 animate-pulse opacity-14"
          style={{ color: "#FDD663", animationDelay: "4s", animationDuration: "3.5s" }}
        />
        <Star
          className="absolute top-1/6 left-1/4 w-3 h-3 animate-pulse opacity-19"
          style={{ color: "#8AB4F8", animationDelay: "1.1s", animationDuration: "2.9s" }}
        />
        <Star
          className="absolute bottom-2/3 right-1/8 w-4 h-4 animate-pulse opacity-15"
          style={{ color: "#81C995", animationDelay: "3.3s", animationDuration: "3.4s" }}
        />
        <Star
          className="absolute top-5/6 right-2/3 w-3 h-3 animate-pulse opacity-17"
          style={{ color: "#FDD663", animationDelay: "0.4s", animationDuration: "2.6s" }}
        />
      </div>

      <div className="flex flex-col items-center text-center space-y-8 relative z-10">
        <div className="relative">
          <div
            className="w-24 h-24 rounded-full flex items-center justify-center relative overflow-hidden backdrop-blur-lg"
            style={{
              backgroundColor: "rgba(42, 42, 45, 0.6)",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            <Brain className="w-12 h-12 relative z-10" style={{ color: "#81C995" }} strokeWidth={1.5} />
          </div>
        </div>

        <div className="space-y-4">
          <h1 className="text-4xl font-bold text-white">Deite</h1>
          <p className="text-lg text-gray-300 max-w-md">Embark your emotional journey</p>
        </div>

        <div className="mt-12">
          <button
            onClick={handleGetStarted}
            className="px-8 py-3 font-semibold rounded-full hover:shadow-lg transition-all duration-300 hover:scale-105 backdrop-blur-lg relative overflow-hidden"
            style={{
              backgroundColor: "rgba(42, 42, 45, 0.8)",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
              color: "#FFFFFF",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
}

