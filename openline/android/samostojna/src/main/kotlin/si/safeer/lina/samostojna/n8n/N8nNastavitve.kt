package si.safeer.lina.samostojna.n8n

data class N8nNastavitve(val naslovWebhooka: String, val skrivnost: String?) {
    override fun toString(): String {
        return "N8nNastavitve(naslovWebhooka=$naslovWebhooka, skrivnost=${if (skrivnost != null) "***" else "null"})"
    }
}
