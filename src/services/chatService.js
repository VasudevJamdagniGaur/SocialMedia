import { getCurrentUser } from './authService';
import firestoreService from './firestoreService';
import { getDateId } from '../utils/dateUtils';

class ChatService {
  constructor() {
    this.openaiApiKey = process.env.REACT_APP_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
    this.geminiApiKey = process.env.REACT_APP_GOOGLE_API_KEY || process.env.GOOGLE_API_KEY || '';
    this.grokApiKey = process.env.REACT_APP_GROK_API_KEY || process.env.GROK_API_KEY || '';
    this.apiProvider = 'openai'; // 'openai', 'gemini', or 'grok'
    this.openaiBaseURL = 'https://api.openai.com/v1';
    this.geminiBaseURL = 'https://generativelanguage.googleapis.com/v1beta';
    this.grokBaseURL = 'https://api.x.ai/v1';
    this.openaiModelName = 'gpt-4o';
    this.geminiModelName = 'gemini-3-flash-preview';
    this.grokModelName = 'grok-3';
    this.visionModelName = 'gpt-4o'; // For OpenAI vision
    // Image generation: Gemini (gemini-3-pro-image-preview / Nano Banana Pro)
    this.geminiImageModelName = 'gemini-3-pro-image-preview';

    // Debug: Log API key status (first 10 chars only for security)
    console.log('🔑 API Keys loaded:');
    console.log('  OpenAI:', this.openaiApiKey ? `${this.openaiApiKey.substring(0, 10)}... (${this.openaiApiKey.length} chars)` : 'NOT SET');
    console.log('  Gemini:', this.geminiApiKey ? `${this.geminiApiKey.substring(0, 10)}... (${this.geminiApiKey.length} chars)` : 'NOT SET');
    console.log('  Grok:', this.grokApiKey ? `${this.grokApiKey.substring(0, 10)}... (${this.grokApiKey.length} chars)` : 'NOT SET');
    console.log('🔍 Environment variables check:');
    console.log('  REACT_APP_GROK_API_KEY exists:', !!process.env.REACT_APP_GROK_API_KEY);
    console.log('  REACT_APP_GROK_API_KEY value:', process.env.REACT_APP_GROK_API_KEY ? `${process.env.REACT_APP_GROK_API_KEY.substring(0, 10)}...` : 'undefined');
  }

  /**
   * Set the API provider (openai, gemini, or grok)
   */
  setApiProvider(provider) {
    if (provider === 'openai' || provider === 'gemini' || provider === 'grok') {
      this.apiProvider = provider;
      console.log('🔄 API Provider switched to:', provider);
    } else {
      console.warn('⚠️ Invalid API provider:', provider);
    }
  }

  /**
   * Get current API key based on provider
   */
  getApiKey() {
    if (this.apiProvider === 'openai') return this.openaiApiKey;
    if (this.apiProvider === 'gemini') return this.geminiApiKey;
    if (this.apiProvider === 'grok') return this.grokApiKey;
    return this.openaiApiKey; // Default fallback
  }

  /**
   * Get current base URL based on provider
   */
  getBaseURL() {
    if (this.apiProvider === 'openai') return this.openaiBaseURL;
    if (this.apiProvider === 'gemini') return this.geminiBaseURL;
    if (this.apiProvider === 'grok') return this.grokBaseURL;
    return this.openaiBaseURL; // Default fallback
  }

  /**
   * Get current model name based on provider
   */
  getModelName() {
    if (this.apiProvider === 'openai') return this.openaiModelName;
    if (this.apiProvider === 'gemini') return this.geminiModelName;
    if (this.apiProvider === 'grok') return this.grokModelName;
    return this.openaiModelName; // Default fallback
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

      // Use DuckDuckGo Instant Answer API (free, no API key)
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

      // Vision analysis currently only supports OpenAI (for now)
      // Use OpenAI API key for vision analysis
      const visionApiKey = this.openaiApiKey;
      if (!visionApiKey || visionApiKey.trim() === '') {
        throw new Error('OpenAI API key is required for vision analysis.');
      }

      const apiUrl = `${this.openaiBaseURL}/chat/completions`;
      const requestBody = {
        model: this.visionModelName,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: visionPrompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${cleanBase64}`
              }
            }
          ]
        }],
        temperature: 0.3, // Lower temp for more accurate descriptions
        max_tokens: 500 // Longer description
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
            'Authorization': `Bearer ${visionApiKey}`
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
      
      // Parse OpenAI vision API response format
      let imageDescription = '';
      if (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
        imageDescription = data.choices[0].message.content;
      }
      
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
    console.log('🚀 CHAT DEBUG: API Provider:', this.apiProvider);
    console.log('🚀 CHAT DEBUG: Using URL:', this.getBaseURL());
    
    // Reload API keys from environment (in case .env was updated)
    // This allows picking up new keys without restarting the app
    this.openaiApiKey = process.env.REACT_APP_OPENAI_API_KEY || this.openaiApiKey || '';
    this.geminiApiKey = process.env.REACT_APP_GOOGLE_API_KEY || this.geminiApiKey || '';
    this.grokApiKey = process.env.REACT_APP_GROK_API_KEY || this.grokApiKey || '';
    
    // Validate API key
    const apiKey = this.getApiKey();
    if (!apiKey || apiKey.trim() === '') {
      const providerName = this.apiProvider === 'openai' ? 'OpenAI' : this.apiProvider === 'gemini' ? 'Gemini' : 'Grok';
      const envKeyName = this.apiProvider === 'openai' ? 'REACT_APP_OPENAI_API_KEY' : this.apiProvider === 'gemini' ? 'REACT_APP_GOOGLE_API_KEY' : 'REACT_APP_GROK_API_KEY';
      
      console.error('❌ CHAT DEBUG: API key is missing!');
      console.error(`❌ CHAT DEBUG: Provider: ${providerName}`);
      console.error(`❌ CHAT DEBUG: Environment variable: ${envKeyName}`);
      console.error(`❌ CHAT DEBUG: process.env.${envKeyName}:`, process.env[envKeyName] ? `${process.env[envKeyName].substring(0, 10)}...` : 'undefined');
      console.error(`❌ CHAT DEBUG: this.grokApiKey:`, this.grokApiKey ? `${this.grokApiKey.substring(0, 10)}...` : 'empty');
      console.error(`❌ CHAT DEBUG: All env vars:`, {
        'REACT_APP_OPENAI_API_KEY': process.env.REACT_APP_OPENAI_API_KEY ? 'SET' : 'NOT SET',
        'REACT_APP_GOOGLE_API_KEY': process.env.REACT_APP_GOOGLE_API_KEY ? 'SET' : 'NOT SET',
        'REACT_APP_GROK_API_KEY': process.env.REACT_APP_GROK_API_KEY ? 'SET' : 'NOT SET'
      });
      
      throw new Error(`${providerName} API key is not configured. Please check your ${envKeyName} in the .env file and restart the React development server.`);
    }
    
    // Log API key status (first 10 chars only for security)
    console.log('✅ CHAT DEBUG: API key found (first 10 chars):', apiKey.substring(0, 10) + '...');
    console.log('✅ CHAT DEBUG: API key length:', apiKey.length);
    
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
      
      // Get model name based on provider
      const modelToUse = this.getModelName();
      const hasImageContext = !!imageDescription;
      
      console.log('🚀 CHAT DEBUG: Using model:', modelToUse);
      console.log('🚀 CHAT DEBUG: Has image context:', hasImageContext);
      console.log('🚀 CHAT DEBUG: API Provider:', this.apiProvider);
      
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

      // Prepare API request based on provider
      let apiUrl, requestBody, headers;
      
      if (this.apiProvider === 'openai') {
        // OpenAI API
        apiUrl = `${this.openaiBaseURL}/chat/completions`;
        requestBody = {
          model: this.openaiModelName,
          messages: [{
            role: 'user',
            content: simplePrompt
          }],
          temperature: 0.65,
          max_tokens: 500
        };
        headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        };
      } else if (this.apiProvider === 'grok') {
        // Grok API (similar to OpenAI structure)
        apiUrl = `${this.grokBaseURL}/chat/completions`;
        requestBody = {
          model: this.grokModelName,
          messages: [{
            role: 'user',
            content: simplePrompt
          }],
          temperature: 0.65,
          max_tokens: 500
        };
        headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        };
      } else {
        // Gemini API - v1, key as query param
        apiUrl = `${this.geminiBaseURL}/models/${this.geminiModelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
        requestBody = {
          contents: [{
            parts: [{
              text: simplePrompt
            }]
          }],
          generationConfig: {
            temperature: 0.65,
            maxOutputTokens: 500
          }
        };
        headers = {
          'Content-Type': 'application/json'
        };
      }
      
      console.log('📤 CHAT DEBUG: Full API URL:', apiUrl);
      console.log('📤 CHAT DEBUG: API Base URL:', this.getBaseURL());
      console.log('📤 CHAT DEBUG: Model:', modelToUse);
      console.log('📤 CHAT DEBUG: Prompt length:', simplePrompt.length);
      console.log('📤 CHAT DEBUG: Has image context:', hasImageContext);
      console.log('📤 CHAT DEBUG: API Key present:', apiKey ? 'YES' : 'NO');
      
      // Add timeout to prevent hanging requests (60 seconds for chat)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
      
      let response;
      try {
        response = await fetch(apiUrl, {
          method: 'POST',
          headers: headers,
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
        
        const providerName = this.apiProvider === 'openai' ? 'OpenAI' : this.apiProvider === 'gemini' ? 'Gemini' : 'Grok';
        const envKeyName = this.apiProvider === 'openai' ? 'REACT_APP_OPENAI_API_KEY' : this.apiProvider === 'gemini' ? 'REACT_APP_GOOGLE_API_KEY' : 'REACT_APP_GROK_API_KEY';
        
        // Provide more specific error messages
        if (response.status === 400) {
          // Check if it's an API key error
          if (errorText.includes('API key') || errorText.includes('invalid') || errorText.includes('permission')) {
            throw new Error(`Invalid or missing ${providerName} API key. Please check your ${envKeyName} in the .env file and make sure it's correct.`);
          }
          throw new Error(`Bad request: ${errorText.substring(0, 200)}`);
        } else if (response.status === 401 || response.status === 403) {
          throw new Error(`API key authentication failed. Please check your ${envKeyName} in the .env file. Make sure the key is valid and has the necessary permissions.`);
        } else if (response.status === 404) {
          throw new Error('AI model not found. Please check if the model is available.');
        } else if (response.status === 500 || response.status === 502 || response.status === 503) {
          throw new Error('AI server is temporarily unavailable. Please try again in a moment.');
        } else if (response.status === 504) {
          throw new Error('Request timed out. The AI server is taking too long to respond.');
        }
        
        throw new Error(`Model ${modelToUse} failed: ${response.status} ${response.statusText}. ${errorText.substring(0, 200)}`);
      }
      
      // Handle response based on provider
      const data = await response.json();
      const providerDisplayName = this.apiProvider === 'openai' ? 'OpenAI' : this.apiProvider === 'gemini' ? 'Gemini' : 'Grok';
      console.log(`✅ CHAT DEBUG: Received response from ${providerDisplayName} API`);
      console.log('✅ CHAT DEBUG: Response keys:', Object.keys(data));
      
      let aiResponse = '';
      
      if (this.apiProvider === 'openai' || this.apiProvider === 'grok') {
        // Parse OpenAI/Grok API response format (same structure)
        if (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
          aiResponse = data.choices[0].message.content;
        } else {
          console.error(`❌ CHAT DEBUG: Unexpected response format from ${providerDisplayName} API`);
          console.error('❌ CHAT DEBUG: Full response data:', JSON.stringify(data, null, 2));
          
          // Check for error in response
          if (data.error) {
            throw new Error(`${providerDisplayName} API Error: ${data.error.message || JSON.stringify(data.error)}`);
          }
          
          throw new Error(`Unexpected response format from ${providerDisplayName} API. Please check your API key and try again. Check console for full response details.`);
        }
      } else {
        // Parse Gemini API response format
        if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
          aiResponse = data.candidates[0].content.parts.map(part => part.text).join('');
        } else {
          console.error('❌ CHAT DEBUG: Unexpected response format from Gemini API');
          console.error('❌ CHAT DEBUG: Full response data:', JSON.stringify(data, null, 2));
          
          // Check for error in response
          if (data.error) {
            throw new Error(`Gemini API Error: ${data.error.message || JSON.stringify(data.error)}`);
          }
          
          throw new Error('Unexpected response format from Gemini API. Please check your API key and try again. Check console for full response details.');
        }
      }
      
      if (!aiResponse || aiResponse.trim() === '') {
        console.error(`❌ CHAT DEBUG: Empty response from ${providerDisplayName} API`);
        throw new Error('Empty response from AI. Please check your API key and try again.');
      }
      
      console.log(`✅ CHAT DEBUG: Successfully got response from ${providerDisplayName} API`);
      console.log('✅ CHAT DEBUG: AI Response:', aiResponse.substring(0, 100));
      return aiResponse;
      
    } catch (error) {
      console.error('❌ CHAT DEBUG: Error in sendMessage:', error);
      throw error;
    }
  }

  /**
   * Edit text using AI (Gemini, Grok, or OpenAI) based on user instruction.
   * Uses the same provider as chat (localStorage 'chat_api_provider').
   * @param {string} text - The text to edit
   * @param {string} instruction - What change to make (e.g. "make it more formal", "fix grammar")
   * @returns {Promise<string>} - The edited text only
   */
  async editTextWithAI(text, instruction) {
    const savedProvider = (typeof localStorage !== 'undefined' && localStorage.getItem('chat_api_provider')) || 'openai';
    this.setApiProvider(savedProvider);

    this.openaiApiKey = process.env.REACT_APP_OPENAI_API_KEY || this.openaiApiKey || '';
    this.geminiApiKey = process.env.REACT_APP_GOOGLE_API_KEY || this.geminiApiKey || '';
    this.grokApiKey = process.env.REACT_APP_GROK_API_KEY || this.grokApiKey || '';

    const apiKey = this.getApiKey();
    if (!apiKey || apiKey.trim() === '') {
      const providerName = this.apiProvider === 'openai' ? 'OpenAI' : this.apiProvider === 'gemini' ? 'Gemini' : 'Grok';
      const envKeyName = this.apiProvider === 'openai' ? 'REACT_APP_OPENAI_API_KEY' : this.apiProvider === 'gemini' ? 'REACT_APP_GOOGLE_API_KEY' : 'REACT_APP_GROK_API_KEY';
      throw new Error(`${providerName} API key is not set. Add ${envKeyName} in .env`);
    }

    const prompt = `Apply the following edit to the text below. Return ONLY the edited text, no quotes, no explanation, no preamble.

Edit instruction: ${instruction}

Text:
${text}`;

    let apiUrl, requestBody, headers;
    if (this.apiProvider === 'openai') {
      apiUrl = `${this.openaiBaseURL}/chat/completions`;
      requestBody = {
        model: this.openaiModelName,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1000
      };
      headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
    } else if (this.apiProvider === 'grok') {
      apiUrl = `${this.grokBaseURL}/chat/completions`;
      requestBody = {
        model: this.grokModelName,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1000
      };
      headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
    } else {
      apiUrl = `${this.geminiBaseURL}/models/${this.geminiModelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
      requestBody = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1000 }
      };
      headers = { 'Content-Type': 'application/json' };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`AI edit failed: ${response.status} ${errText.substring(0, 150)}`);
    }

    const data = await response.json();
    let edited = '';
    if (this.apiProvider === 'openai' || this.apiProvider === 'grok') {
      edited = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ? data.choices[0].message.content : '';
    } else {
      edited = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts)
        ? data.candidates[0].content.parts.map(p => p.text).join('') : '';
    }
    return (edited || '').trim();
  }

  /**
   * Generate 1-3 platform-style post suggestions from a day reflection.
   * Can be one post for the whole day or one per incident (model decides).
  /**
   * Generate share suggestions as one standalone post per key event from the day's reflection.
   * Does not use "Option 1" / "Option 2"; each post is centered on one core event (e.g. meeting Sumit, reading Source Code).
   * @param {string} reflection - The day's reflection text
   * @param {string} platform - 'linkedin' | 'x' | 'reddit'
   * @returns {Promise<{ eventLabel: string, post: string }[]>} - Array of { eventLabel, post } per event
   */
  async generateSocialPostSuggestions(reflection, platform) {
    // Share suggestion text is always generated with OpenAI; rest of app can use other providers
    this.openaiApiKey = (process.env.REACT_APP_OPENAI_API_KEY || process.env.OPENAI_API_KEY || this.openaiApiKey || '').trim();
    const apiKey = this.openaiApiKey;
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('OpenAI API key is not set. Add REACT_APP_OPENAI_API_KEY to .env for share suggestions (LinkedIn, X, Reddit).');
    }

    const platformLabel = platform === 'x' ? 'X (Twitter)' : platform.charAt(0).toUpperCase() + platform.slice(1);

    const platformStyleGuide = {
      linkedin: `LINKEDIN STYLE (strict):
- Professional, polished tone. Thought-leadership or reflective professional narrative.
- Strong opening hook (question, observation, or bold line). Short paragraphs (1–3 lines).
- First person, authentic but career-friendly. Optional light insight or takeaway.
- End with 0–3 relevant hashtags (e.g. #Learning #Reflection). No emoji overload.`,
      x: `X (TWITTER) STYLE (strict):
- Very concise. Each post MUST be under 280 characters (count them).
- Punchy, direct. Line breaks for emphasis. One clear idea per post.
- Can be witty, candid, or reflective. 1–2 hashtags max. Emoji sparingly if at all.`,
      reddit: `REDDIT STYLE (strict):
- Casual, conversational, like r/CasualConversation or a personal story sub.
- First-person, relatable, authentic. Can be self-deprecating or funny.
- Natural paragraph flow. No corporate speak. Feels like talking to a friend.`
    };
    const styleGuide = platformStyleGuide[platform] || platformStyleGuide.linkedin;

    const prompt = `You are turning a day's reflection into separate social posts. You MUST create one standalone post for EACH distinct event or moment mentioned in the reflection.

PLATFORM: ${platformLabel}. Write EVERY post in that platform's native style so it reads like a real ${platformLabel} post.

${styleGuide}

Step 1 – List EVERY main event/moment in the reflection. Include ALL of these when present:
- Embarrassing or funny moments (e.g. wrong door, mix-up, mistake)
- Books, articles, or media mentioned by name (e.g. "The Three-Body Problem", "Source Code", "Crime and Punishment")
- People you met or talked about
- Places you went (e.g. library, office, college)
- Work or projects you did (e.g. deep work, project in the library)
Do not skip any major event. If the user mentions a book, there must be a post about that book. If they mention a mix-up and a book, output two posts (one per event).

Step 2 – For EACH event you listed, write ONE complete, standalone post that:
- Focuses only on that single event
- Expands on the thoughts, emotions, or insights from that moment
- Feels natural and reflective, like a real social post (not a summary)
- Is written EXACTLY in the ${platformLabel} style described above (tone, length, structure)

Output format (strict):
- For each post, first write exactly: EVENT: <short event label>
- Then on the next lines write the full post text.
- Separate each post with a line that contains only: ---
- Do NOT use "Option 1", "Option 2", or any option labels. Only EVENT: and the post content.

Example format (reflection mentioned a mix-up AND a book):
EVENT: The Director's office mix-up
[Full post about that moment only.]

---
EVENT: Reading The Three-Body Problem
[Full post about the book and your thoughts only.]

Reflection:
${(reflection || '').trim()}`;

    const apiUrl = `${this.openaiBaseURL}/chat/completions`;
    const requestBody = {
      model: this.openaiModelName,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: 2400
    };
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Suggestions failed: ${response.status} ${errText.substring(0, 150)}`);
    }

    const data = await response.json();
    const raw = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ? data.choices[0].message.content : '';
    const trimmed = (raw || '').trim();
    if (!trimmed) return [{ eventLabel: 'Reflection', post: reflection.trim() }];

    // Split by --- first; if only one block but text has multiple "EVENT:", split by EVENT: to get all
    let blocks = trimmed.split(/\n *--- *\n/).map(s => s.trim()).filter(Boolean);
    if (blocks.length <= 1 && (trimmed.match(/EVENT:\s*/gi) || []).length >= 2) {
      const eventParts = trimmed.split(/\s*EVENT:\s*/i);
      blocks = eventParts
        .map(p => p.trim())
        .filter(Boolean)
        .map(p => (p.match(/^EVENT:/i) ? p : 'EVENT: ' + p));
    }
    const result = [];
    for (const block of blocks) {
      const eventMatch = block.match(/^EVENT:\s*(.+?)(?:\n|$)/i);
      const eventLabel = eventMatch ? eventMatch[1].trim() : '';
      const post = eventMatch ? block.slice(block.indexOf('\n') + 1).trim() : block;
      if (post) result.push({ eventLabel: eventLabel || 'Moment', post });
    }
    if (result.length === 0) return [{ eventLabel: 'Reflection', post: reflection.trim() }];
    return result;
  }

  // ---------- Image: context + user profile → Gemini (same style for LinkedIn and X) ----------

  /**
   * Extract famous personality, event, place, brand, object from share suggestion (kept for possible future use; not used for image routing).
   * @param {string} postText - Generated share suggestion text
   * @returns {Promise<{ personality: string[], event: string[], place: string[], brand: string[], object: string[] }>}
   */
  async _detectFamousEntities(postText) {
    const apiKey = (this.geminiApiKey || process.env.REACT_APP_GOOGLE_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
    const text = (postText || '').trim();
    const empty = { personality: [], event: [], place: [], brand: [], object: [] };
    if (!apiKey || !text) return empty;

    const prompt = `Extract ONLY famous or well-known entities from the text. Return STRICT JSON, no markdown.

Rules:
- personality: famous people (celebrities, leaders, authors, historical figures). NOT personal contacts or friends.
- event: famous events, named books, films, conferences, awards (e.g. "The Three-Body Problem", "Source Code" book, "Oscars").
- place: famous or iconic places, landmarks, cities, venues.
- brand: famous brands, companies, products.
- object: famous objects, artworks, monuments (e.g. Mona Lisa, Eiffel Tower as object).

Return format (use exactly):
{"personality":[],"event":[],"place":[],"brand":[],"object":[]}

If nothing famous, return empty arrays. Output only the JSON.

Text:
${text.slice(0, 1000)}`;

    try {
      const apiUrl = `${this.geminiBaseURL}/models/${this.geminiModelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 300 }
        })
      });
      if (!res.ok) return empty;
      const data = await res.json();
      let raw = (data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '').trim();
      raw = raw.replace(/```json?/gi, '').replace(/```/g, '').trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return empty;
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        personality: Array.isArray(parsed.personality) ? parsed.personality.filter(s => typeof s === 'string' && s.trim().length > 0).slice(0, 3) : [],
        event: Array.isArray(parsed.event) ? parsed.event.filter(s => typeof s === 'string' && s.trim().length > 0).slice(0, 3) : [],
        place: Array.isArray(parsed.place) ? parsed.place.filter(s => typeof s === 'string' && s.trim().length > 0).slice(0, 3) : [],
        brand: Array.isArray(parsed.brand) ? parsed.brand.filter(s => typeof s === 'string' && s.trim().length > 0).slice(0, 3) : [],
        object: Array.isArray(parsed.object) ? parsed.object.filter(s => typeof s === 'string' && s.trim().length > 0).slice(0, 3) : []
      };
    } catch (e) {
      console.warn('[Image] Famous entity detection failed:', e.message);
      return empty;
    }
  }

  /**
   * Extract context from post and build structured prompt for Gemini image generation.
   * Same instructions for LinkedIn and X: candid, engaging, natural (no platform-specific styling).
   * @param {string} postText - Share suggestion text
   * @param {{ displayName?: string, age?: string, nationality?: string, gender?: string, skinTone?: string, hairstyle?: string, clothingStyle?: string, profession?: string, profileImageUrl?: string }|null} userContext
   * @returns {Promise<string|null>} - Full image generation prompt or null
   */
  async _buildStructuredPromptForNoFamous(postText, userContext = null) {
    const apiKey = (this.geminiApiKey || process.env.REACT_APP_GOOGLE_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
    const text = (postText || '').trim();
    if (!apiKey || !text) return null;

    const age = (userContext?.age || '').trim() || '30';
    const gender = (userContext?.gender || '').trim() || 'person';
    const skinTone = (userContext?.skinTone || '').trim() || 'natural';
    const hairstyle = (userContext?.hairstyle || '').trim() || 'natural';
    const clothingStyle = (userContext?.clothingStyle || '').trim() || 'context-appropriate';
    const profession = (userContext?.profession || '').trim() || 'not specified';
    const profileImageUrl = (userContext?.profileImageUrl || '').trim();

    const extractPrompt = `Analyze this post and extract context for a single realistic photograph. Return STRICT JSON only, no markdown.

Keys (short phrases; empty string if not clear):
- mainActivity: what the person is doing (e.g. "reading a book", "working at a desk", "walking in a corridor")
- environment: location/setting (e.g. "quiet library", "office", "college corridor", "home")
- emotionalTone: mood (e.g. "focused", "embarrassed", "calm", "reflective")
- timeOfDay: "morning" or "afternoon" or "evening" or ""
- professionalOrCasual: "professional" or "casual" or "mixed" or ""
- bodyLanguage: body language cues (e.g. "relaxed posture", "slightly embarrassed", "focused on task") or ""
- contextualOutfit: clothing that fits the scene (e.g. "casual", "smart casual", "professional attire") or ""

Format: {"mainActivity":"","environment":"","emotionalTone":"","timeOfDay":"","professionalOrCasual":"","bodyLanguage":"","contextualOutfit":""}

Post:
${text.slice(0, 800)}`;

    try {
      const apiUrl = `${this.geminiBaseURL}/models/${this.geminiModelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: extractPrompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 250 }
        })
      });
      if (!res.ok) return null;
      const data = await res.json();
      let raw = (data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '').trim();
      raw = raw.replace(/```json?/gi, '').replace(/```/g, '').trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const c = JSON.parse(jsonMatch[0]);
      const activity = (c.mainActivity || '').trim() || 'sitting thoughtfully';
      const environment = (c.environment || '').trim() || 'neutral indoor setting';
      const tone = (c.emotionalTone || '').trim() || 'natural';
      const outfit = (c.contextualOutfit || '').trim() || clothingStyle;
      const bodyLanguage = (c.bodyLanguage || '').trim() || 'natural body language';

      const instructions = `You are generating a realistic, context-aware photograph for a social media post.

IMAGE GENERATION INSTRUCTIONS:
1. If the post implies the user is the main subject, generate a person that resembles the user.
2. If a profile image URL is provided, use it as a visual reference for facial structure, hair style, skin tone, and general appearance.
3. Do NOT replicate the face exactly.
4. Do NOT generate a celebrity look.
5. The generated person should look like the same individual but as a naturally photographed version in a real-world scene.
6. If the user is not the subject of the post, generate a context-appropriate person matching the story.

SCENE REQUIREMENTS:
- The scene must directly reflect the story context.
- No random animals or unrelated elements.
- Avoid generic stock-photo composition.
- Make it feel like a candid real-life captured moment.
- Use natural lighting.
- Use subtle, believable facial expressions.
- Realistic human proportions.
- No exaggerated AI-art style.
- No text overlay in the image.
- No logos unless mentioned in the post.`;

      const styleSuffix = 'professional DSLR photography, natural lighting, shallow depth of field, cinematic but realistic, authentic moment, not staged, not stock photo style.';

      const structuredPrompt = `A realistic high-detail photograph of a ${age}-year-old ${gender} with ${skinTone} skin tone and ${hairstyle} hair, resembling the user's profile appearance, wearing ${outfit}, ${activity}, in a ${environment}, ${bodyLanguage} reflecting ${tone}, ${styleSuffix}`;

      return `${instructions}\n\nGenerate the following image:\n\n${structuredPrompt}`;
    } catch (e) {
      console.warn('[Image] Context extraction failed:', e.message);
      return null;
    }
  }

  /**
   * Turn post content into a short image prompt (scene/mood). No entity extraction.
   * When the scene includes a non-famous person, use user details (name, age, nationality) or default to Indian.
   * @param {string} postText - Full post text
   * @param {{ displayName?: string, age?: string, nationality?: string }|null} [userContext] - Optional user details for depicting the person
   * @returns {Promise<string|null>} - One-sentence image description or null
   */
  async _getImagePromptFromContent(postText, userContext = null) {
    const apiKey = (this.geminiApiKey || process.env.REACT_APP_GOOGLE_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
    const text = (postText || '').trim();
    if (!apiKey || !text) return null;

    const nationality = (userContext?.nationality || 'Indian').trim();
    const userHint = userContext?.displayName || userContext?.age
      ? ` When the image includes a person (not a famous celebrity), describe them as ${nationality}${userContext?.displayName ? `, similar to a person named ${userContext.displayName}` : ''}${userContext?.age ? `, around ${userContext.age} years old` : ''}.`
      : ` When the image includes a person (not a famous celebrity), describe them as ${nationality}.`;

    const prompt = `Read this social media post and describe in ONE short sentence an image that would illustrate it.

IMPORTANT: The image must reflect the SPECIFIC content discussed in the post. Use the actual subjects mentioned:
- If the post discusses a specific book (e.g. "The Three-Body Problem", "Source Code", "Crime and Punishment"), the image should include that book or clearly show someone reading it, or the book's theme (e.g. sci-fi for Three-Body Problem).
- If the post discusses a place (e.g. library, director's office, college), include that setting.
- If the post discusses an event or moment (e.g. mix-up, meeting someone), show that context.
Do NOT describe a generic person in a generic setting. Always reference the specific book title, place, or topic from the post so the image matches what is discussed. Do not mention famous celebrity names.${userHint}

Output only that one sentence, nothing else. No quotes.

Post:
${text.slice(0, 800)}`;

    try {
      const apiUrl = `${this.geminiBaseURL}/models/${this.geminiModelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 80 }
        })
      });
      if (!res.ok) return null;
      const data = await res.json();
      const raw = (data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '').trim();
      const sentence = raw.replace(/^["']|["']$/g, '').trim().slice(0, 200);
      return sentence || null;
    } catch (e) {
      console.warn('[Image prompt] Content prompt failed:', e.message);
      return null;
    }
  }

  /**
   * Use Gemini to extract named entities (people, place, events) from text before any image routing.
   * Routing will use these entities in order: people first, then place, then events.
   * @param {string} postText - Full post text
   * @returns {Promise<{ persons: string[], places: string[], events: string[] }>}
   */
  async extractEntitiesWithNER(postText) {
    const apiKey = (this.geminiApiKey || process.env.REACT_APP_GOOGLE_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
    const empty = { persons: [], places: [], events: [] };
    const text = (postText || '').trim();
    if (!apiKey || !text) return empty;

    const prompt = `You are an entity extraction system.

Extract real-world named entities from the text below.

Rules:
- persons: ONLY famous or well-known public figures (celebrities, leaders, authors, historical figures). Examples: Bill Gates, Sam Altman, Elon Musk. Do NOT include personal contacts, friends, family, or acquaintances (e.g. "my friend Sumit" or "I met John" → leave persons empty).
- places: specific locations or venues (cities, institutions, buildings).
- events: named events, or named works like books (e.g. "Source Code" as a book title). Put book titles in events if they are clearly named.
- Include only real identifiable entities. Do NOT include abstract concepts or hashtags.
- Return STRICT JSON only. No explanation. No markdown. No commentary.

Return format (use this exact structure):
{"persons":[],"places":[],"events":[]}

Examples:
- "I caught up with my friend Sumit today" → {"persons":[],"places":[],"events":[]}
- "Reading Bill Gates' Source Code" → {"persons":["Bill Gates"],"places":[],"events":["Source Code"]}

Text:
${text}`;

    try {
      console.log('[Entity extraction] Input length:', text.length, 'Preview:', text.slice(0, 120) + (text.length > 120 ? '...' : ''));
      const apiUrl = `${this.geminiBaseURL}/models/${this.geminiModelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 350 }
        })
      });
      if (!res.ok) {
        console.warn('[Entity extraction] API not ok:', res.status);
        return this._fallbackEntityExtraction(text);
      }
      const data = await res.json();
      let raw = (data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '').trim();

      console.log('Raw Gemini entity output:', raw);

      raw = raw
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('[Entity extraction] No JSON object in response, using fallback');
        return this._fallbackEntityExtraction(text);
      }
      let parsed;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (parseErr) {
        console.warn('[Entity extraction] JSON parse failed:', parseErr.message, 'Using fallback');
        return this._fallbackEntityExtraction(text);
      }
      const persons = Array.isArray(parsed.persons) ? parsed.persons.filter(s => typeof s === 'string' && s.trim().length > 0 && s.length < 80) : [];
      const places = Array.isArray(parsed.places) ? parsed.places.filter(s => typeof s === 'string' && s.trim().length > 0 && s.length < 80) : [];
      const events = Array.isArray(parsed.events) ? parsed.events.filter(s => typeof s === 'string' && s.trim().length > 0 && s.length < 80) : [];
      const result = { persons, places, events };
      if (persons.length === 0 && places.length === 0 && events.length === 0) {
        const fallback = this._fallbackEntityExtraction(text);
        if (fallback.persons.length > 0 || fallback.places.length > 0 || fallback.events.length > 0) {
          console.log('[Entity extraction] Gemini returned empty, using fallback:', fallback);
          return fallback;
        }
      }
      return result;
    } catch (e) {
      console.warn('Entity extraction failed:', e.message);
      return this._fallbackEntityExtraction(text);
    }
  }

  /**
   * Fallback when Gemini returns invalid/empty: only add famous personalities and book titles.
   * Do NOT add personal contacts (e.g. Sumit, friends, family).
   */
  _fallbackEntityExtraction(text) {
    const result = { persons: [], places: [], events: [] };
    if (!text || typeof text !== 'string') return result;
    const t = text.trim();
    if (!t.length) return result;
    const famousOnly = new Set(['Bill Gates', 'Sam Altman', 'Elon Musk']);
    if (/\bBill\s+Gates\b/i.test(t)) result.persons.push('Bill Gates');
    if (/\bSam\s+Altman\b/i.test(t)) result.persons.push('Sam Altman');
    if (/\bElon\s+Musk\b/i.test(t)) result.persons.push('Elon Musk');
    const possessiveMatch = t.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)[''"]\s*(?:Source\s+Code|[\w\s]+)/g);
    if (possessiveMatch) {
      possessiveMatch.forEach((m) => {
        const name = m.replace(/[''"].*$/, '').trim();
        if (name.length > 1 && name.length < 50 && famousOnly.has(name)) result.persons.push(name);
      });
    }
    result.persons = [...new Set(result.persons)];
    if (/\bSource\s+Code\b/i.test(t) && !result.events.includes('Source Code')) result.events.push('Source Code');
    return result;
  }

  /**
   * Build image generation prompt: combine multiple entities into one LinkedIn-style thumbnail (not just a simple portrait).
   * When both person and event (e.g. book) are present, feature both in a single composite image with minimal text.
   * @param {{ persons: string[], places: string[], events: string[] }} entities
   * @returns {string|null} - Prompt for Gemini image model or null if no entity
   */
  _getImagePromptFromEntities(entities) {
    const { persons, places, events } = entities;
    const person = persons[0]?.trim();
    const place = places[0]?.trim();
    const event = events[0]?.trim();

    const styleSuffix = 'Professional LinkedIn-style thumbnail, minimal text on image, high quality, engaging.';
    // Person + event (e.g. Bill Gates + Source Code book): composite thumbnail featuring both
    if (person && event) {
      return `${person} with the book "${event}", featured together in one image. ${styleSuffix}`;
    }
    // Person + place
    if (person && place) {
      return `${person} at ${place}, featured together. ${styleSuffix}`;
    }
    // Person only: avoid "simple portrait" — more thumbnail-like
    if (person) {
      return `${person}, professional LinkedIn-style thumbnail, engaging and dynamic, not a plain headshot. ${styleSuffix}`;
    }
    // Place only
    if (place) {
      return `${place}, professional LinkedIn-style thumbnail. ${styleSuffix}`;
    }
    // Event only (e.g. book title, conference)
    if (event) {
      return `"${event}" featured prominently, professional LinkedIn-style thumbnail, minimal text. ${styleSuffix}`;
    }
    return null;
  }

  /**
   * Generate one image per post using Gemini: extract context + user profile, build structured prompt, generate image.
   * Same instructions used for LinkedIn and X (candid, engaging, natural).
   * @param {string} postText - Full post text (share suggestion)
   * @param {{ displayName?: string, age?: string, nationality?: string, gender?: string }|null} [userContext] - User profile
   * @param {string} [platform] - 'linkedin' | 'x' | 'reddit' — Reddit does not use images; LinkedIn and X use same style
   * @returns {Promise<string|null>} - Data URL (Gemini) or null
   */
  async fetchImageForReflection(postText, userContext = null, platform = 'x') {
    if (!postText?.trim()) return null;
    const fullText = postText.trim();

    const geminiKey = (this.geminiApiKey || process.env.REACT_APP_GOOGLE_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
    if (!geminiKey) {
      console.warn('[Image] Gemini API key not set');
      return null;
    }

    const imagePrompt = await this._buildStructuredPromptForNoFamous(fullText, userContext);
    if (!imagePrompt) {
      const firstSentence = fullText.split(/[.!?]/)[0]?.trim().slice(0, 100) || fullText.slice(0, 100);
      if (!firstSentence) return null;
      const age = (userContext?.age || '').trim() || '30';
      const gender = (userContext?.gender || '').trim().toLowerCase() || 'person';
      const nationality = (userContext?.nationality || 'Indian').trim();
      const fallback = `A realistic photograph of a ${age} year old ${gender} (${nationality}), ${firstSentence}, natural lighting, high detail, not a celebrity, not stock.`;
      return this._generateImageWithGemini(fallback, geminiKey);
    }

    const strictRules = 'STRICT: Do not generate random unrelated visuals. Do not generate animals unless explicitly mentioned. Do not generate generic stock office images. The person must look contextually aligned with the story. Avoid famous faces. Keep realism high.';
    return this._generateImageWithGemini(`${imagePrompt} ${strictRules}`, geminiKey);
  }

  /**
   * Call Gemini Image Generation API; returns data URL or null.
   * @param {string} prompt - Full image prompt
   * @param {string} apiKey - Gemini API key
   * @returns {Promise<string|null>}
   */
  async _generateImageWithGemini(prompt, apiKey) {
    try {
      const apiUrl = `${this.geminiBaseURL}/models/${this.geminiImageModelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: { aspectRatio: '1:1', imageSize: '2K' }
          }
        })
      });
      if (!res.ok) {
        console.warn('[Image] Gemini image API error:', res.status, await res.text());
        return null;
      }
      const data = await res.json();
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const imagePart = parts.find(p => p.inlineData && p.inlineData.data);
      if (!imagePart?.inlineData) return null;
      const { mimeType = 'image/png', data: base64 } = imagePart.inlineData;
      return `data:${mimeType};base64,${base64}`;
    } catch (e) {
      console.warn('[Image] Gemini generation failed:', e.message);
      return null;
    }
  }

  /**
   * Returns image prompt from post content. Kept for compatibility.
   */
  async getImageSearchQueryForPost(postText) {
    const searchQuery = await this._getImagePromptFromContent(postText || '');
    return { queries: searchQuery ? [searchQuery] : [] };
  }

  /** @deprecated Use getImageSearchQueryForPost / fetchImageForReflection. Kept for compatibility. */
  async getImageSearchQuery(reflection) {
    return this.getImageSearchQueryForPost(reflection);
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