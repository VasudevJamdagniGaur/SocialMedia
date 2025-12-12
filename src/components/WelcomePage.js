import React from "react";
import { useNavigate } from 'react-router-dom';
import { Brain, Heart, Star, Shield, TrendingUp, BookOpen, Users } from "lucide-react";

export default function WelcomePage() {
  const navigate = useNavigate();

  const handleGo = () => {
    navigate('/signup');
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-12 relative overflow-hidden slide-up"
      style={{
        background: "#131313",
      }}
    >
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-24 left-20 opacity-8">
          <svg width="120" height="60" viewBox="0 0 120 60" fill="none" stroke="#81C995" strokeWidth="0.4">
            <path d="M18 36c0-12 7.5-19.5 19.5-19.5s19.5 7.5 19.5 36c0 6-3.75 12-9.75 15.5H27.75c-6-3.5-9.75-9.5-9.75-15.5z" />
            <path d="M52 30c0-9.5 6.25-15.5 15.5-15.5s15.5 6 15.5 30c0 4.75-2.75 9.5-7.75 12.25H59.75c-5-2.75-7.75-7.5-7.75-12.25z" />
            <path d="M85 24c0-7.5 5-12.5 12.5-12.5s12.5 5 12.5 24c0 3.75-1.25 7.5-5 10H90c-3.75-2.5-5-6.25-5-10z" />
          </svg>
        </div>

        <div className="absolute top-72 right-28 opacity-7">
          <svg width="140" height="52" viewBox="0 0 140 52" fill="none" stroke="#FDD663" strokeWidth="0.3">
            <path d="M20 31c0-10.5 7-17 17-17s17 6.5 17 31c0 5.25-3.25 10.5-8.5 13.5H28.5c-5.25-3-8.5-8.25-8.5-13.5z" />
            <path d="M55 26c0-8.5 5.5-13.5 13.5-13.5s13.5 5 13.5 26c0 4.25-2.5 8.5-6.75 10.75H61.75c-4.25-2.25-6.75-6.5-6.75-10.75z" />
            <path d="M85 21c0-6.5 4.5-11 11-11s11 4.5 11 21c0 3.25-1 6.5-4.25 8.25H89.25c-3.25-1.75-4.25-5-4.25-8.25z" />
          </svg>
        </div>

        <div className="absolute bottom-40 left-16 opacity-9">
          <svg width="105" height="42" viewBox="0 0 105 42" fill="none" stroke="#8AB4F8" strokeWidth="0.4">
            <path d="M15 25c0-10 6.25-16.25 16.25-16.25s16.25 6.25 16.25 25c0 5-3 10-8 12.5H23c-5-2.5-8-7.5-8-12.5z" />
            <path d="M42 21c0-8 5-13 13-13s13 5 13 21c0 4-2.25 8-5.5 10H47.5c-3.25-2-5.5-6-5.5-10z" />
            <path d="M70 17c0-6 3.75-10 10-10s10 4 10 17c0 3-0.75 6-3.5 7.5H73.5c-2.75-1.5-3.5-4.5-3.5-7.5z" />
          </svg>
        </div>

        <div className="absolute top-48 left-28 opacity-6">
          <svg width="180" height="22" viewBox="0 0 180 22" fill="none" stroke="#81C995" strokeWidth="0.5">
            <path d="M4 11c14-5 28 5 42-5s28 5 42-5s28 5 42-5s28 5 42 5" />
            <path d="M10 7c10-3.5 20 3.5 30-3.5s20 3.5 30-3.5s20 3.5 30-3.5s20 3.5 30 3.5" opacity="0.4" />
            <circle cx="32" cy="8.5" r="0.8" fill="#81C995" opacity="0.3" />
            <circle cx="88" cy="13.5" r="0.8" fill="#81C995" opacity="0.3" />
            <circle cx="144" cy="9.5" r="0.8" fill="#81C995" opacity="0.3" />
          </svg>
        </div>

        <div className="absolute bottom-56 right-20 opacity-7">
          <svg width="160" height="26" viewBox="0 0 160 26" fill="none" stroke="#FDD663" strokeWidth="0.4">
            <path d="M6 13c12-4.5 24 4.5 36-4.5s24 4.5 36-4.5s24 4.5 36-4.5s24 4.5 36 4.5" />
            <path d="M16 9c9-3 18 3 27-3s18 3 27-3s18 3 27-3s18 3 27 3" opacity="0.5" />
            <circle cx="46" cy="11" r="0.7" fill="#FDD663" opacity="0.4" />
            <circle cx="104" cy="15" r="0.7" fill="#FDD663" opacity="0.4" />
          </svg>
        </div>

        <Heart
          className="absolute top-1/5 left-1/8 w-4 h-4 animate-bounce opacity-14"
          style={{ color: "#81C995", animationDelay: "0.3s", animationDuration: "4s" }}
        />
        <Heart
          className="absolute top-2/3 right-1/6 w-3 h-3 animate-bounce opacity-17"
          style={{ color: "#FDD663", animationDelay: "2s", animationDuration: "3.5s" }}
        />
        <Heart
          className="absolute bottom-1/4 right-3/4 w-5 h-5 animate-bounce opacity-15"
          style={{ color: "#8AB4F8", animationDelay: "1.2s", animationDuration: "3.8s" }}
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
      </div>

      <div className="flex flex-col items-center text-center space-y-8 relative z-10 max-w-4xl">
        <div className="relative">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center relative overflow-hidden backdrop-blur-lg"
            style={{
              backgroundColor: "rgba(42, 42, 45, 0.6)",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            <Brain className="w-10 h-10 relative z-10" style={{ color: "#8AB4F8" }} strokeWidth={1.5} />
          </div>
        </div>

        <h1 className="text-3xl font-bold text-white mb-8">Welcome to deite</h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-2xl mb-8">
          <div
            className="rounded-2xl p-6 border backdrop-blur-lg relative overflow-hidden hover:shadow-md transition-all duration-300"
            style={{
              backgroundColor: "rgba(42, 42, 45, 0.6)",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mb-4 mx-auto backdrop-blur-md"
              style={{
                backgroundColor: "rgba(129, 201, 149, 0.8)",
                boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
              }}
            >
              <Shield className="w-6 h-6 text-white" strokeWidth={1.5} />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Private and Secure</h3>
            <p className="text-sm text-gray-300">Your emotional journey is protected with end-to-end encryption</p>
          </div>

          <div
            className="rounded-2xl p-6 border backdrop-blur-lg relative overflow-hidden hover:shadow-md transition-all duration-300"
            style={{
              backgroundColor: "rgba(28, 31, 46, 0.3)",
              boxShadow: "inset 0 0 25px rgba(212, 175, 55, 0.12), 0 12px 40px rgba(212, 175, 55, 0.08)",
              border: "1px solid rgba(212, 175, 55, 0.18)",
            }}
          >
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mb-4 mx-auto backdrop-blur-md"
              style={{
                backgroundColor: "rgba(253, 214, 99, 0.8)",
                boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
              }}
            >
              <TrendingUp className="w-6 h-6 text-white" strokeWidth={1.5} />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Track emotional growth</h3>
            <p className="text-sm text-gray-300">Monitor your progress and celebrate your emotional milestones</p>
          </div>

          <div
            className="rounded-2xl p-6 border backdrop-blur-lg relative overflow-hidden hover:shadow-md transition-all duration-300"
            style={{
              backgroundColor: "rgba(28, 31, 46, 0.3)",
              boxShadow: "inset 0 0 25px rgba(155, 181, 255, 0.12), 0 12px 40px rgba(155, 181, 255, 0.08)",
              border: "1px solid rgba(155, 181, 255, 0.18)",
            }}
          >
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mb-4 mx-auto backdrop-blur-md"
              style={{
                backgroundColor: "rgba(138, 180, 248, 0.8)",
                boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
              }}
            >
              <BookOpen className="w-6 h-6 text-white" strokeWidth={1.5} />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Journaling</h3>
            <p className="text-sm text-gray-300">Express your thoughts and feelings in a safe, private space</p>
          </div>

          <div
            className="rounded-2xl p-6 border backdrop-blur-lg relative overflow-hidden hover:shadow-md transition-all duration-300"
            style={{
              backgroundColor: "rgba(42, 42, 45, 0.6)",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mb-4 mx-auto backdrop-blur-md"
              style={{
                backgroundColor: "rgba(242, 139, 130, 0.8)",
                boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
              }}
            >
              <Users className="w-6 h-6 text-white" strokeWidth={1.5} />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Mental Support</h3>
            <p className="text-sm text-gray-300">Access resources and guidance for your mental wellness journey</p>
          </div>
        </div>

        <div className="mt-8">
          <button
            onClick={handleGo}
            className="px-12 py-3 font-semibold rounded-full hover:shadow-lg transition-all duration-300 hover:scale-105 backdrop-blur-lg relative overflow-hidden"
            style={{
              backgroundColor: "rgba(42, 42, 45, 0.8)",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
              color: "#FFFFFF",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            Go
          </button>
        </div>
      </div>
    </div>
  );
}

