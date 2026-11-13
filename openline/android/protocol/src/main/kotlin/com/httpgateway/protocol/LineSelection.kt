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
