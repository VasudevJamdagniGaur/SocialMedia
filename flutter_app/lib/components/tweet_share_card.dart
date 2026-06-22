import 'package:flutter/material.dart';

import '../utils/hub_carousel_ai_image.dart';

const _kSociteaLogo = 'assets/images/DEITECIrc-192.webp';

/// Tweet-style card used only for X sharing. Rendered off-screen and converted to an image.
class TweetShareCard extends StatelessWidget {
  const TweetShareCard({
    super.key,
    required this.text,
    this.displayName = 'Socitea User',
    this.username = 'socitea_user',
    this.imageUrl,
    this.profileImageUrl,
    this.width = 1080,
    this.height,
  });

  final String displayName;
  final String username;
  final String text;
  final String? imageUrl;
  final String? profileImageUrl;
  final double width;
  final double? height;

  @override
  Widget build(BuildContext context) {
    final h = height ?? (width * 10 / 7);
    return Container(
      width: width,
      constraints: BoxConstraints(minHeight: h),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipOval(
                child: Container(
                  width: 48,
                  height: 48,
                  color: const Color(0xFFEFF3F4),
                  child: profileImageUrl != null
                      ? Image.network(profileImageUrl!, fit: BoxFit.cover, width: 48, height: 48)
                      : Center(
                          child: Text(
                            displayName.isNotEmpty ? displayName[0].toUpperCase() : '?',
                            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Color(0xFF0F1419)),
                          ),
                        ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            displayName,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w700,
                              color: Color(0xFF0F1419),
                            ),
                          ),
                        ),
                        const SizedBox(width: 6),
                        ClipOval(
                          child: Image.asset(
                            _kSociteaLogo,
                            width: 18,
                            height: 18,
                            fit: BoxFit.cover,
                            errorBuilder: (_, __, ___) => const SizedBox(width: 18, height: 18),
                          ),
                        ),
                      ],
                    ),
                    Text(
                      '@$username',
                      style: const TextStyle(fontSize: 14, color: Color(0xFF536471)),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            text,
            style: const TextStyle(fontSize: 16, height: 1.45, color: Color(0xFF0F1419)),
          ),
          if (imageUrl != null && imageUrl!.isNotEmpty) ...[
            const SizedBox(height: 16),
            ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: SizedBox(
                width: width - 40,
                child: HubCarouselHeroImage(
                  imageUrl: imageUrl,
                  fit: BoxFit.cover,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
