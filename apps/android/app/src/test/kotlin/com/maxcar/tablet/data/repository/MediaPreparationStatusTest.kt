package com.maxcar.tablet.data.repository

import com.maxcar.tablet.data.local.PlaylistItemEntity
import org.junit.Assert.assertEquals
import org.junit.Test

class MediaPreparationStatusTest {
    @Test
    fun `empty manifest explains that no programming was received`() {
        val status = summarizeMediaPreparation(emptyList(), playableItems = 0)

        assertEquals("manifest_empty", status.diagnosticCode)
        assertEquals("Aguardando programação", status.passengerTitle)
    }

    @Test
    fun `failed download is distinguishable from an empty manifest`() {
        val status = summarizeMediaPreparation(
            listOf(item(PlaylistItemEntity.STATUS_FAILED)),
            playableItems = 0,
        )

        assertEquals("media_download_failed", status.diagnosticCode)
        assertEquals(1, status.failedItems)
    }

    @Test
    fun `downloaded but currently invalid media reports its schedule`() {
        val status = summarizeMediaPreparation(
            listOf(item(PlaylistItemEntity.STATUS_READY)),
            playableItems = 0,
        )

        assertEquals("outside_campaign_schedule", status.diagnosticCode)
        assertEquals("Aguardando o horário da campanha", status.passengerTitle)
    }

    private fun item(status: String) = PlaylistItemEntity(
        creativeId = "creative",
        campaignId = "campaign",
        type = "video",
        mimeType = "video/mp4",
        durationSeconds = 10.0,
        fileSizeBytes = 100,
        sha256 = "hash",
        position = 1,
        manifestVersion = "v1",
        downloadStatus = status,
        localPath = null,
        lastError = null,
        updatedAt = 0,
    )
}
