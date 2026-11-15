package si.safeer.lina.seznanitev

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import java.math.BigInteger
import java.security.MessageDigest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Skupni vektorji TS <-> Kotlin (T2, 15. 11. 2026): datoteka skupni-vektorji/vektorji-lina-v1.json je kopija datoteke iz Line
 * (lina-vektorji-1511, src/lib/lina/vektorji-lina-v1.json); ista vsota SHA-256 je pripeta v preizkusu Line. Tu: zdruzeni QR v1,
 * pravilo naslova in SPAKE2 s kodo (nacin A in B, napacna koda). Podpisi, telesa in odgovori so v modulu podpis.
 */
internal object Vektorji {
    /** Vsota datoteke; spremeni se skupaj s kopijo v Lini (preizkus Line skupni-vektorji.test.ts ima isto vsoto). */
    const val SHA256 = "4ec90827642dc3494f0ecdb1b29ba17210787b60ceac7e7ef89d4f959732c8fd"
    val koren: JsonObject by lazy {
        val b = File("../skupni-vektorji/vektorji-lina-v1.json").readBytes()
        val vsota = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }
        assertEquals(SHA256, vsota, "datoteka vektorjev se je spremenila: posodobi vsoto tu in v preizkusu Line (isti kopiji)")
        Json.parseToJsonElement(String(b, Charsets.UTF_8)).jsonObject
    }
}

internal fun JsonElement.s(k: String): String = jsonObject.getValue(k).jsonPrimitive.content
internal fun JsonElement.o(k: String): JsonObject = jsonObject.getValue(k).jsonObject
internal fun JsonElement.a(k: String): JsonArray = jsonObject.getValue(k).jsonArray
internal fun JsonElement.l(k: String): Long = jsonObject.getValue(k).jsonPrimitive.long
internal fun JsonElement.b(k: String): Boolean = jsonObject.getValue(k).jsonPrimitive.boolean
internal fun JsonElement.jeNull(k: String): Boolean = jsonObject.getValue(k) is JsonNull

class SkupniVektorjiTest {
    private val v = Vektorji.koren

    @Test
    fun `QR v1 - besedila iz Line (vsebinaQr) se razberejo v pricakovana polja`() {
        val poz = v.o("qr_v1").a("pozitivni")
        assertTrue(poz.size >= 7)
        for (p in poz) {
            val ime = p.s("ime")
            val z = assertNotNull(QrSeznanitev.razberi(p.s("besedilo"), p.l("zdajMs")), ime)
            val pr = p.o("pricakovano")
            if (pr.jeNull("klici")) assertNull(z.klici, ime) else {
                val k = assertNotNull(z.klici, ime)
                assertEquals(pr.o("klici").s("url"), k.serverUrl, ime)
                assertEquals(pr.o("klici").s("code"), k.code, ime)
                assertEquals(pr.o("klici").s("fp"), k.certSha256, ime)
            }
            if (pr.jeNull("asistent")) assertNull(z.asistent, ime) else {
                val a = assertNotNull(z.asistent, ime)
                val e = pr.o("asistent")
                assertEquals(e.s("naslov"), a.naslov.naslov, ime)
                assertEquals(e.l("vrata").toInt(), a.naslov.vrata, ime)
                assertEquals(e.s("odtis"), a.naslov.odtis, ime)
                assertEquals(e.s("koda"), a.koda, ime)
                assertEquals(e.l("doMs"), a.doMs, ime)
            }
        }
    }

    @Test
    fun `QR v1 - kar Lina nikoli ne napise, Android zavrne (nic se ne nastavi napol)`() {
        val zav = v.o("qr_v1").a("zavrnjeni")
        assertTrue(zav.size >= 20)
        for (z in zav) assertNull(QrSeznanitev.razberi(z.s("besedilo"), z.l("zdajMs")), z.s("ime"))
    }

    @Test
    fun `pravilo zasebnega naslova je isto kot v Lini (zasebenNaslov)`() {
        val n = v.a("naslovi")
        assertTrue(n.size >= 20)
        for (e in n) assertEquals(e.b("zasebni"), AsistentQr.jeZasebniNaslov(e.s("naslov")), e.s("naslov"))
    }

    private fun hex(b: ByteArray) = Spake2.hex(b)
    private fun w64(w: BigInteger) = w.toString(16).padStart(64, '0')

    @Test
    fun `SPAKE2 w iz kode je isti kot v Lini`() {
        for (e in v.o("koda").a("w")) assertEquals(e.s("w"), w64(Spake2.wIzKode(e.s("koda"), e.s("sol_utf8").toByteArray())), e.s("koda"))
    }

    @Test
    fun `SPAKE2 s kodo - pB, pA, cA, cB, Ke in MAC iz Line so bajt za bajtom isti (nacin A, nacin B, napacna koda)`() {
        val toki = v.o("koda").a("toki")
        assertEquals(3, toki.size)
        for (t in toki) {
            val ime = t.s("ime")
            val id = t.s("id"); val pairId = t.s("pair_id"); val odtis = t.s("odtis")
            // stran A (Lina) v Kotlinu: isti pA in cA kot jih je izracunal TS
            val kodaLina = if (t.s("nacin") == "B") KodaLine.koda(t.s("koda_vnos_lastnika"))!! else t.s("koda_lina")
            val lina = Spake2.zaTest(Spake2.wIzKode(kodaLina, pairId.toByteArray()), KodaLine.ID_LINE, id, true, BigInteger(t.s("x_lina"), 16), odtis.toByteArray())
            val ca = lina.zakljuci(Spake2.hex(t.o("spake_telo").s("pb")))
            assertEquals(t.o("spake_odgovor").s("pa"), hex(lina.sporocilo()), ime)
            assertEquals(t.o("spake_odgovor").s("ca"), hex(ca), ime)
            assertEquals(t.s("w_telefon"), w64(Spake2.wIzKode(t.s("koda_telefon"), pairId.toByteArray())), ime)
            // stran B (telefon): KodaOdjemalec isto kot Android v pravem toku
            val tel = KodaOdjemalec.zaTest(t.s("koda_telefon"), id, pairId, odtis, BigInteger(t.s("y_telefon"), 16))
            assertEquals(t.o("spake_telo").s("pb"), tel.pb, ime)
            val cb = tel.potrdi(t.o("spake_odgovor").s("pa"), t.o("spake_odgovor").s("ca"))
            if (t.b("ca_velja")) {
                assertEquals(t.s("cb"), cb, ime)
                assertEquals(t.s("mac"), tel.mac(v.o("podpis").s("kljuc")), ime)
                assertTrue(lina.preveri(Spake2.hex(cb!!)), "Lina sprejme cB telefona")
            } else {
                assertNull(cb, "napacna koda: cA ne velja, telefon ne poslje nicesar naprej ($ime)")
                assertNull(tel.mac(v.o("podpis").s("kljuc")), ime)
            }
        }
    }

    @Test
    fun `nacin B - vnos kode in zacetek iz vektorja`() {
        val toki = v.o("koda").a("toki")
        for (t in toki) {
            assertTrue(KodaLine.veljavenZacetek(t.o("zacni_odgovor").s("pair_id"), t.o("zacni_odgovor").s("nacin"), t.o("zacni_odgovor").s("hub_id"), t.o("zacni_odgovor").s("fp"), t.s("odtis")))
            assertFalse(KodaLine.veljavenZacetek(t.o("zacni_odgovor").s("pair_id"), "spake2", KodaLine.ID_LINE, t.o("zacni_odgovor").s("fp"), "cd".repeat(32)), "drug odtis: posrednik")
        }
        val b = toki[1]
        assertEquals("B", b.s("nacin"))
        assertEquals(b.s("koda_telefon"), KodaLine.koda(b.s("koda_vnos_lastnika")))
        assertEquals("731 905", KodaLine.prikaz(b.s("koda_telefon")))
        assertTrue(Regex("^[1-9]\\d{5}$").matches(KodaLine.novaKoda()))
    }
}
