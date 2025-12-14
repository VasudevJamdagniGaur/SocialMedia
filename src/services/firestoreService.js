import { 
  doc, 
  setDoc, 
  getDoc, 
  addDoc, 
  collection, 
  collectionGroup,
  query, 
  orderBy, 
  limit, 
  getDocs,
  serverTimestamp,
  where,
  increment,
  deleteDoc,
  onSnapshot
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { getDateId } from '../utils/dateUtils';
import { getCurrentUser } from '../services/authService';

class FirestoreService {
  constructor() {
    this.db = db;
  }

  /**
   * Ensure user document exists
   */
  async ensureUser(uid, userData = {}) {
    try {
      const userRef = doc(this.db, `users/${uid}`);
      await setDoc(userRef, {
        createdAt: serverTimestamp(),
        ...userData
      }, { merge: true });
      return { success: true };
    } catch (error) {
      console.error('Error ensuring user:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get user data from Firestore
   * Checks both users and usersMetadata collections
   */
  async getUser(uid) {
    try {
      // First try users collection
      const userRef = doc(this.db, `users/${uid}`);
      const userSnap = await getDoc(userRef);
      
      let userData = {};
      if (userSnap.exists()) {
        userData = userSnap.data();
      }
      
      // Also check usersMetadata for profile picture and display name
      try {
        const metadataRef = doc(this.db, `usersMetadata/${uid}`);
        const metadataSnap = await getDoc(metadataRef);
        if (metadataSnap.exists()) {
          const metadata = metadataSnap.data();
          // Merge metadata into userData, with metadata taking precedence
          userData = {
            ...userData,
            ...metadata,
            // Profile picture from metadata takes precedence
            profilePicture: metadata.profilePicture || userData.profilePicture || null,
            // Display name from metadata takes precedence
            displayName: metadata.displayName || userData.displayName || null
          };
        }
      } catch (metadataError) {
        // If metadata doesn't exist or can't be read, continue with user data only
        console.log('No metadata found for user:', uid);
      }
      
      if (Object.keys(userData).length > 0) {
        return { success: true, data: userData };
      }
      return { success: false, error: 'User not found' };
    } catch (error) {
      console.error('Error getting user:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create or update a chat day document
   */
  async ensureChatDay(uid, dateId) {
    try {
      const chatDayRef = doc(this.db, `users/${uid}/chats/${dateId}`);
      await setDoc(chatDayRef, {
        date: dateId,
        messageCount: 0,
        lastMessageAt: serverTimestamp(),
        summary: null
      }, { merge: true });
      return { success: true };
    } catch (error) {
      console.error('Error ensuring chat day:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Add a message to a chat day
   */
  async addMessage(uid, dateId, messageData) {
    try {
      // Ensure chat day exists first
      await this.ensureChatDay(uid, dateId);
      
      // Add the message
      const messagesRef = collection(this.db, `users/${uid}/chats/${dateId}/messages`);
      const messageRef = await addDoc(messagesRef, {
        ...messageData,
        ts: serverTimestamp()
      });

      // Update chat day counters
      const chatDayRef = doc(this.db, `users/${uid}/chats/${dateId}`);
      
      // Get current message count
      const chatDaySnap = await getDoc(chatDayRef);
      const currentCount = chatDaySnap.exists() ? chatDaySnap.data().messageCount || 0 : 0;
      
      await setDoc(chatDayRef, {
        messageCount: currentCount + 1,
        lastMessageAt: serverTimestamp()
      }, { merge: true });

      return { success: true, messageId: messageRef.id };
    } catch (error) {
      console.error('Error adding message:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get messages for a specific chat day
   */
  async getMessages(uid, dateId) {
    try {
      const messagesRef = collection(this.db, `users/${uid}/chats/${dateId}/messages`);
      const q = query(messagesRef, orderBy('ts', 'asc'));
      const snapshot = await getDocs(q);
      
      const messages = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        messages.push({
          id: doc.id,
          ...data,
          timestamp: data.ts?.toDate() || new Date()
        });
      });

      return { success: true, messages };
    } catch (error) {
      console.error('Error getting messages:', error);
      return { success: false, error: error.message, messages: [] };
    }
  }

  /**
   * Get recent chat days for a user
   */
  async getRecentChatDays(uid, limitCount = 14) {
    try {
      const chatsRef = collection(this.db, `users/${uid}/chats`);
      const q = query(chatsRef, orderBy('date', 'desc'), limit(limitCount));
      const snapshot = await getDocs(q);
      
      const chatDays = [];
      snapshot.forEach(doc => {
        chatDays.push({
          id: doc.id,
          ...doc.data()
        });
      });

      return { success: true, chatDays };
    } catch (error) {
      console.error('Error getting recent chat days:', error);
      return { success: false, error: error.message, chatDays: [] };
    }
  }

  /**
   * Get all chat days for a user (for calendar display)
   */
  async getAllChatDays(uid) {
    try {
      console.log('📅 FIRESTORE: Getting all chat days for calendar...');
      
      const daysRef = collection(this.db, `users/${uid}/days`);
      const snapshot = await getDocs(daysRef);
      
      const chatDays = [];
      snapshot.forEach((doc) => {
        chatDays.push({
          id: doc.id,
          date: doc.id,
          ...doc.data()
        });
      });
      
      console.log('📅 FIRESTORE: Found', chatDays.length, 'chat days');
      console.log('📅 FIRESTORE: Sample chat days:', chatDays.slice(0, 3));
      return { success: true, chatDays };
    } catch (error) {
      console.error('❌ FIRESTORE: Error getting chat days:', error);
      return { success: false, error: error.message, chatDays: [] };
    }
  }

  /**
   * Get all reflection days for calendar indicators
   */
  async getAllReflectionDays(uid) {
    try {
      console.log('📅 FIRESTORE: Getting all reflection days for calendar...');
      
      // First try the new structure: users/{uid}/days/{dateId}/reflection/meta
      const daysRef = collection(this.db, `users/${uid}/days`);
      const snapshot = await getDocs(daysRef);
      
      const reflectionDays = [];
      
      // Check each day for reflection data
      for (const doc of snapshot.docs) {
        const dayData = doc.data();
        const dateId = doc.id;
        
        // Check if this day has reflection data in the new structure
        try {
          const reflectionRef = doc(this.db, `users/${uid}/days/${dateId}/reflection/meta`);
          const reflectionSnap = await getDoc(reflectionRef);
          
          if (reflectionSnap.exists()) {
            console.log('📅 FIRESTORE: Found reflection for', dateId);
            reflectionDays.push({
              id: dateId,
              date: dateId,
              ...dayData,
              hasReflection: true
            });
          }
        } catch (reflectionError) {
          console.log('📅 FIRESTORE: No reflection subcollection for', dateId);
        }
      }
      
      console.log('📅 FIRESTORE: Found', reflectionDays.length, 'reflection days in new structure');
      
      // If no reflections found in new structure, try old structure as fallback
      if (reflectionDays.length === 0) {
        console.log('📅 FIRESTORE: No reflections in new structure, trying old structure...');
        const reflectionDaysRef = collection(this.db, `users/${uid}/dayReflections`);
        const oldSnapshot = await getDocs(reflectionDaysRef);
        
        oldSnapshot.forEach((doc) => {
          reflectionDays.push({
            id: doc.id,
            date: doc.id,
            ...doc.data()
          });
        });
        
        console.log('📅 FIRESTORE: Found', reflectionDays.length, 'reflection days in old structure');
      }
      
      console.log('📅 FIRESTORE: Total reflection days:', reflectionDays.length);
      console.log('📅 FIRESTORE: Sample reflection days:', reflectionDays.slice(0, 3));
      return { success: true, reflectionDays };
    } catch (error) {
      console.error('❌ FIRESTORE: Error getting reflection days:', error);
      return { success: false, error: error.message, reflectionDays: [] };
    }
  }

  /**
   * Save or update a day reflection
   */
  async saveDayReflection(uid, dateId, reflectionData) {
    try {
      const reflectionRef = doc(this.db, `users/${uid}/dayReflections/${dateId}`);
      
      // Check if reflection already exists
      const existingSnap = await getDoc(reflectionRef);
      const isUpdate = existingSnap.exists();
      
      await setDoc(reflectionRef, {
        date: dateId,
        ...reflectionData,
        updatedAt: serverTimestamp(),
        ...(isUpdate ? {} : { createdAt: serverTimestamp() })
      }, { merge: true });

      return { success: true };
    } catch (error) {
      console.error('Error saving day reflection:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get a day reflection
   */
  async getDayReflection(uid, dateId) {
    try {
      const reflectionRef = doc(this.db, `users/${uid}/dayReflections/${dateId}`);
      const snapshot = await getDoc(reflectionRef);
      
      if (snapshot.exists()) {
        return { 
          success: true, 
          reflection: {
            id: snapshot.id,
            ...snapshot.data()
          }
        };
      } else {
        return { success: true, reflection: null };
      }
    } catch (error) {
      console.error('Error getting day reflection:', error);
      return { success: false, error: error.message, reflection: null };
    }
  }

  /**
   * Get recent day reflections
   */
  async getRecentReflections(uid, limitCount = 14) {
    try {
      const reflectionsRef = collection(this.db, `users/${uid}/dayReflections`);
      const q = query(reflectionsRef, orderBy('date', 'desc'), limit(limitCount));
      const snapshot = await getDocs(q);
      
      const reflections = [];
      snapshot.forEach(doc => {
        reflections.push({
          id: doc.id,
          ...doc.data()
        });
      });

      return { success: true, reflections };
    } catch (error) {
      console.error('Error getting recent reflections:', error);
      return { success: false, error: error.message, reflections: [] };
    }
  }

  /**
   * Get chat day info (without messages)
   */
  async getChatDay(uid, dateId) {
    try {
      const chatDayRef = doc(this.db, `users/${uid}/chats/${dateId}`);
      const snapshot = await getDoc(chatDayRef);
      
      if (snapshot.exists()) {
        return { 
          success: true, 
          chatDay: {
            id: snapshot.id,
            ...snapshot.data()
          }
        };
      } else {
        return { success: true, chatDay: null };
      }
    } catch (error) {
      console.error('Error getting chat day:', error);
      return { success: false, error: error.message, chatDay: null };
    }
  }

  /**
   * Save or update daily highlights cache
   */
  async saveHighlightsCache(uid, period, highlightsData) {
    try {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
      const cacheRef = doc(this.db, `users/${uid}/highlightsCache/${period}`);
      
      await setDoc(cacheRef, {
        period: period,
        lastUpdated: today,
        updatedAt: serverTimestamp(),
        highlights: highlightsData,
        createdAt: serverTimestamp()
      }, { merge: true });

      return { success: true };
    } catch (error) {
      console.error('Error saving highlights cache:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get cached highlights for a period
   */
  async getHighlightsCache(uid, period) {
    try {
      const cacheRef = doc(this.db, `users/${uid}/highlightsCache/${period}`);
      const snapshot = await getDoc(cacheRef);
      
      if (snapshot.exists()) {
        const data = snapshot.data();
        const today = new Date().toISOString().split('T')[0];
        
        // Check if cache is from today
        const isToday = data.lastUpdated === today;
        
        return { 
          success: true, 
          cache: {
            id: snapshot.id,
            ...data,
            isValid: isToday
          }
        };
      } else {
        return { success: true, cache: null };
      }
    } catch (error) {
      console.error('Error getting highlights cache:', error);
      return { success: false, error: error.message, cache: null };
    }
  }

  /**
   * Check if highlights cache needs updating (not from today)
   */
  async needsHighlightsUpdate(uid, period) {
    try {
      const result = await this.getHighlightsCache(uid, period);
      if (!result.success) {
        return { success: false, needsUpdate: true };
      }
      
      // If no cache exists or cache is not from today, needs update
      const needsUpdate = !result.cache || !result.cache.isValid;
      
      return { success: true, needsUpdate };
    } catch (error) {
      console.error('Error checking highlights update need:', error);
      return { success: false, error: error.message, needsUpdate: true };
    }
  }
  /**
   * NEW STRUCTURE: Save chat message to /users/{uid}/days/{dateId}/messages/{messageId}
   */
  async saveChatMessageNew(uid, dateId, messageData) {
    try {
      console.log('💾 FIRESTORE NEW: Saving chat message...');
      console.log('💾 FIRESTORE NEW: uid:', uid, 'dateId:', dateId, 'messageData:', messageData);
      console.log('📸 FIRESTORE NEW: Has image:', !!messageData.image);
      
      // Prepare message data
      const messageDoc = {
        role: messageData.sender === 'user' ? 'user' : 'assistant',
        text: messageData.text,
        ts: serverTimestamp(),
        isWhisperSession: messageData.isWhisperSession || false
      };
      
      // Add image if present (base64 data URL)
      if (messageData.image) {
        // Check image size (Firestore has 1MB limit per document)
        // Base64 is ~33% larger than binary, so we check for ~750KB base64 = ~1MB binary
        const imageSize = messageData.image.length;
        const maxSize = 750000; // ~750KB base64
        
        if (imageSize > maxSize) {
          console.warn('⚠️ FIRESTORE NEW: Image too large for Firestore (' + (imageSize / 1024).toFixed(2) + 'KB). Saving without image.');
          // Still save the message, but without the image
          // The image will remain in localStorage as backup
        } else {
          messageDoc.image = messageData.image;
          console.log('📸 FIRESTORE NEW: Image included in message (' + (imageSize / 1024).toFixed(2) + 'KB)');
        }
      }
      
      // Create message in new structure
      const messageRef = doc(collection(this.db, `users/${uid}/days/${dateId}/messages`));
      await setDoc(messageRef, messageDoc);

      console.log('💾 FIRESTORE NEW: Message saved with ID:', messageRef.id);

      // Update day info
      const dayRef = doc(this.db, `users/${uid}/days/${dateId}`);
      await setDoc(dayRef, {
        date: dateId,
        lastMessageAt: serverTimestamp(),
        messageCount: increment(1)
      }, { merge: true });

      console.log('💾 FIRESTORE NEW: Day info updated');
      return { success: true, messageId: messageRef.id };
    } catch (error) {
      console.error('❌ FIRESTORE NEW: Error saving chat message:', error);
      
      // Check if error is due to document size limit
      if (error.message && error.message.includes('size')) {
        console.error('❌ FIRESTORE NEW: Document too large. Image may be too big for Firestore.');
        // Try saving without image
        try {
          const messageRef = doc(collection(this.db, `users/${uid}/days/${dateId}/messages`));
          await setDoc(messageRef, {
            role: messageData.sender === 'user' ? 'user' : 'assistant',
            text: messageData.text,
            ts: serverTimestamp(),
            isWhisperSession: messageData.isWhisperSession || false
            // Image omitted due to size
          });
          console.log('💾 FIRESTORE NEW: Message saved without image (too large)');
          return { success: true, messageId: messageRef.id, imageOmitted: true };
        } catch (retryError) {
          console.error('❌ FIRESTORE NEW: Retry also failed:', retryError);
        }
      }
      
      return { success: false, error: error.message };
    }
  }

  /**
   * NEW STRUCTURE: Get chat messages from /users/{uid}/days/{dateId}/messages
   */
  async getChatMessagesNew(uid, dateId) {
    try {
      console.log('📖 FIRESTORE NEW: Getting chat messages...');
      const messagesRef = collection(this.db, `users/${uid}/days/${dateId}/messages`);
      const q = query(messagesRef, orderBy('ts', 'asc'));
      const snapshot = await getDocs(q);
      
      const messages = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        const message = {
          id: doc.id,
          sender: data.role === 'user' ? 'user' : 'ai',
          text: data.text,
          timestamp: data.ts?.toDate() || new Date(),
          isWhisperSession: data.isWhisperSession || false // Preserve the isWhisperSession flag
        };
        
        // Include image if present
        if (data.image) {
          message.image = data.image;
          console.log('📸 FIRESTORE NEW: Loaded message with image (ID:', doc.id + ')');
        }
        
        messages.push(message);
      });

      console.log('📖 FIRESTORE NEW: Retrieved', messages.length, 'messages');
      console.log('📖 FIRESTORE NEW: Messages with images:', messages.filter(m => m.image).length);
      console.log('📖 FIRESTORE NEW: Whisper messages count:', messages.filter(m => m.isWhisperSession).length);
      console.log('📖 FIRESTORE NEW: Regular messages count:', messages.filter(m => !m.isWhisperSession).length);
      return { success: true, messages };
    } catch (error) {
      console.error('❌ FIRESTORE NEW: Error getting chat messages:', error);
      return { success: false, error: error.message, messages: [] };
    }
  }

  /**
   * Convenience wrapper: Get chat messages (returns messages array directly)
   * For backward compatibility with habitAnalysisService and patternAnalysisService
   */
  async getChatMessages(uid, dateId) {
    try {
      console.log('📖 FIRESTORE: Getting chat messages (wrapper)...');
      const result = await this.getChatMessagesNew(uid, dateId);
      
      if (result.success) {
        return result.messages || [];
      } else {
        console.error('❌ FIRESTORE: Error getting chat messages:', result.error);
        return [];
      }
    } catch (error) {
      console.error('❌ FIRESTORE: Error in getChatMessages wrapper:', error);
      return [];
    }
  }

  /**
   * NEW STRUCTURE: Delete a chat message from /users/{uid}/days/{dateId}/messages/{messageId}
   */
  async deleteChatMessageNew(uid, dateId, messageId) {
    try {
      console.log('🗑️ FIRESTORE NEW: Deleting chat message...', messageId);
      const messageRef = doc(this.db, `users/${uid}/days/${dateId}/messages/${messageId}`);
      await deleteDoc(messageRef);
      console.log('🗑️ FIRESTORE NEW: Message deleted successfully');
      return { success: true };
    } catch (error) {
      console.error('❌ FIRESTORE NEW: Error deleting chat message:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * NEW STRUCTURE: Delete all whisper session messages for a date
   */
  async deleteWhisperSessionMessages(uid, dateId) {
    try {
      console.log('🗑️ FIRESTORE NEW: Deleting all whisper session messages...');
      const messagesRef = collection(this.db, `users/${uid}/days/${dateId}/messages`);
      
      // First, get ALL messages to verify counts
      const allMessagesQuery = query(messagesRef, orderBy('ts', 'asc'));
      const allSnapshot = await getDocs(allMessagesQuery);
      const totalMessages = allSnapshot.size;
      let whisperCount = 0;
      let regularCount = 0;
      
      allSnapshot.forEach(docSnap => {
        const data = docSnap.data();
        if (data.isWhisperSession === true) {
          whisperCount++;
        } else {
          regularCount++;
        }
      });
      
      console.log(`🗑️ FIRESTORE NEW: Total messages: ${totalMessages} (Whisper: ${whisperCount}, Regular: ${regularCount})`);
      
      // Now query and delete ONLY whisper session messages
      const whisperQuery = query(messagesRef, where('isWhisperSession', '==', true));
      const whisperSnapshot = await getDocs(whisperQuery);
      
      const deletePromises = [];
      const deletedIds = [];
      whisperSnapshot.forEach(docSnap => {
        const data = docSnap.data();
        // Double-check: only delete if isWhisperSession is explicitly true
        if (data.isWhisperSession === true) {
          deletedIds.push(docSnap.id);
          deletePromises.push(deleteDoc(docSnap.ref));
        } else {
          console.warn(`⚠️ FIRESTORE NEW: Skipping message ${docSnap.id} - isWhisperSession is not true:`, data.isWhisperSession);
        }
      });
      
      await Promise.all(deletePromises);
      console.log(`🗑️ FIRESTORE NEW: Deleted ${deletePromises.length} whisper session messages (IDs: ${deletedIds.join(', ')})`);
      console.log(`🗑️ FIRESTORE NEW: Regular messages preserved: ${regularCount}`);
      return { success: true, deletedCount: deletePromises.length };
    } catch (error) {
      console.error('❌ FIRESTORE NEW: Error deleting whisper session messages:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * NEW STRUCTURE: Save reflection to /users/{uid}/days/{dateId}/reflection/meta
   */
  async saveReflectionNew(uid, dateId, reflectionData) {
    try {
      console.log('💾 FIRESTORE NEW: Saving reflection...');
      const reflectionRef = doc(this.db, `users/${uid}/days/${dateId}/reflection/meta`);
      
      await setDoc(reflectionRef, {
        summary: reflectionData.summary,
        mood: reflectionData.mood || 'neutral',
        score: reflectionData.score || 50,
        insights: reflectionData.insights || [],
        updatedAt: serverTimestamp(),
        source: 'auto'
      });

      console.log('💾 FIRESTORE NEW: Reflection saved successfully');
      return { success: true };
    } catch (error) {
      console.error('❌ FIRESTORE NEW: Error saving reflection:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * NEW STRUCTURE: Get reflection from /users/{uid}/days/{dateId}/reflection/meta
   */
  async getReflectionNew(uid, dateId) {
    try {
      console.log('📖 FIRESTORE NEW: Getting reflection...');
      const reflectionRef = doc(this.db, `users/${uid}/days/${dateId}/reflection/meta`);
      const snapshot = await getDoc(reflectionRef);
      
      if (snapshot.exists()) {
        const data = snapshot.data();
        console.log('📖 FIRESTORE NEW: Found reflection:', data.summary);
        return { 
          success: true, 
          reflection: data.summary,
          fullData: data
        };
      } else {
        console.log('📖 FIRESTORE NEW: No reflection found');
        return { success: true, reflection: null };
      }
    } catch (error) {
      console.error('❌ FIRESTORE NEW: Error getting reflection:', error);
      return { success: false, error: error.message, reflection: null };
    }
  }

  /**
   * NEW STRUCTURE: Save mood chart data to /users/{uid}/days/{dateId}/moodChart/daily
   */
  async saveMoodChartNew(uid, dateId, moodData) {
    try {
      console.log('💾 FIRESTORE NEW: Saving mood chart...');
      const moodRef = doc(this.db, `users/${uid}/days/${dateId}/moodChart/daily`);
      
      await setDoc(moodRef, {
        happiness: moodData.happiness,
        anxiety: moodData.anxiety,
        stress: moodData.stress,
        energy: moodData.energy,
        updatedAt: serverTimestamp()
      });

      console.log('💾 FIRESTORE NEW: Mood chart saved successfully');
      return { success: true };
    } catch (error) {
      console.error('❌ FIRESTORE NEW: Error saving mood chart:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * NEW STRUCTURE: Save emotional balance to /users/{uid}/days/{dateId}/emotionalBalance/daily
   */
  async saveEmotionalBalanceNew(uid, dateId, balanceData) {
    try {
      console.log('💾 FIRESTORE NEW: Saving emotional balance...');
      const balanceRef = doc(this.db, `users/${uid}/days/${dateId}/emotionalBalance/daily`);
      
      await setDoc(balanceRef, {
        positive: balanceData.positive,
        negative: balanceData.negative,
        neutral: balanceData.neutral,
        updatedAt: serverTimestamp()
      });

      console.log('💾 FIRESTORE NEW: Emotional balance saved successfully');
      return { success: true };
    } catch (error) {
      console.error('❌ FIRESTORE NEW: Error saving emotional balance:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * NEW STRUCTURE: Get mood chart data for multiple days
   */
  async getMoodChartDataNew(uid, days = 7) {
    try {
      console.log(`📊 FIRESTORE NEW: Getting mood chart data for ${days} days...`);
      
      const moodData = [];
      
      // Get the current date ID in India timezone
      const todayDateId = getDateId(new Date());
      console.log(`📊 FIRESTORE NEW: Today's date ID (India timezone): ${todayDateId}`);
      
      // Parse today's date to get year, month, day
      const [todayYear, todayMonth, todayDay] = todayDateId.split('-').map(Number);
      
      // Get data for each day in the range
      for (let i = days - 1; i >= 0; i--) {
        // Create a date object from today's India timezone date and subtract days
        // Note: Month is 0-indexed in JavaScript Date
        const targetDate = new Date(todayYear, todayMonth - 1, todayDay - i);
        const dateId = targetDate.toLocaleDateString('en-CA'); // Format as YYYY-MM-DD
        console.log(`📊 FIRESTORE NEW: Checking mood data for date: ${dateId} (${i} days ago)`);
        
        try {
          const moodRef = doc(this.db, `users/${uid}/days/${dateId}/moodChart/daily`);
          const snapshot = await getDoc(moodRef);
          
          if (snapshot.exists()) {
            const data = snapshot.data();
            console.log(`📊 FIRESTORE NEW: ✅ Found mood data for ${dateId}:`, data);
            console.log(`📊 FIRESTORE NEW: ✅ Raw values - H:${data.happiness} E:${data.energy} A:${data.anxiety} S:${data.stress}`);
            console.log(`📊 FIRESTORE NEW: ✅ Firestore path was: users/${uid}/days/${dateId}/moodChart/daily`);
            
            const dayData = {
              date: dateId,
              day: targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
              happiness: data.happiness || 0,
              anxiety: data.anxiety || 0,
              stress: data.stress || 0,
              energy: data.energy || 0
            };
            
            console.log(`📊 FIRESTORE NEW: ✅ Pushing to array:`, dayData);
            moodData.push(dayData);
          } else {
            // No data for this day - skip it instead of adding zeros
            console.log(`📊 FIRESTORE NEW: ❌ No mood data for ${dateId}, skipping`);
            console.log(`📊 FIRESTORE NEW: ❌ Checked path: users/${uid}/days/${dateId}/moodChart/daily`);
            console.log(`📊 FIRESTORE NEW: ❌ This means NO DATA was saved to Firestore for this date`);
            // Don't add zeros - only show days with actual data
          }
        } catch (dayError) {
          console.error(`❌ Error getting mood data for ${dateId}:`, dayError);
          // Only add defaults if this is a permissions/network error, not if no data exists
          if (dayError.code === 'permission-denied' || dayError.code === 'unavailable') {
            moodData.push({
              date: dateId,
              day: targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
              happiness: 50,
              anxiety: 25,
              stress: 25,
              energy: 50
            });
          } else {
            // For other errors (like no data), add zeros
            moodData.push({
              date: dateId,
              day: targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
              happiness: 0,
              anxiety: 0,
              stress: 0,
              energy: 0
            });
          }
        }
      }
      
      console.log(`📊 FIRESTORE NEW: ✅ Retrieved mood data for ${moodData.length} days`);
      console.log(`📊 FIRESTORE NEW: ✅ Complete array:`, moodData);
      console.log(`📊 FIRESTORE NEW: ✅ Oct 8 data in array:`, moodData.find(d => d.day && d.day.includes('Oct 8')));
      return { success: true, moodData };
    } catch (error) {
      console.error('❌ FIRESTORE NEW: Error getting mood chart data:', error);
      return { success: false, error: error.message, moodData: [] };
    }
  }

  /**
   * NEW STRUCTURE: Get ALL mood chart data (Lifetime) - queries all available days
   */
  async getAllMoodChartDataNew(uid) {
    try {
      console.log('📊 LIFETIME: Fetching ALL available mood chart data...');
      
      // Query the "days" collection to get all available dates
      const daysRef = collection(this.db, `users/${uid}/days`);
      const daysSnapshot = await getDocs(daysRef);
      
      console.log(`📊 LIFETIME: Found ${daysSnapshot.size} days with data in Firestore`);
      
      // ✅ OPTIMIZED: Create all document references at once
      const docRefs = daysSnapshot.docs.map(dayDoc => {
        const dateId = dayDoc.id;
        return doc(this.db, `users/${uid}/days/${dateId}/moodChart/daily`);
      });
      
      // ✅ OPTIMIZED: Fetch ALL documents in parallel using Promise.all (1 network round-trip instead of N)
      console.log('📊 LIFETIME: Fetching all mood documents in parallel...');
      const startTime = Date.now();
      const moodSnapshots = await Promise.all(
        docRefs.map(ref => getDoc(ref))
      );
      const fetchTime = Date.now() - startTime;
      console.log(`📊 LIFETIME: Fetched ${docRefs.length} documents in ${fetchTime}ms (parallel query)`);
      
      // Process results
      const moodData = [];
      daysSnapshot.docs.forEach((dayDoc, index) => {
        const dateId = dayDoc.id;
        const moodSnapshot = moodSnapshots[index];
        
        if (moodSnapshot.exists()) {
          const data = moodSnapshot.data();
          
          // Parse the date to create a proper date object
          const [year, month, day] = dateId.split('-').map(Number);
          const targetDate = new Date(year, month - 1, day);
          
          const dayData = {
            date: dateId,
            day: targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            happiness: data.happiness || 0,
            anxiety: data.anxiety || 0,
            stress: data.stress || 0,
            energy: data.energy || 0
          };
          
          console.log(`📊 LIFETIME: ✅ Found data for ${dateId}: H:${dayData.happiness} E:${dayData.energy} A:${dayData.anxiety} S:${dayData.stress}`);
          moodData.push(dayData);
        }
      });
      
      // Sort by date (oldest first)
      moodData.sort((a, b) => new Date(a.date) - new Date(b.date));
      
      console.log(`📊 LIFETIME: ✅ Retrieved ${moodData.length} days of mood data`);
      console.log(`📊 LIFETIME: ✅ First day: ${moodData.length > 0 ? moodData[0].date : 'N/A'}`);
      console.log(`📊 LIFETIME: ✅ Last day: ${moodData.length > 0 ? moodData[moodData.length - 1].date : 'N/A'}`);
      
      return { success: true, moodData };
    } catch (error) {
      console.error('❌ LIFETIME: Error getting all mood chart data:', error);
      return { success: false, error: error.message, moodData: [] };
    }
  }

  /**
   * Save a pod with name, dates, and reflection
   */
  async savePod(uid, podData) {
    try {
      const podId = podData.id || doc(collection(this.db, `users/${uid}/pods`)).id;
      const podRef = doc(this.db, `users/${uid}/pods/${podId}`);
      
      await setDoc(podRef, {
        name: podData.name || 'My Pod',
        startDate: podData.startDate,
        endDate: podData.endDate || null,
        reflection: podData.reflection || '',
        createdAt: podData.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
        memberCount: podData.memberCount || 5
      }, { merge: true });

      return { success: true, podId };
    } catch (error) {
      console.error('Error saving pod:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all pods for a user
   */
  async getAllPods(uid) {
    try {
      const podsRef = collection(this.db, `users/${uid}/pods`);
      const q = query(podsRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      
      const pods = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        pods.push({
          id: doc.id,
          name: data.name || 'My Pod',
          startDate: data.startDate,
          endDate: data.endDate || null,
          reflection: data.reflection || '',
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
          memberCount: data.memberCount || 5
        });
      });

      return { success: true, pods };
    } catch (error) {
      console.error('Error getting all pods:', error);
      return { success: false, error: error.message, pods: [] };
    }
  }

  /**
   * Get a specific pod by ID
   */
  async getPod(uid, podId) {
    try {
      const podRef = doc(this.db, `users/${uid}/pods/${podId}`);
      const snapshot = await getDoc(podRef);
      
      if (snapshot.exists()) {
        const data = snapshot.data();
        return {
          success: true,
          pod: {
            id: snapshot.id,
            name: data.name || 'My Pod',
            startDate: data.startDate,
            endDate: data.endDate || null,
            reflection: data.reflection || '',
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
            memberCount: data.memberCount || 5
          }
        };
      } else {
        return { success: true, pod: null };
      }
    } catch (error) {
      console.error('Error getting pod:', error);
      return { success: false, error: error.message, pod: null };
    }
  }

  /**
   * Save current pod reflection and create/update pod entry
   */
  async savePodReflection(uid, reflection) {
    try {
      const today = new Date();
      const dateId = today.toISOString().split('T')[0];
      
      // Save to current pod reflection
      const podReflectionRef = doc(this.db, `users/${uid}/podReflections/current`);
      await setDoc(podReflectionRef, {
        summary: reflection,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        dateId: dateId
      }, { merge: true });

      // Also save/update pod entry for today
      const podsRef = collection(this.db, `users/${uid}/pods`);
      const todayQuery = query(podsRef, where('startDate', '==', dateId), limit(1));
      const todaySnapshot = await getDocs(todayQuery);
      
      if (todaySnapshot.empty) {
        // Create new pod entry for today
        const newPodRef = doc(podsRef);
        await setDoc(newPodRef, {
          name: `Pod - ${today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
          startDate: dateId,
          endDate: null,
          reflection: reflection,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          memberCount: 5
        });
      } else {
        // Update existing pod entry
        const podDoc = todaySnapshot.docs[0];
        await setDoc(podDoc.ref, {
          reflection: reflection,
          updatedAt: serverTimestamp()
        }, { merge: true });
      }

      return { success: true };
    } catch (error) {
      console.error('Error saving pod reflection:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get current pod reflection
   */
  async getPodReflection(uid) {
    try {
      const podReflectionRef = doc(this.db, `users/${uid}/podReflections/current`);
      const snapshot = await getDoc(podReflectionRef);
      
      if (snapshot.exists()) {
        const data = snapshot.data();
        return { success: true, reflection: data.summary || '' };
      } else {
        return { success: true, reflection: '' };
      }
    } catch (error) {
      console.error('Error getting pod reflection:', error);
      return { success: false, error: error.message, reflection: '' };
    }
  }

  /**
   * Get crew members based on emotional state similarity and activity
   * Returns users with similar emotional states who were active in last 7 days
   */
  async getCrewMembers(currentUserId, limitCount = 5) {
    try {
      console.log('👥 Getting crew members for user:', currentUserId);
      
      // Get current user's emotional state (average of last 7 days)
      const currentUserMoodData = await this.getMoodChartDataNew(currentUserId, 7);
      if (!currentUserMoodData.success || currentUserMoodData.moodData.length === 0) {
        console.log('⚠️ No mood data for current user, returning empty crew');
        return { success: true, members: [] };
      }

      const currentUserMoods = currentUserMoodData.moodData;
      const avgHappiness = currentUserMoods.reduce((sum, d) => sum + (d.happiness || 50), 0) / currentUserMoods.length;
      const avgEnergy = currentUserMoods.reduce((sum, d) => sum + (d.energy || 50), 0) / currentUserMoods.length;
      const avgStress = currentUserMoods.reduce((sum, d) => sum + (d.stress || 30), 0) / currentUserMoods.length;
      const avgAnxiety = currentUserMoods.reduce((sum, d) => sum + (d.anxiety || 30), 0) / currentUserMoods.length;

      console.log('📊 Current user emotional state:', { avgHappiness, avgEnergy, avgStress, avgAnxiety });

      // Get all users from usersMetadata collection (we'll create this)
      // For now, we'll need to maintain a usersMetadata collection
      // Check if usersMetadata collection exists, if not return empty
      const usersMetadataRef = collection(this.db, 'usersMetadata');
      const usersSnapshot = await getDocs(usersMetadataRef);
      
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

      const potentialMembers = [];

      // Check each user
      for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        if (userId === currentUserId) continue; // Skip current user

        const userData = userDoc.data();
        
        // Check if user is enrolled in crew
        const isEnrolled = userData.crewEnrolled === true;
        if (!isEnrolled) continue;

        // Check if user was active in last 7 days
        const lastActive = userData.lastActive;
        if (!lastActive) continue;
        
        const lastActiveDate = lastActive.toDate ? lastActive.toDate() : new Date(lastActive);
        const lastActiveStr = lastActiveDate.toISOString().split('T')[0];
        
        if (lastActiveStr < sevenDaysAgoStr) continue; // Not active in last 7 days

        // Get user's emotional state
        const userMoodData = await this.getMoodChartDataNew(userId, 7);
        if (!userMoodData.success || userMoodData.moodData.length === 0) continue;

        const userMoods = userMoodData.moodData;
        const userAvgHappiness = userMoods.reduce((sum, d) => sum + (d.happiness || 50), 0) / userMoods.length;
        const userAvgEnergy = userMoods.reduce((sum, d) => sum + (d.energy || 50), 0) / userMoods.length;
        const userAvgStress = userMoods.reduce((sum, d) => sum + (d.stress || 30), 0) / userMoods.length;
        const userAvgAnxiety = userMoods.reduce((sum, d) => sum + (d.anxiety || 30), 0) / userMoods.length;

        // Calculate similarity score (lower difference = more similar)
        const happinessDiff = Math.abs(avgHappiness - userAvgHappiness);
        const energyDiff = Math.abs(avgEnergy - userAvgEnergy);
        const stressDiff = Math.abs(avgStress - userAvgStress);
        const anxietyDiff = Math.abs(avgAnxiety - userAvgAnxiety);
        
        const totalDiff = happinessDiff + energyDiff + stressDiff + anxietyDiff;
        const similarityScore = 400 - totalDiff; // Higher score = more similar

        potentialMembers.push({
          uid: userId,
          displayName: userData.displayName || 'User',
          profilePicture: userData.profilePicture || null,
          similarityScore,
          emotionalState: {
            happiness: userAvgHappiness,
            energy: userAvgEnergy,
            stress: userAvgStress,
            anxiety: userAvgAnxiety
          }
        });
      }

      // Sort by similarity and take top N
      potentialMembers.sort((a, b) => b.similarityScore - a.similarityScore);
      const selectedMembers = potentialMembers.slice(0, limitCount);

      console.log('✅ Found crew members:', selectedMembers.length);
      return { success: true, members: selectedMembers };
    } catch (error) {
      console.error('❌ Error getting crew members:', error);
      return { success: false, error: error.message, members: [] };
    }
  }

  /**
   * Get users who have generated day reflections in the past week
   */
  async getActiveUsersWithReflections(days = 7) {
    try {
      console.log('🔍 Getting active users with reflections in past', days, 'days...');
      
      // Calculate date range - include today and past 7 days
      const today = new Date();
      const dateIds = [];
      for (let i = 0; i <= days; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateId = getDateId(date);
        dateIds.push(dateId);
      }
      
      console.log('📅 Checking date IDs for reflections:', dateIds);
      
      // Get all users
      const usersRef = collection(this.db, 'users');
      const usersSnapshot = await getDocs(usersRef);
      
      console.log('👥 Total users found:', usersSnapshot.size);
      
      const activeUsers = [];
      
      for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        const userData = userDoc.data();
        
        // Get user metadata
        const metadataRef = doc(this.db, `usersMetadata/${userId}`);
        const metadataSnap = await getDoc(metadataRef);
        const metadata = metadataSnap.exists() ? metadataSnap.data() : {};
        
        // Check for reflections in the past week
        let hasRecentReflection = false;
        
        // Check new structure: users/{uid}/days/{dateId}/reflection/meta
        for (const dateId of dateIds) {
          try {
            const reflectionRef = doc(this.db, `users/${userId}/days/${dateId}/reflection/meta`);
            const reflectionSnap = await getDoc(reflectionRef);
            
            if (reflectionSnap.exists()) {
              const reflectionData = reflectionSnap.data();
              // Check if reflection has content (new structure uses 'summary' field)
              if ((reflectionData.summary && reflectionData.summary.trim().length > 0) ||
                  (reflectionData.reflection && reflectionData.reflection.trim().length > 0)) {
                hasRecentReflection = true;
                console.log('✅ Found reflection for', userId, 'on date', dateId);
                break;
              }
            }
          } catch (err) {
            // Document might not exist, continue
            continue;
          }
        }
        
        // Also check old structure: users/{uid}/dayReflections/{dateId}
        if (!hasRecentReflection) {
          for (const dateId of dateIds) {
            try {
              const reflectionRef = doc(this.db, `users/${userId}/dayReflections/${dateId}`);
              const reflectionSnap = await getDoc(reflectionRef);
              
              if (reflectionSnap.exists()) {
                const reflectionData = reflectionSnap.data();
                // Check if reflection has content
                if (reflectionData.reflection && reflectionData.reflection.trim().length > 0) {
                  hasRecentReflection = true;
                  console.log('✅ Found reflection (old structure) for', userId, 'on date', dateId);
                  break;
                }
              }
            } catch (err) {
              continue;
            }
          }
        }
        
        if (hasRecentReflection) {
          activeUsers.push({
            uid: userId,
            displayName: userData.displayName || metadata.displayName || 'User',
            profilePicture: metadata.profilePicture || null,
            email: userData.email
          });
          console.log('✅ Added active user with reflection:', userId, userData.displayName || metadata.displayName || 'User');
        } else {
          console.log(`❌ User ${userId} has no recent reflections`);
        }
      }
      
      console.log('✅ Total active users with reflections found:', activeUsers.length);
      return { success: true, users: activeUsers };
    } catch (error) {
      console.error('❌ Error getting active users with messages:', error);
      return { success: false, error: error.message, users: [] };
    }
  }

  /**
   * Create a crew sphere with members
   */
  async createCrewSphere(creatorUid, memberUids) {
    try {
      const dateId = getDateId(new Date());
      const sphereId = doc(collection(this.db, 'crewSpheres')).id;
      
      // Create sphere document with all members
      const allMembers = [creatorUid, ...memberUids];
      const sphereData = {
        id: sphereId,
        creatorUid: creatorUid,
        members: allMembers,
        createdAt: serverTimestamp(),
        startDate: dateId,
        isActive: true
      };
      
      const sphereRef = doc(this.db, `crewSpheres/${sphereId}`);
      await setDoc(sphereRef, sphereData);
      console.log('✅ Crew sphere document created:', sphereId);
      
      // Also create pod reference for each member so they can see it
      const podCreationResults = [];
      for (const memberUid of allMembers) {
        try {
          const memberPodRef = doc(this.db, `users/${memberUid}/pods/${sphereId}`);
          await setDoc(memberPodRef, {
            name: "Crew's Sphere",
            startDate: dateId,
            sphereId: sphereId,
            members: allMembers,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            memberCount: allMembers.length
          }, { merge: true });
          console.log('✅ Pod document created for member:', memberUid);
          podCreationResults.push({ uid: memberUid, success: true });
        } catch (podError) {
          console.error(`❌ Failed to create pod document for ${memberUid}:`, podError);
          podCreationResults.push({ uid: memberUid, success: false, error: podError.message });
          // Continue creating pod documents for other members even if one fails
        }
      }
      
      // Log summary
      const successful = podCreationResults.filter(r => r.success).length;
      const failed = podCreationResults.filter(r => !r.success).length;
      console.log(`📊 Pod creation summary: ${successful} successful, ${failed} failed`);
      
      // Even if some pod documents failed to create, the sphere is still created
      // The getUserCrewSphere function will find the sphere by checking membership directly
      return { success: true, sphereId, podCreationResults };
    } catch (error) {
      console.error('Error creating crew sphere:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update user metadata for crew matching
   */
  async updateUserMetadata(uid, userData) {
    try {
      const userMetadataRef = doc(this.db, `usersMetadata/${uid}`);
      await setDoc(userMetadataRef, {
        ...userData,
        lastActive: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });
      return { success: true };
    } catch (error) {
      console.error('Error updating user metadata:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get total count of authenticated users/accounts
   */
  async getTotalUserCount() {
    try {
      console.log('👥 Getting total authenticated user count...');
      
      // Check current user first
      let currentUserUid = null;
      try {
        const currentUser = getCurrentUser();
        if (currentUser) {
          currentUserUid = currentUser.uid;
          console.log('👥 Current user UID:', currentUserUid);
        } else {
          console.log('👥 No current user found');
        }
      } catch (authError) {
        console.warn('⚠️ Could not get current user:', authError);
      }
      
      // Primary method: Count from users collection (created by ensureUser)
      // This collection contains all authenticated users
      try {
        const usersRef = collection(this.db, 'users');
        const usersSnapshot = await getDocs(usersRef);
        const usersCount = usersSnapshot.size;
        console.log('👥 Total authenticated users from users collection:', usersCount);
        
        // Always return the count, even if 0, so we can try fallbacks
        if (usersCount > 0) {
          return { success: true, count: usersCount };
        }
        // If 0, continue to fallbacks
        console.log('👥 users collection is empty, trying fallback methods...');
      } catch (usersError) {
        // Check if it's a permission error
        if (usersError.code === 'permission-denied' || usersError.message?.includes('permission')) {
          console.warn('⚠️ Permission denied for users collection. Please deploy Firestore security rules.');
          console.warn('⚠️ See firestore.rules file and deploy it via Firebase Console or CLI.');
        } else {
          console.warn('⚠️ Could not count from users collection:', usersError);
        }
        // Continue to fallbacks
      }
      
      // Fallback 1: Count from usersMetadata collection
      try {
        const usersMetadataRef = collection(this.db, 'usersMetadata');
        const usersMetadataSnapshot = await getDocs(usersMetadataRef);
        const metadataCount = usersMetadataSnapshot.size;
        console.log('👥 Total users from usersMetadata:', metadataCount);
        
        if (metadataCount > 0) {
          return { success: true, count: metadataCount };
        }
      } catch (metadataError) {
        console.warn('⚠️ Could not count from usersMetadata:', metadataError);
      }
      
      // Fallback 2: Count unique users from communityPosts
      try {
        const postsRef = collection(this.db, 'communityPosts');
        const postsSnapshot = await getDocs(postsRef);
        
        const uniqueUserIds = new Set();
        postsSnapshot.forEach((doc) => {
          const data = doc.data();
          if (data.userId) {
            uniqueUserIds.add(data.userId);
          }
        });
        
        const uniqueCount = uniqueUserIds.size;
        console.log('👥 Unique authenticated users from communityPosts:', uniqueCount);
        
        if (uniqueCount > 0) {
          return { success: true, count: uniqueCount };
        }
      } catch (postsError) {
        console.warn('⚠️ Could not count from communityPosts:', postsError);
      }
      
      // Fallback 3: Count unique user UIDs from subcollections using collectionGroup
      // This catches users who have data but no top-level document
      try {
        console.log('👥 Trying to count from user subcollections using collectionGroup...');
        const userUids = new Set();
        
        // Count from users collection first (if any exist)
        const usersRef = collection(this.db, 'users');
        const usersSnapshot = await getDocs(usersRef);
        usersSnapshot.docs.forEach((doc) => {
          userUids.add(doc.id);
        });
        console.log('👥 Users from users collection:', userUids.size);
        
        // Try collectionGroup query for 'days' subcollection
        // Note: This requires a Firestore index. If it fails, we'll catch the error.
        try {
          const allDaysRef = collectionGroup(this.db, 'days');
          const daysSnapshot = await getDocs(allDaysRef);
          
          daysSnapshot.docs.forEach((doc) => {
            // Extract UID from path: users/{uid}/days/{dateId}
            const pathParts = doc.ref.path.split('/');
            if (pathParts.length >= 2 && pathParts[0] === 'users') {
              userUids.add(pathParts[1]);
            }
          });
          console.log('👥 Added users from days subcollection. Total so far:', userUids.size);
        } catch (collectionGroupError) {
          console.warn('⚠️ collectionGroup query failed (may need Firestore index):', collectionGroupError.message);
          // Continue without collectionGroup
        }
        
        // Also try collectionGroup for 'chats' subcollection
        try {
          const allChatsRef = collectionGroup(this.db, 'chats');
          const chatsSnapshot = await getDocs(allChatsRef);
          
          chatsSnapshot.docs.forEach((doc) => {
            const pathParts = doc.ref.path.split('/');
            if (pathParts.length >= 2 && pathParts[0] === 'users') {
              userUids.add(pathParts[1]);
            }
          });
          console.log('👥 Added users from chats subcollection. Total so far:', userUids.size);
        } catch (chatsError) {
          console.warn('⚠️ collectionGroup for chats failed:', chatsError.message);
        }
        
        const totalUniqueUsers = userUids.size;
        console.log('👥 Total unique users from all sources:', totalUniqueUsers);
        
        if (totalUniqueUsers > 0) {
          return { success: true, count: totalUniqueUsers };
        }
      } catch (subcollectionsError) {
        console.warn('⚠️ Could not count from subcollections:', subcollectionsError);
      }
      
      // Final fallback: If current user is logged in, return at least 1
      // This ensures we show at least the current user
      if (currentUserUid) {
        console.log('👥 All counting methods returned 0, but current user exists. Returning 1 as minimum.');
        return { success: true, count: 1 };
      }
      
      // If all methods fail, return 0
      console.log('⚠️ All counting methods returned 0 or failed, and no current user');
      return { success: true, count: 0 };
    } catch (error) {
      console.error('❌ Error getting user count:', error);
      return { success: false, error: error.message, count: 0 };
    }
  }

  /**
   * Get user's crew sphere ID
   * First checks pod documents, then checks if user is a member of any sphere directly
   */
  async getUserCrewSphere(uid) {
    try {
      // Method 1: Get user's pods to find the crew sphere
      const podsRef = collection(this.db, `users/${uid}/pods`);
      const podsSnapshot = await getDocs(podsRef);
      
      for (const podDoc of podsSnapshot.docs) {
        const podData = podDoc.data();
        if (podData.sphereId) {
          // Verify the sphere exists and user is a member
          const sphereRef = doc(this.db, `crewSpheres/${podData.sphereId}`);
          const sphereSnap = await getDoc(sphereRef);
          
          if (sphereSnap.exists()) {
            const sphereData = sphereSnap.data();
            if (sphereData.members && sphereData.members.includes(uid)) {
              return { success: true, sphereId: podData.sphereId, sphere: sphereData };
            }
          }
        }
      }
      
      // Method 2: If no pod document found, check if user is a member of any sphere directly
      // This handles the case where Account 2 is added to a sphere but doesn't have a pod document yet
      // OPTIMIZED: Only query recent spheres to avoid slow full collection scan
      try {
        console.log('🔍 No pod document found, checking recent sphere membership...');
        const spheresRef = collection(this.db, 'crewSpheres');
        // Try to query with ordering first (faster), fallback to simple query if index doesn't exist
        let spheresSnapshot;
        try {
          const recentSpheresQuery = query(spheresRef, orderBy('createdAt', 'desc'), limit(50));
          spheresSnapshot = await getDocs(recentSpheresQuery);
        } catch (orderError) {
          // If index doesn't exist, use simple query with limit
          console.warn('⚠️ Index not found, using simple query:', orderError);
          const simpleQuery = query(spheresRef, limit(50));
          spheresSnapshot = await getDocs(simpleQuery);
        }
        
        for (const sphereDoc of spheresSnapshot.docs) {
          const sphereData = sphereDoc.data();
          if (sphereData.members && Array.isArray(sphereData.members) && sphereData.members.includes(uid)) {
            const sphereId = sphereDoc.id;
            console.log('✅ Found sphere membership for user:', sphereId);
            
            // Create pod document for this user so they can see it in the future (in background)
            const podRef = doc(this.db, `users/${uid}/pods/${sphereId}`);
            const dateId = sphereData.startDate || getDateId(new Date());
            setDoc(podRef, {
              name: "Crew's Sphere",
              startDate: dateId,
              sphereId: sphereId,
              members: sphereData.members,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              memberCount: sphereData.members ? sphereData.members.length : 0
            }, { merge: true }).catch(podError => {
              console.warn('⚠️ Could not create pod document (may not have permission):', podError);
            });
            
            return { success: true, sphereId: sphereId, sphere: sphereData };
          }
        }
      } catch (queryError) {
        console.warn('⚠️ Could not query spheres (permission issue or no index):', queryError);
        // This is okay - we'll just return no sphere found
        // The user will need to wait for the pod document to be created by the sphere creator
      }
      
      return { success: false, sphereId: null };
    } catch (error) {
      console.error('Error getting user crew sphere:', error);
      return { success: false, error: error.message, sphereId: null };
    }
  }

  /**
   * Sync pod documents for a user - ensures they have pod documents for all spheres they're a member of
   * This is useful when Account 2 logs in and needs to see spheres they were added to
   * OPTIMIZED: Only checks recent spheres (last 50) to avoid slow full collection scan
   */
  async syncUserPodDocuments(uid) {
    try {
      console.log('🔄 Syncing pod documents for user:', uid);
      
      // OPTIMIZED: Only get recent spheres (last 50) to avoid slow full collection scan
      const spheresRef = collection(this.db, 'crewSpheres');
      let spheresSnapshot;
      try {
        // Try to query with ordering first (faster), fallback to simple query if index doesn't exist
        const recentSpheresQuery = query(spheresRef, orderBy('createdAt', 'desc'), limit(50));
        spheresSnapshot = await getDocs(recentSpheresQuery);
      } catch (orderError) {
        // If index doesn't exist, use simple query with limit
        console.warn('⚠️ Index not found, using simple query:', orderError);
        const simpleQuery = query(spheresRef, limit(50));
        spheresSnapshot = await getDocs(simpleQuery);
      }
      
      let syncedCount = 0;
      const podPromises = [];
      
      for (const sphereDoc of spheresSnapshot.docs) {
        const sphereData = sphereDoc.data();
        const sphereId = sphereDoc.id;
        
        if (sphereData.members && Array.isArray(sphereData.members) && sphereData.members.includes(uid)) {
          // Check if pod document already exists (in parallel)
          const podRef = doc(this.db, `users/${uid}/pods/${sphereId}`);
          podPromises.push(
            getDoc(podRef).then(async (podSnap) => {
              if (!podSnap.exists()) {
                // Create pod document
                try {
                  const dateId = sphereData.startDate || getDateId(new Date());
                  await setDoc(podRef, {
                    name: "Crew's Sphere",
                    startDate: dateId,
                    sphereId: sphereId,
                    members: sphereData.members,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                    memberCount: sphereData.members ? sphereData.members.length : 0
                  }, { merge: true });
                  console.log('✅ Created missing pod document for sphere:', sphereId);
                  return 1;
                } catch (podError) {
                  console.warn(`⚠️ Could not create pod document for sphere ${sphereId}:`, podError);
                  return 0;
                }
              }
              return 0;
            }).catch(err => {
              console.warn(`⚠️ Error checking pod for sphere ${sphereId}:`, err);
              return 0;
            })
          );
        }
      }
      
      // Wait for all pod checks/creates to complete in parallel
      const results = await Promise.all(podPromises);
      syncedCount = results.reduce((sum, count) => sum + count, 0);
      
      console.log(`✅ Pod sync complete: ${syncedCount} pod documents created`);
      return { success: true, syncedCount };
    } catch (error) {
      console.error('Error syncing pod documents:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Save message to crew sphere
   */
  async saveCrewSphereMessage(sphereId, senderUid, messageData) {
    try {
      const messageRef = doc(collection(this.db, `crewSpheres/${sphereId}/messages`));
      const messageDoc = {
        id: messageRef.id,
        senderUid: senderUid,
        senderName: messageData.senderName || 'User',
        message: messageData.message || '',
        image: messageData.image || null,
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp()
      };
      
      await setDoc(messageRef, messageDoc);
      
      return { success: true, messageId: messageRef.id };
    } catch (error) {
      console.error('Error saving crew sphere message:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get messages from crew sphere
   */
  async getCrewSphereMessages(sphereId) {
    try {
      const messagesRef = collection(this.db, `crewSpheres/${sphereId}/messages`);
      const q = query(messagesRef, orderBy('timestamp', 'asc'));
      const snapshot = await getDocs(q);
      
      const messages = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        messages.push({
          id: doc.id,
          senderUid: data.senderUid,
          sender: data.senderName || 'User',
          message: data.message || '',
          image: data.image || null,
          timestamp: data.timestamp?.toDate() || data.createdAt?.toDate() || new Date(),
          time: (data.timestamp?.toDate() || data.createdAt?.toDate() || new Date()).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
        });
      });
      
      return { success: true, messages };
    } catch (error) {
      console.error('Error getting crew sphere messages:', error);
      return { success: false, error: error.message, messages: [] };
    }
  }

  /**
   * Set up real-time listener for crew sphere messages
   */
  subscribeToCrewSphereMessages(sphereId, callback) {
    try {
      const messagesRef = collection(this.db, `crewSpheres/${sphereId}/messages`);
      const q = query(messagesRef, orderBy('timestamp', 'asc'));
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const messages = [];
        snapshot.forEach(doc => {
          const data = doc.data();
          messages.push({
            id: doc.id,
            senderUid: data.senderUid,
            sender: data.senderName || 'User',
            message: data.message || '',
            image: data.image || null,
            timestamp: data.timestamp?.toDate() || data.createdAt?.toDate() || new Date(),
            time: (data.timestamp?.toDate() || data.createdAt?.toDate() || new Date()).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
          });
        });
        callback(messages);
      }, (error) => {
        console.error('Error in crew sphere messages listener:', error);
        callback([]);
      });
      
      return unsubscribe;
    } catch (error) {
      console.error('Error setting up crew sphere messages listener:', error);
      return () => {}; // Return empty unsubscribe function
    }
  }
}

export default new FirestoreService();
