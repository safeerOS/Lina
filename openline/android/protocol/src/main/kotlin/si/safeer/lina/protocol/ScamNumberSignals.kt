package si.safeer.lina.protocol

/**
 * Znaki prevare, ki se vidijo ze iz same stevilke (lastnik 18. 11. 2026, seznam znakov prevar):
 * napacna dolzina ali oblika stevilke (ponarejen ID klicatelja) in tuja stevilka (za wangiri).
 * Namerno NE: tuja stevilka sama po sebi ni prevara (lastnik ima sorodnike v tujini); skrita stevilka se ne blokira.
 */
object ScamNumberSignals {
    private const val SI_NATIONAL_DIGITS = 8

    /** Stevilka, ki ne more biti prava: +386 z napacno dolzino ali z 0 za klicno, E.164 izven 8-15 stevk, 000..., 1234... */
    fun malformed(number: String): Boolean {
        val raw = number.trim()
        val digits = TakeoverPolicy.digits(raw)
        if (digits.isEmpty()) return false
        if (TakeoverPolicy.isEmergency(raw)) return false
        if (digits.startsWith("000") || digits.startsWith("1234")) return true
        val intl = when {
            raw.startsWith("+") -> digits
            raw.startsWith("00") -> digits.removePrefix("00")
            else -> return false
        }
        if (intl.length < 8 || intl.length > 15) return true
        if (intl.startsWith("386")) {
            val national = intl.removePrefix("386")
            return national.startsWith("0") || national.length != SI_NATIONAL_DIGITS
        }
        return false
    }

    /** Tuja stevilka (ni slovenska, ni domaca oblika brez predpone). */
    fun foreign(number: String): Boolean {
        val raw = number.trim()
        val digits = TakeoverPolicy.digits(raw)
        if (digits.isEmpty()) return false
        return when {
            raw.startsWith("+") -> !digits.startsWith("386")
            raw.startsWith("00") -> !digits.removePrefix("00").startsWith("386")
            else -> false
        }
    }
}
