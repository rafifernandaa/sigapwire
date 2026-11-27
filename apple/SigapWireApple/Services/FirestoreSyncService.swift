import Foundation
#if canImport(FirebaseCore)
import FirebaseCore
import FirebaseAppCheck
import FirebaseAuth
import FirebaseFirestore
import FirebaseRemoteConfig
#endif

@MainActor
public final class FirestoreSyncService: ObservableObject {
    @Published public private(set) var isFirebaseConfigured: Bool = false
    @Published public private(set) var authUid: String?
    @Published public private(set) var dispatches: [DispatchCard] = [SyntheticDrillData.sampleOfflineDispatch]
    @Published public private(set) var openVerificationTasks: [FieldVerificationTask] = []
    @Published public private(set) var activeAreaKnowledge: [AreaKnowledgeFact] = []
    @Published public private(set) var isUsingSampleFallback: Bool = true
    @Published public private(set) var isLoadingDispatches: Bool = false
    @Published public private(set) var syncError: String?
    @Published public private(set) var fastCloudModel: String = "gemini-3.5-flash-lite"
    @Published public private(set) var synthesisCloudModel: String = "gemini-3.8-flash"

    #if canImport(FirebaseFirestore)
    nonisolated(unsafe) private var dispatchesListener: ListenerRegistration?
    nonisolated(unsafe) private var tasksListener: ListenerRegistration?
    nonisolated(unsafe) private var knowledgeListener: ListenerRegistration?
    #endif

    public init() {
        configureIfPlistExists()
    }

    deinit {
        #if canImport(FirebaseFirestore)
        dispatchesListener?.remove()
        tasksListener?.remove()
        knowledgeListener?.remove()
        #endif
    }

    public func configureIfPlistExists() {
        #if canImport(FirebaseCore)
        guard Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil else {
            isFirebaseConfigured = false
            dispatches = [SyntheticDrillData.sampleOfflineDispatch]
            isUsingSampleFallback = true
            return
        }

        if FirebaseApp.app() == nil {
            let providerFactory = AppCheckDebugProviderFactory()
            AppCheck.setAppCheckProviderFactory(providerFactory)
            FirebaseApp.configure()

            let settings = Firestore.firestore().settings
            settings.cacheSettings = PersistentCacheSettings()
            Firestore.firestore().settings = settings
        }

        isFirebaseConfigured = true
        isUsingSampleFallback = false
        isLoadingDispatches = true
        Task {
            await bootstrapSession()
        }
        #else
        isFirebaseConfigured = false
        isLoadingDispatches = false
        #endif
    }

    public func retrySync() {
        guard isFirebaseConfigured else { return }
        syncError = nil
        isLoadingDispatches = true
        Task {
            await bootstrapSession()
        }
    }

    public func bootstrapSession() async {
        guard isFirebaseConfigured else {
            isLoadingDispatches = false
            return
        }
        #if canImport(FirebaseCore)
        isLoadingDispatches = true
        do {
            let uid = try await ensureAnonymousAuthUid()
            authUid = uid
            await loadRemoteConfigModels()
            try await ensureDemoIncidentExists(uid: uid)
            startDispatchesListener()
            startVerificationTasksListener()
            startAreaKnowledgeListener()
            syncError = nil
        } catch {
            isLoadingDispatches = false
            syncError = error.localizedDescription
        }
        #endif
    }

    public func saveIntake(
        incidentId: String = SigapConstants.defaultDemoIncidentId,
        mode: IntakeMode,
        triage: HybridTriageResult,
        privacy: LocalPrivacyResult,
        isVerifiedBySearch: Bool
    ) async throws {
        guard isFirebaseConfigured else {
            throw AppleHybridAiError.firebaseNotConfigured
        }
        #if canImport(FirebaseCore)
        let uid = try await ensureAnonymousAuthUid()
        try await ensureDemoIncidentExists(uid: uid)
        let db = Firestore.firestore()
        let structured = triage.structured

        let safeSources: [[String: String]] = structured.groundingSources
            .filter { $0.uri.hasPrefix("http://") || $0.uri.hasPrefix("https://") }
            .prefix(15)
            .map { src in
                [
                    "title": clampString(src.title, max: 300, fallback: "Source"),
                    "uri": clampString(src.uri, max: 4096, fallback: "https://example.com")
                ]
            }

        let safeHtml: Any = {
            if let html = structured.searchEntryPointHtml, html.count <= 32768 {
                return html
            }
            return NSNull()
        }()

        let structuredPayload: [String: Any] = [
            "headline": clampString(structured.headline, max: 300, fallback: "Apple Quick Text Intake"),
            "hazardType": structured.hazardType.rawValue,
            "location": clampString(structured.location, max: 200, fallback: "Indonesia"),
            "severity": structured.severity.rawValue,
            "summaryId": String(structured.summaryId.trimmingCharacters(in: .whitespacesAndNewlines).prefix(2000)),
            "summaryEn": String(structured.summaryEn.trimmingCharacters(in: .whitespacesAndNewlines).prefix(2000)),
            "keyFacts": clampStringList(structured.keyFacts),
            "urgentNeeds": clampStringList(structured.urgentNeeds),
            "verificationGaps": clampStringList(structured.verificationGaps),
            "rumorVerdict": structured.rumorVerdict.rawValue,
            "panicSignals": clampStringList(structured.panicSignals),
            "groundingSources": safeSources,
            "searchEntryPointHtml": safeHtml
        ]

        let status = (mode == .rumorCheck && isVerifiedBySearch) ? "VERIFIED" : "TRIAGED"

        let intakePayload: [String: Any] = [
            "incidentId": incidentId,
            "mode": mode.rawValue,
            "sourcePlatform": "APPLE",
            "inferenceSource": triage.inferenceSource.rawValue,
            "inferenceModeRequested": triage.inferenceModeRequested,
            "latencyMs": min(max(triage.latencyMs, 0), 600_000),
            "piiRedactedLocally": true,
            "redactionCount": min(max(privacy.redactions.count, 0), 500),
            "sanitizedText": clampString(privacy.sanitizedText, max: 5000, fallback: "[Empty intake]"),
            "hasAttachment": false,
            "structured": structuredPayload,
            "status": status,
            "createdBy": uid,
            "createdAt": FieldValue.serverTimestamp()
        ]

        try await db.collection("intakes").addDocument(data: intakePayload)
        #endif
    }

    public func submitVerificationAnswer(
        taskId: String,
        sanitizedAnswer: String,
        redactionCount: Int
    ) async throws {
        guard isFirebaseConfigured else {
            throw AppleHybridAiError.firebaseNotConfigured
        }
        #if canImport(FirebaseCore)
        let uid = try await ensureAnonymousAuthUid()
        let db = Firestore.firestore()
        try await db.collection("verification_tasks").document(taskId).updateData([
            "status": "ANSWERED",
            "answerText": clampString(sanitizedAnswer, max: 2000, fallback: "Verified by Apple field responder."),
            "answerPlatform": "APPLE",
            "answerPiiRedactedLocally": true,
            "answerRedactionCount": min(max(redactionCount, 0), 500),
            "answeredBy": uid,
            "answeredAt": FieldValue.serverTimestamp(),
            "updatedAt": FieldValue.serverTimestamp()
        ])
        #endif
    }

    // MARK: - Private Firebase Helpers

    #if canImport(FirebaseCore)
    private func ensureAnonymousAuthUid() async throws -> String {
        let auth = Auth.auth()
        if let user = auth.currentUser {
            return user.uid
        }
        let result = try await auth.signInAnonymously()
        return result.user.uid
    }

    private func loadRemoteConfigModels() async {
        let rc = RemoteConfig.remoteConfig()
        let settings = RemoteConfigSettings()
        settings.minimumFetchInterval = 3600
        rc.configSettings = settings
        rc.setDefaults([
            "cloud_model_fast": "gemini-3.5-flash-lite" as NSObject,
            "cloud_model_synthesis": "gemini-3.8-flash" as NSObject
        ])
        do {
            _ = try await rc.fetchAndActivate()
            let fast = rc.configValue(forKey: "cloud_model_fast").stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            let synth = rc.configValue(forKey: "cloud_model_synthesis").stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if !fast.isEmpty { fastCloudModel = fast }
            if !synth.isEmpty { synthesisCloudModel = synth }
        } catch {
            // Keep validated defaults when offline or unconfigured.
        }
    }

    private func ensureDemoIncidentExists(uid: String) async throws {
        let ref = Firestore.firestore().collection("incidents").document(SigapConstants.defaultDemoIncidentId)
        let snap = try await ref.getDocument()
        if !snap.exists {
            try await ref.setData([
                "title": "West Java M6.2 Earthquake (Synthetic Drill)",
                "hazardType": "EARTHQUAKE",
                "region": "Cianjur & Bandung Raya, West Java, Indonesia",
                "severity": "HIGH",
                "status": "ACTIVE",
                "isSyntheticDemo": true,
                "createdBy": uid,
                "createdAt": FieldValue.serverTimestamp(),
                "updatedAt": FieldValue.serverTimestamp()
            ])
        }
    }

    private func startDispatchesListener() {
        dispatchesListener?.remove()
        // Query by single-field incidentId only and sort descending client-side
        // so fresh Firebase projects stay immune to composite-index delays.
        dispatchesListener = Firestore.firestore()
            .collection("dispatches")
            .whereField("incidentId", isEqualTo: SigapConstants.defaultDemoIncidentId)
            .addSnapshotListener { [weak self] snapshot, error in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    if let error {
                        self.isLoadingDispatches = false
                        self.syncError = error.localizedDescription
                        return
                    }
                    guard let docs = snapshot?.documents else {
                        self.isLoadingDispatches = false
                        return
                    }
                    let parsed = docs.compactMap { Self.parseDispatch(doc: $0) }
                        .sorted { $0.publishedAt > $1.publishedAt }
                    if parsed.isEmpty {
                        self.dispatches = [SyntheticDrillData.sampleOfflineDispatch]
                        self.isUsingSampleFallback = true
                    } else {
                        self.dispatches = parsed
                        self.isUsingSampleFallback = false
                    }
                    self.isLoadingDispatches = false
                    self.syncError = nil
                }
            }
    }

    private func startVerificationTasksListener() {
        tasksListener?.remove()
        tasksListener = Firestore.firestore()
            .collection("verification_tasks")
            .whereField("incidentId", isEqualTo: SigapConstants.defaultDemoIncidentId)
            .addSnapshotListener { [weak self] snapshot, error in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    if let error {
                        self.syncError = error.localizedDescription
                        return
                    }
                    guard let docs = snapshot?.documents else { return }
                    let parsed = docs.compactMap { doc -> FieldVerificationTask? in
                        let data = doc.data()
                        let status = (data["status"] as? String) ?? "OPEN"
                        guard status == "OPEN" else { return nil }
                        let ts = (data["createdAt"] as? Timestamp)?.dateValue() ?? Date()
                        return FieldVerificationTask(
                            id: doc.documentID,
                            incidentId: (data["incidentId"] as? String) ?? SigapConstants.defaultDemoIncidentId,
                            question: (data["question"] as? String) ?? "",
                            location: (data["location"] as? String) ?? "Field Zone",
                            status: status,
                            requestedPlatform: (data["requestedPlatform"] as? String) ?? "WEB",
                            answerText: data["answerText"] as? String,
                            answerPlatform: data["answerPlatform"] as? String,
                            createdAt: ts
                        )
                    }.sorted { $0.createdAt > $1.createdAt }
                    self.openVerificationTasks = parsed
                }
            }
    }

    private func startAreaKnowledgeListener() {
        knowledgeListener?.remove()
        knowledgeListener = Firestore.firestore()
            .collection("area_knowledge")
            .whereField("incidentId", isEqualTo: SigapConstants.defaultDemoIncidentId)
            .addSnapshotListener { [weak self] snapshot, error in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    if let error {
                        self.syncError = error.localizedDescription
                        return
                    }
                    guard let docs = snapshot?.documents else { return }
                    let parsed = docs.compactMap { doc -> AreaKnowledgeFact? in
                        let data = doc.data()
                        let active = (data["active"] as? Bool) ?? false
                        guard active else { return nil }
                        let fact = ((data["fact"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !fact.isEmpty else { return nil }
                        let ts = (data["createdAt"] as? Timestamp)?.dateValue() ?? Date()
                        return AreaKnowledgeFact(
                            id: doc.documentID,
                            fact: fact,
                            category: (data["category"] as? String) ?? "SAFETY_CONSTRAINT",
                            active: active,
                            createdAt: ts
                        )
                    }.sorted { $0.createdAt > $1.createdAt }
                    self.activeAreaKnowledge = parsed
                }
            }
    }

    private static func parseDispatch(doc: QueryDocumentSnapshot) -> DispatchCard? {
        let data = doc.data()
        let community = data["communityAlertId"] as? [String: Any] ?? [:]
        let media = data["mediaPressReleaseId"] as? [String: Any] ?? [:]
        let global = data["globalSitrepEn"] as? [String: Any] ?? [:]
        let debunk = data["debunkCard"] as? [String: Any] ?? [:]

        let sources: [GroundingSource] = (debunk["sources"] as? [[String: Any]] ?? []).compactMap { map in
            guard let uri = map["uri"] as? String, !uri.isEmpty else { return nil }
            let title = (map["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            return GroundingSource(title: (title?.isEmpty == false ? title! : uri), uri: uri)
        }

        let timestamp = (data["publishedAt"] as? Timestamp)?.dateValue() ?? Date()
        let rawInference = (data["inferenceSource"] as? String) ?? "IN_CLOUD"

        return DispatchCard(
            id: doc.documentID,
            incidentId: (data["incidentId"] as? String) ?? SigapConstants.defaultDemoIncidentId,
            dispatchNumber: (data["dispatchNumber"] as? Int) ?? 1,
            severity: SeverityLevel.from(data["severity"] as? String),
            inferenceSource: rawInference == "ON_DEVICE" ? .onDevice : .inCloud,
            publishedAt: timestamp,
            communityTitle: (community["title"] as? String) ?? "Update Darurat",
            communityWhatHappened: (community["whatHappened"] as? String) ?? "",
            communityDoNow: community["doNow"] as? [String] ?? [],
            communityAvoid: community["avoid"] as? [String] ?? [],
            whatsappShortText: (community["whatsappShortText"] as? String) ?? "",
            mediaHeadline: (media["headline"] as? String) ?? "",
            mediaDateline: (media["dateline"] as? String) ?? "",
            mediaBody: (media["body"] as? String) ?? "",
            mediaKeyMetrics: media["keyMetrics"] as? [String] ?? [],
            globalHeadline: (global["headline"] as? String) ?? "",
            globalExecutiveSummary: (global["executiveSummary"] as? String) ?? "",
            globalImpactOverview: global["impactOverview"] as? [String] ?? [],
            globalPriorityNeeds: global["priorityNeeds"] as? [String] ?? [],
            globalInformationGaps: global["informationGaps"] as? [String] ?? [],
            hasRumorAlert: (debunk["hasRumorAlert"] as? Bool) ?? false,
            debunkVerdict: RumorVerdict.from(debunk["verdict"] as? String),
            debunkClaim: (debunk["claim"] as? String) ?? "",
            debunkFactId: (debunk["factId"] as? String) ?? "",
            debunkFactEn: (debunk["factEn"] as? String) ?? "",
            debunkSources: sources,
            provenanceCode: {
                let raw = (data["provenanceCode"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
                return (raw?.isEmpty == false) ? raw : nil
            }()
        )
    }
    #endif

    private func clampString(_ raw: String, max: Int, fallback: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return fallback }
        return String(trimmed.prefix(max))
    }

    private func clampStringList(_ items: [String]) -> [String] {
        Array(
            items
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .prefix(20)
        )
    }
}
