// Top-level build file: only declares plugin versions so every module
// resolves the same one. No project-level configuration lives here.
//
// Kotlin is pinned to 2.3.x, one minor behind the latest 2.4.x release:
// Room's compiler (any annotation-processing backend, kapt or KSP) reads
// Kotlin's own @Metadata format through kotlin-metadata-jvm, and Room 2.8.4
// only understands metadata up to format version 2.3.0 — Kotlin 2.4.x
// already emits 2.4.0 and fails kapt with "maximum supported version is
// 2.3.0". Revisit once a Room release bundles a newer kotlin-metadata-jvm.
plugins {
    id("com.android.application") version "9.3.1" apply false
    id("org.jetbrains.kotlin.android") version "2.3.21" apply false
    id("org.jetbrains.kotlin.kapt") version "2.3.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.3.21" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.3.21" apply false
}
