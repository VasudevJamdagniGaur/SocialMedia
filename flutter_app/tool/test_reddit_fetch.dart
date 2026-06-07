import 'dart:convert';
import 'dart:io';

void main() async {
  final url =
      'https://www.reddit.com/r/BollyBlindsNGossip/comments/1tz4qrg/would_ram_charan_or_allu_arjun_be_okay_if_their.json?raw_json=1&limit=120&depth=2&sort=top';
  final client = HttpClient();
  final req = await client.getUrl(Uri.parse(url));
  req.headers.set('User-Agent', 'DeiteNews/1.0 (+https://deitedatabase.web.app)');
  req.headers.set('Accept', 'application/json');
  final res = await req.close();
  final body = await res.transform(utf8.decoder).join();
  final j = jsonDecode(body) as List;
  final post = j[0]['data']['children'][0]['data'] as Map;
  final selftext = '${post['selftext'] ?? ''}';
  print('status=${res.statusCode} selftext_len=${selftext.length}');
  final children = (j[1]['data']['children'] as List?) ?? [];
  var comments = 0;
  for (final c in children) {
    if (c is Map && c['kind'] == 't1') {
      final b = '${(c['data'] as Map)['body'] ?? ''}'.trim();
      if (b.isNotEmpty && b != '[removed]') {
        comments++;
        if (comments <= 2) print('comment=$b');
      }
    }
  }
  print('top_level_comments=$comments');
  client.close();
}
