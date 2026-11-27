package dev.sigapwire.android.ui

import android.app.Application
import android.content.Context
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.sigapwire.android.SigapWireApp
import dev.sigapwire.android.data.AreaKnowledgeFact
import dev.sigapwire.android.data.DeviceNanoStatus
import dev.sigapwire.android.data.DispatchCard
import dev.sigapwire.android.data.FieldVerificationTask
import dev.sigapwire.android.data.FirestoreSyncRepo
import dev.sigapwire.android.data.GroundedVerificationResult
import dev.sigapwire.android.data.HybridAiEngine
import dev.sigapwire.android.data.HybridTriageResult
import dev.sigapwire.android.data.IntakeMode
import dev.sigapwire.android.data.LocalPrivacyResult
import dev.sigapwire.android.data.RemoteModelConfig
import dev.sigapwire.android.data.RumorVerdict
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class AndroidTab {
    FIELD_CAPTURE,
    LIVE_ALERTS
}

data class SigapUiState(
    val activeTab: AndroidTab = AndroidTab.FIELD_CAPTURE,
    val darkTheme: Boolean = false,
    val isFirebaseConfigured: Boolean = SigapWireApp.isFirebaseConfigured,
    val isOnline: Boolean = true,
    val nanoStatus: DeviceNanoStatus = DeviceNanoStatus.CHECKING,
    val nanoDownloadProgress: Float? = null,
    val mode: IntakeMode = IntakeMode.FIELD_REPORT,
    val rawInput: String = "",
    val selectedBitmap: Bitmap? = null,
    val forceCloudFallback: Boolean = false,
    val isRunningPipeline: Boolean = false,
    val pipelineStepMessage: String? = null,
    val privacyResult: LocalPrivacyResult? = null,
    val triageResult: HybridTriageResult? = null,
    val isVerifyingSearch: Boolean = false,
    val groundedResult: GroundedVerificationResult? = null,
    val searchErrorMessage: String? = null,
    val isSavingIntake: Boolean = false,
    val saveFeedback: String? = null,
    val setupNotice: String? = null,
    val errorMessage: String? = null,
    val dispatches: List<DispatchCard> = emptyList(),
    val dispatchesLoading: Boolean = SigapWireApp.isFirebaseConfigured,
    val dispatchesError: String? = null,
    val openVerificationTasks: List<FieldVerificationTask> = emptyList(),
    val activeAreaKnowledge: List<AreaKnowledgeFact> = emptyList(),
    val isSubmittingFieldReply: Boolean = false,
    val fieldReplyFeedback: String? = null
)

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val _uiState = MutableStateFlow(SigapUiState())
    val uiState: StateFlow<SigapUiState> = _uiState.asStateFlow()

    private var modelConfig = RemoteModelConfig()
    private var activeIncidentId = FirestoreSyncRepo.DEFAULT_DEMO_INCIDENT_ID

    private val connectivityManager =
        application.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            _uiState.update { it.copy(isOnline = checkOnlineNow()) }
        }

        override fun onLost(network: Network) {
            _uiState.update { it.copy(isOnline = checkOnlineNow()) }
        }

        override fun onCapabilitiesChanged(
            network: Network,
            networkCapabilities: NetworkCapabilities
        ) {
            _uiState.update { it.copy(isOnline = checkOnlineNow()) }
        }
    }

    init {
        _uiState.update { it.copy(isOnline = checkOnlineNow()) }
        registerNetworkMonitor()
        refreshNanoStatus()
        bootstrapFirebaseAndAlerts()
    }

    private fun checkOnlineNow(): Boolean {
        val active = connectivityManager.activeNetwork ?: return false
        val caps = connectivityManager.getNetworkCapabilities(active) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun registerNetworkMonitor() {
        try {
            val req = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
            connectivityManager.registerNetworkCallback(req, networkCallback)
        } catch (_: Throwable) {
            // Ignore callback registration issues on restricted devices.
        }
    }

    override fun onCleared() {
        super.onCleared()
        try {
            connectivityManager.unregisterNetworkCallback(networkCallback)
        } catch (_: Throwable) {
        }
    }

    fun selectTab(tab: AndroidTab) {
        _uiState.update { it.copy(activeTab = tab) }
    }

    fun toggleTheme() {
        _uiState.update { it.copy(darkTheme = !it.darkTheme) }
    }

    fun setMode(mode: IntakeMode) {
        _uiState.update {
            it.copy(
                mode = mode,
                setupNotice = null,
                searchErrorMessage = null,
                errorMessage = null,
                saveFeedback = null
            )
        }
    }

    fun updateRawInput(value: String) {
        _uiState.update { it.copy(rawInput = value) }
    }

    fun loadScenario(rawInput: String) {
        _uiState.update {
            it.copy(
                rawInput = rawInput,
                privacyResult = null,
                triageResult = null,
                groundedResult = null,
                searchErrorMessage = null,
                setupNotice = null,
                errorMessage = null,
                saveFeedback = null
            )
        }
    }

    fun setBitmap(bitmap: Bitmap?) {
        _uiState.update { it.copy(selectedBitmap = bitmap, errorMessage = null) }
    }

    fun setForceCloudFallback(enabled: Boolean) {
        _uiState.update { it.copy(forceCloudFallback = enabled) }
    }

    fun refreshNanoStatus() {
        viewModelScope.launch {
            _uiState.update { it.copy(nanoStatus = DeviceNanoStatus.CHECKING) }
            val status = HybridAiEngine.checkOnDeviceStatus()
            _uiState.update { it.copy(nanoStatus = status) }
        }
    }

    fun downloadOnDeviceNano() {
        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    nanoStatus = DeviceNanoStatus.DOWNLOADING,
                    nanoDownloadProgress = 0f,
                    errorMessage = null
                )
            }
            val resultStatus = HybridAiEngine.downloadOnDeviceModel { progress ->
                _uiState.update { it.copy(nanoDownloadProgress = progress) }
            }
            _uiState.update {
                it.copy(
                    nanoStatus = resultStatus,
                    nanoDownloadProgress = if (resultStatus == DeviceNanoStatus.AVAILABLE) 1f else null
                )
            }
        }
    }

    private fun bootstrapFirebaseAndAlerts() {
        if (!SigapWireApp.isFirebaseConfigured) return

        viewModelScope.launch {
            try {
                FirestoreSyncRepo.ensureAnonymousAuthUid()
                // Attach authenticated Firestore listeners only after Anonymous Auth succeeds
                // so firestore.rules (isAuthenticated()) never rejects cold-start snapshots.
                viewModelScope.launch {
                    FirestoreSyncRepo.observeOpenVerificationTasks(FirestoreSyncRepo.DEFAULT_DEMO_INCIDENT_ID)
                        .catch { }
                        .collect { tasks ->
                            _uiState.update { it.copy(openVerificationTasks = tasks) }
                        }
                }
                viewModelScope.launch {
                    FirestoreSyncRepo.observeActiveAreaKnowledge(FirestoreSyncRepo.DEFAULT_DEMO_INCIDENT_ID)
                        .catch { }
                        .collect { facts ->
                            _uiState.update { it.copy(activeAreaKnowledge = facts) }
                        }
                }
                modelConfig = FirestoreSyncRepo.loadRemoteModels()
                activeIncidentId = FirestoreSyncRepo.ensureDemoIncidentExists()
            } catch (t: Throwable) {
                _uiState.update {
                    it.copy(
                        dispatchesLoading = false,
                        dispatchesError = "Firebase sync notice: ${t.message}"
                    )
                }
            }
        }

        viewModelScope.launch {
            FirestoreSyncRepo.observeDispatches(FirestoreSyncRepo.DEFAULT_DEMO_INCIDENT_ID)
                .catch { err ->
                    _uiState.update {
                        it.copy(
                            dispatchesLoading = false,
                            dispatchesError = "Could not load live dispatches: ${err.message}"
                        )
                    }
                }
                .collect { cards ->
                    _uiState.update {
                        it.copy(
                            dispatches = cards,
                            dispatchesLoading = false,
                            dispatchesError = null
                        )
                    }
                }
        }
    }

    fun runHybridPipeline() {
        val state = _uiState.value
        val trimmed = state.rawInput.trim()
        if (trimmed.isEmpty()) {
            _uiState.update {
                it.copy(errorMessage = "Enter a raw field note or load a Synthetic Drill before running triage.")
            }
            return
        }

        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isRunningPipeline = true,
                    pipelineStepMessage = "Step 1/2: Running local privacy firewall to strip PII...",
                    privacyResult = null,
                    triageResult = null,
                    groundedResult = null,
                    searchErrorMessage = null,
                    saveFeedback = null,
                    setupNotice = null,
                    errorMessage = null
                )
            }

            try {
                val privacy = HybridAiEngine.runLocalPrivacyFirewall(
                    rawText = trimmed,
                    fastCloudModel = modelConfig.fastCloudModel
                )
                _uiState.update {
                    it.copy(
                        privacyResult = privacy,
                        pipelineStepMessage = if (!SigapWireApp.isFirebaseConfigured) {
                            "Step 1 complete locally (add google-services.json for hybrid cloud/AI triage)."
                        } else {
                            "Step 2/2: Running Firebase AI Logic PREFER_ON_DEVICE triage..."
                        }
                    )
                }

                if (!SigapWireApp.isFirebaseConfigured) {
                    _uiState.update {
                        it.copy(
                            isRunningPipeline = false,
                            pipelineStepMessage = null,
                            setupNotice = "Local PII redaction finished! Add android/app/google-services.json to enable Firebase AI Logic hybrid inference and Firestore sync."
                        )
                    }
                    return@launch
                }

                val triaged = HybridAiEngine.triageIntakeHybrid(
                    mode = state.mode,
                    sanitizedText = privacy.sanitizedText,
                    bitmap = state.selectedBitmap,
                    forceCloudFallback = state.forceCloudFallback,
                    fastCloudModel = modelConfig.fastCloudModel,
                    isOnline = state.isOnline,
                    areaKnowledge = state.activeAreaKnowledge
                )

                _uiState.update {
                    it.copy(
                        isRunningPipeline = false,
                        pipelineStepMessage = null,
                        triageResult = triaged
                    )
                }
            } catch (t: Throwable) {
                _uiState.update {
                    it.copy(
                        isRunningPipeline = false,
                        pipelineStepMessage = null,
                        errorMessage = t.message ?: "Hybrid inference failed."
                    )
                }
            }
        }
    }

    fun verifyWithGoogleSearch() {
        val state = _uiState.value
        val privacy = state.privacyResult ?: return
        val triage = state.triageResult ?: return

        if (!state.isOnline) {
            _uiState.update {
                it.copy(searchErrorMessage = "Device is offline. Google Search Grounding requires connectivity; your local triage card is preserved.")
            }
            return
        }

        viewModelScope.launch {
            _uiState.update {
                it.copy(isVerifyingSearch = true, searchErrorMessage = null)
            }
            try {
                val verification = HybridAiEngine.verifyRumorWithGoogleSearch(
                    sanitizedClaim = privacy.sanitizedText,
                    locationHint = triage.structured.location,
                    synthesisCloudModel = modelConfig.synthesisCloudModel,
                    fastCloudModel = modelConfig.fastCloudModel
                )
                val updatedStructured = triage.structured.copy(
                    rumorVerdict = verification.verdict,
                    summaryId = verification.factId,
                    summaryEn = verification.factEn,
                    groundingSources = verification.sources,
                    searchEntryPointHtml = verification.searchEntryPointHtml
                )
                _uiState.update {
                    it.copy(
                        isVerifyingSearch = false,
                        searchErrorMessage = null,
                        groundedResult = verification,
                        triageResult = triage.copy(structured = updatedStructured)
                    )
                }
            } catch (t: Throwable) {
                _uiState.update {
                    it.copy(
                        isVerifyingSearch = false,
                        searchErrorMessage = t.message ?: "Google Search Grounding failed."
                    )
                }
            }
        }
    }

    fun saveIntakeToFirestore() {
        val state = _uiState.value
        val privacy = state.privacyResult ?: return
        val triage = state.triageResult ?: return

        if (!SigapWireApp.isFirebaseConfigured) {
            _uiState.update {
                it.copy(errorMessage = "Add android/app/google-services.json first to sync intakes to Firestore.")
            }
            return
        }

        viewModelScope.launch {
            _uiState.update {
                it.copy(isSavingIntake = true, saveFeedback = null, errorMessage = null)
            }
            try {
                val uid = FirestoreSyncRepo.ensureAnonymousAuthUid()
                FirestoreSyncRepo.saveIntakeQueued(
                    incidentId = activeIncidentId,
                    mode = state.mode,
                    triage = triage,
                    privacy = privacy,
                    hasAttachment = state.selectedBitmap != null,
                    isVerifiedBySearch = state.groundedResult != null &&
                        triage.structured.rumorVerdict != RumorVerdict.NOT_APPLICABLE,
                    uid = uid
                )
                val msg = if (state.isOnline) {
                    "Saved sanitized ANDROID intake to Firestore. Available now in Web Broadcast Studio."
                } else {
                    "Saved to local Firestore offline cache. Will automatically sync when signal returns."
                }
                _uiState.update {
                    it.copy(
                        isSavingIntake = false,
                        saveFeedback = msg
                    )
                }
            } catch (t: Throwable) {
                _uiState.update {
                    it.copy(
                        isSavingIntake = false,
                        errorMessage = "Failed to save intake: ${t.message}"
                    )
                }
            }
        }
    }

    fun submitFieldTaskAnswer(taskId: String, rawAnswer: String) {
        val trimmed = rawAnswer.trim()
        if (trimmed.isEmpty()) return
        if (!SigapWireApp.isFirebaseConfigured) {
            _uiState.update {
                it.copy(errorMessage = "Add android/app/google-services.json first to answer verification tasks.")
            }
            return
        }

        viewModelScope.launch {
            _uiState.update {
                it.copy(isSubmittingFieldReply = true, fieldReplyFeedback = null, errorMessage = null)
            }
            try {
                val (sanitized, redactions) = HybridAiEngine.deterministicLocalPiiScrub(trimmed)
                val uid = FirestoreSyncRepo.ensureAnonymousAuthUid()
                FirestoreSyncRepo.submitVerificationAnswer(
                    taskId = taskId,
                    sanitizedAnswer = sanitized,
                    redactionCount = redactions.size,
                    uid = uid
                )
                _uiState.update {
                    it.copy(
                        isSubmittingFieldReply = false,
                        fieldReplyFeedback = "Sent scrubbed ANDROID field check (${redactions.size} PII masked locally)."
                    )
                }
            } catch (t: Throwable) {
                _uiState.update {
                    it.copy(
                        isSubmittingFieldReply = false,
                        errorMessage = "Failed to submit field answer: ${t.message}"
                    )
                }
            }
        }
    }
}
