package dev.sigapwire.android.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.sigapwire.android.data.InferenceSourceLabel
import dev.sigapwire.android.data.RumorVerdict
import dev.sigapwire.android.data.SeverityLevel

@Immutable
data class SigapPalette(
    val ground: Color,
    val surface: Color,
    val subtle: Color,
    val inkPrimary: Color,
    val inkMuted: Color,
    val borderSubtle: Color,
    val borderStrong: Color,
    val accentVermilion: Color,
    val onDeviceBg: Color,
    val onDeviceInk: Color,
    val onDeviceBorder: Color,
    val cloudBg: Color,
    val cloudInk: Color,
    val cloudBorder: Color,
    val warnBg: Color,
    val warnInk: Color,
    val warnBorder: Color,
    val criticalBg: Color,
    val criticalInk: Color,
    val criticalBorder: Color
)

val LightSigapPalette = SigapPalette(
    ground = Color(0xFFF8F7F4),
    surface = Color(0xFFFFFFFF),
    subtle = Color(0xFFF1EFEA),
    inkPrimary = Color(0xFF14171A),
    inkMuted = Color(0xFF475569),
    borderSubtle = Color(0xFFDDD9D0),
    borderStrong = Color(0xFF64748B),
    accentVermilion = Color(0xFFC83219),
    onDeviceBg = Color(0xFFECFDF5),
    onDeviceInk = Color(0xFF0D6B53),
    onDeviceBorder = Color(0xFFA7F3D0),
    cloudBg = Color(0xFFEFF6FF),
    cloudInk = Color(0xFF1D4ED8),
    cloudBorder = Color(0xFFBFDBFE),
    warnBg = Color(0xFFFEF3C7),
    warnInk = Color(0xFF92400E),
    warnBorder = Color(0xFFFCD34D),
    criticalBg = Color(0xFFFEE2E2),
    criticalInk = Color(0xFF991B1B),
    criticalBorder = Color(0xFFFCA5A5)
)

val DarkSigapPalette = SigapPalette(
    ground = Color(0xFF111315),
    surface = Color(0xFF1A1D21),
    subtle = Color(0xFF22262C),
    inkPrimary = Color(0xFFF3F4F6),
    inkMuted = Color(0xFF9CA3AF),
    borderSubtle = Color(0xFF2D333B),
    borderStrong = Color(0xFF94A3B8),
    accentVermilion = Color(0xFFC83219),
    onDeviceBg = Color(0xFF064E3B),
    onDeviceInk = Color(0xFF6EE7B7),
    onDeviceBorder = Color(0xFF047857),
    cloudBg = Color(0xFF1E3A8A),
    cloudInk = Color(0xFF93C5FD),
    cloudBorder = Color(0xFF1D4ED8),
    warnBg = Color(0xFF78350F),
    warnInk = Color(0xFFFDE68A),
    warnBorder = Color(0xFFB45309),
    criticalBg = Color(0xFF450A0A),
    criticalInk = Color(0xFFFCA5A5),
    criticalBorder = Color(0xFF991B1B)
)

val LocalSigapPalette = staticCompositionLocalOf { LightSigapPalette }

@Composable
fun SigapWireTheme(
    darkTheme: Boolean,
    content: @Composable () -> Unit
) {
    val palette = if (darkTheme) DarkSigapPalette else LightSigapPalette
    val colorScheme = if (darkTheme) {
        darkColorScheme(
            primary = palette.accentVermilion,
            onPrimary = Color.White,
            background = palette.ground,
            onBackground = palette.inkPrimary,
            surface = palette.surface,
            onSurface = palette.inkPrimary,
            surfaceVariant = palette.subtle,
            onSurfaceVariant = palette.inkMuted,
            outline = palette.borderStrong
        )
    } else {
        lightColorScheme(
            primary = palette.accentVermilion,
            onPrimary = Color.White,
            background = palette.ground,
            onBackground = palette.inkPrimary,
            surface = palette.surface,
            onSurface = palette.inkPrimary,
            surfaceVariant = palette.subtle,
            onSurfaceVariant = palette.inkMuted,
            outline = palette.borderStrong
        )
    }

    CompositionLocalProvider(LocalSigapPalette provides palette) {
        MaterialTheme(
            colorScheme = colorScheme,
            content = content
        )
    }
}

@Composable
fun StatusTag(
    label: String,
    bgColor: Color,
    inkColor: Color,
    borderColor: Color,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(4.dp),
        color = bgColor,
        border = BorderStroke(1.dp, borderColor)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center
        ) {
            Text(
                text = label,
                color = inkColor,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                fontFamily = FontFamily.Monospace
            )
        }
    }
}

@Composable
fun InferenceSourceBadge(
    source: InferenceSourceLabel,
    latencyMs: Long? = null
) {
    val p = LocalSigapPalette.current
    val isLocal = source == InferenceSourceLabel.ON_DEVICE
    val text = buildString {
        append(if (isLocal) "ON_DEVICE" else "IN_CLOUD")
        if (latencyMs != null && latencyMs > 0L) append(" ${latencyMs}ms")
    }
    StatusTag(
        label = text,
        bgColor = if (isLocal) p.onDeviceBg else p.cloudBg,
        inkColor = if (isLocal) p.onDeviceInk else p.cloudInk,
        borderColor = if (isLocal) p.onDeviceBorder else p.cloudBorder
    )
}

@Composable
fun SeverityTag(severity: SeverityLevel) {
    val p = LocalSigapPalette.current
    val (bg, ink, border) = when (severity) {
        SeverityLevel.CRITICAL -> Triple(p.criticalBg, p.criticalInk, p.criticalBorder)
        SeverityLevel.HIGH -> Triple(p.warnBg, p.warnInk, p.warnBorder)
        SeverityLevel.MEDIUM -> Triple(p.cloudBg, p.cloudInk, p.cloudBorder)
        SeverityLevel.LOW -> Triple(p.subtle, p.inkMuted, p.borderSubtle)
    }
    StatusTag(label = severity.name, bgColor = bg, inkColor = ink, borderColor = border)
}

@Composable
fun VerdictTag(verdict: RumorVerdict) {
    if (verdict == RumorVerdict.NOT_APPLICABLE) return
    val p = LocalSigapPalette.current
    val (label, bg, ink, border) = when (verdict) {
        RumorVerdict.VERIFIED -> listOf("VERIFIED", p.onDeviceBg, p.onDeviceInk, p.onDeviceBorder)
        RumorVerdict.MISLEADING -> listOf("MISLEADING / HOAX", p.criticalBg, p.criticalInk, p.criticalBorder)
        RumorVerdict.UNVERIFIED_DEVELOPING -> listOf("UNVERIFIED / DEVELOPING", p.warnBg, p.warnInk, p.warnBorder)
        RumorVerdict.NOT_APPLICABLE -> return
    }
    StatusTag(
        label = label as String,
        bgColor = bg as Color,
        inkColor = ink as Color,
        borderColor = border as Color
    )
}
