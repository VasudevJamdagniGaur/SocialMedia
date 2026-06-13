package therapist.deite.app

import io.flutter.embedding.android.FlutterActivity
import java.io.File

class MainActivity : FlutterActivity() {

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        pruneOversizedFlutterPrefsIfNeeded()
        super.onCreate(savedInstanceState)
    }

    /** Generated AI images were cached as base64 in SharedPreferences and can exceed 100MB. */
    private fun pruneOversizedFlutterPrefsIfNeeded() {
        try {
            val prefsFile = File(
                applicationContext.applicationInfo.dataDir,
                "shared_prefs/FlutterSharedPreferences.xml",
            )
            if (prefsFile.exists() && prefsFile.length() > 2L * 1024L * 1024L) {
                prefsFile.delete()
            }
        } catch (_: Exception) {
            // Best-effort recovery before Dart loads SharedPreferences.
        }
    }
}
