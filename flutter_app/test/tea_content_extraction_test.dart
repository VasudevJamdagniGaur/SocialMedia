import 'package:flutter_test/flutter_test.dart';
import 'package:deite/utils/tea_content_extraction.dart';
import 'package:deite/utils/share_news_cache.dart';
import 'package:deite/services/reddit_tea_service.dart';

void main() {
  group('stripHtmlBoilerplate / feed junk', () {
    test('decodes entities then strips tags so escaped anchors vanish', () {
      const raw =
          '&lt;a href="https://news.google.com/rss/articles/CBMigFBVV95cUxNM"&gt;Sourav&lt;/a&gt;';
      final cleaned = stripHtmlBoilerplate(raw);
      expect(cleaned.contains('&lt;'), isFalse);
      expect(cleaned.contains('<a'), isFalse);
      expect(cleaned.toLowerCase(), contains('sourav'));
    });

    test('isFeedMarkupOrUrlOnly detects Google News link wrappers', () {
      const junk =
          '&lt;a href="https://news.google.com/rss/articles/CBMigFBVV95cUxNM21xbkc1"&gt;read&lt;/a&gt;';
      expect(isFeedMarkupOrUrlOnly(junk), isTrue);
      expect(cleanFeedSnippetForDisplay(junk, title: 'Sourav Ganguly Net Worth'), isEmpty);
    });

    test('isFeedMarkupOrUrlOnly allows real prose', () {
      const prose =
          'Former India captain Sourav Ganguly has built wealth through cricket, commentary and business ventures estimated in crores.';
      expect(isFeedMarkupOrUrlOnly(prose), isFalse);
      expect(cleanFeedSnippetForDisplay(prose), contains('Former India captain'));
    });
  });

  group('teaRowsFromRssArticles', () {
    test('preserves RSS prose as gossip/body (not title-only)', () {
      final rows = teaRowsFromRssArticles([
        {
          'title': 'Delhi police restrict movement ahead of weekend rally',
          'url': 'https://example.com/delhi-rally',
          'description':
              'Authorities increased security across central Delhi as organizers prepared for a large public demonstration.',
          'source': 'News Desk',
          'image': 'https://example.com/img.jpg',
        },
      ]);
      expect(rows, hasLength(1));
      expect(rows.first['gossip'], contains('Authorities increased security'));
      expect(rows.first['description'], contains('demonstration'));
      expect(rows.first['selftext'], isNotEmpty);
    });

    test('rejects Google News HTML/URL junk as body', () {
      final rows = teaRowsFromRssArticles([
        {
          'title': 'Delhi police restrict movement ahead of weekend rally',
          'url': 'https://news.google.com/rss/articles/CBMigFBVV95cUxNM',
          'description':
              '&lt;a href="https://news.google.com/rss/articles/CBMigFBVV95cUxNM21xbkc1"&gt;Delhi police restrict movement&lt;/a&gt;',
          'source': 'Google News',
        },
      ]);
      expect(rows.first.containsKey('gossip'), isFalse);
      expect(rows.first['extractionStatus'], 'titleOnly');
    });

    test('does not invent body when description equals title', () {
      final rows = teaRowsFromRssArticles([
        {
          'title': 'Delhi police restrict movement ahead of weekend rally',
          'url': 'https://example.com/x',
          'description': 'Delhi police restrict movement ahead of weekend rally',
          'source': 'News',
        },
      ]);
      expect(rows.first.containsKey('gossip'), isFalse);
    });

    test('filters net-worth SEO junk titles', () {
      final rows = teaRowsFromRssArticles([
        {
          'title': 'Sourav Ganguly Net Worth',
          'url': 'https://example.com/ganguly',
          'description': 'Celebrity Net Worth profile filler.',
          'source': 'Sports Desk',
        },
      ]);
      expect(rows, isEmpty);
    });
  });

  group('extractedTeaContentFromRow', () {
    test('marks title-only when body missing', () {
      final c = extractedTeaContentFromRow({
        'title': 'Sourav Ganguly Net Worth',
        'url': 'https://youtube.com/watch?v=abcdefghijk',
      });
      expect(c.extractionStatus, TeaExtractionStatus.titleOnly);
      expect(c.missingFields, contains('body'));
      expect(c.hasSubstantialBody, isFalse);
      expect(c.storyTextForAi, isEmpty);
    });

    test('marks complete when long body present', () {
      final body = List.filled(12, 'Ganguly fortune from IPL roles, endorsements, and media work. ')
          .join();
      final c = extractedTeaContentFromRow({
        'title': 'Sourav Ganguly Net Worth',
        'url': 'https://example.com/a',
        'bodyText': body,
        'contentStatus': 'complete',
      });
      expect(c.extractionStatus, TeaExtractionStatus.complete);
      expect(c.hasSubstantialBody, isTrue);
      expect(c.storyTextForAi, contains('endorsements'));
    });

    test('rejects feed markup in description as body', () {
      final c = extractedTeaContentFromRow({
        'title': 'Sourav Ganguly Net Worth',
        'url': 'https://example.com/a',
        'description':
            '&lt;a href="https://news.google.com/rss/articles/CBMi"&gt;link&lt;/a&gt;',
      });
      expect(c.extractionStatus, TeaExtractionStatus.titleOnly);
      expect(c.body, isEmpty);
      expect(c.storyTextForAi, isEmpty);
    });

    test('does not treat title echo as body', () {
      final c = extractedTeaContentFromRow({
        'title': 'Sourav Ganguly Net Worth',
        'url': 'https://example.com/a',
        'description': 'Sourav Ganguly Net Worth',
      });
      expect(c.extractionStatus, TeaExtractionStatus.titleOnly);
      expect(c.body, isEmpty);
    });
  });

  group('analyzeTeaVisualContext', () {
    test('net-worth headline with body marks person central', () {
      final content = extractedTeaContentFromRow({
        'title': 'Sourav Ganguly Net Worth',
        'url': 'https://example.com/a',
        'body':
            'Sourav Ganguly built wealth through cricket leadership, commentary deals, and business investments across India.',
      });
      final visual = analyzeTeaVisualContext(content);
      expect(visual.bodyGrounded, isTrue);
      expect(visual.peopleCentral.any((p) => p.contains('Ganguly')), isTrue);
      expect(visual.toImagePromptBlock(), contains('Sourav Ganguly'));
      expect(visual.tone, 'business profile');
    });

    test('incidental famous name is not forced as sole visual subject', () {
      final content = extractedTeaContentFromRow({
        'title': 'IPL auction surprises fans',
        'url': 'https://example.com/a',
        'body':
            'Several franchises reshuffled their squads overnight. Analysts also recalled how Sourav Ganguly once reshaped team culture years ago, but tonight’s story is about the auction table.',
      });
      final visual = analyzeTeaVisualContext(content);
      expect(visual.bodyGrounded, isTrue);
      // Title subject is auction; Ganguly may appear in people list but claim stays auction-focused.
      expect(visual.centralClaim.toLowerCase(), contains('auction'));
    });

    test('title-only warns image prompt not to invent biography', () {
      final content = extractedTeaContentFromRow({
        'title': 'Sourav Ganguly Net Worth',
        'url': 'https://example.com/a',
      });
      final visual = analyzeTeaVisualContext(content);
      expect(visual.bodyGrounded, isFalse);
      expect(
        visual.toImagePromptBlock().toLowerCase(),
        contains('unavailable'),
      );
    });

    test('politics headline marks named leader as central for photoreal prompt', () {
      final content = extractedTeaContentFromRow({
        'title': 'Narendra Modi Announces a Major Policy Decision',
        'url': 'https://example.com/modi',
      });
      final visual = analyzeTeaVisualContext(content);
      expect(visual.peopleCentral.any((p) => p.contains('Modi')), isTrue);
      expect(visual.tone, 'politics');
      expect(visual.toImagePromptBlock().toLowerCase(), contains('photorealistic'));
    });

    test('cricket headline features Kohli in sports photoreal concept', () {
      final content = extractedTeaContentFromRow({
        'title': 'Virat Kohli Leads India to a Dramatic Victory',
        'url': 'https://example.com/kohli',
      });
      final visual = analyzeTeaVisualContext(content);
      expect(visual.peopleCentral.any((p) => p.contains('Kohli')), isTrue);
      expect(visual.tone, 'sports');
      expect(visual.visualConcept.toLowerCase(), contains('kohli'));
    });

    test('protest headline uses illustrative civic scene guidance', () {
      final content = extractedTeaContentFromRow({
        'title': 'Police Detain Protesters During Demonstrations in Delhi',
        'url': 'https://example.com/protest',
      });
      final visual = analyzeTeaVisualContext(content);
      expect(visual.tone, 'protest / civic');
      expect(visual.peopleCentral, isEmpty);
      final block = visual.toImagePromptBlock().toLowerCase();
      expect(block, contains('illustrative'));
      expect(block, contains('sensitive news'));
    });
  });
}
