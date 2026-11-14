package si.safeer.lina.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Krog 13: logika, izvlecena iz modula app (ozicenje brez preizkusov), in vrata lupine. */
class Krog13AuditTest {
    private val x = "klic-x"
    private val w = "klic-w"
    private fun lina(state: Int) = LineCall(x, ownedByLina = true, androidState = state)
    private fun user(state: Int) = LineCall(w, ownedByLina = false, androidState = state)

    @Test
    fun `stanje Telecoma se preslika v stanje zajema`() {
        assertEquals(AudioCallState.ACTIVE, CallLineFacts.audioState(TelecomPhase.STATE_ACTIVE))
        assertEquals(AudioCallState.HOLDING, CallLineFacts.audioState(TelecomPhase.STATE_HOLDING))
        assertEquals(AudioCallState.AUDIO_PROCESSING, CallLineFacts.audioState(TelecomPhase.STATE_AUDIO_PROCESSING))
        assertEquals(AudioCallState.ENDING, CallLineFacts.audioState(TelecomPhase.STATE_DISCONNECTING))
        assertEquals(AudioCallState.ENDING, CallLineFacts.audioState(TelecomPhase.STATE_DISCONNECTED))
        for (other in listOf(TelecomPhase.STATE_DIALING, TelecomPhase.STATE_RINGING, TelecomPhase.STATE_CONNECTING, 0, 99)) {
            assertEquals(AudioCallState.OTHER, CallLineFacts.audioState(other), "$other")
        }
    }

    @Test
    fun `drug ziv klic ki ni Linin`() {
        assertFalse(CallLineFacts.otherLiveNotLina(listOf(lina(TelecomPhase.STATE_ACTIVE)), x))
        for (state in listOf(
            TelecomPhase.STATE_ACTIVE, TelecomPhase.STATE_DIALING, TelecomPhase.STATE_CONNECTING,
            TelecomPhase.STATE_HOLDING, TelecomPhase.STATE_RINGING,
        )) {
            assertTrue(CallLineFacts.otherLiveNotLina(listOf(lina(TelecomPhase.STATE_ACTIVE), user(state)), x), "$state")
        }
        // Koncan klic in drug Linin klic ne stejeta.
        assertFalse(CallLineFacts.otherLiveNotLina(listOf(lina(4), user(TelecomPhase.STATE_DISCONNECTED)), x))
        assertFalse(CallLineFacts.otherLiveNotLina(listOf(lina(4), LineCall(w, true, TelecomPhase.STATE_ACTIVE)), x))
        // Klic sam sebi ni drug klic, tudi ce ni vec Linin.
        assertFalse(CallLineFacts.otherLiveNotLina(listOf(LineCall(x, false, TelecomPhase.STATE_ACTIVE)), x))
    }

    @Test
    fun `zajem dovoli samo Linin klic na prosti liniji`() {
        assertTrue(CallLineFacts.permitsCapture(listOf(lina(TelecomPhase.STATE_AUDIO_PROCESSING)), x))
        assertTrue(CallLineFacts.permitsCapture(listOf(lina(TelecomPhase.STATE_ACTIVE)), x))
        assertFalse(CallLineFacts.permitsCapture(listOf(lina(TelecomPhase.STATE_HOLDING)), x))
        assertFalse(CallLineFacts.permitsCapture(listOf(lina(TelecomPhase.STATE_DISCONNECTED)), x))
        // Klica ni v registru.
        assertFalse(CallLineFacts.permitsCapture(emptyList(), x))
        assertFalse(CallLineFacts.permitsCapture(listOf(user(TelecomPhase.STATE_ACTIVE)), x))
        // Klic ni vec Linin.
        assertFalse(CallLineFacts.permitsCapture(listOf(LineCall(x, false, TelecomPhase.STATE_ACTIVE)), x))
        // Uporabnikov klic na liniji.
        assertFalse(CallLineFacts.permitsCapture(listOf(lina(12), user(TelecomPhase.STATE_ACTIVE)), x))
        assertFalse(CallLineFacts.permitsCapture(listOf(lina(12), user(TelecomPhase.STATE_DIALING)), x))
        // Koncan uporabnikov klic linije ne zaseda vec.
        assertTrue(CallLineFacts.permitsCapture(listOf(lina(12), user(TelecomPhase.STATE_DISCONNECTED)), x))
    }

    @Test
    fun `N12-2 klic ki zvoni Lininemu klicu ne zasede linije`() {
        // Od kroga 14 (N13-2) ne zasede linije samo klic, ki ga je storitev ze zavrnila z zasedenim znakom.
        val ringing = LineCall(w, ownedByLina = false, androidState = TelecomPhase.STATE_RINGING, rejectedBusy = true)
        assertFalse(CallLineFacts.blocksCapture(listOf(lina(12), ringing), x))
        assertTrue(CallLineFacts.permitsCapture(listOf(lina(12), ringing), x))
        assertTrue(
            CallLineFacts.permitsCapture(
                listOf(lina(12), LineCall(w, false, TelecomPhase.STATE_SIMULATED_RINGING, rejectedBusy = true)),
                x,
            ),
        )
        // Za odlocitev o PREVZEMU se zvoneci klic se vedno steje (TakeoverPolicy, nespremenjeno).
        assertTrue(CallLineFacts.otherLiveNotLina(listOf(lina(12), ringing), x))
        // Vse drugo linijo zasede kot prej: uporabnik ima prednost, tudi ko sele klice (odhodni klic).
        for (state in listOf(TelecomPhase.STATE_ACTIVE, TelecomPhase.STATE_DIALING, TelecomPhase.STATE_CONNECTING, TelecomPhase.STATE_HOLDING)) {
            assertTrue(CallLineFacts.blocksCapture(listOf(lina(12), user(state)), x), "$state")
            assertFalse(CallLineFacts.permitsCapture(listOf(lina(12), user(state)), x), "$state")
        }
    }

    @Test
    fun `odlocitev lastnika drug dohodni klic med Lininim dobi zaseden znak`() {
        val ringing = user(TelecomPhase.STATE_RINGING)
        fun reject(calls: List<LineCall>, candidate: LineCall = ringing, incoming: Boolean = true, emergency: Boolean = false) =
            SecondCallPolicy.rejectAsBusy(candidate, incoming, emergency, calls + candidate)
        // Lina govori (zajem, priprava, start, tudi klic na cakanju): zavrni.
        for (state in listOf(TelecomPhase.STATE_AUDIO_PROCESSING, TelecomPhase.STATE_ACTIVE, TelecomPhase.STATE_HOLDING)) {
            assertTrue(reject(listOf(lina(state))), "$state")
        }
        // Ni drugega klica ali Linin klic se ni sprejet oziroma je koncan: obicajno vedenje.
        assertFalse(reject(emptyList()))
        assertFalse(reject(listOf(lina(TelecomPhase.STATE_RINGING))))
        assertFalse(reject(listOf(lina(TelecomPhase.STATE_DISCONNECTED))))
        // Uporabnik govori sam (ali klice ven): odloca telefon, ne mi.
        val own = LineCall("klic-u", ownedByLina = false, androidState = TelecomPhase.STATE_ACTIVE)
        assertFalse(reject(listOf(own)))
        assertFalse(reject(listOf(lina(12), own)))
        assertFalse(reject(listOf(lina(12), own.copy(androidState = TelecomPhase.STATE_DIALING))))
        // Samo dohodni klic, ki zvoni; odhodni klic uporabnika in ze sprejet klic nikoli.
        assertFalse(reject(listOf(lina(12)), incoming = false))
        assertFalse(reject(listOf(lina(12)), candidate = user(TelecomPhase.STATE_DIALING)))
        assertFalse(reject(listOf(lina(12)), candidate = user(TelecomPhase.STATE_ACTIVE)))
        // Linin lastni klic in klic v sili se ne zavrneta.
        assertFalse(reject(listOf(lina(12)), candidate = LineCall(w, true, TelecomPhase.STATE_RINGING)))
        assertFalse(reject(listOf(lina(12)), emergency = true))
        // Drugi cakajoci klic med Lininim je prav tako zavrnjen.
        assertTrue(reject(listOf(lina(12), LineCall("klic-v", false, TelecomPhase.STATE_RINGING))))
    }

    @Test
    fun `N12-1 vrata lupine so zaprta do ukaza in se odprejo enkrat`() {
        val gate = UplinkGate()
        // Brez ukaza aplikacije ni povezave, torej ni okvirja.
        assertFalse(gate.isOpen)
        assertTrue(gate.open(), "prvo odprtje pove lupini, naj se poveze")
        assertTrue(gate.isOpen)
        assertFalse(gate.open(), "drugo odprtje ne sme odpreti druge povezave")
        assertTrue(gate.isOpen)
        // Nova seja dobi nova, zaprta vrata.
        assertFalse(UplinkGate().isOpen)
    }

    @Test
    fun `N12-1 ukaz open pride skozi razclenjevalnik lupine in velja samo za aktivno sejo`() {
        val op = ShellAuth.parseOp("""{"op":"open","callId":"klic-x"}""")
        assertEquals(mapOf("op" to "open", "callId" to "klic-x"), op)
        assertFalse(ShellAuth.requestCarriesSecrets("""{"op":"open","callId":"klic-x"}"""))
        assertTrue(ShellAuth.acceptConfirm("klic-x", "klic-x"))
        assertFalse(ShellAuth.acceptConfirm("klic-y", "klic-x"))
        assertFalse(ShellAuth.acceptConfirm(null, "klic-x"))
    }

    @Test
    fun `N12-4 ponovna ocena samo za klic ki ga Lina se ima`() {
        assertTrue(LineRecheck.shouldSync(ownedByLina = true))
        assertFalse(LineRecheck.shouldSync(ownedByLina = false))
    }

    @Test
    fun `N12-8 vrsta predvajanja na telefonu je omejena na 60 s`() {
        assertEquals(3_000, MediaStream.MAX_PLAYBACK_FRAMES)
        assertEquals(60_000, MediaStream.MAX_PLAYBACK_FRAMES * MediaStream.FRAME_MS)
        assertEquals(640, MediaStream.FRAME_BYTES)
    }
}
