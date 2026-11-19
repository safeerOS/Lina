package si.safeer.lina.samostojna.n8n

import si.safeer.lina.samostojna.Prenos
import si.safeer.lina.samostojna.Rezultat
import si.safeer.lina.samostojna.posljiZPonovitvami
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.URI

class N8nOdjemalec(
    private val prenos: Prenos,
    private val nastavitve: N8nNastavitve
) {
    var spanje: (Long) -> Unit = { Thread.sleep(it) }

    fun sprozi(ime: String, podatki: Map<String, String>, soglasjePotrjeno: Boolean): IzidN8n {
        if (!soglasjePotrjeno) {
            return IzidN8n.Napaka("Klic ni dovoljen, ker soglasje ni potrjeno.")
        }

        val uri = try {
            URI.create(nastavitve.naslovWebhooka)
        } catch (e: Exception) {
            return IzidN8n.Napaka("Neveljaven naslov.")
        }

        val shema = uri.scheme?.lowercase() ?: ""
        val host = uri.host ?: ""
        
        if (shema != "https") {
            if (shema == "http") {
                val isLocal = jeLokalen(host)
                if (!isLocal) {
                    return IzidN8n.Napaka("Naslov HTTP je dovoljen samo v domačem omrežju. Za internet uporabite HTTPS.")
                }
            } else {
                return IzidN8n.Napaka("Naslov mora uporabljati HTTPS ali HTTP v domačem omrežju.")
            }
        }

        val teloJson = buildJsonObject {
            put("ime", ime)
            put("podatki", buildJsonObject {
                for ((k, v) in podatki) put(k, v)
            })
        }.toString()

        val glave = mutableMapOf("Content-Type" to "application/json")
        if (!nastavitve.skrivnost.isNullOrEmpty()) {
            glave["Authorization"] = "Bearer ${nastavitve.skrivnost}"
        }

        val rez = posljiZPonovitvami(
            prenos = prenos,
            url = nastavitve.naslovWebhooka,
            glave = glave,
            telo = teloJson,
            spanje = spanje,
            razberi = { telo -> Rezultat.Besedilo(telo) },
            // Webhook lahko sprozi dejanje, ki ni idempotentno (poslano sporocilo, rezervacija): brez samodejne ponovitve.
            najvecPoskusov = 1
        )

        return when (rez) {
            is Rezultat.Besedilo -> IzidN8n.Uspeh(rez.besedilo.take(100))
            is Rezultat.Zavrnjeno -> IzidN8n.Napaka(maskiraj(rez.razlog))
            is Rezultat.Napaka -> {
                val razlog = when {
                    rez.koda == 401 || rez.koda == 403 || rez.sporocilo.contains("401") || rez.sporocilo.contains("403") -> 
                        "Povezava zavrnjena (napačno geslo ali ključ)."
                    rez.koda == 404 || rez.sporocilo.contains("404") ->
                        "Storitev ne obstaja na tem naslovu."
                    rez.sporocilo.contains("Brez povezave") ->
                        "Povezava s storitvijo ni uspela. Preverite omrežje in naslov."
                    rez.sporocilo.contains("Odgovor prevelik") ->
                        "Odgovor storitve je prevelik."
                    else -> 
                        "Napaka pri povezavi s storitvijo."
                }
                IzidN8n.Napaka(maskiraj(razlog))
            }
        }
    }

    /** Domace omrezje: natancen IPv4 naslov iz zasebnih obmocij, localhost ali ime .local (ne sme biti le predpona imena). */
    private fun jeLokalen(host: String): Boolean {
        if (host == "localhost" || host.endsWith(".local")) return true
        val deli = host.split(".")
        if (deli.size != 4) return false
        val o = deli.map { d -> d.toIntOrNull()?.takeIf { it in 0..255 && d == it.toString() } ?: return false }
        return o[0] == 127 || o[0] == 10 || (o[0] == 192 && o[1] == 168) || (o[0] == 172 && o[1] in 16..31)
    }

    private fun maskiraj(besedilo: String): String {
        val skrivnost = nastavitve.skrivnost
        if (skrivnost.isNullOrEmpty()) return besedilo
        return besedilo.replace(skrivnost, "***")
    }
}
