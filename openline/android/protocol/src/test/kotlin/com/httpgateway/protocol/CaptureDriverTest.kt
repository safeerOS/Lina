package com.httpgateway.protocol

import com.httpgateway.protocol.CaptureMachine.Effect
import com.httpgateway.protocol.CaptureMachine.Event
import com.httpgateway.protocol.CaptureMachine.Phase
import com.httpgateway.protocol.CaptureMachine.State
import com.httpgateway.protocol.CaptureMachine.StopDebt
import com.httpgateway.protocol.CaptureSim.Companion.W
import com.httpgateway.protocol.CaptureSim.Companion.X
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Krog 12. Ozicenje, ki je bilo prej v CallAudioBridge brez preizkusa (N11-6): pravi
 * izvajalec in avtomat, lazna lupina. Prepletanje niti doloci preizkus korak za korakom.
 */
class CaptureDriverTest {
    private fun capturing(api29: Boolean = false): CaptureSim {
        val sim = CaptureSim(api29)
        sim.activate()
        assertTrue(sim.runPrep())
        assertTrue(sim.runOps())
        assertEquals(Phase.CAPTURING, sim.state.phase)
        assertEquals(X, sim.session)
        return sim
    }

    private fun assertClean(sim: CaptureSim) {
        assertTrue(sim.settle(), "sistem se ne umiri")
        assertEquals(emptyList(), sim.settledViolations())
    }

    // ---- Izcrpno prepletanje -------------------------------------------------------------

    private class Move(val name: String, val enabled: (CaptureSim) -> Boolean, val apply: (CaptureSim) -> Unit)

    private val moves = listOf(
        Move("X aktiven", { it.canActivate() }) { it.activate() },
        Move("zastarel START storitve", { it.xPresent && !it.xOwned }) { it.staleActive() },
        Move("uporabnikov klic", { !it.wLive }) { it.userCallLive() },
        Move("tuj klic konec", { true }) { it.foreignCallRemoved() },
        Move("X odstranjen", { it.xPresent }) { it.xRemoved() },
        Move("uporabnik prevzame X", { it.xPresent && it.xOwned }) { it.userTakesX() },
        Move("X na cakanju", { it.xPresent && it.xOwned && !it.xHeld }) { it.xHeld() },
        Move("krog najema", { it.leaseLabels.none { l -> l is Effect.PingShell } }) { it.tick() },
        Move("priprava uspe", { it.prepLabels.isNotEmpty() }) { it.runPrep(true) },
        Move("priprava ne uspe", { it.prepLabels.firstOrNull() is Effect.Prepare }) { it.runPrep(false) },
        Move("lupina uspe", { it.opsLabels.isNotEmpty() }) { it.runOps(true) },
        Move("lupina ne uspe", { it.opsLabels.firstOrNull().let { l ->
            l is Effect.StartCapture || l is Effect.StopCapture || l is Effect.ExitBackgroundAudio || l is Effect.Disconnect
        } }) { it.runOps(false) },
        // Dogodek sredi starta: lupina je sejo ze odprla, izid pa pride za dogodkom (N10-1).
        Move("uporabnikov klic med startom", { it.opsLabels.firstOrNull() is Effect.StartCapture && !it.wLive }) { sim ->
            sim.runOps(true) { sim.wLive = true; sim.driver.post(Event.UnsafeDownlink) }
        },
        Move("prevzem med startom", { it.opsLabels.firstOrNull() is Effect.StartCapture && it.xOwned }) { sim ->
            sim.runOps(true) { sim.xOwned = false; sim.xState = CaptureSim.ACTIVE; sim.driver.post(Event.CallEnded(X)) }
        },
        Move("ping uspe", { it.leaseLabels.isNotEmpty() }) { it.runLease(true) },
        Move("ping ne uspe", { it.leaseLabels.firstOrNull() is Effect.PingShell }) { it.runLease(false) },
        // Dogodek med pingom: odgovor opisuje stanje pred dogodkom.
        Move("uporabnikov klic med pingom", { it.leaseLabels.firstOrNull() is Effect.PingShell && !it.wLive }) { sim ->
            sim.runLease(true) { sim.wLive = true; sim.driver.post(Event.UnsafeDownlink) }
        },
        Move("X odstranjen med pingom", { it.leaseLabels.firstOrNull() is Effect.PingShell && it.xPresent }) { sim ->
            sim.runLease(true) { sim.xPresent = false; sim.xOwned = false; sim.driver.post(Event.CallEnded(X)) }
        },
        Move("casovnik", { it.timerLabels.isNotEmpty() }) { it.fireTimer() },
        // Proces zvoka sejo spusti sam (AudioWatchdog, potek najema lupine).
        Move("lupina izgubi sejo", { it.session != null }) { it.shellLosesSession() },
    )

    private fun replay(api29: Boolean, path: List<Int>): CaptureSim {
        val sim = CaptureSim(api29)
        for (index in path) moves[index].apply(sim)
        return sim
    }

    /** Vsa zaporedja potez do dolzine [depth] od stanja po potezah [start]. Enaka stanja se razvijejo enkrat. */
    private fun explore(api29: Boolean, depth: Int, start: List<String> = emptyList()): Map<String, Int> {
        val prefix = start.map { name -> moves.indexOfFirst { it.name == name }.also { assertTrue(it >= 0, name) } }
        var frontier = listOf(prefix)
        val seen = HashSet<List<Any?>>()
        seen += replay(api29, prefix).fingerprint()
        val reached = HashMap<String, Int>()
        fun mark(key: String) = reached.merge(key, 1, Int::plus)
        repeat(depth) {
            val next = ArrayList<List<Int>>()
            for (path in frontier) {
                val probe = replay(api29, path)
                for (index in moves.indices) {
                    if (!moves[index].enabled(probe)) continue
                    val extended = path + index
                    val sim = replay(api29, extended)
                    val names = { extended.joinToString(" > ") { moves[it].name } }
                    val stable = sim.stableViolations()
                    if (stable.isNotEmpty()) fail("po korakih [${names()}]: $stable")
                    mark("zaporedja")
                    if (!seen.add(sim.fingerprint())) continue
                    next += extended
                    mark("stanja")
                    if (sim.state.phase == Phase.CAPTURING) mark("zajem")
                    if (sim.gaveBack) mark("vrnitev")
                    if (sim.session != null && !sim.permits(sim.session)) mark("zajem brez dovoljenja s stop na poti")
                    if (sim.state.stop == StopDebt.OWED) mark("dolg")
                    for (call in sim.calls) {
                        when {
                            call.startsWith("notice:") -> mark(call)
                            call.startsWith("disconnect:") -> mark("disconnect")
                            call.startsWith("recheck:") -> mark("recheck")
                        }
                    }
                    // Iz vsakega stanja se mora sistem umiriti v varno stanje.
                    if (!sim.settle()) fail("po korakih [${names()}] se sistem ne umiri")
                    val settled = sim.settledViolations()
                    if (settled.isNotEmpty()) fail("po korakih [${names()}] in umiritvi: $settled")
                }
            }
            frontier = next
        }
        println("prepletanja api29=$api29 globina=$depth zacetek=$start: ${reached.toSortedMap()}")
        return reached
    }

    @Test
    fun `vsa prepletanja do dolzine 9 ohranijo invariante a b c d`() {
        val reached = explore(api29 = false, depth = 9)
        // Preiskava mora doseci vse zanimive izide, sicer invariante ne dokazujejo nicesar.
        for (key in listOf(
            "zajem", "vrnitev", "dolg", "recheck", "disconnect", "zajem brez dovoljenja s stop na poti",
            "notice:audio_returned", "notice:audio_not_returned", "notice:call_disconnected",
        )) {
            assertTrue((reached[key] ?: 0) > 0, "preiskava ni dosegla: $key ($reached)")
        }
        assertTrue(reached.getValue("stanja") > 2_000, "stanj: ${reached["stanja"]}")
    }

    @Test
    fun `vsa prepletanja do dolzine 8 od potrjenega zajema ohranijo invariante`() {
        // Do potrjenega zajema so tri poteze. Od tam se osem: padec seje, dva zgresena pinga, vrnitev, nov klic.
        val reached = explore(api29 = false, depth = 8, start = listOf("X aktiven", "priprava uspe", "lupina uspe"))
        for (key in listOf("vrnitev", "dolg", "recheck", "disconnect", "notice:audio_returned", "notice:call_disconnected")) {
            assertTrue((reached[key] ?: 0) > 0, "preiskava ni dosegla: $key ($reached)")
        }
        assertTrue(reached.getValue("stanja") > 2_000, "stanj: ${reached["stanja"]}")
    }

    @Test
    fun `vsa prepletanja na API 29 klica nikoli ne prekinejo`() {
        val reached = explore(api29 = true, depth = 8)
        assertTrue((reached["vrnitev"] ?: 0) > 0, "$reached")
        assertTrue((reached["notice:audio_returned"] ?: 0) > 0, "$reached")
        // Izhod iz ozadja na API 29 vedno vrne false. Klic je ACTIVE in slisen: ni prekinitve in ni »tih«.
        assertNull(reached["disconnect"])
        assertNull(reached["notice:audio_not_returned"])
    }

    // ---- Ciljani scenariji skozi izvajalca -----------------------------------------------

    @Test
    fun `start preveri linijo pred klicem lupine in po njem`() {
        val sim = CaptureSim()
        sim.activate()
        sim.runPrep()
        // Uporabnik zacne svoj klic, se preden start pride do lupine. Storitev se ni javila.
        sim.wLive = true
        sim.runOps()
        assertFalse("start:$X" in sim.calls)
        assertNull(sim.session)
        assertEquals(Phase.SUSPENDED, sim.state.phase)
        // Ko uporabnikov klic mine, se linija znova oceni in zajem zacne.
        sim.foreignCallRemoved()
        assertTrue("recheck:$X" in sim.calls)
        assertClean(sim)
        assertEquals(X, sim.session)
        assertEquals(Phase.CAPTURING, sim.state.phase)
    }

    @Test
    fun `N10-1 uporabnikov klic med startom zajem ustavi stop za startom`() {
        val sim = CaptureSim()
        sim.activate()
        sim.runPrep()
        sim.runOps(true) {
            sim.wLive = true
            sim.driver.post(Event.UnsafeDownlink)
        }
        // Lupina je sejo odprla, a avtomat je ne pricakuje in stop je ze v vrsti.
        assertEquals(X, sim.session)
        assertNull(sim.state.view.expected)
        assertEquals(emptyList(), sim.stableViolations())
        sim.runOps()
        assertNull(sim.session)
        // Krog najema seje ne potrdi.
        sim.tick()
        sim.runLease()
        assertFalse(sim.calls.any { it.startsWith("confirm") })
        assertClean(sim)
        assertNull(sim.session)
    }

    @Test
    fun `N11-1 cakajoci klic ki se konca med startom ne utisa Lininega klica`() {
        val sim = CaptureSim()
        sim.activate()
        sim.runPrep()
        sim.foreignCallRemoved()
        assertEquals(Phase.STARTING, sim.state.phase)
        assertClean(sim)
        assertEquals(X, sim.session)
        assertEquals(Phase.CAPTURING, sim.state.phase)
        assertFalse(sim.gaveBack)
        sim.tick()
        sim.runLease()
        assertEquals("confirm:$X", sim.calls.last { it.startsWith("confirm") })
    }

    @Test
    fun `vrnitev klica izvede korake v vrstnem redu in stop pred izhodom`() {
        val sim = capturing()
        sim.calls.clear()
        sim.shellLosesSession()
        sim.tick()
        sim.runLease()
        assertTrue(sim.settle())
        val order = sim.calls.filter { !it.startsWith("ping") }
        assertEquals(
            listOf("markManual:$X", "notifyServer:$X", "stop:*", "exit:$X", "notice:audio_returned"),
            order,
        )
        assertEquals(listOf(ReturnNotice.RETURNED), sim.notices)
        assertEquals(emptyList(), sim.settledViolations())
    }

    @Test
    fun `d tih klic v AUDIO_PROCESSING se prekine in obvestilo to pove`() {
        val sim = capturing()
        sim.shellLosesSession()
        sim.tick()
        sim.runLease()
        assertEquals(listOf("markManual:$X", "notifyServer:$X"), sim.calls.takeLast(2))
        sim.runOps() // stop
        sim.runOps(ok = false) // izhod iz ozadja ne uspe
        assertEquals(Effect.Disconnect(X), sim.opsLabels.first())
        sim.runOps()
        sim.runOps()
        assertEquals(listOf(ReturnNotice.DISCONNECTED), sim.notices)
        assertFalse(sim.xPresent)
        assertEquals(emptyList(), sim.violations)
    }

    @Test
    fun `d disconnect ki vrze pomeni tih klic ne prekinjenega`() {
        val sim = capturing()
        sim.shellLosesSession()
        sim.tick()
        sim.runLease()
        sim.runOps()
        sim.runOps(ok = false)
        sim.disconnectThrows = true
        sim.runOps()
        sim.runOps()
        assertEquals(listOf(ReturnNotice.NOT_RETURNED), sim.notices)
        assertTrue(sim.xPresent)
        assertEquals(emptyList(), sim.violations)
    }

    @Test
    fun `d API 29 izhod ne uspe klic ostane ziv in obvestilo pravi da je na slusalki`() {
        val sim = capturing(api29 = true)
        sim.shellLosesSession()
        sim.tick()
        sim.runLease()
        assertTrue(sim.settle())
        assertFalse(sim.calls.any { it.startsWith("disconnect") })
        assertTrue(sim.xPresent)
        assertEquals(listOf(ReturnNotice.RETURNED), sim.notices)
        assertEquals(emptyList(), sim.settledViolations())
    }

    @Test
    fun `c stop se ponavlja do roka in neuspeh se vrne avtomatu`() {
        val sim = capturing()
        sim.calls.clear()
        sim.userCallLive()
        sim.runOps(ok = false)
        // Rok 1000 ms, premor 50 ms: prvi poskus in ponovitve do roka.
        assertEquals(21, sim.calls.count { it == "stop:*" })
        assertEquals(StopDebt.OWED, sim.state.stop)
        assertEquals(X, sim.session)
        // Varna rezerva: krog najema ne potrdi seje in stop ponovi.
        sim.tick()
        sim.runLease()
        assertFalse(sim.calls.any { it.startsWith("confirm") })
        assertTrue(sim.opsLabels.first() is Effect.StopCapture)
        sim.runOps()
        assertNull(sim.session)
        assertEquals(StopDebt.SETTLED, sim.state.stop)
    }

    @Test
    fun `c stop ki uspe v prvem poskusu se ne ponavlja`() {
        val sim = capturing()
        sim.calls.clear()
        sim.xRemoved()
        sim.runOps()
        assertEquals(listOf("stop:$X"), sim.calls)
        assertNull(sim.session)
        assertEquals(StopDebt.SETTLED, sim.state.stop)
    }

    @Test
    fun `e najem potrdi sejo samo med zajemom`() {
        val sim = capturing()
        sim.tick()
        sim.runLease()
        sim.runLease()
        assertEquals(1, sim.calls.count { it == "confirm:$X" })
        // Uporabnik prevzame klic med pingom: odgovor je zastarel in ne potrdi nicesar.
        sim.calls.clear()
        sim.tick()
        sim.runLease(true) {
            sim.xOwned = false
            sim.driver.post(Event.CallEnded(X))
        }
        assertTrue(sim.leaseLabels.isEmpty())
        assertFalse(sim.calls.any { it.startsWith("confirm") })
    }

    @Test
    fun `izjema v vratih je neuspeh in ne izgubljen izid`() {
        val ports = object : CapturePorts {
            override fun prepare(callId: String): Boolean = throw IllegalStateException("nastavitve")
            override fun linePermits(callId: String): Boolean = true
            override fun start(callId: String): Boolean = true
            override fun stop(callId: String?, timeoutMs: Int): Boolean = true
            override fun markManual(callId: String) = throw IllegalStateException("gate")
            override fun notifyServerEnded(callId: String) = Unit
            override fun exitBackgroundAudio(callId: String, attemptExit: Boolean): CapturePorts.ExitFacts =
                throw IllegalStateException("telecom")
            override fun disconnect(callId: String): Boolean = true
            override fun ping(): CapturePorts.PingFacts = throw IllegalStateException("lupina")
            override fun confirm(callId: String) = Unit
            override fun showNotice(notice: ReturnNotice) = Unit
            override fun publishShellLost() = Unit
            override fun cancelShellLost() = Unit
            override fun relaunchShell() = Unit
            override fun recheckLine(callId: String) = Unit
            override fun nowMs(): Long = 0
            override fun sleep(ms: Long) = Unit
        }
        val direct = java.util.concurrent.Executor { it.run() }
        val seen = mutableListOf<Event>()
        var last = State()
        val driver = CaptureDriver(ports, direct, direct, direct, direct, { _, task -> task.run() }) { _, event, step ->
            seen += event
            last = step.state
        }
        driver.post(Event.CallActive(X))
        driver.post(Event.LeaseDue)
        assertTrue(Event.Prepared(X, 1, ok = false) in seen)
        assertTrue(Event.ExitResult(X, callPresent = false, exitOk = false, callState = 0) in seen)
        assertTrue(seen.any { it is Event.LeasePinged && !it.pingOk })
        assertEquals(Phase.IDLE, last.phase)
    }

    @Test
    fun `prave niti prehodi so zaporedni in koncno stanje je zlozitev dogodkov`() {
        val queue = Executors.newSingleThreadExecutor()
        val worker = Executors.newSingleThreadExecutor()
        val order = mutableListOf<Event>()
        var last = State()
        var inside = 0
        var overlap = false
        val driver = CaptureDriver(
            ports = object : CapturePorts {
                override fun prepare(callId: String) = true
                override fun linePermits(callId: String) = true
                override fun start(callId: String) = true
                override fun stop(callId: String?, timeoutMs: Int) = true
                override fun markManual(callId: String) = Unit
                override fun notifyServerEnded(callId: String) = Unit
                override fun exitBackgroundAudio(callId: String, attemptExit: Boolean) =
                    CapturePorts.ExitFacts(callPresent = true, exitOk = true, callState = CaptureSim.ACTIVE)
                override fun disconnect(callId: String) = true
                override fun ping() = CapturePorts.PingFacts(ok = true, reported = null, paired = true, wifi = true)
                override fun confirm(callId: String) = Unit
                override fun showNotice(notice: ReturnNotice) = Unit
                override fun publishShellLost() = Unit
                override fun cancelShellLost() = Unit
                override fun relaunchShell() = Unit
                override fun recheckLine(callId: String) = Unit
                override fun nowMs(): Long = 0
                override fun sleep(ms: Long) = Unit
            },
            queue = queue,
            shellOps = worker,
            prep = worker,
            lease = worker,
            later = { _, task -> worker.execute(task) },
        ) { _, event, step ->
            // Tece samo na niti vrste: ce bi prehod tekel na dveh nitih hkrati, bi se stevec prekril.
            if (inside++ != 0) overlap = true
            order += event
            last = step.state
            inside--
        }
        val posters = 4
        val done = CountDownLatch(posters)
        repeat(posters) { n ->
            Thread {
                repeat(500) { i ->
                    driver.post(
                        when ((i + n) % 5) {
                            0 -> Event.CallActive(X)
                            1 -> Event.UnsafeDownlink
                            2 -> Event.CallEnded(W)
                            3 -> Event.LeaseDue
                            else -> Event.CallEnded(X)
                        },
                    )
                }
                done.countDown()
            }.start()
        }
        assertTrue(done.await(30, TimeUnit.SECONDS))
        // Umiritev brez spanja: prehod cez delavca in nato cez vrsto, dokler krog ne prinese novega dogodka.
        fun round(): Int {
            worker.submit { }.get(30, TimeUnit.SECONDS)
            return queue.submit<Int> { order.size }.get(30, TimeUnit.SECONDS)
        }
        var count = round()
        while (true) {
            val next = round()
            if (next == count) break
            count = next
        }
        worker.shutdown()
        queue.shutdown()
        assertTrue(worker.awaitTermination(30, TimeUnit.SECONDS))
        assertTrue(queue.awaitTermination(30, TimeUnit.SECONDS))
        assertFalse(overlap)
        assertTrue(order.size >= posters * 500)
        assertEquals(order.fold(State()) { state, event -> CaptureMachine.reduce(state, event).state }, last)
    }
}
