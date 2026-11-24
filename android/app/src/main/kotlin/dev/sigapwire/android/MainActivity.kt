package dev.sigapwire.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.sigapwire.android.ui.AndroidTab
import dev.sigapwire.android.ui.FieldCaptureScreen
import dev.sigapwire.android.ui.LiveAlertsScreen
import dev.sigapwire.android.ui.LocalSigapPalette
import dev.sigapwire.android.ui.MainViewModel
import dev.sigapwire.android.ui.SigapWireTheme

class MainActivity : ComponentActivity() {
    @OptIn(ExperimentalMaterial3Api::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val vm: MainViewModel = viewModel()
            val state by vm.uiState.collectAsStateWithLifecycle()

            SigapWireTheme(darkTheme = state.darkTheme) {
                val p = LocalSigapPalette.current
                Scaffold(
                    modifier = Modifier.fillMaxSize(),
                    containerColor = p.ground,
                    topBar = {
                        Column {
                            TopAppBar(
                                colors = TopAppBarDefaults.topAppBarColors(
                                    containerColor = p.surface,
                                    titleContentColor = p.inkPrimary
                                ),
                                title = {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                                    ) {
                                        Box(
                                            modifier = Modifier
                                                .size(11.dp)
                                                .background(
                                                    p.accentVermilion,
                                                    RoundedCornerShape(2.dp)
                                                )
                                        )
                                        Column {
                                            Text(
                                                text = "SigapWire",
                                                fontSize = 18.sp,
                                                fontWeight = FontWeight.Bold,
                                                fontFamily = FontFamily.Serif
                                            )
                                            Text(
                                                text = "Android Field Companion",
                                                fontSize = 11.sp,
                                                color = p.inkMuted
                                            )
                                        }
                                    }
                                },
                                actions = {
                                    OutlinedButton(
                                        onClick = vm::toggleTheme,
                                        modifier = Modifier
                                            .padding(end = 10.dp)
                                            .heightIn(min = 44.dp),
                                        shape = RoundedCornerShape(6.dp),
                                        border = BorderStroke(1.dp, p.borderStrong)
                                    ) {
                                        Text(
                                            text = if (state.darkTheme) "Light" else "Dark",
                                            color = p.inkPrimary,
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.SemiBold
                                        )
                                    }
                                }
                            )
                            HorizontalDivider(color = p.borderSubtle, thickness = 1.dp)
                        }
                    },
                    bottomBar = {
                        Column {
                            HorizontalDivider(color = p.borderSubtle, thickness = 1.dp)
                            NavigationBar(containerColor = p.surface) {
                                NavigationBarItem(
                                    selected = state.activeTab == AndroidTab.FIELD_CAPTURE,
                                    onClick = { vm.selectTab(AndroidTab.FIELD_CAPTURE) },
                                    icon = {
                                        Surface(
                                            shape = RoundedCornerShape(4.dp),
                                            color = if (state.activeTab == AndroidTab.FIELD_CAPTURE) {
                                                p.accentVermilion
                                            } else {
                                                p.subtle
                                            }
                                        ) {
                                            Text(
                                                text = "IN",
                                                color = if (state.activeTab == AndroidTab.FIELD_CAPTURE) {
                                                    androidx.compose.ui.graphics.Color.White
                                                } else {
                                                    p.inkMuted
                                                },
                                                fontSize = 11.sp,
                                                fontWeight = FontWeight.Bold,
                                                fontFamily = FontFamily.Monospace,
                                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                            )
                                        }
                                    },
                                    label = {
                                        Text(
                                            text = "Field Capture",
                                            fontWeight = FontWeight.SemiBold
                                        )
                                    },
                                    colors = NavigationBarItemDefaults.colors(
                                        selectedTextColor = p.inkPrimary,
                                        unselectedTextColor = p.inkMuted,
                                        indicatorColor = p.subtle
                                    )
                                )
                                NavigationBarItem(
                                    selected = state.activeTab == AndroidTab.LIVE_ALERTS,
                                    onClick = { vm.selectTab(AndroidTab.LIVE_ALERTS) },
                                    icon = {
                                        Surface(
                                            shape = RoundedCornerShape(4.dp),
                                            color = if (state.activeTab == AndroidTab.LIVE_ALERTS) {
                                                p.accentVermilion
                                            } else {
                                                p.subtle
                                            }
                                        ) {
                                            Text(
                                                text = if (state.dispatches.isNotEmpty()) {
                                                    "${state.dispatches.size}"
                                                } else {
                                                    "WIRE"
                                                },
                                                color = if (state.activeTab == AndroidTab.LIVE_ALERTS) {
                                                    androidx.compose.ui.graphics.Color.White
                                                } else {
                                                    p.inkMuted
                                                },
                                                fontSize = 11.sp,
                                                fontWeight = FontWeight.Bold,
                                                fontFamily = FontFamily.Monospace,
                                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                            )
                                        }
                                    },
                                    label = {
                                        Text(
                                            text = "Live Alerts",
                                            fontWeight = FontWeight.SemiBold
                                        )
                                    },
                                    colors = NavigationBarItemDefaults.colors(
                                        selectedTextColor = p.inkPrimary,
                                        unselectedTextColor = p.inkMuted,
                                        indicatorColor = p.subtle
                                    )
                                )
                            }
                        }
                    }
                ) { innerPadding ->
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(innerPadding)
                    ) {
                        when (state.activeTab) {
                            AndroidTab.FIELD_CAPTURE -> FieldCaptureScreen(
                                state = state,
                                onModeChange = vm::setMode,
                                onRawInputChange = vm::updateRawInput,
                                onLoadScenario = vm::loadScenario,
                                onBitmapSelected = vm::setBitmap,
                                onForceCloudChange = vm::setForceCloudFallback,
                                onDownloadNano = vm::downloadOnDeviceNano,
                                onRunPipeline = vm::runHybridPipeline,
                                onVerifySearch = vm::verifyWithGoogleSearch,
                                onSaveIntake = vm::saveIntakeToFirestore,
                                onSubmitFieldTaskAnswer = vm::submitFieldTaskAnswer
                            )
                            AndroidTab.LIVE_ALERTS -> LiveAlertsScreen(
                                state = state,
                                onGoToCapture = { vm.selectTab(AndroidTab.FIELD_CAPTURE) }
                            )
                        }
                    }
                }
            }
        }
    }
}
