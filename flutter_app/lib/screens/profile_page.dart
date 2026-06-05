import 'dart:convert';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:go_router/go_router.dart';
import 'package:image_cropper/image_cropper.dart';
import 'package:image_picker/image_picker.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import '../contexts/theme_context.dart';
import '../router/app_router.dart';
import '../services/auth_service.dart';
import '../services/firestore_service.dart';
import '../utils/hub_colors.dart';
import '../utils/profile_bio_analysis.dart';
import '../utils/profile_picture_helper.dart';
import 'profile_details_page.dart';

/// Global notifier so other screens refresh avatar after profile edits.
class ProfilePictureNotifier {
  ProfilePictureNotifier._();
  static final ProfilePictureNotifier instance = ProfilePictureNotifier._();
  final ValueNotifier<int> revision = ValueNotifier(0);
  void notifyUpdated() => revision.value++;
}

class ProfilePage extends StatefulWidget {
  const ProfilePage({super.key});

  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfileEditData {
  String displayName = '';
  String age = '';
  String gender = '';
  String bio = '';
  String birthday = '';
}

class _ProfilePageState extends State<ProfilePage> {
  User? _user;
  bool _isEditing = false;
  bool _loading = false;
  bool _fullDeleteLoading = false;
  bool _showFullDeleteConfirm = false;
  String? _profilePicture;
  bool _showAvatarModal = false;
  bool _showPhotoPreviewModal = false;
  bool _showBirthdayCalendar = false;
  bool _helpExpanded = false;
  DateTime? _birthdayDate;
  final _editData = _ProfileEditData();
  final _nameEditController = TextEditingController();
  final _picker = ImagePicker();

  static const _avatars = [
    ('Apple', 'assets/images/apple-avatar.png'),
    ('Pineapple', 'assets/images/pineapple-avatar.png'),
    ('Carrot', 'assets/images/carrot-avatar.png'),
    ('Banana', 'assets/images/banana-avatar.png'),
    ('Strawberry', 'assets/images/strawberry-avatar.png'),
    ('Broccoli', 'assets/images/broccoli-avatar.png'),
  ];

  @override
  void initState() {
    super.initState();
    _loadUser();
  }

  @override
  void dispose() {
    _nameEditController.dispose();
    super.dispose();
  }

  Future<void> _loadUser() async {
    final user = AuthService().getCurrentUser();
    if (user == null) {
      if (mounted) context.go(AppRoutes.signup);
      return;
    }

    final prefs = await SharedPreferences.getInstance();
    final savedBirthday = prefs.getString('user_birthday_${user.uid}') ?? '';
    final calculatedAge = savedBirthday.isNotEmpty
        ? _calculateAgeFromBirthday(savedBirthday)
        : (prefs.getString('user_age_${user.uid}') ?? '');

    setState(() {
      _user = user;
      _editData.displayName = prefs.getString('user_display_name_${user.uid}') ?? user.displayName ?? '';
      _nameEditController.text = _editData.displayName;
      _editData.age = calculatedAge;
      _editData.gender = prefs.getString('user_gender_${user.uid}') ?? '';
      _editData.bio = prefs.getString('user_bio_${user.uid}') ?? '';
      _editData.birthday = savedBirthday;
      if (savedBirthday.isNotEmpty) {
        _birthdayDate = DateTime.tryParse(savedBirthday);
      }
    });

    await _loadProfilePicture(user.uid, prefs);
    await _ensureDailyBioSummary(user.uid, prefs);
  }

  Future<void> _loadProfilePicture(String uid, SharedPreferences prefs) async {
    try {
      final result = await FirestoreService.instance.getUser(uid);
      if (result['success'] == true) {
        final data = result['data'] as Map<String, dynamic>?;
        final pic = data?['profilePicture'] as String?;
        if (pic != null && pic.isNotEmpty) {
          await prefs.setString('user_profile_picture_$uid', pic);
          if (mounted) setState(() => _profilePicture = pic);
          return;
        }
      }
    } catch (_) {}
    if (mounted) {
      setState(() => _profilePicture = prefs.getString('user_profile_picture_$uid'));
    }
  }

  Future<void> _ensureDailyBioSummary(String uid, SharedPreferences prefs) async {
    final updatedKey = 'user_bio_updated_$uid';
    final lastUpdatedISO = prefs.getString(updatedKey);
    final needsRefresh = lastUpdatedISO == null || DateTime.parse(lastUpdatedISO).isBefore(getLast2Am());
    if (needsRefresh) {
      final summary = await generateAutoBioSummary(
        uid: uid,
        displayName: _editData.displayName,
        age: _editData.age,
        gender: _editData.gender,
      );
      if (summary != null && summary.isNotEmpty) {
        await _persistBioSummary(uid, summary, prefs);
      }
    }
  }

  Future<void> _persistBioSummary(String uid, String summary, SharedPreferences prefs) async {
    final timestamp = DateTime.now().toIso8601String();
    await prefs.setString('user_bio_$uid', summary);
    await prefs.setString('user_bio_updated_$uid', timestamp);
    if (mounted) setState(() => _editData.bio = summary);
  }

  String _calculateAgeFromBirthday(String birthdayString) {
    final birthDate = DateTime.tryParse(birthdayString);
    if (birthDate == null) return '';
    final today = DateTime.now();
    var age = today.year - birthDate.year;
    if (today.month < birthDate.month || (today.month == birthDate.month && today.day < birthDate.day)) {
      age--;
    }
    return age.toString();
  }

  String _formatDate(DateTime date) {
    final y = date.year.toString().padLeft(4, '0');
    final m = date.month.toString().padLeft(2, '0');
    final d = date.day.toString().padLeft(2, '0');
    return '$y-$m-$d';
  }

  String _formatDateDisplay(String? dateString) {
    if (dateString == null || dateString.isEmpty) return '';
    final date = DateTime.tryParse(dateString);
    if (date == null) return '';
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    return '${months[date.month - 1]} ${date.day}, ${date.year}';
  }

  String _getInitials(String? name) {
    if (name == null || name.isEmpty) return 'U';
    return name.split(' ').map((n) => n.isNotEmpty ? n[0] : '').join().toUpperCase();
  }

  Future<String?> _compressDataUrlForStorage(String dataUrl, {int maxSizeKb = 800}) async {
    try {
      if (!dataUrl.startsWith('data:')) return dataUrl;
      final comma = dataUrl.indexOf(',');
      if (comma < 0) return dataUrl;
      final bytes = base64Decode(dataUrl.substring(comma + 1));
      var quality = 85;
      Uint8List? out = bytes;
      while (quality >= 20) {
        out = await FlutterImageCompress.compressWithList(
          bytes,
          minWidth: 480,
          minHeight: 480,
          quality: quality,
        );
        if (out.length <= maxSizeKb * 1024) break;
        quality -= 10;
      }
      return 'data:image/jpeg;base64,${base64Encode(out!)}';
    } catch (_) {
      return dataUrl;
    }
  }

  Future<void> _handleSave() async {
    final user = _user;
    if (user == null) return;

    setState(() => _loading = true);
    try {
      if (_editData.displayName.trim().isNotEmpty && _editData.displayName.trim() != user.displayName) {
        await user.updateDisplayName(_editData.displayName.trim());
        setState(() => _user = AuthService().getCurrentUser());
      }

      var ageToSave = _editData.age;
      if (_editData.birthday.isNotEmpty) {
        ageToSave = _calculateAgeFromBirthday(_editData.birthday);
      }

      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('user_display_name_${user.uid}', _editData.displayName.trim());
      await prefs.setString('user_age_${user.uid}', ageToSave);
      await prefs.setString('user_gender_${user.uid}', _editData.gender);
      await prefs.setString('user_bio_${user.uid}', _editData.bio);
      if (_editData.birthday.isNotEmpty) {
        await prefs.setString('user_birthday_${user.uid}', _editData.birthday);
      }

      if (_profilePicture != null) {
        await prefs.setString('user_profile_picture_${user.uid}', _profilePicture!);
      } else {
        await prefs.remove('user_profile_picture_${user.uid}');
      }

      setState(() => _editData.age = ageToSave);

      try {
        var pictureForFirestore = _profilePicture;
        if (pictureForFirestore != null && pictureForFirestore.startsWith('data:')) {
          pictureForFirestore = await _compressDataUrlForStorage(pictureForFirestore);
        }
        await FirestoreService.instance.ensureUser(user.uid, {
          'displayName': _editData.displayName.trim().isNotEmpty ? _editData.displayName.trim() : user.displayName ?? 'User',
          'email': user.email,
          'profilePicture': pictureForFirestore,
        });
      } catch (_) {}

      ProfilePictureNotifier.instance.notifyUpdated();
      setState(() => _isEditing = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Profile saved successfully!')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Error updating profile. Please try again.')));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _handleCancel() async {
    final user = _user;
    if (user == null) return;
    final prefs = await SharedPreferences.getInstance();
    final savedBirthday = prefs.getString('user_birthday_${user.uid}') ?? '';
    final calculatedAge = savedBirthday.isNotEmpty
        ? _calculateAgeFromBirthday(savedBirthday)
        : (prefs.getString('user_age_${user.uid}') ?? '');

    setState(() {
      _editData.displayName = prefs.getString('user_display_name_${user.uid}') ?? user.displayName ?? '';
      _nameEditController.text = _editData.displayName;
      _editData.age = calculatedAge;
      _editData.gender = prefs.getString('user_gender_${user.uid}') ?? '';
      _editData.bio = prefs.getString('user_bio_${user.uid}') ?? '';
      _editData.birthday = savedBirthday;
      _profilePicture = prefs.getString('user_profile_picture_${user.uid}');
      _isEditing = false;
    });
  }

  Future<void> _handleAvatarSelect(String assetPath) async {
    final user = _user;
    if (user == null) return;
    setState(() {
      _profilePicture = assetPath;
      _showAvatarModal = false;
    });
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('user_profile_picture_${user.uid}', assetPath);
    try {
      await FirestoreService.instance.ensureUser(user.uid, {'profilePicture': assetPath});
    } catch (_) {}
    ProfilePictureNotifier.instance.notifyUpdated();
  }

  Future<void> _pickAndCropImage(ImageSource source) async {
    final file = await _picker.pickImage(source: source, maxWidth: 2000);
    if (file == null) return;

    final cropped = await ImageCropper().cropImage(
      sourcePath: file.path,
      aspectRatio: const CropAspectRatio(ratioX: 1, ratioY: 1),
      uiSettings: [
        AndroidUiSettings(toolbarTitle: 'Adjust your photo', hideBottomControls: false),
        IOSUiSettings(title: 'Adjust your photo'),
      ],
    );
    if (cropped == null) return;

    final bytes = await cropped.readAsBytes();
    if (bytes.length > 5 * 1024 * 1024) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Image size should be less than 5MB')));
      }
      return;
    }

    final dataUrl = 'data:image/jpeg;base64,${base64Encode(bytes)}';
    setState(() {
      _profilePicture = dataUrl;
      _showAvatarModal = false;
      _showPhotoPreviewModal = false;
    });

    final user = _user;
    if (user != null) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('user_profile_picture_${user.uid}', dataUrl);
      try {
        final toStore = await _compressDataUrlForStorage(dataUrl);
        await FirestoreService.instance.ensureUser(user.uid, {'profilePicture': toStore});
      } catch (_) {}
      ProfilePictureNotifier.instance.notifyUpdated();
    }
  }

  Future<void> _handleRemoveProfilePicture() async {
    setState(() => _profilePicture = null);
    final user = _user;
    if (user == null) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('user_profile_picture_${user.uid}');
    try {
      await FirestoreService.instance.ensureUser(user.uid, {'profilePicture': null});
    } catch (_) {}
    ProfilePictureNotifier.instance.notifyUpdated();
  }

  Future<void> _handleSignOut() async {
    final result = await AuthService().signOutUser();
    if (result.success && mounted) {
      context.go(AppRoutes.landing);
    } else if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Error signing out. Please try again.')));
    }
  }

  Future<void> _handleFullDeleteAccount() async {
    final user = _user;
    if (user == null) return;
    setState(() => _fullDeleteLoading = true);
    try {
      final uid = user.uid;
      final prefs = await SharedPreferences.getInstance();
      final keys = prefs.getKeys().where((k) => k.contains(uid)).toList();
      for (final k in keys) {
        await prefs.remove(k);
      }

      try {
        await FirebaseFirestore.instance.doc('users/$uid').delete();
        await FirebaseFirestore.instance.doc('usersMetadata/$uid').delete();
      } catch (_) {}

      await user.delete();
      if (mounted) context.go(AppRoutes.landing);
    } on FirebaseAuthException catch (e) {
      if (mounted) {
        if (e.code == 'requires-recent-login') {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('For security, please sign out and sign back in before deleting your account.')),
          );
        } else {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Error deleting account. Please try again.')));
        }
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Error deleting account. Please try again.')));
      }
    } finally {
      if (mounted) {
        setState(() {
          _fullDeleteLoading = false;
          _showFullDeleteConfirm = false;
        });
      }
    }
  }

  Widget _profileAvatar({double size = 64, VoidCallback? onTap}) {
    return GestureDetector(
      onTap: onTap,
      child: buildProfilePicture(
        picture: _profilePicture,
        size: size,
        initials: _getInitials(_editData.displayName.isNotEmpty ? _editData.displayName : _user?.displayName),
        backgroundColor: HubColors.divider,
      ),
    );
  }

  String get _displayName =>
      _editData.displayName.isNotEmpty ? _editData.displayName : (_user?.displayName ?? 'User');

  @override
  Widget build(BuildContext context) {
    final isDarkMode = context.watch<ThemeNotifier>().isDarkMode;
    if (_user == null) {
      return Scaffold(
        backgroundColor: isDarkMode ? HubColors.bg : const Color(0xFFF5F5F5),
        body: const Center(child: CircularProgressIndicator(color: HubColors.accent)),
      );
    }

    final rowBorder = Border(bottom: BorderSide(color: isDarkMode ? HubColors.divider : Colors.black.withValues(alpha: 0.06)));

    return Scaffold(
      backgroundColor: isDarkMode ? HubColors.bg : const Color(0xFFF5F5F5),
      body: Stack(
        children: [
          SafeArea(
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 480),
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(0, 8, 0, 32),
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      child: Row(
                        children: [
                          IconButton(
                            onPressed: () => context.go(AppRoutes.dashboard),
                            icon: Icon(LucideIcons.arrowLeft, color: isDarkMode ? HubColors.text : Colors.black87),
                          ),
                          Text(
                            'Settings',
                            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: isDarkMode ? HubColors.text : Colors.black87),
                          ),
                        ],
                      ),
                    ),
                    Container(
                      decoration: BoxDecoration(border: rowBorder),
                      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 20),
                      child: Row(
                        children: [
                          Stack(
                            children: [
                              _profileAvatar(
                                onTap: () => setState(() {
                                  if (_profilePicture != null) {
                                    _showPhotoPreviewModal = true;
                                  } else {
                                    _showAvatarModal = true;
                                  }
                                }),
                              ),
                              Positioned(
                                right: 0,
                                bottom: 0,
                                child: GestureDetector(
                                  onTap: () => setState(() => _showAvatarModal = true),
                                  child: Container(
                                    width: 24,
                                    height: 24,
                                    decoration: BoxDecoration(
                                      color: HubColors.accent,
                                      shape: BoxShape.circle,
                                      border: Border.all(color: isDarkMode ? HubColors.bg : const Color(0xFFF5F5F5), width: 2),
                                    ),
                                    child: const Icon(LucideIcons.camera, size: 12, color: Colors.white),
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(width: 16),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  _displayName,
                                  style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16, color: isDarkMode ? HubColors.text : Colors.black87),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                Text(
                                  _user!.email ?? '',
                                  style: const TextStyle(color: HubColors.textSecondary, fontSize: 14),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                            ),
                          ),
                          TextButton(
                            onPressed: () => setState(() => _isEditing = true),
                            style: TextButton.styleFrom(
                              foregroundColor: isDarkMode ? HubColors.text : Colors.black87,
                              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                              minimumSize: Size.zero,
                              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(8),
                                side: BorderSide(color: isDarkMode ? HubColors.divider : Colors.black26),
                              ),
                            ),
                            child: const Text('Edit', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                          ),
                        ],
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Container(
                        decoration: BoxDecoration(border: rowBorder),
                        child: Column(
                          children: [
                            InkWell(
                              onTap: () => setState(() => _helpExpanded = !_helpExpanded),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                                child: Row(
                                  children: [
                                    Icon(LucideIcons.shield, color: isDarkMode ? HubColors.text : Colors.black87, size: 24),
                                    const SizedBox(width: 16),
                                    Expanded(
                                      child: Text(
                                        'Help & Support',
                                        style: TextStyle(fontSize: 15, color: isDarkMode ? HubColors.text : Colors.black87),
                                      ),
                                    ),
                                    AnimatedRotation(
                                      turns: _helpExpanded ? 0.5 : 0,
                                      duration: const Duration(milliseconds: 200),
                                      child: Icon(LucideIcons.chevronDown, color: HubColors.textSecondary, size: 20),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                            if (_helpExpanded) ...[
                              InkWell(
                                onTap: () => launchUrl(Uri.parse('tel:9536138120')),
                                child: Container(
                                  decoration: BoxDecoration(
                                    border: Border(top: BorderSide(color: isDarkMode ? HubColors.divider : Colors.black.withValues(alpha: 0.04))),
                                  ),
                                  padding: const EdgeInsets.fromLTRB(56, 14, 20, 14),
                                  child: Row(
                                    children: [
                                      const Icon(LucideIcons.phone, color: HubColors.textSecondary, size: 20),
                                      const SizedBox(width: 16),
                                      Text('Call Support', style: TextStyle(color: isDarkMode ? HubColors.text : Colors.black87, fontSize: 14)),
                                    ],
                                  ),
                                ),
                              ),
                              InkWell(
                                onTap: () => launchUrl(Uri.parse('https://wa.me/919536138120'), mode: LaunchMode.externalApplication),
                                child: Container(
                                  decoration: BoxDecoration(
                                    border: Border(top: BorderSide(color: isDarkMode ? HubColors.divider : Colors.black.withValues(alpha: 0.04))),
                                  ),
                                  padding: const EdgeInsets.fromLTRB(56, 14, 20, 14),
                                  child: Row(
                                    children: [
                                      const Icon(LucideIcons.messageCircle, color: HubColors.textSecondary, size: 20),
                                      const SizedBox(width: 16),
                                      Text('WhatsApp Support', style: TextStyle(color: isDarkMode ? HubColors.text : Colors.black87, fontSize: 14)),
                                    ],
                                  ),
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(20, 24, 20, 0),
                        child: TextButton(
                          onPressed: _handleSignOut,
                          style: TextButton.styleFrom(
                            foregroundColor: const Color(0xFF3B82F6),
                            padding: EdgeInsets.zero,
                            minimumSize: Size.zero,
                            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          ),
                          child: const Text('Log out', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500)),
                        ),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Danger Zone', style: TextStyle(fontWeight: FontWeight.w600, color: isDarkMode ? HubColors.text : Colors.black87)),
                          const SizedBox(height: 12),
                          Container(
                            decoration: BoxDecoration(
                              border: Border.all(color: Colors.red.withValues(alpha: isDarkMode ? 0.4 : 0.35)),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            padding: const EdgeInsets.all(16),
                            child: Row(
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text('Delete account', style: TextStyle(fontWeight: FontWeight.w600, color: isDarkMode ? HubColors.text : Colors.black87)),
                                      const SizedBox(height: 4),
                                      const Text(
                                        'Permanently delete your account and all associated data. This cannot be undone.',
                                        style: TextStyle(color: HubColors.textSecondary, fontSize: 12),
                                      ),
                                    ],
                                  ),
                                ),
                                if (!_showFullDeleteConfirm)
                                  TextButton(
                                    onPressed: () => setState(() => _showFullDeleteConfirm = true),
                                    style: TextButton.styleFrom(
                                      foregroundColor: isDarkMode ? const Color(0xFFf87171) : const Color(0xFFdc2626),
                                      backgroundColor: isDarkMode ? const Color(0x14EF4444) : const Color(0x0DEF4444),
                                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                      minimumSize: Size.zero,
                                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                      shape: RoundedRectangleBorder(
                                        borderRadius: BorderRadius.circular(6),
                                        side: BorderSide(color: Colors.red.withValues(alpha: isDarkMode ? 0.4 : 0.35)),
                                      ),
                                    ),
                                    child: const Text('Delete account', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500)),
                                  )
                                else
                                  Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      FilledButton(
                                        onPressed: _fullDeleteLoading ? null : _handleFullDeleteAccount,
                                        style: FilledButton.styleFrom(backgroundColor: Colors.red.shade600),
                                        child: Text(_fullDeleteLoading ? 'Deleting...' : 'Confirm delete', style: const TextStyle(fontSize: 12)),
                                      ),
                                      const SizedBox(width: 8),
                                      OutlinedButton(
                                        onPressed: () => setState(() => _showFullDeleteConfirm = false),
                                        child: const Text('Cancel', style: TextStyle(fontSize: 12)),
                                      ),
                                    ],
                                  ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          if (_isEditing) _buildEditOverlay(isDarkMode),
          if (_showAvatarModal) _buildAvatarModal(isDarkMode),
          if (_showPhotoPreviewModal && _profilePicture != null) _buildPhotoPreviewModal(isDarkMode),
          if (_showBirthdayCalendar)
            BirthdayCalendar(
              selectedDate: _birthdayDate,
              onDateSelect: (date) {
                setState(() {
                  _birthdayDate = date;
                  _editData.birthday = _formatDate(date);
                  _editData.age = _calculateAgeFromBirthday(_editData.birthday);
                  _showBirthdayCalendar = false;
                });
              },
              onClose: () => setState(() => _showBirthdayCalendar = false),
            ),
        ],
      ),
    );
  }

  Widget _buildEditOverlay(bool isDarkMode) {
    return Material(
      color: HubColors.bg,
      child: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
              child: Row(
                children: [
                  IconButton(onPressed: _handleCancel, icon: const Icon(LucideIcons.x, color: HubColors.text)),
                  const Expanded(
                    child: Text('Edit profile', textAlign: TextAlign.center, style: TextStyle(color: HubColors.text, fontWeight: FontWeight.bold)),
                  ),
                  TextButton(
                    onPressed: _loading ? null : _handleSave,
                    child: Text(_loading ? 'Saving...' : 'Done', style: const TextStyle(color: HubColors.accent, fontWeight: FontWeight.w600)),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Container(
                    decoration: BoxDecoration(
                      color: isDarkMode ? HubColors.bgSecondary : Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: isDarkMode ? HubColors.divider : Colors.black12),
                    ),
                    child: Column(
                      children: [
                        Padding(
                          padding: const EdgeInsets.all(16),
                          child: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text('Name', style: TextStyle(fontWeight: FontWeight.bold, color: HubColors.text)),
                                    TextField(
                                      controller: _nameEditController,
                                      onChanged: (v) => _editData.displayName = v,
                                      style: const TextStyle(color: HubColors.textSecondary),
                                      decoration: const InputDecoration(border: InputBorder.none, hintText: 'Enter display name'),
                                    ),
                                  ],
                                ),
                              ),
                              _profileAvatar(size: 56, onTap: () => setState(() => _showAvatarModal = true)),
                            ],
                          ),
                        ),
                        const Divider(height: 1, color: HubColors.divider),
                        ListTile(
                          title: const Text('Bio', style: TextStyle(fontWeight: FontWeight.bold, color: HubColors.text)),
                          subtitle: Text(_editData.bio.isEmpty ? '+ Write bio' : _editData.bio, style: const TextStyle(color: HubColors.textSecondary)),
                        ),
                        const Divider(height: 1, color: HubColors.divider),
                        ListTile(
                          title: const Text('Age', style: TextStyle(fontWeight: FontWeight.bold, color: HubColors.text)),
                          subtitle: Text(
                            _editData.birthday.isNotEmpty
                                ? '${_calculateAgeFromBirthday(_editData.birthday)} years old'
                                : (_editData.age.isNotEmpty ? '${_editData.age} years old' : 'Set your birthday below'),
                            style: const TextStyle(color: HubColors.textSecondary),
                          ),
                        ),
                        ListTile(
                          title: const Text('Birthday', style: TextStyle(fontWeight: FontWeight.bold, color: HubColors.text)),
                          subtitle: Text(
                            _formatDateDisplay(_editData.birthday).isEmpty ? '+ Set birthday' : _formatDateDisplay(_editData.birthday),
                            style: const TextStyle(color: HubColors.textSecondary),
                          ),
                          trailing: const Icon(LucideIcons.chevronRight, color: HubColors.textSecondary, size: 16),
                          onTap: () => setState(() => _showBirthdayCalendar = true),
                        ),
                        Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('Gender', style: TextStyle(fontWeight: FontWeight.bold, color: HubColors.text)),
                              const SizedBox(height: 12),
                              Row(
                                children: [
                                  ('female', 'Female', '👩'),
                                  ('male', 'Male', '👨'),
                                  ('other', 'Other', '🌈'),
                                ].map((opt) {
                                  final selected = _editData.gender == opt.$1;
                                  return Expanded(
                                    child: Padding(
                                      padding: const EdgeInsets.symmetric(horizontal: 4),
                                      child: OutlinedButton(
                                        onPressed: () => setState(() => _editData.gender = opt.$1),
                                        style: OutlinedButton.styleFrom(
                                          backgroundColor: selected ? HubColors.accent.withValues(alpha: 0.25) : Colors.transparent,
                                          foregroundColor: selected ? HubColors.accent : HubColors.textSecondary,
                                          side: BorderSide(color: selected ? HubColors.accent : HubColors.divider, width: 1.5),
                                        ),
                                        child: Text('${opt.$3} ${opt.$2}', style: const TextStyle(fontSize: 12)),
                                      ),
                                    ),
                                  );
                                }).toList(),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (_profilePicture != null)
                    TextButton(
                      onPressed: _handleRemoveProfilePicture,
                      child: const Text('Remove profile picture', style: TextStyle(color: Color(0xE6F28B82))),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAvatarModal(bool isDarkMode) {
    return Stack(
      children: [
        GestureDetector(onTap: () => setState(() => _showAvatarModal = false), child: Container(color: Colors.black54)),
        Center(
          child: Container(
            margin: const EdgeInsets.all(24),
            padding: const EdgeInsets.all(24),
            constraints: const BoxConstraints(maxWidth: 400),
            decoration: BoxDecoration(
              color: HubColors.bgSecondary,
              borderRadius: BorderRadius.circular(24),
              border: Border.all(color: HubColors.divider),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    const Expanded(child: Text('Select Profile Picture', style: TextStyle(color: HubColors.text, fontSize: 18, fontWeight: FontWeight.w600))),
                    IconButton(onPressed: () => setState(() => _showAvatarModal = false), icon: const Icon(LucideIcons.x, color: HubColors.textSecondary)),
                  ],
                ),
                const SizedBox(height: 16),
                GridView.count(
                  shrinkWrap: true,
                  crossAxisCount: 3,
                  mainAxisSpacing: 12,
                  crossAxisSpacing: 12,
                  children: _avatars.map((a) {
                    return InkWell(
                      onTap: () => _handleAvatarSelect(a.$2),
                      borderRadius: BorderRadius.circular(12),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          ClipOval(
                            child: Image.asset(
                              a.$2,
                              width: 80,
                              height: 80,
                              fit: BoxFit.cover,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text(a.$1, style: const TextStyle(color: HubColors.textSecondary, fontSize: 11)),
                        ],
                      ),
                    );
                  }).toList(),
                ),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: () => _pickAndCropImage(ImageSource.gallery),
                    icon: const Icon(LucideIcons.image),
                    label: const Text('Upload from Gallery'),
                    style: FilledButton.styleFrom(backgroundColor: HubColors.accent, foregroundColor: Colors.white),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildPhotoPreviewModal(bool isDarkMode) {
    return Material(
      color: Colors.black,
      child: SafeArea(
        child: Column(
          children: [
            Row(
              children: [
                IconButton(
                  onPressed: () => setState(() {
                    _showPhotoPreviewModal = false;
                  }),
                  icon: const Icon(LucideIcons.arrowLeft, color: Colors.white),
                ),
                Expanded(
                  child: Text(
                    _editData.displayName.isNotEmpty ? _editData.displayName : (_user?.displayName ?? 'Profile Photo'),
                    style: const TextStyle(color: Colors.white),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                PopupMenuButton<String>(
                  icon: const Icon(LucideIcons.pencil, color: Colors.white),
                  color: HubColors.bgSecondary,
                  onSelected: (value) {
                    if (value == 'camera') _pickAndCropImage(ImageSource.camera);
                    if (value == 'gallery') _pickAndCropImage(ImageSource.gallery);
                    if (value == 'remove') {
                      _handleRemoveProfilePicture();
                      setState(() => _showPhotoPreviewModal = false);
                    }
                  },
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 'camera', child: Text('Camera', style: TextStyle(color: Colors.white))),
                    PopupMenuItem(value: 'gallery', child: Text('Gallery', style: TextStyle(color: Colors.white))),
                    PopupMenuItem(value: 'remove', child: Text('Remove photo', style: TextStyle(color: Colors.red))),
                  ],
                ),
                PopupMenuButton<String>(
                  icon: const Icon(LucideIcons.share2, color: Colors.white),
                  color: HubColors.bgSecondary,
                  onSelected: (value) async {
                    if (_profilePicture != null && _profilePicture!.startsWith('data:image')) {
                      if (value == 'share') {
                        await Share.shareXFiles([XFile.fromData(base64Decode(_profilePicture!.split(',').last), mimeType: 'image/jpeg', name: 'profile.jpg')]);
                      }
                    }
                  },
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 'share', child: Text('Share to...', style: TextStyle(color: Colors.white))),
                  ],
                ),
              ],
            ),
            Expanded(
              child: Center(
                child: _profilePicture != null && isProfileDataUrl(_profilePicture!)
                    ? Image.memory(base64Decode(_profilePicture!.split(',').last), fit: BoxFit.contain)
                    : buildProfilePicture(
                        picture: _profilePicture,
                        size: 280,
                        initials: _getInitials(_displayName),
                        backgroundColor: HubColors.divider,
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
