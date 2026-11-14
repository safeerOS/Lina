// Modul seznanitev: razclenjevanje QR za seznanitev telefona (pot klicev in pot asistentke). Cisti JVM, brez odvisnosti:
// ne uvaza ne klicev (protocol) ne podpisa (podpis) - kljuci in zetoni obeh poti ostanejo loceni (lastnik 14. 11. 2026).
plugins {
    kotlin("jvm")
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    testImplementation(kotlin("test-junit5"))
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
}
