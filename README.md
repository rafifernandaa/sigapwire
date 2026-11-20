# SigapWire

**Unified Crisis Clarity & Rumor Verification Engine powered by Firebase AI Logic Hybrid Inference.**

SigapWire compresses the delay between raw, chaotic disaster field updates and viral rumors into verified, multi-audience public broadcasts for local Indonesian communities, national media, and global humanitarian channels.

> **Disclaimer:** SigapWire is an independent open-source project built for the **#BuildHybridAI 2026** hackathon. Bundled disaster scenarios are synthetic drills and do not represent official agency statements.

---

## Why Hybrid AI?

Disaster communication breaks under both cloud-only and on-device-only AI:
- **Cloud-only fails** when responders lose signal in impact zones, when citizens refuse to upload private WhatsApp chats or victim contact details to cloud servers, and when high-frequency triage burns quota.
- **On-device-only fails** when combining multiple field reports (beyond 4k to 9k token windows), verifying breaking rumors against live public news/agency feeds, or running on mid-range field Android hardware.

SigapWire deliberately uses all four **Firebase AI Logic** inference modes across one shared Firebase backend (**AI Logic + App Check + Firestore + Anonymous Auth + Remote Config + Hosting**):

| Stage | Firebase AI Logic Mode | Runtime Behavior |
| :--- | :--- | :--- |
| **1. Local Privacy Firewall** | `ONLY_ON_DEVICE` | Strips victim names, phone numbers, chat handles, and street addresses locally before any cloud sync or verification, showing a live **Stayed Local vs. Sent to Cloud** diff. |
| **2. Rapid Field & Rumor Triage** | `PREFER_ON_DEVICE` | Extracts structured JSON (severity, hazard type, needs, verification gaps, panic signals) from messy Bahasa Indonesia/English text and optional JPEG/PNG images locally on Chrome Desktop Gemini Nano / flagship devices, or gracefully falls back to Cloud Gemini (`gemini-3.5-flash-lite`) on mid-range devices such as Samsung Galaxy A55. |
| **3. Live Rumor Fact-Check** | `ONLY_IN_CLOUD` + `{ googleSearch: {} }` | Escalates only the locally sanitized claim to Cloud Gemini (`gemini-3.8-flash`) with Google Search Grounding, enforcing an honest `UNVERIFIED_DEVELOPING` verdict when authoritative confirmation is absent, and displaying clickable sources plus the required Google Search suggestions widget. |
| **4. 4-Audience Broadcast Synthesis** | `ONLY_IN_CLOUD` | Merges multiple synced field and rumor intakes across platforms into synchronized **Community Action Alerts (ID)**, **National Media Press Releases (ID)**, **Global Humanitarian SitReps (EN)**, and **Bilingual Debunk Cards**. |
| **5. Resilient Reader Adaptation** | `PREFER_IN_CLOUD` (Streaming) | Readers on the Live Public Crisis Wire can adapt any bulletin into plain Indonesian, 3-bullet global wire notes, or a 25-second community radio script, falling back to on-device Gemini Nano / Apple Foundation Models if connectivity drops. |

---

## Monorepo Structure

```text
sigapwire/
├── DESIGN.md                  # WCAG AA verified design tokens & visual system
├── LICENSE                    # MIT open-source license
├── firebase.json              # Hosting & Firestore config
├── firestore.rules            # Default-deny schema-validated Security Rules
├── firestore.indexes.json     # Composite indexes for incidents, intakes, dispatches
├── docs/
│   ├── ideas/sigapwire.md     # Problem statement, assumptions, MVP scope
│   └── architecture.md        # Tri-platform routing matrix & shared Firestore schema
├── web/                       # Flagship Web App (Vite + React + TS + Firebase AI Logic JS SDK)
├── android/                   # Field Companion (Kotlin + Jetpack Compose + Hybrid Android SDK)
└── apple/                     # Briefing Companion (SwiftUI iOS/macOS + Apple Foundation Models)
```

---

## Quick Start: Web Flagship (`web/`)

### 1. Prerequisites
- Node.js 20+
- Chrome Desktop v139+ with `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` enabled for local on-device Gemini Nano testing (other browsers automatically use Cloud fallback via `PREFER_ON_DEVICE`).
- A Firebase project on the free Spark tier with **AI Logic (Gemini Developer API)**, **App Check**, **Cloud Firestore**, and **Anonymous Authentication** enabled.

### 2. Configure Local Environment
```bash
cd web
cp .env.example .env.local
```
Fill in your Firebase Web App credentials in `web/.env.local` (this file is gitignored and never committed). Leave `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN=true` for local testing.

### 3. Run Locally
```bash
npm install
npm run dev
```
Open `http://localhost:5173` in Chrome Desktop:
1. Open Chrome DevTools Console on first load and copy the printed `AppCheck debug token` UUID.
2. Register that UUID in **Firebase Console > Security > App Check > Apps > Manage debug tokens**.
3. Click **Download Nano** / **Prepare On-Device Gemini Nano** in the top bar (if not already downloaded) to enable offline on-device inference.

---

## Quick Start: Android Field Companion (`android/`)

### 1. Register Android App in Firebase Console
1. In your Firebase project (**Project Overview > Add app > Android**), register package name **`dev.sigapwire.android`**.
2. Download `google-services.json` and place it at `android/app/google-services.json` (this file is gitignored; see [google-services.json.example](android/app/google-services.json.example)).

### 2. Build & Install Debug APK
```powershell
cd android
$env:JAVA_HOME = "C:\Program Files\Java\jdk-17"
.\gradlew.bat assembleDebug
```
Install `android/app/build/outputs/apk/debug/app-debug.apk` onto your Android phone (e.g., Samsung Galaxy A55 via USB Debugging + `adb install -r`) or emulator.

### 3. Register Android App Check Debug Token
1. Launch **SigapWire** on your Android device and filter Logcat for `DebugAppCheckProvider`:
   ```powershell
   adb logcat -s DebugAppCheckProvider
   ```
2. Copy the printed UUID debug secret and register it in **Firebase Console > Security > App Check > Apps > SigapWire Android > Manage debug tokens**.
3. On flagship AICore devices (Pixel 9/10+, Galaxy S25+), `PREFER_ON_DEVICE` runs Gemini Nano directly on-device; on mid-range hardware like the Samsung Galaxy A55, the SDK detects `OnDeviceModelStatus.UNAVAILABLE` and automatically routes triage to Cloud Gemini while local PII redaction and Firestore offline queuing continue working on-device.

---

## License

MIT License. See [LICENSE](./LICENSE).
