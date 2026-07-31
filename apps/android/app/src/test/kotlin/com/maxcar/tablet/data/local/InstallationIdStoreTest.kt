package com.maxcar.tablet.data.local

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.core.DataStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

@RunWith(RobolectricTestRunner::class)
class InstallationIdStoreTest {

    private val tempFile = File.createTempFile("test-installation-id", ".preferences_pb")
    private val dataStore: DataStore<Preferences> = PreferenceDataStoreFactory.create(
        scope = kotlinx.coroutines.CoroutineScope(Dispatchers.Unconfined),
    ) { tempFile }

    @After
    fun tearDown() {
        tempFile.delete()
    }

    @Test
    fun `getOrCreate generates an id on first run and never changes it`() = runTest {
        val store = InstallationIdStore(dataStore)

        val first = store.getOrCreate()
        val second = store.getOrCreate()

        assertNotNull(first)
        assertEquals(first, second)
    }

    @Test
    fun `getOrCreate persists across separate store instances (same backing DataStore)`() = runTest {
        val firstStore = InstallationIdStore(dataStore)
        val id = firstStore.getOrCreate()

        val secondStore = InstallationIdStore(dataStore)
        val reloaded = secondStore.getOrCreate()

        assertEquals(id, reloaded)
    }
}
