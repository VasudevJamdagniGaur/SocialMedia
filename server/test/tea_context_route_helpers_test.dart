import 'package:test/test.dart';

/// Lightweight classification mirrors server /api/tea/context response shaping.
String classifyLevel(int relatedCount) {
  if (relatedCount >= 2) return 'multiSource';
  if (relatedCount >= 1) return 'snippetBased';
  return 'headlineOnly';
}

void main() {
  test('context level from related source counts', () {
    expect(classifyLevel(0), 'headlineOnly');
    expect(classifyLevel(1), 'snippetBased');
    expect(classifyLevel(3), 'multiSource');
  });
}
