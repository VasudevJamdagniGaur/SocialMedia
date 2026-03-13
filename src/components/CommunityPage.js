import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { MessageCircle, Heart, User, Sun, Moon, Send, X, Plus, XCircle, Image, Link, Share2, Repeat, Bookmark } from 'lucide-react';
import { getCurrentUser } from '../services/authService';
import firestoreService from '../services/firestoreService';
import { collection, addDoc, query, orderBy, getDocs, serverTimestamp, doc, setDoc, updateDoc, increment, deleteDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import { userEventService } from '../services/userEventService';

export default function CommunityPage() {
  const navigate = useNavigate();
  const { isDarkMode, toggleTheme } = useTheme();
  // --- Feed event tracking (impression/view/scroll/dwell + engagement events) ---
  const sessionIdRef = useRef(null);
  const observerRef = useRef(null);
  const observedElsRef = useRef(new Map()); // postId -> element
  const dwellStartRef = useRef(new Map()); // postId -> ms timestamp
  const impressionOnceRef = useRef(new Set()); // postId
  const feedPositionsRef = useRef(new Map()); // postId -> position (1-indexed)
  const [profilePicture, setProfilePicture] = useState(null);
  const [likes, setLikes] = useState(24);
  const [isLiked, setIsLiked] = useState(false);
  const [comments, setComments] = useState([
    { id: 1, author: 'Alex', text: 'Great post! Keep it up! 🌟', time: '1 hour ago' },
    { id: 2, author: 'Sam', text: 'Mindfulness has changed my life too!', time: '45 mins ago' },
  ]);
  const [showComments, setShowComments] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [showCreatePost, setShowCreatePost] = useState(false);
  const [postContent, setPostContent] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [communityPosts, setCommunityPosts] = useState([]);
  const [postComments, setPostComments] = useState({});
  const [postLikes, setPostLikes] = useState({});
  const [postLikedBy, setPostLikedBy] = useState({}); // Track which users liked each post
  const [commentReplies, setCommentReplies] = useState({}); // Track replies for each comment: { [postId-commentId]: [replies] }
  const [replyingTo, setReplyingTo] = useState(null); // Track which comment is being replied to: { postId, commentId }
  const [replyText, setReplyText] = useState(''); // Reply input text
  const [postImage, setPostImage] = useState(null);
  const [postImageUrl, setPostImageUrl] = useState('');
  const [uploadOption, setUploadOption] = useState(null); // 'device' or 'url'
  const [showFAB, setShowFAB] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [activeMembersCount, setActiveMembersCount] = useState(0);
  const [postsTodayCount, setPostsTodayCount] = useState(0);
  const [activeTab, setActiveTab] = useState('explore'); // 'mySpace' | 'following' | 'explore'
  const [followingIds, setFollowingIds] = useState([]);

  useEffect(() => {
    // New session for each feed open (per requirements)
    sessionIdRef.current = userEventService.startSession();
    return () => {
      try {
        userEventService.flush();
      } catch (_) {}
    };
  }, []);
  const [tabTransition, setTabTransition] = useState(false);
  const [tabTouchStart, setTabTouchStart] = useState(null);
  const TAB_ORDER = ['mySpace', 'following', 'explore'];
  const [followLoadingUid, setFollowLoadingUid] = useState(null);
  const [socialShares, setSocialShares] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);

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

    const handleProfilePictureUpdate = (ev) => {
      const newUrl = ev && ev.detail && ev.detail.profilePictureUrl;
      if (newUrl) {
        setProfilePicture(newUrl);
        const u = getCurrentUser();
        if (u) try { localStorage.setItem(`user_profile_picture_${u.uid}`, newUrl); } catch (_) {}
      } else {
        loadProfilePicture();
      }
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

  // Scroll detection for FAB visibility
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      
      // Show FAB when scrolling up, hide when scrolling down
      if (currentScrollY < lastScrollY) {
        // Scrolling up
        setShowFAB(true);
      } else if (currentScrollY > lastScrollY && currentScrollY > 100) {
        // Scrolling down and past 100px
        setShowFAB(false);
      }
      
      setLastScrollY(currentScrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [lastScrollY]);

  const handleProfileClick = () => {
    navigate('/profile');
  };

  const handleLike = () => {
    if (isLiked) {
      setLikes(likes - 1);
      setIsLiked(false);
    } else {
      setLikes(likes + 1);
      setIsLiked(true);
    }
  };

  const handleCommentClick = () => {
    setShowComments(!showComments);
  };

  const handleAddComment = async (postId, parentCommentId = null) => {
    const commentText = parentCommentId 
      ? replyText 
      : (postId ? (postComments[postId]?.newComment || '') : newComment);
    
    if (commentText.trim()) {
      const user = getCurrentUser();
      if (!user) {
        alert('Please sign in to comment');
        return;
      }
      
      const author = localStorage.getItem(`user_display_name_${user.uid}`) || user?.displayName || user?.email?.split('@')[0] || 'Anonymous';
      const commenterProfilePicture = localStorage.getItem(`user_profile_picture_${user.uid}`) || profilePicture || null;
      
      if (parentCommentId) {
        // Add reply to comment
        try {
          const repliesRef = collection(db, `communityPosts/${postId}/comments/${parentCommentId}/replies`);
          await addDoc(repliesRef, {
            text: commentText.trim(),
            author: author,
            authorName: author,
            userId: user.uid,
            profilePicture: commenterProfilePicture || null,
            createdAt: serverTimestamp()
          });
          // Track engagement: comment (reply)
          logEngagement('comment', postId);
          
          // Clear reply input and reset replyingTo
          setReplyText('');
          setReplyingTo(null);
        } catch (error) {
          console.error('Error saving reply:', error);
          alert('Failed to add reply. Please try again.');
        }
      } else if (postId) {
        // Add comment to subcollection
        try {
          const commentsRef = collection(db, `communityPosts/${postId}/comments`);
          await addDoc(commentsRef, {
            text: commentText.trim(),
            author: author,
            authorName: author,
            userId: user.uid,
            profilePicture: commenterProfilePicture || null,
            createdAt: serverTimestamp()
          });
          // Track engagement: comment
          logEngagement('comment', postId);
          
          // Clear the comment input
          setPostComments({
            ...postComments,
            [postId]: {
              ...postComments[postId],
              newComment: ''
            }
          });
        } catch (error) {
          console.error('Error saving comment:', error);
          alert('Failed to add comment. Please try again.');
        }
      } else {
        // Legacy support for old post
        const newCommentObj = {
          id: Date.now(),
          author: author,
          text: commentText.trim(),
          time: 'Just now',
          timestamp: serverTimestamp()
        };
        setComments([...comments, newCommentObj]);
        setNewComment('');
      }
    }
  };

  // Ensure current user document exists and load active members count
  useEffect(() => {
    const loadActiveMembersCount = async () => {
      const user = getCurrentUser();
      
      // First, ensure current user document exists
      if (user) {
        try {
          await firestoreService.ensureUser(user.uid, {
            email: user.email,
            displayName: user.displayName || 'User',
            createdAt: new Date().toISOString()
          });
          console.log('✅ Current user document ensured');
        } catch (error) {
          console.error('Error ensuring current user document:', error);
        }
      }
      
      // Then load the count
      try {
        console.log('📊 Loading active members count...');
        const result = await firestoreService.getTotalUserCount();
        console.log('📊 Result:', result);
        console.log('📊 Result count value:', result.count);
        if (result.success) {
          console.log('✅ Setting active members count to:', result.count);
          setActiveMembersCount(result.count || 0);
        } else {
          console.warn('⚠️ Failed to get user count:', result.error);
          // If failed but we have a current user, show at least 1
          if (user) {
            console.log('⚠️ Showing 1 as fallback (current user exists)');
            setActiveMembersCount(1);
          } else {
            setActiveMembersCount(0);
          }
        }
      } catch (error) {
        console.error('❌ Error loading active members count:', error);
        // If error but we have a current user, show at least 1
        if (user) {
          setActiveMembersCount(1);
        } else {
          setActiveMembersCount(0);
        }
      }
    };

    loadActiveMembersCount();
    
    // Also refresh count periodically (every 30 seconds) to catch new users
    const refreshInterval = setInterval(() => {
      loadActiveMembersCount();
    }, 30000);
    
    return () => clearInterval(refreshInterval);
  }, []);

  // Load community posts from Firestore with real-time listeners
  useEffect(() => {
    const postsRef = collection(db, 'communityPosts');
    const q = query(postsRef, orderBy('createdAt', 'desc'));
    
    // Store all unsubscribe functions for likes and comments
    const unsubscribeFunctions = [];
    
    // Set up real-time listener for posts
    const unsubscribePosts = onSnapshot(q, (querySnapshot) => {
      // Clean up previous listeners
      unsubscribeFunctions.forEach(unsub => unsub());
      unsubscribeFunctions.length = 0;
      
      const posts = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        posts.push({
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate?.() || new Date()
        });
      });
      
      setCommunityPosts(posts);
      
      // Calculate posts created today (using local timezone)
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      
      const postsToday = posts.filter(post => {
        if (!post.createdAt) return false;
        const postDate = post.createdAt instanceof Date ? post.createdAt : new Date(post.createdAt);
        return postDate >= todayStart && postDate <= todayEnd;
      });
      
      setPostsTodayCount(postsToday.length);
      console.log(`📊 Posts today: ${postsToday.length} out of ${posts.length} total posts`);
      
      // Initialize state for each post
      const initialLikes = {};
      const initialComments = {};
      const initialLikedBy = {};
      
      posts.forEach(post => {
        initialLikes[post.id] = post.likes || 0;
        initialComments[post.id] = {
          comments: [],
          showComments: false,
          newComment: ''
        };
        initialLikedBy[post.id] = post.likedBy || [];
      });
      
      setPostLikes(initialLikes);
      setPostComments(initialComments);
      setPostLikedBy(initialLikedBy);
      
      // Set up real-time listeners for likes and comments for each post
      posts.forEach(post => {
        // Listen to likes subcollection
        const likesRef = collection(db, `communityPosts/${post.id}/likes`);
        const unsubscribeLikes = onSnapshot(likesRef, 
          (likesSnapshot) => {
            console.log(`📊 Likes snapshot for post ${post.id}:`, likesSnapshot.size, 'likes');
            const likedUserIds = [];
            likesSnapshot.forEach((likeDoc) => {
              likedUserIds.push(likeDoc.id);
              console.log(`  - Like from user: ${likeDoc.id}`);
            });
            
            console.log(`✅ Updating likes for post ${post.id}: ${likedUserIds.length} likes`);
            
            setPostLikes(prev => ({
              ...prev,
              [post.id]: likedUserIds.length
            }));
            
            setPostLikedBy(prev => ({
              ...prev,
              [post.id]: likedUserIds
            }));
          },
          (error) => {
            console.error(`❌ Error listening to likes for post ${post.id}:`, error);
            console.error('Error code:', error.code, 'Error message:', error.message);
          }
        );
        
        // Listen to comments subcollection
        const commentsRef = collection(db, `communityPosts/${post.id}/comments`);
        const commentsQuery = query(commentsRef, orderBy('createdAt', 'asc'));
        const unsubscribeComments = onSnapshot(commentsQuery, (commentsSnapshot) => {
          const comments = [];
          commentsSnapshot.forEach((commentDoc) => {
            const commentData = commentDoc.data();
            comments.push({
              id: commentDoc.id,
              author: commentData.author || commentData.authorName || 'Anonymous',
              text: commentData.text || commentData.message || '',
              time: commentData.createdAt?.toDate ? formatTimeAgo(commentData.createdAt.toDate()) : 'Just now',
              timestamp: commentData.createdAt?.toDate?.() || new Date(),
              userId: commentData.userId || commentData.authorId,
              profilePicture: commentData.profilePicture || null
            });
            
            // Set up listener for replies to this comment
            const repliesRef = collection(db, `communityPosts/${post.id}/comments/${commentDoc.id}/replies`);
            const repliesQuery = query(repliesRef, orderBy('createdAt', 'asc'));
            const unsubscribeReplies = onSnapshot(repliesQuery, (repliesSnapshot) => {
              const replies = [];
              repliesSnapshot.forEach((replyDoc) => {
                const replyData = replyDoc.data();
                replies.push({
                  id: replyDoc.id,
                  author: replyData.author || replyData.authorName || 'Anonymous',
                  text: replyData.text || replyData.message || '',
                  time: replyData.createdAt?.toDate ? formatTimeAgo(replyData.createdAt.toDate()) : 'Just now',
                  timestamp: replyData.createdAt?.toDate?.() || new Date(),
                  userId: replyData.userId || replyData.authorId,
                  profilePicture: replyData.profilePicture || null
                });
              });
              
              setCommentReplies(prev => ({
                ...prev,
                [`${post.id}-${commentDoc.id}`]: replies
              }));
            }, (error) => {
              console.error(`❌ Error listening to replies for comment ${commentDoc.id}:`, error);
            });
            
            unsubscribeFunctions.push(unsubscribeReplies);
          });
          
          setPostComments(prev => ({
            ...prev,
            [post.id]: {
              ...prev[post.id],
              comments: comments
            }
          }));
        });
        
        // Store unsubscribe functions for cleanup
        unsubscribeFunctions.push(unsubscribeLikes);
        unsubscribeFunctions.push(unsubscribeComments);
      });
    }, (error) => {
      console.error('Error loading posts:', error);
    });

    return () => {
      unsubscribePosts();
      // Clean up all like and comment listeners
      unsubscribeFunctions.forEach(unsub => unsub());
    };
  }, []);

  // Load following list for "Following" tab
  useEffect(() => {
    const user = getCurrentUser();
    if (!user) return;
    firestoreService.getFollowing(user.uid).then((result) => {
      if (result.success && result.followingIds) {
        setFollowingIds(result.followingIds);
      }
    });
  }, []);

  // Load social shares for My Presence (shared to X, WhatsApp, More, image)
  useEffect(() => {
    const user = getCurrentUser();
    if (!user) return;
    firestoreService.getSocialSharesByUser(user.uid).then((result) => {
      if (result.success && result.shares) {
        setSocialShares(result.shares);
      }
    });
  }, []);

  const user = getCurrentUser();

  const normalizeReflectionDate = (val) => {
    if (!val) return '';
    if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10);
    try {
      const d = val instanceof Date ? val : new Date(val);
      return d.toISOString().slice(0, 10);
    } catch {
      return '';
    }
  };

  const socialSharesByDate = (() => {
    const map = {};
    socialShares.forEach((s) => {
      const d = s.reflectionDate || '';
      if (!d) return;
      if (!map[d]) map[d] = [];
      if (!map[d].includes(s.platform)) map[d].push(s.platform);
    });
    return map;
  })();

  const filteredPosts = (() => {
    if (!communityPosts.length) return [];
    if (activeTab === 'mySpace') {
      return user ? communityPosts.filter((p) => p.authorId === user.uid) : [];
    }
    if (activeTab === 'following') {
      if (!user || !followingIds.length) return [];
      return communityPosts.filter((p) => p.authorId && followingIds.includes(p.authorId));
    }
    return communityPosts; // explore: all posts
  })();

  // Update position mapping for tracking
  useEffect(() => {
    const m = new Map();
    filteredPosts.forEach((p, idx) => {
      if (p?.id) m.set(p.id, idx + 1);
    });
    feedPositionsRef.current = m;
  }, [filteredPosts]);

  // IntersectionObserver: impression (once), dwell timer, then view/scroll on exit
  useEffect(() => {
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          const nowMs = Date.now();
          for (const entry of entries) {
            const el = entry.target;
            const postId = el?.dataset?.postId;
            if (!postId) continue;
            const position_in_feed = feedPositionsRef.current.get(postId) || null;

            const visibleEnough = entry.isIntersecting && entry.intersectionRatio >= 0.6;
            if (visibleEnough) {
              if (!impressionOnceRef.current.has(postId)) {
                impressionOnceRef.current.add(postId);
                userEventService.logEvent({
                  user_id: currentUser.uid,
                  post_id: postId,
                  event_type: 'impression',
                  position_in_feed
                });
              }
              if (!dwellStartRef.current.has(postId)) {
                dwellStartRef.current.set(postId, nowMs);
              }
            } else {
              if (dwellStartRef.current.has(postId)) {
                const startMs = dwellStartRef.current.get(postId);
                const dwell = Math.max(0, nowMs - (startMs || nowMs));
                dwellStartRef.current.delete(postId);

                if (dwell >= 2000) {
                  userEventService.logEvent({
                    user_id: currentUser.uid,
                    post_id: postId,
                    event_type: 'view',
                    dwell_time_ms: dwell,
                    position_in_feed
                  });
                } else {
                  userEventService.logEvent({
                    user_id: currentUser.uid,
                    post_id: postId,
                    event_type: 'scroll',
                    position_in_feed
                  });
                }
              }
            }
          }
        },
        { threshold: [0, 0.6, 1] }
      );
    }

    const observer = observerRef.current;
    for (const [, el] of observedElsRef.current.entries()) {
      try {
        observer.observe(el);
      } catch (_) {}
    }

    return () => {
      try {
        observer.disconnect();
      } catch (_) {}
      observerRef.current = null;
      observedElsRef.current = new Map();
      dwellStartRef.current = new Map();
      impressionOnceRef.current = new Set();
    };
  }, [activeTab]);

  const registerPostElement = (postId, el) => {
    if (!postId) return;
    if (!el) {
      const prev = observedElsRef.current.get(postId);
      if (prev && observerRef.current) {
        try {
          observerRef.current.unobserve(prev);
        } catch (_) {}
      }
      observedElsRef.current.delete(postId);
      return;
    }
    el.dataset.postId = postId;
    observedElsRef.current.set(postId, el);
    if (observerRef.current) {
      try {
        observerRef.current.observe(el);
      } catch (_) {}
    }
  };

  const logEngagement = (event_type, postId) => {
    const currentUser = getCurrentUser();
    if (!currentUser || !postId) return;
    const position_in_feed = feedPositionsRef.current.get(postId) || null;
    userEventService.logEvent({
      user_id: currentUser.uid,
      post_id: postId,
      event_type,
      position_in_feed
    });
  };

  const mySpacePostDates = new Set(
    (activeTab === 'mySpace' && user ? filteredPosts : [])
      .map((p) => normalizeReflectionDate(p.reflectionDate))
      .filter(Boolean)
  );
  const socialOnlyDates = activeTab === 'mySpace'
    ? Object.keys(socialSharesByDate).filter((d) => !mySpacePostDates.has(d)).sort().reverse()
    : [];

  const formatSocialDate = (dateStr) => {
    if (!dateStr) return '';
    try {
      const [y, m, d] = dateStr.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
    } catch {
      return dateStr;
    }
  };

  const socialPlatformLabels = { x: 'X', whatsapp: 'WhatsApp', native: 'More', image: 'Image' };

  const switchTab = (tab) => {
    if (tab === activeTab) return;
    setTabTransition(true);
    setTimeout(() => {
      setActiveTab(tab);
      setTabTransition(false);
    }, 150);
  };

  const handleTabTouchStart = (e) => setTabTouchStart(e.touches?.[0]?.clientX ?? null);
  const handleTabTouchEnd = (e) => {
    const x = e.changedTouches?.[0]?.clientX;
    if (tabTouchStart == null || x == null) return;
    const delta = x - tabTouchStart;
    const idx = TAB_ORDER.indexOf(activeTab);
    if (delta < -40 && idx < TAB_ORDER.length - 1) switchTab(TAB_ORDER[idx + 1]);
    else if (delta > 40 && idx > 0) switchTab(TAB_ORDER[idx - 1]);
    setTabTouchStart(null);
  };

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        alert('Image size should be less than 10MB');
        e.target.value = '';
        return;
      }
      
      if (!file.type.startsWith('image/')) {
        alert('Please select a valid image file');
        e.target.value = '';
        return;
      }
      
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result;
        if (result) {
          setPostImage(result);
          setPostImageUrl('');
        }
      };
      reader.onerror = () => {
        alert('Failed to read image file');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleImageUrlChange = (url) => {
    setPostImageUrl(url);
    setPostImage(null);
  };

  const validateImageUrl = (url) => {
    try {
      new URL(url);
      return /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i.test(url);
    } catch {
      return false;
    }
  };

  const handleCreatePost = async () => {
    if (!postContent.trim() && !postImage && !postImageUrl.trim()) return;
    
    const user = getCurrentUser();
    if (!user) {
      alert('Please sign in to create a post');
      return;
    }

    // Validate URL if provided
    if (postImageUrl.trim() && !validateImageUrl(postImageUrl.trim())) {
      alert('Please enter a valid image URL');
      return;
    }

    setIsPosting(true);
    try {
      const postData = {
        author: user.displayName || 'Anonymous',
        authorId: user.uid,
        content: postContent.trim(),
        createdAt: serverTimestamp(),
        likes: 0,
        comments: [],
        profilePicture: profilePicture || null,
        image: postImage || postImageUrl.trim() || null
      };

      await addDoc(collection(db, 'communityPosts'), postData);
      
      // Note: The real-time listener will automatically update the posts and postsTodayCount
      // No need to manually reload here
      
      // Initialize new post state
      const newPostId = posts[0]?.id;
      if (newPostId) {
        setPostLikes({ ...postLikes, [newPostId]: 0 });
        setPostComments({
          ...postComments,
          [newPostId]: { comments: [], showComments: false, newComment: '' }
        });
      }
      
      setPostContent('');
      setPostImage(null);
      setPostImageUrl('');
      setUploadOption(null);
      setShowCreatePost(false);
    } catch (error) {
      console.error('Error creating post:', error);
      alert('Failed to create post. Please try again.');
    } finally {
      setIsPosting(false);
    }
  };

  const handlePostLike = async (postId) => {
    const user = getCurrentUser();
    if (!user) {
      alert('Please sign in to like posts');
      return;
    }

    const likedUsers = postLikedBy[postId] || [];
    const isLiked = likedUsers.includes(user.uid);
    
    console.log(`❤️ Handling like for post ${postId}, isLiked: ${isLiked}, user: ${user.uid}`);
    
    try {
      const likeRef = doc(db, `communityPosts/${postId}/likes/${user.uid}`);
      
      if (isLiked) {
        // Unlike: remove from subcollection
        console.log(`👎 Unliking post ${postId}...`);
        await deleteDoc(likeRef);
        console.log(`✅ Successfully unliked post ${postId}`);
        
        // Manually update state as fallback (in case listener is slow)
        setPostLikes(prev => ({
          ...prev,
          [postId]: Math.max(0, (prev[postId] || 0) - 1)
        }));
        setPostLikedBy(prev => ({
          ...prev,
          [postId]: (prev[postId] || []).filter(uid => uid !== user.uid)
        }));
      } else {
        // Like: add to subcollection
        console.log(`👍 Liking post ${postId}...`);
        await setDoc(likeRef, {
          userId: user.uid,
          createdAt: serverTimestamp()
        });
        console.log(`✅ Successfully liked post ${postId}`);
        // Track engagement: like
        logEngagement('like', postId);
        
        // Manually update state as fallback (in case listener is slow)
        setPostLikes(prev => ({
          ...prev,
          [postId]: (prev[postId] || 0) + 1
        }));
        setPostLikedBy(prev => ({
          ...prev,
          [postId]: [...(prev[postId] || []), user.uid]
        }));
      }
      
      // Note: We don't update the main post document's likedBy array anymore
      // The likes subcollection is the source of truth, and real-time listeners
      // will update the UI automatically. We also update state manually as a fallback.
    } catch (error) {
      console.error('❌ Error updating like:', error);
      console.error('Error details:', error.code, error.message);
      alert('Failed to update like: ' + error.message);
    }
  };

  const openUserProfile = (authorId) => {
    if (!authorId) return;
    if (user && authorId === user.uid) {
      navigate('/profile');
    } else {
      navigate(`/user/${authorId}`);
    }
  };

  const handleFollowClick = async (authorId) => {
    const currentUser = getCurrentUser();
    if (!currentUser || !authorId || authorId === currentUser.uid) return;
    setFollowLoadingUid(authorId);
    try {
      const isFollowing = followingIds.includes(authorId);
      const result = isFollowing
        ? await firestoreService.unfollowUser(currentUser.uid, authorId)
        : await firestoreService.followUser(currentUser.uid, authorId);
      if (result.success && result.followingIds) {
        setFollowingIds(result.followingIds);
      }
    } catch (err) {
      console.error('Follow/unfollow error:', err);
    } finally {
      setFollowLoadingUid(null);
    }
  };

  const formatTimeAgo = (date) => {
    if (!date) return 'Just now';
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} ${minutes === 1 ? 'min' : 'mins'} ago`;
    if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
    return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  };


  // Threads-style theme constants
  const THREADS = {
    bg: '#0F0F0F',
    bgSecondary: '#121212',
    text: '#FFFFFF',
    textSecondary: '#A0A0A0',
    divider: '#1E1E1E',
    accent: '#A855F7',
    accentHighlight: '#C084FC',
    accentShadow: '#7E22CE',
  };

  return (
    <div
      className="min-h-screen relative overflow-hidden slide-up"
      style={{
        background: THREADS.bg,
        paddingTop: 0,
        paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div className="relative z-10 mx-auto w-full max-w-[600px] px-4 sm:px-5">
        {/* Sticky header: Theme | DeTea logo | Profile */}
        <header
          className="sticky top-0 z-20 flex items-center justify-between px-1 py-3 min-h-[52px]"
          style={{
            paddingTop: 'max(12px, env(safe-area-inset-top, 0px))',
            background: THREADS.bg,
            borderBottom: `1px solid ${THREADS.divider}`,
          }}
        >
          <button
            onClick={toggleTheme}
            className="w-10 h-10 rounded-full flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity flex-shrink-0"
            aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDarkMode ? <Moon className="w-5 h-5" strokeWidth={2} style={{ color: THREADS.accent }} /> : <Sun className="w-5 h-5" strokeWidth={2} style={{ color: THREADS.accent }} />}
          </button>
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ background: THREADS.bgSecondary }}>
            <img
              src="/DEITECIrc.png"
              alt="DeTea"
              className="w-8 h-8 object-contain"
            />
          </div>
          <button
            onClick={handleProfileClick}
            className="w-10 h-10 rounded-full flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity overflow-hidden flex-shrink-0"
            style={{ background: profilePicture ? 'transparent' : THREADS.bgSecondary }}
            aria-label="Profile"
          >
            {profilePicture ? (
              <img src={profilePicture} alt="" className="w-full h-full object-cover" />
            ) : (
              <User className="w-5 h-5 text-white" style={{ color: THREADS.text }} strokeWidth={2} />
            )}
          </button>
        </header>

        {/* Hamburger menu overlay */}
        {menuOpen && (
          <div
            className="fixed inset-0 z-50 bg-black/60"
            style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
            onClick={() => setMenuOpen(false)}
          >
            <div
              className="mt-2 mx-4 rounded-2xl overflow-hidden max-w-[280px]"
              style={{ background: THREADS.bgSecondary }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b" style={{ borderColor: THREADS.divider }}>
                <button
                  onClick={() => { setMenuOpen(false); handleProfileClick(); }}
                  className="flex items-center gap-3 w-full text-left py-2 rounded-lg hover:opacity-90 transition-opacity"
                  style={{ color: THREADS.text }}
                >
                  {profilePicture ? (
                    <img src={profilePicture} alt="" className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: THREADS.divider }}>
                      <User className="w-5 h-5" style={{ color: THREADS.textSecondary }} />
                    </div>
                  )}
                  <span className="font-medium">Profile</span>
                </button>
              </div>
              <div className="p-4">
                <button
                  onClick={() => { setMenuOpen(false); toggleTheme(); }}
                  className="flex items-center gap-3 w-full text-left py-2 rounded-lg hover:opacity-90 transition-opacity"
                  style={{ color: THREADS.text }}
                >
                  {isDarkMode ? <Moon className="w-5 h-5" style={{ color: THREADS.textSecondary }} /> : <Sun className="w-5 h-5" style={{ color: THREADS.textSecondary }} />}
                  <span className="font-medium">Theme</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tabs - Threads style */}
        <div
          className="flex items-center justify-around overflow-x-auto no-scrollbar touch-pan-y"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}
          onTouchStart={handleTabTouchStart}
          onTouchEnd={handleTabTouchEnd}
        >
          {[
            { id: 'mySpace', label: 'My Presence' },
            { id: 'following', label: 'Following' },
            { id: 'explore', label: 'Explore' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              className="flex-1 min-w-0 py-4 px-2 text-center transition-colors duration-200 relative"
            >
              <span
                className="text-[15px] font-medium transition-colors"
                style={{ color: activeTab === tab.id ? THREADS.text : THREADS.textSecondary }}
              >
                {tab.label}
              </span>
              {activeTab === tab.id && (
                <span
                  className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-0.5 rounded-full"
                  style={{ backgroundColor: THREADS.accent }}
                />
              )}
            </button>
          ))}
        </div>

        {/* Stats line */}
        <div className="py-3 flex items-center justify-center gap-6" style={{ fontSize: '12px', color: THREADS.textSecondary }}>
          <span>{activeMembersCount.toLocaleString()} members</span>
          <span>{postsTodayCount} today</span>
        </div>

        {/* Feed - Threads style flat list */}
        <div
          className="pb-4"
          style={{
            opacity: tabTransition ? 0.7 : 1,
            transform: tabTransition ? 'translateY(4px)' : 'translateY(0)',
            transition: 'opacity 0.2s ease, transform 0.2s ease',
          }}
        >
          {activeTab === 'mySpace' && filteredPosts.length === 0 && socialOnlyDates.length === 0 && (
            <div className="py-16 px-6 text-center">
              <p className="text-base leading-relaxed" style={{ color: THREADS.textSecondary }}>
                Your reflections will appear here when you share them with the community.
              </p>
              <p className="mt-2 text-sm" style={{ color: THREADS.textSecondary }}>
                A quiet space just for what you’ve shared.
              </p>
            </div>
          )}
          {activeTab === 'following' && filteredPosts.length === 0 && (
            <div className="py-16 px-6 text-center">
              <p className="text-base leading-relaxed" style={{ color: THREADS.textSecondary }}>
                {followingIds.length === 0
                  ? 'Follow people to see their reflections here. Familiar faces, calm feed.'
                  : 'No posts from people you follow yet.'}
              </p>
            </div>
          )}
          {activeTab === 'explore' && filteredPosts.length === 0 && (
            <div className="py-16 px-6 text-center">
              <p className="text-base leading-relaxed" style={{ color: THREADS.textSecondary }}>
                No reflections in the community yet. Be the first to share.
              </p>
            </div>
          )}

          <div className="rounded-2xl overflow-hidden" style={{ background: THREADS.bg }}>
          {filteredPosts.map((post, index) => {
            const postCommentsData = postComments[post.id] || { comments: post.comments || [], showComments: false, newComment: '' };
            const postLikesCount = postLikes[post.id] || post.likes || 0;
            const likedUsers = postLikedBy[post.id] || [];
            const isPostLiked = user && likedUsers.includes(user.uid);
            
            return (
              <div
                key={post.id}
                ref={(el) => registerPostElement(post.id, el)}
                className="relative transition-[background,transform] duration-150 hover:bg-white/[0.03] active:scale-[0.99] fadeIn"
                style={{
                  borderTop: index === 0 ? 'none' : `1px solid ${THREADS.divider}`,
                  padding: '16px 0',
                  animation: 'fadeIn 0.25s ease forwards',
                }}
              >
                <div className="flex items-start gap-3 px-1">
                  <div className="flex-shrink-0 relative">
                    <button
                      type="button"
                      onClick={() => post.authorId && openUserProfile(post.authorId)}
                      className="rounded-full focus:outline-none cursor-pointer"
                    >
                      {post.profilePicture ? (
                        <img src={post.profilePicture} alt="" className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: THREADS.divider }}>
                          <User className="w-5 h-5" style={{ color: THREADS.textSecondary }} strokeWidth={1.5} />
                        </div>
                      )}
                    </button>
                    {post.authorId && user && post.authorId !== user.uid && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleFollowClick(post.authorId); }}
                        disabled={followLoadingUid === post.authorId}
                        className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-white flex items-center justify-center shadow-md border border-gray-200 focus:outline-none cursor-pointer hover:opacity-90 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                        aria-label={followingIds.includes(post.authorId) ? 'Unfollow' : 'Follow'}
                      >
                        <Plus className="w-3 h-3 text-black" strokeWidth={2.5} stroke="currentColor" />
                      </button>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => post.authorId && openUserProfile(post.authorId)}
                      className="flex items-center gap-2 text-left cursor-pointer hover:opacity-90"
                      style={{ fontSize: '13px' }}
                    >
                      <span className="font-semibold" style={{ color: THREADS.text }}>{post.author}</span>
                      <span style={{ color: THREADS.textSecondary }}>{formatTimeAgo(post.createdAt)}</span>
                    </button>
                    <p className="text-[15px] leading-snug mt-0.5" style={{ color: THREADS.text }}>
                      {post.content}
                    </p>
                    {activeTab === 'mySpace' && user && post.authorId === user.uid && (() => {
                      const normDate = normalizeReflectionDate(post.reflectionDate);
                      const platforms = normDate ? (socialSharesByDate[normDate] || []) : [];
                      if (platforms.length === 0) return null;
                      const text = platforms.map((p) => socialPlatformLabels[p] || p).join(', ');
                      return (
                        <p className="mt-1.5 text-xs" style={{ color: THREADS.textSecondary }}>
                          Shared to social: {text}
                        </p>
                      );
                    })()}
                    {post.image && (
                      <div className="mt-3 rounded-2xl overflow-hidden" style={{ borderRadius: '14px' }}>
                        <img
                          src={post.image}
                          alt=""
                          className="w-full max-h-80 object-cover"
                          referrerPolicy="no-referrer"
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-6 mt-3 pt-3 px-1" style={{ borderTop: `1px solid ${THREADS.divider}` }}>
                  <button
                    onClick={() => handlePostLike(post.id)}
                    className="flex items-center gap-1.5 transition-transform hover:opacity-80 active:scale-95"
                  >
                    <Heart
                      className="w-4 h-4 transition-colors"
                      style={{ color: isPostLiked ? THREADS.accent : THREADS.textSecondary }}
                      fill={isPostLiked ? THREADS.accent : 'none'}
                    />
                    <span className="text-xs" style={{ color: THREADS.textSecondary }}>{postLikesCount}</span>
                  </button>
                  <button
                    onClick={() => setPostComments({ ...postComments, [post.id]: { ...postCommentsData, showComments: !postCommentsData.showComments } })}
                    className="flex items-center gap-1.5 transition-transform hover:opacity-80 active:scale-95"
                  >
                    <MessageCircle className="w-4 h-4" style={{ color: THREADS.textSecondary }} />
                    <span className="text-xs" style={{ color: THREADS.textSecondary }}>{postCommentsData.comments.length}</span>
                  </button>
                  <button
                    onClick={() => logEngagement('save', post.id)}
                    className="flex items-center gap-1.5 transition-transform hover:opacity-80 active:scale-95"
                    title="Save"
                  >
                    <Bookmark className="w-4 h-4" style={{ color: THREADS.textSecondary }} />
                    <span className="text-xs" style={{ color: THREADS.textSecondary }}>0</span>
                  </button>
                  <button
                    onClick={() => logEngagement('share', post.id)}
                    className="flex items-center gap-1.5 transition-transform hover:opacity-80 active:scale-95"
                    title="Share"
                  >
                    <Send className="w-4 h-4" style={{ color: THREADS.textSecondary }} />
                    <span className="text-xs" style={{ color: THREADS.textSecondary }}>0</span>
                  </button>
                  {activeTab === 'mySpace' && user && post.authorId === user.uid && (() => {
                    const normDate = normalizeReflectionDate(post.reflectionDate);
                    const platforms = normDate ? (socialSharesByDate[normDate] || []) : [];
                    const sharedX = platforms.includes('x');
                    const sharedIg = platforms.includes('instagram');
                    const sharedReddit = platforms.includes('reddit');
                    const sharedWa = platforms.includes('whatsapp');
                    const sharedLinkedIn = platforms.includes('linkedin');
                    const socialGreen = THREADS.accent;
                    const socialGrey = THREADS.textSecondary;
                    return (
                      <div className="flex items-center gap-3 ml-auto" title="Shared to social">
                        <span className="w-4 h-4 flex items-center justify-center" title={sharedX ? 'Shared to X' : 'Not shared to X'}>
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill={sharedX ? socialGreen : socialGrey} aria-hidden>
                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                          </svg>
                        </span>
                        <span className="w-4 h-4 flex items-center justify-center" title={sharedIg ? 'Shared to Instagram' : 'Not shared to Instagram'}>
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke={sharedIg ? socialGreen : socialGrey} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                            <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                            <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                          </svg>
                        </span>
                        <span className="w-4 h-4 flex items-center justify-center" title={sharedLinkedIn ? 'Shared to LinkedIn' : 'Not shared to LinkedIn'}>
                          <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden>
                            <path
                              fill={sharedLinkedIn ? socialGreen : socialGrey}
                              d="M4.98 3.5C4.98 4.88 3.88 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1 4.98 2.12 4.98 3.5zM.25 8.25h4.5V24h-4.5V8.25zM8.75 8.25h4.31v2.14h.06c.6-1.14 2.06-2.34 4.24-2.34 4.54 0 5.38 2.99 5.38 6.88V24h-4.5v-7.16c0-1.71-.03-3.9-2.38-3.9-2.38 0-2.75 1.86-2.75 3.78V24h-4.5V8.25z"
                            />
                          </svg>
                        </span>
                        <span className="w-4 h-4 flex items-center justify-center" title={sharedReddit ? 'Shared to Reddit' : 'Not shared to Reddit'}>
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill={sharedReddit ? socialGreen : socialGrey} aria-hidden>
                            <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
                          </svg>
                        </span>
                        <span className="w-4 h-4 flex items-center justify-center" title={sharedWa ? 'Shared to WhatsApp' : 'Not shared to WhatsApp'}>
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill={sharedWa ? socialGreen : socialGrey} aria-hidden>
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.865 9.865 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.578 5.945L.057 24l6.305-1.654a9.863 9.863 0 004.688 1.177h.004c5.45 0 9.884-4.437 9.884-9.884 0-2.64-1.03-5.122-2.898-6.988a9.865 9.865 0 00-6.994-2.893z" />
                          </svg>
                        </span>
                      </div>
                    );
                  })()}
                </div>

                {/* Comments Section - Threads style */}
                {postCommentsData.showComments && (
                  <div className="mt-4 pt-4 border-t" style={{ borderColor: THREADS.divider }}>
                    <div className="mb-3">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold" style={{ color: THREADS.text }}>
                          Comments ({postCommentsData.comments.length})
                        </h3>
                        <button
                          onClick={() => {
                            setPostComments({
                              ...postComments,
                              [post.id]: {
                                ...postCommentsData,
                                showComments: false
                              }
                            });
                          }}
                          className="p-1 rounded-full hover:opacity-80 transition-opacity hover:bg-white/10"
                        >
                          <X className="w-4 h-4" style={{ color: THREADS.textSecondary }} />
                        </button>
                      </div>
                      
                      {/* Comments List */}
                      <div className="space-y-3 max-h-48 overflow-y-auto mb-3" style={{ scrollbarWidth: 'thin' }}>
                        {postCommentsData.comments.map((comment) => {
                          const replies = commentReplies[`${post.id}-${comment.id}`] || [];
                          const isReplying = replyingTo?.postId === post.id && replyingTo?.commentId === comment.id;
                          
                          const commentAvatar = comment.profilePicture || (comment.userId === user?.uid ? (localStorage.getItem(`user_profile_picture_${user?.uid}`) || profilePicture) : null);
                          return (
                            <div key={comment.id || comment.timestamp}>
                              <div className="flex items-start space-x-2">
                                <div
                                  className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs bg-cover bg-center"
                                  style={{
                                    backgroundColor: THREADS.divider,
                                    ...(commentAvatar ? { backgroundImage: `url(${commentAvatar})` } : {}),
                                  }}
                                >
                                  {!commentAvatar && <span>👤</span>}
                                </div>
                                <div className="flex-1">
                                  <div className="flex items-center space-x-2 mb-1">
                                    <span className="text-xs font-semibold" style={{ color: THREADS.text }}>{comment.author}</span>
                                    <span className="text-[10px]" style={{ color: THREADS.textSecondary }}>{comment.time || 'Just now'}</span>
                                  </div>
                                  <p className="text-xs leading-relaxed" style={{ color: THREADS.text }}>{comment.text}</p>
                                  <div className="flex items-center space-x-3 mt-1">
                                    <button
                                      onClick={() => {
                                        if (isReplying) { setReplyingTo(null); setReplyText(''); } else { setReplyingTo({ postId: post.id, commentId: comment.id }); }
                                      }}
                                      className="text-[10px] transition-colors hover:opacity-80"
                                      style={{ color: THREADS.textSecondary }}
                                    >
                                      {isReplying ? 'Cancel' : 'Reply'}
                                    </button>
                                    {replies.length > 0 && (
                                      <span className="text-[10px]" style={{ color: THREADS.textSecondary }}>
                                        {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
                                      </span>
                                    )}
                                  </div>
                                  {isReplying && (
                                    <div className="mt-2 flex items-center space-x-2">
                                      <input
                                        type="text"
                                        value={replyText}
                                        onChange={(e) => setReplyText(e.target.value)}
                                        onKeyPress={(e) => { if (e.key === 'Enter') handleAddComment(post.id, comment.id); }}
                                        placeholder={`Reply to ${comment.author}...`}
                                        className="flex-1 rounded-lg px-2 py-1.5 text-xs border-none outline-none placeholder:opacity-60"
                                        style={{ background: 'rgba(255,255,255,0.06)', color: THREADS.text }}
                                        autoFocus
                                      />
                                      <button
                                        onClick={() => handleAddComment(post.id, comment.id)}
                                        disabled={!replyText.trim()}
                                        className="px-2 py-1.5 rounded-lg text-xs transition-opacity disabled:opacity-50"
                                        style={{ backgroundColor: replyText.trim() ? THREADS.accent : THREADS.divider, color: '#fff' }}
                                      >
                                        <Send className="w-3 h-3" />
                                      </button>
                                    </div>
                                  )}
                                  {replies.length > 0 && (
                                    <div className="mt-2 ml-4 space-y-2 pl-3 border-l-2" style={{ borderColor: THREADS.divider }}>
                                      {replies.map((reply) => {
                                        const replyAvatar = reply.profilePicture || (reply.userId === user?.uid ? (localStorage.getItem(`user_profile_picture_${user?.uid}`) || profilePicture) : null);
                                        return (
                                        <div key={reply.id} className="flex items-start space-x-2">
                                          <div
                                            className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs bg-cover bg-center"
                                            style={{ backgroundColor: THREADS.divider, ...(replyAvatar ? { backgroundImage: `url(${replyAvatar})` } : {}) }}
                                          >
                                            {!replyAvatar && <span>👤</span>}
                                          </div>
                                          <div className="flex-1">
                                            <div className="flex items-center space-x-2 mb-0.5">
                                              <span className="text-[10px] font-semibold" style={{ color: THREADS.text }}>{reply.author}</span>
                                              <span className="text-[9px]" style={{ color: THREADS.textSecondary }}>{reply.time || 'Just now'}</span>
                                            </div>
                                            <p className="text-[11px] leading-relaxed" style={{ color: THREADS.text }}>{reply.text}</p>
                                          </div>
                                        </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Add Comment Input */}
                      <div className="flex items-center space-x-2">
                        <input
                          type="text"
                          value={postCommentsData.newComment || ''}
                          onChange={(e) => {
                            setPostComments({
                              ...postComments,
                              [post.id]: {
                                ...postCommentsData,
                                newComment: e.target.value
                              }
                            });
                          }}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              handleAddComment(post.id);
                            }
                          }}
                          placeholder="Add a comment..."
                          className="flex-1 rounded-lg px-3 py-2 text-xs border-none outline-none"
                          style={{
                            background: 'rgba(255,255,255,0.06)',
                            color: THREADS.text,
                          }}
                        />
                        <button
                          onClick={() => handleAddComment(post.id)}
                          disabled={!postCommentsData.newComment?.trim()}
                          className="w-8 h-8 rounded-lg flex items-center justify-center transition-opacity disabled:opacity-50"
                          style={{
                            backgroundColor: postCommentsData.newComment?.trim() ? THREADS.accent : THREADS.divider,
                          }}
                        >
                          <Send className="w-3 h-3 text-white" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {activeTab === 'mySpace' && socialOnlyDates.map((dateStr) => {
            const platforms = socialSharesByDate[dateStr] || [];
            const text = platforms.map((p) => socialPlatformLabels[p] || p).join(', ');
            return (
              <div
                key={`social-${dateStr}`}
                className="rounded-2xl p-4 border-t transition-[background] duration-150 hover:bg-white/[0.03]"
                style={{ borderColor: THREADS.divider }}
              >
                <div className="flex items-center gap-2">
                  <Share2 className="w-4 h-4 flex-shrink-0" style={{ color: THREADS.accent }} />
                  <p className="text-sm" style={{ color: THREADS.text }}>
                    Shared to {text} on {formatSocialDate(dateStr)}
                  </p>
                </div>
              </div>
            );
          })}
          </div>
        </div>
      </div>

      {/* FAB - Threads style with DeTea accent */}
      <button
        onClick={() => setShowCreatePost(true)}
        className={`fixed bottom-20 right-4 z-40 w-14 h-14 rounded-full flex items-center justify-center transition-all duration-300 hover:scale-105 active:scale-95 ${
          showFAB ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
        style={{
          backgroundColor: THREADS.accent,
          boxShadow: `0 4px 20px ${THREADS.accentShadow}60`,
        }}
      >
        <Plus className="w-6 h-6 text-white" strokeWidth={2.5} />
      </button>

      {/* Create Post Modal - Threads style */}
      {showCreatePost && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
          onClick={() => setShowCreatePost(false)}
        >
          <div
            className="rounded-2xl p-6 w-full max-w-sm relative"
            style={{
              backgroundColor: THREADS.bgSecondary,
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
              border: `1px solid ${THREADS.divider}`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold" style={{ color: THREADS.text }}>
                Create a Post
              </h2>
              <button
                onClick={() => {
                  setShowCreatePost(false);
                  setPostContent('');
                  setPostImage(null);
                  setPostImageUrl('');
                  setUploadOption(null);
                }}
                className="p-1 rounded-full hover:opacity-80 transition-opacity hover:bg-white/10"
              >
                <XCircle className="w-5 h-5" style={{ color: THREADS.textSecondary }} />
              </button>
            </div>

            <textarea
              value={postContent}
              onChange={(e) => setPostContent(e.target.value)}
              placeholder="What's on your mind?"
              rows={6}
              className="w-full rounded-xl px-4 py-3 text-sm border-none outline-none resize-none mb-4 placeholder:opacity-60"
              style={{
                background: 'rgba(255,255,255,0.06)',
                color: THREADS.text,
              }}
            />

            {/* Photo Upload Options */}
            {!uploadOption && (
              <div className="mb-4">
                <p className="text-sm mb-3" style={{ color: THREADS.textSecondary }}>
                  Add a photo:
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setUploadOption('device')}
                    className="flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all hover:opacity-90"
                    style={{ borderColor: THREADS.divider, background: 'rgba(255,255,255,0.04)' }}
                  >
                    <Image className="w-6 h-6 mb-2" style={{ color: THREADS.accent }} />
                    <span className="text-xs font-medium" style={{ color: THREADS.text }}>Upload Photo</span>
                  </button>
                  <button
                    onClick={() => setUploadOption('url')}
                    className="flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all hover:opacity-90"
                    style={{ borderColor: THREADS.divider, background: 'rgba(255,255,255,0.04)' }}
                  >
                    <Link className="w-6 h-6 mb-2" style={{ color: THREADS.accent }} />
                    <span className="text-xs font-medium" style={{ color: THREADS.text }}>From URL</span>
                  </button>
                </div>
              </div>
            )}

            {/* Device Upload Option */}
            {uploadOption === 'device' && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm" style={{ color: THREADS.textSecondary }}>Upload from device</p>
                  <button
                    onClick={() => { setUploadOption(null); setPostImage(null); }}
                    className="text-xs hover:opacity-80 transition-opacity"
                    style={{ color: THREADS.textSecondary }}
                  >
                    Change option
                  </button>
                </div>
                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" id="image-upload-input" />
                <label
                  htmlFor="image-upload-input"
                  className="block w-full rounded-xl px-4 py-3 text-sm text-center cursor-pointer transition-all hover:opacity-90"
                  style={{ background: 'rgba(255,255,255,0.06)', color: THREADS.text, border: `1px solid ${THREADS.divider}` }}
                >
                  {postImage ? 'Change Photo' : 'Choose Photo'}
                </label>
                {postImage && (
                  <div className="mt-3 relative">
                    <img 
                      src={postImage} 
                      alt="Preview" 
                      className="w-full rounded-lg max-h-48 object-cover"
                    />
                    <button
                      onClick={() => setPostImage(null)}
                      className="absolute top-2 right-2 p-1 rounded-full bg-black/50 hover:bg-black/70 transition-all"
                    >
                      <X className="w-4 h-4 text-white" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* URL Upload Option */}
            {uploadOption === 'url' && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm" style={{ color: THREADS.textSecondary }}>Upload from URL</p>
                  <button
                    onClick={() => { setUploadOption(null); setPostImageUrl(''); }}
                    className="text-xs hover:opacity-80 transition-opacity"
                    style={{ color: THREADS.textSecondary }}
                  >
                    Change option
                  </button>
                </div>
                <input
                  type="url"
                  value={postImageUrl}
                  onChange={(e) => handleImageUrlChange(e.target.value)}
                  placeholder="https://example.com/image.jpg"
                  className="w-full rounded-xl px-4 py-3 text-sm border-none outline-none mb-3 placeholder:opacity-60"
                  style={{ background: 'rgba(255,255,255,0.06)', color: THREADS.text }}
                />
                {postImageUrl && (
                  <div className="relative">
                    <img 
                      src={postImageUrl} 
                      alt="Preview" 
                      className="w-full rounded-lg max-h-48 object-cover"
                      onError={(e) => {
                        e.target.style.display = 'none';
                        alert('Failed to load image from URL. Please check the URL and try again.');
                      }}
                    />
                    <button
                      onClick={() => setPostImageUrl('')}
                      className="absolute top-2 right-2 p-1 rounded-full bg-black/50 hover:bg-black/70 transition-all"
                    >
                      <X className="w-4 h-4 text-white" />
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center space-x-3">
              <button
                onClick={() => {
                  setShowCreatePost(false);
                  setPostContent('');
                  setPostImage(null);
                  setPostImageUrl('');
                  setUploadOption(null);
                }}
                className="flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80 bg-white/10 text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleCreatePost}
                disabled={(!postContent.trim() && !postImage && !postImageUrl.trim()) || isPosting}
                className="flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-50"
                style={{
                  backgroundColor: (postContent.trim() || postImage || postImageUrl.trim()) && !isPosting ? THREADS.accent : THREADS.divider,
                  color: '#fff',
                }}
              >
                {isPosting ? 'Posting...' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

