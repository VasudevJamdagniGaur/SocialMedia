import React, { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from 'react-router-dom';
import { Brain, Send, ArrowLeft, User, AlertTriangle, Image as ImageIcon, X, Eye } from "lucide-react";
import { useTheme } from '../contexts/ThemeContext';
import chatService from '../services/chatService';
import reflectionService from '../services/reflectionService';
import emotionalAnalysisService from '../services/emotionalAnalysisService';
import firestoreService from '../services/firestoreService';
import { getCurrentUser } from '../services/authService';
import { getDateId } from '../utils/dateUtils';
import { Capacitor } from '@capacitor/core';

export default function ChatPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isDarkMode } = useTheme();
  
  // Fix: Use getDateId directly with the date object or current date
  const selectedDate = location.state?.selectedDate ? new Date(location.state.selectedDate) : new Date();
  const selectedDateId = getDateId(selectedDate);
  const isWhisperMode = location.state?.isWhisperMode || false;
  const isFreshSession = location.state?.isFreshSession || false;
  
  console.log('📅 CHAT: Selected date:', selectedDate);
  console.log('📅 CHAT: Date ID for saving:', selectedDateId);
  console.log('🤫 CHAT: Whisper mode:', isWhisperMode);
  console.log('🆕 CHAT: Fresh session:', isFreshSession);
  
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showDeleteWarning, setShowDeleteWarning] = useState(false);
  const [profilePicture, setProfilePicture] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const messagesEndRef = useRef(null);
  
  // Debug: Log when imagePreview changes
  useEffect(() => {
    console.log('📸 imagePreview state changed:', !!imagePreview, imagePreview ? `Length: ${imagePreview.length}` : 'null');
  }, [imagePreview]);
  
  // Debug: Log when selectedImage changes
  useEffect(() => {
    console.log('📸 selectedImage state changed:', !!selectedImage, selectedImage ? `Name: ${selectedImage.name}, Size: ${selectedImage.size}` : 'null');
  }, [selectedImage]);
  const inputRef = useRef(null);
  const handleBackRef = useRef(null);
  const fileInputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

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

    // Listen for profile picture updates
    const handleProfilePictureUpdate = () => {
      loadProfilePicture();
    };

    window.addEventListener('profilePictureUpdated', handleProfilePictureUpdate);

    return () => {
      window.removeEventListener('profilePictureUpdated', handleProfilePictureUpdate);
    };
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Cleanup effect to ensure input is always enabled
  useEffect(() => {
    const cleanup = () => {
      setIsLoading(false);
      if (inputRef.current) {
        inputRef.current.focus();
      }
    };

    // Cleanup on component unmount
    return cleanup;
  }, []);

  // Safety effect to ensure loading state doesn't get stuck
  useEffect(() => {
    if (isLoading) {
      const safetyTimeout = setTimeout(() => {
        console.log('🔄 SAFETY: Force-disabling loading state after 30 seconds');
        setIsLoading(false);
      }, 30000); // 30 second safety timeout

      return () => clearTimeout(safetyTimeout);
    }
  }, [isLoading]);

  const saveMessages = (newMessages) => {
    localStorage.setItem(`chatMessages_${selectedDateId}`, JSON.stringify(newMessages));
  };

  const checkAndGenerateEmotionalAnalysis = async (uid, dateId, messages) => {
    try {
      console.log('🔍 AUTO-ANALYSIS: Checking emotional data for date:', dateId);
      
      // Filter out welcome messages first
      const realMessages = messages.filter(m => m.id !== 'welcome' && m.text && m.text.length > 0);
      
      if (realMessages.length < 2) {
        console.log('⚠️ AUTO-ANALYSIS: Not enough messages (need at least 2), skipping');
        return;
      }
      
      console.log('🔍 AUTO-ANALYSIS: Found', realMessages.length, 'real messages');
      
      // Check existing mood data
      const moodRef = await firestoreService.getMoodChartDataNew(uid, 1);
      
      let shouldGenerate = false;
      
      if (!moodRef.success || !moodRef.moodData || moodRef.moodData.length === 0) {
        console.log('🔄 AUTO-ANALYSIS: No mood data found, will generate');
        shouldGenerate = true;
      } else {
        const todayMood = moodRef.moodData[0];
        console.log('🔍 AUTO-ANALYSIS: Current mood data:', todayMood);
        
        const total = (todayMood.happiness || 0) + (todayMood.energy || 0) + 
                     (todayMood.anxiety || 0) + (todayMood.stress || 0);
        
        // Check for default/invalid values
        const isDefaultPattern = (todayMood.happiness === 50 && todayMood.energy === 50 && 
                                  todayMood.anxiety === 25 && todayMood.stress === 25);
        const isEmptyOrInvalid = total === 0 || total === 100 || isDefaultPattern;
        const isWrongDate = todayMood.date !== dateId;
        
        console.log('🔍 AUTO-ANALYSIS: Total:', total, 'IsDefault:', isDefaultPattern, 
                    'IsEmpty:', isEmptyOrInvalid, 'WrongDate:', isWrongDate);
        
        if (isEmptyOrInvalid || isWrongDate) {
          console.log('🔄 AUTO-ANALYSIS: Invalid/default data detected, will regenerate');
          shouldGenerate = true;
        } else {
          console.log('✅ AUTO-ANALYSIS: Valid data exists, skipping generation');
        }
      }
      
      if (shouldGenerate) {
        console.log('🚀 AUTO-ANALYSIS: Starting emotional analysis...');
        await generateAndSaveEmotionalAnalysis(uid, dateId, realMessages);
        console.log('✅ AUTO-ANALYSIS: Complete! Mood data updated.');
      }
    } catch (error) {
      console.error('❌ AUTO-ANALYSIS: Error:', error);
    }
  };

  const generateAndSaveEmotionalAnalysis = async (uid, dateId, messages) => {
    try {
      // Filter out welcome message, whisper session messages, and ensure we have real conversation
      const realMessages = messages.filter(m => 
        m.id !== 'welcome' && 
        m.text && 
        m.text.length > 0 && 
        !m.isWhisperSession
      );
      
      if (realMessages.length < 2) {
        console.log('⚠️ Not enough non-whisper messages for emotional analysis');
        return;
      }
      
      console.log('🧠 Generating emotional analysis for', realMessages.length, 'non-whisper messages...');
      const emotionalScores = await emotionalAnalysisService.analyzeEmotionalScores(realMessages);
      console.log('✅ Generated emotional scores:', emotionalScores);
      
      // Save to Firestore
      await firestoreService.saveMoodChartNew(uid, dateId, emotionalScores);
      console.log('💾 Emotional scores saved to Firestore');
      
      // Also save emotional balance
      const total = emotionalScores.happiness + emotionalScores.energy + emotionalScores.stress + emotionalScores.anxiety;
      let positive = ((emotionalScores.happiness + emotionalScores.energy) / total) * 100;
      let negative = ((emotionalScores.stress + emotionalScores.anxiety) / total) * 100;
      let neutral = 100 - positive - negative;
      
      // Ensure all values are between 0 and 100 (clamp to prevent negative values)
      positive = Math.max(0, Math.min(100, Math.round(positive)));
      negative = Math.max(0, Math.min(100, Math.round(negative)));
      neutral = Math.max(0, Math.min(100, Math.round(neutral)));
      
      await firestoreService.saveEmotionalBalanceNew(uid, dateId, {
        positive: positive,
        negative: negative,
        neutral: neutral
      });
      console.log('💾 Emotional balance saved to Firestore');
      
      // CRITICAL: Clear the dashboard cache so new data shows immediately
      console.log('🗑️ Clearing dashboard cache to show fresh data...');
      const cacheKeys = Object.keys(localStorage).filter(key =>
        key.includes('emotional_wellbeing') || key.includes('moodChart') || key.includes('emotionalBalance')
      );
      cacheKeys.forEach(key => {
        localStorage.removeItem(key);
        console.log('🗑️ Removed cache:', key);
      });

      // Set a timestamp to force UI refresh
      const refreshTimestamp = Date.now();
      localStorage.setItem('emotional_data_refresh', refreshTimestamp.toString());
      console.log('✅ Set refresh timestamp:', refreshTimestamp);

      // Also dispatch a custom event that the dashboard can listen for
      window.dispatchEvent(new CustomEvent('emotionalDataUpdated', {
        detail: { timestamp: refreshTimestamp, dateId: dateId, scores: emotionalScores }
      }));

      // CRITICAL: Force immediate UI update by setting data directly in localStorage with current timestamp
      console.log('🔥 FORCE UI UPDATE: Setting fresh mood data directly...');
      const freshMoodData = [{
        date: dateId,
        day: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        happiness: emotionalScores.happiness,
        anxiety: emotionalScores.anxiety,
        stress: emotionalScores.stress,
        energy: emotionalScores.energy
      }];

      // Override cache with fresh data
      const cacheKey = `emotional_wellbeing_emotional_7_${uid}`;
      localStorage.setItem(cacheKey, JSON.stringify({
        weeklyMoodData: freshMoodData,
        emotionalData: freshMoodData,
        timestamp: new Date().toISOString()
      }));

      console.log('✅ Fresh mood data set in cache:', freshMoodData);

      // Set a global flag to force fresh data loading for the next 5 minutes
      localStorage.setItem('force_fresh_data_until', (Date.now() + 5 * 60 * 1000).toString());
      console.log('🚨 Set force fresh data flag for 5 minutes');

      // Also trigger a page refresh for the dashboard if it's currently open
      if (window.location.hash.includes('emotional-wellbeing') || window.location.pathname.includes('emotional-wellbeing')) {
        console.log('🔄 Dashboard is currently open, forcing refresh...');
        // Force a hard refresh after a short delay
        setTimeout(() => {
          window.location.reload();
        }, 500);
      }

      // Force immediate update of any open dashboard windows/tabs
      console.log('🔥 FORCE UPDATE: Triggering immediate dashboard update...');
      setTimeout(() => {
        // Try to call the dashboard's force update function if it exists
        if (window.forceDashboardUpdate) {
          window.forceDashboardUpdate();
        }
      }, 1000);
      
    } catch (error) {
      console.error('❌ Error generating emotional analysis:', error);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    
    console.log('🎯 CHAT PAGE DEBUG: handleSendMessage called');
    console.log('🎯 CHAT PAGE DEBUG: inputMessage:', inputMessage);
    console.log('🎯 CHAT PAGE DEBUG: isLoading:', isLoading);
    
    // Force reset loading state if it seems stuck
    if (isLoading) {
      console.log('🔄 CHAT DEBUG: Loading state detected, checking if stuck...');
      const currentTime = Date.now();
      const lastLoadingTime = window.lastLoadingTime || 0;
      
      if (currentTime - lastLoadingTime > 10000) { // If loading for more than 10 seconds
        console.log('🔄 CHAT DEBUG: Loading state appears stuck, force-resetting...');
        setIsLoading(false);
        return;
      }
    }
    
    if ((!inputMessage.trim() && !selectedImage) || isLoading) {
      console.log('🎯 CHAT PAGE DEBUG: Returning early - empty message/image or loading');
      return;
    }

    const userMessageText = inputMessage.trim() || 'Check this out!';
    
    // Check for "day reflect" command
    const isDayReflectCommand = /^(day reflect|\/day reflect|dayreflect)$/i.test(userMessageText);
    
    if (isDayReflectCommand) {
      // Handle day reflect command - generate narrative diary story
      console.log('📖 DAY REFLECT COMMAND: Generating narrative diary story...');
      
      const userMessage = {
        id: Date.now(),
        text: userMessageText,
        sender: 'user',
        timestamp: new Date(),
        isWhisperSession: isWhisperMode
      };

      // Add user message immediately
      const newMessages = [...messages, userMessage];
      setMessages(newMessages);
      setInputMessage('');
      setIsLoading(true);
      window.lastLoadingTime = Date.now();

      try {
        // Generate narrative diary story from current conversation (before the command)
        // Use existing messages, not including the command itself
        const narrativeStory = await reflectionService.generateNarrativeDiaryStory(messages);
        
        // Create AI message with the narrative story
        const aiMessage = {
          id: Date.now() + 1,
          text: narrativeStory,
          sender: 'ai',
          timestamp: new Date(),
          isWhisperSession: isWhisperMode
        };

        const finalMessages = [...newMessages, aiMessage];
        setMessages(finalMessages);
        saveMessages(finalMessages);

        // Save AI message to Firestore
        const user = getCurrentUser();
        if (user) {
          try {
            await firestoreService.saveChatMessageNew(user.uid, selectedDateId, {
              ...aiMessage,
              isWhisperSession: isWhisperMode
            });
            console.log('💾 Day reflect narrative story saved to Firestore');
          } catch (error) {
            console.error('❌ Error saving day reflect story to Firestore:', error);
          }
        }

        setIsLoading(false);
        window.lastLoadingTime = 0;
        
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus();
          }
        }, 100);
        
        return; // Exit early, don't process as normal message
      } catch (error) {
        console.error('❌ Error generating day reflect narrative:', error);
        
        // Show error message
        const errorMessage = {
          id: Date.now() + 1,
          text: "I'm sorry, I'm having trouble generating your day reflection right now. Please try again in a moment.",
          sender: 'ai',
          timestamp: new Date(),
          isWhisperSession: isWhisperMode
        };
        
        const finalMessages = [...newMessages, errorMessage];
        setMessages(finalMessages);
        saveMessages(finalMessages);
        
        setIsLoading(false);
        window.lastLoadingTime = 0;
        
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus();
          }
        }, 100);
        
        return; // Exit early
      }
    }

    const userMessage = {
      id: Date.now(),
      text: userMessageText,
      sender: 'user',
      timestamp: new Date(),
      isWhisperSession: isWhisperMode, // Ensure flag is set in state
      image: selectedImage ? imagePreview : null // Include image preview in message
    };

    console.log('🎯 CHAT PAGE DEBUG: Created user message:', userMessage);
    console.log('📸 CHAT PAGE DEBUG: Has image:', !!selectedImage);

    // Check if message contains Instagram reel link
    const isInstagramReel = /instagram\.com\/(reel|p|tv)\//i.test(userMessageText);
    
    // Add user message immediately
    const newMessages = [...messages, userMessage];
    
    // If it's an Instagram reel, add a loading message
    if (isInstagramReel) {
      const loadingMessage = {
        id: 'instagram-loading-' + Date.now(),
        text: '👀 Deite is enjoying the reel',
        sender: 'ai',
        timestamp: new Date(),
        isProcessingReel: true, // Special flag for Instagram reel processing
        isWhisperSession: isWhisperMode
      };
      newMessages.push(loadingMessage);
    }
    
    setMessages(newMessages);
    setInputMessage('');
    
    // Clear image selection
    const imageToSend = selectedImage;
    setSelectedImage(null);
    setImagePreview(null);
    
    setIsLoading(true);
    window.lastLoadingTime = Date.now(); // Track when loading started
    
    console.log('🔄 CHAT DEBUG: Set isLoading to true, input should be disabled now');

    // Save user message to Firestore immediately
    const user = getCurrentUser();
    if (user) {
      try {
        const saveResult = await firestoreService.saveChatMessageNew(user.uid, selectedDateId, {
          ...userMessage,
          isWhisperSession: isWhisperMode
        });
        console.log('💾 User message saved to Firestore');
        
        // Update message ID to match Firestore ID for proper image matching
        if (saveResult.success && saveResult.messageId) {
          userMessage.id = saveResult.messageId;
          // Update the message in the messages array with the Firestore ID
          const updatedMessages = [...newMessages];
          const messageIndex = updatedMessages.findIndex(msg => msg.id === userMessage.id || (msg.text === userMessage.text && msg.sender === 'user'));
          if (messageIndex !== -1) {
            updatedMessages[messageIndex] = { ...updatedMessages[messageIndex], id: saveResult.messageId };
            setMessages(updatedMessages);
            saveMessages(updatedMessages);
          }
        }
      } catch (error) {
        console.error('❌ Error saving user message to Firestore:', error);
      }
    }

    console.log('🎯 CHAT PAGE DEBUG: About to call chatService.sendMessage...');

    try {
      console.log('🚀 CHAT PAGE DEBUG: Sending message to AI...');
      console.log('🚀 CHAT PAGE DEBUG: Message text:', userMessageText);
      console.log('🚀 CHAT PAGE DEBUG: Conversation history length:', messages.length);
      console.log('📸 CHAT PAGE DEBUG: Sending image file:', !!imageToSend);
      
      // Remove Instagram loading message if it exists
      let currentMessages = newMessages.filter(msg => !msg.isProcessingReel);
      
      // Create AI message placeholder for streaming
      const aiMessage = {
        id: Date.now() + 1,
        text: '',
        sender: 'ai',
        timestamp: new Date(),
        isStreaming: true,
        isWhisperSession: isWhisperMode // Ensure flag is set in state
      };

      currentMessages = [...currentMessages, aiMessage];
      setMessages(currentMessages);

      let fullResponse = '';
      let typewriterQueue = [];
      let isTyping = false;

      // Typewriter effect function
      const typewriterEffect = () => {
        if (isTyping || typewriterQueue.length === 0) return;
        
        isTyping = true;
        const processQueue = () => {
          if (typewriterQueue.length === 0) {
            isTyping = false;
            return;
          }
          
          const token = typewriterQueue.shift();
          fullResponse += token;
          
          // Update the message with current text
          setMessages(prevMessages => {
            const updated = [...prevMessages];
            const aiMsgIndex = updated.findIndex(msg => msg.id === aiMessage.id);
            if (aiMsgIndex !== -1) {
              updated[aiMsgIndex] = {
                ...updated[aiMsgIndex],
                text: fullResponse
              };
            }
            return updated;
          });
          
          // Continue with next token with minimal delay for smooth typewriter effect
          setTimeout(processQueue, Math.random() * 20 + 10); // 10-30ms delay (faster!)
        };
        
        processQueue();
      };

      // Token callback for streaming - IMMEDIATE processing
      const onToken = (token) => {
        console.log('📝 TYPEWRITER DEBUG: IMMEDIATE token received:', token);
        
        // Add token to queue immediately
        typewriterQueue.push(token);
        
        // Start typewriter effect IMMEDIATELY if not already running
        if (!isTyping) {
          console.log('📝 TYPEWRITER DEBUG: Starting IMMEDIATE typewriter effect');
          typewriterEffect();
        }
      };
      
      // Call the chat service with streaming enabled
      const aiResponse = await chatService.sendMessage(userMessageText, messages, onToken, imageToSend, null);
      
      console.log('✅ CHAT PAGE DEBUG: Received final AI response:', aiResponse);
      
      // Validate response
      if (!aiResponse || typeof aiResponse !== 'string') {
        throw new Error('Invalid AI response format');
      }

      // Wait for typewriter effect to finish with timeout
      const waitForTypewriter = () => {
        return new Promise((resolve) => {
          let timeoutCount = 0;
          const maxTimeouts = 50; // 5 seconds max wait
          
          const checkQueue = () => {
            if (typewriterQueue.length === 0 && !isTyping) {
              resolve();
            } else if (timeoutCount >= maxTimeouts) {
              console.log('⚠️ Typewriter timeout - proceeding anyway');
              resolve();
            } else {
              timeoutCount++;
              setTimeout(checkQueue, 100);
            }
          };
          checkQueue();
        });
      };

      await waitForTypewriter();

      // Build final messages deterministically (avoid relying on async state callback)
      const finalMessagesLocal = (() => {
        const updated = [...currentMessages];
        const aiMsgIndex = updated.findIndex(msg => msg.id === aiMessage.id);
        if (aiMsgIndex !== -1) {
          updated[aiMsgIndex] = {
            ...updated[aiMsgIndex],
            text: fullResponse || aiResponse, // Use fullResponse if available, otherwise aiResponse
            isStreaming: false
          };
        }
        return updated;
      })();

      // Update state and storage
      setMessages(finalMessagesLocal);
      saveMessages(finalMessagesLocal);

      // IMPORTANT: Enable input field immediately after AI response is shown
      // Reflection and emotional analysis will run in background without blocking
      console.log('🔄 CHAT DEBUG: AI response complete - enabling input field immediately');
      setIsLoading(false);
      window.lastLoadingTime = 0; // Reset loading timer
      
      // Focus input field immediately
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 100);

      // Save AI message to Firestore NEW structure (in background)
      const user = getCurrentUser();
      if (user && finalMessagesLocal.length > 0) {
        // Run in background - don't await
        (async () => {
        try {
          const aiMessage = finalMessagesLocal[finalMessagesLocal.length - 1];
          if (aiMessage.sender === 'ai') {
            const saveResult = await firestoreService.saveChatMessageNew(user.uid, selectedDateId, {
              ...aiMessage,
              isWhisperSession: isWhisperMode
            });
            console.log('💾 AI message saved to Firestore NEW structure');
            
            // Update message ID to match Firestore ID for proper persistence
            if (saveResult.success && saveResult.messageId) {
              // Update in state and localStorage with Firestore ID
              setMessages(prevMessages => {
                const updated = prevMessages.map(msg => 
                  msg.id === aiMessage.id ? { ...msg, id: saveResult.messageId } : msg
                );
                saveMessages(updated);
                return updated;
              });
            }
          }
        } catch (error) {
          console.error('❌ Error saving AI message to Firestore:', error);
        }
        })();
      }

      // Generate and save reflection after the conversation (skip for whisper sessions)
      // Run in background - don't block user input
      if (!isWhisperMode) {
        // Run reflection generation asynchronously - don't await
        (async () => {
        try {
            console.log('📝 Generating reflection (background)...');
          console.log('🔍 CHAT DEBUG: finalMessagesLocal type:', typeof finalMessagesLocal, 'length:', finalMessagesLocal?.length);
          
          // Ensure we have a valid messages array
          const messagesToProcess = Array.isArray(finalMessagesLocal) ? finalMessagesLocal : [];
          console.log('🔍 CHAT DEBUG: Using messages array with length:', messagesToProcess.length);
          
          // Generate AI reflection using RunPod llama3:70b
          let reflection;
          try {
            console.log('🤖 Generating AI reflection using RunPod llama3:70b...');
            reflection = await reflectionService.generateReflection(messagesToProcess);
            console.log('✅ AI Reflection generated via RunPod:', reflection);
          } catch (apiError) {
            console.log('⚠️ AI reflection failed:', apiError.message);
              return; // Don't save if generation failed
          }
          
          const user = getCurrentUser();
          if (user) {
            // Save to NEW Firestore structure
            await firestoreService.saveReflectionNew(user.uid, selectedDateId, {
              summary: reflection,
              mood: 'neutral',
              score: 50,
              insights: []
            });
            console.log('💾 Reflection saved to Firestore NEW structure');
          } else {
            localStorage.setItem(`reflection_${selectedDateId}`, reflection);
            console.log('💾 Reflection saved to localStorage');
          }
        } catch (reflectionError) {
            console.error('❌ Error generating reflection (background):', reflectionError);
            // Don't save fallback - let it fail silently in background
          }
        })();
      } else {
        console.log('🤫 WHISPER SESSION: Skipping reflection generation');
      }

      // Generate and save emotional analysis after the conversation (skip for whisper sessions)
      // Run in background - don't block user input
      if (!isWhisperMode) {
        // Run emotional analysis asynchronously - don't await
        (async () => {
        try {
            console.log('🧠 Generating emotional analysis (background)...');
          console.log('🔍 CHAT DEBUG: finalMessagesLocal type:', typeof finalMessagesLocal, 'length:', finalMessagesLocal?.length);
          
          // Ensure we have a valid messages array and filter out whisper session messages
          const messagesToProcess = Array.isArray(finalMessagesLocal) ? 
            finalMessagesLocal.filter(m => !m.isWhisperSession) : [];
          console.log('🔍 CHAT DEBUG: Using non-whisper messages array with length:', messagesToProcess.length);
          
          console.log('🤖 FORCING AI emotional analysis with RunPod...');
          console.log('🤖 Messages to analyze:', messagesToProcess.map(m => `${m.sender}: ${m.text.slice(0, 50)}...`));
          
          try {
            const emotionalScores = await emotionalAnalysisService.analyzeEmotionalScores(messagesToProcess);
            console.log('✅ AI Emotional analysis generated:', emotionalScores);
            console.log('🎯 Scores breakdown - H:', emotionalScores.happiness, 'E:', emotionalScores.energy, 'A:', emotionalScores.anxiety, 'S:', emotionalScores.stress);
            
            // Check if scores are all zeros
            const total = (emotionalScores.happiness || 0) + (emotionalScores.energy || 0) + (emotionalScores.anxiety || 0) + (emotionalScores.stress || 0);
            if (total === 0) {
              console.error('❌ CRITICAL: Emotional analysis returned ALL ZEROS - API likely failed');
              console.error('❌ CRITICAL: This means the RunPod AI server did not generate valid scores');
              console.error('❌ CRITICAL: Check browser console for "All models failed" error above');
            }
            
            const user = getCurrentUser();
            if (user) {
              // Save to NEW Firestore structure - moodChart
              console.log('💾 SAVING AI SCORES TO FIREBASE:', emotionalScores);
              console.log('💾 User ID:', user.uid, 'Date ID:', selectedDateId);
              console.log('💾 Firestore path will be: users/' + user.uid + '/days/' + selectedDateId + '/moodChart/daily');
              
              try {
                const saveResult = await firestoreService.saveMoodChartNew(user.uid, selectedDateId, emotionalScores);
                console.log('💾 ✅ AI Mood chart saved to Firestore - Result:', saveResult);
                if (!saveResult.success) {
                  console.error('❌ CRITICAL: Save failed:', saveResult.error);
                }
              } catch (saveError) {
                console.error('❌ Error saving mood chart:', saveError);
                console.error('❌ CRITICAL: Save error details:', saveError.message, saveError.code);
              }
              
              // Also calculate and save emotional balance
              try {
                const total = emotionalScores.happiness + emotionalScores.energy + emotionalScores.stress + emotionalScores.anxiety;
                const positive = ((emotionalScores.happiness + emotionalScores.energy) / total) * 100;
                const negative = ((emotionalScores.stress + emotionalScores.anxiety) / total) * 100;
                const neutral = 100 - positive - negative;
                
                await firestoreService.saveEmotionalBalanceNew(user.uid, selectedDateId, {
                  positive: Math.round(positive),
                  negative: Math.round(negative),
                  neutral: Math.round(neutral)
                });
                console.log('💾 AI Emotional balance saved to Firestore NEW structure');
              } catch (balanceError) {
                console.error('❌ Error saving emotional balance:', balanceError);
              }
            } else {
              // Fallback for anonymous users
              try {
                const userId = 'anonymous';
                await emotionalAnalysisService.saveEmotionalData(userId, selectedDateId, emotionalScores);
                console.log('💾 Emotional data saved (anonymous)');
              } catch (anonError) {
                console.error('❌ Error saving anonymous emotional data:', anonError);
              }
            }
          } catch (analysisError) {
              console.error('❌ Error in emotional analysis (background):', analysisError);
          }
        } catch (emotionalError) {
            console.error('❌ Error in emotional analysis section (background):', emotionalError);
        }
        })();
      } else {
        console.log('🤫 WHISPER SESSION: Skipping emotional analysis generation');
      }

    } catch (error) {
      console.error('❌ Error sending message:', error);
      console.error('❌ Error details:', error.message);
      console.error('❌ Error stack:', error.stack);
      
      // Add error message with more details in console
      const errorMessage = {
        id: Date.now() + 1,
        text: "I'm sorry, I'm having trouble responding right now. Please try again in a moment.",
        sender: 'ai',
        timestamp: new Date(),
        isWhisperSession: isWhisperMode
      };
      
      // Remove the streaming message if it exists
      const finalMessages = newMessages.filter(msg => !msg.isStreaming);
      finalMessages.push(errorMessage);
      
      setMessages(finalMessages);
      saveMessages(finalMessages);
      
      // Enable input even on error
      setIsLoading(false);
      window.lastLoadingTime = 0;
      
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 100);
    }
  };

  // Keyboard event handler for Enter key
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!isLoading && inputMessage.trim()) {
          handleSendMessage(e);
        }
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [isLoading, inputMessage, handleSendMessage]);

  // Pre-warm the AI model when ChatPage loads (for both regular chat and whisper sessions)
  useEffect(() => {
    const warmUpModel = async () => {
      try {
        console.log('🔥 Pre-warming AI model (llama3:70b)...');
        // Send a minimal request to load model into GPU memory
        // This reduces first-message delay significantly
        const warmUpResponse = await fetch(`${chatService.baseURL}api/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'llama3:70b',
            prompt: 'Hi',
            stream: false,
            options: {
              num_predict: 1, // Minimal response just to load the model
              temperature: 0.1
            }
          })
        });
        
        if (warmUpResponse.ok) {
          console.log('✅ Model pre-warmed successfully - first message will be faster!');
        } else {
          console.log('⚠️ Model warm-up completed (non-critical):', warmUpResponse.status);
        }
      } catch (error) {
        console.log('⚠️ Model warm-up failed (non-critical):', error.message);
        // Don't throw - this is optional and shouldn't block the UI
      }
    };
    
    // Warm up after a short delay to not block page render
    // Works for both regular chat and whisper sessions
    const warmUpTimeout = setTimeout(warmUpModel, 500);
    
    return () => clearTimeout(warmUpTimeout);
  }, []); // Run once when component mounts

  useEffect(() => {
    // Load existing messages or set welcome message
    const loadMessages = async () => {
      const user = getCurrentUser();
      
      // If this is a fresh session (Whisper Mode), skip loading previous messages
      if (isFreshSession) {
        console.log('🤫 WHISPER MODE: Starting fresh session, not loading previous messages');
        setWelcomeMessage();
        return;
      }
      
      // Try to load from Firestore first if user is logged in
      if (user) {
        try {
          console.log('📖 Loading messages from Firestore for date:', selectedDateId);
          const result = await firestoreService.getChatMessagesNew(user.uid, selectedDateId);
          
          if (result.success && result.messages && result.messages.length > 0) {
            console.log('✅ Loaded', result.messages.length, 'messages from Firestore');
            
            // Merge with localStorage to get any images that might be missing from Firestore
            const storedMessagesJson = localStorage.getItem(`chatMessages_${selectedDateId}`);
            if (storedMessagesJson) {
              try {
                const storedMessages = JSON.parse(storedMessagesJson);
                console.log('📸 Merging Firestore messages with localStorage images...');
                
                // Create maps for quick lookup: by ID and by content (text + sender + timestamp)
                const storedMapById = new Map();
                const storedMapByContent = new Map();
                
                storedMessages.forEach(msg => {
                  if (msg.image) {
                    // Map by ID
                    if (msg.id) {
                      storedMapById.set(msg.id, msg.image);
                    }
                    // Map by content (text + sender + approximate timestamp)
                    // Use timestamp within 5 seconds as match (to handle slight differences)
                    const contentKey = `${msg.sender}:${msg.text}`;
                    storedMapByContent.set(contentKey, { image: msg.image, timestamp: msg.timestamp });
                  }
                });
                
                // Merge images from localStorage into Firestore messages
                const mergedMessages = result.messages.map(msg => {
                  // If Firestore message doesn't have image, try to restore from localStorage
                  if (!msg.image) {
                    // First try matching by ID
                    if (msg.id && storedMapById.has(msg.id)) {
                      msg.image = storedMapById.get(msg.id);
                      console.log('📸 Restored image from localStorage by ID for message:', msg.id);
                    } else {
                      // Fallback: try matching by content (text + sender)
                      const contentKey = `${msg.sender}:${msg.text}`;
                      if (storedMapByContent.has(contentKey)) {
                        const storedData = storedMapByContent.get(contentKey);
                        // Check if timestamps are close (within 10 seconds)
                        const timeDiff = Math.abs(
                          (msg.timestamp?.getTime() || 0) - 
                          (storedData.timestamp instanceof Date ? storedData.timestamp.getTime() : new Date(storedData.timestamp).getTime())
                        );
                        if (timeDiff < 10000) { // 10 seconds
                          msg.image = storedData.image;
                          console.log('📸 Restored image from localStorage by content for message:', msg.id);
                        }
                      }
                    }
                  }
                  return msg;
                });
                
                setMessages(mergedMessages);
                // Save merged messages back to localStorage
                saveMessages(mergedMessages);
              } catch (mergeError) {
                console.error('❌ Error merging messages:', mergeError);
                // Fallback to just Firestore messages
                setMessages(result.messages);
                saveMessages(result.messages);
              }
            } else {
              setMessages(result.messages);
              saveMessages(result.messages);
            }
            
            // Check if we need to generate emotional analysis for these messages
            await checkAndGenerateEmotionalAnalysis(user.uid, selectedDateId, result.messages);
            
            return;
          } else {
            console.log('📖 No messages in Firestore, checking localStorage...');
          }
        } catch (error) {
          console.error('❌ Error loading from Firestore:', error);
        }
      }
      
      // Fallback to localStorage if Firestore fails or no messages found
      const storedMessages = localStorage.getItem(`chatMessages_${selectedDateId}`);
      if (storedMessages) {
        try {
          const parsedMessages = JSON.parse(storedMessages);
          const messagesWithDates = parsedMessages.map(msg => ({
            ...msg,
            timestamp: new Date(msg.timestamp)
          }));
          setMessages(messagesWithDates);
          console.log('✅ Loaded', messagesWithDates.length, 'messages from localStorage');
        } catch (error) {
          console.error('Error parsing stored messages:', error);
          setWelcomeMessage();
        }
      } else {
        setWelcomeMessage();
      }
    };

    const setWelcomeMessage = () => {
      let welcomeText;
      
      if (isWhisperMode) {
        welcomeText = "Welcome to your Whisper Session. This is a private, fresh space just for you. What would you like to share in confidence today?";
      } else {
        welcomeText = "Hey there! I'm Deite, and I'm genuinely glad you're here. There's something beautiful about taking a moment to connect with yourself and your feelings. What's been on your heart lately?";
      }
      
      const welcomeMessage = {
        id: 'welcome',
        text: welcomeText,
        sender: 'ai',
        timestamp: new Date()
      };
      setMessages([welcomeMessage]);
    };

    loadMessages();
  }, [selectedDateId]);

  const handleBack = () => {
    // Show custom warning modal if in whisper mode AND there are whisper session messages
    if (isWhisperMode) {
      // Check if there are any actual messages (excluding welcome message)
      // In whisper mode, all messages in the current session are whisper messages
      const actualMessages = messages.filter(m => 
        m.id !== 'welcome' && 
        m.text && 
        m.text.trim().length > 0
      );
      
      console.log(`🤫 BACK BUTTON: Whisper mode active, found ${actualMessages.length} messages (excluding welcome)`);
      console.log(`🤫 BACK BUTTON: Total messages in state: ${messages.length}`);
      console.log(`🤫 BACK BUTTON: Messages:`, messages.map(m => ({ id: m.id, sender: m.sender, textLength: m.text?.length || 0, isWhisper: m.isWhisperSession })));
      
      if (actualMessages.length > 0) {
        // Show warning if there are actual messages to delete
        console.log(`🤫 Found ${actualMessages.length} whisper session messages - showing deletion warning`);
        setShowDeleteWarning(true);
        return; // Don't navigate yet, wait for user confirmation
      } else {
        // No messages, just navigate back directly
        console.log('🤫 No whisper session messages found - navigating directly to dashboard');
        navigate('/dashboard', { replace: true });
        return;
      }
    }
    
    // Navigate back to dashboard (regular chat)
    navigate('/dashboard');
  };

  // Keep handleBack ref updated
  handleBackRef.current = handleBack;

  // Handle Android hardware back button - handles whisper session warnings
  // This listener fires FIRST and handles ChatPage-specific logic
  useEffect(() => {
    let backButtonListener = null;

    const setupBackButton = async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          const { App } = await import('@capacitor/app');
          // Add listener for back button
          // Registering ANY listener prevents app exit by default
          backButtonListener = await App.addListener('backButton', () => {
            console.log('🔙 Android hardware back button pressed on ChatPage');
            // Call our handleBack function to navigate to dashboard
            // This will handle both regular chat and whisper session cases
            // Use ref to access the latest handleBack function
            if (handleBackRef.current) {
              handleBackRef.current();
            }
          });

          console.log('✅ Android back button listener registered for ChatPage');
        } catch (error) {
          console.warn('⚠️ Could not set up back button listener:', error);
        }
      }
    };

    setupBackButton();

    // Cleanup listener on unmount
    return () => {
      if (backButtonListener) {
        backButtonListener.remove();
        console.log('🧹 Removed Android back button listener from ChatPage');
      }
    };
  }, [navigate]); // navigate is stable, handleBack ref will have latest state

  const handleConfirmDelete = async () => {
    setShowDeleteWarning(false);
    
    // User confirmed - delete all whisper session messages
    console.log('🗑️ User confirmed deletion - removing all whisper session messages...');
    const user = getCurrentUser();
    
    if (user) {
      try {
        // First, preserve regular messages from localStorage before clearing
        const storedMessagesKey = `chatMessages_${selectedDateId}`;
        const storedMessagesJson = localStorage.getItem(storedMessagesKey);
        let regularMessages = [];
        
        if (storedMessagesJson) {
          try {
            const allStoredMessages = JSON.parse(storedMessagesJson);
            // Filter out whisper session messages, keep only regular messages
            regularMessages = allStoredMessages.filter(m => !m.isWhisperSession);
            console.log(`💾 Preserving ${regularMessages.length} regular messages in localStorage`);
          } catch (parseError) {
            console.error('❌ Error parsing stored messages:', parseError);
          }
        }
        
        // Use the dedicated method to delete all whisper session messages from Firestore
        const result = await firestoreService.deleteWhisperSessionMessages(user.uid, selectedDateId);
        if (result.success) {
          console.log(`🗑️ Deleted ${result.deletedCount || 0} whisper session messages from Firestore`);
        } else {
          console.error('❌ Error deleting whisper session messages:', result.error);
        }
        
        // Update localStorage: remove whisper messages but keep regular messages
        if (regularMessages.length > 0) {
          localStorage.setItem(storedMessagesKey, JSON.stringify(regularMessages));
          console.log(`💾 Updated localStorage: kept ${regularMessages.length} regular messages, removed whisper messages`);
        } else {
          // If no regular messages, just remove the key
          localStorage.removeItem(storedMessagesKey);
          console.log('🗑️ Cleared localStorage (no regular messages to preserve)');
        }
      } catch (error) {
        console.error('❌ Error deleting whisper session messages:', error);
        // Still navigate even if deletion fails
      }
    }
    
    // Always navigate back to dashboard after deletion (even if deletion failed)
    console.log('🏠 Navigating to dashboard after whisper session deletion...');
    navigate('/dashboard', { replace: true });
  };

  const handleCancelDelete = () => {
    setShowDeleteWarning(false);
    console.log('🤫 User cancelled leaving whisper session');
  };

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
  };

  return (
    <>
      <style>
        {`
          @keyframes blink {
            0%, 50% { opacity: 1; }
            51%, 100% { opacity: 0; }
          }
        `}
      </style>
    <div
      className="min-h-screen flex flex-col relative overflow-hidden"
      style={{
        background: isDarkMode
          ? "#131313"
          : "#FAFAF8",
      }}
    >
      {/* Header */}
      <div className={`sticky top-0 z-20 flex items-center justify-between p-6 border-b backdrop-blur-lg ${
        isDarkMode ? 'border-gray-600/20' : 'border-gray-200/50'
      }`}
        style={{
          backgroundColor: isDarkMode
            ? "rgba(19, 19, 19, 0.9)"
            : "rgba(250, 250, 248, 0.9)",
        }}
      >
        <button
          onClick={handleBack}
          className={`w-10 h-10 rounded-full flex items-center justify-center hover:opacity-80 transition-opacity ${
            isDarkMode ? 'backdrop-blur-md' : 'bg-white'
          }`}
          style={isDarkMode ? {
            backgroundColor: "rgba(42, 42, 45, 0.6)",
            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
          } : {
            boxShadow: "0 2px 8px rgba(134, 169, 107, 0.15)",
          }}
        >
          <ArrowLeft className="w-5 h-5" style={{ color: isDarkMode ? "#8AB4F8" : "#87A96B" }} strokeWidth={1.5} />
        </button>

        <div className="flex items-center space-x-3">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center ${
              isDarkMode ? 'backdrop-blur-md' : 'bg-white'
            }`}
            style={isDarkMode ? {
              backgroundColor: "rgba(42, 42, 45, 0.6)",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            } : {
              boxShadow: "0 2px 8px rgba(134, 169, 107, 0.15)",
            }}
          >
            <Brain className="w-5 h-5" style={{ color: isDarkMode ? "#FDD663" : "#87A96B" }} strokeWidth={1.5} />
          </div>
          <div>
            <h1 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
              {isWhisperMode ? 'Whisper Session' : 'Deite'}
            </h1>
          </div>
        </div>

        <button
          onClick={() => navigate('/profile')}
          className={`w-10 h-10 rounded-full flex items-center justify-center hover:opacity-80 transition-opacity overflow-hidden ${
            isDarkMode ? 'backdrop-blur-md' : 'bg-white'
          }`}
          style={isDarkMode ? {
            backgroundColor: profilePicture ? "transparent" : "rgba(42, 42, 45, 0.6)",
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
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 relative z-10">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-xs lg:max-w-md px-4 py-3 rounded-2xl backdrop-blur-lg relative overflow-hidden ${
                message.sender === 'user' ? 'ml-4' : 'mr-4'
              }`}
              style={{
                backgroundColor: message.sender === 'user'
                  ? "rgba(129, 201, 149, 0.08)"
                  : message.isProcessingReel
                  ? "rgba(42, 42, 45, 0.8)"
                  : "rgba(42, 42, 45, 0.6)",
                boxShadow: message.sender === 'user'
                  ? "0 4px 16px rgba(0, 0, 0, 0.15)"
                  : "0 4px 16px rgba(0, 0, 0, 0.15)",
                border: message.sender === 'user'
                  ? "1px solid rgba(129, 201, 149, 0.15)"
                  : "1px solid rgba(255, 255, 255, 0.08)",
              }}
            >
              {message.image && (
                <img 
                  src={message.image} 
                  alt="Shared" 
                  className="max-w-full rounded-lg mb-2 object-cover"
                  style={{ maxHeight: '300px' }}
                />
              )}
              {message.isProcessingReel ? (
                <div className="flex items-center space-x-2">
                  <Eye className="w-5 h-5 text-yellow-400 animate-pulse" />
                  <p className="text-white text-sm leading-relaxed">
                    {message.text}
                  </p>
                </div>
              ) : (
                <p className="text-white text-sm leading-relaxed">
                  {message.text}
                  {message.isStreaming && (
                    <span className="inline-block ml-1 w-2 h-4 bg-gray-400 animate-pulse" style={{
                      animation: 'blink 1s infinite'
                    }}>|</span>
                  )}
                </p>
              )}
              <p className="text-xs text-gray-400 mt-1">{formatTime(message.timestamp)}</p>
            </div>
          </div>
        ))}
        
        
        <div ref={messagesEndRef} />
      </div>


      {/* Input */}
      <div className="relative z-10 p-4 border-t border-gray-700/30">
        {/* Image Preview */}
        {imagePreview && (
          <div className="mb-3 relative inline-block" style={{ display: 'block' }}>
            <div className="relative" style={{ display: 'inline-block' }}>
              <img 
                src={imagePreview} 
                alt="Preview" 
                className="max-w-[200px] max-h-[200px] rounded-lg object-cover"
                style={{ 
                  display: 'block',
                  maxWidth: '200px',
                  maxHeight: '200px',
                  borderRadius: '8px',
                  objectFit: 'cover'
                }}
                onLoad={() => console.log('📸 Image preview loaded successfully')}
                onError={(e) => {
                  console.error('❌ Image preview failed to load:', e);
                  alert('Failed to load image preview. Please try selecting the image again.');
                  setSelectedImage(null);
                  setImagePreview(null);
                }}
              />
              <button
                onClick={() => {
                  console.log('📸 Removing image preview');
                  setSelectedImage(null);
                  setImagePreview(null);
                  if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                  }
                }}
                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-600 transition-colors"
                style={{ zIndex: 10 }}
              >
                <X className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>
        )}
        
        <form onSubmit={handleSendMessage} className="flex space-x-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => {
              console.log('📸 Image input changed');
              const file = e.target.files?.[0];
              if (file) {
                console.log('📸 File selected:', file.name, 'Size:', (file.size / 1024).toFixed(2), 'KB', 'Type:', file.type);
                
                if (file.size > 10 * 1024 * 1024) { // 10MB limit
                  alert('Image size should be less than 10MB');
                  e.target.value = ''; // Reset input
                  return;
                }
                
                // Validate file type
                if (!file.type.startsWith('image/')) {
                  alert('Please select a valid image file');
                  e.target.value = ''; // Reset input
                  return;
                }
                
                setSelectedImage(file);
                console.log('📸 Setting selectedImage state');
                
                const reader = new FileReader();
                
                reader.onload = (event) => {
                  console.log('📸 FileReader onload triggered');
                  const result = event.target?.result;
                  if (result) {
                    console.log('📸 Setting imagePreview, length:', result.length);
                    setImagePreview(result);
                    console.log('📸 Image preview should now be visible');
                  } else {
                    console.error('❌ FileReader result is null or undefined');
                  }
                };
                
                reader.onerror = (error) => {
                  console.error('❌ FileReader error:', error);
                  alert('Error reading image file. Please try again.');
                  setSelectedImage(null);
                  setImagePreview(null);
                  e.target.value = ''; // Reset input
                };
                
                reader.onabort = () => {
                  console.warn('⚠️ FileReader aborted');
                  setSelectedImage(null);
                  setImagePreview(null);
                };
                
                try {
                  reader.readAsDataURL(file);
                  console.log('📸 Started reading file as data URL');
                } catch (error) {
                  console.error('❌ Error starting FileReader:', error);
                  alert('Error processing image. Please try again.');
                  setSelectedImage(null);
                  setImagePreview(null);
                  e.target.value = ''; // Reset input
                }
              } else {
                console.log('📸 No file selected');
                setSelectedImage(null);
                setImagePreview(null);
              }
            }}
            className="hidden"
          />
          
          <button
            type="button"
            onClick={() => {
              console.log('📸 Image button clicked, fileInputRef:', fileInputRef.current);
              if (fileInputRef.current) {
                fileInputRef.current.click();
              } else {
                console.error('❌ fileInputRef is null!');
              }
            }}
            disabled={isLoading}
            className="w-12 h-12 rounded-2xl flex items-center justify-center backdrop-blur-lg transition-all duration-300 hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
            style={{
              backgroundColor: selectedImage ? "rgba(129, 201, 149, 0.3)" : "rgba(42, 42, 45, 0.6)",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
              border: selectedImage ? "1px solid rgba(129, 201, 149, 0.5)" : "1px solid rgba(255, 255, 255, 0.08)",
            }}
            title={selectedImage ? `Image selected: ${selectedImage.name}` : "Select image"}
          >
            <ImageIcon 
              className="w-5 h-5" 
              style={{ color: selectedImage ? "#81C995" : "#8AB4F8" }} 
              strokeWidth={1.5} 
            />
          </button>
          
          <input
            ref={inputRef}
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Share what's on your mind..."
            disabled={isLoading}
            className="flex-1 px-4 py-3 rounded-2xl focus:outline-none focus:ring-2 text-white placeholder-gray-400 backdrop-blur-md"
            style={{
              backgroundColor: "rgba(42, 42, 45, 0.6)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
            }}
          />
          <button
            type="submit"
            disabled={(!inputMessage.trim() && !selectedImage) || isLoading}
            className="w-12 h-12 rounded-2xl flex items-center justify-center backdrop-blur-lg transition-all duration-300 hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
            style={{
              background: (inputMessage.trim() || selectedImage) && !isLoading
                ? "rgba(42, 42, 45, 0.8)"
                : "rgba(42, 42, 45, 0.4)",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            <Send 
              className="w-5 h-5" 
              style={{ color: (inputMessage.trim() || selectedImage) && !isLoading ? "#FFFFFF" : "#8AB4F8" }} 
              strokeWidth={1.5} 
            />
          </button>
        </form>
      </div>

      {/* Delete Warning Modal - Matching EmotionalWellbeing UI/UX */}
      {showDeleteWarning && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
          }}
          onClick={handleCancelDelete}
        >
          <div
            className={`max-w-md w-full rounded-xl p-6 transition-all duration-300 ${
              isDarkMode ? 'border border-gray-600/20' : 'bg-white/40 border border-gray-200/30'
            }`}
            style={isDarkMode ? {
              backgroundColor: "rgba(42, 42, 45, 0.6)",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
            } : {
              backgroundColor: "rgba(255, 255, 255, 0.6)",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.1)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Warning Icon */}
            <div className="flex items-center justify-center mb-4">
              <div 
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={isDarkMode ? {
                  backgroundColor: "rgba(42, 42, 45, 0.6)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                } : {
                  backgroundColor: "rgba(255, 255, 255, 0.6)",
                  border: "1px solid rgba(0, 0, 0, 0.08)",
                }}
              >
                <AlertTriangle className="w-6 h-6" style={{ color: isDarkMode ? "#F28B82" : "#F28B82" }} />
              </div>
            </div>

            {/* Title */}
            <h3 className={`text-lg font-semibold text-center mb-3 ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
              Leaving Whisper Session
            </h3>

            {/* Message */}
            <p className={`text-sm leading-relaxed text-center mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              All chat messages in this session will be <strong className={isDarkMode ? 'text-red-400' : 'text-red-600'}>permanently deleted</strong> and cannot be recovered.
            </p>

            <p className={`text-sm leading-relaxed text-center mb-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              Are you sure you want to leave and delete all messages?
            </p>

            {/* Buttons */}
            <div className="flex space-x-3">
              <button
                onClick={handleCancelDelete}
                className={`flex-1 px-3 py-2 rounded-full text-sm font-medium transition-all duration-300 touch-manipulation ${
                  isDarkMode 
                    ? 'bg-gray-800 text-gray-300 hover:bg-gray-700' 
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className={`flex-1 px-3 py-2 rounded-full text-sm font-medium transition-all duration-300 touch-manipulation ${
                  isDarkMode 
                    ? 'bg-gray-800 text-gray-300 hover:bg-gray-700 border border-red-500/50' 
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300 border border-red-500/50'
                }`}
                style={{
                  backgroundColor: isDarkMode 
                    ? "rgba(242, 139, 130, 0.15)" 
                    : "rgba(242, 139, 130, 0.1)",
                  border: "1px solid rgba(242, 139, 130, 0.3)",
                }}
              >
                <span className={isDarkMode ? 'text-red-400' : 'text-red-600'}>Delete & Leave</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}