package si.safeer.lina.asistent

import android.content.Context
import si.safeer.lina.samostojna.Racunalnik
import si.safeer.lina.samostojna.Racunalniki
import si.safeer.lina.samostojna.SeznamRacunalnikov
import si.safeer.lina.seznanitev.AsistentNaslov
import si.safeer.lina.seznanitev.AsistentQr

/**
 * Seznanitve z Lino na racunalnikih: naslov, vrata in odtis (odtis ni skrivnost, dokaze pa, s kom govorimo).
 * Naloga 34: telefon hrani VEC racunalnikov (seznam v kljucu »racunalniki«, pravila v modulu samostojna: Racunalniki); [beri] vrne
 * izbranega, zato klicatelji (zavihki, sinhronizacija, naloga) delajo kot prej. Stari kljuci naslov/vrata/odtis/rele so zrcalo
 * izbranega: iz njih se ob prvem branju naredi seznam (prehod, pravilo naloge 28) in starejsa razlicica po vrnitvi se vedno dela.
 */
object AsistentShramba {
    private const val PREFS = "lina_asistent"
    private const val SEZNAM = "racunalniki"

    /** Pravila QR za vsak shranjen racunalnik (zasebni naslov, vrata, odtis); neveljaven id releja se zavrze loceno (clan ostane). */
    private val veljaven: (Racunalnik) -> Boolean = { r -> AsistentQr.naslov(r.naslov, r.vrata, r.odtis) != null }
    private val veljavenRele: (String) -> Boolean = { si.safeer.lina.podpis.ReleProtokol.jeIdReleja(it) }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Seznam (z enkratnim prehodom iz ene stare seznanitve); nikoli ne zbrise kljucev drugih vrednosti v datoteki. */
    @Synchronized
    fun seznam(context: Context): SeznamRacunalnikov {
        val p = prefs(context)
        Racunalniki.izJson(p.getString(SEZNAM, null), veljaven, veljavenRele)?.let { return it }
        val s = Racunalniki.prehod(null, p.getString("naslov", null), p.getInt("vrata", 0), p.getString("odtis", null), p.getString("rele", null), veljaven, veljavenRele)
        if (s.racunalniki.isNotEmpty() && zapisi(context, s)) SinhronizacijaZLino.prenesiRevizijo(context, s.racunalniki[0].odtis)
        return s
    }

    /** commit (ne apply): smrt procesa po seznanitvi ne sme izgubiti racunalnika. Zrcalo izbranega v starih kljucih. */
    @Synchronized
    private fun zapisi(context: Context, s: SeznamRacunalnikov): Boolean {
        val e = prefs(context).edit().putString(SEZNAM, Racunalniki.vJson(s))
        val i = s.izbrani()
        if (i == null) e.remove("naslov").remove("vrata").remove("odtis").remove("rele")
        else {
            e.putString("naslov", i.naslov).putInt("vrata", i.vrata).putString("odtis", i.odtis)
            if (i.rele != null) e.putString("rele", i.rele) else e.remove("rele")
        }
        return e.commit()
    }

    @Synchronized
    private fun spremeni(context: Context, f: (SeznamRacunalnikov) -> SeznamRacunalnikov?): Boolean {
        val n = f(seznam(context)) ?: return false
        return zapisi(context, n)
    }

    fun izbrani(context: Context): Racunalnik? = seznam(context).izbrani()

    fun beri(context: Context): AsistentNaslov? {
        val r = izbrani(context) ?: return null
        // Ponovna preverba: shranjeno mora se vedno ustrezati pravilom QR.
        return AsistentQr.naslov(r.naslov, r.vrata, r.odtis)
    }

    /** Nova seznanitev: doda racunalnik (ali posodobi naslov istega odtisa) in ga izbere; drugih NE prepise (naloga 34). */
    fun shrani(context: Context, a: AsistentNaslov, ime: String? = null): Boolean = spremeni(context) { Racunalniki.dodaj(it, a.odtis, a.naslov, a.vrata, ime) }

    fun izberi(context: Context, odtis: String): Boolean = spremeni(context) { Racunalniki.izberi(it, odtis) }
    fun preimenuj(context: Context, odtis: String, ime: String): Boolean = spremeni(context) { Racunalniki.preimenuj(it, odtis, ime) }
    fun prepovej(context: Context, odtis: String, prepovedan: Boolean): Boolean = spremeni(context) { Racunalniki.prepovej(it, odtis, prepovedan) }
    fun samodejno(context: Context, da: Boolean): Boolean = spremeni(context) { it.copy(samodejno = da) }

    /**
     * Global Link (naloga 22): id Line na releju izbranega racunalnika, ki ga je TA racunalnik poslal v podpisanem /stanje prek pripete
     * povezave. Shranjen samo veljaven id; ko ga racunalnik ne poslje vec (Global Link izklopljen), ga telefon pozabi in rele ne poskusa.
     */
    fun rele(context: Context): String? = izbrani(context)?.rele?.takeIf { si.safeer.lina.podpis.ReleProtokol.jeIdReleja(it) }

    /** Naloga 34: rele se zapise racunalniku, cigar povezava je odgovorila ([odtis]), ne izbranemu po morebitni zamenjavi. */
    fun shraniRele(context: Context, odtis: String, id: String?) {
        val nov = id?.takeIf { si.safeer.lina.podpis.ReleProtokol.jeIdReleja(it) }
        var star: String? = null
        val spremenjen = synchronized(this) {
            star = seznam(context).po(odtis)?.rele
            star != nov && spremeni(context) { Racunalniki.nastaviRele(it, odtis, nov) }
        }
        // Global Link izklopljen ali drug id: lokalna vrata releja TEGA racunalnika se zaprejo (pregled 4)
        if (spremenjen) star?.let { PovezavaLine.zapriRele(odtis, it) }
    }

    /** Odstrani en racunalnik s seznama (ostali ostanejo); njegova vrata releja se zaprejo. Izbrani = pozabi (kot gumb Pozabi). */
    fun odstrani(context: Context, odtis: String): Boolean {
        if (seznam(context).izbrani()?.odtis == odtis) return pozabi(context)
        val r = synchronized(this) { seznam(context).po(odtis)?.also { if (!zapisi(context, Racunalniki.odstrani(seznam(context), odtis))) return false } } ?: return false
        r.rele?.let { PovezavaLine.zapriRele(odtis, it) }
        return true
    }

    /**
     * Pozabi IZBRANI racunalnik (naloga 34: drugi ostanejo). Datoteka »lina_asistent« hrani tudi tajnopise kljucev (Gemini, Brave,
     * TinyFish, Twilio, Google), zato NIKOLI clear(): 19. 11. 2026 je gumb »Pozabi racunalnik« zbrisal vse vnesene kljuce.
     */
    fun pozabi(context: Context): Boolean {
        // T3 (pregled 0213): shranjena naloga je bila potrjena za TA racunalnik - po »Pozabi« je ne posljemo nikomur (datoteka hrani samo njo)
        // naloga 26t: pod istim zaklepom kot prehodi naloge (nit oddaje ne sme po brisanju zapisati stare naloge nazaj)
        synchronized(si.safeer.lina.samostojna.NalogaRacunalnika.ZAKLEP) { context.getSharedPreferences(CAKAJOCA, Context.MODE_PRIVATE).edit().clear().commit() }
        // branje in zapis v enem zaklepu (slepi pregled 34: socasna meritev ne vrne pozabljenega in ne izgubi novega)
        val (izbran, ok) = synchronized(this) {
            val s = seznam(context)
            val i = s.izbrani() ?: return prefs(context).edit().remove("naslov").remove("vrata").remove("odtis").remove("rele").commit()
            i to zapisi(context, Racunalniki.odstrani(s, i.odtis))
        }
        // T13 (pregled 0213): kanali releja, ki ze tecejo, se zaprejo takoj (ne sele ob naslednji povezavi)
        izbran.rele?.let { PovezavaLine.zapriRele(izbran.odtis, it) }
        return ok
    }

    /** Ena shranjena naloga za pozneje (besedilo, odtis racunalnika, cas shranjevanja); AsistentKontroler.shraniZaPozneje. */
    const val CAKAJOCA = "lina_cakajoca_naloga"
}
