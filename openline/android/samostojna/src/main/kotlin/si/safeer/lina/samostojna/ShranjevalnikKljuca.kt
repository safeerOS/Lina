package si.safeer.lina.samostojna

interface ShranjevalnikKljuca {
    fun preberi(): KljucGemini?
    fun shrani(k: KljucGemini)
    fun izbrisi()
}

class PomnilniskiShranjevalnik : ShranjevalnikKljuca {
    private var kljuc: KljucGemini? = null

    override fun preberi(): KljucGemini? = kljuc

    override fun shrani(k: KljucGemini) {
        kljuc = k
    }

    override fun izbrisi() {
        kljuc = null
    }
}
