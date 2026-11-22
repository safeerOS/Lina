package si.safeer.lina.telecom

import si.safeer.lina.audio.CallAudioBridge
import si.safeer.lina.transport.GatewayRuntime

/**
 * Uporabnik prevzame Linin klic (gumb v InCallActivity ali zamenjava zvocne poti na slušalke/Bluetooth).
 * Lastnik 22. 11. 2026: Lina takoj utihne za ta klic, mikrofon telefona se vklopi.
 */
object PrevzemKlica {
    /** Oznaka, mikrofon vklopljen, seja z modelom zaprta (v niti: vticnice in datoteka), zajem ustavljen, racunalnik obvescen. */
    fun ustavi(callId: String) {
        LinaCallGate.markManual(callId)
        // Seja z modelom in prehod sta skupna za proces: ce Lina streze se drugemu klicu, ju ne zapiramo (CodeRabbit 22. 11. 2026),
        // in sklice vzamemo TAKOJ, da poznejsa zamenjava (nov klic) ne zadene napacnega.
        fun drugiLininKlic() = CallRegistry.snapshot().any { it.callId != callId && LinaCallGate.isOwned(it.callId) && !LinaCallGate.isManual(it.callId) }
        val drugiLinin = drugiLininKlic()
        if (!drugiLinin) {
            val gemini = LokalniPrehodUpravljalnik.gemini
            val prehod = LokalniPrehodUpravljalnik.prehod
            Thread {
                // Objekta sta skupna za proces: ce je medtem zacel Linin NOV klic, ju ne zapiramo (ponovni preverek v niti; ostane majhno okno, NEPREVERJENO na napravi).
                if (!drugiLininKlic()) {
                    runCatching { gemini?.konecKlica() }
                    runCatching { prehod?.pocisti() }
                }
            }.start()
        }
        // Mikrofon odutisamo le, ce ni drugega Lininega klica (UtisanMikrofon je skupen).
        if (!drugiLinin) UtisanMikrofon.odutisaj(sila = true)
        CallAudioBridge.onCallEnded(callId)
        GatewayRuntime.notifyCallEnded(callId)
    }
}
