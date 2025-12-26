import { getCurrentUser } from './authService';
import firestoreService from './firestoreService';
import { getDateId } from '../utils/dateUtils';

class ChatService {
  constructor() {
    this.apiKey = process.env.REACT_APP_GOOGLE_API_KEY || '';
    this.baseURL = 'https://generativelanguage.googleapis.com/v1beta/models';
    this.modelName = 'gemini-pro';
    this.visionModelName = 'gemini-pro-vision';
    // Optional: Add your Serper API key here for better results
    // Get free API key at: https://serper.dev (2,500 free searches/month)
    this.serperApiKey = null; // Set this if you want to use Serper API
  }

  /**
   * Detect if message contains URLs/links
   */
  hasUrl(message) {
    const urlPattern = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}[^\s]*)/i;
    return urlPattern.test(message);
  }

  /**
   * Extract URLs from message
   */
  extractUrls(message) {
    const urlPattern = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}[^\s]*)/gi;
    return message.match(urlPattern) || [];
  }

  /**
   * Convert image file to base64
   */
  async imageToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // Ollama expects just the base64 string without the data URL prefix
        const result = reader.result;
        if (result.includes(',')) {
          const base64 = result.split(',')[1];
          resolve(base64);
        } else {
          resolve(result);
        }
      };
      reader.onerror = (error) => {
        console.error('❌ FileReader error:', error);
        reject(error);
      };
      reader.readAsDataURL(file);
    });
  }

  /**
   * Fetch metadata from a URL (for Instagram Reels, memes, etc.)
   * Extracts title, description, and image from Open Graph tags
   */
  async fetchUrlMetadata(url) {
    try {
      console.log('🔗 Fetching metadata from URL:', url);
      
      // Use a CORS proxy to fetch the page
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl);
      
      if (!response.ok) {
        throw new Error('Failed to fetch page');
      }
      
      const data = await response.json();
      const htmlContent = data.contents;
      
      // Extract metadata from Open Graph tags
      const metadata = {
        title: null,
        description: null,
        image: null,
        videoUrl: null,
        siteName: null
      };
      
      // Extract title (prefer og:title, fallback to <title>)
      const ogTitleMatch = htmlContent.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
      const titleMatch = htmlContent.match(/<title>([^<]+)<\/title>/i);
      if (ogTitleMatch) {
        metadata.title = ogTitleMatch[1];
      } else if (titleMatch) {
        metadata.title = titleMatch[1];
      }
      
      // Extract description
      const descMatch = htmlContent.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i) ||
                       htmlContent.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
      if (descMatch) {
        metadata.description = descMatch[1];
      }
      
      // Extract video URL (for reels/videos)
      const videoMatch = htmlContent.match(/<meta\s+property="og:video"\s+content="([^"]+)"/i) ||
                        htmlContent.match(/<meta\s+property="og:video:url"\s+content="([^"]+)"/i);
      if (videoMatch) {
        metadata.videoUrl = videoMatch[1];
      }
      
      // Extract thumbnail/image
      const imageMatch = htmlContent.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
      if (imageMatch) {
        metadata.image = imageMatch[1];
      }
      
      // Extract site name
      const siteMatch = htmlContent.match(/<meta\s+property="og:site_name"\s+content="([^"]+)"/i);
      if (siteMatch) {
        metadata.siteName = siteMatch[1];
      }
      
      console.log('🔗 Metadata extracted:', metadata);
      return metadata;
    } catch (error) {
      console.error('❌ Error fetching URL metadata:', error);
      return null;
    }
  }

  /**
   * Check if URL is an Instagram link (post, reel, or story)
   */
  isInstagramLink(url) {
    const instagramPatterns = [
      /instagram\.com\/(reel|p|tv|stories)\//i,
      /instagram\.com\/[^\/]+\/(reel|p|tv)\//i
    ];
    
    return instagramPatterns.some(pattern => pattern.test(url));
  }

  /**
   * Check if URL is a social media post/reel/meme link
   */
  isSocialMediaLink(url) {
    const socialPatterns = [
      /instagram\.com\/(reel|p|tv)\//i,
      /twitter\.com\//i,
      /x\.com\//i,
      /tiktok\.com\//i,
      /reddit\.com\//i,
      /youtube\.com\//i,
      /youtu\.be\//i,
      /facebook\.com\//i,
      /imgur\.com\//i,
      /9gag\.com\//i
    ];
    
    return socialPatterns.some(pattern => pattern.test(url));
  }

  /**
   * Fetch Instagram post/reel data from Ensemble Data API
   */
  async fetchInstagramPostData(instagramUrl) {
    try {
      console.log('📸 Fetching Instagram post data from Ensemble Data API:', instagramUrl);
      
      const apiUrl = `https://api.ensembledata.com/instagram/post?url=${encodeURIComponent(instagramUrl)}`;
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'X-API-Key': 'XxrDGV8x0zDWIg2Y'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Ensemble Data API error:', response.status, errorText);
        throw new Error(`API request failed: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('✅ Instagram post data received from API');
      console.log('📸 Full API response structure:', JSON.stringify(data, null, 2).substring(0, 1000)); // Log first 1000 chars
      
      // Extract the data we need - handle different possible response structures
      const postData = {
        caption: data.caption || data.description || data.text || null,
        comments: [],
        user: {
          username: data.user?.username || data.username || data.author?.username || data.owner?.username || null,
          profilePicture: data.user?.profile_picture || data.user?.profile_pic_url || data.profile_picture || data.profile_pic_url || null,
          followers: data.user?.followers || data.followers || data.user?.follower_count || null
        },
        images: [],
        videos: [],
        type: data.type || data.media_type || 'unknown' // 'image', 'video', 'carousel', etc.
      };
      
      // Extract images (for posts) or video thumbnails (for reels)
      if (data.images && Array.isArray(data.images)) {
        postData.images = data.images.slice(0, 3); // Get first 2-3 images
      } else if (data.image) {
        postData.images = [data.image];
      } else if (data.thumbnail) {
        postData.images = [data.thumbnail];
      } else if (data.display_url) {
        postData.images = [data.display_url];
      } else if (data.media && Array.isArray(data.media)) {
        // Handle carousel posts
        const mediaUrls = data.media
          .filter(item => item.type === 'image' || item.type === 'photo')
          .map(item => item.url || item.display_url || item.thumbnail_url)
          .filter(Boolean)
          .slice(0, 3);
        postData.images = mediaUrls;
      }
      
      // Extract videos
      if (data.videos && Array.isArray(data.videos)) {
        postData.videos = data.videos.slice(0, 3);
      } else if (data.video) {
        postData.videos = [data.video];
      } else if (data.video_url) {
        postData.videos = [data.video_url];
      } else if (data.media && Array.isArray(data.media)) {
        // Handle carousel posts with videos
        const videoUrls = data.media
          .filter(item => item.type === 'video')
          .map(item => item.url || item.video_url)
          .filter(Boolean)
          .slice(0, 3);
        postData.videos = videoUrls;
      }
      
      // Extract comments (handle different possible structures)
      if (Array.isArray(data.comments)) {
        postData.comments = data.comments.map(comment => {
          // Handle different comment structures
          if (typeof comment === 'string') {
            return { text: comment, username: 'unknown', likes: 0 };
          }
          return {
            text: comment.text || comment.comment || comment.body || comment.content || String(comment),
            username: comment.username || comment.user?.username || comment.author?.username || comment.owner?.username || 'unknown',
            likes: comment.likes || comment.like_count || comment.likes_count || 0
          };
        });
      } else if (data.comments && typeof data.comments === 'object') {
        // If comments is an object with a data array
        const commentsArray = data.comments.data || data.comments.comments || [];
        postData.comments = commentsArray.map(comment => ({
          text: comment.text || comment.comment || comment.body || comment.content || String(comment),
          username: comment.username || comment.user?.username || comment.author?.username || 'unknown',
          likes: comment.likes || comment.like_count || 0
        }));
      }
      
      console.log('📸 Extracted post data:', {
        hasCaption: !!postData.caption,
        captionPreview: postData.caption ? postData.caption.substring(0, 100) : 'none',
        commentsCount: postData.comments.length,
        commentsPreview: postData.comments.slice(0, 2).map(c => c.text?.substring(0, 50)),
        imagesCount: postData.images.length,
        username: postData.user.username,
        type: postData.type
      });
      
      return postData;
    } catch (error) {
      console.error('❌ Error fetching Instagram post data:', error);
      console.error('❌ Error details:', error.message, error.stack);
      return null;
    }
  }

  /**
   * Fetch image from URL and convert to base64
   */
  async fetchImageAsBase64(imageUrl) {
    try {
      console.log('📸 Fetching image from URL:', imageUrl);
      
      // Use a CORS proxy to fetch images
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(imageUrl)}`;
      const response = await fetch(proxyUrl);
      
      if (!response.ok) {
        throw new Error('Failed to fetch image');
      }
      
      const data = await response.json();
      const htmlContent = data.contents;
      
      // Try to extract image URL from HTML (for Instagram, etc.)
      // This is a simplified approach - you might need more sophisticated parsing
      const imgMatch = htmlContent.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i) ||
                      htmlContent.match(/<img[^>]+src="([^"]+)"/i);
      
      if (imgMatch && imgMatch[1]) {
        const actualImageUrl = imgMatch[1];
        // Fetch the actual image
        const imageResponse = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(actualImageUrl)}`);
        const imageData = await imageResponse.json();
        
        // Convert to base64
        const base64Response = await fetch(actualImageUrl);
        const blob = await base64Response.blob();
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = reader.result.split(',')[1];
            resolve(base64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
      
      // If direct image URL, fetch it
      const imageResponse = await fetch(imageUrl);
      const blob = await imageResponse.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = reader.result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error('❌ Error fetching image:', error);
      return null;
    }
  }

  /**
   * Detect if the message is about entertainment topics
   */
  isEntertainmentTopic(message) {
    const entertainmentKeywords = [
      'show', 'tv', 'series', 'movie', 'film', 'celebrity', 'actor', 'actress',
      'director', 'episode', 'season', 'netflix', 'hulu', 'disney', 'hbo',
      'amazon prime', 'streaming', 'gossip', 'rumor', 'news', 'entertainment',
      'hollywood', 'bollywood', 'trailer', 'premiere', 'release', 'award',
      'oscar', 'grammy', 'emmy', 'star', 'famous', 'influencer', 'youtuber',
      'tiktok', 'instagram', 'social media', 'trending', 'viral', 'singer',
      'rapper', 'artist', 'musician', 'comedian', 'host', 'anchor', 'reporter',
      'model', 'fashion', 'red carpet', 'awards show', 'premiere', 'debut',
      'album', 'song', 'track', 'music video', 'podcast', 'interview'
    ];
    
    const lowerMessage = message.toLowerCase();
    
    // Check for entertainment keywords
    const hasKeyword = entertainmentKeywords.some(keyword => lowerMessage.includes(keyword));
    
    // Also check for common celebrity name patterns or questions about people
    const celebrityPatterns = [
      /^(who is|what about|tell me about|do you know)/i,
      /\b(he|she|they)\s+(is|was|are|were)\s+(a|an|the)\s+(actor|actress|singer|star|celebrity)/i
    ];
    
    const hasCelebrityPattern = celebrityPatterns.some(pattern => pattern.test(message));
    
    return hasKeyword || hasCelebrityPattern;
  }

  /**
   * Extract a better search query from the user message
   * Removes common words and focuses on key terms
   * Preserves Instagram handles, usernames, and specific identifiers
   */
  extractSearchQuery(message) {
    // Detect Instagram handles, usernames, or specific identifiers
    const instagramHandlePattern = /(@\w+|[\w_]+\.writes|writes|instagram|insta)/i;
    const hasSpecificIdentifier = instagramHandlePattern.test(message);
    
    // Common words to remove
    const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'about', 'what', 'who', 'where', 'when', 'why', 'how', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them'];
    
    // If there's a specific identifier, preserve it carefully
    if (hasSpecificIdentifier) {
      // Extract the name and the identifier
      const words = message.toLowerCase()
        .replace(/[^\w\s@._]/g, ' ') // Keep @, ., _ for handles
        .split(/\s+/)
        .filter(word => word.length > 0);
      
      // Find the identifier part (writes, instagram handle, etc.)
      const identifierIndex = words.findIndex(w => 
        w.includes('writes') || w.includes('insta') || w.includes('@') || w.includes('_') || w.includes('.')
      );
      
      if (identifierIndex > 0) {
        // Get name before identifier and identifier itself
        const name = words.slice(0, identifierIndex).filter(w => !stopWords.includes(w)).join(' ');
        const identifier = words.slice(identifierIndex).join(' ');
        const query = `${name} ${identifier}`.trim();
        console.log('🔍 Extracted search query with identifier:', query);
        return query;
      } else if (identifierIndex === 0) {
        // Identifier is at the start, get the full message with identifier
        const query = words.join(' ').trim();
        console.log('🔍 Extracted search query with identifier at start:', query);
        return query;
      }
    }
    
    // Regular extraction for other cases
    const words = message.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.includes(word));
    
    const keyTerms = words.slice(0, 7);
    const query = keyTerms.length > 0 ? keyTerms.join(' ') : message;
    
    console.log('🔍 Extracted search query:', query);
    return query;
  }

  /**
   * Search the web for information about entertainment topics
   * Uses DuckDuckGo API (free, no API key needed) - optimized for better results
   */
  async searchWeb(query) {
    try {
      console.log('🔍 Searching web for:', query);
      
      // Option 1: Use Serper API (better results, requires free API key) - optional
      if (this.serperApiKey) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
          
          const response = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-KEY': this.serperApiKey
            },
            body: JSON.stringify({
              q: query,
              num: 5
            }),
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          if (response.ok) {
            const data = await response.json();
            const results = data.organic?.slice(0, 3).map(result => ({
              title: result.title,
              snippet: result.snippet,
              link: result.link
            })) || [];
            
            if (results.length > 0) {
              console.log('✅ Web search results (Serper):', results);
              return results;
            }
          }
        } catch (serperError) {
          if (serperError.name !== 'AbortError') {
            console.log('⚠️ Serper API failed, trying DuckDuckGo...', serperError);
          }
        }
      }
      
      // Option 2: Use DuckDuckGo Instant Answer API (free, no API key) - PRIMARY METHOD
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
        
        // Enhanced DuckDuckGo query - add "news" or "latest" for better entertainment results
        const enhancedQuery = this.enhanceEntertainmentQuery(query);
        const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(enhancedQuery)}&format=json&no_html=1&skip_disambig=1`;
        
        const response = await fetch(ddgUrl, {
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const data = await response.json();
          const results = [];
          
          // Extract Abstract (main result) - most relevant
          if (data.AbstractText) {
            results.push({
              title: data.Heading || query,
              snippet: data.AbstractText.substring(0, 300), // Limit snippet length
              link: data.AbstractURL || ''
            });
          }
          
          // Extract Related Topics - additional context
          if (data.RelatedTopics && data.RelatedTopics.length > 0) {
            data.RelatedTopics.slice(0, 3).forEach(topic => {
              if (topic.Text) {
                const parts = topic.Text.split(' - ');
                const snippet = topic.Text.length > 300 ? topic.Text.substring(0, 300) + '...' : topic.Text;
                results.push({
                  title: parts[0] || topic.Text.substring(0, 60),
                  snippet: snippet,
                  link: topic.FirstURL || ''
                });
              }
            });
          }
          
          // Extract Answer (if available) - direct answers
          if (data.Answer && data.Answer !== data.AbstractText) {
            results.push({
              title: data.Heading || 'Quick Answer',
              snippet: data.Answer.substring(0, 300),
              link: data.AbstractURL || ''
            });
          }
          
          // Extract Definition (if available) - for celebrities/people
          if (data.Definition && data.Definition !== data.AbstractText) {
            results.push({
              title: data.Heading || 'Definition',
              snippet: data.Definition.substring(0, 300),
              link: data.AbstractURL || ''
            });
          }
          
          // Remove duplicates and limit to 4 results
          const uniqueResults = results.filter((result, index, self) =>
            index === self.findIndex(r => r.snippet === result.snippet)
          ).slice(0, 4);
          
          if (uniqueResults.length > 0) {
            console.log(`✅ Web search results (DuckDuckGo): ${uniqueResults.length} results found`);
            return uniqueResults;
          }
        }
      } catch (ddgError) {
        if (ddgError.name !== 'AbortError') {
          console.log('⚠️ DuckDuckGo search failed:', ddgError);
        }
      }
      
      console.log('⚠️ Web search unavailable, proceeding without search results');
      return [];
      
    } catch (error) {
      console.error('❌ Error in web search:', error);
      return [];
    }
  }

  /**
   * Enhance entertainment queries for better DuckDuckGo results
   * Prioritizes Indian context (Bollywood, Indian celebrities, Indian shows)
   * Skips adding "Bollywood" when specific identifiers (Instagram handles, usernames) are present
   */
  enhanceEntertainmentQuery(query) {
    const lowerQuery = query.toLowerCase();
    
    // Check for specific identifiers (Instagram handles, usernames, unique identifiers)
    const hasSpecificIdentifier = /(writes|insta|instagram|@|_|\.writes|\._)/i.test(query);
    
    // Indian context keywords to add
    const indianContexts = ['india', 'indian', 'bollywood', 'tollywood', 'kollywood', 'mollywood', 'south indian'];
    
    // Check if query already has Indian context
    const hasIndianContext = indianContexts.some(ctx => lowerQuery.includes(ctx));
    
    // Add context keywords for better results
    const entertainmentContexts = [
      'news', 'latest', 'recent', 'update', 'gossip', 'rumor',
      'celebrity', 'actor', 'actress', 'show', 'series', 'movie'
    ];
    
    // Check if query already has context
    const hasContext = entertainmentContexts.some(ctx => lowerQuery.includes(ctx));
    
    // Build enhanced query with Indian context
    let enhancedQuery = query;
    
    // DON'T add Bollywood context if there's a specific identifier (Instagram handle, username, etc.)
    // This prevents confusion with famous Bollywood celebrities
    if (!hasIndianContext && !hasSpecificIdentifier) {
      // Check if it's likely an entertainment query
      const isEntertainmentQuery = this.isEntertainmentTopic(query) || 
                                   lowerQuery.includes('who') || 
                                   lowerQuery.includes('celebrity') ||
                                   lowerQuery.includes('actor') ||
                                   lowerQuery.includes('actress') ||
                                   lowerQuery.includes('singer') ||
                                   lowerQuery.includes('star');
      
      if (isEntertainmentQuery) {
        // Add Indian context to prioritize Indian results
        enhancedQuery = `${query} India Indian Bollywood`;
      }
    } else if (hasSpecificIdentifier) {
      // For specific identifiers, add "Instagram" or "social media" to make search more specific
      if (!lowerQuery.includes('instagram') && !lowerQuery.includes('insta') && !lowerQuery.includes('social media')) {
        enhancedQuery = `${query} Instagram social media`;
      }
    }
    
    // If it's about a person/celebrity, add "news" or "latest" (but not if there's a specific identifier)
    if (!hasContext && !hasSpecificIdentifier && (lowerQuery.includes('who') || lowerQuery.length < 20)) {
      return `${enhancedQuery} news latest`;
    }
    
    // If it's about a show/movie, add "updates" or "news"
    if (!hasContext && (lowerQuery.includes('show') || lowerQuery.includes('movie') || lowerQuery.includes('series'))) {
      return `${enhancedQuery} updates news`;
    }
    
    return enhancedQuery;
  }

  async checkModelsAvailable() {
    try {
      const response = await fetch(`${this.baseURL}api/tags`);
      if (response.ok) {
        const data = await response.json();
        console.log('📋 Available models:', data.models?.map(m => m.name) || []);
        return data.models || [];
      }
    } catch (error) {
      console.error('❌ Could not check available models:', error);
    }
    return [];
  }

  /**
   * Get user profile context from localStorage
   */
  getUserProfileContext() {
    try {
      // Get current user from authService
      const user = getCurrentUser();
      
      if (!user || !user.uid) {
        return null;
      }
      
      // Get birthday and format it
      const birthdayString = localStorage.getItem(`user_birthday_${user.uid}`) || null;
      let birthday = null;
      let birthdayFormatted = null;
      
      if (birthdayString) {
        try {
          const date = new Date(birthdayString);
          if (!isNaN(date.getTime())) {
            birthday = birthdayString;
            // Format as "Month Day, Year" (e.g., "January 15, 2000")
            birthdayFormatted = date.toLocaleDateString('en-US', { 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            });
          }
        } catch (error) {
          console.error('Error parsing birthday:', error);
        }
      }
      
      const profileContext = {
        name: user.displayName || null,
        age: localStorage.getItem(`user_age_${user.uid}`) || null,
        gender: localStorage.getItem(`user_gender_${user.uid}`) || null,
        bio: localStorage.getItem(`user_bio_${user.uid}`) || null,
        birthday: birthday,
        birthdayFormatted: birthdayFormatted
      };
      
      // Only return if we have at least some information
      if (profileContext.name || profileContext.age || profileContext.gender || profileContext.bio || profileContext.birthday) {
        return profileContext;
      }
      
      return null;
    } catch (error) {
      console.error('❌ Error getting user profile context:', error);
      return null;
    }
  }

  /**
   * Analyze image using vision model and get detailed description
   */
  async analyzeImageWithVision(imageBase64, userMessage = '') {
    try {
      console.log('👁️ VISION: Analyzing image with vision model...');
      console.log('👁️ VISION: Image base64 length:', imageBase64?.length || 0);
      console.log('👁️ VISION: Using model:', this.visionModelName);
      
      // Ensure base64 is clean (no data URL prefix)
      let cleanBase64 = imageBase64;
      if (imageBase64.includes(',')) {
        cleanBase64 = imageBase64.split(',')[1];
      }
      
      if (!cleanBase64 || cleanBase64.length < 100) {
        throw new Error('Invalid or too small base64 image');
      }
      
      const visionPrompt = `Analyze this image in COMPLETE DETAIL. Describe:
- What you see (objects, people, text, scenes, colors, layout)
- The context and setting
- Any text visible in the image (exact words if readable)
- The mood, tone, or emotion conveyed
- If it's a meme, explain the joke, format, and why it's funny
- If it's a screenshot, describe what's on screen
- Any cultural references, trends, or context
- Every detail that would help someone understand what this image is about

Be thorough and detailed. This description will be used to generate a response.`;

      const apiUrl = `${this.baseURL}/${this.visionModelName}:generateContent?key=${this.apiKey}`;
      const requestBody = {
        contents: [{
          parts: [
            { text: visionPrompt },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: cleanBase64
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0.3, // Lower temp for more accurate descriptions
          maxOutputTokens: 500 // Longer description
        }
      };

      console.log('👁️ VISION: Sending request to:', apiUrl);
      console.log('👁️ VISION: Request body keys:', Object.keys(requestBody));

      // Add timeout to vision model call (30 seconds)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      let response;
      try {
        response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
      } catch (fetchError) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') {
          throw new Error('Vision model request timed out after 30 seconds');
        }
        throw fetchError;
      }

      console.log('👁️ VISION: Response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ VISION: Error response:', errorText);
        throw new Error(`Vision model failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('👁️ VISION: Response keys:', Object.keys(data));
      
      const imageDescription = data.response || data.text || data.output || '';
      
      if (!imageDescription || imageDescription.trim().length === 0) {
        throw new Error('Empty description from vision model');
      }
      
      console.log('✅ VISION: Image analysis complete');
      console.log('📝 VISION: Description length:', imageDescription.length);
      console.log('📝 VISION: Description preview:', imageDescription.substring(0, 200));
      
      return imageDescription;
    } catch (error) {
      console.error('❌ VISION: Error analyzing image:', error);
      console.error('❌ VISION: Error details:', error.message, error.stack);
      throw error; // Re-throw to be handled by caller
    }
  }

  async sendMessage(userMessage, conversationHistory = [], onToken = null, imageFile = null, imageBase64 = null) {
    console.log('🚀 CHAT DEBUG: Starting sendMessage with:', userMessage);
    console.log('🚀 CHAT DEBUG: Using URL:', this.baseURL);
    
    // Validate API key
    if (!this.apiKey || this.apiKey.trim() === '') {
      console.error('❌ CHAT DEBUG: API key is missing!');
      throw new Error('Google API key is not configured.');
    }
    
    // Log API key status (first 10 chars only for security)
    console.log('✅ CHAT DEBUG: API key found (first 10 chars):', this.apiKey.substring(0, 10) + '...');
    console.log('✅ CHAT DEBUG: API key length:', this.apiKey.length);
    
    try {
      // Check if we have an image (file or base64) or URL
      let hasImage = false;
      let finalImageBase64 = imageBase64;
      let imageDescription = null; // Declare early so it can be set for social media links
      
      // Convert image file to base64 if provided
      if (imageFile) {
        console.log('📸 Image file provided, converting to base64...');
        finalImageBase64 = await this.imageToBase64(imageFile);
        hasImage = true;
      } else if (imageBase64) {
        console.log('📸 Image base64 provided');
        hasImage = true;
      } else if (this.hasUrl(userMessage)) {
        // Check if URL points to an image or social media post
        const urls = this.extractUrls(userMessage);
        console.log('🔗 URLs detected in message:', urls);
        
        // Check if any URL is an Instagram link (priority - use Ensemble Data API)
        const instagramUrl = urls.find(url => this.isInstagramLink(url));
        
        if (instagramUrl) {
          // Handle Instagram posts/reels/stories with Ensemble Data API
          console.log('📸 Instagram link detected, fetching data from Ensemble Data API...');
          const instagramData = await this.fetchInstagramPostData(instagramUrl);
          
          // Check if we got valid data with caption or comments
          const hasValidData = instagramData && (
            (instagramData.caption && instagramData.caption.trim().length > 0) ||
            (instagramData.comments && instagramData.comments.length > 0) ||
            (instagramData.user && instagramData.user.username)
          );
          
          if (hasValidData) {
            // Build comprehensive description from Instagram data
            const isReel = instagramData.type === 'video' || instagramUrl.includes('/reel/') || instagramUrl.includes('/tv/');
            const accountUsername = instagramData.user.username || 'unknown';
            
            // IMPORTANT: User is sharing someone else's meme/reel, not their own
            let linkDescription = `The user shared a MEME (an Instagram ${isReel ? 'reel' : 'post'}) from @${accountUsername}'s account. This is NOT the user's own content - they found and shared this meme from @${accountUsername}. `;
            
            // Add caption (CRITICAL - this is the main content of the meme)
            if (instagramData.caption && instagramData.caption.trim().length > 0) {
              linkDescription += `MEME CAPTION: "${instagramData.caption}". `;
            } else {
              linkDescription += `(No caption available for this meme). `;
            }
            
            // Add account info (important context - whose meme this is)
            linkDescription += `This meme is from @${accountUsername}'s account. `;
            if (instagramData.user.followers) {
              linkDescription += `@${accountUsername} has ${instagramData.user.followers} followers. `;
            }
            
            // Add comments (especially funny ones) - prioritize these for humor
            if (instagramData.comments && instagramData.comments.length > 0) {
              // Sort comments by likes to find the funniest/most popular ones
              const sortedComments = [...instagramData.comments]
                .filter(c => c.text && c.text.trim().length > 0)
                .sort((a, b) => (b.likes || 0) - (a.likes || 0));
              const topComments = sortedComments.slice(0, 5); // Get top 5 for better selection
              
              linkDescription += `TOP COMMENTS (${instagramData.comments.length} total): `;
              topComments.forEach((comment, index) => {
                if (comment.text) {
                  linkDescription += `Comment ${index + 1}: "@${comment.username}" said "${comment.text}" (${comment.likes || 0} likes). `;
                }
              });
            } else {
              linkDescription += `(No comments available). `;
            }
            
            // Analyze images if available (for posts or video thumbnails)
            if (instagramData.images && instagramData.images.length > 0) {
              try {
                console.log(`📸 Analyzing ${instagramData.images.length} image(s) from Instagram post...`);
                const imageDescriptions = [];
                
                // Analyze up to 2-3 images
                for (let i = 0; i < Math.min(instagramData.images.length, 3); i++) {
                  const imageUrl = instagramData.images[i];
                  const thumbnailBase64 = await this.fetchImageAsBase64(imageUrl);
                  if (thumbnailBase64) {
                    const imgDescription = await this.analyzeImageWithVision(thumbnailBase64, userMessage);
                    imageDescriptions.push(imgDescription);
                  }
                }
                
                if (imageDescriptions.length > 0) {
                  linkDescription += `Visual content: ${imageDescriptions.join(' | ')}`;
                }
              } catch (error) {
                console.log('⚠️ Could not analyze images, using text data only:', error);
              }
            }
            
            imageDescription = linkDescription;
            hasImage = true; // Treat as having image context
            console.log('✅ Instagram post data processed successfully');
          } else {
            // API failed or returned no valid data - just respond with laughing emojis
            console.log('⚠️ Could not access Instagram content from API - will respond with emojis only');
            // Set a special flag to indicate we should just respond with emojis
            imageDescription = 'EMOJI_ONLY_RESPONSE';
            hasImage = true; // Still treat as having context so we use the special prompt
          }
        } else {
          // Check if any URL is a social media link (non-Instagram)
          const socialMediaUrl = urls.find(url => this.isSocialMediaLink(url));
          
          if (socialMediaUrl) {
            // Handle other social media posts/reels/memes specially
            console.log('📹 Social media link detected, fetching metadata...');
            const urlMetadata = await this.fetchUrlMetadata(socialMediaUrl);
            
            if (urlMetadata) {
              // Create a detailed description from metadata
              let linkDescription = `The user shared a link from ${urlMetadata.siteName || 'social media'}. `;
              
              if (urlMetadata.title) {
                linkDescription += `Title: "${urlMetadata.title}". `;
              }
              
              if (urlMetadata.description) {
                linkDescription += `Description: "${urlMetadata.description}". `;
              }
              
              // If it's a video/reel, mention that
              if (urlMetadata.videoUrl || socialMediaUrl.includes('/reel/') || socialMediaUrl.includes('/tv/')) {
                linkDescription += `This is a video/reel. `;
              }
              
              // If we have a thumbnail, analyze it for visual context
              if (urlMetadata.image) {
                try {
                  console.log('📸 Analyzing thumbnail from metadata...');
                  const thumbnailBase64 = await this.fetchImageAsBase64(urlMetadata.image);
                  if (thumbnailBase64) {
                    const thumbnailDescription = await this.analyzeImageWithVision(thumbnailBase64, userMessage);
                    linkDescription += `Visual content from thumbnail: ${thumbnailDescription}`;
                  }
                } catch (error) {
                  console.log('⚠️ Could not analyze thumbnail, using metadata only:', error);
                  // Still use metadata even if thumbnail analysis fails
                }
              }
              
              imageDescription = linkDescription;
              hasImage = true; // Treat as having image context
              console.log('✅ Social media link metadata processed');
            } else {
              console.log('⚠️ Could not fetch link metadata, trying to fetch as image...');
              // Fallback: try to fetch as regular image
              const fetchedImage = await this.fetchImageAsBase64(socialMediaUrl);
              if (fetchedImage) {
                finalImageBase64 = fetchedImage;
                hasImage = true;
                console.log('✅ Successfully fetched image from URL');
              }
            }
          } else {
            // Regular image URL handling (direct image links)
            for (const url of urls) {
              const fetchedImage = await this.fetchImageAsBase64(url);
              if (fetchedImage) {
                finalImageBase64 = fetchedImage;
                hasImage = true;
                console.log('✅ Successfully fetched image from URL');
                break;
              }
            }
          }
        }
      }
      
      // If we have an image but no description yet (regular images, not social media links), analyze it with vision model
      if (hasImage && finalImageBase64 && !imageDescription) {
        console.log('📸 Image detected - starting two-step process...');
        try {
          imageDescription = await this.analyzeImageWithVision(finalImageBase64, userMessage);
          
          if (!imageDescription || imageDescription.trim().length === 0) {
            console.log('⚠️ Vision analysis returned empty, falling back to regular processing');
            imageDescription = null;
          } else {
            console.log('✅ Image description received, will send to Gemini');
          }
        } catch (visionError) {
          console.error('❌ Vision analysis failed:', visionError);
          console.log('⚠️ Falling back to regular processing without image context');
          imageDescription = null;
          // Continue with regular processing - don't throw error
        }
      }
      
      // If we already have imageDescription from social media metadata, use it
      if (imageDescription) {
        console.log('📸 Using image description from metadata/vision analysis');
      }
      
      // Always use Gemini for final response
      const modelToUse = this.modelName; // gemini-pro
      const hasImageContext = !!imageDescription;
      
      console.log('🚀 CHAT DEBUG: Using model:', modelToUse);
      console.log('🚀 CHAT DEBUG: Has image context:', hasImageContext);
      
      // Get user profile context
      const userProfile = this.getUserProfileContext();
      
      // Check if this is an entertainment topic (only for non-vision messages)
      const isEntertainment = !hasImageContext && this.isEntertainmentTopic(userMessage);
      let webSearchResults = null;
      
      // Search the web for entertainment topics
      if (isEntertainment) {
        console.log('🎬 Entertainment topic detected, searching web...');
        
        // Create a better search query by extracting key terms
        // Remove common words and focus on the main topic
        const searchQuery = this.extractSearchQuery(userMessage);
        webSearchResults = await this.searchWeb(searchQuery);
        
        // If no results, try the original message
        if (!webSearchResults || webSearchResults.length === 0) {
          console.log('⚠️ No results with optimized query, trying original message...');
          webSearchResults = await this.searchWeb(userMessage);
        }
      }
      
      // Build a simpler prompt that works with Ollama
      let conversationContext = '';
      
      // Add conversation history (last 3 messages for context)
      if (conversationHistory && conversationHistory.length > 0) {
        const recentMessages = conversationHistory.slice(-3);
        conversationContext = recentMessages.map(msg => {
          return msg.sender === 'user' ? `Human: ${msg.text}` : `Assistant: ${msg.text}`;
        }).join('\n') + '\n';
      }
      
      // Build the prompt with web search results if available
      let searchContext = '';
      let responseLength = 200; // Default response length
      
      if (isEntertainment && webSearchResults && webSearchResults.length > 0) {
        // Check if user message has specific identifiers
        const hasSpecificIdentifier = /(writes|insta|instagram|@|_|\.writes|\._)/i.test(userMessage);
        
        searchContext = '\n\n📰 REAL-TIME INFORMATION FROM THE INTERNET:\n';
        webSearchResults.forEach((result, index) => {
          searchContext += `${index + 1}. ${result.title}: ${result.snippet}\n`;
        });
        searchContext += '\nIMPORTANT THERAPEUTIC GUIDELINES FOR ENTERTAINMENT TOPICS:';
        searchContext += '\n- Use this REAL information to stay grounded and accurate';
        searchContext += '\n- Reflect on how these facts might make the user feel or why they shared them';
        searchContext += '\n- Offer gentle validation, curious observations, and supportive coping ideas';
        searchContext += '\n- Keep the tone calm, non-judgmental, and emotionally safe';
        searchContext += '\n- Avoid gossip or roasts—focus on empathy and psychological insight';
        searchContext += '\n- Integrate the facts naturally without sounding like a news report';
        
        if (hasSpecificIdentifier) {
          searchContext += '\n- CRITICAL: The user mentioned a specific identifier (Instagram handle, username like "tee writes", "tee_.writes", etc.)';
          searchContext += '\n- PRIORITIZE search results that match that EXACT identifier the user mentioned';
          searchContext += '\n- If search results mention different people with the same name, use ONLY the one that matches the specific identifier the user mentioned';
          searchContext += '\n- Do NOT confuse with other people who have the same name but different identifiers';
        } else {
          searchContext += '\n- PRIORITIZE INDIAN CONTEXT: Focus on Indian celebrities, Bollywood, Indian shows, Indian entertainment unless the search results clearly indicate international/Western context';
          searchContext += '\n- If search results mention Indian celebrities or Indian entertainment, emphasize that in your response';
        }
        
        // Increase response length for entertainment topics with search results (but keep it controlled)
        responseLength = 250; // Reduced to encourage shorter, more controlled responses
      } else if (isEntertainment) {
        // Entertainment topic but no search results
        searchContext = '\n\nNOTE: This appears to be an entertainment topic, but no current information was found.';
        searchContext += '\n- Still respond with warmth and curiosity';
        searchContext += '\n- Be transparent that no current info was found while keeping focus on the user';
        searchContext += '\n- Invite the user to share what resonates or how they feel about the topic';
        searchContext += '\n- Assume Indian context (Bollywood, Indian celebrities) unless user specifies otherwise';
      }
      
      // Build user profile context string
      let userContext = '';
      if (userProfile) {
        userContext = '\n\n👤 USER PROFILE INFORMATION:\n';
        if (userProfile.name) {
          userContext += `- Name: ${userProfile.name}\n`;
        }
        if (userProfile.age) {
          userContext += `- Age: ${userProfile.age} years old\n`;
        }
        if (userProfile.gender) {
          userContext += `- Gender: ${userProfile.gender}\n`;
        }
        if (userProfile.birthdayFormatted) {
          userContext += `- Birthday: ${userProfile.birthdayFormatted}\n`;
        }
        if (userProfile.bio) {
          userContext += `- About: ${userProfile.bio}\n`;
        }
        const userName = userProfile.name || 'they';
        userContext += `\nIMPORTANT: Use the user's name (${userName}) naturally in conversations when appropriate. Reference their age, gender, birthday, or bio context when relevant to make responses more personalized and meaningful. Remember their birthday (${userProfile.birthdayFormatted || 'not provided'}) and use it when they ask about it or when it's relevant to the conversation.`;
      }
      
      // Create the prompt based on whether we have image context
      let simplePrompt;
      
      if (hasImageContext && imageDescription) {
        // Check if API failed and we should just respond with emojis
        if (imageDescription === 'EMOJI_ONLY_RESPONSE') {
          // Content unavailable: respond therapeutically about the intention behind sharing
          simplePrompt = `You are Deite, a compassionate therapist-like companion who prioritizes emotional safety and validation.${userContext}

The user just shared an Instagram link, but the content could not be accessed. Even without seeing the media, respond in 3-4 gentle sentences that:
- Acknowledge you couldn't view the link while keeping focus on the user
- Reflect what sharing a meme/reel might signal about their mood or needs
- Offer grounding reassurance or a coping idea tied to their possible feelings
- Ask ONE open-ended question inviting them to describe the content or share what resonated
- Maintain a calm, empathetic, non-judgmental tone with no jokes or roasts

${conversationContext}Human: ${userMessage || 'Check this out!'}
Assistant:`;
        } else {
          // Check if this is Instagram data (has comments, user info, etc.)
          const isInstagramData = imageDescription.includes('Instagram') && 
                                 (imageDescription.includes('Comments') || imageDescription.includes('@'));
          
          if (isInstagramData) {
            // Special handling for Instagram posts with comments
            simplePrompt = `You are Deite, a calm, empathetic therapist-like friend. The user just shared an Instagram post/reel, and here's what it contains:${userContext}

📸 INSTAGRAM POST DATA:
${imageDescription}

${userMessage ? `\nUser's message: "${userMessage}"` : ''}

THERAPEUTIC RESPONSE GUIDELINES FOR SHARED POSTS:
- Assume the user resonated with this post emotionally—mirror the themes you see in the caption/comments
- Validate any feelings the content might stir (humor, stress relief, longing, frustration, pride, etc.)
- Offer a gentle insight or coping reframe that connects to the post details
- Invite the user to share what part of the post hit home for them with ONE caring question
- Keep the tone grounded, warm, and judgement-free—no roasts, sarcasm, or slangy reactions
- Stay within 3-4 thoughtful sentences, prioritizing emotional safety over hype

${conversationContext}Human: ${userMessage || 'Check this out!'}
Assistant:`;
        } else {
          // Regular image/meme handling
            simplePrompt = `You are Deite, a supportive therapist-like confidante. The user just shared an image/meme, and here's what it contains:${userContext}

📸 IMAGE ANALYSIS:
${imageDescription}

${userMessage ? `\nUser's message: "${userMessage}"` : ''}

THERAPEUTIC RESPONSE GUIDELINES FOR VISUAL CONTENT:
- Reflect the emotions, story, or theme described in the analysis above
- Validate why someone might share or connect with this specific meme/image
- Offer a gentle observation or grounding reminder tied to what you see
- Ask ONE soft, curious question that invites the user to open up about their reaction
- Use warm, calm language (3-4 sentences) and avoid jokes, roasting, or slang

${conversationContext}Human: ${userMessage || 'Check this out!'}
Assistant:`;
          }
        }
      } else {
        // Regular message prompt - therapist mode
        simplePrompt = `You are Deite, a compassionate therapist-like companion who offers a safe, validating space.${userContext}

CORE THERAPIST GUIDELINES:
- Listen for the emotion beneath the words and name it with care
- Validate the user’s lived experience without judgment or sarcasm
- Offer one gentle insight, reframing, or coping strategy rooted in what they shared
- Ask ONE open-ended, non-leading question to invite deeper sharing
- Keep responses to 3-5 sentences, warm, grounded, and trauma-informed
- Prioritize Indian cultural context when relevant (Bollywood, local realities, family dynamics) while honoring the user’s specific cues

${searchContext}
${conversationContext}Human: ${userMessage}
Assistant:`;
      }

      // Prepare API request - Use Google Generative AI API
      const apiUrl = `${this.baseURL}/${this.modelName}:generateContent?key=${this.apiKey}`;
      
      console.log('📤 CHAT DEBUG: Full API URL (first 100 chars):', apiUrl.substring(0, 100) + '...');
      console.log('📤 CHAT DEBUG: API Base URL:', this.baseURL);
      console.log('📤 CHAT DEBUG: Model:', this.modelName);
      console.log('📤 CHAT DEBUG: Prompt length:', simplePrompt.length);
      console.log('📤 CHAT DEBUG: Has image context:', hasImageContext);
      console.log('📤 CHAT DEBUG: API Key present:', this.apiKey ? 'YES' : 'NO');
      
      const requestBody = {
        contents: [{
          parts: [{
            text: simplePrompt
          }]
        }],
        generationConfig: {
          temperature: 0.65, // Calmer tone for therapeutic responses
          maxOutputTokens: 350 // Allow space for multi-sentence supportive replies
        }
      };
      
      // Note: We don't send images to gemini-pro - only the text description from vision model
      
      console.log('📤 CHAT DEBUG: Sending request to:', apiUrl);
      
      // Add timeout to prevent hanging requests (60 seconds for chat)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
      
      let response;
      try {
        response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
      } catch (fetchError) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') {
          console.error('❌ CHAT DEBUG: Request timed out after 60 seconds');
          throw new Error('Request timed out. The AI server may be slow or unavailable. Please try again.');
        }
        // Check for network errors
        if (fetchError.message.includes('Failed to fetch') || fetchError.message.includes('NetworkError')) {
          console.error('❌ CHAT DEBUG: Network error - AI server may be unreachable');
          throw new Error('Unable to connect to the AI server. Please check your internet connection and try again.');
        }
        throw fetchError;
      }

      console.log('📥 CHAT DEBUG: Response status:', response.status);
      console.log('📥 CHAT DEBUG: Response ok:', response.ok);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ CHAT DEBUG: Error response:', errorText);
        
        // Provide more specific error messages
        if (response.status === 400) {
          // Check if it's an API key error
          if (errorText.includes('API key') || errorText.includes('invalid') || errorText.includes('permission')) {
            throw new Error('Invalid or missing Google API key. Please check your REACT_APP_GOOGLE_API_KEY in the .env file and make sure it\'s correct.');
          }
          throw new Error(`Bad request: ${errorText.substring(0, 200)}`);
        } else if (response.status === 401 || response.status === 403) {
          throw new Error('API key authentication failed. Please check your REACT_APP_GOOGLE_API_KEY in the .env file. Make sure the key is valid and has the necessary permissions.');
        } else if (response.status === 404) {
          throw new Error('AI model not found. Please check if the model is available.');
        } else if (response.status === 500 || response.status === 502 || response.status === 503) {
          throw new Error('AI server is temporarily unavailable. Please try again in a moment.');
        } else if (response.status === 504) {
          throw new Error('Request timed out. The AI server is taking too long to respond.');
        }
        
        throw new Error(`Model ${this.modelName} failed: ${response.status} ${response.statusText}. ${errorText.substring(0, 200)}`);
      }
      
      // Note: Google API doesn't support streaming in the same way
      // For now, we'll use non-streaming and call onToken with the full response
      // Handle response
      {
        // Handle non-streaming response from Google Gemini API
        const data = await response.json();
        console.log('✅ CHAT DEBUG: Received response from Google Gemini API');
        console.log('✅ CHAT DEBUG: Response keys:', Object.keys(data));
        
        // Parse Google Gemini API response format
        let aiResponse = '';
        if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
          aiResponse = data.candidates[0].content.parts.map(part => part.text).join('');
        } else {
          console.error('❌ CHAT DEBUG: Unexpected response format from Google Gemini API');
          console.error('❌ CHAT DEBUG: Full response data:', JSON.stringify(data, null, 2));
          console.error('❌ CHAT DEBUG: Response structure:', {
            hasCandidates: !!data.candidates,
            candidatesLength: data.candidates?.length,
            firstCandidate: data.candidates?.[0],
            hasContent: !!data.candidates?.[0]?.content,
            hasParts: !!data.candidates?.[0]?.content?.parts
          });
          
          // Check for error in response
          if (data.error) {
            throw new Error(`Google API Error: ${data.error.message || JSON.stringify(data.error)}`);
          }
          
          throw new Error('Unexpected response format from Google Gemini API. Please check your API key and try again. Check console for full response details.');
        }
        
        if (!aiResponse || aiResponse.trim() === '') {
          console.error('❌ CHAT DEBUG: Empty response from Google Gemini API');
          throw new Error('Empty response from AI. Please check your API key and try again.');
        }
        
        console.log('✅ CHAT DEBUG: Successfully got response from Google Gemini API');
        console.log('✅ CHAT DEBUG: AI Response:', aiResponse.substring(0, 100));
        return aiResponse;
      }
      
    } catch (error) {
      console.error('❌ CHAT DEBUG: Error in sendMessage:', error);
      throw error;
    }
  }

  async generateDayDescription(dayData, type, periodText, userCharacterCount = null) {
    try {
      console.log(`🤖 Generating ${type} day description for`, dayData.date);
      
      // Calculate user character count if not provided
      let actualUserCharacterCount = userCharacterCount;
      if (actualUserCharacterCount === null && dayData.date) {
        try {
          const user = getCurrentUser();
          if (user) {
            // Convert date to dateId format
            let dateId;
            if (dayData.date instanceof Date) {
              dateId = getDateId(dayData.date);
            } else if (typeof dayData.date === 'string') {
              // Check if it's already in YYYY-MM-DD format
              if (/^\d{4}-\d{2}-\d{2}$/.test(dayData.date)) {
                dateId = dayData.date;
              } else {
                // Try parsing as date string
                const dateObj = new Date(dayData.date);
                dateId = getDateId(dateObj);
              }
            } else if (dayData.timestamp) {
              // If timestamp is available, use that
              const dateObj = new Date(dayData.timestamp);
              dateId = getDateId(dateObj);
            } else {
              // Fallback: try to parse as date
              const dateObj = new Date(dayData.date);
              dateId = getDateId(dateObj);
            }
            
            // Fetch user messages for that day
            const messagesResult = await firestoreService.getChatMessagesNew(user.uid, dateId);
            if (messagesResult.success && messagesResult.messages) {
              // Calculate total character count from user messages
              actualUserCharacterCount = messagesResult.messages
                .filter(msg => msg.sender === 'user' && msg.text)
                .reduce((total, msg) => total + msg.text.length, 0);
              console.log(`📊 User wrote ${actualUserCharacterCount} characters on ${dayData.date} (dateId: ${dateId})`);
            }
          }
        } catch (error) {
          console.warn('⚠️ Could not fetch user messages for character count:', error);
        }
      }
      
      // Calculate character limit (2x user character count)
      const maxReflectionCharacters = actualUserCharacterCount ? actualUserCharacterCount * 2 : null;
      
      if (maxReflectionCharacters) {
        console.log(`📊 Reflection limit: ${maxReflectionCharacters} characters (2x user input: ${actualUserCharacterCount})`);
      }
      
      // Estimate max tokens from character count (conservative: 3 chars per token)
      const estimatedMaxTokens = maxReflectionCharacters ? Math.floor(maxReflectionCharacters / 3) : 200;
      
      const characterLimitInstruction = maxReflectionCharacters 
        ? `\n\nCRITICAL CHARACTER LIMIT: The response must NEVER exceed ${maxReflectionCharacters} characters (which is 2x the ${actualUserCharacterCount} characters the user wrote on this day). Always stay within this strict character limit.`
        : '';
      
      const prompt = `You are Deite — a compassionate AI therapist and emotional analyst.
You are analyzing a user's emotional wellbeing based on their daily reflections, moods, and emotional summaries.

${type === 'best' ? `
Analyze the BEST MOOD DAY and explain why this day felt so positive.
- Focus on what made it special: achievements, positive connections, self-growth, calmness, or healing
- Be specific about the emotional cause
- Avoid generic phrases like "this was likely due to" or "you might have felt"
- Use direct reasoning: "You felt emotionally elevated because you overcame self-doubt during your project presentation, proving to yourself that persistence pays off."
` : `
Analyze the MOST CHALLENGING DAY and explain why it was emotionally difficult.
- Identify emotional triggers, inner conflicts, or moments of overwhelm
- Offer gentle insight into their coping process or emotional growth
- Avoid robotic summaries like "multiple pressures" — make it sound human, like a therapist's reflection
- Be specific about the emotional cause
`}

Date: ${dayData.date || 'Unknown'}
Mood: ${dayData.happiness}% happiness, ${dayData.energy}% energy
Stress: ${dayData.stress}% stress, ${dayData.anxiety}% anxiety

${dayData.summary ? `Summary from that day: ${dayData.summary}` : 'No daily summary available for this day.'}

Keep the response warm, natural, and empathetic (3-5 sentences). Focus on meaning and emotional cause, not numbers.${characterLimitInstruction}`;

      // Use sendMessage but with token limit
      const response = await this.sendMessage(prompt);
      let description = response.trim();
      
      // Enforce character limit: description must not exceed 2x user character count
      if (maxReflectionCharacters && description.length > maxReflectionCharacters) {
        console.warn(`⚠️ Generated description (${description.length} chars) exceeds limit (${maxReflectionCharacters} chars). Truncating...`);
        // Truncate to the character limit, trying to end at a sentence boundary
        description = description.substring(0, maxReflectionCharacters);
        // Try to find the last sentence ending (., !, ?) before the limit
        const lastSentenceEnd = Math.max(
          description.lastIndexOf('.'),
          description.lastIndexOf('!'),
          description.lastIndexOf('?')
        );
        if (lastSentenceEnd > maxReflectionCharacters * 0.7) {
          // If we found a sentence end reasonably close to the limit, use it
          description = description.substring(0, lastSentenceEnd + 1);
        }
        console.log(`✅ Truncated description to ${description.length} characters (within ${maxReflectionCharacters} limit)`);
      }
      
      console.log(`📖 Generated ${type} day description: ${description.length} characters${maxReflectionCharacters ? ` (limit: ${maxReflectionCharacters})` : ''}`);
      return description;
    } catch (error) {
      console.error(`❌ Error generating ${type} day description:`, error);
      return `You experienced ${type === 'best' ? 'a significantly positive day' : 'a challenging emotional period'} during ${periodText}. Reflect on what contributed to this experience and how it relates to your ongoing emotional journey.`;
    }
  }
}

export default new ChatService();