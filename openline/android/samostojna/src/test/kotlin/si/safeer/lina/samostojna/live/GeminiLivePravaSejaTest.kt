package si.safeer.lina.samostojna.live

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import si.safeer.lina.samostojna.DnevnikKlicev
import si.safeer.lina.samostojna.GoogleZeton
import si.safeer.lina.samostojna.KljucGemini
import si.safeer.lina.samostojna.ShranjevalnikKljuca
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.assertTrue
import kotlin.test.fail

class GeminiLivePravaSejaTest {

    @Test
    @EnabledIfEnvironmentVariable(named = "LINA_LIVE", matches = "1")
    fun `prava seja z Vertex AI`() {
        val zeton = try {
            val pb = ProcessBuilder("gcloud", "auth", "application-default", "print-access-token")
            val proc = pb.start()
            val output = proc.inputStream.bufferedReader().readText().trim()
            proc.waitFor()
            if (proc.exitValue() != 0) {
                fail("PRAVA SEJA NI USPELA (gcloud exit code ${proc.exitValue()})")
                return
            }
            output
        } catch (e: Exception) {
            fail("PRAVA SEJA NI USPELA. Dobesedna napaka: ${e.message}")
            return
        }

        // Projekt
        val projekt = File(System.getenv("LINA_PROJEKT_DATOTEKA") ?: throw RuntimeException("Nastavi LINA_PROJEKT_DATOTEKA")).readLines().first().trim()

        val shramba = object : ShranjevalnikKljuca {
            override fun shrani(kljuc: KljucGemini) {}
            override fun preberi(): KljucGemini? = null
            override fun izbrisi() {}
        }

        val dnevnik = DnevnikKlicev(si.safeer.lina.samostojna.PomnilniskaShramba())

        val odjemalec = GeminiLiveOdjemalec(
            apiKljuc = shramba,
            googleZeton = GoogleZeton { zeton },
            projekt = { projekt },
            dnevnik = dnevnik,
            izbiraPoti = IzbiraPotiLive(naVoljo = { it == PotLive.VERTEX }),
            wsFabrika = JavaNetWsFabrika()
        )

        val latch = CountDownLatch(1)
        var prejeto = 0

        odjemalec.nastaviIzhod { 
            prejeto += it.size
            if (prejeto > 0) latch.countDown()
        }

        val zacetek = System.currentTimeMillis()
        
        // Posljimo zacetni prazni okvir, da se vzpostavi povezava
        odjemalec.vKlic(ByteArray(0))
        Thread.sleep(500) // cakamo na open

        // Preberemo zvok
        val pcm = File("build/tmp/test_sl.pcm").readBytes()
        var offset = 0
        while (offset < pcm.size) {
            val end = minOf(offset + 640, pcm.size)
            val chunk = pcm.copyOfRange(offset, end)
            odjemalec.vKlic(chunk)
            offset = end
            Thread.sleep(20) // 640 byte at 16kHz is 20ms
        }
        odjemalec.pocisti() // da sporocilo turnComplete

        val uspeh = latch.await(20, TimeUnit.SECONDS)
        val trajanje = System.currentTimeMillis() - zacetek

        odjemalec.konecKlica()

        if (!uspeh) {
            val zadnjiZapis = dnevnik.seznam().lastOrNull()?.povzetek ?: "Neznano"
            fail("PRAVA SEJA NI USPELA (cas $trajanje ms). Dobesedna napaka: $zadnjiZapis")
        } else {
            println("USPEH: Prvi zvok prejet v $trajanje ms.")
            assertTrue(trajanje > 0)
        }
    }
}
