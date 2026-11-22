import SwiftUI

@MainActor
public final class QuickTextIntakeViewModel: ObservableObject {
    @Published public var mode: IntakeMode = .fieldReport
    @Published public var rawInput: String = SyntheticDrillData.scenarios.first?.rawInput ?? ""
    @Published public var selectedScenarioNote: String = SyntheticDrillData.scenarios.first?.note ?? ""
    @Published public var isRedacting: Bool = false
    @Published public var privacyResult: LocalPrivacyResult?
    @Published public var isTriaging: Bool = false
    @Published public var triageResult: HybridTriageResult?
    @Published public var isVerifyingSearch: Bool = false
    @Published public var isSaving: Bool = false
    @Published public var statusMessage: String?
    @Published public var errorMessage: String?
    @Published public var copiedKey: String?

    public init() {}

    public func copyWithFeedback(key: String, text: String) {
        SigapClipboard.copy(text)
        copiedKey = key
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(2))
            if self?.copiedKey == key {
                self?.copiedKey = nil
            }
        }
    }

    public func loadScenario(_ scenario: SyntheticScenario) {
        mode = scenario.mode
        rawInput = scenario.rawInput
        selectedScenarioNote = scenario.note
        privacyResult = nil
        triageResult = nil
        statusMessage = nil
        errorMessage = nil
    }

    public func clearResultsOnEdit() {
        privacyResult = nil
        triageResult = nil
    }

    public func runLocalRedaction(isFirebaseConfigured: Bool) {
        isRedacting = true
        errorMessage = nil
        statusMessage = nil
        let input = rawInput

        Task { @MainActor [weak self] in
            guard let self else { return }
            let res = await AppleHybridAiService.redactPiiLocally(
                rawText: input,
                isFirebaseConfigured: isFirebaseConfigured
            )
            self.privacyResult = res
            self.isRedacting = false
        }
    }

    public func runHybridTriage(syncService: FirestoreSyncService) {
        guard let privacyResult else { return }
        isTriaging = true
        errorMessage = nil
        statusMessage = nil

        let sanitized = privacyResult.sanitizedText
        let currentMode = mode
        let fastModel = syncService.fastCloudModel
        let configured = syncService.isFirebaseConfigured

        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let res = try await AppleHybridAiService.triageTextIntake(
                    sanitizedText: sanitized,
                    mode: currentMode,
                    fastCloudModel: fastModel,
                    isFirebaseConfigured: configured
                )
                self.triageResult = res
            } catch {
                self.errorMessage = error.localizedDescription
            }
            self.isTriaging = false
        }
    }

    public func runSearchCheck(syncService: FirestoreSyncService) {
        guard let privacyResult, var currentTriage = triageResult else { return }
        isVerifyingSearch = true
        errorMessage = nil

        let sanitized = privacyResult.sanitizedText
        let synthModel = syncService.synthesisCloudModel
        let configured = syncService.isFirebaseConfigured

        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let search = try await AppleHybridAiService.verifyClaimWithGoogleSearch(
                    sanitizedText: sanitized,
                    synthesisCloudModel: synthModel,
                    isFirebaseConfigured: configured
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
                    routingReason: "Verified via Google Search Grounding (\(synthModel)).",
                    estimatedInputTokens: currentTriage.estimatedInputTokens,
                    ranOfflineDeterministicFallback: false
                )
                self.triageResult = currentTriage
            } catch {
                self.errorMessage = error.localizedDescription
            }
            self.isVerifyingSearch = false
        }
    }

    public func saveToFirestore(syncService: FirestoreSyncService) {
        guard let privacyResult, let triageResult else { return }
        isSaving = true
        errorMessage = nil
        statusMessage = nil

        let currentMode = mode
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await syncService.saveIntake(
                    mode: currentMode,
                    triage: triageResult,
                    privacy: privacyResult,
                    isVerifiedBySearch: !triageResult.structured.groundingSources.isEmpty
                )
                self.statusMessage = "Synced sanitized intake (sourcePlatform: APPLE) to Firestore."
            } catch {
                self.errorMessage = error.localizedDescription
            }
            self.isSaving = false
        }
    }
}

public struct QuickTextIntakeView: View {
    @Environment(\.colorScheme) private var scheme
    @ObservedObject var syncService: FirestoreSyncService
    @StateObject private var viewModel = QuickTextIntakeViewModel()

    public init(syncService: FirestoreSyncService) {
        self.syncService = syncService
    }

    private var estimatedTokens: Int {
        let target = viewModel.privacyResult?.sanitizedText ?? viewModel.rawInput
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
                if let privacy = viewModel.privacyResult {
                    privacyDiffCard(privacy)
                }
                if let triage = viewModel.triageResult {
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
            Picker("Intake Mode", selection: $viewModel.mode) {
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
                                viewModel.loadScenario(scenario)
                            } label: {
                                Text(scenario.label)
                                    .font(.caption.weight(.medium))
                                    .padding(.horizontal, 12)
                                    .frame(minHeight: 44)
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

                if !viewModel.selectedScenarioNote.isEmpty {
                    Text(viewModel.selectedScenarioNote)
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

                TextEditor(text: $viewModel.rawInput)
                    .font(.body)
                    .frame(minHeight: 130)
                    .padding(8)
                    .background(SigapTheme.ground(scheme))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(SigapTheme.borderStrong(scheme), lineWidth: 1)
                    )
                    .onChange(of: viewModel.rawInput) { _, _ in
                        viewModel.clearResultsOnEdit()
                    }
            }

            HStack(spacing: 10) {
                Button {
                    viewModel.runLocalRedaction(isFirebaseConfigured: syncService.isFirebaseConfigured)
                } label: {
                    HStack(spacing: 6) {
                        if viewModel.isRedacting {
                            ProgressView().controlSize(.small)
                        }
                        Text(viewModel.isRedacting ? "Redacting..." : "1. Scrub PII Locally")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(viewModel.privacyResult == nil ? SigapTheme.accentVermilion : SigapTheme.subtle(scheme))
                    .foregroundStyle(viewModel.privacyResult == nil ? Color.white : SigapTheme.inkPrimary(scheme))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
                .disabled(viewModel.isRedacting || viewModel.rawInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Button {
                    viewModel.runHybridTriage(syncService: syncService)
                } label: {
                    HStack(spacing: 6) {
                        if viewModel.isTriaging {
                            ProgressView().controlSize(.small)
                        }
                        Text(viewModel.isTriaging ? "Analyzing..." : "2. Hybrid Triage")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(viewModel.privacyResult != nil ? SigapTheme.accentVermilion : SigapTheme.subtle(scheme))
                    .foregroundStyle(viewModel.privacyResult != nil ? Color.white : SigapTheme.inkMuted(scheme))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
                .disabled(viewModel.privacyResult == nil || viewModel.isTriaging)
            }

            if let errorMessage = viewModel.errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(SigapTheme.accentText(scheme))
            }
            if let statusMessage = viewModel.statusMessage {
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

            Button {
                viewModel.copyWithFeedback(key: "safe-text", text: p.sanitizedText)
            } label: {
                Text(viewModel.copiedKey == "safe-text" ? "Copied Cloud-Safe Text" : "Copy Cloud-Safe Text")
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                    .background(SigapTheme.subtle(scheme))
                    .foregroundStyle(SigapTheme.inkPrimary(scheme))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(SigapTheme.borderStrong(scheme), lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
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
        let verdictColors = SigapTheme.verdictColors(s.rumorVerdict, scheme: scheme)
        let summaryShareText = [
            "[\(s.severity.rawValue)] \(s.headline)",
            "Location: \(s.location) | Hazard: \(s.hazardType.rawValue)",
            "ID: \(s.summaryId)",
            "EN: \(s.summaryEn)",
            s.urgentNeeds.isEmpty ? nil : "Needs: \(s.urgentNeeds.joined(separator: "; "))",
        ]
        .compactMap { $0 }
        .joined(separator: "\n")

        return VStack(alignment: .leading, spacing: 10) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    tag(s.severity.rawValue, fg: sevColors.fg, bg: sevColors.bg)
                    tag(s.hazardType.rawValue, fg: SigapTheme.inkPrimary(scheme), bg: SigapTheme.subtle(scheme))
                    if s.rumorVerdict != .notApplicable {
                        tag(s.rumorVerdict.rawValue, fg: verdictColors.fg, bg: verdictColors.bg)
                    }
                    tag(triage.inferenceSource.badgeText, fg: srcColors.fg, bg: srcColors.bg)
                    tag("\(triage.latencyMs) ms", fg: SigapTheme.inkMuted(scheme), bg: SigapTheme.subtle(scheme))
                }
            }

            Text(s.headline)
                .font(.system(.title3, design: .serif, weight: .bold))
                .foregroundStyle(SigapTheme.inkPrimary(scheme))

            Text("Location: \(s.location)")
                .font(.caption.weight(.semibold))
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

            if !s.keyFacts.isEmpty {
                SigapBulletSection(
                    title: viewModel.mode == .fieldReport ? "Observed Facts" : "Extracted Claims",
                    items: s.keyFacts
                )
            }
            if !s.urgentNeeds.isEmpty {
                SigapBulletSection(
                    title: viewModel.mode == .fieldReport ? "Urgent Needs" : "Required Agency Checks",
                    items: s.urgentNeeds
                )
            }
            if !s.verificationGaps.isEmpty {
                SigapBulletSection(title: "Verification Gaps", items: s.verificationGaps)
            }
            if !s.panicSignals.isEmpty {
                SigapBulletSection(title: "Panic / Rumor Signals", items: s.panicSignals)
            }

            HStack(spacing: 10) {
                Button {
                    viewModel.copyWithFeedback(key: "triage-summary", text: summaryShareText)
                } label: {
                    Text(viewModel.copiedKey == "triage-summary" ? "Copied Summary" : "Copy Summary")
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 12)
                        .frame(minHeight: 44)
                        .background(SigapTheme.subtle(scheme))
                        .foregroundStyle(SigapTheme.inkPrimary(scheme))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(SigapTheme.borderStrong(scheme), lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)

                ShareLink(item: summaryShareText) {
                    Text("Share Triage")
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 12)
                        .frame(minHeight: 44)
                        .background(SigapTheme.subtle(scheme))
                        .foregroundStyle(SigapTheme.inkPrimary(scheme))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(SigapTheme.borderStrong(scheme), lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
            }

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
                                .frame(minHeight: 44, alignment: .leading)
                        }
                    }
                }
            }

            HStack(spacing: 10) {
                if viewModel.mode == .rumorCheck {
                    Button {
                        viewModel.runSearchCheck(syncService: syncService)
                    } label: {
                        HStack(spacing: 6) {
                            if viewModel.isVerifyingSearch {
                                ProgressView().controlSize(.small)
                            }
                            Text(viewModel.isVerifyingSearch ? "Checking Search..." : "Verify With Google Search")
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
                    .disabled(viewModel.isVerifyingSearch || !syncService.isFirebaseConfigured)
                }

                Button {
                    viewModel.saveToFirestore(syncService: syncService)
                } label: {
                    HStack(spacing: 6) {
                        if viewModel.isSaving {
                            ProgressView().controlSize(.small)
                        }
                        Text(viewModel.isSaving ? "Syncing..." : "Sync Intake to Firestore")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(SigapTheme.accentVermilion)
                    .foregroundStyle(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
                .disabled(viewModel.isSaving || !syncService.isFirebaseConfigured)
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

    private func tag(_ text: String, fg: Color, bg: Color) -> some View {
        SigapStatusTag(text, fg: fg, bg: bg)
    }
}
