package si.safeer.lina.telecom

import java.io.File
import java.io.FileOutputStream

/**
 * Diagnosticni zajem Linine izhodne zvocne poti (kar klicatelj slisi): surov PCM 16 kHz s16le mono v
 * <files>/lina_zvok/zajem/lina-<cas>.pcm. Novo datoteko zacne po 10 s tisine (nov klic), hrani zadnjih 5.
 * Glas klicatelja se NE zapisuje (to bi zahtevalo napoved snemanja po ZEKom-2, clen 214).
 * Pretvorba: ffmpeg -f s16le -ar 16000 -ac 1 -i lina-xxx.pcm lina-xxx.wav
 */
internal class ZajemIzhodaLine(files: File) {
    private val mapa = File(files, "lina_zvok/zajem")
    private var izhod: FileOutputStream? = null
    private var zadnji = 0L

    @Synchronized
    fun zapisi(okvir: ByteArray) {
        runCatching {
            val zdaj = System.currentTimeMillis()
            if (izhod == null || zdaj - zadnji > 10_000L) {
                izhod?.close()
                mapa.mkdirs()
                izhod = FileOutputStream(File(mapa, "lina-$zdaj.pcm"))
                mapa.listFiles()?.sortedBy { it.name }?.dropLast(5)?.forEach { it.delete() }
            }
            zadnji = zdaj
            izhod?.write(okvir)
            izhod?.flush()
        }
    }
}
