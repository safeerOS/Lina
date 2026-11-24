package si.safeer.lina.podpis

import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.nio.file.Files
import java.security.MessageDigest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * »Namesti na ta telefon« (24. 11. 2026): vsako varovalo pred PackageInstallerjem posebej - glave, meja velikosti, sha256 in
 * velikost prenesenega, paket si.safeer.lina, podpisni certifikat enak namescenemu; ob zavrnitvi se kopija pobrise, druge
 * datoteke v cacheDir ostanejo.
 */
class NamestitevApkTest {
    private val vsebina = "APK-VSEBINA".toByteArray()
    private val sha = MessageDigest.getInstance("SHA-256").digest(vsebina).joinToString("") { "%02x".format(it) }
    private fun glave(
        sha256: String? = sha, velikost: Long? = vsebina.size.toLong(), paket: String? = "si.safeer.lina",
        gradnja: String? = "0123456789abcdef", vrsta: String? = "application/vnd.android.package-archive",
    ) = GlaveApk(sha256, velikost, paket, gradnja, vrsta)

    private fun mapa(): File = Files.createTempDirectory("lina-apk-").toFile()

    @Test
    fun `glave morajo biti popolne in v mejah`() {
        assertNull(NamestitevApk.preveriGlave(glave()))
        for (g in listOf(
            glave(sha256 = null), glave(sha256 = "C".repeat(64)), glave(sha256 = "c".repeat(63)),
            glave(velikost = null), glave(velikost = 0), glave(velikost = NamestitevApk.NAJVEC_BAJTOV + 1),
            glave(paket = "si.safeer.lina.lazna"), glave(paket = null),
            glave(gradnja = "../x"), glave(vrsta = "text/html"),
        )) assertEquals(true, NamestitevApk.preveriGlave(g) != null, g.toString())
        assertEquals(ZavrnitevApk.PREVELIK, NamestitevApk.preveriGlave(glave(velikost = NamestitevApk.NAJVEC_BAJTOV + 1)))
        assertEquals(ZavrnitevApk.PAKET, NamestitevApk.preveriGlave(glave(paket = "com.tuja")))
    }

    @Test
    fun `pravi prenos se shrani v svojo datoteko v cacheDir`() {
        val m = mapa()
        val r = NamestitevApk.shrani(ByteArrayInputStream(vsebina), glave(), m)
        val ok = r as IzidPrenosa.Ok
        assertEquals(File(m, NamestitevApk.IME_DATOTEKE), ok.datoteka)
        assertTrue(ok.datoteka.readBytes().contentEquals(vsebina))
        assertEquals(sha, ok.sha256)
        assertEquals("0123456789abcdef", ok.gradnja)
    }

    @Test
    fun `drugacna vsebina enake velikosti - vsota se ne ujema, kopija pobrisana`() {
        val m = mapa()
        val r = NamestitevApk.shrani(ByteArrayInputStream("APK-VSEBINO".toByteArray()), glave(), m)
        assertEquals(IzidPrenosa.Zavrnjeno(ZavrnitevApk.VSOTA), r)
        assertFalse(File(m, NamestitevApk.IME_DATOTEKE).exists())
    }

    @Test
    fun `krajse ali daljse telo od content-length je zavrnjeno, daljse se ne bere do konca`() {
        val m = mapa()
        assertEquals(IzidPrenosa.Zavrnjeno(ZavrnitevApk.VELIKOST), NamestitevApk.shrani(ByteArrayInputStream(vsebina.copyOf(5)), glave(), m))
        var prebrano = 0L
        val neskoncno = object : InputStream() {
            override fun read(): Int { prebrano++; return 'A'.code }
            override fun read(b: ByteArray, off: Int, len: Int): Int { java.util.Arrays.fill(b, off, off + len, 'A'.code.toByte()); prebrano += len; return len }
        }
        assertEquals(IzidPrenosa.Zavrnjeno(ZavrnitevApk.VELIKOST), NamestitevApk.shrani(neskoncno, glave(), m))
        assertTrue(prebrano <= vsebina.size + 64 * 1024, "bral $prebrano")
        assertFalse(File(m, NamestitevApk.IME_DATOTEKE).exists())
    }

    @Test
    fun `prekinjen prenos pobrise kopijo`() {
        val m = mapa()
        val prekinjen = object : InputStream() {
            var n = 0
            override fun read(): Int = if (n++ < 3) 'A'.code else throw IOException("prekinjeno")
        }
        assertEquals(IzidPrenosa.Zavrnjeno(ZavrnitevApk.PREKINJENO), NamestitevApk.shrani(prekinjen, glave(), m))
        assertFalse(File(m, NamestitevApk.IME_DATOTEKE).exists())
    }

    @Test
    fun `slabe glave - nic se ne bere in nic ne zapise`() {
        val m = mapa()
        var bral = false
        val tok = object : InputStream() { override fun read(): Int { bral = true; return -1 } }
        assertEquals(IzidPrenosa.Zavrnjeno(ZavrnitevApk.GLAVE), NamestitevApk.shrani(tok, glave(sha256 = null), m))
        assertFalse(bral)
        assertTrue(m.listFiles()!!.isEmpty())
    }

    @Test
    fun `paket in podpisni certifikat morata biti enaka namescenemu`() {
        val nas = listOf("a".repeat(64))
        assertNull(NamestitevApk.preveriArhiv("si.safeer.lina", nas, nas))
        assertEquals(ZavrnitevApk.PAKET, NamestitevApk.preveriArhiv("si.safeer.lina2", nas, nas))
        assertEquals(ZavrnitevApk.PAKET, NamestitevApk.preveriArhiv(null, nas, nas))
        assertEquals(ZavrnitevApk.PODPIS, NamestitevApk.preveriArhiv("si.safeer.lina", listOf("b".repeat(64)), nas))
        assertEquals(ZavrnitevApk.PODPIS, NamestitevApk.preveriArhiv("si.safeer.lina", null, nas))
        assertEquals(ZavrnitevApk.PODPIS, NamestitevApk.preveriArhiv("si.safeer.lina", emptyList(), emptyList()))
        assertEquals(ZavrnitevApk.PODPIS, NamestitevApk.preveriArhiv("si.safeer.lina", nas, null))
        // dodaten podpisnik v arhivu ni isti podpis
        assertEquals(ZavrnitevApk.PODPIS, NamestitevApk.preveriArhiv("si.safeer.lina", nas + "b".repeat(64), nas))
    }

    @Test
    fun `odtis certifikata je sha256 DER v hex`() {
        assertEquals(MessageDigest.getInstance("SHA-256").digest(byteArrayOf(1, 2)).joinToString("") { "%02x".format(it) }, NamestitevApk.odtis(byteArrayOf(1, 2)))
    }

    @Test
    fun `pospravljanje pobrise samo svojo datoteko`() {
        val m = mapa()
        File(m, NamestitevApk.IME_DATOTEKE).writeText("x")
        File(m, "drugo.apk").writeText("y")
        File(m, "slike").mkdir()
        assertTrue(NamestitevApk.pobrisi(m))
        assertEquals(setOf("drugo.apk", "slike"), m.list()!!.toSet())
        assertTrue(NamestitevApk.pobrisi(m), "ce je ni, je pospravljeno")
    }
}
