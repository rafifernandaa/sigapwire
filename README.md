# SigapWire

**Unified Crisis Clarity & Rumor Verification Engine powered by Firebase AI Logic Hybrid Inference.**

SigapWire compresses the delay between raw, chaotic disaster field updates and viral rumors into verified, multi-audience public broadcasts for local Indonesian communities, national media, and global humanitarian channels.

> **Disclaimer:** SigapWire is an independent open-source project built for the **#BuildHybridAI 2026** hackathon. Bundled disaster scenarios are synthetic drills and do not represent official agency statements.

---

## Why Hybrid AI?

Disaster communication breaks under both cloud-only and on-device-only AI:
- **Cloud-only fails** when responders lose signal in impact zones, when citizens refuse to upload private WhatsApp chats or victim contact details to cloud servers, and when high-frequency triage burns quota.
- **On-device-only fails** when combining multiple field reports (beyond 4k to 9k token windows), verifying breaking rumors against live public news/agency feeds, or running on mid-range field Android hardware.

SigapWire uses **Firebase AI Logic** (`GoogleAIBackend` Gemini Developer API + on-device Gemini Nano / Apple Foundation Models) across one shared Firebase backend (**AI Logic + App Check + Firestore + Anonymous Auth + Remote Config + Hosting**):

| Stage | Firebase AI Logic Mode | Runtime Behavior |
| :--- | :--- | :--- |
| **1. Local Privacy Firewall** | `ONLY_ON_DEVICE` | Strips victim names, phone numbers, chat handles, and street addresses locally before any cloud sync or verification, showing a live **Stayed Local vs. Cloud-Safe Output** diff. |
| **2. Rapid Field & Rumor Triage** | `PREFER_ON_DEVICE` | Extracts structured JSON (severity, hazard type, needs, verification gaps, panic signals) from messy Bahasa Indonesia/English text (and optional JPEG/PNG images on Web/Android) locally when within safe token budgets, or automatically escalates to Cloud Gemini (`gemini-3.5-flash-lite`) when over budget or unavailable on-device. |
| **3. Live Rumor Fact-Check** | `ONLY_IN_CLOUD` + `{ googleSearch: {} }` | Escalates only the locally sanitized claim to Cloud Gemini (`gemini-3.8-flash`) with Google Search Grounding (and automatic fallback to `gemini-3.5-flash-lite` on `429` quota or `500`/`503`/`504` high-demand spikes), enforcing an honest `UNVERIFIED_DEVELOPING` verdict when authoritative confirmation is absent. |
| **4. 4-Audience Broadcast Synthesis** | `ONLY_IN_CLOUD` | Merges synced cross-platform field and rumor intakes (`WEB`, `ANDROID`, `APPLE`) into synchronized **Community Alerts (ID)**, **National Press Releases (ID)**, **Global SitReps (EN)**, and **Debunk Cards**, with live Hybrid Telemetry counters and one-click `.md` SitRep export. |
| **5. Resilient Reader Adaptation** | `PREFER_IN_CLOUD` (Streaming) | Readers on the Public Crisis Wire can adapt bulletins into plain Indonesian, 3-bullet English wire notes, or a 25-second community radio script, falling back to on-device Gemini Nano / Apple Foundation Models if connectivity drops, plus SitRep Markdown (`.md`) download. |

### Hybrid Routing Flow

```text
Raw Field Report / Rumor
  │
  ▼ [1. Local Privacy Firewall - ONLY_ON_DEVICE]
  │   Masks names, phones, @handles, street addresses on-device
  ▼
Cloud-Safe Sanitized Text
  │
  ├─► Within local token budget & model ready ─► On-Device Triage (Nano / Apple Intelligence)
  │
  └─► Over budget, unavailable, or multi-report:
        ├─► Cloud Fast Triage (gemini-3.5-flash-lite)
        ├─► Grounded Rumor Check (gemini-3.8-flash -> fast fallback on 429/500/503/504)
        └─► 4-Audience Broadcast Studio + Live Telemetry + SitRep (.md) Export
```

---

## Monorepo Structure

```text
sigapwire/
├── DESIGN.md                        # WCAG AA verified design tokens & visual system
├── LICENSE                          # MIT open-source license
├── firebase.json                    # Hosting & Firestore config
├── firestore.rules                  # Default-deny schema-validated Security Rules
├── firestore.indexes.json           # Composite indexes for incidents, intakes, dispatches
├── anti-slop/                       # Delivery gate & contrast audit records
├── docs/
│   ├── ideas/sigapwire.md           # Problem statement, assumptions, MVP scope
│   └── architecture.md              # Tri-platform routing matrix & shared Firestore schema
├── web/                             # Flagship Web App (Vite + React + TS + Firebase JS SDK v13)
├── android/                         # Field Companion (Kotlin + Jetpack Compose + Firebase AI Logic Android)
└── apple/                           # Briefing Companion (SwiftUI iOS/macOS + FirebaseAILogic / FoundationModels)
    └── SigapWireApple.xcodeproj/    # Pre-generated iOS/macOS Xcode project (from project.yml)
```

---

## Quick Start: Web Flagship (`web/`)

### 1. Prerequisites
- Node.js 20+
- Chrome Desktop v139+ with `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` enabled for local on-device Gemini Nano testing (other browsers automatically use Cloud fallback via `PREFER_ON_DEVICE`).
- A Firebase project with **AI Logic (Gemini Developer API)**, **App Check**, **Cloud Firestore**, **Remote Config**, and **Anonymous Authentication** enabled.

### 2. Configure Local Environment
```bash
cd web
cp .env.example .env.local
```
Fill in your Firebase Web App credentials in `web/.env.local` (this file is gitignored and never committed):
- Keep `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN=true` for local `localhost` / `127.0.0.1` testing. In [web/src/lib/firebase.ts](./web/src/lib/firebase.ts), debug tokens are automatically restricted to local dev hosts so production Hosting builds always use `ReCaptchaV3Provider` (`VITE_FIREBASE_RECAPTCHA_SITE_KEY`).

### 3. Run & Verify Locally
```bash
npm install
npm run dev
```
Open `http://localhost:5173` in Chrome Desktop:
1. Open Chrome DevTools Console on first load and copy the printed `AppCheck debug token` UUID.
2. Register that UUID in **Firebase Console > App Check > Apps > Manage debug tokens** (and configure reCAPTCHA v3 for production Hosting).
3. Click **Download Nano** / **Prepare On-Device Gemini Nano** in the top bar (if not already downloaded) to enable offline on-device inference.

To verify types and production build before deploying:
```bash
npm run typecheck && npm run build
```

---

## Quick Start: Android Field Companion (`android/`)

### 1. Register Android App in Firebase Console
1. In your Firebase project (**Project Overview > Add app > Android**), register package name **`dev.sigapwire.android`**.
2. Download `google-services.json` and place it at `android/app/google-services.json` (gitignored; see [google-services.json.example](./android/app/google-services.json.example)).

### 2. Run Unit Tests & Build Debug APK
With **JDK 17** configured:

On **macOS / Linux**:
```bash
cd android
./gradlew testDebugUnitTest
./gradlew assembleDebug
```

On **Windows PowerShell**:
```powershell
cd android
$env:JAVA_HOME = "C:\Program Files\Java\jdk-17"
.\gradlew.bat testDebugUnitTest
.\gradlew.bat assembleDebug
```
Install `android/app/build/outputs/apk/debug/app-debug.apk` onto your Android device or emulator (`adb install -r`). Unit tests in [HybridAiEngineTest.kt](./android/app/src/test/kotlin/dev/sigapwire/android/data/HybridAiEngineTest.kt) verify local PII redaction, token routing budgets, and transient cloud outage/quota matching (`429`, `500`, `503`, `504`).

### 3. Register Android App Check Debug Token
1. Launch **SigapWire** on your Android device and filter Logcat for `DebugAppCheckProvider`:
   ```bash
   adb logcat -s DebugAppCheckProvider
   ```
2. Copy the printed UUID debug secret and register it in **Firebase Console > App Check > Apps > Manage debug tokens**.
3. On flagship AICore devices, `PREFER_ON_DEVICE` runs Gemini Nano directly on-device; on mid-range hardware, the SDK detects `OnDeviceModelStatus.UNAVAILABLE` and routes triage to Cloud Gemini while local PII redaction and Firestore offline queuing stay on-device.

---

## Quick Start: Apple Briefing Companion (`apple/`)

The Apple companion (`apple/SigapWireApple/`) targets **iOS 26+** and **macOS 26+ (Apple Silicon)** using **`FirebaseAILogic`** (`firebase-ios-sdk` v12.13.0+) with `.hybridModel(primary: FirebaseAI.SystemLanguageModel.default, secondary: cloudModel)`, plus native `FoundationModels.SystemLanguageModel.default` support when running offline or without `GoogleService-Info.plist`.

### 1. Register Apple App & Attach `GoogleService-Info.plist`
1. In Firebase Console (**Project Overview > Add app > Apple**), register bundle ID **`dev.sigapwire.apple`**.
2. Download `GoogleService-Info.plist` and place it at `apple/GoogleService-Info.plist` (gitignored; see [GoogleService-Info.plist.example](./apple/GoogleService-Info.plist.example)).

### 2. Open & Build in Xcode
Open the checked-in project directly in Xcode 26+:
```bash
open apple/SigapWireApple.xcodeproj
```
*(If you modify [apple/project.yml](./apple/project.yml), regenerate the `.xcodeproj` with `cd apple && xcodegen generate`. Both `SigapWireApple_iOS` and `SigapWireApple_macOS` schemes build cleanly with `SWIFT_STRICT_CONCURRENCY: complete`.)*

### 3. Enable Apple Intelligence & Register App Check Debug Token
1. On macOS / iOS 26+ (Apple Silicon), enable **System Settings > Apple Intelligence & Siri** so `SystemLanguageModel.default` runs on-device (otherwise `HybridModel` automatically falls back to `gemini-3.5-flash-lite` in-cloud).
2. Run the app in Xcode and copy the console line:
   `[AppCheckCore] App Check debug token: '...'`
3. Register that UUID in **Firebase Console > App Check > Apps > Manage debug tokens**.
4. Note: Apple Foundation Models runs text-only inside a conservative 1,600-token safety router (inside Apple's 4,096-token window); larger multi-subdistrict dumps automatically escalate to Cloud Gemini after local `ONLY_ON_DEVICE` PII scrubbing. Both Quick Text Intake and Briefing Wire support one-tap Copy and native SwiftUI `ShareLink`.

---

## License

MIT License. See [LICENSE](./LICENSE).
