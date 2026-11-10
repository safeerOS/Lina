package com.httpgateway.dialer.telecom

/** Ali je prikljucena naprava, ki lahko dvigne klic mimo zaslona. */
object RouteGuard {
    @Volatile
    var externalPickup: Boolean = false
}
