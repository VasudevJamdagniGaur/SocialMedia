import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { User, Sun, Moon, ChevronRight, Sparkles } from 'lucide-react';
import { getCurrentUser } from '../services/authService';
import reflectionService from '../services/reflectionService';
import firestoreService from '../services/firestoreService';
import CalendarPopup from './CalendarPopup';
import { getDateId, formatDateForDisplay } from '../utils/dateUtils';

export default function PodPage() {
  const navigate = useNavigate();
  const { isDarkMode, toggleTheme } = useTheme();
  const [profilePicture, setProfilePicture] = useState(null);
  const [podReflection, setPodReflection] = useState('');
  const [isLoadingPodReflection, setIsLoadingPodReflection] = useState(false);
  const [isReflectionExpanded, setIsReflectionExpanded] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [podDays, setPodDays] = useState([]);
  const [crewMembers, setCrewMembers] = useState([]);
  const [isLoadingCrewMembers, setIsLoadingCrewMembers] = useState(true);
  const [crewActivityPosts, setCrewActivityPosts] = useState([]);
  const [isLoadingCrewActivity, setIsLoadingCrewActivity] = useState(false);
  const [followingIds, setFollowingIds] = useState([]);
  const [followLoadingUid, setFollowLoadingUid] = useState(null);

  // Load profile picture
  useEffect(() => {
    const loadProfilePicture = () => {
      const user = getCurrentUser();
      if (user) {
        const savedPicture = localStorage.getItem(`user_profile_picture_${user.uid}`);
        if (savedPicture) {
          setProfilePicture(savedPicture);
        } else {
          setProfilePicture(null);
        }
      }
    };

    loadProfilePicture();

    // Listen for storage changes and custom events (when profile picture is updated from ProfilePage)
    const handleStorageChange = (e) => {
      if (e.key && e.key.startsWith('user_profile_picture_')) {
        loadProfilePicture();
      }
    };

    const handleProfilePictureUpdate = () => {
      loadProfilePicture();
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('profilePictureUpdated', handleProfilePictureUpdate);
    
    // Also check on focus and visibility change (when returning from ProfilePage)
    const handleFocus = () => {
      loadProfilePicture();
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        loadProfilePicture();
      }
    };
    
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('profilePictureUpdated', handleProfilePictureUpdate);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Load pod days for calendar indicators
  useEffect(() => {
    const loadPodDays = async () => {
      const user = getCurrentUser();
      if (!user) return;

      try {
        const result = await firestoreService.getAllPods(user.uid);
        if (result.success) {
          // Extract dates from pods that have reflections
          const daysWithReflections = result.pods
            .filter(pod => pod.reflection && pod.startDate)
            .map(pod => ({
              date: pod.startDate,
              hasReflection: true
            }));
          setPodDays(daysWithReflections);
        }
      } catch (error) {
        console.error('Error loading pod days:', error);
      }
    };

    loadPodDays();
  }, []);

  // Load crew members from sphere
  useEffect(() => {
    const loadCrewMembers = async () => {
      const user = getCurrentUser();
      if (!user) {
        setIsLoadingCrewMembers(false);
        return;
      }

      try {
        setIsLoadingCrewMembers(true);
        
        // Run sync in background (don't wait for it)
        firestoreService.syncUserPodDocuments(user.uid).catch(err => {
          console.warn('Background sync failed:', err);
        });
        
        // Update user metadata in background
        firestoreService.updateUserMetadata(user.uid, {
          displayName: user.displayName || 'User',
          profilePicture: profilePicture,
          crewEnrolled: localStorage.getItem(`user_crew_enrolled_${user.uid}`) === 'true'
        }).catch(err => {
          console.warn('Metadata update failed:', err);
        });

        // Get user's crew sphere
        const sphereResult = await firestoreService.getUserCrewSphere(user.uid);
        
        if (sphereResult.success && sphereResult.sphereId && sphereResult.sphere) {
          // Get members from the sphere
          if (sphereResult.sphere.members && Array.isArray(sphereResult.sphere.members)) {
            const memberUids = sphereResult.sphere.members.filter(uid => uid !== user.uid);
            
            // Load all member details in parallel for faster loading
            const memberPromises = memberUids.map(async (memberUid) => {
              try {
                const memberResult = await firestoreService.getUser(memberUid);
                if (memberResult.success && memberResult.data) {
                  return {
                    uid: memberUid,
                    displayName: memberResult.data.displayName || 'User',
                    profilePicture: memberResult.data.profilePicture || null
                  };
                }
                return null;
              } catch (err) {
                console.error(`Error loading member ${memberUid}:`, err);
                return null;
              }
            });
            
            const members = (await Promise.all(memberPromises)).filter(m => m !== null);
            
            console.log('✅ Loaded crew members from sphere:', members.length);
            setCrewMembers(members);
          } else {
            setCrewMembers([]);
          }
        } else {
          // No sphere found, show empty
          console.log('ℹ️ No crew sphere found');
          setCrewMembers([]);
        }
      } catch (error) {
        console.error('Error loading crew members:', error);
        setCrewMembers([]);
      } finally {
        setIsLoadingCrewMembers(false);
      }
    };

    loadCrewMembers();
  }, [profilePicture]);

  // Load recent community posts from crew members (Crew's Activity)
  useEffect(() => {
    const user = getCurrentUser();
    if (!user) return;
    const authorIds = [user.uid, ...crewMembers.map((m) => m.uid)];
    if (authorIds.length === 0) {
      setCrewActivityPosts([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setIsLoadingCrewActivity(true);
      try {
        const result = await firestoreService.getCommunityPostsByAuthorIds(authorIds, 15);
        if (!cancelled && result.success && result.posts) {
          setCrewActivityPosts(result.posts);
        }
      } catch (err) {
        if (!cancelled) setCrewActivityPosts([]);
      } finally {
        if (!cancelled) setIsLoadingCrewActivity(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [crewMembers]);

  // Load pod reflection for selected date
  useEffect(() => {
    const loadPodReflection = async () => {
      const user = getCurrentUser();
      if (!user) return;

      try {
        const dateId = getDateId(selectedDate);
        setIsLoadingPodReflection(true);

        // Try to get pod for this date
        const podsResult = await firestoreService.getAllPods(user.uid);
        if (podsResult.success) {
          // Find pod that matches the selected date
          const podForDate = podsResult.pods.find(pod => pod.startDate === dateId);
          
          if (podForDate && podForDate.reflection) {
            setPodReflection(podForDate.reflection);
          } else {
            // If no pod found for this date, check if it's today and use current reflection
            const todayId = getDateId(new Date());
            if (dateId === todayId) {
              const result = await firestoreService.getPodReflection(user.uid);
              if (result.success && result.reflection) {
                setPodReflection(result.reflection);
              } else {
                const savedReflection = localStorage.getItem('pod_reflection');
                setPodReflection(savedReflection || '');
              }
            } else {
              setPodReflection('');
            }
          }
        } else {
          // Fallback to current reflection if today
          const todayId = getDateId(new Date());
          const dateId = getDateId(selectedDate);
          if (dateId === todayId) {
            const savedReflection = localStorage.getItem('pod_reflection');
            setPodReflection(savedReflection || '');
          } else {
            setPodReflection('');
          }
        }
      } catch (error) {
        console.error('Error loading pod reflection:', error);
        setPodReflection('');
      } finally {
        setIsLoadingPodReflection(false);
      }
    };

    loadPodReflection();
  }, [selectedDate]);

  // Load following list for Follow button in Crew's Activity
  useEffect(() => {
    const u = getCurrentUser();
    if (!u) return;
    firestoreService.getFollowing(u.uid).then((res) => {
      if (res.success && res.followingIds) setFollowingIds(res.followingIds);
    });
  }, []);

  const openUserProfile = (authorId) => {
    if (!authorId) return;
    const u = getCurrentUser();
    if (u && authorId === u.uid) navigate('/profile');
    else navigate(`/user/${authorId}`);
  };

  const handleFollowClick = async (e, authorId) => {
    e.stopPropagation();
    const u = getCurrentUser();
    if (!u || !authorId || authorId === u.uid) return;
    setFollowLoadingUid(authorId);
    try {
      const isFollowing = followingIds.includes(authorId);
      const result = isFollowing
        ? await firestoreService.unfollowUser(u.uid, authorId)
        : await firestoreService.followUser(u.uid, authorId);
      if (result.success && result.followingIds) setFollowingIds(result.followingIds);
    } catch (err) {
      console.error('Follow/unfollow error:', err);
    } finally {
      setFollowLoadingUid(null);
    }
  };

  const formatTimeAgo = (date) => {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    const now = new Date();
    const diff = now - d;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  const handleProfileClick = () => {
    navigate('/profile');
  };

  const handleCalendarClick = async () => {
    setIsCalendarOpen(true);
    // Refresh pod days when opening calendar
    const user = getCurrentUser();
    if (user) {
      try {
        const result = await firestoreService.getAllPods(user.uid);
        if (result.success) {
          const daysWithReflections = result.pods
            .filter(pod => pod.reflection && pod.startDate)
            .map(pod => ({
              date: pod.startDate,
              hasReflection: true
            }));
          setPodDays(daysWithReflections);
        }
      } catch (error) {
        console.error('Error refreshing pod days:', error);
      }
    }
  };

  const handleDateSelect = (date) => {
    setSelectedDate(date);
    setIsCalendarOpen(false);
  };


  const handleGeneratePodReflection = async () => {
    const user = getCurrentUser();
    if (!user) {
      alert('Please sign in to generate crew reflections');
      return;
    }

    try {
      console.log('🔄 Generating crew reflection...');
      setIsLoadingPodReflection(true);

      // Get user's crew sphere
      const sphereResult = await firestoreService.getUserCrewSphere(user.uid);
      
      if (!sphereResult.success || !sphereResult.sphereId) {
        alert('No crew sphere found. Create a crew sphere first!');
        setIsLoadingPodReflection(false);
        return;
      }

      // Get crew sphere messages from Firestore
      console.log('📥 Fetching crew sphere messages...');
      const messagesResult = await firestoreService.getCrewSphereMessages(sphereResult.sphereId);
      
      if (!messagesResult.success || !messagesResult.messages || messagesResult.messages.length === 0) {
        alert('No messages found in crew sphere. Start chatting in your crew sphere to generate a reflection!');
        setIsLoadingPodReflection(false);
        return;
      }

      console.log('📥 Found', messagesResult.messages.length, 'crew sphere messages');

      // Generate crew reflection using the reflection service
      console.log('🤖 Generating crew reflection via Google Gemini API...');
      const generatedReflection = await reflectionService.generateCrewReflection(messagesResult.messages);
      console.log('✅ Crew reflection generated:', generatedReflection);

      // Save crew reflection to Firestore using the service
      await firestoreService.savePodReflection(user.uid, generatedReflection);

      // Also save to localStorage as backup
      localStorage.setItem('pod_reflection', generatedReflection);

      // Update local state
      setPodReflection(generatedReflection);

      console.log('💾 Crew reflection saved!');
      alert('✅ Crew reflection generated successfully!');
    } catch (error) {
      console.error('❌ Error generating crew reflection:', error);
      alert('Failed to generate crew reflection: ' + error.message);
    } finally {
      setIsLoadingPodReflection(false);
    }
  };

  return (
    <div
      className="min-h-screen px-6 relative overflow-hidden slide-up"
      style={{
        background: isDarkMode
          ? "#131314"
          : "#B5C4AE",
        paddingTop: 'max(1.5rem, calc(env(safe-area-inset-top, 0px) + 1rem))',
        // Dedicated buffer: nav bar (56px) + breathing gap (24px) + safe-area so content never touches the bar
        paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))',
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
        {/* Title Section: theme left, Crew (beta) center, profile right - match dashboard */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            {/* Left: Day/night toggle - same as dashboard */}
            <div
              onClick={toggleTheme}
              className={`w-10 h-10 rounded-full flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity flex-shrink-0 ${
                isDarkMode ? 'backdrop-blur-md' : 'bg-white'
              }`}
              style={isDarkMode ? {
                backgroundColor: "#121212",
                boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
                border: "1px solid #1E1E1E",
              } : {
                boxShadow: "0 2px 8px rgba(230, 179, 186, 0.15)",
              }}
            >
              {isDarkMode ?
                <Moon className="w-5 h-5" style={{ color: "#A855F7" }} strokeWidth={1.5} /> :
                <Sun className="w-5 h-5" style={{ color: "#A855F7" }} strokeWidth={1.5} />
              }
            </div>
            {/* Center: Crew (beta) */}
            <div className="flex items-center justify-center flex-1 min-w-0 mx-2">
              <h1 className={`text-xl font-bold whitespace-nowrap ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                Crew <span className={`font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>(beta)</span>
              </h1>
            </div>
            {/* Right: Profile - same as dashboard */}
            <div
              onClick={handleProfileClick}
              className={`w-10 h-10 rounded-full flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity overflow-hidden flex-shrink-0 ${
                isDarkMode ? 'backdrop-blur-md' : 'bg-white'
              }`}
              style={isDarkMode ? {
                backgroundColor: profilePicture ? "transparent" : "#121212",
                boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
                border: profilePicture ? "none" : "1px solid #1E1E1E",
              } : {
                boxShadow: "0 2px 8px rgba(177, 156, 217, 0.15)",
              }}
            >
              {profilePicture ? (
                <img 
                  src={profilePicture} 
                  alt="Profile" 
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-5 h-5" style={{ color: "#A855F7" }} strokeWidth={1.5} />
              )}
            </div>
          </div>
          <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Your personal wellness crew
          </p>
        </div>

        {/* Shared theme for all Crew cards - same as Crew's Activity / Community */}
        {(() => {
          const HUB = {
            bg: '#0F0F0F',
            text: '#FFFFFF',
            textSecondary: '#A0A0A0',
            divider: '#1E1E1E',
            accent: '#A855F7',
            accentHighlight: '#C084FC',
            accentShadow: '#7E22CE',
          };
          const cardClass = 'rounded-2xl overflow-hidden';
          const cardStyle = { background: HUB.bg, border: `1px solid ${HUB.divider}` };
          const headerClass = 'flex items-center justify-between px-4 py-4';
          const headerBorder = { borderBottom: `1px solid ${HUB.divider}` };

          return (
        <>
        {/* Categories */}
        <div className="space-y-4 px-1">
          <div className={cardClass} style={cardStyle}>
            <div className={headerClass} style={headerBorder}>
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: HUB.accent + '30' }}>
                  <Sparkles className="w-4 h-4" style={{ color: HUB.accent }} strokeWidth={2} />
                </div>
                <h2 className="text-lg font-semibold" style={{ color: HUB.text }}>Categories</h2>
              </div>
            </div>
            <div className="px-4 py-3">
              {['Sports', 'AI & Tech', 'Entrepreneurship', 'Current Affairs'].map((category, index) => (
                <div
                  key={category}
                  onClick={() => {
                    if (category === 'Sports') {
                      navigate('/pod/sports');
                    } else if (category === 'AI & Tech') {
                      navigate('/pod/ai-tech');
                    }
                  }}
                  className="flex items-center justify-between py-3 cursor-pointer transition-opacity hover:opacity-90"
                  style={{
                    borderTop: index === 0 ? 'none' : `1px solid ${HUB.divider}`,
                    color: HUB.text,
                  }}
                >
                  <span className="text-[15px] font-medium">{category}</span>
                  <ChevronRight className="w-5 h-5" style={{ color: HUB.textSecondary }} />
                </div>
              ))}
            </div>
          </div>
        </div>
        </>
          );
        })()}
      </div>

      {/* Calendar Popup */}
      <CalendarPopup
        isOpen={isCalendarOpen}
        onClose={() => setIsCalendarOpen(false)}
        selectedDate={selectedDate}
        onDateSelect={handleDateSelect}
        chatDays={podDays}
      />
    </div>
  );
}

