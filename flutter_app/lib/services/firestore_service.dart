import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/foundation.dart';
import 'package:intl/intl.dart';

import '../utils/date_utils.dart';
import 'auth_service.dart';

/// Firestore + Storage service (singleton). Port of `firestoreService.js`.
class FirestoreService {
  FirestoreService._();

  static final FirestoreService instance = FirestoreService._();

  factory FirestoreService() => instance;

  final FirebaseFirestore _db = FirebaseFirestore.instance;
  final FirebaseStorage _storage = FirebaseStorage.instance;

  dynamic _getCurrentUser() => AuthService.instance.getCurrentUser();

  int _toInt32(int n) => n.toSigned(32);

  int _imul(int a, int b) => (a * b).toSigned(32);

  String _randomSuffix() {
    final r = Random().nextInt(0x7FFFFFFF).toRadixString(36);
    if (r.length >= 8) return r.substring(2, 8);
    return r.padRight(6, '0').substring(0, 6);
  }

  bool _isFileOrBytes(dynamic file) => file is File || file is Uint8List;

  String _fileExtension(dynamic file) {
    if (file is File) {
      final name = file.path.split(Platform.pathSeparator).last;
      if (name.contains('.')) return name.split('.').last;
    }
    return 'jpg';
  }

  Future<void> _uploadFileOrBytes(Reference storageRef, dynamic file) async {
    if (file is File) {
      await storageRef.putFile(file);
    } else if (file is Uint8List) {
      await storageRef.putData(file);
    }
  }

  DateTime _toDate(dynamic ts) {
    if (ts is Timestamp) return ts.toDate();
    if (ts is DateTime) return ts;
    return DateTime.now();
  }

  bool _needsIndex(FirebaseException e) {
    final msg = e.message?.toLowerCase() ?? '';
    return e.code == 'failed-precondition' || msg.contains('index');
  }

  String _formatShortDay(DateTime date) => DateFormat('MMM d').format(date);

  String _formatTime(DateTime dt) => DateFormat('h:mm a').format(dt);

  Map<String, dynamic> _mapPostDoc(QueryDocumentSnapshot<Map<String, dynamic>> docSnap) {
    final data = docSnap.data();
    return {'id': docSnap.id, ...data, 'createdAt': _toDate(data['createdAt'])};
  }

  String hashForNewsUrlCache(String url) {
    final trimmed = url.trim();
    final raw = trimmed.length > 900 ? trimmed.substring(0, 900) : trimmed;
    final s = raw.replaceAll(RegExp(r'\s+'), ' ').trim();
    if (s.isEmpty) return '';
    var h = 0;
    for (var i = 0; i < s.length; i++) {
      h = _toInt32((h << 5) - h + s.codeUnitAt(i));
    }
    return h.abs().toRadixString(36);
  }

  Future<Map<String, dynamic>> ensureUser(
    String uid, [
    Map<String, dynamic> userData = const {},
  ]) async {
    try {
      await _db.doc('users/$uid').set({
        'createdAt': FieldValue.serverTimestamp(),
        ...userData,
      }, SetOptions(merge: true));
      if (userData.containsKey('profilePicture') ||
          userData.containsKey('displayName')) {
        final metadataPayload = <String, dynamic>{};
        if (userData.containsKey('profilePicture')) {
          metadataPayload['profilePicture'] = userData['profilePicture'];
        }
        if (userData.containsKey('displayName')) {
          metadataPayload['displayName'] = userData['displayName'];
        }
        if (metadataPayload.isNotEmpty) {
          await _db.doc('usersMetadata/$uid').set(metadataPayload, SetOptions(merge: true));
        }
      }
      return {'success': true};
    } catch (error) {
      debugPrint('Error ensuring user: $error');
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> getUser(String uid) async {
    try {
      var userData = <String, dynamic>{};
      final userSnap = await _db.doc('users/$uid').get();
      if (userSnap.exists) userData = Map<String, dynamic>.from(userSnap.data() ?? {});
      try {
        final metadataSnap = await _db.doc('usersMetadata/$uid').get();
        if (metadataSnap.exists) {
          final metadata = metadataSnap.data() ?? {};
          userData = {
            ...userData,
            ...metadata,
            'profilePicture': metadata['profilePicture'] ?? userData['profilePicture'],
            'displayName': metadata['displayName'] ?? userData['displayName'],
          };
        }
      } catch (_) {
        debugPrint('No metadata found for user: $uid');
      }
      if (userData.isNotEmpty) return {'success': true, 'data': userData};
      return {'success': false, 'error': 'User not found'};
    } catch (error) {
      debugPrint('Error getting user: $error');
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<String?> getProfilePictureUrl(String uid) async {
    final result = await getUser(uid);
    if (result['success'] == true) {
      final pic = (result['data'] as Map?)?['profilePicture'];
      if (pic != null) return pic as String;
    }
    return null;
  }

  Future<Map<String, dynamic>> getFollowing(String uid) async {
    try {
      final snap = await _db.doc('users/$uid/following/following').get();
      if (snap.exists && snap.data()?['followingIds'] is List) {
        return {
          'success': true,
          'followingIds': List<dynamic>.from(snap.data()!['followingIds'] as List),
        };
      }
      return {'success': true, 'followingIds': <String>[]};
    } catch (error) {
      debugPrint('Error getting following list: $error');
      return {'success': false, 'followingIds': <String>[]};
    }
  }

  Future<Map<String, dynamic>> followUser(String uid, String targetUid) async {
    try {
      if (uid.isEmpty || targetUid.isEmpty || uid == targetUid) return {'success': false};
      final followingRef = _db.doc('users/$uid/following/following');
      final snap = await followingRef.get();
      final existing = snap.exists && snap.data()?['followingIds'] is List
          ? List<String>.from(snap.data()!['followingIds'] as List)
          : <String>[];
      if (existing.contains(targetUid)) return {'success': true, 'followingIds': existing};
      final next = [...existing, targetUid];
      await followingRef.set({'followingIds': next}, SetOptions(merge: true));
      return {'success': true, 'followingIds': next};
    } catch (error) {
      debugPrint('Error following user: $error');
      return {'success': false};
    }
  }

  Future<Map<String, dynamic>> unfollowUser(String uid, String targetUid) async {
    try {
      if (uid.isEmpty || targetUid.isEmpty) return {'success': false};
      final followingRef = _db.doc('users/$uid/following/following');
      final snap = await followingRef.get();
      final existing = snap.exists && snap.data()?['followingIds'] is List
          ? List<String>.from(snap.data()!['followingIds'] as List)
          : <String>[];
      final next = existing.where((id) => id != targetUid).toList();
      await followingRef.set({'followingIds': next}, SetOptions(merge: true));
      return {'success': true, 'followingIds': next};
    } catch (error) {
      debugPrint('Error unfollowing user: $error');
      return {'success': false};
    }
  }

  Future<Map<String, dynamic>> getCommunityPostsByAuthorIds(
    List<String>? authorIds, [
    int limitCount = 20,
  ]) async {
    if (authorIds == null || authorIds.isEmpty) {
      return {'success': true, 'posts': <Map<String, dynamic>>[]};
    }
    final ids = authorIds.take(30).toList();
    final postsRef = _db.collection('communityPosts');
    try {
      final snapshot = await postsRef
          .where('authorId', whereIn: ids)
          .orderBy('createdAt', descending: true)
          .limit(limitCount)
          .get();
      return {
        'success': true,
        'posts': snapshot.docs.map(_mapPostDoc).toList(),
      };
    } on FirebaseException catch (indexError) {
      if (_needsIndex(indexError)) {
        try {
          final fallbackSnap =
              await postsRef.where('authorId', whereIn: ids).limit(limitCount * 2).get();
          final posts = fallbackSnap.docs.map(_mapPostDoc).toList();
          posts.sort((a, b) {
            final aTime = (a['createdAt'] as DateTime?)?.millisecondsSinceEpoch ?? 0;
            final bTime = (b['createdAt'] as DateTime?)?.millisecondsSinceEpoch ?? 0;
            return bTime.compareTo(aTime);
          });
          return {'success': true, 'posts': posts.take(limitCount).toList()};
        } catch (fallbackError) {
          debugPrint('Error getting community posts (fallback): $fallbackError');
        }
      }
      return {'success': false, 'posts': <Map<String, dynamic>>[]};
    } catch (error) {
      debugPrint('Error getting community posts by authors: $error');
      return {'success': false, 'posts': <Map<String, dynamic>>[]};
    }
  }

  Future<Map<String, dynamic>> saveSocialShare(String uid, Map<String, dynamic> data) async {
    if (uid.isEmpty || data['platform'] == null) {
      return {'success': false, 'error': 'Missing uid or platform'};
    }
    try {
      final reflectionDate = data['reflectionDate'] ?? getDateId(DateTime.now());
      final dateStr = reflectionDate is String
          ? reflectionDate
          : reflectionDate is DateTime
              ? getDateId(reflectionDate)
              : getDateId(DateTime.now());
      final snippet = (data['reflectionSnippet'] as String?) ?? '';
      await _db.collection('socialShares').add({
        'userId': uid,
        'platform': data['platform'],
        'reflectionDate': dateStr,
        'reflectionSnippet': snippet.isEmpty ? null : snippet.substring(0, min(200, snippet.length)),
        'createdAt': FieldValue.serverTimestamp(),
      });
      return {'success': true};
    } catch (error) {
      debugPrint('Error saving social share: $error');
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<String?> uploadPostImage(String uid, String dataUrl) async {
    if (dataUrl.isEmpty || !dataUrl.startsWith('data:image')) return null;
    try {
      final path = 'posts/$uid/${DateTime.now().millisecondsSinceEpoch}-${_randomSuffix()}.png';
      final storageRef = _storage.ref(path);
      final commaIndex = dataUrl.indexOf(',');
      if (commaIndex == -1) return null;
      await storageRef.putData(
        base64Decode(dataUrl.substring(commaIndex + 1)),
        SettableMetadata(contentType: 'image/png'),
      );
      return await storageRef.getDownloadURL();
    } catch (error) {
      debugPrint('Error uploading post image: $error');
      return null;
    }
  }

  Future<String?> uploadPostImageFromFile(String uid, dynamic file) async {
    if (uid.isEmpty || !_isFileOrBytes(file)) return null;
    try {
      final path =
          'posts/$uid/${DateTime.now().millisecondsSinceEpoch}-${_randomSuffix()}.${_fileExtension(file)}';
      final storageRef = _storage.ref(path);
      await _uploadFileOrBytes(storageRef, file);
      return await storageRef.getDownloadURL();
    } catch (error) {
      debugPrint('Error uploading post image file: $error');
      return null;
    }
  }

  Future<String?> uploadPostImageToPath(String uid, String postId, dynamic file) async {
    if (uid.isEmpty || postId.isEmpty || !_isFileOrBytes(file)) return null;
    try {
      final path = 'posts/$uid/$postId.${_fileExtension(file)}';
      final storageRef = _storage.ref(path);
      await _uploadFileOrBytes(storageRef, file);
      return await storageRef.getDownloadURL();
    } catch (error) {
      debugPrint('Error uploading post image to path: $error');
      return null;
    }
  }

  String hashForReflectionCache(String postText) {
    final raw = postText.trim();
    final sliced = raw.length > 500 ? raw.substring(0, 500) : raw;
    final s = sliced.replaceAll(RegExp(r'\s+'), ' ').trim();
    var h = 0;
    for (var i = 0; i < s.length; i++) {
      h = _toInt32((h << 5) - h + s.codeUnitAt(i));
    }
    return h.abs().toRadixString(36);
  }

  Future<String?> getReflectionImageUrlByIndex(
    String uid,
    String platform,
    dynamic reflectionKey,
    dynamic index,
  ) async {
    if (uid.isEmpty || platform.isEmpty || reflectionKey == null || index == null) return null;
    try {
      final snap = await _db.doc('reflectionImageCache/${uid}_${platform}_${reflectionKey}_$index').get();
      return snap.data()?['imageUrl'] as String?;
    } catch (error) {
      debugPrint('getReflectionImageUrlByIndex failed: $error');
      return null;
    }
  }

  Future<void> saveReflectionImageUrlByIndex(
    String uid,
    String platform,
    dynamic reflectionKey,
    dynamic index,
    String imageUrl,
  ) async {
    if (uid.isEmpty || platform.isEmpty || reflectionKey == null || index == null || imageUrl.isEmpty) {
      return;
    }
    try {
      await _db.doc('reflectionImageCache/${uid}_${platform}_${reflectionKey}_$index').set({
        'userId': uid,
        'platform': platform,
        'reflectionKey': reflectionKey,
        'index': index,
        'imageUrl': imageUrl,
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
    } catch (error) {
      debugPrint('saveReflectionImageUrlByIndex failed: $error');
    }
  }

  Future<String?> uploadReflectionImageFileByIndex(
    String uid,
    dynamic file,
    dynamic reflectionKey,
    String platform,
    dynamic index,
  ) async {
    if (uid.isEmpty || !_isFileOrBytes(file) || reflectionKey == null || platform.isEmpty || index == null) {
      return null;
    }
    try {
      final path = 'reflectionCache/$uid/${reflectionKey}_${platform}_$index.${_fileExtension(file)}';
      final storageRef = _storage.ref(path);
      await _uploadFileOrBytes(storageRef, file);
      return await storageRef.getDownloadURL();
    } catch (error) {
      debugPrint('Error uploading reflection cache image by index: $error');
      return null;
    }
  }

  Future<String?> uploadReflectionImageFile(String uid, dynamic file, String cacheKey) async {
    if (uid.isEmpty || !_isFileOrBytes(file) || cacheKey.isEmpty) return null;
    try {
      final path = 'reflectionCache/$uid/$cacheKey.${_fileExtension(file)}';
      final storageRef = _storage.ref(path);
      await _uploadFileOrBytes(storageRef, file);
      return await storageRef.getDownloadURL();
    } catch (error) {
      debugPrint('Error uploading reflection cache image: $error');
      return null;
    }
  }

  Future<String?> getReflectionImageUrl(String uid, String? postText) async {
    if (uid.isEmpty || (postText?.trim().isEmpty ?? true)) return null;
    try {
      final key = hashForReflectionCache(postText!);
      final snap = await _db.doc('reflectionImageCache/${uid}_$key').get();
      return snap.data()?['imageUrl'] as String?;
    } catch (error) {
      debugPrint('getReflectionImageUrl failed: $error');
      return null;
    }
  }

  Future<void> saveReflectionImageUrl(String uid, String postText, String imageUrl) async {
    if (uid.isEmpty || postText.trim().isEmpty || imageUrl.isEmpty) return;
    try {
      final key = hashForReflectionCache(postText);
      await _db.doc('reflectionImageCache/${uid}_$key').set({
        'userId': uid,
        'postTextSnippet': postText.trim().length > 300 ? postText.trim().substring(0, 300) : postText.trim(),
        'imageUrl': imageUrl,
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
    } catch (error) {
      debugPrint('saveReflectionImageUrl failed: $error');
    }
  }

  Future<String?> getNewsShareImageUrl(String uid, String? articleUrl) async {
    final url = (articleUrl ?? '').trim();
    if (uid.isEmpty || url.isEmpty) return null;
    try {
      final key = hashForNewsUrlCache(url);
      if (key.isEmpty) return null;
      final snap = await _db.doc('newsImageCache/${uid}_$key').get();
      return snap.data()?['imageUrl'] as String?;
    } catch (error) {
      debugPrint('getNewsShareImageUrl failed: $error');
      return null;
    }
  }

  Future<void> saveNewsShareImageUrl(
    String uid,
    String articleUrl,
    String imageUrl, [
    String storagePath = '',
  ]) async {
    final url = articleUrl.trim();
    if (uid.isEmpty || url.isEmpty || imageUrl.isEmpty) return;
    try {
      final key = hashForNewsUrlCache(url);
      if (key.isEmpty) return;
      final sp = storagePath.trim();
      await _db.doc('newsImageCache/${uid}_$key').set({
        'userId': uid,
        'articleUrl': url.length > 1200 ? url.substring(0, 1200) : url,
        'imageUrl': imageUrl,
        'lastSeenAt': DateTime.now().millisecondsSinceEpoch,
        'storagePath': sp.isEmpty ? FieldValue.delete() : sp,
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
    } catch (error) {
      debugPrint('saveNewsShareImageUrl failed: $error');
    }
  }

  Future<Map<String, String>?> uploadNewsShareImageFile(
    String uid,
    dynamic file,
    String articleUrl,
  ) async {
    final url = articleUrl.trim();
    if (uid.isEmpty || !_isFileOrBytes(file) || url.isEmpty) return null;
    try {
      final key = hashForNewsUrlCache(url);
      if (key.isEmpty) return null;
      final storagePath = 'newsShareCache/$uid/$key.${_fileExtension(file)}';
      final storageRef = FirebaseStorage.instance.ref(storagePath);
      await _uploadFileOrBytes(storageRef, file);
      return {'imageUrl': await storageRef.getDownloadURL(), 'storagePath': storagePath};
    } catch (error) {
      debugPrint('Error uploading news share cache image: $error');
      return null;
    }
  }

  Future<void> touchNewsShareImage(String uid, String articleUrl) async {
    final url = articleUrl.trim();
    if (uid.isEmpty || url.isEmpty) return;
    try {
      final key = hashForNewsUrlCache(url);
      if (key.isEmpty) return;
      await _db.doc('newsImageCache/${uid}_$key').set({
        'userId': uid,
        'articleUrl': url.length > 1200 ? url.substring(0, 1200) : url,
        'lastSeenAt': DateTime.now().millisecondsSinceEpoch,
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
    } catch (error) {
      debugPrint('touchNewsShareImage failed: $error');
    }
  }

  /// Global hub carousel image (Tea + News) — shared across users on Deitea server.
  Future<String?> getHubCarouselImageUrl(String? articleUrl) async {
    final url = (articleUrl ?? '').trim();
    if (url.isEmpty) return null;
    try {
      final key = hashForNewsUrlCache(url);
      if (key.isEmpty) return null;
      final snap = await _db.doc('hubCarouselImageCache/$key').get();
      return snap.data()?['imageUrl'] as String?;
    } catch (error) {
      debugPrint('getHubCarouselImageUrl failed: $error');
      return null;
    }
  }

  Future<String?> saveHubCarouselImage({
    required String articleUrl,
    required String imageUrl,
    required String kind,
    String headline = '',
    String storagePath = '',
  }) async {
    final url = articleUrl.trim();
    if (url.isEmpty || imageUrl.isEmpty) return null;
    try {
      final key = hashForNewsUrlCache(url);
      if (key.isEmpty) return null;

      var finalUrl = imageUrl.trim();
      var finalPath = storagePath.trim();

      if (finalUrl.startsWith('data:image')) {
        final uploaded = await _uploadHubCarouselDataUrl(key, finalUrl);
        if (uploaded == null) return null;
        finalUrl = uploaded['imageUrl'] ?? '';
        finalPath = uploaded['storagePath'] ?? '';
        if (finalUrl.isEmpty) return null;
      }

      await _db.doc('hubCarouselImageCache/$key').set({
        'articleUrl': url.length > 1200 ? url.substring(0, 1200) : url,
        'imageUrl': finalUrl,
        'kind': kind,
        if (headline.trim().isNotEmpty) 'headline': headline.trim(),
        if (finalPath.isNotEmpty) 'storagePath': finalPath,
        'lastSeenAt': DateTime.now().millisecondsSinceEpoch,
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
      return finalUrl;
    } catch (error) {
      debugPrint('saveHubCarouselImage failed: $error');
      return null;
    }
  }

  Future<void> deleteHubCarouselImage(String articleUrl) async {
    final url = articleUrl.trim();
    if (url.isEmpty) return;
    try {
      final key = hashForNewsUrlCache(url);
      if (key.isEmpty) return;
      final ref = _db.doc('hubCarouselImageCache/$key');
      final snap = await ref.get();
      if (!snap.exists) return;
      final data = snap.data() ?? {};
      final storagePath = (data['storagePath'] ?? '').toString().trim();
      if (storagePath.isNotEmpty) {
        try {
          await _storage.ref(storagePath).delete();
        } catch (_) {}
      }
      await ref.delete();
    } catch (error) {
      debugPrint('deleteHubCarouselImage failed: $error');
    }
  }

  Future<Map<String, String>?> _uploadHubCarouselDataUrl(String key, String dataUrl) async {
    if (!dataUrl.startsWith('data:image')) return null;
    try {
      final commaIndex = dataUrl.indexOf(',');
      if (commaIndex == -1) return null;
      final storagePath = 'hubCarouselCache/$key.png';
      final storageRef = _storage.ref(storagePath);
      await storageRef.putData(
        base64Decode(dataUrl.substring(commaIndex + 1)),
        SettableMetadata(contentType: 'image/png'),
      );
      return {
        'imageUrl': await storageRef.getDownloadURL(),
        'storagePath': storagePath,
      };
    } catch (error) {
      debugPrint('_uploadHubCarouselDataUrl failed: $error');
      return null;
    }
  }

  Future<void> cleanupNewsShareImages(
    String uid,
    List<dynamic>? activeUrls, {
    int? maxAgeMs,
    int? maxDocs,
  }) async {
    if (uid.isEmpty) return;
    final ageMs = maxAgeMs ?? 3 * 24 * 60 * 60 * 1000;
    final docLimit = maxDocs ?? 120;
    final active = (activeUrls ?? [])
        .map((u) => (u ?? '').toString().trim())
        .where((u) => u.isNotEmpty)
        .toSet();
    if (active.isEmpty) return;
    try {
      final snap = await _db
          .collection('newsImageCache')
          .where('userId', isEqualTo: uid)
          .orderBy('updatedAt', descending: true)
          .limit(docLimit)
          .get();
      final now = DateTime.now().millisecondsSinceEpoch;
      await Future.wait(snap.docs.map((d) async {
        final data = d.data();
        final url = (data['articleUrl'] ?? '').toString().trim();
        if (url.isEmpty) return;
        if (active.contains(url)) {
          await d.reference.set({
            'lastSeenAt': now,
            'updatedAt': FieldValue.serverTimestamp(),
          }, SetOptions(merge: true));
          return;
        }
        final lastSeenAt = data['lastSeenAt'] is num ? (data['lastSeenAt'] as num).toInt() : 0;
        if (lastSeenAt != 0 && now - lastSeenAt < ageMs) return;
        final storagePath = (data['storagePath'] ?? '').toString().trim();
        if (storagePath.isNotEmpty) {
          try {
            await _storage.ref(storagePath).delete();
          } catch (_) {}
        }
        await d.reference.delete();
      }));
    } catch (error) {
      debugPrint('cleanupNewsShareImages failed: $error');
    }
  }

  /// Create a Detea social post: image in Storage, metadata + imageUrl in Firestore.
  Future<Map<String, dynamic>> createPostForShare({
    required String uid,
    required String caption,
    dynamic imageFile,
    List<dynamic>? imageFiles,
    String? imageUrl,
    List<String>? imageUrls,
    String? imageDataUrl,
    List<String>? imageDataUrls,
    required String platform,
  }) async {
    if (uid.isEmpty || caption.isEmpty) {
      return {'success': false, 'error': 'Missing uid or caption'};
    }
    try {
      final currentUser = _getCurrentUser();
      await ensureUser(uid, {
        'userId': uid,
        if (currentUser?.displayName != null)
          'displayName': currentUser!.displayName,
        if (currentUser?.email != null)
          'username': currentUser!.email!.split('@').first,
        'updatedAt': FieldValue.serverTimestamp(),
      });
      final postsRef = _db.collection('posts');
      final urlList = <String>[];
      final fileList = <dynamic>[];
      final dataUrlList = <String>[];
      if (imageUrl != null && imageUrl.trim().isNotEmpty) urlList.add(imageUrl.trim());
      if (imageUrls != null) {
        for (final u in imageUrls) {
          if (u.trim().isNotEmpty) urlList.add(u.trim());
        }
      }
      if (_isFileOrBytes(imageFile)) fileList.add(imageFile);
      if (imageFiles != null) {
        for (final f in imageFiles) {
          if (_isFileOrBytes(f)) fileList.add(f);
        }
      }
      if (imageDataUrl != null && imageDataUrl.trim().isNotEmpty) {
        dataUrlList.add(imageDataUrl.trim());
      }
      if (imageDataUrls != null) {
        for (final d in imageDataUrls) {
          if (d.trim().isNotEmpty) dataUrlList.add(d.trim());
        }
      }
      if (fileList.isNotEmpty) {
        final tempPostId = postsRef.doc().id;
        for (var i = 0; i < fileList.length; i++) {
          final key = '$tempPostId-$i';
          var uploaded = await uploadPostImageToPath(uid, key, fileList[i]);
          uploaded ??= await uploadPostImageFromFile(uid, fileList[i]);
          if (uploaded != null) urlList.add(uploaded);
        }
      }
      for (final d in dataUrlList) {
        final uploaded = await uploadPostImage(uid, d);
        if (uploaded != null) urlList.add(uploaded);
      }
      final uniqueUrls = urlList.where((u) => u.isNotEmpty).toSet().toList();
      final imageUrlFinal = uniqueUrls.isNotEmpty ? uniqueUrls.first : null;
      final normalizedCaption = caption.trim();
      try {
        final dedupeQuery = imageUrlFinal != null
            ? postsRef
                .where('userId', isEqualTo: uid)
                .where('caption', isEqualTo: normalizedCaption)
                .where('imageUrl', isEqualTo: imageUrlFinal)
            : postsRef
                .where('userId', isEqualTo: uid)
                .where('caption', isEqualTo: normalizedCaption)
                .where('imageUrl', isEqualTo: null);
        final existingSnap = await dedupeQuery.get();
        if (existingSnap.docs.isNotEmpty) {
          final existingPostId = existingSnap.docs.first.id;
          await _db.collection('shareHistory').add({
            'userId': uid,
            'postId': existingPostId,
            'platform': platform,
            'createdAt': FieldValue.serverTimestamp(),
          });
          return {
            'success': true,
            'postId': existingPostId,
            'imageUrl': imageUrlFinal,
            'imageUrls': uniqueUrls,
          };
        }
      } catch (dedupeError) {
        debugPrint('createPostForShare dedupe check failed: $dedupeError');
      }
      final postDocRef = postsRef.doc();
      final postId = postDocRef.id;
      await postDocRef.set({
        'userId': uid,
        'caption': normalizedCaption,
        'imageUrl': imageUrlFinal,
        'imageUrls': uniqueUrls.isNotEmpty ? uniqueUrls : null,
        'createdAt': FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
        'likeCount': 0,
        'commentCount': 0,
      });
      await _db.doc('userPosts/$uid/posts/$postId').set({
        'userId': uid,
        'postId': postId,
        'createdAt': FieldValue.serverTimestamp(),
        'postRef': 'posts/$postId',
      });
      await _db.collection('shareHistory').add({
        'userId': uid,
        'postId': postId,
        'platform': platform,
        'createdAt': FieldValue.serverTimestamp(),
      });
      return {
        'success': true,
        'postId': postId,
        'imageUrl': imageUrlFinal,
        'imageUrls': uniqueUrls,
      };
    } catch (error) {
      debugPrint('Error creating post for share: $error');
      return {'success': false, 'error': error.toString()};
    }
  }

  /// Get all social shares for a user (for My Presence feed).
  Future<Map<String, dynamic>> getSocialSharesByUser(String uid) async {
    if (uid.isEmpty) return {'success': true, 'shares': <Map<String, dynamic>>[]};
    final colRef = _db.collection('socialShares');

    List<Map<String, dynamic>> mapSnapshot(
      QuerySnapshot<Map<String, dynamic>> snapshot,
    ) {
      return snapshot.docs.map((docSnap) {
        final d = docSnap.data();
        return {
          'id': docSnap.id,
          'platform': d['platform'] ?? 'native',
          'reflectionDate': d['reflectionDate'] ?? '',
          'reflectionSnippet': d['reflectionSnippet'],
          'createdAt': _toDate(d['createdAt']),
        };
      }).toList();
    }

    try {
      final q = colRef
          .where('userId', isEqualTo: uid)
          .orderBy('createdAt', descending: true)
          .limit(100);
      final snapshot = await q.get();
      return {'success': true, 'shares': mapSnapshot(snapshot)};
    } on FirebaseException catch (indexError) {
      if (_needsIndex(indexError)) {
        try {
          final fallbackQ = colRef.where('userId', isEqualTo: uid).limit(150);
          final fallbackSnap = await fallbackQ.get();
          final shares = mapSnapshot(fallbackSnap);
          shares.sort((a, b) {
            final aTime = (a['createdAt'] as DateTime?)?.millisecondsSinceEpoch ?? 0;
            final bTime = (b['createdAt'] as DateTime?)?.millisecondsSinceEpoch ?? 0;
            return bTime.compareTo(aTime);
          });
          return {'success': true, 'shares': shares.take(100).toList()};
        } catch (e) {
          debugPrint('Error getting social shares (fallback): $e');
        }
      } else {
        debugPrint('Error getting social shares: $indexError');
      }
      return {'success': true, 'shares': <Map<String, dynamic>>[]};
    } catch (error) {
      debugPrint('Error getting social shares: $error');
      return {'success': true, 'shares': <Map<String, dynamic>>[]};
    }
  }

  Future<Map<String, dynamic>> ensureChatDay(String uid, String dateId) async {
    try {
      final chatDayRef = _db.doc('users/$uid/chats/$dateId');
      await chatDayRef.set({
        'date': dateId,
        'messageCount': 0,
        'lastMessageAt': FieldValue.serverTimestamp(),
        'summary': null,
      }, SetOptions(merge: true));
      return {'success': true};
    } catch (error) {
      debugPrint('Error ensuring chat day: $error');
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> addMessage(
    String uid,
    String dateId,
    Map<String, dynamic> messageData,
  ) async {
    try {
      await ensureChatDay(uid, dateId);
      final messagesRef = _db.collection('users/$uid/chats/$dateId/messages');
      final messageRef = await messagesRef.add({
        ...messageData,
        'ts': FieldValue.serverTimestamp(),
      });
      final chatDayRef = _db.doc('users/$uid/chats/$dateId');
      final chatDaySnap = await chatDayRef.get();
      final currentCount = chatDaySnap.exists
          ? (chatDaySnap.data()?['messageCount'] as num?)?.toInt() ?? 0
          : 0;
      await chatDayRef.set({
        'messageCount': currentCount + 1,
        'lastMessageAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
      return {'success': true, 'messageId': messageRef.id};
    } catch (error) {
      debugPrint('Error adding message: $error');
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> getMessages(String uid, String dateId) async {
    try {
      final messagesRef = _db.collection('users/$uid/chats/$dateId/messages');
      final snapshot = await messagesRef.orderBy('ts').get();
      final messages = snapshot.docs.map((doc) {
        final data = doc.data();
        return {'id': doc.id, ...data, 'timestamp': _toDate(data['ts'])};
      }).toList();
      return {'success': true, 'messages': messages};
    } catch (error) {
      debugPrint('Error getting messages: $error');
      return {'success': false, 'error': error.toString(), 'messages': <Map<String, dynamic>>[]};
    }
  }

  Future<Map<String, dynamic>> getRecentChatDays(String uid, [int limitCount = 14]) async {
    try {
      final snapshot = await _db
          .collection('users/$uid/chats')
          .orderBy('date', descending: true)
          .limit(limitCount)
          .get();
      final chatDays = snapshot.docs.map((doc) => {'id': doc.id, ...doc.data()}).toList();
      return {'success': true, 'chatDays': chatDays};
    } catch (error) {
      debugPrint('Error getting recent chat days: $error');
      return {'success': false, 'error': error.toString(), 'chatDays': <Map<String, dynamic>>[]};
    }
  }

  Future<Map<String, dynamic>> getAllChatDays(String uid) async {
    try {
      debugPrint('ðŸ“… FIRESTORE: Getting all chat days for calendar...');
      final snapshot = await _db.collection('users/$uid/days').get();
      final chatDays = snapshot.docs
          .map((doc) => {'id': doc.id, 'date': doc.id, ...doc.data()})
          .toList();
      debugPrint('ðŸ“… FIRESTORE: Found ${chatDays.length} chat days');
      return {'success': true, 'chatDays': chatDays};
    } catch (error) {
      debugPrint('âŒ FIRESTORE: Error getting chat days: $error');
      return {'success': false, 'error': error.toString(), 'chatDays': <Map<String, dynamic>>[]};
    }
  }

  Future<Map<String, dynamic>> getAllReflectionDays(String uid) async {
    try {
      debugPrint('ðŸ“… FIRESTORE: Getting all reflection days for calendar...');
      final snapshot = await _db.collection('users/$uid/days').get();
      final reflectionDays = <Map<String, dynamic>>[];
      for (final dayDoc in snapshot.docs) {
        final dayData = dayDoc.data();
        final dateId = dayDoc.id;
        try {
          final reflectionSnap =
              await _db.doc('users/$uid/days/$dateId/reflection/meta').get();
          if (reflectionSnap.exists) {
            reflectionDays.add({
              'id': dateId,
              'date': dateId,
              ...dayData,
              'hasReflection': true,
            });
          }
        } catch (_) {}
      }
      if (reflectionDays.isEmpty) {
        final oldSnapshot = await _db.collection('users/$uid/dayReflections').get();
        for (final doc in oldSnapshot.docs) {
          reflectionDays.add({'id': doc.id, 'date': doc.id, ...doc.data()});
        }
      }
      return {'success': true, 'reflectionDays': reflectionDays};
    } catch (error) {
      debugPrint('âŒ FIRESTORE: Error getting reflection days: $error');
      return {'success': false, 'error': error.toString(), 'reflectionDays': <Map<String, dynamic>>[]};
    }
  }

  Future<Map<String, dynamic>> saveDayReflection(
    String uid,
    String dateId,
    Map<String, dynamic> reflectionData,
  ) async {
    try {
      final reflectionRef = _db.doc('users/$uid/dayReflections/$dateId');
      final isUpdate = (await reflectionRef.get()).exists;
      await reflectionRef.set({
        'date': dateId,
        ...reflectionData,
        'updatedAt': FieldValue.serverTimestamp(),
        if (!isUpdate) 'createdAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
      return {'success': true};
    } catch (error) {
      debugPrint('Error saving day reflection: $error');
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> getDayReflection(String uid, String dateId) async {
    try {
      final snapshot = await _db.doc('users/$uid/dayReflections/$dateId').get();
      if (snapshot.exists) {
        return {'success': true, 'reflection': {'id': snapshot.id, ...?snapshot.data()}};
      }
      return {'success': true, 'reflection': null};
    } catch (error) {
      debugPrint('Error getting day reflection: $error');
      return {'success': false, 'error': error.toString(), 'reflection': null};
    }
  }

  Future<Map<String, dynamic>> getRecentReflections(String uid, [int limitCount = 14]) async {
    try {
      final snapshot = await _db
          .collection('users/$uid/dayReflections')
          .orderBy('date', descending: true)
          .limit(limitCount)
          .get();
      final reflections = snapshot.docs.map((doc) => {'id': doc.id, ...doc.data()}).toList();
      return {'success': true, 'reflections': reflections};
    } catch (error) {
      debugPrint('Error getting recent reflections: $error');
      return {'success': false, 'error': error.toString(), 'reflections': <Map<String, dynamic>>[]};
    }
  }

  Future<Map<String, dynamic>> getChatDay(String uid, String dateId) async {
    try {
      final snapshot = await _db.doc('users/$uid/chats/$dateId').get();
      if (snapshot.exists) {
        return {'success': true, 'chatDay': {'id': snapshot.id, ...?snapshot.data()}};
      }
      return {'success': true, 'chatDay': null};
    } catch (error) {
      debugPrint('Error getting chat day: $error');
      return {'success': false, 'error': error.toString(), 'chatDay': null};
    }
  }

  Future<Map<String, dynamic>> saveHighlightsCache(
    String uid,
    String period,
    dynamic highlightsData,
  ) async {
    try {
      final today = DateTime.now().toUtc().toIso8601String().split('T').first;
      await _db.doc('users/$uid/highlightsCache/$period').set({
        'period': period,
        'lastUpdated': today,
        'updatedAt': FieldValue.serverTimestamp(),
        'highlights': highlightsData,
        'createdAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
      return {'success': true};
    } catch (error) {
      debugPrint('Error saving highlights cache: $error');
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> getHighlightsCache(String uid, String period) async {
    try {
      final snapshot = await _db.doc('users/$uid/highlightsCache/$period').get();
      if (snapshot.exists) {
        final data = snapshot.data()!;
        final today = DateTime.now().toUtc().toIso8601String().split('T').first;
        return {
          'success': true,
          'cache': {'id': snapshot.id, ...data, 'isValid': data['lastUpdated'] == today},
        };
      }
      return {'success': true, 'cache': null};
    } catch (error) {
      debugPrint('Error getting highlights cache: $error');
      return {'success': false, 'error': error.toString(), 'cache': null};
    }
  }

  Future<Map<String, dynamic>> needsHighlightsUpdate(String uid, String period) async {
    try {
      final result = await getHighlightsCache(uid, period);
      if (result['success'] != true) return {'success': false, 'needsUpdate': true};
      final cache = result['cache'] as Map<String, dynamic>?;
      return {'success': true, 'needsUpdate': cache == null || cache['isValid'] != true};
    } catch (error) {
      debugPrint('Error checking highlights update need: $error');
      return {'success': false, 'error': error.toString(), 'needsUpdate': true};
    }
  }

  Future<Map<String, dynamic>> saveChatMessageNew(
    String uid,
    String dateId,
    Map<String, dynamic> messageData,
  ) async {
    try {
      debugPrint('ðŸ’¾ FIRESTORE NEW: Saving chat message...');
      final messageDoc = <String, dynamic>{
        'role': messageData['sender'] == 'user' ? 'user' : 'assistant',
        'text': messageData['text'],
        'ts': FieldValue.serverTimestamp(),
        'isWhisperSession': messageData['isWhisperSession'] ?? false,
      };
      if (messageData['image'] != null) {
        final image = messageData['image'] as String;
        const maxSize = 750000;
        if (image.length > maxSize) {
          debugPrint('âš ï¸ FIRESTORE NEW: Image too large for Firestore. Saving without image.');
        } else {
          messageDoc['image'] = image;
        }
      }
      final messageRef = _db.collection('users/$uid/days/$dateId/messages').doc();
      await messageRef.set(messageDoc);
      await _db.doc('users/$uid/days/$dateId').set({
        'date': dateId,
        'lastMessageAt': FieldValue.serverTimestamp(),
        'messageCount': FieldValue.increment(1),
      }, SetOptions(merge: true));
      return {'success': true, 'messageId': messageRef.id};
    } catch (error) {
      debugPrint('âŒ FIRESTORE NEW: Error saving chat message: $error');
      if (error.toString().contains('size')) {
        try {
          final messageRef = _db.collection('users/$uid/days/$dateId/messages').doc();
          await messageRef.set({
            'role': messageData['sender'] == 'user' ? 'user' : 'assistant',
            'text': messageData['text'],
            'ts': FieldValue.serverTimestamp(),
            'isWhisperSession': messageData['isWhisperSession'] ?? false,
          });
          return {'success': true, 'messageId': messageRef.id, 'imageOmitted': true};
        } catch (retryError) {
          debugPrint('âŒ FIRESTORE NEW: Retry also failed: $retryError');
        }
      }
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> getChatMessagesNew(String uid, String dateId) async {
    try {
      debugPrint('ðŸ“– FIRESTORE NEW: Getting chat messages...');
      final snapshot = await _db
          .collection('users/$uid/days/$dateId/messages')
          .orderBy('ts')
          .get();
      final messages = snapshot.docs.map((doc) {
        final data = doc.data();
        final message = <String, dynamic>{
          'id': doc.id,
          'sender': data['role'] == 'user' ? 'user' : 'ai',
          'text': data['text'],
          'timestamp': _toDate(data['ts']),
          'isWhisperSession': data['isWhisperSession'] ?? false,
        };
        if (data['image'] != null) message['image'] = data['image'];
        return message;
      }).toList();
      return {'success': true, 'messages': messages};
    } catch (error) {
      debugPrint('âŒ FIRESTORE NEW: Error getting chat messages: $error');
      return {'success': false, 'error': error.toString(), 'messages': <Map<String, dynamic>>[]};
    }
  }

  Future<List<Map<String, dynamic>>> getChatMessages(String uid, String dateId) async {
    try {
      final result = await getChatMessagesNew(uid, dateId);
      if (result['success'] == true) {
        return List<Map<String, dynamic>>.from(result['messages'] as List? ?? []);
      }
      return [];
    } catch (error) {
      debugPrint('âŒ FIRESTORE: Error in getChatMessages wrapper: $error');
      return [];
    }
  }

  Future<Map<String, dynamic>> deleteChatMessageNew(
    String uid,
    String dateId,
    String messageId,
  ) async {
    try {
      await _db.doc('users/$uid/days/$dateId/messages/$messageId').delete();
      return {'success': true};
    } catch (error) {
      debugPrint('âŒ FIRESTORE NEW: Error deleting chat message: $error');
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> deleteWhisperSessionMessages(String uid, String dateId) async {
    try {
      final messagesRef = _db.collection('users/$uid/days/$dateId/messages');
      final whisperSnapshot =
          await messagesRef.where('isWhisperSession', isEqualTo: true).get();
      final deletePromises = <Future<void>>[];
      for (final docSnap in whisperSnapshot.docs) {
        if (docSnap.data()['isWhisperSession'] == true) {
          deletePromises.add(docSnap.reference.delete());
        }
      }
      await Future.wait(deletePromises);
      return {'success': true, 'deletedCount': deletePromises.length};
    } catch (error) {
      debugPrint('âŒ FIRESTORE NEW: Error deleting whisper session messages: $error');
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> saveReflectionNew(
    String uid,
    String dateId,
    Map<String, dynamic> reflectionData,
  ) async {
    try {
      await _db.doc('users/$uid/days/$dateId/reflection/meta').set({
        'summary': reflectionData['summary'],
        'mood': reflectionData['mood'] ?? 'neutral',
        'score': reflectionData['score'] ?? 50,
        'insights': reflectionData['insights'] ?? [],
        'updatedAt': FieldValue.serverTimestamp(),
        'source': 'auto',
      });
      return {'success': true};
    } catch (error) {
      debugPrint('âŒ FIRESTORE NEW: Error saving reflection: $error');
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> getReflectionNew(String uid, String dateId) async {
    try {
      final snapshot = await _db.doc('users/$uid/days/$dateId/reflection/meta').get();
      if (snapshot.exists) {
        final data = snapshot.data()!;
        return {'success': true, 'reflection': data['summary'], 'fullData': data};
      }
      return {'success': true, 'reflection': null};
    } catch (error) {
      debugPrint('âŒ FIRESTORE NEW: Error getting reflection: $error');
      return {'success': false, 'error': error.toString(), 'reflection': null};
    }
  }

  Future<Map<String, dynamic>> saveMoodChartNew(
    String uid,
    String dateId,
    Map<String, dynamic> moodData,
  ) async {
    try {
      await _db.doc('users/$uid/days/$dateId/moodChart/daily').set({
        'happiness': moodData['happiness'],
        'anxiety': moodData['anxiety'],
        'stress': moodData['stress'],
        'energy': moodData['energy'],
        'updatedAt': FieldValue.serverTimestamp(),
      });
      return {'success': true};
    } catch (error) {
      debugPrint('âŒ FIRESTORE NEW: Error saving mood chart: $error');
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> saveEmotionalBalanceNew(
    String uid,
    String dateId,
    Map<String, dynamic> balanceData,
  ) async {
    try {
      await _db.doc('users/$uid/days/$dateId/emotionalBalance/daily').set({
        'positive': balanceData['positive'],
        'negative': balanceData['negative'],
        'neutral': balanceData['neutral'],
        'updatedAt': FieldValue.serverTimestamp(),
      });
      return {'success': true};
    } catch (error) {
      debugPrint('âŒ FIRESTORE NEW: Error saving emotional balance: $error');
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> getEmotionalBalanceDataNew(String uid, [int days = 7]) async {
    try {
      final balanceData = <Map<String, dynamic>>[];
      final todayDateId = getDateId(DateTime.now());
      final parts = todayDateId.split('-').map(int.parse).toList();
      final todayYear = parts[0];
      final todayMonth = parts[1];
      final todayDay = parts[2];
      for (var i = days - 1; i >= 0; i--) {
        final targetDate = DateTime(todayYear, todayMonth, todayDay - i);
        final dateId =
            '${targetDate.year.toString().padLeft(4, '0')}-${targetDate.month.toString().padLeft(2, '0')}-${targetDate.day.toString().padLeft(2, '0')}';
        try {
          final snapshot =
              await _db.doc('users/$uid/days/$dateId/emotionalBalance/daily').get();
          if (snapshot.exists) {
            final data = snapshot.data()!;
            balanceData.add({
              'date': dateId,
              'day': _formatShortDay(targetDate),
              'positive': data['positive'] ?? 0,
              'negative': data['negative'] ?? 0,
              'neutral': data['neutral'] ?? 0,
            });
          }
        } catch (dayError) {
          debugPrint('âŒ Error getting balance data for $dateId: $dayError');
        }
      }
      return {'success': true, 'balanceData': balanceData};
    } catch (error) {
      debugPrint('âŒ FIRESTORE NEW: Error getting emotional balance data: $error');
      return {'success': false, 'error': error.toString(), 'balanceData': <Map<String, dynamic>>[]};
    }
  }

  Future<Map<String, dynamic>> getMoodChartDataNew(String uid, [int days = 7]) async {
    try {
      final todayDateId = getDateId(DateTime.now());
      final parts = todayDateId.split('-').map(int.parse).toList();
      final todayYear = parts[0];
      final todayMonth = parts[1];
      final todayDay = parts[2];

      final daySlots = <({DateTime date, String dateId})>[];
      for (var i = days - 1; i >= 0; i--) {
        final targetDate = DateTime(todayYear, todayMonth, todayDay - i);
        final dateId =
            '${targetDate.year.toString().padLeft(4, '0')}-${targetDate.month.toString().padLeft(2, '0')}-${targetDate.day.toString().padLeft(2, '0')}';
        daySlots.add((date: targetDate, dateId: dateId));
      }

      final results = await Future.wait(
        daySlots.map((slot) async {
          try {
            final snapshot =
                await _db.doc('users/$uid/days/${slot.dateId}/moodChart/daily').get();
            if (snapshot.exists) {
              final data = snapshot.data()!;
              return {
                'date': slot.dateId,
                'day': _formatShortDay(slot.date),
                'happiness': data['happiness'] ?? 0,
                'anxiety': data['anxiety'] ?? 0,
                'stress': data['stress'] ?? 0,
                'energy': data['energy'] ?? 0,
              };
            }
            if (days == 7) {
              return {
                'date': slot.dateId,
                'day': _formatShortDay(slot.date),
                'happiness': 0,
                'anxiety': 0,
                'stress': 0,
                'energy': 0,
              };
            }
          } on FirebaseException catch (dayError) {
            if (days == 7 &&
                dayError.code != 'permission-denied' &&
                dayError.code != 'unavailable') {
              return {
                'date': slot.dateId,
                'day': _formatShortDay(slot.date),
                'happiness': 0,
                'anxiety': 0,
                'stress': 0,
                'energy': 0,
              };
            }
          } catch (dayError) {
            debugPrint('Error getting mood data for ${slot.dateId}: $dayError');
          }
          return null;
        }),
      );

      final moodData = results
          .whereType<Map<String, dynamic>>()
          .toList()
        ..sort((a, b) => DateTime.parse(a['date'] as String)
            .compareTo(DateTime.parse(b['date'] as String)));

      return {'success': true, 'moodData': moodData};
    } catch (error) {
      debugPrint('âŒ FIRESTORE NEW: Error getting mood chart data: $error');
      return {'success': false, 'error': error.toString(), 'moodData': <Map<String, dynamic>>[]};
    }
  }

  Future<Map<String, dynamic>> getAllMoodChartDataNew(String uid) async {
    try {
      final daysSnapshot = await _db.collection('users/$uid/days').get();
      final docRefs = daysSnapshot.docs
          .map((dayDoc) => _db.doc('users/$uid/days/${dayDoc.id}/moodChart/daily'))
          .toList();
      final moodSnapshots = await Future.wait(docRefs.map((ref) => ref.get()));
      final moodData = <Map<String, dynamic>>[];
      for (var index = 0; index < daysSnapshot.docs.length; index++) {
        final dateId = daysSnapshot.docs[index].id;
        final moodSnapshot = moodSnapshots[index];
        if (moodSnapshot.exists) {
          final data = moodSnapshot.data()!;
          final dateParts = dateId.split('-').map(int.parse).toList();
          final targetDate = DateTime(dateParts[0], dateParts[1], dateParts[2]);
          moodData.add({
            'date': dateId,
            'day': _formatShortDay(targetDate),
            'happiness': data['happiness'] ?? 0,
            'anxiety': data['anxiety'] ?? 0,
            'stress': data['stress'] ?? 0,
            'energy': data['energy'] ?? 0,
          });
        }
      }
      moodData.sort((a, b) => DateTime.parse(a['date'] as String)
          .compareTo(DateTime.parse(b['date'] as String)));
      return {'success': true, 'moodData': moodData};
    } catch (error) {
      debugPrint('âŒ LIFETIME: Error getting all mood chart data: $error');
      return {'success': false, 'error': error.toString(), 'moodData': <Map<String, dynamic>>[]};
    }
  }

  Future<Map<String, dynamic>> savePod(String uid, Map<String, dynamic> podData) async {
    try {
      final podId = podData['id'] as String? ??
          _db.collection('users/$uid/pods').doc().id;
      await _db.doc('users/$uid/pods/$podId').set({
        'name': podData['name'] ?? 'My Pod',
        'startDate': podData['startDate'],
        'endDate': podData['endDate'],
        'reflection': podData['reflection'] ?? '',
        'createdAt': podData['createdAt'] ?? FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
        'memberCount': podData['memberCount'] ?? 5,
      }, SetOptions(merge: true));
      return {'success': true, 'podId': podId};
    } catch (error) {
      debugPrint('Error saving pod: $error');
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> getAllPods(String uid) async {
    try {
      final snapshot =
          await _db.collection('users/$uid/pods').orderBy('createdAt', descending: true).get();
      final pods = snapshot.docs.map((doc) {
        final data = doc.data();
        return {
          'id': doc.id,
          'name': data['name'] ?? 'My Pod',
          'startDate': data['startDate'],
          'endDate': data['endDate'],
          'reflection': data['reflection'] ?? '',
          'createdAt': _toDate(data['createdAt']),
          'updatedAt': _toDate(data['updatedAt']),
          'memberCount': data['memberCount'] ?? 5,
        };
      }).toList();
      return {'success': true, 'pods': pods};
    } catch (error) {
      debugPrint('Error getting all pods: $error');
      return {'success': false, 'error': error.toString(), 'pods': <Map<String, dynamic>>[]};
    }
  }

  Future<Map<String, dynamic>> getPod(String uid, String podId) async {
    try {
      final snapshot = await _db.doc('users/$uid/pods/$podId').get();
      if (snapshot.exists) {
        final data = snapshot.data()!;
        return {
          'success': true,
          'pod': {
            'id': snapshot.id,
            'name': data['name'] ?? 'My Pod',
            'startDate': data['startDate'],
            'endDate': data['endDate'],
            'reflection': data['reflection'] ?? '',
            'createdAt': _toDate(data['createdAt']),
            'updatedAt': _toDate(data['updatedAt']),
            'memberCount': data['memberCount'] ?? 5,
          },
        };
      }
      return {'success': true, 'pod': null};
    } catch (error) {
      debugPrint('Error getting pod: $error');
      return {'success': false, 'error': error.toString(), 'pod': null};
    }
  }

  Future<Map<String, dynamic>> savePodReflection(String uid, String reflection) async {
    try {
      final today = DateTime.now();
      final dateId = today.toUtc().toIso8601String().split('T').first;
      await _db.doc('users/$uid/podReflections/current').set({
        'summary': reflection,
        'createdAt': FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
        'dateId': dateId,
      }, SetOptions(merge: true));
      final podsRef = _db.collection('users/$uid/pods');
      final todaySnapshot =
          await podsRef.where('startDate', isEqualTo: dateId).limit(1).get();
      if (todaySnapshot.docs.isEmpty) {
        await podsRef.doc().set({
          'name':
              'Pod - ${_formatShortDay(today)}, ${today.year}',
          'startDate': dateId,
          'endDate': null,
          'reflection': reflection,
          'createdAt': FieldValue.serverTimestamp(),
          'updatedAt': FieldValue.serverTimestamp(),
          'memberCount': 5,
        });
      } else {
        await todaySnapshot.docs.first.reference.set({
          'reflection': reflection,
          'updatedAt': FieldValue.serverTimestamp(),
        }, SetOptions(merge: true));
      }
      return {'success': true};
    } catch (error) {
      debugPrint('Error saving pod reflection: $error');
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> getPodReflection(String uid) async {
    try {
      final snapshot = await _db.doc('users/$uid/podReflections/current').get();
      if (snapshot.exists) {
        final data = snapshot.data()!;
        return {
          'success': true,
          'reflection': data['summary'] ?? '',
          'createdAt': data['createdAt'],
          'dateId': data['dateId'],
        };
      }
      return {'success': true, 'reflection': ''};
    } catch (error) {
      debugPrint('Error getting pod reflection: $error');
      return {'success': false, 'error': error.toString(), 'reflection': ''};
    }
  }

  Future<Map<String, dynamic>> getAllPodReflections(String uid) async {
    try {
      final snapshot = await _db.collection('users/$uid/podReflections').get();
      final reflections = <Map<String, dynamic>>[];
      for (final doc in snapshot.docs) {
        final data = doc.data();
        if (data['summary'] != null) {
          reflections.add({
            'id': doc.id,
            'reflection': data['summary'],
            'dateId': data['dateId'],
            'createdAt': data['createdAt'] != null
                ? _toDate(data['createdAt'])
                : (data['dateId'] != null
                    ? DateTime.parse(data['dateId'] as String)
                    : DateTime.now()),
            'updatedAt': _toDate(data['updatedAt']),
          });
        }
      }
      reflections.sort((a, b) {
        final aTime = (a['createdAt'] as DateTime?)?.millisecondsSinceEpoch ?? 0;
        final bTime = (b['createdAt'] as DateTime?)?.millisecondsSinceEpoch ?? 0;
        return bTime.compareTo(aTime);
      });
      return {'success': true, 'reflections': reflections};
    } catch (error) {
      debugPrint('Error getting all pod reflections: $error');
      return {'success': false, 'error': error.toString(), 'reflections': <Map<String, dynamic>>[]};
    }
  }

  Future<Map<String, dynamic>> getCrewMembers(String currentUserId, [int limitCount = 5]) async {
    try {
      final currentUserMoodData = await getMoodChartDataNew(currentUserId, 7);
      if (currentUserMoodData['success'] != true ||
          (currentUserMoodData['moodData'] as List).isEmpty) {
        return {'success': true, 'members': <Map<String, dynamic>>[]};
      }
      final currentUserMoods =
          List<Map<String, dynamic>>.from(currentUserMoodData['moodData'] as List);
      double avg(String key, double fallback) {
        if (currentUserMoods.isEmpty) return fallback;
        return currentUserMoods
                .map((d) => (d[key] as num?)?.toDouble() ?? fallback)
                .reduce((a, b) => a + b) /
            currentUserMoods.length;
      }

      final avgHappiness = avg('happiness', 50);
      final avgEnergy = avg('energy', 50);
      final avgStress = avg('stress', 30);
      final avgAnxiety = avg('anxiety', 30);

      final usersSnapshot = await _db.collection('usersMetadata').get();
      final sevenDaysAgo = DateTime.now().subtract(const Duration(days: 7));
      final sevenDaysAgoStr =
          sevenDaysAgo.toUtc().toIso8601String().split('T').first;
      final potentialMembers = <Map<String, dynamic>>[];

      for (final userDoc in usersSnapshot.docs) {
        final userId = userDoc.id;
        if (userId == currentUserId) continue;
        final userData = userDoc.data();
        final isEnrolled =
            userData['enrolled_for_crew'] != false && userData['crewEnrolled'] != false;
        if (!isEnrolled) continue;
        final lastActive = userData['lastActive'];
        if (lastActive == null) continue;
        final lastActiveDate = _toDate(lastActive);
        final lastActiveStr =
            lastActiveDate.toUtc().toIso8601String().split('T').first;
        if (lastActiveStr.compareTo(sevenDaysAgoStr) < 0) continue;

        final userMoodData = await getMoodChartDataNew(userId, 7);
        if (userMoodData['success'] != true ||
            (userMoodData['moodData'] as List).isEmpty) {
          continue;
        }
        final userMoods = List<Map<String, dynamic>>.from(userMoodData['moodData'] as List);
        double userAvg(String key, double fallback) =>
            userMoods.map((d) => (d[key] as num?)?.toDouble() ?? fallback).reduce((a, b) => a + b) /
            userMoods.length;

        final userAvgHappiness = userAvg('happiness', 50);
        final userAvgEnergy = userAvg('energy', 50);
        final userAvgStress = userAvg('stress', 30);
        final userAvgAnxiety = userAvg('anxiety', 30);

        final totalDiff = (avgHappiness - userAvgHappiness).abs() +
            (avgEnergy - userAvgEnergy).abs() +
            (avgStress - userAvgStress).abs() +
            (avgAnxiety - userAvgAnxiety).abs();
        potentialMembers.add({
          'uid': userId,
          'displayName': userData['displayName'] ?? 'User',
          'profilePicture': userData['profilePicture'],
          'similarityScore': 400 - totalDiff,
          'emotionalState': {
            'happiness': userAvgHappiness,
            'energy': userAvgEnergy,
            'stress': userAvgStress,
            'anxiety': userAvgAnxiety,
          },
        });
      }
      potentialMembers.sort(
        (a, b) => (b['similarityScore'] as num).compareTo(a['similarityScore'] as num),
      );
      return {
        'success': true,
        'members': potentialMembers.take(limitCount).toList(),
      };
    } catch (error) {
      debugPrint('âŒ Error getting crew members: $error');
      return {'success': false, 'error': error.toString(), 'members': <Map<String, dynamic>>[]};
    }
  }

  Future<Map<String, dynamic>> getActiveUsersWithReflections([int days = 7]) async {
    try {
      final dateIds = <String>[];
      for (var i = 0; i <= days; i++) {
        dateIds.add(getDateId(DateTime.now().subtract(Duration(days: i))));
      }
      final usersSnapshot = await _db.collection('users').get();
      final activeUsers = <Map<String, dynamic>>[];
      for (final userDoc in usersSnapshot.docs) {
        final userId = userDoc.id;
        final userData = userDoc.data();
        final metadataSnap = await _db.doc('usersMetadata/$userId').get();
        final metadata = metadataSnap.exists ? metadataSnap.data()! : <String, dynamic>{};
        var hasRecentReflection = false;
        for (final dateId in dateIds) {
          try {
            final reflectionSnap =
                await _db.doc('users/$userId/days/$dateId/reflection/meta').get();
            if (reflectionSnap.exists) {
              final reflectionData = reflectionSnap.data()!;
              final summary = reflectionData['summary'] as String? ?? '';
              final reflection = reflectionData['reflection'] as String? ?? '';
              if (summary.trim().isNotEmpty || reflection.trim().isNotEmpty) {
                hasRecentReflection = true;
                break;
              }
            }
          } catch (_) {}
        }
        if (!hasRecentReflection) {
          for (final dateId in dateIds) {
            try {
              final reflectionSnap =
                  await _db.doc('users/$userId/dayReflections/$dateId').get();
              if (reflectionSnap.exists) {
                final reflectionData = reflectionSnap.data()!;
                final reflection = reflectionData['reflection'] as String? ?? '';
                if (reflection.trim().isNotEmpty) {
                  hasRecentReflection = true;
                  break;
                }
              }
            } catch (_) {}
          }
        }
        if (hasRecentReflection) {
          activeUsers.add({
            'uid': userId,
            'displayName': userData['displayName'] ?? metadata['displayName'] ?? 'User',
            'profilePicture': metadata['profilePicture'],
            'email': userData['email'],
          });
        }
      }
      return {'success': true, 'users': activeUsers};
    } catch (error) {
      debugPrint('âŒ Error getting active users with messages: $error');
      return {'success': false, 'error': error.toString(), 'users': <Map<String, dynamic>>[]};
    }
  }

  Future<Map<String, dynamic>> createCrewSphere(
    String creatorUid,
    List<String> memberUids,
  ) async {
    try {
      final dateId = getDateId(DateTime.now());
      final sphereId = _db.collection('crewSpheres').doc().id;
      final allMembers = [creatorUid, ...memberUids];
      await _db.doc('crewSpheres/$sphereId').set({
        'id': sphereId,
        'creatorUid': creatorUid,
        'members': allMembers,
        'createdAt': FieldValue.serverTimestamp(),
        'startDate': dateId,
        'isActive': true,
      });
      final podCreationResults = <Map<String, dynamic>>[];
      for (final memberUid in allMembers) {
        try {
          await _db.doc('users/$memberUid/pods/$sphereId').set({
            'name': "Crew's Sphere",
            'startDate': dateId,
            'sphereId': sphereId,
            'members': allMembers,
            'createdAt': FieldValue.serverTimestamp(),
            'updatedAt': FieldValue.serverTimestamp(),
            'memberCount': allMembers.length,
          }, SetOptions(merge: true));
          podCreationResults.add({'uid': memberUid, 'success': true});
        } catch (podError) {
          podCreationResults.add({
            'uid': memberUid,
            'success': false,
            'error': podError.toString(),
          });
        }
      }
      return {'success': true, 'sphereId': sphereId, 'podCreationResults': podCreationResults};
    } catch (error) {
      debugPrint('Error creating crew sphere: $error');
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> updateUserMetadata(
    String uid,
    Map<String, dynamic> userData,
  ) async {
    try {
      await _db.doc('usersMetadata/$uid').set({
        ...userData,
        'lastActive': FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
      return {'success': true};
    } catch (error) {
      debugPrint('Error updating user metadata: $error');
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> updateCrewEnrollment(
    String uid,
    bool enrolled, [
    String? optOutReason,
  ]) async {
    try {
      final userRef = _db.doc('users/$uid');
      final metaRef = _db.doc('usersMetadata/$uid');
      if (enrolled) {
        final payload = {
          'enrolled_for_crew': true,
          'crew_opt_out_reason': FieldValue.delete(),
          'crew_opt_out_timestamp': FieldValue.delete(),
          'updatedAt': FieldValue.serverTimestamp(),
        };
        await Future.wait([
          userRef.set(payload, SetOptions(merge: true)),
          metaRef.set({...payload, 'lastActive': FieldValue.serverTimestamp()},
              SetOptions(merge: true)),
        ]);
      } else {
        final payload = {
          'enrolled_for_crew': false,
          'crew_opt_out_reason': optOutReason ?? 'Other',
          'crew_opt_out_timestamp': FieldValue.serverTimestamp(),
          'updatedAt': FieldValue.serverTimestamp(),
        };
        await Future.wait([
          userRef.set(payload, SetOptions(merge: true)),
          metaRef.set({...payload, 'lastActive': FieldValue.serverTimestamp()},
              SetOptions(merge: true)),
        ]);
      }
      return {'success': true};
    } catch (error) {
      debugPrint('Error updating crew enrollment: $error');
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> getTotalUserCount() async {
    try {
      String? currentUserUid;
      try {
        final currentUser = _getCurrentUser();
        currentUserUid = currentUser?.uid;
      } catch (authError) {
        debugPrint('âš ï¸ Could not get current user: $authError');
      }

      try {
        final usersSnapshot = await _db.collection('users').get();
        final usersCount = usersSnapshot.size;
        if (usersCount > 0) return {'success': true, 'count': usersCount};
      } on FirebaseException catch (usersError) {
        if (usersError.code == 'permission-denied') {
          debugPrint('âš ï¸ Permission denied for users collection.');
        }
      } catch (usersError) {
        debugPrint('âš ï¸ Could not count from users collection: $usersError');
      }

      try {
        final metadataSnapshot = await _db.collection('usersMetadata').get();
        if (metadataSnapshot.size > 0) {
          return {'success': true, 'count': metadataSnapshot.size};
        }
      } catch (metadataError) {
        debugPrint('âš ï¸ Could not count from usersMetadata: $metadataError');
      }

      try {
        final postsSnapshot = await _db.collection('communityPosts').get();
        final uniqueUserIds = <String>{};
        for (final doc in postsSnapshot.docs) {
          final userId = doc.data()['userId'];
          if (userId != null) uniqueUserIds.add(userId as String);
        }
        if (uniqueUserIds.isNotEmpty) {
          return {'success': true, 'count': uniqueUserIds.length};
        }
      } catch (postsError) {
        debugPrint('âš ï¸ Could not count from communityPosts: $postsError');
      }

      try {
        final userUids = <String>{};
        final usersSnapshot = await _db.collection('users').get();
        for (final doc in usersSnapshot.docs) {
          userUids.add(doc.id);
        }
        try {
          final daysSnapshot = await _db.collectionGroup('days').get();
          for (final doc in daysSnapshot.docs) {
            final pathParts = doc.reference.path.split('/');
            if (pathParts.length >= 2 && pathParts[0] == 'users') {
              userUids.add(pathParts[1]);
            }
          }
        } catch (collectionGroupError) {
          debugPrint(
            'âš ï¸ collectionGroup query failed: ${collectionGroupError.toString()}',
          );
        }
        try {
          final chatsSnapshot = await _db.collectionGroup('chats').get();
          for (final doc in chatsSnapshot.docs) {
            final pathParts = doc.reference.path.split('/');
            if (pathParts.length >= 2 && pathParts[0] == 'users') {
              userUids.add(pathParts[1]);
            }
          }
        } catch (chatsError) {
          debugPrint('âš ï¸ collectionGroup for chats failed: ${chatsError.toString()}');
        }
        if (userUids.isNotEmpty) return {'success': true, 'count': userUids.length};
      } catch (subcollectionsError) {
        debugPrint('âš ï¸ Could not count from subcollections: $subcollectionsError');
      }

      if (currentUserUid != null) {
        return {'success': true, 'count': 1};
      }
      return {'success': true, 'count': 0};
    } catch (error) {
      debugPrint('âŒ Error getting user count: $error');
      return {'success': false, 'error': error.toString(), 'count': 0};
    }
  }

  Future<Map<String, dynamic>> getUserCrewSphere(String uid) async {
    try {
      final podsSnapshot = await _db.collection('users/$uid/pods').get();
      for (final podDoc in podsSnapshot.docs) {
        final podData = podDoc.data();
        final sphereId = podData['sphereId'] as String?;
        if (sphereId != null) {
          final sphereSnap = await _db.doc('crewSpheres/$sphereId').get();
          if (sphereSnap.exists) {
            final sphereData = sphereSnap.data()!;
            final members = sphereData['members'];
            if (members is List && members.contains(uid)) {
              return {'success': true, 'sphereId': sphereId, 'sphere': sphereData};
            }
          }
        }
      }

      try {
        QuerySnapshot<Map<String, dynamic>> spheresSnapshot;
        try {
          spheresSnapshot = await _db
              .collection('crewSpheres')
              .orderBy('createdAt', descending: true)
              .limit(50)
              .get();
        } catch (_) {
          spheresSnapshot = await _db.collection('crewSpheres').limit(50).get();
        }

        for (final sphereDoc in spheresSnapshot.docs) {
          final sphereData = sphereDoc.data();
          final members = sphereData['members'];
          if (members is List && members.contains(uid)) {
            final sphereId = sphereDoc.id;
            final podRef = _db.doc('users/$uid/pods/$sphereId');
            final dateId = sphereData['startDate'] as String? ?? getDateId(DateTime.now());
            podRef.set({
              'name': "Crew's Sphere",
              'startDate': dateId,
              'sphereId': sphereId,
              'members': members,
              'createdAt': FieldValue.serverTimestamp(),
              'updatedAt': FieldValue.serverTimestamp(),
              'memberCount': members.length,
            }, SetOptions(merge: true)).catchError((Object podError) {
              debugPrint('âš ï¸ Could not create pod document: $podError');
            });
            return {'success': true, 'sphereId': sphereId, 'sphere': sphereData};
          }
        }
      } catch (queryError) {
        debugPrint('âš ï¸ Could not query spheres: $queryError');
      }

      return {'success': false, 'sphereId': null};
    } catch (error) {
      debugPrint('Error getting user crew sphere: $error');
      return {'success': false, 'error': error.toString(), 'sphereId': null};
    }
  }

  Future<Map<String, dynamic>> syncUserPodDocuments(String uid) async {
    try {
      QuerySnapshot<Map<String, dynamic>> spheresSnapshot;
      try {
        spheresSnapshot = await _db
            .collection('crewSpheres')
            .orderBy('createdAt', descending: true)
            .limit(50)
            .get();
      } catch (_) {
        spheresSnapshot = await _db.collection('crewSpheres').limit(50).get();
      }

      final podPromises = <Future<int>>[];
      for (final sphereDoc in spheresSnapshot.docs) {
        final sphereData = sphereDoc.data();
        final sphereId = sphereDoc.id;
        final members = sphereData['members'];
        if (members is! List || !members.contains(uid)) continue;
        podPromises.add(() async {
          try {
            final podRef = _db.doc('users/$uid/pods/$sphereId');
            final podSnap = await podRef.get();
            if (!podSnap.exists) {
              final dateId =
                  sphereData['startDate'] as String? ?? getDateId(DateTime.now());
              await podRef.set({
                'name': "Crew's Sphere",
                'startDate': dateId,
                'sphereId': sphereId,
                'members': members,
                'createdAt': FieldValue.serverTimestamp(),
                'updatedAt': FieldValue.serverTimestamp(),
                'memberCount': members.length,
              }, SetOptions(merge: true));
              return 1;
            }
            return 0;
          } catch (_) {
            return 0;
          }
        }());
      }
      final results = await Future.wait(podPromises);
      final syncedCount = results.fold<int>(0, (a, b) => a + b);
      return {'success': true, 'syncedCount': syncedCount};
    } catch (error) {
      debugPrint('Error syncing pod documents: $error');
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> saveCrewSphereMessage(
    String sphereId,
    String senderUid,
    Map<String, dynamic> messageData,
  ) async {
    try {
      final messageRef = _db.collection('crewSpheres/$sphereId/messages').doc();
      await messageRef.set({
        'id': messageRef.id,
        'senderUid': senderUid,
        'senderName': messageData['senderName'] ?? 'User',
        'message': messageData['message'] ?? '',
        'image': messageData['image'],
        'timestamp': FieldValue.serverTimestamp(),
        'createdAt': FieldValue.serverTimestamp(),
      });
      return {'success': true, 'messageId': messageRef.id};
    } catch (error) {
      debugPrint('Error saving crew sphere message: $error');
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> getCrewSphereMessages(String sphereId) async {
    try {
      final snapshot = await _db
          .collection('crewSpheres/$sphereId/messages')
          .orderBy('timestamp')
          .get();
      final messages = snapshot.docs.map((doc) {
        final data = doc.data();
        final timestamp = _toDate(data['timestamp'] ?? data['createdAt']);
        return {
          'id': doc.id,
          'senderUid': data['senderUid'],
          'sender': data['senderName'] ?? 'User',
          'message': data['message'] ?? '',
          'image': data['image'],
          'timestamp': timestamp,
          'time': _formatTime(timestamp),
        };
      }).toList();
      return {'success': true, 'messages': messages};
    } catch (error) {
      debugPrint('Error getting crew sphere messages: $error');
      return {'success': false, 'error': error.toString(), 'messages': <Map<String, dynamic>>[]};
    }
  }

  void Function() subscribeToCrewSphereMessages(
    String sphereId,
    void Function(List<Map<String, dynamic>> messages) callback,
  ) {
    try {
      final sub = _db
          .collection('crewSpheres/$sphereId/messages')
          .orderBy('timestamp')
          .snapshots()
          .listen(
        (snapshot) {
          final messages = snapshot.docs.map((doc) {
            final data = doc.data();
            final timestamp = _toDate(data['timestamp'] ?? data['createdAt']);
            return {
              'id': doc.id,
              'senderUid': data['senderUid'],
              'sender': data['senderName'] ?? 'User',
              'message': data['message'] ?? '',
              'image': data['image'],
              'timestamp': timestamp,
              'time': _formatTime(timestamp),
            };
          }).toList();
          callback(messages);
        },
        onError: (Object error) {
          debugPrint('Error in crew sphere messages listener: $error');
          callback([]);
        },
      );
      return () {
        sub.cancel();
      };
    } catch (error) {
      debugPrint('Error setting up crew sphere messages listener: $error');
      return () {};
    }
  }

  String sportsTrendingDocIdFromUrl(String url) {
    final s = url;
    var h = 0;
    for (var i = 0; i < s.length; i++) {
      h = _imul(31, h) + s.codeUnitAt(i);
    }
    return 'st_${h.abs().toRadixString(36)}';
  }

  int computeSportsTrendingScore(dynamic likes, dynamic shares, dynamic views) {
    final l = (likes is num ? likes : num.tryParse('$likes') ?? 0).toInt();
    final s = (shares is num ? shares : num.tryParse('$shares') ?? 0).toInt();
    final v = (views is num ? views : num.tryParse('$views') ?? 0).toInt();
    return l * 3 + s * 5 + v;
  }

  Future<Map<String, dynamic>> getSportsTrendingByCountry(
    String countryUpper, [
    int limitCount = 10,
  ]) async {
    try {
      final upper = countryUpper.toUpperCase();
      final c = upper.length >= 2 ? upper.substring(0, 2) : upper;
      if (c.length != 2) return {'success': true, 'items': <Map<String, dynamic>>[]};
      final lim = limitCount.clamp(1, 30);
      final snap = await _db
          .collection('podSportsTrending')
          .where('country', isEqualTo: c)
          .orderBy('trendingScore', descending: true)
          .limit(lim)
          .get();
      final items = snap.docs.map((d) {
        final x = d.data();
        var createdAtMs = 0;
        try {
          final ts = x['createdAt'];
          if (ts is Timestamp) {
            createdAtMs = ts.millisecondsSinceEpoch;
          } else if (ts is Map && ts['seconds'] is num) {
            createdAtMs = ((ts['seconds'] as num).toInt()) * 1000;
          }
        } catch (_) {}
        return {
          'id': d.id,
          'firestoreId': d.id,
          'title': x['title'] ?? '',
          'source': x['source'] ?? 'News',
          'url': x['url'] ?? '',
          'image': x['image'],
          'category': x['category'] ?? '',
          'country': x['country'] ?? c,
          'city': x['city'] is String ? x['city'] : null,
          'likes': (x['likes'] as num?)?.toInt() ?? 0,
          'shares': (x['shares'] as num?)?.toInt() ?? 0,
          'views': (x['views'] as num?)?.toInt() ?? 0,
          'trendingScore': (x['trendingScore'] as num?)?.toInt() ?? 0,
          'createdAtMs': createdAtMs,
        };
      }).toList();
      return {'success': true, 'items': items};
    } catch (error) {
      debugPrint('getSportsTrendingByCountry: $error');
      return {'success': false, 'items': <Map<String, dynamic>>[], 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> ensureSportsTrendingNewsItem(
    Map<String, dynamic> payload,
  ) async {
    try {
      final url = (payload['url'] ?? '').toString().trim();
      if (url.isEmpty) return {'success': false, 'error': 'missing url'};
      final id = sportsTrendingDocIdFromUrl(url);
      final docRef = _db.doc('podSportsTrending/$id');
      final snap = await docRef.get();
      if (snap.exists) return {'success': true, 'id': id, 'existed': true};
      final countryRaw = (payload['country'] ?? '').toString().toUpperCase().replaceAll(RegExp(r'[^A-Z]'), '');
      final country = countryRaw.length >= 2 ? countryRaw.substring(0, 2) : countryRaw;
      if (country.length != 2) return {'success': false, 'error': 'invalid country'};
      final cityRaw = payload['city'];
      final cityTrim = cityRaw is String && cityRaw.trim().isNotEmpty
          ? cityRaw.trim().substring(0, cityRaw.trim().length.clamp(0, 120))
          : '';
      final row = <String, dynamic>{
        'title': (payload['title'] ?? '').toString().substring(
            0, (payload['title'] ?? '').toString().length.clamp(0, 500)),
        'source': (payload['source'] ?? 'News').toString().substring(
            0, (payload['source'] ?? 'News').toString().length.clamp(0, 200)),
        'url': url,
        'image': payload['image'],
        'category': (payload['category'] ?? '').toString().substring(
            0, (payload['category'] ?? '').toString().length.clamp(0, 80)),
        'country': country,
        'likes': 0,
        'shares': 0,
        'views': 0,
        'trendingScore': 0,
        'createdAt': FieldValue.serverTimestamp(),
      };
      if (cityTrim.isNotEmpty) row['city'] = cityTrim;
      await docRef.set(row);
      return {'success': true, 'id': id, 'existed': false};
    } catch (error) {
      debugPrint('ensureSportsTrendingNewsItem: $error');
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> incrementSportsTrendingEngagement(
    String docId,
    String kind,
  ) async {
    try {
      final id = docId.trim();
      if (id.isEmpty || !['like', 'share', 'view'].contains(kind)) {
        return {'success': false};
      }
      final docRef = _db.doc('podSportsTrending/$id');
      await _db.runTransaction((transaction) async {
        final snap = await transaction.get(docRef);
        if (!snap.exists) return;
        final d = snap.data()!;
        var likes = (d['likes'] as num?)?.toInt() ?? 0;
        var shares = (d['shares'] as num?)?.toInt() ?? 0;
        var views = (d['views'] as num?)?.toInt() ?? 0;
        if (kind == 'like') {
          likes += 1;
        } else if (kind == 'share') {
          shares += 1;
        } else if (kind == 'view') {
          views += 1;
        }
        final trendingScore = computeSportsTrendingScore(likes, shares, views);
        transaction.update(docRef, {
          'likes': likes,
          'shares': shares,
          'views': views,
          'trendingScore': trendingScore,
        });
      });
      return {'success': true};
    } catch (error) {
      debugPrint('incrementSportsTrendingEngagement: $error');
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> getSportsExploreStats(String uid) async {
    final id = uid.trim();
    if (id.isEmpty) return {};
    try {
      final snap = await _db.doc('users/$id').get();
      if (!snap.exists) return {};
      final raw = snap.data()?['sportsExploreStats'];
      if (raw is Map<String, dynamic>) return Map<String, dynamic>.from(raw);
      return {};
    } catch (error) {
      debugPrint('getSportsExploreStats: $error');
      return {};
    }
  }

  Future<Map<String, dynamic>> mergeSportsExploreStats(
    String uid,
    String slug, {
    num secondsDelta = 0,
    num visitInc = 0,
  }) async {
    final id = uid.trim();
    final key = slug.trim();
    if (id.isEmpty || key.isEmpty) return {'success': false};
    final sd = (secondsDelta.round()).clamp(0, 86400);
    final vi = (visitInc.round()).clamp(0, 200);
    if (sd == 0 && vi == 0) return {'success': true};
    try {
      final docRef = _db.doc('users/$id');
      await _db.runTransaction((tx) async {
        final snap = await tx.get(docRef);
        final prev = snap.exists ? snap.data()! : <String, dynamic>{};
        final prevStats = prev['sportsExploreStats'];
        final stats = prevStats is Map<String, dynamic>
            ? Map<String, dynamic>.from(prevStats)
            : <String, dynamic>{};
        final cur = stats[key] is Map ? Map<String, dynamic>.from(stats[key] as Map) : {'seconds': 0, 'visits': 0};
        final nextSec = (((cur['seconds'] as num?)?.toInt() ?? 0) + sd).clamp(0, 7 * 86400);
        final nextVis = ((cur['visits'] as num?)?.toInt() ?? 0) + vi;
        stats[key] = {
          'seconds': nextSec,
          'visits': nextVis,
          'updatedAt': FieldValue.serverTimestamp(),
        };
        tx.set(docRef, {'sportsExploreStats': stats}, SetOptions(merge: true));
      });
      return {'success': true};
    } catch (error) {
      debugPrint('mergeSportsExploreStats: $error');
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> mergeSportsSurfaceSeconds(
    String uid,
    num deltaSec,
  ) async {
    final id = uid.trim();
    final d = deltaSec.round().clamp(0, 7200);
    if (id.isEmpty || d < 1) return {'success': false};
    try {
      final docRef = _db.doc('users/$id');
      await _db.runTransaction((tx) async {
        final snap = await tx.get(docRef);
        final prev = snap.exists ? snap.data()! : <String, dynamic>{};
        final cur = (prev['sportsSurfaceSeconds'] as num?)?.toInt() ?? 0;
        tx.set(docRef, {'sportsSurfaceSeconds': cur + d}, SetOptions(merge: true));
      });
      return {'success': true};
    } catch (error) {
      debugPrint('mergeSportsSurfaceSeconds: $error');
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<void> addCommunityPost(Map<String, dynamic> postData) async {
    await _db.collection('communityPosts').add(postData);
  }

  Stream<List<CommunityPost>> watchCommunityPosts({int limitCount = 100}) {
    return _db
        .collection('communityPosts')
        .orderBy('createdAt', descending: true)
        .limit(limitCount)
        .snapshots()
        .map((snap) => snap.docs.map((d) => CommunityPost.fromMap(d.id, _mapPostDoc(d))).toList());
  }

  Stream<List<Map<String, dynamic>>> streamCommunityPosts({int limitCount = 100}) {
    return watchCommunityPosts(limitCount: limitCount).map(
      (posts) => posts
          .map(
            (p) => {
              'id': p.id,
              'content': p.content,
              'author': p.author,
              'authorId': p.authorId,
              'createdAt': p.createdAt,
              'image': p.image,
              'profilePicture': p.profilePicture,
              'likes': p.likes,
              'likedBy': p.likedBy,
            },
          )
          .toList(),
    );
  }

  Future<Map<String, dynamic>> togglePostLike(String postId, String uid, bool liked) async {
    try {
      final likeRef = _db.doc('communityPosts/$postId/likes/$uid');
      if (liked) {
        await likeRef.set({'createdAt': FieldValue.serverTimestamp()});
      } else {
        await likeRef.delete();
      }
      return {'success': true};
    } catch (error) {
      return {'success': false, 'error': error.toString()};
    }
  }
}

class CommunityPost {
  CommunityPost({
    required this.id,
    required this.content,
    this.author,
    this.authorId,
    this.createdAt,
    this.image,
    this.profilePicture,
    this.likes = 0,
    this.likedBy = const [],
  });

  factory CommunityPost.fromMap(String id, Map<String, dynamic> data) {
    return CommunityPost(
      id: id,
      content: data['content'] as String? ?? '',
      author: data['author'] as String?,
      authorId: data['authorId'] as String?,
      createdAt: data['createdAt'] is DateTime ? data['createdAt'] as DateTime : null,
      image: data['image'] as String?,
      profilePicture: data['profilePicture'] as String?,
      likes: (data['likes'] as num?)?.toInt() ?? 0,
      likedBy: (data['likedBy'] as List?)?.cast<String>() ?? const [],
    );
  }

  final String id;
  final String content;
  final String? author;
  final String? authorId;
  final DateTime? createdAt;
  final String? image;
  final String? profilePicture;
  final int likes;
  final List<String> likedBy;
}

final firestoreService = FirestoreService.instance;
