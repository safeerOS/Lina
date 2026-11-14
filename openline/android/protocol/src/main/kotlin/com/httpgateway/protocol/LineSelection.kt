package com.httpgateway.protocol

data class Line(
    val id: String,
    val label: String,
    val isEsim: Boolean,
    val active: Boolean
)

object LineIdCodec {
    const val KEY_BYTES = 32

    // Neprozoren, stabilen identifikator linije. PhoneAccountHandle.id je pri SIM pogosto ICCID (malo moznosti - gol
    // SHA-256 se da preiskati, pregled 15). Zato HMAC-SHA256 z nakljucnim kljucem te namestitve: brez kljuca se ICCID
    // ne da izracunati in id ni sledilni identifikator med namestitvami. Izbrano linijo najdemo s ponovnim branjem seznama.
    fun encode(key: ByteArray, component: String, accountId: String): String {
        require(key.size >= KEY_BYTES) { "kljuc linije prekratek" }
        val mac = javax.crypto.Mac.getInstance("HmacSHA256")
        mac.init(javax.crypto.spec.SecretKeySpec(key, "HmacSHA256"))
        val digest = mac.doFinal("$component\n$accountId".toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }
}

sealed class LineSelectionResult {
    data class Use(val id: String) : LineSelectionResult()
    object Ambiguous : LineSelectionResult()
    data class Single(val id: String) : LineSelectionResult()
    /** Izbrana linija ni vec aktivna (brez signala, izklop, menjava eSIM): Lina ne prevzame klicev na drugi liniji. */
    object SavedUnavailable : LineSelectionResult()
    object None : LineSelectionResult()
    object Invalid : LineSelectionResult()
}

object LineSelection {
    fun choose(lines: List<Line>, saved: String?): LineSelectionResult {
        val ids = mutableSetOf<String>()
        for (line in lines) {
            if (line.id.isBlank() || line.label.isBlank()) return LineSelectionResult.Invalid
            if (!ids.add(line.id)) return LineSelectionResult.Invalid
        }

        val activeLines = lines.filter { it.active }

        if (activeLines.isEmpty()) {
            return LineSelectionResult.None
        }

        val savedActiveLine = activeLines.find { it.id == saved }
        if (savedActiveLine != null) {
            return LineSelectionResult.Use(savedActiveLine.id)
        }
        // Pregled 15 (N1): shranjena linija ni aktivna - nikoli samodejno druga linija (Single), uporabnik izbere znova.
        if (saved != null) {
            return LineSelectionResult.SavedUnavailable
        }

        if (activeLines.size == 1) {
            return LineSelectionResult.Single(activeLines.first().id)
        }

        return LineSelectionResult.Ambiguous
    }
}

/**
 * Pregled 16 (N1): ali Lina sme prevzeti klic na liniji callLineId. Samo ce izbira vrne Use ali Single za PRAV to linijo;
 * vec linij brez izbire, izbrana linija neaktivna, brez linij ali neveljaven seznam -> ne (klic zvoni samo na telefonu).
 */
object LineGate {
    fun allows(lines: List<Line>, saved: String?, callLineId: String?): Boolean {
        if (callLineId.isNullOrBlank()) return false
        return when (val r = LineSelection.choose(lines, saved)) {
            is LineSelectionResult.Use -> r.id == callLineId
            is LineSelectionResult.Single -> r.id == callLineId
            else -> false
        }
    }
}

enum class LineStatus { NO_PERMISSION, NONE, AMBIGUOUS, SAVED_UNAVAILABLE, INVALID, USING }

/** Kaj pokaze izbirnik linije v nastavitvah (N1, N4). Izbrati se da samo aktivno linijo. */
object LinePicker {
    data class View(val status: LineStatus, val usingLabel: String?, val choices: List<Line>, val selectedIndex: Int)

    fun view(permission: Boolean, lines: List<Line>, saved: String?): View {
        if (!permission) return View(LineStatus.NO_PERMISSION, null, emptyList(), -1)
        val choices = lines.filter { it.active }
        return when (val r = LineSelection.choose(lines, saved)) {
            is LineSelectionResult.Use -> View(LineStatus.USING, choices.first { it.id == r.id }.label, choices, choices.indexOfFirst { it.id == r.id })
            is LineSelectionResult.Single -> View(LineStatus.USING, choices.first { it.id == r.id }.label, choices, 0)
            LineSelectionResult.Ambiguous -> View(LineStatus.AMBIGUOUS, null, choices, -1)
            LineSelectionResult.SavedUnavailable -> View(LineStatus.SAVED_UNAVAILABLE, null, choices, -1)
            LineSelectionResult.None -> View(LineStatus.NONE, null, emptyList(), -1)
            LineSelectionResult.Invalid -> View(LineStatus.INVALID, null, emptyList(), -1)
        }
    }
}
