import 'dart:async';
import 'dart:convert';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../contexts/theme_context.dart';
import '../router/app_router.dart';
import '../services/auth_service.dart';
import '../services/firestore_result.dart';
import '../services/firestore_service.dart';

/// Mirrors src/components/PodGroupChatPage.js
class PodGroupChatPage extends StatefulWidget {
  const PodGroupChatPage({super.key});

  @override
  State<PodGroupChatPage> createState() => _PodGroupChatPageState();
}

class _PodGroupChatPageState extends State<PodGroupChatPage> {
  final _inputController = TextEditingController();
  final _scrollController = ScrollController();
  final _picker = ImagePicker();

  String? _profilePicture;
  String? _selectedImageBase64;
  String? _sphereId;
  List<_CrewMember> _crewMembers = [];
  List<Map<String, dynamic>> _messages = [];
  bool _loadingCrew = true;
  void Function()? _unsub;

  static const _memberColors = [
    Color(0xFF7DD3C0),
    Color(0xFFFDD663),
    Color(0xFF8AB4F8),
    Color(0xFFE6B3BA),
    Color(0xFF81C995),
  ];

  @override
  void initState() {
    super.initState();
    _loadProfilePicture();
    _loadCrewSphere();
  }

  @override
  void dispose() {
    _unsub?.call();
    _inputController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _loadProfilePicture() async {
    final user = AuthService().getCurrentUser();
    if (user == null) return;
    try {
      final result = await FirestoreService.instance.getUser(user.uid);
      if (result.success && result.data != null && result.data!['profilePicture'] != null) {
        final pic = result.data!['profilePicture'] as String;
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('user_profile_picture_${user.uid}', pic);
        if (mounted) setState(() => _profilePicture = pic);
        return;
      }
    } catch (_) {}
    final prefs = await SharedPreferences.getInstance();
    if (mounted) setState(() => _profilePicture = prefs.getString('user_profile_picture_${user.uid}'));
  }

  Future<void> _loadCrewSphere() async {
    final user = AuthService().getCurrentUser();
    if (user == null) {
      setState(() => _loadingCrew = false);
      return;
    }
    setState(() => _loadingCrew = true);
    FirestoreService.instance.syncUserPodDocuments(user.uid);
    FirestoreService.instance.updateUserMetadata(user.uid, {
      'displayName': user.displayName ?? 'User',
      'profilePicture': _profilePicture,
    });

    final sphereResult = await FirestoreService.instance.getUserCrewSphere(user.uid);
    if (sphereResult.success && sphereResult['sphereId'] != null) {
      final sphereId = sphereResult['sphereId'] as String;
      setState(() => _sphereId = sphereId);
      final sphere = sphereResult['sphere'] as Map<String, dynamic>?;
      final members = sphere?['members'];
      if (members is List) {
        final uids = members.cast<String>().where((uid) => uid != user.uid).toList();
        final loaded = <_CrewMember>[];
        for (var i = 0; i < uids.length; i++) {
          final m = await FirestoreService.instance.getUser(uids[i]);
          if (m.success && m.data != null) {
            loaded.add(_CrewMember(
              uid: uids[i],
              displayName: m.data!['displayName'] as String? ?? 'User',
              profilePicture: m.data!['profilePicture'] as String?,
              color: _memberColors[i % _memberColors.length],
            ));
          }
        }
        setState(() => _crewMembers = loaded);
      }
      _subscribeMessages(sphereId);
    }
    setState(() => _loadingCrew = false);
  }

  void _subscribeMessages(String sphereId) {
    _unsub?.call();
    _unsub = FirestoreService.instance.subscribeToCrewSphereMessages(sphereId, (msgs) {
      if (!mounted) return;
      setState(() => _messages = msgs);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scrollController.hasClients) {
          _scrollController.animateTo(
            _scrollController.position.maxScrollExtent,
            duration: const Duration(milliseconds: 300),
            curve: Curves.easeOut,
          );
        }
      });
    });
  }

  Future<void> _pickImage() async {
    final file = await _picker.pickImage(source: ImageSource.gallery, maxWidth: 1200);
    if (file == null) return;
    final bytes = await file.readAsBytes();
    if (bytes.length > 10 * 1024 * 1024) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Image size should be less than 10MB')));
      return;
    }
    setState(() => _selectedImageBase64 = 'data:image/jpeg;base64,${base64Encode(bytes)}');
  }

  Future<void> _send() async {
    final user = AuthService().getCurrentUser();
    if (user == null || _sphereId == null) return;
    final text = _inputController.text.trim();
    if (text.isEmpty && _selectedImageBase64 == null) return;

    final result = await FirestoreService.instance.saveCrewSphereMessage(
      _sphereId!,
      user.uid,
      {
        'senderName': user.displayName ?? 'User',
        'message': text,
        'image': _selectedImageBase64,
      },
    );
    if (result.success) {
      _inputController.clear();
      setState(() => _selectedImageBase64 = null);
    } else if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to send message. Please try again.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = context.watch<ThemeNotifier>().isDarkMode;
    final user = AuthService().getCurrentUser();
    final userName = user?.displayName ?? 'You';

    final groupMembers = <_MemberBarItem>[
      _MemberBarItem(name: userName, profilePicture: _profilePicture, color: isDark ? const Color(0xFF8AB4F8) : const Color(0xFF87A96B)),
      ..._crewMembers.map((m) => _MemberBarItem(name: m.displayName, profilePicture: m.profilePicture, color: m.color)),
      if (!_loadingCrew) const _MemberBarItem(name: 'AI', isAi: true),
    ];

    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF131314) : const Color(0xFFB5C4AE),
      body: Column(
        children: [
          Material(
            color: isDark ? const Color(0xFF262626) : Colors.white,
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                child: Row(
                  children: [
                    IconButton(
                      icon: Icon(LucideIcons.arrowLeft, color: isDark ? Colors.white : Colors.grey.shade800),
                      onPressed: () => context.go(AppRoutes.pod),
                    ),
                    Icon(LucideIcons.users, color: isDark ? const Color(0xFF8AB4F8) : const Color(0xFF87A96B), size: 22),
                    const SizedBox(width: 8),
                    Text("Crew's Sphere", style: TextStyle(color: isDark ? Colors.white : Colors.grey.shade800, fontSize: 18, fontWeight: FontWeight.w600)),
                  ],
                ),
              ),
            ),
          ),
          SizedBox(
            height: 88,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              itemCount: groupMembers.length,
              separatorBuilder: (_, __) => const SizedBox(width: 12),
              itemBuilder: (_, i) {
                final m = groupMembers[i];
                return Column(
                  children: [
                    CircleAvatar(
                      radius: 20,
                      backgroundColor: m.isAi ? const Color(0xFFB19CD9).withValues(alpha: 0.3) : m.color.withValues(alpha: 0.3),
                      backgroundImage: m.profilePicture != null ? CachedNetworkImageProvider(m.profilePicture!) : null,
                      child: m.isAi
                          ? const Icon(Icons.smart_toy, size: 20)
                          : (m.profilePicture == null ? Icon(LucideIcons.user, color: m.color, size: 18) : null),
                    ),
                    const SizedBox(height: 4),
                    SizedBox(
                      width: 56,
                      child: Text(m.name, maxLines: 1, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center, style: TextStyle(fontSize: 10, color: isDark ? Colors.grey : Colors.grey.shade600)),
                    ),
                  ],
                );
              },
            ),
          ),
          Expanded(
            child: _messages.isEmpty
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(LucideIcons.users, size: 64, color: isDark ? Colors.grey.shade600 : Colors.grey.shade300),
                          const SizedBox(height: 16),
                          Text('Welcome to Your Crew', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: isDark ? Colors.white : Colors.grey.shade800)),
                          const SizedBox(height: 12),
                          Text(
                            'Your crew of 5 people who match your vibe. A space to talk, laugh, and gossip — with an anonymous identity.',
                            textAlign: TextAlign.center,
                            style: TextStyle(fontSize: 14, color: isDark ? Colors.grey.shade400 : Colors.grey.shade500),
                          ),
                        ],
                      ),
                    ),
                  )
                : ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.all(16),
                    itemCount: _messages.length,
                    itemBuilder: (_, i) => _MessageBubble(
                      msg: _messages[i],
                      isDark: isDark,
                      crewMembers: _crewMembers,
                      currentUid: user?.uid,
                      profilePicture: _profilePicture,
                    ),
                  ),
          ),
          Material(
            color: isDark ? const Color(0xFF262626) : Colors.white,
            child: SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  children: [
                    if (_selectedImageBase64 != null)
                      Stack(
                        children: [
                          ClipRRect(
                            borderRadius: BorderRadius.circular(8),
                            child: Image.memory(base64Decode(_selectedImageBase64!.split(',').last), height: 120, fit: BoxFit.cover),
                          ),
                          Positioned(
                            top: 4,
                            right: 4,
                            child: IconButton(
                              icon: const Icon(LucideIcons.x, color: Colors.white, size: 18),
                              onPressed: () => setState(() => _selectedImageBase64 = null),
                            ),
                          ),
                        ],
                      ),
                    Row(
                      children: [
                        IconButton(icon: Icon(LucideIcons.image, color: isDark ? const Color(0xFF8AB4F8) : const Color(0xFF87A96B)), onPressed: _pickImage),
                        Expanded(
                          child: TextField(
                            controller: _inputController,
                            style: TextStyle(color: isDark ? Colors.white : Colors.grey.shade800),
                            decoration: InputDecoration(
                              hintText: 'Type a message...',
                              filled: true,
                              fillColor: isDark ? Colors.grey.shade800.withValues(alpha: 0.5) : Colors.grey.shade100,
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
                            ),
                            onSubmitted: (_) => _send(),
                          ),
                        ),
                        IconButton(
                          icon: const Icon(LucideIcons.send, color: Colors.white),
                          style: IconButton.styleFrom(backgroundColor: isDark ? const Color(0xFF8AB4F8) : const Color(0xFF87A96B)),
                          onPressed: _send,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CrewMember {
  const _CrewMember({required this.uid, required this.displayName, this.profilePicture, required this.color});
  final String uid;
  final String displayName;
  final String? profilePicture;
  final Color color;
}

class _MemberBarItem {
  const _MemberBarItem({required this.name, this.profilePicture, this.color = Colors.grey, this.isAi = false});
  final String name;
  final String? profilePicture;
  final Color color;
  final bool isAi;
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({
    required this.msg,
    required this.isDark,
    required this.crewMembers,
    required this.currentUid,
    required this.profilePicture,
  });

  final Map<String, dynamic> msg;
  final bool isDark;
  final List<_CrewMember> crewMembers;
  final String? currentUid;
  final String? profilePicture;

  @override
  Widget build(BuildContext context) {
    final sender = msg['sender'] as String? ?? 'User';
    final isAi = sender == 'AI';
    Color color = isDark ? const Color(0xFF8AB4F8) : const Color(0xFF87A96B);
    String? pic = profilePicture;
    final senderUid = msg['senderUid'] as String? ?? '';
    if (senderUid != currentUid) {
      for (final m in crewMembers) {
        if (m.uid == senderUid) {
          color = m.color;
          pic = m.profilePicture;
          break;
        }
      }
    }
    final image = msg['image'] as String?;
    final message = msg['message'] as String? ?? '';
    final time = msg['time'] as String? ?? '';

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: isAi ? const EdgeInsets.all(12) : null,
      decoration: isAi
          ? BoxDecoration(
              color: const Color(0xFFB19CD9).withValues(alpha: isDark ? 0.15 : 0.1),
              borderRadius: BorderRadius.circular(16),
            )
          : null,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            radius: 16,
            backgroundColor: color.withValues(alpha: 0.3),
            backgroundImage: !isAi && pic != null ? CachedNetworkImageProvider(pic) : null,
            child: isAi ? const Icon(Icons.smart_toy, size: 16) : (pic == null ? const Text('👤', style: TextStyle(fontSize: 12)) : null),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(sender, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: isDark ? Colors.white : Colors.grey.shade800)),
                    const SizedBox(width: 8),
                    Text(time, style: TextStyle(fontSize: 10, color: Colors.grey.shade500)),
                  ],
                ),
                if (image != null && image.startsWith('data:'))
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: Image.memory(base64Decode(image.contains(',') ? image.split(',').last : image), fit: BoxFit.cover),
                    ),
                  ),
                if (message.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(message, style: TextStyle(fontSize: 14, color: isDark ? Colors.grey.shade300 : Colors.grey.shade700)),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
