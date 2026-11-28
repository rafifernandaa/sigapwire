# SigapWire

**Unified Crisis Clarity & Rumor Verification Engine powered by Firebase AI Logic Hybrid Inference.**

- **Live Web App (Free Judge Access, No Login Required):** https://sigapwire-hybrid-ai.web.app
- **Public Repository:** https://github.com/rafifernandaa/sigapwire
- **Open-Source License:** MIT License ([LICENSE](./LICENSE))
- **Event:** Built from scratch for **#BuildHybridAI 2026** (Nov 11 - Nov 30, 2026) using **Google Antigravity** and official **Firebase Agent Skills**

> **Disclaimer:** SigapWire is an independent open-source project built for the **#BuildHybridAI 2026** hackathon. Bundled disaster scenarios are synthetic drills (`SYNTHETIC DRILL`) and do not represent official agency statements. No production API keys, live secrets, or real personal data are stored in this repository.

---

## Value Proposition & Problem Statement

In the first 60 minutes of an earthquake, flood, or volcanic crisis, emergency teams and citizens face two compounding failures: raw field updates arrive as messy Bahasa Indonesia/English chats packed with victim phone numbers and addresses, while unverified viral rumors spread panic faster than responders can issue clear guidance.

Disaster communication breaks under both cloud-only and on-device-only AI:
- **Cloud-only AI fails** when cell towers drop in impact zones, when citizens refuse to upload private WhatsApp chats or victim contact details to cloud servers, and when high-frequency field triage exhausts cloud quota.
- **On-device-only AI fails** when synthesizing multi-report incident briefings beyond small local context windows (4k-9k tokens), verifying breaking rumors against live public news/agency feeds, or running on mid-range field Android hardware without AICore Gemini Nano.

**SigapWire solves both** by combining on-device privacy/triage (`ONLY_ON_DEVICE` & `PREFER_ON_DEVICE`), cloud search grounding & multi-audience synthesis (`ONLY_IN_CLOUD` + Google Search Grounding), resilient streaming reader adaptation (`PREFER_IN_CLOUD`), deterministic non-LLM safety gates, and closed-loop field verification across **Web (Chrome)**, **Android**, and **Apple (iOS 26+ & macOS 26+)** over one shared Firebase backend.

---

## Runtime Firebase AI Logic & Firebase Stack Proof

Firebase AI Logic is imported and invoked directly at runtime across all three platforms (never mocked or README-only):

| Platform | Runtime Files | Exact SDK Imports & Runtime Calls | Hybrid Modes Exercised |
| :--- | :--- | :--- | :--- |
| **Web (Chrome)** | [web/src/lib/firebase.ts](./web/src/lib/firebase.ts)<br>[web/src/lib/hybridAi.ts](./web/src/lib/hybridAi.ts) | `import { getAI, GoogleAIBackend } from "firebase/ai"`<br>`import { getGenerativeModel, InferenceMode, ResponseModality, Schema } from "firebase/ai"`<br>`getAI(app, { backend: new GoogleAIBackend() })`<br>`getGenerativeModel(ai, { mode: InferenceMode.*, inCloudParams, onDeviceParams, tools: [{ googleSearch: {} }] })`<br>`getGenerativeModel(ai, { model: "gemini-3.8-flash-tts", generationConfig: { responseModalities: [ResponseModality.AUDIO], speechConfig } })` | `ONLY_ON_DEVICE` (privacy firewall + offline triage + Web Speech audio fallback)<br>`PREFER_ON_DEVICE` (triage + Nano init)<br>`ONLY_IN_CLOUD` (Search Grounding rumor check, 4-audience synthesis, over-budget escalation)<br>`PREFER_IN_CLOUD` (streaming reader adaptation + hyperlocal dialect/visitor translation)<br>`ResponseModality.AUDIO` (`prebuiltVoiceConfig` & `multiSpeakerVoiceConfig` Crisis Radio TTS) |
| **Android (Kotlin / Compose)** | [android/.../HybridAiEngine.kt](./android/app/src/main/kotlin/dev/sigapwire/android/data/HybridAiEngine.kt) | `import com.google.firebase.ai.InferenceMode`<br>`import com.google.firebase.ai.OnDeviceConfig`<br>`import com.google.firebase.ai.ondevice.FirebaseAIOnDevice`<br>`import com.google.firebase.ai.type.GenerativeBackend`<br>`import com.google.firebase.ai.type.Tool`<br>`FirebaseAIOnDevice.checkStatus()` / `.download()`<br>`Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(...)` + `Tool.googleSearch()` | `ONLY_ON_DEVICE` (local privacy firewall)<br>`PREFER_ON_DEVICE` (multimodal text+photo triage with automatic cloud fallback on mid-range devices)<br>`ONLY_IN_CLOUD` (token-budget escalation + Google Search Grounding) |
| **Apple (iOS 26+ & macOS 26+)** | [apple/.../AppleHybridAiService.swift](./apple/SigapWireApple/Services/AppleHybridAiService.swift) | `import FirebaseAILogic` & `import FoundationModels`<br>`FirebaseAI.firebaseAI(backend: .googleAI())`<br>`FirebaseAI.SystemLanguageModel.default`<br>`ai.generativeModelSession(model: .hybridModel(primary: systemModel, secondary: cloudModel))`<br>`tools: [.googleSearch()]` | `SystemLanguageModel.default` on-device privacy & triage (Apple Silicon)<br>`.hybridModel(primary:secondary:)` triage & streaming briefing adaptation<br>Cloud Gemini + `.googleSearch()` rumor verification |

### Supporting Firebase Products Used at Runtime

| Firebase Service | Runtime Integration |
| :--- | :--- |
| **Firebase App Check** | Web: `ReCaptchaV3Provider` in production Hosting + localhost-only debug token guard ([web/src/lib/firebase.ts](./web/src/lib/firebase.ts)). Android: `DebugAppCheckProviderFactory` ([SigapWireApp.kt](./android/app/src/main/kotlin/dev/sigapwire/android/SigapWireApp.kt)). Apple: `AppCheckDebugProviderFactory` ([FirestoreSyncService.swift](./apple/SigapWireApple/Services/FirestoreSyncService.swift)). |
| **Cloud Firestore** | Persistent local offline cache (`persistentLocalCache` / `PersistentCacheSettings`), atomic `writeBatch` commits for publish and promotion flows, and real-time cross-platform sync across 5 schema-validated collections (`incidents`, `intakes`, `dispatches`, `verification_tasks`, `area_knowledge`) with optional SHA-256 provenance fields enforced by [firestore.rules](./firestore.rules). |
| **Firebase Authentication** | Silent Anonymous Auth (`signInAnonymously`) across Web, Android, and Apple so responders and judges connect immediately with zero sign-up friction while Firestore rules enforce `request.auth != null` and owner UID checks. |
| **Firebase Remote Config** | Runtime model ID configuration (`cloud_model_fast`, `cloud_model_synthesis`, `cloud_model_deep`, `cloud_model_tts`, `cloud_model_tts_fallback`) across Web, Android, and Apple without requiring client redeploys. |
| **Firebase Hosting** | Hosts the live production Web Command & Public Crisis Wire app at https://sigapwire-hybrid-ai.web.app ([firebase.json](./firebase.json)). |

---

## Judge Quick-Test Guide (Live Web App, ~3 Minutes)

Open **https://sigapwire-hybrid-ai.web.app** in **Chrome Desktop** (no login needed; Silent Anonymous Auth starts automatically):

1. **Local Privacy Firewall + Hybrid Triage (`Command Desk`):**
   - Load a bundled **Synthetic Drill** scenario (contains mock phone numbers, `@handles`, and street names) and click **Sanitize & Triage**.
   - Inspect the live **Stayed Local vs. Cloud-Safe Output** diff (`ONLY_ON_DEVICE`), the `ON_DEVICE` vs. `IN_CLOUD` inference badge & latency, and the structured Bahasa Indonesia / English summary, urgent needs, and verification gaps.
   - Click **Request Field Check** on any verification gap, then click **Save to Incident Queue**.
2. **Offline Signal Loss & Reconnect Sync (`Offline Field Mode`):**
   - Click **`ONLINE`** in the top bar to switch to **`OFFLINE (DRILL)`** (disables Firestore network).
   - Run another triage strictly on-device (`ONLY_ON_DEVICE`) and save it to Firestore's local offline cache (`PENDING SYNC` pill increments).
   - Click **`OFFLINE (DRILL)`** again to restore signal and watch pending writes sync automatically (`SYNCED`) with one-click cloud upgrade/verification actions.
3. **Google Search Grounding Rumor Check (`Command Desk -> Verify Rumor`):**
   - Switch mode to **Verify Rumor**, load a rumor drill, triage locally, then click **Verify with Google Search (Cloud)** (`ONLY_IN_CLOUD` + `{ googleSearch: {} }`). Observe clickable grounding citations and the honest `UNVERIFIED_DEVELOPING` guardrail when authoritative confirmation is absent.
4. **4-Audience Broadcast + Deterministic Pre-Publish Safety Gate (`Broadcast Studio`):**
   - Select synced intakes and click **Synthesize 4-Audience Broadcast** (generates Community Action Alert ID, National Press Release ID, Global Humanitarian SitRep EN, and Rumor Debunk Card).
   - Click **`Test Safety Gate (Drill)`** to inject synthetic PII, unsafe all-clear claims, and a peak-severity downgrade; verify **Publish** locks (`PUBLISH BLOCKED`), click the one-click deterministic repair buttons, toggle **Commander Release Sign-Off**, download the SitRep + verification receipt (**Export Markdown (.md)**), and click **Publish to Public Crisis Wire**.
5. **Closed-Loop Field Verification, `[AK-1]` Area Knowledge, Live Scorecard & 32-Scenario Benchmark (`Ops Memory & Audit`):**
   - Inspect the **Hybrid Routing & Privacy Scorecard** (`On-Device Share %`, `PII Blocked On-Device`, `Cloud Calls Avoided`, `Human Gate Actions`, and `LAST HANDOFF`), also displayed compactly on **Command Desk**.
   - Reply to an open verification check (try including a mock phone number to watch local PII scrubbing before upload), click **Promote to Area Knowledge** (atomic `writeBatch` commit) to mint **`[AK-1]`**, click **Run 32-Scenario Benchmark** to verify all 4 pillars live in-browser, and click **Export Incident Audit (.md)** to download the full multi-platform chronological decision trace.
6. **Anti-Forgery Provenance Seal, Hyperlocal Translation & Crisis Radio TTS (`Public Crisis Wire`):**
   - Click **Verify Provenance** on any dispatch (or copy the WhatsApp Alert and paste it into **Verify Forwarded WhatsApp Alert** at the top) to recompute its `SIGAP-D{n}-{HEX6}` SHA-256 manifest live and inspect the zero-PII hybrid chain of custody.
   - Translate any published Community Alert via one-tap regional dialect and visitor pills (`Bahasa Indonesia`, `Basa Sunda`, `Basa Jawa`, `English`, `日本語`, `한국어`, `العربية`), verified automatically by the deterministic **Numeric Guard**.
   - Stream reader adaptations via `PREFER_IN_CLOUD`, or click **Play Radio Audio (Gemini TTS)** / **2-Voice Rumor Debunk Audio** to synthesize natural spoken radio/loudspeaker audio (`gemini-3.8-flash-tts` -> `gemini-3.8-flash-lite-tts`, WAV download), automatically switching to on-device browser speech synthesis when offline.

---

## Hybrid AI Routing Architecture

| Stage | Firebase AI Logic Mode | Runtime Behavior |
| :--- | :--- | :--- |
| **1. Local Privacy Firewall** | `ONLY_ON_DEVICE` | Strips victim names, phone numbers, chat handles, and street addresses locally before any cloud sync or verification, showing a live **Stayed Local vs. Cloud-Safe Output** diff. |
| **2. Rapid Field & Rumor Triage** | `PREFER_ON_DEVICE` | Extracts structured JSON (severity, hazard type, needs, verification gaps, panic signals) from messy Bahasa Indonesia/English text (and optional JPEG/PNG images on Web/Android) with bounded `[AK-N]` Area Knowledge injection, or automatically escalates to Cloud Gemini (`gemini-3.5-flash-lite`) when over token budget or unavailable on-device. |
| **3. Live Rumor Fact-Check** | `ONLY_IN_CLOUD` + `{ googleSearch: {} }` | Escalates only the locally sanitized claim to Cloud Gemini (`gemini-3.8-flash`) with Google Search Grounding (and automatic fallback to `gemini-3.5-flash-lite` on `429` quota or `500`/`503`/`504` transient spikes), enforcing an honest `UNVERIFIED_DEVELOPING` verdict when authoritative confirmation is absent. |
| **4. 4-Audience Broadcast Synthesis & Safety Gate** | `ONLY_IN_CLOUD` + Deterministic Gate | Merges synced cross-platform intakes (`WEB`, `ANDROID`, `APPLE`) + active `[AK-N]` facts into synchronized **Community Alerts (ID)**, **National Press Releases (ID)**, **Global SitReps (EN)**, and **Debunk Cards**, guarded by a synchronous **Deterministic Pre-Publish Safety Gate** (Zero-PII Leak Guard, Rumor Safety Guard, Peak Severity Invariant, Gap Disclosure + Commander Sign-Off) and `.md` SitRep export with receipt. |
| **5. Hyperlocal Translation, Streaming & Crisis Radio TTS** | `PREFER_IN_CLOUD` + `ResponseModality.AUDIO` | Citizens and responders translate Community Alerts into **Basa Sunda**, **Basa Jawa**, **English**, **日本語**, **한국어**, or **العربية** with deterministic numeric preservation (`verifyTranslationNumericSafety`), stream format adaptations, or generate single/2-voice loudspeaker audio via Gemini TTS (`gemini-3.8-flash-tts` / `gemini-3.8-flash-lite-tts` with `.wav` export and automatic on-device Web Speech API fallback offline). |

```text
Raw Field Report / Rumor
  │
  ▼ [1. Local Privacy Firewall - ONLY_ON_DEVICE]
  │   Masks names, phones, @handles, street addresses on-device
  ▼
Cloud-Safe Sanitized Text + Bounded Human Area Knowledge ([AK-1..N])
  │
  ├─► Signal lost (Offline Field Mode) ─► ONLY_ON_DEVICE Nano or deterministic draft ─► Firestore offline queue -> Cloud upgrade on reconnect
  │
  ├─► Within local token budget & model ready ─► On-Device Triage (Chrome Nano / Android AICore / Apple Foundation Models)
  │
  └─► Over budget, unavailable, or multi-report:
        ├─► Cloud Fast Triage (gemini-3.5-flash-lite)
        ├─► Grounded Rumor Check (gemini-3.8-flash + Google Search -> fast fallback on 429/500/503/504)
        ├─► 4-Audience Broadcast Studio -> Deterministic Safety Gate -> Publish + SitRep (.md) Export
        └─► Closed-Loop Field Verification -> Local PII Scrub Reply -> Promote to [AK-N] -> Unified Audit Trail (.md)
```

---

## Summary of What Was Built During #BuildHybridAI 2026

SigapWire was created entirely from scratch during the **Nov 11 - Nov 30, 2026** hackathon submission period:
- **Flagship Web Command, Broadcast Studio, Public Crisis Wire & Ops Memory (`web/`):** Full Vite + React 19 + TypeScript strict + Tailwind CSS v4 app with WCAG AA light/dark tokens ([DESIGN.md](./DESIGN.md)), live token-budget router meter, live Hybrid Routing & Privacy Scorecard ([hybridScorecard.ts](./web/src/lib/hybridScorecard.ts)), offline drill simulation, deterministic pre-publish safety gate ([broadcastSafetyGate.ts](./web/src/lib/broadcastSafetyGate.ts)), closed-loop verification tasks & Area Knowledge context formatter ([areaKnowledgeContext.ts](./web/src/lib/areaKnowledgeContext.ts)), derived unified hybrid audit trail ([auditTrail.ts](./web/src/lib/auditTrail.ts)), client-side EXIF-stripped SHA-256 Crisis Provenance Seals (`SIGAP-D{n}-{HEX6}`) + atomic `writeBatch` publishing ([crisisProvenance.ts](./web/src/lib/crisisProvenance.ts)), Karrot-inspired hyperlocal dialect/visitor translation banner with numeric safety verification ([crisisTranslation.ts](./web/src/lib/crisisTranslation.ts)), Firebase AI Logic Gemini TTS radio/loudspeaker synthesis + WAV encoder ([audioWav.ts](./web/src/lib/audioWav.ts)), 32-scenario 4-pillar Hybrid Crisis Readiness Benchmark ([hybridEvalSuite.ts](./web/src/lib/hybridEvalSuite.ts) -> [EVAL_REPORT.md](./docs/EVAL_REPORT.md)), Architecture Decision Record ([ADR-001](./docs/decisions/ADR-001-crisis-provenance-and-hybrid-eval.md)), and Node unit tests (`web/tests/*.test.ts`).
- **Android Field Companion (`android/`):** Kotlin + Jetpack Compose Material 3 app (live-verified on physical **Samsung Galaxy A55 5G / `SM-A556E`, Android 17**) with camera/gallery photo intake, `FirebaseAIOnDevice` readiness/download tracking, local PII scrubber, bounded `[AK-N]` prompt injection, inline `Open Field Checks (N)` field replies, inline Stage 3 Google Search Grounding error/offline guidance, auth-sequenced cold-start Firestore listeners, offline Firestore persistence, synced Light/Dark edge-to-edge bars (`DESIGN.md` WCAG AA tokens, [Audit 004](./anti-slop/audit-004-2026-11-27.md)), and 5/5 JUnit tests (`HybridAiEngineTest.kt`).
- **Apple Briefing Companion (`apple/`):** Native SwiftUI app (`iOS 26+` and `macOS 26+` with Swift 6 strict concurrency) integrating `FirebaseAILogic` `.hybridModel(primary:secondary:)` + `FoundationModels.SystemLanguageModel.default`, inline `Open Field Checks (N)` field replies with local PII scrubbing, bounded `[AK-N]` context injection, streaming reader adaptation, and native `ShareLink`.
- **Shared Firebase Security & Indexing:** Strict schema-validated [firestore.rules](./firestore.rules) across all 5 collections and [firestore.indexes.json](./firestore.indexes.json).

---

## Monorepo Structure

```text
sigapwire/
├── AGENTS.md                           # #BuildHybridAI 2026 rules, verification commands & boundaries
├── DESIGN.md                           # WCAG AA verified light/dark color tokens & typography system
├── LICENSE                             # MIT open-source license
├── firebase.json                       # Hosting & Firestore config
├── firestore.rules                     # Schema-validated rules (incidents, intakes, dispatches, verification_tasks, area_knowledge)
├── firestore.indexes.json              # Composite indexes for Firestore queries
├── anti-slop/                          # Delivery gate & WCAG contrast audit records
├── docs/
│   ├── decisions/ADR-001-crisis-provenance-and-hybrid-eval.md # Architecture Decision Record
│   ├── ideas/broadcast-safety-gate.md  # Deterministic Pre-Publish Safety Gate specification
│   ├── ideas/closed-loop-ops-memory.md # Closed-Loop Ops Memory & Audit specification
│   ├── ideas/crisis-provenance-and-eval.md # Crisis Provenance Seal & Readiness Benchmark spec
│   ├── ideas/sigapwire.md              # Problem statement, assumptions & scope
│   ├── EVAL_REPORT.md                  # Reproducible 32/32 Hybrid Crisis Readiness Benchmark report
│   └── architecture.md                 # Tri-platform routing matrix & shared Firestore schema
├── web/                                # Flagship Web App (Vite, React 19, TypeScript, Tailwind v4, Firebase JS SDK v13)
├── android/                            # Field Companion (Kotlin, Jetpack Compose, Material 3, Firebase Android BoM)
└── apple/                              # Briefing Companion (SwiftUI iOS 26+ / macOS 26+, FirebaseAILogic / FoundationModels)
    └── SigapWireApple.xcodeproj/       # Pre-generated iOS/macOS Xcode project (from apple/project.yml)
```

---

## Local Setup & Reproduction Instructions

### 1. Web Flagship (`web/`)

**Prerequisites:**
- Node.js 20+
- Chrome Desktop v139+ with `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` enabled for local Gemini Nano execution (other browsers automatically fall back to Cloud Gemini via `PREFER_ON_DEVICE`).
- A Firebase project with **AI Logic (Gemini Developer API)**, **App Check**, **Cloud Firestore**, **Remote Config**, and **Anonymous Authentication** enabled.

**Configure & run locally:**
```bash
cd web
cp .env.example .env.local
# Fill in your Firebase Web App credentials in web/.env.local (gitignored)
npm install
npm run dev
```
1. Keep `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN=true` for local `localhost` / `127.0.0.1` testing. On production Hosting builds, [web/src/lib/firebase.ts](./web/src/lib/firebase.ts) automatically disables debug tokens and uses `ReCaptchaV3Provider` (`VITE_FIREBASE_RECAPTCHA_SITE_KEY`).
2. Open `http://localhost:5173`, copy the printed `AppCheck debug token` UUID from Chrome DevTools Console, and register it in **Firebase Console > App Check > Apps > Manage debug tokens**.
3. Click **Download Nano** / **Prepare On-Device Gemini Nano** in the top bar (if not already downloaded) to enable offline on-device inference.

**Verify tests, 32-scenario eval benchmark, typecheck, production build & deploy:**
```bash
cd web
npm test && npm run eval && npm run typecheck && npm run build
cd ..
npx -y firebase-tools@latest login
npx -y firebase-tools@latest deploy --only firestore:rules,hosting --project <YOUR_FIREBASE_PROJECT_ID>
```

### 2. Android Field Companion (`android/`) - Build & Deploy to Your Phone

**Prerequisites:**
- **JDK 17** installed locally
- **Android SDK** (`platform-tools` / `adb`) installed via Android Studio or `android` CLI
- An **Android 8.0+ (`minSdk 26`)** physical phone with a USB cable (recommended for testing real hardware fallback/AICore), or a hardware-accelerated Android emulator

**Step 1: Connect Firebase (optional for local-only PII testing; required for Cloud fallback & Firestore sync)**
1. In Firebase Console (**Project Settings > General > Your apps > Add app > Android**), register package name **`dev.sigapwire.android`**.
2. Download `google-services.json` and place it at `android/app/google-services.json` (gitignored; template in [google-services.json.example](./android/app/google-services.json.example)).
   - *Local-only preview:* Even without `google-services.json`, the app compiles and runs Stage 1 on-device PII redaction right away while displaying a non-blocking setup notice.

**Step 2: Run unit tests & build the debug APK**
- **macOS / Linux:**
  ```bash
  cd android
  ./gradlew testDebugUnitTest assembleDebug
  ```
- **Windows PowerShell:**
  ```powershell
  cd android
  $env:JAVA_HOME = "C:\Program Files\Java\jdk-17"
  .\gradlew.bat testDebugUnitTest assembleDebug
  ```
The built APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.

**Step 3: Deploy directly to your Android phone via USB Debugging**
1. On your Android phone, enable **Developer options** (*Settings > About phone > Software information > tap Build number 7 times*), then enable **Settings > Developer options > USB debugging**.
2. Connect your phone via USB, verify ADB sees it, and tap **Allow** (check *Always allow from this computer*) on the phone prompt:
   ```bash
   adb devices -l
   ```
3. Install and launch the app directly onto your phone:
   ```bash
   adb install -r android/app/build/outputs/apk/debug/app-debug.apk
   adb shell am start -n dev.sigapwire.android/.MainActivity
   ```
   *(On Windows, if `adb` is not on your `PATH`, use `"$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"`.)*

**Step 4: Register the App Check Debug Token (for live Cloud Gemini & Firestore)**
1. After launching the app once with `google-services.json` present, read the generated debug UUID from Logcat:
   - **macOS / Linux:** `adb logcat -d | grep DebugAppCheckProvider`
   - **Windows PowerShell:** `adb logcat -d | Select-String DebugAppCheckProvider`
2. In **Firebase Console > App Check > Apps**, click the **`⋮` menu** next to `dev.sigapwire.android` -> **Manage debug tokens** -> **Add debug token**, paste the UUID, and click **Save**.
   - You do **not** need to register Play Integrity for local USB debug builds (`DebugAppCheckProviderFactory` exchanges your debug token directly).
   - Stage 3 live rumor fact-checking (`Tool.googleSearch()`) requires active Google Search Grounding quota on your linked Gemini API project (`https://ai.dev/rate-limit`). Cloud model IDs (`cloud_model_fast`, `cloud_model_synthesis`) can also be updated anytime via **Firebase Remote Config** without rebuilding the APK.

**Step 5: Verify hybrid hardware behavior on device**
- **Flagship AICore devices (Pixel 9/10, Galaxy S25+):** `PREFER_ON_DEVICE` runs Gemini Nano on-device (`0` cloud tokens used) for short field triage and local privacy redaction.
- **Mid-range Android hardware (verified live on Samsung Galaxy A55 5G / `SM-A556E`, Android 17):** Detects `No Local Nano -> Auto Cloud Fallback Active`, keeps Stage 1 PII redaction and Firestore offline queuing strictly on-device, automatically injects active `[AK-N]` Area Knowledge from Firestore, syncs `Open Field Checks` and `Live Alerts`, and falls back to Cloud Gemini for Stage 2 triage cleanly.

### 3. Apple Briefing Companion (`apple/`)

Targets **iOS 26+** and **macOS 26+ (Apple Silicon)** using `FirebaseAILogic` (`firebase-ios-sdk` v12.13.0+) with `.hybridModel(primary: FirebaseAI.SystemLanguageModel.default, secondary: cloudModel)` and native `FoundationModels.SystemLanguageModel.default`.

1. In Firebase Console (**Project Overview > Add app > Apple**), register bundle ID **`dev.sigapwire.apple`**.
2. Place `GoogleService-Info.plist` at `apple/GoogleService-Info.plist` (gitignored; template in [GoogleService-Info.plist.example](./apple/GoogleService-Info.plist.example)).
3. Open [apple/SigapWireApple.xcodeproj](./apple/SigapWireApple.xcodeproj) in Xcode 26+ (`open apple/SigapWireApple.xcodeproj`) or verify unsigned builds from CLI:
   ```bash
   xcodebuild -project apple/SigapWireApple.xcodeproj -scheme SigapWireApple_macOS -destination 'platform=macOS' CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO CODE_SIGN_ALLOWED=NO build
   xcodebuild -project apple/SigapWireApple.xcodeproj -scheme SigapWireApple_iOS -destination 'generic/platform=iOS Simulator' CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO CODE_SIGN_ALLOWED=NO build
   ```
4. Enable **System Settings > Apple Intelligence & Siri** on Apple Silicon to run `SystemLanguageModel.default` on-device (otherwise `HybridModel` falls back to `gemini-3.5-flash-lite` in-cloud).
5. Copy `[AppCheckCore] App Check debug token: '...'` from the Xcode console and register that UUID in **Firebase Console > App Check > Apps > Manage debug tokens**.

---

## Security, Privacy & Open-Source License

- **Local Privacy Invariant:** Raw unredacted user text containing victim phone numbers, `@handles`, honorific names, or street addresses is scrubbed on-device (`ONLY_ON_DEVICE` + deterministic regex guard) before leaving the client.
- **No Committed Secrets:** `web/.env.local`, `android/app/google-services.json`, and `apple/GoogleService-Info.plist` are gitignored; only `.example` templates are committed.
- **Schema-Enforced Firestore Rules:** [firestore.rules](./firestore.rules) enforces explicit allow-listed/required field sets, length caps, owner UID immutability, and `answerPiiRedactedLocally == true` on field verification replies.
- **License:** Licensed under the **MIT License**. See [LICENSE](./LICENSE).
