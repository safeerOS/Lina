package si.safeer.lina.samostojna.soglasja

/**
 * Pogodba: `preberi` MORA vedno vrniti zadnje trajno stanje (brez lastnega predpomnilnika po primerku),
 * ker TrajnaSoglasja pod skupnim zaklepom bere, spremeni in shrani; predpomnjen seznam bi lahko obnovil preklicano soglasje.
 */
interface ShrambaSoglasij {
    fun preberi(): List<Soglasje>
    fun shrani(soglasja: List<Soglasje>)
}
