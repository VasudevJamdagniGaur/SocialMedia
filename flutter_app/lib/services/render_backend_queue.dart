import 'dart:async';

import 'package:flutter/foundation.dart';

/// Gap between Pod Tea / News carousel image calls (1 per second).
const renderBackendCarouselGapMs = 1000;

/// Global priority for all requests to detea-backend.onrender.com.
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

  bool _isFrozenCarouselPriority(RenderBackendPriority priority) {
    return priority == RenderBackendPriority.podTeaHome ||
        priority == RenderBackendPriority.podNewsHome ||
        priority == RenderBackendPriority.podVertical;
  }

  /// Call when the user opens share / post creation (before navigating).
  void beginPostCreationSession() {
    _postCreationDepth++;
    debugPrint('[RenderQueue] post-creation session started (depth=$_postCreationDepth)');
    _sortPending();
    unawaited(_drain());
  }

  /// Call when share / post creation screen is closed.
  void endPostCreationSession() {
    if (_postCreationDepth > 0) _postCreationDepth--;
    debugPrint('[RenderQueue] post-creation session ended (depth=$_postCreationDepth)');
    unawaited(_drain());
  }

  /// Share/post flows — always highest priority.
  Future<T> runPostCreation<T>(
    Future<T> Function() work, {
    String? debugLabel,
  }) {
    return run(
      priority: RenderBackendPriority.postCreation,
      work: work,
      debugLabel: debugLabel,
    );
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

  RenderBackendPriority _effectivePriority(RenderBackendPriority requested) {
    if (!isPostCreationActive) return requested;
    if (requested == RenderBackendPriority.postCreation) return requested;
    if (_isFrozenCarouselPriority(requested)) return requested;
    return RenderBackendPriority.postCreation;
  }

  void _sortPending() {
    _pending.sort((a, b) {
      final byPriority = a.priority.index.compareTo(b.priority.index);
      if (byPriority != 0) return byPriority;
      return a.seq.compareTo(b.seq);
    });
  }

  int _gapAfter(RenderBackendPriority priority) {
    if (priority == RenderBackendPriority.postCreation) return 0;
    if (priority == RenderBackendPriority.podTeaHome ||
        priority == RenderBackendPriority.podNewsHome) {
      return renderBackendCarouselGapMs;
    }
    return renderBackendCarouselGapMs;
  }

  Future<void> _drain() async {
    if (_draining) return;
    _draining = true;
    try {
      while (_pending.isNotEmpty) {
        _sortPending();

        final takeIdx = _nextRunnableIndex();
        if (takeIdx < 0) {
          // Post session active but only carousel work is queued — freeze until post calls arrive.
          break;
        }

        final item = _pending.removeAt(takeIdx);
        await _execute(item);

        if (_pending.isEmpty) break;

        final gap = _gapAfter(item.priority);
        if (gap > 0) {
          await Future<void>.delayed(Duration(milliseconds: gap));
        }
      }
    } finally {
      _draining = false;
      if (_pending.isNotEmpty && _nextRunnableIndex() >= 0) {
        unawaited(_drain());
      }
    }
  }

  int _nextRunnableIndex() {
    if (_pending.isEmpty) return -1;
    _sortPending();
    if (isPostCreationActive) {
      return _pending.indexWhere((e) => e.priority == RenderBackendPriority.postCreation);
    }
    return 0;
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

RenderBackendPriority renderPriorityWhenSharing() {
  return RenderBackendQueue.instance.isPostCreationActive
      ? RenderBackendPriority.postCreation
      : RenderBackendPriority.shareScreen;
}
