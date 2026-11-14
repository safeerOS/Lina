package si.safeer.lina.telecom

import android.os.Build
import android.telecom.Call
import si.safeer.lina.protocol.BackgroundAudioSignatures
import org.lsposed.hiddenapibypass.HiddenApiBypass

/**
 * Izhod iz obdelave zvoka v ozadju, da slusalka spet slisi klic.
 * API 29 metode nima. API 30–35: exitBackgroundAudioProcessing(boolean).
 * false pusti klic aktiven. Brez argumenta metoda ne obstaja in zvok ostane tih.
 */
object CallBackgroundAudio {
    fun exit(call: Call): Boolean {
        val params = BackgroundAudioSignatures.exitParameterTypes(Build.VERSION.SDK_INT) ?: return false
        if (params != listOf("boolean")) return false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            HiddenApiBypass.addHiddenApiExemptions("Landroid/telecom/Call;")
        }
        return runCatching {
            val method = Call::class.java.getMethod(
                BackgroundAudioSignatures.EXIT_METHOD,
                Boolean::class.javaPrimitiveType,
            )
            method.invoke(call, BackgroundAudioSignatures.SHOULD_RING_WHEN_RETURNING_AUDIO)
            true
        }.getOrDefault(false)
    }
}
