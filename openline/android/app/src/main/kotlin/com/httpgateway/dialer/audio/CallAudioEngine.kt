package com.httpgateway.dialer.audio

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import android.util.Log
import com.httpgateway.dialer.transport.TlsPin
import com.httpgateway.protocol.AudioArm
import com.httpgateway.protocol.AudioWatchdog
import com.httpgateway.protocol.MediaStream
import com.httpgateway.protocol.ShellLease
import com.httpgateway.protocol.TlsPin as MediaPin
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * Tece v procesu lupine. Zajem VOICE_DOWNLINK in predvajanje v TELEPHONY.
 * Vticnica je samo TlsPin.client. Brez odtisa ali brez wss se zvok ne zacne.
 * Naslov in odtis sta tista, ki sta prisla ob zagonu, ne iz zahteve start.
 * Brez potrditve aplikacije se zajem sam ustavi.
 */
class CallAudioEngine(private val context: Context?) {
    data class Target(
        val callId: String,
        val mediaUrl: String,
        val deviceId: String,
        val deviceToken: String,
        val certSha256: String,
    ) {
        override fun toString(): String = "Target(callId=$callId)"
    }

    private var client: OkHttpClient? = null
    private var clientPin: String? = null
    private var session: Session? = null
    private var armedCert: String = ""
    private var armedDevice: String = ""
    private var armedToken: String = ""

    /** Dovoljeni odtis in zetona naprave. Naslov klica se izpelje iz tega, ne iz zahteve. */
    @Synchronized
    fun arm(mediaUrl: String, certSha256: String, deviceId: String, deviceToken: String) {
        armedCert = certSha256
        armedDevice = deviceId
        armedToken = deviceToken
        if (mediaUrl.isBlank()) Log.w(TAG, "ob zagonu ni naslova prehoda")
    }

    @Synchronized
    fun start(target: Target): Boolean {
        if (!AudioArm.accepts(armedCert, armedToken, armedDevice, target.certSha256, target.deviceToken, target.deviceId)) {
            Log.w(TAG, "odtis ali zeton ni tisti ob zagonu")
            return false
        }
        val pin = runCatching { MediaPin.requireMediaPin(target.mediaUrl, target.certSha256) }.getOrElse {
            Log.w(TAG, "ni wss ali odtisa")
            return false
        }
        if (session?.target?.callId == target.callId) return true
        stop()
        if (client == null || clientPin != pin) {
            client = TlsPin.client(pin)
            clientPin = pin
        }
        session = Session(target, checkNotNull(client)).also(Session::start)
        return true
    }

    @Synchronized
    fun stop(callId: String? = null) {
        val current = session ?: return
        if (callId != null && current.target.callId != callId) return
        current.close()
        session = null
    }

    @Synchronized
    fun confirm() {
        session?.confirm()
    }

    @Synchronized
    fun activeCallId(): String? = session?.target?.callId

    @Synchronized
    private fun dropSession(failed: Session) {
        if (session !== failed) return
        failed.close()
        if (session === failed) session = null
    }

    private inner class Session(val target: Target, private val client: OkHttpClient) : WebSocketListener() {
        private val record: AudioRecord
        private val track: AudioTrack

        init {
            val built = buildRecord()
            val played = try {
                buildTrack()
            } catch (thrown: Throwable) {
                runCatching { built.release() }
                throw thrown
            }
            record = built
            track = played
        }
        private val playbackQueue = LinkedBlockingQueue<ByteArray>()

        @Volatile
        private var running = true

        @Volatile
        private var closed = false

        @Volatile
        private var confirmedAt = SystemClock.elapsedRealtime()

        @Volatile
        private var socket: WebSocket? = null
        private val threads = mutableListOf<Thread>()
        private var faults = 0

        fun confirm() {
            confirmedAt = SystemClock.elapsedRealtime()
        }

        fun start() {
            record.startRecording()
            track.play()
            Log.i(TAG, "audio started for ${target.callId}")
            thread("capture", ::captureLoop)
            thread("playback", ::playbackLoop)
            connect()
        }

        fun close() {
            val self = Thread.currentThread()
            val toJoin: List<Thread>
            val current: WebSocket?
            synchronized(this) {
                if (closed) return
                closed = true
                running = false
                current = socket
                socket = null
                threads.forEach { if (it !== self) it.interrupt() }
                toJoin = threads.filter { it !== self }
            }
            current?.close(1000, "call_ended")
            runCatching { record.stop() }
            runCatching { track.stop() }
            toJoin.forEach { runCatching { it.join(500) } }
            runCatching { record.release() }
            runCatching { track.release() }
            Log.i(TAG, "audio stopped for ${target.callId}")
        }

        private fun connect() {
            if (!running) return
            val request = Request.Builder()
                .url(target.mediaUrl)
                .header("X-Device-Id", target.deviceId)
                .header("X-Device-Token", target.deviceToken)
                .build()
            socket = client.newWebSocket(request, this)
        }

        private fun captureLoop() {
            val frame = ByteArray(MediaStream.FRAME_BYTES)
            while (running) {
                if (ShellLease.expired(confirmedAt, SystemClock.elapsedRealtime())) {
                    Log.w(TAG, "ni potrditve aplikacije, zajem se ustavi")
                    dropSession(this)
                    return
                }
                var read = 0
                var dead = false
                while (read < frame.size && running) {
                    val n = record.read(frame, read, frame.size - read)
                    if (n <= 0) {
                        dead = true
                        break
                    }
                    read += n
                }
                if (!dead) {
                    if (running && read > 0) socket?.send(frame.toByteString(0, read))
                    continue
                }
                val action = takeAction() ?: return
                if (AudioWatchdog.releasesSession(action)) {
                    Log.w(TAG, "zajetje ustavljeno po omejitvi poskusov")
                    dropSession(this)
                    return
                }
            }
        }

        private fun playbackLoop() {
            while (running) {
                val chunk = try {
                    playbackQueue.poll(100, TimeUnit.MILLISECONDS)
                } catch (_: InterruptedException) {
                    return
                } ?: continue
                track.write(chunk, 0, chunk.size)
            }
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
            if (running) playbackQueue.offer(bytes.toByteArray())
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            if (!MediaStream.isClearMessage(text)) return
            playbackQueue.clear()
            runCatching {
                track.pause()
                track.flush()
                track.play()
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            Log.w(TAG, "media socket failed for ${target.callId} (http ${response?.code})", t)
            onSocketFault(webSocket)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (running) onSocketFault(webSocket)
        }

        private fun takeAction(): AudioWatchdog.Action? = synchronized(this) {
            if (!running || closed) return null
            faults += 1
            AudioWatchdog.afterFailure(faults)
        }

        private fun onSocketFault(failed: WebSocket) {
            val proceed = synchronized(this) {
                if (!running || closed || socket !== failed) false
                else {
                    socket = null
                    true
                }
            }
            if (!proceed) return
            val action = takeAction() ?: return
            if (AudioWatchdog.releasesSession(action)) {
                Log.w(TAG, "vticnica ustavljena po omejitvi poskusov")
                dropSession(this)
                return
            }
            val waiter = Thread {
                try {
                    Thread.sleep(1_000)
                } catch (_: InterruptedException) {
                    return@Thread
                }
                if (running) connect()
            }
            synchronized(this) { threads += waiter }
            waiter.start()
        }

        private fun thread(name: String, body: () -> Unit): Thread {
            val worker = Thread({
                runCatching(body).onFailure { Log.w(TAG, "$name loop ended", it) }
            }, "callaudio-$name")
            synchronized(this) { threads += worker }
            worker.start()
            return worker
        }

        @SuppressLint("MissingPermission")
        private fun buildRecord(): AudioRecord {
            val minBuf = AudioRecord.getMinBufferSize(
                MediaStream.SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
            )
            val builder = AudioRecord.Builder()
                .setAudioSource(MediaRecorder.AudioSource.VOICE_DOWNLINK)
                .setAudioFormat(pcmFormat(AudioFormat.CHANNEL_IN_MONO))
                .setBufferSizeInBytes(maxOf(minBuf, MediaStream.FRAME_BYTES) * 4)
            if (context != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) builder.setContext(context)
            val built = builder.build()
            check(built.state == AudioRecord.STATE_INITIALIZED) {
                built.release()
                "VOICE_DOWNLINK capture unavailable"
            }
            return built
        }

        private fun buildTrack(): AudioTrack {
            val minBuf = AudioTrack.getMinBufferSize(
                MediaStream.SAMPLE_RATE,
                AudioFormat.CHANNEL_OUT_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
            )
            val builder = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build(),
                )
                .setAudioFormat(pcmFormat(AudioFormat.CHANNEL_OUT_MONO))
                .setBufferSizeInBytes(maxOf(minBuf, MediaStream.FRAME_BYTES * 4))
                .setTransferMode(AudioTrack.MODE_STREAM)
            if (context != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                builder.setContext(context)
            }
            val built = builder.build()
            val telephony = telephonyOutput() ?: run {
                built.release()
                throw IllegalStateException("TELEPHONY output device not found")
            }
            built.setPreferredDevice(telephony)
            return built
        }
    }

    private companion object {
        const val TAG = "CallAudioEngine"

        fun pcmFormat(channelMask: Int): AudioFormat = AudioFormat.Builder()
            .setSampleRate(MediaStream.SAMPLE_RATE)
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setChannelMask(channelMask)
            .build()

        fun telephonyOutput(): AudioDeviceInfo? {
            val getDevices = AudioManager::class.java
                .getDeclaredMethod("getDevicesStatic", Int::class.javaPrimitiveType)
                .apply { isAccessible = true }
            @Suppress("UNCHECKED_CAST")
            val devices = getDevices.invoke(null, AudioManager.GET_DEVICES_OUTPUTS) as Array<AudioDeviceInfo>
            return devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_TELEPHONY }
        }
    }
}
