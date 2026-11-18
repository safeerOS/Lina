package si.safeer.lina.samostojna

import java.time.ZonedDateTime
import java.time.format.DateTimeParseException

sealed class Odgovor {
    class Besedilo(val besedilo: String) : Odgovor()
    class Zapisek(val besedilo: String) : Odgovor()
    class Opomnik(val besedilo: String, val cas: String) : Odgovor()
    class Napaka(val sporocilo: String) : Odgovor()
}

class Asistent(
    private val odjemalec: PonudnikOdjemalec,
    private val sistemskoNavodilo: String,
    private val najvecSporocil: Int = 40
) {
    private val zgodovina = mutableListOf<Sporocilo>()

    fun povej(vnos: String): Odgovor {
        if (vnos.isBlank()) {
            return Odgovor.Besedilo("")
        }

        zgodovina.add(Sporocilo("user", vnos))
        
        while (zgodovina.size > najvecSporocil) {
            zgodovina.removeAt(0)
        }

        val rezultat = odjemalec.poslji(zgodovina, sistemskoNavodilo)

        when (rezultat) {
            is Rezultat.Besedilo -> {
                zgodovina.add(Sporocilo("model", rezultat.besedilo))
                
                while (zgodovina.size > najvecSporocil) {
                    zgodovina.removeAt(0)
                }

                val besedilo = rezultat.besedilo
                
                val vrstice = besedilo.lines()
                for (vrstica in vrstice) {
                    val obrezana = vrstica.trim()
                    if (obrezana.startsWith("[[zapisek:") && obrezana.endsWith("]]")) {
                        val vsebina = obrezana.substring(10, obrezana.length - 2).trim()
                        if (vsebina.isNotEmpty()) {
                            return Odgovor.Zapisek(vsebina)
                        }
                    } else if (obrezana.startsWith("[[opomnik:") && obrezana.endsWith("]]")) {
                        val vsebina = obrezana.substring(10, obrezana.length - 2).trim()
                        val deli = vsebina.split("|", limit = 2)
                        if (deli.size == 2) {
                            val casString = deli[0].trim()
                            val besediloOpomnika = deli[1].trim()
                            if (besediloOpomnika.isNotEmpty()) {
                                try {
                                    ZonedDateTime.parse(casString)
                                    return Odgovor.Opomnik(besediloOpomnika, casString)
                                } catch (e: DateTimeParseException) {
                                    // Neveljaven cas - nadaljuje se kot navadno besedilo
                                }
                            }
                        }
                    }
                }
                
                return Odgovor.Besedilo(besedilo)
            }
            is Rezultat.Napaka -> {
                zgodovina.removeLast() // odstrani zadnji 'user' vnos, da lahko uporabnik ponovi
                return Odgovor.Napaka(rezultat.sporocilo)
            }
            is Rezultat.Zavrnjeno -> {
                zgodovina.removeLast()
                return Odgovor.Napaka("Zavrnjeno: ${rezultat.razlog}")
            }
        }
    }
}
