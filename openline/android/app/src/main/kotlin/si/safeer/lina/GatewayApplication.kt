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
        CallAudioBridge.initialize(this)
        LinaCallGate.setManualListener { GatewayRuntime.forgetCall(it) }
        GatewayRuntime.initialize(this)
        GatewayConnectionService.start(this)
    }
}
