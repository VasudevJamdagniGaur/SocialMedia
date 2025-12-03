import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { handleGoogleRedirect } from './services/authService';
import { Capacitor } from '@capacitor/core';
import LandingPage from './components/LandingPage';
import WelcomePage from './components/WelcomePage';
import SignupPage from './components/SignupPage';
import EmailSignupPage from './components/EmailSignupPage';
import ProfileDetailsPage from './components/ProfileDetailsPage';
import LoginPage from './components/LoginPage';
import ForgotPasswordPage from './components/ForgotPasswordPage';
import DashboardPage from './components/DashboardPage';
import ChatPage from './components/ChatPage';
import EmotionalWellbeing from './components/EmotionalWellbeing';
import ProfilePage from './components/ProfilePage';
import SplashScreen from './components/SplashScreen';
import CommunityPage from './components/CommunityPage';
import PodPage from './components/PodPage';
import PodGroupChatPage from './components/PodGroupChatPage';
import BottomNavigation from './components/BottomNavigation';

// Lazy load Capacitor App plugin for deep link handling
const getAppPlugin = async () => {
  if (!Capacitor.isNativePlatform()) {
    return null;
  }
  try {
    const { App } = await import('@capacitor/app');
    return App;
  } catch (e) {
    console.warn('⚠️ Capacitor App plugin not available:', e);
    return null;
  }
};

// Component to handle Google Sign-In redirects and route transitions
function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const [displayLocation, setDisplayLocation] = useState(location);
  const [transitionStage, setTransitionStage] = useState('fadeIn');

  useEffect(() => {
    if (location.pathname !== displayLocation.pathname) {
      setTransitionStage('fadeOut');
    }
  }, [location.pathname, displayLocation.pathname]);

  useEffect(() => {
    // Handle Google Sign-In redirect on app load
    const handleAuthRedirect = async () => {
      try {
        const result = await handleGoogleRedirect();
        if (result.success && result.user) {
          navigate('/dashboard', { replace: true });
        }
      } catch (error) {
        console.error('Error handling Google redirect:', error);
      }
    };
    
    // Check for redirect result after app loads
    setTimeout(handleAuthRedirect, 500);
  }, [navigate]);

  // Global Android back button handler
  useEffect(() => {
    let backButtonListener = null;

    const setupGlobalBackButton = async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          const { App } = await import('@capacitor/app');
          
          // Add global listener for back button - handles ALL routes
          // Registering a listener automatically prevents app exit
          backButtonListener = await App.addListener('backButton', () => {
            console.log('🔙 Android hardware back button pressed, current route:', location.pathname);
            
            // Handle navigation based on current route
            if (location.pathname === '/chat') {
              // ChatPage has its own handler for whisper session warnings
              // Let it handle the navigation
              console.log('📍 ChatPage will handle its own navigation');
              // Don't do anything here - ChatPage's handler will take care of it
            } else if (location.pathname === '/wellbeing') {
              // Navigate to dashboard from Emotional Wellbeing
              console.log('📍 Navigating to dashboard from Emotional Wellbeing');
              navigate('/dashboard', { replace: true });
            } else if (location.pathname === '/profile') {
              // Navigate to dashboard from Profile
              console.log('📍 Navigating to dashboard from Profile');
              navigate('/dashboard', { replace: true });
            } else if (location.pathname === '/pod/chat') {
              // Navigate to pod from Pod Group Chat
              console.log('📍 Navigating to pod from Pod Group Chat');
              navigate('/pod', { replace: true });
            } else if (location.pathname === '/pod') {
              // Navigate to dashboard from Pod
              console.log('📍 Navigating to dashboard from Pod');
              navigate('/dashboard', { replace: true });
            } else if (location.pathname === '/community') {
              // Navigate to dashboard from Community
              console.log('📍 Navigating to dashboard from Community');
              navigate('/dashboard', { replace: true });
            } else if (location.pathname === '/dashboard') {
              // If already on dashboard, exit app
              console.log('📍 Already on dashboard, exiting app');
              App.exitApp();
            } else if (location.pathname === '/' || location.pathname === '/landing') {
              // Exit app from landing/splash
              console.log('📍 Exiting app from', location.pathname);
              App.exitApp();
            } else {
              // For other routes (login, signup, etc.), navigate to dashboard
              console.log('📍 Navigating to dashboard from', location.pathname);
              navigate('/dashboard', { replace: true });
            }
          });

          console.log('✅ Global Android back button listener registered');
        } catch (error) {
          console.warn('⚠️ Could not set up global back button listener:', error);
        }
      }
    };

    setupGlobalBackButton();

    // Cleanup listener on unmount
    return () => {
      if (backButtonListener) {
        backButtonListener.remove();
        console.log('🧹 Removed global Android back button listener');
      }
    };
  }, [navigate, location.pathname]);

  return (
    <div
      className={transitionStage}
      onAnimationEnd={() => {
        if (transitionStage === 'fadeOut') {
          setTransitionStage('fadeIn');
          setDisplayLocation(location);
        }
      }}
      style={{
        width: '100%',
        minHeight: '100vh',
      }}
    >
      <Routes location={displayLocation}>
        <Route path="/" element={<SplashScreen />} />
        <Route path="/landing" element={<LandingPage />} />
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/signup/email" element={<EmailSignupPage />} />
        <Route path="/signup/profile-details" element={<ProfileDetailsPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/pod" element={<PodPage />} />
        <Route path="/pod/chat" element={<PodGroupChatPage />} />
        <Route path="/community" element={<CommunityPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/wellbeing" element={<EmotionalWellbeing />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Routes>
      
      {/* Show bottom navigation only on main app pages */}
      {(location.pathname === '/dashboard' || location.pathname === '/pod' || location.pathname === '/community' || location.pathname === '/wellbeing') && (
        <BottomNavigation />
      )}
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <Router>
        <div className="App" style={{ backgroundColor: '#202124', minHeight: '100vh' }}>
          <AppContent />
        </div>
      </Router>
    </ThemeProvider>
  );
}

export default App;

