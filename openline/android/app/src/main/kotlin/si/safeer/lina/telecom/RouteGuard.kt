package si.safeer.lina.telecom

/** Ali je prikljucena naprava, ki lahko dvigne klic mimo zaslona. */
object RouteGuard {
    @Volatile
    var externalPickup: Boolean = false
}
