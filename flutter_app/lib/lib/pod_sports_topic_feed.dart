import 'package:deite/services/sports_personalization_service.dart';

import 'pod_reddit_hot.dart';
import 'pod_topic_news_shared.dart';

const Map<String, String> googleBrowseQuery = {
  'cricket': 'cricket OR IPL OR T20 OR Ashes',
  'football':
      '"Major League Soccer" OR MLS OR NWSL OR USMNT OR USWNT OR "US Soccer"',
  'f1': '"Formula 1" OR F1 OR "Grand Prix"',
  'chess': 'chess OR FIDE OR grandmaster OR Candidates',
  'others': 'sports',
};

const Map<String, List<String>> redditSportsSubs = {
  'cricket': ['Cricket', 'IndianCricket', 'IndiaCricketGossips'],
  'football': [
    'Championship',
    'Soccer',
    'Football',
    'PremierLeague',
    'Soccercirclejerk',
  ],
  'f1': ['formula1', 'F1Discussions', 'formuladank', 'F1FeederSeries', 'GrandPrixRacing'],
  'chess': ['chess', 'TournamentChess', 'AnarchyChess', 'chessmemes'],
  'others': ['sports', 'sportsdiscussion', 'sportsarefun'],
};

const Map<String, Map<String, String>> sportsTopicMeta = {
  'cricket': {
    'label': 'Cricket',
    'q': '(cricket OR IPL OR "test cricket" OR T20 OR BBL OR PSL OR Ashes OR wicket)',
  },
  'football': {
    'label': 'Football',
    'q':
        '("Major League Soccer" OR MLS OR NWSL OR USMNT OR USWNT OR "US Soccer" OR "U.S. Soccer" OR "Inter Miami" OR LAFC OR "LA Galaxy" OR "Atlanta United" OR "Seattle Sounders" OR "Leagues Cup")',
  },
  'f1': {
    'label': 'F1',
    'q':
        '("Formula 1" OR "Formula One" OR F1 OR "Grand Prix" OR qualifying OR pitwall OR constructors)',
  },
  'chess': {
    'label': 'Chess',
    'q':
        '(chess OR FIDE OR grandmaster OR Carlsen OR Nakamura OR Candidates OR lichess OR Chess.com)',
  },
  'others': {'label': 'Other sports', 'q': ''},
};

String getSportsTopicLabel(String topicId) =>
    sportsTopicMeta[topicId]?['label'] ?? 'Sports';

String browseTopicOnGoogleNews(String topicId) {
  final q = googleBrowseQuery[topicId] ?? googleBrowseQuery['others']!;
  return googleNewsSearchUrl(q.trim());
}

bool sportArticleMatchesTopic(String topicId, Map<String, dynamic> item) {
  final blob = '${item['title'] ?? ''} ${item['description'] ?? ''}';
  if (blob.trim().isEmpty) return false;
  switch (topicId) {
    case 'cricket':
      return RegExp(
            r'\b(cricket|cricketer|cricketers|cricketing)\b',
            caseSensitive: false,
          ).hasMatch(blob) ||
          RegExp(r'\b(ipl|wpl|psl|bbl|cpl|ilt20|sa20)\b', caseSensitive: false)
              .hasMatch(blob) ||
          RegExp(r'\b(ashes|wicket|wickets|super over|follow[- ]on)\b',
                  caseSensitive: false)
              .hasMatch(blob) ||
          RegExp(r'\b(t20|t-20|twenty-?20)\b', caseSensitive: false).hasMatch(blob) ||
          RegExp(r'\b(odi|one[- ]day international|one[- ]dayers)\b',
                  caseSensitive: false)
              .hasMatch(blob) ||
          RegExp(r'\b(test match|test series|pink[- ]ball|day[- ]night test)\b',
                  caseSensitive: false)
              .hasMatch(blob) ||
          RegExp(r'\b(bcci|pcb\b|slc|nzc)\b', caseSensitive: false).hasMatch(blob) ||
          RegExp(
            r'\b(batsman|batsmen|batters?|bowlers?|stumping|lbw|googly|yorker|bouncer|maiden)\b',
            caseSensitive: false,
          ).hasMatch(blob);
    case 'football':
      if (RegExp(
            r'\b(nfl|super bowl|touchdown|quarterback|ncaa football|nfl draft|afc championship|nfc championship|gridiron)\b',
            caseSensitive: false,
          ).hasMatch(blob) &&
          !RegExp(r'\b(soccer|mls|nwsl|fifa|goalkeeper|usmnt|uswnt)\b',
                  caseSensitive: false)
              .hasMatch(blob)) {
        return false;
      }
      final mlsNwslFed = RegExp(
            r"\b(mls|nwsl|major league soccer|national women's soccer league)\b",
            caseSensitive: false,
          ).hasMatch(blob) ||
          RegExp(r'\b(usmnt|uswnt)\b', caseSensitive: false).hasMatch(blob) ||
          RegExp(
            r'\b(us soccer|u\.s\. soccer|ussf|united states soccer federation)\b',
            caseSensitive: false,
          ).hasMatch(blob);
      final usNatTeam = RegExp(r'\bsoccer\b', caseSensitive: false).hasMatch(blob) &&
          RegExp(r'\b(united states|u\.s\.|usa)\b', caseSensitive: false).hasMatch(blob) &&
          RegExp(r"\b(men'?s national|women'?s national|national team)\b",
                  caseSensitive: false)
              .hasMatch(blob);
      final mlsClub = RegExp(
        r'\b(inter miami|lafc|la galaxy|atlanta united|seattle sounders|portland timbers|orlando city|philadelphia union|austin fc|st\.?\s*louis city sc|columbus crew|sporting kansas city|new york city fc|nycfc|dc united|chicago fire|minnesota united|houston dynamo|fc dallas|colorado rapids|real salt lake|san jose earthquakes|vancouver whitecaps|toronto fc|cf montreal|new england revolution|nashville sc|charlotte fc|red bulls|rb ny)\b',
        caseSensitive: false,
      ).hasMatch(blob);
      final usCup = RegExp(r'\b(leagues cup|gold cup)\b', caseSensitive: false)
              .hasMatch(blob) &&
          RegExp(r'\b(united states|u\.s\.|usa|usmnt|uswnt|american)\b',
                  caseSensitive: false)
              .hasMatch(blob);
      final soccerInAmerica = RegExp(r'\bsoccer\b', caseSensitive: false).hasMatch(blob) &&
          RegExp(r'\b(united states|u\.s\.|usa|american|mls|nwsl|usmnt|uswnt)\b',
                  caseSensitive: false)
              .hasMatch(blob);
      return mlsNwslFed || usNatTeam || mlsClub || usCup || soccerInAmerica;
    case 'f1':
      return RegExp(r'\b(formula\s*1|formula one|\bf1\b)\b', caseSensitive: false)
              .hasMatch(blob) ||
          RegExp(
            r'\b(grand prix|qualifying|paddock|constructor|pit stop|pole position)\b',
            caseSensitive: false,
          ).hasMatch(blob) ||
          RegExp(
            r'\b(verstappen|hamilton|leclerc|norris|red bull racing|ferrari f1|mclaren f1|mercedes f1)\b',
            caseSensitive: false,
          ).hasMatch(blob);
    case 'chess':
      return RegExp(
            r'\b(chess|fide|grandmaster|grandmasters|lichess|chess\.com)\b',
            caseSensitive: false,
          ).hasMatch(blob) ||
          RegExp(
            r'\b(carlsen|nakamura|firouzja|ding liren|gukesh|praggnanandhaa)\b',
            caseSensitive: false,
          ).hasMatch(blob) ||
          RegExp(
            r'\b(fide candidates|candidates tournament|tata steel chess|grand chess tour)\b',
            caseSensitive: false,
          ).hasMatch(blob);
    default:
      return true;
  }
}

bool matchesMainTopic(String text) {
  final t = text.toLowerCase();
  final cricket = RegExp(
    r'\b(cricket|ipl|ashes|t20|odi|bbl|psl|wicket|test match|super over)\b',
    caseSensitive: false,
  ).hasMatch(t);
  final football = RegExp(
        r'\b(soccer|nfl|ncaa football|fifa|uefa|premier league|champions league|la liga|bundesliga|serie a|mls|world cup)\b',
        caseSensitive: false,
      ).hasMatch(t) ||
      RegExp(r'\bfootball\b', caseSensitive: false).hasMatch(t);
  final f1 = RegExp(
    r'\b(formula\s*1|formula one|\bf1\b|grand prix|qualifying|constructor championship|paddock)\b',
    caseSensitive: false,
  ).hasMatch(t);
  final chess = RegExp(r'\b(chess|fide|grandmaster|carlsen|nakamura|lichess)\b',
          caseSensitive: false)
      .hasMatch(t);
  return cricket || football || f1 || chess;
}

List<Map<String, dynamic>> buildSportsFallbackRows(String topicId, String label) {
  final q = googleBrowseQuery[topicId] ?? googleBrowseQuery['others']!;
  final baseUrl = googleNewsSearchUrl(q.trim());
  final now = DateTime.now().toUtc().toIso8601String();
  return List.generate(6, (i) {
    return {
      'title': '$label update ${i + 1}',
      'source': 'News',
      'url': baseUrl,
      'image': null,
      'description': '$label roundup',
      'publishedAt': now,
      'sourceSiteUrl': '',
      'publisherUrl': '',
    };
  });
}

Future<List<NewsArticle>> fetchSportsHubTrendingCarouselItems() async {
  const topicOpts = {
    'cricket': {'maxPerSub': 45, 'maxKeep': 22, 'minScore': 14},
    'football': {'maxPerSub': 40, 'maxKeep': 22, 'minScore': 12},
    'f1': {'maxPerSub': 40, 'maxKeep': 22, 'minScore': 10},
    'chess': {'maxPerSub': 40, 'maxKeep': 22, 'minScore': 8},
    'others': {'maxPerSub': 45, 'maxKeep': 26, 'minScore': 10},
  };

  final ordered = <NewsArticle>[];
  for (final topicId in podSportsExploreSlugs) {
    final base = topicOpts[topicId] ?? {'maxPerSub': 40, 'maxKeep': 22, 'minScore': 10};
    final subs = redditSportsSubs[topicId] ?? [];
    final filterPost = topicId == 'others'
        ? (Map<String, dynamic> post) {
            final blob =
                '${post['title'] ?? ''} ${post['selftext'] is String ? post['selftext'] : ''}';
            return !matchesMainTopic(blob);
          }
        : null;

    var rows = await tryRedditHotRows(
      subs,
      maxPerSub: base['maxPerSub']!,
      maxKeep: base['maxKeep']!,
      minScore: base['minScore']!,
      filterPost: filterPost,
    );
    var pick = pickBestHubCarouselRow(rows);
    if (pick == null && base['minScore']! > 6) {
      rows = await tryRedditHotRows(
        subs,
        maxPerSub: base['maxPerSub']!,
        maxKeep: base['maxKeep']!,
        minScore: 6,
        filterPost: filterPost,
      );
      pick = pickBestHubCarouselRow(rows);
    }
    if (pick != null) {
      ordered.add(
        NewsArticle.fromNormalized(
          hubCarouselFromRedditRow(pick, exploreTopic: topicId),
        ),
      );
    }
  }
  return ordered;
}

Future<List<Map<String, dynamic>>> _trySportsRowsFromGoogleRss(String topicId) async {
  final rssQ = switch (topicId) {
    'cricket' => 'cricket OR IPL OR T20 when:7d',
    'football' => 'soccer OR MLS OR Premier League when:7d',
    'f1' => 'Formula 1 OR F1 when:7d',
    'chess' => 'chess OR FIDE when:7d',
    _ => 'sports when:7d',
  };
  final rssItems = await fetchLiveFromGoogleRssByQuery(rssQ);
  if (topicId == 'others') {
    final filtered = rssItems.where((a) {
      final blob = '${a['title']} ${a['description'] ?? ''}';
      return !matchesMainTopic(blob);
    }).toList();
    return filtered.isNotEmpty ? filtered.take(30).toList() : [];
  }
  var picked = rssItems.where((a) => sportArticleMatchesTopic(topicId, a)).take(30).toList();
  if (picked.isEmpty) picked = rssItems.take(30).toList();
  else if (topicId == 'football' && picked.length < 6) {
    final urls = picked.map((p) => p['url']).whereType<String>().toSet();
    for (final a in rssItems) {
      if (picked.length >= 18) break;
      final u = a['url'];
      if (u is String && u.isNotEmpty && !urls.contains(u)) {
        urls.add(u);
        picked = [...picked, a];
      }
    }
  }
  return picked;
}

Set<String> _normTitleWords(String s) => s
    .toLowerCase()
    .replaceAll(RegExp(r'https?://\S+'), ' ')
    .replaceAll(RegExp(r'[^a-z0-9\s]'), ' ')
    .split(RegExp(r'\s+'))
    .where((w) => w.length > 2)
    .toSet();

List<Map<String, dynamic>> _dedupeByTitleJaccard(List<Map<String, dynamic>> enriched) {
  double jaccard(String a, String b) {
    final A = _normTitleWords(a);
    final B = _normTitleWords(b);
    if (A.isEmpty || B.isEmpty) return 0;
    final inter = A.where(B.contains).length;
    final uni = A.length + B.length - inter;
    return uni == 0 ? 0 : inter / uni;
  }

  final deduped = <Map<String, dynamic>>[];
  for (final it in enriched) {
    final title = '${it['title'] ?? ''}';
    if (title.isEmpty) continue;
    final already = deduped.any((x) => jaccard('${x['title']}', title) >= 0.62);
    if (!already) deduped.add(it);
  }
  return deduped;
}

Future<List<Map<String, dynamic>>> _loadNewsApiSportsRows(
  String topicId,
  Map<String, String> config,
) async {
  if (topicId == 'others') {
    final normalized = await fetchNewsApiTopHeadlinesNormalized(
      category: 'sports',
      language: 'en',
      pageSize: 100,
    );
    final filtered = normalized.where((a) {
      final blob = '${a['title']} ${a['description'] ?? ''}';
      return !matchesMainTopic(blob);
    }).toList();
    return filtered.take(30).toList();
  }
  final q = config['q'] ?? '';
  if (q.isEmpty) return [];

  var fetched = await fetchNewsApiEverythingNormalized(q: q, pageSize: 100);
  var onTopic = fetched.where((a) => sportArticleMatchesTopic(topicId, a)).toList();

  if (onTopic.isEmpty) {
    final narrowQ = switch (topicId) {
      'cricket' => 'cricket OR IPL',
      'football' => 'soccer OR MLS',
      'f1' => 'Formula 1',
      'chess' => 'chess OR FIDE',
      _ => null,
    };
    if (narrowQ != null) {
      fetched = await fetchNewsApiEverythingNormalized(q: narrowQ, pageSize: 60);
      onTopic = fetched.where((a) => sportArticleMatchesTopic(topicId, a)).toList();
    }
  }

  if (onTopic.isEmpty) {
    final qHead = switch (topicId) {
      'cricket' => 'cricket',
      'football' => 'soccer',
      'f1' => 'F1',
      'chess' => 'chess',
      _ => '',
    };
    final thSports = await fetchNewsApiTopHeadlinesNormalized(
      category: 'sports',
      language: 'en',
      pageSize: 100,
      q: qHead.isEmpty ? null : qHead,
    );
    onTopic = thSports.where((a) => sportArticleMatchesTopic(topicId, a)).toList();
    if (onTopic.isEmpty && topicId == 'cricket') {
      final thIn = await fetchNewsApiTopHeadlinesNormalized(
        country: 'in',
        language: 'en',
        pageSize: 50,
        q: 'cricket',
      );
      onTopic = thIn.where((a) => sportArticleMatchesTopic(topicId, a)).toList();
      if (onTopic.isEmpty && thIn.isNotEmpty) onTopic = thIn.take(30).toList();
    }
    if (onTopic.isEmpty && thSports.isNotEmpty) onTopic = thSports.take(30).toList();
  }

  return onTopic.take(30).toList();
}

List<Map<String, dynamic>> _mergeSportsApiAndRss(
  List<Map<String, dynamic>> apiRows,
  List<Map<String, dynamic>> rssRows, {
  int maxKeep = 36,
}) {
  final seen = <String>{};
  final out = <Map<String, dynamic>>[];
  for (final r in apiRows) {
    final u = '${r['url'] ?? ''}'.trim();
    if (u.isEmpty || seen.contains(u)) continue;
    seen.add(u);
    out.add(r);
  }
  for (final r in rssRows) {
    final u = '${r['url'] ?? ''}'.trim();
    if (u.isEmpty || seen.contains(u)) continue;
    seen.add(u);
    out.add(r);
    if (out.length >= maxKeep) break;
  }
  return out;
}

class SportsTopicFeedResult {
  const SportsTopicFeedResult({
    required this.items,
    this.error = '',
    this.allowRewrite = false,
  });
  final List<NewsArticle> items;
  final String error;
  final bool allowRewrite;
}

Future<SportsTopicFeedResult> fetchSportsTopicRawItemsResult(
  String topicId, {
  bool rssOnlyPrefetch = false,
}) async {
  final config = sportsTopicMeta[topicId];
  if (config == null) {
    return const SportsTopicFeedResult(items: [], allowRewrite: false);
  }
  final title = config['label']!;

  if (topicId == 'cricket') {
    final redditRows = await tryRedditHotRows(
      redditSportsSubs['cricket']!,
      maxPerSub: 50,
      maxKeep: 18,
      minScore: 18,
    );
    if (redditRows.isNotEmpty) {
      return SportsTopicFeedResult(items: mapsToNewsArticles(redditRows));
    }
    return SportsTopicFeedResult(
      items: mapsToNewsArticles(buildSportsFallbackRows(topicId, title)),
      error: 'Cricket posts are unavailable from Reddit right now. Try again shortly.',
    );
  }

  if (topicId == 'football') {
    final redditRows = await tryRedditHotRows(
      redditSportsSubs['football']!,
      maxPerSub: 40,
      maxKeep: 22,
      minScore: 16,
    );
    if (redditRows.isNotEmpty) {
      return SportsTopicFeedResult(items: mapsToNewsArticles(redditRows));
    }
  }

  if (topicId == 'f1') {
    final redditRows = await tryRedditHotRows(
      redditSportsSubs['f1']!,
      maxPerSub: 40,
      maxKeep: 22,
      minScore: 14,
    );
    if (redditRows.isNotEmpty) {
      return SportsTopicFeedResult(items: mapsToNewsArticles(redditRows));
    }
  }

  if (topicId == 'chess') {
    final redditRows = await tryRedditHotRows(
      redditSportsSubs['chess']!,
      maxPerSub: 40,
      maxKeep: 22,
      minScore: 12,
    );
    if (redditRows.isNotEmpty) {
      return SportsTopicFeedResult(items: mapsToNewsArticles(redditRows));
    }
  }

  if (topicId == 'others') {
    final redditRows = await tryRedditHotRows(
      redditSportsSubs['others']!,
      maxPerSub: 45,
      maxKeep: 28,
      minScore: 14,
      filterPost: (post) {
        final blob =
            '${post['title'] ?? ''} ${post['selftext'] is String ? post['selftext'] : ''}';
        return !matchesMainTopic(blob);
      },
    );
    if (redditRows.isNotEmpty) {
      return SportsTopicFeedResult(items: mapsToNewsArticles(redditRows));
    }
  }

  if (!canFetchLiveNews()) {
    return SportsTopicFeedResult(
      items: mapsToNewsArticles(buildSportsFallbackRows(topicId, title)),
      error:
          'Backend NewsAPI is unavailable. Set NEWSAPI_KEY on the server (Firebase Functions: `newsApi`). Showing browse links only.',
    );
  }

  final cooldown = isNewsApiRateLimitedCooldown();
  final rssRows = await _trySportsRowsFromGoogleRss(topicId);
  final apiRows = rssOnlyPrefetch || cooldown
      ? <Map<String, dynamic>>[]
      : await _loadNewsApiSportsRows(topicId, config);

  var rows = _mergeSportsApiAndRss(apiRows, rssRows, maxKeep: 40);
  final apiLen = apiRows.length;
  final rssLen = rssRows.length;

  if (rows.isEmpty) {
    final picked = await _trySportsRowsFromGoogleRss(topicId);
    if (picked.isNotEmpty) rows = picked;
  }

  if (rows.isEmpty) {
    return SportsTopicFeedResult(
      items: mapsToNewsArticles(buildSportsFallbackRows(topicId, title)),
      error:
          'News returned no articles. Set NEWSAPI_KEY on Firebase Functions (`newsApi`) or pass keys at build time.',
    );
  }

  rows = rows.take(30).toList();
  final enriched = await enrichNewsItemsWithOgImages(
    rows,
    enableOgFallback: !rssOnlyPrefetch,
    maxResolve: rssOnlyPrefetch ? 0 : 10,
    concurrency: rssOnlyPrefetch ? 1 : 2,
  );
  final deduped = _dedupeByTitleJaccard(enriched);
  final rssOnlyMerged = apiLen == 0 && rssLen > 0;
  return SportsTopicFeedResult(
    items: mapsToNewsArticles(deduped.isNotEmpty ? deduped : enriched),
    allowRewrite: !rssOnlyMerged,
  );
}

Future<List<NewsArticle>> fetchSportsTopicRawItems(
  String topicId, {
  bool rssOnlyPrefetch = false,
}) async {
  final r = await fetchSportsTopicRawItemsResult(
    topicId,
    rssOnlyPrefetch: rssOnlyPrefetch,
  );
  return r.items;
}

List<NewsArticle> buildFallbackRows(String topicId, String label) =>
    mapsToNewsArticles(buildSportsFallbackRows(topicId, label));
