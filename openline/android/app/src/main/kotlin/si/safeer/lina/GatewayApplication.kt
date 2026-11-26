package si.safeer.lina

import android.app.Application
import android.content.Context
import si.safeer.lina.audio.CallAudioBridge
import si.safeer.lina.telecom.LinaCallGate
import si.safeer.lina.transport.GatewayConnectionService
import si.safeer.lina.transport.GatewayRuntime

class GatewayApplication : Application() {
    override fun attachBaseContext(base: Context) {
        super.attachBaseContext(AppLocale.wrap(base))
    }

    override fun onCreate() {
        super.onCreate()
        // Opozorilo ob prvem zagonu: brez »Razumem« kljuc naprave ne podpise nalog in gradenj; oznaka namestitve se zapise zdaj.
        val opozorilo = si.safeer.lina.config.OpozoriloShramba(this)
        si.safeer.lina.podpis.NapravaKljuc.smeDelati = { opozorilo.smeDelati() }
        opozorilo.namestitev()
        // Lastnik: nikoli posnetek zvoka. Posnetki Lininega izhoda iz 0.2.13 (files/lina_zvok/zajem) se izbrisejo; napaka ne ustavi zagona (0214 A4).
        val files = filesDir
        Thread({ runCatching { si.safeer.lina.samostojna.izbrisiStarePosnetkeZvoka(files) } }, "lina-pocisti-zvok").start()
        CallAudioBridge.initialize(this)
        LinaCallGate.setManualListener { GatewayRuntime.forgetCall(it) }
        GatewayRuntime.initialize(this)
        GatewayConnectionService.start(this)
    }
}
