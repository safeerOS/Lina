package si.safeer.lina.podpis

/**
 * Naloga 23t (lastnik 26. 11. 2026): Lina na racunalniku ob prvi nalogi odpre sejo Claude Code in vrne 503 claude-code-ni s
 * stanje.zagon = "odpira" (asistent-streznik.server.ts naloga). Kanal zavrne podpis, starejsi od svojega zagona, zato telefon
 * potrjeno nalogo obdrzi, poizveduje podpisan GET /stanje in jo, ko je seja odprta, poslje ENKRAT znova z novim podpisom
 * (nov cas in enkratni niz). Lastniku je ne potrdi znova (naloga je ze potrjena). Ista pot (IzbirnaPovezava) za LAN in Global Link.
 */
object CakanjeSeje {
    const val ODPIRA = "odpira"
    /** RazlogSeje (seja-claude.server.ts) in "odpira"; drugih vrednosti telefon ne sprejme. */
    val RAZLOGI = setOf(ODPIRA, "ni-terminala", "ni-claude", "izklopljeno", "opozorilo", "omejitev", "napaka")
    const val RAZMIK_MS = 3_000L
    /** Kot ROK_ODPIRANJA_MS na racunalniku (3 min). */
    const val ROK_MS = 3 * 60_000L

    /** Caka samo 503 claude-code-ni z zagon == "odpira"; vsak drug razlog gre takoj v sporocilo. */
    fun cakaj(o: OdgovorLine): Boolean = o is OdgovorLine.Napaka && o.status == 503 && o.koda == "claude-code-ni" && o.zagon == ODPIRA

    sealed class Izid {
        /** Seja je odprta in naloga je bila poslana enkrat znova; [odgovor] je odgovor racunalnika (drugega kroga ni). */
        data class Oddana(val naloga: PodpisanaNaloga, val odgovor: OdgovorLine) : Izid()
        /** Rok brez odprte seje ali koncni razlog v odgovoru /stanje ([razlog]; danasnja Lina ga v /stanje ne poslje). */
        data class Rok(val razlog: String?) : Izid()
        object Preklicano : Izid()
        object BrezPodpisa : Izid()
    }

    /**
     * [preklicano] vkljuci vse, zaradi cesar stara naloga ne sme vec oditi: lastnik je preklical ali dal drugo nalogo, zaslon je
     * zaprt, racunalnik ni vec isti (CakajocaNaloga.smePoslati). Preveri se pred vsako poizvedbo in tik pred oddajo.
     */
    data class Odvisnosti(
        val pov: PovezavaZLino,
        val posiljatelj: String,
        val podpisiStanje: (cas: Long, enkratni: String) -> String?,
        val podpisiNalogo: (cas: Long, enkratni: String) -> PodpisanaNaloga?,
        val nakljucno: () -> String,
        val zdaj: () -> Long,
        val spi: (Long) -> Unit,
        val preklicano: () -> Boolean,
        /** Zacetek cakanja (obnova po zasuku: rok tece od prvega zacetka); null = zdaj. */
        val zacetek: Long? = null,
        /** Tik pred POST ponovne oddaje (kontroler zapise trajno oznako: preklic ali obnova vesta, da je bila oddaja morda na poti). */
        val predOddajo: () -> Unit = {},
    )

    /** Racunalnik ima nalogo: 202 ali 409 »obstaja« (isti id je ze sprejel, npr. po zasuku zaslona med oddajo). */
    fun sprejeta(o: OdgovorLine): Boolean = o is OdgovorLine.Ok || (o is OdgovorLine.Napaka && o.status == 409 && o.koda == "obstaja")

    /**
     * Preklic (Ustavi, nova naloga) je prisel, ko je bila oddaja ze na poti: id naloge, ki jo racunalnik ima ali jo je morda prejel
     * (izid neznan) - telefon jo ustavi s podpisanim /ustavi. null = nic ni bilo oddano ali racunalnik je ni sprejel.
     */
    fun ustaviPoPreklicu(izid: Izid): String? =
        (izid as? Izid.Oddana)?.takeIf { sprejeta(it.odgovor) || IzidOddaje.jeNeznan(it.odgovor) }?.naloga?.id

    /**
     * Naloga 24 (CR3, CR6): zaslon, ki je oddajo zacel, je zaprt (njegov izid se ne obdela), lastnik pa je to nalogo medtem preklical
     * (trajna oznaka preklica [preklicanId], tudi z novega zaslona). /ustavi preklica je lahko prisel pred sprejemom zadrzane oddaje
     * (404), zato jo po odgovoru ustavi nit oddaje sama. null = ni preklica te naloge ali racunalnik je ni sprejel.
     */
    fun ustaviPoZaprtju(izid: Izid, preklicanId: String?): String? = ustaviPoPreklicu(izid)?.takeIf { it == preklicanId }

    /** Blokira (najvec ROK_MS + en razmik + cas zahtev, do ~35 s na pot); klici samo v ozadju. */
    fun pocakajInOddaj(o: Odvisnosti): Izid {
        val konec = (o.zacetek ?: o.zdaj()) + ROK_MS
        while (true) {
            if (o.preklicano()) return Izid.Preklicano
            if (o.zdaj() >= konec) return Izid.Rok(null)
            o.spi(RAZMIK_MS)
            if (o.preklicano()) return Izid.Preklicano
            val cas = o.zdaj()
            val enkratni = o.nakljucno()
            val podpis = o.podpisiStanje(cas, enkratni)
            val odg = if (podpis == null) OdgovorLine.Nedosegljiva else o.pov.stanjeSeje(o.posiljatelj, cas, enkratni, podpis)
            // nedosegljiv ali napaka med cakanjem: poskusi znova do roka
            if (odg !is OdgovorLine.Ok) continue
            if (AsistentProtokol.razberiSejo(odg.telo) == true) {
                if (o.preklicano()) return Izid.Preklicano
                // naloga 24 CR5: spanje ali pocasen /stanje je rok lahko ze prestopil - po roku naloga ne odide
                if (o.zdaj() >= konec) return Izid.Rok(null)
                val n = o.podpisiNalogo(o.zdaj(), o.nakljucno()) ?: return Izid.BrezPodpisa
                // naloga 24 CR6: preklic med podpisom - zastarela naloga ne odide in oznaka oddaje se ne zapise
                if (o.preklicano()) return Izid.Preklicano
                o.predOddajo()
                return Izid.Oddana(n, o.pov.naloga(AsistentProtokol.teloNaloge(n)))
            }
            AsistentProtokol.razberiZagon(odg.telo)?.takeIf { it != ODPIRA }?.let { return Izid.Rok(it) }
        }
    }
}
