import SwiftUI

@MainActor
public final class BriefingWireViewModel: ObservableObject {
    public enum AudienceLanguage: String, CaseIterable, Identifiable {
        case indonesian = "ID"
        case english = "EN"
        public var id: String { rawValue }
        public var label: String { self == .indonesian ? "Community (ID)" : "Global SitRep (EN)" }
    }

    @Published public var selectedLanguage: AudienceLanguage = .indonesian
    @Published public var selectedDispatchId: String?
    @Published public var selectedFormat: BriefingFormat = .executive3Bullet
    @Published public var streamedBriefText: String = ""
    @Published public var streamSourceLabel: InferenceSourceLabel = .onDevice
    @Published public var streamRoutingNote: String = ""
    @Published public var isStreaming: Bool = false
    @Published public var streamError: String?
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

    public func selectDispatch(_ id: String) {
        selectedDispatchId = id
        streamedBriefText = ""
        streamRoutingNote = ""
        streamError = nil
    }

    public func startStreamingBrief(dispatch: DispatchCard, syncService: FirestoreSyncService) {
        isStreaming = true
        streamError = nil
        streamedBriefText = ""

        let format = selectedFormat
        let fastCloudModel = syncService.fastCloudModel
        let isConfigured = syncService.isFirebaseConfigured

        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let stream = AppleHybridAiService.streamDispatchBriefing(
                    dispatch: dispatch,
                    format: format,
                    fastCloudModel: fastCloudModel,
                    isFirebaseConfigured: isConfigured
                )
                for try await update in stream {
                    self.streamedBriefText = update.text
                    self.streamSourceLabel = update.inferenceSource
                    self.streamRoutingNote = update.routingNote
                }
            } catch {
                self.streamError = error.localizedDescription
            }
            self.isStreaming = false
        }
    }
}

public struct BriefingWireView: View {
    @Environment(\.colorScheme) private var scheme
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif
    @ObservedObject var syncService: FirestoreSyncService
    @StateObject private var viewModel = BriefingWireViewModel()

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

    private var activeDispatch: DispatchCard? {
        if let id = viewModel.selectedDispatchId,
           let match = syncService.dispatches.first(where: { $0.id == id }) {
            return match
        }
        return syncService.dispatches.first
    }

    public var body: some View {
        GeometryReader { proxy in
            let useTwoColumn = proxy.size.width >= 900
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    BriefingHeaderSection(
                        selectedLanguage: $viewModel.selectedLanguage,
                        isSampleDrill: syncService.isUsingSampleFallback
                    )

                    if let err = syncService.syncError {
                        BriefingNoticeBanner(
                            title: "Firestore Sync Notice",
                            message: err,
                            isWarning: true,
                            retryAction: { syncService.retrySync() }
                        )
                    } else if syncService.isUsingSampleFallback && !syncService.isLoadingDispatches {
                        BriefingNoticeBanner(
                            title: syncService.isFirebaseConfigured ? "No Published Dispatches Yet" : "Preview Drill Mode",
                            message: syncService.isFirebaseConfigured
                                ? "Showing offline synthetic reference dispatch until Broadcast Studio (Web) publishes a live dispatch."
                                : "Add GoogleService-Info.plist to sync live dispatches from Web and Android. You can still test Apple Foundation Models briefing streaming below.",
                            isWarning: false,
                            retryAction: nil
                        )
                    }

                    if syncService.isLoadingDispatches {
                        VStack(spacing: 12) {
                            SigapSkeletonCard(accessibilityText: "Loading synced crisis dispatches from Firestore")
                            SigapSkeletonCard(accessibilityText: "Preparing executive briefing adapter")
                        }
                    } else {
                        if syncService.dispatches.count > 1 {
                            BriefingDispatchPickerStrip(
                                dispatches: syncService.dispatches,
                                activeDispatchId: activeDispatch?.id,
                                onSelect: { viewModel.selectDispatch($0) }
                            )
                        }

                        if let dispatch = activeDispatch {
                            if useTwoColumn {
                                HStack(alignment: .top, spacing: 18) {
                                    BriefingDispatchCard(
                                        dispatch: dispatch,
                                        selectedLanguage: viewModel.selectedLanguage,
                                        copiedKey: viewModel.copiedKey,
                                        isCompact: false,
                                        onCopy: { key, text in viewModel.copyWithFeedback(key: key, text: text) }
                                    )
                                    .frame(maxWidth: .infinity)

                                    BriefingStreamingAdapterCard(
                                        dispatch: dispatch,
                                        syncService: syncService,
                                        viewModel: viewModel,
                                        isCompact: false
                                    )
                                    .frame(width: min(420, proxy.size.width * 0.42))
                                }
                            } else {
                                BriefingDispatchCard(
                                    dispatch: dispatch,
                                    selectedLanguage: viewModel.selectedLanguage,
                                    copiedKey: viewModel.copiedKey,
                                    isCompact: isCompactWidth,
                                    onCopy: { key, text in viewModel.copyWithFeedback(key: key, text: text) }
                                )

                                BriefingStreamingAdapterCard(
                                    dispatch: dispatch,
                                    syncService: syncService,
                                    viewModel: viewModel,
                                    isCompact: isCompactWidth
                                )
                            }
                        }
                    }
                }
                .padding(isCompactWidth ? 14 : 20)
                .frame(maxWidth: useTwoColumn ? 1180 : 820, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(SigapTheme.ground(scheme))
        }
    }
}

private struct BriefingHeaderSection: View {
    @Environment(\.colorScheme) private var scheme
    @Binding var selectedLanguage: BriefingWireViewModel.AudienceLanguage
    let isSampleDrill: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                SigapStatusTag(
                    "SYNTHETIC DRILL FEED",
                    fg: SigapTheme.warningColors(scheme).fg,
                    bg: SigapTheme.warningColors(scheme).bg,
                    border: SigapTheme.warningBorder(scheme)
                )
                if isSampleDrill {
                    SigapStatusTag(
                        "OFFLINE REFERENCE",
                        fg: SigapTheme.inkMuted(scheme),
                        bg: SigapTheme.subtle(scheme),
                        border: SigapTheme.borderSubtle(scheme)
                    )
                }
                Spacer()
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Live Crisis Wire & Executive Briefing")
                    .font(.system(.title2, design: .serif, weight: .bold))
                    .foregroundStyle(SigapTheme.inkPrimary(scheme))
                Text("Synced verified dispatches adapted on-device by Apple Foundation Models.")
                    .font(.subheadline)
                    .foregroundStyle(SigapTheme.inkMuted(scheme))
            }

            Picker("Audience Language", selection: $selectedLanguage) {
                ForEach(BriefingWireViewModel.AudienceLanguage.allCases) { lang in
                    Text(lang.label).tag(lang)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityLabel("Audience language selector")
        }
    }
}

private struct BriefingDispatchPickerStrip: View {
    @Environment(\.colorScheme) private var scheme
    let dispatches: [DispatchCard]
    let activeDispatchId: String?
    let onSelect: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(dispatches) { card in
                    let isSelected = card.id == activeDispatchId
                    Button {
                        onSelect(card.id)
                    } label: {
                        HStack(spacing: 6) {
                            Text("Dispatch #\(card.dispatchNumber)")
                                .font(.system(.caption, design: .monospaced, weight: .semibold))
                                .monospacedDigit()
                            Text(card.severity.rawValue)
                                .font(.system(.caption2, design: .monospaced))
                        }
                    }
                    .buttonStyle(SigapButtonStyle(isSelected ? .primary : .secondary))
                    .accessibilityAddTraits(isSelected ? .isSelected : [])
                }
            }
        }
    }
}

private struct BriefingDispatchCard: View {
    @Environment(\.colorScheme) private var scheme
    let dispatch: DispatchCard
    let selectedLanguage: BriefingWireViewModel.AudienceLanguage
    let copiedKey: String?
    let isCompact: Bool
    let onCopy: (String, String) -> Void

    var body: some View {
        let sevColors = SigapTheme.severityColors(dispatch.severity, scheme: scheme)
        let srcColors = dispatch.inferenceSource == .onDevice
            ? SigapTheme.onDeviceColors(scheme)
            : SigapTheme.inCloudColors(scheme)
        let okColors = SigapTheme.onDeviceColors(scheme)
        let critColors = SigapTheme.criticalColors(scheme)

        VStack(alignment: .leading, spacing: 14) {
            // Masthead metadata row
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    Text("DISPATCH #\(dispatch.dispatchNumber)")
                        .font(.system(.caption, design: .monospaced, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(SigapTheme.inkPrimary(scheme))

                    SigapStatusTag(dispatch.severity.rawValue, fg: sevColors.fg, bg: sevColors.bg)
                    SigapStatusTag(dispatch.inferenceSource.badgeText, fg: srcColors.fg, bg: srcColors.bg)

                    if let seal = dispatch.provenanceCode, !seal.isEmpty {
                        SigapStatusTag(
                            "SEAL: \(seal)",
                            fg: okColors.fg,
                            bg: okColors.bg,
                            border: SigapTheme.onDeviceBorder(scheme)
                        )
                    }
                }
            }

            Divider()
                .background(SigapTheme.borderSubtle(scheme))

            if selectedLanguage == .indonesian {
                Text(dispatch.communityTitle)
                    .font(.system(.title3, design: .serif, weight: .bold))
                    .foregroundStyle(SigapTheme.inkPrimary(scheme))

                Text(dispatch.communityWhatHappened)
                    .font(.body)
                    .foregroundStyle(SigapTheme.inkPrimary(scheme))
                    .fixedSize(horizontal: false, vertical: true)

                if !dispatch.communityDoNow.isEmpty || !dispatch.communityAvoid.isEmpty {
                    if isCompact {
                        VStack(spacing: 10) {
                            if !dispatch.communityDoNow.isEmpty {
                                SigapActionCallout(
                                    title: "LAKUKAN SEKARANG (DO NOW)",
                                    items: dispatch.communityDoNow,
                                    fg: okColors.fg,
                                    bg: okColors.bg,
                                    border: SigapTheme.onDeviceBorder(scheme)
                                )
                            }
                            if !dispatch.communityAvoid.isEmpty {
                                SigapActionCallout(
                                    title: "HINDARI (AVOID)",
                                    items: dispatch.communityAvoid,
                                    fg: critColors.fg,
                                    bg: critColors.bg,
                                    border: SigapTheme.criticalBorder(scheme)
                                )
                            }
                        }
                    } else {
                        HStack(alignment: .top, spacing: 10) {
                            if !dispatch.communityDoNow.isEmpty {
                                SigapActionCallout(
                                    title: "LAKUKAN SEKARANG (DO NOW)",
                                    items: dispatch.communityDoNow,
                                    fg: okColors.fg,
                                    bg: okColors.bg,
                                    border: SigapTheme.onDeviceBorder(scheme)
                                )
                            }
                            if !dispatch.communityAvoid.isEmpty {
                                SigapActionCallout(
                                    title: "HINDARI (AVOID)",
                                    items: dispatch.communityAvoid,
                                    fg: critColors.fg,
                                    bg: critColors.bg,
                                    border: SigapTheme.criticalBorder(scheme)
                                )
                            }
                        }
                    }
                }
            } else {
                Text(dispatch.globalHeadline)
                    .font(.system(.title3, design: .serif, weight: .bold))
                    .foregroundStyle(SigapTheme.inkPrimary(scheme))

                Text(dispatch.globalExecutiveSummary)
                    .font(.body)
                    .foregroundStyle(SigapTheme.inkPrimary(scheme))
                    .fixedSize(horizontal: false, vertical: true)

                if !dispatch.globalPriorityNeeds.isEmpty {
                    SigapBulletSection(title: "Priority Needs", items: dispatch.globalPriorityNeeds)
                }
                if !dispatch.globalInformationGaps.isEmpty {
                    SigapBulletSection(title: "Verified Information Gaps", items: dispatch.globalInformationGaps)
                }
            }

            if !dispatch.whatsappShortText.isEmpty {
                let copyLabel = copiedKey == "wa-\(dispatch.id)" ? "WhatsApp Alert Copied" : "Copy WhatsApp Alert"
                if isCompact {
                    VStack(spacing: 8) {
                        Button {
                            onCopy("wa-\(dispatch.id)", dispatch.whatsappShortText)
                        } label: {
                            Text(copyLabel).font(.caption.weight(.semibold))
                        }
                        .buttonStyle(SigapButtonStyle(.secondary, fullWidth: true))

                        ShareLink(item: dispatch.whatsappShortText) {
                            Text("Share Alert").font(.caption.weight(.semibold))
                        }
                        .buttonStyle(SigapButtonStyle(.subtle, fullWidth: true))
                    }
                } else {
                    HStack(spacing: 10) {
                        Button {
                            onCopy("wa-\(dispatch.id)", dispatch.whatsappShortText)
                        } label: {
                            Text(copyLabel).font(.caption.weight(.semibold))
                        }
                        .buttonStyle(SigapButtonStyle(.secondary))

                        ShareLink(item: dispatch.whatsappShortText) {
                            Text("Share Alert").font(.caption.weight(.semibold))
                        }
                        .buttonStyle(SigapButtonStyle(.subtle))
                    }
                }
            }

            if dispatch.hasRumorAlert {
                let verdictColors = SigapTheme.verdictColors(dispatch.debunkVerdict, scheme: scheme)
                VStack(alignment: .leading, spacing: 8) {
                    SigapStatusTag(
                        "RUMOR CHECK: \(dispatch.debunkVerdict.rawValue)",
                        fg: verdictColors.fg,
                        bg: verdictColors.bg
                    )
                    Text(selectedLanguage == .indonesian ? dispatch.debunkFactId : dispatch.debunkFactEn)
                        .font(.callout)
                        .foregroundStyle(SigapTheme.inkPrimary(scheme))
                        .fixedSize(horizontal: false, vertical: true)

                    if !dispatch.debunkSources.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(dispatch.debunkSources) { src in
                                if let url = URL(string: src.uri) {
                                    Link(src.title, destination: url)
                                        .font(.caption.weight(.medium))
                                        .foregroundStyle(SigapTheme.accentText(scheme))
                                        .frame(minHeight: 44, alignment: .leading)
                                }
                            }
                        }
                    }
                }
                .sigapSubtlePanel(padding: 12)
            }
        }
        .sigapCard()
    }
}

private struct BriefingStreamingAdapterCard: View {
    @Environment(\.colorScheme) private var scheme
    let dispatch: DispatchCard
    @ObservedObject var syncService: FirestoreSyncService
    @ObservedObject var viewModel: BriefingWireViewModel
    let isCompact: Bool

    var body: some View {
        let modelStatus = AppleHybridAiService.checkAvailability(isFirebaseConfigured: syncService.isFirebaseConfigured)
        let badgeColors = viewModel.streamSourceLabel == .onDevice
            ? SigapTheme.onDeviceColors(scheme)
            : SigapTheme.inCloudColors(scheme)

        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("On-Device Streaming Briefing Adapter")
                    .font(.headline)
                    .foregroundStyle(SigapTheme.inkPrimary(scheme))
                Text("HybridModel(primary: Apple Foundation Models, secondary: \(syncService.fastCloudModel))")
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(SigapTheme.inkMuted(scheme))
            }

            // Full-legibility format selector (never truncates mid-word on iPhone)
            VStack(alignment: .leading, spacing: 6) {
                Text("Output Format")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(SigapTheme.inkMuted(scheme))

                VStack(spacing: 6) {
                    ForEach(BriefingFormat.allCases) { fmt in
                        let selected = viewModel.selectedFormat == fmt
                        Button {
                            viewModel.selectedFormat = fmt
                        } label: {
                            HStack {
                                Text(isCompact ? fmt.compactTitle : fmt.title)
                                    .font(.caption.weight(selected ? .bold : .medium))
                                Spacer()
                                if selected {
                                    Text("ACTIVE")
                                        .font(.system(.caption2, design: .monospaced, weight: .bold))
                                        .foregroundStyle(SigapTheme.accentText(scheme))
                                }
                            }
                        }
                        .buttonStyle(SigapButtonStyle(selected ? .secondary : .subtle, fullWidth: true))
                        .accessibilityAddTraits(selected ? .isSelected : [])
                    }
                }
            }

            Button {
                viewModel.startStreamingBrief(dispatch: dispatch, syncService: syncService)
            } label: {
                HStack(spacing: 8) {
                    if viewModel.isStreaming {
                        ProgressView()
                            .controlSize(.small)
                    }
                    Text(viewModel.isStreaming ? "Streaming Brief..." : "Stream Adapted Briefing")
                        .fontWeight(.semibold)
                }
            }
            .buttonStyle(SigapButtonStyle(.primary, fullWidth: true))
            .disabled(viewModel.isStreaming)

            Text("Model readiness: \(modelStatus.label)")
                .font(.caption)
                .foregroundStyle(SigapTheme.inkMuted(scheme))

            if let streamError = viewModel.streamError {
                Text(streamError)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(SigapTheme.accentText(scheme))
            }

            if !viewModel.streamedBriefText.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        SigapStatusTag(
                            viewModel.streamSourceLabel.badgeText,
                            fg: badgeColors.fg,
                            bg: badgeColors.bg
                        )
                        if !viewModel.streamRoutingNote.isEmpty {
                            Text(viewModel.streamRoutingNote)
                                .font(.caption)
                                .foregroundStyle(SigapTheme.inkMuted(scheme))
                                .lineLimit(2)
                        }
                    }

                    Text(viewModel.streamedBriefText)
                        .font(.body)
                        .foregroundStyle(SigapTheme.inkPrimary(scheme))
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)

                    HStack(spacing: 10) {
                        Button {
                            viewModel.copyWithFeedback(key: "brief-\(dispatch.id)", text: viewModel.streamedBriefText)
                        } label: {
                            Text(viewModel.copiedKey == "brief-\(dispatch.id)" ? "Copied Brief" : "Copy Brief")
                                .font(.caption.weight(.semibold))
                        }
                        .buttonStyle(SigapButtonStyle(.secondary))

                        ShareLink(item: viewModel.streamedBriefText) {
                            Text("Share Brief")
                                .font(.caption.weight(.semibold))
                        }
                        .buttonStyle(SigapButtonStyle(.secondary))
                    }
                }
                .sigapSubtlePanel(padding: 12)
            }
        }
        .sigapCard()
    }
}

private struct BriefingNoticeBanner: View {
    @Environment(\.colorScheme) private var scheme
    let title: String
    let message: String
    let isWarning: Bool
    let retryAction: (() -> Void)?

    var body: some View {
        let colors = isWarning
            ? SigapTheme.warningColors(scheme)
            : (fg: SigapTheme.inkPrimary(scheme), bg: SigapTheme.subtle(scheme))
        let border = isWarning ? SigapTheme.warningBorder(scheme) : SigapTheme.borderSubtle(scheme)

        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(colors.fg)
                Text(message)
                    .font(.caption)
                    .foregroundStyle(isWarning ? colors.fg : SigapTheme.inkMuted(scheme))
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            if let retryAction {
                Button("Retry Sync", action: retryAction)
                    .font(.caption.weight(.semibold))
                    .buttonStyle(SigapButtonStyle(.secondary))
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(colors.bg)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(border, lineWidth: 1)
        )
    }
}
