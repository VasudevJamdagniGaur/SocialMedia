import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { ChevronLeft, User } from 'lucide-react';
import { getCurrentUser } from '../services/authService';
import firestoreService from '../services/firestoreService';

export default function UserProfilePage() {
  const navigate = useNavigate();
  const { userId } = useParams();
  const { isDarkMode } = useTheme();
  const [profileUser, setProfileUser] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState(false);
  const [followingIds, setFollowingIds] = useState([]);
  const currentUser = getCurrentUser();

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [userResult, postsResult] = await Promise.all([
          firestoreService.getUser(userId),
          firestoreService.getCommunityPostsByAuthorIds([userId], 50),
        ]);
        if (!cancelled) {
          if (userResult.success && userResult.data) {
            setProfileUser({ uid: userId, ...userResult.data });
          } else {
            setProfileUser(null);
          }
          if (postsResult.success && postsResult.posts) {
            setPosts(postsResult.posts);
          } else {
            setPosts([]);
          }
        }
      } catch (err) {
        if (!cancelled) setProfileUser(null); setPosts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!currentUser) return;
    firestoreService.getFollowing(currentUser.uid).then((res) => {
      if (res.success && res.followingIds) setFollowingIds(res.followingIds);
    });
  }, [currentUser?.uid]);

  const handleFollow = async () => {
    if (!currentUser || !userId || userId === currentUser.uid) return;
    setFollowLoading(true);
    try {
      const isFollowing = followingIds.includes(userId);
      const result = isFollowing
        ? await firestoreService.unfollowUser(currentUser.uid, userId)
        : await firestoreService.followUser(currentUser.uid, userId);
      if (result.success && result.followingIds) setFollowingIds(result.followingIds);
    } catch (err) {
      console.error('Follow error:', err);
    } finally {
      setFollowLoading(false);
    }
  };

  const formatTimeAgo = (date) => {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    const now = new Date();
    const diff = now - d;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 30) return `${days}d ago`;
    return d.toLocaleDateString();
  };

  const isOwnProfile = currentUser && userId === currentUser.uid;
  const isFollowing = followingIds.includes(userId);

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: isDarkMode ? '#131313' : '#FAFAF8' }}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="flex space-x-1">
            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <p className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Loading profile...</p>
        </div>
      </div>
    );
  }

  if (!profileUser) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center p-6"
        style={{ background: isDarkMode ? '#131313' : '#FAFAF8' }}
      >
        <p className={isDarkMode ? 'text-gray-400' : 'text-gray-600'} style={{ marginBottom: 16 }}>User not found.</p>
        <button
          onClick={() => navigate(-1)}
          className={`px-4 py-2 rounded-lg ${isDarkMode ? 'bg-gray-700 text-white' : 'bg-gray-200 text-gray-800'}`}
        >
          Go back
        </button>
      </div>
    );
  }

  const displayName = profileUser.displayName || profileUser.email?.split('@')[0] || 'User';
  const profilePicture = profileUser.profilePicture || null;

  return (
    <div
      className="min-h-screen"
      style={{
        background: isDarkMode ? '#131313' : '#FAFAF8',
        paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div className="max-w-sm mx-auto px-4">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(-1)}
            className={`w-10 h-10 rounded-full flex items-center justify-center ${isDarkMode ? 'bg-gray-800' : 'bg-gray-200'}`}
          >
            <ChevronLeft className={`w-5 h-5 ${isDarkMode ? 'text-white' : 'text-gray-800'}`} />
          </button>
          <h1 className={`text-lg font-semibold flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
            Profile
          </h1>
        </div>

        {/* Profile card */}
        <div
          className={`rounded-2xl p-6 mb-6 ${isDarkMode ? 'bg-[#262626]' : 'bg-white'}`}
          style={isDarkMode ? { border: '1px solid rgba(255,255,255,0.08)' } : { boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}
        >
          <div className="flex flex-col items-center text-center">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0 mb-3"
              style={isDarkMode ? { backgroundColor: '#1a1a1a' } : { backgroundColor: '#f3f4f6' }}
            >
              {profilePicture ? (
                <img src={profilePicture} alt="" className="w-full h-full object-cover" />
              ) : (
                <User className={`w-10 h-10 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`} strokeWidth={1.5} />
              )}
            </div>
            <h2 className={`text-xl font-bold mb-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              {displayName}
            </h2>
            {!isOwnProfile && currentUser && (
              <button
                onClick={handleFollow}
                disabled={followLoading}
                className={`mt-3 text-sm font-medium px-4 py-2 rounded-full transition-colors ${
                  followLoading ? 'opacity-60' : 'hover:opacity-90'
                } ${
                  isFollowing
                    ? (isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600')
                    : (isDarkMode ? 'bg-[#8AB4F8] text-white' : 'bg-[#87A96B] text-white')
                }`}
              >
                {followLoading ? '…' : isFollowing ? 'Following' : 'Follow'}
              </button>
            )}
            {isOwnProfile && (
              <button
                onClick={() => navigate('/profile')}
                className={`mt-3 text-sm font-medium px-4 py-2 rounded-full ${isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'}`}
              >
                Edit profile
              </button>
            )}
          </div>
        </div>

        {/* Posts / Activity */}
        <h3 className={`text-sm font-semibold mb-3 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          Posts & activity
        </h3>
        {posts.length === 0 ? (
          <div
            className={`rounded-2xl p-8 text-center ${isDarkMode ? 'bg-[#262626]' : 'bg-white'}`}
            style={isDarkMode ? { border: '1px solid rgba(255,255,255,0.08)' } : { boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}
          >
            <p className={isDarkMode ? 'text-gray-500' : 'text-gray-500'}>
              {isOwnProfile ? "You haven't shared any posts yet." : 'No posts yet.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {posts.map((post) => (
              <div
                key={post.id}
                className={`rounded-2xl p-4 ${isDarkMode ? 'bg-[#262626]' : 'bg-white'}`}
                style={isDarkMode ? { border: '1px solid rgba(255,255,255,0.06)' } : { boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}
              >
                <p className={`text-[15px] leading-snug ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                  {post.content}
                </p>
                {post.image && (
                  <div className="mt-3 rounded-xl overflow-hidden">
                    <img src={post.image} alt="" className="w-full max-h-64 object-cover" onError={(e) => { e.target.style.display = 'none'; }} />
                  </div>
                )}
                <p className={`text-xs mt-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                  {formatTimeAgo(post.createdAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
