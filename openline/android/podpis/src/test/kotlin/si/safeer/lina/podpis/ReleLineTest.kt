package si.safeer.lina.podpis

import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Global Link na telefonu (naloga 22, 25. 11. 2026): izbira poti (domace omrezje, nato rele), kanal releja link.safeer.si
 * (protokol kot core/link_rele.py) in lokalna vrata s skrivnostjo, skozi katera gre HTTPS s pripetim odtisom kot doma.
 */
class ReleLineTest {
    private class Lazna(val odg: OdgovorLine) : PovezavaZLino {
        val klici = AtomicInteger()
        private fun o(): OdgovorLine { klici.incrementAndGet(); return odg }
        override fun naloga(telo: String) = o()
        override fun dogodki(id: String, posiljatelj: String, cas: Long, enkratni: String, podpis: String, od: Long, cakaS: Int) = o()
        override fun klici(telo: String) = o()
        override fun sinhron(telo: String) = o()
        override fun odobritev(telo: String) = o()
        override fun ustavi(telo: String) = o()
        override fun seznani(telo: String) = o()
        override fun stanjeSeznanitve(koda: String) = o()
        override fun stanjeSeje(posiljatelj: String, cas: Long, enkratni: String, podpis: String) = o()
        override fun stanjeGradenj(posiljatelj: String, cas: Long, enkratni: String, podpis: String) = o()
        override fun predlogGradnje(telo: String) = o()
        override fun potrditevGradnje(telo: String) = o()
        override fun stanjeAgentNalog(posiljatelj: String, cas: Long, enkratni: String, podpis: String) = o()
        override fun dodeliAgentNalogo(telo: String) = o()
        override fun prekliciAgentNalogo(telo: String) = o()
    }

    @Test
    fun `naloge agentov in gradnje - LAN nedosegljiv, rele dosegljiv - vsak klic uspe prek releja (lastnik 25 11 2026)`() {
        val klici: List<Pair<String, (PovezavaZLino) -> OdgovorLine>> = listOf(
            "stanjeGradenj" to { p -> p.stanjeGradenj("a", 1, "b", "c") },
            "predlogGradnje" to { p -> p.predlogGradnje("{}") },
            "potrditevGradnje" to { p -> p.potrditevGradnje("{}") },
            "stanjeAgentNalog" to { p -> p.stanjeAgentNalog("a", 1, "b", "c") },
            "dodeliAgentNalogo" to { p -> p.dodeliAgentNalogo("{}") },
            "prekliciAgentNalogo" to { p -> p.prekliciAgentNalogo("{}") },
        )
        for ((ime, klic) in klici) {
            val lan = Lazna(OdgovorLine.Nedosegljiva)
            val rele = Lazna(OdgovorLine.Ok("{\"ok\":true}"))
            val poti = mutableListOf<PotLine?>()
            assertEquals(OdgovorLine.Ok("{\"ok\":true}"), klic(IzbirnaPovezava(lan, null, rele, poVrsti) { poti += it }), ime)
            assertEquals(1, lan.klici.get(), "$ime: LAN najprej")
            assertEquals(1, rele.klici.get(), "$ime: nato rele")
            assertEquals(listOf<PotLine?>(PotLine.GLOBAL_LINK), poti, ime)
        }
    }

    @Test
    fun `prenos APK po poteh - LAN nedosegljiv, rele prenese z isto povezavo, odgovor LAN ustavi iskanje, nic dosegljivo je null`() {
        val lan = Lazna(OdgovorLine.Nedosegljiva)
        val rele = Lazna(OdgovorLine.Ok("{}"))
        val poti = mutableListOf<PotLine?>()
        val p = IzbirnaPovezava(lan, null, rele, poVrsti) { poti += it }
        // klic vrne null samo, ce pot ni dosegljiva (kot prenesiApk z Nedosegljiva)
        val izid = p.poPoteh { pov -> if (pov === lan) null else "apk" }
        assertEquals("apk" to PotLine.GLOBAL_LINK, izid)
        assertEquals(listOf<PotLine?>(PotLine.GLOBAL_LINK), poti)
        // doma: rele se ne poskusi (isti enkratni niz se ne porabi dvakrat)
        var releKlican = false
        assertEquals("doma" to PotLine.DOMACE_OMREZJE, p.poPoteh { pov -> if (pov === rele) { releKlican = true; "x" } else "doma" })
        assertTrue(!releKlican)
        assertNull(p.poPoteh<String> { null })
        assertEquals(listOf(PotLine.GLOBAL_LINK, PotLine.DOMACE_OMREZJE, null), poti)
        // brez releja (Global Link izklopljen): samo LAN
        assertNull(IzbirnaPovezava(lan, null, null, poVrsti).poPoteh { pov -> if (pov === lan) null else "x" })
    }

    /** Zaporedno kot PrenosPoPoti brez premorov (premore preizkusa samostojna/IzbiraPotiTest). */
    private val poVrsti: (() -> OdgovorLine?, (() -> OdgovorLine?)?, (() -> OdgovorLine?)?) -> OdgovorLine? =
        { l, n, r -> listOfNotNull(l, n, r).firstNotNullOfOrNull { it() } }

    @Test
    fun `LAN ni dosegljiv, rele je - zahteva uspe prek releja in pot je Global Link`() {
        val lan = Lazna(OdgovorLine.Nedosegljiva)
        val rele = Lazna(OdgovorLine.Ok("{}"))
        val poti = mutableListOf<PotLine?>()
        val p = IzbirnaPovezava(lan, null, rele, poVrsti) { poti += it }
        assertEquals(OdgovorLine.Ok("{}"), p.naloga("{}"))
        assertEquals(1, lan.klici.get())
        assertEquals(1, rele.klici.get())
        assertEquals(listOf<PotLine?>(PotLine.GLOBAL_LINK), poti)
    }

    @Test
    fun `doma uspe LAN - rele se ne poskusi, napaka streznika je dosegljiva pot, vse pade - Nedosegljiva in pot neznana`() {
        val rele = Lazna(OdgovorLine.Ok("{}"))
        val poti = mutableListOf<PotLine?>()
        assertEquals(OdgovorLine.Ok("x"), IzbirnaPovezava(Lazna(OdgovorLine.Ok("x")), null, rele, poVrsti) { poti += it }.naloga("{}"))
        assertEquals(0, rele.klici.get())
        val zavrnjeno = OdgovorLine.Napaka(403, "zavrnjeno")
        assertEquals(zavrnjeno, IzbirnaPovezava(Lazna(zavrnjeno), null, rele, poVrsti) { poti += it }.stanjeSeje("a", 1, "b", "c"))
        assertEquals(OdgovorLine.Nedosegljiva, IzbirnaPovezava(Lazna(OdgovorLine.Nedosegljiva), null, Lazna(OdgovorLine.Nedosegljiva), poVrsti) { poti += it }.naloga("{}"))
        assertEquals(listOf(PotLine.DOMACE_OMREZJE, PotLine.DOMACE_OMREZJE, null), poti)
        // brez releja (Global Link izklopljen na racunalniku): samo LAN
        assertEquals(OdgovorLine.Nedosegljiva, IzbirnaPovezava(Lazna(OdgovorLine.Nedosegljiva), null, null, poVrsti).naloga("{}"))
    }

    @Test
    fun `pregled - sinhronizacija, klici in seznanjanje nikoli prek releja (samo domace omrezje, ne polnijo omejitev Line)`() {
        val rele = Lazna(OdgovorLine.Ok("{}"))
        val p = IzbirnaPovezava(Lazna(OdgovorLine.Nedosegljiva), null, rele, poVrsti)
        assertEquals(OdgovorLine.Nedosegljiva, p.sinhron("{}"))
        assertEquals(OdgovorLine.Nedosegljiva, p.klici("{}"))
        assertEquals(OdgovorLine.Nedosegljiva, p.seznani("{}"))
        assertEquals(OdgovorLine.Nedosegljiva, p.stanjeSeznanitve("k"))
        assertEquals(0, rele.klici.get())
        assertEquals(OdgovorLine.Ok("{}"), p.ustavi("{}"))
        assertEquals(1, rele.klici.get())
    }

    @Test
    fun `podpis releja - isti niz kot link_rele podpisane_glave, samo pot connect`() {
        val prazno = MessageDigest.getInstance("SHA-256").digest(ByteArray(0)).joinToString("") { "%02x".format(it) }
        val pot = "/v1/connect?to=n-0123456789abcdef&kanal=" + "a".repeat(32)
        assertEquals("GET\n$pot\n1763130000\n$prazno", String(ReleProtokol.sporociloPodpisa(pot, 1763130000), Charsets.UTF_8))
        assertTrue(ReleProtokol.jePotPovezave(pot))
        for (slaba in listOf("/v1/listen", "/v1/accept?kanal=" + "a".repeat(32), "/v1/connect?to=n-xyz&kanal=" + "a".repeat(32),
            "/v1/connect?to=n-0123456789abcdef&kanal=" + "a".repeat(31), "$pot&x=1")) {
            assertTrue(!ReleProtokol.jePotPovezave(slaba), slaba)
        }
        assertTrue(ReleProtokol.jeIdReleja("n-0123456789abcdef"))
        assertTrue(!ReleProtokol.jeIdReleja("n-0123456789ABCDEF"))
    }

    @Test
    fun `id releja iz podpisanega stanja - samo veljaven id, sicer null`() {
        assertEquals("n-0123456789abcdef", AsistentProtokol.razberiRele("""{"claudeCode":"odprta","rele":"n-0123456789abcdef"}"""))
        assertNull(AsistentProtokol.razberiRele("""{"claudeCode":"odprta"}"""))
        assertNull(AsistentProtokol.razberiRele("""{"rele":"n-0123"}"""))
        assertNull(AsistentProtokol.razberiRele("""{"rele":"https://napadalec.example"}"""))
        assertNull(AsistentProtokol.razberiRele("ni json"))
    }

    @Test
    fun `okvirji - maskiran okvir releja, prevelik in nadaljevanje brez zacetka so napaka`() {
        val r = ReleProtokol.Razclenjevalec()
        val d1 = ReleProtokol.okvir(2, "ab".toByteArray(), null).also { it[0] = (it[0].toInt() and 0x7f).toByte() }
        val d2 = ReleProtokol.okvir(0, "cd".toByteArray(), null)
        assertTrue(r.dodaj(d1).isEmpty())
        assertEquals("abcd", String(r.dodaj(d2).single().podatki))
        assertFailsWith<java.io.IOException> { ReleProtokol.Razclenjevalec().dodaj(ReleProtokol.okvir(2, byteArrayOf(1), ByteArray(4) { 7 })) }
        assertFailsWith<java.io.IOException> { ReleProtokol.Razclenjevalec().dodaj(ReleProtokol.okvir(0, byteArrayOf(1), null)) }
        val velik = ByteArray(10).also { it[0] = 0x82.toByte(); it[1] = 127; java.nio.ByteBuffer.wrap(it, 2, 8).putLong(5L * 1024 * 1024) }
        assertFailsWith<java.io.IOException> { ReleProtokol.Razclenjevalec().dodaj(velik) }
    }

    // ------------------------------------------------------------- lazen rele (navaden TCP namesto TLS do link.safeer.si)

    private val par = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
    private val javni = Base64.getEncoder().encodeToString(par.public.encoded)
    private val podpisnik: (String, Long) -> String? = { pot, cas ->
        Signature.getInstance("SHA256withECDSA").run { initSign(par.private); update(ReleProtokol.sporociloPodpisa(pot, cas)); Base64.getEncoder().encodeToString(sign()) }
    }

    /** Rele: preveri podpis in pot, odgovori 101 (ali [status]), poslje »ready«, nato prenasa bajte do [lina] (odmev Line). */
    private inner class LazenRele(val status: Int = 101, val ready: Boolean = true, val napacenAccept: Boolean = false, val pingi: Boolean = false, val tok: ByteArray? = null) : AutoCloseable {
        val zaprti = AtomicInteger()
        val ss = ServerSocket(0, 8, InetAddress.getLoopbackAddress())
        val kanali = AtomicInteger()
        val podpisi = mutableListOf<Boolean>()
        init {
            thread(isDaemon = true) {
                while (!ss.isClosed) {
                    val s = try { ss.accept() } catch (_: Exception) { break }
                    thread(isDaemon = true) { streži(s) }
                }
            }
        }
        private fun vrstica(i: InputStream): String {
            val b = StringBuilder()
            while (true) { val c = i.read(); if (c < 0 || c == '\n'.code) break; if (c != '\r'.code) b.append(c.toChar()) }
            return b.toString()
        }
        private fun streži(s: Socket) {
            val i = s.getInputStream(); val o = s.getOutputStream()
            val prva = vrstica(i)
            val g = mutableMapOf<String, String>()
            while (true) { val v = vrstica(i); if (v.isEmpty()) break; val k = v.indexOf(':'); g[v.substring(0, k).trim().lowercase()] = v.substring(k + 1).trim() }
            val pot = prva.split(" ")[1]
            val ok = KrogKljuc.preveriPodpisSKljucem(g["x-safeer-key"].orEmpty(), ReleProtokol.sporociloPodpisa(pot, g["x-safeer-time"]!!.toLong()), g["x-safeer-signature"].orEmpty())
            synchronized(podpisi) { podpisi += ok }
            if (!ok || status != 101) { o.write("HTTP/1.1 ${if (ok) status else 401} X\r\ncontent-length: 0\r\n\r\n".toByteArray()); s.close(); return }
            val acc = Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-1").digest((g["sec-websocket-key"] + ReleProtokol.GUID).toByteArray()))
            o.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${if (napacenAccept) "x$acc" else acc}\r\n\r\n".toByteArray())
            kanali.incrementAndGet()
            if (pingi) {
                // rele, ki namesto »ready« neskoncno posilja ping (cuvaj na telefonu mora kanal zapreti)
                try { while (true) { o.write(ReleProtokol.okvir(9, byteArrayOf(), null)); o.flush(); Thread.sleep(100) } } catch (_: Exception) { s.close(); zaprti.incrementAndGet(); return }
            }
            if (ready) o.write(ReleProtokol.okvir(1, "ready".toByteArray(), null))
            o.flush()
            if (tok != null) {
                // »Lina« posilja velik odgovor (APK) kot racunalnik (rele-lina.server.ts kotDuplex): binarna sporocila po 16 KiB, nato close
                var k = 0
                while (k < tok.size) { val n = minOf(16 * 1024, tok.size - k); o.write(ReleProtokol.okvir(2, tok.copyOfRange(k, k + n), null)); k += n }
                o.write(ReleProtokol.okvir(8, byteArrayOf(), null)); o.flush()
                // zapiranje z neprebranim vhodom bi na Linuxu poslalo RST in izgubilo neposlane bajte: najprej preberi do konca
                s.soTimeout = 10_000
                try { val b = ByteArray(4096); while (i.read(b) >= 0) {} } catch (_: Exception) {}
                s.close(); zaprti.incrementAndGet(); return
            }
            // »Lina« na drugi strani kanala: vrne vse, kar dobi, z dodano »L:«
            val r = ReleProtokol.Razclenjevalec(maskirano = true)
            val buf = ByteArray(4096)
            while (true) {
                val n = try { i.read(buf) } catch (_: Exception) { -1 }
                if (n < 0) break
                val sporocila = try { r.dodaj(buf.copyOf(n)) } catch (_: Exception) { break }
                for (m in sporocila) if (m.op == 2) { o.write(ReleProtokol.okvir(2, "L:".toByteArray() + m.podatki, null)); o.flush() }
                if (sporocila.any { it.op == 8 }) break
            }
            s.close()
            zaprti.incrementAndGet()
        }
        fun kanal() = ReleKanal(odpri = { Socket(InetAddress.getLoopbackAddress(), ss.localPort) }, kljuc = { javni }, podpisi = podpisnik)
        override fun close() = ss.close()
    }

    private fun preberi(i: InputStream, n: Int): String {
        val b = ByteArray(n); var k = 0
        while (k < n) { val x = i.read(b, k, n - k); if (x < 0) break; k += x }
        return String(b, 0, k)
    }

    @Test
    fun `kanal releja - podpisan connect, ready, bajti v obe smeri`() {
        LazenRele().use { rele ->
            val (vhod, izhod) = rele.kanal().odpri("n-0123456789abcdef")!!
            izhod.write("zivjo".toByteArray()); izhod.flush()
            assertEquals("L:zivjo", preberi(vhod, 7))
            assertEquals(listOf(true), rele.podpisi)
        }
    }

    @Test
    fun `kanal releja - zavrnitev, napacen Sec-WebSocket-Accept ali brez ready je null`() {
        LazenRele(status = 403).use { assertNull(it.kanal().odpri("n-0123456789abcdef")) }
        LazenRele(napacenAccept = true).use { assertNull(it.kanal().odpri("n-0123456789abcdef")) }
        LazenRele(ready = false).use { assertNull(it.kanal(rokReady = 300).odpri("n-0123456789abcdef")) }
        LazenRele().use { assertNull(it.kanal().odpri("https://napadalec")) } // cilj ni id releja: nic se ne poslje
    }

    @Test
    fun `pregled - cuvaj zapre kanal, ce rele namesto ready posilja ping`() {
        LazenRele(ready = false, pingi = true).use { rele ->
            val zacetek = System.currentTimeMillis()
            assertNull(rele.kanal(rokReady = 500).odpri("n-0123456789abcdef"))
            assertTrue(System.currentTimeMillis() - zacetek < 3_000, "cuvaj ni ustavil cakanja")
        }
    }

    @Test
    fun `pregled - lokalna vrata, skupni rok za skrivnost (pocasno posiljanje ne drzi mesta) in zaprtje kanala na releju`() {
        LazenRele().use { rele ->
            ReleVrata("n-0123456789abcdef", rele.kanal()).use { v ->
                // tuja aplikacija posilja po en bajt na 300 ms (vsako branje je pod 5 s, skupaj pa ne)
                val tuja = Socket(InetAddress.getLoopbackAddress(), v.vrata)
                val zacetek = System.currentTimeMillis()
                thread(isDaemon = true) { try { repeat(31) { tuja.getOutputStream().write(1); tuja.getOutputStream().flush(); Thread.sleep(300) } } catch (_: Exception) {} }
                tuja.soTimeout = 9_000
                assertEquals(-1, try { tuja.getInputStream().read() } catch (_: java.net.SocketException) { -1 })
                assertTrue(System.currentTimeMillis() - zacetek < 7_500, "vrata so drzala tujo vticnico predolgo")
                assertEquals(0, rele.kanali.get())
                // prava vticnica: po zaprtju lokalne strani se zapre tudi kanal na releju
                val s = v.tovarna().createSocket(InetAddress.getLoopbackAddress(), v.vrata)
                s.getOutputStream().write("x".toByteArray()); s.getOutputStream().flush()
                assertEquals("L:x", preberi(s.getInputStream(), 3))
                s.close()
                val rok = System.currentTimeMillis() + 3_000
                while (rele.zaprti.get() < 1 && System.currentTimeMillis() < rok) Thread.sleep(20)
                assertEquals(1, rele.zaprti.get())
            }
        }
    }

    @Test
    fun `prenos APK prek releja - 9 MiB tece kot tok (sporocila po 16 KiB kot kotDuplex racunalnika), meja 4 MiB velja za sporocilo`() {
        val apk = ByteArray(9 * 1024 * 1024).also { java.util.Random(7).nextBytes(it) }
        LazenRele(tok = apk).use { rele ->
            ReleVrata("n-0123456789abcdef", rele.kanal()).use { v ->
                val s = v.tovarna().createSocket(InetAddress.getLoopbackAddress(), v.vrata)
                s.getOutputStream().write("GET".toByteArray()); s.getOutputStream().flush()
                s.soTimeout = 20_000
                val prejeto = s.getInputStream().readBytes()
                s.close()
                assertEquals(apk.size, prejeto.size)
                assertTrue(MessageDigest.isEqual(MessageDigest.getInstance("SHA-256").digest(apk), MessageDigest.getInstance("SHA-256").digest(prejeto)))
            }
        }
    }

    private fun LazenRele.kanal(rokReady: Int) = ReleKanal(odpri = { Socket(InetAddress.getLoopbackAddress(), ss.localPort) }, kljuc = { javni }, podpisi = podpisnik, rokMs = rokReady)

    @Test
    fun `lokalna vrata - samo vticnica s skrivnostjo dobi kanal, tuja aplikacija brez skrivnosti ne odpre kanala`() {
        LazenRele().use { rele ->
            ReleVrata("n-0123456789abcdef", rele.kanal()).use { v ->
                val s = v.tovarna().createSocket(InetAddress.getLoopbackAddress(), v.vrata)
                s.getOutputStream().write("tls".toByteArray()); s.getOutputStream().flush()
                assertEquals("L:tls", preberi(s.getInputStream(), 5))
                s.close()
                assertEquals(1, rele.kanali.get())
                // tuja aplikacija na telefonu: navadna vticnica na ista vrata, brez skrivnosti
                val tuja = Socket(InetAddress.getLoopbackAddress(), v.vrata)
                tuja.getOutputStream().write(ByteArray(32) { 1 }); tuja.getOutputStream().flush()
                tuja.soTimeout = 3000
                assertEquals(-1, tuja.getInputStream().read())
                assertEquals(1, rele.kanali.get())
            }
        }
    }
}
