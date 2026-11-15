package si.safeer.lina.podpis

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
import si.safeer.lina.seznanitev.QrSeznanitev
import java.io.File
import java.security.MessageDigest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Skupni vektorji TS <-> Kotlin (T2, 15. 11. 2026), del za podpise in telesa/odgovore: datoteka skupni-vektorji/vektorji-lina-v1.json
 * je kopija datoteke iz Line (lina-vektorji-1511, src/lib/lina/vektorji-lina-v1.json); ista vsota SHA-256 je pripeta v preizkusu Line.
 * QR, naslov in SPAKE2 so v modulu seznanitev (SkupniVektorjiTest).
 */
class SkupniVektorjiTest {
    private companion object {
        const val SHA256 = "bd39c40105ce1f64128dced831c702795c696b110caaf8374340bdeac97fc728"
    }

    private val v: JsonObject by lazy {
        val b = File("../skupni-vektorji/vektorji-lina-v1.json").readBytes()
        val vsota = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }
        assertEquals(SHA256, vsota, "datoteka vektorjev se je spremenila: posodobi vsoto tu, v modulu seznanitev in v preizkusu Line (isti kopiji)")
        Json.parseToJsonElement(String(b, Charsets.UTF_8)).jsonObject
    }

    private fun JsonElement.s(k: String): String = jsonObject.getValue(k).jsonPrimitive.content
    private fun JsonElement.o(k: String): JsonObject = jsonObject.getValue(k).jsonObject
    private fun JsonElement.a(k: String): JsonArray = jsonObject.getValue(k).jsonArray
    private fun JsonElement.l(k: String): Long = jsonObject.getValue(k).jsonPrimitive.long
    private fun JsonElement.b(k: String): Boolean = jsonObject.getValue(k).jsonPrimitive.boolean
    private fun JsonElement.jeNull(k: String): Boolean = jsonObject.getValue(k) is JsonNull
    private fun enakoJson(pricakovano: JsonElement, telo: String, ime: String) = assertEquals(pricakovano, Json.parseToJsonElement(telo), ime)

    private val kljuc get() = v.o("podpis").s("kljuc")

    /** Niz po vrsti: isto kot funkcije v kanal-claude.ts (Kotlin vrne null, ce polje ni po pogodbi). */
    private fun niz(vrsta: String, p: JsonElement): String? = when (vrsta) {
        "naloga" -> NiziLine.nizNaloge(p.s("id"), p.s("posiljatelj"), p.s("besedilo"), p.l("cas"), p.s("enkratni"))
        "odobritev" -> NiziLine.nizOdobritve(p.s("zahtevaId"), p.b("dovoli"), p.s("posiljatelj"), p.l("cas"), p.s("enkratni"), p.s("chatId"), p.s("zgostitev"))
        "ustavitev" -> NiziLine.nizUstavitve(p.s("id"), p.s("posiljatelj"), p.l("cas"), p.s("enkratni"))
        "stanje" -> NiziLine.nizStanja(p.s("posiljatelj"), p.l("cas"), p.s("enkratni"))
        "seznanitev" -> NiziLine.nizSeznanitve(p.s("koda"), p.s("id"), p.s("kljuc"), p.s("ime"), p.l("cas"), p.s("enkratni"))
        "dogodki" -> NiziLine.nizDogodkov(p.s("id"), p.s("posiljatelj"), p.l("cas"), p.s("enkratni"))
        "klici" -> NiziLine.nizKlici(p.s("koda"), p.s("posiljatelj"), p.l("cas"), p.s("enkratni"))
        else -> error("neznana vrsta $vrsta")
    }

    @Test
    fun `id naprave iz kljuca in zgostitve prikaza so isti kot v Lini`() {
        assertEquals(v.o("podpis").s("id"), KrogKljuc.idIzKljuca(kljuc))
        assertTrue(KrogKljuc.jeIdIzKljuca(v.o("podpis").s("id")))
        val z = v.a("zgostitve")
        assertTrue(z.size >= 3)
        for (e in z) assertEquals(e.s("sha256"), NiziLine.zgostitevPrikaza(e.s("orodje"), e.s("predogled"), e.s("opis")), e.s("orodje"))
    }

    @Test
    fun `nizi podpisov so bajt za bajtom isti kot v Lini in podpis iz Line (Node ECDSA) preveri JCA`() {
        val nizi = v.o("podpis").a("nizi")
        assertEquals(8, nizi.size)
        for (n in nizi) {
            val ime = n.s("ime")
            assertEquals(n.s("niz"), niz(n.s("vrsta"), n.o("vhod")), ime)
            assertTrue(KrogKljuc.preveriPodpisSKljucem(kljuc, n.s("niz").toByteArray(Charsets.UTF_8), n.s("podpis")), "podpis $ime")
            assertFalse(KrogKljuc.preveriPodpisSKljucem(kljuc, (n.s("niz") + "x").toByteArray(Charsets.UTF_8), n.s("podpis")), "spremenjen niz $ime")
        }
    }

    @Test
    fun `kar Lina zavrne, Android ne podpise (niz je null)`() {
        val zav = v.o("podpis").a("zavrnjeni")
        assertTrue(zav.size >= 9)
        for (z in zav) assertNull(niz(z.s("vrsta"), z.o("vhod")), z.s("razlog"))
    }

    @Test
    fun `ime naprave - isto pravilo kot imeNaprave v Lini`() {
        val imena = v.a("imena")
        assertTrue(imena.size >= 15)
        for (i in imena) assertEquals(i.b("veljavno"), NiziLine.veljavnoIme(i.s("ime")), i.s("ime").map { "%04x".format(it.code) }.joinToString(" "))
    }

    @Test
    fun `seznanitev s kodo - telesa, odgovori in napake poti koda so v zapisu Line`() {
        val koda = v.o("koda")
        for (t in koda.a("toki")) {
            val ime = t.s("ime"); val id = t.s("id"); val pairId = t.s("pair_id")
            enakoJson(t.o("zacni_telo"), KodaProtokol.teloZacni(id, t.s("ime_telefona"), t.s("nacin") == "B"), "zacni telo $ime")
            val z = assertNotNull(KodaProtokol.razberiZacetek(t.o("zacni_odgovor").toString()), "zacni odgovor $ime")
            assertEquals(listOf(pairId, "spake2", "lina-asistent", t.s("odtis"), 300L), listOf(z.pairId, z.nacin, z.hubId, z.fp, z.poteceS))
            val sp = t.o("spake_telo")
            enakoJson(sp, KodaProtokol.teloSpake(pairId, id, sp.s("pb")), "spake telo $ime")
            assertEquals(t.o("spake_odgovor").s("pa") to t.o("spake_odgovor").s("ca"), KodaProtokol.razberiSpake(t.o("spake_odgovor").toString()), "spake odgovor $ime")
            enakoJson(t.o("odpovej_telo"), KodaProtokol.teloOdpovej(pairId, id), "odpovej telo $ime")
            assertTrue(KodaProtokol.odpovedano(t.o("odpovej_odgovor").toString()), "odpovedano $ime")
            if (!t.b("ca_velja")) continue
            val p = t.o("potrdi_telo")
            assertEquals(t.s("niz_podpisa"), NiziLine.nizSeznanitve(pairId, id, kljuc, t.s("ime_telefona"), p.l("cas"), p.s("enkratni")), "niz podpisa $ime")
            assertTrue(KrogKljuc.preveriPodpisSKljucem(kljuc, t.s("niz_podpisa").toByteArray(Charsets.UTF_8), p.s("podpis")), "podpis potrditve $ime")
            enakoJson(p, KodaProtokol.teloPotrdi(pairId, id, kljuc, t.s("ime_telefona"), p.l("cas"), p.s("enkratni"), p.s("podpis"), p.s("cb"), p.s("mac")), "potrdi telo $ime")
            val r = assertNotNull(KodaProtokol.razberiPotrdi(t.o("potrdi_odgovor").toString()), "potrdi odgovor $ime")
            // T1-S1: /koda/potrdi ne nosi poti klicev (pride sele s podpisanim POST /seznani/klici po lastnikovem »Dodaj«)
            assertNull(r.second, "potrdi brez poti klicev $ime")
        }
        val napake = koda.a("napake")
        assertTrue(napake.size >= 12)
        for (n in napake) assertEquals(n.s("kotlin"), KodaProtokol.napaka(n.l("status").toInt(), n.s("napaka")).name, "${n.l("status")} ${n.s("napaka")}")
    }

    @Test
    fun `koncna tocka asistentke - telesa zahtev so v zapisu Line, odgovori se razberejo`() {
        val a = v.o("asistent")
        val n = a.o("naloga_telo")
        enakoJson(n, AsistentProtokol.teloNaloge(PodpisanaNaloga(n.s("id"), n.s("posiljatelj"), n.s("besedilo"), n.l("cas"), n.s("enkratni"), n.s("podpis"))), "naloga")
        val o = a.o("odobritev_telo")
        enakoJson(o, AsistentProtokol.teloOdobritve(o.s("nalogaId"), o.s("zahtevaId"), o.b("dovoli"), o.s("posiljatelj"), o.l("cas"), o.s("enkratni"), o.s("podpis")), "odobritev")
        val u = a.o("ustavitev_telo")
        enakoJson(u, AsistentProtokol.teloUstavitve(u.s("id"), u.s("posiljatelj"), u.l("cas"), u.s("enkratni"), u.s("podpis")), "ustavitev")
        val sz = a.o("seznanitev_telo")
        enakoJson(sz, AsistentProtokol.teloSeznanitve(sz.s("koda"), sz.s("id"), sz.s("kljuc"), sz.s("ime"), sz.l("cas"), sz.s("enkratni"), sz.s("podpis")), "seznanitev")
        val st = a.o("stanje_poizvedba")
        assertEquals(v.o("podpis").a("nizi").first { it.s("ime") == "stanje" }.s("niz"), NiziLine.nizStanja(st.s("posiljatelj"), st.l("cas"), st.s("enkratni")))
        // zgostitev odobritve iz prikazanih polj = zgostitev v podpisanem nizu
        val zg = NiziLine.zgostitevPrikaza(a.o("orodje").s("orodje"), a.o("orodje").s("predogled"), a.o("orodje").s("opis"))
        assertTrue(v.o("podpis").a("nizi").first { it.s("ime") == "odobritev_dovoli" }.s("niz").endsWith("\n$zg"))
    }

    @Test
    fun `T1 podpisan GET dogodki in POST seznani klici - telo, poizvedba in odgovori so v zapisu Line`() {
        val a = v.o("asistent")
        val dp = a.o("dogodki_poizvedba")
        val nd = v.o("podpis").a("nizi").first { it.s("ime") == "dogodki" }
        assertEquals(nd.s("podpis"), dp.s("podpis"))
        assertEquals(nd.s("niz"), NiziLine.nizDogodkov(a.s("id_naloge"), dp.s("posiljatelj"), dp.l("cas"), dp.s("enkratni")))
        val kt = a.o("klici_telo")
        val nk = v.o("podpis").a("nizi").first { it.s("ime") == "klici" }
        enakoJson(kt, AsistentProtokol.teloKlici(kt.s("koda"), kt.s("id"), kt.l("cas"), kt.s("enkratni"), kt.s("podpis")), "klici telo")
        assertEquals(nk.s("podpis"), kt.s("podpis"))
        assertEquals(nk.s("niz"), NiziLine.nizKlici(kt.s("koda"), kt.s("id"), kt.l("cas"), kt.s("enkratni")))
        val odg = a.a("klici_odgovori")
        val z = assertNotNull(AsistentProtokol.razberiKlice(odg[0].o("telo").toString()))
        assertEquals(odg[0].o("pricakovano").s("url"), z.url); assertEquals(odg[0].o("pricakovano").s("code"), z.code); assertEquals(odg[0].o("pricakovano").s("fp"), z.fp)
        assertNotNull(QrSeznanitev.klicnoVabilo(z.url, z.code, z.fp), "razdelek klicev iz /seznani/klici preveri isto pravilo kot QR")
        assertNull(AsistentProtokol.razberiKlice(odg[1].o("telo").toString()), """{"klici":null}""")
        assertNull(AsistentProtokol.razberiKlice("""{"klici":{"url":"https://192.168.1.20:8787","code":"K7QM4TZP"}}"""), "manjka fp")
    }

    @Test
    fun `dogodki iz GET dogodki, stanje seznanitve in seje se razberejo v pricakovana polja`() {
        val a = v.o("asistent")
        val d = assertNotNull(AsistentProtokol.razberiDogodke(a.o("dogodki_odgovor").toString(), 0))
        assertTrue(d.koncano)
        val pr = a.a("dogodki_pricakovano")
        assertEquals(pr.size, d.dogodki.size)
        for ((e, x) in pr.zip(d.dogodki)) {
            assertEquals(e.l("st"), x.st)
            when (e.s("vrsta")) {
                "stanje" -> assertEquals(DogodekLine.Stanje(e.l("st"), e.s("besedilo")), x)
                "odobritev" -> assertEquals(DogodekLine.Odobritev(e.l("st"), e.s("zahtevaId"), e.s("orodje"), e.s("predogled"), e.s("opis")), x)
                "izid" -> assertEquals(DogodekLine.Izid(e.l("st"), e.b("ok"), e.s("besedilo")), x)
                else -> error("vrsta")
            }
        }
        assertEquals(3L, AsistentProtokol.zadnjaSt(a.o("dogodki_odgovor").toString(), 0))
        assertNull(AsistentProtokol.razberiDogodke(a.o("dogodki_odgovor").toString(), 3), "st mora narascati nad »od«")
        for (e in a.a("seznanitev_stanja")) {
            val pr2 = if (e.jeNull("pricakovano")) null else StanjeSeznanitve.valueOf(e.s("pricakovano"))
            assertEquals(pr2, AsistentProtokol.razberiSeznanitev(e.o("telo").toString()), e.o("telo").toString())
        }
        for (e in a.a("seja")) {
            val pr3 = if (e.jeNull("pricakovano")) null else e.b("pricakovano")
            assertEquals(pr3, AsistentProtokol.razberiSejo(e.o("telo").toString()), e.o("telo").toString())
        }
    }
}
