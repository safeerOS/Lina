package si.safeer.lina.samostojna.n8n

sealed class IzidN8n {
    data class Uspeh(val odgovorKratek: String) : IzidN8n()
    data class Napaka(val razlog: String) : IzidN8n()
}
