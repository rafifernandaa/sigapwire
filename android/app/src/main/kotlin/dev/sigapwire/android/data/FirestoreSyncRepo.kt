package dev.sigapwire.android.data

import com.google.firebase.Firebase
import com.google.firebase.Timestamp
import com.google.firebase.auth.auth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.firestore
import com.google.firebase.remoteconfig.remoteConfig
import com.google.firebase.remoteconfig.remoteConfigSettings
import dev.sigapwire.android.SigapWireApp
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.tasks.await

data class RemoteModelConfig(
    val fastCloudModel: String = "gemini-3.5-flash-lite",
    val synthesisCloudModel: String = "gemini-3.8-flash"
)

object FirestoreSyncRepo {
    const val DEFAULT_DEMO_INCIDENT_ID = "inc_westjava_drill_2026"

    suspend fun ensureAnonymousAuthUid(): String {
        val auth = Firebase.auth
        val current = auth.currentUser
        if (current != null) return current.uid
        val res = auth.signInAnonymously().await()
        return res.user?.uid ?: throw IllegalStateException("Anonymous sign-in returned no user.")
    }

    suspend fun loadRemoteModels(): RemoteModelConfig {
        if (!SigapWireApp.isFirebaseConfigured) return RemoteModelConfig()
        return try {
            val rc = Firebase.remoteConfig
            rc.setConfigSettingsAsync(
                remoteConfigSettings { minimumFetchIntervalInSeconds = 3600L }
            ).await()
            rc.setDefaultsAsync(
                mapOf(
                    "cloud_model_fast" to "gemini-3.5-flash-lite",
                    "cloud_model_synthesis" to "gemini-3.8-flash"
                )
            ).await()
            rc.fetchAndActivate().await()
            RemoteModelConfig(
                fastCloudModel = rc.getString("cloud_model_fast")
                    .ifBlank { "gemini-3.5-flash-lite" },
                synthesisCloudModel = rc.getString("cloud_model_synthesis")
                    .ifBlank { "gemini-3.8-flash" }
            )
        } catch (_: Throwable) {
            RemoteModelConfig()
        }
    }

    suspend fun ensureDemoIncidentExists(): String {
        val uid = ensureAnonymousAuthUid()
        val ref = Firebase.firestore.collection("incidents").document(DEFAULT_DEMO_INCIDENT_ID)
        val snap = ref.get().await()
        if (!snap.exists()) {
            ref.set(
                mapOf(
                    "title" to "West Java M6.2 Earthquake (Synthetic Drill)",
                    "hazardType" to "EARTHQUAKE",
                    "region" to "Cianjur & Bandung Raya, West Java, Indonesia",
                    "severity" to "HIGH",
                    "status" to "ACTIVE",
                    "isSyntheticDemo" to true,
                    "createdBy" to uid,
                    "createdAt" to FieldValue.serverTimestamp(),
                    "updatedAt" to FieldValue.serverTimestamp()
                )
            ).await()
        }
        return DEFAULT_DEMO_INCIDENT_ID
    }

    /**
     * Persists a locally PII-sanitized intake to Firestore (matching firestore.rules exactly).
     * When offline, Firestore local persistence queues the write immediately and syncs on reconnect.
     */
    fun saveIntakeQueued(
        incidentId: String,
        mode: IntakeMode,
        triage: HybridTriageResult,
        privacy: LocalPrivacyResult,
        hasAttachment: Boolean,
        isVerifiedBySearch: Boolean,
        uid: String
    ) {
        val db = Firebase.firestore
        val structured = triage.structured

        val safeSources = structured.groundingSources
            .filter { it.uri.startsWith("http://") || it.uri.startsWith("https://") }
            .take(15)
            .map { src ->
                mapOf(
                    "title" to src.title.trim().take(300).ifBlank { "Source" },
                    "uri" to src.uri.trim().take(4096)
                )
            }

        val safeSearchHtml = structured.searchEntryPointHtml
            ?.takeIf { it.length <= 32768 }

        val structuredMap = hashMapOf<String, Any?>(
            "headline" to structured.headline.trim().take(300).ifBlank { "Crisis Intake" },
            "hazardType" to structured.hazardType.name,
            "location" to structured.location.trim().take(200).ifBlank { "Indonesia" },
            "severity" to structured.severity.name,
            "summaryId" to structured.summaryId.trim().take(2000),
            "summaryEn" to structured.summaryEn.trim().take(2000),
            "keyFacts" to structured.keyFacts.map { it.trim() }.filter { it.isNotEmpty() }.take(20),
            "urgentNeeds" to structured.urgentNeeds.map { it.trim() }.filter { it.isNotEmpty() }.take(20),
            "verificationGaps" to structured.verificationGaps.map { it.trim() }.filter { it.isNotEmpty() }.take(20),
            "rumorVerdict" to structured.rumorVerdict.name,
            "panicSignals" to structured.panicSignals.map { it.trim() }.filter { it.isNotEmpty() }.take(20),
            "groundingSources" to safeSources,
            "searchEntryPointHtml" to safeSearchHtml
        )

        val intakePayload = hashMapOf<String, Any>(
            "incidentId" to incidentId,
            "mode" to mode.name,
            "sourcePlatform" to "ANDROID",
            "inferenceSource" to triage.inferenceSource.name,
            "inferenceModeRequested" to triage.inferenceModeRequested,
            "latencyMs" to triage.latencyMs.coerceIn(0L, 600000L),
            "piiRedactedLocally" to true,
            "redactionCount" to privacy.redactions.size.coerceIn(0, 500),
            "sanitizedText" to privacy.sanitizedText.trim().take(5000).ifBlank { "[Empty intake]" },
            "hasAttachment" to hasAttachment,
            "structured" to structuredMap,
            "status" to if (mode == IntakeMode.RUMOR_CHECK && isVerifiedBySearch) {
                "VERIFIED"
            } else {
                "TRIAGED"
            },
            "createdBy" to uid,
            "createdAt" to FieldValue.serverTimestamp()
        )

        // Fire-and-forget enqueue with local persistence support so offline captures resolve immediately in UX.
        db.collection("intakes").add(intakePayload)
    }

    fun observeDispatches(incidentId: String = DEFAULT_DEMO_INCIDENT_ID): Flow<List<DispatchCard>> {
        if (!SigapWireApp.isFirebaseConfigured) return flowOf(emptyList())

        return callbackFlow {
            var reg: ListenerRegistration? = null
            try {
                reg = Firebase.firestore.collection("dispatches")
                    .whereEqualTo("incidentId", incidentId)
                    .addSnapshotListener { snap, err ->
                        if (err != null) {
                            close(err)
                            return@addSnapshotListener
                        }
                        if (snap == null) return@addSnapshotListener
                        val cards = snap.documents.mapNotNull { doc ->
                            parseDispatchCard(doc.id, doc.data ?: return@mapNotNull null)
                        }.sortedByDescending { it.publishedAtMillis }
                        trySend(cards)
                    }
            } catch (t: Throwable) {
                close(t)
            }
            awaitClose { reg?.remove() }
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun parseDispatchCard(id: String, data: Map<String, Any>): DispatchCard? {
        val community = data["communityAlertId"] as? Map<String, Any> ?: return null
        val media = data["mediaPressReleaseId"] as? Map<String, Any> ?: return null
        val global = data["globalSitrepEn"] as? Map<String, Any> ?: return null
        val debunk = data["debunkCard"] as? Map<String, Any> ?: return null

        val publishedAtMillis = (data["publishedAt"] as? Timestamp)?.toDate()?.time
            ?: System.currentTimeMillis()

        val rawSources = (debunk["sources"] as? List<Map<String, Any>>).orEmpty()
        val parsedSources = rawSources.mapNotNull { src ->
            val uri = src["uri"]?.toString().orEmpty()
            if (uri.isBlank()) null
            else GroundingSource(
                title = src["title"]?.toString()?.ifBlank { "Source" } ?: "Source",
                uri = uri
            )
        }

        return DispatchCard(
            id = id,
            incidentId = data["incidentId"]?.toString().orEmpty(),
            dispatchNumber = (data["dispatchNumber"] as? Number)?.toInt() ?: 1,
            severity = parseEnumSafe(data["severity"]?.toString(), SeverityLevel.HIGH),
            inferenceSource = parseEnumSafe(data["inferenceSource"]?.toString(), InferenceSourceLabel.IN_CLOUD),
            publishedAtMillis = publishedAtMillis,
            communityTitle = community["title"]?.toString().orEmpty(),
            communityWhatHappened = community["whatHappened"]?.toString().orEmpty(),
            communityDoNow = asStringList(community["doNow"]),
            communityAvoid = asStringList(community["avoid"]),
            whatsappShortText = community["whatsappShortText"]?.toString().orEmpty(),
            mediaHeadline = media["headline"]?.toString().orEmpty(),
            mediaDateline = media["dateline"]?.toString().orEmpty(),
            mediaBody = media["body"]?.toString().orEmpty(),
            mediaKeyMetrics = asStringList(media["keyMetrics"]),
            globalHeadline = global["headline"]?.toString().orEmpty(),
            globalExecutiveSummary = global["executiveSummary"]?.toString().orEmpty(),
            globalImpactOverview = asStringList(global["impactOverview"]),
            globalPriorityNeeds = asStringList(global["priorityNeeds"]),
            globalInformationGaps = asStringList(global["informationGaps"]),
            hasRumorAlert = debunk["hasRumorAlert"] as? Boolean ?: false,
            debunkVerdict = parseEnumSafe(debunk["verdict"]?.toString(), RumorVerdict.NOT_APPLICABLE),
            debunkClaim = debunk["claim"]?.toString().orEmpty(),
            debunkFactId = debunk["factId"]?.toString().orEmpty(),
            debunkFactEn = debunk["factEn"]?.toString().orEmpty(),
            debunkSources = parsedSources
        )
    }

    private fun asStringList(raw: Any?): List<String> {
        return (raw as? List<*>)?.mapNotNull { it?.toString()?.trim()?.takeIf { s -> s.isNotEmpty() } }
            ?: emptyList()
    }

    private inline fun <reified T : Enum<T>> parseEnumSafe(raw: String?, fallback: T): T {
        val cleaned = raw?.trim()?.uppercase() ?: return fallback
        return enumValues<T>().firstOrNull { it.name == cleaned } ?: fallback
    }
}
