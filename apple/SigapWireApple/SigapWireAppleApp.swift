import SwiftUI

enum SigapAppleTab: String, CaseIterable, Identifiable {
    case briefing = "briefing"
    case intake = "intake"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .briefing: return "Briefing Wire"
        case .intake: return "Quick Text Intake"
        }
    }

    var systemImage: String {
        switch self {
        case .briefing: return "newspaper"
        case .intake: return "shield.lefthalf.filled"
        }
    }
}

@main
struct SigapWireAppleApp: App {
    @StateObject private var syncService = FirestoreSyncService()
    @AppStorage("sigapwire_dark_mode") private var useDarkMode: Bool = false

    var body: some Scene {
        WindowGroup {
            SigapWireRootView(syncService: syncService, useDarkMode: $useDarkMode)
                .preferredColorScheme(useDarkMode ? .dark : .light)
                #if os(macOS)
                .frame(minWidth: 760, minHeight: 580)
                #endif
        }
        #if os(macOS)
        .defaultSize(width: 1120, height: 780)
        #endif
    }
}

struct SigapWireRootView: View {
    @Environment(\.colorScheme) private var scheme
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif
    @ObservedObject var syncService: FirestoreSyncService
    @Binding var useDarkMode: Bool
    @State private var selectedTab: SigapAppleTab = .briefing

    private var isCompactWidth: Bool {
        #if os(iOS)
        return horizontalSizeClass == .compact
        #else
        return false
        #endif
    }

    var body: some View {
        VStack(spacing: 0) {
            topMastheadBar

            #if os(macOS)
            Group {
                switch selectedTab {
                case .briefing:
                    BriefingWireView(syncService: syncService)
                case .intake:
                    QuickTextIntakeView(syncService: syncService)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            #else
            TabView(selection: $selectedTab) {
                BriefingWireView(syncService: syncService)
                    .tag(SigapAppleTab.briefing)
                    .tabItem {
                        Label(SigapAppleTab.briefing.title, systemImage: SigapAppleTab.briefing.systemImage)
                    }

                QuickTextIntakeView(syncService: syncService)
                    .tag(SigapAppleTab.intake)
                    .tabItem {
                        Label(SigapAppleTab.intake.title, systemImage: SigapAppleTab.intake.systemImage)
                    }
                    .badge(syncService.openVerificationTasks.count)
            }
            .tint(SigapTheme.accentVermilion)
            #endif
        }
        .background(SigapTheme.ground(scheme))
    }

    private var topMastheadBar: some View {
        let modelStatus = AppleHybridAiService.checkAvailability(isFirebaseConfigured: syncService.isFirebaseConfigured)
        let statusColors = modelStatus.isOnDeviceReady
            ? SigapTheme.onDeviceColors(scheme)
            : (syncService.isFirebaseConfigured ? SigapTheme.inCloudColors(scheme) : SigapTheme.warningColors(scheme))
        let readinessText: String = {
            if modelStatus.isOnDeviceReady {
                return isCompactWidth ? "ON-DEVICE" : "APPLE FM READY"
            }
            if syncService.isFirebaseConfigured {
                return isCompactWidth ? "CLOUD" : "CLOUD FALLBACK"
            }
            return isCompactWidth ? "PREVIEW" : "PREVIEW ONLY"
        }()

        return VStack(spacing: 0) {
            HStack(spacing: 10) {
                Button {
                    selectedTab = .briefing
                } label: {
                    HStack(spacing: 8) {
                        Rectangle()
                            .fill(SigapTheme.accentVermilion)
                            .frame(width: 10, height: 10)
                            .accessibilityHidden(true)

                        Text("SigapWire")
                            .font(.system(.headline, design: .serif, weight: .bold))
                            .foregroundStyle(SigapTheme.inkPrimary(scheme))
                            .lineLimit(1)
                            .fixedSize(horizontal: true, vertical: false)
                    }
                    .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("SigapWire Home")

                #if os(macOS)
                Divider()
                    .frame(height: 20)
                    .padding(.horizontal, 2)

                HStack(spacing: 4) {
                    macTabButton(
                        tab: .briefing,
                        count: syncService.isUsingSampleFallback ? 0 : syncService.dispatches.count,
                        shortcutKey: "1"
                    )
                    macTabButton(
                        tab: .intake,
                        count: syncService.openVerificationTasks.count,
                        shortcutKey: "2"
                    )
                }
                #endif

                Spacer(minLength: 8)

                SigapStatusTag(
                    readinessText,
                    fg: statusColors.fg,
                    bg: statusColors.bg
                )
                .accessibilityLabel("Model readiness: \(modelStatus.label)")

                Button {
                    useDarkMode.toggle()
                } label: {
                    Text(useDarkMode ? "Light" : "Dark")
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                }
                .buttonStyle(SigapButtonStyle(.secondary))
                .accessibilityLabel(useDarkMode ? "Switch to daylight light mode" : "Switch to night-shift dark mode")
            }
            .padding(.horizontal, isCompactWidth ? 12 : 18)
            .padding(.vertical, 6)
            .background(SigapTheme.surface(scheme))

            Divider()
                .background(SigapTheme.borderSubtle(scheme))
        }
    }

    #if os(macOS)
    private func macTabButton(tab: SigapAppleTab, count: Int, shortcutKey: KeyEquivalent) -> some View {
        let isActive = selectedTab == tab
        return Button {
            selectedTab = tab
        } label: {
            HStack(spacing: 6) {
                Image(systemName: tab.systemImage)
                    .font(.caption.weight(.semibold))
                    .accessibilityHidden(true)
                Text(tab.title)
                    .font(.subheadline.weight(isActive ? .bold : .medium))
                    .lineLimit(1)
                if count > 0 {
                    Text("\(count)")
                        .font(.system(.caption2, design: .monospaced, weight: .semibold))
                        .monospacedDigit()
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(SigapTheme.surface(scheme))
                        .foregroundStyle(SigapTheme.inkMuted(scheme))
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                        .overlay(
                            RoundedRectangle(cornerRadius: 4)
                                .stroke(SigapTheme.borderSubtle(scheme), lineWidth: 1)
                        )
                }
            }
        }
        .buttonStyle(SigapButtonStyle(.navTab(active: isActive)))
        .keyboardShortcut(shortcutKey, modifiers: .command)
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }
    #endif
}
