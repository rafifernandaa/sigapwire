package dev.sigapwire.android.data

import android.graphics.Bitmap
import android.os.Build
import com.google.firebase.Firebase
import com.google.firebase.ai.InferenceMode
import com.google.firebase.ai.InferenceSource
import com.google.firebase.ai.OnDeviceConfig
import com.google.firebase.ai.ai
import com.google.firebase.ai.ondevice.DownloadStatus
import com.google.firebase.ai.ondevice.FirebaseAIOnDevice
import com.google.firebase.ai.ondevice.OnDeviceModelStatus
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.PublicPreviewAPI
import com.google.firebase.ai.type.Tool
import com.google.firebase.ai.type.content
import com.google.firebase.ai.type.generationConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.roundToInt

data class TokenRouteEvaluation(
    val estimatedTokens: Int,
    val safeLocalLimit: Int,
    val exceedsLocalBudget: Boolean
)

data class PiiCounters(
    var phone: Int = 0,
    var handle: Int = 0,
    var name: Int = 0,
    var address: Int = 0
)

object HybridAiEngine {
    const val ON_DEVICE_SAFE_INPUT_TOKENS = 1600
    const val IMAGE_TOKEN_ESTIMATE = 300
    private const val MAX_LOCAL_PRIVACY_SINGLE_CALL_CHARS = 2200
    private const val LOCAL_PRIVACY_CHUNK_CHARS = 1900
    private const val MAX_IMAGE_EDGE_PX = 1024

    fun estimateTokens(text: String, hasImage: Boolean = false): Int {
        val textTokens = if (text.isBlank()) 0 else ceil(text.length / 3.2).toInt()
        return textTokens + if (hasImage) IMAGE_TOKEN_ESTIMATE else 0
    }

    fun evaluateTokenRoute(text: String, hasImage: Boolean = false): TokenRouteEvaluation {
        val est = estimateTokens(text, hasImage)
        return TokenRouteEvaluation(
            estimatedTokens = est,
            safeLocalLimit = ON_DEVICE_SAFE_INPUT_TOKENS,
            exceedsLocalBudget = est > ON_DEVICE_SAFE_INPUT_TOKENS
        )
    }

    fun scaleBitmapMaxEdge(bitmap: Bitmap, maxEdge: Int = MAX_IMAGE_EDGE_PX): Bitmap {
        val longEdge = max(bitmap.width, bitmap.height)
        if (longEdge <= maxEdge) return bitmap
        val scale = maxEdge.toFloat() / longEdge.toFloat()
        val targetW = max(1, (bitmap.width * scale).roundToInt())
        val targetH = max(1, (bitmap.height * scale).roundToInt())
        return Bitmap.createScaledBitmap(bitmap, targetW, targetH, true)
    }

    @OptIn(PublicPreviewAPI::class)
    suspend fun checkOnDeviceStatus(): DeviceNanoStatus = withContext(Dispatchers.IO) {
        try {
            when (FirebaseAIOnDevice.checkStatus()) {
                OnDeviceModelStatus.AVAILABLE -> DeviceNanoStatus.AVAILABLE
                OnDeviceModelStatus.DOWNLOADABLE -> DeviceNanoStatus.DOWNLOADABLE
                OnDeviceModelStatus.DOWNLOADING -> DeviceNanoStatus.DOWNLOADING
                OnDeviceModelStatus.UNAVAILABLE -> DeviceNanoStatus.UNAVAILABLE
                else -> DeviceNanoStatus.UNAVAILABLE
            }
        } catch (_: Throwable) {
            DeviceNanoStatus.UNAVAILABLE
        }
    }

    @OptIn(PublicPreviewAPI::class)
    suspend fun downloadOnDeviceModel(onProgress: (Float) -> Unit): DeviceNanoStatus {
        return withContext(Dispatchers.IO) {
            try {
                var totalBytes = 1L
                var finalStatus = DeviceNanoStatus.DOWNLOADING
                FirebaseAIOnDevice.download().collect { status ->
                    when (status) {
                        is DownloadStatus.DownloadStarted -> {
                            totalBytes = status.bytesToDownload.coerceAtLeast(1L)
                            onProgress(0f)
                        }
                        is DownloadStatus.DownloadInProgress -> {
                            val pct = (status.totalBytesDownloaded.toFloat() / totalBytes.toFloat())
                                .coerceIn(0f, 1f)
                            onProgress(pct)
                        }
                        is DownloadStatus.DownloadCompleted -> {
                            onProgress(1f)
                            finalStatus = DeviceNanoStatus.AVAILABLE
                        }
                        is DownloadStatus.DownloadFailed -> {
                            finalStatus = DeviceNanoStatus.ERROR
                        }
                    }
                }
                if (finalStatus == DeviceNanoStatus.DOWNLOADING) {
                    checkOnDeviceStatus()
                } else {
                    finalStatus
                }
            } catch (_: Throwable) {
                DeviceNanoStatus.UNAVAILABLE
            }
        }
    }

    fun deterministicLocalPiiScrub(
        rawText: String,
        counters: PiiCounters = PiiCounters()
    ): Pair<String, List<RedactionItem>> {
        var sanitized = rawText
        val redactions = mutableListOf<RedactionItem>()

        val phoneRegex = Regex("""(?:\+62|62|0)\s?8\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{3,5}""")
        sanitized = phoneRegex.replace(sanitized) {
            counters.phone += 1
            val placeholder = "[PHONE_${counters.phone}]"
            redactions.add(
                RedactionItem(
                    category = RedactionCategory.PHONE_NUMBER,
                    placeholder = placeholder,
                    reason = "Indonesian mobile number redacted locally"
                )
            )
            placeholder
        }

        val handleRegex = Regex("""@[a-zA-Z0-9._]{3,30}""")
        sanitized = handleRegex.replace(sanitized) {
            counters.handle += 1
            val placeholder = "[HANDLE_${counters.handle}]"
            redactions.add(
                RedactionItem(
                    category = RedactionCategory.CHAT_HANDLE,
                    placeholder = placeholder,
                    reason = "Social/chat handle redacted locally"
                )
            )
            placeholder
        }

        val nameRegex = Regex("""\b(Pak|Bu|Ibu|Bapak|Sdr|Sdri)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)""")
        sanitized = nameRegex.replace(sanitized) { match ->
            counters.name += 1
            val honorific = match.groupValues[1]
            val placeholder = "[RESIDENT_${counters.name}]"
            redactions.add(
                RedactionItem(
                    category = RedactionCategory.PERSON_NAME,
                    placeholder = placeholder,
                    reason = "Personal name after \"$honorific\" redacted locally"
                )
            )
            "$honorific $placeholder"
        }

        val addressRegex = Regex(
            """\bJl\.\s+[A-Za-z0-9.\s]+?(?:No\.?\s*\d+)(?:\s+RT\s*\d+(?:/RW\s*\d+)?)?""",
            RegexOption.IGNORE_CASE
        )
        sanitized = addressRegex.replace(sanitized) {
            counters.address += 1
            val placeholder = "[STREET_ADDRESS_${counters.address}]"
            redactions.add(
                RedactionItem(
                    category = RedactionCategory.ADDRESS_DETAIL,
                    placeholder = placeholder,
                    reason = "House-level street address redacted locally"
                )
            )
            placeholder
        }

        return sanitized to redactions
    }

    private fun splitTextIntoLocalChunks(rawText: String): List<String> {
        if (rawText.length <= MAX_LOCAL_PRIVACY_SINGLE_CALL_CHARS) return listOf(rawText)
        val lines = rawText.split(Regex("\n+"))
        val chunks = mutableListOf<String>()
        var current = StringBuilder()

        for (rawLine in lines) {
            val line = rawLine.trim()
            if (line.isEmpty()) continue
            if (line.length > LOCAL_PRIVACY_CHUNK_CHARS) {
                if (current.isNotEmpty()) {
                    chunks.add(current.toString())
                    current = StringBuilder()
                }
                var remaining = line
                while (remaining.length > LOCAL_PRIVACY_CHUNK_CHARS) {
                    var cut = remaining.lastIndexOf(' ', LOCAL_PRIVACY_CHUNK_CHARS)
                    if (cut < LOCAL_PRIVACY_CHUNK_CHARS / 2) cut = LOCAL_PRIVACY_CHUNK_CHARS
                    chunks.add(remaining.substring(0, cut).trim())
                    remaining = remaining.substring(cut).trim()
                }
                if (remaining.isNotEmpty()) current.append(remaining)
                continue
            }

            if (current.isEmpty()) {
                current.append(line)
            } else if (current.length + 1 + line.length <= LOCAL_PRIVACY_CHUNK_CHARS) {
                current.append('\n').append(line)
            } else {
                chunks.add(current.toString())
                current = StringBuilder(line)
            }
        }
        if (current.isNotEmpty()) chunks.add(current.toString())
        return if (chunks.isEmpty()) listOf(rawText) else chunks
    }

    @OptIn(PublicPreviewAPI::class)
    suspend fun runLocalPrivacyFirewall(
        rawText: String,
        fastCloudModel: String
    ): LocalPrivacyResult = withContext(Dispatchers.IO) {
        val startMs = System.currentTimeMillis()
        val chunks = splitTextIntoLocalChunks(rawText)
        val counters = PiiCounters()
        val dedupedRedactions = linkedMapOf<String, RedactionItem>()
        val sanitizedChunks = mutableListOf<String>()

        val nanoAvailable = checkOnDeviceStatus() == DeviceNanoStatus.AVAILABLE
        val localModel = if (nanoAvailable) {
            try {
                Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(
                    modelName = fastCloudModel,
                    onDeviceConfig = OnDeviceConfig(mode = InferenceMode.ONLY_ON_DEVICE)
                )
            } catch (_: Throwable) {
                null
            }
        } else {
            null
        }

        var usedModelOnAnyChunk = false
        var usedRegexOnly = false

        for ((index, chunk) in chunks.withIndex()) {
            if (localModel == null) {
                usedRegexOnly = true
                val (scrubbed, items) = deterministicLocalPiiScrub(chunk, counters)
                sanitizedChunks.add(scrubbed)
                items.forEach { dedupedRedactions[it.placeholder] = it }
                continue
            }

            try {
                val prompt = buildString {
                    appendLine("You are an on-device privacy redaction gate for disaster reports.")
                    appendLine("Remove ONLY private personal identifiers (names, phone numbers, @handles, house addresses) and replace with [PERSON_1], [PHONE_1], [HANDLE_1], [ADDRESS_1].")
                    appendLine("Keep districts, bridges, dams, hazard facts, and urgent needs intact.")
                    appendLine("Return ONLY valid JSON: {\"sanitizedText\": \"...\", \"redactions\": [{\"category\": \"PERSON_NAME|PHONE_NUMBER|CHAT_HANDLE|ADDRESS_DETAIL|OTHER_PII\", \"placeholder\": \"...\", \"reason\": \"...\"}]}")
                    if (chunks.size > 1) appendLine("[Chunk ${index + 1}/${chunks.size}]")
                    appendLine("RAW INPUT:")
                    append(chunk)
                }
                val response = localModel.generateContent(prompt)
                val obj = JSONObject(extractJsonFromText(response.text ?: ""))
                val modelSanitized = obj.optString("sanitizedText", chunk).ifBlank { chunk }
                val (postGuarded, guardItems) = deterministicLocalPiiScrub(modelSanitized, counters)
                sanitizedChunks.add(postGuarded)
                usedModelOnAnyChunk = true

                val arr = obj.optJSONArray("redactions")
                if (arr != null) {
                    for (j in 0 until arr.length()) {
                        val item = arr.optJSONObject(j) ?: continue
                        val rawPlaceholder = item.optString("placeholder").trim()
                        if (rawPlaceholder.isEmpty()) continue
                        val normalized = if (chunks.size > 1 && rawPlaceholder.endsWith("]")) {
                            rawPlaceholder.dropLast(1) + "_C${index + 1}]"
                        } else {
                            rawPlaceholder
                        }
                        val category = parseEnum(
                            item.optString("category"),
                            RedactionCategory.OTHER_PII
                        )
                        dedupedRedactions[normalized] = RedactionItem(
                            category = category,
                            placeholder = normalized,
                            reason = item.optString("reason", "Redacted on-device")
                        )
                    }
                }
                guardItems.forEach { dedupedRedactions[it.placeholder] = it }
            } catch (_: Throwable) {
                usedRegexOnly = true
                val (scrubbed, items) = deterministicLocalPiiScrub(chunk, counters)
                sanitizedChunks.add(scrubbed)
                items.forEach { dedupedRedactions[it.placeholder] = it }
            }
        }

        LocalPrivacyResult(
            sanitizedText = sanitizedChunks.joinToString("\n\n"),
            redactions = dedupedRedactions.values.toList(),
            inferenceSource = InferenceSourceLabel.ON_DEVICE,
            latencyMs = (System.currentTimeMillis() - startMs).coerceAtLeast(1L),
            usedRegexFallback = !usedModelOnAnyChunk && usedRegexOnly
        )
    }

    @OptIn(PublicPreviewAPI::class)
    suspend fun triageIntakeHybrid(
        mode: IntakeMode,
        sanitizedText: String,
        bitmap: Bitmap?,
        forceCloudFallback: Boolean,
        fastCloudModel: String,
        isOnline: Boolean
    ): HybridTriageResult = withContext(Dispatchers.IO) {
        val startMs = System.currentTimeMillis()
        val scaledBitmap = bitmap?.let { scaleBitmapMaxEdge(it) }
        val routeEval = evaluateTokenRoute(sanitizedText, scaledBitmap != null)

        var requestedMode = InferenceMode.PREFER_ON_DEVICE
        var requestedModeLabel = "PREFER_ON_DEVICE"
        var presetReason = ""

        if (forceCloudFallback) {
            requestedMode = InferenceMode.ONLY_IN_CLOUD
            requestedModeLabel = "ONLY_IN_CLOUD"
            presetReason = "Forced Cloud Gemini comparison on ${Build.MODEL} (ONLY_IN_CLOUD)"
        } else if (routeEval.exceedsLocalBudget) {
            requestedMode = InferenceMode.ONLY_IN_CLOUD
            requestedModeLabel = "ONLY_IN_CLOUD"
            presetReason =
                "Auto-escalated to Cloud: ~${routeEval.estimatedTokens} est. tokens exceeds $ON_DEVICE_SAFE_INPUT_TOKENS-token local budget"
        }

        val promptText = buildTriagePrompt(mode, sanitizedText)

        fun buildModel(inferenceMode: InferenceMode) =
            Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(
                modelName = fastCloudModel,
                generationConfig = generationConfig {
                    responseMimeType = "application/json"
                    temperature = 0.2f
                },
                onDeviceConfig = OnDeviceConfig(mode = inferenceMode)
            )

        val requestContent = content {
            if (scaledBitmap != null) image(scaledBitmap)
            text(promptText)
        }

        var parsedStructured: StructuredIntake
        var actualSource: InferenceSourceLabel
        var routingReason: String

        try {
            val response = buildModel(requestedMode).generateContent(requestContent)
            parsedStructured = parseStructuredIntake(response.text ?: "", mode)
            actualSource = if (response.inferenceSource == InferenceSource.ON_DEVICE) {
                InferenceSourceLabel.ON_DEVICE
            } else {
                InferenceSourceLabel.IN_CLOUD
            }

            routingReason = when {
                requestedMode == InferenceMode.ONLY_IN_CLOUD -> {
                    actualSource = InferenceSourceLabel.IN_CLOUD
                    presetReason
                }
                actualSource == InferenceSourceLabel.ON_DEVICE ->
                    "Processed locally on ${Build.MODEL} via AICore Gemini Nano (0 cloud tokens used)"
                else ->
                    "Auto-fallback to Cloud Gemini on ${Build.MODEL} via PREFER_ON_DEVICE (on-device model unavailable)"
            }
        } catch (primaryErr: Throwable) {
            if (requestedMode == InferenceMode.PREFER_ON_DEVICE &&
                isOnDeviceOrParseError(primaryErr) &&
                isOnline
            ) {
                try {
                    val retryResponse = buildModel(InferenceMode.ONLY_IN_CLOUD)
                        .generateContent(requestContent)
                    parsedStructured = parseStructuredIntake(retryResponse.text ?: "", mode)
                    actualSource = InferenceSourceLabel.IN_CLOUD
                    requestedModeLabel = "ONLY_IN_CLOUD"
                    routingReason = "Auto-escalated to Cloud after hitting on-device limit on ${Build.MODEL}"
                } catch (cloudErr: Throwable) {
                    throw formatFriendlyAiException(cloudErr)
                }
            } else {
                throw formatFriendlyAiException(primaryErr)
            }
        }

        HybridTriageResult(
            structured = parsedStructured,
            inferenceSource = actualSource,
            inferenceModeRequested = requestedModeLabel,
            latencyMs = (System.currentTimeMillis() - startMs).coerceAtLeast(1L),
            routingReason = routingReason,
            estimatedInputTokens = routeEval.estimatedTokens
        )
    }

    suspend fun verifyRumorWithGoogleSearch(
        sanitizedClaim: String,
        locationHint: String,
        synthesisCloudModel: String,
        fastCloudModel: String
    ): GroundedVerificationResult = withContext(Dispatchers.IO) {
        val startMs = System.currentTimeMillis()
        val prompt = buildString {
            appendLine("You are a crisis fact-checking assistant supporting disaster communications officers.")
            appendLine("Verify the following SANITIZED claim using live Google Search results (official agencies such as BMKG, BNPB, PVMBG, USGS, credible newsrooms).")
            appendLine("SAFETY RULE: Never declare a breaking physical hazard 'safe' unless corroborated by authoritative sources. If there is no clear confirmation or credible debunk, return verdict 'UNVERIFIED_DEVELOPING'.")
            appendLine("Respond ONLY with valid JSON: {\"verdict\": \"VERIFIED\" | \"MISLEADING\" | \"UNVERIFIED_DEVELOPING\", \"factId\": \"2-3 calm sentences in Bahasa Indonesia\", \"factEn\": \"2-3 calm sentences in English\"}")
            appendLine("REGION HINT: $locationHint")
            appendLine("SANITIZED CLAIM: $sanitizedClaim")
        }

        suspend fun runSearch(modelName: String) =
            Firebase.ai(backend = GenerativeBackend.googleAI())
                .generativeModel(
                    modelName = modelName,
                    tools = listOf(Tool.googleSearch())
                )
                .generateContent(prompt)

        val response = try {
            runSearch(synthesisCloudModel)
        } catch (err: Throwable) {
            if (isTransientCloudError(err) && fastCloudModel != synthesisCloudModel) {
                try {
                    runSearch(fastCloudModel)
                } catch (fallbackErr: Throwable) {
                    throw formatFriendlyAiException(fallbackErr)
                }
            } else {
                throw formatFriendlyAiException(err)
            }
        }

        val grounding = response.candidates.firstOrNull()?.groundingMetadata
        val sources = grounding?.groundingChunks
            ?.mapNotNull { chunk ->
                val web = chunk.web ?: return@mapNotNull null
                val uri = web.uri?.trim().orEmpty()
                if (!uri.startsWith("http")) return@mapNotNull null
                GroundingSource(
                    title = web.title?.trim().orEmpty().ifBlank { "Source" },
                    uri = uri
                )
            }
            ?.take(15)
            ?: emptyList()

        val searchHtml = grounding?.searchEntryPoint?.renderedContent
        val searchQueries = grounding?.webSearchQueries ?: emptyList()

        var verdict = RumorVerdict.UNVERIFIED_DEVELOPING
        var factId = "Klaim ini belum dapat dikonfirmasi dari sumber resmi. Ikuti informasi kanal resmi kebencanaan setempat."
        var factEn = "This claim cannot yet be confirmed by authoritative sources. Follow official local disaster agency advisories."

        try {
            val obj = JSONObject(extractJsonFromText(response.text ?: ""))
            val rawVerdict = obj.optString("verdict")
            if (rawVerdict in listOf("VERIFIED", "MISLEADING", "UNVERIFIED_DEVELOPING")) {
                verdict = parseEnum(rawVerdict, RumorVerdict.UNVERIFIED_DEVELOPING)
            }
            obj.optString("factId").takeIf { it.isNotBlank() }?.let { factId = it }
            obj.optString("factEn").takeIf { it.isNotBlank() }?.let { factEn = it }
        } catch (_: Throwable) {
            val raw = (response.text ?: "").trim()
            if (raw.isNotBlank()) {
                factId = raw.take(600)
                factEn = raw.take(600)
            }
        }

        GroundedVerificationResult(
            verdict = verdict,
            factId = factId,
            factEn = factEn,
            sources = sources,
            searchEntryPointHtml = searchHtml,
            webSearchQueries = searchQueries,
            latencyMs = (System.currentTimeMillis() - startMs).coerceAtLeast(1L)
        )
    }

    private fun buildTriagePrompt(mode: IntakeMode, sanitizedText: String): String {
        val roleInstructions = if (mode == IntakeMode.FIELD_REPORT) {
            listOf(
                "You are a rapid disaster field-report structuring engine.",
                "Convert the messy Indonesian/English field report (and optional photo) into clean JSON.",
                "- headline: crisp English headline (max 90 chars)",
                "- hazardType: one of EARTHQUAKE, FLOOD, VOLCANO, LANDSLIDE, TSUNAMI, OTHER",
                "- location: specific Indonesian district/city/region",
                "- severity: one of CRITICAL, HIGH, MEDIUM, LOW",
                "- summaryId: concise, calm factual summary in Bahasa Indonesia (max 2 sentences)",
                "- summaryEn: concise factual summary in English (max 2 sentences)",
                "- keyFacts: array of 2-4 concrete observed facts (<= 16 words each)",
                "- urgentNeeds: array of 1-4 concrete immediate relief/safety needs",
                "- verificationGaps: array of 1-3 unknown/unconfirmed details",
                "- panicSignals: empty array [] unless speculative rumors appear"
            )
        } else {
            listOf(
                "You are a disaster rumor triage engine.",
                "Extract the core verifiable claim and panic signals from the forwarded message/screenshot.",
                "DO NOT declare a claim true or false without external search verification.",
                "- headline: neutral English claim summary (max 90 chars)",
                "- hazardType: one of EARTHQUAKE, FLOOD, VOLCANO, LANDSLIDE, TSUNAMI, OTHER",
                "- location: specific Indonesian district/city/region",
                "- severity: one of CRITICAL, HIGH, MEDIUM, LOW",
                "- summaryId: neutral Bahasa Indonesia summary of what is being claimed",
                "- summaryEn: neutral English summary of what is being claimed",
                "- keyFacts: array of 1-3 verifiable factual assertions in the rumor",
                "- urgentNeeds: array of 1-2 official agency checks required",
                "- verificationGaps: array of 1-3 missing pieces of evidence",
                "- panicSignals: array of 1-4 manipulation/panic cues"
            )
        }

        return buildString {
            roleInstructions.forEach { appendLine(it) }
            appendLine("Respond ONLY with valid JSON matching those exact keys (no markdown outside JSON).")
            appendLine()
            appendLine("SANITIZED INPUT:")
            append(sanitizedText)
        }
    }

    private fun parseStructuredIntake(rawText: String, mode: IntakeMode): StructuredIntake {
        val obj = JSONObject(extractJsonFromText(rawText))
        return StructuredIntake(
            headline = obj.optString("headline").ifBlank { "Untitled Crisis Intake" },
            hazardType = parseEnum(obj.optString("hazardType"), HazardType.OTHER),
            location = obj.optString("location").ifBlank { "Indonesia (Location Unspecified)" },
            severity = parseEnum(obj.optString("severity"), SeverityLevel.MEDIUM),
            summaryId = obj.optString("summaryId"),
            summaryEn = obj.optString("summaryEn"),
            keyFacts = jsonArrayToStrings(obj.optJSONArray("keyFacts")),
            urgentNeeds = jsonArrayToStrings(obj.optJSONArray("urgentNeeds")),
            verificationGaps = jsonArrayToStrings(obj.optJSONArray("verificationGaps")),
            rumorVerdict = if (mode == IntakeMode.RUMOR_CHECK) {
                RumorVerdict.UNVERIFIED_DEVELOPING
            } else {
                RumorVerdict.NOT_APPLICABLE
            },
            panicSignals = jsonArrayToStrings(obj.optJSONArray("panicSignals")),
            groundingSources = emptyList(),
            searchEntryPointHtml = null
        )
    }

    private fun extractJsonFromText(rawText: String): String {
        val trimmed = rawText.trim()
        val fenceMatch = Regex("""```(?:json)?\s*([\s\S]*?)```""", RegexOption.IGNORE_CASE)
            .find(trimmed)
        if (fenceMatch != null) {
            return fenceMatch.groupValues[1].trim()
        }
        val firstBrace = trimmed.indexOf('{')
        val lastBrace = trimmed.lastIndexOf('}')
        if (firstBrace != -1 && lastBrace > firstBrace) {
            return trimmed.substring(firstBrace, lastBrace + 1)
        }
        return trimmed
    }

    private fun jsonArrayToStrings(arr: JSONArray?): List<String> {
        if (arr == null) return emptyList()
        val out = mutableListOf<String>()
        for (i in 0 until arr.length()) {
            val s = arr.optString(i).trim()
            if (s.isNotEmpty()) out.add(s)
        }
        return out
    }

    private inline fun <reified T : Enum<T>> parseEnum(raw: String, fallback: T): T {
        val cleaned = raw.trim().uppercase()
        return enumValues<T>().firstOrNull { it.name == cleaned } ?: fallback
    }

    internal fun isRateLimitOrQuotaError(err: Throwable): Boolean {
        val msg = (err.message ?: "").lowercase()
        return msg.contains("429") ||
            msg.contains("resource_exhausted") ||
            msg.contains("quota") ||
            msg.contains("rate limit")
    }

    internal fun isTransientCloudError(err: Throwable): Boolean {
        if (isRateLimitOrQuotaError(err)) return true
        val msg = (err.message ?: "").lowercase()
        return msg.contains("500") ||
            msg.contains("503") ||
            msg.contains("504") ||
            msg.contains("high demand") ||
            msg.contains("try again later") ||
            msg.contains("deadline expired") ||
            msg.contains("deadline_exceeded") ||
            msg.contains("unavailable") ||
            msg.contains("overloaded") ||
            msg.contains("timeout")
    }

    private fun isOnDeviceOrParseError(err: Throwable): Boolean {
        val msg = (err.message ?: "").lowercase()
        return msg.contains("token") ||
            msg.contains("context") ||
            msg.contains("limit") ||
            msg.contains("json") ||
            msg.contains("unavailable") ||
            err is org.json.JSONException
    }

    internal fun formatFriendlyAiException(err: Throwable): IllegalStateException {
        val raw = err.message ?: err::class.simpleName ?: "Unknown error"
        return when {
            isRateLimitOrQuotaError(err) -> IllegalStateException(
                "Cloud Gemini rate or token quota reached (429 / RESOURCE_EXHAUSTED). Wait 15 to 30 seconds and retry. ($raw)",
                err
            )
            isTransientCloudError(err) -> IllegalStateException(
                "Cloud Gemini is temporarily experiencing high demand or timed out (500/503/504). Retry in a moment. ($raw)",
                err
            )
            else -> IllegalStateException(raw, err)
        }
    }
}
