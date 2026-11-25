package si.safeer.lina.asistent

import android.content.Context
import si.safeer.lina.seznanitev.AsistentNaslov
import si.safeer.lina.seznanitev.AsistentQr

/** Seznanitev z Lino na racunalniku: naslov, vrata in odtis (odtis ni skrivnost, dokaze pa, s kom govorimo). */
object AsistentShramba {
    private const val PREFS = "lina_asistent"

    fun beri(context: Context): AsistentNaslov? {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val naslov = p.getString("naslov", null) ?: return null
        val odtis = p.getString("odtis", null) ?: return null
        val vrata = p.getInt("vrata", 0)
        // Ponovna preverba: shranjeno mora se vedno ustrezati pravilom QR.
        return AsistentQr.naslov(naslov, vrata, odtis)
    }

    fun shrani(context: Context, a: AsistentNaslov): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("naslov", a.naslov).putInt("vrata", a.vrata).putString("odtis", a.odtis).commit()

    /**
     * Global Link (naloga 22): id Line na releju, ki ga je racunalnik poslal v podpisanem /stanje prek pripete povezave. Shranjen
     * samo veljaven id; ko ga racunalnik ne poslje vec (Global Link izklopljen), ga telefon pozabi in rele ne poskusa.
     */
    fun rele(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("rele", null)?.takeIf { si.safeer.lina.podpis.ReleProtokol.jeIdReleja(it) }

    fun shraniRele(context: Context, id: String?) {
        val e = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        if (id != null && si.safeer.lina.podpis.ReleProtokol.jeIdReleja(id)) e.putString("rele", id) else e.remove("rele")
        e.apply()
    }

    /**
     * Pozabi samo seznanitev z racunalnikom. Datoteka »lina_asistent« hrani tudi tajnopise kljucev (Gemini, Brave, TinyFish,
     * Twilio, Google), zato NIKOLI clear(): 19. 11. 2026 je gumb »Pozabi racunalnik« zbrisal vse vnesene kljuce.
     */
    fun pozabi(context: Context): Boolean {
        // T3 (pregled 0213): shranjena naloga je bila potrjena za TA racunalnik - po »Pozabi« je ne posljemo nikomur (datoteka hrani samo njo)
        context.getSharedPreferences(CAKAJOCA, Context.MODE_PRIVATE).edit().clear().commit()
        // T13 (pregled 0213): kanali releja, ki ze tecejo, se zaprejo takoj (ne sele ob naslednji povezavi)
        PovezavaLine.zapriRele()
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("naslov").remove("vrata").remove("odtis").remove("rele").commit()
    }

    /** Ena shranjena naloga za pozneje (besedilo, odtis racunalnika, cas shranjevanja); AsistentKontroler.shraniZaPozneje. */
    const val CAKAJOCA = "lina_cakajoca_naloga"
}
