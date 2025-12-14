import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { Users, User, Sun, Moon, ChevronRight, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
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
      if (!user) return;

      try {
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
      }
    };

    loadCrewMembers();
  }, [profilePicture]);

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
      alert('Please sign in to generate pod reflections');
      return;
    }

    try {
      console.log('🔄 Generating pod reflection...');
      setIsLoadingPodReflection(true);

      // Get pod messages from Firestore
      // Try different collection structures for pod messages
      let podMessages = [];
      
      // Try: users/{uid}/podChats/messages
      try {
        const podChatRef = collection(db, `users/${user.uid}/podChats/messages`);
        const podChatQuery = query(podChatRef, orderBy('createdAt', 'asc'), limit(100));
        const podChatSnapshot = await getDocs(podChatQuery);
        
        podChatSnapshot.forEach((doc) => {
          const data = doc.data();
          podMessages.push({
            sender: data.senderId === user.uid ? 'user' : (data.sender === 'AI' ? 'ai' : 'user'),
            text: data.message || data.text || '',
            timestamp: data.createdAt
          });
        });
      } catch (e) {
        console.log('No messages in podChats/messages collection');
      }

      // If no messages found in Firestore, use sample pod messages for demonstration
      // In a real implementation, these would come from Firestore
      if (podMessages.length === 0) {
        // Use sample messages that represent pod conversations
        podMessages = [
          { sender: 'user', text: 'Hey everyone! How are you all doing today?' },
          { sender: 'ai', text: 'Hello! I\'m here to support everyone in their wellness journey. How can I help today?' },
          { sender: 'user', text: 'I\'ve been practicing mindfulness this week and it\'s been amazing!' },
          { sender: 'user', text: 'That\'s awesome! I\'ve been struggling with stress lately. Any tips?' },
          { sender: 'ai', text: 'Great question! Deep breathing exercises and short breaks can help. Would you like me to guide you through a quick 5-minute stress relief exercise?' },
          { sender: 'user', text: 'I\'d love to join that too!' },
          { sender: 'user', text: 'Count me in! This pod is so supportive' }
        ];
      }

      console.log('📥 Found', podMessages.length, 'pod messages');

      if (podMessages.length === 0) {
        alert('No pod messages found. Start chatting in your pod to generate a reflection!');
        setIsLoadingPodReflection(false);
        return;
      }

      // Generate reflection using the reflection service
      console.log('🤖 Generating pod reflection via AI...');
      const generatedReflection = await reflectionService.generateReflection(podMessages);
      console.log('✅ Pod reflection generated:', generatedReflection);

      // Save pod reflection to Firestore using the service
      await firestoreService.savePodReflection(user.uid, generatedReflection);

      // Also save to localStorage as backup
      localStorage.setItem('pod_reflection', generatedReflection);

      // Update local state
      setPodReflection(generatedReflection);

      console.log('💾 Pod reflection saved!');
      alert('✅ Pod reflection generated successfully!');
    } catch (error) {
      console.error('❌ Error generating pod reflection:', error);
      alert('Failed to generate pod reflection: ' + error.message);
    } finally {
      setIsLoadingPodReflection(false);
    }
  };

  return (
    <div
      className="min-h-screen px-6 py-8 pb-20 relative overflow-hidden slide-up"
      style={{
        background: isDarkMode
          ? "#131313"
          : "#FAFAF8"
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
        {/* Title Section with Profile */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-3">
              <img
                src="/crew-icon.png"
                alt="Crew"
                className="w-16 h-16 object-contain"
                style={{
                  filter: isDarkMode ? 'brightness(0) invert(1)' : 'brightness(0)',
                  WebkitFilter: isDarkMode ? 'brightness(0) invert(1)' : 'brightness(0)'
                }}
              />
              <h1 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                Crew
              </h1>
            </div>
            <div className="flex space-x-2">
              <div
                onClick={toggleTheme}
                className={`w-10 h-10 rounded-full flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity ${
                  isDarkMode ? 'backdrop-blur-md' : 'bg-white'
                }`}
                style={isDarkMode ? {
                  backgroundColor: "#262626",
                  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                } : {
                  boxShadow: "0 2px 8px rgba(230, 179, 186, 0.15)",
                }}
              >
                {isDarkMode ?
                  <Sun className="w-5 h-5" style={{ color: "#8AB4F8" }} strokeWidth={1.5} /> :
                  <Moon className="w-5 h-5" style={{ color: "#E6B3BA" }} strokeWidth={1.5} />
                }
              </div>
              <div
                onClick={handleProfileClick}
                className={`w-10 h-10 rounded-full flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity overflow-hidden ${
                  isDarkMode ? 'backdrop-blur-md' : 'bg-white'
                }`}
                style={isDarkMode ? {
                  backgroundColor: profilePicture ? "transparent" : "#262626",
                  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
                  border: profilePicture ? "none" : "1px solid rgba(255, 255, 255, 0.08)",
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
                  <User className="w-5 h-5" style={{ color: isDarkMode ? "#81C995" : "#B19CD9" }} strokeWidth={1.5} />
                )}
              </div>
            </div>
          </div>
          <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Your personal wellness crew
          </p>
        </div>

        {/* Crew Content */}
        <div className="space-y-4">
          {/* Group Message Section */}
          <div
            onClick={() => navigate('/pod/chat')}
            className={`rounded-2xl p-5 relative overflow-hidden cursor-pointer transition-opacity hover:opacity-90 ${
              isDarkMode ? 'backdrop-blur-lg' : 'bg-white'
            }`}
            style={isDarkMode ? {
              backgroundColor: "#262626",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            } : {
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
            }}
          >
            {/* Title - Centered */}
            <div className="flex items-center justify-center mb-4">
              <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                Crew's Sphere
              </h2>
            </div>
            
            {/* Group Members - Centered */}
            <div className="flex items-center justify-center space-x-2 flex-wrap">
              {/* Current User */}
              {(() => {
                const user = getCurrentUser();
                const userName = user?.displayName || 'You';
                return (
                  <div
                    className="flex flex-col items-center"
                    title={userName}
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs mb-1 overflow-hidden"
                      style={{
                        backgroundColor: profilePicture ? "transparent" : (isDarkMode ? '#8AB4F8' + '30' : '#87A96B' + '20'),
                        border: profilePicture ? "none" : `2px solid ${isDarkMode ? '#8AB4F8' : '#87A96B'}40`,
                      }}
                    >
                      {profilePicture ? (
                        <img 
                          src={profilePicture} 
                          alt="You" 
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <User className="w-4 h-4" style={{ color: isDarkMode ? '#8AB4F8' : '#87A96B' }} />
                      )}
                    </div>
                    <span className={`text-[10px] ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      {userName}
                    </span>
                  </div>
                );
              })()}
              
              {/* Other Members */}
              {[
                ...crewMembers.map((member, index) => ({
                  name: member.displayName || member.name || 'User',
                  emoji: '👤',
                  color: ['#7DD3C0', '#FDD663', '#8AB4F8', '#E6B3BA', '#81C995'][index % 5],
                  profilePicture: member.profilePicture || null,
                  uid: member.uid
                })),
                { name: 'AI', emoji: '🤖', color: '#B19CD9', avatar: '/ai-avatar.png' },
              ].map((member, index) => (
                <div
                  key={index}
                  className="flex flex-col items-center"
                  title={member.name}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs mb-1 overflow-hidden"
                    style={{
                      backgroundColor: member.avatar ? "transparent" : (isDarkMode ? member.color + '30' : member.color + '20'),
                      border: member.avatar ? "none" : `2px solid ${member.color}40`,
                    }}
                  >
                    {member.avatar ? (
                      <img 
                        src={member.avatar} 
                        alt={member.name} 
                        className="w-full h-full object-cover"
                      />
                    ) : member.profilePicture ? (
                      <img 
                        src={member.profilePicture} 
                        alt={member.name} 
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span>{member.emoji}</span>
                    )}
                  </div>
                  <span className={`text-[10px] ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {member.name}
                  </span>
                </div>
              ))}
            </div>

          </div>

          {/* Pod Reflection Section - Dropdown Card */}
          <div
            onClick={() => navigate('/pod/all')}
            className={`rounded-2xl p-5 relative overflow-hidden cursor-pointer transition-all hover:opacity-90 ${
              isDarkMode ? 'backdrop-blur-lg' : 'bg-white'
            }`}
            style={isDarkMode ? {
              backgroundColor: "#262626",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            } : {
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
              borderTop: "3px solid #E6B3BA30",
            }}
          >
            {/* Main Heading: Crew's Reflection */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{
                    backgroundColor: isDarkMode ? "#FDD663" : "#E6B3BA",
                    boxShadow: isDarkMode ? "0 4px 16px rgba(0, 0, 0, 0.15)" : "none",
                  }}
                >
                  <Sparkles className="w-4 h-4" style={{ color: isDarkMode ? "#000" : "#fff" }} strokeWidth={2} />
                </div>
                <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>Crew's Reflection</h2>
              </div>
              <ChevronRight className={`w-5 h-5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
            </div>
            
            {/* Reflection Content */}
            {isLoadingPodReflection ? (
              <div className="flex flex-col items-center justify-center py-4">
                <div className="flex space-x-1 mb-3">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
                <p className={`text-sm text-center italic ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Generating crew reflection...</p>
              </div>
            ) : podReflection ? (
              <div
                onClick={() => navigate('/pod/reflections')}
                className="cursor-pointer transition-opacity hover:opacity-90"
              >
                <div className="flex items-start gap-3">
                  <ChevronRight className={`w-5 h-5 mt-0.5 flex-shrink-0 ${isDarkMode ? 'text-[#8AB4F8]' : 'text-[#87A96B]'}`} strokeWidth={2.5} />
                  <div className="flex-1">
                    <p className={`text-sm leading-relaxed ${isDarkMode ? 'text-gray-300' : 'text-gray-600'} line-clamp-3`}>
                      {podReflection}
                    </p>
                    <p className={`text-xs mt-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                      Tap to view all reflections →
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div
                onClick={() => navigate('/pod/reflections')}
                className="flex flex-col items-center justify-center py-4 cursor-pointer"
              >
                <div
                  className={`w-12 h-12 rounded-lg flex items-center justify-center mb-3 ${
                    isDarkMode ? 'backdrop-blur-md' : 'bg-white'
                  }`}
                  style={isDarkMode ? {
                    backgroundColor: "rgba(28, 31, 46, 0.5)",
                    boxShadow: "inset 0 0 20px rgba(125, 211, 192, 0.12), 0 8px 32px rgba(125, 211, 192, 0.08)",
                    border: "1px solid rgba(125, 211, 192, 0.18)",
                  } : {
                    boxShadow: "0 2px 6px rgba(0, 0, 0, 0.06)",
                  }}
                >
                  <span className="text-2xl">🌿</span>
                </div>
                <p className={`text-sm text-center italic ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  No reflection yet. Tap to view all reflections →
                </p>
              </div>
            )}
          </div>
        </div>
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

