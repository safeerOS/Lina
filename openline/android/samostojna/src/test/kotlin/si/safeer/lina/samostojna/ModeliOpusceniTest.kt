package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class ModeliOpusceniTest {
    /**
     * Opusceni modeli po uradnem seznamu https://aistudio.google.com/docs/deprecations.md (prebrano 25. 11. 2026):
     * gemini-2.5-flash je opuscen, od 1. 12. 2026 se zahteve preusmerijo na gemini-3.5-flash-lite (neskladne spremembe API).
     * Na Vertexu (locations/global) je 25. 11. 2026 gemini-2.5-flash vrnil 404.
     */
    private val OPUSCENI = setOf("gemini-2.5-flash")

    @Test
    fun `noben rezervni ali privzeti model samostojne kode ni opuscen`() {
        val modeli = REZERVNI_MODELI_VERTEX + Ponudnik.entries.map { it.model } + SamodejniModel.PRIPOROCENI.values.flatten()
        for (m in modeli) assertFalse(m in OPUSCENI, m)
    }

    @Test
    fun `rezervni modeli Vertex so tisti, ki so 25 11 2026 na Vertexu odgovorili 200`() {
        assertEquals(listOf("gemini-3-flash-preview", "gemini-3.8-flash"), REZERVNI_MODELI_VERTEX)
    }
}
