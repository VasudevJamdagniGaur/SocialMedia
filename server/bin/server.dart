import 'dart:io';

import 'package:deite_server/server.dart';

Future<void> main() async {
  // Optional: load server/.env for local dev
  final envFile = File('.env');
  if (await envFile.exists()) {
    for (final line in await envFile.readAsLines()) {
      final t = line.trim();
      if (t.isEmpty || t.startsWith('#')) continue;
      final i = t.indexOf('=');
      if (i <= 0) continue;
      final key = t.substring(0, i).trim();
      var val = t.substring(i + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.substring(1, val.length - 1);
      }
      Platform.environment[key] = val;
    }
  }

  if (Platform.environment['GOOGLE_CREDENTIALS']?.trim().isNotEmpty == true) {
    await File('service-account.json')
        .writeAsString(Platform.environment['GOOGLE_CREDENTIALS']!);
  }

  await runServer();
}
