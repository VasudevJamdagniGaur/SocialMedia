import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../contexts/theme_context.dart';
import '../models/chat_message.dart';
import '../router/app_router.dart';
import '../services/chat_service.dart';
import '../services/emotional_analysis_service.dart';
import '../services/firestore_service.dart';
import '../services/reflection_service.dart';
import '../utils/date_utils.dart';
import '../utils/hub_colors.dart';

class ChatPage extends StatefulWidget {
  const ChatPage({super.key});

  @override
  State<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends State<ChatPage> {
  final _inputController = TextEditingController();
  final _scrollController = ScrollController();
  final _inputFocus = FocusNode();

  List<ChatMessage> _messages = [];
  bool _isLoading = false;
  XFile? _selectedImage;
  Uint8List? _imagePreviewBytes;
  String? _apiProvider;
  DateTime _selectedDate = DateTime.now();
  bool _isWhisperMode = false;
  bool _isFreshSession = false;
  late String _selectedDateId;
  DateTime? _lastLoadingStarted;
  Timer? _loadingSafetyTimer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _initFromRoute());
  }

  Future<void> _initFromRoute() async {
    final extra = GoRouterState.of(context).extra;
    if (extra is Map) {
      if (extra['selectedDate'] != null) {
        _selectedDate = extra['selectedDate'] is DateTime
            ? extra['selectedDate'] as DateTime
            : DateTime.tryParse('${extra['selectedDate']}') ?? DateTime.now();
      }
      _isWhisperMode = extra['isWhisperMode'] == true;
      _isFreshSession = extra['isFreshSession'] == true;
    }
    _selectedDateId = getDateId(_selectedDate);
    await ChatService.instance.loadSavedProvider();
    _apiProvider = ChatService.instance.apiProvider;
    await _loadMessages();
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _loadingSafetyTimer?.cancel();
    _inputController.dispose();
    _scrollController.dispose();
    _inputFocus.dispose();
    super.dispose();
  }

  Map<String, dynamic> _toFirestoreMap(ChatMessage m) => {
        'sender': m.sender,
        'text': m.text,
        'isWhisperSession': m.isWhisperSession,
        if (m.image != null) 'image': m.image,
      };

  ChatMessage _fromFirestoreMap(Map<String, dynamic> m) => ChatMessage(
        id: m['id'],
        text: m['text'] as String? ?? '',
        sender: m['sender'] as String? ?? 'ai',
        timestamp: m['timestamp'] is DateTime ? m['timestamp'] as DateTime : DateTime.now(),
        isWhisperSession: m['isWhisperSession'] as bool? ?? false,
        image: m['image'] as String?,
      );

  Future<void> _saveMessagesLocal() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      'chatMessages_$_selectedDateId',
      jsonEncode(_messages.map((m) => m.toJson()).toList()),
    );
  }

  Future<void> _loadMessages() async {
    final user = FirebaseAuth.instance.currentUser;
    if (_isFreshSession) {
      _setWelcomeMessage();
      return;
    }
    if (user != null) {
      final result = await FirestoreService.instance.getChatMessagesNew(user.uid, _selectedDateId);
      if (result['success'] == true) {
        final raw = (result['messages'] as List?)?.cast<Map<String, dynamic>>() ?? [];
        if (raw.isNotEmpty) {
          var merged = raw.map(_fromFirestoreMap).toList();
          final prefs = await SharedPreferences.getInstance();
          final stored = prefs.getString('chatMessages_$_selectedDateId');
          if (stored != null) {
            try {
              final local = (jsonDecode(stored) as List)
                  .map((e) => ChatMessage.fromJson(Map<String, dynamic>.from(e as Map)))
                  .toList();
              merged = merged.map((msg) {
                if (msg.image != null) return msg;
                final byId = local.where((l) => l.id == msg.id && l.image != null).cast<ChatMessage?>().firstOrNull;
                if (byId != null) return msg.copyWith(image: byId.image);
                final byContent =
                    local.where((l) => l.sender == msg.sender && l.text == msg.text && l.image != null).cast<ChatMessage?>().firstOrNull;
                if (byContent != null) return msg.copyWith(image: byContent.image);
                return msg;
              }).toList();
            } catch (_) {}
          }
          setState(() => _messages = merged);
          await _saveMessagesLocal();
          unawaited(_checkAndGenerateEmotionalAnalysis(user.uid, merged));
          _scrollToBottom();
          return;
        }
      }
    }
    final prefs = await SharedPreferences.getInstance();
    final stored = prefs.getString('chatMessages_$_selectedDateId');
    if (stored != null) {
      try {
        final parsed =
            (jsonDecode(stored) as List).map((e) => ChatMessage.fromJson(Map<String, dynamic>.from(e as Map))).toList();
        setState(() => _messages = parsed);
        _scrollToBottom();
        return;
      } catch (_) {}
    }
    _setWelcomeMessage();
  }

  void _setWelcomeMessage() {
    final welcomeText = _isWhisperMode
        ? 'Welcome to your Whisper Session. This is a private, fresh space just for you. What would you like to share in confidence today?'
        : "Hi, I'm Detea. How was your day?";
    setState(() {
      _messages = [
        ChatMessage(id: 'welcome', text: welcomeText, sender: 'ai', timestamp: DateTime.now()),
      ];
    });
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
      );
    });
  }

  void _startLoadingSafety() {
    _loadingSafetyTimer?.cancel();
    _loadingSafetyTimer = Timer(const Duration(seconds: 30), () {
      if (mounted && _isLoading) setState(() => _isLoading = false);
    });
  }

  void _stopLoadingSafety() {
    _loadingSafetyTimer?.cancel();
    _loadingSafetyTimer = null;
  }

  Future<void> _pickImage() async {
    final picker = ImagePicker();
    final file = await picker.pickImage(source: ImageSource.gallery, maxWidth: 1920, imageQuality: 85);
    if (file == null) return;
    final bytes = await file.readAsBytes();
    if (bytes.length > 10 * 1024 * 1024) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Image must be under 10MB')));
      }
      return;
    }
    setState(() {
      _selectedImage = file;
      _imagePreviewBytes = bytes;
    });
  }

  Future<void> _handleSendMessage() async {
    if (_isLoading) {
      if (_lastLoadingStarted != null && DateTime.now().difference(_lastLoadingStarted!) > const Duration(seconds: 10)) {
        setState(() => _isLoading = false);
        _stopLoadingSafety();
      } else {
        return;
      }
    }
    if (_inputController.text.trim().isEmpty && _selectedImage == null) return;

    final userMessageText = _inputController.text.trim().isEmpty ? 'Check this out!' : _inputController.text.trim();
    if (RegExp(r'^(day reflect|/day reflect|dayreflect)$', caseSensitive: false).hasMatch(userMessageText)) {
      await _handleDayReflect(userMessageText);
      return;
    }

    final imagePreviewDataUrl =
        _imagePreviewBytes != null ? 'data:image/jpeg;base64,${base64Encode(_imagePreviewBytes!)}' : null;
    final userMessage = ChatMessage(
      id: DateTime.now().millisecondsSinceEpoch,
      text: userMessageText,
      sender: 'user',
      timestamp: DateTime.now(),
      isWhisperSession: _isWhisperMode,
      image: imagePreviewDataUrl,
    );

    final isInstagramReel = RegExp(r'instagram\.com/(reel|p|tv)/', caseSensitive: false).hasMatch(userMessageText);
    var working = [..._messages, userMessage];
    if (isInstagramReel) {
      working.add(ChatMessage(
        id: 'instagram-loading-${DateTime.now().millisecondsSinceEpoch}',
        text: '👀 Detea is enjoying the reel',
        sender: 'ai',
        timestamp: DateTime.now(),
        isProcessingReel: true,
        isWhisperSession: _isWhisperMode,
      ));
    }

    setState(() {
      _messages = working;
      _inputController.clear();
      _isLoading = true;
      _lastLoadingStarted = DateTime.now();
    });
    _startLoadingSafety();
    _scrollToBottom();

    final imageToSend = _selectedImage;
    final imageBytes = _imagePreviewBytes;
    setState(() {
      _selectedImage = null;
      _imagePreviewBytes = null;
    });

    final user = FirebaseAuth.instance.currentUser;
    if (user != null) {
      final saveResult =
          await FirestoreService.instance.saveChatMessageNew(user.uid, _selectedDateId, _toFirestoreMap(userMessage));
      if (saveResult['success'] == true && saveResult['messageId'] != null) {
        userMessage.id = saveResult['messageId'];
      }
    }

    try {
      working = working.where((m) => !m.isProcessingReel).toList();
      final aiMessage = ChatMessage(
        id: DateTime.now().millisecondsSinceEpoch + 1,
        text: '',
        sender: 'ai',
        timestamp: DateTime.now(),
        isStreaming: true,
        isWhisperSession: _isWhisperMode,
      );
      working = [...working, aiMessage];
      setState(() => _messages = working);

      final history = _messages.where((m) => m.id != aiMessage.id && !m.isProcessingReel).toList();
      final aiResponse = await ChatService.instance.sendMessage(
        userMessageText,
        conversationHistory: history,
        imageFile: imageToSend,
        imageBytes: imageBytes,
        imageMimeType: imageToSend?.mimeType ?? 'image/jpeg',
      );

      var fullResponse = '';
      for (var i = 0; i < aiResponse.length; i += 2) {
        fullResponse += aiResponse.substring(i, (i + 2).clamp(0, aiResponse.length));
        if (!mounted) break;
        setState(() {
          final idx = _messages.indexWhere((m) => m.id == aiMessage.id);
          if (idx >= 0) _messages[idx] = _messages[idx].copyWith(text: fullResponse);
        });
        await Future.delayed(Duration(milliseconds: 10 + (i % 20)));
      }

      final finalMessages = _messages.map((m) {
        if (m.id == aiMessage.id) return m.copyWith(text: fullResponse, isStreaming: false);
        return m;
      }).toList();

      setState(() {
        _messages = finalMessages;
        _isLoading = false;
        _lastLoadingStarted = null;
      });
      _stopLoadingSafety();
      await _saveMessagesLocal();
      _scrollToBottom();
      _inputFocus.requestFocus();

      if (user != null) {
        final lastAi = finalMessages.lastWhere((m) => m.sender == 'ai', orElse: () => aiMessage);
        unawaited(FirestoreService.instance.saveChatMessageNew(user.uid, _selectedDateId, _toFirestoreMap(lastAi)));
      }

      if (!_isWhisperMode) {
        unawaited(_generateReflectionBackground(finalMessages));
        unawaited(_generateEmotionalBackground(finalMessages));
      }
    } catch (e) {
      final errMsg = ChatMessage(
        id: DateTime.now().millisecondsSinceEpoch + 2,
        text: "I'm sorry, I'm having trouble responding right now. Please try again in a moment.",
        sender: 'ai',
        timestamp: DateTime.now(),
        isWhisperSession: _isWhisperMode,
      );
      setState(() {
        _messages = [..._messages.where((m) => !m.isStreaming), errMsg];
        _isLoading = false;
      });
      _stopLoadingSafety();
      await _saveMessagesLocal();
    }
  }

  Future<void> _handleDayReflect(String commandText) async {
    final userMessage = ChatMessage(
      id: DateTime.now().millisecondsSinceEpoch,
      text: commandText,
      sender: 'user',
      timestamp: DateTime.now(),
      isWhisperSession: _isWhisperMode,
    );
    setState(() {
      _messages = [..._messages, userMessage];
      _inputController.clear();
      _isLoading = true;
    });
    _startLoadingSafety();
    try {
      final story = await ReflectionService.instance
          .generateNarrativeDiaryStory(_messages.where((m) => m.id != userMessage.id).toList());
      final aiMessage = ChatMessage(
        id: DateTime.now().millisecondsSinceEpoch + 1,
        text: story,
        sender: 'ai',
        timestamp: DateTime.now(),
        isWhisperSession: _isWhisperMode,
      );
      setState(() {
        _messages = [..._messages, aiMessage];
        _isLoading = false;
      });
      _stopLoadingSafety();
      await _saveMessagesLocal();
      final user = FirebaseAuth.instance.currentUser;
      if (user != null) {
        await FirestoreService.instance.saveChatMessageNew(user.uid, _selectedDateId, _toFirestoreMap(aiMessage));
      }
    } catch (_) {
      setState(() {
        _messages = [
          ..._messages,
          ChatMessage(
            id: DateTime.now().millisecondsSinceEpoch + 1,
            text: "I'm sorry, I'm having trouble generating your day reflection right now. Please try again in a moment.",
            sender: 'ai',
            timestamp: DateTime.now(),
            isWhisperSession: _isWhisperMode,
          ),
        ];
        _isLoading = false;
      });
      _stopLoadingSafety();
    }
  }

  Future<void> _generateReflectionBackground(List<ChatMessage> msgs) async {
    try {
      final reflection = await ReflectionService.instance.generateReflection(msgs);
      final user = FirebaseAuth.instance.currentUser;
      if (user != null) {
        await FirestoreService.instance.saveReflectionNew(user.uid, _selectedDateId, {
          'summary': reflection,
          'mood': 'neutral',
          'score': 50,
          'insights': [],
        });
      } else {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('reflection_$_selectedDateId', reflection);
      }
    } catch (_) {}
  }

  Future<void> _generateEmotionalBackground(List<ChatMessage> msgs) async {
    try {
      final filtered = msgs.where((m) => !m.isWhisperSession).toList();
      final scores = await EmotionalAnalysisService.instance.analyzeEmotionalScores(filtered);
      final user = FirebaseAuth.instance.currentUser;
      if (user != null) {
        await FirestoreService.instance.saveMoodChartNew(user.uid, _selectedDateId, scores);
        final total = scores.values.reduce((a, b) => a + b);
        if (total > 0) {
          var positive = ((scores['happiness']! + scores['energy']!) / total) * 100;
          var negative = ((scores['stress']! + scores['anxiety']!) / total) * 100;
          var neutral = 100 - positive - negative;
          await FirestoreService.instance.saveEmotionalBalanceNew(user.uid, _selectedDateId, {
            'positive': positive.round().clamp(0, 100),
            'negative': negative.round().clamp(0, 100),
            'neutral': neutral.round().clamp(0, 100),
          });
        }
      }
    } catch (_) {}
  }

  Future<void> _checkAndGenerateEmotionalAnalysis(String uid, List<ChatMessage> messages) async {
    final real = messages.where((m) => m.id != 'welcome' && m.text.isNotEmpty).toList();
    if (real.length < 2) return;
    final moodRef = await FirestoreService.instance.getMoodChartDataNew(uid, 1);
    final moodData = (moodRef['moodData'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    var shouldGenerate = moodData.isEmpty;
    if (!shouldGenerate && moodData.isNotEmpty) {
      final today = moodData.last;
      final total = (today['happiness'] as num? ?? 0) +
          (today['energy'] as num? ?? 0) +
          (today['anxiety'] as num? ?? 0) +
          (today['stress'] as num? ?? 0);
      final isDefault =
          today['happiness'] == 50 && today['energy'] == 50 && today['anxiety'] == 25 && today['stress'] == 25;
      shouldGenerate = total == 0 || total == 100 || isDefault || today['date'] != _selectedDateId;
    }
    if (shouldGenerate) await _generateEmotionalBackground(real);
  }

  Future<void> _handleBack() async {
    if (_isWhisperMode) {
      final actual = _messages.where((m) => m.id != 'welcome' && m.text.trim().isNotEmpty).toList();
      if (actual.isNotEmpty) {
        await _showDeleteDialog();
        return;
      }
    } else {
      final real = _messages.where((m) => m.id != 'welcome' && m.text.trim().isNotEmpty && !m.isWhisperSession).toList();
      if (real.length >= 2) {
        unawaited(_generateReflectionBackground(_messages));
      }
    }
    if (mounted) context.go(AppRoutes.dashboard);
  }

  Future<void> _confirmDeleteWhisper() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user != null) {
      final prefs = await SharedPreferences.getInstance();
      final key = 'chatMessages_$_selectedDateId';
      final stored = prefs.getString(key);
      if (stored != null) {
        try {
          final all =
              (jsonDecode(stored) as List).map((e) => ChatMessage.fromJson(Map<String, dynamic>.from(e as Map))).toList();
          final regular = all.where((m) => !m.isWhisperSession).toList();
          if (regular.isEmpty) {
            await prefs.remove(key);
          } else {
            await prefs.setString(key, jsonEncode(regular.map((m) => m.toJson()).toList()));
          }
        } catch (_) {}
      }
      await FirestoreService.instance.deleteWhisperSessionMessages(user.uid, _selectedDateId);
    }
    if (mounted) context.go(AppRoutes.dashboard);
  }

  Future<void> _cycleProvider() async {
    final next = await ChatService.instance.cycleProvider();
    setState(() => _apiProvider = next);
  }

  String _formatTime(DateTime date) {
    final h = date.hour > 12 ? date.hour - 12 : (date.hour == 0 ? 12 : date.hour);
    final m = date.minute.toString().padLeft(2, '0');
    final ampm = date.hour >= 12 ? 'PM' : 'AM';
    return '$h:$m $ampm';
  }

  String _dateLabel(DateTime d) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final msgDay = DateTime(d.year, d.month, d.day);
    final diff = today.difference(msgDay).inDays;
    final time = _formatTime(d);
    if (diff == 0) return 'TODAY $time';
    if (diff == 1) return 'YESTERDAY $time';
    return '${d.month}/${d.day} $time';
  }

  String _providerAsset() {
    switch (_apiProvider) {
      case 'gemini':
        return 'assets/images/gemini-icon.png';
      case 'grok':
        return 'assets/images/grok-icon.png';
      default:
        return 'assets/images/openai-icon.png';
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDarkMode = context.watch<ThemeNotifier>().isDarkMode;
    final hasComposerContent = _inputController.text.trim().isNotEmpty || _selectedImage != null;

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _handleBack();
      },
      child: Scaffold(
        backgroundColor: isDarkMode ? HubColors.bg : HubColors.lightScaffold,
        body: SafeArea(
          child: Column(
            children: [
              _buildHeader(isDarkMode),
              Expanded(child: _buildMessagesList(isDarkMode)),
              _buildInputArea(isDarkMode, hasComposerContent),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader(bool isDarkMode) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: isDarkMode ? const Color(0xE6131314) : const Color(0xE6FAFAF8),
        border: Border(bottom: BorderSide(color: isDarkMode ? Colors.white10 : Colors.black12)),
      ),
      child: Row(
        children: [
          _circleBtn(isDarkMode, onTap: _handleBack, child: const Icon(Icons.arrow_back, color: HubColors.accent)),
          const SizedBox(width: 12),
          ClipOval(child: Image.asset('assets/images/DEITECIrc-192.webp', width: 40, height: 40, fit: BoxFit.cover)),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              _isWhisperMode ? 'Whisper Session' : 'Detea',
              style: TextStyle(color: isDarkMode ? Colors.white : Colors.black87, fontSize: 18, fontWeight: FontWeight.w600),
            ),
          ),
          _circleBtn(
            isDarkMode,
            onTap: _cycleProvider,
            child: Image.asset(
              _providerAsset(),
              width: 24,
              height: 24,
              color: (_apiProvider == 'openai' || _apiProvider == 'grok') ? Colors.white : null,
              colorBlendMode: BlendMode.srcIn,
            ),
          ),
        ],
      ),
    );
  }

  Widget _circleBtn(bool isDarkMode, {required VoidCallback onTap, required Widget child}) {
    return Material(
      color: isDarkMode ? const Color(0xFF262626) : Colors.white,
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: SizedBox(width: 40, height: 40, child: Center(child: child)),
      ),
    );
  }

  Widget _buildMessagesList(bool isDarkMode) {
    String? lastDateKey;
    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.all(16),
      itemCount: _messages.length,
      itemBuilder: (_, i) {
        final message = _messages[i];
        final dateKey = '${message.timestamp.year}-${message.timestamp.month}-${message.timestamp.day}';
        final showDate = dateKey != lastDateKey;
        if (showDate) lastDateKey = dateKey;
        final isUser = message.sender == 'user';

        return Column(
          children: [
            if (showDate)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  _dateLabel(message.timestamp),
                  style: TextStyle(
                    color: isDarkMode ? HubColors.chatDateSep : Colors.black54,
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            Align(
              alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
              child: Container(
                constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.85),
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: isDarkMode ? (isUser ? HubColors.chatUserBubble : HubColors.chatAiBubble) : (isUser ? const Color(0xFF363636) : Colors.white),
                  borderRadius: BorderRadius.only(
                    topLeft: const Radius.circular(16),
                    topRight: const Radius.circular(16),
                    bottomLeft: Radius.circular(isUser ? 16 : 4),
                    bottomRight: Radius.circular(isUser ? 4 : 16),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (message.image != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: Image.memory(
                            base64Decode(message.image!.contains(',') ? message.image!.split(',').last : message.image!),
                            height: 200,
                            fit: BoxFit.cover,
                            errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                          ),
                        ),
                      ),
                    if (message.isProcessingReel)
                      Row(
                        children: [
                          Icon(Icons.visibility, color: Colors.amber.shade400, size: 20),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              message.text,
                              style: TextStyle(color: isDarkMode ? Colors.white : const Color(0xFF1A1A1A), fontSize: 13),
                            ),
                          ),
                        ],
                      )
                    else
                      Text.rich(
                        TextSpan(
                          text: message.text,
                          style: TextStyle(
                            color: isDarkMode ? Colors.white : (isUser ? Colors.white : const Color(0xFF1A1A1A)),
                            fontSize: isUser ? 14 : 13,
                            height: 1.4,
                          ),
                          children: message.isStreaming
                              ? [
                                  WidgetSpan(
                                    child: Container(width: 8, height: 16, margin: const EdgeInsets.only(left: 4), color: Colors.white54),
                                  ),
                                ]
                              : [],
                        ),
                      ),
                    const SizedBox(height: 4),
                    Text(
                      _formatTime(message.timestamp),
                      style: TextStyle(
                        color: (isDarkMode ? Colors.white : Colors.black87).withValues(alpha: 0.75),
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildInputArea(bool isDarkMode, bool hasComposerContent) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isDarkMode ? HubColors.bg : Colors.white.withValues(alpha: 0.9),
        border: Border(top: BorderSide(color: Colors.grey.withValues(alpha: 0.3))),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_imagePreviewBytes != null)
            Stack(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: Image.memory(_imagePreviewBytes!, width: 200, height: 200, fit: BoxFit.cover),
                ),
                Positioned(
                  top: 4,
                  right: 4,
                  child: GestureDetector(
                    onTap: () => setState(() {
                      _selectedImage = null;
                      _imagePreviewBytes = null;
                    }),
                    child: Container(
                      decoration: const BoxDecoration(color: Colors.red, shape: BoxShape.circle),
                      padding: const EdgeInsets.all(4),
                      child: const Icon(Icons.close, color: Colors.white, size: 16),
                    ),
                  ),
                ),
              ],
            ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              _circleBtn(
                isDarkMode,
                onTap: _isLoading ? () {} : _pickImage,
                child: Icon(Icons.add, color: _selectedImage != null ? Colors.greenAccent : HubColors.accent),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  controller: _inputController,
                  focusNode: _inputFocus,
                  enabled: !_isLoading,
                  maxLines: 4,
                  minLines: 1,
                  onChanged: (_) => setState(() {}),
                  onSubmitted: (_) => _handleSendMessage(),
                  style: TextStyle(color: isDarkMode ? Colors.white : const Color(0xFF1A1A1A)),
                  decoration: InputDecoration(
                    hintText: 'Message...',
                    filled: true,
                    fillColor: isDarkMode ? const Color(0xFF3A3A3A) : Colors.white,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  ),
                ),
              ),
              if (hasComposerContent) ...[
                const SizedBox(width: 8),
                _circleBtn(isDarkMode, onTap: _isLoading ? () {} : _handleSendMessage, child: const Icon(Icons.send, color: HubColors.accent)),
              ],
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _showDeleteDialog() async {
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF262626),
        title: const Text('Leaving Whisper Session', style: TextStyle(color: Colors.white)),
        content: const Text(
          'All chat messages in this session will be permanently deleted and cannot be recovered.\n\nAre you sure you want to leave and delete all messages?',
          style: TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              _confirmDeleteWhisper();
            },
            child: const Text('Delete & Leave', style: TextStyle(color: Colors.redAccent)),
          ),
        ],
      ),
    );
  }
}
