import Foundation
#if canImport(FirebaseAILogic)
import FirebaseAILogic
import FirebaseCore
#endif

public enum AppleHybridAiError: LocalizedError {
    case emptyInput
    case sdkUnavailable
    case firebaseNotConfigured

    public var errorDescription: String? {
        switch self {
        case .emptyInput:
            return "Enter a synthetic field update or viral rumor before running local sanitization."
        case .sdkUnavailable:
            return "FirebaseAILogic package is not linked yet. Resolve Swift Package dependencies in Xcode."
        case .firebaseNotConfigured:
            return "Add GoogleService-Info.plist to enable Cloud Gemini fallback. Local deterministic checks still work."
        }
    }
}

public struct GroundedCheckResult: Sendable {
    public let verdict: RumorVerdict
    public let factId: String
    public let factEn: String
    public let sources: [GroundingSource]
    public let searchEntryPointHtml: String?
    public let latencyMs: Int
}

public struct BriefingChunkUpdate: Sendable {
    public let text: String
    public let inferenceSource: InferenceSourceLabel
    public let routingNote: String
}

public enum AppleHybridAiService {
    public static func estimateTokens(_ text: String) -> Int {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return 0 }
        return Int(ceil(Double(trimmed.count) / 3.2))
    }

    public static func checkAvailability(isFirebaseConfigured: Bool) -> AppleModelStatus {
        #if canImport(FirebaseAILogic)
        if !isFirebaseConfigured {
            return .unconfigured
        }
        switch FirebaseAI.SystemLanguageModel.default.availability {
        case .available:
            return .available
        case .unavailable(.deviceNotEligible):
            return .deviceNotEligible
        case .unavailable(.appleIntelligenceNotEnabled):
            return .appleIntelligenceDisabled
        case .unavailable(.modelNotReady):
            return .modelNotReady
        case .unavailable:
            return .unavailable
        }
        #else
        return .unconfigured
        #endif
    }

    /// Stage 1: ONLY_ON_DEVICE local privacy firewall.
    /// Scrubs phone numbers, chat handles, honorific person names, and street addresses locally
    /// before any text leaves the device. Never transmits unredacted text to cloud endpoints.
    public static func redactPiiLocally(
        rawText: String,
        isFirebaseConfigured: Bool
    ) async -> LocalPrivacyResult {
        let started = Date()
        let cleaned = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else {
            return LocalPrivacyResult(
                sanitizedText: "",
                redactions: [],
                inferenceSource: .onDevice,
                usedLocalModel: false,
                latencyMs: 0,
                usedRegexFallback: true
            )
        }

        // First apply deterministic local regex scrubbing across the full input (safe at any length).
        let regexResult = deterministicRegexScrub(cleaned)
        var finalSanitized = regexResult.text
        var redactions = regexResult.items
        var usedLocalModel = false
        var usedRegexFallback = true

        #if canImport(FirebaseAILogic)
        if isFirebaseConfigured, FirebaseAI.SystemLanguageModel.default.isAvailable {
            do {
                let ai = FirebaseAI.firebaseAI(backend: .googleAI())
                let systemModel = FirebaseAI.SystemLanguageModel.default
                let chunks = splitIntoSafeChunks(finalSanitized, maxChunkChars: SigapConstants.localPrivacyChunkChars)
                var refinedChunks: [String] = []
                refinedChunks.reserveCapacity(chunks.count)

                for (chunkIdx, chunk) in chunks.enumerated() {
                    // Fresh single-turn session keeps Foundation Models within its 4,096 token window.
                    let session = ai.generativeModelSession(model: systemModel)
                    let prompt = """
                    You are a strict local crisis-data privacy filter running ONLY on-device.
                    Inspect this disaster field text (chunk \(chunkIdx + 1) of \(chunks.count)).
                    Replace any remaining personal names, phone numbers, social/chat handles, ID numbers, or exact house street addresses with placeholders like [RESIDENT_\(chunkIdx + 1)], [PHONE_\(chunkIdx + 1)], [HANDLE_\(chunkIdx + 1)], or [ADDRESS_\(chunkIdx + 1)].
                    Keep place/district/village/river/bridge names, hazard details, counts, and timestamps intact.
                    Respond strictly as JSON: {"sanitizedText":"...","extraRedactions":0}

                    TEXT:
                    \(chunk)
                    """
                    let response = try await session.respond(to: prompt)
                    if let parsed = parsePrivacyJson(response.content), !parsed.sanitizedText.isEmpty {
                        refinedChunks.append(parsed.sanitizedText)
                        if parsed.extraRedactions > 0 {
                            redactions.append(
                                RedactionItem(
                                    category: .otherPii,
                                    placeholder: "[LOCAL_MODEL_\(chunkIdx + 1)]",
                                    reason: "Additional entity redacted on-device by Apple Foundation Models"
                                )
                            )
                        }
                        usedLocalModel = true
                        usedRegexFallback = false
                    } else {
                        refinedChunks.append(chunk)
                    }
                }
                let joined = refinedChunks.joined(separator: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
                if !joined.isEmpty {
                    finalSanitized = joined
                }
            } catch {
                // Keep deterministic local regex result so PII never reaches the cloud unredacted.
                usedLocalModel = false
                usedRegexFallback = true
            }
        }
        #endif

        let elapsed = max(1, Int(Date().timeIntervalSince(started) * 1000))
        return LocalPrivacyResult(
            sanitizedText: finalSanitized,
            redactions: redactions,
            inferenceSource: .onDevice,
            usedLocalModel: usedLocalModel,
            latencyMs: elapsed,
            usedRegexFallback: usedRegexFallback
        )
    }

    /// Stage 2: Text-only hybrid intake extraction with automatic Token-Budget Routing.
    /// Uses HybridModel(primary: SystemLanguageModel.default, secondary: cloudModel) when <= 1,600 est. tokens;
    /// automatically routes larger dumps directly to Cloud Gemini.
    public static func triageTextIntake(
        sanitizedText: String,
        mode: IntakeMode,
        fastCloudModel: String,
        isFirebaseConfigured: Bool
    ) async throws -> HybridTriageResult {
        let cleaned = sanitizedText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else {
            throw AppleHybridAiError.emptyInput
        }

        let started = Date()
        let estimatedTokens = estimateTokens(cleaned)
        let exceedsLocalBudget = estimatedTokens > SigapConstants.appleOnDeviceSafeInputTokens

        let routingReason: String
        let requestedMode: String
        if !isFirebaseConfigured {
            routingReason = "Firebase not configured locally; ran deterministic offline heuristic preview."
            requestedMode = "ONLY_ON_DEVICE"
            let structured = deterministicHeuristicTriage(cleaned: cleaned, mode: mode)
            return HybridTriageResult(
                structured: structured,
                inferenceSource: .onDevice,
                inferenceModeRequested: requestedMode,
                latencyMs: max(1, Int(Date().timeIntervalSince(started) * 1000)),
                routingReason: routingReason,
                estimatedInputTokens: estimatedTokens,
                ranOfflineDeterministicFallback: true
            )
        }

        if exceedsLocalBudget {
            requestedMode = "ONLY_IN_CLOUD"
            routingReason = "Estimated \(estimatedTokens) tokens exceeds Apple on-device safety limit (\(SigapConstants.appleOnDeviceSafeInputTokens)); routed to Cloud Gemini."
        } else {
            requestedMode = "PREFER_ON_DEVICE"
            routingReason = "Estimated \(estimatedTokens) tokens fits Apple Foundation Models window; HybridModel prefers on-device with automatic cloud fallback."
        }

        #if canImport(FirebaseAILogic)
        let ai = FirebaseAI.firebaseAI(backend: .googleAI())
        let cloudModel = ai.geminiModel(name: fastCloudModel)
        let systemModel = FirebaseAI.SystemLanguageModel.default

        let prompt = buildTriagePrompt(sanitizedText: cleaned, mode: mode)

        do {
            let session = exceedsLocalBudget
                ? ai.generativeModelSession(model: cloudModel)
                : ai.generativeModelSession(model: .hybridModel(primary: systemModel, secondary: cloudModel))

            let response = try await session.respond(to: prompt)
            let rawModelVersion = unwrapOptionalString(response.rawResponse.modelVersion) ?? ""
            let ranOnDevice = rawModelVersion.lowercased().contains("apple-foundation-models")
            let sourceLabel: InferenceSourceLabel = ranOnDevice ? .onDevice : .inCloud

            let parsed = parseStructuredIntakeJson(
                rawText: response.content,
                fallbackSourceText: cleaned,
                mode: mode
            )

            let finalReason = ranOnDevice
                ? "Executed on-device via Apple Foundation Models (\(rawModelVersion))."
                : (exceedsLocalBudget
                    ? routingReason
                    : "Executed in-cloud via \(rawModelVersion.isEmpty ? fastCloudModel : rawModelVersion) (hybrid fallback).")

            return HybridTriageResult(
                structured: parsed,
                inferenceSource: sourceLabel,
                inferenceModeRequested: requestedMode,
                latencyMs: max(1, Int(Date().timeIntervalSince(started) * 1000)),
                routingReason: finalReason,
                estimatedInputTokens: estimatedTokens,
                ranOfflineDeterministicFallback: false
            )
        } catch {
            // If network/quota fails offline, gracefully fall back to deterministic heuristic card so responder stays unblocked.
            let structured = deterministicHeuristicTriage(cleaned: cleaned, mode: mode)
            return HybridTriageResult(
                structured: structured,
                inferenceSource: .onDevice,
                inferenceModeRequested: requestedMode,
                latencyMs: max(1, Int(Date().timeIntervalSince(started) * 1000)),
                routingReason: "Network/API unavailable (\(error.localizedDescription)); generated deterministic offline card.",
                estimatedInputTokens: estimatedTokens,
                ranOfflineDeterministicFallback: true
            )
        }
        #else
        let structured = deterministicHeuristicTriage(cleaned: cleaned, mode: mode)
        return HybridTriageResult(
            structured: structured,
            inferenceSource: .onDevice,
            inferenceModeRequested: "ONLY_ON_DEVICE",
            latencyMs: max(1, Int(Date().timeIntervalSince(started) * 1000)),
            routingReason: "FirebaseAILogic module unavailable; ran deterministic offline heuristic preview.",
            estimatedInputTokens: estimatedTokens,
            ranOfflineDeterministicFallback: true
        )
        #endif
    }

    /// Stage 3 (Optional on Rumor Check): ONLY_IN_CLOUD verification using Google Search Grounding.
    public static func verifyClaimWithGoogleSearch(
        sanitizedText: String,
        synthesisCloudModel: String,
        isFirebaseConfigured: Bool
    ) async throws -> GroundedCheckResult {
        guard isFirebaseConfigured else {
            throw AppleHybridAiError.firebaseNotConfigured
        }
        #if canImport(FirebaseAILogic)
        let started = Date()
        let ai = FirebaseAI.firebaseAI(backend: .googleAI())
        let model = ai.generativeModel(
            modelName: synthesisCloudModel,
            tools: [.googleSearch()]
        )
        let prompt = """
        Verify this disaster-related rumor using Google Search.
        Never guess or invent facts. If official agency confirmation (BNPB, BMKG, PVMBG, BPBD, Basarnas, Kemenhub) is absent, classify as UNVERIFIED_DEVELOPING.
        Respond strictly in JSON:
        {"verdict":"VERIFIED|MISLEADING|UNVERIFIED_DEVELOPING","factId":"concise Indonesian clarification","factEn":"concise English clarification"}

        CLAIM (SANITIZED):
        \(sanitizedText)
        """

        let response = try await model.generateContent(prompt)
        let rawText = response.text ?? ""
        var sources: [GroundingSource] = []
        var searchHtml: String?

        if let candidate = response.candidates.first,
           let groundingMetadata = candidate.groundingMetadata {
            searchHtml = groundingMetadata.searchEntryPoint?.renderedContent
            for chunk in groundingMetadata.groundingChunks {
                if let web = chunk.web,
                   let uri = unwrapOptionalString(web.uri),
                   uri.hasPrefix("http://") || uri.hasPrefix("https://") {
                    let title = unwrapOptionalString(web.title)?.trimmingCharacters(in: .whitespacesAndNewlines)
                    sources.append(GroundingSource(title: (title?.isEmpty == false ? title! : uri), uri: uri))
                }
            }
        }

        let parsed = parseGroundedCheckJson(rawText: rawText, hasSources: !sources.isEmpty)
        return GroundedCheckResult(
            verdict: parsed.verdict,
            factId: parsed.factId,
            factEn: parsed.factEn,
            sources: Array(sources.prefix(15)),
            searchEntryPointHtml: searchHtml,
            latencyMs: max(1, Int(Date().timeIntervalSince(started) * 1000))
        )
        #else
        throw AppleHybridAiError.sdkUnavailable
        #endif
    }

    /// Stage 5: Streaming Apple Foundation Models / Hybrid Briefing Adapter for synced dispatches.
    /// Uses HybridModel(primary: systemModel, secondary: cloudModel) so executives and dispatchers get instant
    /// on-device streaming on Apple Silicon even offline, with automatic cloud fallback on unsupported Macs/iOS builds.
    public static func streamDispatchBriefing(
        dispatch: DispatchCard,
        format: BriefingFormat,
        fastCloudModel: String,
        isFirebaseConfigured: Bool
    ) -> AsyncThrowingStream<BriefingChunkUpdate, Error> {
        AsyncThrowingStream { continuation in
            Task {
                let compactSource = buildCompactBriefingInput(dispatch)
                let formatInstruction: String
                switch format {
                case .executive3Bullet:
                    formatInstruction = "Produce an ultra-concise 3-bullet executive briefing in English covering Situation, Priority Needs, and Rumor/Gap status."
                case .bahasaPlainSummary:
                    formatInstruction = "Tulis ringkasan singkat Bahasa Indonesia yang jelas dan tenang dalam 3 poin aksi utama untuk masyarakat."
                case .mediaSpokespersonQuote:
                    formatInstruction = "Draft one attributed spokesperson quote (2 to 3 sentences, placeholder [Spokesperson]) suitable for broadcast media in Indonesian followed by an English translation."
                }

                #if canImport(FirebaseAILogic)
                if isFirebaseConfigured {
                    let ai = FirebaseAI.firebaseAI(backend: .googleAI())
                    let cloudModel = ai.geminiModel(name: fastCloudModel)
                    let systemModel = FirebaseAI.SystemLanguageModel.default
                    let onDeviceReady = systemModel.isAvailable
                    let expectedSource: InferenceSourceLabel = onDeviceReady ? .onDevice : .inCloud
                    let routingNote = onDeviceReady
                        ? "Streaming via HybridModel (primary: Apple Foundation Models on-device)."
                        : "Apple Foundation Models unavailable; streaming via HybridModel fallback (\(fastCloudModel))."

                    do {
                        let session = ai.generativeModelSession(
                            model: .hybridModel(primary: systemModel, secondary: cloudModel)
                        )
                        let prompt = """
                        \(formatInstruction)
                        Use only facts present below. Never use em dashes. Keep under 160 words.

                        \(compactSource)
                        """
                        var accumulated = ""
                        let stream = session.streamResponse(to: prompt)
                        for try await snapshot in stream {
                            accumulated += snapshot.content
                            continuation.yield(
                                BriefingChunkUpdate(
                                    text: accumulated,
                                    inferenceSource: expectedSource,
                                    routingNote: routingNote
                                )
                            )
                        }
                        if !accumulated.isEmpty {
                            continuation.finish()
                            return
                        }
                    } catch {
                        // Fall through to deterministic local brief if offline AND Apple Intelligence disabled.
                    }
                }
                #endif

                let localFallbackText = buildOfflineFallbackBriefing(dispatch: dispatch, format: format)
                continuation.yield(
                    BriefingChunkUpdate(
                        text: localFallbackText,
                        inferenceSource: .onDevice,
                        routingNote: "Generated deterministically on-device (offline or unconfigured preview)."
                    )
                )
                continuation.finish()
            }
        }
    }

    // MARK: - Private Helpers

    private static func unwrapOptionalString(_ value: String?) -> String? {
        value
    }

    private static func splitIntoSafeChunks(_ text: String, maxChunkChars: Int) -> [String] {
        guard text.count > maxChunkChars else { return [text] }
        let paragraphs = text.components(separatedBy: "\n\n")
        var chunks: [String] = []
        var buffer = ""
        for para in paragraphs {
            let trimmed = para.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }
            if buffer.isEmpty {
                buffer = trimmed
            } else if buffer.count + trimmed.count + 2 <= maxChunkChars {
                buffer += "\n\n" + trimmed
            } else {
                chunks.append(buffer)
                buffer = trimmed
            }
        }
        if !buffer.isEmpty {
            chunks.append(buffer)
        }
        return chunks.isEmpty ? [String(text.prefix(maxChunkChars))] : chunks
    }

    private static func deterministicRegexScrub(_ raw: String) -> (text: String, items: [RedactionItem]) {
        var text = raw
        var items: [RedactionItem] = []

        func replaceMatches(
            pattern: String,
            options: NSRegularExpression.Options = [],
            category: RedactionCategory,
            placeholderPrefix: String,
            reason: String
        ) {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return }
            let fullRange = NSRange(text.startIndex..<text.endIndex, in: text)
            let matches = regex.matches(in: text, options: [], range: fullRange)
            guard !matches.isEmpty else { return }

            var counter = 0
            // Iterate in reverse to preserve string indices cleanly.
            for match in matches.reversed() {
                guard let swiftRange = Range(match.range, in: text) else { continue }
                counter += 1
                let tag = "[\(placeholderPrefix)_\(matches.count - counter + 1)]"
                text.replaceSubrange(swiftRange, with: tag)
                items.append(RedactionItem(category: category, placeholder: tag, reason: reason))
            }
        }

        // Indonesian & international phone formats
        replaceMatches(
            pattern: #"(?:\+62|62|0)8[0-9\-\s]{7,15}"#,
            category: .phoneNumber,
            placeholderPrefix: "PHONE",
            reason: "Phone number redacted locally"
        )

        // Chat / social handles
        replaceMatches(
            pattern: #"@[A-Za-z0-9_]{3,30}"#,
            category: .chatHandle,
            placeholderPrefix: "HANDLE",
            reason: "Chat/social handle redacted locally"
        )

        // Street addresses (Jl. / Jalan ... No. ... RT/RW ...)
        replaceMatches(
            pattern: #"\b(?:Jl\.?|Jalan)\s+[A-Za-z0-9.\s]{2,40}?\s+No\.?\s*\d+(?:\s*(?:RT|RW)\s*\d+(?:/(?:RT|RW)?\s*\d+)?)?"#,
            options: [.caseInsensitive],
            category: .addressDetail,
            placeholderPrefix: "ADDRESS",
            reason: "House street address redacted locally"
        )

        // Indonesian honorific person names (Pak / Bu / Ibu / Bapak / Sdr / Sdri / sepupu sy ...)
        replaceMatches(
            pattern: #"\b(?:Pak|Bu|Ibu|Bapak|Sdr\.?|Sdri\.?)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}"#,
            category: .personName,
            placeholderPrefix: "RESIDENT",
            reason: "Resident or volunteer name redacted locally"
        )

        return (text, items.reversed())
    }

    private static func parsePrivacyJson(_ rawText: String) -> (sanitizedText: String, extraRedactions: Int)? {
        guard let jsonStr = extractJsonObject(from: rawText),
              let data = jsonStr.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let sanitized = obj["sanitizedText"] as? String else {
            return nil
        }
        let count = (obj["extraRedactions"] as? Int) ?? 0
        return (sanitized.trimmingCharacters(in: .whitespacesAndNewlines), count)
    }

    private static func buildTriagePrompt(sanitizedText: String, mode: IntakeMode) -> String {
        """
        Analyze this locally PII-sanitized Indonesian/English disaster intake (\(mode.rawValue)).
        Return ONLY valid JSON matching these keys and allowed enum values:
        {
          "headline": "concise factual headline under 120 chars",
          "hazardType": "EARTHQUAKE|FLOOD|VOLCANO|LANDSLIDE|TSUNAMI|OTHER",
          "location": "affected subdistrict/city/province",
          "severity": "CRITICAL|HIGH|MEDIUM|LOW",
          "summaryId": "2 sentence Bahasa Indonesia summary",
          "summaryEn": "2 sentence English summary",
          "keyFacts": ["fact 1", "fact 2"],
          "urgentNeeds": ["need 1"],
          "verificationGaps": ["unconfirmed item 1"],
          "rumorVerdict": "VERIFIED|MISLEADING|UNVERIFIED_DEVELOPING|NOT_APPLICABLE",
          "panicSignals": ["viral urgency signal if rumor, else empty array"]
        }

        SANITIZED TEXT:
        \(sanitizedText)
        """
    }

    private static func parseStructuredIntakeJson(
        rawText: String,
        fallbackSourceText: String,
        mode: IntakeMode
    ) -> StructuredIntake {
        let fallback = deterministicHeuristicTriage(cleaned: fallbackSourceText, mode: mode)
        guard let jsonStr = extractJsonObject(from: rawText),
              let data = jsonStr.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return fallback
        }

        func str(_ key: String, defaultVal: String) -> String {
            let v = (obj[key] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return v.isEmpty ? defaultVal : v
        }

        func strList(_ key: String, defaultVal: [String]) -> [String] {
            guard let arr = obj[key] as? [Any] else { return defaultVal }
            let mapped = arr.compactMap { ($0 as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
            return mapped.isEmpty ? defaultVal : Array(mapped.prefix(20))
        }

        return StructuredIntake(
            headline: String(str("headline", defaultVal: fallback.headline).prefix(300)),
            hazardType: HazardType.from(obj["hazardType"] as? String),
            location: String(str("location", defaultVal: fallback.location).prefix(200)),
            severity: SeverityLevel.from(obj["severity"] as? String),
            summaryId: String(str("summaryId", defaultVal: fallback.summaryId).prefix(2000)),
            summaryEn: String(str("summaryEn", defaultVal: fallback.summaryEn).prefix(2000)),
            keyFacts: strList("keyFacts", defaultVal: fallback.keyFacts),
            urgentNeeds: strList("urgentNeeds", defaultVal: fallback.urgentNeeds),
            verificationGaps: strList("verificationGaps", defaultVal: fallback.verificationGaps),
            rumorVerdict: mode == .rumorCheck
                ? RumorVerdict.from(obj["rumorVerdict"] as? String)
                : .notApplicable,
            panicSignals: strList("panicSignals", defaultVal: fallback.panicSignals),
            groundingSources: [],
            searchEntryPointHtml: nil
        )
    }

    private static func parseGroundedCheckJson(
        rawText: String,
        hasSources: Bool
    ) -> (verdict: RumorVerdict, factId: String, factEn: String) {
        if let jsonStr = extractJsonObject(from: rawText),
           let data = jsonStr.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            let rawVerdict = RumorVerdict.from(obj["verdict"] as? String)
            let safeVerdict: RumorVerdict = (rawVerdict == .notApplicable)
                ? (hasSources ? .unverifiedDeveloping : .unverifiedDeveloping)
                : rawVerdict
            let factId = (obj["factId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let factEn = (obj["factEn"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            return (
                verdict: safeVerdict,
                factId: (factId?.isEmpty == false ? factId! : "Status klaim masih memerlukan konfirmasi kanal resmi terkait."),
                factEn: (factEn?.isEmpty == false ? factEn! : "Claim requires confirmation from official emergency authorities.")
            )
        }
        return (
            verdict: .unverifiedDeveloping,
            factId: "Klarifikasi awal dilakukan, namun verifikasi otoritas resmi masih terus dipantau.",
            factEn: "Initial search check completed; authoritative agency confirmation remains in progress."
        )
    }

    private static func deterministicHeuristicTriage(cleaned: String, mode: IntakeMode) -> StructuredIntake {
        let lower = cleaned.lowercased()
        let hazard: HazardType
        if lower.contains("gempa") || lower.contains("quake") {
            hazard = .earthquake
        } else if lower.contains("banjir") || lower.contains("flood") || lower.contains("bendungan") || lower.contains("dam") {
            hazard = .flood
        } else if lower.contains("gunung") || lower.contains("vulkanik") || lower.contains("erupsi") || lower.contains("semeru") || lower.contains("merapi") {
            hazard = .volcano
        } else if lower.contains("longsor") || lower.contains("landslide") {
            hazard = .landslide
        } else {
            hazard = .other
        }

        let severity: SeverityLevel = (lower.contains("darurat") || lower.contains("jebol") || lower.contains("ambruk") || lower.contains("putus"))
            ? .high
            : .medium

        let headline = mode == .rumorCheck
            ? "Unverified Viral Claim Flagged for Clarification (\(hazard.rawValue))"
            : "Sanitized Field Update Logged (\(hazard.rawValue))"

        return StructuredIntake(
            headline: headline,
            hazardType: hazard,
            location: "Indonesia (Synthetic Drill)",
            severity: severity,
            summaryId: String(cleaned.prefix(280)),
            summaryEn: "Locally sanitized \(mode == .rumorCheck ? "rumor check" : "field report") ready for command desk review.",
            keyFacts: [String(cleaned.prefix(160))],
            urgentNeeds: mode == .fieldReport ? ["Awaiting command desk triage and resource confirmation"] : [],
            verificationGaps: ["Pending authoritative confirmation from field desk or Search grounding"],
            rumorVerdict: mode == .rumorCheck ? .unverifiedDeveloping : .notApplicable,
            panicSignals: mode == .rumorCheck ? ["Urgency framing / unverified forwarding"] : [],
            groundingSources: [],
            searchEntryPointHtml: nil
        )
    }

    private static func extractJsonObject(from raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let first = trimmed.firstIndex(of: "{"),
           let last = trimmed.lastIndex(of: "}"),
           first < last {
            return String(trimmed[first...last])
        }
        return nil
    }

    private static func buildCompactBriefingInput(_ d: DispatchCard) -> String {
        let debunkLine = d.hasRumorAlert
            ? "Rumor (\(d.debunkVerdict.rawValue)): \(d.debunkFactEn)"
            : "No active rumor debunk."
        return """
        Dispatch #\(d.dispatchNumber) [\(d.severity.rawValue)]
        Community ID: \(d.communityTitle) | \(d.communityWhatHappened)
        Global EN: \(d.globalHeadline) | \(d.globalExecutiveSummary)
        Needs: \(d.globalPriorityNeeds.prefix(4).joined(separator: "; "))
        Gaps: \(d.globalInformationGaps.prefix(3).joined(separator: "; "))
        \(debunkLine)
        """
    }

    private static func buildOfflineFallbackBriefing(dispatch d: DispatchCard, format: BriefingFormat) -> String {
        switch format {
        case .executive3Bullet:
            return """
            - Situation: \(d.globalHeadline)
            - Priority Needs: \(d.globalPriorityNeeds.prefix(2).joined(separator: "; "))
            - Verification Status: \(d.hasRumorAlert ? "\(d.debunkVerdict.rawValue): \(d.debunkFactEn)" : "All core facts sourced from field intakes.")
            """
        case .bahasaPlainSummary:
            let actions = d.communityDoNow.prefix(2).map { "- \($0)" }.joined(separator: "\n")
            return """
            \(d.communityTitle)

            \(d.communityWhatHappened)

            Langkah Utama:
            \(actions)
            """
        case .mediaSpokespersonQuote:
            return """
            [Spokesperson]: "Tim posko terus memverifikasi kondisi lapangan dan mengalihkan jalur distribusi untuk menjaga pasokan bantuan. Masyarakat diimbau merujuk informasi resmi posko dan tidak meneruskan pesan berantai yang belum terkonfirmasi."

            English translation: "Field posts continue verifying conditions and rerouting supply lines to protect relief delivery. The public is urged to follow official command updates and avoid forwarding unverified chain messages."
            """
        }
    }
}
