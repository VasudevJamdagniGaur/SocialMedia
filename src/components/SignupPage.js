import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { signUpUser, onAuthStateChange, getCurrentUser } from '../services/authService';
import { Brain } from 'lucide-react';
import LaserFlow from './LaserFlow';

const SignupPage = () => {
  const navigate = useNavigate();
  const [isLoaded, setIsLoaded] = useState(false);

  // Listen for auth state changes (handles popup completion on mobile)
  useEffect(() => {
    const unsubscribe = onAuthStateChange((user) => {
      if (user) {
        console.log('✅ Auth state changed - user signed in:', user);
        
        // If we're stuck on auth handler page, clear it first
        if (window.location.href.includes('__/auth/handler')) {
          console.log('🔄 Clearing auth handler URL');
          window.history.replaceState({}, '', '/signup');
        }
        
        // Navigate to dashboard when user is authenticated
        navigate('/dashboard', { replace: true });
      }
    });

    return () => unsubscribe();
  }, [navigate]);

  useEffect(() => {
    // Trigger fade-in animation on component mount
    setIsLoaded(true);
  }, []);

  return (
    <div
      className={`min-h-screen flex flex-col relative overflow-hidden transition-all duration-1000 background-animated ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
      style={{
        background: 'radial-gradient(ellipse at bottom, #1B2735 0%, #090A0F 100%)',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Stars background */}
      <div className="absolute inset-0 overflow-hidden" style={{ zIndex: 2 }}>
        {[...Array(80)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width: Math.random() * 3 + 1 + 'px',
              height: Math.random() * 3 + 1 + 'px',
              left: Math.random() * 100 + '%',
              top: Math.random() * 100 + '%',
              background: 'white',
              boxShadow: `0 0 ${Math.random() * 10 + 2}px rgba(255, 255, 255, ${Math.random() * 0.5 + 0.3})`,
              animation: `twinkle ${Math.random() * 5 + 3}s ease-in-out ${Math.random() * 5}s infinite`,
              opacity: Math.random() * 0.7 + 0.3,
            }}
          />
        ))}
        </div>

      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      `}</style>

      {/* Centered glowing logo */}
      <div className="flex-1 flex items-center justify-center mobile-container relative" style={{ zIndex: 10 }}>
          <div className="relative">
          {/* Outer glow ring */}
            <div
            className={`absolute inset-0 rounded-full animate-pulse transition-all duration-2000 ${isLoaded ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}`}
              style={{
              background: 'radial-gradient(circle, rgba(139, 195, 74, 0.3) 0%, transparent 70%)',
              width: '200px',
              height: '200px',
              filter: 'blur(20px)',
            }}
          />

          {/* Inner logo circle */}
          <div
            className={`relative mobile-logo rounded-full flex items-center justify-center transition-all duration-1500 delay-300 logo-glow ${isLoaded ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`}
            style={{
              width: '120px',
              height: '120px',
              backgroundColor: "rgba(38, 38, 38, 0.8)",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              backdropFilter: 'blur(10px)',
            }}
          >
            <Brain className="w-14 h-14" style={{ color: "#8AB4F8" }} strokeWidth={1.5} />
          </div>
          </div>
        </div>

      {/* LaserFlow Background - centered with tail at top */}
      <div 
        style={{ 
          position: 'absolute',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '100%',
          height: '140vh',
          overflow: 'visible',
          zIndex: 1,
          pointerEvents: 'none'
        }}
      >
        <LaserFlow
          horizontalBeamOffset={0.0}
          verticalBeamOffset={0.2}
          color="#8BC34A"
        />
      </div>

      {/* Bottom card with buttons */}
      <div style={{ position: 'relative', width: '100%' }}>

        <div
          className={`mobile-container mb-8 rounded-3xl p-6 transition-all duration-1000 delay-700 card-float ${isLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
          style={{
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
            zIndex: 10,
            position: 'relative'
          }}
        >
          <div className="space-y-4">
          {/* Sign up */}
          <button
            className="w-full mobile-button rounded-2xl font-semibold transition-all duration-300 hover:scale-[0.98] active:scale-[0.96]"
              style={{
              background: 'rgba(255, 255, 255, 0.1)',
              color: 'rgba(255, 255, 255, 0.9)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              backdropFilter: 'blur(10px)',
              }}
              onClick={() => navigate('/signup/email')}
            >
              Sign up
            </button>

          {/* Log in */}
          <button
            className="w-full mobile-button rounded-2xl font-semibold transition-all duration-300 hover:scale-[0.98] active:scale-[0.96]"
            style={{
              background: 'transparent',
              color: 'rgba(255, 255, 255, 0.9)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              backdropFilter: 'blur(10px)',
            }}
              onClick={() => navigate('/login')}
            >
              Log in
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignupPage;
