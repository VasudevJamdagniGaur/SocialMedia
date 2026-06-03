import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import '../contexts/theme_context.dart';
import '../router/app_router.dart';
import '../services/chat_service.dart';
import '../services/firestore_service.dart';
import '../utils/date_utils.dart';
import '../utils/hub_colors.dart';

class ShareReflectionPage extends StatefulWidget {
  const ShareReflectionPage({super.key});

  @override
  State<ShareReflectionPage> createState() => _ShareReflectionPageState();
}

class _ShareReflectionPageState extends State<ShareReflectionPage> {
  late String _initialText;
  late String _sharePreviewText;
  bool _shareEditMode = false;
  bool _isSharingPost = false;
  String? _profilePicture;
  String _displayName = 'You';
  String _shareAs = 'text';
  String _imageTheme = 'light';
  bool _showAiEditModal = false;
  final _aiInstructionController = TextEditingController();
  bool _isAiEditing = false;
  final _cardKey = GlobalKey();

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final extra = GoRouterState.of(context).extra;
    final state = extra is Map ? extra : <String, dynamic>{};
    final reflection = state['reflection'] ?? state['reflectionToShare']?['reflection'] ?? '';
    _initialText = (reflection is String ? reflection : '').trim();
    _sharePreviewText = _initialText;
    if (_initialText.isEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final from = state['from'] == 'reflections' ? AppRoutes.podReflections : AppRoutes.dashboard;
        context.go(from as String? ?? AppRoutes.dashboard);
      });
    }
    _loadProfile();
  }

  Future<void> _loadProfile() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _displayName = prefs.getString('user_display_name_${user.uid}') ?? user.displayName ?? 'You';
      _profilePicture = prefs.getString('user_profile_picture_${user.uid}');
    });
  }

  String _shareHeaderText() {
    final extra = GoRouterState.of(context).extra;
    final state = extra is Map ? extra : <String, dynamic>{};
    DateTime d = DateTime.now();
    if (state['selectedDate'] != null) {
      d = state['selectedDate'] is DateTime ? state['selectedDate'] as DateTime : DateTime.tryParse('${state['selectedDate']}') ?? d;
    }
    final today = DateTime.now();
    if (d.year == today.year && d.month == today.month && d.day == today.day) {
      return 'This is what you lived today.';
    }
    final yesterday = today.subtract(const Duration(days: 1));
    if (d.year == yesterday.year && d.month == yesterday.month && d.day == yesterday.day) {
      return 'You lived this moment yesterday.';
    }
    return 'You lived this moment on ${d.month}/${d.day}.';
  }

  String _handleFromName(String name) => '@${name.replaceAll(RegExp(r'\s+'), '').toLowerCase().substring(0, name.length.clamp(0, 20))}';

  Future<void> _shareToHub() async {
    final user = FirebaseAuth.instance.currentUser;
    final content = _sharePreviewText.trim();
    if (user == null || content.isEmpty) return;
    setState(() => _isSharingPost = true);
    try {
      await firestoreService.addCommunityPost({
        'author': _displayName,
        'authorId': user.uid,
        'content': content,
        'createdAt': FieldValue.serverTimestamp(),
        'likes': 0,
        'comments': [],
        'profilePicture': _profilePicture,
        'image': null,
        'source': 'day_reflect',
      });
      if (mounted) context.go(AppRoutes.community);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to share to HUB.')));
      }
    } finally {
      if (mounted) setState(() => _isSharingPost = false);
    }
  }

  Future<void> _applyAiEdit() async {
    final instruction = _aiInstructionController.text.trim();
    if (instruction.isEmpty || _sharePreviewText.trim().isEmpty) return;
    setState(() => _isAiEditing = true);
    try {
      final edited = await chatService.editTextWithAI(_sharePreviewText, instruction);
      setState(() {
        _sharePreviewText = edited;
        _showAiEditModal = false;
        _aiInstructionController.clear();
      });
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _isAiEditing = false);
    }
  }

  Future<void> _shareNative(String text) async {
    await Share.share(text, subject: 'My day reflection');
    _recordShare('native');
  }

  void _recordShare(String platform) {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;
    firestoreService.saveSocialShare(user.uid, {
      'platform': platform,
      'reflectionDate': getDateId(),
      'reflectionSnippet': _sharePreviewText.trim().substring(0, _sharePreviewText.length.clamp(0, 200)),
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_initialText.isEmpty) return const SizedBox.shrink();
    final isDarkMode = context.watch<ThemeNotifier>().isDarkMode;
    final extra = GoRouterState.of(context).extra;
    final fromReflections = extra is Map && extra['reflectionToShare'] != null;

    return Scaffold(
      backgroundColor: isDarkMode ? const Color(0xFF131314) : HubColors.lightScaffold,
      body: Stack(
        children: [
          SafeArea(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
            Row(
              children: [
                IconButton(
                  onPressed: () => context.go(fromReflections ? AppRoutes.podReflections : AppRoutes.dashboard),
                  icon: const Icon(Icons.arrow_back),
                  color: isDarkMode ? Colors.white54 : Colors.black54,
                ),
                Expanded(
                  child: Text(
                    _shareHeaderText(),
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w500, color: isDarkMode ? HubColors.mint : HubColors.sage),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            RepaintBoundary(
              key: _cardKey,
              child: Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: _shareAs == 'image'
                      ? (_imageTheme == 'dark' ? const Color(0xFF1A1A1A) : Colors.white)
                      : (isDarkMode ? const Color(0xFF262626) : Colors.white),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: isDarkMode ? Colors.white10 : Colors.black12),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        CircleAvatar(
                          radius: 20,
                          backgroundImage: _profilePicture != null ? NetworkImage(_profilePicture!) : null,
                          child: _profilePicture == null ? const Icon(Icons.person, size: 20) : null,
                        ),
                        const SizedBox(width: 12),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(_displayName, style: const TextStyle(fontWeight: FontWeight.w600)),
                            Text(_handleFromName(_displayName), style: const TextStyle(color: Colors.grey, fontSize: 13)),
                          ],
                        ),
                        const Spacer(),
                        IconButton(onPressed: () => setState(() => _shareEditMode = true), icon: const Icon(Icons.edit, size: 18)),
                        IconButton(onPressed: () => setState(() => _showAiEditModal = true), icon: Icon(Icons.auto_awesome, size: 18, color: isDarkMode ? HubColors.mint : HubColors.sage)),
                      ],
                    ),
                    const SizedBox(height: 16),
                    if (_shareEditMode)
                      TextField(
                        controller: TextEditingController(text: _sharePreviewText),
                        onChanged: (v) => _sharePreviewText = v,
                        maxLines: 8,
                        decoration: const InputDecoration(border: OutlineInputBorder()),
                        onSubmitted: (_) => setState(() => _shareEditMode = false),
                      )
                    else
                      Text(_sharePreviewText, style: const TextStyle(fontSize: 15, height: 1.5)),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 20),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'text', label: Text('Text'), icon: Icon(Icons.article_outlined)),
                ButtonSegment(value: 'image', label: Text('Image'), icon: Icon(Icons.image_outlined)),
              ],
              selected: {_shareAs},
              onSelectionChanged: (s) => setState(() => _shareAs = s.first),
            ),
            const SizedBox(height: 16),
            if (_shareAs == 'text')
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _isSharingPost ? null : _shareToHub,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: isDarkMode ? HubColors.mint : HubColors.sage,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  ),
                  child: Text(_isSharingPost ? 'Sharing…' : 'Share to HUB'),
                ),
              ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(child: OutlinedButton(onPressed: () => launchUrl(Uri.parse('https://twitter.com/intent/tweet?text=${Uri.encodeComponent(_sharePreviewText)}'), mode: LaunchMode.externalApplication), child: const Text('X'))),
                const SizedBox(width: 8),
                Expanded(child: OutlinedButton(onPressed: () => launchUrl(Uri.parse('https://wa.me/?text=${Uri.encodeComponent(_sharePreviewText)}'), mode: LaunchMode.externalApplication), child: const Text('WhatsApp'))),
                const SizedBox(width: 8),
                Expanded(child: OutlinedButton(onPressed: () => _shareNative(_sharePreviewText), child: const Text('More'))),
              ],
            ),
              ],
            ),
          ),
          if (_showAiEditModal)
            SafeArea(
              child: GestureDetector(
                onTap: _isAiEditing ? null : () => setState(() => _showAiEditModal = false),
                child: ColoredBox(
                  color: Colors.black54,
                  child: Center(
                    child: GestureDetector(
                      onTap: () {},
                      child: Container(
                        margin: const EdgeInsets.all(24),
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          color: isDarkMode ? const Color(0xFF262626) : Colors.white,
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text('Edit with AI', style: TextStyle(fontWeight: FontWeight.w600, color: isDarkMode ? Colors.white : Colors.black87)),
                            const SizedBox(height: 12),
                            TextField(
                              controller: _aiInstructionController,
                              enabled: !_isAiEditing,
                              decoration: const InputDecoration(hintText: 'e.g. make it shorter and more positive'),
                            ),
                            const SizedBox(height: 12),
                            Row(
                              children: [
                                Expanded(
                                  child: OutlinedButton(
                                    onPressed: _isAiEditing ? null : () => setState(() => _showAiEditModal = false),
                                    child: const Text('Cancel'),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: FilledButton(
                                    onPressed: _isAiEditing ? null : _applyAiEdit,
                                    child: Text(_isAiEditing ? 'Applying…' : 'Apply'),
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    _aiInstructionController.dispose();
    super.dispose();
  }
}

// ignore: unused_element
Future<Uint8List?> _captureWidget(GlobalKey key) async {
  final boundary = key.currentContext?.findRenderObject() as RenderRepaintBoundary?;
  if (boundary == null) return null;
  final image = await boundary.toImage(pixelRatio: 2);
  final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
  return bytes?.buffer.asUint8List();
}
