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
}
