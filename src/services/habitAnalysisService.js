import firestoreService from './firestoreService';
import { getDateIdDaysAgo } from '../utils/dateUtils';

class HabitAnalysisService {
  constructor() {
    this.apiKey = process.env.REACT_APP_GOOGLE_API_KEY || '';
    this.baseURL = 'https://generativelanguage.googleapis.com/v1beta/models';
    this.modelName = 'gemini-pro';
    this.minDaysRequired = 1; // Minimum days needed for meaningful analysis
    this.minMessagesRequired = 1; // Minimum total messages needed
  }

  /**
   * Get habit analysis - wrapper for analyzeHabits
   * @param {string} uid - User ID
   * @param {boolean} forceRefresh - Force refresh analysis
   * @returns {Object} Analysis results with habits, patterns, and insights
   */
  async getHabitAnalysis(uid, forceRefresh = false) {
    console.log('🔍 Getting habit analysis...', { uid, forceRefresh });
    
    try {
      // Check cache first if not forcing refresh
      if (!forceRefresh) {
        const cacheKey = `habit_analysis_${uid}`;
        const cachedData = localStorage.getItem(cacheKey);
        if (cachedData) {
          const parsed = JSON.parse(cachedData);
          const age = Date.now() - parsed.timestamp;
          // Use cached data if less than 24 hours old
          if (age < 24 * 60 * 60 * 1000) {
            console.log('✅ Using cached habit analysis');
            return parsed.analysis;
          }
        }
      }
      
      // Get fresh analysis
      const analysis = await this.analyzeHabits(uid);
      
      // Cache the result
      const cacheKey = `habit_analysis_${uid}`;
      localStorage.setItem(cacheKey, JSON.stringify({
        analysis,
        timestamp: Date.now()
      }));
      
      return analysis;
      
    } catch (error) {
      console.error('❌ Error getting habit analysis:', error);
      return this.getDefaultHabitAnalysis();
    }
  }

  /**
   * Analyze habits and patterns from 3 months of chat data
   * @param {string} uid - User ID
   * @returns {Object} Analysis results with habits, patterns, and insights
   */
  async analyzeHabits(uid) {
    console.log('🔍 Starting habit analysis for 3 months...');
    
    try {
      // Get 3 months of chat data
      const chatData = await this.getChatData(uid, 90); // 3 months
      
      if (!this.hasEnoughData(chatData)) {
        console.log('⚠️ Not enough data for habit analysis');
        return this.getDefaultHabitAnalysis();
      }
      
      // Perform AI analysis using RunPod directly
      const analysisResult = await this.performHabitAnalysis(chatData);
      
      console.log('✅ Habit analysis completed:', analysisResult);
      return analysisResult;
      
    } catch (error) {
      console.error('❌ Error in habit analysis:', error);
      return this.getDefaultHabitAnalysis();
    }
  }

  /**
   * Perform AI analysis on chat data using Google Gemini API
   */
  async performHabitAnalysis(chatData) {
    console.log('🤖 Performing AI habit analysis on 3 months of chat data...');
    
    try {
      // Create conversation context from chat data
      const conversationContext = chatData.map(day => {
        const messages = day.messages || [];
        const messageTexts = messages.map(msg => `${msg.sender}: ${msg.text}`).join('\n');
        return `${day.date}: ${messageTexts}`;
      }).join('\n\n');

      const habitAnalysisPrompt = `You are an AI habit and pattern analyzer. Analyze the following conversation data to identify habits, patterns, and insights that can help improve emotional well-being.

## Your Task:
Analyze 3 months of conversation data to identify:
1. **Habits** - Specific, actionable habits that address recurring challenges
2. **Patterns** - Emotional triggers, struggles, and positive behaviors
3. **Insights** - Key challenges, emotional cycles, and opportunities

## Conversation Data:
${conversationContext}

## Response Format:
Return a JSON object with this exact structure:

{
  "habits": [
    {
      "title": "Specific habit name",
      "description": "Clear, actionable description of what to do",
      "why": "Specific reason based on their patterns (e.g., 'You mentioned work stress 15 times in the last 3 months')",
      "frequency": "How often to do it (e.g., 'Daily', '3x per week', 'When feeling anxious')",
      "category": "stress_management|sleep|social|productivity|self_care|mindfulness"
    },
    {
      "title": "Second specific habit",
      "description": "Clear, actionable description",
      "why": "Specific reason based on their patterns",
      "frequency": "How often to do it",
      "category": "stress_management|sleep|social|productivity|self_care|mindfulness"
    },
    {
      "title": "Third specific habit",
      "description": "Clear, actionable description",
      "why": "Specific reason based on their patterns",
      "frequency": "How often to do it",
      "category": "stress_management|sleep|social|productivity|self_care|mindfulness"
    }
  ],
  "patterns": {
    "topStruggles": ["struggle1", "struggle2", "struggle3"],
    "emotionalTriggers": ["trigger1", "trigger2", "trigger3"],
    "positiveBehaviors": ["behavior1", "behavior2", "behavior3"]
  },
  "insights": {
    "mainChallenge": "Primary recurring challenge identified",
    "emotionalCycle": "How their emotions typically cycle",
    "keyOpportunity": "Biggest opportunity for improvement"
  }
}

IMPORTANT: 
- Maximum 3 habits, each addressing a different category
- Each habit must be based on SPECIFIC evidence from their conversations
- Be concrete and actionable, not abstract
- Focus on habits that will have the biggest impact on their most frequent struggles`;

      console.log('📤 HABIT DEBUG: Sending request to Google Gemini...');

      // Use Google Generative AI API
      const apiUrl = `${this.baseURL}/${this.modelName}:generateContent?key=${this.apiKey}`;
      console.log('🌐 HABIT API URL:', apiUrl);

      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 120 seconds
      
      // Use Google Generative AI API
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: habitAnalysisPrompt
            }]
          }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 1000
          }
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      console.log('✅ HABIT DEBUG: Received response from Google API:', data);
      
      // Parse Google API response format
      let responseText = '';
      if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
        responseText = data.candidates[0].content.parts.map(part => part.text).join('');
      }
      
      if (responseText) {
        const analysisResult = this.parseHabitAnalysisResult(responseText);
        console.log('✅ AI habit analysis completed:', analysisResult);
        return analysisResult;
      } else {
        throw new Error('Invalid response format from API');
      }

    } catch (error) {
      console.error('❌ Error in AI habit analysis:', error);
      return this.getDefaultHabitAnalysis();
    }
  }

  /**
   * Get chat data from Firestore
   */
  async getChatData(uid, days) {
    const chatData = [];
    
    for (let i = 0; i < days; i++) {
      const dateId = getDateIdDaysAgo(i);
      const dayData = await firestoreService.getChatMessages(uid, dateId);
      
      if (dayData && dayData.length > 0) {
        chatData.push({
          date: dateId,
          messages: dayData
        });
      }
    }
    
    return chatData;
  }

  /**
   * Check if there's enough data for analysis
   */
  hasEnoughData(chatData) {
    const totalMessages = chatData.reduce((sum, day) => sum + (day.messages?.length || 0), 0);
    const daysWithData = chatData.length;
    
    return daysWithData >= this.minDaysRequired && totalMessages >= this.minMessagesRequired;
  }

  /**
   * Get default habit analysis when no data is available
   */
  getDefaultHabitAnalysis() {
    return {
      habits: [
        {
          title: 'Daily Reflection',
          description: 'Take 5 minutes each evening to reflect on your day',
          why: 'Regular reflection helps process emotions and identify patterns',
          frequency: 'Daily',
          category: 'mindfulness'
        },
        {
          title: 'Stress Management',
          description: 'Practice deep breathing when feeling overwhelmed',
          why: 'Helps manage stress and anxiety in the moment',
          frequency: 'When feeling stressed',
          category: 'stress_management'
        },
        {
          title: 'Gratitude Practice',
          description: 'Write down three things you\'re grateful for each day',
          why: 'Focuses attention on positive aspects of life',
          frequency: 'Daily',
          category: 'self_care'
        }
      ],
      patterns: {
        topStruggles: ['Work stress', 'Time management', 'Self-doubt'],
        emotionalTriggers: ['Deadlines', 'Criticism', 'Uncertainty'],
        positiveBehaviors: ['Problem-solving', 'Seeking support', 'Learning new things']
      },
      insights: {
        mainChallenge: 'Balancing work demands with personal well-being',
        emotionalCycle: 'Stress builds up during work, relief comes from personal activities',
        keyOpportunity: 'Developing consistent stress management routines'
      }
    };
  }

  /**
   * Parse habit analysis result from AI response
   */
  parseHabitAnalysisResult(responseText) {
    try {
      // Try to extract JSON from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.error('❌ Error parsing habit analysis result:', error);
    }
    
    return this.getDefaultHabitAnalysis();
  }
}

export default new HabitAnalysisService();