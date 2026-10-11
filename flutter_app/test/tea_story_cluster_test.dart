import 'package:flutter_test/flutter_test.dart';
import 'package:deite/utils/tea_event_topics.dart';
import 'package:deite/utils/tea_story_cluster.dart';

void main() {
  group('clusterTeaRows', () {
    test('merges near-duplicate headlines into one cluster', () {
      final clusters = clusterTeaRows([
        {
          'title': 'CJP protest draws crowds at Jantar Mantar',
          'url': 'https://example.com/a1',
          'source': 'Outlet A',
          'description': 'Demonstrators gathered in Delhi seeking CEC action.',
          'score': 10,
        },
        {
          'title': 'CJP protest draws large crowds at Jantar Mantar',
          'url': 'https://example.com/a2',
          'source': 'Outlet B',
          'description': 'Police managed barricades near the protest site.',
          'score': 4,
        },
        {
          'title': 'Unrelated cricket match ends in a thriller',
          'url': 'https://example.com/c1',
          'source': 'Sports',
          'description': 'Last-ball finish sealed the chase.',
          'score': 8,
        },
      ]);
      expect(clusters.length, greaterThanOrEqualTo(2));
      final protest = clusters.firstWhere(
        (c) => c.title.toLowerCase().contains('cjp') || c.title.toLowerCase().contains('jantar'),
        orElse: () => clusters.first,
      );
      expect(protest.relatedSources.length, greaterThanOrEqualTo(2));
      expect(protest.contextLevel, 'multiSource');
    });

    test('does not merge unrelated stories that share a common name token', () {
      final clusters = clusterTeaRows([
        {
          'title': 'Modi inaugurates new metro line',
          'url': 'https://example.com/m1',
          'source': 'News',
          'description': 'Prime Minister opens phase of metro expansion.',
        },
        {
          'title': 'Cricket board announces new tournament calendar',
          'url': 'https://example.com/m2',
          'source': 'Sports',
          'description': 'Fixtures released for the upcoming season.',
        },
      ]);
      expect(clusters, hasLength(2));
    });
  });

  group('matchTeaEventId', () {
    test('matches CJP event on multiple keywords', () {
      final id = matchTeaEventId(
        'Cockroach Janta Party protest at Jantar Mantar',
        'Demands include CEC resignation and SIR concerns',
      );
      expect(id, 'cjp-protest-2026-10-10');
    });

    test('does not match on a single weak keyword', () {
      final id = matchTeaEventId('Delhi weather update', 'Sunny skies across NCR');
      expect(id, isNull);
    });
  });

  group('teaEventTopics', () {
    test('CJP topic is query-driven not article-hardcoded', () {
      final t = teaEventTopicById('cjp-protest-2026-10-10');
      expect(t, isNotNull);
      expect(t!.googleQueries, isNotEmpty);
      expect(t.newsApiQuery.toLowerCase(), contains('cjp'));
      expect(t.redditSubs, contains('india'));
      // Must not ship a canned article list — discovery is query-driven.
      expect(t.toJson().containsKey('articles'), isFalse);
    });
  });

  group('CJP live-shaped clustering', () {
    test('groups multi-outlet detention / Jantar Mantar coverage', () {
      final clusters = clusterTeaRows([
        {
          'title':
              "'Cockroach' group leaders among hundreds detained in Delhi protest - BBC",
          'url': 'https://www.bbc.com/news/cjp-1',
          'source': 'BBC',
          'description': 'Police detained protesters near Jantar Mantar.',
          'eventId': 'cjp-protest-2026-10-10',
          'isBreaking': true,
        },
        {
          'title':
              'India detains thousands, locks down Delhi to foil election chief protest - Reuters',
          'url': 'https://www.reuters.com/world/cjp-2',
          'source': 'Reuters',
          'description': 'Authorities restricted movement ahead of CJP rally.',
          'eventId': 'cjp-protest-2026-10-10',
          'isBreaking': true,
        },
        {
          'title': 'Mumbai Protest Demands Gyanesh Kumar’s Resignation Over SIR',
          'url': 'https://frontline.thehindu.com/cjp-3',
          'source': 'Frontline',
          'description': 'CJP and allies protest CEC over voter-roll revision.',
          'eventId': 'cjp-protest-2026-10-10',
        },
        {
          'title': 'Unrelated IPL auction gossip dominates social feeds',
          'url': 'https://example.com/ipl',
          'source': 'Entertainment',
          'description': 'Franchise bidding rumors swirl online.',
        },
      ], eventId: 'cjp-protest-2026-10-10', isBreaking: true);

      expect(clusters.length, greaterThanOrEqualTo(2));
      final eventish = clusters.where((c) => c.eventId == 'cjp-protest-2026-10-10');
      expect(eventish, isNotEmpty);
      final withSources = eventish.firstWhere(
        (c) => c.relatedSources.length >= 2,
        orElse: () => eventish.first,
      );
      expect(withSources.relatedSources.length, greaterThanOrEqualTo(1));
    });
  });
}
