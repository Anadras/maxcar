import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.kapt")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

android {
    namespace = "com.maxcar.tablet"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.maxcar.tablet"
        // MAX-010.6: device identity is signed with SHA256withECDSAinP1363Format,
        // which Android only added in API 30. The pilot fleet's actual hardware
        // (Black Shark tablets) runs API 35, so raising the floor to 30 costs
        // nothing in practice and avoids carrying a DER-to-P1363 conversion path
        // for devices that don't exist in this fleet.
        minSdk = 30
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    flavorDimensions += "environment"
    productFlavors {
        create("staging") {
            dimension = "environment"
            applicationIdSuffix = ".staging"
            versionNameSuffix = "-staging"
            buildConfigField(
                "String",
                "DEVICE_API_BASE_URL",
                "\"https://cdciyuwikdzofaaxvdbp.supabase.co/functions/v1/\"",
            )
        }
        create("production") {
            dimension = "environment"
            // MAXCAR only has one Supabase project today (staging doubles as
            // the operational backend); this flavor exists so the pilot's
            // future dedicated production project is a one-line change, not
            // a new build variant.
            buildConfigField(
                "String",
                "DEVICE_API_BASE_URL",
                "\"https://cdciyuwikdzofaaxvdbp.supabase.co/functions/v1/\"",
            )
        }
    }

    buildTypes {
        debug {
            isDebuggable = true
            applicationIdSuffix = ".debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            isReturnDefaultValues = true
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.06.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.core:core-ktx:1.19.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.11.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
    implementation("androidx.activity:activity-compose:1.13.0")
    // Play Services still pulls Fragment 1.1.0 transitively. Keep a current
    // version explicit so Activity Result APIs are safe on the pilot tablet.
    implementation("androidx.fragment:fragment-ktx:1.8.9")
    implementation("androidx.navigation:navigation-compose:2.9.8")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")

    implementation("com.squareup.okhttp3:okhttp:5.4.0")

    // Video playback only; images are decoded and shown directly in
    // Compose (see ui/player) rather than through Media3's own image
    // timeline support, which keeps the player's two content types on one
    // predictable, testable state machine instead of two playback engines.
    implementation("androidx.media3:media3-exoplayer:1.10.1")
    implementation("androidx.media3:media3-ui:1.10.1")

    implementation("androidx.room:room-runtime:2.8.4")
    implementation("androidx.room:room-ktx:2.8.4")
    kapt("androidx.room:room-compiler:2.8.4")

    implementation("androidx.work:work-runtime-ktx:2.11.2")

    implementation("androidx.datastore:datastore-preferences:1.2.1")

    implementation("androidx.security:security-crypto:1.1.0")

    implementation("androidx.startup:startup-runtime:1.2.0")

    // Fused Location Provider for the GEO engine (MAX-008). No other Play
    // Services module is used — the app has no other reason to depend on
    // Google Play Services beyond precise, battery-reasonable location.
    implementation("com.google.android.gms:play-services-location:21.3.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
    testImplementation("app.cash.turbine:turbine:1.2.1")
    testImplementation("com.squareup.okhttp3:mockwebserver:5.4.0")
    testImplementation("androidx.room:room-testing:2.8.4")
    testImplementation("androidx.work:work-testing:2.11.2")
    testImplementation("org.robolectric:robolectric:4.16")
    testImplementation("androidx.test:core-ktx:1.7.0")

    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
}
