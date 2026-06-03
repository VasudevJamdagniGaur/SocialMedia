import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

const _storageKey = 'deite_tea_watchlist_v1';

class TeaWatchlistItem {
  TeaWatchlistItem({
    required this.id,
    required this.title,
    required this.url,
    this.postUrl = '',
    this.thumbnail = '',
    this.author = '',
    this.savedAt = '',
    this.source = 'tea',
  });

  final String id;
  final String title;
  final String url;
  final String postUrl;
  final String thumbnail;
  final String author;
  final String savedAt;
  final String source;

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'url': url,
        'postUrl': postUrl,
        'thumbnail': thumbnail,
        'author': author,
        'savedAt': savedAt,
        'source': source,
      };

  factory TeaWatchlistItem.fromJson(Map<String, dynamic> json) => TeaWatchlistItem(
        id: '${json['id'] ?? ''}',
        title: json['title'] as String? ?? '',
        url: json['url'] as String? ?? '',
        postUrl: json['postUrl'] as String? ?? '',
        thumbnail: json['thumbnail'] as String? ?? '',
        author: json['author'] as String? ?? '',
        savedAt: json['savedAt'] as String? ?? '',
        source: json['source'] as String? ?? 'tea',
      );
}

Future<List<TeaWatchlistItem>> getTeaWatchlist() async {
  final prefs = await SharedPreferences.getInstance();
  final raw = prefs.getString(_storageKey);
  if (raw == null) return [];
  try {
    final arr = jsonDecode(raw) as List<dynamic>;
    return arr
        .whereType<Map<String, dynamic>>()
        .map(TeaWatchlistItem.fromJson)
        .toList();
  } catch (_) {
    return [];
  }
}

Future<void> setTeaWatchlist(List<TeaWatchlistItem> items) async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.setString(_storageKey, jsonEncode(items.map((e) => e.toJson()).toList()));
}

TeaWatchlistItem normalizeTeaItemForWatchlist(Map<String, dynamic> item) {
  return TeaWatchlistItem(
    id: '${item['id'] ?? ''}',
    title: item['title'] as String? ?? '',
    url: item['url'] as String? ?? '',
    postUrl: item['postUrl'] as String? ?? '',
    thumbnail: item['thumbnail'] as String? ?? '',
    author: item['author'] as String? ?? '',
    savedAt: DateTime.now().toUtc().toIso8601String(),
    source: 'tea',
  );
}

Future<List<TeaWatchlistItem>> toggleTeaWatchlistItem(Map<String, dynamic> item) async {
  final id = '${item['id'] ?? ''}';
  if (id.isEmpty) return getTeaWatchlist();
  final list = await getTeaWatchlist();
  final idx = list.indexWhere((x) => x.id == id);
  if (idx >= 0) {
    list.removeAt(idx);
  } else {
    final row = normalizeTeaItemForWatchlist(item);
    if (row.url.isEmpty) return list;
    list.insert(0, row);
  }
  await setTeaWatchlist(list);
  return list;
}

Future<List<TeaWatchlistItem>> removeTeaWatchlistById(String postId) async {
  final list = (await getTeaWatchlist()).where((x) => x.id != postId).toList();
  await setTeaWatchlist(list);
  return list;
}

Future<bool> isTeaPostWatchlisted(String postId) async {
  final list = await getTeaWatchlist();
  return list.any((x) => x.id == postId);
}

bool isDirectImageUrl(String? postUrl) {
  if (postUrl == null || postUrl.trim().isEmpty) return false;
  final path = postUrl.trim().split('?').first.split('#').first;
  return RegExp(r'\.(jpe?g|png|gif|webp)$', caseSensitive: false).hasMatch(path);
}

String? watchlistHeroUrl(TeaWatchlistItem row) {
  final thumb = row.thumbnail.trim();
  if (isDirectImageUrl(row.postUrl)) return row.postUrl.trim();
  if (thumb.startsWith('http')) return thumb;
  return null;
}
