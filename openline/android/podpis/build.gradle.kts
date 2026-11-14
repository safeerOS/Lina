// Modul podpis: kljuc naprave Safeer Linka in nizi Linine asistentke. Cisti JVM, brez Androida in BREZ odvisnosti od
// modula protocol (klici): pot tajnice ne sme doseci podpisa (AGENTS.md, locitev tajnica/asistentka).
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
