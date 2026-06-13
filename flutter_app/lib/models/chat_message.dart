class ChatMessage {
  ChatMessage({
    required this.id,
    required this.text,
    required this.sender,
    required this.timestamp,
    this.isWhisperSession = false,
    this.image,
    this.isStreaming = false,
    this.isProcessingReel = false,
    this.systemKind,
  });

  dynamic id;
  String text;
  final String sender; // 'user' | 'ai' | 'system'
  DateTime timestamp;
  bool isWhisperSession;
  String? image;
  bool isStreaming;
  bool isProcessingReel;
  /// Inline banner, e.g. whisper_on | whisper_off
  String? systemKind;

  bool get isSystemNotification => sender == 'system';

  Map<String, dynamic> toJson() => {
        'id': id,
        'text': text,
        'sender': sender,
        'timestamp': timestamp.toIso8601String(),
        'isWhisperSession': isWhisperSession,
        if (image != null) 'image': image,
        if (isProcessingReel) 'isProcessingReel': isProcessingReel,
        if (systemKind != null) 'systemKind': systemKind,
      };

  factory ChatMessage.fromJson(Map<String, dynamic> json) => ChatMessage(
        id: json['id'],
        text: json['text'] as String? ?? '',
        sender: json['sender'] as String? ?? 'ai',
        timestamp: DateTime.tryParse(json['timestamp'] as String? ?? '') ?? DateTime.now(),
        isWhisperSession: json['isWhisperSession'] as bool? ?? false,
        image: json['image'] as String?,
        isProcessingReel: json['isProcessingReel'] as bool? ?? false,
        systemKind: json['systemKind'] as String?,
      );

  ChatMessage copyWith({
    dynamic id,
    String? text,
    String? sender,
    DateTime? timestamp,
    bool? isWhisperSession,
    String? image,
    bool? isStreaming,
    bool? isProcessingReel,
    String? systemKind,
  }) =>
      ChatMessage(
        id: id ?? this.id,
        text: text ?? this.text,
        sender: sender ?? this.sender,
        timestamp: timestamp ?? this.timestamp,
        isWhisperSession: isWhisperSession ?? this.isWhisperSession,
        image: image ?? this.image,
        isStreaming: isStreaming ?? this.isStreaming,
        isProcessingReel: isProcessingReel ?? this.isProcessingReel,
        systemKind: systemKind ?? this.systemKind,
      );
}
