import 'dart:convert';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

/// Normalizes React web paths (`/apple-avatar.png`) to Flutter asset paths.
String? normalizeProfilePicturePath(String? pic) {
  if (pic == null || pic.isEmpty) return null;
  if (pic.startsWith('/')) {
    return 'assets/images/${pic.replaceFirst('/', '')}';
  }
  return pic;
}

bool isProfileDataUrl(String pic) => pic.startsWith('data:image');

bool isProfileAssetPath(String pic) {
  final normalized = normalizeProfilePicturePath(pic)!;
  return normalized.startsWith('assets/');
}

bool isProfileEmoji(String pic) => pic.startsWith('emoji:');

bool isProfileNetworkUrl(String pic) =>
    pic.startsWith('http://') || pic.startsWith('https://');

/// Renders a profile picture from data URL, asset, network URL, emoji, or initials fallback.
Widget buildProfilePicture({
  required String? picture,
  required double size,
  String? initials,
  Color backgroundColor = const Color(0xFF1E1E1E),
  Color initialsColor = Colors.white,
}) {
  final pic = normalizeProfilePicturePath(picture);
  if (pic == null) {
    return CircleAvatar(
      radius: size / 2,
      backgroundColor: backgroundColor,
      child: Text(
        initials ?? 'U',
        style: TextStyle(
          fontWeight: FontWeight.bold,
          fontSize: size * 0.28,
          color: initialsColor,
        ),
      ),
    );
  }

  if (isProfileDataUrl(pic)) {
    try {
      final bytes = base64Decode(pic.split(',').last);
      return ClipOval(
        child: Image.memory(bytes, width: size, height: size, fit: BoxFit.cover),
      );
    } catch (_) {
      // fall through to initials
    }
  } else if (isProfileAssetPath(pic)) {
    return ClipOval(
      child: Image.asset(
        pic,
        width: size,
        height: size,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => CircleAvatar(
          radius: size / 2,
          backgroundColor: backgroundColor,
          child: Text(initials ?? 'U', style: TextStyle(fontSize: size * 0.28)),
        ),
      ),
    );
  } else if (isProfileEmoji(pic)) {
    return CircleAvatar(
      radius: size / 2,
      backgroundColor: backgroundColor,
      child: Text(pic.replaceFirst('emoji:', ''), style: TextStyle(fontSize: size * 0.45)),
    );
  } else if (isProfileNetworkUrl(pic)) {
    return ClipOval(
      child: CachedNetworkImage(
        imageUrl: pic,
        width: size,
        height: size,
        fit: BoxFit.cover,
        errorWidget: (_, __, ___) => CircleAvatar(
          radius: size / 2,
          backgroundColor: backgroundColor,
          child: Text(initials ?? 'U', style: TextStyle(fontSize: size * 0.28)),
        ),
      ),
    );
  }

  return CircleAvatar(
    radius: size / 2,
    backgroundColor: backgroundColor,
    child: Text(
      initials ?? 'U',
      style: TextStyle(
        fontWeight: FontWeight.bold,
        fontSize: size * 0.28,
        color: initialsColor,
      ),
    ),
  );
}
