/// Query-driven Tea event topics — reusable for protests, elections, sports, celebs.
/// Discovery uses these search strings; articles are never hardcoded.
class TeaEventTopic {
  const TeaEventTopic({
    required this.eventId,
    required this.label,
    required this.category,
    required this.googleQueries,
    required this.newsApiQuery,
    required this.redditQuery,
    required this.redditSubs,
    required this.youtubeQuery,
    this.keywords = const [],
    this.isBreaking = false,
    this.startDate,
  });

  final String eventId;
  final String label;
  final String category;
  final List<String> googleQueries;
  final String newsApiQuery;
  final String redditQuery;
  final List<String> redditSubs;
  final String youtubeQuery;
  final List<String> keywords;
  final bool isBreaking;
  final DateTime? startDate;

  Map<String, dynamic> toJson() => {
        'eventId': eventId,
        'label': label,
        'category': category,
        'googleQueries': googleQueries,
        'newsApiQuery': newsApiQuery,
        'redditQuery': redditQuery,
        'redditSubs': redditSubs,
        'youtubeQuery': youtubeQuery,
        'keywords': keywords,
        'isBreaking': isBreaking,
        if (startDate != null) 'startDate': startDate!.toIso8601String(),
      };
}

/// Tea feed section ids (UI chips).
enum TeaFeedSection {
  forYou,
  trending,
  breaking,
  reddit,
  socialBuzz,
  fun,
  events,
}

extension TeaFeedSectionX on TeaFeedSection {
  String get label {
    switch (this) {
      case TeaFeedSection.forYou:
        return 'For You';
      case TeaFeedSection.trending:
        return 'Trending';
      case TeaFeedSection.breaking:
        return 'Breaking';
      case TeaFeedSection.reddit:
        return 'Reddit';
      case TeaFeedSection.socialBuzz:
        return 'Social';
      case TeaFeedSection.fun:
        return 'Fun';
      case TeaFeedSection.events:
        return 'Events';
    }
  }

  String get id => name;
}

/// Section → Google News RSS query profiles (expandable, not single-source).
const Map<TeaFeedSection, List<String>> teaSectionGoogleQueries = {
  TeaFeedSection.breaking: [
    '(breaking OR "developing story" OR "live updates") (India OR world) when:1d',
    '("top news" OR headlines) India when:1d',
  ],
  TeaFeedSection.trending: [
    '(trending OR viral) India when:2d',
    '(politics OR parliament OR election) India when:2d',
  ],
  TeaFeedSection.fun: [
    '(meme OR viral OR funny OR "internet culture") India when:3d',
    '(Bollywood OR celebrity OR gossip) India when:3d',
    '(cricket OR IPL) (viral OR meme OR moment) when:3d',
  ],
  TeaFeedSection.forYou: [
    '(India news OR technology OR cricket OR Bollywood) when:2d',
    '(AI OR startup OR business) India when:3d',
  ],
  TeaFeedSection.reddit: [],
  TeaFeedSection.socialBuzz: [
    '(YouTube OR viral video) India when:2d',
  ],
  TeaFeedSection.events: [],
};

/// Reddit subs discovered per lane (dynamic expansion can append at runtime).
const Map<TeaFeedSection, List<String>> teaSectionRedditSubs = {
  TeaFeedSection.reddit: [
    'india',
    'IndiaSpeaks',
    'unitedstatesofindia',
    'Cricket',
    'bollywood',
    'BollyBlindsNGossip',
    'technology',
    'worldnews',
  ],
  TeaFeedSection.fun: [
    'IndianDankMemes',
    'bollywood',
    'CricketShitpost',
    'BollyBlindsNGossip',
  ],
  TeaFeedSection.breaking: ['india', 'worldnews', 'IndiaSpeaks'],
  TeaFeedSection.trending: ['india', 'BollyBlindsNGossip', 'Cricket'],
  TeaFeedSection.forYou: ['india', 'BollyBlindsNGossip', 'technology'],
  TeaFeedSection.socialBuzz: ['india', 'videos'],
  TeaFeedSection.events: ['india', 'IndiaSpeaks', 'unitedstatesofindia'],
};

/// Registered event topics. CJP Oct 10 2026 is the first concrete event —
/// discovered via queries, not a hardcoded article list.
final List<TeaEventTopic> teaEventTopics = [
  TeaEventTopic(
    eventId: 'cjp-protest-2026-10-10',
    label: 'CJP protest — 10 Oct 2026',
    category: 'politics',
    isBreaking: true,
    startDate: DateTime.utc(2026, 10, 10),
    googleQueries: [
      '("Cockroach Janta Party" OR CJP) (protest OR rally OR "Jantar Mantar") when:14d',
      '("Jantar Mantar") (protest OR CJP OR "Cockroach Janta") when:14d',
      '("Gyanesh Kumar" OR CEC) (resign OR resignation OR CJP OR protest) when:14d',
      '("Special Intensive Revision" OR SIR) (voter OR electoral OR roll) (protest OR CJP) when:14d',
      '(CJP OR "Cockroach Janta") (Mumbai OR Bengaluru OR Bangalore OR Ahmedabad OR Delhi) protest when:14d',
    ],
    newsApiQuery:
        '("Cockroach Janta Party" OR CJP) AND (protest OR "Jantar Mantar" OR CEC OR "Gyanesh Kumar" OR SIR)',
    redditQuery: 'CJP OR "Cockroach Janta" OR "Jantar Mantar" protest OR "Gyanesh Kumar"',
    redditSubs: [
      'india',
      'IndiaSpeaks',
      'unitedstatesofindia',
      'Delhi',
      'KeralaSpeaks',
      'indiaworldnews',
    ],
    youtubeQuery: 'CJP protest Jantar Mantar Cockroach Janta Party October 2026',
    keywords: [
      'CJP',
      'Cockroach Janta Party',
      'Jantar Mantar',
      'Gyanesh Kumar',
      'CEC',
      'Special Intensive Revision',
      'SIR',
      'voter roll',
    ],
  ),
];

TeaEventTopic? teaEventTopicById(String id) {
  for (final t in teaEventTopics) {
    if (t.eventId == id) return t;
  }
  return null;
}
