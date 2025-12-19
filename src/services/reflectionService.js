import firestoreService from './firestoreService';
import { getDateId } from '../utils/dateUtils';

class ReflectionService {
  constructor() {
<<<<<<< HEAD
    // Use CORS proxy if available, otherwise fallback to direct URL
    this.proxyURL = 'http://localhost:3001';
    this.baseURL = 'https://rr9rd9oc5khoyk-11434.proxy.runpod.net/';
    this.useProxy = true; // Try proxy first
=======
    this.apiKey = process.env.REACT_APP_GOOGLE_API_KEY || '';
    this.baseURL = 'https://generativelanguage.googleapis.com/v1beta/models';
    this.modelName = 'gemini-pro';
>>>>>>> 8e6a6ff7 (Refactor API key management across multiple services to utilize environment variables. Updated EmotionalWellbeing, ChatService, EmotionalAnalysisService, HabitAnalysisService, PatternAnalysisService, and ReflectionService to enhance security and maintainability by removing hardcoded API keys.)
    this.greetings = ['hey', 'hi', 'hello', 'hii', 'hiii', 'hiiii', 'sup', 'yo', 'what\'s up', 'wassup'];
  }

  isSimpleGreeting(message) {
    const cleanMsg = message.toLowerCase().trim();
    return this.greetings.some(greeting => 
      cleanMsg === greeting || 
      cleanMsg === greeting + '!' || 
      cleanMsg === greeting + '.'
    );
  }

  async generateReflection(messages) {
    console.log('🔄 Starting reflection generation...');
    console.log('🔍 REFLECTION DEBUG: messages type:', typeof messages, 'length:', messages?.length);
    
    // Safety check and fix for messages
    if (!messages || !Array.isArray(messages)) {
      console.error('❌ REFLECTION ERROR: Invalid messages array, using fallback');
      return "Had a brief chat with Deite today.";
    }
    
    console.log('💬 Total messages for reflection:', messages.length);
    
    // Filter out system messages, whisper session messages, and get meaningful messages
    const userMessages = messages
      .filter(msg => msg.sender === 'user' && !msg.isWhisperSession)
      .map(msg => msg.text.trim())
      .filter(text => !this.isSimpleGreeting(text) && text.length > 3);

    const aiMessages = messages
      .filter(msg => msg.sender === 'ai' && !msg.isWhisperSession)
      .map(msg => msg.text.trim());

    console.log('📝 User messages:', userMessages.length);
    console.log('🤖 AI messages:', aiMessages.length);

    if (userMessages.length === 0) {
      return "Had a brief chat with Deite today but didn't share much.";
    }

    // Generate AI summary with safe fallback
    try {
      const aiSummary = await this.generateAISummary(userMessages, aiMessages);
      return aiSummary;
    } catch (err) {
      console.error('⚠️ Reflection generation via API failed, using fallback:', err?.message || err);
      return this.createFallbackSummary(userMessages, aiMessages);
    }
  }

  async generateAISummary(userMessages, aiMessages) {
    console.log('🤖 Starting AI day summary generation...');
    
    // Create a conversation context for the AI
    const conversationContext = this.buildConversationContext(userMessages, aiMessages);
    console.log('📋 Conversation context created');
    
    // Calculate total character count from user messages
    const userCharacterCount = userMessages.reduce((total, msg) => total + msg.length, 0);
    const maxReflectionCharacters = userCharacterCount * 2; // Reflection must not exceed 2x user characters
    
    console.log(`📊 User wrote ${userCharacterCount} characters. Reflection limit: ${maxReflectionCharacters} characters (2x user input).`);
    
    // Count total meaningful messages for length adjustment
    const totalMessages = userMessages.length;
    
    // Estimate tokens from character count (roughly 1 token = 4 characters for English text)
    // But we'll use a more conservative estimate to ensure we stay under the limit
    const estimatedMaxTokensFromChars = Math.floor(maxReflectionCharacters / 3); // Conservative: 3 chars per token
    
    // Size instructions based on message count - STRICT length control
    let sizeInstructions, maxTokens;
    if (totalMessages <= 3) {
      sizeInstructions = `14. REFLECTION LENGTH - CRITICAL: Write ONLY 2-3 sentences maximum. Keep it very short and concise.`;
      maxTokens = Math.min(100, estimatedMaxTokensFromChars);
    } else if (totalMessages <= 7) {
      sizeInstructions = `14. REFLECTION LENGTH - Write a short reflection (3-4 sentences maximum). Keep it concise.`;
      maxTokens = Math.min(150, estimatedMaxTokensFromChars);
    } else if (totalMessages <= 15) {
      sizeInstructions = `14. REFLECTION LENGTH - Write a medium reflection (4-5 sentences maximum). Still keep it concise.`;
      maxTokens = Math.min(200, estimatedMaxTokensFromChars);
    } else {
      sizeInstructions = `14. REFLECTION LENGTH - Write a slightly longer reflection (5-6 sentences maximum). Keep it concise and focused.`;
      maxTokens = Math.min(250, estimatedMaxTokensFromChars);
    }
    
    // Ensure we never exceed the character limit
    // Add explicit character limit instruction
    const characterLimitInstruction = `16. CHARACTER LIMIT - CRITICAL: The reflection must NEVER exceed ${maxReflectionCharacters} characters (which is 2x the ${userCharacterCount} characters the user wrote). Always stay within this strict limit.`;
    
    const reflectionPrompt = `Write a natural, first-person diary entry about this day. Tell the story of what happened and how it felt.

CRITICAL REQUIREMENTS:
1. WRITE IN FIRST PERSON - Use "I", "my", "me" - this is a personal diary entry
2. NO META-COMMENTARY - Do NOT say "Here is a diary entry" or "summarizing the day" or mention "user" - just tell the story directly
3. FOCUS ON WHAT HAPPENED - Write about the actual events, conversations, and experiences from the day
4. CAPTURE THE FEELING - Include emotions and how things felt, but naturally woven into the story
5. BE SPECIFIC - Mention real events, people, or activities that were discussed
6. NATURAL STORYTELLING - Write like someone naturally reflecting on their day, not like an analysis or summary
7. USE AS LITTLE TIME/SPACE AS APPROPRIATE - Keep it concise, focus on what matters most
8. NO REPEATED "DEITE SAID..." - Do NOT repeatedly say "Deite said..." or "Deite told me..." - just mention what was discussed naturally
9. NO "DEITE ASKED ME..." - Do NOT say "Deite asked me..." - just write about the topics naturally
10. NO LONG DESCRIPTIONS OF DEITE'S ACTIONS - Do NOT write long descriptions of what Deite did or how Deite responded - focus on YOUR experience and reflections
11. FEEL LIKE A PERSONAL REFLECTION - The diary should feel natural and personal, like you're reflecting on your own day, not describing an AI conversation
12. AVOID DRAMATIC LINES - Do NOT use overly dramatic phrases like "It was crazy", "it gave me all the feels", "it was absolutely amazing", etc. UNLESS something truly extraordinary or life-changing happened. Keep the tone grounded and realistic - avoid too much dramatic storytelling for ordinary days.
13. NO REFLECTIVE CLOSING SENTENCES - Do NOT include reflective or moral closing sentences such as "it lifted my mood", "it made me feel seen", "it reminded me of something", "it was a good day", "it helped me realize", etc. End the diary naturally after describing the events or thoughts of the day, without summarizing emotions or giving life lessons. Just describe what happened and stop - no need to wrap it up with emotional conclusions.
14. NO POSITIVITY ABOUT TALKING TO DEITE - Do NOT add statements like "talking to Deite made me feel better", "chatting with Deite helped", "Deite made me feel", or any positive statements about the conversation itself. ONLY summarize what the user expressed and how their day emotionally felt - do NOT comment on the conversation or its effects.
15. ONLY SUMMARIZE USER'S EXPRESSION - Focus ONLY on summarizing what the user expressed in their messages and how their day emotionally felt. Do NOT add commentary about the conversation, Deite's responses, or how talking to Deite affected them.
${sizeInstructions}
${characterLimitInstruction}

Conversation with Deite:
${conversationContext}

Write a natural diary entry about this day in first person. Just tell the story of what happened and how it felt. Focus ONLY on summarizing what the user expressed and how their day emotionally felt. Do NOT add any statements about talking to Deite, how Deite helped, or how the conversation made you feel. Keep it grounded and realistic, avoiding dramatic language unless something truly extraordinary happened. End naturally after describing events - do NOT add reflective closing sentences about how things made you feel or what you learned.

CRITICAL: The reflection must NEVER exceed ${maxReflectionCharacters} characters (2x the ${userCharacterCount} characters the user wrote). Always stay within this strict character limit.`;

    // Minimal diagnostics to ensure we're not sending an empty prompt
    console.log('🧪 Reflection prompt length:', reflectionPrompt.length);
    console.log('🧪 Reflection prompt preview:', reflectionPrompt.slice(0, 200));

    console.log('🌐 Making API call to RunPod for reflection...');

    // Go directly to llama3:70b - skip model check
    const modelToUse = 'llama3:70b';
    
    // Try proxy first, fallback to direct URL if proxy fails
    let apiUrl = this.useProxy ? `${this.proxyURL}/api/generate` : `${this.baseURL}api/generate`;
    
      try {
      console.log(`🔄 Using model: ${modelToUse} for reflection`);
      console.log(`🌐 Day reflection API URL: ${apiUrl}`);
      
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 120 seconds
        
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
          model: modelToUse,
            prompt: reflectionPrompt,
            stream: false,
            options: {
              temperature: 0.5,  // Lower temperature for more accurate, focused summaries
              top_p: 0.9,
              max_tokens: maxTokens  // Dynamic token limit based on message count for concise reflections
            }
          }),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);

      console.log(`📥 Response status for ${modelToUse}:`, response.status);

        if (!response.ok) {
          const errorText = await response.text();
        console.error(`❌ RunPod API Error for ${modelToUse}:`, response.status, errorText);
        throw new Error(`Reflection generation failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
      console.log(`✅ RunPod response received for day summary with ${modelToUse}`);
        
        // Accept multiple possible fields from providers
        const text = (data && (data.response ?? data.output ?? data.message?.content)) || '';
        if (typeof text === 'string' && text.trim()) {
          let summary = text.trim();
          
          // Enforce character limit: reflection must not exceed 2x user character count
          if (summary.length > maxReflectionCharacters) {
            console.warn(`⚠️ Generated reflection (${summary.length} chars) exceeds limit (${maxReflectionCharacters} chars). Truncating...`);
            // Truncate to the character limit, trying to end at a sentence boundary
            summary = summary.substring(0, maxReflectionCharacters);
            // Try to find the last sentence ending (., !, ?) before the limit
            const lastSentenceEnd = Math.max(
              summary.lastIndexOf('.'),
              summary.lastIndexOf('!'),
              summary.lastIndexOf('?')
            );
            if (lastSentenceEnd > maxReflectionCharacters * 0.7) {
              // If we found a sentence end reasonably close to the limit, use it
              summary = summary.substring(0, lastSentenceEnd + 1);
            }
            console.log(`✅ Truncated reflection to ${summary.length} characters (within ${maxReflectionCharacters} limit)`);
          }
          
          console.log(`📖 Generated day summary: ${summary.length} characters (limit: ${maxReflectionCharacters})`);
          return summary;
        } else {
        console.error(`❌ Invalid response format from ${modelToUse}:`, data);
          console.log('🔍 Full response data:', JSON.stringify(data, null, 2));
        throw new Error('Invalid response format from reflection API');
        }
    } catch (error) {
      console.error(`💥 Error with model ${modelToUse}:`, error.message);
      
      // If proxy failed and we were using proxy, try direct URL
      if (this.useProxy && apiUrl.includes('localhost:3001')) {
        console.log('🔄 Proxy failed for day reflection, trying direct URL...');
        this.useProxy = false;
        apiUrl = `${this.baseURL}api/generate`;
        
        try {
          const directController = new AbortController();
          const directTimeoutId = setTimeout(() => directController.abort(), 120000);
          
          const directResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: modelToUse,
              prompt: reflectionPrompt,
              stream: false,
              options: {
                temperature: 0.5,
                top_p: 0.9,
                max_tokens: maxTokens
              }
            }),
            signal: directController.signal
          });
          
          clearTimeout(directTimeoutId);
          
          if (directResponse.ok) {
            const data = await directResponse.json();
            const text = (data && (data.response ?? data.output ?? data.message?.content)) || '';
            if (typeof text === 'string' && text.trim()) {
              let summary = text.trim();
              
              // Enforce character limit
              if (summary.length > maxReflectionCharacters) {
                summary = summary.substring(0, maxReflectionCharacters);
                const lastSentenceEnd = Math.max(
                  summary.lastIndexOf('.'),
                  summary.lastIndexOf('!'),
                  summary.lastIndexOf('?')
                );
                if (lastSentenceEnd > maxReflectionCharacters * 0.7) {
                  summary = summary.substring(0, lastSentenceEnd + 1);
                }
              }
              
              console.log('✅ Direct URL worked for day reflection');
              return summary;
            }
          }
        } catch (directError) {
          console.error('❌ Direct URL also failed for day reflection:', directError);
        }
      }
      
      throw error;
    }
  }

  createFallbackSummary(userMessages, aiMessages) {
    const lastUser = userMessages[userMessages.length - 1] || '';
    const firstUser = userMessages[0] || '';
    const base = (firstUser !== lastUser) ? `${firstUser} ... ${lastUser}` : lastUser;
    const trimmed = base.slice(0, 220);
    return `Today I chatted with Deite about: "${trimmed}${base.length > 220 ? '...' : ''}". It was nice to talk through my day and get some perspective.`;
  }

  buildConversationContext(userMessages, aiMessages) {
    let context = '';
    
    // Build a detailed conversation flow for better day summaries
    // Include more context to capture emotional depth and important topics
    userMessages.forEach((userMsg, index) => {
      context += `User: "${userMsg}"\n`;
      if (aiMessages[index]) {
        // Include more of the AI response to capture the emotional journey and context
        // Increased from 200 to 300 characters to better capture full context
        const aiResponse = aiMessages[index].substring(0, 300);
        context += `Deite: "${aiResponse}${aiMessages[index].length > 300 ? '...' : ''}"\n\n`;
      }
    });
    
    // Add a summary note at the end to help the AI identify key themes
    if (context.length > 0) {
      context += `\n---\nPlease analyze this conversation carefully and identify:\n`;
      context += `1. Key events or topics discussed (loss, grief, achievements, challenges, etc.)\n`;
      context += `2. Emotional tone (sad, grieving, happy, stressed, anxious, etc.)\n`;
      context += `3. Important details that should be reflected in the diary entry\n`;
    }
    
    return context.trim();
  }

  async generateNarrativeDiaryStory(messages) {
    console.log('📖 Starting narrative diary story generation...');
    console.log('🔍 NARRATIVE DEBUG: messages type:', typeof messages, 'length:', messages?.length);
    
    // Safety check and fix for messages
    if (!messages || !Array.isArray(messages)) {
      console.error('❌ NARRATIVE ERROR: Invalid messages array, using fallback');
      return "Today was a day like any other, filled with small moments and quiet thoughts.";
    }
    
    console.log('💬 Total messages for narrative story:', messages.length);
    
    // Filter out system messages, whisper session messages, and get meaningful messages
    const userMessages = messages
      .filter(msg => msg.sender === 'user' && !msg.isWhisperSession)
      .map(msg => msg.text.trim())
      .filter(text => !this.isSimpleGreeting(text) && text.length > 3);

    const aiMessages = messages
      .filter(msg => msg.sender === 'ai' && !msg.isWhisperSession)
      .map(msg => msg.text.trim());

    console.log('📝 User messages:', userMessages.length);
    console.log('🤖 AI messages:', aiMessages.length);

    if (userMessages.length === 0) {
      return "Today unfolded quietly, a gentle day where thoughts drifted like clouds across a calm sky.";
    }

    // Generate narrative diary story with safe fallback
    try {
      const narrativeStory = await this.generateAINarrativeStory(userMessages, aiMessages);
      return narrativeStory;
    } catch (err) {
      console.error('⚠️ Narrative story generation via API failed, using fallback:', err?.message || err);
      return this.createFallbackNarrative(userMessages, aiMessages);
    }
  }

  async generateAINarrativeStory(userMessages, aiMessages) {
    console.log('🤖 Starting AI narrative diary story generation...');
    
    // Create a conversation context for the AI
    const conversationContext = this.buildConversationContext(userMessages, aiMessages);
    console.log('📋 Conversation context created for narrative');
    
    // Calculate dynamic token limit based on number of messages and topics
    const totalMessages = userMessages.length + aiMessages.length;
    
    // Estimate number of topics by looking at unique conversation themes
    // Simple heuristic: more messages = more topics, but cap the growth
    const estimatedTopics = Math.min(Math.ceil(totalMessages / 3), 5); // Cap at 5 topics
    
    let maxTokens, sentenceGuidance;
    
    if (totalMessages <= 3) {
      // Very short conversation - brief reflection
      maxTokens = 80;
      sentenceGuidance = "1-2 sentences";
    } else if (totalMessages <= 6) {
      // Short conversation - concise reflection
      maxTokens = 120;
      sentenceGuidance = "2 sentences";
    } else if (totalMessages <= 10) {
      // Medium conversation - moderate reflection
      maxTokens = 150;
      sentenceGuidance = "2-3 sentences";
    } else if (totalMessages <= 15) {
      // Longer conversation - detailed reflection
      maxTokens = 180;
      sentenceGuidance = "3 sentences";
    } else {
      // Very long conversation - comprehensive but still concise reflection
      maxTokens = 200;
      sentenceGuidance = "3-4 sentences";
    }
    
    console.log(`📊 Message count: ${totalMessages}, Estimated topics: ${estimatedTopics}, Setting max_tokens to ${maxTokens} for ${sentenceGuidance} reflection`);
    
    const narrativePrompt = `Write a SHORT, natural, first-person diary entry about this day. Keep it brief and concise - mention all key topics but don't elaborate too much.

CRITICAL REQUIREMENTS:
1. WRITE IN FIRST PERSON - Use "I", "my", "me" - this is a personal diary entry
2. NO META-COMMENTARY - Do NOT say "Here is a diary entry" or "summarizing the day" or mention "user" or "person" - just tell the story directly
3. NO ANALYSIS - Do NOT add analysis sections, bullet points, lists, or explanations - ONLY tell the story
4. BE BRIEF - Write ${sentenceGuidance} maximum. Keep it short and concise. Use as little time/space as appropriate - focus on what matters most.
5. COVER ALL TOPICS - Briefly mention the key events, conversations, or experiences discussed (about ${estimatedTopics} main topics)
6. INCLUDE EMOTIONS - Naturally weave in how things felt (sad, happy, excited, etc.) without being explicit about it
7. NATURAL STORYTELLING - Write like someone naturally reflecting on their day in a brief way
8. BE SPECIFIC BUT CONCISE - Mention real events, people, or activities, but keep descriptions brief
9. NO REPEATED "DEITE SAID..." - Do NOT repeatedly say "Deite said..." or "Deite told me..." - just mention what was discussed naturally
10. NO "DEITE ASKED ME..." - Do NOT say "Deite asked me..." - just write about the topics naturally
11. NO LONG DESCRIPTIONS OF DEITE'S ACTIONS - Do NOT write long descriptions of what Deite did or how Deite responded - focus on YOUR experience and reflections
12. FEEL LIKE A PERSONAL REFLECTION - The diary should feel natural and personal, like you're reflecting on your own day, not describing an AI conversation
13. AVOID DRAMATIC LINES - Do NOT use overly dramatic phrases like "It was crazy", "it gave me all the feels", "it was absolutely amazing", etc. UNLESS something truly extraordinary or life-changing happened. Keep the tone grounded and realistic - avoid too much dramatic storytelling for ordinary days.
14. NO REFLECTIVE CLOSING SENTENCES - Do NOT include reflective or moral closing sentences such as "it lifted my mood", "it made me feel seen", "it reminded me of something", "it was a good day", "it helped me realize", etc. End the diary naturally after describing the events or thoughts of the day, without summarizing emotions or giving life lessons. Just describe what happened and stop - no need to wrap it up with emotional conclusions.

Conversation with Deite:
${conversationContext}

Write a SHORT, natural diary entry about this day in first person. Write ${sentenceGuidance} maximum, briefly covering all key topics and emotions. Focus on YOUR experience and reflections, not on describing what Deite said or did. Keep it grounded and realistic, avoiding dramatic language unless something truly extraordinary happened. End naturally after describing events - do NOT add reflective closing sentences about how things made you feel or what you learned:`;

    console.log('🧪 Narrative prompt length:', narrativePrompt.length);
    console.log('🧪 Narrative prompt preview:', narrativePrompt.slice(0, 200));

    console.log('🌐 Making API call to RunPod for narrative story...');

    // Go directly to llama3:70b - skip model check
    const modelToUse = 'llama3:70b';
    
    // Try proxy first, fallback to direct URL if proxy fails
    let apiUrl = this.useProxy ? `${this.proxyURL}/api/generate` : `${this.baseURL}api/generate`;
    
    try {
      console.log(`🔄 Using model: ${modelToUse} for narrative story`);
      console.log(`🌐 Narrative story API URL: ${apiUrl}`);
      
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 120 seconds
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelToUse,
          prompt: narrativePrompt,
          stream: false,
          options: {
            temperature: 0.7,  // Slightly higher temperature for more natural, creative storytelling
            top_p: 0.9,
            max_tokens: maxTokens  // Dynamic token limit based on message count
          }
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      console.log(`📥 Response status for ${modelToUse}:`, response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ RunPod API Error for ${modelToUse}:`, response.status, errorText);
        throw new Error(`Narrative story generation failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`✅ RunPod response received for narrative story with ${modelToUse}`);
        
      // Accept multiple possible fields from providers
      const text = (data && (data.response ?? data.output ?? data.message?.content)) || '';
      if (typeof text === 'string' && text.trim()) {
        const story = text.trim();
        console.log('📖 Generated narrative diary story:', story);
        return story;
      } else {
        console.error(`❌ Invalid response format from ${modelToUse}:`, data);
        console.log('🔍 Full response data:', JSON.stringify(data, null, 2));
        throw new Error('Invalid response format from narrative story API');
      }
    } catch (error) {
      console.error(`💥 Error with model ${modelToUse}:`, error.message);
      
      // If proxy failed and we were using proxy, try direct URL
      if (this.useProxy && apiUrl.includes('localhost:3001')) {
        console.log('🔄 Proxy failed for narrative story, trying direct URL...');
        this.useProxy = false;
        apiUrl = `${this.baseURL}api/generate`;
        
        try {
          const directController = new AbortController();
          const directTimeoutId = setTimeout(() => directController.abort(), 120000);
          
          const directResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: modelToUse,
              prompt: narrativePrompt,
              stream: false,
              options: {
                temperature: 0.7,
                top_p: 0.9,
                max_tokens: maxTokens
              }
            }),
            signal: directController.signal
          });
          
          clearTimeout(directTimeoutId);
          
          if (directResponse.ok) {
            const data = await directResponse.json();
            const text = (data && (data.response ?? data.output ?? data.message?.content)) || '';
            if (typeof text === 'string' && text.trim()) {
              const story = text.trim();
              console.log('✅ Direct URL worked for narrative story');
              return story;
            }
          }
        } catch (directError) {
          console.error('❌ Direct URL also failed for narrative story:', directError);
        }
      }
      
      throw error;
    }
  }

  createFallbackNarrative(userMessages, aiMessages) {
    const lastUser = userMessages[userMessages.length - 1] || '';
    const firstUser = userMessages[0] || '';
    const combined = (firstUser !== lastUser) ? `${firstUser} ... ${lastUser}` : lastUser;
    const trimmed = combined.slice(0, 200);
    return `Today I found myself reflecting on ${trimmed}${combined.length > 200 ? '...' : ''}. It was a day that brought its own rhythm, its own quiet moments of thought and conversation.`;
  }

  async saveReflection(userId, dateId, reflection) {
    try {
      console.log('💾 Saving reflection...');
      console.log('🔍 SAVE DEBUG: userId:', userId, 'dateId:', dateId, 'reflection length:', reflection?.length);
      
      // Analyze reflection for mood and insights
      const analysis = this.analyzeReflection(reflection);
      
      // Use new structure for saving reflections
      const reflectionData = {
        summary: reflection,
        mood: analysis.mood.toLowerCase(),
        score: analysis.score,
        insights: analysis.insights,
        source: 'auto'
      };
      
      console.log('🔍 SAVE DEBUG: Reflection data:', reflectionData);
      
      // Save to Firestore with new structure
      const result = await firestoreService.saveReflectionNew(userId, dateId, reflectionData);
      console.log('✅ Reflection saved successfully to Firestore (new structure)');
      
      // Also save to localStorage as backup
      localStorage.setItem(`reflection_${dateId}`, reflection);
      console.log('✅ Reflection saved to localStorage as backup');
      
      return result;
    } catch (error) {
      console.error('❌ Error saving reflection:', error);
      // Fallback to localStorage only
      localStorage.setItem(`reflection_${dateId}`, reflection);
      console.log('✅ Reflection saved to localStorage (fallback)');
      return { success: true };
    }
  }

  async getReflection(userId, dateId) {
    try {
      console.log('📖 GET DEBUG: Getting reflection for userId:', userId, 'dateId:', dateId);
      
      // Try new Firestore structure first
      const result = await firestoreService.getReflectionNew(userId, dateId);
      console.log('📖 GET DEBUG: New Firestore result:', result);
      
      if (result.success && result.reflection) {
        console.log('📖 GET DEBUG: Found in new Firestore structure:', result.reflection);
        return { 
          success: true, 
          reflection: result.reflection
        };
      }
      
      // Fallback to localStorage
      const localReflection = localStorage.getItem(`reflection_${dateId}`);
      if (localReflection) {
        console.log('📖 GET DEBUG: Found in localStorage:', localReflection);
        return { success: true, reflection: localReflection };
      }
      
      console.log('📖 GET DEBUG: No reflection found anywhere');
      return { success: true, reflection: null };
    } catch (error) {
      console.error('❌ Error getting reflection:', error);
      // Fallback to localStorage only
      const localReflection = localStorage.getItem(`reflection_${dateId}`);
      return { 
        success: true, 
        reflection: localReflection || null 
      };
    }
  }

  analyzeReflection(reflection) {
    const lowerReflection = reflection.toLowerCase();
    
    // Simple mood analysis based on keywords
    const moodKeywords = {
      'Happy': ['happy', 'good', 'great', 'excited', 'positive', 'hopeful'],
      'Sad': ['sad', 'down', 'depressed', 'upset', 'disappointed'],
      'Anxious': ['anxious', 'worried', 'nervous', 'stressed', 'overwhelmed'],
      'Angry': ['angry', 'frustrated', 'annoyed', 'mad'],
      'Peaceful': ['calm', 'peaceful', 'relaxed', 'content'],
      'Neutral': []
    };

    let detectedMood = 'Neutral';
    let maxScore = 0;

    for (const [mood, keywords] of Object.entries(moodKeywords)) {
      if (mood === 'Neutral') continue;
      
      const score = keywords.reduce((count, keyword) => {
        return count + (lowerReflection.includes(keyword) ? 1 : 0);
      }, 0);
      
      if (score > maxScore) {
        maxScore = score;
        detectedMood = mood;
      }
    }

    // Calculate score (0-100) based on mood
    let score = 50; // neutral baseline
    switch (detectedMood) {
      case 'Happy':
      case 'Peaceful':
        score = 75 + Math.min(25, maxScore * 5);
        break;
      case 'Sad':
      case 'Angry':
        score = Math.max(15, 40 - maxScore * 5);
        break;
      case 'Anxious':
        score = Math.max(25, 45 - maxScore * 3);
        break;
      default:
        score = 50;
    }

    // Extract insights
    const insights = [];
    if (lowerReflection.includes('work')) insights.push('Work discussion');
    if (lowerReflection.includes('relationship') || lowerReflection.includes('family')) insights.push('Relationship focus');
    if (lowerReflection.includes('health')) insights.push('Health consideration');
    if (lowerReflection.includes('future') || lowerReflection.includes('plan')) insights.push('Future planning');
    if (lowerReflection.includes('stress') || lowerReflection.includes('anxiety')) insights.push('Stress management');

    return {
      mood: detectedMood,
      score: Math.round(score),
      insights: insights.length > 0 ? insights : ['General reflection']
    };
  }

  /**
   * Generate crew reflection from crew sphere chat messages
   * Similar to day reflection but analyzes crew sphere group chat instead
   */
  async generateCrewReflection(crewMessages) {
    console.log('🔄 Starting crew reflection generation...');
    console.log('🔍 CREW REFLECTION DEBUG: messages type:', typeof crewMessages, 'length:', crewMessages?.length);
    
    // Safety check and fix for messages
    if (!crewMessages || !Array.isArray(crewMessages)) {
      console.error('❌ CREW REFLECTION ERROR: Invalid messages array, using fallback');
      return "Had a brief chat with the crew today.";
    }
    
    console.log('💬 Total crew messages for reflection:', crewMessages.length);
    
    // Filter out simple greetings and get meaningful messages
    // Crew messages have structure: { sender, message, senderUid, timestamp, etc. }
    const userMessages = crewMessages
      .filter(msg => msg.senderUid && msg.sender !== 'AI' && msg.message)
      .map(msg => msg.message.trim())
      .filter(text => !this.isSimpleGreeting(text) && text.length > 3);

    const aiMessages = crewMessages
      .filter(msg => msg.sender === 'AI' && msg.message)
      .map(msg => msg.message.trim());

    console.log('📝 User messages in crew:', userMessages.length);
    console.log('🤖 AI messages in crew:', aiMessages.length);

    if (userMessages.length === 0) {
      return "Had a brief chat with the crew today but didn't share much.";
    }

    // Generate AI summary with safe fallback
    try {
      const aiSummary = await this.generateCrewAISummary(userMessages, aiMessages);
      return aiSummary;
    } catch (err) {
      console.error('⚠️ Crew reflection generation via API failed, using fallback:', err?.message || err);
      return this.createFallbackCrewSummary(userMessages, aiMessages);
    }
  }

  async generateCrewAISummary(userMessages, aiMessages) {
    console.log('🤖 Starting AI crew summary generation...');
    
    // Create a conversation context for the AI
    const conversationContext = this.buildCrewConversationContext(userMessages, aiMessages);
    console.log('📋 Crew conversation context created');
    
    // Calculate total character count from user messages
    const userCharacterCount = userMessages.reduce((total, msg) => total + msg.length, 0);
    const maxReflectionCharacters = userCharacterCount * 2; // Reflection must not exceed 2x user characters
    
    console.log(`📊 Users wrote ${userCharacterCount} characters. Reflection limit: ${maxReflectionCharacters} characters (2x user input).`);
    
    // Count total meaningful messages for length adjustment
    const totalMessages = userMessages.length;
    
    // Estimate tokens from character count (roughly 1 token = 4 characters for English text)
    const estimatedMaxTokensFromChars = Math.floor(maxReflectionCharacters / 3); // Conservative: 3 chars per token
    
    // Size instructions based on message count - STRICT length control
    let sizeInstructions, maxTokens;
    if (totalMessages <= 3) {
      sizeInstructions = `14. REFLECTION LENGTH - CRITICAL: Write ONLY 2-3 sentences maximum. Keep it very short and concise.`;
      maxTokens = Math.min(100, estimatedMaxTokensFromChars);
    } else if (totalMessages <= 7) {
      sizeInstructions = `14. REFLECTION LENGTH - Write a short reflection (3-4 sentences maximum). Keep it concise.`;
      maxTokens = Math.min(150, estimatedMaxTokensFromChars);
    } else if (totalMessages <= 15) {
      sizeInstructions = `14. REFLECTION LENGTH - Write a medium reflection (4-5 sentences maximum). Still keep it concise.`;
      maxTokens = Math.min(200, estimatedMaxTokensFromChars);
    } else {
      sizeInstructions = `14. REFLECTION LENGTH - Write a slightly longer reflection (5-6 sentences maximum). Keep it concise and focused.`;
      maxTokens = Math.min(250, estimatedMaxTokensFromChars);
    }
    
    // Ensure we never exceed the character limit
    const characterLimitInstruction = `16. CHARACTER LIMIT - CRITICAL: The reflection must NEVER exceed ${maxReflectionCharacters} characters (which is 2x the ${userCharacterCount} characters the users wrote). Always stay within this strict limit.`;
    
    const reflectionPrompt = `Write a natural, first-person diary entry about this day's crew conversation. Tell the story of what happened in the crew's sphere chat and how it felt.

CRITICAL REQUIREMENTS:
1. WRITE IN FIRST PERSON - Use "I", "my", "me" - this is a personal diary entry
2. NO META-COMMENTARY - Do NOT say "Here is a diary entry" or "summarizing the day" or mention "user" or "crew members" - just tell the story directly
3. FOCUS ON WHAT HAPPENED - Write about the actual events, conversations, and experiences from the crew chat
4. CAPTURE THE FEELING - Include emotions and how things felt, but naturally woven into the story
5. BE SPECIFIC - Mention real events, people, or activities that were discussed in the crew
6. NATURAL STORYTELLING - Write like someone naturally reflecting on their day, not like an analysis or summary
7. USE AS LITTLE TIME/SPACE AS APPROPRIATE - Keep it concise, focus on what matters most
8. NO REPEATED "CREW MEMBER SAID..." - Do NOT repeatedly say "someone said..." or "a member told me..." - just mention what was discussed naturally
9. NO LONG DESCRIPTIONS OF OTHERS' ACTIONS - Do NOT write long descriptions of what others did or how they responded - focus on YOUR experience and reflections
10. FEEL LIKE A PERSONAL REFLECTION - The diary should feel natural and personal, like you're reflecting on your own day, not describing a group chat
11. AVOID DRAMATIC LINES - Do NOT use overly dramatic phrases like "It was crazy", "it gave me all the feels", "it was absolutely amazing", etc. UNLESS something truly extraordinary or life-changing happened. Keep the tone grounded and realistic - avoid too much dramatic storytelling for ordinary days.
12. NO REFLECTIVE CLOSING SENTENCES - Do NOT include reflective or moral closing sentences such as "it lifted my mood", "it made me feel seen", "it reminded me of something", "it was a good day", "it helped me realize", etc. End the diary naturally after describing the events or thoughts of the day, without summarizing emotions or giving life lessons. Just describe what happened and stop - no need to wrap it up with emotional conclusions.
13. NO POSITIVITY ABOUT TALKING TO CREW - Do NOT add statements like "talking to the crew made me feel better", "chatting with the crew helped", "the crew made me feel", or any positive statements about the conversation itself. ONLY summarize what was expressed and how the day emotionally felt - do NOT comment on the conversation or its effects.
14. ONLY SUMMARIZE WHAT WAS EXPRESSED - Focus ONLY on summarizing what was expressed in the crew chat and how the day emotionally felt. Do NOT add commentary about the conversation, crew members' responses, or how talking to the crew affected you.
${sizeInstructions}
${characterLimitInstruction}

Crew's Sphere Chat:
${conversationContext}

Write a natural diary entry about this day's crew conversation in first person. Just tell the story of what happened and how it felt. Focus ONLY on summarizing what was expressed in the crew chat and how the day emotionally felt. Do NOT add any statements about talking to the crew, how the crew helped, or how the conversation made you feel. Keep it grounded and realistic, avoiding dramatic language unless something truly extraordinary happened. End naturally after describing events - do NOT add reflective closing sentences about how things made you feel or what you learned.

CRITICAL: The reflection must NEVER exceed ${maxReflectionCharacters} characters (2x the ${userCharacterCount} characters the users wrote). Always stay within this strict character limit.`;

    console.log('🧪 Crew reflection prompt length:', reflectionPrompt.length);
    console.log('🧪 Crew reflection prompt preview:', reflectionPrompt.slice(0, 200));

    console.log('🌐 Making API call to RunPod for crew reflection...');

    const modelToUse = 'llama3:70b';
    
    // Try proxy first, fallback to direct URL if proxy fails
    let apiUrl = this.useProxy ? `${this.proxyURL}/api/generate` : `${this.baseURL}api/generate`;
    
    try {
      console.log(`🔄 Using model: ${modelToUse} for crew reflection`);
      console.log(`🌐 Crew reflection API URL: ${apiUrl}`);
      
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 120 seconds
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelToUse,
          prompt: reflectionPrompt,
          stream: false,
          options: {
            temperature: 0.5,  // Lower temperature for more accurate, focused summaries
            top_p: 0.9,
            max_tokens: maxTokens  // Dynamic token limit based on message count for concise reflections
          }
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      console.log(`📥 Response status for ${modelToUse}:`, response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ RunPod API Error for ${modelToUse}:`, response.status, errorText);
        throw new Error(`Crew reflection generation failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`✅ RunPod response received for crew summary with ${modelToUse}`);
        
      // Accept multiple possible fields from providers
      const text = (data && (data.response ?? data.output ?? data.message?.content)) || '';
      if (typeof text === 'string' && text.trim()) {
        let summary = text.trim();
        
        // Enforce character limit: reflection must not exceed 2x user character count
        if (summary.length > maxReflectionCharacters) {
          console.warn(`⚠️ Generated crew reflection (${summary.length} chars) exceeds limit (${maxReflectionCharacters} chars). Truncating...`);
          // Truncate to the character limit, trying to end at a sentence boundary
          summary = summary.substring(0, maxReflectionCharacters);
          // Try to find the last sentence ending (., !, ?) before the limit
          const lastSentenceEnd = Math.max(
            summary.lastIndexOf('.'),
            summary.lastIndexOf('!'),
            summary.lastIndexOf('?')
          );
          if (lastSentenceEnd > maxReflectionCharacters * 0.7) {
            // If we found a sentence end reasonably close to the limit, use it
            summary = summary.substring(0, lastSentenceEnd + 1);
          }
          console.log(`✅ Truncated crew reflection to ${summary.length} characters (within ${maxReflectionCharacters} limit)`);
        }
        
        console.log(`📖 Generated crew summary: ${summary.length} characters (limit: ${maxReflectionCharacters})`);
        return summary;
      } else {
        console.error(`❌ Invalid response format from ${modelToUse}:`, data);
        console.log('🔍 Full response data:', JSON.stringify(data, null, 2));
        throw new Error('Invalid response format from crew reflection API');
      }
    } catch (error) {
      console.error(`💥 Error with model ${modelToUse}:`, error.message);
      throw error;
    }
  }

  buildCrewConversationContext(userMessages, aiMessages) {
    let context = '';
    
    // Build a detailed conversation flow for better crew summaries
    // Include more context to capture emotional depth and important topics
    userMessages.forEach((userMsg, index) => {
      context += `Crew Member: "${userMsg}"\n`;
      if (aiMessages[index]) {
        // Include more of the AI response to capture the emotional journey and context
        const aiResponse = aiMessages[index].substring(0, 300);
        context += `AI: "${aiResponse}${aiMessages[index].length > 300 ? '...' : ''}"\n\n`;
      }
    });
    
    // Add a summary note at the end to help the AI identify key themes
    if (context.length > 0) {
      context += `\n---\nPlease analyze this crew conversation carefully and identify:\n`;
      context += `1. Key events or topics discussed (loss, grief, achievements, challenges, etc.)\n`;
      context += `2. Emotional tone (sad, grieving, happy, stressed, anxious, etc.)\n`;
      context += `3. Important details that should be reflected in the diary entry\n`;
    }
    
    return context.trim();
  }

  createFallbackCrewSummary(userMessages, aiMessages) {
    const lastUser = userMessages[userMessages.length - 1] || '';
    const firstUser = userMessages[0] || '';
    const base = (firstUser !== lastUser) ? `${firstUser} ... ${lastUser}` : lastUser;
    const trimmed = base.slice(0, 220);
    return `Today I chatted with the crew about: "${trimmed}${base.length > 220 ? '...' : ''}". It was nice to talk through my day with the crew and get some perspective.`;
  }
}

export default new ReflectionService();