import 'dart:convert';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../components/skeleton/feed_skeleton.dart';
import '../contexts/theme_context.dart';
import '../router/app_router.dart';
import '../services/firestore_service.dart';
import '../utils/hub_colors.dart';

const _adminEmail = 'cultivatorboi@gmail.com';
const _createPostMaxChars = 500;

bool _isAdminUser(User? user) => user?.email == _adminEmail;

class CommunityPage extends StatefulWidget {
  const CommunityPage({super.key});

  @override
  State<CommunityPage> createState() => _CommunityPageState();
}

class _CommunityPageState extends State<CommunityPage> {
  final _scrollController = ScrollController();
  final _postController = TextEditingController();

  String _activeTab = 'explore';
  bool _showCreatePost = false;
  bool _showFab = true;
  bool _tabTransition = false;
  bool _openedCreateFromExtra = false;

  double _lastScrollOffset = 0;
  String? _profilePicture;
  List<String> _followingIds = [];
  String? _followLoadingUid;
  String? _postMenuOpenId;
  String? _deletePostLoadingId;

  String _selectedPlatform = 'x';
  final List<_MediaItem> _mediaItems = [];

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    _loadProfile();
    _loadFollowing();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final extra = GoRouterState.of(context).extra;
    if (extra is Map && extra['openCreatePost'] == true && !_openedCreateFromExtra) {
      _openedCreateFromExtra = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        setState(() {
          _activeTab = 'mySpace';
          _showCreatePost = true;
        });
      });
    }
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final offset = _scrollController.offset;
    if (offset < _lastScrollOffset) {
      if (!_showFab) setState(() => _showFab = true);
    } else if (offset > _lastScrollOffset && offset > 100) {
      if (_showFab) setState(() => _showFab = false);
    }
    _lastScrollOffset = offset;
  }

  Future<void> _loadProfile() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    setState(() {
      _profilePicture = prefs.getString('user_profile_picture_${user.uid}');
    });
  }

  Future<void> _loadFollowing() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || !_isAdminUser(user)) return;
    final res = await FirestoreService.instance.getFollowing(user.uid);
    if (!mounted) return;
    if (res['success'] == true && res['followingIds'] is List) {
      setState(() => _followingIds = List<String>.from(res['followingIds'] as List));
    }
  }

  List<Map<String, dynamic>> _filterPosts(List<Map<String, dynamic>> posts, String tab) {
    final user = FirebaseAuth.instance.currentUser;
    if (posts.isEmpty) return [];

    if (tab == 'mySpace') {
      if (user == null) return [];
      final mine = posts.where((p) => p['authorId'] == user.uid).toList();
      if (mine.isEmpty) return [];

      final byKey = <String, Map<String, dynamic>>{};
      for (final p in mine) {
        final content = (p['content'] as String? ?? '').trim();
        final image = p['image'] as String? ?? '';
        final key = '$content::$image';
        final existing = byKey[key];
        if (existing == null) {
          byKey[key] = p;
        } else {
          final existingTime = (existing['createdAt'] as DateTime?)?.millisecondsSinceEpoch ?? 0;
          final currentTime = (p['createdAt'] as DateTime?)?.millisecondsSinceEpoch ?? 0;
          if (currentTime > existingTime) byKey[key] = p;
        }
      }
      final list = byKey.values.toList();
      list.sort((a, b) {
        final ta = (a['createdAt'] as DateTime?)?.millisecondsSinceEpoch ?? 0;
        final tb = (b['createdAt'] as DateTime?)?.millisecondsSinceEpoch ?? 0;
        return tb.compareTo(ta);
      });
      return list;
    }

    if (tab == 'following') {
      if (user == null || _followingIds.isEmpty) return [];
      return posts.where((p) {
        final authorId = p['authorId'] as String?;
        return authorId != null && _followingIds.contains(authorId);
      }).toList();
    }

    return posts;
  }

  void _switchTab(String tab) {
    if (tab == _activeTab) return;
    setState(() => _tabTransition = true);
    Future.delayed(const Duration(milliseconds: 150), () {
      if (!mounted) return;
      setState(() {
        _activeTab = tab;
        _tabTransition = false;
      });
    });
  }

  Future<void> _handleFollow(String authorId) async {
    final current = FirebaseAuth.instance.currentUser;
    if (current == null || authorId.isEmpty || authorId == current.uid) return;
    setState(() => _followLoadingUid = authorId);
    try {
      final isFollowing = _followingIds.contains(authorId);
      final result = isFollowing
          ? await FirestoreService.instance.unfollowUser(current.uid, authorId)
          : await FirestoreService.instance.followUser(current.uid, authorId);
      if (mounted && result['success'] == true && result['followingIds'] is List) {
        setState(() => _followingIds = List<String>.from(result['followingIds'] as List));
      }
    } finally {
      if (mounted) setState(() => _followLoadingUid = null);
    }
  }

  Future<void> _deletePost(String postId) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || postId.isEmpty) return;
    setState(() {
      _deletePostLoadingId = postId;
      _postMenuOpenId = null;
    });
    try {
      await FirebaseFirestore.instance.collection('communityPosts').doc(postId).delete();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to delete post: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _deletePostLoadingId = null);
    }
  }

  void _openUserProfile(String? authorId) {
    if (authorId == null || authorId.isEmpty) return;
    final user = FirebaseAuth.instance.currentUser;
    if (user != null && authorId == user.uid) {
      context.go(AppRoutes.profile);
    } else {
      context.go('/user/$authorId');
    }
  }

  void _resetCreatePostState() {
    setState(() {
      _showCreatePost = false;
      _postController.clear();
      _selectedPlatform = 'x';
      _mediaItems.clear();
    });
  }

  Future<void> _pickImages() async {
    final picker = ImagePicker();
    final files = await picker.pickMultiImage(imageQuality: 85);
    if (files.isEmpty) return;

    for (final file in files) {
      final bytes = await file.readAsBytes();
      if (bytes.length > 10 * 1024 * 1024) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Each image must be less than 10MB')),
          );
        }
        continue;
      }
      final src = 'data:image/jpeg;base64,${base64Encode(bytes)}';
      if (!mounted) return;
      setState(() {
        _mediaItems.insert(0, _MediaItem(id: '${DateTime.now().microsecondsSinceEpoch}', src: src));
        if (_mediaItems.length > 10) _mediaItems.removeRange(10, _mediaItems.length);
      });
    }
  }

  void _generatePost() {
    final text = _postController.text.trim();
    if (text.isEmpty && _mediaItems.isEmpty) return;

    final platform = _selectedPlatform == 'x'
        ? 'x'
        : _selectedPlatform == 'reddit'
            ? 'reddit'
            : 'linkedin';

    setState(() => _showCreatePost = false);
    context.go(AppRoutes.shareSuggestions, extra: {
      'reflection': text.isEmpty ? ' ' : text,
      'platform': platform,
      'returnTo': AppRoutes.community,
      'suggestionsOnly': true,
      'media': _mediaItems.map((m) => m.src).where((s) => s.isNotEmpty).take(6).toList(),
    });
  }

  Widget _emptyState(String message, {String? subtitle}) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 64),
      child: Center(
        child: Column(
          children: [
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: HubColors.textSecondary, fontSize: 16, height: 1.5),
            ),
            if (subtitle != null) ...[
              const SizedBox(height: 8),
              Text(
                subtitle,
                textAlign: TextAlign.center,
                style: const TextStyle(color: HubColors.textSecondary, fontSize: 14),
              ),
            ],
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = context.watch<ThemeNotifier>();
    final user = FirebaseAuth.instance.currentUser;
    final admin = _isAdminUser(user);
    final effectiveTab = admin ? _activeTab : 'mySpace';

    final tabs = admin
        ? const [
            (id: 'mySpace', label: 'My Deeds'),
            (id: 'following', label: 'Following'),
            (id: 'explore', label: 'HUB'),
          ]
        : const [(id: 'mySpace', label: 'My Deeds')];

    return Scaffold(
      backgroundColor: HubColors.bg,
      body: SafeArea(
        bottom: false,
        child: Stack(
          children: [
            Column(
              children: [
                _buildHeader(theme),
                _buildTabs(tabs, effectiveTab),
                Expanded(
                  child: StreamBuilder<List<Map<String, dynamic>>>(
                    stream: FirestoreService.instance.streamCommunityPosts(),
                    builder: (context, snap) {
                      if (snap.connectionState == ConnectionState.waiting && !snap.hasData) {
                        return const Padding(padding: EdgeInsets.all(16), child: FeedSkeleton());
                      }
                      final allPosts = snap.data ?? [];
                      final filtered = _filterPosts(allPosts, effectiveTab);

                      if (filtered.isEmpty) {
                        return ListView(
                          controller: _scrollController,
                          children: [_buildEmptyForTab(effectiveTab)],
                        );
                      }

                      return AnimatedOpacity(
                        duration: const Duration(milliseconds: 200),
                        opacity: _tabTransition ? 0.7 : 1,
                        child: ListView.builder(
                          controller: _scrollController,
                          padding: const EdgeInsets.only(bottom: 120),
                          itemCount: filtered.length,
                          itemBuilder: (context, index) {
                            final post = filtered[index];
                            final isFirst = index == 0;
                            final isMyPost = effectiveTab == 'mySpace' &&
                                user != null &&
                                post['authorId'] == user.uid;
                            return _CommunityPostCard(
                              post: post,
                              isFirst: isFirst,
                              isMyPost: isMyPost,
                              showMyPostMenu: isMyPost,
                              menuOpen: _postMenuOpenId == post['id'],
                              deleting: _deletePostLoadingId == post['id'],
                              followingIds: _followingIds,
                              followLoadingUid: _followLoadingUid,
                              currentProfilePicture: _profilePicture,
                              onMenuToggle: () {
                                setState(() {
                                  _postMenuOpenId =
                                      _postMenuOpenId == post['id'] ? null : post['id'] as String?;
                                });
                              },
                              onMenuClose: () => setState(() => _postMenuOpenId = null),
                              onDelete: () => _deletePost(post['id'] as String),
                              onAuthorTap: () => _openUserProfile(post['authorId'] as String?),
                              onFollowTap: () => _handleFollow(post['authorId'] as String? ?? ''),
                            );
                          },
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
            if (_showCreatePost) _buildCreatePostModal(),
            Positioned(
              right: 16,
              bottom: 88,
              child: IgnorePointer(
                ignoring: !_showFab,
                child: AnimatedOpacity(
                  duration: const Duration(milliseconds: 300),
                  opacity: _showFab ? 1 : 0,
                  child: AnimatedSlide(
                    duration: const Duration(milliseconds: 300),
                    offset: _showFab ? Offset.zero : const Offset(0, 0.5),
                    child: FloatingActionButton(
                      onPressed: () => setState(() => _showCreatePost = true),
                      backgroundColor: HubColors.accent,
                      elevation: 8,
                      child: const Icon(Icons.add, color: Colors.white, size: 28),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyForTab(String tab) {
    switch (tab) {
      case 'mySpace':
        return _emptyState(
          'Your reflections will appear here when you share them with the community.',
          subtitle: 'A quiet space just for what you\'ve shared.',
        );
      case 'following':
        return _emptyState(
          _followingIds.isEmpty
              ? 'Follow people to see their reflections here. Familiar faces, calm feed.'
              : 'No posts from people you follow yet.',
        );
      default:
        return _emptyState('No reflections in the community yet. Be the first to share.');
    }
  }

  Widget _buildHeader(ThemeNotifier theme) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      decoration: const BoxDecoration(
        color: HubColors.bg,
        border: Border(bottom: BorderSide(color: HubColors.divider)),
      ),
      child: Row(
        children: [
          IconButton(
            onPressed: theme.toggleTheme,
            icon: Icon(
              theme.isDarkMode ? Icons.dark_mode : Icons.light_mode,
              color: HubColors.accent,
            ),
            tooltip: theme.isDarkMode ? 'Switch to light mode' : 'Switch to dark mode',
          ),
          Expanded(
            child: Center(
              child: ClipOval(
                child: Image.asset(
                  'assets/images/DEITECIrc.webp',
                  width: 40,
                  height: 40,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => const Icon(Icons.circle, color: HubColors.textSecondary),
                ),
              ),
            ),
          ),
          IconButton(
            onPressed: () => context.go(AppRoutes.watchlist),
            icon: const Icon(Icons.bookmark_outline, color: HubColors.text),
            tooltip: 'Watchlist',
          ),
          IconButton(
            onPressed: () => context.go(AppRoutes.helpImprove),
            tooltip: 'Help improve Deite',
            icon: const Text('✨', style: TextStyle(fontSize: 18)),
          ),
          IconButton(
            onPressed: () => context.go(AppRoutes.profile),
            tooltip: 'Profile',
            icon: _profileAvatar(_profilePicture, radius: 18),
          ),
        ],
      ),
    );
  }

  Widget _buildTabs(List<({String id, String label})> tabs, String effectiveTab) {
    return Row(
      children: tabs.map((tab) {
        final active = effectiveTab == tab.id;
        return Expanded(
          child: GestureDetector(
            onTap: () => _switchTab(tab.id),
            behavior: HitTestBehavior.opaque,
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  child: Text(
                    tab.label,
                    style: TextStyle(
                      color: active ? HubColors.text : HubColors.textSecondary,
                      fontSize: 15,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
                AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  height: 2,
                  width: active ? 48 : 0,
                  decoration: BoxDecoration(
                    color: HubColors.accent,
                    borderRadius: BorderRadius.circular(1),
                  ),
                ),
              ],
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _buildCreatePostModal() {
    final charCount = _postController.text.characters.length;
    final canGenerate = _postController.text.trim().isNotEmpty || _mediaItems.isNotEmpty;

    return Material(
      color: HubColors.bg,
      child: SafeArea(
        child: Column(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: const BoxDecoration(
                border: Border(bottom: BorderSide(color: HubColors.divider)),
              ),
              child: Row(
                children: [
                  IconButton(
                    onPressed: _resetCreatePostState,
                    icon: const Icon(Icons.close, color: HubColors.textSecondary),
                  ),
                  const Expanded(
                    child: Text(
                      'Create Post ✨',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: HubColors.text,
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  const SizedBox(width: 48),
                ],
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      '1. Where are you posting?',
                      style: TextStyle(color: HubColors.text, fontSize: 13, fontWeight: FontWeight.w500),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        _platformButton('x', 'X (Twitter)'),
                        const SizedBox(width: 12),
                        _platformButton('linkedin', 'LinkedIn'),
                        const SizedBox(width: 12),
                        _platformButton('reddit', 'Reddit'),
                      ],
                    ),
                    const SizedBox(height: 24),
                    const Text(
                      '2. Describe your idea (rough is fine)',
                      style: TextStyle(color: HubColors.text, fontSize: 13, fontWeight: FontWeight.w500),
                    ),
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: const Color(0xFF1A1A1A),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: HubColors.divider),
                      ),
                      child: Column(
                        children: [
                          TextField(
                            controller: _postController,
                            maxLines: 5,
                            maxLength: _createPostMaxChars,
                            onChanged: (_) => setState(() {}),
                            style: const TextStyle(color: HubColors.text, fontSize: 14, height: 1.5),
                            decoration: const InputDecoration(
                              border: InputBorder.none,
                              counterText: '',
                              hintText: 'Write your idea here...',
                              hintStyle: TextStyle(color: HubColors.textSecondary),
                            ),
                          ),
                          Align(
                            alignment: Alignment.centerRight,
                            child: Text(
                              '$charCount/$_createPostMaxChars',
                              style: const TextStyle(color: HubColors.textSecondary, fontSize: 11),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 24),
                    const Text(
                      '3. Add media',
                      style: TextStyle(color: HubColors.text, fontSize: 13, fontWeight: FontWeight.w500),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        GestureDetector(
                          onTap: _pickImages,
                          child: Container(
                            width: 150,
                            height: 110,
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(color: HubColors.accent, width: 1, style: BorderStyle.solid),
                              color: HubColors.accent.withValues(alpha: 0.06),
                            ),
                            child: Stack(
                              fit: StackFit.expand,
                              children: [
                                if (_mediaItems.isNotEmpty)
                                  ClipRRect(
                                    borderRadius: BorderRadius.circular(16),
                                    child: _imageFromSrc(_mediaItems.first.src, fit: BoxFit.cover),
                                  ),
                                if (_mediaItems.isNotEmpty)
                                  Container(
                                    decoration: BoxDecoration(
                                      borderRadius: BorderRadius.circular(16),
                                      gradient: LinearGradient(
                                        begin: Alignment.topCenter,
                                        end: Alignment.bottomCenter,
                                        colors: [
                                          Colors.black.withValues(alpha: 0.55),
                                          Colors.black.withValues(alpha: 0.25),
                                          Colors.black.withValues(alpha: 0.65),
                                        ],
                                      ),
                                    ),
                                  ),
                                if (_mediaItems.length > 1)
                                  Positioned(
                                    top: 8,
                                    right: 8,
                                    child: Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                      decoration: BoxDecoration(
                                        color: Colors.black.withValues(alpha: 0.55),
                                        borderRadius: BorderRadius.circular(12),
                                        border: Border.all(color: HubColors.divider),
                                      ),
                                      child: Text(
                                        '+${_mediaItems.length - 1}',
                                        style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600),
                                      ),
                                    ),
                                  ),
                                const Center(
                                  child: Column(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(Icons.image_outlined, color: HubColors.accent, size: 28),
                                      SizedBox(height: 8),
                                      Text(
                                        'Upload photos',
                                        style: TextStyle(color: HubColors.text, fontSize: 12, fontWeight: FontWeight.w500),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: SizedBox(
                            height: 110,
                            child: ListView.separated(
                              scrollDirection: Axis.horizontal,
                              itemCount: _mediaItems.length,
                              separatorBuilder: (_, __) => const SizedBox(width: 12),
                              itemBuilder: (_, i) => _mediaPreviewCard(_mediaItems[i]),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            Container(
              padding: EdgeInsets.fromLTRB(20, 16, 20, MediaQuery.paddingOf(context).bottom + 16),
              decoration: const BoxDecoration(
                color: HubColors.bgSecondary,
                border: Border(top: BorderSide(color: HubColors.divider)),
              ),
              child: SizedBox(
                width: double.infinity,
                height: 50,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(16),
                    gradient: const LinearGradient(
                      colors: [HubColors.accent, HubColors.accentHighlight],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: HubColors.accent.withValues(alpha: 0.25),
                        blurRadius: 30,
                        offset: const Offset(0, 10),
                      ),
                    ],
                  ),
                  child: ElevatedButton(
                    onPressed: canGenerate ? _generatePost : null,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.transparent,
                      shadowColor: Colors.transparent,
                      foregroundColor: Colors.white,
                      disabledForegroundColor: Colors.white54,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                    ),
                    child: const Text('✨ Generate Post'),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _platformButton(String id, String label) {
    final selected = _selectedPlatform == id;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _selectedPlatform = id),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 8),
          decoration: BoxDecoration(
            color: selected ? Colors.white.withValues(alpha: 0.04) : Colors.white.withValues(alpha: 0.02),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: selected ? HubColors.accent : HubColors.divider),
            boxShadow: selected
                ? [
                    BoxShadow(
                      color: HubColors.accent.withValues(alpha: 0.18),
                      blurRadius: 24,
                      offset: const Offset(0, 10),
                    ),
                  ]
                : null,
          ),
          child: Center(child: _platformIcon(id)),
        ),
      ),
    );
  }

  Widget _platformIcon(String platformId) {
    return Container(
      width: 36,
      height: 36,
      decoration: BoxDecoration(
        color: _selectedPlatform == platformId
            ? HubColors.accent.withValues(alpha: 0.12)
            : Colors.white.withValues(alpha: 0.04),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: HubColors.divider),
      ),
      child: Center(
        child: switch (platformId) {
          'linkedin' => const Text(
              'in',
              style: TextStyle(
                color: HubColors.text,
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
          'x' => CustomPaint(
              size: const Size(18, 18),
              painter: _XLogoPainter(),
            ),
          _ => Image.asset(
              'assets/images/reddit-logo-mono.png',
              width: 28,
              height: 28,
              errorBuilder: (_, __, ___) => const Icon(Icons.forum, color: HubColors.text, size: 20),
            ),
        },
      ),
    );
  }

  Widget _mediaPreviewCard(_MediaItem item) {
    return Stack(
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(16),
          child: SizedBox(
            width: 110,
            height: 110,
            child: _imageFromSrc(item.src, fit: BoxFit.cover),
          ),
        ),
        Positioned(
          top: 8,
          right: 8,
          child: GestureDetector(
            onTap: () => setState(() => _mediaItems.removeWhere((m) => m.id == item.id)),
            child: Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.55),
                shape: BoxShape.circle,
                border: Border.all(color: HubColors.divider),
              ),
              child: const Icon(Icons.close, size: 16, color: HubColors.text),
            ),
          ),
        ),
      ],
    );
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    _postController.dispose();
    super.dispose();
  }
}

class _CommunityPostCard extends StatefulWidget {
  const _CommunityPostCard({
    required this.post,
    required this.isFirst,
    required this.isMyPost,
    required this.showMyPostMenu,
    required this.menuOpen,
    required this.deleting,
    required this.followingIds,
    required this.followLoadingUid,
    required this.currentProfilePicture,
    required this.onMenuToggle,
    required this.onMenuClose,
    required this.onDelete,
    required this.onAuthorTap,
    required this.onFollowTap,
  });

  final Map<String, dynamic> post;
  final bool isFirst;
  final bool isMyPost;
  final bool showMyPostMenu;
  final bool menuOpen;
  final bool deleting;
  final List<String> followingIds;
  final String? followLoadingUid;
  final String? currentProfilePicture;
  final VoidCallback onMenuToggle;
  final VoidCallback onMenuClose;
  final VoidCallback onDelete;
  final VoidCallback onAuthorTap;
  final VoidCallback onFollowTap;

  @override
  State<_CommunityPostCard> createState() => _CommunityPostCardState();
}

class _CommunityPostCardState extends State<_CommunityPostCard> {
  bool _showComments = false;
  bool _canSendComment = false;
  final _commentController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _commentController.addListener(() {
      final can = _commentController.text.trim().isNotEmpty;
      if (can != _canSendComment) setState(() => _canSendComment = can);
    });
  }

  String get _postId => widget.post['id'] as String;

  Future<void> _toggleLike(bool isLiked) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please sign in to like posts')),
      );
      return;
    }
    final likeRef = FirebaseFirestore.instance.doc('communityPosts/$_postId/likes/${user.uid}');
    try {
      if (isLiked) {
        await likeRef.delete();
      } else {
        await likeRef.set({
          'userId': user.uid,
          'createdAt': FieldValue.serverTimestamp(),
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to update like: $e')),
        );
      }
    }
  }

  Future<void> _addComment() async {
    final text = _commentController.text.trim();
    if (text.isEmpty) return;

    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please sign in to comment')),
      );
      return;
    }

    final prefs = await SharedPreferences.getInstance();
    final author = prefs.getString('user_display_name_${user.uid}') ??
        user.displayName ??
        user.email?.split('@').first ??
        'Anonymous';
    final profilePicture = prefs.getString('user_profile_picture_${user.uid}') ?? widget.currentProfilePicture;

    try {
      await FirebaseFirestore.instance.collection('communityPosts/$_postId/comments').add({
        'text': text,
        'author': author,
        'authorName': author,
        'userId': user.uid,
        'profilePicture': profilePicture,
        'createdAt': FieldValue.serverTimestamp(),
      });
      _commentController.clear();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to add comment: $e')),
        );
      }
    }
  }

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final user = FirebaseAuth.instance.currentUser;
    final authorId = widget.post['authorId'] as String?;
    final canFollow = authorId != null && user != null && authorId != user.uid;
    final isFollowing = authorId != null && widget.followingIds.contains(authorId);
    final sharedPlatform = widget.post['sharedPlatform'] as String?;
    final content = widget.post['content'] as String? ?? '';
    final image = widget.post['image'] as String?;
    final hideContentForXImage = sharedPlatform == 'x' && image != null && image.isNotEmpty;

    return Container(
      decoration: BoxDecoration(
        border: Border(
          top: widget.isFirst ? BorderSide.none : const BorderSide(color: HubColors.divider),
        ),
      ),
      padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (widget.showMyPostMenu)
            Align(
              alignment: Alignment.topRight,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    _formatThreeDotTimestamp(widget.post['createdAt'] as DateTime?),
                    style: const TextStyle(color: HubColors.textSecondary, fontSize: 12),
                  ),
                  IconButton(
                    onPressed: widget.deleting ? null : widget.onMenuToggle,
                    icon: const Icon(Icons.more_vert, size: 20, color: HubColors.textSecondary),
                  ),
                ],
              ),
            ),
          if (widget.menuOpen)
            Align(
              alignment: Alignment.topRight,
              child: Material(
                color: HubColors.bgSecondary,
                borderRadius: BorderRadius.circular(12),
                child: Container(
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: HubColors.divider),
                  ),
                  child: TextButton.icon(
                    onPressed: widget.deleting ? null : widget.onDelete,
                    icon: const Icon(Icons.delete_outline, size: 18, color: HubColors.textSecondary),
                    label: Text(
                      widget.deleting ? 'Deleting…' : 'Delete',
                      style: const TextStyle(color: HubColors.text, fontSize: 14),
                    ),
                  ),
                ),
              ),
            ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Stack(
                clipBehavior: Clip.none,
                children: [
                  GestureDetector(
                    onTap: widget.onAuthorTap,
                    child: _profileAvatar(widget.post['profilePicture'] as String?, radius: 20),
                  ),
                  if (canFollow)
                    Positioned(
                      right: -2,
                      bottom: -2,
                      child: GestureDetector(
                        onTap: widget.followLoadingUid == authorId ? null : widget.onFollowTap,
                        child: Container(
                          width: 20,
                          height: 20,
                          decoration: BoxDecoration(
                            color: Colors.white,
                            shape: BoxShape.circle,
                            border: Border.all(color: Colors.grey.shade300),
                          ),
                          child: widget.followLoadingUid == authorId
                              ? const Padding(
                                  padding: EdgeInsets.all(4),
                                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black),
                                )
                              : Icon(
                                  isFollowing ? Icons.check : Icons.add,
                                  size: 14,
                                  color: Colors.black,
                                ),
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    GestureDetector(
                      onTap: widget.onAuthorTap,
                      child: Row(
                        children: [
                          Text(
                            widget.post['author'] as String? ?? 'Anonymous',
                            style: const TextStyle(
                              color: HubColors.text,
                              fontWeight: FontWeight.w600,
                              fontSize: 13,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            _formatTimeAgo(widget.post['createdAt'] as DateTime?),
                            style: const TextStyle(color: HubColors.textSecondary, fontSize: 13),
                          ),
                        ],
                      ),
                    ),
                    if (!hideContentForXImage && content.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        content,
                        style: const TextStyle(color: HubColors.text, fontSize: 15, height: 1.35),
                      ),
                    ],
                    if (image != null && image.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(14),
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(maxHeight: 320),
                          child: _imageFromSrc(image, fit: BoxFit.cover, width: double.infinity),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
            stream: FirebaseFirestore.instance.collection('communityPosts/$_postId/likes').snapshots(),
            builder: (context, likesSnap) {
              final likedIds = likesSnap.data?.docs.map((d) => d.id).toList() ?? [];
              final likesCount = likedIds.length;
              final isLiked = user != null && likedIds.contains(user.uid);

              return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
                stream: FirebaseFirestore.instance
                    .collection('communityPosts/$_postId/comments')
                    .orderBy('createdAt', descending: false)
                    .snapshots(),
                builder: (context, commentsSnap) {
                  final comments = commentsSnap.data?.docs ?? [];

                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        padding: const EdgeInsets.only(top: 12),
                        decoration: const BoxDecoration(
                          border: Border(top: BorderSide(color: HubColors.divider)),
                        ),
                        child: Row(
                          children: [
                            _actionButton(
                              icon: isLiked ? Icons.favorite : Icons.favorite_border,
                              iconColor: isLiked ? HubColors.accent : HubColors.textSecondary,
                              label: '$likesCount',
                              onTap: () => _toggleLike(isLiked),
                            ),
                            const SizedBox(width: 24),
                            _actionButton(
                              icon: Icons.chat_bubble_outline,
                              label: '${comments.length}',
                              onTap: () => setState(() => _showComments = !_showComments),
                            ),
                          ],
                        ),
                      ),
                      if (_showComments) ...[
                        const SizedBox(height: 16),
                        Container(
                          padding: const EdgeInsets.only(top: 16),
                          decoration: const BoxDecoration(
                            border: Border(top: BorderSide(color: HubColors.divider)),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Text(
                                    'Comments (${comments.length})',
                                    style: const TextStyle(
                                      color: HubColors.text,
                                      fontSize: 14,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                  const Spacer(),
                                  IconButton(
                                    onPressed: () => setState(() => _showComments = false),
                                    icon: const Icon(Icons.close, size: 18, color: HubColors.textSecondary),
                                  ),
                                ],
                              ),
                              if (comments.isEmpty)
                                const Padding(
                                  padding: EdgeInsets.symmetric(vertical: 8),
                                  child: Text(
                                    'No comments yet.',
                                    style: TextStyle(color: HubColors.textSecondary, fontSize: 12),
                                  ),
                                )
                              else
                                ...comments.map((doc) {
                                  final data = doc.data();
                                  final commentAuthor = data['author'] as String? ??
                                      data['authorName'] as String? ??
                                      'Anonymous';
                                  final commentText = data['text'] as String? ?? data['message'] as String? ?? '';
                                  final createdAt = data['createdAt'];
                                  DateTime? commentTime;
                                  if (createdAt is Timestamp) commentTime = createdAt.toDate();
                                  final commentPic = data['profilePicture'] as String?;

                                  return Padding(
                                    padding: const EdgeInsets.only(bottom: 12),
                                    child: Row(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        _profileAvatar(commentPic, radius: 12),
                                        const SizedBox(width: 8),
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              Row(
                                                children: [
                                                  Text(
                                                    commentAuthor,
                                                    style: const TextStyle(
                                                      color: HubColors.text,
                                                      fontSize: 12,
                                                      fontWeight: FontWeight.w600,
                                                    ),
                                                  ),
                                                  const SizedBox(width: 6),
                                                  Text(
                                                    _formatTimeAgo(commentTime),
                                                    style: const TextStyle(
                                                      color: HubColors.textSecondary,
                                                      fontSize: 10,
                                                    ),
                                                  ),
                                                ],
                                              ),
                                              const SizedBox(height: 2),
                                              Text(
                                                commentText,
                                                style: const TextStyle(color: HubColors.text, fontSize: 12, height: 1.4),
                                              ),
                                            ],
                                          ),
                                        ),
                                      ],
                                    ),
                                  );
                                }),
                              const SizedBox(height: 8),
                              Row(
                                children: [
                                  Expanded(
                                    child: TextField(
                                      controller: _commentController,
                                      style: const TextStyle(color: HubColors.text, fontSize: 12),
                                      decoration: InputDecoration(
                                        hintText: 'Add a comment...',
                                        hintStyle: TextStyle(color: HubColors.textSecondary.withValues(alpha: 0.8)),
                                        filled: true,
                                        fillColor: Colors.white.withValues(alpha: 0.06),
                                        border: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(8),
                                          borderSide: BorderSide.none,
                                        ),
                                        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                                      ),
                                      onSubmitted: (_) => _addComment(),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  IconButton(
                                    onPressed: _canSendComment ? _addComment : null,
                                    style: IconButton.styleFrom(
                                      backgroundColor: HubColors.accent,
                                      disabledBackgroundColor: HubColors.divider,
                                    ),
                                    icon: const Icon(Icons.send, size: 16, color: Colors.white),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ],
                    ],
                  );
                },
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _actionButton({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
    Color iconColor = HubColors.textSecondary,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
        child: Row(
          children: [
            Icon(icon, size: 18, color: iconColor),
            const SizedBox(width: 6),
            Text(label, style: const TextStyle(color: HubColors.textSecondary, fontSize: 12)),
          ],
        ),
      ),
    );
  }
}

class _MediaItem {
  _MediaItem({required this.id, required this.src});
  final String id;
  final String src;
}

class _XLogoPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = HubColors.text;
    final scale = size.width / 24;
    canvas.scale(scale);
    final path = Path()
      ..moveTo(18.244, 2)
      ..lineTo(21.62, 2)
      ..lineTo(14.24, 10.436)
      ..lineTo(22.92, 22)
      ..lineTo(16.12, 22)
      ..lineTo(10.8, 15.04)
      ..lineTo(4.69, 22)
      ..lineTo(1.31, 22)
      ..lineTo(9.21, 12.96)
      ..lineTo(1.08, 2)
      ..lineTo(8.05, 2)
      ..lineTo(12.86, 8.3)
      ..close();
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

Widget _profileAvatar(String? url, {required double radius}) {
  if (url != null && url.startsWith('data:image')) {
    try {
      return CircleAvatar(
        radius: radius,
        backgroundImage: MemoryImage(base64Decode(url.split(',').last)),
      );
    } catch (_) {}
  }
  if (url != null && url.isNotEmpty && !url.startsWith('data:')) {
    return CircleAvatar(
      radius: radius,
      backgroundImage: CachedNetworkImageProvider(url),
      backgroundColor: HubColors.divider,
    );
  }
  return CircleAvatar(
    radius: radius,
    backgroundColor: HubColors.divider,
    child: Icon(Icons.person, size: radius, color: HubColors.textSecondary),
  );
}

Widget _imageFromSrc(String src, {BoxFit fit = BoxFit.cover, double? width}) {
  Widget child;
  if (src.startsWith('data:image')) {
    try {
      child = Image.memory(
        base64Decode(src.split(',').last),
        fit: fit,
        width: width,
        errorBuilder: (_, __, ___) => const SizedBox.shrink(),
      );
    } catch (_) {
      child = const SizedBox.shrink();
    }
  } else {
    child = CachedNetworkImage(
      imageUrl: src,
      fit: fit,
      width: width,
      errorWidget: (_, __, ___) => const SizedBox.shrink(),
    );
  }
  return child;
}

String _formatTimeAgo(DateTime? date) {
  if (date == null) return 'Just now';
  final diff = DateTime.now().difference(date);
  if (diff.inMinutes < 1) return 'Just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes} ${diff.inMinutes == 1 ? 'min' : 'mins'} ago';
  if (diff.inHours < 24) return '${diff.inHours} ${diff.inHours == 1 ? 'hour' : 'hours'} ago';
  return '${diff.inDays} ${diff.inDays == 1 ? 'day' : 'days'} ago';
}

String _formatThreeDotTimestamp(DateTime? dateVal) {
  if (dateVal == null) return '';
  final now = DateTime.now();
  final diff = now.difference(dateVal);
  if (diff.isNegative) return '';

  if (diff.inHours < 24) {
    final hours = diff.inHours;
    if (hours >= 1) return '${hours}h';
    final minutes = diff.inMinutes.clamp(1, 59);
    return '${minutes}m';
  }

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  final month = months[dateVal.month - 1];
  final dayNum = dateVal.day;
  if (dateVal.year == now.year) return '$dayNum $month';

  final dayPadded = dayNum.toString().padLeft(2, '0');
  final year2 = (dateVal.year % 100).toString().padLeft(2, '0');
  return '$dayPadded $month $year2';
}
