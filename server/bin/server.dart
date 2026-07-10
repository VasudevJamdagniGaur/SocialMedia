import 'dart:convert';
import 'dart:io';

import 'package:deite_server/server.dart';

import '../lib/config.dart';

/// Resolve service-account JSON from common Render/env names.
String? _readCredentialsJson() {
  for (final key in [
    'GOOGLE_CREDENTIALS',
    'GOOGLE_SERVICE_ACCOUNT_JSON',
    'GCP_SERVICE_ACCOUNT',
    'FIREBASE_SERVICE_ACCOUNT',
  ]) {
    final v = ServerConfig.env(key);
    if (v != null && v.trim().isNotEmpty) return v.trim();
  }
  return null;
}

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

  // Always write credentials next to the binary working directory.
  final credsPath = ServerConfig.credentialsPath;
  final credsFile = File(credsPath);
  final creds = _readCredentialsJson();
  if (creds != null && creds.isNotEmpty) {
    await credsFile.writeAsString(creds);
    stdout.writeln('[boot] Wrote service account credentials to $credsPath');
  }

  if (await credsFile.exists()) {
    try {
      final decoded = jsonDecode(await credsFile.readAsString());
      if (decoded is Map) {
        final projectId = '${decoded['project_id'] ?? ''}'.trim();
        final clientEmail = '${decoded['client_email'] ?? ''}'.trim();
        if (projectId.isNotEmpty && projectId != 'offgrid-492919') {
          // Force Vertex project from the service account (ignore stale Render env).
          ServerConfig.setLocalEnv('GOOGLE_CLOUD_PROJECT', projectId);
        }
        if (clientEmail.isNotEmpty) {
          stdout.writeln('[boot] Service account: $clientEmail');
        }
        stdout.writeln('[boot] Credentials project_id: $projectId');
      }
    } catch (e) {
      stderr.writeln('[boot] Could not parse service account JSON: $e');
    }
  } else {
    stderr.writeln(
      '[boot] WARNING: No service-account file at $credsPath. '
      'Set GOOGLE_CREDENTIALS on Render to the my-socitea JSON.',
    );
  }

  // Pin credentials path for Vertex auth.
  ServerConfig.setLocalEnv('GOOGLE_APPLICATION_CREDENTIALS', credsPath);

  final resolved = ServerConfig.projectId;
  final envProject = Platform.environment['GOOGLE_CLOUD_PROJECT']?.trim();
  if (envProject != null &&
      envProject.isNotEmpty &&
      envProject != resolved) {
    stdout.writeln(
      '[boot] Ignoring GOOGLE_CLOUD_PROJECT=$envProject; using $resolved from service account',
    );
  }
  if (resolved == 'offgrid-492919') {
    stderr.writeln(
      '[boot] FATAL: project resolved to broken offgrid-492919. '
      'Update GOOGLE_CREDENTIALS to my-socitea service account.',
    );
  }

  await runServer();
}
