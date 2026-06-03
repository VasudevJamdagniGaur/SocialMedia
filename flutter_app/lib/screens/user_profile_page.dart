import 'package:cached_network_image/cached_network_image.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../components/skeleton/profile_skeleton.dart';
import '../contexts/theme_context.dart';
import '../router/app_router.dart';
import '../services/firestore_service.dart';
import '../utils/hub_colors.dart';

class UserProfilePage extends StatefulWidget {
  const UserProfilePage({super.key, required this.userId});

  final String userId;

  @override
  State<UserProfilePage> createState() => _UserProfilePageState();
}

class _UserProfilePageState extends State<UserProfilePage> {
  Map<String, dynamic>? _profileUser;
  List<CommunityPost> _posts = [];
  bool _loading = true;
  bool _followLoading = false;
  List<String> _followingIds = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final userResult = await FirestoreService.instance.getUser(widget.userId);
    final postsResult = await FirestoreService.instance.getCommunityPostsByAuthorIds([widget.userId], 50);
    final current = FirebaseAuth.instance.currentUser;
    if (current != null) {
      final f = await FirestoreService.instance.getFollowing(current.uid);
      if (f['success'] == true && f['followingIds'] is List) {
        _followingIds = List<String>.from(f['followingIds'] as List);
      }
    }
    if (!mounted) return;
    final postsRaw = postsResult['posts'];
    setState(() {
      _profileUser = userResult['success'] == true ? userResult['data'] as Map<String, dynamic>? : null;
      _posts = postsRaw is List
          ? postsRaw
              .map((p) => CommunityPost.fromMap('${(p as Map)['id']}', Map<String, dynamic>.from(p)))
              .toList()
          : [];
      _loading = false;
    });
  }

  Future<void> _handleFollow() async {
    final current = FirebaseAuth.instance.currentUser;
    if (current == null || widget.userId == current.uid) return;
    setState(() => _followLoading = true);
    final isFollowing = _followingIds.contains(widget.userId);
    final result = isFollowing
        ? await FirestoreService.instance.unfollowUser(current.uid, widget.userId)
        : await FirestoreService.instance.followUser(current.uid, widget.userId);
    if (mounted) {
      setState(() {
        if (result['success'] == true && result['followingIds'] is List) {
          _followingIds = List<String>.from(result['followingIds'] as List);
        }
        _followLoading = false;
      });
    }
  }

  String _timeAgo(DateTime? date) {
    if (date == null) return '';
    final diff = DateTime.now().difference(date);
    if (diff.inMinutes < 1) return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 30) return '${diff.inDays}d ago';
    return '${date.month}/${date.day}/${date.year}';
  }

  @override
  Widget build(BuildContext context) {
    final isDarkMode = context.watch<ThemeNotifier>().isDarkMode;
    if (_loading) return const ProfileSkeleton();

    if (_profileUser == null) {
      return Scaffold(
        backgroundColor: isDarkMode ? const Color(0xFF131314) : HubColors.lightScaffold,
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('User not found.', style: TextStyle(color: isDarkMode ? Colors.white54 : Colors.black54)),
              const SizedBox(height: 16),
              ElevatedButton(onPressed: () => context.pop(), child: const Text('Go back')),
            ],
          ),
        ),
      );
    }

    final current = FirebaseAuth.instance.currentUser;
    final isOwn = current?.uid == widget.userId;
    final isFollowing = _followingIds.contains(widget.userId);
    final displayName = _profileUser!['displayName'] as String? ?? _profileUser!['email']?.toString().split('@').first ?? 'User';
    final profilePicture = _profileUser!['profilePicture'] as String?;
    final social = {
      'x': (_profileUser!['xUrl'] ?? _profileUser!['twitterUrl'] ?? '').toString().trim().ifEmpty('https://x.com'),
      'threads': (_profileUser!['threadsUrl'] ?? '').toString().trim().ifEmpty('https://threads.net'),
      'reddit': (_profileUser!['redditUrl'] ?? '').toString().trim().ifEmpty('https://www.reddit.com'),
      'linkedin': (_profileUser!['linkedinUrl'] ?? '').toString().trim().ifEmpty('https://www.linkedin.com'),
    };

    return Scaffold(
      backgroundColor: isDarkMode ? const Color(0xFF131314) : HubColors.lightScaffold,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Row(
              children: [
                IconButton(onPressed: () => context.pop(), icon: Icon(Icons.chevron_left, color: isDarkMode ? Colors.white : Colors.black87)),
                Text('Profile', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: isDarkMode ? Colors.white : Colors.black87)),
              ],
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: isDarkMode ? const Color(0xFF262626) : Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: isDarkMode ? Colors.white10 : Colors.black12),
              ),
              child: Column(
                children: [
                  CircleAvatar(
                    radius: 40,
                    backgroundColor: isDarkMode ? const Color(0xFF1A1A1A) : Colors.grey.shade200,
                    backgroundImage: profilePicture != null ? CachedNetworkImageProvider(profilePicture) : null,
                    child: profilePicture == null ? Icon(Icons.person, size: 40, color: isDarkMode ? Colors.white54 : Colors.black45) : null,
                  ),
                  const SizedBox(height: 12),
                  Text(displayName, style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: isDarkMode ? Colors.white : Colors.black87)),
                  const SizedBox(height: 12),
                  if (!isOwn && current != null)
                    ElevatedButton(
                      onPressed: _followLoading ? null : _handleFollow,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: isFollowing ? (isDarkMode ? Colors.grey.shade800 : Colors.grey.shade300) : HubColors.sage,
                        foregroundColor: isFollowing ? (isDarkMode ? Colors.white70 : Colors.black54) : Colors.white,
                        shape: const StadiumBorder(),
                      ),
                      child: Text(_followLoading ? '…' : isFollowing ? 'Following' : 'Follow'),
                    ),
                  if (isOwn)
                    OutlinedButton(onPressed: () => context.go(AppRoutes.profile), child: const Text('Edit profile')),
                  const SizedBox(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: social.entries.map((e) {
                      return IconButton(
                        onPressed: () => launchUrl(Uri.parse(e.value), mode: LaunchMode.externalApplication),
                        icon: Icon(_socialIcon(e.key), color: isDarkMode ? const Color(0xFFE7E9EA) : const Color(0xFF0F1419)),
                      );
                    }).toList(),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            Text('Posts & activity', style: TextStyle(fontWeight: FontWeight.w600, color: isDarkMode ? Colors.white54 : Colors.black54)),
            const SizedBox(height: 12),
            if (_posts.isEmpty)
              Container(
                padding: const EdgeInsets.all(32),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: isDarkMode ? const Color(0xFF262626) : Colors.white,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Text('No posts yet.', style: TextStyle(color: isDarkMode ? Colors.white54 : Colors.black54)),
              )
            else
              ..._posts.map((post) => Container(
                    margin: const EdgeInsets.only(bottom: 12),
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: isDarkMode ? const Color(0xFF262626) : Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: isDarkMode ? Colors.white10 : Colors.black12),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(post.content, style: TextStyle(color: isDarkMode ? Colors.white : Colors.black87, height: 1.5)),
                        const SizedBox(height: 8),
                        Text(_timeAgo(post.createdAt), style: TextStyle(color: isDarkMode ? Colors.white38 : Colors.black38, fontSize: 12)),
                      ],
                    ),
                  )),
          ],
        ),
      ),
    );
  }

  IconData _socialIcon(String key) {
    switch (key) {
      case 'reddit':
        return Icons.reddit;
      case 'linkedin':
        return Icons.business;
      case 'threads':
        return Icons.alternate_email;
      default:
        return Icons.close; // X approximation
    }
  }
}

extension _IfEmpty on String {
  String ifEmpty(String fallback) => isEmpty ? fallback : this;
}
