# Closed-Loop Ops Memory & Audit (`Ops Memory & Audit`)

## Problem Statement
How might we turn SigapWire from a one-way intake funnel into a closed-loop, human-verified crisis memory system where Commander field checks resolve live verification gaps across Web, Apple, and Android, promote trusted local facts into hybrid AI prompts, and expose an inspectable decision audit trail within the `#BuildHybridAI 2026` judging bar?

## Recommended Direction
Implement **Unified Closed-Loop Ops Memory & Audit** across all 3 platforms backed by **2 strictly scoped Firestore collections** (`verification_tasks` and `area_knowledge`) without bloating mobile navigation or duplicating Firestore writes for transient UI state:

1. **Two-Way Field Verification Loop (`verification_tasks`):**
   - Commanders turn any `verificationGap` (either directly from a `CommandDesk` triage card or from `BroadcastStudio`'s `GAP_DISCLOSURE_CHECK` Safety Gate finding) into a bounded `OPEN` field check (`question`, `location`, `linkedIntakeId`).
   - Mobile responders (Apple `QuickTextIntakeView`, Android `FieldCaptureScreen`, or Web `Ops Memory & Audit`) see inline **`Open Field Checks (N)`** cards with zero new mobile tabs.
   - Replies always pass through local deterministic PII scrubbing (`ONLY_ON_DEVICE`) before saving (`ANSWERED`) to Firestore.
2. **Conservative Human-Authored Area Knowledge (`area_knowledge`):**
   - Commanders promote confirmed `ANSWERED` field checks or enter direct ground truth (e.g., bridge load limits, primary shelters, official agency contacts) into `area_knowledge` (`HUMAN_DIRECT | PROMOTED_FIELD_CHECK`).
   - **Guardrail:** Unverified rumors and AI triage guesses never enter `area_knowledge` automatically.
   - Active facts are tagged `[AK-1]`, `[AK-2]`, ... and injected inside strict character/token budgets into Web, Apple, and Android triage and synthesis prompts, with visible **`Area Knowledge Injected (N active)`** pills and SitRep `.md` receipt disclosure.
3. **Unified Hybrid Decision Audit Trail & Markdown Dossier (`Ops Memory & Audit` 4th Web Tab):**
   - Deterministically derives the cross-platform decision timeline (`PII_SCRUBBED_LOCAL`, `TRIAGE_ROUTED`, `OFFLINE_QUEUED`, `RUMOR_GROUNDED`, `FIELD_TASK_REQUESTED`, `FIELD_TASK_ANSWERED`, `AREA_KNOWLEDGE_RECORDED`, `DISPATCH_PUBLISHED`) from synced Firestore documents, merged with local session governance events (`OFFLINE_DRILL_TOGGLED`, `SAFETY_GATE_DRILL`, `SAFETY_GATE_REPAIRED`, `COMMANDER_SIGNOFF`).
   - Provides category filters (`ALL`, `ON_DEVICE`, `IN_CLOUD`, `HUMAN_GATE`) and one-click **`Export Incident Audit (.md)`**.

## Alignment with `#BuildHybridAI 2026` Criteria
- **Technological Implementation:** Demonstrates bidirectional Firebase AI Logic hybrid routing (on-device PII scrub -> on-device/cloud triage -> cloud grounded search -> deterministic Safety Gate -> cross-device field verification -> bounded `[AK-N]` prompt injection across Web JS SDK, Android Kotlin SDK, and Apple SwiftUI `HybridModel`).
- **Design & Coherence:** One clean 4th Web tab (`Ops Memory & Audit`) unifies operational memory and auditability; Apple and Android stay clean with zero added tabs.
- **Potential Impact & Idea Quality:** Solves the real disaster command failure where AI drafts keep repeating stale errors because field confirmations and local constraints never flow back into next-cycle triage.

## Key Assumptions to Validate
- [ ] **Bounded `[AK-N]` injection stays inside on-device limits:** Cap injected Area Knowledge strictly at `8 facts / 1,200 chars` on Web and `6 facts / 900 chars` on Apple & Android so Chrome Nano (`2,200` tokens) and Apple/Android (`1,600` tokens) keep safe headroom.
- [ ] **`verification_tasks` & `area_knowledge` pass strict Firestore Rules:** Anonymous multi-device responders can answer open tasks (`OPEN -> ANSWERED` only with `answerPiiRedactedLocally == true`) and toggle/promote facts without weakening immutable creator/audit fields.
- [ ] **All 3 clients compile cleanly without Xcode target file churn:** Apple updates stay inside existing `.swift` files (`SigapWireModels.swift`, `FirestoreSyncService.swift`, `AppleHybridAiService.swift`, `QuickTextIntakeView.swift`) and pass `xcodebuild` for macOS & iOS Simulator.

## MVP Scope
- **Firestore Rules:** Add `verification_tasks/{taskId}` and `area_knowledge/{factId}` in `firestore.rules` via `firestore-rules-author`.
- **Web (`web/`):** Types, `areaKnowledgeContext.ts`, `auditTrail.ts`, `firestoreRepo.ts` subscriptions & mutations, `hybridAi.ts` prompt injection, `dispatchExport.ts` receipt + audit `.md` download, `OpsMemoryAudit.tsx` 4th tab, Safety Gate & CommandDesk `Request Field Check` triggers, and Node unit tests (`tests/opsMemoryAudit.test.ts`).
- **Apple (`apple/SigapWireApple/`):** `FieldVerificationTask` & `AreaKnowledgeFact` models, Firestore real-time listeners + `submitVerificationAnswer`, `[AK-N]` triage prompt injection, and collapsible inline `Open Field Checks (N)` reply card in `QuickTextIntakeView.swift`.
- **Android (`android/`):** Matching Kotlin models, `FirestoreSyncRepo` Flow listeners + answer mutation, `HybridAiEngine` `[AK-N]` injection + unit test, and inline `Open Field Checks (N)` card in `FieldCaptureScreen.kt`.

## Not Doing (and Why)
- **3rd `audit_events` Firestore collection** - Deriving the persistent timeline from existing synced collections (`intakes`, `verification_tasks`, `area_knowledge`, `dispatches`) merged with session events avoids duplicate writes and extra rules complexity while staying auditable across devices.
- **Firebase Storage photo attachments on field checks** - Adds new Storage bucket & security rules setup friction before demo; scrubbed text updates keep everything fast and cleanly inside Firestore.
- **Dedicated extra tabs on Apple & Android** - Preserves compact mobile navigation (`2 tabs`) by embedding `Open Field Checks (N)` inline at the top of capture screens.
