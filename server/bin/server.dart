import 'dart:io';

import 'package:deite_server/server.dart';

import '../lib/config.dart';

Future<void> main() async {
  // Optional: load server/.env for local dev (Platform.environment is read-only).
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
      ServerConfig.setLocalEnv(key, val);
    }
  }

  final creds = ServerConfig.env('GOOGLE_CREDENTIALS');
  if (creds != null && creds.isNotEmpty) {
    await File('service-account.json').writeAsString(creds);
  }

  await runServer();
}
