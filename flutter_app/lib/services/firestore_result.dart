import '../models/chat_message.dart';

/// Marker for calendar days with chat activity.
class CalendarDayMarker {
  const CalendarDayMarker({required this.date, this.id});
  final String date;
  final String? id;

  factory CalendarDayMarker.fromMap(Map<String, dynamic> m) => CalendarDayMarker(
        date: m['date'] as String? ?? m['id'] as String? ?? '',
        id: m['id'] as String?,
      );
}

class ReflectionResult {
  ReflectionResult({required this.success, this.reflection, this.error, this.fullData});
  final bool success;
  final String? reflection;
  final String? error;
  final Map<String, dynamic>? fullData;
}

class CrewChatMessage {
  CrewChatMessage({required this.senderUid, required this.sender, required this.message});
  final String senderUid;
  final String sender;
  final String message;
}

/// Parse Firestore service Map responses (mirrors JS `{ success, ... }` shapes).
extension FirestoreMapResult on Map<String, dynamic> {
  bool get success => this['success'] == true;
  String? get error => this['error'] as String?;
  Map<String, dynamic>? get data => this['data'] as Map<String, dynamic>?;
  String? get reflection => this['reflection'] as String?;
  String? get messageId => this['messageId'] as String?;
  int? get deletedCount => (this['deletedCount'] as num?)?.toInt();

  List<String> get followingIds =>
      (this['followingIds'] as List?)?.map((e) => '$e').toList() ?? [];

  List<CalendarDayMarker> get chatDays => (this['chatDays'] as List?)
          ?.map((e) => CalendarDayMarker.fromMap(Map<String, dynamic>.from(e as Map)))
          .toList() ??
      [];

  List<ChatMessage> get messages {
    final raw = this['messages'] as List?;
    if (raw == null) return [];
    return raw.map((e) {
      final m = Map<String, dynamic>.from(e as Map);
      return ChatMessage(
        id: m['id'],
        sender: m['sender'] as String? ?? 'ai',
        text: m['text'] as String? ?? '',
        timestamp: m['timestamp'] is DateTime
            ? m['timestamp'] as DateTime
            : DateTime.tryParse('${m['timestamp']}') ?? DateTime.now(),
        isWhisperSession: m['isWhisperSession'] as bool? ?? false,
        image: m['image'] as String?,
      );
    }).toList();
  }

  List<Map<String, dynamic>> get moodData =>
      (this['moodData'] as List?)?.map((e) => Map<String, dynamic>.from(e as Map)).toList() ?? [];

  ReflectionResult toReflectionResult() => ReflectionResult(
        success: success,
        reflection: reflection,
        error: error,
        fullData: this['fullData'] as Map<String, dynamic>?,
      );
}

/// Convert [ChatMessage] to Firestore document payload.
Map<String, dynamic> chatMessageToFirestore(ChatMessage m) => {
      'sender': m.sender,
      'text': m.text,
      'isWhisperSession': m.isWhisperSession,
      if (m.image != null) 'image': m.image,
    };
