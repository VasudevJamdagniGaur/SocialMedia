import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { onAuthStateChange, signInWithGoogle } from '../services/authService';

/** Stable star field so layout does not shift on re-render. */
function useStarField(count = 120) {
  return useMemo(() => {
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: `${(i * 17.3) % 100}%`,
      top: `${(i * 23.7 + 11) % 100}%`,
      size: (i % 5 === 0 ? 2.5 : i % 3 === 0 ? 1.5 : 1) + (i % 2) * 0.5,
      opacity: 0.35 + (i % 7) * 0.08,
      delay: (i % 11) * 0.4,
      duration: 3 + (i % 5),
    }));
  }, [count]);
}

const SignupPage = () => {
  const navigate = useNavigate();
  const [isLoaded, setIsLoaded] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const stars = useStarField(140);

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
      {/* Deep space base */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 120% 80% at 50% 35%, #0d1228 0%, #06060f 45%, #020205 100%)',
        }}
      />

      {/* Star field */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {stars.map((s) => (
          <div
            key={s.id}
            className="absolute rounded-full bg-white"
            style={{
              left: s.left,
              top: s.top,
              width: s.size,
              height: s.size,
              opacity: s.opacity,
              boxShadow: `0 0 ${s.size * 2}px rgba(255,255,255,0.5)`,
              animation: `signup-twinkle ${s.duration}s ease-in-out ${s.delay}s infinite`,
            }}
          />
        ))}
      </div>

      {/* Ambient nebula — cyan + purple, centered behind logo */}
      <div
        className="pointer-events-none absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2"
        style={{
          width: 'min(92vw, 420px)',
          height: 'min(92vw, 420px)',
          background:
            'radial-gradient(circle at 50% 50%, rgba(56, 189, 248, 0.22) 0%, rgba(88, 28, 135, 0.18) 28%, rgba(30, 10, 60, 0.12) 48%, transparent 72%)',
          filter: 'blur(2px)',
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2"
        style={{
          width: 'min(70vw, 280px)',
          height: 'min(70vw, 280px)',
          background:
            'radial-gradient(circle, rgba(147, 51, 234, 0.15) 0%, rgba(6, 182, 212, 0.08) 40%, transparent 70%)',
          filter: 'blur(28px)',
        }}
        aria-hidden
      />

      <style>{`
        @keyframes signup-twinkle {
          0%, 100% { opacity: 0.25; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.15); }
        }
      `}</style>

      {/* Logo — same treatment as LandingPage */}
      <div className="relative z-10 flex flex-[1.1] min-h-0 items-center justify-center px-6 pb-4 pt-[max(12px,env(safe-area-inset-top))]">
        <div
          className={`relative transition-all duration-1000 ease-out ${
            isLoaded ? 'scale-100 opacity-100' : 'scale-90 opacity-0'
          }`}
        >
          <div
            className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full backdrop-blur-lg relative"
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
