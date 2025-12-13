class EmotionalAnalysisService {
  constructor() {
    this.baseURL = 'https://uyuwcw4zaa1mzb-11434.proxy.runpod.net/';
  }

  async analyzeEmotionalScores(messages) {
    console.log('🧠 Starting emotional analysis...');
    console.log('🔍 EMOTIONAL DEBUG: messages type:', typeof messages, 'length:', messages?.length);
    
    try {
      // Extract conversation text from messages
      const conversationText = messages
        .filter(msg => msg.text && msg.text.trim())
        .map(msg => `${msg.sender === 'user' ? 'User' : 'Assistant'}: ${msg.text}`)
        .join('\n');
      
      if (!conversationText || conversationText.trim() === '') {
        console.log('⚠️ No conversation text found, returning default scores');
        return this.getDefaultScores();
      }
      
      // Create emotional analysis prompt
      const prompt = `Analyze the emotional state from this conversation and provide numerical scores (0-100) for:
- happiness (how positive/joyful)
- energy (how energetic/motivated)  
- anxiety (how worried/anxious)
- stress (how stressed/pressured)

Conversation:
${conversationText}

Respond ONLY with a JSON object in this exact format:
{
  "happiness": <number>,
  "energy": <number>,
  "anxiety": <number>,
  "stress": <number>
}`;

      const apiUrl = `${this.baseURL}api/generate`;
      const modelToUse = 'llama3:70b'; // Go directly to preferred model
      
        try {
        console.log('🤖 Using model for emotional analysis:', modelToUse);
          
          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
            model: modelToUse,
              prompt: prompt,
              stream: false,
              options: {
                temperature: 0.3,
                num_predict: 300
              }
            })
          });
          
          if (!response.ok) {
          console.error(`❌ Model ${modelToUse} failed:`, response.status, response.statusText);
          throw new Error(`Emotional analysis failed: ${response.status} ${response.statusText}`);
          }
          
          const data = await response.json();
          console.log('✅ EMOTIONAL DEBUG: Received response:', data);
          
          // Parse the response
          let responseText = data.response || data.text || data.output || '';
          
          // Extract JSON from response
          const jsonMatch = responseText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const emotionalData = JSON.parse(jsonMatch[0]);
            
            // Validate the scores
            if (this.isValidAnalysisResult(emotionalData)) {
              console.log('✅ Valid emotional analysis:', emotionalData);
              return emotionalData;
            } else {
              console.log('⚠️ Invalid emotional analysis format, using defaults');
              return this.getDefaultScores();
            }
          } else {
            console.log('⚠️ Could not extract JSON from response');
            return this.getDefaultScores();
          }
      } catch (error) {
        console.error(`❌ Error with model ${modelToUse}:`, error);
      return this.getDefaultScores();
      }
    } catch (error) {
      console.error('❌ EMOTIONAL DEBUG: Error in analyzeEmotionalScores:', error);
      return this.getDefaultScores();
    }
  }

  isValidAnalysisResult(result) {
    if (!result || typeof result !== 'object') {
      return false;
    }
    
    const requiredFields = ['happiness', 'energy', 'anxiety', 'stress'];
    for (const field of requiredFields) {
      if (typeof result[field] !== 'number' || result[field] < 1 || result[field] > 100) {
        return false;
      }
    }
    
    return true;
  }

  getDefaultScores() {
    return {
      happiness: 50,
      energy: 50,
      anxiety: 30,
      stress: 30
    };
  }

  async saveEmotionalData(userId, dateId, scores) {
    // This method is called but not needed in the new implementation
    // The scores are already saved by ChatPage via firestoreService
    console.log('💾 Save emotional data called for:', userId, dateId, scores);
    return { success: true };
  }
}

export default new EmotionalAnalysisService();