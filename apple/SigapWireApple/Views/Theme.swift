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
    public let border: Color?

    public init(_ text: String, fg: Color, bg: Color, border: Color? = nil) {
        self.text = text
        self.fg = fg
        self.bg = bg
        self.border = border
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
            .overlay(
                RoundedRectangle(cornerRadius: 4)
                    .stroke(border ?? fg.opacity(0.22), lineWidth: 1)
            )
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
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.caption.weight(.bold))
                .foregroundStyle(SigapTheme.inkMuted(scheme))
            ForEach(items, id: \.self) { item in
                HStack(alignment: .top, spacing: 6) {
                    Text("-")
                        .foregroundStyle(SigapTheme.accentText(scheme))
                        .accessibilityHidden(true)
                    Text(item)
                        .font(.callout)
                        .foregroundStyle(SigapTheme.inkPrimary(scheme))
                }
            }
        }
    }
}

public struct SigapActionCallout: View {
    public let title: String
    public let items: [String]
    public let fg: Color
    public let bg: Color
    public let border: Color

    public init(title: String, items: [String], fg: Color, bg: Color, border: Color) {
        self.title = title
        self.items = items
        self.fg = fg
        self.bg = bg
        self.border = border
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption.weight(.bold))
                .foregroundStyle(fg)
            ForEach(items, id: \.self) { item in
                HStack(alignment: .top, spacing: 6) {
                    Text("-")
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(fg)
                        .accessibilityHidden(true)
                    Text(item)
                        .font(.callout)
                        .foregroundStyle(fg)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(bg)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(border, lineWidth: 1)
        )
    }
}

public enum SigapButtonVariant: Sendable {
    case primary
    case secondary
    case subtle
    case onDevice
    case warning
    case navTab(active: Bool)
}

public struct SigapButtonStyle: ButtonStyle {
    public let variant: SigapButtonVariant
    public let fullWidth: Bool
    public let minHeight: CGFloat

    public init(
        _ variant: SigapButtonVariant,
        fullWidth: Bool = false,
        minHeight: CGFloat = 44
    ) {
        self.variant = variant
        self.fullWidth = fullWidth
        self.minHeight = minHeight
    }

    public func makeBody(configuration: Configuration) -> some View {
        SigapButtonBody(
            configuration: configuration,
            variant: variant,
            fullWidth: fullWidth,
            minHeight: minHeight
        )
    }
}

private struct SigapButtonBody: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isHovered: Bool = false

    let configuration: ButtonStyle.Configuration
    let variant: SigapButtonVariant
    let fullWidth: Bool
    let minHeight: CGFloat

    private var colors: (fg: Color, bg: Color, border: Color) {
        let pressed = configuration.isPressed && isEnabled
        let hovered = isHovered && isEnabled

        switch variant {
        case .primary:
            let bg = pressed
                ? SigapTheme.accentVermilionActive
                : (hovered ? SigapTheme.accentVermilionHover : SigapTheme.accentVermilion)
            return (Color.white, bg, bg)

        case .secondary:
            let bg = pressed
                ? SigapTheme.activeSurface(scheme)
                : (hovered ? SigapTheme.hoverSurface(scheme) : SigapTheme.surface(scheme))
            let border = hovered ? SigapTheme.inkPrimary(scheme) : SigapTheme.borderStrong(scheme)
            return (SigapTheme.inkPrimary(scheme), bg, border)

        case .subtle:
            let bg = pressed
                ? SigapTheme.activeSurface(scheme)
                : (hovered ? SigapTheme.hoverSurface(scheme) : SigapTheme.subtle(scheme))
            let border = hovered ? SigapTheme.borderStrong(scheme) : SigapTheme.borderSubtle(scheme)
            return (SigapTheme.inkPrimary(scheme), bg, border)

        case .onDevice:
            let base = SigapTheme.onDeviceColors(scheme)
            let bg = pressed || hovered ? SigapTheme.onDeviceHover(scheme) : base.bg
            let border = hovered ? base.fg : SigapTheme.onDeviceBorder(scheme)
            return (base.fg, bg, border)

        case .warning:
            let base = SigapTheme.warningColors(scheme)
            let bg = pressed || hovered ? SigapTheme.warningHover(scheme) : base.bg
            let border = hovered ? base.fg : SigapTheme.warningBorder(scheme)
            return (base.fg, bg, border)

        case .navTab(let active):
            let bg = active
                ? SigapTheme.subtle(scheme)
                : (pressed ? SigapTheme.activeSurface(scheme) : (hovered ? SigapTheme.hoverSurface(scheme) : Color.clear))
            let fg = active || hovered ? SigapTheme.inkPrimary(scheme) : SigapTheme.inkMuted(scheme)
            return (fg, bg, Color.clear)
        }
    }

    var body: some View {
        let palette = colors
        let isNavActive: Bool = {
            if case .navTab(let active) = variant { return active }
            return false
        }()

        configuration.label
            .padding(.horizontal, 12)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: minHeight)
            .background(palette.bg)
            .foregroundStyle(palette.fg)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(
                Group {
                    if case .navTab = variant {
                        VStack {
                            Spacer()
                            Rectangle()
                                .fill(isNavActive ? SigapTheme.accentVermilion : Color.clear)
                                .frame(height: 2)
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    } else {
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(palette.border, lineWidth: 1)
                    }
                }
            )
            .opacity(isEnabled ? 1.0 : 0.55)
            .scaleEffect(configuration.isPressed && isEnabled && !reduceMotion ? 0.99 : 1.0)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: configuration.isPressed)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: isHovered)
            #if os(macOS)
            .onHover { hovering in
                isHovered = hovering
            }
            #endif
    }
}

public struct SigapCardModifier: ViewModifier {
    @Environment(\.colorScheme) private var scheme
    let padding: CGFloat

    public func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SigapTheme.surface(scheme))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(SigapTheme.borderSubtle(scheme), lineWidth: 1)
            )
    }
}

public struct SigapSubtlePanelModifier: ViewModifier {
    @Environment(\.colorScheme) private var scheme
    let padding: CGFloat

    public func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SigapTheme.subtle(scheme))
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(SigapTheme.borderSubtle(scheme), lineWidth: 1)
            )
    }
}

public extension View {
    func sigapCard(padding: CGFloat = 16) -> some View {
        modifier(SigapCardModifier(padding: padding))
    }

    func sigapSubtlePanel(padding: CGFloat = 12) -> some View {
        modifier(SigapSubtlePanelModifier(padding: padding))
    }
}

public struct SigapSkeletonCard: View {
    @Environment(\.colorScheme) private var scheme
    public let accessibilityText: String

    public init(accessibilityText: String) {
        self.accessibilityText = accessibilityText
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                RoundedRectangle(cornerRadius: 4)
                    .fill(SigapTheme.subtle(scheme))
                    .frame(width: 90, height: 18)
                RoundedRectangle(cornerRadius: 4)
                    .fill(SigapTheme.subtle(scheme))
                    .frame(width: 64, height: 18)
                Spacer()
            }
            RoundedRectangle(cornerRadius: 4)
                .fill(SigapTheme.subtle(scheme))
                .frame(height: 22)
            RoundedRectangle(cornerRadius: 4)
                .fill(SigapTheme.subtle(scheme))
                .frame(height: 14)
            RoundedRectangle(cornerRadius: 4)
                .fill(SigapTheme.subtle(scheme))
                .frame(maxWidth: 260, minHeight: 14, maxHeight: 14)
        }
        .sigapCard()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
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

    public static func hoverSurface(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0x2B3038) : Color(hex: 0xE8E4DC)
    }

    public static func activeSurface(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0x343B45) : Color(hex: 0xDDD8CE)
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
    public static let accentVermilionHover = Color(hex: 0xA82813)
    public static let accentVermilionActive = Color(hex: 0x8F210F)

    public static func accentText(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0xFCA5A5) : Color(hex: 0xB92B14)
    }

    // Functional state tokens (text + fill)
    public static func onDeviceColors(_ scheme: ColorScheme) -> (fg: Color, bg: Color) {
        scheme == .dark
            ? (Color(hex: 0x6EE7B7), Color(hex: 0x064E3B))
            : (Color(hex: 0x0D6B53), Color(hex: 0xECFDF5))
    }

    public static func onDeviceHover(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0x065F46) : Color(hex: 0xD1FAE5)
    }

    public static func onDeviceBorder(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0x047857) : Color(hex: 0xA7F3D0)
    }

    public static func inCloudColors(_ scheme: ColorScheme) -> (fg: Color, bg: Color) {
        scheme == .dark
            ? (Color(hex: 0x93C5FD), Color(hex: 0x1E3A8A))
            : (Color(hex: 0x1D4ED8), Color(hex: 0xEFF6FF))
    }

    public static func inCloudBorder(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0x2563EB) : Color(hex: 0xBFDBFE)
    }

    public static func warningColors(_ scheme: ColorScheme) -> (fg: Color, bg: Color) {
        scheme == .dark
            ? (Color(hex: 0xFDE68A), Color(hex: 0x78350F))
            : (Color(hex: 0x92400E), Color(hex: 0xFEF3C7))
    }

    public static func warningHover(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0x92400E) : Color(hex: 0xFDE68A)
    }

    public static func warningBorder(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0xB45309) : Color(hex: 0xFCD34D)
    }

    public static func criticalColors(_ scheme: ColorScheme) -> (fg: Color, bg: Color) {
        scheme == .dark
            ? (Color(hex: 0xFCA5A5), Color(hex: 0x450A0A))
            : (Color(hex: 0x991B1B), Color(hex: 0xFEE2E2))
    }

    public static func criticalBorder(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0x991B1B) : Color(hex: 0xFCA5A5)
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
