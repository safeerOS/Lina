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
     * Pozabi samo seznanitev z racunalnikom. Datoteka »lina_asistent« hrani tudi tajnopise kljucev (Gemini, Brave, TinyFish,
     * Twilio, Google), zato NIKOLI clear(): 19. 11. 2026 je gumb »Pozabi racunalnik« zbrisal vse vnesene kljuce.
     */
    fun pozabi(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("naslov").remove("vrata").remove("odtis").commit()
}
