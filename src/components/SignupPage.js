import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { onAuthStateChange, signInWithGoogle } from '../services/authService';
import SpaceBackground from './SpaceBackground';

const SignupPage = () => {
  const navigate = useNavigate();
  const [isLoaded, setIsLoaded] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  useEffect(() => {
    const unsubscribe = onAuthStateChange((user) => {
      if (user) {
        navigate('/dashboard', { replace: true });
      }
    });
    return () => unsubscribe();
  }, [navigate]);

  useEffect(() => {
    setIsLoaded(true);
  }, []);

  return (
    <div
      className={`relative flex min-h-[100dvh] flex-col overflow-hidden transition-opacity duration-700 ${
        isLoaded ? 'opacity-100' : 'opacity-0'
      }`}
      style={{
        background: '#030308',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <SpaceBackground nebulaCenterY="38%" />

      {/* Logo — same treatment as LandingPage */}
      <div className="relative z-10 flex flex-[1.1] min-h-0 items-center justify-center px-6 pb-4 pt-[max(12px,env(safe-area-inset-top))]">
        <div
          className={`relative transition-all duration-1000 ease-out ${
            isLoaded ? 'scale-100 opacity-100' : 'scale-90 opacity-0'
          }`}
        >
          <div
            className="relative flex h-[7.8rem] w-[7.8rem] items-center justify-center overflow-hidden rounded-full backdrop-blur-lg"
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
      </div>

      {/* Auth — lower third */}
      <div
        className={`relative z-10 mx-auto flex w-full max-w-[400px] flex-col items-center gap-5 px-6 pb-[max(28px,env(safe-area-inset-bottom,24px))] transition-all duration-700 delay-150 ${
          isLoaded ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
        }`}
        style={{ flex: '0 0 auto', minHeight: '32vh', justifyContent: 'flex-end' }}
      >
        <button
          type="button"
          disabled={googleLoading}
          className="flex h-[52px] w-[min(90vw,350px)] max-w-full items-center justify-center gap-3 rounded-full bg-white text-[15px] font-semibold text-slate-900 shadow-[0_2px_12px_rgba(0,0,0,0.25)] transition hover:bg-gray-50 active:scale-[0.99] disabled:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#030308]"
          onClick={async () => {
            if (googleLoading) return;
            setGoogleLoading(true);
            try {
              const result = await signInWithGoogle();
              if (result?.success) {
                navigate('/dashboard', { replace: true });
                return;
              }
              alert(result?.error ?? 'Sign-in failed. Please try again.');
            } catch (err) {
              console.error('Google sign-in error:', err);
              alert(err?.message ?? 'Sign-in failed. Please try again.');
            } finally {
              setGoogleLoading(false);
            }
          }}
        >
          {!googleLoading ? (
            <>
              <span className="flex shrink-0" aria-hidden>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
              </span>
              <span className="tracking-tight">Continue with Google</span>
            </>
          ) : (
            <span>Signing in…</span>
          )}
        </button>

        <Link
          to="/login"
          className="text-[15px] font-medium text-white/95 transition-colors hover:text-white focus:outline-none focus-visible:underline"
        >
          Log in with email and password
        </Link>
      </div>
    </div>
  );
};

export default SignupPage;
