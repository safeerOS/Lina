package si.safeer.lina.protocol

/**
 * Stari staticni pozdrav OL1 ni vec dokaz istovetnosti.
 * Povezana vrata, ki ga posljejo, so zasedena. Zeton se ne poslje.
 * BUSY je rok ali zasedenost, ne tuj proces: lupine se ne ubije.
 */
object ShellHandshake {
    enum class Probe { ABSENT, OURS, OCCUPIED, STALE, BUSY }
}
