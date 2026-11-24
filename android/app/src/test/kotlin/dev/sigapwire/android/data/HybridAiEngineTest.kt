package dev.sigapwire.android.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HybridAiEngineTest {
    @Test
    fun deterministicLocalPiiScrub_masksIndonesianPiiWhilePreservingDistricts() {
        val raw =
            "Lapor dr Cugenang: Pak Hendra Santoso (0812-0000-4411, Jl. Melati No. 14 RT 02) dan @andi_kurniawan lapor jembatan retak."
        val (sanitized, redactions) = HybridAiEngine.deterministicLocalPiiScrub(raw)

        assertTrue(sanitized.contains("Cugenang"))
        assertTrue(sanitized.contains("jembatan retak"))
        assertFalse(sanitized.contains("Hendra Santoso"))
        assertFalse(sanitized.contains("0812-0000-4411"))
        assertFalse(sanitized.contains("@andi_kurniawan"))
        assertFalse(sanitized.contains("Jl. Melati No. 14"))
        assertEquals(4, redactions.size)
    }

    @Test
    fun evaluateTokenRoute_flagsLongPayloadOverLocalBudget() {
        val shortEval = HybridAiEngine.evaluateTokenRoute("Gempa di Cianjur butuh tenda.", hasImage = false)
        assertFalse(shortEval.exceedsLocalBudget)

        val longText = "a".repeat(6000)
        val longEval = HybridAiEngine.evaluateTokenRoute(longText, hasImage = false)
        assertTrue(longEval.exceedsLocalBudget)
    }

    @Test
    fun isTransientCloudError_matchesQuotaAndTransientOutagesOnly() {
        assertTrue(
            HybridAiEngine.isTransientCloudError(
                IllegalStateException("[500] This model is currently experiencing high demand. Please try again later.")
            )
        )
        assertTrue(
            HybridAiEngine.isTransientCloudError(
                IllegalStateException("[503] Deadline expired before operation could complete.")
            )
        )
        assertTrue(
            HybridAiEngine.isTransientCloudError(
                IllegalStateException("429 RESOURCE_EXHAUSTED quota exceeded")
            )
        )
        assertFalse(
            HybridAiEngine.isTransientCloudError(
                IllegalStateException("[401] Firebase App Check token is invalid.")
            )
        )
    }

    @Test
    fun formatFriendlyAiException_providesClearRetryGuidanceForDemandSpikes() {
        val formatted503 = HybridAiEngine.formatFriendlyAiException(
            IllegalStateException("[503] Deadline expired before operation could complete.")
        )
        assertTrue((formatted503.message ?: "").contains("500/503/504"))

        val formatted429 = HybridAiEngine.formatFriendlyAiException(
            IllegalStateException("429 RESOURCE_EXHAUSTED")
        )
        assertTrue((formatted429.message ?: "").contains("429"))
    }

    @Test
    fun formatAreaKnowledgeContext_excludesInactiveTagsAndEnforcesCaps() {
        val facts = listOf(
            AreaKnowledgeFact(
                id = "paused",
                fact = "Ignored inactive fact",
                category = "ROUTE_ACCESS",
                active = false,
                createdAtMillis = 1L
            )
        ) + (1..10).map { idx ->
            AreaKnowledgeFact(
                id = "ak-$idx",
                fact = "Northern ring bridge load limit $idx tons confirmed safe for light trucks only.",
                category = "ROUTE_ACCESS",
                active = true,
                createdAtMillis = idx.toLong()
            )
        }

        val block = HybridAiEngine.formatAreaKnowledgeContext(facts)
        assertFalse(block.contains("Ignored inactive fact"))
        assertTrue(block.contains("[AK-1]"))
        assertTrue(block.length <= 900)
        val akMatches = Regex("""\[AK-\d+]""").findAll(block).count()
        assertTrue(akMatches in 1..6)
    }
}
