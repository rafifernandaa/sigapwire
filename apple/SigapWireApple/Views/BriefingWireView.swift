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
    @ObservedObject var syncService: FirestoreSyncService
    @StateObject private var viewModel = BriefingWireViewModel()

    public init(syncService: FirestoreSyncService) {
        self.syncService = syncService
    }

    private var activeDispatch: DispatchCard? {
        if let id = viewModel.selectedDispatchId,
           let match = syncService.dispatches.first(where: { $0.id == id }) {
            return match
        }
        return syncService.dispatches.first
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                headerControls

                if let err = syncService.syncError {
                    noticeBanner(
                        title: "Firestore Sync Notice",
                        message: err,
                        isWarning: true
                    )
                } else if syncService.isUsingSampleFallback {
                    noticeBanner(
                        title: syncService.isFirebaseConfigured ? "No Published Dispatches Yet" : "Preview Drill Mode",
                        message: syncService.isFirebaseConfigured
                            ? "Showing offline synthetic reference dispatch until Broadcast Studio (Web) publishes a live dispatch."
                            : "Add GoogleService-Info.plist to sync live dispatches from Web and Android. You can still test Apple Intelligence or deterministic briefing streaming below.",
                        isWarning: false
                    )
                }

                if syncService.dispatches.count > 1 {
                    dispatchPickerStrip
                }

                if let dispatch = activeDispatch {
                    dispatchDetailCard(dispatch)
                    appleBriefingAdapterCard(dispatch)
                }
            }
            .padding(16)
            .frame(maxWidth: 820, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(SigapTheme.ground(scheme))
    }

    private var headerControls: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Live Crisis Wire & Executive Briefing")
                        .font(.system(.title2, design: .serif, weight: .bold))
                        .foregroundStyle(SigapTheme.inkPrimary(scheme))
                    Text("Synced verified dispatches adapted on-device by Apple Foundation Models.")
                        .font(.subheadline)
                        .foregroundStyle(SigapTheme.inkMuted(scheme))
                }
                Spacer()
            }

            Picker("Audience Language", selection: $viewModel.selectedLanguage) {
                ForEach(BriefingWireViewModel.AudienceLanguage.allCases) { lang in
                    Text(lang.label).tag(lang)
                }
            }
            .pickerStyle(.segmented)
        }
    }

    private var dispatchPickerStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(syncService.dispatches) { card in
                    let isSelected = card.id == activeDispatch?.id
                    Button {
                        viewModel.selectDispatch(card.id)
                    } label: {
                        HStack(spacing: 6) {
                            Text("Dispatch #\(card.dispatchNumber)")
                                .font(.system(.caption, design: .monospaced, weight: .semibold))
                                .monospacedDigit()
                            Text(card.severity.rawValue)
                                .font(.system(.caption2, design: .monospaced))
                        }
                        .padding(.horizontal, 10)
                        .frame(minHeight: 44)
                        .background(isSelected ? SigapTheme.accentVermilion : SigapTheme.surface(scheme))
                        .foregroundStyle(isSelected ? Color.white : SigapTheme.inkPrimary(scheme))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(isSelected ? SigapTheme.accentVermilion : SigapTheme.borderSubtle(scheme), lineWidth: 1)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func dispatchDetailCard(_ d: DispatchCard) -> some View {
        let sevColors = SigapTheme.severityColors(d.severity, scheme: scheme)
        let srcColors = d.inferenceSource == .onDevice
            ? SigapTheme.onDeviceColors(scheme)
            : SigapTheme.inCloudColors(scheme)

        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text("DISPATCH #\(d.dispatchNumber)")
                    .font(.system(.caption, design: .monospaced, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(SigapTheme.inkPrimary(scheme))

                statusTag(d.severity.rawValue, fg: sevColors.fg, bg: sevColors.bg)
                statusTag(d.inferenceSource.badgeText, fg: srcColors.fg, bg: srcColors.bg)
                Spacer()
            }

            if viewModel.selectedLanguage == .indonesian {
                Text(d.communityTitle)
                    .font(.system(.title3, design: .serif, weight: .bold))
                    .foregroundStyle(SigapTheme.inkPrimary(scheme))

                Text(d.communityWhatHappened)
                    .font(.body)
                    .foregroundStyle(SigapTheme.inkPrimary(scheme))

                if !d.communityDoNow.isEmpty {
                    SigapBulletSection(title: "Lakukan Sekarang (Do Now)", items: d.communityDoNow)
                }
                if !d.communityAvoid.isEmpty {
                    SigapBulletSection(title: "Hindari (Avoid)", items: d.communityAvoid)
                }
            } else {
                Text(d.globalHeadline)
                    .font(.system(.title3, design: .serif, weight: .bold))
                    .foregroundStyle(SigapTheme.inkPrimary(scheme))

                Text(d.globalExecutiveSummary)
                    .font(.body)
                    .foregroundStyle(SigapTheme.inkPrimary(scheme))

                if !d.globalPriorityNeeds.isEmpty {
                    SigapBulletSection(title: "Priority Needs", items: d.globalPriorityNeeds)
                }
                if !d.globalInformationGaps.isEmpty {
                    SigapBulletSection(title: "Verified Information Gaps", items: d.globalInformationGaps)
                }
            }

            if !d.whatsappShortText.isEmpty {
                HStack(spacing: 10) {
                    Button {
                        viewModel.copyWithFeedback(key: "wa-\(d.id)", text: d.whatsappShortText)
                    } label: {
                        Text(viewModel.copiedKey == "wa-\(d.id)" ? "WhatsApp Alert Copied" : "Copy WhatsApp Alert")
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

                    ShareLink(item: d.whatsappShortText) {
                        Text("Share Alert")
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
            }

            if d.hasRumorAlert {
                let verdictColors = SigapTheme.verdictColors(d.debunkVerdict, scheme: scheme)
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        statusTag("RUMOR CHECK: \(d.debunkVerdict.rawValue)", fg: verdictColors.fg, bg: verdictColors.bg)
                    }
                    Text(viewModel.selectedLanguage == .indonesian ? d.debunkFactId : d.debunkFactEn)
                        .font(.callout)
                        .foregroundStyle(SigapTheme.inkPrimary(scheme))

                    if !d.debunkSources.isEmpty {
                        ForEach(d.debunkSources) { src in
                            if let url = URL(string: src.uri) {
                                Link(src.title, destination: url)
                                    .font(.caption)
                                    .foregroundStyle(SigapTheme.accentText(scheme))
                                    .frame(minHeight: 44, alignment: .leading)
                            }
                        }
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(SigapTheme.subtle(scheme))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(SigapTheme.borderSubtle(scheme), lineWidth: 1)
                )
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SigapTheme.surface(scheme))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(SigapTheme.borderSubtle(scheme), lineWidth: 1)
        )
    }

    private func appleBriefingAdapterCard(_ d: DispatchCard) -> some View {
        let modelStatus = AppleHybridAiService.checkAvailability(isFirebaseConfigured: syncService.isFirebaseConfigured)
        let badgeColors = viewModel.streamSourceLabel == .onDevice
            ? SigapTheme.onDeviceColors(scheme)
            : SigapTheme.inCloudColors(scheme)

        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("On-Device Streaming Briefing Adapter")
                        .font(.headline)
                        .foregroundStyle(SigapTheme.inkPrimary(scheme))
                    Text("HybridModel(primary: Apple Foundation Models, secondary: \(syncService.fastCloudModel))")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(SigapTheme.inkMuted(scheme))
                }
                Spacer()
            }

            Picker("Briefing Format", selection: $viewModel.selectedFormat) {
                ForEach(BriefingFormat.allCases) { fmt in
                    Text(fmt.title).tag(fmt)
                }
            }
            .pickerStyle(.segmented)

            Button {
                viewModel.startStreamingBrief(dispatch: d, syncService: syncService)
            } label: {
                HStack(spacing: 8) {
                    if viewModel.isStreaming {
                        ProgressView()
                            .controlSize(.small)
                    }
                    Text(viewModel.isStreaming ? "Streaming Brief..." : "Stream Adapted Briefing")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(SigapTheme.accentVermilion)
                .foregroundStyle(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            .buttonStyle(.plain)
            .disabled(viewModel.isStreaming)

            Text("Model readiness: \(modelStatus.label)")
                .font(.caption)
                .foregroundStyle(SigapTheme.inkMuted(scheme))

            if let streamError = viewModel.streamError {
                Text(streamError)
                    .font(.caption)
                    .foregroundStyle(SigapTheme.accentText(scheme))
            }

            if !viewModel.streamedBriefText.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        statusTag(viewModel.streamSourceLabel.badgeText, fg: badgeColors.fg, bg: badgeColors.bg)
                        if !viewModel.streamRoutingNote.isEmpty {
                            Text(viewModel.streamRoutingNote)
                                .font(.caption)
                                .foregroundStyle(SigapTheme.inkMuted(scheme))
                        }
                    }

                    Text(viewModel.streamedBriefText)
                        .font(.body)
                        .foregroundStyle(SigapTheme.inkPrimary(scheme))
                        .textSelection(.enabled)

                    HStack(spacing: 10) {
                        Button {
                            viewModel.copyWithFeedback(key: "brief-\(d.id)", text: viewModel.streamedBriefText)
                        } label: {
                            Text(viewModel.copiedKey == "brief-\(d.id)" ? "Copied Brief" : "Copy Brief")
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 12)
                                .frame(minHeight: 44)
                                .background(SigapTheme.surface(scheme))
                                .foregroundStyle(SigapTheme.inkPrimary(scheme))
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 6)
                                        .stroke(SigapTheme.borderStrong(scheme), lineWidth: 1)
                                )
                        }
                        .buttonStyle(.plain)

                        ShareLink(item: viewModel.streamedBriefText) {
                            Text("Share Brief")
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 12)
                                .frame(minHeight: 44)
                                .background(SigapTheme.surface(scheme))
                                .foregroundStyle(SigapTheme.inkPrimary(scheme))
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 6)
                                        .stroke(SigapTheme.borderStrong(scheme), lineWidth: 1)
                                )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(SigapTheme.subtle(scheme))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(SigapTheme.borderSubtle(scheme), lineWidth: 1)
                )
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SigapTheme.surface(scheme))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(SigapTheme.borderSubtle(scheme), lineWidth: 1)
        )
    }

    private func statusTag(_ text: String, fg: Color, bg: Color) -> some View {
        SigapStatusTag(text, fg: fg, bg: bg)
    }

    private func noticeBanner(title: String, message: String, isWarning: Bool) -> some View {
        let colors = isWarning ? SigapTheme.warningColors(scheme) : (SigapTheme.inkPrimary(scheme), SigapTheme.subtle(scheme))
        return VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption.weight(.bold))
                .foregroundStyle(colors.0)
            Text(message)
                .font(.caption)
                .foregroundStyle(isWarning ? colors.0 : SigapTheme.inkMuted(scheme))
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(colors.1)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(SigapTheme.borderSubtle(scheme), lineWidth: 1)
        )
    }
}
