import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:shimmer/shimmer.dart';

import '../router/app_router.dart';
import 'package:deite/lib/pod_topic_news_shared.dart';
import '../services/hub_personalization_service.dart';
import '../utils/share_news_cache.dart';
import 'hub_theme.dart';

/// Horizontal trending card â€” mirrors SportsTrendingCard / AiTechTrendingCard.
class HubTrendingCarouselCard extends StatefulWidget {
  const HubTrendingCarouselCard({
    super.key,
    required this.item,
    required this.index,
    required this.returnTo,
    this.showSource = false,
    this.onLike,
    this.isSignedIn = false,
  });

  final NewsArticle item;
  final int index;
  final String returnTo;
  final bool showSource;
  final VoidCallback? onLike;
  final bool isSignedIn;

  static const _gradients = [
    [Color(0xFF1a1a2e), Color(0xFF0f3460)],
    [Color(0xFF2d132c), Color(0xFFc72c41)],
    [Color(0xFF0f2027), Color(0xFF2c5364)],
    [Color(0xFF1e3c72), Color(0xFF7e8ba3)],
    [Color(0xFF232526), Color(0xFF414345)],
  ];

  @override
  State<HubTrendingCarouselCard> createState() => _HubTrendingCarouselCardState();
}

class _HubTrendingCarouselCardState extends State<HubTrendingCarouselCard> {
  bool _heroFailed = false;

  Future<void> _openShare() async {
    if (widget.item.url.isEmpty) return;
    final payload = {
      'newsArticle': widget.item.toMap(),
      'returnTo': widget.returnTo,
    };
    await prepareShareSuggestionsRoute(payload);
    if (!mounted) return;
    context.push(AppRoutes.shareSuggestions, extra: payload);
  }

  @override
  Widget build(BuildContext context) {
    final w = MediaQuery.sizeOf(context).width * 0.78;
    final src = widget.item.image?.trim() ?? '';
    final showImg = src.startsWith('http') && !_heroFailed;
    final g = HubTrendingCarouselCard._gradients[widget.index % HubTrendingCarouselCard._gradients.length];

    return SizedBox(
      width: w.clamp(200, 260),
      height: 200,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: widget.item.url.isEmpty ? null : _openShare,
          borderRadius: BorderRadius.circular(12),
          child: Ink(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: HubTheme.divider),
              gradient: showImg
                  ? null
                  : LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: g,
                    ),
            ),
            child: Stack(
              fit: StackFit.expand,
              children: [
                if (showImg)
                  ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: CachedNetworkImage(
                      imageUrl: src,
                      fit: BoxFit.cover,
                      errorWidget: (_, __, ___) {
                        WidgetsBinding.instance.addPostFrameCallback((_) {
                          if (mounted) setState(() => _heroFailed = true);
                        });
                        return const SizedBox.shrink();
                      },
                    ),
                  ),
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 0,
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      borderRadius: const BorderRadius.vertical(bottom: Radius.circular(12)),
                      gradient: LinearGradient(
                        begin: Alignment.bottomCenter,
                        end: Alignment.topCenter,
                        colors: [Colors.black.withValues(alpha: 0.92), Colors.transparent],
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          widget.item.title,
                          maxLines: 4,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        if (widget.showSource && widget.item.source.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 6),
                            child: Text(
                              widget.item.source.toUpperCase(),
                              style: TextStyle(
                                color: Colors.white.withValues(alpha: 0.65),
                                fontSize: 11,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
                if (widget.isSignedIn && widget.onLike != null)
                  Positioned(
                    top: 8,
                    right: 8,
                    child: IconButton(
                      icon: const Icon(Icons.favorite_border, color: Colors.white, size: 20),
                      onPressed: widget.onLike,
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// News list row â€” mirrors NewsFeedRow.
class NewsFeedRow extends StatelessWidget {
  const NewsFeedRow({
    super.key,
    required this.item,
    required this.onOpenShare,
    this.isLast = false,
  });

  final NewsArticle item;
  final VoidCallback onOpenShare;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onOpenShare,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          border: isLast ? null : const Border(bottom: BorderSide(color: HubTheme.divider)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.title,
                    style: const TextStyle(color: HubTheme.text, fontSize: 15, fontWeight: FontWeight.w500),
                  ),
                  if (item.source.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        item.source,
                        style: const TextStyle(color: HubTheme.textSecondary, fontSize: 12),
                      ),
                    ),
                ],
              ),
            ),
            if (item.image != null && item.image!.startsWith('http'))
              Padding(
                padding: const EdgeInsets.only(left: 12),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: CachedNetworkImage(
                    imageUrl: item.image!,
                    width: 72,
                    height: 72,
                    fit: BoxFit.cover,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class CardSkeletonRow extends StatelessWidget {
  const CardSkeletonRow({super.key, this.count = 4});
  final int count;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 200,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.only(left: 16, right: 16, bottom: 8),
        itemCount: count,
        separatorBuilder: (_, __) => const SizedBox(width: 12),
        itemBuilder: (_, __) => Shimmer.fromColors(
          baseColor: HubTheme.divider,
          highlightColor: HubTheme.textSecondary.withValues(alpha: 0.3),
          child: Container(
            width: 240,
            decoration: BoxDecoration(
              color: HubTheme.divider,
              borderRadius: BorderRadius.circular(12),
            ),
          ),
        ),
      ),
    );
  }
}

class ListSkeleton extends StatelessWidget {
  const ListSkeleton({super.key, this.count = 5});
  final int count;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: List.generate(
        count,
        (_) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Shimmer.fromColors(
            baseColor: HubTheme.divider,
            highlightColor: HubTheme.textSecondary.withValues(alpha: 0.3),
            child: Container(
              height: 64,
              decoration: BoxDecoration(
                color: HubTheme.divider,
                borderRadius: BorderRadius.circular(8),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class HubBackHeader extends StatelessWidget {
  const HubBackHeader({
    super.key,
    required this.title,
    required this.onBack,
  });

  final String title;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 24),
      child: Row(
        children: [
          Material(
            color: HubTheme.bg,
            shape: const CircleBorder(side: BorderSide(color: HubTheme.divider)),
            child: IconButton(
              icon: const Icon(Icons.arrow_back, color: HubTheme.text),
              onPressed: onBack,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              title,
              style: const TextStyle(
                color: HubTheme.text,
                fontSize: 20,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

Future<void> openNewsShare(BuildContext context, NewsArticle item, String returnTo) async {
  recordHubNewsClick('', item.exploreTopic ?? 'general');
  final payload = {
    'newsArticle': item.toMap(),
    'returnTo': returnTo,
  };
  await prepareShareSuggestionsRoute(payload);
  if (!context.mounted) return;
  context.push(AppRoutes.shareSuggestions, extra: payload);
}
