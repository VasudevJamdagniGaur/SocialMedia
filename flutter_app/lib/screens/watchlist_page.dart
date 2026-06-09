import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../router/app_router.dart';
import '../utils/hub_colors.dart';
import '../utils/share_news_cache.dart';
import '../utils/tea_watchlist_storage.dart';

class WatchlistPage extends StatefulWidget {
  const WatchlistPage({super.key});

  @override
  State<WatchlistPage> createState() => _WatchlistPageState();
}

class _WatchlistPageState extends State<WatchlistPage> {
  List<TeaWatchlistItem> _items = [];

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    final items = await getTeaWatchlist();
    if (mounted) setState(() => _items = items);
  }

  Future<void> _remove(String id) async {
    await removeTeaWatchlistById(id);
    await _reload();
  }

  Future<void> _openShareSuggestions(TeaWatchlistItem row) async {
    if (row.url.isEmpty) return;
    final payload = {
      'newsArticle': {
        'title': row.title,
        'url': row.url,
        'description': '',
        'image': watchlistHeroUrl(row),
        'source': 'r/BollyBlindsNGossip',
      },
      'returnTo': AppRoutes.watchlist,
      'platform': 'linkedin',
    };
    await prepareShareSuggestionsRoute(payload);
    if (!mounted) return;
    context.go(AppRoutes.shareSuggestions, extra: payload);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: HubColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
              child: Row(
                children: [
                  IconButton(
                    onPressed: () => context.go(AppRoutes.community),
                    icon: const Icon(Icons.arrow_back, color: Colors.white),
                  ),
                  const Icon(Icons.bookmark, color: HubColors.accent, size: 22),
                  const SizedBox(width: 8),
                  const Text('Watchlist', style: TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w800)),
                ],
              ),
            ),
            const Divider(height: 1, color: HubColors.divider),
            Expanded(
              child: _items.isEmpty
                  ? const Center(
                      child: Padding(
                        padding: EdgeInsets.all(24),
                        child: Text(
                          'Save posts from Tea with the bookmark button. They will show up here.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: HubColors.textSecondary, fontSize: 15),
                        ),
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.all(16),
                      itemCount: _items.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 12),
                      itemBuilder: (_, i) {
                        final row = _items[i];
                        final img = watchlistHeroUrl(row);
                        final canOpen = row.url.isNotEmpty;
                        return Material(
                          color: const Color(0xFF121212),
                          borderRadius: BorderRadius.circular(16),
                          child: InkWell(
                            borderRadius: BorderRadius.circular(16),
                            onTap: canOpen ? () => _openShareSuggestions(row) : null,
                            child: Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(color: HubColors.divider),
                              ),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  ClipRRect(
                                    borderRadius: BorderRadius.circular(12),
                                    child: Container(
                                      width: 88,
                                      height: 88,
                                      color: const Color(0xFF1A1A1A),
                                      child: img != null
                                          ? CachedNetworkImage(imageUrl: img, fit: BoxFit.cover)
                                          : const Center(child: Text('☕', style: TextStyle(fontSize: 28))),
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          row.title.isNotEmpty ? row.title : 'Tea post',
                                          maxLines: 3,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w600),
                                        ),
                                        if (row.url.isNotEmpty) ...[
                                          const SizedBox(height: 8),
                                          TextButton.icon(
                                            onPressed: () => _remove(row.id),
                                            icon: const Icon(Icons.delete_outline, size: 16),
                                            label: const Text('Remove'),
                                            style: TextButton.styleFrom(
                                              foregroundColor: HubColors.textSecondary,
                                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                              side: const BorderSide(color: HubColors.divider),
                                            ),
                                          ),
                                        ],
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
