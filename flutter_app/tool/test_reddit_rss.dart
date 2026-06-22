import 'dart:convert';
import 'dart:io';

void main() async {
  final url =
      'https://www.reddit.com/r/BollyBlindsNGossip/comments/1tz4qrg/.rss';
  final client = HttpClient();
  final req = await client.getUrl(Uri.parse(url));
  req.headers.set('User-Agent', 'SociTeaRedditProxy/1.0');
  final res = await req.close();
  final xml = await res.transform(utf8.decoder).join();
  final blocks = RegExp(r'<entry>[\s\S]*?</entry>', multiLine: true).allMatches(xml);
  print('entries=${blocks.length}');
  var i = 0;
  for (final m in blocks) {
    if (i++ >= 3) break;
    final block = m.group(0)!;
    final titleM = RegExp(r'<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?</title>')
        .firstMatch(block);
    final contentM = RegExp(
      r'<content[^>]*type="html"[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?</content>',
    ).firstMatch(block);
    print('title=${titleM?.group(1)?.trim()}');
    final c = contentM?.group(1) ?? '';
    print('content_len=${c.length}');
    if (c.isNotEmpty) print('content_snip=${c.substring(0, c.length.clamp(0, 200))}');
  }
  client.close();
}
