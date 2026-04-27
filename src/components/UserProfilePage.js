import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { ChevronLeft, User, Linkedin, AtSign } from 'lucide-react';
import { getCurrentUser } from '../services/authService';
import firestoreService from '../services/firestoreService';
import ProfileSkeleton from './skeleton/ProfileSkeleton';

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
    return <ProfileSkeleton />;
  }

  if (!profileUser) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center p-6"
        style={{ background: isDarkMode ? '#131314' : '#B5C4AE' }}
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

  // Social profile URLs: use stored values or platform home
  const socialLinks = {
    x: (profileUser.xUrl || profileUser.twitterUrl || '').trim() || 'https://x.com',
    threads: (profileUser.threadsUrl || '').trim() || 'https://threads.net',
    reddit: (profileUser.redditUrl || '').trim() || 'https://www.reddit.com',
    linkedin: (profileUser.linkedinUrl || '').trim() || 'https://www.linkedin.com',
  };

  return (
    <div
      className="min-h-screen"
      style={{
        background: isDarkMode ? '#131314' : '#B5C4AE',
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
            {/* Social links: X, Threads, Reddit, LinkedIn */}
            <div className={`flex items-center justify-center gap-4 mt-4 pt-4 border-t ${isDarkMode ? 'border-gray-600/50' : 'border-gray-200'}`}>
              <a
                href={socialLinks.x}
                target="_blank"
                rel="noopener noreferrer"
                className={`p-2 rounded-full transition-opacity hover:opacity-80 ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
                title="X (Twitter)"
                aria-label="Open X profile"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill={isDarkMode ? '#e7e9ea' : '#0f1419'} aria-hidden>
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a
                href={socialLinks.threads}
                target="_blank"
                rel="noopener noreferrer"
                className={`p-2 rounded-full transition-opacity hover:opacity-80 ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
                title="Threads"
                aria-label="Open Threads profile"
              >
                <AtSign className={`w-5 h-5 ${isDarkMode ? 'text-[#e7e9ea]' : 'text-[#0f1419]'}`} strokeWidth={2} aria-hidden />
              </a>
              <a
                href={socialLinks.reddit}
                target="_blank"
                rel="noopener noreferrer"
                className={`p-2 rounded-full transition-opacity hover:opacity-80 ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
                title="Reddit"
                aria-label="Open Reddit profile"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill={isDarkMode ? '#e7e9ea' : '#0f1419'} aria-hidden>
                  <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
                </svg>
              </a>
              <a
                href={socialLinks.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className={`p-2 rounded-full transition-opacity hover:opacity-80 ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
                title="LinkedIn"
                aria-label="Open LinkedIn profile"
              >
                <Linkedin className={`w-5 h-5 ${isDarkMode ? 'text-[#e7e9ea]' : 'text-[#0f1419]'}`} strokeWidth={1.5} aria-hidden />
              </a>
            </div>
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
