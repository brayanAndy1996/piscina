package expo.modules.piscinaclock

import android.os.SystemClock
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PiscinaClockModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PiscinaClock")
    AsyncFunction("snapshot") {
      val context = appContext.reactContext ?: throw IllegalStateException("Android context unavailable")
      val boot = Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)
      if (boot < 0) throw IllegalStateException("Boot identity unavailable")
      mapOf("bootId" to boot.toString(), "elapsedMs" to SystemClock.elapsedRealtime().toDouble(), "wallMs" to System.currentTimeMillis().toDouble())
    }
  }
}
