package si.safeer.lina.samostojna

import java.io.File
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// Klica na Samsungu 22. 11. 2026 brez zvoka: TLS kljuc lokalnega prehoda v AndroidKeyStore je KeyMint zavrnil pri podpisu
// NONEwithECDSA (»Incompatible digest«), tudi po zamenjavi z DIGEST_NONE. Kljuc prehoda je zato programski, na disku ovit z AES-GCM.
class PrehodKljucTest {
    private val vir = File("../app/src/main/kotlin/si/safeer/lina/telecom/LokalniPrehodUpravljalnik.kt").readText()

    @Test
    fun `TLS kljuc prehoda ni v AndroidKeyStore, na disku je samo ovit`() {
        val start = vir.substringAfter("fun start(").substringBefore("val prefs =")
        assertTrue("KeyStore.getInstance(\"PKCS12\")" in start, "kljuc za TLS iz programske shrambe")
        assertTrue("KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, \"AndroidKeyStore\")" !in vir, "EC kljuc za TLS ne sme biti v AndroidKeyStore")
        assertTrue("AdbKeyBlob.seal(ovoj, par.private.encoded)" in vir, "zasebni kljuc na disku samo ovit")
        assertTrue("noBackupFilesDir" in vir, "brez varnostne kopije")
    }

    // Klic 22. 11. 2026 ob 10.30: Vertex Live odgovarja v binarnih okvirjih; OkHttp odjemalec jih mora brati.
    @Test
    fun `odjemalec Live bere tudi binarne okvirje`() {
        val f = File("../app/src/main/kotlin/si/safeer/lina/OkHttpWsFabrika.kt").readText()
        assertTrue("override fun onMessage(webSocket: WebSocket, bytes: okio.ByteString)" in f)
        assertTrue("poslusalec.onText(bytes.utf8())" in f)
    }

    // Posnetek lastnika 22. 11. 2026: okno klicatelja s svetlim besedilom na belem ozadju.
    @Test
    fun `vsako pogovorno okno ima paleto aplikacije`() {
        val t = File("../app/src/main/res/values/themes.xml").readText()
        assertTrue("<item name=\"android:alertDialogTheme\">@style/Gw.Dialog</item>" in t)
        assertTrue("<item name=\"android:colorBackgroundFloating\">@color/surface</item>" in t)
    }
}
