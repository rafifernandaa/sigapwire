import SwiftUI

@main
struct SigapWireAppleApp: App {
    @StateObject private var syncService = FirestoreSyncService()
    @AppStorage("sigapwire_dark_mode") private var useDarkMode: Bool = false

    var body: some Scene {
        WindowGroup {
            SigapWireRootView(syncService: syncService, useDarkMode: $useDarkMode)
                .preferredColorScheme(useDarkMode ? .dark : .light)
        }
    }
}

struct SigapWireRootView: View {
    @Environment(\.colorScheme) private var scheme
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif
    @ObservedObject var syncService: FirestoreSyncService
    @Binding var useDarkMode: Bool

    private var isCompactWidth: Bool {
        #if os(iOS)
        return horizontalSizeClass == .compact
        #else
        return false
        #endif
    }

    var body: some View {
        VStack(spacing: 0) {
            topBannerBar
            TabView {
                BriefingWireView(syncService: syncService)
                    .tabItem {
                        Label("Briefing Wire", systemImage: "newspaper")
                    }

                QuickTextIntakeView(syncService: syncService)
                    .tabItem {
                        Label("Quick Text Intake", systemImage: "shield.lefthalf.filled")
                    }
            }
        }
        .background(SigapTheme.ground(scheme))
    }

    private var topBannerBar: some View {
        let modelStatus = AppleHybridAiService.checkAvailability(isFirebaseConfigured: syncService.isFirebaseConfigured)
        let statusColors = modelStatus.isOnDeviceReady
            ? SigapTheme.onDeviceColors(scheme)
            : (syncService.isFirebaseConfigured ? SigapTheme.inCloudColors(scheme) : SigapTheme.warningColors(scheme))
        let readinessText = modelStatus.isOnDeviceReady
            ? "APPLE NANO READY"
            : (syncService.isFirebaseConfigured ? "CLOUD FALLBACK" : "PREVIEW ONLY")

        return VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 10) {
                    Rectangle()
                        .fill(SigapTheme.accentVermilion)
                        .frame(width: 10, height: 10)

                    Text("SigapWire")
                        .font(.system(.headline, design: .serif, weight: .bold))
                        .foregroundStyle(SigapTheme.inkPrimary(scheme))
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)

                    if !isCompactWidth {
                        SigapStatusTag("SYNTHETIC DRILL", fg: SigapTheme.inkMuted(scheme), bg: SigapTheme.subtle(scheme))
                    }

                    Spacer(minLength: 8)

                    if !isCompactWidth {
                        SigapStatusTag(readinessText, fg: statusColors.0, bg: statusColors.1)
                    }

                    Button {
                        useDarkMode.toggle()
                    } label: {
                        Text(useDarkMode ? "Light" : "Dark")
                            .font(.caption.weight(.semibold))
                            .lineLimit(1)
                            .fixedSize(horizontal: true, vertical: false)
                            .padding(.horizontal, 12)
                            .frame(minWidth: 44, minHeight: 44)
                            .background(SigapTheme.subtle(scheme))
                            .foregroundStyle(SigapTheme.inkPrimary(scheme))
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                    .buttonStyle(.plain)
                }

                if isCompactWidth {
                    HStack(spacing: 8) {
                        SigapStatusTag("SYNTHETIC DRILL", fg: SigapTheme.inkMuted(scheme), bg: SigapTheme.subtle(scheme))
                        SigapStatusTag(readinessText, fg: statusColors.0, bg: statusColors.1)
                        Spacer()
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(SigapTheme.surface(scheme))

            Divider()
                .background(SigapTheme.borderSubtle(scheme))
        }
    }
}
