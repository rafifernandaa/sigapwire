import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

public enum SigapClipboard {
    @MainActor
    public static func copy(_ text: String) {
        #if canImport(UIKit)
        UIPasteboard.general.string = text
        #elseif canImport(AppKit)
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(text, forType: .string)
        #endif
    }
}

public struct SigapStatusTag: View {
    public let text: String
    public let fg: Color
    public let bg: Color

    public init(_ text: String, fg: Color, bg: Color) {
        self.text = text
        self.fg = fg
        self.bg = bg
    }

    public var body: some View {
        Text(text)
            .font(.system(.caption2, design: .monospaced, weight: .semibold))
            .monospacedDigit()
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .foregroundStyle(fg)
            .background(bg)
            .clipShape(RoundedRectangle(cornerRadius: 4))
    }
}

public struct SigapBulletSection: View {
    @Environment(\.colorScheme) private var scheme
    public let title: String
    public let items: [String]

    public init(title: String, items: [String]) {
        self.title = title
        self.items = items
    }

    public var body: some View {
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
}

public enum SigapTheme {
    // Ground & surfaces (DESIGN.md WCAG AA Verified)
    public static func ground(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0x111315) : Color(hex: 0xF8F7F4)
    }

    public static func surface(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0x1A1D21) : Color(hex: 0xFFFFFF)
    }

    public static func subtle(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0x22262C) : Color(hex: 0xF1EFEA)
    }

    public static func inkPrimary(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0xF3F4F6) : Color(hex: 0x14171A)
    }

    public static func inkMuted(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0x9CA3AF) : Color(hex: 0x475569)
    }

    public static func borderStrong(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0x94A3B8) : Color(hex: 0x64748B)
    }

    public static func borderSubtle(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0x2D333B) : Color(hex: 0xDDD9D0)
    }

    public static let accentVermilion = Color(hex: 0xC83219)

    public static func accentText(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0xFCA5A5) : Color(hex: 0xB92B14)
    }

    // Functional state tokens (text + fill)
    public static func onDeviceColors(_ scheme: ColorScheme) -> (fg: Color, bg: Color) {
        scheme == .dark
            ? (Color(hex: 0x6EE7B7), Color(hex: 0x064E3B))
            : (Color(hex: 0x0D6B53), Color(hex: 0xECFDF5))
    }

    public static func inCloudColors(_ scheme: ColorScheme) -> (fg: Color, bg: Color) {
        scheme == .dark
            ? (Color(hex: 0x93C5FD), Color(hex: 0x1E3A8A))
            : (Color(hex: 0x1D4ED8), Color(hex: 0xEFF6FF))
    }

    public static func warningColors(_ scheme: ColorScheme) -> (fg: Color, bg: Color) {
        scheme == .dark
            ? (Color(hex: 0xFDE68A), Color(hex: 0x78350F))
            : (Color(hex: 0x92400E), Color(hex: 0xFEF3C7))
    }

    public static func criticalColors(_ scheme: ColorScheme) -> (fg: Color, bg: Color) {
        scheme == .dark
            ? (Color(hex: 0xFCA5A5), Color(hex: 0x450A0A))
            : (Color(hex: 0x991B1B), Color(hex: 0xFEE2E2))
    }

    public static func severityColors(_ severity: SeverityLevel, scheme: ColorScheme) -> (fg: Color, bg: Color) {
        switch severity {
        case .critical:
            return criticalColors(scheme)
        case .high:
            return warningColors(scheme)
        case .medium:
            return inCloudColors(scheme)
        case .low:
            return (inkMuted(scheme), subtle(scheme))
        }
    }

    public static func verdictColors(_ verdict: RumorVerdict, scheme: ColorScheme) -> (fg: Color, bg: Color) {
        switch verdict {
        case .verified:
            return onDeviceColors(scheme)
        case .misleading:
            return criticalColors(scheme)
        case .unverifiedDeveloping:
            return warningColors(scheme)
        case .notApplicable:
            return (inkMuted(scheme), subtle(scheme))
        }
    }
}

public extension Color {
    init(hex: UInt32, opacity: Double = 1.0) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >> 8) & 0xFF) / 255.0
        let b = Double(hex & 0xFF) / 255.0
        self.init(.sRGB, red: r, green: g, blue: b, opacity: opacity)
    }
}
