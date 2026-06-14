import 'dart:async';

import 'package:flutter/foundation.dart';

/// Minimum gap between consecutive Render backend HTTP calls.
const renderBackendRequestGapMs = 3000;

/// Global priority for all requests to detea-backend.onrender.com.
/// [postCreation] blocks every other priority while a share/post flow is active.
enum RenderBackendPriority {
  postCreation,
  podTeaHome,
  podNewsHome,
  podVertical,
  teaFeed,
  shareScreen,
  background,
}

class _QueuedRenderRequest<T> {
  _QueuedRenderRequest({
    required this.priority,
    required this.seq,
    required this.completer,
    required this.work,
    this.label,
  });

  final RenderBackendPriority priority;
  final int seq;
  final Completer<T> completer;
  final Future<T> Function() work;
  final String? label;
}

/// Serializes every Render backend call — one HTTP request at a time app-wide.
class RenderBackendQueue {
  RenderBackendQueue._();

  static final RenderBackendQueue instance = RenderBackendQueue._();

  final List<_QueuedRenderRequest<dynamic>> _pending = [];
  bool _draining = false;
  int _seq = 0;
  int _postCreationDepth = 0;

  bool get isPostCreationActive => _postCreationDepth > 0;

  /// Call when the user opens share / post creation (before navigating).
  void beginPostCreationSession() {
    _postCreationDepth++;
    debugPrint('[RenderQueue] post-creation session started (depth=$_postCreationDepth)');
    _sortPending();
  }

  /// Call when share / post creation screen is closed.
  void endPostCreationSession() {
    if (_postCreationDepth > 0) _postCreationDepth--;
    debugPrint('[RenderQueue] post-creation session ended (depth=$_postCreationDepth)');
    unawaited(_drain());
  }

  Future<T> run<T>({
    required RenderBackendPriority priority,
    required Future<T> Function() work,
    String? debugLabel,
  }) {
    final effective = _effectivePriority(priority);
    final completer = Completer<T>();
    _pending.add(_QueuedRenderRequest<T>(
      priority: effective,
      seq: _seq++,
      completer: completer,
      work: work,
      label: debugLabel,
    ));
    _sortPending();
    unawaited(_drain());
    return completer.future;
  }

  void _sortPending() {
    _pending.sort((a, b) {
      final byPriority = a.priority.index.compareTo(b.priority.index);
      if (byPriority != 0) return byPriority;
      return a.seq.compareTo(b.seq);
    });
  }

  Future<void> _drain() async {
    if (_draining) return;
    _draining = true;
    try {
      while (_pending.isNotEmpty) {
        _sortPending();

        if (isPostCreationActive) {
          final postIdx = _pending.indexWhere(
            (e) => e.priority == RenderBackendPriority.postCreation,
          );
          if (postIdx < 0) {
            await Future<void>.delayed(const Duration(milliseconds: 100));
            continue;
          }
          await _execute(_pending.removeAt(postIdx));
        } else {
          await _execute(_pending.removeAt(0));
        }

        if (_pending.isNotEmpty) {
          await Future<void>.delayed(
            const Duration(milliseconds: renderBackendRequestGapMs),
          );
        }
      }
    } finally {
      _draining = false;
    }
  }

  Future<void> _execute(_QueuedRenderRequest<dynamic> item) async {
    if (kDebugMode && item.label != null) {
      debugPrint('[RenderQueue] ${item.priority.name} ${item.label}');
    }
    try {
      item.completer.complete(await item.work());
    } catch (e, st) {
      if (!item.completer.isCompleted) {
        item.completer.completeError(e, st);
      }
    }
  }

  /// During post creation, share/post API calls run first; carousel work stays queued.
  RenderBackendPriority _effectivePriority(RenderBackendPriority requested) {
    if (!isPostCreationActive) return requested;
    if (requested == RenderBackendPriority.postCreation) {
      return requested;
    }
    if (requested.index >= RenderBackendPriority.shareScreen.index) {
      return RenderBackendPriority.postCreation;
    }
    return requested;
  }
}

RenderBackendPriority hubCarouselPriorityToRender(HubCarouselImagePriority priority) {
  switch (priority) {
    case HubCarouselImagePriority.podTeaHome:
      return RenderBackendPriority.podTeaHome;
    case HubCarouselImagePriority.podNewsHome:
      return RenderBackendPriority.podNewsHome;
    case HubCarouselImagePriority.podVertical:
      return RenderBackendPriority.podVertical;
    case HubCarouselImagePriority.teaFeed:
      return RenderBackendPriority.teaFeed;
    case HubCarouselImagePriority.shareScreen:
      return RenderBackendPriority.shareScreen;
    case HubCarouselImagePriority.background:
      return RenderBackendPriority.background;
  }
}

/// Kept for carousel call sites — maps to [RenderBackendPriority] via [hubCarouselPriorityToRender].
enum HubCarouselImagePriority {
  podTeaHome,
  podNewsHome,
  podVertical,
  teaFeed,
  shareScreen,
  background,
}
