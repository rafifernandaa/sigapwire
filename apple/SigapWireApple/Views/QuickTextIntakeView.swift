import SwiftUI

public struct QuickTextIntakeView: View {
    @Environment(\.colorScheme) private var scheme
    @ObservedObject var syncService: FirestoreSyncService

    @State private var mode: IntakeMode = .fieldReport
    @State private var rawInput: String = SyntheticDrillData.scenarios.first?.rawInput ?? ""
    @State private var selectedScenarioNote: String = SyntheticDrillData.scenarios.first?.note ?? ""
    @State private var isRedacting: Bool = false
    @State private var privacyResult: LocalPrivacyResult?
    @State private var isTriaging: Bool = false
    @State private var triageResult: HybridTriageResult?
    @State private var isVerifyingSearch: Bool = false
    @State private var isSaving: Bool = false
    @State private var statusMessage: String?
    @State private var errorMessage: String?

    public init(syncService: FirestoreSyncService) {
        self.syncService = syncService
    }

    private var estimatedTokens: Int {
        let target = privacyResult?.sanitizedText ?? rawInput
        return AppleHybridAiService.estimateTokens(target)
    }

    private var exceedsAppleBudget: Bool {
        estimatedTokens > SigapConstants.appleOnDeviceSafeInputTokens
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                headerSection
                inputComposerCard
                if let privacy = privacyResult {
                    privacyDiffCard(privacy)
                }
                if let triage = triageResult {
                    structuredResultCard(triage)
                }
            }
            .padding(16)
            .frame(maxWidth: 820, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(SigapTheme.ground(scheme))
    }

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Quick Text Intake (Privacy-First)")
                .font(.system(.title2, design: .serif, weight: .bold))
                .foregroundStyle(SigapTheme.inkPrimary(scheme))
            Text("Apple on-device Foundation Models handles text-only triage (up to 1,600 safe input tokens) after local PII redaction. Image capture runs on Web and Android.")
                .font(.subheadline)
                .foregroundStyle(SigapTheme.inkMuted(scheme))
        }
    }

    private var inputComposerCard: some View {
        let tokenBadgeColors = exceedsAppleBudget
            ? SigapTheme.warningColors(scheme)
            : SigapTheme.onDeviceColors(scheme)

        return VStack(alignment: .leading, spacing: 12) {
            Picker("Intake Mode", selection: $mode) {
                ForEach(IntakeMode.allCases) { item in
                    Text(item.displayLabel).tag(item)
                }
            }
            .pickerStyle(.segmented)

            VStack(alignment: .leading, spacing: 6) {
                Text("Load Synthetic Drill Preset")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(SigapTheme.inkMuted(scheme))

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(SyntheticDrillData.scenarios) { scenario in
                            Button {
                                mode = scenario.mode
                                rawInput = scenario.rawInput
                                selectedScenarioNote = scenario.note
                                privacyResult = nil
                                triageResult = nil
                                statusMessage = nil
                                errorMessage = nil
                            } label: {
                                Text(scenario.label)
                                    .font(.caption.weight(.medium))
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 6)
                                    .background(SigapTheme.subtle(scheme))
                                    .foregroundStyle(SigapTheme.inkPrimary(scheme))
                                    .clipShape(RoundedRectangle(cornerRadius: 6))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 6)
                                            .stroke(SigapTheme.borderSubtle(scheme), lineWidth: 1)
                                    )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                if !selectedScenarioNote.isEmpty {
                    Text(selectedScenarioNote)
                        .font(.caption)
                        .foregroundStyle(SigapTheme.inkMuted(scheme))
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Raw Report or Claim (Text-Only)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(SigapTheme.inkPrimary(scheme))
                    Spacer()
                    Text("Est. ~\(estimatedTokens) / \(SigapConstants.appleOnDeviceSafeInputTokens) tokens")
                        .font(.system(.caption2, design: .monospaced, weight: .semibold))
                        .monospacedDigit()
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .foregroundStyle(tokenBadgeColors.0)
                        .background(tokenBadgeColors.1)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                }

                TextEditor(text: $rawInput)
                    .font(.body)
                    .frame(minHeight: 130)
                    .padding(8)
                    .background(SigapTheme.ground(scheme))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(SigapTheme.borderStrong(scheme), lineWidth: 1)
                    )
                    .onChange(of: rawInput) { _, _ in
                        privacyResult = nil
                        triageResult = nil
                    }
            }

            HStack(spacing: 10) {
                Button {
                    runLocalRedaction()
                } label: {
                    HStack(spacing: 6) {
                        if isRedacting {
                            ProgressView().controlSize(.small)
                        }
                        Text(isRedacting ? "Redacting..." : "1. Scrub PII Locally")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(privacyResult == nil ? SigapTheme.accentVermilion : SigapTheme.subtle(scheme))
                    .foregroundStyle(privacyResult == nil ? Color.white : SigapTheme.inkPrimary(scheme))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
                .disabled(isRedacting || rawInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Button {
                    runHybridTriage()
                } label: {
                    HStack(spacing: 6) {
                        if isTriaging {
                            ProgressView().controlSize(.small)
                        }
                        Text(isTriaging ? "Analyzing..." : "2. Hybrid Triage")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(privacyResult != nil ? SigapTheme.accentVermilion : SigapTheme.subtle(scheme))
                    .foregroundStyle(privacyResult != nil ? Color.white : SigapTheme.inkMuted(scheme))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
                .disabled(privacyResult == nil || isTriaging)
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(SigapTheme.accentText(scheme))
            }
            if let statusMessage {
                Text(statusMessage)
                    .font(.caption)
                    .foregroundStyle(SigapTheme.onDeviceColors(scheme).0)
            }
        }
        .padding(16)
        .background(SigapTheme.surface(scheme))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(SigapTheme.borderSubtle(scheme), lineWidth: 1)
        )
    }

    private func privacyDiffCard(_ p: LocalPrivacyResult) -> some View {
        let onDeviceColors = SigapTheme.onDeviceColors(scheme)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text("Stayed Local vs. Cloud-Safe Output")
                    .font(.headline)
                    .foregroundStyle(SigapTheme.inkPrimary(scheme))
                Spacer()
                Text("ON_DEVICE (\(p.latencyMs) ms)")
                    .font(.system(.caption2, design: .monospaced, weight: .semibold))
                    .monospacedDigit()
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .foregroundStyle(onDeviceColors.0)
                    .background(onDeviceColors.1)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            }

            if p.redactions.isEmpty {
                Text("No phone numbers, names, handles, or house addresses matched locally.")
                    .font(.caption)
                    .foregroundStyle(SigapTheme.inkMuted(scheme))
            } else {
                Text("Stayed on device (\(p.redactions.count) item(s) scrubbed):")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(SigapTheme.inkPrimary(scheme))
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(p.redactions) { item in
                            Text("\(item.placeholder) (\(item.category.rawValue))")
                                .font(.system(.caption2, design: .monospaced))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 3)
                                .background(SigapTheme.subtle(scheme))
                                .foregroundStyle(SigapTheme.inkPrimary(scheme))
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                        }
                    }
                }
            }

            Text(p.sanitizedText)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(SigapTheme.inkPrimary(scheme))
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(SigapTheme.subtle(scheme))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .textSelection(.enabled)
        }
        .padding(16)
        .background(SigapTheme.surface(scheme))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(SigapTheme.borderSubtle(scheme), lineWidth: 1)
        )
    }

    private func structuredResultCard(_ triage: HybridTriageResult) -> some View {
        let s = triage.structured
        let sevColors = SigapTheme.severityColors(s.severity, scheme: scheme)
        let srcColors = triage.inferenceSource == .onDevice
            ? SigapTheme.onDeviceColors(scheme)
            : SigapTheme.inCloudColors(scheme)

        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                tag(s.severity.rawValue, fg: sevColors.fg, bg: sevColors.bg)
                tag(triage.inferenceSource.badgeText, fg: srcColors.fg, bg: srcColors.bg)
                tag("\(triage.latencyMs) ms", fg: SigapTheme.inkMuted(scheme), bg: SigapTheme.subtle(scheme))
                Spacer()
            }

            Text(s.headline)
                .font(.system(.title3, design: .serif, weight: .bold))
                .foregroundStyle(SigapTheme.inkPrimary(scheme))

            Text(triage.routingReason)
                .font(.caption)
                .foregroundStyle(SigapTheme.inkMuted(scheme))

            Text("ID: \(s.summaryId)")
                .font(.callout)
                .foregroundStyle(SigapTheme.inkPrimary(scheme))
            Text("EN: \(s.summaryEn)")
                .font(.callout)
                .foregroundStyle(SigapTheme.inkMuted(scheme))

            if !s.groundingSources.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Google Search Grounding Sources")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(SigapTheme.inkPrimary(scheme))
                    ForEach(s.groundingSources) { src in
                        if let url = URL(string: src.uri) {
                            Link(src.title, destination: url)
                                .font(.caption)
                                .foregroundStyle(SigapTheme.accentText(scheme))
                        }
                    }
                }
            }

            HStack(spacing: 10) {
                if mode == .rumorCheck {
                    Button {
                        runSearchCheck()
                    } label: {
                        HStack(spacing: 6) {
                            if isVerifyingSearch {
                                ProgressView().controlSize(.small)
                            }
                            Text(isVerifyingSearch ? "Checking Search..." : "Verify With Google Search")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(SigapTheme.subtle(scheme))
                        .foregroundStyle(SigapTheme.inkPrimary(scheme))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(SigapTheme.borderStrong(scheme), lineWidth: 1)
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(isVerifyingSearch || !syncService.isFirebaseConfigured)
                }

                Button {
                    saveToFirestore()
                } label: {
                    HStack(spacing: 6) {
                        if isSaving {
                            ProgressView().controlSize(.small)
                        }
                        Text(isSaving ? "Syncing..." : "Sync Intake to Firestore")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(SigapTheme.accentVermilion)
                    .foregroundStyle(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
                .disabled(isSaving || !syncService.isFirebaseConfigured)
            }
        }
        .padding(16)
        .background(SigapTheme.surface(scheme))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(SigapTheme.borderSubtle(scheme), lineWidth: 1)
        )
    }

    private func runLocalRedaction() {
        isRedacting = true
        errorMessage = nil
        statusMessage = nil

        Task { @MainActor in
            let res = await AppleHybridAiService.redactPiiLocally(
                rawText: rawInput,
                isFirebaseConfigured: syncService.isFirebaseConfigured
            )
            privacyResult = res
            isRedacting = false
        }
    }

    private func runHybridTriage() {
        guard let privacyResult else { return }
        isTriaging = true
        errorMessage = nil
        statusMessage = nil

        Task { @MainActor in
            do {
                let res = try await AppleHybridAiService.triageTextIntake(
                    sanitizedText: privacyResult.sanitizedText,
                    mode: mode,
                    fastCloudModel: syncService.fastCloudModel,
                    isFirebaseConfigured: syncService.isFirebaseConfigured
                )
                triageResult = res
            } catch {
                errorMessage = error.localizedDescription
            }
            isTriaging = false
        }
    }

    private func runSearchCheck() {
        guard let privacyResult, var currentTriage = triageResult else { return }
        isVerifyingSearch = true
        errorMessage = nil

        Task { @MainActor in
            do {
                let search = try await AppleHybridAiService.verifyClaimWithGoogleSearch(
                    sanitizedText: privacyResult.sanitizedText,
                    synthesisCloudModel: syncService.synthesisCloudModel,
                    isFirebaseConfigured: syncService.isFirebaseConfigured
                )
                let updatedStructured = StructuredIntake(
                    headline: currentTriage.structured.headline,
                    hazardType: currentTriage.structured.hazardType,
                    location: currentTriage.structured.location,
                    severity: currentTriage.structured.severity,
                    summaryId: search.factId,
                    summaryEn: search.factEn,
                    keyFacts: currentTriage.structured.keyFacts,
                    urgentNeeds: currentTriage.structured.urgentNeeds,
                    verificationGaps: currentTriage.structured.verificationGaps,
                    rumorVerdict: search.verdict,
                    panicSignals: currentTriage.structured.panicSignals,
                    groundingSources: search.sources,
                    searchEntryPointHtml: search.searchEntryPointHtml
                )
                currentTriage = HybridTriageResult(
                    structured: updatedStructured,
                    inferenceSource: .inCloud,
                    inferenceModeRequested: "ONLY_IN_CLOUD",
                    latencyMs: search.latencyMs,
                    routingReason: "Verified via Google Search Grounding (\(syncService.synthesisCloudModel)).",
                    estimatedInputTokens: currentTriage.estimatedInputTokens,
                    ranOfflineDeterministicFallback: false
                )
                triageResult = currentTriage
            } catch {
                errorMessage = error.localizedDescription
            }
            isVerifyingSearch = false
        }
    }

    private func saveToFirestore() {
        guard let privacyResult, let triageResult else { return }
        isSaving = true
        errorMessage = nil
        statusMessage = nil

        Task { @MainActor in
            do {
                try await syncService.saveIntake(
                    mode: mode,
                    triage: triageResult,
                    privacy: privacyResult,
                    isVerifiedBySearch: !triageResult.structured.groundingSources.isEmpty
                )
                statusMessage = "Synced sanitized intake (sourcePlatform: APPLE) to Firestore."
            } catch {
                errorMessage = error.localizedDescription
            }
            isSaving = false
        }
    }

    private func tag(_ text: String, fg: Color, bg: Color) -> some View {
        Text(text)
            .font(.system(.caption2, design: .monospaced, weight: .semibold))
            .monospacedDigit()
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .foregroundStyle(fg)
            .background(bg)
            .clipShape(RoundedRectangle(cornerRadius: 4))
    }
}
