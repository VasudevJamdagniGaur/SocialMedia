/// Hub â†’ Trending ranking: engagement with time decay, interest/city boosts, feed mixing.

import 'package:cloud_firestore/cloud_firestore.dart';

const int hubInterestMatchBoost = 50;
const int hubCityMatchBoost = 30;

const List<String> hubDefaultInterests = [
  'cricket',
  'football',
  'f1',
  'chess',
  'others',
];

double computeHubTrendingScore(
  num likes,
  num shares,
  num views,
  dynamic createdAt,
) {
  final engagement =
      (likes.toInt()) * 3 + (shares.toInt()) * 5 + (views.toInt());
  int createdMs;
  if (createdAt is Timestamp) {
    createdMs = createdAt.millisecondsSinceEpoch;
  } else if (createdAt is DateTime) {
    createdMs = createdAt.millisecondsSinceEpoch;
  } else if (createdAt is num) {
    createdMs = createdAt.toInt();
  } else {
    createdMs = DateTime.now().millisecondsSinceEpoch;
  }
  final hoursSincePosted =
      ((DateTime.now().millisecondsSinceEpoch - createdMs) / 3600000)
          .clamp(1, double.infinity);
  return engagement / hoursSincePosted;
}

double effectiveHubRankScore(
  Map<String, dynamic> item,
  String? userCity,
  List<String>? userInterestsLower,
) {
  final base = (item['trendingScore'] as num?)?.toDouble() ?? 0;
  final cat = (item['category'] as String? ?? '').toLowerCase();
  final interestBoost = userInterestsLower != null &&
          userInterestsLower.contains(cat)
      ? hubInterestMatchBoost.toDouble()
      : 0;
  final uc = (userCity ?? '').trim().toLowerCase();
  final nc = (item['city'] as String? ?? '').trim().toLowerCase();
  final cityBoost = uc.isNotEmpty && nc.isNotEmpty && uc == nc
      ? hubCityMatchBoost.toDouble()
      : 0;
  return base + interestBoost + cityBoost;
}

List<T> shuffleInPlace<T>(List<T> arr) {
  final a = arr;
  final rng = DateTime.now().microsecondsSinceEpoch;
  for (var i = a.length - 1; i > 0; i--) {
    final j = (rng + i * 7919) % (i + 1);
    final tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

Map<String, String>? hubNewsTag(
  String bucket,
  num trendingScore,
  dynamic createdAt,
  bool inTopTrendingTier,
) {
  if (bucket == 'trending' && inTopTrendingTier) {
    return {'label': 'Trending', 'emoji': 'ðŸ”¥'};
  }
  int createdMs;
  if (createdAt is Timestamp) {
    createdMs = createdAt.millisecondsSinceEpoch;
  } else if (createdAt is DateTime) {
    createdMs = createdAt.millisecondsSinceEpoch;
  } else if (createdAt is num) {
    createdMs = createdAt.toInt();
  } else {
    createdMs = DateTime.now().millisecondsSinceEpoch;
  }
  final hours =
      (DateTime.now().millisecondsSinceEpoch - createdMs) / 3600000;
  if (hours < 8 && trendingScore > 0) {
    return {'label': 'Rising', 'emoji': 'ðŸ“ˆ'};
  }
  return null;
}

List<Map<String, dynamic>> mixHubFeedSegments(
  List<Map<String, dynamic>> trendingList,
  List<Map<String, dynamic>> latestList, [
  int targetSize = 20,
]) {
  final nT = (targetSize * 0.6).round().clamp(1, targetSize);
  final nL = (targetSize * 0.2).round().clamp(1, targetSize);
  final nR = (targetSize - nT - nL).clamp(0, targetSize);

  final seen = <String>{};

  List<Map<String, dynamic>> take(List<Map<String, dynamic>> list, int n) {
    final out = <Map<String, dynamic>>[];
    for (final item in list) {
      final id = item['id'] as String?;
      if (id == null || seen.contains(id)) continue;
      seen.add(id);
      out.add(item);
      if (out.length >= n) break;
    }
    return out;
  }

  final trendingPart = take(trendingList, nT);
  final latestPart = take(latestList, nL);

  final pool = <Map<String, dynamic>>[];
  for (final x in trendingList) {
    final id = x['id'] as String?;
    if (id != null && !seen.contains(id)) pool.add(x);
  }
  for (final x in latestList) {
    final id = x['id'] as String?;
    if (id != null && !seen.contains(id)) pool.add(x);
  }
  shuffleInPlace(pool);
  final randomPart = take(pool, nR);

  final topScore = trendingList.isNotEmpty
      ? (trendingList.first['trendingScore'] as num?)?.toDouble() ?? 0
      : 0;
  final tierCut = topScore * 0.35;

  var ti = 0;
  var li = 0;
  var ri = 0;
  final interleaved = <Map<String, dynamic>>[];

  while (interleaved.length < targetSize) {
    var progressed = false;
    for (var k = 0; k < 3 && ti < trendingPart.length && interleaved.length < targetSize; k++) {
      interleaved.add({...trendingPart[ti++], '_mixBucket': 'trending'});
      progressed = true;
    }
    if (li < latestPart.length && interleaved.length < targetSize) {
      interleaved.add({...latestPart[li++], '_mixBucket': 'latest'});
      progressed = true;
    }
    if (ri < randomPart.length && interleaved.length < targetSize) {
      interleaved.add({...randomPart[ri++], '_mixBucket': 'random'});
      progressed = true;
    }
    if (!progressed) {
      while (ti < trendingPart.length && interleaved.length < targetSize) {
        interleaved.add({...trendingPart[ti++], '_mixBucket': 'trending'});
      }
      while (li < latestPart.length && interleaved.length < targetSize) {
        interleaved.add({...latestPart[li++], '_mixBucket': 'latest'});
      }
      while (ri < randomPart.length && interleaved.length < targetSize) {
        interleaved.add({...randomPart[ri++], '_mixBucket': 'random'});
      }
      break;
    }
  }

  return interleaved.asMap().entries.map((entry) {
    final i = entry.key;
    final x = Map<String, dynamic>.from(entry.value);
    final mixBucket = x.remove('_mixBucket') as String? ?? 'trending';
    final inTop = mixBucket == 'trending' &&
        ((x['trendingScore'] as num?)?.toDouble() ?? 0) >= tierCut &&
        i < (targetSize * 0.35).ceil();
    final tag = hubNewsTag(
      mixBucket,
      (x['trendingScore'] as num?) ?? 0,
      x['createdAt'],
      inTop,
    );
    return {...x, 'mixBucket': mixBucket, 'feedTag': tag};
  }).toList();
}

bool hasUsableHubImage(String? url) {
  final s = '${url ?? ''}'.trim();
  return s.startsWith('http://') || s.startsWith('https://');
}

bool hubMapRowHasImage(Map<String, dynamic> row) {
  return hasUsableHubImage('${row['image'] ?? ''}') ||
      hasUsableHubImage('${row['thumbnail'] ?? ''}');
}

/// Stable partition — items with images first, original order kept within each group.
List<T> prioritizeWithImagesFirst<T>(
  List<T> items,
  bool Function(T item) hasImage,
) {
  final withImg = <T>[];
  final without = <T>[];
  for (final item in items) {
    (hasImage(item) ? withImg : without).add(item);
  }
  return [...withImg, ...without];
}

void sortHubMapRowsImageFirst(
  List<Map<String, dynamic>> rows, {
  int Function(Map<String, dynamic> a, Map<String, dynamic> b)? compare,
}) {
  rows.sort((a, b) {
    final ai = hubMapRowHasImage(a);
    final bi = hubMapRowHasImage(b);
    if (ai != bi) return ai ? -1 : 1;
    return compare?.call(a, b) ?? 0;
  });
}

int hubMapRowScore(Map<String, dynamic> row) =>
    row['score'] is num ? (row['score'] as num).toInt() : int.tryParse('${row['score']}') ?? 0;
