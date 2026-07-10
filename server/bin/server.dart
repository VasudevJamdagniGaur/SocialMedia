import 'dart:convert';
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
    try {
      final decoded = jsonDecode(creds);
      if (decoded is Map) {
        final projectId = '${decoded['project_id'] ?? ''}'.trim();
        if (projectId.isNotEmpty && projectId != 'offgrid-492919') {
          // Override stale Render GOOGLE_CLOUD_PROJECT with the SA's real project.
          ServerConfig.setLocalEnv('GOOGLE_CLOUD_PROJECT', projectId);
        }
      }
    } catch (e) {
      stderr.writeln('[boot] Could not parse GOOGLE_CREDENTIALS project_id: $e');
    }
  }

  final resolved = ServerConfig.projectId;
  final envProject = Platform.environment['GOOGLE_CLOUD_PROJECT']?.trim();
  if (envProject != null &&
      envProject.isNotEmpty &&
      envProject != resolved) {
    stdout.writeln(
      '[boot] Ignoring GOOGLE_CLOUD_PROJECT=$envProject; using $resolved from service account',
    );
  }

  await runServer();
}
