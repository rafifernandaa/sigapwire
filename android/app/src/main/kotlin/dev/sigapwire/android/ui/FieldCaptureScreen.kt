package dev.sigapwire.android.ui

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.sigapwire.android.data.DeviceNanoStatus
import dev.sigapwire.android.data.HybridAiEngine
import dev.sigapwire.android.data.IntakeMode
import dev.sigapwire.android.data.SyntheticDrillData

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FieldCaptureScreen(
    state: SigapUiState,
    onModeChange: (IntakeMode) -> Unit,
    onRawInputChange: (String) -> Unit,
    onLoadScenario: (String) -> Unit,
    onBitmapSelected: (Bitmap?) -> Unit,
    onForceCloudChange: (Boolean) -> Unit,
    onDownloadNano: () -> Unit,
    onRunPipeline: () -> Unit,
    onVerifySearch: () -> Unit,
    onSaveIntake: () -> Unit,
    onSubmitFieldTaskAnswer: (String, String) -> Unit
) {
    val p = LocalSigapPalette.current
    val context = LocalContext.current
    val scrollState = rememberScrollState()
    var showOpenTasks by remember { mutableStateOf(true) }
    var selectedTaskId by remember { mutableStateOf<String?>(null) }
    var fieldReplyDraft by remember { mutableStateOf("") }

    val cameraLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.TakePicturePreview()
    ) { bitmap ->
        if (bitmap != null) {
            onBitmapSelected(HybridAiEngine.scaleBitmapMaxEdge(bitmap))
        }
    }

    val photoPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.PickVisualMedia()
    ) { uri ->
        if (uri != null) {
            val decoded = decodeUriBitmap(context, uri)
            if (decoded != null) {
                onBitmapSelected(HybridAiEngine.scaleBitmapMaxEdge(decoded))
            }
        }
    }

    val tokenRoute = HybridAiEngine.evaluateTokenRoute(
        text = state.rawInput,
        hasImage = state.selectedBitmap != null
    )
    val filteredScenarios = SyntheticDrillData.scenarios.filter { it.mode == state.mode }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .imePadding()
            .verticalScroll(scrollState)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // Hardware & Hybrid Runtime Card
        Surface(
            shape = RoundedCornerShape(8.dp),
            color = p.surface,
            border = BorderStroke(1.dp, p.borderSubtle)
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "${Build.MANUFACTURER.uppercase()} ${Build.MODEL}",
                        color = p.inkPrimary,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Monospace
                    )
                    StatusTag(
                        label = if (state.isOnline) "ONLINE" else "OFFLINE",
                        bgColor = if (state.isOnline) p.subtle else p.warnBg,
                        inkColor = if (state.isOnline) p.inkMuted else p.warnInk,
                        borderColor = if (state.isOnline) p.borderSubtle else p.warnBorder
                    )
                }

                val (nanoLabel, nanoBg, nanoInk, nanoBorder) = when (state.nanoStatus) {
                    DeviceNanoStatus.AVAILABLE -> listOf(
                        "AICore Gemini Nano: AVAILABLE (On-Device)",
                        p.onDeviceBg, p.onDeviceInk, p.onDeviceBorder
                    )
                    DeviceNanoStatus.DOWNLOADABLE -> listOf(
                        "AICore Gemini Nano: DOWNLOADABLE",
                        p.onDeviceBg, p.onDeviceInk, p.onDeviceBorder
                    )
                    DeviceNanoStatus.DOWNLOADING -> listOf(
                        "Downloading Gemini Nano ${((state.nanoDownloadProgress ?: 0f) * 100).toInt()}%",
                        p.cloudBg, p.cloudInk, p.cloudBorder
                    )
                    DeviceNanoStatus.CHECKING -> listOf(
                        "Checking AICore On-Device Status...",
                        p.subtle, p.inkMuted, p.borderSubtle
                    )
                    DeviceNanoStatus.UNAVAILABLE, DeviceNanoStatus.ERROR -> listOf(
                        "No Local Nano -> Auto Cloud Fallback Active",
                        p.cloudBg, p.cloudInk, p.cloudBorder
                    )
                }

                StatusTag(
                    label = nanoLabel as String,
                    bgColor = nanoBg as Color,
                    inkColor = nanoInk as Color,
                    borderColor = nanoBorder as Color
                )

                Text(
                    text = if (state.nanoStatus == DeviceNanoStatus.AVAILABLE) {
                        "Local PII redaction and short field triage run directly on-device via Firebase AI Logic."
                    } else {
                        "PREFER_ON_DEVICE automatically falls back to Cloud Gemini on this hardware while PII redaction remains strictly local."
                    },
                    color = p.inkMuted,
                    fontSize = 12.sp,
                    lineHeight = 17.sp
                )

                if (state.nanoStatus == DeviceNanoStatus.DOWNLOADABLE) {
                    OutlinedButton(
                        onClick = onDownloadNano,
                        modifier = Modifier.heightIn(min = 44.dp),
                        shape = RoundedCornerShape(6.dp),
                        border = BorderStroke(1.dp, p.onDeviceBorder)
                    ) {
                        Text(
                            text = "Download On-Device Gemini Nano",
                            color = p.onDeviceInk,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }
            }
        }

        // Missing google-services.json setup notice
        if (!state.isFirebaseConfigured) {
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = p.warnBg,
                border = BorderStroke(1.dp, p.warnBorder)
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text(
                        text = "Firebase Config Pending (google-services.json)",
                        color = p.warnInk,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Local PII redaction runs right now. Add Android app dev.sigapwire.android in Firebase Console and drop google-services.json into android/app/ to enable Cloud fallback and Firestore sync.",
                        color = p.warnInk,
                        fontSize = 12.sp,
                        lineHeight = 17.sp
                    )
                }
            }
        }

        if (state.activeAreaKnowledge.isNotEmpty()) {
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = p.onDeviceBg,
                border = BorderStroke(1.dp, p.onDeviceBorder)
            ) {
                FlowRow(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                    itemVerticalAlignment = Alignment.CenterVertically
                ) {
                    StatusTag(
                        label = "Area Knowledge Active (${state.activeAreaKnowledge.size})",
                        bgColor = p.surface,
                        inkColor = p.onDeviceInk,
                        borderColor = p.onDeviceBorder
                    )
                    Text(
                        text = "Verified local ground truth is injected into triage.",
                        color = p.onDeviceInk,
                        fontSize = 11.sp
                    )
                }
            }
        }

        if (state.openVerificationTasks.isNotEmpty()) {
            val activeTask = state.openVerificationTasks.firstOrNull { it.id == selectedTaskId }
                ?: state.openVerificationTasks.first()

            Surface(
                shape = RoundedCornerShape(8.dp),
                color = p.surface,
                border = BorderStroke(1.dp, p.warnBorder)
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
                        StatusTag(
                            label = "Open Field Checks (${state.openVerificationTasks.size})",
                            bgColor = p.warnBg,
                            inkColor = p.warnInk,
                            borderColor = p.warnBorder
                        )
                        OutlinedButton(
                            onClick = { showOpenTasks = !showOpenTasks },
                            modifier = Modifier.heightIn(min = 44.dp),
                            shape = RoundedCornerShape(6.dp),
                            border = BorderStroke(1.dp, p.borderStrong),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                        ) {
                            Text(
                                text = if (showOpenTasks) "Hide" else "Show",
                                color = p.inkPrimary,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                    }

                    if (showOpenTasks) {
                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            state.openVerificationTasks.forEach { task ->
                                val selected = task.id == activeTask.id
                                OutlinedButton(
                                    onClick = { selectedTaskId = task.id },
                                    modifier = Modifier.heightIn(min = 44.dp),
                                    shape = RoundedCornerShape(6.dp),
                                    border = BorderStroke(1.dp, if (selected) p.warnBorder else p.borderStrong),
                                    colors = ButtonDefaults.outlinedButtonColors(
                                        containerColor = if (selected) p.warnBg else p.subtle
                                    )
                                ) {
                                    Text(
                                        text = "${task.location}: ${task.question.take(42)}",
                                        color = if (selected) p.warnInk else p.inkPrimary,
                                        fontSize = 11.sp
                                    )
                                }
                            }
                        }

                        Text(
                            text = activeTask.question,
                            color = p.inkPrimary,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold
                        )

                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(
                                text = "Field Verification Reply",
                                color = p.inkPrimary,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                            OutlinedTextField(
                                value = fieldReplyDraft,
                                onValueChange = { fieldReplyDraft = it },
                                modifier = Modifier.fillMaxWidth(),
                                placeholder = {
                                    Text(
                                        text = "Enter verified observation (PII scrubbed locally)...",
                                        color = p.inkMuted,
                                        fontSize = 13.sp
                                    )
                                },
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedBorderColor = p.accentVermilion,
                                    unfocusedBorderColor = p.borderStrong,
                                    focusedTextColor = p.inkPrimary,
                                    unfocusedTextColor = p.inkPrimary,
                                    focusedContainerColor = p.ground,
                                    unfocusedContainerColor = p.ground
                                )
                            )
                        }

                        Button(
                            onClick = {
                                val textToSend = fieldReplyDraft
                                fieldReplyDraft = ""
                                onSubmitFieldTaskAnswer(activeTask.id, textToSend)
                            },
                            enabled = !state.isSubmittingFieldReply && fieldReplyDraft.isNotBlank(),
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = 44.dp),
                            shape = RoundedCornerShape(6.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = p.onDeviceInk,
                                contentColor = if (state.darkTheme) p.onDeviceBg else Color.White
                            )
                        ) {
                            Text(
                                text = if (state.isSubmittingFieldReply) "Scrubbing & Sending..." else "Scrub PII & Send Answer",
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                    }

                    if (!state.fieldReplyFeedback.isNullOrBlank()) {
                        Text(
                            text = state.fieldReplyFeedback,
                            color = p.onDeviceInk,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
            }
        }

        // Shared Intake Card
        Surface(
            shape = RoundedCornerShape(8.dp),
            color = p.surface,
            border = BorderStroke(1.dp, p.borderSubtle)
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // Mode Toggle
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(6.dp),
                    color = p.subtle,
                    border = BorderStroke(1.dp, p.borderSubtle)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(4.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        listOf(
                            IntakeMode.FIELD_REPORT to "Digest Field Report",
                            IntakeMode.RUMOR_CHECK to "Verify Rumor"
                        ).forEach { (modeItem, title) ->
                            val active = state.mode == modeItem
                            Button(
                                onClick = { onModeChange(modeItem) },
                                modifier = Modifier
                                    .weight(1f)
                                    .heightIn(min = 44.dp),
                                shape = RoundedCornerShape(5.dp),
                                border = if (active) BorderStroke(1.dp, p.borderStrong) else null,
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = if (active) p.surface else Color.Transparent,
                                    contentColor = if (active) p.inkPrimary else p.inkMuted
                                ),
                                elevation = null,
                                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp)
                            ) {
                                Text(
                                    text = title,
                                    fontSize = 13.sp,
                                    fontWeight = if (active) FontWeight.Bold else FontWeight.Medium
                                )
                            }
                        }
                    }
                }

                // Synthetic Drill Chips
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        text = "Load Synthetic Drill Sample",
                        color = p.inkMuted,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        filteredScenarios.forEach { scenario ->
                            OutlinedButton(
                                onClick = { onLoadScenario(scenario.rawInput) },
                                modifier = Modifier.heightIn(min = 44.dp),
                                shape = RoundedCornerShape(6.dp),
                                border = BorderStroke(1.dp, p.borderStrong),
                                colors = ButtonDefaults.outlinedButtonColors(
                                    containerColor = p.subtle,
                                    contentColor = p.inkPrimary
                                )
                            ) {
                                Text(
                                    text = scenario.label,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold
                                )
                            }
                        }
                    }
                }

                // Raw Input TextArea
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        text = if (state.mode == IntakeMode.FIELD_REPORT) {
                            "Raw Field Note (Bahasa Indonesia / English)"
                        } else {
                            "Forwarded Rumor or Suspicious Chat"
                        },
                        color = p.inkPrimary,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    OutlinedTextField(
                        value = state.rawInput,
                        onValueChange = onRawInputChange,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 130.dp, max = 260.dp),
                        maxLines = 10,
                        placeholder = {
                            Text(
                                text = "Paste messy responder notes or WhatsApp forwards...",
                                color = p.inkMuted,
                                fontSize = 13.sp
                            )
                        },
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = p.accentVermilion,
                            unfocusedBorderColor = p.borderStrong,
                            focusedTextColor = p.inkPrimary,
                            unfocusedTextColor = p.inkPrimary,
                            focusedContainerColor = p.ground,
                            unfocusedContainerColor = p.ground
                        )
                    )

                    // Live Token-Budget Router Bar
                    val progress = (tokenRoute.estimatedTokens.toFloat() /
                        tokenRoute.safeLocalLimit.toFloat()).coerceIn(0f, 1f)
                    val routeLabel = when {
                        state.forceCloudFallback -> "Forced Cloud"
                        tokenRoute.exceedsLocalBudget -> "Auto-Escalate to Cloud"
                        state.nanoStatus == DeviceNanoStatus.AVAILABLE -> "On-Device Nano"
                        else -> "PREFER_ON_DEVICE (Cloud Fallback)"
                    }
                    Surface(
                        shape = RoundedCornerShape(6.dp),
                        color = p.subtle,
                        border = BorderStroke(1.dp, p.borderSubtle)
                    ) {
                        Column(
                            modifier = Modifier.padding(10.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            FlowRow(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                Text(
                                    text = "~${tokenRoute.estimatedTokens} est. tokens / ${tokenRoute.safeLocalLimit} budget",
                                    color = p.inkMuted,
                                    fontSize = 11.sp,
                                    fontFamily = FontFamily.Monospace
                                )
                                Text(
                                    text = routeLabel,
                                    color = if (tokenRoute.exceedsLocalBudget || state.forceCloudFallback) p.cloudInk else p.onDeviceInk,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    fontFamily = FontFamily.Monospace
                                )
                            }
                            LinearProgressIndicator(
                                progress = { progress },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(5.dp)
                                    .clip(RoundedCornerShape(4.dp)),
                                color = if (tokenRoute.exceedsLocalBudget || state.forceCloudFallback) p.cloudInk else p.onDeviceInk,
                                trackColor = p.ground,
                                gapSize = 0.dp,
                                drawStopIndicator = {}
                            )
                        }
                    }
                }

                // Camera & Gallery Attachment Controls
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(
                        onClick = { cameraLauncher.launch(null) },
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 44.dp),
                        shape = RoundedCornerShape(6.dp),
                        border = BorderStroke(1.dp, p.borderStrong)
                    ) {
                        Text(
                            text = "Snap Photo",
                            color = p.inkPrimary,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                    OutlinedButton(
                        onClick = {
                            photoPickerLauncher.launch(
                                PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                            )
                        },
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 44.dp),
                        shape = RoundedCornerShape(6.dp),
                        border = BorderStroke(1.dp, p.borderStrong)
                    ) {
                        Text(
                            text = "Pick Image",
                            color = p.inkPrimary,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }

                state.selectedBitmap?.let { bmp ->
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Image(
                            bitmap = bmp.asImageBitmap(),
                            contentDescription = "Selected disaster field photo or rumor screenshot",
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(160.dp)
                                .clip(RoundedCornerShape(6.dp)),
                            contentScale = ContentScale.Crop
                        )
                        OutlinedButton(
                            onClick = { onBitmapSelected(null) },
                            modifier = Modifier.heightIn(min = 44.dp),
                            shape = RoundedCornerShape(6.dp),
                            border = BorderStroke(1.dp, p.borderStrong)
                        ) {
                            Text("Remove Image", color = p.inkPrimary, fontSize = 12.sp)
                        }
                    }
                }

                // Force Cloud Toggle
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(p.subtle)
                        .toggleable(
                            value = state.forceCloudFallback,
                            onValueChange = onForceCloudChange,
                            role = Role.Checkbox
                        )
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Checkbox(
                        checked = state.forceCloudFallback,
                        onCheckedChange = null
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    Text(
                        text = "Force ONLY_IN_CLOUD comparison (local PII scrub still runs first)",
                        color = p.inkPrimary,
                        fontSize = 12.sp
                    )
                }

                // Primary CTA
                Button(
                    onClick = onRunPipeline,
                    enabled = !state.isRunningPipeline,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp),
                    shape = RoundedCornerShape(6.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = p.accentVermilion,
                        contentColor = Color.White
                    )
                ) {
                    Text(
                        text = when {
                            state.isRunningPipeline -> "Running Hybrid AI Pipeline..."
                            state.mode == IntakeMode.FIELD_REPORT -> "Redact Locally & Digest Report"
                            else -> "Redact Locally & Triage Rumor"
                        },
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }

                state.pipelineStepMessage?.let { step ->
                    Surface(
                        shape = RoundedCornerShape(6.dp),
                        color = p.cloudBg,
                        border = BorderStroke(1.dp, p.cloudBorder)
                    ) {
                        Text(
                            text = step,
                            color = p.cloudInk,
                            fontSize = 12.sp,
                            modifier = Modifier.padding(10.dp)
                        )
                    }
                }

                state.setupNotice?.let { notice ->
                    Surface(
                        shape = RoundedCornerShape(6.dp),
                        color = p.warnBg,
                        border = BorderStroke(1.dp, p.warnBorder)
                    ) {
                        Text(
                            text = notice,
                            color = p.warnInk,
                            fontSize = 12.sp,
                            lineHeight = 17.sp,
                            modifier = Modifier.padding(10.dp)
                        )
                    }
                }

                state.errorMessage?.let { err ->
                    Surface(
                        shape = RoundedCornerShape(6.dp),
                        color = p.criticalBg,
                        border = BorderStroke(1.dp, p.criticalBorder)
                    ) {
                        Text(
                            text = err,
                            color = p.criticalInk,
                            fontSize = 12.sp,
                            modifier = Modifier.padding(10.dp)
                        )
                    }
                }
            }
        }

        // STAGE 1 OUTPUT: Local Privacy Diff
        state.privacyResult?.let { privacy ->
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
                        Text(
                            text = "Stage 1: Local Privacy Diff",
                            color = p.inkPrimary,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold
                        )
                        InferenceSourceBadge(
                            source = privacy.inferenceSource,
                            latencyMs = privacy.latencyMs
                        )
                    }

                    Text(
                        text = "${privacy.redactions.size} personal identifier(s) scrubbed locally before cloud/sync.",
                        color = p.inkMuted,
                        fontSize = 12.sp
                    )

                    Surface(
                        shape = RoundedCornerShape(6.dp),
                        color = p.ground,
                        border = BorderStroke(1.dp, p.onDeviceBorder)
                    ) {
                        Column(modifier = Modifier.padding(10.dp)) {
                            Text(
                                text = "SAFE SANITIZED PAYLOAD",
                                color = p.onDeviceInk,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = privacy.sanitizedText,
                                color = p.inkPrimary,
                                fontSize = 12.sp,
                                lineHeight = 18.sp
                            )
                        }
                    }
                }
            }
        }

        // STAGE 2 & 3 OUTPUT: Structured Situation / Rumor Card
        state.triageResult?.let { triage ->
            val s = triage.structured
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = p.surface,
                border = BorderStroke(1.dp, p.borderSubtle)
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        SeverityTag(s.severity)
                        StatusTag(s.hazardType.name, p.subtle, p.inkPrimary, p.borderSubtle)
                        VerdictTag(s.rumorVerdict)
                        InferenceSourceBadge(triage.inferenceSource, triage.latencyMs)
                    }

                    Text(
                        text = "${triage.routingReason} (~${triage.estimatedInputTokens} est. tokens)",
                        color = p.inkMuted,
                        fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace
                    )

                    Text(
                        text = s.headline,
                        color = p.inkPrimary,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Serif
                    )
                    Text(
                        text = "Location: ${s.location}",
                        color = p.inkMuted,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium
                    )

                    Surface(
                        shape = RoundedCornerShape(6.dp),
                        color = p.ground,
                        border = BorderStroke(1.dp, p.borderSubtle)
                    ) {
                        Column(
                            modifier = Modifier.padding(10.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Text(
                                text = "RINGKASAN (ID)",
                                color = p.inkMuted,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace
                            )
                            Text(text = s.summaryId, color = p.inkPrimary, fontSize = 13.sp)
                            Text(
                                text = "SUMMARY (EN)",
                                color = p.inkMuted,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace
                            )
                            Text(text = s.summaryEn, color = p.inkPrimary, fontSize = 13.sp)
                        }
                    }

                    if (s.keyFacts.isNotEmpty()) {
                        BulletSection(
                            title = if (state.mode == IntakeMode.FIELD_REPORT) "Observed Facts" else "Extracted Claims",
                            items = s.keyFacts
                        )
                    }
                    if (s.urgentNeeds.isNotEmpty()) {
                        BulletSection(
                            title = if (state.mode == IntakeMode.FIELD_REPORT) "Urgent Needs" else "Required Checks",
                            items = s.urgentNeeds
                        )
                    }
                    if (s.verificationGaps.isNotEmpty()) {
                        BulletSection(title = "Verification Gaps", items = s.verificationGaps)
                    }

                    // Stage 3: Google Search Grounding for Rumor Checks
                    if (state.mode == IntakeMode.RUMOR_CHECK) {
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = p.subtle,
                            border = BorderStroke(1.dp, p.borderSubtle)
                        ) {
                            Column(
                                modifier = Modifier.padding(12.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Text(
                                    text = "Stage 3: Google Search Grounding (Cloud)",
                                    color = p.inkPrimary,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                OutlinedButton(
                                    onClick = onVerifySearch,
                                    enabled = !state.isVerifyingSearch && state.isOnline,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .heightIn(min = 44.dp),
                                    shape = RoundedCornerShape(6.dp),
                                    border = BorderStroke(1.dp, p.cloudBorder),
                                    colors = ButtonDefaults.outlinedButtonColors(
                                        containerColor = p.cloudBg,
                                        contentColor = p.cloudInk
                                    )
                                ) {
                                    Text(
                                        text = if (state.isVerifyingSearch) {
                                            "Searching live sources..."
                                        } else {
                                            "Verify Scrubbed Claim with Google Search"
                                        },
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                }

                                if (!state.isOnline && state.searchErrorMessage.isNullOrBlank()) {
                                    Surface(
                                        shape = RoundedCornerShape(6.dp),
                                        color = p.warnBg,
                                        border = BorderStroke(1.dp, p.warnBorder)
                                    ) {
                                        Text(
                                            text = "Device is offline. Google Search Grounding requires connectivity; your local triage card is preserved.",
                                            color = p.warnInk,
                                            fontSize = 12.sp,
                                            lineHeight = 17.sp,
                                            modifier = Modifier.padding(10.dp)
                                        )
                                    }
                                }

                                state.searchErrorMessage?.let { searchErr ->
                                    Surface(
                                        shape = RoundedCornerShape(6.dp),
                                        color = p.criticalBg,
                                        border = BorderStroke(1.dp, p.criticalBorder)
                                    ) {
                                        Text(
                                            text = searchErr,
                                            color = p.criticalInk,
                                            fontSize = 12.sp,
                                            lineHeight = 17.sp,
                                            modifier = Modifier.padding(10.dp)
                                        )
                                    }
                                }

                                state.groundedResult?.let { grounded ->
                                    FlowRow(
                                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                                        verticalArrangement = Arrangement.spacedBy(6.dp)
                                    ) {
                                        VerdictTag(grounded.verdict)
                                        InferenceSourceBadge(
                                            dev.sigapwire.android.data.InferenceSourceLabel.IN_CLOUD,
                                            grounded.latencyMs
                                        )
                                    }

                                    if (grounded.sources.isNotEmpty()) {
                                        Text(
                                            text = "GROUNDING SOURCES (${grounded.sources.size})",
                                            color = p.inkMuted,
                                            fontSize = 11.sp,
                                            fontFamily = FontFamily.Monospace,
                                            fontWeight = FontWeight.Bold
                                        )
                                        FlowRow(
                                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                                            verticalArrangement = Arrangement.spacedBy(6.dp)
                                        ) {
                                            grounded.sources.forEach { src ->
                                                OutlinedButton(
                                                    onClick = {
                                                        try {
                                                            context.startActivity(
                                                                Intent(Intent.ACTION_VIEW, Uri.parse(src.uri))
                                                            )
                                                        } catch (_: Throwable) {
                                                        }
                                                    },
                                                    modifier = Modifier.heightIn(min = 44.dp),
                                                    shape = RoundedCornerShape(6.dp),
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

                    Button(
                        onClick = onSaveIntake,
                        enabled = !state.isSavingIntake,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp),
                        shape = RoundedCornerShape(6.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = p.accentVermilion,
                            contentColor = Color.White
                        )
                    ) {
                        Text(
                            text = if (state.isSavingIntake) {
                                "Saving to Queue..."
                            } else {
                                "Save Sanitized Intake to Queue"
                            },
                            fontSize = 14.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }

                    state.saveFeedback?.let { feedback ->
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = p.onDeviceBg,
                            border = BorderStroke(1.dp, p.onDeviceBorder)
                        ) {
                            Text(
                                text = feedback,
                                color = p.onDeviceInk,
                                fontSize = 12.sp,
                                modifier = Modifier.padding(10.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun BulletSection(title: String, items: List<String>) {
    val p = LocalSigapPalette.current
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(
            text = title,
            color = p.inkPrimary,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold
        )
        items.forEach { item ->
            Text(
                text = "• $item",
                color = p.inkPrimary,
                fontSize = 12.sp,
                lineHeight = 17.sp
            )
        }
    }
}

private fun decodeUriBitmap(context: android.content.Context, uri: Uri): Bitmap? {
    return try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val source = ImageDecoder.createSource(context.contentResolver, uri)
            ImageDecoder.decodeBitmap(source) { decoder, _, _ ->
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            }
        } else {
            context.contentResolver.openInputStream(uri)?.use { stream ->
                BitmapFactory.decodeStream(stream)
            }
        }
    } catch (_: Throwable) {
        null
    }
}
