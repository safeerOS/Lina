package com.httpgateway.protocol

import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull

/** Krog 17, N13 (pregled 15): sonda samo prek wss, zeton iz datoteke, ki se po branju izbrise. */
class EhoProbeInputTest {
    private val pin = "ab".repeat(32)
    private val token = "t".repeat(40)

    @Test
    fun `N13 samo wss s polnim odtisom`() {
        val ok = EhoProbeInput.config("wss://192.0.2.10:8787/v1/device-channel", pin, 50)
        assertEquals(pin, ok.pin)
        assertEquals(50, ok.frames)
        for (bad in listOf(
            "ws://192.0.2.10:8787/v1/device-channel",
            "https://192.0.2.10:8787/v1/device-channel",
            "WSS://192.0.2.10:8787/x",
            "wss:///brez-gostitelja",
            "wss://uporabnik:geslo@192.0.2.10:8787/x",
            " ",
            "nic",
        )) {
            assertFailsWith<IllegalArgumentException>(bad) { EhoProbeInput.config(bad, pin, 50) }
        }
        assertFailsWith<IllegalArgumentException> { EhoProbeInput.config(null, pin, 50) }
        assertFailsWith<IllegalArgumentException> { EhoProbeInput.config("wss://192.0.2.10/x", "ab", 50) }
        assertFailsWith<IllegalArgumentException> { EhoProbeInput.config("wss://192.0.2.10/x", null, 50) }
        assertEquals(256, EhoProbeInput.config("wss://192.0.2.10/x", pin, 99_999).frames)
        assertEquals(1, EhoProbeInput.config("wss://192.0.2.10/x", pin, -5).frames)
    }

    private fun tmpDir(): File = Files.createTempDirectory("eho-sonda").toFile()

    @Test
    fun `N13 zeton iz datoteke in datoteka izbrisana po branju`() {
        val dir = tmpDir()
        try {
            val f = File(dir, EhoProbeInput.TOKEN_FILE)
            f.writeText("$token\n")
            assertEquals(token, EhoProbeInput.readTokenOnce(f))
            assertFalse(f.exists(), "datoteka z zetonom mora izginiti takoj po branju")
            assertNull(EhoProbeInput.readTokenOnce(f), "drugo branje nima zetona")
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test
    fun `N13 kratek zeton zavrnjen in datoteka vseeno izbrisana`() {
        val dir = tmpDir()
        try {
            for (content in listOf("kratek", "", "a b".padEnd(40, 'x'), "x".repeat(5000))) {
                val f = File(dir, EhoProbeInput.TOKEN_FILE)
                f.writeText(content)
                assertNull(EhoProbeInput.readTokenOnce(f), content.take(10))
                assertFalse(f.exists())
            }
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test
    fun `N13 simbolna povezava se ne bere`() {
        val dir = tmpDir()
        try {
            val target = File(dir, "drugje").apply { writeText(token) }
            val link = File(dir, EhoProbeInput.TOKEN_FILE)
            Files.createSymbolicLink(link.toPath(), target.toPath())
            assertNull(EhoProbeInput.readTokenOnce(link))
            assertFalse(Files.exists(link.toPath(), java.nio.file.LinkOption.NOFOLLOW_LINKS))
            assertEquals(token, target.readText(), "cilj povezave ostane nedotaknjen")
        } finally {
            dir.deleteRecursively()
        }
    }
}
