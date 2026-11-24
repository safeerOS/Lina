package si.safeer.lina.samostojna

/**
 * Lina kot cilj »Deli« (lastnik 24. 11. 2026: »fotografiram s svojim programom za fotografiranje in pošljem Lini za analizo«).
 * Galerija ali fotoaparat -> Deli -> Lina: datoteke gredo med priponke, vprasanje napise lastnik in sam tapne Poslji.
 * Tu je samo odlocitev (brez Androida), branje in preverba vsebine po bajtih ostaneta v isti poti kot izbira priponk.
 */
const val AKCIJA_DELI = "android.intent.action.SEND"
const val AKCIJA_DELI_VEC = "android.intent.action.SEND_MULTIPLE"

enum class ZavrnitevDeljenja { IZKLOPLJENO, NEPODPRTA_VRSTA, PRAZNO }

sealed class OdlocitevDeljenja {
    /** Ni deljenje: aktivnost obdela namen po starem. */
    object NiDeljenje : OdlocitevDeljenja()

    /**
     * Sprejmi: [indeksi] so mesta URI-jev (v vrstnem redu namena), ki jih preberemo; [cezMejo] jih je preskocenih zaradi meje
     * priponk, [nedovoljeni] zaradi naslova; [besedilo] gre v polje za vnos (nikoli se ne poslje samo).
     */
    data class Sprejmi(val indeksi: List<Int>, val cezMejo: Int, val nedovoljeni: Int, val besedilo: String?) : OdlocitevDeljenja()

    data class Zavrni(val razlog: ZavrnitevDeljenja) : OdlocitevDeljenja()
}

/** Vrste, ki jih Lina sprejme iz drugih aplikacij (enako kot filter v AndroidManifest.xml). */
fun sprejemljivaVrstaDeljenja(mime: String?): Boolean {
    val m = mime?.lowercase()?.substringBefore(';')?.trim() ?: return false
    return (m.startsWith("image/") && m.length > "image/".length) || m == "application/pdf" || m == "text/plain"
}

/**
 * Sistemski ponudniki, do katerih ima Lina dovoljenje (imenik, koledar) ali ki hranijo zasebne podatke: tuja aplikacija bi
 * z namenom SEND, ki kaze nanje, Lino pripravila do branja podatkov, ki jih sama ne sme brati.
 */
private val ZAPRTE_AVTORITETE = setOf(
    "com.android.contacts", "contacts", "com.android.calendar", "calendar", "call_log", "sms", "mms", "mms-sms", "telephony",
    "icc", "voicemail", "settings", "user_dictionary",
)

/**
 * Samo naslovi content:// tujih ponudnikov: file:// bi lahko kazal na Linine zasebne datoteke (tuja aplikacija bi jih tako
 * poslala modelu), lasten ponudnik posnetkov in sistemski ponudniki zasebnih podatkov pa niso vir za deljenje.
 */
fun dovoljenNaslovDeljenja(shema: String?, avtoriteta: String?, lastneAvtoritete: Set<String>): Boolean {
    if (!shema.equals("content", ignoreCase = true) || avtoriteta.isNullOrBlank()) return false
    // Avtoriteta lahko nosi uporabnika (»10@com.android.contacts«) - primerjamo brez njega.
    val a = avtoriteta.lowercase().substringAfterLast('@')
    return a !in ZAPRTE_AVTORITETE && a !in lastneAvtoritete.map { it.lowercase() }
}

/**
 * Odlocitev o deljenju. [naslovi] so (shema, avtoriteta) vsakega URI-ja iz namena, [zePriponk] stevilo ze izbranih priponk.
 * Zavrnjeno, ce je stikalo izklopljeno, vrsta ni podprta ali ni nicesar za sprejeti.
 */
fun odlociDeljenje(
    akcija: String?,
    mime: String?,
    naslovi: List<Pair<String?, String?>>,
    besedilo: String?,
    vklopljeno: Boolean,
    zePriponk: Int,
    lastneAvtoritete: Set<String>,
): OdlocitevDeljenja {
    if (akcija != AKCIJA_DELI && akcija != AKCIJA_DELI_VEC) return OdlocitevDeljenja.NiDeljenje
    if (!vklopljeno) return OdlocitevDeljenja.Zavrni(ZavrnitevDeljenja.IZKLOPLJENO)
    if (!sprejemljivaVrstaDeljenja(mime)) return OdlocitevDeljenja.Zavrni(ZavrnitevDeljenja.NEPODPRTA_VRSTA)
    val dovoljeni = naslovi.indices.filter { dovoljenNaslovDeljenja(naslovi[it].first, naslovi[it].second, lastneAvtoritete) }
    val prostor = (NAJVEC_PRIPONK - zePriponk).coerceAtLeast(0)
    val indeksi = dovoljeni.take(prostor)
    val cisto = besedilo?.replace(Regex("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]"), "")?.trim()?.take(NAJVEC_ZNAKOV_DELJENEGA_BESEDILA)?.ifEmpty { null }
    if (naslovi.isEmpty() && cisto == null) return OdlocitevDeljenja.Zavrni(ZavrnitevDeljenja.PRAZNO)
    return OdlocitevDeljenja.Sprejmi(indeksi, dovoljeni.size - indeksi.size, naslovi.size - dovoljeni.size, cisto)
}

/** Deljeno besedilo (npr. povezava) gre v polje za vnos; daljse besedilo naj pride kot datoteka. */
const val NAJVEC_ZNAKOV_DELJENEGA_BESEDILA = 4_000
