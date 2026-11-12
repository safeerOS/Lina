package com.httpgateway.dialer

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.telecom.Call
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.widget.Button
import android.widget.GridLayout
import android.widget.TextView
import android.widget.Toast
import com.httpgateway.dialer.audio.CallAudioBridge
import com.httpgateway.dialer.telecom.CallBackgroundAudio
import com.httpgateway.dialer.telecom.CallCommandController
import com.httpgateway.dialer.telecom.CallRegistry
import com.httpgateway.dialer.telecom.IncomingCallNotice
import com.httpgateway.dialer.telecom.LinaCallGate
import com.httpgateway.dialer.transport.GatewayRuntime
import com.httpgateway.protocol.AudioReturn
import com.httpgateway.protocol.CallScreen
import com.httpgateway.protocol.CommandAction
import com.httpgateway.protocol.FailureMessages
import com.httpgateway.protocol.GatewayCommand
import java.util.UUID

class InCallActivity : Activity(), CallRegistry.Listener {
    companion object {
        /** N14-4: klic, ki ga ob odprtju vmesnika takoj dvignemo (dejanje v obvestilu). */
        const val EXTRA_ANSWER_CALL_ID = "answer_call_id"

        /** Vmesnik je viden: obvestilo dohodnega klica se umakne. */
        @Volatile
        var visible = false
            private set
    }

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(AppLocale.wrap(newBase))
    }

    private lateinit var stateDot: View
    private lateinit var stateText: TextView
    private lateinit var numberText: TextView
    private lateinit var timerText: TextView
    private lateinit var routedText: TextView
    private lateinit var ringingRow: View
    private lateinit var activeRow: View
    private lateinit var holdButton: Button
    private lateinit var keypad: GridLayout
    private lateinit var callPicker: Button
    private lateinit var takeBackButton: Button
    private lateinit var controller: CallCommandController
    private val handler = Handler(Looper.getMainLooper())
    private var selectedCallId: String? = null

    private val ticker = object : Runnable {
        override fun run() {
            renderTimer()
            handler.postDelayed(this, 500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
            )
        }
        controller = CallCommandController(this)
        setContentView(R.layout.activity_in_call)
        findViewById<View>(R.id.root).setOnApplyWindowInsetsListener { view, insets ->
            val bars = insets.getInsets(WindowInsets.Type.systemBars())
            view.setPadding(dp(24) + bars.left, dp(40) + bars.top, dp(24) + bars.right, dp(28) + bars.bottom)
            insets
        }
        stateDot = findViewById(R.id.stateDot)
        stateText = findViewById(R.id.stateText)
        numberText = findViewById(R.id.numberText)
        timerText = findViewById(R.id.timerText)
        routedText = findViewById(R.id.routedText)
        ringingRow = findViewById(R.id.ringingRow)
        activeRow = findViewById(R.id.activeRow)
        holdButton = findViewById(R.id.holdButton)
        keypad = findViewById(R.id.keypad)
        callPicker = findViewById(R.id.callPicker)
        takeBackButton = findViewById(R.id.takeBackButton)

        findViewById<Button>(R.id.answerButton).setOnClickListener { execute(CommandAction.ANSWER) }
        findViewById<Button>(R.id.declineButton).setOnClickListener { execute(CommandAction.REJECT) }
        findViewById<Button>(R.id.endButton).setOnClickListener { execute(CommandAction.HANGUP) }
        callPicker.setOnClickListener {
            val ids = CallRegistry.snapshot().map { it.callId }
            selectedCallId = CallScreen.nextId(ids, selectedCallId)
            render()
        }
        takeBackButton.setOnClickListener { takeBack() }
        holdButton.setOnClickListener {
            val held = currentCall()?.let(CallRegistry::androidState) == Call.STATE_HOLDING
            execute(if (held) CommandAction.UNHOLD else CommandAction.HOLD)
        }
        findViewById<Button>(R.id.keypadButton).setOnClickListener {
            keypad.visibility = if (keypad.visibility == View.VISIBLE) View.GONE else View.VISIBLE
        }
        buildKeypad()
        handleAnswerIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleAnswerIntent(intent)
    }

    /** N14-4: »Sprejmi« iz obvestila dohodnega klica: odgovor gre skozi isto pot kot gumb v vmesniku. */
    private fun handleAnswerIntent(intent: Intent?) {
        val callId = intent?.getStringExtra(EXTRA_ANSWER_CALL_ID) ?: return
        intent.removeExtra(EXTRA_ANSWER_CALL_ID)
        selectedCallId = callId
        controller.performLocal(
            GatewayCommand(commandId = "local_ui_${UUID.randomUUID()}", callId = callId, action = CommandAction.ANSWER),
        ) { result ->
            if (!result.ok) runOnUiThread { Toast.makeText(this, textFor(result.error), Toast.LENGTH_SHORT).show() }
        }
    }

    override fun onStart() {
        super.onStart()
        visible = true
        // Vmesnik je odprt: obvestilo dohodnega klica ni vec potrebno.
        IncomingCallNotice.cancelAll(this)
        CallRegistry.addListener(this)
        render()
        handler.post(ticker)
    }

    override fun onStop() {
        visible = false
        handler.removeCallbacks(ticker)
        CallRegistry.removeListener(this)
        super.onStop()
    }

    override fun onCallsChanged() {
        runOnUiThread(::render)
    }

    private fun buildKeypad() {
        listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#").forEach { digit ->
            keypad.addView(
                Button(this, null, 0, R.style.Gw_Button).apply {
                    text = digit
                    textSize = 20f
                    setOnClickListener { execute(CommandAction.DTMF, digit) }
                },
                GridLayout.LayoutParams().apply {
                    width = dp(72)
                    height = dp(56)
                    setMargins(dp(6), dp(6), dp(6), dp(6))
                },
            )
        }
    }

    private fun displayed(): CallRegistry.Entry? {
        val entries = CallRegistry.snapshot()
        val id = CallScreen.displayedId(entries.map { it.callId }, selectedCallId)
        selectedCallId = id
        return entries.firstOrNull { it.callId == id }
    }

    private fun currentCall(): Call? = displayed()?.call

    private fun render() {
        val entry = displayed() ?: return finish()
        val call = entry.call
        val state = CallRegistry.androidState(call)
        val incoming = call.details.callDirection == Call.Details.DIRECTION_INCOMING
        val canHold = (call.details.callCapabilities and Call.Details.CAPABILITY_HOLD) != 0
        val ids = CallRegistry.snapshot().map { it.callId }

        numberText.text = call.details.handle?.schemeSpecificPart?.takeIf { it.isNotBlank() } ?: getString(R.string.unknown_number)
        val (color, label) = when (state) {
            Call.STATE_RINGING -> R.color.ring to getString(R.string.incoming_call)
            Call.STATE_DIALING, Call.STATE_CONNECTING -> R.color.ring to getString(R.string.calling)
            Call.STATE_ACTIVE, Call.STATE_AUDIO_PROCESSING -> R.color.live to getString(R.string.on_call)
            Call.STATE_HOLDING -> R.color.muted to getString(R.string.on_hold)
            Call.STATE_DISCONNECTING, Call.STATE_DISCONNECTED -> R.color.muted to getString(R.string.call_ended)
            else -> R.color.muted to (if (incoming) getString(R.string.incoming_call) else getString(R.string.calling))
        }
        stateDot.backgroundTintList = ColorStateList.valueOf(getColor(color))
        val index = ids.indexOf(entry.callId).coerceAtLeast(0) + 1
        stateText.text = if (ids.size > 1) "$label · $index/${ids.size}" else label

        val connected = state == Call.STATE_ACTIVE || state == Call.STATE_AUDIO_PROCESSING || state == Call.STATE_HOLDING
        routedText.visibility = if (state == Call.STATE_AUDIO_PROCESSING) View.VISIBLE else View.GONE
        ringingRow.visibility = if (state == Call.STATE_RINGING) View.VISIBLE else View.GONE
        activeRow.visibility = if (connected) View.VISIBLE else View.GONE
        holdButton.visibility = if (canHold || state == Call.STATE_HOLDING) View.VISIBLE else View.GONE
        holdButton.text = if (state == Call.STATE_HOLDING) getString(R.string.resume) else getString(R.string.hold)
        callPicker.visibility = if (ids.size > 1) View.VISIBLE else View.GONE
        callPicker.text = getString(R.string.next_call, index, ids.size)
        takeBackButton.visibility = if (CallScreen.showTakeBack(LinaCallGate.isOwned(entry.callId))) View.VISIBLE else View.GONE
        if (!connected) keypad.visibility = View.GONE
        renderTimer()
    }

    private fun renderTimer() {
        val call = currentCall() ?: return
        val since = call.details.connectTimeMillis
        if (since <= 0) {
            timerText.text = ""
            return
        }
        val seconds = ((System.currentTimeMillis() - since) / 1000).coerceAtLeast(0)
        timerText.text = "%d:%02d".format(seconds / 60, seconds % 60)
    }

    private fun execute(action: CommandAction, digits: String? = null) {
        val entry = displayed() ?: return
        controller.performLocal(
            GatewayCommand(
                commandId = "local_ui_${UUID.randomUUID()}",
                callId = entry.callId,
                action = action,
                digits = digits,
            ),
        ) { result ->
            if (!result.ok) runOnUiThread { Toast.makeText(this, textFor(result.error), Toast.LENGTH_SHORT).show() }
        }
    }

    /** Uporabnik vzame Linin klic nazaj: oznaka, ustavitev zajema, izhod iz ozadja. */
    private fun takeBack() {
        val entry = displayed() ?: return
        LinaCallGate.markManual(entry.callId)
        CallAudioBridge.onCallEnded(entry.callId)
        GatewayRuntime.notifyCallEnded(entry.callId)
        val returned = CallBackgroundAudio.exit(entry.call)
        // API 29 izhoda nima: klic je ACTIVE in slisen, opozorilo »tih« bi bilo napacno (N11-5).
        val audible = CallRegistry.androidState(entry.call) == Call.STATE_ACTIVE
        if (AudioReturn.shouldWarn(exitFailed = !returned, audible = audible)) {
            Toast.makeText(this, getString(R.string.audio_not_returned), Toast.LENGTH_LONG).show()
        }
        render()
    }

    private fun textFor(code: String?): String {
        val key = FailureMessages.resourceName(code)
        val id = resources.getIdentifier(key, "string", packageName)
        return if (id != 0) getString(id) else getString(R.string.didnt_work)
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
