package si.safeer.lina.telecom

import si.safeer.lina.samostojna.prehod.LokalniPrehod

object LokalniPrehodUpravljalnik {
    var prehod: LokalniPrehod? = null

    fun tece(): Boolean = prehod != null // TODO: check if running
}
