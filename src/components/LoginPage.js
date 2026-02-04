import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { onAuthStateChange, signInUser, sendPasswordReset } from '../services/authService';
import { Brain } from 'lucide-react';
import LaserFlow from './LaserFlow';

const LoginPage = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

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

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await signInUser(email.trim(), password);
      if (result?.success) {
        navigate('/dashboard', { replace: true });
        return;
      }
      const msg = result?.error || 'Sign in failed. Please try again.';
      if (result?.errorCode === 'auth/invalid-credential' || result?.errorCode === 'auth/wrong-password') {
        setError('Invalid email or password. Please try again.');
      } else {
        setError(msg);
      }
    } catch (err) {
      setError(err?.message || 'Sign in failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setError('');
    if (!forgotEmail.trim()) {
      setError('Please enter your email address.');
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await sendPasswordReset(forgotEmail.trim());
      if (result?.success) {
        setForgotSent(true);
      } else {
        setError(result?.error || 'Failed to send reset email.');
      }
    } catch (err) {
      setError(err?.message || 'Failed to send reset email.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className={`min-h-screen flex flex-col relative overflow-hidden transition-all duration-1000 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
      style={{
        background: 'radial-gradient(ellipse at bottom, #1B2735 0%, #090A0F 100%)',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
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
          pointerEvents: 'none',
        }}
      >
        <LaserFlow horizontalBeamOffset={0.0} verticalBeamOffset={0.2} color="#8BC34A" />
      </div>

      <div className="flex-1 flex items-center justify-center px-6 relative" style={{ zIndex: 10 }}>
        <div className="w-full max-w-sm">
          <div className="flex justify-center mb-8">
            <div
              className="rounded-full flex items-center justify-center"
              style={{
                width: '72px',
                height: '72px',
                backgroundColor: '#262626',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              <Brain className="w-9 h-9" style={{ color: '#8AB4F8' }} strokeWidth={1.5} />
            </div>
          </div>

          <h1 className="text-xl font-semibold text-white text-center mb-1">Log in</h1>
          <p className="text-gray-400 text-sm text-center mb-6">Use your email and password</p>

          {showForgotPassword ? (
            <div className="space-y-4">
              {forgotSent ? (
                <div className="rounded-xl p-4 text-center" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
                  <p className="text-white text-sm">Check your email for a link to reset your password.</p>
                  <button
                    type="button"
                    onClick={() => { setShowForgotPassword(false); setForgotSent(false); setForgotEmail(''); }}
                    className="mt-3 text-sm text-[#8AB4F8] hover:underline"
                  >
                    Back to log in
                  </button>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <input
                    type="email"
                    placeholder="Email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    className="w-full rounded-xl px-4 py-3 text-white placeholder-gray-500 border border-white/10 focus:border-[#8AB4F8] focus:outline-none transition-colors"
                    style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
                    autoComplete="email"
                  />
                  {error && <p className="text-red-400 text-sm">{error}</p>}
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full rounded-xl py-3.5 font-medium text-white transition-all hover:opacity-90 disabled:opacity-60"
                    style={{ backgroundColor: '#8AB4F8' }}
                  >
                    {isSubmitting ? 'Sending…' : 'Send reset link'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowForgotPassword(false); setError(''); }}
                    className="w-full text-gray-400 text-sm hover:text-white"
                  >
                    Back to log in
                  </button>
                </form>
              )}
            </div>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl px-4 py-3 text-white placeholder-gray-500 border border-white/10 focus:border-[#8AB4F8] focus:outline-none transition-colors"
                style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
                autoComplete="email"
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl px-4 py-3 text-white placeholder-gray-500 border border-white/10 focus:border-[#8AB4F8] focus:outline-none transition-colors"
                style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
                autoComplete="current-password"
              />
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-xl py-3.5 font-medium text-white transition-all hover:opacity-90 disabled:opacity-60"
                style={{ backgroundColor: '#8AB4F8' }}
              >
                {isSubmitting ? 'Signing in…' : 'Log in'}
              </button>
              <button
                type="button"
                onClick={() => setShowForgotPassword(true)}
                className="w-full text-gray-400 text-sm hover:text-white"
              >
                Forgot password?
              </button>
            </form>
          )}

          <p className="text-center mt-6">
            <Link to="/signup" className="text-[#8AB4F8] hover:underline text-sm">
              Back to sign up
            </Link>
          </p>
        </div>
      </div>

      <div
        style={{
          position: 'relative',
          zIndex: 10,
          paddingLeft: '1.5rem',
          paddingRight: '1.5rem',
          paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom, 24px))',
        }}
      />
    </div>
  );
};

export default LoginPage;
