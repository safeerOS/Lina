package si.safeer.lina.samostojna

import java.time.ZonedDateTime
import java.time.format.DateTimeParseException

sealed class Odgovor {
    class Besedilo(val besedilo: String) : Odgovor()
    class Zapisek(val besedilo: String) : Odgovor()
    class Opomnik(val besedilo: String, val cas: String) : Odgovor()
    /** Nov dogodek v koledarju telefona: zapise ga aplikacija po uporabnikovi potrditvi, ne model. */
    class NoviDogodek(val naslov: String, val zacetekMs: Long, val konecMs: Long) : Odgovor()
    /** Budilka v aplikaciji Ura: nastavi jo aplikacija po uporabnikovi potrditvi. dnevi: ISO 1 = ponedeljek ... 7 = nedelja; prazno = enkratna. */
    class NovaBudilka(val ura: Int, val minuta: Int, val oznaka: String, val dnevi: List<Int>) : Odgovor()
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
    // Trajna zgodovina seje (lastnik 23. 11. 2026: Lina je pozabljala pogovor ob ponovnem zagonu, novem dnevu in menjavi ponudnika).
    private val seja: ZgodovinaSeje? = null,
    // Vidni zapiski Line, najnovejsi prvi (23. 11. 2026: Lina jih bere sama in jih priloze nalogam za racunalnik).
    private val zapiski: () -> List<String> = { emptyList() },
    private val zdaj: () -> ZonedDateTime = { ZonedDateTime.now() },
) {
    private val zgodovina = mutableListOf<Sporocilo>()
    /** Povzetek pogovora iz prejsnjih dni (iz [seja]); danasnji obrati so ze v [zgodovina]. */
    private val povzetek: String

    init {
        val o = runCatching { seja?.obnovi(zdaj().toLocalDate(), zdaj().zone) }.getOrNull()
        if (o != null) zgodovina.addAll(o.danes.takeLast(najvecSporocil).dropWhile { it.vloga != "user" })
        povzetek = o?.povzetek ?: ""
    }

    /** Zapiski s skrivnostjo (kljuc, geslo) ne gredo ne modelu ne v nalogo za racunalnik. */
    private fun zapiskiZdaj(): List<String> = runCatching { zapiski() }.getOrDefault(emptyList()).filterNot { SpominPogovorov.jeSkrivnost(it) }

    /** Uspesna izmenjava gre v trajno zgodovino (skrivnosti ne). */
    private fun zapomni(vnos: String, odgovor: String) {
        runCatching { seja?.dodaj(vnos, odgovor, zdaj().toInstant().toEpochMilli()) }
    }
    /** Zadnja naloga, predana racunalniku v tem pogovoru: vprasanje o nalogi jo razlozi in ne poslje nove (lastnik 23. 11. 2026). */
    private var zadnjaNaloga: String? = null

    /** Klice aplikacija, ko je racunalnik nalogo res sprejel (zavrnjena naloga ne sme postati »zadnja«). */
    fun nalogaPredana(besedilo: String) { zadnjaNaloga = besedilo }
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
        val povezan = runCatching { racunalnikPovezan() }.getOrDefault(false)
        // Priprava naloge za racunalnik: vecji priklic (lastnik 23. 11. 2026), da Lina sama najde nacrt in povezave iz prejsnjih dni.
        val zaNalogo = povezan && NAMEN_NALOGE.containsMatchIn(vnos)
        val priklic = runCatching {
            spomin?.let { if (zaNalogo) it.prikliči(vnos, zgodovina.map { z -> z.besedilo }, VECJI_PRIKLIC, ZNAKOV_VECJEGA_PRIKLICA) else it.prikliči(vnos, zgodovina.map { z -> z.besedilo }) } ?: ""
        }.getOrDefault("")
        val navodilo = sistemskoNavodilo + SistemskoNavodilo.racunalnik(povezan) + navodiloPovzetkaSeje(povzetek) + navodiloZapiskov(zapiskiZdaj()) +
            navodiloSpomina(priklic) + (if (priponke.isNotEmpty() || vnos.contains("--- Začetek datoteke")) NAVODILO_PRIPONK else "")

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
                        val prejsnja = zadnjaNaloga
                        if (prejsnja != null && jeVprasanjeONalogi(vnos)) {
                            // Model je namesto razlage izmislil novo nalogo: novih nalog ne pošiljamo, razložimo zadnjo.
                            val razlaga = "Računalniku sem predala nalogo: »$prejsnja«. Potek in odobritve so v zavihku Računalnik."
                            zgodovina.add(Sporocilo("model", razlaga))
                            obrezi()
                            zapomni(vnos, razlaga)
                            return Odgovor.Besedilo(razlaga)
                        }
                        // Samostojna naloga (23. 11. 2026): koda priloze nacrt, povezave, zapiske in omejitve; sklic brez vsebine = vprasaj lastnika.
                        when (val p = SamostojnaNaloga.pripravi(nal, zgodovina.toList(), zapiskiZdaj())) {
                            is SamostojnaNaloga.Izid.Manjka -> {
                                zgodovina.add(Sporocilo("model", p.vprasanje))
                                obrezi()
                                zapomni(vnos, p.vprasanje)
                                return Odgovor.Besedilo(p.vprasanje)
                            }
                            is SamostojnaNaloga.Izid.Pripravljena -> {
                                val besedilo = popraviMoskeOblike(rezultat.besedilo.lines().filterNot { jeVrsticaOrodja(it) }.joinToString("\n").trim())
                                zgodovina.add(Sporocilo("model", besedilo))
                                obrezi()
                                zapomni(vnos, besedilo.ifEmpty { "Računalniku sem predala nalogo." } + "\n[naloga za računalnik: ${p.besedilo.take(300)}]")
                                return Odgovor.NalogaRacunalniku(p.besedilo)
                            }
                        }
                    }
                }
                // Zenska oblika ze v zgodovini in spominu (23. 11. 2026): model v naslednjem obratu ne bere svojih moskih oblik nazaj.
                val izModela = popraviMoskeOblike(rezultat.besedilo.lines().filterNot { jeVrsticaOrodja(it) }.joinToString("\n").trim())
                // Po zadnjem krogu orodij je lahko ostala samo vrstica orodja (navodilo jih zahteva brez besedila); nadomestni stavek ne gre v spomin.
                val besedilo = izModela.ifEmpty { BREZ_ODGOVORA }
                zgodovina.add(Sporocilo("model", besedilo))
                obrezi()
                if (izModela.isNotEmpty()) { runCatching { spomin?.zapisi(vnos, besedilo) }; zapomni(vnos, besedilo) }

                val vrstice = besedilo.lines()
                for (vrstica in vrstice) {
                    val obrezana = vrstica.trim()
                    if (obrezana.startsWith("[[zapisek:") && obrezana.endsWith("]]")) {
                        val vsebina = obrezana.substring(10, obrezana.length - 2).trim()
                        if (vsebina.isNotEmpty()) {
                            return Odgovor.Zapisek(vsebina)
                        }
                    } else if (obrezana.startsWith("[[budilka:") && obrezana.endsWith("]]")) {
                        BudilkaZapis.razclenji(obrezana.substring(10, obrezana.length - 2))?.let { return it }
                    } else if (obrezana.startsWith("[[dogodek:") && obrezana.endsWith("]]")) {
                        DogodekKoledarZapis.razclenji(obrezana.substring(10, obrezana.length - 2), System.currentTimeMillis())?.let { return it }
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

    /**
     * Lina sama odgovori Claude Code (23. 11. 2026): en klic modela brez orodij, z zgodovino seje in zapiski; vprasanje Claude Code je
     * podatek. Varovala (brisanje, push, sudo, odobritev, [[...]]) preveri koda - model ne more podpisati nicesar, kar jih zadene.
     */
    fun odgovorZaClaudeCode(naloga: String, vprasanje: String, izid: Boolean = false): SamodejniOdgovor.Odlocitev {
        val kontekst = zgodovina.toList().let { if (it.lastOrNull()?.vloga == "user") it.dropLast(1) else it }.takeLast(20)
        val priklic = runCatching {
            spomin?.prikliči("$naloga\n$vprasanje", kontekst.map { it.besedilo }, VECJI_PRIKLIC, ZNAKOV_VECJEGA_PRIKLICA) ?: ""
        }.getOrDefault("")
        val navodilo = sistemskoNavodilo + navodiloPovzetkaSeje(povzetek) + navodiloZapiskov(zapiskiZdaj()) + navodiloSpomina(priklic) +
            (if (izid) SamodejniOdgovor.NAVODILO_IZID else SamodejniOdgovor.NAVODILO)
        val r = try { odjemalec.poslji(kontekst + Sporocilo("user", SamodejniOdgovor.poziv(naloga, vprasanje, izid)), navodilo) }
            catch (e: Exception) { Rezultat.Napaka(null, e.javaClass.simpleName) }
        return when (r) {
            is Rezultat.Besedilo -> SamodejniOdgovor.izModela(popraviMoskeOblike(r.besedilo))
            is Rezultat.Napaka -> SamodejniOdgovor.Odlocitev.VprasajLastnika("Lina ni mogla vprašati modela (${r.sporocilo.take(80)}).")
            is Rezultat.Zavrnjeno -> SamodejniOdgovor.Odlocitev.VprasajLastnika("Model je zavrnil odgovor.")
        }
    }

    companion object {
        private const val NAJVEC_KROGOV_ORODIJ = 2
        /** Vecji priklic za nalogo racunalniku in odgovor Claude Code (navadni: SpominPogovorov.NAJVEC_PRIKLICANIH po 300 znakov). */
        const val VECJI_PRIKLIC = 15
        const val ZNAKOV_VECJEGA_PRIKLICA = 800
        private val NAMEN_NALOGE = Regex("claude|ra[čc]unalnik|nalog", RegexOption.IGNORE_CASE)
        const val BREZ_ODGOVORA = "Odgovora zdaj nisem našla. Poskusi vprašati malo drugače."
    }
}

/** Uporabnik sprašuje o nalogi (ne daje nove): »kakšna je naloga«, »opiši nalogo, ki si jo dala računalniku«. */
internal fun jeVprasanjeONalogi(vnos: String): Boolean {
    val v = vnos.lowercase()
    if (!v.contains("nalog")) return false
    // Izrecna zahteva za novo nalogo ni vprasanje o prejsnji (CodeRabbit): »lahko predaš novo nalogo?«.
    if (Regex("(nov[aeoi]?|drug[aeo]|še eno|se eno|ponovi)\\s+nalog").containsMatchIn(v) || Regex("^\\s*(predaj|pošlji|poslji|daj|naredi|ustvari)").containsMatchIn(v) ||
        Regex("(lahko|bi)\\s+(predaš|predas|pošlješ|posljes|daš|das)").containsMatchIn(v)) return false
    return v.contains("?") || listOf("razlož", "razloz", "opiš", "opis", "kakšn", "kaksn", "katero", "kaj si", "povej").any { v.contains(it) }
}
