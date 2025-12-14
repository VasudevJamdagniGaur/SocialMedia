import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { Users, MessageCircle, Heart, TrendingUp, User, Sun, Moon, Send, X, Plus, XCircle, Image, Link, FileText, Layers, Activity, Brain, Sprout, Coffee, Flame } from 'lucide-react';
import { getCurrentUser } from '../services/authService';
import firestoreService from '../services/firestoreService';
import { collection, addDoc, query, orderBy, getDocs, serverTimestamp, doc, setDoc, updateDoc, increment, deleteDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';

export default function CommunityPage() {
  const navigate = useNavigate();
  const { isDarkMode, toggleTheme } = useTheme();
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
      
      const author = user?.displayName || user?.email?.split('@')[0] || 'Anonymous';
      
      if (parentCommentId) {
        // Add reply to comment
        try {
          const repliesRef = collection(db, `communityPosts/${postId}/comments/${parentCommentId}/replies`);
          await addDoc(repliesRef, {
            text: commentText.trim(),
            author: author,
            authorName: author,
            userId: user.uid,
            createdAt: serverTimestamp()
          });
          
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
            createdAt: serverTimestamp()
          });
          
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
              userId: commentData.userId || commentData.authorId
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
                  userId: replyData.userId || replyData.authorId
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
                src="/hub-icon.png" 
                alt="HUB Logo" 
                className="object-contain"
                style={{
                  width: '64px',
                  height: '64px',
                  filter: isDarkMode ? 'brightness(0) invert(1)' : 'brightness(0)',
                  WebkitFilter: isDarkMode ? 'brightness(0) invert(1)' : 'brightness(0)'
                }}
              />
              <h1 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                HUB
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
            Connect with others on their wellness journey
          </p>
        </div>

        {/* Community Cards */}
        <div className="space-y-4">
          {/* Community Stats Card */}
          <div
            className={`rounded-2xl p-5 relative overflow-hidden ${
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
            <div className="flex items-center justify-between mb-4">
              <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                Community Stats
              </h2>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <Users className={`w-5 h-5 ${isDarkMode ? 'text-white' : 'text-gray-800'}`} strokeWidth={2} />
                  <div className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                    {activeMembersCount.toLocaleString()}
                  </div>
                </div>
                <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Active Members
                </div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <FileText className={`w-5 h-5 ${isDarkMode ? 'text-white' : 'text-gray-800'}`} strokeWidth={2} />
                  <div className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                    {postsTodayCount.toLocaleString()}
                  </div>
                </div>
                <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Posts Today
                </div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <Layers className={`w-5 h-5 ${isDarkMode ? 'text-white' : 'text-gray-800'}`} strokeWidth={2} />
                  <div className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                    1
                  </div>
                </div>
                <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Existing Spheres
                </div>
              </div>
            </div>
          </div>

          {/* Community Posts */}
          {communityPosts.map((post) => {
            const postCommentsData = postComments[post.id] || { comments: post.comments || [], showComments: false, newComment: '' };
            const postLikesCount = postLikes[post.id] || post.likes || 0;
            const user = getCurrentUser();
            const likedUsers = postLikedBy[post.id] || [];
            const isPostLiked = user && likedUsers.includes(user.uid);
            
            return (
              <div
                key={post.id}
                className={`rounded-2xl p-5 relative overflow-hidden ${
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
                <div className="flex items-start space-x-3 mb-3">
                  {post.profilePicture ? (
                    <img 
                      src={post.profilePicture} 
                      alt={post.author}
                      className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{
                        backgroundColor: isDarkMode ? "#7DD3C0" : "#E6B3BA",
                      }}
                    >
                      <span className="text-lg">👤</span>
                    </div>
                  )}
                  <div className="flex-1">
                    <div className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                      {post.author}
                    </div>
                    <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                      {formatTimeAgo(post.createdAt)}
                    </div>
                  </div>
                </div>
                <p className={`text-sm leading-relaxed mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {post.content}
                </p>
                {post.image && (
                  <div className="mb-4 rounded-lg overflow-hidden">
                    <img 
                      src={post.image} 
                      alt="Post" 
                      className="w-full max-h-96 object-cover"
                      onError={(e) => {
                        e.target.style.display = 'none';
                      }}
                    />
                  </div>
                )}
                <div className="flex items-center space-x-4">
                  <button 
                    onClick={() => handlePostLike(post.id)}
                    className="flex items-center space-x-1 transition-colors hover:opacity-80"
                  >
                    <Heart 
                      className={`w-4 h-4 transition-colors ${
                        isPostLiked 
                          ? 'text-red-500 fill-red-500' 
                          : (isDarkMode ? 'text-gray-400' : 'text-gray-500')
                      }`} 
                      fill={isPostLiked ? 'currentColor' : 'none'}
                    />
                    <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                      {postLikesCount}
                    </span>
                  </button>
                  <button 
                    onClick={() => {
                      setPostComments({
                        ...postComments,
                        [post.id]: {
                          ...postCommentsData,
                          showComments: !postCommentsData.showComments
                        }
                      });
                    }}
                    className="flex items-center space-x-1 transition-colors hover:opacity-80"
                  >
                    <MessageCircle className={`w-4 h-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                    <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                      {postCommentsData.comments.length}
                    </span>
                  </button>
                </div>

                {/* Comments Section */}
                {postCommentsData.showComments && (
                  <div className="mt-4 pt-4 border-t" style={{ borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)' }}>
                    <div className="mb-3">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
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
                          className={`p-1 rounded-full hover:opacity-80 transition-opacity ${
                            isDarkMode ? 'hover:bg-gray-800/50' : 'hover:bg-gray-100'
                          }`}
                        >
                          <X className={`w-4 h-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                        </button>
                      </div>
                      
                      {/* Comments List */}
                      <div className="space-y-3 max-h-48 overflow-y-auto mb-3" style={{ scrollbarWidth: 'thin' }}>
                        {postCommentsData.comments.map((comment) => {
                          const replies = commentReplies[`${post.id}-${comment.id}`] || [];
                          const isReplying = replyingTo?.postId === post.id && replyingTo?.commentId === comment.id;
                          
                          return (
                            <div key={comment.id || comment.timestamp}>
                              <div className="flex items-start space-x-2">
                                <div
                                  className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs"
                                  style={{
                                    backgroundColor: isDarkMode ? "#7DD3C0" + '30' : "#E6B3BA" + '20',
                                  }}
                                >
                                  <span>👤</span>
                                </div>
                                <div className="flex-1">
                                  <div className="flex items-center space-x-2 mb-1">
                                    <span className={`text-xs font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                                      {comment.author}
                                    </span>
                                    <span className={`text-[10px] ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                      {comment.time || 'Just now'}
                                    </span>
                                  </div>
                                  <p className={`text-xs leading-relaxed ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                    {comment.text}
                                  </p>
                                  <div className="flex items-center space-x-3 mt-1">
                                    <button
                                      onClick={() => {
                                        if (isReplying) {
                                          setReplyingTo(null);
                                          setReplyText('');
                                        } else {
                                          setReplyingTo({ postId: post.id, commentId: comment.id });
                                        }
                                      }}
                                      className={`text-[10px] ${isDarkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700'} transition-colors`}
                                    >
                                      {isReplying ? 'Cancel' : 'Reply'}
                                    </button>
                                    {replies.length > 0 && (
                                      <span className={`text-[10px] ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                        {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
                                      </span>
                                    )}
                                  </div>
                                  
                                  {/* Reply Input */}
                                  {isReplying && (
                                    <div className="mt-2 flex items-center space-x-2">
                                      <input
                                        type="text"
                                        value={replyText}
                                        onChange={(e) => setReplyText(e.target.value)}
                                        onKeyPress={(e) => {
                                          if (e.key === 'Enter') {
                                            handleAddComment(post.id, comment.id);
                                          }
                                        }}
                                        placeholder={`Reply to ${comment.author}...`}
                                        className={`flex-1 rounded-lg px-2 py-1.5 text-xs border-none outline-none ${
                                          isDarkMode 
                                            ? 'bg-gray-800/50 text-white placeholder-gray-500' 
                                            : 'bg-gray-100 text-gray-800 placeholder-gray-500'
                                        }`}
                                        autoFocus
                                      />
                                      <button
                                        onClick={() => handleAddComment(post.id, comment.id)}
                                        disabled={!replyText.trim()}
                                        className={`px-2 py-1.5 rounded-lg text-xs transition-colors ${
                                          replyText.trim()
                                            ? (isDarkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white')
                                            : (isDarkMode ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-gray-200 text-gray-400 cursor-not-allowed')
                                        }`}
                                      >
                                        <Send className="w-3 h-3" />
                                      </button>
                                    </div>
                                  )}
                                  
                                  {/* Replies List */}
                                  {replies.length > 0 && (
                                    <div className="mt-2 ml-4 space-y-2 pl-3 border-l-2" style={{ borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)' }}>
                                      {replies.map((reply) => (
                                        <div key={reply.id} className="flex items-start space-x-2">
                                          <div
                                            className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs"
                                            style={{
                                              backgroundColor: isDarkMode ? "#7DD3C0" + '20' : "#E6B3BA" + '15',
                                            }}
                                          >
                                            <span>👤</span>
                                          </div>
                                          <div className="flex-1">
                                            <div className="flex items-center space-x-2 mb-0.5">
                                              <span className={`text-[10px] font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                                                {reply.author}
                                              </span>
                                              <span className={`text-[9px] ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                                {reply.time || 'Just now'}
                                              </span>
                                            </div>
                                            <p className={`text-[11px] leading-relaxed ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                              {reply.text}
                                            </p>
                                          </div>
                                        </div>
                                      ))}
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
                          className={`flex-1 rounded-lg px-3 py-2 text-xs border-none outline-none ${
                            isDarkMode 
                              ? 'bg-gray-800/50 text-white placeholder-gray-500' 
                              : 'bg-gray-100 text-gray-800 placeholder-gray-500'
                          }`}
                        />
                        <button
                          onClick={() => handleAddComment(post.id)}
                          disabled={!postCommentsData.newComment?.trim()}
                          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-opacity ${
                            postCommentsData.newComment?.trim()
                              ? (isDarkMode ? 'bg-[#8AB4F8]' : 'bg-[#87A96B]')
                              : (isDarkMode ? 'bg-gray-700 opacity-50' : 'bg-gray-300 opacity-50')
                          }`}
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

          {/* Trending Topics Card */}
          <div
            className={`rounded-2xl p-5 relative overflow-hidden ${
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
            <div className="flex items-center space-x-2 mb-4">
              <TrendingUp className={`w-5 h-5 ${isDarkMode ? 'text-white' : 'text-gray-800'}`} strokeWidth={2} />
              <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                Hot Tea
              </h2>
              <Coffee className={`w-4 h-4 ${isDarkMode ? 'text-white' : 'text-gray-800'}`} strokeWidth={2} />
              <Flame className={`w-4 h-4 ${isDarkMode ? 'text-white' : 'text-gray-800'}`} strokeWidth={2} />
            </div>
            <div className="space-y-2">
              {[
                { name: 'Mindfulness Tips', icon: Activity },
                { name: 'Daily Gratitude', icon: Heart },
                { name: 'Stress Management', icon: Brain },
                { name: 'Self-Care Routines', icon: Sprout }
              ].map((topic, index) => {
                const IconComponent = topic.icon;
                return (
                  <div
                    key={index}
                    className={`flex items-center space-x-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                      isDarkMode ? 'hover:bg-gray-800/30' : 'hover:bg-gray-50'
                    }`}
                  >
                    <IconComponent className={`w-4 h-4 ${isDarkMode ? 'text-white' : 'text-gray-800'}`} strokeWidth={2} />
                    <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      #{topic.name}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Floating Action Button - Create Post */}
      <button
        onClick={() => setShowCreatePost(true)}
        className={`fixed bottom-20 right-4 z-40 w-14 h-14 rounded-full flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95 shadow-lg ${
          showFAB ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
        style={{
          backgroundColor: "#1d9bf0",
          boxShadow: "0 4px 16px rgba(29, 155, 240, 0.4)",
        }}
      >
        <Plus className="w-6 h-6 text-white" strokeWidth={2.5} />
      </button>

      {/* Create Post Modal */}
      {showCreatePost && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
          onClick={() => setShowCreatePost(false)}
        >
          <div
            className={`rounded-2xl p-6 w-full max-w-sm relative ${
              isDarkMode ? 'backdrop-blur-lg' : 'bg-white'
            }`}
            style={isDarkMode ? {
              backgroundColor: "#262626",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
            } : {
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
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
                className={`p-1 rounded-full hover:opacity-80 transition-opacity ${
                  isDarkMode ? 'hover:bg-gray-800/50' : 'hover:bg-gray-100'
                }`}
              >
                <XCircle className={`w-5 h-5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
              </button>
            </div>

            <textarea
              value={postContent}
              onChange={(e) => setPostContent(e.target.value)}
              placeholder="What's on your mind?"
              rows={6}
              className={`w-full rounded-lg px-4 py-3 text-sm border-none outline-none resize-none mb-4 ${
                isDarkMode 
                  ? 'bg-gray-800/50 text-white placeholder-gray-500' 
                  : 'bg-gray-100 text-gray-800 placeholder-gray-500'
              }`}
            />

            {/* Photo Upload Options */}
            {!uploadOption && (
              <div className="mb-4">
                <p className={`text-sm mb-3 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Add a photo:
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setUploadOption('device')}
                    className={`flex flex-col items-center justify-center p-4 rounded-lg border-2 transition-all ${
                      isDarkMode 
                        ? 'border-gray-700 hover:border-[#8AB4F8] bg-gray-800/30' 
                        : 'border-gray-300 hover:border-[#87A96B] bg-gray-50'
                    }`}
                  >
                    <Image className={`w-6 h-6 mb-2 ${isDarkMode ? 'text-[#8AB4F8]' : 'text-[#87A96B]'}`} />
                    <span className={`text-xs font-medium ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                      Upload Photo
                    </span>
                  </button>
                  <button
                    onClick={() => setUploadOption('url')}
                    className={`flex flex-col items-center justify-center p-4 rounded-lg border-2 transition-all ${
                      isDarkMode 
                        ? 'border-gray-700 hover:border-[#8AB4F8] bg-gray-800/30' 
                        : 'border-gray-300 hover:border-[#87A96B] bg-gray-50'
                    }`}
                  >
                    <Link className={`w-6 h-6 mb-2 ${isDarkMode ? 'text-[#8AB4F8]' : 'text-[#87A96B]'}`} />
                    <span className={`text-xs font-medium ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                      From URL
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* Device Upload Option */}
            {uploadOption === 'device' && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Upload from device
                  </p>
                  <button
                    onClick={() => {
                      setUploadOption(null);
                      setPostImage(null);
                    }}
                    className={`text-xs ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-800'}`}
                  >
                    Change option
                  </button>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                  id="image-upload-input"
                />
                <label
                  htmlFor="image-upload-input"
                  className={`block w-full rounded-lg px-4 py-3 text-sm text-center cursor-pointer transition-all ${
                    isDarkMode 
                      ? 'bg-gray-800/50 text-white border border-gray-700 hover:bg-gray-800/70' 
                      : 'bg-gray-100 text-gray-800 border border-gray-300 hover:bg-gray-200'
                  }`}
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
                  <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Upload from URL
                  </p>
                  <button
                    onClick={() => {
                      setUploadOption(null);
                      setPostImageUrl('');
                    }}
                    className={`text-xs ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-800'}`}
                  >
                    Change option
                  </button>
                </div>
                <input
                  type="url"
                  value={postImageUrl}
                  onChange={(e) => handleImageUrlChange(e.target.value)}
                  placeholder="https://example.com/image.jpg"
                  className={`w-full rounded-lg px-4 py-3 text-sm border-none outline-none mb-3 ${
                    isDarkMode 
                      ? 'bg-gray-800/50 text-white placeholder-gray-500' 
                      : 'bg-gray-100 text-gray-800 placeholder-gray-500'
                  }`}
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
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80 ${
                  isDarkMode ? 'bg-gray-700 text-white' : 'bg-gray-200 text-gray-800'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={handleCreatePost}
                disabled={(!postContent.trim() && !postImage && !postImageUrl.trim()) || isPosting}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-opacity ${
                  (postContent.trim() || postImage || postImageUrl.trim()) && !isPosting
                    ? (isDarkMode ? 'bg-[#8AB4F8] text-white hover:opacity-90' : 'bg-[#87A96B] text-white hover:opacity-90')
                    : (isDarkMode ? 'bg-gray-700 opacity-50 text-gray-400' : 'bg-gray-300 opacity-50 text-gray-500')
                }`}
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

