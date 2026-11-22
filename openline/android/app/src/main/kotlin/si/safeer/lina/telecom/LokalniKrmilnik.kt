package si.safeer.lina.telecom

import android.content.Context
import android.telecom.Call
import android.util.Log
import si.safeer.lina.protocol.CommandAction
import si.safeer.lina.protocol.GatewayCommand

class LokalniKrmilnik(private val context: Context) : CallEventSink {
    override fun emitCallAdded(callId: String, call: Call) {
        // Ob prejemu klica za SAMOSTOJNO pot naredimo to, kar bi naredil racunalnik (prehod):
        // 1. Dvignemo klic (ANSWER)
        // Usmeritev zvoka in ostalo se zgodi v CallAudioBridge po uspesnem dvigu, ko preide v ACTIVE.
        // Stevilka klicatelja za zapis klica (skrita stevilka = prazno).
        LokalniPrehodUpravljalnik.gemini?.stevilkaNaslednjegaKlica = call.details?.handle?.schemeSpecificPart.orEmpty()
        val controller = CallCommandController(context)
        // Ko se Lina poslovi, klic tudi prekine (lastnik 22. 11. 2026): model pokliče koncaj_klic, odjemalec sprozi prekinitev.
        LokalniPrehodUpravljalnik.gemini?.naKonecPogovora = {
            controller.handle(GatewayCommand(commandId = "loc_end_$callId", callId = callId, action = CommandAction.HANGUP, digits = null)) { r ->
                Log.i("LokalniKrmilnik", "Call $callId ended by Lina: ok=${r.ok}")
            }
        }
        // Lastnik 22. 11. 2026: mikrofon telefona se zaradi tezave s slisnostjo NE vklopi nazaj (Lina je program in ne potrebuje mikrofona telefona).
        // Orodje klicatelj_ne_slisi samo zapise tezavo v dnevnik; Lina ponovi zadnji stavek. Vzrok (utisanje) se odpravi v kodi, ne z vklopom mikrofona.
        LokalniPrehodUpravljalnik.gemini?.naTezavoSlisnosti = {
            Log.w("LokalniKrmilnik", "klicatelj javlja, da Line ne slisi (mikrofon ostane utisan)")
        }
        val answerCmd = GatewayCommand(
            commandId = "loc_ans_$callId",
            callId = callId,
            action = CommandAction.ANSWER,
            digits = null
        )
        controller.handle(answerCmd) { result ->
            if (result.ok) {
                Log.i("LokalniKrmilnik", "Call $callId answered locally")
                // Seja z modelom se odpre ze zdaj (ob dvigu), da Lina spregovori takoj, ko zvok klica stece (lastnik 22. 11. 2026).
                runCatching { LokalniPrehodUpravljalnik.gemini?.pripraviKlic() }
            } else {
                Log.w("LokalniKrmilnik", "Failed to answer locally: ${result.error}")
            }
        }
    }

    override fun emitCallRemoved(callId: String, call: Call) {
        // Preklic klica / konec
        // Lokalni prehod moramo pocistiti. Kdo obvesti Asistenta?
        LokalniPrehodUpravljalnik.prehod?.pocisti()
        // Konec klica zapise zapis klica tudi, ce se zvocna povezava ni zaprla sama.
        LokalniPrehodUpravljalnik.gemini?.konecKlica()
    }

    override fun emitCallState(callId: String, call: Call) {
        // Povemo asistentu, ce se stanje spremeni
    }
}
