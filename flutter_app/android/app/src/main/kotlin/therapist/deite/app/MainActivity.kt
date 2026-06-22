package therapist.deite.app

import android.content.Intent
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterActivity() {

    private val linkedInShareChannel = "therapist.deite.app/linkedin_share"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, linkedInShareChannel)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "shareImage" -> {
                        val path = call.argument<String>("path")
                        val mimeType = call.argument<String>("mimeType") ?: "image/jpeg"
                        if (path.isNullOrBlank()) {
                            result.error("INVALID", "path required", null)
                            return@setMethodCallHandler
                        }
                        result.success(shareImageToLinkedIn(path, mimeType))
                    }
                    "shareText" -> {
                        val text = call.argument<String>("text")
                        if (text.isNullOrBlank()) {
                            result.error("INVALID", "text required", null)
                            return@setMethodCallHandler
                        }
                        result.success(shareTextToLinkedIn(text))
                    }
                    else -> result.notImplemented()
                }
            }
    }

    private fun shareImageToLinkedIn(filePath: String, mimeType: String): Boolean {
        return try {
            val file = File(filePath)
            if (!file.exists()) return false
            val uri = FileProvider.getUriForFile(
                this,
                "${applicationContext.packageName}.linkedin_share",
                file,
            )
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = mimeType
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                setPackage("com.linkedin.android")
            }
            startActivity(intent)
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun shareTextToLinkedIn(text: String): Boolean {
        return try {
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, text)
                setPackage("com.linkedin.android")
            }
            startActivity(intent)
            true
        } catch (_: Exception) {
            false
        }
    }

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
