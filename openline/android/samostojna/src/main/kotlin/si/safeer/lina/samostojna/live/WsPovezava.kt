package si.safeer.lina.samostojna.live

interface WsPovezava {
    fun posiljiBesedilo(besedilo: String)
    fun zapri(koda: Int, razlog: String)
}

interface WsPoslusalec {
    fun onOpen(povezava: WsPovezava)
    fun onText(besedilo: String)
    fun onError(napaka: Throwable)
    fun onClose(koda: Int, razlog: String)
}

interface WsFabrika {
    fun odpri(url: String, glave: Map<String, String>, poslusalec: WsPoslusalec): WsPovezava
}
