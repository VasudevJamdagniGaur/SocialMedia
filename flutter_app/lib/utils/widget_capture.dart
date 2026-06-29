import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

/// Renders [child] in an off-screen overlay and returns a PNG snapshot.
Future<Uint8List?> captureWidgetToPng(
  BuildContext context,
  Widget child, {
  Duration settleDelay = const Duration(milliseconds: 100),
  double pixelRatio = 2.0,
}) async {
  final key = GlobalKey();
  final overlayState = Overlay.of(context, rootOverlay: true);
  late OverlayEntry entry;

  entry = OverlayEntry(
    builder: (_) => Positioned(
      left: -20000,
      top: 0,
      child: Material(
        type: MaterialType.transparency,
        child: RepaintBoundary(
          key: key,
          child: child,
        ),
      ),
    ),
  );

  overlayState.insert(entry);
  try {
    await Future<void>.delayed(settleDelay);
    await WidgetsBinding.instance.endOfFrame;
    await WidgetsBinding.instance.endOfFrame;

    final renderObject = key.currentContext?.findRenderObject();
    if (renderObject is! RenderRepaintBoundary) return null;

    final image = await renderObject.toImage(pixelRatio: pixelRatio);
    final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
    return byteData?.buffer.asUint8List();
  } finally {
    entry.remove();
  }
}
