// Modul podpis: kljuc naprave Safeer Linka in nizi Linine asistentke. Cisti JVM, brez Androida in BREZ odvisnosti od
// modula protocol (klici): pot tajnice ne sme doseci podpisa (AGENTS.md, locitev tajnica/asistentka).
plugins {
    kotlin("jvm")
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    // JSON pogodbe asistentke (samo JsonElement, brez vticnika); ista razlicica kot protocol.
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
    // Tok s kodo (TokKode) uporabi SPAKE2 iz modula seznanitev; oba sta pot asistentke, ne klicev.
    implementation(project(":seznanitev"))
    testImplementation(kotlin("test-junit5"))
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
}
