import SwiftUI

@MainActor
public final class QuickTextIntakeViewModel: ObservableObject {
    @Published public var mode: IntakeMode = .fieldReport
    @Published public var selectedScenarioId: String? = SyntheticDrillData.scenarios.first?.id
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
    @Published public var showOpenFieldChecks: Bool = true
    @Published public var selectedTaskId: String?
    @Published public var fieldCheckReply: String = ""
    @Published public var isSubmittingFieldReply: Bool = false
    @Published public var fieldReplyFeedback: String?

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
        selectedScenarioId = scenario.id
        mode = scenario.mode
        rawInput = scenario.rawInput
        selectedScenarioNote = scenario.note
        privacyResult = nil
        triageResult = nil
        statusMessage = nil
        errorMessage = nil
    }

    public func clearInput() {
        selectedScenarioId = nil
        rawInput = ""
        selectedScenarioNote = ""
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
        let activeKnowledge = syncService.activeAreaKnowledge

        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let res = try await AppleHybridAiService.triageTextIntake(
                    sanitizedText: sanitized,
                    mode: currentMode,
                    fastCloudModel: fastModel,
                    isFirebaseConfigured: configured,
                    areaKnowledge: activeKnowledge
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

    public func submitFieldCheckReply(task: FieldVerificationTask, syncService: FirestoreSyncService) {
        let trimmed = fieldCheckReply.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isSubmittingFieldReply = true
        fieldReplyFeedback = nil
        errorMessage = nil

        let configured = syncService.isFirebaseConfigured
        Task { @MainActor [weak self] in
            guard let self else { return }
            let scrubbed = await AppleHybridAiService.redactPiiLocally(
                rawText: trimmed,
                isFirebaseConfigured: configured
            )
            do {
                try await syncService.submitVerificationAnswer(
                    taskId: task.id,
                    sanitizedAnswer: scrubbed.sanitizedText,
                    redactionCount: scrubbed.redactions.count
                )
                self.fieldCheckReply = ""
                self.selectedTaskId = nil
                self.fieldReplyFeedback = "Sent scrubbed field answer (\(scrubbed.redactions.count) PII masked on-device)."
            } catch {
                self.errorMessage = error.localizedDescription
            }
            self.isSubmittingFieldReply = false
        }
    }
}

public struct QuickTextIntakeView: View {
    @Environment(\.colorScheme) private var scheme
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif
    @ObservedObject var syncService: FirestoreSyncService
    @StateObject private var viewModel = QuickTextIntakeViewModel()
    @FocusState private var isEditorFocused: Bool

    public init(syncService: FirestoreSyncService) {
        self.syncService = syncService
    }

    private var isCompactWidth: Bool {
        #if os(iOS)
        return horizontalSizeClass == .compact
        #else
        return false
        #endif
    }

    private var estimatedTokens: Int {
        let target = viewModel.privacyResult?.sanitizedText ?? viewModel.rawInput
        return AppleHybridAiService.estimateTokens(target)
    }

    private var exceedsAppleBudget: Bool {
        estimatedTokens > SigapConstants.appleOnDeviceSafeInputTokens
    }

    public var body: some View {
        GeometryReader { proxy in
            let useTwoColumn = proxy.size.width >= 920
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    IntakeHeaderSection()

                    if !syncService.activeAreaKnowledge.isEmpty {
                        let okColors = SigapTheme.onDeviceColors(scheme)
                        HStack(spacing: 8) {
                            SigapStatusTag(
                                "AREA KNOWLEDGE ACTIVE (\(syncService.activeAreaKnowledge.count))",
                                fg: okColors.fg,
                                bg: okColors.bg,
                                border: SigapTheme.onDeviceBorder(scheme)
                            )
                            Text("Human-verified ground truth is injected into triage prompts.")
                                .font(.caption)
                                .foregroundStyle(SigapTheme.inkMuted(scheme))
                            Spacer()
                        }
                        .padding(10)
                        .background(okColors.bg.opacity(0.45))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(SigapTheme.onDeviceBorder(scheme), lineWidth: 1)
                        )
                    }

                    if useTwoColumn {
                        HStack(alignment: .top, spacing: 18) {
                            VStack(alignment: .leading, spacing: 16) {
                                if !syncService.openVerificationTasks.isEmpty {
                                    OpenFieldChecksCard(
                                        syncService: syncService,
                                        viewModel: viewModel,
                                        isCompact: false
                                    )
                                }
                                IntakeComposerCard(
                                    syncService: syncService,
                                    viewModel: viewModel,
                                    estimatedTokens: estimatedTokens,
                                    exceedsAppleBudget: exceedsAppleBudget,
                                    isCompact: false,
                                    isEditorFocused: $isEditorFocused
                                )
                            }
                            .frame(width: min(490, proxy.size.width * 0.46))

                            VStack(alignment: .leading, spacing: 16) {
                                resultsColumnContent(isCompact: false)
                            }
                            .frame(maxWidth: .infinity)
                        }
                    } else {
                        if !syncService.openVerificationTasks.isEmpty {
                            OpenFieldChecksCard(
                                syncService: syncService,
                                viewModel: viewModel,
                                isCompact: isCompactWidth
                            )
                        }
                        IntakeComposerCard(
                            syncService: syncService,
                            viewModel: viewModel,
                            estimatedTokens: estimatedTokens,
                            exceedsAppleBudget: exceedsAppleBudget,
                            isCompact: isCompactWidth,
                            isEditorFocused: $isEditorFocused
                        )
                        resultsColumnContent(isCompact: isCompactWidth)
                    }
                }
                .padding(isCompactWidth ? 14 : 20)
                .frame(maxWidth: useTwoColumn ? 1180 : 820, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            #if os(iOS)
            .scrollDismissesKeyboard(.interactively)
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") {
                        isEditorFocused = false
                    }
                    .font(.callout.weight(.semibold))
                }
            }
            #endif
            .background(SigapTheme.ground(scheme))
        }
    }

    @ViewBuilder
    private func resultsColumnContent(isCompact: Bool) -> some View {
        if viewModel.privacyResult == nil && viewModel.triageResult == nil {
            IntakeEmptyGuidanceCard()
        } else {
            if let privacy = viewModel.privacyResult {
                PrivacyDiffCard(
                    rawInput: viewModel.rawInput,
                    privacy: privacy,
                    copiedKey: viewModel.copiedKey,
                    isCompact: isCompact,
                    onCopy: { key, text in viewModel.copyWithFeedback(key: key, text: text) }
                )
            }
            if let triage = viewModel.triageResult {
                StructuredTriageCard(
                    triage: triage,
                    mode: viewModel.mode,
                    syncService: syncService,
                    viewModel: viewModel,
                    isCompact: isCompact
                )
            }
        }
    }
}

private struct IntakeHeaderSection: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Quick Text Intake & Local Privacy Firewall")
                .font(.system(.title2, design: .serif, weight: .bold))
                .foregroundStyle(SigapTheme.inkPrimary(scheme))
            Text("Apple on-device Foundation Models handles text-only triage (up to 1,600 safe input tokens) after local PII redaction. Image capture runs on Web and Android.")
                .font(.subheadline)
                .foregroundStyle(SigapTheme.inkMuted(scheme))
        }
    }
}

private struct IntakeEmptyGuidanceCard: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("No intake analyzed yet")
                .font(.system(.title3, design: .serif, weight: .bold))
                .foregroundStyle(SigapTheme.inkPrimary(scheme))
            Text("Choose a Synthetic Drill preset or type a field update, then run both hybrid stages:")
                .font(.subheadline)
                .foregroundStyle(SigapTheme.inkMuted(scheme))

            VStack(alignment: .leading, spacing: 8) {
                Text("1. Scrub PII Locally: Strips names, phone numbers, handles, and street addresses strictly on-device before any cloud call.")
                Text("2. Hybrid Triage: Structures severity, urgent needs, and gaps on Apple Foundation Models within 1,600 tokens, or escalates to Cloud Gemini automatically.")
                Text("3. Ground & Sync: Cross-check sanitized rumors via Google Search Grounding and sync clean cards to Broadcast Studio.")
            }
            .font(.callout)
            .foregroundStyle(SigapTheme.inkPrimary(scheme))
        }
        .sigapCard()
    }
}

private struct OpenFieldChecksCard: View {
    @Environment(\.colorScheme) private var scheme
    @ObservedObject var syncService: FirestoreSyncService
    @ObservedObject var viewModel: QuickTextIntakeViewModel
    let isCompact: Bool

    var body: some View {
        let warnColors = SigapTheme.warningColors(scheme)
        let okColors = SigapTheme.onDeviceColors(scheme)
        let activeTask = syncService.openVerificationTasks.first(where: { $0.id == viewModel.selectedTaskId })
            ?? syncService.openVerificationTasks.first

        VStack(alignment: .leading, spacing: 10) {
            HStack {
                SigapStatusTag(
                    "OPEN FIELD CHECKS (\(syncService.openVerificationTasks.count))",
                    fg: warnColors.fg,
                    bg: warnColors.bg,
                    border: SigapTheme.warningBorder(scheme)
                )
                Spacer()
                Button {
                    viewModel.showOpenFieldChecks.toggle()
                } label: {
                    Text(viewModel.showOpenFieldChecks ? "Hide" : "Show")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(SigapButtonStyle(.subtle))
                .accessibilityLabel(viewModel.showOpenFieldChecks ? "Hide open field checks" : "Show open field checks")
            }

            if viewModel.showOpenFieldChecks {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(syncService.openVerificationTasks) { task in
                            let selected = task.id == activeTask?.id
                            Button {
                                viewModel.selectedTaskId = task.id
                                viewModel.fieldReplyFeedback = nil
                            } label: {
                                Text("\(task.location): \(task.question)")
                                    .font(.caption.weight(.medium))
                                    .lineLimit(1)
                                    .frame(maxWidth: 240, alignment: .leading)
                            }
                            .buttonStyle(SigapButtonStyle(selected ? .warning : .subtle))
                            .accessibilityAddTraits(selected ? .isSelected : [])
                        }
                    }
                }

                if let task = activeTask {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(task.question)
                            .font(.callout.weight(.semibold))
                            .foregroundStyle(SigapTheme.inkPrimary(scheme))

                        Text("Responder Reply (PII scrubbed locally before upload)")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(SigapTheme.inkMuted(scheme))

                        if isCompact {
                            VStack(spacing: 8) {
                                replyField
                                sendReplyButton(task: task)
                            }
                        } else {
                            HStack(spacing: 8) {
                                replyField
                                sendReplyButton(task: task)
                            }
                        }
                    }
                }
            }

            if let replyNote = viewModel.fieldReplyFeedback {
                Text(replyNote)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(okColors.fg)
            }
        }
        .sigapCard(padding: 14)
    }

    private var replyField: some View {
        TextField("Enter ground observation...", text: $viewModel.fieldCheckReply)
            .textFieldStyle(.plain)
            .padding(.horizontal, 10)
            .frame(minHeight: 44)
            .background(SigapTheme.ground(scheme))
            .foregroundStyle(SigapTheme.inkPrimary(scheme))
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(SigapTheme.borderStrong(scheme), lineWidth: 1)
            )
            .accessibilityLabel("Field verification reply")
    }

    private func sendReplyButton(task: FieldVerificationTask) -> some View {
        Button {
            viewModel.submitFieldCheckReply(task: task, syncService: syncService)
        } label: {
            Text(viewModel.isSubmittingFieldReply ? "Sending..." : "Scrub PII & Send Answer")
                .font(.caption.weight(.semibold))
                .lineLimit(1)
        }
        .buttonStyle(SigapButtonStyle(.onDevice, fullWidth: isCompact))
        .disabled(
            viewModel.isSubmittingFieldReply
                || viewModel.fieldCheckReply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        )
    }
}

private struct IntakeComposerCard: View {
    @Environment(\.colorScheme) private var scheme
    @ObservedObject var syncService: FirestoreSyncService
    @ObservedObject var viewModel: QuickTextIntakeViewModel
    let estimatedTokens: Int
    let exceedsAppleBudget: Bool
    let isCompact: Bool
    var isEditorFocused: FocusState<Bool>.Binding

    private var tokenFillFraction: Double {
        min(1.0, Double(estimatedTokens) / Double(SigapConstants.appleOnDeviceSafeInputTokens))
    }

    var body: some View {
        let tokenBadgeColors = exceedsAppleBudget
            ? SigapTheme.warningColors(scheme)
            : SigapTheme.onDeviceColors(scheme)
        let tokenBorder = exceedsAppleBudget
            ? SigapTheme.warningBorder(scheme)
            : SigapTheme.onDeviceBorder(scheme)

        VStack(alignment: .leading, spacing: 14) {
            Picker("Intake Mode", selection: $viewModel.mode) {
                ForEach(IntakeMode.allCases) { item in
                    Text(item.displayLabel).tag(item)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityLabel("Intake mode")

            VStack(alignment: .leading, spacing: 6) {
                Text("Load Synthetic Drill Preset")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(SigapTheme.inkMuted(scheme))

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(SyntheticDrillData.scenarios) { scenario in
                            let selected = viewModel.selectedScenarioId == scenario.id
                            Button {
                                viewModel.loadScenario(scenario)
                            } label: {
                                Text(scenario.label)
                                    .font(.caption.weight(selected ? .bold : .medium))
                            }
                            .buttonStyle(SigapButtonStyle(selected ? .secondary : .subtle))
                            .accessibilityAddTraits(selected ? .isSelected : [])
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
                HStack(alignment: .center, spacing: 8) {
                    Text("Raw Report or Claim (Text-Only)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(SigapTheme.inkPrimary(scheme))
                    Spacer()
                    if !viewModel.rawInput.isEmpty {
                        Button("Clear") {
                            viewModel.clearInput()
                        }
                        .font(.caption.weight(.semibold))
                        .buttonStyle(SigapButtonStyle(.subtle))
                        .accessibilityLabel("Clear raw input text")
                    }
                }

                ZStack(alignment: .topLeading) {
                    TextEditor(text: $viewModel.rawInput)
                        .focused(isEditorFocused)
                        .scrollContentBackground(.hidden)
                        .font(.body)
                        .foregroundStyle(SigapTheme.inkPrimary(scheme))
                        .frame(minHeight: 130)
                        .padding(8)
                        .onChange(of: viewModel.rawInput) { _, _ in
                            viewModel.clearResultsOnEdit()
                        }
                        .accessibilityLabel("Raw disaster field report or rumor text")

                    if viewModel.rawInput.isEmpty {
                        Text("Paste a messy Indonesian or English field note or viral rumor...")
                            .font(.body)
                            .foregroundStyle(SigapTheme.inkMuted(scheme))
                            .padding(.horizontal, 13)
                            .padding(.vertical, 16)
                            .allowsHitTesting(false)
                    }
                }
                .background(SigapTheme.ground(scheme))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(SigapTheme.borderStrong(scheme), lineWidth: 1)
                )

                // Determinate Token-Budget Meter
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text("~\(estimatedTokens) / \(SigapConstants.appleOnDeviceSafeInputTokens) est. tokens")
                            .font(.system(.caption, design: .monospaced))
                            .monospacedDigit()
                            .foregroundStyle(SigapTheme.inkMuted(scheme))
                        Spacer()
                        SigapStatusTag(
                            exceedsAppleBudget ? "AUTO-ESCALATE CLOUD" : "ON-DEVICE BUDGET",
                            fg: tokenBadgeColors.fg,
                            bg: tokenBadgeColors.bg,
                            border: tokenBorder
                        )
                    }
                    GeometryReader { barGeo in
                        ZStack(alignment: .leading) {
                            Capsule()
                                .fill(SigapTheme.ground(scheme))
                                .frame(height: 6)
                            Capsule()
                                .fill(tokenBadgeColors.fg)
                                .frame(width: max(0, barGeo.size.width * tokenFillFraction), height: 6)
                        }
                    }
                    .frame(height: 6)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("On-device token budget \(estimatedTokens) of \(SigapConstants.appleOnDeviceSafeInputTokens)")
                }
                .sigapSubtlePanel(padding: 10)
            }

            if isCompact {
                VStack(spacing: 8) {
                    scrubButton
                    triageButton
                }
            } else {
                HStack(spacing: 10) {
                    scrubButton
                    triageButton
                }
            }

            if let errorMessage = viewModel.errorMessage {
                Text(errorMessage)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(SigapTheme.accentText(scheme))
            }
            if let statusMessage = viewModel.statusMessage {
                Text(statusMessage)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(SigapTheme.onDeviceColors(scheme).fg)
            }
        }
        .sigapCard()
    }

    private var scrubButton: some View {
        Button {
            isEditorFocused.wrappedValue = false
            viewModel.runLocalRedaction(isFirebaseConfigured: syncService.isFirebaseConfigured)
        } label: {
            HStack(spacing: 6) {
                if viewModel.isRedacting {
                    ProgressView().controlSize(.small)
                }
                Text(viewModel.isRedacting ? "Redacting..." : "1. Scrub PII Locally")
                    .fontWeight(.semibold)
            }
        }
        .buttonStyle(SigapButtonStyle(viewModel.privacyResult == nil ? .primary : .secondary, fullWidth: true))
        .disabled(viewModel.isRedacting || viewModel.rawInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    private var triageButton: some View {
        Button {
            isEditorFocused.wrappedValue = false
            viewModel.runHybridTriage(syncService: syncService)
        } label: {
            HStack(spacing: 6) {
                if viewModel.isTriaging {
                    ProgressView().controlSize(.small)
                }
                Text(viewModel.isTriaging ? "Analyzing..." : "2. Hybrid Triage")
                    .fontWeight(.semibold)
            }
        }
        .buttonStyle(SigapButtonStyle(viewModel.privacyResult != nil ? .primary : .subtle, fullWidth: true))
        .disabled(viewModel.privacyResult == nil || viewModel.isTriaging)
    }
}

private struct PrivacyDiffCard: View {
    @Environment(\.colorScheme) private var scheme
    let rawInput: String
    let privacy: LocalPrivacyResult
    let copiedKey: String?
    let isCompact: Bool
    let onCopy: (String, String) -> Void

    var body: some View {
        let onDeviceColors = SigapTheme.onDeviceColors(scheme)
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text("Stage 1: Local Privacy Firewall (PII Diff)")
                    .font(.headline)
                    .foregroundStyle(SigapTheme.inkPrimary(scheme))
                Spacer()
                SigapStatusTag(
                    "ON_DEVICE (\(privacy.latencyMs) ms)",
                    fg: onDeviceColors.fg,
                    bg: onDeviceColors.bg,
                    border: SigapTheme.onDeviceBorder(scheme)
                )
            }

            if privacy.redactions.isEmpty {
                Text("No phone numbers, names, handles, or street addresses matched locally.")
                    .font(.caption)
                    .foregroundStyle(SigapTheme.inkMuted(scheme))
            } else {
                Text("Stayed on device (\(privacy.redactions.count) item(s) scrubbed):")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(SigapTheme.inkPrimary(scheme))
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(privacy.redactions) { item in
                            SigapStatusTag(
                                "\(item.placeholder) (\(item.category.rawValue))",
                                fg: SigapTheme.inkPrimary(scheme),
                                bg: SigapTheme.subtle(scheme),
                                border: SigapTheme.borderSubtle(scheme)
                            )
                        }
                    }
                }
            }

            if isCompact {
                VStack(spacing: 10) {
                    localRawPane
                    safePayloadPane
                }
            } else {
                HStack(alignment: .top, spacing: 10) {
                    localRawPane
                    safePayloadPane
                }
            }

            Button {
                onCopy("safe-text", privacy.sanitizedText)
            } label: {
                Text(copiedKey == "safe-text" ? "Copied Cloud-Safe Text" : "Copy Cloud-Safe Text")
                    .font(.caption.weight(.semibold))
            }
            .buttonStyle(SigapButtonStyle(.secondary, fullWidth: isCompact))
        }
        .sigapCard()
    }

    private var localRawPane: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("STAYED LOCAL ONLY")
                .font(.system(.caption2, design: .monospaced, weight: .bold))
                .foregroundStyle(SigapTheme.inkMuted(scheme))
            Text(rawInput)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(SigapTheme.inkPrimary(scheme))
                .fixedSize(horizontal: false, vertical: true)
        }
        .sigapSubtlePanel(padding: 10)
    }

    private var safePayloadPane: some View {
        let ok = SigapTheme.onDeviceColors(scheme)
        return VStack(alignment: .leading, spacing: 6) {
            Text("SAFE PAYLOAD (CLOUD ELIGIBLE)")
                .font(.system(.caption2, design: .monospaced, weight: .bold))
                .foregroundStyle(ok.fg)
            Text(privacy.sanitizedText)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(SigapTheme.inkPrimary(scheme))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SigapTheme.ground(scheme))
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(SigapTheme.onDeviceBorder(scheme), lineWidth: 1)
        )
    }
}

private struct StructuredTriageCard: View {
    @Environment(\.colorScheme) private var scheme
    let triage: HybridTriageResult
    let mode: IntakeMode
    @ObservedObject var syncService: FirestoreSyncService
    @ObservedObject var viewModel: QuickTextIntakeViewModel
    let isCompact: Bool

    var body: some View {
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

        VStack(alignment: .leading, spacing: 12) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    SigapStatusTag(s.severity.rawValue, fg: sevColors.fg, bg: sevColors.bg)
                    SigapStatusTag(s.hazardType.rawValue, fg: SigapTheme.inkPrimary(scheme), bg: SigapTheme.subtle(scheme))
                    if s.rumorVerdict != .notApplicable {
                        SigapStatusTag(s.rumorVerdict.rawValue, fg: verdictColors.fg, bg: verdictColors.bg)
                    }
                    SigapStatusTag(triage.inferenceSource.badgeText, fg: srcColors.fg, bg: srcColors.bg)
                    SigapStatusTag("\(triage.latencyMs) ms", fg: SigapTheme.inkMuted(scheme), bg: SigapTheme.subtle(scheme))
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(s.headline)
                    .font(.system(.title3, design: .serif, weight: .bold))
                    .foregroundStyle(SigapTheme.inkPrimary(scheme))
                Text("Location: \(s.location)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(SigapTheme.inkPrimary(scheme))
                Text(triage.routingReason)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(SigapTheme.inkMuted(scheme))
            }

            // Framed Bilingual Summary Panes
            if isCompact {
                VStack(spacing: 8) {
                    summaryBox(title: "RINGKASAN (BAHASA INDONESIA)", text: s.summaryId)
                    summaryBox(title: "SUMMARY (ENGLISH WIRE)", text: s.summaryEn)
                }
            } else {
                HStack(alignment: .top, spacing: 10) {
                    summaryBox(title: "RINGKASAN (BAHASA INDONESIA)", text: s.summaryId)
                    summaryBox(title: "SUMMARY (ENGLISH WIRE)", text: s.summaryEn)
                }
            }

            if !s.keyFacts.isEmpty {
                SigapBulletSection(
                    title: mode == .fieldReport ? "Observed Facts" : "Extracted Claims",
                    items: s.keyFacts
                )
            }
            if !s.urgentNeeds.isEmpty {
                SigapBulletSection(
                    title: mode == .fieldReport ? "Urgent Needs" : "Required Agency Checks",
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
                }
                .buttonStyle(SigapButtonStyle(.secondary))

                ShareLink(item: summaryShareText) {
                    Text("Share Triage")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(SigapButtonStyle(.subtle))
            }

            if !s.groundingSources.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Google Search Grounding Sources")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(SigapTheme.inkPrimary(scheme))
                    ForEach(s.groundingSources) { src in
                        if let url = URL(string: src.uri) {
                            Link(src.title, destination: url)
                                .font(.caption.weight(.medium))
                                .foregroundStyle(SigapTheme.accentText(scheme))
                                .frame(minHeight: 44, alignment: .leading)
                        }
                    }
                }
            }

            if isCompact {
                VStack(spacing: 8) {
                    if mode == .rumorCheck {
                        verifySearchButton
                    }
                    syncButton
                }
            } else {
                HStack(spacing: 10) {
                    if mode == .rumorCheck {
                        verifySearchButton
                    }
                    syncButton
                }
            }
        }
        .sigapCard()
    }

    private func summaryBox(title: String, text: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(.caption2, design: .monospaced, weight: .bold))
                .foregroundStyle(SigapTheme.inkMuted(scheme))
            Text(text)
                .font(.callout)
                .foregroundStyle(SigapTheme.inkPrimary(scheme))
                .fixedSize(horizontal: false, vertical: true)
        }
        .sigapSubtlePanel(padding: 10)
    }

    private var verifySearchButton: some View {
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
        }
        .buttonStyle(SigapButtonStyle(.secondary, fullWidth: true))
        .disabled(viewModel.isVerifyingSearch || !syncService.isFirebaseConfigured)
    }

    private var syncButton: some View {
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
        }
        .buttonStyle(SigapButtonStyle(.primary, fullWidth: true))
        .disabled(viewModel.isSaving || !syncService.isFirebaseConfigured)
    }
}
