import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif
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
        if isFirebaseConfigured {
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
        }
        #endif
        #if canImport(FoundationModels)
        let nativeStatus = checkNativeFoundationModelAvailability()
        if nativeStatus == .available || isFirebaseConfigured {
            return nativeStatus
        }
        #endif
        return .unconfigured
    }

    #if canImport(FoundationModels)
    private static func checkNativeFoundationModelAvailability() -> AppleModelStatus {
        switch FoundationModels.SystemLanguageModel.default.availability {
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
        @unknown default:
            return .unavailable
        }
    }
    #endif

    private static func buildPrivacyPrompt(chunk: String, chunkIndex: Int, totalChunks: Int) -> String {
        """
        You are a local on-device privacy scanner for disaster reports (chunk \(chunkIndex + 1) of \(totalChunks)).
        Bracketed tags like [RESIDENT_1], [PHONE_1], [HANDLE_1], [ADDRESS_1] are already redacted.
        Find any REMAINING unredacted personal person names, phone numbers, social @handles, or exact house street numbers in the text below.
        Do NOT include city, district, village, bridge, dam, river, school, or agency names.
        Respond strictly as JSON with an array of exact substrings to redact (empty array [] if none remain):
        {"extraPii":["exact name or phone"]}

        TEXT:
        \(chunk)
        """
    }

    private static let nonPiiLocationAllowlist: Set<String> = [
        "indonesia", "west java", "east java", "jawa barat", "jawa timur", "jawa", "bali",
        "cianjur", "cugenang", "sukamaju", "dayeuhkolot", "bandung", "bandung raya",
        "cirata", "bendungan cirata", "semeru", "pacet", "cipendawa", "warungkondang",
        "mekarsari", "gekbrong", "sukaresmi", "karangtengah", "mande", "cilaku", "ciranjang",
        "bmkg", "bnpb", "pvmbg", "bpbd", "basarnas", "pupr", "pdam", "pln", "spbu", "wib"
    ]

    private static func runChunkedPrivacyPass(
        baseText: String,
        redactions: inout [RedactionItem],
        respond: (String) async throws -> String
    ) async throws -> (text: String, usedModel: Bool) {
        let chunks = splitIntoSafeChunks(baseText, maxChunkChars: SigapConstants.localPrivacyChunkChars)
        var refinedChunks: [String] = []
        refinedChunks.reserveCapacity(chunks.count)
        var usedModel = false
        var localModelCounter = 0

        for chunk in chunks {
            let prompt = buildPrivacyPrompt(chunk: chunk, chunkIndex: refinedChunks.count, totalChunks: chunks.count)
            let content = try await respond(prompt)
            if let parsed = parsePrivacyJson(content) {
                usedModel = true
                var updatedChunk = chunk

                for candidate in parsed.extraPii {
                    let trimmed = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard trimmed.count >= 3,
                          trimmed.count <= 45,
                          !trimmed.contains("["),
                          !trimmed.contains("]"),
                          !nonPiiLocationAllowlist.contains(trimmed.lowercased()),
                          updatedChunk.contains(trimmed) else {
                        continue
                    }
                    localModelCounter += 1
                    let placeholder = "[LOCAL_MODEL_\(localModelCounter)]"
                    updatedChunk = updatedChunk.replacingOccurrences(of: trimmed, with: placeholder)
                    redactions.append(
                        RedactionItem(
                            category: .otherPii,
                            placeholder: placeholder,
                            reason: "Additional entity redacted on-device by Apple Foundation Models"
                        )
                    )
                }

                if parsed.extraPii.isEmpty,
                   let alt = parsed.sanitizedText,
                   alt != "...",
                   alt.count >= Int(Double(chunk.count) * 0.85) {
                    let postGuarded = deterministicRegexScrub(alt)
                    updatedChunk = postGuarded.text
                    redactions.append(contentsOf: postGuarded.items)
                }

                refinedChunks.append(updatedChunk)
            } else {
                refinedChunks.append(chunk)
            }
        }

        let joined = refinedChunks.joined(separator: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
        return (joined.isEmpty ? baseText : joined, usedModel)
    }

    private static func mergeStreamSnapshot(_ snapshotContent: String, accumulated: String) -> String {
        if snapshotContent.hasPrefix(accumulated) || snapshotContent.count >= accumulated.count {
            return snapshotContent
        }
        return accumulated + snapshotContent
    }

    private static func buildBriefingPrompt(dispatch: DispatchCard, format: BriefingFormat) -> String {
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
        return """
        \(formatInstruction)
        Use only facts present below. Never use em dashes. Keep under 160 words.

        \(compactSource)
        """
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
                let pass = try await runChunkedPrivacyPass(baseText: finalSanitized, redactions: &redactions) { prompt in
                    // Fresh single-turn session keeps Foundation Models within its 4,096 token window.
                    let session = ai.generativeModelSession(model: systemModel)
                    let response = try await session.respond(to: prompt)
                    return response.content
                }
                finalSanitized = pass.text
                usedLocalModel = pass.usedModel
                usedRegexFallback = !pass.usedModel
            } catch {
                // Keep deterministic local regex result so PII never reaches the cloud unredacted.
                usedLocalModel = false
                usedRegexFallback = true
            }
        }
        #endif

        #if canImport(FoundationModels)
        if !usedLocalModel, FoundationModels.SystemLanguageModel.default.isAvailable {
            do {
                let pass = try await runChunkedPrivacyPass(baseText: finalSanitized, redactions: &redactions) { prompt in
                    let session = FoundationModels.LanguageModelSession(model: FoundationModels.SystemLanguageModel.default)
                    let response = try await session.respond(to: prompt)
                    return response.content
                }
                finalSanitized = pass.text
                usedLocalModel = pass.usedModel
                usedRegexFallback = !pass.usedModel
            } catch {
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

    public static func formatAreaKnowledgeContext(_ facts: [AreaKnowledgeFact]) -> String {
        let activeFacts = facts.filter { $0.active && !$0.fact.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        guard !activeFacts.isEmpty else { return "" }

        let maxFacts = 6
        let maxChars = 900
        let header = "VERIFIED AREA KNOWLEDGE (HUMAN-CONFIRMED - DO NOT CONTRADICT; CITE [AK-N]):"
        var lines: [String] = [header]
        var charCount = header.count
        var included = 0

        for item in activeFacts {
            if included >= maxFacts { break }
            let cleanFact = item.fact.trimmingCharacters(in: .whitespacesAndNewlines)
            let entry = "[AK-\(included + 1)] (\(item.category)) \(cleanFact)"
            let candidate = charCount + 1 + entry.count
            if candidate > maxChars && included > 0 { break }
            if candidate > maxChars {
                let remaining = max(40, maxChars - charCount - 4)
                lines.append(String(entry.prefix(remaining)) + "...")
                break
            }
            lines.append(entry)
            charCount = candidate
            included += 1
        }
        return lines.joined(separator: "\n")
    }

    /// Stage 2: Text-only hybrid intake extraction with automatic Token-Budget Routing.
    /// Uses HybridModel(primary: SystemLanguageModel.default, secondary: cloudModel) when <= 1,600 est. tokens;
    /// automatically routes larger dumps directly to Cloud Gemini.
    public static func triageTextIntake(
        sanitizedText: String,
        mode: IntakeMode,
        fastCloudModel: String,
        isFirebaseConfigured: Bool,
        areaKnowledge: [AreaKnowledgeFact] = []
    ) async throws -> HybridTriageResult {
        let cleaned = sanitizedText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else {
            throw AppleHybridAiError.emptyInput
        }

        let started = Date()
        let akContext = formatAreaKnowledgeContext(areaKnowledge)
        let combinedForBudget = akContext.isEmpty ? cleaned : "\(akContext)\n\n\(cleaned)"
        let estimatedTokens = estimateTokens(combinedForBudget)
        let exceedsLocalBudget = estimatedTokens > SigapConstants.appleOnDeviceSafeInputTokens

        let routingReason: String
        let requestedMode: String
        if !isFirebaseConfigured {
            #if canImport(FoundationModels)
            if !exceedsLocalBudget, FoundationModels.SystemLanguageModel.default.isAvailable {
                do {
                    let session = FoundationModels.LanguageModelSession(model: FoundationModels.SystemLanguageModel.default)
                    let prompt = buildTriagePrompt(sanitizedText: cleaned, mode: mode, areaKnowledgeContext: akContext)
                    let response = try await session.respond(to: prompt)
                    let parsed = parseStructuredIntakeJson(
                        rawText: response.content,
                        fallbackSourceText: cleaned,
                        mode: mode
                    )
                    return HybridTriageResult(
                        structured: parsed,
                        inferenceSource: .onDevice,
                        inferenceModeRequested: "ONLY_ON_DEVICE",
                        latencyMs: max(1, Int(Date().timeIntervalSince(started) * 1000)),
                        routingReason: "Executed natively on-device via Apple FoundationModels.SystemLanguageModel.default.",
                        estimatedInputTokens: estimatedTokens,
                        ranOfflineDeterministicFallback: false
                    )
                } catch {
                    // Fall back to deterministic heuristic card below.
                }
            }
            #endif
            requestedMode = exceedsLocalBudget ? "ONLY_IN_CLOUD" : "ONLY_ON_DEVICE"
            routingReason = exceedsLocalBudget
                ? "Estimated \(estimatedTokens) tokens exceeds \(SigapConstants.appleOnDeviceSafeInputTokens) local budget; add GoogleService-Info.plist to escalate to Cloud Gemini. Generated deterministic local preview."
                : "Firebase not configured locally; ran deterministic offline heuristic preview."
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

        let prompt = buildTriagePrompt(sanitizedText: cleaned, mode: mode, areaKnowledgeContext: akContext)

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
                let prompt = buildBriefingPrompt(dispatch: dispatch, format: format)

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
                        var accumulated = ""
                        let stream = session.streamResponse(to: prompt)
                        for try await snapshot in stream {
                            accumulated = mergeStreamSnapshot(snapshot.content, accumulated: accumulated)
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
                        // Fall through to native FoundationModels or deterministic local brief below.
                    }
                }
                #endif

                #if canImport(FoundationModels)
                if !isFirebaseConfigured, FoundationModels.SystemLanguageModel.default.isAvailable {
                    do {
                        let session = FoundationModels.LanguageModelSession(model: FoundationModels.SystemLanguageModel.default)
                        var accumulated = ""
                        let stream = session.streamResponse(to: prompt)
                        for try await snapshot in stream {
                            accumulated = mergeStreamSnapshot(snapshot.content, accumulated: accumulated)
                            continuation.yield(
                                BriefingChunkUpdate(
                                    text: accumulated,
                                    inferenceSource: .onDevice,
                                    routingNote: "Streaming natively on-device via Apple FoundationModels.SystemLanguageModel.default."
                                )
                            )
                        }
                        if !accumulated.isEmpty {
                            continuation.finish()
                            return
                        }
                    } catch {
                        // Fall through to deterministic local brief below.
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

        // Indonesian & international phone formats (matches Web & Android patterns including optional space after +62)
        replaceMatches(
            pattern: #"(?:\+62|62|0)\s?8\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{3,5}"#,
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

        // Indonesian honorific & kinship person names (Pak / Bu / Ibu / Bapak / Sdr / Sdri / sepupu sy ...)
        replaceMatches(
            pattern: #"\b(?:Pak|Bu|Ibu|Bapak|Sdr\.?|Sdri\.?|sepupu\s+sy|sepupu\s+saya|kakak|adik)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}"#,
            category: .personName,
            placeholderPrefix: "RESIDENT",
            reason: "Resident or volunteer name redacted locally"
        )

        return (text, items.reversed())
    }

    private struct PrivacyModelResponse {
        let extraPii: [String]
        let sanitizedText: String?
    }

    private static func parsePrivacyJson(_ rawText: String) -> PrivacyModelResponse? {
        if let jsonStr = extractJsonObject(from: rawText),
           let data = jsonStr.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            let extraPii = (obj["extraPii"] as? [Any])?
                .compactMap { ($0 as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty } ?? []
            let sanitized = (obj["sanitizedText"] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines)

            if obj["extraPii"] == nil && sanitized == nil {
                return nil
            }
            return PrivacyModelResponse(extraPii: extraPii, sanitizedText: sanitized)
        }

        if let arrStr = extractJsonSlice(from: rawText, open: "[", close: "]"),
           let data = arrStr.data(using: .utf8),
           let arr = try? JSONSerialization.jsonObject(with: data) as? [Any] {
            let extraPii = arr
                .compactMap { ($0 as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            return PrivacyModelResponse(extraPii: extraPii, sanitizedText: nil)
        }

        return nil
    }

    private static func buildTriagePrompt(
        sanitizedText: String,
        mode: IntakeMode,
        areaKnowledgeContext: String = ""
    ) -> String {
        let akBlock = areaKnowledgeContext.isEmpty ? "" : "\n\(areaKnowledgeContext)\n"
        return """
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
        \(akBlock)
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

    private static func extractJsonSlice(from raw: String, open: Character, close: Character) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let first = trimmed.firstIndex(of: open),
           let last = trimmed.lastIndex(of: close),
           first < last {
            return String(trimmed[first...last])
        }
        return nil
    }

    private static func extractJsonObject(from raw: String) -> String? {
        extractJsonSlice(from: raw, open: "{", close: "}")
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
