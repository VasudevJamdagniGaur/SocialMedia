import 'package:flutter_test/flutter_test.dart';
import 'package:deite/utils/tea_topic_context.dart';
import 'package:deite/utils/share_news_cache.dart';

void main() {
  group('TeaTopicContext model', () {
    test('headline-only summary never invents body facts', () {
      final ctx = TeaTopicContext(
        headline: 'Sourav Ganguly Net Worth',
        sourceUrl: 'https://example.com/a',
        publisher: 'Sports Desk',
        availableSnippet: '',
        relatedSources: const [],
        verifiedFacts: const ['Reported headline: Sourav Ganguly Net Worth'],
        unverifiedClaims: const [],
        contextSummary:
            'Limited context: only the headline is available from Sports Desk. Full article text was not accessible.',
        contextLevel: TeaContextLevel.headlineOnly,
        confidence: 0.2,
        generatedAt: DateTime.now(),
      );
      expect(ctx.isLimited, isTrue);
      expect(ctx.displaySummary.toLowerCase(), contains('limited context'));
      expect(ctx.storyTextForAi, contains('headlineOnly'));
      expect(ctx.storyTextForAi.toLowerCase(), contains('do not invent'));
      expect(isFeedMarkupOrUrlOnly(ctx.displaySummary), isFalse);
    });

    test('multi-source marks higher confidence and lists related sources', () {
      final ctx = TeaTopicContext(
        headline: 'Team clinches dramatic late win',
        sourceUrl: 'https://example.com/match',
        publisher: 'Match Desk',
        availableSnippet: 'A stoppage-time goal sealed the result before a packed stadium.',
        relatedSources: const [
          TeaRelatedSource(
            title: 'Late winner sparks celebrations',
            url: 'https://news.example.com/1',
            publisher: 'Outlet A',
            snippet: 'Fans erupted after a last-gasp strike decided the fixture.',
          ),
          TeaRelatedSource(
            title: 'Stoppage-time drama decides clash',
            url: 'https://news.example.com/2',
            publisher: 'Outlet B',
            snippet: 'The home side scored deep in added time to secure three points.',
          ),
        ],
        verifiedFacts: const [
          'Reported headline: Team clinches dramatic late win',
          'A stoppage-time goal sealed the result before a packed stadium.',
        ],
        unverifiedClaims: const [],
        contextSummary: 'A stoppage-time goal sealed the result before a packed stadium.',
        contextLevel: TeaContextLevel.multiSource,
        confidence: 0.8,
        generatedAt: DateTime.now(),
      );
      expect(ctx.contextLevel, TeaContextLevel.multiSource);
      expect(ctx.relatedSources, hasLength(2));
      expect(ctx.toArticleFields()['contentStatus'], 'complete');
      expect(ctx.storyTextForAi, contains('RELATED SOURCES'));
    });

    test('toJson / fromJson round-trip', () {
      final original = TeaTopicContext(
        headline: 'Snippet story',
        sourceUrl: 'https://example.com/s',
        publisher: 'Blog',
        availableSnippet: 'A short blurb about the event.',
        relatedSources: const [
          TeaRelatedSource(title: 'Other', url: 'https://x.com/1', publisher: 'X'),
        ],
        verifiedFacts: const ['Reported headline: Snippet story'],
        unverifiedClaims: const ['Single-source snippet (unconfirmed): A short blurb'],
        contextSummary: 'A short blurb about the event.',
        contextLevel: TeaContextLevel.snippetBased,
        confidence: 0.4,
        generatedAt: DateTime.utc(2026, 1, 1),
      );
      final restored = TeaTopicContext.fromJson(original.toJson());
      expect(restored.headline, original.headline);
      expect(restored.contextLevel, TeaContextLevel.snippetBased);
      expect(restored.relatedSources.first.url, 'https://x.com/1');
    });
  });

  group('buildLocalTeaShareSuggestions headline-only', () {
    test('does not invent article details', () {
      final posts = buildLocalTeaShareSuggestions(
        {
          'title': 'Mystery Celebrity Rumor',
          'contextLevel': 'headlineOnly',
          'gossip': '',
          'description': '',
        },
        'linkedin',
      );
      expect(posts, isNotEmpty);
      final joined = posts.map((p) => p['post'] ?? '').join(' ');
      expect(joined.toLowerCase(), contains('headline'));
      expect(joined.toLowerCase(), isNot(contains('according to sources inside')));
      expect(joined, isNot(contains('https://')));
    });
  });
}
