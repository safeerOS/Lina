package si.safeer.lina.samostojna

import java.time.ZonedDateTime
import java.time.format.DateTimeParseException

sealed class Odgovor {
    class Besedilo(val besedilo: String) : Odgovor()
    class Zapisek(val besedilo: String) : Odgovor()
    class Opomnik(val besedilo: String, val cas: String) : Odgovor()
    class Napaka(val sporocilo: String) : Odgovor()
    /** Naloga za racunalnik (Claude Code prek podpisanega kanala); izvede jo aplikacija, ne model. */
    class NalogaRacunalniku(val besedilo: String) : Odgovor()
}

class Asistent(
    private val odjemalec: PonudnikOdjemalec,
    private val sistemskoNavodilo: String,
    private val najvecSporocil: Int = 40,
    // Spletna orodja (iskanje Brave, branje strani TinyFish); brez kljuca jih ni (lastnik 18. 11. 2026).
    private val orodja: SpletnaOrodja? = null,
    // Spomin pogovorov na telefonu (lastnik 22. 11. 2026: privzeto vklopljen, brez potrjevanja, dela brez racunalnika).
    private val spomin: SpominPogovorov? = null,
    // Ali je telefon povezan z Lino na racunalniku (ob vsakem vprasanju znova: povezava se spreminja).
    private val racunalnikPovezan: () -> Boolean = { false },
    // Koledar telefona, samo branje (lastnik 22. 11. 2026); brez dovoljenja orodje odgovori z besedilom o dovoljenju.
    private val koledar: KoledarIzvajalec? = null,
) {
    private val zgodovina = mutableListOf<Sporocilo>()
    // Orodja vzporedno (do 3 naenkrat) s predpomnilnikom uspesnih rezultatov v tem pogovoru (22. 11. 2026).
    private val izvajalec = IzvajalecOrodij({ k ->
        when (k.orodje) {
            "iskanje" -> orodja!!.isci(k.vsebina)
            "koledar" -> IzidOrodja.Besedilo(koledar!!.izvedi(k.vsebina))
            else -> orodja!!.beri(k.vsebina)
        }
    })

    private fun obrezi() {
        while (zgodovina.size > najvecSporocil) zgodovina.removeAt(0)
    }

    private fun jeVrsticaOrodja(vrstica: String): Boolean {
        val v = vrstica.trim()
        return v.startsWith("[[") && v.endsWith("]]") && (v.startsWith("[[iskanje:") || v.startsWith("[[beri:") || v.startsWith("[[koledar:") || v.startsWith("[[racunalnik:"))
    }

    /**
     * [priponke]: binarne priponke tega obrata (22. 11. 2026). Gredo k ponudniku samo v tem obratu (in v krogih orodij);
     * po odgovoru ostane v zgodovini samo besedilo, da se velike datoteke ne posiljajo ob vsakem naslednjem vprasanju.
     */
    fun povej(vnos: String, priponke: List<Priponka> = emptyList()): Odgovor {
        if (vnos.isBlank()) {
            return Odgovor.Besedilo("")
        }
        try {
            return povejNotranje(vnos, priponke)
        } finally {
            if (priponke.isNotEmpty()) {
                val i = zgodovina.indexOfFirst { it.priponke.isNotEmpty() }
                if (i >= 0) zgodovina[i] = zgodovina[i].copy(priponke = emptyList())
            }
        }
    }

    private fun povejNotranje(vnos: String, priponke: List<Priponka>): Odgovor {
        // Priklic starejsih sorodnih obratov (ne tistih, ki so ze v zgodovini seje); podatek, ne navodilo. Napaka spomina ne podre pogovora.
        val priklic = runCatching { spomin?.prikliči(vnos, zgodovina.map { it.besedilo }) ?: "" }.getOrDefault("")
        val povezan = runCatching { racunalnikPovezan() }.getOrDefault(false)
        val navodilo = sistemskoNavodilo + SistemskoNavodilo.racunalnik(povezan) + navodiloSpomina(priklic) + (if (priponke.isNotEmpty() || vnos.contains("--- Začetek datoteke")) NAVODILO_PRIPONK else "")

        zgodovina.add(Sporocilo("user", vnos, priponke))
        var dodano = 1
        obrezi()

        var rezultat = odjemalec.poslji(zgodovina, navodilo)

        // Orodja: najvec dva kroga na vprasanje. Rezultat s spleta je nezaupan podatek, ne navodilo.
        var krogi = 0
        while (rezultat is Rezultat.Besedilo && krogi < NAJVEC_KROGOV_ORODIJ) {
            if (orodja == null && koledar == null) break
            val klici = klicOrodijIzBesedila(rezultat.besedilo, orodja?.iskanjeNaVoljo == true, orodja?.branjeNaVoljo == true, koledar != null)
            if (klici.isEmpty()) break
            krogi++
            zgodovina.add(Sporocilo("model", rezultat.besedilo))
            val povratno = povratnoSporociloOrodij(klici, izvajalec.izvedi(klici))
            zgodovina.add(Sporocilo("user", povratno))
            dodano += 2
            obrezi()
            rezultat = odjemalec.poslji(zgodovina, navodilo)
        }

        when (rezultat) {
            is Rezultat.Besedilo -> {
                // Vrstic orodja uporabniku ne pokazemo (tudi, ce jih model po omejitvi krogov ponovi).
                // Naloga za racunalnik: vrstica je ukaz aplikaciji, uporabnik je ne vidi (zato se razcleni iz izvirnega besedila).
                if (povezan) {
                    val nal = rezultat.besedilo.lines().map { it.trim() }
                        .firstOrNull { it.startsWith("[[racunalnik:") && it.endsWith("]]") }
                        ?.let { it.substring(13, it.length - 2).trim() }
                    if (!nal.isNullOrEmpty()) {
                        zgodovina.add(Sporocilo("model", popraviMoskeOblike(rezultat.besedilo.lines().filterNot { jeVrsticaOrodja(it) }.joinToString("\n").trim())))
                        obrezi()
                        return Odgovor.NalogaRacunalniku(nal)
                    }
                }
                // Zenska oblika ze v zgodovini in spominu (23. 11. 2026): model v naslednjem obratu ne bere svojih moskih oblik nazaj.
                val besedilo = popraviMoskeOblike(rezultat.besedilo.lines().filterNot { jeVrsticaOrodja(it) }.joinToString("\n").trim())
                    // Po zadnjem krogu orodij je lahko ostala samo vrstica orodja (navodilo jih zahteva brez besedila).
                    .ifEmpty { BREZ_ODGOVORA }
                zgodovina.add(Sporocilo("model", besedilo))
                obrezi()
                runCatching { spomin?.zapisi(vnos, besedilo) }

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
                repeat(dodano) { if (zgodovina.isNotEmpty()) zgodovina.removeAt(zgodovina.size - 1) } // uporabnik lahko ponovi
                return Odgovor.Napaka(rezultat.sporocilo)
            }
            is Rezultat.Zavrnjeno -> {
                repeat(dodano) { if (zgodovina.isNotEmpty()) zgodovina.removeAt(zgodovina.size - 1) }
                return Odgovor.Napaka("Zavrnjeno: ${rezultat.razlog}")
            }
        }
    }

    companion object {
        private const val NAJVEC_KROGOV_ORODIJ = 2
        const val BREZ_ODGOVORA = "Odgovora zdaj nisem našla. Poskusi vprašati malo drugače."
    }
}
