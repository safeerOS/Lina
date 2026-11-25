import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
}

android {
    namespace = "si.safeer.lina"
    compileSdk = 37
    buildToolsVersion = "36.0.0"

    defaultConfig {
        applicationId = "si.safeer.lina"
        minSdk = 29
        targetSdk = 35
        versionCode = 213
        versionName = "0.2.13"

        val defaultWsUrl = providers.gradleProperty("GATEWAY_WS_URL")
            .orElse("")
            .get()
        buildConfigField("String", "DEFAULT_GATEWAY_WS_URL", "\"${defaultWsUrl.replace("\"", "\\\"")}\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(project(":protocol"))
    implementation(project(":podpis"))
    implementation(project(":seznanitev"))
    implementation(project(":samostojna"))
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // In-app wireless ADB: pairs with this phone's own adbd to launch the shell-UID audio server.
    implementation("com.github.MuntashirAkon:libadb-android:3.1.1")
    implementation("org.conscrypt:conscrypt-android:2.5.3")
    implementation("org.lsposed.hiddenapibypass:hiddenapibypass:6.1")
    implementation("org.bouncycastle:bcpkix-jdk15to18:1.81")
    // QR pairing with the admin console (Google code scanner: no camera permission needed).
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
    // OCR na telefonu za lokalni indeks dokumentov (23. 11. 2026): model prek storitev Google Play (APK ostane majhen),
    // prepoznava tece na napravi. Ni bilo prevedeno lokalno - preveri pri gradnji na GitHubu.
    implementation("com.google.android.gms:play-services-mlkit-text-recognition:19.0.1")

    testImplementation("org.jetbrains.kotlin:kotlin-test")
}
