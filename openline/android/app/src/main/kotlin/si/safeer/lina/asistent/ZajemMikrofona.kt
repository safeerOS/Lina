package si.safeer.lina.asistent

import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AudioEffect
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import si.safeer.lina.samostojna.KonecGovora
import si.safeer.lina.samostojna.StanjeGovora

/**
 * Stikalo »Zmanjsanje hrupa« (lastnik 24. 11. 2026: privzeto VKLOPLJENO). Eno za telefon: klic (filter klicatelja, omejevalnik,
 * nizka obcutljivost zacetka govora v GeminiLiveOdjemalec) in mikrofon asistentke (ZajemMikrofona). Kljuc je obstojeci
 * lina_zvok/obdelava_zvoka (do zdaj brez gumba).
 */
object ZmanjsanjeHrupa {
    private const val PREFS = "lina_zvok"
    private const val KLJUC = "obdelava_zvoka"
    fun vklopljeno(c: Context): Boolean = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KLJUC, true)
    fun nastavi(c: Context, vklop: Boolean) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KLJUC, vklop).apply()
}

/**
 * Zajem govora za asistentko (16 kHz mono, 16 bit): vir VOICE_COMMUNICATION (sistem nanj veze obdelavo za govor) in ucinki
 * NoiseSuppressor, AcousticEchoCanceler, AutomaticGainControl, kadar jih naprava ima (isAvailable). Konec govora doloci
 * [KonecGovora] (1,6 s tisine po govoru, 8 s brez govora, najvec 60 s); drugi dotik mikrofona konca prej.
 * [koncano] se poklice z ozadne niti z zajetim PCM in podatkom, ali je bil govor zaznan; ob [ustavi] z zavrzi = true se ne poklice.
 * Klicatelj pred [zacni] preveri dovoljenje RECORD_AUDIO.
 */
class ZajemMikrofona(private val koncano: (pcm: ByteArray, slisalGovor: Boolean) -> Unit) {
    @Volatile private var ustavljen = false
    @Volatile private var zavrzi = false

    fun zacni() {
        Thread({ zajem() }, "lina-mikrofon").start()
    }

    fun ustavi(zavrzi: Boolean = false) {
        if (zavrzi) this.zavrzi = true
        ustavljen = true
    }

    @android.annotation.SuppressLint("MissingPermission")
    private fun zajem() {
        val fs = 16000
        val min = AudioRecord.getMinBufferSize(fs, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val rec = try {
            AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, fs, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min, fs))
        } catch (e: Exception) { null }
        if (rec == null || rec.state != AudioRecord.STATE_INITIALIZED) {
            rec?.release()
            if (!zavrzi) koncano(ByteArray(0), false)
            return
        }
        val seja = rec.audioSessionId
        val ucinki = listOfNotNull<AudioEffect>(
            if (NoiseSuppressor.isAvailable()) runCatching { NoiseSuppressor.create(seja) }.getOrNull() else null,
            if (AcousticEchoCanceler.isAvailable()) runCatching { AcousticEchoCanceler.create(seja) }.getOrNull() else null,
            if (AutomaticGainControl.isAvailable()) runCatching { AutomaticGainControl.create(seja) }.getOrNull() else null,
        )
        for (u in ucinki) runCatching { u.setEnabled(true) } // setEnabled vrne int: brez lastnosti enabled
        val konec = KonecGovora(fs)
        val izhod = java.io.ByteArrayOutputStream()
        val med = ShortArray(fs / 50)
        try {
            rec.startRecording()
            while (!ustavljen) {
                val n = rec.read(med, 0, med.size)
                if (n < 0) break
                for (i in 0 until n) { val s = med[i].toInt(); izhod.write(s and 0xFF); izhod.write((s shr 8) and 0xFF) }
                if (n > 0 && konec.dodaj(med, n) != StanjeGovora.POSLUSA) break
            }
        } catch (e: Exception) {
            // Mikrofon je vzela druga aplikacija ali klic: kar je zajeto, gre v prepis, ce je bil govor.
        } finally {
            runCatching { rec.stop() }
            rec.release()
            for (u in ucinki) runCatching { u.release() }
        }
        if (!zavrzi) koncano(izhod.toByteArray(), konec.slisalGovor)
    }
}
