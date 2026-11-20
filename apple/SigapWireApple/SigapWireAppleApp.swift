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
    @ObservedObject var syncService: FirestoreSyncService
    @Binding var useDarkMode: Bool

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

        return VStack(spacing: 0) {
            HStack(spacing: 10) {
                Rectangle()
                    .fill(SigapTheme.accentVermilion)
                    .frame(width: 10, height: 10)

                Text("SigapWire")
                    .font(.system(.headline, design: .serif, weight: .bold))
                    .foregroundStyle(SigapTheme.inkPrimary(scheme))

                Text("SYNTHETIC DRILL")
                    .font(.system(.caption2, design: .monospaced, weight: .semibold))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(SigapTheme.subtle(scheme))
                    .foregroundStyle(SigapTheme.inkMuted(scheme))
                    .clipShape(RoundedRectangle(cornerRadius: 4))

                Spacer()

                Text(modelStatus.isOnDeviceReady ? "APPLE NANO READY" : (syncService.isFirebaseConfigured ? "CLOUD FALLBACK" : "PREVIEW ONLY"))
                    .font(.system(.caption2, design: .monospaced, weight: .semibold))
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .foregroundStyle(statusColors.0)
                    .background(statusColors.1)
                    .clipShape(RoundedRectangle(cornerRadius: 4))

                Button {
                    useDarkMode.toggle()
                } label: {
                    Text(useDarkMode ? "Light" : "Dark")
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .background(SigapTheme.subtle(scheme))
                        .foregroundStyle(SigapTheme.inkPrimary(scheme))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(SigapTheme.surface(scheme))

            Divider()
                .background(SigapTheme.borderSubtle(scheme))
        }
    }
}
