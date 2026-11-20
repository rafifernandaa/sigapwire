import SwiftUI

public struct BriefingWireView: View {
    @Environment(\.colorScheme) private var scheme
    @ObservedObject var syncService: FirestoreSyncService

    @State private var selectedLanguage: AudienceLanguage = .indonesian
    @State private var selectedDispatchId: String?
    @State private var selectedFormat: BriefingFormat = .executive3Bullet
    @State private var streamedBriefText: String = ""
    @State private var streamSourceLabel: InferenceSourceLabel = .onDevice
    @State private var streamRoutingNote: String = ""
    @State private var isStreaming: Bool = false
    @State private var streamError: String?

    enum AudienceLanguage: String, CaseIterable, Identifiable {
        case indonesian = "ID"
        case english = "EN"
        var id: String { rawValue }
        var label: String { self == .indonesian ? "Community (ID)" : "Global SitRep (EN)" }
    }

    public init(syncService: FirestoreSyncService) {
        self.syncService = syncService
    }

    private var activeDispatch: DispatchCard? {
        if let id = selectedDispatchId,
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

            Picker("Audience Language", selection: $selectedLanguage) {
                ForEach(AudienceLanguage.allCases) { lang in
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
                        selectedDispatchId = card.id
                        streamedBriefText = ""
                        streamRoutingNote = ""
                    } label: {
                        HStack(spacing: 6) {
                            Text("Dispatch #\(card.dispatchNumber)")
                                .font(.system(.caption, design: .monospaced, weight: .semibold))
                                .monospacedDigit()
                            Text(card.severity.rawValue)
                                .font(.system(.caption2, design: .monospaced))
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
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

            if selectedLanguage == .indonesian {
                Text(d.communityTitle)
                    .font(.system(.title3, design: .serif, weight: .bold))
                    .foregroundStyle(SigapTheme.inkPrimary(scheme))

                Text(d.communityWhatHappened)
                    .font(.body)
                    .foregroundStyle(SigapTheme.inkPrimary(scheme))

                if !d.communityDoNow.isEmpty {
                    bulletSection(title: "Lakukan Sekarang (Do Now)", items: d.communityDoNow)
                }
                if !d.communityAvoid.isEmpty {
                    bulletSection(title: "Hindari (Avoid)", items: d.communityAvoid)
                }
            } else {
                Text(d.globalHeadline)
                    .font(.system(.title3, design: .serif, weight: .bold))
                    .foregroundStyle(SigapTheme.inkPrimary(scheme))

                Text(d.globalExecutiveSummary)
                    .font(.body)
                    .foregroundStyle(SigapTheme.inkPrimary(scheme))

                if !d.globalPriorityNeeds.isEmpty {
                    bulletSection(title: "Priority Needs", items: d.globalPriorityNeeds)
                }
                if !d.globalInformationGaps.isEmpty {
                    bulletSection(title: "Verified Information Gaps", items: d.globalInformationGaps)
                }
            }

            if d.hasRumorAlert {
                let verdictColors = SigapTheme.verdictColors(d.debunkVerdict, scheme: scheme)
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        statusTag("RUMOR CHECK: \(d.debunkVerdict.rawValue)", fg: verdictColors.fg, bg: verdictColors.bg)
                    }
                    Text(selectedLanguage == .indonesian ? d.debunkFactId : d.debunkFactEn)
                        .font(.callout)
                        .foregroundStyle(SigapTheme.inkPrimary(scheme))

                    if !d.debunkSources.isEmpty {
                        ForEach(d.debunkSources) { src in
                            if let url = URL(string: src.uri) {
                                Link(src.title, destination: url)
                                    .font(.caption)
                                    .foregroundStyle(SigapTheme.accentText(scheme))
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
        let badgeColors = streamSourceLabel == .onDevice
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

            Picker("Briefing Format", selection: $selectedFormat) {
                ForEach(BriefingFormat.allCases) { fmt in
                    Text(fmt.title).tag(fmt)
                }
            }
            .pickerStyle(.segmented)

            Button {
                startStreamingBrief(dispatch: d)
            } label: {
                HStack(spacing: 8) {
                    if isStreaming {
                        ProgressView()
                            .controlSize(.small)
                    }
                    Text(isStreaming ? "Streaming Brief..." : "Stream Adapted Briefing")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(SigapTheme.accentVermilion)
                .foregroundStyle(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            .buttonStyle(.plain)
            .disabled(isStreaming)

            Text("Model readiness: \(modelStatus.label)")
                .font(.caption)
                .foregroundStyle(SigapTheme.inkMuted(scheme))

            if let streamError {
                Text(streamError)
                    .font(.caption)
                    .foregroundStyle(SigapTheme.accentText(scheme))
            }

            if !streamedBriefText.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        statusTag(streamSourceLabel.badgeText, fg: badgeColors.fg, bg: badgeColors.bg)
                        if !streamRoutingNote.isEmpty {
                            Text(streamRoutingNote)
                                .font(.caption)
                                .foregroundStyle(SigapTheme.inkMuted(scheme))
                        }
                    }

                    Text(streamedBriefText)
                        .font(.body)
                        .foregroundStyle(SigapTheme.inkPrimary(scheme))
                        .textSelection(.enabled)
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

    private func startStreamingBrief(dispatch: DispatchCard) {
        isStreaming = true
        streamError = nil
        streamedBriefText = ""

        Task { @MainActor in
            do {
                let stream = AppleHybridAiService.streamDispatchBriefing(
                    dispatch: dispatch,
                    format: selectedFormat,
                    fastCloudModel: syncService.fastCloudModel,
                    isFirebaseConfigured: syncService.isFirebaseConfigured
                )
                for try await update in stream {
                    streamedBriefText = update.text
                    streamSourceLabel = update.inferenceSource
                    streamRoutingNote = update.routingNote
                }
            } catch {
                streamError = error.localizedDescription
            }
            isStreaming = false
        }
    }

    private func bulletSection(title: String, items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(SigapTheme.inkMuted(scheme))
            ForEach(items, id: \.self) { item in
                HStack(alignment: .top, spacing: 6) {
                    Text("-")
                        .foregroundStyle(SigapTheme.accentText(scheme))
                    Text(item)
                        .font(.callout)
                        .foregroundStyle(SigapTheme.inkPrimary(scheme))
                }
            }
        }
    }

    private func statusTag(_ text: String, fg: Color, bg: Color) -> some View {
        Text(text)
            .font(.system(.caption2, design: .monospaced, weight: .semibold))
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .foregroundStyle(fg)
            .background(bg)
            .clipShape(RoundedRectangle(cornerRadius: 4))
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
