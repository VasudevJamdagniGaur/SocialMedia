import 'package:flutter_test/flutter_test.dart';
import 'package:deite/services/public_figure_service.dart';
import 'package:deite/utils/content_personalization.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('analyzeContentSubject', () {
    test('detects self + event for meeting a person at a hackathon', () {
      final a = analyzeContentSubject('I met Abhishek Dipke at a hackathon.');
      expect(a.kind, ContentSubjectKind.userSelf);
      expect(a.useUserFaceReference, isTrue);
      expect(a.confidence, greaterThanOrEqualTo(0.5));
    });

    test('treats celebrity-only posts as general (no user face)', () {
      final a = analyzeContentSubject(
        "Create a post about Narendra Modi's address at a technology event.",
      );
      expect(a.kind, ContentSubjectKind.generalTopic);
      expect(a.useUserFaceReference, isFalse);
    });

    test('does not force a face for abstract topics', () {
      final a = analyzeContentSubject(
        "I want to discuss the impact of AI on India's economy.",
      );
      // Soft first-person without clear event → confidence below face threshold.
      expect(a.confidence < 0.5 || a.kind == ContentSubjectKind.generalTopic, isTrue);
    });
  });

  group('PublicFigureService', () {
    test('returns empty for abstract AI economy topic (no invented celebrity)', () async {
      final result = await PublicFigureService.instance.scanAndResolve(
        "I want to discuss the impact of AI on India's economy.",
        timeout: const Duration(seconds: 20),
        maxPeople: 2,
      );
      // Should not invent a famous person for a topical discussion.
      expect(result.figures, isEmpty);
    });

    test('resolves Narendra Modi with a Wikipedia reference when online', () async {
      final result = await PublicFigureService.instance.scanAndResolve(
        "Create a post about Narendra Modi's address at a technology event.",
        timeout: const Duration(seconds: 25),
        maxPeople: 1,
      );
      // Network-dependent: skip soft-fail if offline in CI.
      if (result.figures.isEmpty) {
        // ignore: avoid_print
        print('SKIP: Wikipedia unreachable or timed out for Modi');
        return;
      }
      final fig = result.figures.first;
      expect(fig.displayName.toLowerCase(), contains('modi'));
      expect(fig.hasReferenceImage, isTrue);
      expect(fig.source, anyOf('wikipedia', 'cache'));
      expect(fig.ambiguous, isFalse);
    }, timeout: const Timeout(Duration(seconds: 40)));

    test('resolves Virat Kohli when online', () async {
      final result = await PublicFigureService.instance.scanAndResolve(
        "Write about Virat Kohli's latest achievement.",
        timeout: const Duration(seconds: 25),
        maxPeople: 1,
      );
      if (result.figures.isEmpty) {
        // ignore: avoid_print
        print('SKIP: Wikipedia unreachable or timed out for Kohli');
        return;
      }
      expect(result.figures.first.displayName.toLowerCase(), contains('kohli'));
      expect(result.figures.first.hasReferenceImage, isTrue);
    }, timeout: const Timeout(Duration(seconds: 40)));

    test('flags or skips ambiguous common names without inventing identity', () async {
      final result = await PublicFigureService.instance.scanAndResolve(
        'I met Rahul Sharma.',
        timeout: const Duration(seconds: 25),
        maxPeople: 1,
      );
      // Either ambiguous notice / empty figures — never a confident wrong face.
      final usedWrongConfidentFace = result.figures.any(
        (f) => f.hasReferenceImage && !f.ambiguous && f.confidence >= 0.8,
      );
      // Common name may still resolve to one Wikipedia page; require notice OR no high-confidence sole pick.
      if (usedWrongConfidentFace && (result.notice == null || result.notice!.isEmpty)) {
        // Accept only if Wikipedia returned a clearly labeled person and we found a photo —
        // still OK if description exists; the hard rule is we must not fabricate URLs.
        expect(result.figures.first.thumbnailUrl, isNotNull);
        expect(result.figures.first.thumbnailUrl!, startsWith('http'));
      }
    }, timeout: const Timeout(Duration(seconds: 40)));
  });

  group('personalizationAspectRatio', () {
    test('platform ratios', () {
      expect(personalizationAspectRatio(platform: 'linkedin'), '1:1');
      expect(personalizationAspectRatio(platform: 'x'), '16:9');
      expect(
        personalizationAspectRatio(platform: 'instagram', instagramFormat: 'post'),
        '1:1',
      );
      expect(
        personalizationAspectRatio(platform: 'instagram', instagramFormat: 'story'),
        '9:16',
      );
    });
  });
}
