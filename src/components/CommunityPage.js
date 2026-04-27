import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { MessageCircle, Heart, User, Sun, Moon, Send, X, Plus, XCircle, Image, Link, Share2, Repeat, Bookmark, MoreVertical, Trash2 } from 'lucide-react';
import { getCurrentUser } from '../services/authService';
import firestoreService from '../services/firestoreService';
import { collection, addDoc, query, orderBy, getDocs, serverTimestamp, doc, setDoc, updateDoc, increment, deleteDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import { userEventService } from '../services/userEventService';
import { isAdmin } from '../utils/admin';
import Skeleton from './skeleton/Skeleton';

function PlatformButton({ label, iconText, selected, onClick, colors }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex items-center justify-center px-3 py-2 rounded-2xl min-w-[56px] transition-all active:scale-[0.99]"
      style={{
        background: selected ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${selected ? colors.accent : colors.divider}`,
        boxShadow: selected ? `0 0 0 1px ${colors.accent}, 0 10px 24px rgba(168, 85, 247, 0.18)` : 'none',
      }}
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{
          background: selected ? 'rgba(168, 85, 247, 0.12)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${colors.divider}`,
          color: selected ? colors.accentHighlight : colors.textSecondary,
          fontWeight: 700,
          fontSize: iconText === 'in' ? 18 : 13,
          lineHeight: 1,
        }}
        aria-hidden
      >
        {iconText}
      </div>
    </button>
  );
}

function SuggestionChip({ label, iconText, onClick, colors }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 px-3 py-2 rounded-full text-[12px] transition-colors hover:bg-white/10 active:scale-[0.99]"
      style={{
        border: `1px solid ${colors.accent}`,
        color: colors.accentHighlight,
        background: 'rgba(168, 85, 247, 0.05)',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        className="w-5 h-5 rounded-full inline-flex items-center justify-center"
        style={{ background: 'rgba(168, 85, 247, 0.16)', color: colors.accentHighlight, fontSize: 12 }}
        aria-hidden
      >
        {iconText}
      </span>
      {label}
    </button>
  );
}

function MediaCard({ src, onRemove, colors }) {
  return (
    <div
      className="relative w-[110px] h-[110px] rounded-2xl overflow-hidden flex-shrink-0"
      style={{ border: `1px solid ${colors.divider}`, background: 'rgba(255,255,255,0.03)' }}
    >
      <img
        src={src}
        alt=""
        className="w-full h-full object-cover"
        referrerPolicy="no-referrer"
        onError={(e) => {
          e.currentTarget.style.display = 'none';
        }}
      />
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.55)', border: `1px solid ${colors.divider}` }}
        aria-label="Remove media"
      >
        <X className="w-4 h-4" style={{ color: colors.text }} />
      </button>
    </div>
  );
}

export default function CommunityPage() {
  const navigate = useNavigate();
  const location = useLocation();
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
  const [selectedPlatform, setSelectedPlatform] = useState('x'); // 'x' | 'linkedin' | 'reddit'
  const [mediaItems, setMediaItems] = useState([]); // [{ id: string, src: string, source: 'device' | 'url' }]
  const [communityPosts, setCommunityPosts] = useState([]);
  const [postComments, setPostComments] = useState({});
  const [postLikes, setPostLikes] = useState({});
  const [postLikedBy, setPostLikedBy] = useState({}); // Track which users liked each post
  const [commentReplies, setCommentReplies] = useState({}); // Track replies for each comment: { [postId-commentId]: [replies] }
  const [replyingTo, setReplyingTo] = useState(null); // Track which comment is being replied to: { postId, commentId }
  const [replyText, setReplyText] = useState(''); // Reply input text
  const [postImage, setPostImage] = useState(null);
  const [postImageUrl, setPostImageUrl] = useState('');
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
  const [postMenuOpenId, setPostMenuOpenId] = useState(null); // three-dot menu for My Presence post
  const [deletePostLoadingId, setDeletePostLoadingId] = useState(null);
  const [linkedInPosts, setLinkedInPosts] = useState([]);
  const [linkedInPostsLoading, setLinkedInPostsLoading] = useState(false);
  const [analyticsRefreshing, setAnalyticsRefreshing] = useState({});

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

  const user = getCurrentUser();
  const admin = isAdmin(user);

  // Open "Create Post" directly when coming from Dashboard FAB.
  const openedFromFabRef = useRef(false);
  useEffect(() => {
    const flag = !!location?.state?.openCreatePost;
    if (flag && !openedFromFabRef.current) {
      openedFromFabRef.current = true;
      setActiveTab('mySpace');
      setShowCreatePost(true);
    }
  }, [location?.state?.openCreatePost]);

  // Temporary restriction: only admin can access Following/HUB.
  // Non-admins get a My Presence only experience (no hidden tab placeholders).
  useEffect(() => {
    if (!admin) {
      if (activeTab !== 'mySpace') setActiveTab('mySpace');
    }
  }, [admin, activeTab]);

  // Load following list for "Following" tab (admin only)
  useEffect(() => {
    if (!admin) return;
    if (!user) return;
    firestoreService.getFollowing(user.uid).then((result) => {
      if (result.success && result.followingIds) {
        setFollowingIds(result.followingIds);
      }
    });
  }, [admin, user?.uid]);

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

  // Load LinkedIn posts (for post performance / analytics) when user is set
  useEffect(() => {
    const u = getCurrentUser();
    if (!u?.uid) return;
    setLinkedInPostsLoading(true);
    const apiBase = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://deitedatabase.firebaseapp.com';
    fetch(`${apiBase}/api/linkedin/posts?userId=${encodeURIComponent(u.uid)}`)
      .then((res) => (res.ok ? res.json() : { posts: [] }))
      .then((data) => {
        setLinkedInPosts(Array.isArray(data.posts) ? data.posts : []);
      })
      .catch(() => setLinkedInPosts([]))
      .finally(() => setLinkedInPostsLoading(false));
  }, []);

  const tabs = admin
    ? [
        { id: 'mySpace', label: 'My Presence' },
        { id: 'following', label: 'Following' },
        { id: 'explore', label: 'HUB' },
      ]
    : [{ id: 'mySpace', label: 'My Presence' }];

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

    // My Space: only current user's posts, with duplicates (same content+image) collapsed to newest one
    if (activeTab === 'mySpace') {
      if (!user) return [];
      const mine = communityPosts.filter((p) => p.authorId === user.uid);
      if (!mine.length) return [];

      const byKey = new Map();
      mine.forEach((p) => {
        const content = (p?.content || '').trim();
        const image = p?.image || '';
        const key = `${content}::${image}`;
        const existing = byKey.get(key);
        if (!existing) {
          byKey.set(key, p);
        } else {
          const existingTime = existing.createdAt?.getTime?.() ?? 0;
          const currentTime = p.createdAt?.getTime?.() ?? 0;
          if (currentTime > existingTime) {
            byKey.set(key, p);
          }
        }
      });

      return Array.from(byKey.values()).sort((a, b) => {
        const ta = a.createdAt?.getTime?.() ?? 0;
        const tb = b.createdAt?.getTime?.() ?? 0;
        return tb - ta;
      });
    }

    // Following tab: only posts from people you follow
    if (activeTab === 'following') {
      if (!user || !followingIds.length) return [];
      return communityPosts.filter((p) => p.authorId && followingIds.includes(p.authorId));
    }

    // Explore: all posts
    return communityPosts;
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

  const feedItems = filteredPosts.map((post) => ({ type: 'post', post }));

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

  const withTimeout = (promise, ms, label = 'Request') => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
  };

  const handleCreatePost = async () => {
    const firstMediaSrc = mediaItems?.[0]?.src || postImage || (postImageUrl?.trim?.() ? postImageUrl.trim() : null);
    if (!postContent.trim() && !firstMediaSrc) return;
    
    const user = getCurrentUser();
    if (!user) {
      alert('Please sign in to create a post');
      return;
    }

    // Validate URL if provided (legacy + new media flow)
    if (firstMediaSrc && typeof firstMediaSrc === 'string' && firstMediaSrc.startsWith('http') && !validateImageUrl(firstMediaSrc)) {
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
        image: firstMediaSrc || null
      };

      // Firestore can hang indefinitely when offline / network issues.
      // Ensure UI doesn't get stuck in "Generating…".
      await withTimeout(addDoc(collection(db, 'communityPosts'), postData), 15000, 'Create post');
      
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
      setMediaItems([]);
      setSelectedPlatform('x');
      setShowCreatePost(false);
    } catch (error) {
      console.error('Error creating post:', error);
      const msg = error?.message || 'Failed to create post. Please try again.';
      alert(msg);
    } finally {
      setIsPosting(false);
    }
  };

  const CREATE_POST = {
    maxChars: 500,
    platforms: [
      { id: 'x', label: 'X (Twitter)', icon: 'X' },
      { id: 'linkedin', label: 'LinkedIn', icon: 'in' },
      { id: 'reddit', label: 'Reddit', icon: 'r/' },
    ],
  };

  const resetCreatePostState = () => {
    setShowCreatePost(false);
    setPostContent('');
    setSelectedPlatform('x');
    setMediaItems([]);

    // Legacy state (kept for backwards compatibility elsewhere in the file)
    setPostImage(null);
    setPostImageUrl('');
  };

  const addMediaFromFiles = (fileList) => {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;
    const imageFiles = files.filter((f) => f.type?.startsWith?.('image/'));
    if (!imageFiles.length) return;

    const tooLarge = imageFiles.find((f) => (f.size || 0) > 10 * 1024 * 1024);
    if (tooLarge) {
      alert('Each image must be less than 10MB');
      return;
    }

    imageFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const src = ev.target?.result;
        if (!src) return;
        setMediaItems((prev) => [{ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, src, source: 'device' }, ...prev].slice(0, 10));
      };
      reader.onerror = () => {};
      reader.readAsDataURL(file);
    });
  };

  const removeMediaItem = (id) => {
    setMediaItems((prev) => prev.filter((m) => m.id !== id));
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

  const handleDeletePost = async (postId) => {
    if (!postId || !user) return;
    setDeletePostLoadingId(postId);
    setPostMenuOpenId(null);
    try {
      const postRef = doc(db, 'communityPosts', postId);
      await deleteDoc(postRef);
      setCommunityPosts((prev) => prev.filter((p) => p.id !== postId));
    } catch (error) {
      console.error('Error deleting post:', error);
      alert('Failed to delete post: ' + (error?.message || 'Unknown error'));
    } finally {
      setDeletePostLoadingId(null);
    }
  };

  const handleCopyLink = async (postId) => {
    try {
      const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
      const path = typeof window !== 'undefined' ? window.location.pathname : '';
      const url = `${origin}${path}?post=${encodeURIComponent(postId)}`;
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        // Fallback: best-effort selection copy
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setPostMenuOpenId(null);
    } catch (e) {
      console.error('Copy link failed:', e);
      alert('Failed to copy link.');
    }
  };

  const handleSaveFromMenu = (postId) => {
    try {
      logEngagement('save', postId);
      setPostMenuOpenId(null);
    } catch (e) {
      console.error('Save failed:', e);
    }
  };

  const handleAboutFromMenu = (post) => {
    setPostMenuOpenId(null);
    if (post?.authorId) openUserProfile(post.authorId);
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

  // Three-dot timestamp label for My Presence (matches your example screenshots)
  const formatThreeDotTimestamp = (dateVal) => {
    if (!dateVal) return '';
    const postDate = dateVal instanceof Date ? dateVal : new Date(dateVal);
    if (Number.isNaN(postDate.getTime())) return '';

    const now = new Date();
    const diffMs = now - postDate;
    if (diffMs < 0) return '';

    // < 24 hours => show like "17h"
    if (diffMs < 24 * 60 * 60 * 1000) {
      const hours = Math.floor(diffMs / 3600000);
      if (hours >= 1) return `${hours}h`;
      const minutes = Math.max(1, Math.floor(diffMs / 60000));
      return `${minutes}m`;
    }

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[postDate.getMonth()];
    const dayNum = postDate.getDate();
    const year = postDate.getFullYear();
    const currentYear = now.getFullYear();

    // This year => show like "20 Feb"
    if (year === currentYear) return `${dayNum} ${month}`;

    // Past year => show like "08 Dec 25"
    const dayPadded = String(dayNum).padStart(2, '0');
    const year2 = String(year).slice(-2);
    return `${dayPadded} ${month} ${year2}`;
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
        {/* Sticky header: Theme | Detea logo | Profile */}
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
              src="/DEITECIrc.webp"
              alt="Detea"
              className="w-full h-full object-cover rounded-full"
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
          {tabs.map((tab) => (
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

        {/* Feed - Threads style flat list */}
        <div
          className="pb-4"
          style={{
            opacity: tabTransition ? 0.7 : 1,
            transform: tabTransition ? 'translateY(4px)' : 'translateY(0)',
            transition: 'opacity 0.2s ease, transform 0.2s ease',
          }}
        >
          {activeTab === 'mySpace' && linkedInPosts.length > 0 && (
            <div
              className="mx-4 mb-4 rounded-2xl p-4"
              style={{
                background: isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
              }}
            >
              <h3 className="text-sm font-semibold mb-3" style={{ color: THREADS.text }}>
                Your LinkedIn post performance
              </h3>
              {linkedInPostsLoading ? (
                <div className="space-y-2" aria-hidden="true">
                  <Skeleton variant="text" className="h-3 w-[92%]" />
                  <Skeleton variant="text" className="h-3 w-[84%] opacity-90" />
                  <Skeleton variant="text" className="h-3 w-[66%] opacity-80" />
                </div>
              ) : (
                <ul className="space-y-3">
                  {linkedInPosts.map((p, idx) => (
                    <li
                      key={p.id}
                      className="flex flex-col gap-2"
                      style={{ borderBottom: idx < linkedInPosts.length - 1 ? `1px solid ${THREADS.divider}` : 'none', paddingBottom: idx < linkedInPosts.length - 1 ? 12 : 0, marginBottom: idx < linkedInPosts.length - 1 ? 12 : 0 }}
                    >
                      <p className="text-xs line-clamp-2" style={{ color: THREADS.textSecondary }}>
                        {p.caption || 'Post'}
                      </p>
                      <div className="flex items-center gap-4 text-xs" style={{ color: THREADS.text }}>
                        <span>👍 {p.analytics?.likes ?? 0} likes</span>
                        <span>💬 {p.analytics?.comments ?? 0} comments</span>
                        <button
                          type="button"
                          disabled={analyticsRefreshing[p.id]}
                          onClick={() => {
                            const u = getCurrentUser();
                            if (!u?.uid) return;
                            setAnalyticsRefreshing((prev) => ({ ...prev, [p.id]: true }));
                            const apiBase = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://deitedatabase.firebaseapp.com';
                            fetch(`${apiBase}/api/linkedin/analytics?userId=${encodeURIComponent(u.uid)}&postId=${encodeURIComponent(p.id)}`)
                              .then((res) => (res.ok ? res.json() : {}))
                              .then((data) => {
                                setLinkedInPosts((prev) =>
                                  prev.map((post) =>
                                    post.id === p.id
                                      ? { ...post, analytics: { likes: data.likes ?? post.analytics?.likes ?? 0, comments: data.comments ?? post.analytics?.comments ?? 0, lastFetchedAt: data.lastFetchedAt ?? null } }
                                      : post
                                  )
                                );
                              })
                              .finally(() => setAnalyticsRefreshing((prev) => ({ ...prev, [p.id]: false })));
                          }}
                          className="text-xs underline cursor-pointer disabled:opacity-50"
                          style={{ color: THREADS.accent }}
                        >
                          {analyticsRefreshing[p.id] ? (
                            <span className="inline-flex items-center">
                              <Skeleton variant="text" className="h-2 w-16 rounded-full" />
                            </span>
                          ) : (
                            'Refresh'
                          )}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
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
          {feedItems.map((item, index) => {
            const post = item.post;
            const postCommentsData = postComments[post.id] || { comments: post.comments || [], showComments: false, newComment: '' };
            const postLikesCount = postLikes[post.id] || post.likes || 0;
            const likedUsers = postLikedBy[post.id] || [];
            const isPostLiked = user && likedUsers.includes(user.uid);
            const isFirstPost = index === 0;
            const isMyPost = activeTab === 'mySpace' && user && post.authorId === user.uid;
            const menuOpen = postMenuOpenId === post.id;
            const deleting = deletePostLoadingId === post.id;
            
            return (
              <div
                key={post.id}
                ref={(el) => registerPostElement(post.id, el)}
                className="relative transition-[background,transform] duration-150 hover:bg-white/[0.03] active:scale-[0.99] fadeIn"
                style={{
                  borderTop: isFirstPost ? 'none' : `1px solid ${THREADS.divider}`,
                  padding: '16px 0',
                  animation: 'fadeIn 0.25s ease forwards',
                }}
              >
                {isMyPost && (
                  <div className="absolute top-2 right-2 z-10 flex items-center gap-2">
                    <span
                      className="text-[12px] font-medium"
                      style={{ color: THREADS.textSecondary, lineHeight: 1 }}
                    >
                      {formatThreeDotTimestamp(post.createdAt)}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPostMenuOpenId((id) => (id === post.id ? null : post.id));
                      }}
                      disabled={deleting}
                      className="p-1.5 rounded-full hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-offset-0 transition-colors"
                      style={{ color: THREADS.textSecondary }}
                      aria-label="Post options"
                    >
                      <MoreVertical className="w-[18px] h-[18px]" strokeWidth={1.5} />
                    </button>
                    {menuOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-0"
                          aria-hidden
                          onClick={() => setPostMenuOpenId(null)}
                        />
                        <div
                          className="absolute right-0 top-full mt-1 py-1 min-w-[140px] rounded-xl shadow-lg z-20"
                          style={{
                            background: THREADS.bgSecondary,
                            border: `1px solid ${THREADS.divider}`,
                          }}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyLink(post.id);
                            }}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-white/10 focus:outline-none transition-colors rounded-lg mx-1"
                            style={{ color: THREADS.text }}
                          >
                            <Link className="w-4 h-4 flex-shrink-0" style={{ color: THREADS.textSecondary }} strokeWidth={2} />
                            Copy link
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSaveFromMenu(post.id);
                            }}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-white/10 focus:outline-none transition-colors rounded-lg mx-1"
                            style={{ color: THREADS.text }}
                          >
                            <Bookmark className="w-4 h-4 flex-shrink-0" style={{ color: THREADS.textSecondary }} strokeWidth={2} />
                            Save
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAboutFromMenu(post);
                            }}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-white/10 focus:outline-none transition-colors rounded-lg mx-1"
                            style={{ color: THREADS.text }}
                          >
                            <User className="w-4 h-4 flex-shrink-0" style={{ color: THREADS.textSecondary }} strokeWidth={2} />
                            About
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeletePost(post.id);
                            }}
                            disabled={deleting}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-white/10 focus:outline-none transition-colors rounded-lg mx-1"
                            style={{ color: THREADS.text }}
                          >
                            <Trash2 className="w-4 h-4 flex-shrink-0" style={{ color: THREADS.textSecondary }} />
                            {deleting ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
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
                    {!(post?.sharedPlatform === 'x' && post?.image) ? (
                      <p className="text-[15px] leading-snug mt-0.5" style={{ color: THREADS.text }}>
                        {post.content}
                      </p>
                    ) : null}
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

      {/* FAB - Threads style with Detea accent */}
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
          className="fixed inset-0 z-50"
          style={{ backgroundColor: THREADS.bg }}
        >
          <div
            className="w-full h-full relative"
            style={{
              backgroundColor: THREADS.bgSecondary,
              paddingTop: 'max(14px, env(safe-area-inset-top, 0px))',
              paddingBottom: 'max(14px, env(safe-area-inset-bottom, 0px))',
            }}
          >
            {/* Top bar */}
            <div
              className="flex items-center justify-between px-5 pb-4"
              style={{ borderBottom: `1px solid ${THREADS.divider}` }}
            >
              <button
                type="button"
                onClick={resetCreatePostState}
                className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" style={{ color: THREADS.textSecondary }} />
              </button>
              <h2 className="text-[18px] font-semibold tracking-tight" style={{ color: THREADS.text }}>
                Create Post <span style={{ color: THREADS.accent }}>✨</span>
              </h2>
              <div className="w-9 h-9" />
            </div>

            {/* Scrollable content */}
            <div
              className="space-y-5 overflow-y-auto px-5 pt-5"
              style={{ height: 'calc(100dvh - 180px)' }}
            >
              {/* 1. Platform selection */}
              <div>
                <p className="text-[13px] font-medium mb-3" style={{ color: THREADS.text }}>
                  1. Where are you posting?
                </p>
                <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
                  {CREATE_POST.platforms.map((p) => (
                    <PlatformButton
                      key={p.id}
                      label={p.label}
                      iconText={p.icon}
                      selected={selectedPlatform === p.id}
                      onClick={() => setSelectedPlatform(p.id)}
                      colors={THREADS}
                    />
                  ))}
                </div>
              </div>

              {/* 2. Idea input */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[13px] font-medium" style={{ color: THREADS.text }}>
                    2. Describe your idea (rough is fine)
                  </p>
                </div>

                <div
                  className="rounded-2xl p-4"
                  style={{
                    background: '#1A1A1A',
                    border: `1px solid ${THREADS.divider}`,
                  }}
                >
                  <textarea
                    value={postContent}
                    onChange={(e) => setPostContent(e.target.value.slice(0, CREATE_POST.maxChars))}
                    placeholder="Write your idea here..."
                    rows={5}
                    className="w-full bg-transparent outline-none resize-none text-[14px] leading-relaxed placeholder:opacity-60"
                    style={{ color: THREADS.text }}
                  />
                  <div className="flex items-center justify-end">
                    <span className="text-[11px]" style={{ color: THREADS.textSecondary }}>
                      {(postContent || '').length}/{CREATE_POST.maxChars}
                    </span>
                  </div>
                </div>
              </div>

              {/* 3. Media upload */}
              <div>
                <p className="text-[13px] font-medium mb-3" style={{ color: THREADS.text }}>
                  3. Add media
                </p>

                <div className="flex gap-3">
                  {/* Upload box */}
                  <div className="flex-shrink-0 w-[150px]">
                    <input
                      id="create-post-media-input"
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        addMediaFromFiles(e.target.files);
                        e.target.value = '';
                      }}
                    />
                    <label
                      htmlFor="create-post-media-input"
                      className="w-full h-[110px] rounded-2xl flex flex-col items-center justify-center cursor-pointer select-none relative overflow-hidden"
                      style={{
                        border: `1px dashed ${THREADS.accent}`,
                        background: 'rgba(168, 85, 247, 0.06)',
                      }}
                    >
                      {mediaItems.length > 0 && (
                        <>
                          <img
                            src={mediaItems[0]?.src}
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover opacity-80"
                            referrerPolicy="no-referrer"
                          />
                          <div
                            className="absolute inset-0"
                            style={{
                              background:
                                'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 45%, rgba(0,0,0,0.65) 100%)',
                            }}
                          />
                          {mediaItems.length > 1 && (
                            <div
                              className="absolute top-2 right-2 px-2 py-1 rounded-full text-[11px] font-semibold"
                              style={{ background: 'rgba(0,0,0,0.55)', color: '#fff', border: `1px solid ${THREADS.divider}` }}
                            >
                              +{mediaItems.length - 1}
                            </div>
                          )}
                        </>
                      )}

                      <div className="relative z-10 flex flex-col items-center justify-center">
                        <div
                          className="w-10 h-10 rounded-2xl flex items-center justify-center mb-2"
                          style={{
                            background: 'rgba(0,0,0,0.25)',
                            border: `1px solid ${THREADS.divider}`,
                            backdropFilter: 'blur(6px)',
                          }}
                        >
                          <Image className="w-5 h-5" style={{ color: THREADS.accent }} />
                        </div>
                        <span className="text-[12px] font-medium" style={{ color: THREADS.text }}>
                          Upload photos
                        </span>
                      </div>
                    </label>
                  </div>

                  {/* Preview cards */}
                  <div className="flex-1 overflow-x-auto no-scrollbar">
                    <div className="flex gap-3">
                      {mediaItems.length === 0 ? (
                        <div
                          className="h-[110px] flex items-center justify-center px-4 rounded-2xl"
                          style={{ border: `1px solid ${THREADS.divider}`, background: 'rgba(255,255,255,0.03)', color: THREADS.textSecondary, minWidth: 180 }}
                        >
                          <span className="text-[12px]">No media added yet</span>
                        </div>
                      ) : (
                        mediaItems.map((m) => (
                          <MediaCard key={m.id} src={m.src} onRemove={() => removeMediaItem(m.id)} colors={THREADS} />
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom actions */}
            <div
              className="px-5 pt-4 pb-4 space-y-3 sticky"
              style={{
                borderTop: `1px solid ${THREADS.divider}`,
                background: THREADS.bgSecondary,
                bottom: 'calc(env(safe-area-inset-bottom, 0px) + 76px)',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  const text = (postContent || '').trim();
                  if (!text && mediaItems.length === 0) return;

                  // Route to existing suggestions screen (LinkedIn / X / Reddit).
                  const platform =
                    selectedPlatform === 'x'
                      ? 'x'
                      : selectedPlatform === 'reddit'
                        ? 'reddit'
                        : 'linkedin';

                  setShowCreatePost(false);
                  navigate('/share-suggestions', {
                    state: {
                      reflection: text || ' ',
                      platform,
                      returnTo: '/community',
                      suggestionsOnly: true,
                      media: mediaItems.map((m) => m?.src).filter(Boolean).slice(0, 6),
                    },
                  });
                }}
                disabled={(!postContent.trim() && mediaItems.length === 0) || isPosting}
                className="w-full h-[50px] rounded-2xl font-semibold text-[15px] transition-opacity disabled:opacity-50"
                style={{
                  color: '#fff',
                  background: `linear-gradient(135deg, ${THREADS.accent} 0%, ${THREADS.accentHighlight} 100%)`,
                  boxShadow: `0 10px 30px rgba(168, 85, 247, 0.25)`,
                }}
              >
                {isPosting ? 'Generating…' : '✨ Generate Post'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

