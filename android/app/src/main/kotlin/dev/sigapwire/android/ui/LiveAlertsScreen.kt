package dev.sigapwire.android.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.sigapwire.android.data.DispatchCard
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private enum class AlertChannel {
    COMMUNITY,
    MEDIA,
    GLOBAL,
    DEBUNK
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LiveAlertsScreen(
    state: SigapUiState,
    onGoToCapture: () -> Unit
) {
    val p = LocalSigapPalette.current
    val context = LocalContext.current
    val selectedChannels = remember { mutableStateMapOf<String, AlertChannel>() }
    var copiedDispatchId by remember { mutableStateOf<String?>(null) }

    when {
        !state.isFirebaseConfigured -> {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp),
                contentAlignment = Alignment.TopCenter
            ) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = p.surface,
                    border = BorderStroke(1.dp, p.borderSubtle)
                ) {
                    Column(
                        modifier = Modifier.padding(18.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            text = "Firebase Not Configured Yet",
                            color = p.inkPrimary,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "Place your google-services.json in android/app/ to stream live dispatches published from the SigapWire Web Broadcast Studio.",
                            color = p.inkMuted,
                            fontSize = 13.sp,
                            lineHeight = 19.sp
                        )
                    }
                }
            }
        }

        state.dispatchesLoading -> {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp),
                contentAlignment = Alignment.TopCenter
            ) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = p.surface,
                    border = BorderStroke(1.dp, p.borderSubtle)
                ) {
                    Text(
                        text = "Loading verified crisis dispatches from Firestore...",
                        color = p.inkMuted,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(18.dp)
                    )
                }
            }
        }

        state.dispatchesError != null && state.dispatches.isEmpty() -> {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp),
                contentAlignment = Alignment.TopCenter
            ) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = p.criticalBg,
                    border = BorderStroke(1.dp, p.criticalBorder)
                ) {
                    Text(
                        text = state.dispatchesError,
                        color = p.criticalInk,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(16.dp)
                    )
                }
            }
        }

        state.dispatches.isEmpty() -> {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp),
                contentAlignment = Alignment.TopCenter
            ) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = p.surface,
                    border = BorderStroke(1.dp, p.borderSubtle)
                ) {
                    Column(
                        modifier = Modifier.padding(18.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Text(
                            text = "No Published Dispatches Yet",
                            color = p.inkPrimary,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "Capture a field report or rumor on this phone, then synthesize and publish it in the Web Broadcast Studio to watch the verified alert sync here in real time.",
                            color = p.inkMuted,
                            fontSize = 13.sp,
                            lineHeight = 19.sp
                        )
                        Button(
                            onClick = onGoToCapture,
                            modifier = Modifier.heightIn(min = 44.dp),
                            shape = RoundedCornerShape(6.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = p.accentVermilion,
                                contentColor = Color.White
                            )
                        ) {
                            Text("Go to Field Capture", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }

        else -> {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        StatusTag(
                            label = "SYNTHETIC DRILL FEED",
                            bgColor = p.warnBg,
                            inkColor = p.warnInk,
                            borderColor = p.warnBorder
                        )
                        Text(
                            text = if (state.isOnline) "LIVE SYNC" else "OFFLINE CACHED",
                            color = p.inkMuted,
                            fontSize = 11.sp,
                            fontFamily = FontFamily.Monospace
                        )
                    }
                }

                items(state.dispatches, key = { it.id }) { dispatch ->
                    val activeChannel = selectedChannels[dispatch.id] ?: AlertChannel.COMMUNITY
                    DispatchCardView(
                        dispatch = dispatch,
                        activeChannel = activeChannel,
                        copied = copiedDispatchId == dispatch.id,
                        onSelectChannel = { selectedChannels[dispatch.id] = it },
                        onCopyWhatsApp = {
                            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                            clipboard.setPrimaryClip(
                                ClipData.newPlainText("SigapWire Alert", dispatch.whatsappShortText)
                            )
                            copiedDispatchId = dispatch.id
                        },
                        onOpenSource = { uri ->
                            try {
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(uri)))
                            } catch (_: Throwable) {
                            }
                        }
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DispatchCardView(
    dispatch: DispatchCard,
    activeChannel: AlertChannel,
    copied: Boolean,
    onSelectChannel: (AlertChannel) -> Unit,
    onCopyWhatsApp: () -> Unit,
    onOpenSource: (String) -> Unit
) {
    val p = LocalSigapPalette.current
    val dateFormatter = remember { SimpleDateFormat("dd MMM HH:mm", Locale.getDefault()) }

    Surface(
        shape = RoundedCornerShape(8.dp),
        color = p.surface,
        border = BorderStroke(1.dp, p.borderSubtle)
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "DISPATCH #${dispatch.dispatchNumber}",
                        color = p.inkPrimary,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Monospace
                    )
                    SeverityTag(dispatch.severity)
                    InferenceSourceBadge(dispatch.inferenceSource)
                }
                Text(
                    text = dateFormatter.format(Date(dispatch.publishedAtMillis)),
                    color = p.inkMuted,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace
                )
            }

            val channels = buildList {
                add(AlertChannel.COMMUNITY to "Warga (ID)")
                add(AlertChannel.MEDIA to "Pers (ID)")
                add(AlertChannel.GLOBAL to "Global (EN)")
                if (dispatch.hasRumorAlert) add(AlertChannel.DEBUNK to "Debunk")
            }

            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                channels.forEach { (channel, label) ->
                    val active = activeChannel == channel
                    OutlinedButton(
                        onClick = { onSelectChannel(channel) },
                        modifier = Modifier.heightIn(min = 44.dp),
                        shape = RoundedCornerShape(6.dp),
                        border = BorderStroke(1.dp, if (active) p.borderStrong else p.borderSubtle),
                        colors = ButtonDefaults.outlinedButtonColors(
                            containerColor = if (active) p.subtle else Color.Transparent,
                            contentColor = p.inkPrimary
                        )
                    ) {
                        Text(
                            text = label,
                            fontSize = 12.sp,
                            fontWeight = if (active) FontWeight.Bold else FontWeight.Medium
                        )
                    }
                }
            }

            when (activeChannel) {
                AlertChannel.COMMUNITY -> {
                    Text(
                        text = dispatch.communityTitle,
                        color = p.inkPrimary,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = dispatch.communityWhatHappened,
                        color = p.inkPrimary,
                        fontSize = 13.sp,
                        lineHeight = 19.sp
                    )
                    if (dispatch.communityDoNow.isNotEmpty()) {
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = p.onDeviceBg,
                            border = BorderStroke(1.dp, p.onDeviceBorder)
                        ) {
                            Column(modifier = Modifier.padding(10.dp)) {
                                Text(
                                    text = "LAKUKAN SEKARANG",
                                    color = p.onDeviceInk,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    fontFamily = FontFamily.Monospace
                                )
                                dispatch.communityDoNow.forEach { line ->
                                    Text("• $line", color = p.onDeviceInk, fontSize = 12.sp)
                                }
                            }
                        }
                    }
                    if (dispatch.communityAvoid.isNotEmpty()) {
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = p.criticalBg,
                            border = BorderStroke(1.dp, p.criticalBorder)
                        ) {
                            Column(modifier = Modifier.padding(10.dp)) {
                                Text(
                                    text = "HINDARI",
                                    color = p.criticalInk,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    fontFamily = FontFamily.Monospace
                                )
                                dispatch.communityAvoid.forEach { line ->
                                    Text("• $line", color = p.criticalInk, fontSize = 12.sp)
                                }
                            }
                        }
                    }
                    OutlinedButton(
                        onClick = onCopyWhatsApp,
                        modifier = Modifier.heightIn(min = 44.dp),
                        border = BorderStroke(1.dp, p.borderStrong)
                    ) {
                        Text(
                            text = if (copied) "WhatsApp Alert Copied" else "Copy Short WhatsApp Alert",
                            color = p.inkPrimary,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }

                AlertChannel.MEDIA -> {
                    Text(
                        text = dispatch.mediaDateline,
                        color = p.inkMuted,
                        fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace
                    )
                    Text(
                        text = dispatch.mediaHeadline,
                        color = p.inkPrimary,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = dispatch.mediaBody,
                        color = p.inkPrimary,
                        fontSize = 13.sp,
                        lineHeight = 19.sp
                    )
                }

                AlertChannel.GLOBAL -> {
                    Text(
                        text = dispatch.globalHeadline,
                        color = p.inkPrimary,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = dispatch.globalExecutiveSummary,
                        color = p.inkPrimary,
                        fontSize = 13.sp,
                        lineHeight = 19.sp
                    )
                    if (dispatch.globalPriorityNeeds.isNotEmpty()) {
                        Text(
                            text = "Priority Needs",
                            color = p.inkPrimary,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold
                        )
                        dispatch.globalPriorityNeeds.forEach { need ->
                            Text("• $need", color = p.inkPrimary, fontSize = 12.sp)
                        }
                    }
                    if (dispatch.globalInformationGaps.isNotEmpty()) {
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = "Information Gaps",
                            color = p.inkMuted,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold
                        )
                        dispatch.globalInformationGaps.forEach { gap ->
                            Text("• $gap", color = p.inkMuted, fontSize = 12.sp)
                        }
                    }
                }

                AlertChannel.DEBUNK -> {
                    VerdictTag(dispatch.debunkVerdict)
                    Text(
                        text = "Claim: ${dispatch.debunkClaim}",
                        color = p.inkPrimary,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(text = dispatch.debunkFactId, color = p.inkPrimary, fontSize = 13.sp)
                    Text(text = dispatch.debunkFactEn, color = p.inkMuted, fontSize = 12.sp)
                    if (dispatch.debunkSources.isNotEmpty()) {
                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            dispatch.debunkSources.forEach { src ->
                                OutlinedButton(
                                    onClick = { onOpenSource(src.uri) },
                                    modifier = Modifier.heightIn(min = 44.dp),
                                    border = BorderStroke(1.dp, p.borderStrong)
                                ) {
                                    Text(src.title, color = p.inkPrimary, fontSize = 11.sp)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
