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
        // Po startu je seja pripravljena, povezava na streznik pa se zaprta (N12-1).
        assertFalse(sim.gateOpen)
        assertTrue(sim.runOps())
        assertTrue(sim.gateOpen)
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
        // Cakajoci klic zazvoni: storitev ne poslje dogodka, linija ga steje (N12-2).
        Move("cakajoci klic zazvoni", { !it.wLive && !it.wRinging }) { it.foreignCallRings() },
        // N13-2: klic v sili ali neuspela zavrnitev: klic zvoni in zasede linijo, Linin klic se zadrzi.
        Move("zvoneci klic brez zavrnitve zazvoni", { !it.wLive && !it.wRinging }) { it.foreignCallRings(rejected = false) },
        Move("tuj klic konec", { true }) { it.foreignCallRemoved() },
        Move("X odstranjen", { it.xPresent }) { it.xRemoved() },
        Move("uporabnik prevzame X", { it.xPresent && it.xOwned }) { it.userTakesX() },
        Move("X na cakanju", { it.xPresent && it.xOwned && !it.xHeld }) { it.xHeld() },
        Move("krog najema", { it.leaseLabels.none { l -> l is Effect.PingShell } }) { it.tick() },
        Move("priprava uspe", { it.prepLabels.isNotEmpty() }) { it.runPrep(true) },
        Move("priprava ne uspe", { it.prepLabels.firstOrNull() is Effect.Prepare }) { it.runPrep(false) },
        Move("lupina uspe", { it.opsLabels.isNotEmpty() }) { it.runOps(true) },
        Move("lupina ne uspe", { it.opsLabels.firstOrNull().let { l ->
            l is Effect.StartCapture || l is Effect.StopCapture || l is Effect.ExitBackgroundAudio || l is Effect.OpenUplink
        } }) { it.runOps(false) },
        Move("nujna nit uspe", { it.urgentLabels.isNotEmpty() }) { it.runUrgent(true) },
        Move("nujna nit ne uspe", { it.urgentLabels.firstOrNull().let { l ->
            l is Effect.ExitBackgroundAudio || l is Effect.Disconnect || l is Effect.UrgentStop
        } }) { it.runUrgent(false) },
        // N12-1: dogodek pride med startom in vrsta ga obdela takoj; nujni stop stece na prosti niti.
        Move("uporabnikov klic med startom z nujnim stopom", { it.opsLabels.firstOrNull() is Effect.StartCapture && !it.wLive }) { sim ->
            sim.runOps(true, during = { sim.wLive = true; sim.driver.post(Event.UnsafeDownlink); sim.settleQueue() })
        },
        // N12-4: linija se prebere na niti priprave ali lupine, tuj klic pa se konca, preden izid pride v vrsto.
        Move("tuj klic konec med branjem linije v pripravi", {
            it.prepLabels.firstOrNull() is Effect.Prepare && (it.wLive || it.wRinging)
        }) { sim ->
            sim.runPrep(true, afterPermit = { sim.wLive = false; sim.wRinging = false; sim.driver.post(Event.CallEnded(W)) })
        },
        Move("tuj klic konec med branjem linije pred startom", {
            it.opsLabels.firstOrNull() is Effect.StartCapture && (it.wLive || it.wRinging)
        }) { sim ->
            sim.runOps(true, afterPermit = { sim.wLive = false; sim.wRinging = false; sim.driver.post(Event.CallEnded(W)) })
        },
        // N12-6: rok starta potece, preden je zajem potrjen.
        Move("rok starta", { it.timerLabels.any { l -> l is Effect.ScheduleStartDeadline } }) { it.fireTimer(deadline = true) },
        // Dogodek sredi starta: lupina je sejo ze odprla, izid pa pride za dogodkom (N10-1).
        Move("uporabnikov klic med startom", { it.opsLabels.firstOrNull() is Effect.StartCapture && !it.wLive }) { sim ->
            sim.runOps(true, during = { sim.wLive = true; sim.driver.post(Event.UnsafeDownlink) })
        },
        Move("prevzem med startom", { it.opsLabels.firstOrNull() is Effect.StartCapture && it.xOwned }) { sim ->
            sim.runOps(true, during = { sim.xOwned = false; sim.xState = CaptureSim.ACTIVE; sim.driver.post(Event.CallEnded(X)) })
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
        Move("casovnik", { it.timerLabels.any { l -> l is Effect.ScheduleRetry } }) { it.fireTimer() },
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
                    if (moves[index].name == "cakajoci klic zazvoni" &&
                        (sim.state != probe.state || sim.permits(X) != probe.permits(X) || sim.session != probe.session)
                    ) {
                        fail("zvonjenje cakajocega klica je spremenilo Linin klic po korakih [${path.joinToString(" > ") { moves[it].name }}]")
                    }
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
    fun `vsa prepletanja do dolzine 8 ohranijo invariante a b c d`() {
        val reached = explore(api29 = false, depth = 8)
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
    fun `vsa prepletanja do dolzine 7 od potrjenega zajema ohranijo invariante`() {
        // Do potrjenega zajema z odprto povezavo so stiri poteze. Od tam se sedem: padec seje, dva zgresena pinga, vrnitev, nov klic.
        val reached = explore(api29 = false, depth = 7, start = listOf("X aktiven", "priprava uspe", "lupina uspe", "lupina uspe"))
        for (key in listOf("vrnitev", "dolg", "recheck", "disconnect", "notice:audio_returned", "notice:call_disconnected")) {
            assertTrue((reached[key] ?: 0) > 0, "preiskava ni dosegla: $key ($reached)")
        }
        assertTrue(reached.getValue("stanja") > 2_000, "stanj: ${reached["stanja"]}")
    }

    @Test
    fun `vsa prepletanja na API 29 klica nikoli ne prekinejo`() {
        val reached = explore(api29 = true, depth = 7)
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
        sim.runOps(true, during = {
            sim.wLive = true
            sim.driver.post(Event.UnsafeDownlink)
        })
        // Lupina je sejo odprla, a avtomat je ne pricakuje in stop je ze v vrsti.
        assertFalse(sim.gateOpen)
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
        assertEquals(Effect.Disconnect(X), sim.urgentLabels.first())
        sim.runUrgent()
        sim.runUrgent()
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
        sim.runUrgent()
        sim.runUrgent()
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

    // ---- Krog 13: najdbe dvanajstega pregleda ---------------------------------------------

    @Test
    fun `N12-1 med startom ki visi nujni stop pride do lupine in noben okvir ne gre na streznik`() {
        // Izhodisce: Pregled12DemoTest P12-1. Tam je bilo med startom 0 stopov in 5 s odprtega zajema.
        val sim = CaptureSim()
        sim.activate()
        sim.runPrep()
        assertEquals(Phase.STARTING, sim.state.phase)
        var stopsDuringStart = -1
        var sessionDuringStart: String? = "?"
        var gateDuringStart = true
        sim.runOps(true, during = {
            // Lupina je sejo ze pripravila, odgovor zamuja; uporabnik dvigne svoj klic W.
            sim.wLive = true
            sim.driver.post(Event.UnsafeDownlink)
            sim.settleQueue()
            stopsDuringStart = sim.calls.count { it.startsWith("stop:") }
            sessionDuringStart = sim.session
            gateDuringStart = sim.gateOpen
        })
        assertEquals(1, stopsDuringStart, "nujni stop mora priti do lupine med startom")
        assertNull(sessionDuringStart)
        assertFalse(gateDuringStart)
        // Povezava na streznik se ni odprla niti enkrat: okvirjev uporabnikovega klica ni.
        assertTrue(sim.settle())
        assertFalse(sim.calls.any { it.startsWith("open:") })
        assertEquals(emptyList(), sim.settledViolations())
    }

    @Test
    fun `N12-1 brez nujnega stopa povezava ostane zaprta do potrjenega zajema`() {
        // Tudi ce nujni stop zamudi (dogodek pride tik pred odgovorom lupine), okvirjev ni: seja je zaprta.
        val sim = CaptureSim()
        sim.activate()
        sim.runPrep()
        sim.runOps(true, during = { sim.wLive = true; sim.driver.post(Event.UnsafeDownlink) })
        assertEquals(X, sim.session)
        assertFalse(sim.gateOpen)
        assertFalse(sim.opsLabels.any { it is Effect.OpenUplink })
        assertTrue(sim.settle())
        assertFalse(sim.calls.any { it.startsWith("open:") })
    }

    @Test
    fun `N12-1 linija se preveri se tik pred odprtjem povezave`() {
        val sim = CaptureSim()
        sim.activate()
        sim.runPrep()
        sim.runOps()
        assertEquals(Effect.OpenUplink(X, sim.state.generation), sim.opsLabels.first())
        // Uporabnik dvigne svoj klic med izidom starta in odprtjem; storitev dogodka se ni poslala.
        sim.wLive = true
        sim.runOps()
        assertFalse(sim.calls.any { it.startsWith("open:") })
        assertFalse(sim.gateOpen)
        assertEquals(Phase.SUSPENDED, sim.state.phase)
        sim.runOps()
        assertNull(sim.session)
    }

    @Test
    fun `N12-1 zakasnel nujni stop ne ustavi starta novejse generacije`() {
        val sim = CaptureSim()
        sim.activate()
        sim.runPrep()
        // Prvi start je pri lupini, uporabnik da klic na cakanje in ga takoj vrne: nujni stop caka v vrsti.
        var stale: Runnable? = null
        sim.runOps(true, during = {
            sim.xHeld = true
            sim.driver.post(Event.CallSuspended(X))
            sim.queue.runAll()
            stale = sim.urgent.tasks.removeFirst()
            sim.urgentLabels.removeFirst()
        })
        // Urejena stopa prvega starta (ob preklicu in ob zastarelem izidu).
        while (sim.opsLabels.firstOrNull() is Effect.StopCapture) assertTrue(sim.runOps())
        assertNull(sim.session)
        sim.activate()
        sim.runPrep()
        var sessionAfterStale: String? = null
        sim.runOps(true, during = {
            stale!!.run()
            sessionAfterStale = sim.session
        })
        assertEquals(X, sessionAfterStale, "nujni stop starejse generacije je ustavil nov start")
        assertTrue(sim.settle())
        assertEquals(emptyList(), sim.settledViolations())
        assertEquals(X, sim.session)
        assertTrue(sim.gateOpen)
    }

    @Test
    fun `N12-1 nujni stop se lupini ne poslje ce start ni v teku`() {
        val sim = capturing()
        sim.calls.clear()
        sim.userCallLive()
        // Urejena nit je prosta: stop je prvi v njeni vrsti, nujna nit lupine ne klice.
        assertEquals(emptyList(), sim.calls)
        assertTrue(sim.opsLabels.first() is Effect.StopCapture)
        sim.runOps()
        assertEquals(listOf("stop:*"), sim.calls)
        assertNull(sim.session)
        assertFalse(sim.gateOpen)
    }

    @Test
    fun `N12-4 dovoljenje prebrano pred koncem tujega klica ne pusti Lininega klica tihega`() {
        // Izhodisce: Pregled12DemoTest P12-2. Tam je klic po petih krogih najema ostal SUSPENDED brez ponovne ocene.
        val sim = CaptureSim()
        sim.activate()
        assertEquals(Phase.PREPARING, sim.state.phase)
        // Uporabnik klice ven (DIALING): storitev zanj ne poslje dogodka, linija pa je zasedena.
        sim.wLive = true
        sim.calls.clear()
        // Nit priprave prebere linijo; uporabnik odneha in W izgine, preden izid pride v vrsto.
        sim.runPrep(true, afterPermit = {
            sim.wLive = false
            sim.driver.post(Event.CallEnded(W))
        })
        assertEquals(Phase.SUSPENDED, sim.state.phase)
        assertTrue(sim.permits(X), "linija je prosta in klic je Linin")
        assertFalse(sim.calls.any { it.startsWith("recheck") })
        // Prvi krog najema klic oceni znova in zajem se zacne.
        sim.tick()
        sim.runLease()
        assertTrue("recheck:$X" in sim.calls)
        assertTrue(sim.settle())
        assertEquals(Phase.CAPTURING, sim.state.phase)
        assertEquals(X, sim.session)
        assertTrue(sim.gateOpen)
        assertFalse(sim.gaveBack)
    }

    @Test
    fun `N12-5 izjema v izhodu iz ozadja najprej poskusi prekinitev in obvestilo sledi izidu`() {
        // Izhodisce: Pregled12DemoTest P12-4. Tam je bilo obvestilo »klic prekinjen« brez klica disconnect.
        for (disconnectWorks in listOf(true, false)) {
            val sim = capturing()
            sim.shellLosesSession()
            sim.exitThrows = true
            sim.tick()
            sim.runLease()
            sim.runOps() // stop
            sim.calls.clear()
            sim.runOps() // izhod iz ozadja vrze
            assertEquals(listOf("exit:$X"), sim.calls)
            assertEquals(Effect.Disconnect(X), sim.urgentLabels.first())
            sim.runUrgent(ok = disconnectWorks)
            sim.runUrgent()
            assertEquals(listOf("exit:$X", "disconnect:$X"), sim.calls.filter { !it.startsWith("notice") })
            val expected = if (disconnectWorks) ReturnNotice.DISCONNECTED else ReturnNotice.NOT_RETURNED
            assertEquals(listOf(expected), sim.notices)
        }
    }

    @Test
    fun `N12-6 lupina ki visi ob startu klic se vrne ob roku in ne po koncu starta`() {
        val sim = CaptureSim()
        sim.activate()
        sim.runPrep()
        val order = mutableListOf<String>()
        sim.runOps(true, during = {
            // Start visi. Rok 6 s potece; izhod iz ozadja mora steci zdaj, na loceni niti.
            sim.fireTimer(deadline = true)
            assertEquals(Phase.IDLE, sim.state.phase)
            assertTrue(sim.runUrgent()) // nujni stop: start je se pri lupini
            assertTrue(sim.runUrgent()) // izhod iz ozadja
            order += sim.calls.filter { it.startsWith("markManual") || it.startsWith("exit") || it.startsWith("stop") }
            assertTrue(sim.runUrgent()) // obvestilo
        })
        // Med startom: klic oznacen, nujni stop pri lupini, izhod izveden; povezava ni bila odprta.
        assertEquals(listOf("markManual:$X", "stop:*", "exit:$X"), order)
        assertEquals(listOf(ReturnNotice.RETURNED), sim.notices)
        assertFalse(sim.calls.any { it.startsWith("open:") })
        assertTrue(sim.settle())
        assertNull(sim.session)
        assertEquals(emptyList(), sim.settledViolations())
    }

    @Test
    fun `N12-6 izhod po roku ima pred sabo poskus stopa tudi ce je stara seja se odprta`() {
        // Potrjen zajem; uporabnik dvigne svoj klic in ga takoj konca, urejeni stop pa se ni stekel.
        val sim = capturing()
        sim.userCallLive()
        sim.foreignCallRemoved()
        assertEquals(Phase.PREPARING, sim.state.phase)
        assertEquals(X, sim.session)
        assertTrue(sim.gateOpen)
        sim.calls.clear()
        // Priprava visi, rok potece. Start ni pri lupini, zato mora biti nujni stop prisilen.
        sim.fireTimer(deadline = true)
        assertTrue(sim.runUrgent())
        assertTrue(sim.runUrgent())
        assertEquals(listOf("markManual:$X", "notifyServer:$X", "stop:*", "exit:$X"), sim.calls.filter { it != "prepare:$X" })
        assertEquals(emptyList(), sim.violations)
        assertNull(sim.session)
    }

    @Test
    fun `N12-6 priprava ki visi klic se vrne ob roku`() {
        val sim = CaptureSim()
        sim.activate()
        assertEquals(Phase.PREPARING, sim.state.phase)
        sim.fireTimer(deadline = true)
        assertEquals(Phase.IDLE, sim.state.phase)
        assertTrue(sim.gaveBack)
        // Priprava se konca pozneje: starta ni.
        assertTrue(sim.settle())
        assertFalse(sim.calls.any { it.startsWith("start:") })
        assertEquals(listOf(ReturnNotice.RETURNED), sim.notices)
    }

    @Test
    fun `N12-7 linija se prebere po pripravi in ne pred njo`() {
        // Mutacija P24 dvanajstega pregleda (linija prebrana PRED pripravo) je prezivela.
        val sim = CaptureSim()
        sim.activate()
        // Uporabnik dvigne svoj klic MED pripravo; storitev dogodka se ni poslala.
        sim.runPrep(true, duringPrepare = { sim.wLive = true })
        val prepared = sim.trace.map { it.second }.filterIsInstance<Event.Prepared>().single()
        assertFalse(prepared.permitted, "linija je bila prebrana pred pripravo")
        assertEquals(Phase.SUSPENDED, sim.state.phase)
        assertTrue(sim.trace.none { step -> step.third.effects.any { it is Effect.StartCapture } })
        assertTrue(sim.calls.indexOf("prepare:$X") >= 0)
    }

    @Test
    fun `N12-2 cakajoci klic ki zvoni ne zadrzi starta in ne ustavi zajema`() {
        // Odlocitev lastnika 10. 11. 2026 (»Telefon zmore le en telefonski klic naenkrat«): drug dohodni klic
        // med Lininim dobi zaseden znak. Dokler Telecom zavrnitve ne izvede, klic se zvoni; ta cas Lininemu
        // klicu ne sme vzeti linije. Prej (pregled 12): start zadrzan, klicatelj v tisini do konca zvonjenja.
        val early = CaptureSim()
        early.activate()
        early.foreignCallRings()
        early.runPrep()
        assertEquals(Phase.STARTING, early.state.phase)
        early.runOps()
        early.runOps()
        assertEquals(Phase.CAPTURING, early.state.phase)
        assertTrue(early.gateOpen)
        assertFalse(early.calls.any { it.startsWith("recheck") || it.startsWith("stop:") })
        // Zavrnjeni klic izgine: Linin klic se ne spremeni.
        early.foreignCallRemoved()
        assertTrue(early.settle())
        assertEquals(Phase.CAPTURING, early.state.phase)
        assertEquals(X, early.session)
        assertTrue(early.gateOpen)
        assertFalse(early.gaveBack)
        assertEquals(emptyList(), early.settledViolations())

        // Isti klic med potrjenim zajemom: nic se ne ustavi.
        val late = capturing()
        late.calls.clear()
        late.foreignCallRings()
        repeat(3) {
            late.tick()
            assertTrue(late.settle())
        }
        late.foreignCallRemoved()
        assertTrue(late.settle())
        assertEquals(Phase.CAPTURING, late.state.phase)
        assertTrue(late.gateOpen)
        assertEquals(listOf("stop:$W"), late.calls.filter { it.startsWith("stop:") })
        assertEquals(emptyList(), late.settledViolations())
    }

    // ---- Krog 14: najdbe 13. pregleda -----------------------------------------------------

    @Test
    fun `N13-1 open ki vztrajno ne uspe klic se vrne uporabniku po omejenem stevilu poskusov`() {
        val sim = CaptureSim()
        sim.activate()
        var rounds = 0
        while (!sim.gaveBack && rounds++ < 12) {
            sim.runPrep()
            while (sim.ops.tasks.isNotEmpty()) {
                val next = sim.opsLabels.first()
                sim.runOps(openFails = next is Effect.OpenUplink)
            }
            sim.runUrgent()
            // Krog najema: storitev klic zadrzan ponovno oceni in znova poslje START.
            sim.tick()
            sim.runLease()
        }
        assertTrue(sim.gaveBack, "po $rounds krogih klic ni vrnjen: klicatelj bi bil tih do konca klica")
        assertEquals(2, sim.calls.count { it.startsWith("open:") })
        assertTrue(sim.settle())
        assertEquals(emptyList(), sim.settledViolations().filterNot { it.startsWith("Linin klic je tih") })
    }

    @Test
    fun `N14-2 open pri zasedeni liniji ne steje kot neuspeh in klic se ne vrne`() {
        val sim = CaptureSim()
        sim.activate()
        sim.runPrep()
        sim.runOps()
        assertTrue(sim.opsLabels.first() is Effect.OpenUplink)
        // Uporabnik dvigne svoj klic tik pred odprtjem: linePermits=false, open sploh ni poskusen.
        sim.wLive = true
        sim.runOps()
        assertFalse(sim.calls.any { it.startsWith("open:") }, "open ne sme teci na zasedeni liniji")
        assertEquals(Phase.SUSPENDED, sim.state.phase)
        assertEquals(0, sim.state.openFailures, "zasedena linija ni napaka odprtja")
        assertFalse(sim.gaveBack, "klic ne sme na slusalko, ko je uporabnik na drugem klicu")
    }

    @Test
    fun `N13-4 nujni stop pride do lupine tudi med odprtjem povezave`() {
        val sim = CaptureSim()
        sim.activate()
        sim.runPrep()
        sim.runOps()
        assertTrue(sim.opsLabels.first() is Effect.OpenUplink)
        var stopsDuringOpen = -1
        sim.duringOpen = {
            // Uporabnik dvigne svoj klic, medtem ko lupina odpira povezavo; urejeni stop bi cakal za open.
            sim.wLive = true
            sim.driver.post(Event.UnsafeDownlink)
            sim.settleQueue()
            stopsDuringOpen = sim.calls.count { it.startsWith("stop:") }
        }
        sim.runOps()
        assertEquals(1, stopsDuringOpen, "nujni stop mora priti do lupine med odprtjem")
        assertFalse(sim.gateOpen)
        assertNull(sim.session)
        assertTrue(sim.settle())
        assertEquals(emptyList(), sim.settledViolations())
    }

    @Test
    fun `N13-2 klic ki zvoni in ni zavrnjen ustavi zajem takoj in ga po koncu zvonjenja nadaljuje`() {
        val sim = capturing()
        sim.calls.clear()
        // Klic v sili ali neuspela zavrnitev: zvoni, uporabnik ga lahko dvigne ali pa zvok klica gre kam drugam.
        sim.foreignCallRings(rejected = false)
        assertEquals(Phase.SUSPENDED, sim.state.phase)
        assertTrue(sim.calls.contains("stop:$X") || sim.opsLabels.any { it is Effect.StopCapture })
        assertTrue(sim.settle())
        assertNull(sim.session)
        assertFalse(sim.gateOpen)
        assertFalse(sim.gaveBack, "Linin klic ostane Linin, samo brez zajema")
        // Zvonjenje se konca: zajem se po krogu najema nadaljuje.
        sim.foreignCallRemoved()
        assertTrue(sim.settle())
        assertEquals(Phase.CAPTURING, sim.state.phase)
        assertEquals(X, sim.session)
        assertTrue(sim.gateOpen)
        assertEquals(emptyList(), sim.settledViolations())
    }

    @Test
    fun `N13-2 zavrnjen klic ki se zvoni zajema ne ustavi`() {
        val sim = capturing()
        sim.calls.clear()
        sim.foreignCallRings(rejected = true)
        assertTrue(sim.settle())
        assertEquals(Phase.CAPTURING, sim.state.phase)
        assertTrue(sim.calls.none { it.startsWith("stop:") && it != "stop:$W" })
        assertEquals(emptyList(), sim.settledViolations())
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
            override fun openUplink(callId: String): Boolean = throw IllegalStateException("lupina")
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
        // Casovniki se ne sprozijo: rok starta bi sicer potekel takoj.
        val driver = CaptureDriver(ports, direct, direct, direct, direct, direct, { _, _ -> }) { _, event, step ->
            seen += event
            last = step.state
        }
        driver.post(Event.CallActive(X))
        driver.post(Event.LeaseDue)
        assertTrue(Event.Prepared(X, 1, ok = false) in seen)
        // Krog 13 (N12-5): izjema v izhodu iz ozadja ni vec »klica ni«. Varna domneva je tih klic v
        // AUDIO_PROCESSING, zato sledi poskus prekinitve in sele nato obvestilo.
        assertTrue(
            Event.ExitResult(X, callPresent = true, exitOk = false, callState = TelecomPhase.STATE_AUDIO_PROCESSING) in seen,
        )
        assertTrue(Event.DisconnectResult(X, ok = true) in seen)
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
                override fun openUplink(callId: String) = true
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
            urgent = worker,
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
