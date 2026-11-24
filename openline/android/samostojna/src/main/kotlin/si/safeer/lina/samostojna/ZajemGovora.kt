package si.safeer.lina.samostojna

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.sin

/**
 * Lina v hrupni tiskarni (lastnik 24. 11. 2026; meritev in nacrt: zvok-hrup-1510/POROCILO.md, NACRT.md).
 * Asistentka na telefonu sama zajame mikrofon (VOICE_COMMUNICATION + NoiseSuppressor/AEC/AGC, kjer so na voljo) in sama ugotovi
 * konec govora. Pravilo je enako kot na racunalniku (pogovor.tsx): konec po 1,6 s tisine po govoru, brez govora 8 s, najvec 60 s.
 * Danasnji racunalnik ima stalen prag glasnosti (RMS 0,035), ki v hrupu ne najde konca (0 dB: 27 od 32 posnetkov brez konca);
 * tu je prag relativen in odporen na udarce strojev:
 *  1. pas govora 250-3000 Hz (brumenje, motor in rjavi sum ventilatorja so nizje; sumenje papirja vise),
 *  2. ozadje = spodnja ovojnica energije okvirjev (takoj navzdol, navzgor 1 dB/s, a nikoli pod najtisji okvir zadnjih 3 s, da
 *     se po digitalni tisini na zacetku zajema ali ob vklopu stroja ujame v 3 s) - neodvisno od ojacanja mikrofona,
 *  3. okvir (20 ms) je glasen, ce je 9 dB nad ozadjem; govor je, ce so glasni vsaj 4 od zadnjih 10 okvirjev (200 ms):
 *     udarec stroja (~30 ms) prizge najvec 2 okvirja, zlog govora traja 100-300 ms.
 * Preizkus na 13 posnetkih meritve (ZajemGovoraTest): pri 5 in 0 dB 12/13 pravocasnih koncev, nikoli obvisi; danasnji prag RMS pri
 * 0 dB konca le 6/13. Na cistem posnetku s tihim zacetkom konca do ~2 s pozneje (nikoli prej). Hrup je sinteticen; ni preizkuseno
 * na pravem hrupu tiskarne in na napravi.
 */
enum class StanjeGovora { POSLUSA, KONEC, BREZ_GOVORA, NAJDLJE }

class KonecGovora(private val fs: Int = 16000) {
    private val okvir = fs / 50
    private val vp = Biquad.visokoprepustni(250.0, fs); private val vp2 = Biquad.visokoprepustni(250.0, fs)
    private val np = Biquad.nizkoprepustni(3000.0, fs)
    private var vsota = 0.0
    private var vOkvirju = 0
    private var okvirjev = 0
    private var ozadje = Double.NaN
    private val zadnji = BooleanArray(OKNO)
    private val energije = DoubleArray(OKNO_OZADJA)
    private var tiho = 0

    /** Ali je bil v posnetku ze zaznan govor (brez govora se nic ne poslje v prepis). */
    var slisalGovor = false
        private set

    /** Doda vzorce (16-bitni PCM mono) in vrne stanje; ko ni vec [StanjeGovora.POSLUSA], naj klicatelj zajem ustavi. */
    fun dodaj(pcm: ShortArray, n: Int = pcm.size): StanjeGovora {
        var stanje = StanjeGovora.POSLUSA
        for (i in 0 until n) {
            val y = np.f(vp2.f(vp.f(pcm[i].toDouble())))
            vsota += y * y
            if (++vOkvirju == okvir) {
                stanje = koncajOkvir(vsota / okvir)
                vsota = 0.0; vOkvirju = 0
                if (stanje != StanjeGovora.POSLUSA) return stanje
            }
        }
        return stanje
    }

    private fun koncajOkvir(moc: Double): StanjeGovora {
        val e = 10 * log10(moc + 1.0)
        // Digitalna tisina (zacetek zajema, prvi delni okvir) ni ozadje: sicer bi sobni sum 3 s stel za govor in posnetek bi se koncal,
        // preden uporabnik spregovori (preizkus na posnetku g8238, 24. 11. 2026).
        if (e >= DIGITALNA_TISINA_DB) {
            ozadje = if (ozadje.isNaN() || e < ozadje) e else ozadje + DVIG_DB_NA_OKVIR
            energije[okvirjev % OKNO_OZADJA] = e
            if (okvirjev >= OKNO_OZADJA - 1) ozadje = maxOf(ozadje, energije.min())
        } else energije[okvirjev % OKNO_OZADJA] = Double.NEGATIVE_INFINITY
        zadnji[okvirjev % OKNO] = !ozadje.isNaN() && e > ozadje + PRAG_DB
        okvirjev++
        val govor = zadnji.count { it } >= POTREBNIH
        if (govor) { slisalGovor = true; tiho = 0 } else if (slisalGovor) tiho++
        val ms = okvirjev * 20L
        return when {
            slisalGovor && tiho * 20L > TISINA_PO_GOVORU_MS -> StanjeGovora.KONEC
            !slisalGovor && ms >= BREZ_GOVORA_MS -> StanjeGovora.BREZ_GOVORA
            ms >= NAJVEC_MS -> StanjeGovora.NAJDLJE
            else -> StanjeGovora.POSLUSA
        }
    }

    companion object {
        const val TISINA_PO_GOVORU_MS = 1_600L
        const val BREZ_GOVORA_MS = 8_000L
        const val NAJVEC_MS = 60_000L
        private const val OKNO = 10
        private const val OKNO_OZADJA = 150 // 3 s
        private const val DIGITALNA_TISINA_DB = 10.0 // RMS ~3 LSB; sum pravega mikrofona je visji
        private const val POTREBNIH = 4
        private const val PRAG_DB = 9.0
        private const val DVIG_DB_NA_OKVIR = 1.0 * 0.02
    }
}

/** Filter 2. reda (Butterworth, Q = 1/sqrt 2) po RBJ. */
private class Biquad(private val b0: Double, private val b1: Double, private val b2: Double, private val a1: Double, private val a2: Double) {
    private var x1 = 0.0; private var x2 = 0.0; private var y1 = 0.0; private var y2 = 0.0
    fun f(x: Double): Double {
        val y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2 = x1; x1 = x; y2 = y1; y1 = y
        return y
    }

    companion object {
        private fun koef(fc: Double, fs: Int, visoko: Boolean): Biquad {
            val w0 = 2 * PI * fc / fs; val alfa = sin(w0) / (2 * 0.70710678); val c = cos(w0); val a0 = 1 + alfa
            val b = if (visoko) doubleArrayOf((1 + c) / 2, -(1 + c), (1 + c) / 2) else doubleArrayOf((1 - c) / 2, 1 - c, (1 - c) / 2)
            return Biquad(b[0] / a0, b[1] / a0, b[2] / a0, -2 * c / a0, (1 - alfa) / a0)
        }
        fun visokoprepustni(fc: Double, fs: Int) = koef(fc, fs, true)
        fun nizkoprepustni(fc: Double, fs: Int) = koef(fc, fs, false)
    }
}

/** 16-bitni PCM mono (little-endian) v datoteko WAV za prepis. */
fun wavIzPcm(pcm: ByteArray, fs: Int = 16000): ByteArray {
    val b = java.nio.ByteBuffer.allocate(44 + pcm.size).order(java.nio.ByteOrder.LITTLE_ENDIAN)
    b.put("RIFF".toByteArray(Charsets.US_ASCII)).putInt(36 + pcm.size).put("WAVE".toByteArray(Charsets.US_ASCII))
    b.put("fmt ".toByteArray(Charsets.US_ASCII)).putInt(16).putShort(1).putShort(1).putInt(fs).putInt(fs * 2).putShort(2).putShort(16)
    b.put("data".toByteArray(Charsets.US_ASCII)).putInt(pcm.size).put(pcm)
    return b.array()
}

/**
 * Ali asistentka posnetek zajame sama (zmanjsanje hrupa in konec govora v Lini) ali ga preda sistemski prepoznavi (kot do zdaj).
 * Sama samo, ce je stikalo »Zmanjsanje hrupa« vklopljeno in ponudnik asistentke zna prebrati zvok (Gemini, Vertex);
 * izklopljeno stikalo = natanko danasnje vedenje.
 */
fun lastniZajemGovora(zmanjsanjeHrupa: Boolean, ponudnik: Ponudnik): Boolean =
    zmanjsanjeHrupa && podpiraPriponko(ponudnik, VrstaPriponke.ZVOK, "audio/wav")

/** Navodilo modelu za prepis posnetka iz mikrofona; besedilo gre v polje za vnos, da ga uporabnik pregleda. */
const val NAVODILO_PREPISA = "Prepiši govor v priloženem posnetku dobesedno, v jeziku govorca. Vrni samo prepis, brez opomb, narekovajev " +
    "in opisa zvokov. Hrup v ozadju (stroji, udarci, papir) prezri. Če v posnetku ni razumljivega govora, vrni prazen odgovor."

/** Prepis iz odgovora modela: prazen niz, ce ga ni (napaka ali brez govora). */
fun prepisIzRezultata(r: Rezultat): String = (r as? Rezultat.Besedilo)?.besedilo?.trim()?.removeSurrounding("\"")?.trim().orEmpty()
