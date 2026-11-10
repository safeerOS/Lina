package com.httpgateway.dialer

import android.app.Application
import android.content.Context
import com.httpgateway.dialer.audio.CallAudioBridge
import com.httpgateway.dialer.telecom.LinaCallGate
import com.httpgateway.dialer.transport.GatewayConnectionService
import com.httpgateway.dialer.transport.GatewayRuntime

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
