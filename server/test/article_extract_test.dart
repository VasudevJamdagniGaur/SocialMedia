import 'package:deite_server/utils/article_extract.dart';
import 'package:test/test.dart';

void main() {
  setUp(clearArticleExtractCache);

  group('classifyContentStatus', () {
    test('unavailable when body empty', () {
      expect(
        classifyContentStatus(title: 'Hello', bodyText: '', description: ''),
        'unavailable',
      );
    });

    test('partial when meta description only', () {
      expect(
        classifyContentStatus(
          title: 'Hello World',
          bodyText: '',
          description: 'A short but real description about the story topic.',
        ),
        'partial',
      );
    });

    test('complete when long body', () {
      final body = List.filled(20, 'Paragraph about the actual news event. ').join();
      expect(
        classifyContentStatus(title: 'Event headline', bodyText: body, description: ''),
        'complete',
      );
    });

    test('never treats title echo as complete body', () {
      expect(
        classifyContentStatus(
          title: 'Sourav Ganguly Net Worth',
          bodyText: 'Sourav Ganguly Net Worth',
          description: '',
        ),
        'unavailable',
      );
    });
  });

  group('extractReadableTextFromHtml', () {
    test('prefers article paragraphs over nav junk', () {
      const html = '''
<html><body>
<nav>Home About Subscribe Cookie settings</nav>
<article>
  <h1>Match report</h1>
  <p>The home side dominated possession for most of the evening under bright lights.</p>
  <p>Key moments included a late equalizer and a tense stoppage-time finish for fans.</p>
  <p>Coaches praised the defensive shape after a difficult midweek schedule.</p>
</article>
<aside class="related">Related: more stories you may like</aside>
</body></html>
''';
      final text = extractReadableTextFromHtml(html);
      expect(text.toLowerCase(), contains('dominated possession'));
      expect(text.toLowerCase(), contains('late equalizer'));
      expect(text.toLowerCase(), isNot(contains('cookie settings')));
    });

    test('handles HTML entities in paragraphs', () {
      const html = '''
<html><body><article>
<p>Wealth &amp; legacy: Ganguly&apos;s career spanned &quot;two decades&quot; of cricket.</p>
<p>Analysts noted commentary deals and board roles after retirement from Tests.</p>
</article></body></html>
''';
      final text = extractReadableTextFromHtml(html);
      expect(text, contains('Wealth & legacy'));
      expect(text, contains("Ganguly's career"));
      expect(text, contains('two decades'));
    });
  });

  group('decodeGoogleNewsArticleIdUrl', () {
    test('returns null for non google news urls', () {
      expect(decodeGoogleNewsArticleIdUrl('https://example.com/a'), isNull);
    });
  });
}
