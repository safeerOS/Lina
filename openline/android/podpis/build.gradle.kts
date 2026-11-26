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
    // Naloga 28: Ed25519 za podpis izdaj (java.security ga ima na Androidu sele od API 33, minSdk je 29). Ista razlicica, ki jo
    // app ze nosi prek bcpkix-jdk15to18:1.87 (naloga 22: OSV brez zapisov); sha1 jar ba01e5ad8e7e66374e850f7204f72c4e75e82785.
    implementation("org.bouncycastle:bcprov-jdk15to18:1.87")
    testImplementation(kotlin("test-junit5"))
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
}
