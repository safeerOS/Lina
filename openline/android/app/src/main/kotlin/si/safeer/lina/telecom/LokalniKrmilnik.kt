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
        val answerCmd = GatewayCommand(
            commandId = "loc_ans_$callId",
            callId = callId,
            action = CommandAction.ANSWER,
            digits = null
        )
        controller.handle(answerCmd) { result ->
            if (result.ok) {
                Log.i("LokalniKrmilnik", "Call $callId answered locally")
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
