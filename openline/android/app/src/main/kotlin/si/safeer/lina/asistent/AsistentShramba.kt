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
        return AsistentQr.razberi("safeer-lina://asistent?v=1&naslov=$naslov&vrata=$vrata&odtis=$odtis")
    }

    fun shrani(context: Context, a: AsistentNaslov): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("naslov", a.naslov).putInt("vrata", a.vrata).putString("odtis", a.odtis).commit()

    fun pozabi(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().commit()
}
