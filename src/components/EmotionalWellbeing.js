import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { Capacitor } from '@capacitor/core';
import emotionalAnalysisService from '../services/emotionalAnalysisService';
import patternAnalysisService from '../services/patternAnalysisService';
import habitAnalysisService from '../services/habitAnalysisService';
import { getCurrentUser } from '../services/authService';
import chatService from '../services/chatService';
import firestoreService from '../services/firestoreService';
import { getDateId } from '../utils/dateUtils';
import { 
  Brain, 
  Heart, 
  Star, 
  Smile,
  BarChart3,
  Target,
  Lightbulb,
  Award,
  AlertTriangle,
  Zap,
  BookOpen,
  Sun,
  RefreshCw
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip
} from 'recharts';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

// Error Boundary Component
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('EmotionalWellbeing Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white p-6">
          <div className="text-center">
            <h2 className="text-xl font-bold mb-4">Something went wrong</h2>
            <p className="text-gray-400 mb-4">The Emotional Wellbeing section encountered an error.</p>
            <button 
              onClick={() => window.location.reload()} 
              className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function EmotionalWellbeing() {
  const navigate = useNavigate();
  const { isDarkMode } = useTheme();

  // Add CSS animation styles and mobile utilities
  React.useEffect(() => {
    try {
      const style = document.createElement('style');
      style.textContent = `
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        @media (max-width: 475px) {
          .xs\\:block {
            display: none !important;
          }
        }
      `;
      document.head.appendChild(style);
      return () => {
        try {
          document.head.removeChild(style);
        } catch (e) {
          // Style already removed or doesn't exist
        }
      };
    } catch (error) {
      console.error('Error adding styles:', error);
    }
  }, []);
  
  // Add initial loading state
  const [isInitializing, setIsInitializing] = useState(true);
  const [emotionalData, setEmotionalData] = useState([]);
  const [weeklyMoodData, setWeeklyMoodData] = useState([]);
  const [moodBalance, setMoodBalance] = useState([]);
  const [topEmotions, setTopEmotions] = useState([]);
  const [highlights, setHighlights] = useState({});
  const [highlightsLoading, setHighlightsLoading] = useState(false);
  const [triggers, setTriggers] = useState({});
  const [selectedPeriod, setSelectedPeriod] = useState(7); // 7, 15 days, or 365 (lifetime)
  const [balancePeriod, setBalancePeriod] = useState(7); // 1, 7, or 30 days for emotional balance
  const [patternPeriod] = useState(30); // Fixed to 30 days (this month) to focus on recent data
  const [highlightsPeriod] = useState('3months'); // Always show last 3 months
  const [patternLoading, setPatternLoading] = useState(false);
  const [patternAnalysis, setPatternAnalysis] = useState(null);
  const [habitAnalysis, setHabitAnalysis] = useState(null);
  const [habitLoading, setHabitLoading] = useState(false);
  const [hasEnoughData, setHasEnoughData] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [selectedDateDetails, setSelectedDateDetails] = useState(null);
  const [selectedGuidanceTip, setSelectedGuidanceTip] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [emotionExplanations, setEmotionExplanations] = useState(null);
  const [isLoadingFresh, setIsLoadingFresh] = useState(false);
  const [lastCacheUpdate, setLastCacheUpdate] = useState(null);
  const [chartKey, setChartKey] = useState(0); // Force chart re-render
  const preCacheCompletedRef = useRef(false); // Track if pre-caching has been completed
  const periodRequestIdRef = useRef(0); // Track in-flight period requests

  // Expose force update function to global scope
  useEffect(() => {
    window.forceDashboardUpdate = async () => {
      console.log('🔥 GLOBAL FORCE UPDATE: Called from external script');
      const user = getCurrentUser();
      if (user) {
        console.log('🔥 GLOBAL FORCE UPDATE: Clearing all caches and reloading...');
        // Clear all caches
        const cacheKeys = Object.keys(localStorage).filter(key =>
          key.includes('emotional_wellbeing') || key.includes('moodChart') || key.includes('emotionalBalance') || key.includes('force_fresh_data_until')
        );
        cacheKeys.forEach(key => localStorage.removeItem(key));

        // Force immediate data load from Firestore
        const result = await firestoreService.getMoodChartDataNew(user.uid, selectedPeriod);
        if (result.success && result.moodData && result.moodData.length > 0) {
          console.log('✅ GLOBAL FORCE UPDATE: Got fresh data from Firestore');
          setWeeklyMoodData(result.moodData);
          setEmotionalData(result.moodData);
          setChartKey(prev => prev + 1);
        }

        // Reload all data
        await loadFreshData();
        console.log('✅ GLOBAL FORCE UPDATE: Complete');
      }
    };
  }, [selectedPeriod]);

  // Debug logging for data states
  useEffect(() => {
    console.log('🔍 DEBUG: =================== STATE UPDATE ===================');
    console.log('🔍 DEBUG: weeklyMoodData length:', weeklyMoodData?.length);
    console.log('🔍 DEBUG: weeklyMoodData FULL ARRAY:', weeklyMoodData);
    console.log('🔍 DEBUG: Oct 8 in weeklyMoodData:', weeklyMoodData?.find(d => d.day && d.day.includes('Oct 8')));
    console.log('🔍 DEBUG: emotionalData length:', emotionalData?.length);
    console.log('🔍 DEBUG: emotionalData FULL ARRAY:', emotionalData);
    console.log('🔍 DEBUG: ====================================================');
  }, [weeklyMoodData, emotionalData]);

  // Force chart re-render when data changes
  useEffect(() => {
    if (weeklyMoodData.length > 0) {
      setChartKey(prev => prev + 1);
      console.log('🔄 CHART: Forcing re-render with new data');
    }
  }, [weeklyMoodData]);

  // Cache keys for different data types
  const getCacheKey = (type, period, userId) => `emotional_wellbeing_${type}_${period}_${userId}`;

  // Cache management functions
  // Helper function to check if we should fetch fresh data (after 12 PM or forced refresh)
  // Defined early so it can be used by loadFromCache
  const shouldFetchFreshData = useCallback((lastFetchTimestamp, forceRefresh = false) => {
    if (forceRefresh) {
      console.log('🔄 Force refresh requested');
      return true;
    }
    
    const now = new Date();
    const currentHour = now.getHours();
    const currentDate = now.toDateString();
    
    // If it's before 12 PM, use cached data
    if (currentHour < 12) {
      console.log('⏰ Before 12 PM - using cached data');
      return false;
    }
    
    // If it's after 12 PM, check if we've already fetched today
    if (currentHour >= 12) {
      if (!lastFetchTimestamp) {
        console.log('⏰ After 12 PM - no previous fetch, will fetch');
        return true;
      }
      
      const lastFetch = new Date(lastFetchTimestamp);
      const lastFetchDate = lastFetch.toDateString();
      const lastFetchHour = lastFetch.getHours();
      
      // If it's a different day, or same day but last fetch was before 12 PM, fetch again
      if (lastFetchDate !== currentDate || lastFetchHour < 12) {
        console.log('⏰ After 12 PM - new day or last fetch was before 12 PM, will fetch');
        return true;
      }
      
      console.log('⏰ After 12 PM - already fetched today after 12 PM, using cache');
      return false;
    }
    
    return false;
  }, []);

  const saveToCache = (key, data) => {
    try {
      const now = new Date();
      const cacheData = {
        data,
        timestamp: now.toISOString(),
        lastFetchTimestamp: now.toISOString(), // Track when we last fetched from Firebase
        version: '1.0'
      };
      localStorage.setItem(key, JSON.stringify(cacheData));
      console.log(`💾 CACHE: Saved data to cache with timestamp: ${now.toISOString()}`);
    } catch (error) {
      console.error('Error saving to cache:', error);
    }
  };

  const loadFromCache = (key, maxAgeMinutes = 30, check12PM = false) => {
    try {
      const cached = localStorage.getItem(key);
      if (!cached) {
        console.log(`💾 CACHE: No cache found for key: ${key}`);
        return null;
      }

      const cacheData = JSON.parse(cached);
      
      // Handle both old format (cacheData.data) and new format (cacheData directly)
      const data = cacheData.data || cacheData;
      const timestamp = cacheData.timestamp || cacheData.data?.timestamp;
      const lastFetchTimestamp = cacheData.lastFetchTimestamp || timestamp;
      
      if (!timestamp) {
        console.log(`💾 CACHE: Invalid cache format for key: ${key}`);
        return null;
      }
      
      // If check12PM is enabled, check if we should fetch fresh data
      if (check12PM) {
        const shouldFetch = shouldFetchFreshData(lastFetchTimestamp, false);
        if (shouldFetch) {
          console.log(`💾 CACHE: After 12 PM and need fresh data, not using cache for key: ${key}`);
          return null; // Don't use cache, will fetch fresh
        }
      }
      
      const ageMinutes = (Date.now() - new Date(timestamp).getTime()) / (1000 * 60);
      
      if (ageMinutes > maxAgeMinutes) {
        console.log(`💾 CACHE: Cache expired (${Math.round(ageMinutes)} minutes old, max ${maxAgeMinutes} minutes)`);
        localStorage.removeItem(key);
        return null;
      }

      console.log(`💾 CACHE: Using cached data (${Math.round(ageMinutes)} minutes old)`);
      return data;
    } catch (error) {
      console.error('Error loading from cache:', error);
      return null;
    }
  };

  const startNewPeriodRequest = (period) => {
    const label = period === 365 ? 'lifetime' : `${period} days`;
    periodRequestIdRef.current += 1;
    console.log(`🆕 Started period request #${periodRequestIdRef.current} for ${label}`);
    return periodRequestIdRef.current;
  };

  const isLatestPeriodRequest = (requestId) => requestId === periodRequestIdRef.current;

  // Data loading functions
  const loadCachedEmotionalData = useCallback((userId, period) => {
    const cacheKey = getCacheKey('emotional', period, userId);
    // Check 12 PM rule - only use cache if before 12 PM or already fetched after 12 PM today
    const cachedData = loadFromCache(cacheKey, 24 * 60, true); // 24 hours cache, check 12 PM rule
    
    if (cachedData && cachedData.weeklyMoodData && cachedData.weeklyMoodData.length > 0) {
      console.log(`⚡ Setting cached emotional data instantly (${cachedData.weeklyMoodData.length} days)`);
      console.log(`⚡ Cache period: ${cachedData.period}, Data count: ${cachedData.dataCount}`);
      setWeeklyMoodData(cachedData.weeklyMoodData || []);
      setEmotionalData(cachedData.emotionalData || []);
      setLastCacheUpdate(cachedData.timestamp);
      return true; // Cache exists
    }
    console.log('⚡ No valid cache found for emotional data (or need fresh data after 12 PM)');
    return false; // No cache
  }, [shouldFetchFreshData]);

  const loadCachedBalanceData = useCallback((userId, period) => {
    const cacheKey = getCacheKey('balance', period, userId);
    // Check 12 PM rule - only use cache if before 12 PM or already fetched after 12 PM today
    const cachedData = loadFromCache(cacheKey, 24 * 60, true); // 24 hours cache, check 12 PM rule
    
    if (cachedData) {
      console.log('⚡ Setting cached balance data instantly');
      setMoodBalance(cachedData.moodBalance || []);
      setTopEmotions(cachedData.topEmotions || []);
      return true; // Cache exists
    }
    return false; // No cache
  }, [shouldFetchFreshData]);

  const loadCachedPatternData = useCallback((userId, period) => {
    const cacheKey = getCacheKey('pattern', period, userId);
    const cachedData = loadFromCache(cacheKey, 24 * 60); // 24 hours cache (persist across sessions)
    
    if (cachedData) {
      console.log('⚡ Setting cached pattern data instantly');
      setPatternAnalysis(cachedData.patternAnalysis);
      setTriggers(cachedData.triggers || {});
      setHasEnoughData(cachedData.hasEnoughData !== false);
      
      // Check if we should fetch fresh data (after 12 PM)
      const lastFetchTimestamp = cachedData.lastFetchTimestamp || cachedData.timestamp;
      
      if (shouldFetchFreshData(lastFetchTimestamp, false)) {
        console.log('⏰ After 12 PM - will refresh pattern data in background');
        // Don't return early - let it load fresh data in background
      } else {
        console.log('⏰ Before 12 PM or already fetched today - using cached pattern data');
        return true; // Use cached data, no need to refresh
      }
    }
    return false;
  }, [shouldFetchFreshData]);

  const loadCachedHighlightsData = useCallback((userId, period) => {
    const cacheKey = getCacheKey('highlights', '3months', userId);
    const cachedData = loadFromCache(cacheKey, 24 * 60); // 24 hours cache (persist across sessions)
    
    if (cachedData) {
      console.log('⚡ Setting cached highlights data instantly');
      setHighlights(cachedData.highlights || {});
      setHighlightsLoading(false);
      
      // Check if we should fetch fresh data (after 12 PM)
      const lastFetchTimestamp = cachedData.lastFetchTimestamp || cachedData.timestamp;
      
      if (shouldFetchFreshData(lastFetchTimestamp, false)) {
        console.log('⏰ After 12 PM - will refresh highlights data in background');
        // Don't return early - let it load fresh data in background
      } else {
        console.log('⏰ Before 12 PM or already fetched today - using cached highlights data');
        return true; // Use cached data, no need to refresh
      }
    } else {
      // No cache - set loading to true
      setHighlightsLoading(true);
    }
    return false;
  }, [shouldFetchFreshData]);

  const loadCachedData = useCallback((userId) => {
    console.log('⚡ Loading all cached data instantly...');
    
    // Load cached emotional data
    loadCachedEmotionalData(userId, selectedPeriod);
    
    // Load cached balance data
    loadCachedBalanceData(userId, balancePeriod);
    
    // Load cached pattern data
    loadCachedPatternData(userId, patternPeriod);
    
    // Load cached highlights data
    loadCachedHighlightsData(userId, highlightsPeriod);
  }, [selectedPeriod, balancePeriod, patternPeriod, highlightsPeriod, loadCachedEmotionalData, loadCachedBalanceData, loadCachedPatternData, loadCachedHighlightsData]);

  // Fresh data loading functions (background) - Define individual functions first
  const loadFreshEmotionalData = async (forceRefresh = false, period = selectedPeriod, requestId = startNewPeriodRequest(period)) => {
    const user = getCurrentUser();
    if (!user) return;

    // Check if we should fetch (after 12 PM or force refresh)
    if (!forceRefresh) {
      const cacheKey = getCacheKey('emotional', period, user.uid);
      const cachedData = localStorage.getItem(cacheKey);
      let lastFetchTimestamp = null;
      if (cachedData) {
        try {
          const parsed = JSON.parse(cachedData);
          lastFetchTimestamp = parsed.lastFetchTimestamp || parsed.timestamp;
        } catch (e) {
          console.error('Error parsing cache:', e);
        }
      }
      
      const shouldFetch = shouldFetchFreshData(lastFetchTimestamp, false);
      if (!shouldFetch) {
        console.log('⏰ Before 12 PM or already fetched today - skipping fresh fetch');
        return;
      }
    }

    const freshData = await loadRealEmotionalDataInternal(period, requestId);
    if (!freshData) return;

    if (!isLatestPeriodRequest(requestId)) {
      console.log(`⚠️ Stale emotional data for ${period === 365 ? 'lifetime' : period + ' days'} - skipping cache save`);
      return;
    }

    const cacheKey = getCacheKey('emotional', period, user.uid);
    saveToCache(cacheKey, {
      weeklyMoodData: freshData.weeklyMoodData,
      emotionalData: freshData.emotionalData,
      period: period,
      dataCount: freshData.weeklyMoodData?.length || 0,
      timestamp: new Date().toISOString()
    });
  };

  const loadFreshBalanceData = async (period = balancePeriod, forceRefresh = false) => {
    const user = getCurrentUser();
    if (!user) return;

    // Check if we should fetch (after 12 PM or force refresh)
    if (!forceRefresh) {
      const cacheKey = getCacheKey('balance', period, user.uid);
      const cachedData = localStorage.getItem(cacheKey);
      let lastFetchTimestamp = null;
      if (cachedData) {
        try {
          const parsed = JSON.parse(cachedData);
          lastFetchTimestamp = parsed.lastFetchTimestamp || parsed.timestamp;
        } catch (e) {
          console.error('Error parsing cache:', e);
        }
      }
      
      const shouldFetch = shouldFetchFreshData(lastFetchTimestamp, false);
      if (!shouldFetch) {
        console.log('⏰ Before 12 PM or already fetched today - skipping fresh balance fetch');
        return;
      }
    }

    const freshData = await loadBalanceDataInternal(period, { updateState: true });
    if (freshData) {
      const cacheKey = getCacheKey('balance', period, user.uid);
      saveToCache(cacheKey, {
        moodBalance: freshData.moodBalance,
        topEmotions: freshData.topEmotions,
        timestamp: new Date().toISOString()
      });
    }
  };

  const prefetchAllBalancePeriods = async (forceRefresh = false, skipPeriod = null) => {
    const user = getCurrentUser();
    if (!user) return;

    const periods = [7, 30, 365];

    for (const period of periods) {
      if (skipPeriod === period) {
        continue;
      }

      const cacheKey = getCacheKey('balance', period, user.uid);
      const cached = loadFromCache(cacheKey, 30);

      if (!forceRefresh && cached) {
        console.log(`⚡ Balance cache already available for ${period === 365 ? 'lifetime' : period + ' days'}`);
        continue;
      }

      try {
        const balanceData = await loadBalanceDataInternal(period, { updateState: false });
        if (balanceData) {
          saveToCache(cacheKey, {
            moodBalance: balanceData.moodBalance,
            topEmotions: balanceData.topEmotions,
            timestamp: new Date().toISOString()
          });
          console.log(`✅ Pre-cached balance data for ${period === 365 ? 'lifetime' : period + ' days'}`);
        }
      } catch (error) {
        console.error(`❌ Error pre-caching balance data for ${period === 365 ? 'lifetime' : period + ' days'}`, error);
      }
    }
  };

  const loadFreshHighlightsData = async () => {
    const user = getCurrentUser();
    if (!user) return;

    setHighlightsLoading(true);
    // Clear highlights while loading to prevent showing old data
    setHighlights({});
    try {
      const freshData = await loadHighlightsDataInternal();
      if (freshData) {
        const cacheKey = getCacheKey('highlights', '3months', user.uid);
        const today = new Date().toDateString();
        saveToCache(cacheKey, {
          highlights: freshData.highlights,
          timestamp: new Date().toISOString(),
          lastUpdateDate: today // Track the date when highlights were last updated
        });
      }
    } finally {
      setHighlightsLoading(false);
    }
  };

  const loadFreshPatternAnalysis = async (forceRefresh = false) => {
    const user = getCurrentUser();
    if (!user) return;

    const freshData = await loadPatternAnalysisInternal();
    if (freshData) {
      const cacheKey = getCacheKey('pattern', patternPeriod, user.uid);
      const today = new Date().toDateString();
      saveToCache(cacheKey, {
        patternAnalysis: freshData.patternAnalysis,
        triggers: freshData.triggers,
        hasEnoughData: freshData.hasEnoughData,
        timestamp: new Date().toISOString(),
        lastUpdateDate: today // Track the date when pattern analysis was last updated
      });
    }
  };

  const loadFreshDataOnly = async () => {
    console.log('🚨 FORCE FRESH ONLY: Loading data directly from Firestore (no caching)...');
    const user = getCurrentUser();
    if (!user) return;

    try {
      // Load emotional data directly from Firestore
      const result = await firestoreService.getMoodChartDataNew(user.uid, selectedPeriod);
      if (result.success && result.moodData && result.moodData.length > 0) {
        console.log('✅ FORCE FRESH ONLY: Got fresh data from Firestore:', result.moodData.length, 'days');
        setWeeklyMoodData(result.moodData);
        setEmotionalData(result.moodData);
        setChartKey(prev => prev + 1); // Force chart re-render
      }

      // Also load balance data
      const balanceResult = await firestoreService.getMoodChartDataNew(user.uid, 30); // Balance uses 30 days
      if (balanceResult.success && balanceResult.moodData && balanceResult.moodData.length > 0) {
        setMoodBalance(balanceResult.moodData);
      }

    } catch (error) {
      console.error('❌ FORCE FRESH ONLY Error:', error);
    }
  };

  const loadFreshData = async (forceRefresh = false) => {
    console.log('🔄 Loading fresh data in background...', forceRefresh ? '(force refresh)' : '');
    setIsLoadingFresh(true);

    try {
      const user = getCurrentUser();
      const promises = [
        loadFreshEmotionalData(forceRefresh),
        loadFreshBalanceData(balancePeriod, forceRefresh)
      ];
      
      // Only load fresh pattern analysis if force refresh or after 12 PM
      if (forceRefresh || shouldFetchFreshData(null, false)) {
        promises.push(loadFreshPatternAnalysis(forceRefresh));
      } else {
        console.log('⏰ Pattern analysis cache is still valid, skipping refresh');
      }
      
      // Only load fresh highlights if force refresh or after 12 PM
      if (forceRefresh || shouldFetchFreshData(null, false)) {
        promises.push(loadFreshHighlightsData(forceRefresh));
      } else {
        console.log('⏰ Highlights cache is still valid, skipping refresh');
      }
      
      await Promise.all(promises);
      await prefetchAllBalancePeriods(true, balancePeriod);
    } catch (error) {
      console.error('❌ Error loading fresh data:', error);
    } finally {
      setIsLoadingFresh(false);
    }
  };

  // Load cached data instantly on mount only
  useEffect(() => {
    const initializeComponent = async () => {
      try {
        setIsInitializing(true);
        const user = getCurrentUser();
        
        if (!user) {
          console.warn('⚠️ No user found, component will render with empty state');
          setIsInitializing(false);
          return;
        }

        // CRITICAL FIX: Migrate any existing localStorage data to Firestore
        try {
          const migrated = localStorage.getItem('emotional_data_migrated');
          if (!migrated) {
            console.log('🔄 First time loading - checking for localStorage data to migrate...');
            emotionalAnalysisService.migrateLocalStorageToFirestore(user.uid).then(result => {
              if (result.success) {
                console.log(`✅ Migration complete: ${result.migrated} records migrated`);
                localStorage.setItem('emotional_data_migrated', 'true');
                // Clear cache to force reload with new data
                const cacheKeys = Object.keys(localStorage).filter(key =>
                  key.includes('emotional_wellbeing') || key.includes('moodChart')
                );
                cacheKeys.forEach(key => localStorage.removeItem(key));
              }
            }).catch(error => {
              console.error('❌ Migration error:', error);
            });
          }
        } catch (error) {
          console.error('❌ Error checking migration status:', error);
        }
        
        // Check if we need to force fresh data loading (bypass all caching)
        const forceFreshUntil = localStorage.getItem('force_fresh_data_until');
        const currentTime = Date.now();
        const shouldForceFresh = forceFreshUntil && parseInt(forceFreshUntil) > currentTime;

        if (shouldForceFresh) {
          console.log('🚨 FORCE FRESH MODE: Bypassing all caching for fresh data...');
          // Skip all caching and load directly from Firestore
          try {
            await loadFreshDataOnly();
          } catch (error) {
            console.error('❌ Error in force fresh data load:', error);
          }
          setIsInitializing(false);
          return;
        }

        // Check if we need to force refresh due to new data
        const lastRefresh = localStorage.getItem('emotional_data_refresh');
        const shouldForceRefresh = lastRefresh && (currentTime - parseInt(lastRefresh)) < 60000; // Within last minute

        if (shouldForceRefresh) {
          console.log('🔄 FORCE REFRESH: New emotional data detected, clearing all caches...');
          // Clear ALL emotional wellbeing caches
          const cacheKeys = Object.keys(localStorage).filter(key =>
            key.includes('emotional_wellbeing') || key.includes('moodChart') || key.includes('emotionalBalance') || key.includes('force_fresh_data_until')
          );
          cacheKeys.forEach(key => {
            localStorage.removeItem(key);
            console.log('🗑️ Cleared cache:', key);
          });
        }

        // Load cached data instantly on initial mount only
        try {
          loadCachedData(user.uid);
        } catch (error) {
          console.error('❌ Error loading cached data:', error);
        }

        // CRITICAL: Check for forced fresh data and use it immediately
        const forcedCacheKey = `emotional_wellbeing_emotional_7_${user.uid}`;
        const forcedData = localStorage.getItem(forcedCacheKey);

        if (forcedData) {
          try {
            const parsedForcedData = JSON.parse(forcedData);
            console.log('🔥 FORCE DATA: Using forced fresh data:', parsedForcedData);
            setWeeklyMoodData(parsedForcedData.weeklyMoodData || []);
            setEmotionalData(parsedForcedData.emotionalData || []);
            setChartKey(prev => prev + 1); // Force chart re-render
          } catch (error) {
            console.error('❌ Error parsing forced data:', error);
          }
        }

        // Only fetch fresh data if it's after 12 PM and we haven't fetched today
        // Otherwise, use cached data (refresh button will force update when needed)
        const cacheKey = getCacheKey('emotional', 7, user.uid);
        const cachedData = localStorage.getItem(cacheKey);
        let lastFetchTimestamp = null;
        if (cachedData) {
          try {
            const parsed = JSON.parse(cachedData);
            lastFetchTimestamp = parsed.lastFetchTimestamp || parsed.timestamp;
          } catch (e) {
            console.error('Error parsing cache:', e);
          }
        }
        
        const shouldRefresh = shouldFetchFreshData(lastFetchTimestamp, false);
        if (shouldRefresh) {
          console.log('⏰ After 12 PM - fetching fresh data in background');
          loadFreshData().catch(error => {
            console.error('❌ Error loading fresh data:', error);
          });
        } else {
          console.log('⏰ Using cached data on mount (before 12 PM or already fetched today)');
        }
        
        // Set initialization complete after a short delay to ensure UI renders
        setTimeout(() => {
          setIsInitializing(false);
        }, 100);
      } catch (error) {
        console.error('❌ CRITICAL ERROR in EmotionalWellbeing initialization:', error);
        setIsInitializing(false);
      }
    };

    initializeComponent();
  }, [shouldFetchFreshData]); // Run only once on mount

  // Listen for localStorage changes and custom events to detect when new emotional data is saved
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === 'emotional_data_refresh' && e.newValue) {
        console.log('🔄 STORAGE CHANGE: New emotional data detected!');
        // Force immediate refresh
        const user = getCurrentUser();
        if (user) {
          console.log('🔄 STORAGE CHANGE: Clearing cache and reloading...');
          // Clear all caches
          const cacheKeys = Object.keys(localStorage).filter(key =>
            key.includes('emotional_wellbeing') || key.includes('moodChart') || key.includes('emotionalBalance')
          );
          cacheKeys.forEach(key => localStorage.removeItem(key));

          // Force reload
          loadCachedData(user.uid);
          loadFreshData();
        }
      }
    };

    const handleCustomEvent = (e) => {
      console.log('🔄 CUSTOM EVENT: Emotional data updated!', e.detail);
      const user = getCurrentUser();
      if (user && e.detail && e.detail.scores) {
        console.log('🔥 CUSTOM EVENT: Using provided scores directly!');
        const { scores, dateId } = e.detail;

        // Create fresh mood data from the provided scores
        const freshMoodData = [{
          date: dateId,
          day: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          happiness: scores.happiness,
          anxiety: scores.anxiety,
          stress: scores.stress,
          energy: scores.energy
        }];

        // Set the data directly in state to force immediate update
        setWeeklyMoodData(freshMoodData);
        setEmotionalData(freshMoodData);
        setChartKey(prev => prev + 1); // Force chart re-render

        console.log('✅ CUSTOM EVENT: Mood data updated immediately:', freshMoodData);

        // Also clear caches to ensure consistency
        const cacheKeys = Object.keys(localStorage).filter(key =>
          key.includes('emotional_wellbeing') || key.includes('moodChart') || key.includes('emotionalBalance')
        );
        cacheKeys.forEach(key => localStorage.removeItem(key));
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('emotionalDataUpdated', handleCustomEvent);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('emotionalDataUpdated', handleCustomEvent);
    };
  }, []); // No dependencies - set up event listeners once

  useEffect(() => {
    const user = getCurrentUser();
    if (user) {
      const requestId = startNewPeriodRequest(selectedPeriod);
      console.log('🔄 MOOD CHART: Period changed to', selectedPeriod);
      // Try to load from cache first - ONLY for selectedPeriod
      const hasCache = loadCachedEmotionalData(user.uid, selectedPeriod);
      
      // Only load fresh data if it's after 12 PM or refresh is needed
      const cacheKey = getCacheKey('emotional', selectedPeriod, user.uid);
      const cachedData = localStorage.getItem(cacheKey);
      let lastFetchTimestamp = null;
      if (cachedData) {
        try {
          const parsed = JSON.parse(cachedData);
          lastFetchTimestamp = parsed.lastFetchTimestamp || parsed.timestamp;
        } catch (e) {
          console.error('Error parsing cache:', e);
        }
      }
      
      const shouldFetch = shouldFetchFreshData(lastFetchTimestamp, false);
      
      if (hasCache && !shouldFetch) {
        console.log('⚡ Using cached data for period', selectedPeriod, '- instant switch! (Before 12 PM or already fetched today)');
        // Don't fetch in background if before 12 PM or already fetched today
        return;
      } else if (hasCache && shouldFetch) {
        console.log('⚡ Using cached data for period', selectedPeriod, '- instant switch! Loading fresh in background after 12 PM...');
        // Load fresh data in background to update cache
        loadFreshEmotionalData(selectedPeriod, requestId);
      } else {
        console.log('⚡ No cache for period', selectedPeriod, '- loading fresh data');
        loadFreshEmotionalData(selectedPeriod, requestId);
      }
    }
  }, [selectedPeriod]); // Only depend on selectedPeriod

  useEffect(() => {
    const user = getCurrentUser();
    if (user) {
      console.log('🔄 BALANCE CHART: Period changed to', balancePeriod);
      
      // For lifetime, always load fresh data to ensure we get all data from first chat
      if (balancePeriod === 365) {
        console.log('⚖️ LIFETIME selected - loading fresh data from first chat date');
        loadFreshBalanceData(balancePeriod);
      } else {
        // For 7 or 30 days, try cache first
        const hasBalanceCache = loadCachedBalanceData(user.uid, balancePeriod);
        
        if (!hasBalanceCache) {
          console.log('⚖️ No balance cache for period', balancePeriod, '- loading fresh data');
          loadFreshBalanceData(balancePeriod);
        } else {
          console.log('⚖️ Using cached balance data for period', balancePeriod, '- instant switch!');
        }
      }
    }
  }, [balancePeriod]); // Only depend on balancePeriod

  // Pre-cache all periods (7, 15, lifetime) in background for instant switching
  useEffect(() => {
    const user = getCurrentUser();
    if (user && !isInitializing && !preCacheCompletedRef.current) {
      preCacheCompletedRef.current = true; // Mark as completed to prevent re-running
      console.log('🚀 Pre-caching all periods for instant switching...');
      
      // Helper function to process and cache mood data
      const processAndCacheMoodData = async (period, moodData) => {
        if (moodData && moodData.length > 0) {
          // Apply emotion rules (same as in loadRealEmotionalDataInternal)
          const processedMoodData = moodData.map(day => {
            let { happiness, energy, anxiety, stress } = day;
            
            // Rule: Happiness decreases if stress/anxiety are high
            if ((stress >= 60 || anxiety >= 60) && happiness > 50) {
              happiness = Math.min(50, happiness);
            }
            
            // Rule: If happiness is very high, stress/anxiety should be lower
            if (happiness >= 70) {
              if (stress > 40) stress = 40;
              if (anxiety > 40) anxiety = 40;
            }
            
            return {
              ...day,
              happiness,
              energy,
              anxiety,
              stress
            };
          });

          const cacheKey = getCacheKey('emotional', period, user.uid);
          saveToCache(cacheKey, {
            weeklyMoodData: processedMoodData,
            emotionalData: processedMoodData,
            timestamp: new Date().toISOString()
          });
          console.log(`✅ Pre-cached ${period === 365 ? 'lifetime' : period + ' days'} data: ${processedMoodData.length} days`);
        }
      };

      // Pre-cache 7 days (if not already cached)
      const cache7Key = getCacheKey('emotional', 7, user.uid);
      const cache7 = loadFromCache(cache7Key, 30);
      if (!cache7) {
        firestoreService.getMoodChartDataNew(user.uid, 7)
          .then(result => {
            if (result.success && result.moodData) {
              processAndCacheMoodData(7, result.moodData);
            }
          })
          .catch(error => {
            console.error('❌ Error pre-caching 7 days:', error);
          });
      } else {
        console.log('⚡ 7 days already cached');
      }
      
      // Pre-cache 15 days (if not already cached)
      const cache15Key = getCacheKey('emotional', 15, user.uid);
      const cache15 = loadFromCache(cache15Key, 30);
      if (!cache15) {
        firestoreService.getMoodChartDataNew(user.uid, 15)
          .then(result => {
            if (result.success && result.moodData) {
              processAndCacheMoodData(15, result.moodData);
            }
          })
          .catch(error => {
            console.error('❌ Error pre-caching 15 days:', error);
          });
      } else {
        console.log('⚡ 15 days already cached');
      }
      
      // Pre-cache lifetime (if not already cached)
      const cacheLifetimeKey = getCacheKey('emotional', 365, user.uid);
      const cacheLifetime = loadFromCache(cacheLifetimeKey, 30);
      if (!cacheLifetime) {
        firestoreService.getAllMoodChartDataNew(user.uid)
          .then(result => {
            if (result.success && result.moodData) {
              processAndCacheMoodData(365, result.moodData);
            } else {
              // Fallback to 30 days if no lifetime data
              console.log('📊 LIFETIME: No lifetime data found, pre-caching 30 days as fallback');
              return firestoreService.getMoodChartDataNew(user.uid, 30);
            }
          })
          .then(result => {
            if (result && result.success && result.moodData) {
              processAndCacheMoodData(365, result.moodData);
            }
          })
          .catch(error => {
            console.error('❌ Error pre-caching lifetime:', error);
          });
      } else {
        console.log('⚡ Lifetime already cached');
      }

      prefetchAllBalancePeriods()
        .catch(error => console.error('❌ Error pre-caching balance periods:', error));
    }
  }, [isInitializing]);

  useEffect(() => {
    const user = getCurrentUser();
    if (user) {
      const hasCache = loadCachedPatternData(user.uid, patternPeriod);
      
      // Only load fresh data if it's a new day after 12 PM or no cached data exists
      const cacheKey = getCacheKey('pattern', patternPeriod, user.uid);
      const cachedData = loadFromCache(cacheKey, 24 * 60);
      
      if (!cachedData) {
        console.log('📅 No cached pattern data, loading fresh data');
        loadFreshPatternAnalysis();
      } else {
        const lastUpdateDate = cachedData.lastUpdateDate;
        
        const lastFetchTimestamp = cachedData.lastFetchTimestamp || cachedData.timestamp;
        if (shouldFetchFreshData(lastFetchTimestamp, false)) {
          console.log('⏰ After 12 PM detected, refreshing pattern data');
          loadFreshPatternAnalysis();
        } else {
          console.log('📅 Same day or before 12 PM, using cached pattern data');
        }
      }
      
      loadHabitAnalysis(false); // Don't force refresh on initial load
    }
  }, [patternPeriod, loadCachedPatternData, shouldFetchFreshData]);

  useEffect(() => {
    const user = getCurrentUser();
    if (user) {
      const hasCache = loadCachedHighlightsData(user.uid, highlightsPeriod);
      
      // Only load fresh data if it's a new day after 12 PM or no cached data exists
      const cacheKey = getCacheKey('highlights', '3months', user.uid);
      const cachedData = loadFromCache(cacheKey, 24 * 60);
      
      if (!cachedData) {
        console.log('📅 No cached highlights data, loading fresh data');
        loadFreshHighlightsData();
      } else {
        const lastUpdateDate = cachedData.lastUpdateDate;
        
        const lastFetchTimestamp = cachedData.lastFetchTimestamp || cachedData.timestamp;
        if (shouldFetchFreshData(lastFetchTimestamp, false)) {
          console.log('⏰ After 12 PM detected, refreshing highlights data');
          loadFreshHighlightsData();
        } else {
          console.log('📅 Same day or before 12 PM, using cached highlights data');
        }
      }
    }
  }, [highlightsPeriod, loadCachedHighlightsData, shouldFetchFreshData]);

  const loadHabitAnalysis = async (forceRefresh = false) => {
    const user = getCurrentUser();
    if (!user) return;

    setHabitLoading(true);
    try {
      const analysis = await habitAnalysisService.getHabitAnalysis(user.uid, forceRefresh);
      setHabitAnalysis(analysis);
      console.log('📊 Habit analysis loaded:', analysis);
    } catch (error) {
      console.error('Error loading habit analysis:', error);
    } finally {
      setHabitLoading(false);
    }
  };

  const loadRealEmotionalDataInternal = async (period = selectedPeriod, requestId = periodRequestIdRef.current) => {
    console.log(`📊 UNIFIED: Loading AI emotional data for ${period === 365 ? 'lifetime' : period + ' days'} from NEW Firebase structure...`);
    
    const user = getCurrentUser();
    if (!user) {
      console.log('📊 UNIFIED: No user logged in, showing empty state');
      if (isLatestPeriodRequest(requestId)) {
        showEmptyState(period);
      }
      return null;
    }

    try {
      // First, check for missing days and generate analysis if needed
      const daysToCheck = period === 365 ? 30 : period; // For lifetime, check last 30 days
      const todayDateId = getDateId(new Date());
      const [todayYear, todayMonth, todayDay] = todayDateId.split('-').map(Number);
      
      console.log('📊 UNIFIED: Checking for missing emotional analysis in the period...');
      const generationPromises = [];
      
      for (let i = daysToCheck - 1; i >= 0; i--) {
        const targetDate = new Date(todayYear, todayMonth - 1, todayDay - i);
        const dateId = targetDate.toLocaleDateString('en-CA');
        
        // Check if mood data exists and is valid
        const moodRef = doc(db, `users/${user.uid}/days/${dateId}/moodChart/daily`);
        const moodSnapshot = await getDoc(moodRef);
        
        let shouldGenerate = false;
        
        if (!moodSnapshot.exists()) {
          // No data exists, need to generate
          shouldGenerate = true;
          console.log(`📊 UNIFIED: No mood data for ${dateId}, will generate`);
        } else {
          // Check if existing data is valid (not all zeros)
          const data = moodSnapshot.data();
          const total = (data.happiness || 0) + (data.energy || 0) + (data.anxiety || 0) + (data.stress || 0);
          if (total === 0) {
            // Data exists but is invalid (all zeros), regenerate
            shouldGenerate = true;
            console.log(`📊 UNIFIED: Invalid mood data (all zeros) for ${dateId}, will regenerate`);
          }
        }
        
        if (shouldGenerate) {
          // Try to generate analysis for this day
          generationPromises.push(generateMissingEmotionalAnalysis(user.uid, dateId));
        }
      }
      
      // Wait for all generations to complete (but don't fail if some fail)
      if (generationPromises.length > 0) {
        console.log(`📊 UNIFIED: Generating emotional analysis for ${generationPromises.length} missing days...`);
        const results = await Promise.allSettled(generationPromises);
        const successful = results.filter(r => r.status === 'fulfilled' && r.value !== null).length;
        console.log(`📊 UNIFIED: Finished generating missing emotional analysis - ${successful} successful out of ${generationPromises.length}`);
        
        // Small delay to ensure Firestore has processed the writes
        if (successful > 0) {
          console.log('📊 UNIFIED: Waiting 500ms for Firestore to sync...');
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // Check cache first for faster loading
      const cacheKey = getCacheKey('emotional', period, user.uid);
      const cachedData = loadFromCache(cacheKey, 5); // Use cache if less than 5 minutes old
      
      if (cachedData && cachedData.weeklyMoodData && cachedData.weeklyMoodData.length > 0) {
        console.log(`⚡ Using cached data (${cachedData.weeklyMoodData.length} days) - loading fresh in background`);
        // Set cached data immediately for instant display
        if (isLatestPeriodRequest(requestId)) {
          setWeeklyMoodData(cachedData.weeklyMoodData);
          setEmotionalData(cachedData.emotionalData);
        }
        // Continue to load fresh data in background
      }

      // Get AI-generated mood data from new Firebase structure
      let result;
      if (period === 365) {
        // For lifetime, get ALL available mood data from the first chat to today
        console.log('📊 LIFETIME: Fetching ALL available mood chart data from first chat...');
        result = await firestoreService.getAllMoodChartDataNew(user.uid);
        
        if (!result.success || !result.moodData || result.moodData.length === 0) {
          console.log('📊 LIFETIME: No lifetime data found, trying to get first 30 days');
          result = await firestoreService.getMoodChartDataNew(user.uid, 30);
        } else {
          console.log(`📊 LIFETIME: Found ${result.moodData.length} days of data from first chat`);
          if (result.moodData.length > 0) {
            const earliestDate = result.moodData[0].date;
            console.log(`📊 LIFETIME: Data starts from ${earliestDate} - showing complete history`);
          }
        }
      } else {
        result = await firestoreService.getMoodChartDataNew(user.uid, period);
        console.log(`📊 UNIFIED: Retrieved ${result.moodData?.length || 0} days from Firestore for ${period}-day period`);
        
        // If we got fewer days than requested, log it
        if (result.success && result.moodData && result.moodData.length < period) {
          console.log(`⚠️ UNIFIED: Only ${result.moodData.length} days with data out of ${period} requested days`);
        }
      }
      console.log('📊 UNIFIED: Mood chart data result:', result);
      
      // For 7 days view, keep all days (including zeros). For other periods, filter zeros
      if (result.success && result.moodData) {
        if (period === 7) {
          // For 7 days, keep all days and sort by date
          result.moodData = result.moodData
            .sort((a, b) => {
              // Sort by date (ascending - oldest first)
              return new Date(a.date) - new Date(b.date);
            });
          console.log(`📊 UNIFIED: For 7 days view, keeping all ${result.moodData.length} days (including zeros)`);
        } else {
          // For other periods, filter out days with all zeros
          result.moodData = result.moodData
            .filter(day => {
              const total = (day.happiness || 0) + (day.energy || 0) + (day.anxiety || 0) + (day.stress || 0);
              return total > 0;
            })
            .sort((a, b) => {
              // Sort by date (ascending - oldest first)
              return new Date(a.date) - new Date(b.date);
            });
          console.log(`📊 UNIFIED: After filtering zeros and sorting, ${result.moodData.length} days with valid data`);
        }
        console.log(`📊 UNIFIED: Date range: ${result.moodData[0]?.date} to ${result.moodData[result.moodData.length - 1]?.date}`);
      }

      if (result.success && result.moodData && result.moodData.length > 0) {
        console.log('📊 UNIFIED: ✅ Processing AI-generated mood data:', result.moodData.length, 'days');
        console.log('📊 UNIFIED: ✅ RAW FIRESTORE DATA:', result.moodData);
        console.log('📊 UNIFIED: ✅ Oct 8 in raw data:', result.moodData.find(d => d.day && d.day.includes('Oct 8')));
        
        // Apply emotion rules to ALL loaded data (NO 200% cap)
        const processedMoodData = result.moodData.map(day => {
          let { happiness, energy, anxiety, stress } = day;
          
          // Apply emotion rules
          // Rule: Happiness decreases if stress/anxiety are high
          if ((stress >= 60 || anxiety >= 60) && happiness > 50) {
            happiness = Math.min(50, happiness);
            console.log(`🔧 CHART: Reduced happiness for ${day.day} due to high stress/anxiety`);
          }
          
          // Rule: If happiness is very high, stress/anxiety should be lower
          if (happiness >= 70) {
            if (stress > 40) stress = 40;
            if (anxiety > 40) anxiety = 40;
            console.log(`🔧 CHART: Reduced stress/anxiety for ${day.day} due to high happiness`);
          }
          
          return {
            ...day,
            happiness,
            energy,
            anxiety,
            stress
          };
        });
        
        // Filter for display (show all data, even defaults, but with rules applied)
        const validMoodData = processedMoodData;
        
        if (validMoodData.length > 0) {
          console.log('📊 UNIFIED: Found', validMoodData.length, 'days with rule-compliant scores');
          console.log('📊 UNIFIED: Sample data:', processedMoodData[0]);
          console.log('📊 UNIFIED: All processed data:', processedMoodData);

          // Check if we have real data (not all zeros)
          const hasRealData = processedMoodData.some(day =>
            day.happiness !== 0 || day.energy !== 0 || day.anxiety !== 0 || day.stress !== 0
          );
          console.log('📊 UNIFIED: Has real data:', hasRealData);

          // Force state update with new reference to trigger re-render
          // Ensure all values are numbers and within valid range (0-100)
          // For 7 days view, keep all days (including zeros). For other periods, filter zeros
          let filteredData = processedMoodData;
          if (period !== 7) {
            // For non-7-day periods, filter out days with all zeros
            filteredData = processedMoodData.filter(day => {
              const total = (day.happiness || 0) + (day.energy || 0) + (day.anxiety || 0) + (day.stress || 0);
              return total > 0; // Only include days with actual data
            });
          }
          
          const newMoodData = filteredData
            .sort((a, b) => {
              // Sort by date (ascending - oldest first) for proper chart display
              return new Date(a.date) - new Date(b.date);
            })
            .map(day => ({
            ...day,
            happiness: typeof day.happiness === 'number' ? Math.max(0, Math.min(100, day.happiness)) : 0,
            energy: typeof day.energy === 'number' ? Math.max(0, Math.min(100, day.energy)) : 0,
            anxiety: typeof day.anxiety === 'number' ? Math.max(0, Math.min(100, day.anxiety)) : 0,
            stress: typeof day.stress === 'number' ? Math.max(0, Math.min(100, day.stress)) : 0
          }));
          
          // Log data variation to help debug flat lines
          if (newMoodData.length > 0) {
            const happinessValues = newMoodData.map(d => d.happiness);
            const energyValues = newMoodData.map(d => d.energy);
            const anxietyValues = newMoodData.map(d => d.anxiety);
            const stressValues = newMoodData.map(d => d.stress);
            
            console.log('📊 CHART: Data variation check:');
            console.log(`  Happiness: min=${Math.min(...happinessValues)}, max=${Math.max(...happinessValues)}, unique=${new Set(happinessValues).size}`);
            console.log(`  Energy: min=${Math.min(...energyValues)}, max=${Math.max(...energyValues)}, unique=${new Set(energyValues).size}`);
            console.log(`  Anxiety: min=${Math.min(...anxietyValues)}, max=${Math.max(...anxietyValues)}, unique=${new Set(anxietyValues).size}`);
            console.log(`  Stress: min=${Math.min(...stressValues)}, max=${Math.max(...stressValues)}, unique=${new Set(stressValues).size}`);
          }
          
          console.log('🔄 CHART: About to update state with:', newMoodData.length, 'days');
          console.log('🔄 CHART: First day data:', newMoodData[0]);
          console.log('🔄 CHART: Last day data:', newMoodData[newMoodData.length - 1]);
          console.log('🔄 CHART: Sample values - H:', newMoodData.map(d => d.happiness).slice(0, 5), 'E:', newMoodData.map(d => d.energy).slice(0, 5));
          console.log('🔄 CHART: Oct 8 data:', newMoodData.find(d => d.day && d.day.includes('Oct 8')));
          
          if (!isLatestPeriodRequest(requestId)) {
            console.log('⚠️ UNIFIED: Stale request detected, skipping state update.');
            return null;
          }

          setWeeklyMoodData(newMoodData);
          setEmotionalData(newMoodData);
          
          console.log('✅ CHART: State updated successfully!');
          console.log(`✅ CHART: weeklyMoodData should now have ${newMoodData.length} days (requested ${period} days)`);
          
          // Warn if we have fewer days than requested
          if (newMoodData.length < period && period !== 365) {
            console.warn(`⚠️ CHART: Only showing ${newMoodData.length} days out of ${period} requested days. Missing days may not have chat messages or data generation failed.`);
          }
          
          // Calculate averages for display using processed data
          const avgHappiness = processedMoodData.reduce((sum, item) => sum + item.happiness, 0) / processedMoodData.length;
          const avgEnergy = processedMoodData.reduce((sum, item) => sum + item.energy, 0) / processedMoodData.length;
          const avgAnxiety = processedMoodData.reduce((sum, item) => sum + item.anxiety, 0) / processedMoodData.length;
          const avgStress = processedMoodData.reduce((sum, item) => sum + item.stress, 0) / processedMoodData.length;
          const avgTotal = avgHappiness + avgEnergy + avgAnxiety + avgStress;
          
          console.log('📊 UNIFIED: Rule-Applied Averages - H:', Math.round(avgHappiness), 'E:', Math.round(avgEnergy), 'A:', Math.round(avgAnxiety), 'S:', Math.round(avgStress));
          console.log('📊 UNIFIED: Average total:', Math.round(avgTotal));
          
          // Save to cache immediately for fast loading next time
          const cacheKey = getCacheKey('emotional', period, user.uid);
          const cacheData = {
            weeklyMoodData: newMoodData,
            emotionalData: newMoodData,
            timestamp: new Date().toISOString(),
            period: period,
            dataCount: newMoodData.length
          };
          saveToCache(cacheKey, cacheData);
          console.log(`💾 CACHE: Saved mood data to cache (${newMoodData.length} days) for period ${period}`);
          
          // Return data for caching
          return {
            weeklyMoodData: newMoodData,
            emotionalData: newMoodData
          };
        } else {
          console.log('📊 UNIFIED: No real AI scores found, showing empty state');
          if (isLatestPeriodRequest(requestId)) {
            showEmptyState(period);
          }
        }
      } else {
        console.log('📊 UNIFIED: No AI mood data found, showing empty state');
        if (isLatestPeriodRequest(requestId)) {
          showEmptyState(period);
        }
      }
    } catch (error) {
      console.error('❌ UNIFIED: Error loading AI mood data:', error);
      if (isLatestPeriodRequest(requestId)) {
        showEmptyState(period);
      }
    }
    
    return null;
  };

  const loadBalanceDataInternal = async (period = balancePeriod, options = {}) => {
    const { updateState = true } = options;
    console.log(`⚖️ Loading balance data for ${period === 365 ? 'lifetime' : period + ' days'}...`);
    
    const user = getCurrentUser();
    if (!user) {
      console.log('⚖️ No user logged in for balance data');
      return { moodBalance: [], topEmotions: [] };
    }

    console.log('⚖️ USER ID:', user.uid);
    console.log('⚖️ BALANCE PERIOD:', period);

    try {
      // First, check for missing days and generate analysis if needed
      const daysToCheck = period === 365 ? 30 : period; // For lifetime, check last 30 days
      const todayDateId = getDateId(new Date());
      const [todayYear, todayMonth, todayDay] = todayDateId.split('-').map(Number);
      
      console.log('⚖️ Checking for missing emotional analysis in the period...');
      const generationPromises = [];
      
      for (let i = daysToCheck - 1; i >= 0; i--) {
        const targetDate = new Date(todayYear, todayMonth - 1, todayDay - i);
        const dateId = targetDate.toLocaleDateString('en-CA');
        
        // Check if mood data exists
        const moodRef = doc(db, `users/${user.uid}/days/${dateId}/moodChart/daily`);
        const moodSnapshot = await getDoc(moodRef);
        
        if (!moodSnapshot.exists()) {
          // Try to generate analysis for this day
          generationPromises.push(generateMissingEmotionalAnalysis(user.uid, dateId));
        }
      }
      
      // Wait for all generations to complete (but don't fail if some fail)
      if (generationPromises.length > 0) {
        console.log(`⚖️ Generating emotional analysis for ${generationPromises.length} missing days...`);
        await Promise.allSettled(generationPromises);
        console.log('⚖️ Finished generating missing emotional analysis');
      }

      // Use the same data source as the mood chart for consistency
      let result;
      if (period === 365) {
        // For lifetime, get ALL available mood data from the first chat to today
        console.log('⚖️ LIFETIME: Fetching ALL available balance data from first chat...');
        result = await firestoreService.getAllMoodChartDataNew(user.uid);
        
        if (!result.success || !result.moodData || result.moodData.length === 0) {
          console.log('⚖️ LIFETIME: No lifetime data found, trying to get first 30 days');
          result = await firestoreService.getMoodChartDataNew(user.uid, 30);
        } else {
          console.log(`⚖️ LIFETIME: Found ${result.moodData.length} days of balance data from first chat`);
          if (result.moodData.length > 0) {
            const earliestDate = result.moodData[0].date;
            console.log(`⚖️ LIFETIME: Balance data starts from ${earliestDate} - showing complete history`);
          }
        }
      } else {
        result = await firestoreService.getMoodChartDataNew(user.uid, period);
      }

      console.log('⚖️ Balance chart data result:', result);
      console.log('⚖️ Balance chart - success:', result.success);
      console.log('⚖️ Balance chart - moodData length:', result.moodData?.length);
      console.log('⚖️ Balance chart - first few days:', result.moodData?.slice(0, 3));

      let balanceData;
      if (result.success && result.moodData && result.moodData.length > 0) {
        console.log('⚖️ Processing balance data from Firebase:', result.moodData.length, 'days');
        console.log('⚖️ Balance chart - Sample data:', result.moodData[0]);
        
        // Apply emotion rules to balance data (NO 200% cap)
        const processedMoodData = result.moodData.map(day => {
          let { happiness, energy, anxiety, stress } = day;
          
          // Apply emotion rules
          if ((stress >= 60 || anxiety >= 60) && happiness > 50) {
            happiness = Math.min(50, happiness);
          }
          
          if (happiness >= 70) {
            if (stress > 40) stress = 40;
            if (anxiety > 40) anxiety = 40;
          }
          
          return {
            ...day,
            happiness,
            energy,
            anxiety,
            stress
          };
        });
        
        balanceData = processBalanceDataInternal(processedMoodData, period);
      } else {
        console.log('⚖️ No balance data found, creating empty time series');
        balanceData = processBalanceDataInternal([], period);
      }
      
      // Set state and return data for caching
      if (updateState) {
        setMoodBalance(balanceData.moodBalance);
        setTopEmotions(balanceData.topEmotions);
      }
      
      return balanceData;
    } catch (error) {
      console.error('❌ Error loading balance data:', error);
      const emptyBalanceData = processBalanceDataInternal([], period);
      if (updateState) {
        setMoodBalance(emptyBalanceData.moodBalance);
        setTopEmotions(emptyBalanceData.topEmotions);
      }
      return emptyBalanceData;
    }
  };

  const loadHighlightsDataInternal = async () => {
    console.log(`🏆 Loading highlights data for last 3 months...`);
    
    const user = getCurrentUser();
    if (!user) {
      console.log('🏆 No user logged in for highlights');
      setHighlights({});
      setHighlightsLoading(false);
      return { highlights: {} };
    }

    setHighlightsLoading(true);
    // Clear highlights while loading to prevent showing old data
    setHighlights({});
    try {
      // Use the same Firebase data source as other charts for consistency
      console.log('🔄 Loading highlights data from Firebase...');
      const result = await firestoreService.getMoodChartDataNew(user.uid, 90);
      console.log('🏆 Highlights Firebase data result:', result);

      if (result.success && result.moodData && result.moodData.length > 0) {
        console.log('🏆 Processing highlights data from Firebase:', result.moodData.length, 'days');
        
        // Apply emotion rules to highlights data (NO 200% cap)
        const processedMoodData = result.moodData.map(day => {
          let { happiness, energy, anxiety, stress } = day;
          
          // Apply emotion rules
          if ((stress >= 60 || anxiety >= 60) && happiness > 50) {
            happiness = Math.min(50, happiness);
          }
          
          if (happiness >= 70) {
            if (stress > 40) stress = 40;
            if (anxiety > 40) anxiety = 40;
          }
          
          return {
            ...day,
            happiness,
            energy,
            anxiety,
            stress
          };
        });
        
        // ✅ NEW: Fetch reflections for all days to enrich AI analysis
        console.log('📖 Fetching reflections for each day to enrich highlights...');
        const enrichedData = await Promise.all(
          processedMoodData.map(async (day) => {
            try {
              const reflectionResult = await firestoreService.getReflectionNew(user.uid, day.date);
              return {
                ...day,
                summary: reflectionResult.reflection || null
              };
            } catch (error) {
              console.log(`⚠️ No reflection found for ${day.date}`);
              return { ...day, summary: null };
            }
          })
        );
        
        console.log('✅ Enriched highlights data with reflections:', enrichedData);
        
        const highlightsData = await processHighlightsDataInternal(enrichedData, user.uid);
        setHighlights(highlightsData);
        setHighlightsLoading(false);
        return { highlights: highlightsData };
      } else {
        console.log('📝 No highlights data found in Firebase');
        setHighlights({});
        setHighlightsLoading(false);
        return { highlights: {} };
      }
    } catch (error) {
      console.error('❌ Error loading highlights data:', error);
      setHighlights({});
      setHighlightsLoading(false);
      return { highlights: {} };
    }
  };

  const processHighlightsDataInternal = async (data, userId) => {
    console.log(`🔄 Processing highlights data: ${data.length} entries for last 3 months`);
    console.log(`🔄 All data received:`, data.map(d => ({ 
      date: d.date, 
      h: d.happiness, 
      e: d.energy, 
      a: d.anxiety, 
      s: d.stress,
      total: (d.happiness || 0) + (d.energy || 0) + (d.anxiety || 0) + (d.stress || 0)
    })));
    
    // Filter valid data for highlights (must have actual emotional scores, not all zeros)
    const validData = data.filter(item => {
      const hasData = item.happiness !== undefined && 
        (item.happiness > 0 || item.energy > 0 || item.anxiety > 0 || item.stress > 0);
      const total = (item.happiness || 0) + (item.energy || 0) + (item.anxiety || 0) + (item.stress || 0);
      return hasData && total >= 10; // At least 10 points total to avoid nearly empty days
    });
    
    console.log(`🔄 Valid highlights data: ${validData.length} entries (filtered from ${data.length})`);
    console.log(`🔄 Valid data dates:`, validData.map(d => d.date));
    
    // Debug: Show which dates were filtered out
    const filteredOut = data.filter(item => {
      const hasData = item.happiness !== undefined && 
        (item.happiness > 0 || item.energy > 0 || item.anxiety > 0 || item.stress > 0);
      const total = (item.happiness || 0) + (item.energy || 0) + (item.anxiety || 0) + (item.stress || 0);
      return !(hasData && total >= 10);
    });
    console.log(`🔄 Filtered out ${filteredOut.length} days:`, filteredOut.map(d => ({ date: d.date, total: (d.happiness || 0) + (d.energy || 0) + (d.anxiety || 0) + (d.stress || 0) })));
    
    if (validData.length === 0) {
      console.log('📝 No valid emotional data found for highlights');
      // Return empty highlights but with a message
      return {
        peak: {
          title: "Best Mood Day",
          description: "No emotional data available for the last 3 months. Start chatting with Deite to track your emotional journey!",
          date: "No data",
          score: 0
        },
        toughestDay: {
          title: "Challenging Day", 
          description: "No emotional data available for the last 3 months. Your emotional patterns will appear after chatting.",
          date: "No data",
          score: 0
        }
      };
    }
    
    // If we only have one day of data, we can't show different days
    if (validData.length === 1) {
      console.log('📝 Only one day of emotional data available');
      const onlyDay = validData[0];
      return {
        peak: {
          title: "Best Mood Day",
          description: "This is your first day tracking emotions with Deite. Keep chatting to see more insights!",
          date: onlyDay.date ? new Date(onlyDay.date).toLocaleDateString() : 'Unknown Date',
          score: Math.round((onlyDay.happiness + onlyDay.energy) / 2)
        },
        toughestDay: {
          title: "Challenging Day", 
          description: "Chat with Deite for a few more days to identify patterns and challenging moments.",
          date: "Track more days",
          score: 0
        }
      };
    }

    // Generate highlights based on real data
    // Best day = highest positive energy (happiness + energy)
    const bestDay = validData.reduce((best, current) => {
      const currentScore = (current.happiness + current.energy) / 2;
      const bestScore = (best.happiness + best.energy) / 2;
      return currentScore > bestScore ? current : best;
    });

    // Worst day = lowest positive energy (most challenging day)
    // This ensures we're finding the actual worst day, not just highest stress day
    let worstDay = validData.reduce((worst, current) => {
      const currentPositiveScore = (current.happiness + current.energy) / 2;
      const worstPositiveScore = (worst.happiness + worst.energy) / 2;
      return currentPositiveScore < worstPositiveScore ? current : worst;
    });

    // If best day and worst day are the same, find a different worst day
    if (validData.length > 1 && bestDay.date === worstDay.date) {
      console.log('⚠️ Best day and worst day are the same:', bestDay.date);
      console.log('⚠️ Finding alternative worst day from', validData.length, 'valid days');
      
      // Filter out the best day and find worst from remaining days
      const otherDays = validData.filter(day => day.date !== bestDay.date);
      console.log('⚠️ Other days available:', otherDays.map(d => d.date));
      
      if (otherDays.length > 0) {
        worstDay = otherDays.reduce((worst, current) => {
          const currentPositiveScore = (current.happiness + current.energy) / 2;
          const worstPositiveScore = (worst.happiness + worst.energy) / 2;
          return currentPositiveScore < worstPositiveScore ? current : worst;
        });
        console.log('✅ Found alternative worst day:', worstDay.date);
      } else {
        console.log('⚠️ No other days available, keeping same day but will show different descriptions');
      }
    }

    console.log('🏆 Best day found:', bestDay.date, '- Happiness:', bestDay.happiness, 'Energy:', bestDay.energy);
    console.log('🏆 Worst day found:', worstDay.date, '- Anxiety:', worstDay.anxiety, 'Stress:', worstDay.stress);
    console.log('📝 Best day summary:', bestDay.summary);
    console.log('📝 Worst day summary:', worstDay.summary);

    // Clean up summary text to remove unwanted phrases and analysis sections
    const cleanSummary = (summary) => {
      if (!summary) return summary;
      
      let cleaned = summary;
      
      // Remove common unwanted phrases
      const unwantedPhrases = [
        /Here is a diary entry summarizing the (user's|user) day:?\s*/gi,
        /Here is a diary entry:?\s*/gi,
        /Diary entry summarizing the (user's|user) day:?\s*/gi,
        /Summarizing the (user's|user) day:?\s*/gi,
        /Here's a diary entry:?\s*/gi,
        /This is a diary entry:?\s*/gi,
        /Diary entry:?\s*/gi,
        /the user's day/gi,
        /the user/gi,
        /this person's day/gi,
        /this person/gi,
      ];
      
      unwantedPhrases.forEach(phrase => {
        cleaned = cleaned.replace(phrase, '');
      });
      
      // Remove "Analysis:" and everything after it - catch it anywhere in the text
      const analysisIndex = cleaned.search(/Analysis:?\s*/i);
      if (analysisIndex !== -1) {
        cleaned = cleaned.substring(0, analysisIndex).trim();
      }
      
      // Also remove analysis sections with patterns like "1. Key events", etc.
      const analysisPatterns = [
        /\n\s*1\.\s*Key events.*$/gi,
        /\n\s*2\.\s*Emotional tone.*$/gi,
        /\n\s*3\.\s*Important details.*$/gi,
        /\n\s*Key events or topics.*$/gi,
        /\n\s*Emotional tone:.*$/gi,
        /\n\s*Important details.*$/gi,
      ];
      
      analysisPatterns.forEach(pattern => {
        cleaned = cleaned.replace(pattern, '');
      });
      
      // Remove any numbered lists or bullet points that might be analysis
      cleaned = cleaned.replace(/\n\s*\d+\.\s*[^\n]*/g, '');
      cleaned = cleaned.replace(/\n\s*[-•]\s*[^\n]*/g, '');
      
      // Remove quotes around the content if present
      cleaned = cleaned.replace(/^["']|["']$/g, '');
      cleaned = cleaned.trim();
      
      return cleaned;
    };
    
    // Generate natural storytelling descriptions based on the day's summary
    // Apply 2x character limit based on user's conversation that day
    const generateBestDayDescription = async (day) => {
      const dateStr = day.date ? new Date(day.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'this day';
      
      if (day.summary) {
        // Clean and use the summary directly as natural storytelling
        let cleanedSummary = cleanSummary(day.summary);
        
        // Calculate user character count for that day and apply 2x limit
        try {
          const user = getCurrentUser();
          if (user && day.date) {
            // Convert date to dateId format
            let dateId;
            if (day.date instanceof Date) {
              dateId = getDateId(day.date);
            } else if (typeof day.date === 'string') {
              if (/^\d{4}-\d{2}-\d{2}$/.test(day.date)) {
                dateId = day.date;
              } else {
                const dateObj = new Date(day.date);
                dateId = getDateId(dateObj);
              }
            } else if (day.timestamp) {
              const dateObj = new Date(day.timestamp);
              dateId = getDateId(dateObj);
            } else {
              const dateObj = new Date(day.date);
              dateId = getDateId(dateObj);
            }
            
            // Fetch user messages for that day
            const messagesResult = await firestoreService.getChatMessagesNew(user.uid, dateId);
            if (messagesResult.success && messagesResult.messages) {
              // Calculate total character count from user messages
              const userCharacterCount = messagesResult.messages
                .filter(msg => msg.sender === 'user' && msg.text)
                .reduce((total, msg) => total + msg.text.length, 0);
              
              const maxReflectionCharacters = userCharacterCount * 2;
              
              console.log(`📊 Best Mood Day: User wrote ${userCharacterCount} characters. Description limit: ${maxReflectionCharacters} characters.`);
              
              // Enforce character limit: description must not exceed 2x user character count
              if (cleanedSummary.length > maxReflectionCharacters) {
                console.warn(`⚠️ Best Mood Day description (${cleanedSummary.length} chars) exceeds limit (${maxReflectionCharacters} chars). Truncating...`);
                // Truncate to the character limit, trying to end at a sentence boundary
                cleanedSummary = cleanedSummary.substring(0, maxReflectionCharacters);
                // Try to find the last sentence ending (., !, ?) before the limit
                const lastSentenceEnd = Math.max(
                  cleanedSummary.lastIndexOf('.'),
                  cleanedSummary.lastIndexOf('!'),
                  cleanedSummary.lastIndexOf('?')
                );
                if (lastSentenceEnd > maxReflectionCharacters * 0.7) {
                  // If we found a sentence end reasonably close to the limit, use it
                  cleanedSummary = cleanedSummary.substring(0, lastSentenceEnd + 1);
                }
                console.log(`✅ Truncated Best Mood Day description to ${cleanedSummary.length} characters (within ${maxReflectionCharacters} limit)`);
              }
            }
          }
        } catch (error) {
          console.warn('⚠️ Could not fetch user messages for Best Mood Day character count:', error);
        }
        
        return cleanedSummary;
      }
      
      // Fallback if no summary available
      return `On ${dateStr}, I experienced a day that felt particularly positive and uplifting.`;
    };
    
    const generateChallengingDayDescription = async (day) => {
      const dateStr = day.date ? new Date(day.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'this day';
      
      if (day.summary) {
        // Clean and use the summary directly as natural storytelling
        let cleanedSummary = cleanSummary(day.summary);
        
        // Calculate user character count for that day and apply 2x limit
        try {
          const user = getCurrentUser();
          if (user && day.date) {
            // Convert date to dateId format
            let dateId;
            if (day.date instanceof Date) {
              dateId = getDateId(day.date);
            } else if (typeof day.date === 'string') {
              if (/^\d{4}-\d{2}-\d{2}$/.test(day.date)) {
                dateId = day.date;
              } else {
                const dateObj = new Date(day.date);
                dateId = getDateId(dateObj);
              }
            } else if (day.timestamp) {
              const dateObj = new Date(day.timestamp);
              dateId = getDateId(dateObj);
            } else {
              const dateObj = new Date(day.date);
              dateId = getDateId(dateObj);
            }
            
            // Fetch user messages for that day
            const messagesResult = await firestoreService.getChatMessagesNew(user.uid, dateId);
            if (messagesResult.success && messagesResult.messages) {
              // Calculate total character count from user messages
              const userCharacterCount = messagesResult.messages
                .filter(msg => msg.sender === 'user' && msg.text)
                .reduce((total, msg) => total + msg.text.length, 0);
              
              const maxReflectionCharacters = userCharacterCount * 2;
              
              console.log(`📊 Challenging Day: User wrote ${userCharacterCount} characters. Description limit: ${maxReflectionCharacters} characters.`);
              
              // Enforce character limit: description must not exceed 2x user character count
              if (cleanedSummary.length > maxReflectionCharacters) {
                console.warn(`⚠️ Challenging Day description (${cleanedSummary.length} chars) exceeds limit (${maxReflectionCharacters} chars). Truncating...`);
                // Truncate to the character limit, trying to end at a sentence boundary
                cleanedSummary = cleanedSummary.substring(0, maxReflectionCharacters);
                // Try to find the last sentence ending (., !, ?) before the limit
                const lastSentenceEnd = Math.max(
                  cleanedSummary.lastIndexOf('.'),
                  cleanedSummary.lastIndexOf('!'),
                  cleanedSummary.lastIndexOf('?')
                );
                if (lastSentenceEnd > maxReflectionCharacters * 0.7) {
                  // If we found a sentence end reasonably close to the limit, use it
                  cleanedSummary = cleanedSummary.substring(0, lastSentenceEnd + 1);
                }
                console.log(`✅ Truncated Challenging Day description to ${cleanedSummary.length} characters (within ${maxReflectionCharacters} limit)`);
              }
            }
          }
        } catch (error) {
          console.warn('⚠️ Could not fetch user messages for Challenging Day character count:', error);
        }
        
        return cleanedSummary;
      }
      
      // Fallback if no summary available
      return `On ${dateStr}, I experienced a day that felt particularly challenging.`;
    };
    
    console.log('📝 Generating contextual descriptions based on data...');
    const bestDayDescription = await generateBestDayDescription(bestDay);
    const worstDayDescription = await generateChallengingDayDescription(worstDay);
    console.log('✅ Generated Best day description:', bestDayDescription);
    console.log('✅ Generated Challenging day description:', worstDayDescription);

    const highlightsData = {
        peak: {
          title: "Best Mood Day",
          description: bestDayDescription,
          date: bestDay.date ? new Date(bestDay.date).toLocaleDateString() : 'Unknown Date',
          score: Math.round((bestDay.happiness + bestDay.energy) / 2)
        },
        toughestDay: {
          title: "Challenging Day",
          description: worstDayDescription,
          date: worstDay.date ? new Date(worstDay.date).toLocaleDateString() : 'Unknown Date',
        score: Math.round((worstDay.happiness + worstDay.energy) / 2)
        }
      };

      // Save to cache for future use
      try {
        console.log('💾 Saving highlights to cache...');
        await firestoreService.saveHighlightsCache(userId, '3months', highlightsData);
        console.log('✅ Highlights cached successfully');
      } catch (cacheError) {
        console.error('❌ Error caching highlights (non-critical):', cacheError);
    }

    console.log('✅ Highlights data processed successfully');
    console.log('🏆 Final highlights data:', highlightsData);
    return highlightsData;
  };

  const processBalanceDataInternal = (data, period = balancePeriod) => {
    console.log(`🔄 Processing balance data: ${data.length} entries for ${period === 365 ? 'lifetime' : period + ' days'}`);
    
    // If we have data, use it directly (it's already from Firebase with proper date range)
    if (data.length > 0) {
      console.log('🔄 Using Firebase data directly for balance chart');
      console.log('🔄 Sample data points:', data.slice(0, 3));
      
      const moodBalance = data.map((dayData, index) => {
        const date = new Date(dayData.date);
        
        // Calculate balance percentages for this specific day
        // Positive = (happiness + energy) / total
        // Negative = (anxiety + stress) / total
        // Neutral = remainder
        const total = dayData.happiness + dayData.energy + dayData.anxiety + dayData.stress;
        
        let positiveScore, negativeScore, neutralScore;
        
        if (total > 0) {
          // Calculate as percentages of total emotional energy
          const positiveTotal = dayData.happiness + dayData.energy;
          const negativeTotal = dayData.anxiety + dayData.stress;
          
          positiveScore = Math.round((positiveTotal / total) * 100);
          negativeScore = Math.round((negativeTotal / total) * 100);
          neutralScore = 100 - positiveScore - negativeScore;
          
          // Ensure all values are between 0 and 100 (clamp to prevent negative values)
          positiveScore = Math.max(0, Math.min(100, positiveScore));
          negativeScore = Math.max(0, Math.min(100, negativeScore));
          neutralScore = Math.max(0, Math.min(100, neutralScore));
        } else {
          // If total is 0, skip this day (don't use defaults)
          console.log(`⚠️ Skipping day ${dayData.date} - no valid emotional scores (total: ${total})`);
          return null;
        }
        
        // Log first few items for debugging
        if (index < 3) {
          console.log(`⚖️ Balance Day ${index}: ${dayData.date} - P:${positiveScore} N:${neutralScore} Neg:${negativeScore} (Total:${total}, H:${dayData.happiness} E:${dayData.energy} A:${dayData.anxiety} S:${dayData.stress})`);
        }
        
        return {
          day: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          date: dayData.date,
          positive: positiveScore,
          neutral: neutralScore,
          negative: negativeScore
        };
      }).filter(item => item !== null); // Remove null entries (days with no valid data)
      
      // Calculate top emotions from available data
      const validData = data.filter(day => {
        const total = day.happiness + day.energy + day.anxiety + day.stress;
        return total > 0;
      });
      
      if (validData.length > 0) {
        const avgHappiness = validData.reduce((sum, item) => sum + item.happiness, 0) / validData.length;
        const avgEnergy = validData.reduce((sum, item) => sum + item.energy, 0) / validData.length;
        const avgAnxiety = validData.reduce((sum, item) => sum + item.anxiety, 0) / validData.length;
        const avgStress = validData.reduce((sum, item) => sum + item.stress, 0) / validData.length;

      const topEmotions = [
        { name: 'Happiness', value: Math.round(avgHappiness), color: '#10B981' },
        { name: 'Energy', value: Math.round(avgEnergy), color: '#F59E0B' },
        { name: 'Anxiety', value: Math.round(avgAnxiety), color: '#EF4444' },
        { name: 'Stress', value: Math.round(avgStress), color: '#8B5CF6' }
      ].sort((a, b) => b.value - a.value);

      console.log('✅ Balance data processed successfully from Firebase data');
        console.log(`✅ Processed ${moodBalance.length} days with valid balance data`);
      return { moodBalance, topEmotions };
    }
    }
    
    // If no valid data, return empty arrays (don't use defaults)
    console.log('⚠️ No valid balance data found, returning empty arrays');
    return { moodBalance: [], topEmotions: [] };
  };

  /**
   * Helper function to generate missing emotional analysis for days with chat but no mood data
   */
  const generateMissingEmotionalAnalysis = async (uid, dateId) => {
    try {
      console.log(`🧠 Checking if emotional analysis needed for ${dateId}...`);
      
      // Check if mood data already exists
      const moodRef = doc(db, `users/${uid}/days/${dateId}/moodChart/daily`);
      const moodSnapshot = await getDoc(moodRef);
      
      if (moodSnapshot.exists()) {
        const data = moodSnapshot.data();
        const total = (data.happiness || 0) + (data.energy || 0) + (data.anxiety || 0) + (data.stress || 0);
        
        // Only skip if we have valid data (not all zeros)
        if (total > 0) {
          console.log(`✅ Mood data already exists for ${dateId} with valid values, skipping generation`);
          return {
            date: dateId,
            happiness: data.happiness || 0,
            energy: data.energy || 0,
            anxiety: data.anxiety || 0,
            stress: data.stress || 0
          };
    } else {
          console.log(`⚠️ Mood data exists for ${dateId} but all values are zero, will regenerate`);
          // Continue to generate new analysis
        }
      }
      
      // Check if chat messages exist for this day
      const messagesResult = await firestoreService.getChatMessagesNew(uid, dateId);
      if (!messagesResult.success || !messagesResult.messages || messagesResult.messages.length === 0) {
        console.log(`⚠️ No chat messages found for ${dateId}, cannot generate analysis`);
        return null;
    }

      // Filter out welcome message, whisper session messages, and ensure we have real conversation
      const realMessages = messagesResult.messages.filter(m => 
        m.id !== 'welcome' && 
        m.text && 
        m.text.length > 0 && 
        !m.isWhisperSession
      );
      
      if (realMessages.length < 2) {
        console.log(`⚠️ Not enough non-whisper messages for ${dateId} (${realMessages.length} messages)`);
        return null;
      }
      
      console.log(`🧠 Generating emotional analysis for ${dateId} using ${realMessages.length} messages via Google Gemini API...`);
      
      // Generate emotional analysis using Google Gemini API
      const emotionalScores = await emotionalAnalysisService.analyzeEmotionalScores(realMessages);
      console.log(`✅ Generated emotional scores for ${dateId}:`, emotionalScores);
      
      // Save to Firestore
      await firestoreService.saveMoodChartNew(uid, dateId, emotionalScores);
      console.log(`💾 Emotional scores saved to Firestore for ${dateId}`);

      // Also save emotional balance
      const total = emotionalScores.happiness + emotionalScores.energy + emotionalScores.stress + emotionalScores.anxiety;
      let positive = ((emotionalScores.happiness + emotionalScores.energy) / total) * 100;
      let negative = ((emotionalScores.stress + emotionalScores.anxiety) / total) * 100;
      let neutral = 100 - positive - negative;
      
      // Ensure all values are between 0 and 100
      positive = Math.max(0, Math.min(100, Math.round(positive)));
      negative = Math.max(0, Math.min(100, Math.round(negative)));
      neutral = Math.max(0, Math.min(100, Math.round(neutral)));
      
      await firestoreService.saveEmotionalBalanceNew(uid, dateId, {
        positive: positive,
        negative: negative,
        neutral: neutral
      });
      console.log(`💾 Emotional balance saved to Firestore for ${dateId}`);
      
      return {
        date: dateId,
        happiness: emotionalScores.happiness,
        energy: emotionalScores.energy,
        anxiety: emotionalScores.anxiety,
        stress: emotionalScores.stress
      };
    } catch (error) {
      console.error(`❌ Error generating emotional analysis for ${dateId}:`, error);
      return null;
    }
  };

  const processRealEmotionalData = (data) => {
    console.log(`🔄 Processing real emotional data: ${data.length} entries for ${selectedPeriod} days`);
    
    // Create date range for the selected period
    const dateRange = [];
    for (let i = selectedPeriod - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      dateRange.push(date.toISOString().split('T')[0]);
    }

    // Map real data to date range
    const weeklyData = dateRange.map(dateStr => {
      const dayData = data.find(item => item.date === dateStr);
      const date = new Date(dateStr);
      
      return {
        day: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        date: dateStr,
        happiness: dayData ? dayData.happiness : 0,
        anxiety: dayData ? dayData.anxiety : 0,
        energy: dayData ? dayData.energy : 0,
        stress: dayData ? dayData.stress : 0
      };
    });

    setWeeklyMoodData(weeklyData);

    // Calculate averages for highlights and other data processing
    const validData = data.filter(item => item.happiness !== undefined);
    if (validData.length > 0) {
      const avgHappiness = validData.reduce((sum, day) => sum + day.happiness, 0) / validData.length;
      const avgEnergy = validData.reduce((sum, day) => sum + day.energy, 0) / validData.length;
      const avgAnxiety = validData.reduce((sum, day) => sum + day.anxiety, 0) / validData.length;
      const avgStress = validData.reduce((sum, day) => sum + day.stress, 0) / validData.length;


      setTriggers({
        stress: avgStress > 50 ? ["High stress conversations", "Complex decisions"] : ["Minor uncertainties", "Daily pressures"],
        joy: ["Meaningful conversations", "Self-reflection", "Emotional support"],
        distraction: ["Overthinking patterns", "Worry cycles"]
      });
    }

    setEmotionalData(data);
    console.log('✅ Real emotional data processed successfully');
  };

  const showEmptyState = (days) => {
    const displayPeriod = days === 365 ? 'lifetime' : `${days} days`;
    console.log(`📭 Showing empty state for ${displayPeriod} - no chat data available`);
    
    // Create empty date range for display
    const dateRange = [];
    const actualDays = days === 365 ? 30 : days; // For lifetime with no data, show 30 days
    for (let i = actualDays - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      dateRange.push(date);
    }

    // Set empty data with just date labels
    const emptyWeeklyData = dateRange.map(date => ({
      day: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      date: date.toISOString().split('T')[0],
      happiness: 0,
      anxiety: 0,
      energy: 0,
      stress: 0
    }));
    setWeeklyMoodData(emptyWeeklyData);

    // Set empty mood balance with default time series
    const emptyBalanceData = dateRange.map(date => ({
      day: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      date: date.toISOString().split('T')[0],
      positive: 0,
      neutral: 0,
      negative: 0
    }));
    setMoodBalance(emptyBalanceData);

    // Set empty top emotions
    setTopEmotions([]);

    // Set empty emotional timeline data
    setEmotionalData([]);

    // Set empty state highlights
    setHighlights({
      peak: {
        title: "No Data Yet",
        description: "Start chatting with Deite to track your emotional journey",
        date: "N/A",
        score: 0
      },
      toughestDay: {
        title: "No Data Yet", 
        description: "Your emotional patterns will appear after chatting",
        date: "N/A",
        score: 0
      },
      shift: {
        title: "Start Your Journey",
        description: "Chat with Deite to begin emotional tracking",
        change: "0 days tracked",
        trend: "neutral"
      }
    });

    // Set empty triggers
    setTriggers({
      stress: [],
      joy: [],
      distraction: []
    });

    console.log('✅ Empty state set successfully');
  };

  const loadPatternAnalysisInternal = async () => {
    // Use 90 days (3 months) for pattern analysis as per user request
    const analysisPeriod = 90;
    console.log(`🔍 Loading pattern analysis for last 3 months (${analysisPeriod} days)...`);
    setPatternLoading(true);
    
    try {
      const user = getCurrentUser();
      const userId = user?.uid || 'anonymous';
      
      const analysis = await patternAnalysisService.getPatternAnalysis(userId, analysisPeriod, true);
      console.log('📊 Pattern analysis result:', analysis);
      
      setPatternAnalysis(analysis);
      setHasEnoughData(analysis.hasEnoughData);
      
      let triggers;
      if (analysis.success && analysis.hasEnoughData) {
        triggers = analysis.triggers;
        setTriggers(analysis.triggers);
      } else {
        // Set empty state or "not enough data" message
        triggers = {
          stress: [],
          joy: [],
          distraction: []
        };
        setTriggers(triggers);
      }
      
      return {
        patternAnalysis: analysis,
        triggers: triggers,
        hasEnoughData: analysis.hasEnoughData
      };
    } catch (error) {
      console.error('❌ Error loading pattern analysis:', error);
      const defaultTriggers = {
        stress: [],
        joy: [],
        distraction: []
      };
      setTriggers(defaultTriggers);
      setHasEnoughData(false);
      
      return {
        patternAnalysis: null,
        triggers: defaultTriggers,
        hasEnoughData: false
      };
    } finally {
      setPatternLoading(false);
    }
  };

  // Note: Android hardware back button is handled globally in App.js

  const handleRefreshData = async () => {
    console.log('🔄 Manual data refresh triggered...');
    const user = getCurrentUser();
    if (!user) {
      alert('Please sign in to refresh data');
      return;
    }

    try {
      // Force refresh - fetch fresh data regardless of 12 PM rule
      console.log('🔄 Force refresh - fetching fresh data from Firebase...');

      // DEBUG: Check if we have any localStorage emotional data
      const emotionalData = localStorage.getItem(`emotional_data_${user.uid}`);
      console.log('🔍 DEBUG: localStorage emotional data:', emotionalData);

      // Reset state to force re-render
      console.log('🔄 Resetting state...');
      setWeeklyMoodData([]);
      setEmotionalData([]);
      setMoodBalance([]);
      setTopEmotions([]);
      setPatternAnalysis(null);
      setHighlights({});
      setChartKey(prev => prev + 1); // Force chart re-render

      // AGGRESSIVE: Force immediate data load from Firestore
      console.log('🔥 AGGRESSIVE REFRESH: Loading data directly from Firestore...');
      const result = await firestoreService.getMoodChartDataNew(user.uid, selectedPeriod);

      if (result.success && result.moodData && result.moodData.length > 0) {
        console.log('✅ AGGRESSIVE REFRESH: Got fresh data from Firestore:', result.moodData.length, 'days');
        console.log('🔍 DEBUG: Fresh data sample:', result.moodData[0]);
        setWeeklyMoodData(result.moodData);
        setEmotionalData(result.moodData);
        setChartKey(prev => prev + 1); // Force chart re-render

        // Clear the force fresh flag since we have fresh data now
        localStorage.removeItem('force_fresh_data_until');
        console.log('✅ Cleared force fresh flag');
      } else {
        console.log('❌ AGGRESSIVE REFRESH: No data from Firestore');
        console.log('🔍 DEBUG: Result details:', result);
      }

      // Reload all data with force refresh flag
      console.log('📥 Loading fresh data from Firestore (force refresh)...');
      await loadFreshEmotionalData(true); // Force refresh
      await loadFreshBalanceData(balancePeriod, true); // Force refresh
      await loadFreshPatternAnalysis(true); // Force refresh
      await loadFreshHighlightsData(true); // Force refresh
      await loadHabitAnalysis(true); // Force refresh

      console.log('✅ All data refreshed!');
    } catch (error) {
      console.error('❌ Error refreshing data:', error);
      alert('Failed to refresh data: ' + error.message);
    }
  };

  const handleCheckFirestoreData = async () => {
    console.log('🔍 Checking Firestore data...');
    const user = getCurrentUser();
    if (!user) {
      alert('Please sign in to check data');
      return;
    }

    try {
      // Check today's data
      const todayId = getDateId(new Date());
      console.log('🔍 Checking data for today:', todayId);

      const moodRef = doc(db, `users/${user.uid}/days/${todayId}/moodChart/daily`);
      const snapshot = await getDoc(moodRef);

      if (snapshot.exists()) {
        const data = snapshot.data();
        console.log('✅ Found mood data:', data);
        alert(`Found mood data for today!\n\nHappiness: ${data.happiness}\nEnergy: ${data.energy}\nAnxiety: ${data.anxiety}\nStress: ${data.stress}`);
      } else {
        console.log('❌ No mood data found for today');
        alert('No mood data found for today. Make sure you chatted and emotional analysis ran.');
      }
    } catch (error) {
      console.error('❌ Error checking Firestore data:', error);
      alert('Error checking data: ' + error.message);
    }
  };

  const handleFullTest = async () => {
    console.log('🚀 Starting comprehensive test of entire flow...');
    const user = getCurrentUser();
    if (!user) {
      alert('Please sign in first');
      return;
    }

    try {
      // Step 1: Test API connectivity first
      console.log('🧪 STEP 1: Testing API connectivity...');
      const apiTest = await emotionalAnalysisService.testAPI();
      if (apiTest.success) {
        console.log('✅ STEP 1 PASSED: API is working');
      } else {
        console.log('❌ STEP 1 FAILED: API not working');
        alert('❌ API not working: ' + apiTest.error);
        return;
      }

      // Step 2: Check if there's any mood data for today
      console.log('📊 STEP 2: Checking if mood data exists...');
      const todayId = getDateId(new Date());
      const moodRef = doc(db, `users/${user.uid}/days/${todayId}/moodChart/daily`);
      const snapshot = await getDoc(moodRef);

      if (snapshot.exists()) {
        const data = snapshot.data();
        console.log('✅ STEP 2 PASSED: Found mood data:', data);

        // Step 3: Test loading via getMoodChartDataNew
        console.log('📊 STEP 3: Testing getMoodChartDataNew...');
        const result = await firestoreService.getMoodChartDataNew(user.uid, 7);
        console.log('📊 STEP 3 RESULT:', result);

        if (result.success && result.moodData) {
          console.log('✅ STEP 3 PASSED: getMoodChartDataNew returned data');

          // Step 4: Check if our data is in the result
          const ourData = result.moodData.find(d => d.date === todayId);
          console.log('📊 STEP 4: Looking for our data in result:', ourData);

          if (ourData && (ourData.happiness !== 0 || ourData.energy !== 0 || ourData.anxiety !== 0 || ourData.stress !== 0)) {
            console.log('✅ STEP 4 PASSED: Found our analyzed data in result');

            // Step 5: Manually trigger data loading
            console.log('📊 STEP 5: Manually triggering data loading...');
            await loadRealEmotionalDataInternal();

            console.log('✅ ALL TESTS PASSED! Data should be displaying correctly.');
            alert('✅ All tests passed! If charts still show defaults, try refreshing the page.');

          } else {
            console.log('❌ STEP 4 FAILED: Data found but all values are 0');
            alert('❌ Found data but all values are 0. Check if emotional analysis actually ran.');
          }
        } else {
          console.log('❌ STEP 3 FAILED: getMoodChartDataNew failed');
          alert('❌ getMoodChartDataNew failed. Check console for details.');
        }
      } else {
        console.log('❌ STEP 2 FAILED: No mood data found for today');
        alert('❌ No mood data found for today. Did you chat and was emotional analysis run?');
      }
    } catch (error) {
      console.error('❌ Full test failed:', error);
      alert('❌ Test failed: ' + error.message);
    }
  };

  const handleTestAPI = async () => {
    console.log('🧪 Testing API connectivity...');
    try {
      const result = await emotionalAnalysisService.testAPI();
      if (result.success) {
        alert(`✅ API test successful!\n\nWorking Model: ${result.model}\nResponse: ${result.response}`);
      } else {
        alert('❌ API test failed: ' + result.error + '\n\nCheck console for details.');
      }
    } catch (error) {
      alert('❌ API test error: ' + error.message);
    }
  };

  const handleMigrateData = async () => {
    console.log('🔄 MANUAL MIGRATION: Starting migration of localStorage data...');
    const user = getCurrentUser();
    if (!user) {
      alert('Please sign in first');
      return;
    }

    try {
      // Get emotional data from localStorage
      const emotionalDataKey = `emotional_data_${user.uid}`;
      const emotionalData = JSON.parse(localStorage.getItem(emotionalDataKey) || '[]');
      
      console.log(`📊 Found ${emotionalData.length} emotional records in localStorage`);
      
      if (emotionalData.length === 0) {
        alert('No emotional data found in localStorage. Chat with Deite first to generate some data!');
        return;
      }

      console.log('📋 Sample data:', emotionalData.slice(0, 2));
      
      let migrated = 0;
      for (const record of emotionalData) {
        try {
          const result = await firestoreService.saveMoodChartNew(user.uid, record.date, {
            happiness: record.happiness,
            energy: record.energy,
            anxiety: record.anxiety,
            stress: record.stress
          });
          
          if (result.success) {
            migrated++;
            console.log(`✅ Migrated ${record.date}: H:${record.happiness} E:${record.energy} A:${record.anxiety} S:${record.stress}`);
          } else {
            console.error(`❌ Failed to migrate ${record.date}:`, result.error);
          }
        } catch (error) {
          console.error(`❌ Error migrating ${record.date}:`, error);
        }
      }
      
      console.log(`🎉 Migration complete! ${migrated}/${emotionalData.length} records migrated`);
      
      if (migrated > 0) {
        // Mark migration as complete
        localStorage.setItem('emotional_data_migrated', 'true');
        
        // Clear mood chart cache to force refresh
        const cacheKeys = Object.keys(localStorage).filter(key =>
          key.includes('emotional_wellbeing') || key.includes('moodChart')
        );
        cacheKeys.forEach(key => {
          localStorage.removeItem(key);
          console.log('🗑️ Cleared cache:', key);
        });
        
        // Force refresh
        await loadFreshDataOnly();
        
        alert(`✅ Migration successful!\n\nMigrated ${migrated} emotional records to Firestore.\n\nThe mood chart should now show your real data!`);
      } else {
        alert('❌ Migration failed. Check console for details.');
      }
    } catch (error) {
      console.error('❌ Migration error:', error);
      alert('❌ Migration failed: ' + error.message);
    }
  };

  const handleScanAllDays = async () => {
    console.log('🔍 SCANNING ALL DAYS: Looking for days with chat but no mood data...');
    const user = getCurrentUser();
    if (!user) {
      alert('Please sign in first');
      return;
    }

    try {
      // Get all days from the last 30 days
      const daysToCheck = [];
      const today = new Date();
      
      for (let i = 29; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateId = date.toISOString().split('T')[0]; // YYYY-MM-DD format
        daysToCheck.push(dateId);
      }

      console.log('🔍 SCANNING: Checking', daysToCheck.length, 'days for missing mood data...');
      
      const daysWithChat = [];
      const daysWithMoodData = [];
      const daysNeedingAnalysis = [];

      // Check each day
      for (const dateId of daysToCheck) {
        console.log(`🔍 SCANNING: Checking ${dateId}...`);
        
        // Check for chat messages
        const messagesResult = await firestoreService.getChatMessagesNew(user.uid, dateId);
        const hasChat = messagesResult.success && messagesResult.messages.length > 0;
        
        // Check for mood data
        const moodRef = doc(db, `users/${user.uid}/days/${dateId}/moodChart/daily`);
        const moodSnap = await getDoc(moodRef);
        const hasMoodData = moodSnap.exists();
        
        if (hasChat) {
          daysWithChat.push(dateId);
          console.log(`✅ SCANNING: ${dateId} has ${messagesResult.messages.length} chat messages`);
        }
        
        if (hasMoodData) {
          daysWithMoodData.push(dateId);
          console.log(`✅ SCANNING: ${dateId} has mood data`);
        }
        
        if (hasChat && !hasMoodData) {
          daysNeedingAnalysis.push(dateId);
          console.log(`⚠️ SCANNING: ${dateId} needs mood analysis!`);
        }
      }

      console.log('📊 SCANNING RESULTS:');
      console.log('Days with chat:', daysWithChat.length);
      console.log('Days with mood data:', daysWithMoodData.length);
      console.log('Days needing analysis:', daysNeedingAnalysis.length);

      if (daysNeedingAnalysis.length === 0) {
        alert(`✅ All good!\n\nFound ${daysWithChat.length} days with chat data.\nAll days already have mood data generated.`);
      } else {
        alert(`Found ${daysNeedingAnalysis.length} days that need mood analysis:\n\n${daysNeedingAnalysis.join(', ')}\n\nClick "Fix All Missing Data" to generate mood analysis for all these days!`);
      }
    } catch (error) {
      console.error('❌ SCANNING: Error:', error);
      alert('Error scanning days: ' + error.message);
    }
  };

  const handleCheckOct8Data = async () => {
    console.log('🔍 CHECKING OCT 8 DATA: Investigating what data exists...');
    const user = getCurrentUser();
    if (!user) {
      alert('Please sign in first');
      return;
    }

    try {
      const oct8Id = '2025-10-08';
      
      // Check Firestore mood data
      console.log('🔍 CHECKING: Looking for mood data in Firestore...');
      const moodRef = doc(db, `users/${user.uid}/days/${oct8Id}/moodChart/daily`);
      const moodSnap = await getDoc(moodRef);
      
      if (moodSnap.exists()) {
        const moodData = moodSnap.data();
        console.log('✅ CHECKING: Found mood data in Firestore:', moodData);
        alert(`✅ Found mood data for October 8th:\n\nHappiness: ${moodData.happiness}%\nEnergy: ${moodData.energy}%\nAnxiety: ${moodData.anxiety}%\nStress: ${moodData.stress}%`);
      } else {
        console.log('❌ CHECKING: No mood data in Firestore');
        
        // Check for chat messages
        console.log('🔍 CHECKING: Looking for chat messages...');
        const messagesResult = await firestoreService.getChatMessagesNew(user.uid, oct8Id);
        
        if (messagesResult.success && messagesResult.messages.length > 0) {
          console.log('✅ CHECKING: Found', messagesResult.messages.length, 'chat messages');
          alert(`Found ${messagesResult.messages.length} chat messages for October 8th, but no mood data.\n\nClick "Fix Oct 8th Data" to generate mood analysis from your chat!`);
        } else {
          console.log('❌ CHECKING: No chat messages found');
          alert('No chat messages found for October 8th.\n\nDid you chat with Deite on that day?');
        }
      }
    } catch (error) {
      console.error('❌ CHECKING: Error:', error);
      alert('Error checking data: ' + error.message);
    }
  };

  const handleFixAllMissingData = async () => {
    console.log('🔧 FIXING ALL MISSING DATA: Starting comprehensive mood data generation...');
    const user = getCurrentUser();
    if (!user) {
      alert('Please sign in first');
      return;
    }

    try {
      // First, scan to find all days that need analysis
      const daysToCheck = [];
      const today = new Date();
      
      for (let i = 29; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateId = date.toISOString().split('T')[0];
        daysToCheck.push(dateId);
      }

      console.log('🔧 FIXING: Scanning', daysToCheck.length, 'days...');
      
      const daysNeedingAnalysis = [];

      // Find all days that need analysis
      for (const dateId of daysToCheck) {
        const messagesResult = await firestoreService.getChatMessagesNew(user.uid, dateId);
        const hasChat = messagesResult.success && messagesResult.messages.length > 0;
        
        if (hasChat) {
          const moodRef = doc(db, `users/${user.uid}/days/${dateId}/moodChart/daily`);
          const moodSnap = await getDoc(moodRef);
          const hasMoodData = moodSnap.exists();
          
          if (!hasMoodData) {
            daysNeedingAnalysis.push({ dateId, messageCount: messagesResult.messages.length });
          }
        }
      }

      if (daysNeedingAnalysis.length === 0) {
        alert('✅ All days already have mood data! No fixes needed.');
        return;
      }

      console.log('🔧 FIXING: Found', daysNeedingAnalysis.length, 'days needing analysis:', daysNeedingAnalysis.map(d => d.dateId));

      // Confirm with user
      const confirmFix = window.confirm(`Found ${daysNeedingAnalysis.length} days that need mood analysis:\n\n${daysNeedingAnalysis.map(d => `${d.dateId} (${d.messageCount} messages)`).join('\n')}\n\nThis will generate mood data for all these days. Continue?`);
      
      if (!confirmFix) {
        console.log('🔧 FIXING: User cancelled');
        return;
      }

      // Process each day
      let successCount = 0;
      let errorCount = 0;
      const results = [];

      for (const { dateId, messageCount } of daysNeedingAnalysis) {
        try {
          console.log(`🔧 FIXING: Processing ${dateId} (${messageCount} messages)...`);
          
          // Get messages for this day
          const messagesResult = await firestoreService.getChatMessagesNew(user.uid, dateId);
          
          if (messagesResult.success && messagesResult.messages.length > 0) {
            // Generate emotional analysis
            const emotionalScores = await emotionalAnalysisService.analyzeEmotionalScores(messagesResult.messages);
            
            if (emotionalScores && emotionalScores.happiness !== undefined) {
              // Save the emotional data
              const saveResult = await emotionalAnalysisService.saveEmotionalData(user.uid, dateId, emotionalScores);
              
              if (saveResult.success) {
                successCount++;
                results.push(`✅ ${dateId}: H:${emotionalScores.happiness} E:${emotionalScores.energy} A:${emotionalScores.anxiety} S:${emotionalScores.stress}`);
                console.log(`✅ FIXING: ${dateId} completed successfully`);
              } else {
                errorCount++;
                results.push(`❌ ${dateId}: Save failed - ${saveResult.error}`);
                console.error(`❌ FIXING: ${dateId} save failed:`, saveResult.error);
              }
            } else {
              errorCount++;
              results.push(`❌ ${dateId}: Analysis failed - invalid scores`);
              console.error(`❌ FIXING: ${dateId} analysis failed - invalid scores:`, emotionalScores);
            }
          } else {
            errorCount++;
            results.push(`❌ ${dateId}: No messages found`);
            console.error(`❌ FIXING: ${dateId} no messages found`);
          }
        } catch (error) {
          errorCount++;
          results.push(`❌ ${dateId}: Error - ${error.message}`);
          console.error(`❌ FIXING: ${dateId} error:`, error);
        }
      }

      // Show results
      console.log('🔧 FIXING: Complete!', successCount, 'successful,', errorCount, 'failed');
      
      // Force refresh the mood chart
      await loadFreshDataOnly();
      
      alert(`🔧 Fix Complete!\n\n✅ Successfully processed: ${successCount} days\n❌ Failed: ${errorCount} days\n\nResults:\n${results.join('\n')}\n\nThe mood chart should now show real data for all processed days!`);
      
    } catch (error) {
      console.error('❌ FIXING: Error:', error);
      alert('Error fixing missing data: ' + error.message);
    }
  };

  const handleForceAnalysisForOct8 = async () => {
    console.log('🔬 OCT 8 ANALYSIS: Starting manual emotional analysis for October 8th...');
    const user = getCurrentUser();
    if (!user) {
      alert('Please sign in first');
      return;
    }

    try {
      const oct8Id = '2025-10-08';
      console.log('🔬 OCT 8 ANALYSIS: Date ID:', oct8Id);

      // Get October 8th messages
      const messagesResult = await firestoreService.getChatMessagesNew(user.uid, oct8Id);
      console.log('🔬 OCT 8 ANALYSIS: Messages result:', messagesResult);

      if (!messagesResult.success || messagesResult.messages.length === 0) {
        alert('No messages found for October 8th. Did you chat with Deite on that day?');
        return;
      }

      console.log('🔬 OCT 8 ANALYSIS: Found', messagesResult.messages.length, 'messages');
      console.log('🔬 OCT 8 ANALYSIS: Sample message:', messagesResult.messages[0]);

      // Run emotional analysis
      console.log('🔬 OCT 8 ANALYSIS: Calling analyzeEmotionalScores...');
      const emotionalScores = await emotionalAnalysisService.analyzeEmotionalScores(messagesResult.messages);
      console.log('🔬 OCT 8 ANALYSIS: Results:', emotionalScores);

      if (emotionalScores && emotionalScores.happiness !== undefined) {
        // Save the emotional data
        console.log('🔬 OCT 8 ANALYSIS: Saving emotional data...');
        const saveResult = await emotionalAnalysisService.saveEmotionalData(user.uid, oct8Id, emotionalScores);
        
        if (saveResult.success) {
          console.log('✅ OCT 8 ANALYSIS: Emotional data saved successfully!');
          
          // Force refresh the mood chart
          await loadFreshDataOnly();
          
          alert(`✅ October 8th Analysis Complete!\n\nHappiness: ${emotionalScores.happiness}%\nEnergy: ${emotionalScores.energy}%\nAnxiety: ${emotionalScores.anxiety}%\nStress: ${emotionalScores.stress}%\n\nThe mood chart should now show real data for October 8th!`);
        } else {
          console.error('❌ OCT 8 ANALYSIS: Failed to save:', saveResult.error);
          alert('❌ Failed to save emotional data: ' + saveResult.error);
        }
      } else {
        console.error('❌ OCT 8 ANALYSIS: Invalid emotional scores:', emotionalScores);
        alert('❌ Failed to generate emotional analysis. Check console for details.');
      }
    } catch (error) {
      console.error('❌ OCT 8 ANALYSIS: Error:', error);
      alert('❌ Analysis failed: ' + error.message);
    }
  };

  const handleForceAnalysis = async () => {
    console.log('🔬 FORCE ANALYSIS: Starting manual emotional analysis for today...');
    const user = getCurrentUser();
    if (!user) {
      alert('Please sign in first');
      return;
    }

    try {
      const todayId = getDateId(new Date());
      console.log('🔬 FORCE ANALYSIS: Date ID:', todayId);

      // Get today's messages
      const messagesResult = await firestoreService.getChatMessagesNew(user.uid, todayId);
      console.log('🔬 FORCE ANALYSIS: Messages result:', messagesResult);

      if (!messagesResult.success || messagesResult.messages.length === 0) {
        alert('No messages found for today. Chat with Deite first!');
        return;
      }

      console.log('🔬 FORCE ANALYSIS: Found', messagesResult.messages.length, 'messages');
      console.log('🔬 FORCE ANALYSIS: Sample message:', messagesResult.messages[0]);

      // Run emotional analysis
      console.log('🔬 FORCE ANALYSIS: Calling analyzeEmotionalScores...');
      const emotionalScores = await emotionalAnalysisService.analyzeEmotionalScores(messagesResult.messages);
      console.log('🔬 FORCE ANALYSIS: Results:', emotionalScores);

      if (emotionalScores.happiness === 0 && emotionalScores.energy === 0 && 
          emotionalScores.anxiety === 0 && emotionalScores.stress === 0) {
        alert('⚠️ Analysis returned all zeros. Check console for API errors.');
        return;
      }

      // Save to Firestore
      console.log('🔬 FORCE ANALYSIS: Saving to Firestore...');
      await firestoreService.saveMoodChartNew(user.uid, todayId, emotionalScores);
      console.log('🔬 FORCE ANALYSIS: Saved successfully!');

      // Calculate and save emotional balance
      const total = emotionalScores.happiness + emotionalScores.energy + 
                    emotionalScores.stress + emotionalScores.anxiety;
      let positive = ((emotionalScores.happiness + emotionalScores.energy) / total) * 100;
      let negative = ((emotionalScores.stress + emotionalScores.anxiety) / total) * 100;
      let neutral = 100 - positive - negative;

      // Ensure all values are between 0 and 100 (clamp to prevent negative values)
      positive = Math.max(0, Math.min(100, Math.round(positive)));
      negative = Math.max(0, Math.min(100, Math.round(negative)));
      neutral = Math.max(0, Math.min(100, Math.round(neutral)));

      await firestoreService.saveEmotionalBalanceNew(user.uid, todayId, {
        positive: positive,
        negative: negative,
        neutral: neutral
      });

      // Auto-refresh the data FIRST
      console.log('🔬 FORCE ANALYSIS: Refreshing chart data...');
      window.isForceAnalysis = true;
      await handleRefreshData();
      
      // Wait a moment for state to update
      await new Promise(resolve => setTimeout(resolve, 500));
      
      window.isForceAnalysis = false;

      alert(`✅ Analysis complete!\n\nHappiness: ${emotionalScores.happiness}\nEnergy: ${emotionalScores.energy}\nAnxiety: ${emotionalScores.anxiety}\nStress: ${emotionalScores.stress}\n\nChart updated successfully!`);

    } catch (error) {
      console.error('🔬 FORCE ANALYSIS ERROR:', error);
      alert('❌ Analysis failed: ' + error.message);
    }
  };

  // Custom tooltip component for the line chart
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div
          className={`p-4 rounded-2xl backdrop-blur-lg border shadow-lg ${
            isDarkMode 
              ? 'bg-gray-900/90 border-gray-700/50 text-white' 
              : 'bg-white/90 border-gray-200/50 text-gray-800'
          }`}
          style={{
            boxShadow: isDarkMode 
              ? "0 8px 32px rgba(0, 0, 0, 0.3)" 
              : "0 8px 32px rgba(0, 0, 0, 0.1)",
          }}
        >
          <p className={`font-semibold mb-3 ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
            {label}
          </p>
          <div className="space-y-2">
            {payload.map((entry, index) => (
              <div key={index} className="flex items-center justify-between space-x-4">
                <div className="flex items-center space-x-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: entry.color }}
                  ></div>
                  <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                    {entry.name.charAt(0).toUpperCase() + entry.name.slice(1)}
                  </span>
                </div>
                <span className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                  {entry.value}%
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    return null;
  };

  const handleDateClick = async (dateData) => {
    console.log('📊 Date clicked for detailed analysis:', dateData);
    setSelectedDateDetails(dateData);
    
    try {
      // Generate AI explanations for why each emotion has its score
      const explanations = await generateEmotionExplanations(dateData);
      setEmotionExplanations(explanations);
      setShowDetailsModal(true);
    } catch (error) {
      console.error('❌ Error generating emotion explanations:', error);
      // Show modal with basic info even if AI fails
      setEmotionExplanations({
        happiness: `You felt happy because of positive interactions and topics discussed.`,
        energy: `Your energy was steady since you were engaged in meaningful conversation.`,
        anxiety: `You had some concerns about various topics that came up.`,
        stress: `You felt mild stress due to daily responsibilities mentioned.`
      });
      setShowDetailsModal(true);
    }
  };

  const generateEmotionExplanations = async (dateData) => {
    console.log('🤖 Generating AI explanations for emotion scores...');
    
    const user = getCurrentUser();
    if (!user) {
      throw new Error('No user logged in');
    }

    // Get chat messages for that specific date
    const chatResult = await firestoreService.getChatMessagesNew(user.uid, dateData.date);
    
    if (!chatResult.success || !chatResult.messages || chatResult.messages.length === 0) {
      throw new Error('No chat data found for this date');
    }

    // Create conversation transcript for that day
    const transcript = chatResult.messages.map(msg => 
      `${msg.sender === 'user' ? 'User' : 'Deite'}: ${msg.text}`
    ).join('\n\n');

    const explanationPrompt = `Based on this conversation, explain why the user felt each emotion at that specific level. Give one concise, contextual reason per emotion.

CONVERSATION:
${transcript}

EMOTION SCORES:
- Happiness: ${dateData.happiness}%
- Energy: ${dateData.energy}%
- Anxiety: ${dateData.anxiety}%
- Stress: ${dateData.stress}%

For each emotion, provide ONE short sentence explaining WHY the user felt that way based on what they discussed. Be specific and contextual, not generic.

Examples:
- "You felt happy because you achieved a goal you were working towards."
- "Your energy was steady since you were motivated but dealing with challenges."
- "You had some worries about upcoming deadlines that were mentioned."
- "You felt mild stress due to work responsibilities you discussed."

Return in this JSON format:
{
  "happiness": "You felt happy because [specific reason from conversation]",
  "energy": "Your energy was [level description] since [specific reason from conversation]",
  "anxiety": "You had [anxiety level description] about [specific concern from conversation]",
  "stress": "You felt [stress level description] due to [specific stressor from conversation]"
}`;

    try {
      const apiKey = process.env.REACT_APP_GOOGLE_API_KEY || '';
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent`;
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: explanationPrompt
            }]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 300
          }
        })
      });

      if (response.ok) {
        const data = await response.json();
        // Parse Google API response format
        let responseText = '';
        if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
          responseText = data.candidates[0].content.parts.map(part => part.text).join('');
        }
        
        if (responseText) {
          const jsonMatch = responseText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const explanations = JSON.parse(jsonMatch[0]);
            console.log('✅ AI explanations generated:', explanations);
            return explanations;
          }
        }
      }
    } catch (error) {
      console.error('❌ Error generating AI explanations:', error);
    }

    // Fallback explanations
    return {
      happiness: `You felt happy because of the positive topics and achievements discussed in your conversation.`,
      energy: `Your energy was moderate since you were engaged but dealing with various challenges.`,
      anxiety: `You had some concerns about topics that came up during the chat.`,
      stress: `You felt mild stress due to responsibilities and pressures mentioned.`
    };
  };

  const handleAIUpdate = async () => {
    console.log('🤖 Starting comprehensive data refresh...');
    setIsUpdating(true);

    try {
      const user = getCurrentUser();
      if (!user) {
        alert('Please sign in to refresh data');
        setIsUpdating(false);
        return;
      }

      // First, refresh all data from Firestore
      console.log('🔄 Step 1: Refreshing data from Firestore...');
      
      // Clear cache using correct cache keys
      localStorage.removeItem(getCacheKey('emotional', selectedPeriod, user.uid));
      localStorage.removeItem(getCacheKey('balance', balancePeriod, user.uid));
      localStorage.removeItem(getCacheKey('pattern', patternPeriod, user.uid));
      localStorage.removeItem(getCacheKey('highlights', '3months', user.uid));
      localStorage.removeItem(`habit_analysis_${user.uid}`); // Clear habit analysis cache
      console.log('🗑️ Cache cleared for all data types');
      
      // Reset state to force re-render
      setWeeklyMoodData([]);
      setEmotionalData([]);
      setMoodBalance([]);
      setTopEmotions([]);
      setPatternAnalysis(null);
      setHighlights({});
      setChartKey(prev => prev + 1); // Force chart re-render
      console.log('🔄 State reset complete');
      
      // Reload all data
      await loadFreshEmotionalData();
      await loadFreshBalanceData(balancePeriod);
      await loadFreshPatternAnalysis();
      await loadFreshHighlightsData();
      await loadHabitAnalysis(true); // Force refresh habit analysis
      
      console.log('✅ All data refreshed from Firestore!');

      // Get emotional data for analysis (using current selected period)
      const userId = user.uid;
      let emotionalDataRaw;
      if (selectedPeriod === 7) {
        emotionalDataRaw = emotionalAnalysisService.getEmotionalData(userId, 7);
      } else if (selectedPeriod === 15) {
        emotionalDataRaw = emotionalAnalysisService.getEmotionalData(userId, 15);
      } else {
        emotionalDataRaw = emotionalAnalysisService.getEmotionalData(userId, 30);
      }

      if (emotionalDataRaw.length === 0) {
        console.log('📝 No emotional data found for AI analysis');
        // Don't show error, just finish since we refreshed the data
        return;
      }

      console.log(`📊 Analyzing ${emotionalDataRaw.length} days of emotional data...`);

      // Generate comprehensive AI analysis
      const periodText = selectedPeriod === 7 ? 'last week' : 
                        selectedPeriod === 15 ? 'last 2 weeks' : 'last month';
      
      const aiAnalysis = await chatService.generateComprehensiveAnalysis(emotionalDataRaw, periodText);
      console.log('🎯 AI Analysis received:', aiAnalysis);

      // Update highlights with AI-generated descriptions
      const validData = emotionalDataRaw.filter(item => item.happiness !== undefined);
      if (validData.length > 0) {
        const bestDay = validData.reduce((best, current) => 
          (current.happiness + current.energy) > (best.happiness + best.energy) ? current : best
        );
        const worstDay = validData.reduce((worst, current) => 
          (current.anxiety + current.stress) > (worst.anxiety + worst.stress) ? current : worst
        );

        const updatedHighlights = {
          peak: {
            title: "Best Mood Day",
            description: aiAnalysis.highlights.bestDayReason,
            date: new Date(bestDay.timestamp).toLocaleDateString(),
            score: Math.round((bestDay.happiness + bestDay.energy) / 2)
          },
          toughestDay: {
            title: "Challenging Day",
            description: aiAnalysis.highlights.challengingDayReason,
            date: new Date(worstDay.timestamp).toLocaleDateString(),
            score: Math.round((worstDay.anxiety + worstDay.stress) / 2)
          }
        };

        setHighlights(updatedHighlights);
        setHighlightsLoading(false);

        // Cache the updated highlights
        try {
          await firestoreService.saveHighlightsCache(userId, '3months', updatedHighlights);
        } catch (cacheError) {
          console.error('❌ Error caching updated highlights:', cacheError);
        }
      }

      // Update triggers with AI analysis
      setTriggers({
        stress: aiAnalysis.triggers.stressFactors || ["Work pressure", "Time constraints"],
        joy: aiAnalysis.triggers.joyFactors || ["Meaningful conversations", "Personal achievements"],
        distraction: aiAnalysis.triggers.energyDrains || ["Overthinking", "Worry cycles"]
      });

      // Update emotional balance based on AI analysis
      const avgHappiness = validData.reduce((sum, day) => sum + day.happiness, 0) / validData.length;
      const avgEnergy = validData.reduce((sum, day) => sum + day.energy, 0) / validData.length;
      const avgAnxiety = validData.reduce((sum, day) => sum + day.anxiety, 0) / validData.length;
      const avgStress = validData.reduce((sum, day) => sum + day.stress, 0) / validData.length;

      let positiveScore = Math.round((avgHappiness + avgEnergy) / 2);
      let negativeScore = Math.round((avgAnxiety + avgStress) / 2);
      let neutralScore = 100 - positiveScore - negativeScore;

      // Ensure all values are between 0 and 100 (clamp to prevent negative values)
      positiveScore = Math.max(0, Math.min(100, positiveScore));
      negativeScore = Math.max(0, Math.min(100, negativeScore));
      neutralScore = Math.max(0, Math.min(100, neutralScore));

      setMoodBalance([
        { name: 'Positive', value: positiveScore, color: '#7DD3C0' },
        { name: 'Neutral', value: neutralScore, color: '#D4AF37' },
        { name: 'Negative', value: negativeScore, color: '#9BB5FF' }
      ]);

      // Update pattern analysis with AI insights
      setPatternAnalysis({
        overallTrend: aiAnalysis.patterns.overallTrend,
        keyInsight: aiAnalysis.patterns.keyInsight,
        recommendation: aiAnalysis.patterns.recommendation,
        emotionalBalance: aiAnalysis.emotionalBalance,
        personalizedGuidance: aiAnalysis.personalizedGuidance
      });

      // Refresh mood chart data
      processRealEmotionalData(emotionalDataRaw);

      console.log('✅ AI comprehensive update completed successfully');
      alert('🤖 AI analysis complete! All sections have been updated with fresh insights.');

    } catch (error) {
      console.error('❌ Error during AI update:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  const renderMoodSurvey = () => (
    <div className="space-y-4">

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          {/* 1. Mood Chart - Line Chart - Mobile Optimized */}
          <div
            className={`rounded-xl p-4 backdrop-blur-lg transition-all duration-300 ${
              isDarkMode ? 'border border-gray-600/20' : 'bg-white/40 border border-gray-200/30'
            }`}
            style={isDarkMode ? {
              backgroundColor: "#262626",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
            } : {
              backgroundColor: "rgba(255, 255, 255, 0.6)",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.1)",
            }}
          >
            <div className="flex flex-col space-y-4 mb-4">
              <div className="flex items-center space-x-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center"
                  style={{
                    background: "linear-gradient(135deg, rgba(125, 211, 192, 0.2) 0%, rgba(212, 175, 55, 0.2) 100%)",
                    border: "1px solid rgba(125, 211, 192, 0.3)",
                  }}
                >
                  <BarChart3 className="w-5 h-5" style={{ color: "#7DD3C0" }} />
                </div>
                <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                  Mood Chart
                </h3>
              </div>
              
              {/* Period Toggle - Mobile Optimized */}
              <div className="flex space-x-2 w-full">
                <button
                  onClick={() => setSelectedPeriod(7)}
                  className={`flex-1 px-3 py-2 rounded-full text-sm transition-all duration-300 touch-manipulation ${
                    selectedPeriod === 7
                      ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
                      : isDarkMode
                        ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  7 Days
                </button>
                <button
                  onClick={() => setSelectedPeriod(15)}
                  className={`flex-1 px-3 py-2 rounded-full text-sm transition-all duration-300 touch-manipulation ${
                    selectedPeriod === 15
                      ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
                      : isDarkMode
                        ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  15 Days
                </button>
                <button
                  onClick={() => setSelectedPeriod(365)}
                  className={`flex-1 px-3 py-2 rounded-full text-sm transition-all duration-300 touch-manipulation ${
                    selectedPeriod === 365
                      ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
                      : isDarkMode
                        ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  Lifetime
                </button>
              </div>
            </div>

            <div className="w-full" style={{ height: '280px', minHeight: '280px' }}>
          {weeklyMoodData.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
                  style={isDarkMode ? {
                    backgroundColor: "#262626",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                  } : {
                    backgroundColor: "rgba(255, 255, 255, 0.6)",
                    border: "1px solid rgba(0, 0, 0, 0.08)",
                  }}
                >
                  <Heart className="w-6 h-6" style={{ color: isDarkMode ? "#FDD663" : "#87A96B" }} />
                </div>
                <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  No data yet
                </p>
              </div>
            </div>
          ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  key={chartKey}
                  data={weeklyMoodData}
                  margin={{ top: 10, right: 10, left: -10, bottom: 5 }}
                  onClick={(data) => {
                    if (data && data.activePayload && data.activePayload[0]) {
                      const clickedData = data.activePayload[0].payload;
                      console.log('📊 CHART CLICK: Date clicked:', clickedData);
                      handleDateClick(clickedData);
                    }
                  }}
                >

                  <XAxis 
                    dataKey="day" 
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: isDarkMode ? '#9CA3AF' : '#6B7280', fontSize: 11 }}
                    angle={-45}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis 
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: isDarkMode ? '#9CA3AF' : '#6B7280', fontSize: 11 }}
                    width={35}
                    domain={[0, 100]}
                    allowDecimals={false}
                  />
                  <Tooltip 
                    content={<CustomTooltip />}
                    cursor={{ stroke: isDarkMode ? '#374151' : '#D1D5DB', strokeWidth: 1 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="happiness"
                    stroke="#81C995"
                    strokeWidth={2}
                    dot={{ fill: '#81C995', strokeWidth: 2, r: 3 }}
                    activeDot={{
                      r: 6,
                      stroke: '#81C995',
                      strokeWidth: 2,
                      fill: '#81C995'
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="energy"
                    stroke="#FDD663"
                    strokeWidth={2}
                    dot={{ fill: '#FDD663', strokeWidth: 2, r: 3 }}
                    activeDot={{
                      r: 6,
                      stroke: '#FDD663',
                      strokeWidth: 2,
                      fill: '#FDD663'
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="anxiety"
                    stroke="#8AB4F8"
                    strokeWidth={2}
                    dot={{ fill: '#8AB4F8', strokeWidth: 2, r: 3 }}
                    activeDot={{
                      r: 6,
                      stroke: '#8AB4F8',
                      strokeWidth: 2,
                      fill: '#8AB4F8'
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="stress"
                    stroke="#F28B82"
                    strokeWidth={2}
                    dot={{ fill: '#F28B82', strokeWidth: 2, r: 3 }}
                    activeDot={{
                      r: 6,
                      stroke: '#F28B82',
                      strokeWidth: 2,
                      fill: '#F28B82'
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
          )}
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4">
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 rounded-full bg-[#81C995]"></div>
                <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>Happiness</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 rounded-full bg-[#FDD663]"></div>
                <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>Energy</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 rounded-full bg-[#8AB4F8]"></div>
                <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>Anxiety</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 rounded-full bg-[#F28B82]"></div>
                <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>Stress</span>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 flex flex-col">
          {/* 2. Emotional Balance - Line Chart - Mobile Optimized */}
            <div
              className={`rounded-xl p-4 backdrop-blur-lg transition-all duration-300 ${
                isDarkMode ? 'border border-gray-600/20' : 'bg-white/40 border border-gray-200/30'
              }`}
              style={isDarkMode ? {
                backgroundColor: "#262626",
                boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
              } : {
                backgroundColor: "rgba(255, 255, 255, 0.6)",
                boxShadow: "0 8px 32px rgba(0, 0, 0, 0.1)",
              }}
            >
              <div className="flex flex-col space-y-4 mb-4 lg:flex-row lg:items-center lg:justify-between lg:space-y-0 lg:gap-4">
                <div className="flex items-center space-x-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center"
                    style={{
                      background: "linear-gradient(135deg, rgba(212, 175, 55, 0.2) 0%, rgba(177, 156, 217, 0.2) 100%)",
                      border: "1px solid rgba(212, 175, 55, 0.3)",
                    }}
                  >
                    <Target className="w-5 h-5" style={{ color: "#D4AF37" }} />
                  </div>
                  <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                    Emotional Balance
                  </h3>
                </div>

                {/* Balance Period Toggle - Mobile Optimized */}
                <div className="flex space-x-2 w-full">
                  <button
                    onClick={() => setBalancePeriod(7)}
                    className={`flex-1 px-3 py-2 rounded-full text-sm transition-all duration-300 touch-manipulation ${
                      balancePeriod === 7
                        ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
                        : isDarkMode
                          ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    7 Days
                  </button>
                  <button
                    onClick={() => setBalancePeriod(30)}
                    className={`flex-1 px-3 py-2 rounded-full text-sm transition-all duration-300 touch-manipulation ${
                      balancePeriod === 30
                        ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
                        : isDarkMode
                          ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    30 Days
                  </button>
                  <button
                    onClick={() => setBalancePeriod(365)}
                    className={`flex-1 px-3 py-2 rounded-full text-sm transition-all duration-300 touch-manipulation ${
                      balancePeriod === 365
                        ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
                        : isDarkMode
                          ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    Lifetime
                  </button>
                </div>
              </div>

              <div className="w-full" style={{ height: '280px', minHeight: '280px' }}>
          {moodBalance.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
                  style={isDarkMode ? {
                    backgroundColor: "#262626",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                  } : {
                    backgroundColor: "rgba(255, 255, 255, 0.6)",
                    border: "1px solid rgba(0, 0, 0, 0.08)",
                  }}
                >
                  <Target className="w-6 h-6" style={{ color: isDarkMode ? "#D4AF37" : "#87A96B" }} />
                </div>
                <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  No balance data yet
                </p>
              </div>
            </div>
          ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart 
                    key={`balance-${chartKey}`} 
                    data={moodBalance}
                    margin={{ top: 10, right: 10, left: -10, bottom: 5 }}
                  >
                    <XAxis 
                      dataKey="day" 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: isDarkMode ? '#9CA3AF' : '#6B7280', fontSize: 11 }}
                      angle={-45}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: isDarkMode ? '#9CA3AF' : '#6B7280', fontSize: 11 }}
                      width={35}
                      domain={[0, 100]}
                    />
                    <Tooltip 
                      content={<CustomTooltip />}
                      cursor={{ stroke: isDarkMode ? '#374151' : '#D1D5DB', strokeWidth: 1 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="positive"
                      stroke="#81C995"
                      strokeWidth={2}
                      dot={{ fill: '#81C995', strokeWidth: 2, r: 3 }}
                      activeDot={{
                        r: 6,
                        stroke: '#81C995',
                        strokeWidth: 2,
                        fill: '#81C995'
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="neutral"
                      stroke="#FDD663"
                      strokeWidth={2}
                      dot={{ fill: '#FDD663', strokeWidth: 2, r: 3 }}
                      activeDot={{
                        r: 6,
                        stroke: '#FDD663',
                        strokeWidth: 2,
                        fill: '#FDD663'
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="negative"
                      stroke="#F28B82"
                      strokeWidth={2}
                      dot={{ fill: '#F28B82', strokeWidth: 2, r: 3 }}
                      activeDot={{
                        r: 6,
                        stroke: '#F28B82',
                        strokeWidth: 2,
                        fill: '#F28B82'
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
          )}
              </div>

              <div className="flex flex-wrap justify-center gap-4 mt-4">
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 rounded-full bg-[#81C995]"></div>
                  <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>Positive</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 rounded-full bg-[#FDD663]"></div>
                  <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>Neutral</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 rounded-full bg-[#F28B82]"></div>
                  <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>Negative</span>
                </div>
              </div>
            </div>
        </div>
      </div>

          {/* 3. Highlights */}
          <div
            className={`rounded-xl p-6 backdrop-blur-lg transition-all duration-300 ${
              isDarkMode ? 'border border-gray-600/20' : 'bg-white/40 border border-gray-200/30'
            }`}
            style={isDarkMode ? {
              backgroundColor: "#262626",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
            } : {
              backgroundColor: "rgba(255, 255, 255, 0.6)",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.1)",
            }}
          >
            <div className="flex items-center space-x-3 mb-6">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={isDarkMode ? {
                  backgroundColor: "#262626",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                } : {
                  backgroundColor: "rgba(255, 255, 255, 0.6)",
                  border: "1px solid rgba(0, 0, 0, 0.08)",
                }}
              >
                <Award className="w-5 h-5" style={{ color: isDarkMode ? "#8AB4F8" : "#87A96B" }} />
              </div>
              <div>
                <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                  Highlights
                </h3>
                <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Last 3 months emotional journey
                </p>
              </div>
            </div>

        {emotionalData.length === 0 ? (
          <div className="text-center py-8">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
              style={isDarkMode ? {
                backgroundColor: "#262626",
                border: "1px solid rgba(255, 255, 255, 0.08)",
              } : {
                backgroundColor: "rgba(255, 255, 255, 0.6)",
                border: "1px solid rgba(0, 0, 0, 0.08)",
              }}
            >
              <Award className="w-6 h-6" style={{ color: isDarkMode ? "#8AB4F8" : "#87A96B" }} />
            </div>
            <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Highlights will appear here
            </p>
          </div>
        ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {/* Best Mood Day - Unified UI with Green Title */}
              <div
                className="group p-4 sm:p-6 rounded-xl transition-all duration-300 cursor-pointer hover:scale-105"
                style={isDarkMode ? {
                  backgroundColor: "rgba(129, 201, 149, 0.08)",
                  border: "1px solid rgba(129, 201, 149, 0.15)",
                } : {
                  backgroundColor: "rgba(129, 201, 149, 0.08)",
                  border: "1px solid rgba(129, 201, 149, 0.15)",
                }}
              >
                <div className="flex items-center space-x-3 mb-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-300"
                    style={{
                      backgroundColor: "rgba(125, 211, 192, 0.2)",
                      boxShadow: "0 0 15px rgba(125, 211, 192, 0.3)",
                    }}
                  >
                    <Smile className="w-4 h-4" style={{ color: "#E8F4F1" }} />
                  </div>
                  <h4 className="font-semibold text-green-400 group-hover:text-green-300 transition-colors duration-300">
                    {highlights.peak?.title || 'Best Mood Day'}
                  </h4>
                </div>
                {highlightsLoading ? (
                  <>
                    <div className="flex items-center space-x-2 mb-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-green-400 border-t-transparent"></div>
                      <p className="text-sm text-gray-400">Loading...</p>
                    </div>
                    <p className="text-xs text-gray-500">Loading your highlights...</p>
                  </>
                ) : (
                  <>
                    <p className={`text-sm leading-relaxed mb-2 group-hover:transition-colors duration-300 ${isDarkMode ? 'text-gray-300 group-hover:text-gray-200' : 'text-gray-800 group-hover:text-gray-900'}`}>
                      {highlights.peak?.description || 'Your highest emotional peak this period.'}
                    </p>
                    <p className={`text-xs transition-colors duration-300 ${isDarkMode ? 'text-gray-400 group-hover:text-gray-300' : 'text-gray-600 group-hover:text-gray-700'}`}>
                      {highlights.peak?.date || 'No data available'}
                    </p>
                  </>
                )}
              </div>

              {/* Challenging Day - Unified UI with Red Title */}
              <div
                className="group p-4 sm:p-6 rounded-xl transition-all duration-300 cursor-pointer hover:scale-105"
                style={isDarkMode ? {
                  backgroundColor: "rgba(242, 139, 130, 0.08)",
                  border: "1px solid rgba(242, 139, 130, 0.15)",
                } : {
                  backgroundColor: "rgba(242, 139, 130, 0.08)",
                  border: "1px solid rgba(242, 139, 130, 0.15)",
                }}
              >
                <div className="flex items-center space-x-3 mb-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-300"
                    style={{
                      backgroundColor: "#F28B82",
                    }}
                  >
                    <AlertTriangle className="w-4 h-4 text-white" />
                  </div>
                  <h4 className="font-semibold text-red-400 group-hover:text-red-300 transition-colors duration-300">
                    {highlights.toughestDay?.title || 'Challenging Day'}
                  </h4>
                </div>
                {highlightsLoading ? (
                  <>
                    <div className="flex items-center space-x-2 mb-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-red-400 border-t-transparent"></div>
                      <p className="text-sm text-gray-400">Loading...</p>
                    </div>
                    <p className="text-xs text-gray-500">Loading your highlights...</p>
                  </>
                ) : (
                  <>
                    <p className={`text-sm leading-relaxed mb-2 group-hover:transition-colors duration-300 ${isDarkMode ? 'text-gray-300 group-hover:text-gray-200' : 'text-gray-800 group-hover:text-gray-900'}`}>
                      {highlights.toughestDay?.description || 'Your most challenging emotional period.'}
                    </p>
                    <p className={`text-xs transition-colors duration-300 ${isDarkMode ? 'text-gray-400 group-hover:text-gray-300' : 'text-gray-600 group-hover:text-gray-700'}`}>
                      {highlights.toughestDay?.date || 'No data available'}
                    </p>
                  </>
                )}
              </div>
            </div>
        )}
          </div>

          {/* 4. Triggers */}
          <div
            className={`rounded-xl p-6 backdrop-blur-lg transition-all duration-300 ${
              isDarkMode ? 'border border-gray-600/20' : 'bg-white/40 border border-gray-200/30'
            }`}
            style={isDarkMode ? {
              backgroundColor: "#262626",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
            } : {
              backgroundColor: "rgba(255, 255, 255, 0.6)",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.1)",
            }}
          >
            <div className="flex items-center space-x-3 mb-6">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={isDarkMode ? {
                  backgroundColor: "#262626",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                } : {
                  backgroundColor: "rgba(255, 255, 255, 0.6)",
                  border: "1px solid rgba(0, 0, 0, 0.08)",
                }}
              >
                <Lightbulb className="w-5 h-5" style={{ color: isDarkMode ? "#FDD663" : "#87A96B" }} />
              </div>
              <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                Triggers & Patterns
              </h3>
            </div>

        {emotionalData.length === 0 ? (
          <div className="text-center py-8">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
              style={isDarkMode ? {
                backgroundColor: "#262626",
                border: "1px solid rgba(255, 255, 255, 0.08)",
              } : {
                backgroundColor: "rgba(255, 255, 255, 0.6)",
                border: "1px solid rgba(0, 0, 0, 0.08)",
              }}
            >
              <Lightbulb className="w-6 h-6" style={{ color: isDarkMode ? "#FDD663" : "#87A96B" }} />
            </div>
            <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Patterns will appear here
            </p>
          </div>
        ) : (
          <>
            {/* Loading State */}
            {patternLoading && (
              <div className="flex items-center justify-center py-8">
                <div className="flex items-center space-x-3">
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-purple-500 border-t-transparent"></div>
                  <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    Analyzing your patterns...
                  </span>
                </div>
              </div>
            )}

            {/* Pattern Analysis Results */}
            {!patternLoading && (
              <>
                {/* Data Status Banner - Only show if no trigger data exists */}
                {!hasEnoughData && patternAnalysis && !(
                  (triggers.stress && triggers.stress.length > 0) ||
                  (triggers.joy && triggers.joy.length > 0) ||
                  (triggers.distraction && triggers.distraction.length > 0)
                ) && (
                  <div className={`mb-6 p-4 rounded-lg border`}
                    style={isDarkMode ? {
                      backgroundColor: "rgba(253, 214, 99, 0.08)",
                      border: "1px solid rgba(253, 214, 99, 0.15)",
                    } : {
                      backgroundColor: "rgba(253, 214, 99, 0.08)",
                      border: "1px solid rgba(253, 214, 99, 0.15)",
                    }}>
                    <div className="flex items-center space-x-2">
                      <AlertTriangle className="w-5 h-5" style={{ color: "#FDD663" }} />
                      <span className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                        {patternAnalysis.message || `No chat data available for analysis`}
                      </span>
                    </div>
                    {patternAnalysis.totalMessages !== undefined && (
                      <p className={`text-xs mt-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                        Current: {patternAnalysis.totalMessages} messages across {patternAnalysis.totalDays} days. Start chatting to build your emotional patterns!
                      </p>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <h4 className={`font-medium mb-3 flex items-center space-x-2 ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
                      <AlertTriangle className="w-4 h-4" />
                      <span>Stress Triggers</span>
                    </h4>
                    <div className="space-y-2">
                      {triggers.stress && triggers.stress.length > 0 ? (
                        triggers.stress.map((trigger, index) => (
                          <div key={index} className={`p-3 rounded-lg ${isDarkMode ? 'bg-red-500/10 border border-red-500/20' : 'bg-red-50 border border-red-200'}`}>
                            <span className={`text-sm ${isDarkMode ? 'text-red-300' : 'text-red-700'}`}>{trigger}</span>
                          </div>
                        ))
                      ) : (
                        <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-gray-700/30' : 'bg-gray-100'}`}>
                          <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            No specific stress triggers found in conversations
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <h4 className={`font-medium mb-3 flex items-center space-x-2 ${isDarkMode ? 'text-green-400' : 'text-green-600'}`}>
                      <Heart className="w-4 h-4" />
                      <span>Joy Boosters</span>
                    </h4>
                    <div className="space-y-2">
                      {triggers.joy && triggers.joy.length > 0 ? (
                        triggers.joy.map((trigger, index) => (
                          <div key={index} className={`p-3 rounded-lg`}
                            style={isDarkMode ? {
                              backgroundColor: "rgba(129, 201, 149, 0.08)",
                              border: "1px solid rgba(129, 201, 149, 0.15)",
                            } : {
                              backgroundColor: "rgba(129, 201, 149, 0.08)",
                              border: "1px solid rgba(129, 201, 149, 0.15)",
                            }}>
                            <span className={`text-sm ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>{trigger}</span>
                          </div>
                        ))
                      ) : (
                        <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-gray-700/30' : 'bg-gray-100'}`}>
                          <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            No specific joy sources found in conversations
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <h4 className={`font-medium mb-3 flex items-center space-x-2 ${isDarkMode ? 'text-yellow-400' : 'text-yellow-600'}`}>
                      <Zap className="w-4 h-4" />
                      <span>Distractions</span>
                    </h4>
                    <div className="space-y-2">
                      {triggers.distraction && triggers.distraction.length > 0 ? (
                        triggers.distraction.map((trigger, index) => (
                          <div key={index} className={`p-3 rounded-lg`}
                            style={isDarkMode ? {
                              backgroundColor: "rgba(253, 214, 99, 0.08)",
                              border: "1px solid rgba(253, 214, 99, 0.15)",
                            } : {
                              backgroundColor: "rgba(253, 214, 99, 0.08)",
                              border: "1px solid rgba(253, 214, 99, 0.15)",
                            }}>
                            <span className={`text-sm ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>{trigger}</span>
                          </div>
                        ))
                      ) : (
                        <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-gray-700/30' : 'bg-gray-100'}`}>
                          <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            No specific distractions found in conversations
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Insights Section */}
                {hasEnoughData && patternAnalysis && patternAnalysis.insights && (
                  <div className={`mt-6 p-4 rounded-lg`}
                    style={isDarkMode ? {
                      backgroundColor: "rgba(138, 180, 248, 0.08)",
                      border: "1px solid rgba(138, 180, 248, 0.15)",
                    } : {
                      backgroundColor: "rgba(138, 180, 248, 0.08)",
                      border: "1px solid rgba(138, 180, 248, 0.15)",
                    }}>
                    <h4 className={`font-medium mb-3 flex items-center space-x-2 ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                      <Target className="w-4 h-4" style={{ color: "#8AB4F8" }} />
                      <span>Key Insights</span>
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <p className={`text-xs font-medium ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>Primary Stress Source</p>
                        <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                          {patternAnalysis.insights.primaryStressSource}
                        </p>
                      </div>
                      <div>
                        <p className={`text-xs font-medium ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>Main Joy Source</p>
                        <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                          {patternAnalysis.insights.mainJoySource}
                        </p>
                      </div>
                      <div>
                        <p className={`text-xs font-medium ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>Behavioral Pattern</p>
                        <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                          {patternAnalysis.insights.behavioralPattern}
                        </p>
                      </div>
                    </div>
                  </div>
              )}
            </>
                )}
              </>
            )}
          </div>

      {/* 5. Personalised Guidance */}
          <div
            className={`rounded-xl p-6 backdrop-blur-lg transition-all duration-300 ${
              isDarkMode ? 'border border-gray-600/20' : 'bg-white/40 border border-gray-200/30'
            }`}
            style={isDarkMode ? {
              backgroundColor: "#262626",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
            } : {
              backgroundColor: "rgba(255, 255, 255, 0.6)",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.1)",
            }}
          >
            <div className="flex items-center space-x-3 mb-6">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={isDarkMode ? {
                  backgroundColor: "#262626",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                } : {
                  backgroundColor: "rgba(255, 255, 255, 0.6)",
                  border: "1px solid rgba(0, 0, 0, 0.08)",
                }}
              >
                <BookOpen className="w-5 h-5" style={{ color: isDarkMode ? "#8AB4F8" : "#87A96B" }} />
              </div>
              <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                Personalized Guidance
              </h3>
            </div>

        {emotionalData.length === 0 ? (
          <div className="text-center py-8">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
              style={isDarkMode ? {
                backgroundColor: "#262626",
                border: "1px solid rgba(255, 255, 255, 0.08)",
              } : {
                backgroundColor: "rgba(255, 255, 255, 0.6)",
                border: "1px solid rgba(0, 0, 0, 0.08)",
              }}
            >
              <BookOpen className="w-6 h-6" style={{ color: isDarkMode ? "#8AB4F8" : "#87A96B" }} />
            </div>
            <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Guidance will appear here
            </p>
          </div>
        ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Data-Driven Personalized Guidance Tips */}
              {patternAnalysis && patternAnalysis.success && patternAnalysis.guidanceTips && patternAnalysis.guidanceTips.length > 0 ? (
                patternAnalysis.guidanceTips.map((tip, index) => (
                  <div
                    key={index}
                    onClick={() => setSelectedGuidanceTip(tip)}
                    className={`group p-5 rounded-xl transition-all duration-300 hover:scale-105 hover:shadow-lg cursor-pointer`}
                    style={isDarkMode ? {
                      backgroundColor: "rgba(138, 180, 248, 0.08)",
                      border: "1px solid rgba(138, 180, 248, 0.15)",
                      boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                    } : {
                      backgroundColor: "rgba(138, 180, 248, 0.08)",
                      border: "1px solid rgba(138, 180, 248, 0.15)",
                      boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                    }}
                  >
                    <div className="flex items-start space-x-4">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-300"
                        style={{
                          backgroundColor: "rgba(138, 180, 248, 0.2)",
                          boxShadow: "0 0 15px rgba(138, 180, 248, 0.3)",
                        }}
                      >
                        <span className="text-lg font-bold text-blue-400">
                          {index + 1}
                        </span>
                      </div>
                      
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className={`text-lg font-semibold group-hover:text-blue-300 transition-colors duration-300 ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                            {tip.title}
                          </h4>
                          <div className={`text-xs px-2 py-1 rounded-full ${isDarkMode ? 'bg-gray-700/50 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
                            {tip.category?.replace('_', ' ').toUpperCase()}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              ) : patternLoading ? (
                <>
                  {/* Loading State */}
                  <div className="flex items-center justify-center space-x-3 py-8">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center animate-pulse"
                      style={isDarkMode ? {
                        backgroundColor: "#262626",
                        border: "1px solid rgba(255, 255, 255, 0.08)",
                      } : {
                        backgroundColor: "rgba(255, 255, 255, 0.6)",
                        border: "1px solid rgba(0, 0, 0, 0.08)",
                      }}
                    >
                      <BookOpen className="w-4 h-4" style={{ color: isDarkMode ? "#8AB4F8" : "#87A96B" }} />
                    </div>
                    <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Analyzing your patterns to generate personalized tips...
                    </p>
                  </div>

                  {/* Loading Skeleton */}
                  <div className="grid grid-cols-1 gap-4 mb-6">
                    {[1, 2, 3].map((index) => (
                      <div
                        key={index}
                        className="p-5 rounded-xl animate-pulse"
                        style={isDarkMode ? {
                          backgroundColor: "rgba(138, 180, 248, 0.08)",
                          border: "1px solid rgba(138, 180, 248, 0.15)",
                        } : {
                          backgroundColor: "rgba(138, 180, 248, 0.08)",
                          border: "1px solid rgba(138, 180, 248, 0.15)",
                        }}
                      >
                        <div className="flex items-start space-x-4">
                          <div
                            className="w-10 h-10 rounded-full"
                            style={{
                              backgroundColor: "rgba(138, 180, 248, 0.2)",
                            }}
                          />
                          <div className="flex-1 space-y-3">
                            <div className="flex items-center justify-between">
                              <div className={`h-5 w-3/4 rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}></div>
                              <div className="flex space-x-2">
                                <div className={`h-6 w-16 rounded-full ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}></div>
                                <div className={`h-6 w-20 rounded-full ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}></div>
                              </div>
                            </div>
                            <div className={`h-4 w-full rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}></div>
                            <div className={`h-4 w-2/3 rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}></div>
                            <div className={`h-16 w-full rounded-lg ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}></div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  {/* Continue Chatting */}
                  <div
                    className="group p-4 sm:p-6 rounded-xl transition-all duration-300 cursor-pointer hover:scale-105"
                    style={isDarkMode ? {
                      backgroundColor: "rgba(138, 180, 248, 0.08)",
                      border: "1px solid rgba(138, 180, 248, 0.15)",
                    } : {
                      backgroundColor: "rgba(138, 180, 248, 0.08)",
                      border: "1px solid rgba(138, 180, 248, 0.15)",
                    }}
                    onClick={() => navigate('/chat')}
                  >
                    <div className="flex items-center space-x-3 mb-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-300"
                        style={{
                          backgroundColor: "#8AB4F8",
                        }}
                      >
                        <Sun className="w-4 h-4 text-white" />
                      </div>
                      <h4 className="font-semibold text-gray-100 group-hover:text-white transition-colors duration-300">
                        Continue Chatting
                      </h4>
                    </div>
                    <p className="text-sm text-gray-300 group-hover:text-gray-200 transition-colors duration-300 leading-relaxed">
                      Keep engaging with Deite to build more comprehensive emotional insights and patterns.
                    </p>
                  </div>

                  {/* Reflect Daily */}
                  <div
                    className="group p-4 sm:p-6 rounded-xl transition-all duration-300 cursor-pointer hover:scale-105"
                    style={isDarkMode ? {
                      backgroundColor: "rgba(253, 214, 99, 0.08)",
                      border: "1px solid rgba(253, 214, 99, 0.15)",
                    } : {
                      backgroundColor: "rgba(253, 214, 99, 0.08)",
                      border: "1px solid rgba(253, 214, 99, 0.15)",
                    }}
                    onClick={() => navigate('/chat')}
                  >
                    <div className="flex items-center space-x-3 mb-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-300"
                        style={{
                          backgroundColor: "#FDD663",
                        }}
                      >
                        <Star className="w-4 h-4 text-white" />
                      </div>
                      <h4 className="font-semibold text-gray-100 group-hover:text-white transition-colors duration-300">
                        Reflect Daily
                      </h4>
                    </div>
                    <p className="text-sm text-gray-300 group-hover:text-gray-200 transition-colors duration-300 leading-relaxed">
                      Regular conversations help create more accurate emotional tracking and better insights.
                    </p>
                  </div>

                  {/* Build Patterns */}
                  <div
                    className="group p-4 sm:p-6 rounded-xl transition-all duration-300 cursor-pointer hover:scale-105"
                    style={isDarkMode ? {
                      backgroundColor: "rgba(242, 139, 130, 0.08)",
                      border: "1px solid rgba(242, 139, 130, 0.15)",
                    } : {
                      backgroundColor: "rgba(242, 139, 130, 0.08)",
                      border: "1px solid rgba(242, 139, 130, 0.15)",
                    }}
                    onClick={() => navigate('/chat')}
                  >
                    <div className="flex items-center space-x-3 mb-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-300"
                        style={{
                          backgroundColor: "#F28B82",
                        }}
                      >
                        <Brain className="w-4 h-4 text-white" />
                      </div>
                      <h4 className="font-semibold text-gray-100 group-hover:text-white transition-colors duration-300">
                        Build Patterns
                      </h4>
                    </div>
                    <p className="text-sm text-gray-300 group-hover:text-gray-200 transition-colors duration-300 leading-relaxed">
                      Share more details about your experiences to unlock personalized insights.
                    </p>
                  </div>
                </>
              )}
            </div>
        )}
          </div>

    </div>
  );

  // Show loading screen during initialization
  if (isInitializing) {
    return (
      <ErrorBoundary>
        <div
          className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden"
          style={{
            background: isDarkMode
              ? "#131313"
              : "#FAFAF8",
          }}
        >
          <div className="flex flex-col items-center space-y-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center animate-pulse"
              style={isDarkMode ? {
                backgroundColor: "#262626",
                border: "1px solid rgba(255, 255, 255, 0.08)",
              } : {
                backgroundColor: "rgba(255, 255, 255, 0.6)",
                border: "1px solid rgba(0, 0, 0, 0.08)",
              }}
            >
              <Heart className="w-8 h-8" style={{ color: isDarkMode ? "#FDD663" : "#87A96B" }} />
            </div>
            <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Loading Emotional Wellbeing...
            </p>
          </div>
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <div
        className="min-h-screen flex flex-col relative overflow-hidden pb-20"
        style={{
          background: isDarkMode
            ? "#131313"
            : "#FAFAF8",
        }}
      >
      {/* Header - Mobile Optimized */}
      <div className={`sticky top-0 z-20 flex items-center justify-between pl-6 pr-8 py-5 border-b backdrop-blur-lg ${
        isDarkMode ? 'border-gray-600/20' : 'border-gray-200/50'
      }`}
        style={{
          backgroundColor: isDarkMode
            ? "rgba(19, 19, 19, 0.95)"
            : "rgba(250, 250, 248, 0.95)",
        }}
      >
        <div className="flex items-center space-x-2">
        </div>

        <div className="flex items-center space-x-3 flex-1 justify-center mx-4">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center ${
              isDarkMode ? 'backdrop-blur-md' : 'bg-white'
            }`}
            style={isDarkMode ? {
              backgroundColor: "#262626",
              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            } : {
              boxShadow: "0 2px 8px rgba(134, 169, 107, 0.15)",
            }}
          >
            <Heart className="w-5 h-5" style={{ color: isDarkMode ? "#FDD663" : "#87A96B" }} strokeWidth={1.5} />
          </div>
          <div className="flex items-center space-x-3">
            <div className="text-center px-2">
              <h1 className={`text-xl font-semibold whitespace-nowrap ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                Emotional Wellbeing
              </h1>
            </div>
            <button
              onClick={handleAIUpdate}
              disabled={isUpdating}
              className={`flex items-center space-x-2 px-3 py-2 rounded-xl transition-all duration-200 touch-manipulation ${
                isUpdating
                  ? 'bg-gray-200 dark:bg-gray-700 cursor-not-allowed'
                  : 'text-white shadow-lg hover:shadow-xl transform hover:scale-105'
              }`}
              style={isDarkMode ? {
                backgroundColor: isUpdating ? "" : "#262626",
                border: isUpdating ? "" : "1px solid rgba(255, 255, 255, 0.08)",
              } : {
                backgroundColor: isUpdating ? "" : "rgba(134, 169, 107, 0.95)",
              }}
            >
              <RefreshCw className={`w-4 h-4 ${(isUpdating || isLoadingFresh) ? 'animate-spin' : ''}`} />
              <span className="text-sm font-medium hidden xs:block">
                {isUpdating ? 'Updating...' : isLoadingFresh ? 'Refreshing...' : 'Refresh'}
              </span>
            </button>
          </div>
        </div>

      </div>

      {/* Content - Mobile Optimized */}
      <div className="flex-1 overflow-y-auto p-4 pb-6">
        {renderMoodSurvey()}
      </div>

      {/* Emotion Details Modal - Mobile Optimized */}
      {showDetailsModal && selectedDateDetails && emotionExplanations && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div
            className={`rounded-2xl p-4 max-w-sm w-full max-h-[85vh] overflow-y-auto ${
              isDarkMode ? 'bg-gray-800' : 'bg-white'
            }`}
            style={isDarkMode ? {
              backgroundColor: "#262626",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
            } : {
              boxShadow: "0 20px 60px rgba(0, 0, 0, 0.15)",
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-lg font-bold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                Emotion Details - {selectedDateDetails.day}
              </h3>
              <button
                onClick={() => setShowDetailsModal(false)}
                className={`w-8 h-8 rounded-full flex items-center justify-center touch-manipulation ${
                  isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
                }`}
              >
                <span className={`text-xl ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>×</span>
              </button>
            </div>

            <div className="space-y-3">
              {/* Happiness */}
              <div className="p-4 rounded-xl"
                style={isDarkMode ? {
                  backgroundColor: "rgba(129, 201, 149, 0.08)",
                  border: "1px solid rgba(129, 201, 149, 0.15)",
                } : {
                  backgroundColor: "rgba(129, 201, 149, 0.08)",
                  border: "1px solid rgba(129, 201, 149, 0.15)",
                }}>
                <div className="flex items-center space-x-3 mb-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: "#81C995" }}>
                    <Smile className="w-4 h-4 text-white" />
                  </div>
                  <h4 className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                    Happiness: {selectedDateDetails.happiness}%
                  </h4>
                </div>
                <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {emotionExplanations.happiness}
                </p>
              </div>

              {/* Energy */}
              <div className="p-4 rounded-xl"
                style={isDarkMode ? {
                  backgroundColor: "rgba(253, 214, 99, 0.08)",
                  border: "1px solid rgba(253, 214, 99, 0.15)",
                } : {
                  backgroundColor: "rgba(253, 214, 99, 0.08)",
                  border: "1px solid rgba(253, 214, 99, 0.15)",
                }}>
                <div className="flex items-center space-x-3 mb-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: "#FDD663" }}>
                    <Zap className="w-4 h-4 text-white" />
                  </div>
                  <h4 className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                    Energy: {selectedDateDetails.energy}%
                  </h4>
                </div>
                <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {emotionExplanations.energy}
                </p>
              </div>

              {/* Anxiety */}
              <div className="p-4 rounded-xl"
                style={isDarkMode ? {
                  backgroundColor: "rgba(138, 180, 248, 0.08)",
                  border: "1px solid rgba(138, 180, 248, 0.15)",
                } : {
                  backgroundColor: "rgba(138, 180, 248, 0.08)",
                  border: "1px solid rgba(138, 180, 248, 0.15)",
                }}>
                <div className="flex items-center space-x-3 mb-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: "#8AB4F8" }}>
                    <AlertTriangle className="w-4 h-4 text-white" />
                  </div>
                  <h4 className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                    Anxiety: {selectedDateDetails.anxiety}%
                  </h4>
                </div>
                <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {emotionExplanations.anxiety}
                </p>
              </div>

              {/* Stress */}
              <div className="p-4 rounded-xl"
                style={isDarkMode ? {
                  backgroundColor: "rgba(242, 139, 130, 0.08)",
                  border: "1px solid rgba(242, 139, 130, 0.15)",
                } : {
                  backgroundColor: "rgba(242, 139, 130, 0.08)",
                  border: "1px solid rgba(242, 139, 130, 0.15)",
                }}>
                <div className="flex items-center space-x-3 mb-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: "#F28B82" }}>
                    <Target className="w-4 h-4 text-white" />
                  </div>
                  <h4 className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                    Stress: {selectedDateDetails.stress}%
                  </h4>
                </div>
                <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {emotionExplanations.stress}
                </p>
              </div>
            </div>

            <div className="mt-6 text-center">
              <button
                onClick={() => setShowDetailsModal(false)}
                className="px-6 py-2 text-white rounded-full hover:opacity-90 transition-opacity"
                style={isDarkMode ? {
                  backgroundColor: "#262626",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                } : {
                  backgroundColor: "#262626",
                  border: "1px solid rgba(0, 0, 0, 0.08)",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Guidance Tip Detail Modal */}
      {selectedGuidanceTip && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div
            className={`rounded-2xl p-6 max-w-lg w-full max-h-[85vh] overflow-y-auto ${
              isDarkMode ? 'bg-gray-800' : 'bg-white'
            }`}
            style={isDarkMode ? {
              backgroundColor: "#262626",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
            } : {
              boxShadow: "0 20px 60px rgba(0, 0, 0, 0.15)",
            }}
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center"
                  style={{
                    backgroundColor: "rgba(138, 180, 248, 0.2)",
                    boxShadow: "0 0 15px rgba(138, 180, 248, 0.3)",
                  }}
                >
                  <Lightbulb className="w-5 h-5 text-blue-400" />
                </div>
                <h3 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                  {selectedGuidanceTip.title}
                </h3>
              </div>
              <button
                onClick={() => setSelectedGuidanceTip(null)}
                className={`w-8 h-8 rounded-full flex items-center justify-center touch-manipulation ${
                  isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
                }`}
              >
                <span className={`text-xl ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>×</span>
              </button>
            </div>

            <div className="mb-4">
              <div className={`inline-block text-xs px-3 py-1 rounded-full ${isDarkMode ? 'bg-gray-700/50 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
                {selectedGuidanceTip.category?.replace('_', ' ').toUpperCase()}
              </div>
            </div>

            <div className="mb-6">
              <p className={`text-base leading-relaxed ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {selectedGuidanceTip.description}
              </p>
            </div>

            <div className="text-center">
              <button
                onClick={() => setSelectedGuidanceTip(null)}
                className="px-6 py-2 text-white rounded-full hover:opacity-90 transition-opacity"
                style={isDarkMode ? {
                  backgroundColor: "#262626",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                } : {
                  backgroundColor: "#262626",
                  border: "1px solid rgba(0, 0, 0, 0.08)",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </ErrorBoundary>
  );
}
