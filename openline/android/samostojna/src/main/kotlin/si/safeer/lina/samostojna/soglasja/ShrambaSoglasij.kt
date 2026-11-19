package si.safeer.lina.samostojna.soglasja

interface ShrambaSoglasij {
    fun preberi(): List<Soglasje>
    fun shrani(soglasja: List<Soglasje>)
}
