package com.httpgateway.dialer.audio

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import com.httpgateway.dialer.DialerActivity
import com.httpgateway.dialer.R
import com.httpgateway.dialer.config.GatewayConfigStore
import com.httpgateway.dialer.shell.ShellClient
import com.httpgateway.dialer.shell.ShellLauncher
import com.httpgateway.dialer.telecom.CallBackgroundAudio
import com.httpgateway.dialer.telecom.CallRegistry
import com.httpgateway.dialer.telecom.LinaCallGate
import com.httpgateway.dialer.transport.DeviceHealth
import com.httpgateway.dialer.transport.GatewayRuntime
import com.httpgateway.protocol.ArmSlot
import com.httpgateway.protocol.AudioDrop
import com.httpgateway.protocol.AudioPing
import com.httpgateway.protocol.CaptureOrder
import com.httpgateway.protocol.CapturePermit
import com.httpgateway.protocol.GatewayUrl
import com.httpgateway.protocol.LeaseRound
import com.httpgateway.protocol.MediaStream
import com.httpgateway.protocol.ShellCleanup
import com.httpgateway.protocol.ShellLoss
import com.httpgateway.protocol.ShellNotice
import com.httpgateway.protocol.TlsPin
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * App side of call audio: tells the shell server which call to stream. Audio itself flows
 * directly between the shell server and the gateway; it never passes through this process.
 * Odtis je isti kot pri nadzorni povezavi. Brez njega se zvok ne zacne.
 */
object CallAudioBridge {
    private const val TAG = "CallAudioBridge"

    enum class Status { SETUP_REQUIRED, STOPPED, READY }

    private val worker = Executors.newSingleThreadExecutor { Thread(it, "callaudio-bridge") }
    private val lease: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { Thread(it, "callaudio-lease") }
    private val arm = ArmSlot()
    private val armLock = Any()
    private val handedBack = ConcurrentHashMap.newKeySet<String>()

    @Volatile
    private var misses = 0

    @Volatile
    private var shellNoticeState = ShellNotice.State(false, 0)

    @Volatile
    private var seenWifi = false

    @Volatile
    private var wifiWasUp = false

    @Volatile
    private var appContext: Context? = null

    fun initialize(context: Context) {
        appContext = context.applicationContext
        worker.execute { ShellLauncher.ensureRunning(context.applicationContext) }
        lease.scheduleWithFixedDelay({ confirmLease() }, 3, 3, TimeUnit.SECONDS)
    }

    /** Blocking (local socket); call off the main thread. */
    fun status(context: Context): Status = when {
        ShellClient(context).isRunning() -> Status.READY
        !ShellLauncher.isPaired(context) -> Status.SETUP_REQUIRED
        else -> Status.STOPPED
    }

    fun restart(context: Context, onResult: (ShellLauncher.Result) -> Unit) {
        worker.execute {
            val client = ShellClient(context)
            client.exit()
            ShellCleanup.waitUntilDown(
                answers = { client.isRunning() },
                sleep = { Thread.sleep(it) },
                now = { System.currentTimeMillis() },
            )
            onResult(ShellLauncher.ensureRunning(context.applicationContext))
        }
    }

    /** Klic je ACTIVE in ga ima Lina: zazeni zvok samo s pripetim odtisom. */
    fun onCallActive(callId: String) {
        val context = appContext ?: return
        handedBack.remove(callId)
        worker.execute {
            val config = GatewayConfigStore(context).load()
            if (config.wsUrl.isBlank() || config.deviceToken.isBlank()) return@execute
            if (!GatewayUrl.accept(config.wsUrl, config.deviceToken)) {
                Log.w(TAG, "zvok se ne zacne za $callId: neveljaven naslov")
                giveBack(callId, warn = true)
                return@execute
            }
            val mediaUrl = runCatching { MediaStream.deviceMediaUrl(config.wsUrl, callId) }.getOrElse {
                Log.w(TAG, "zvok se ne zacne za $callId: neveljaven naslov")
                giveBack(callId, warn = true)
                return@execute
            }
            if (runCatching { TlsPin.requireMediaPin(mediaUrl, config.certSha256) }.isFailure) {
                Log.w(TAG, "zvok se ne zacne za $callId: ni wss ali odtisa")
                giveBack(callId, warn = true)
                return@execute
            }
            val launch = ShellLauncher.ensureRunning(context)
            if (launch !is ShellLauncher.Result.Running && launch !is ShellLauncher.Result.Held) {
                Log.w(TAG, "call audio unavailable for $callId: $launch")
                giveBack(callId, warn = true)
                return@execute
            }
            val ownedBefore = LinaCallGate.isOwned(callId)
            if (!CapturePermit.begin(ownedBefore)) {
                ShellClient(context).stop(callId)
                return@execute
            }
            synchronized(armLock) { arm.set(CaptureOrder.beforeStart(callId)) }
            var reply: org.json.JSONObject? = null
            for (i in 1..CapturePermit.startAttempts()) {
                reply = ShellClient(context).start(callId)
                if (reply?.optBoolean("ok") == true) break
            }
            val after = CaptureOrder.afterStart(
                callId,
                CapturePermit.keep(ownedBefore, reply?.optBoolean("ok") == true, LinaCallGate.isOwned(callId)),
            )
            synchronized(armLock) { arm.set(after) }
            if (after.expected == null) {
                Log.w(TAG, "start $callId failed -> $reply")
                giveBack(callId, warn = true)
            }
            Log.i(TAG, "start $callId -> $reply")
        }
    }

    fun onCallEnded(callId: String) {
        handedBack.remove(callId)
        synchronized(armLock) {
            if (arm.get().expected == callId) arm.set(CaptureOrder.Armed(null, false))
            misses = 0
        }
        val context = appContext ?: return
        Thread { stopUntil(ShellClient(context), callId) }.start()
    }

    /** Na liniji je klic, ki ga Lina nima. Zajem ustavimo, ne glede na id seje. */
    fun onUnsafeDownlink() {
        synchronized(armLock) {
            arm.set(CaptureOrder.Armed(null, false))
            misses = 0
        }
        val context = appContext ?: return
        Thread { stopUntil(ShellClient(context), null) }.start()
    }

    private fun confirmLease() {
        try {
            confirmLeaseBody()
        } catch (t: Throwable) {
            Log.w(TAG, "lease", t)
        }
    }

    private fun confirmLeaseBody() {
        val context = appContext ?: return
        val client = ShellClient(context)
        val viewBefore = synchronized(armLock) { arm.get() }
        val ping = client.ping()
        val up = ping != null
        val paired = ShellLauncher.isPaired(context)
        val notice = ShellNotice.next(paired, up, shellNoticeState)
        shellNoticeState = notice.state
        if (notice.publish) notifyLost(context)
        if (notice.cancel) cancelLost(context)
        val wifi = DeviceHealth.isOnWifi(context)
        val retry = ShellLoss.nextWifi(paired, up, wifi, seenWifi, wifiWasUp)
        seenWifi = retry.seen
        wifiWasUp = retry.wifiWasUp
        if (retry.shouldRetry) runCatching { ShellLauncher.ensureRunning(context) }
        val reported = ping?.optString("callId")?.takeIf { up && it.isNotEmpty() }
        val evaluated = synchronized(armLock) {
            val viewAfter = arm.get()
            val round = LeaseRound.evaluate(viewBefore, viewAfter, pingOk = up, reported = reported, misses = misses)
            misses = round.misses
            round to viewAfter.expected
        }
        val (round, expected) = evaluated
        round.plan.confirmCallId?.let { client.confirm(it) }
        when {
            (round.giveBackSilence || round.plan.notifyDropped) && !expected.isNullOrEmpty() ->
                giveBack(expected, warn = true, stopTarget = round.plan.stopTarget)
            else -> {
                if (round.plan.clearExpected) {
                    synchronized(armLock) {
                        if (!arm.get().startInFlight) arm.set(CaptureOrder.Armed(null, false))
                    }
                }
                if (round.plan.stop) stopUntil(client, round.plan.stopTarget)
            }
        }
    }

    /** stop, dokler lupina ne potrdi. Naslednji krog poskusi znova. */
    private fun stopUntil(client: ShellClient, callId: String?) {
        val start = android.os.SystemClock.elapsedRealtime()
        while (android.os.SystemClock.elapsedRealtime() - start < 1000) {
            val reply = client.stop(callId, timeoutMs = 1000)
            if (AudioPing.stopSettled(reply?.optBoolean("ok") == true)) return
            Thread.sleep(50)
        }
    }

    private fun giveBack(callId: String, warn: Boolean, stopTarget: String? = callId) {
        if (!handedBack.add(callId)) return
        val proceed = synchronized(armLock) {
            val view = arm.get()
            val blocked = (view.startInFlight && view.expected == callId) ||
                (view.expected != null && view.expected != callId)
            if (blocked) {
                handedBack.remove(callId)
                false
            } else {
                arm.set(CaptureOrder.Armed(null, false))
                misses = 0
                true
            }
        }
        if (!proceed) return
        val context = appContext
        val drop = AudioDrop.plan(true)
        val call = CallRegistry.get(callId)
        var exitOk = false
        val order = AudioDrop.giveBackOrder()
        for (step in order) {
            when (step) {
                AudioDrop.Step.MARK_MANUAL -> LinaCallGate.markManual(callId)
                AudioDrop.Step.NOTIFY_SERVER -> GatewayRuntime.notifyCallEnded(callId)
                AudioDrop.Step.EXIT_BACKGROUND_AUDIO -> {
                    exitOk = if (call != null && drop.returnToHandset && !AudioDrop.simulatedRinging()) {
                        CallBackgroundAudio.exit(call)
                    } else {
                        false
                    }
                    val outcome = AudioDrop.outcome(callPresent = call != null, exitOk = exitOk)
                    if (warn && outcome.warn && context != null) notifyReturned(context, outcome.message)
                }
                AudioDrop.Step.STOP_CAPTURE -> {
                    if (context != null && drop.stopCapture) {
                        Thread { stopUntil(ShellClient(context), stopTarget) }.start()
                    }
                }
            }
        }
    }

    private fun notifyLost(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val channelId = "shell"
        manager.createNotificationChannel(
            NotificationChannel(channelId, context.getString(R.string.shell_channel), NotificationManager.IMPORTANCE_DEFAULT),
        )
        val open = PendingIntent.getActivity(
            context,
            0,
            Intent(context, DialerActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = Notification.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.stat_sys_warning)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(context.getString(R.string.shell_lost))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .build()
        manager.notify(7003, notification)
    }

    private fun cancelLost(context: Context) {
        context.getSystemService(NotificationManager::class.java)?.cancel(7003)
    }

    private fun notifyReturned(context: Context, messageKey: String) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val channelId = "shell"
        manager.createNotificationChannel(
            NotificationChannel(channelId, context.getString(R.string.shell_channel), NotificationManager.IMPORTANCE_DEFAULT),
        )
        val id = context.resources.getIdentifier(messageKey, "string", context.packageName)
        val text = if (id != 0) context.getString(id) else context.getString(R.string.audio_not_returned)
        val notification = Notification.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.stat_sys_warning)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(text)
            .setOnlyAlertOnce(true)
            .build()
        manager.notify(7004, notification)
    }
}
