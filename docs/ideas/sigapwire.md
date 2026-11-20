# SigapWire — Unified Crisis Clarity Engine

## Problem Statement
**How might we** compress the golden hour between messy, low-connectivity disaster field reports and viral rumors into **verified, clear, multi-audience crisis broadcasts** (for Indonesian communities, national media, and global humanitarian/news channels)—using **Firebase AI Logic hybrid inference** so every responder, comms officer, and reader gets instant private/offline AI where supported and seamless cloud intelligence everywhere else?

## Recommended Direction
Build **SigapWire**, a tri-platform crisis information engine backed by a single Firebase project (**AI Logic + App Check + Firestore + Anonymous Auth + Hosting**) that solves three core disaster-communication bottlenecks through **one unified intake-to-broadcast pipeline**:

1. **One Shared Intake Shell (2 Modes, 90% Shared UI & Schema):**
   - **Mode 1 — Digest Field Report:** Turns messy raw Bahasa Indonesia/mixed field notes + an optional damage photo into a clean, structured **Situation Card** (JSON: hazard type, location, severity, infrastructure impact, urgent needs, verification gaps).
   - **Mode 2 — Verify Rumor:** Extracts factual claims & panic/manipulation cues from a forwarded WhatsApp message/screenshot, strips private sender/victim PII locally, and runs live **Search-grounded** cloud verification (`VERIFIED`, `MISLEADING`, or `UNVERIFIED_DEVELOPING` with clickable citations—never hallucinating certainty).

2. **Purposeful Use of All 4 Firebase AI Logic Hybrid Inference Patterns:**
   - **`ONLY_ON_DEVICE` (Local Privacy Firewall):** Strips victim names, phone numbers, WhatsApp group/sender handles, and sensitive personal identifiers *locally* before cloud calls, displaying a live **"Stayed Local vs. Sent to Cloud" Redaction Diff**.
   - **`PREFER_ON_DEVICE` (Offline / Zero-Cost Triage):** Runs local single-turn JSON extraction & claim triage on **Chrome Desktop (Gemini Nano)** and **Apple Silicon Mac/iOS Simulator (Apple Foundation Models)**, while **Samsung Galaxy A55 (Android)** demonstrates real automatic cloud fallback (`IN_CLOUD`) + Firestore offline queuing—displaying a live `inferenceSource` telemetry badge on every card.
   - **`ONLY_IN_CLOUD` + Google Search Grounding (Heavy Synthesis & Truth Check):** Merges multiple synced field cards (beyond 4k–9k local token limits), verifies scrubbed rumor claims against live public sources, and generates **4 synchronized outputs in one click**:
     1. **Community Action Alert** *(Plain, calm Bahasa Indonesia — What happened / Do now / Avoid)*
     2. **National Media Press Release** *(Indonesian journalistic format)*
     3. **Global Humanitarian SitRep** *(English — OCHA / ReliefWeb / international press format)*
     4. **Shareable Debunk Card** *(Bilingual ID/EN WhatsApp-ready card with source links)*
   - **`PREFER_IN_CLOUD` (Resilient Public Reader):** Readers on the live Public & Global Crisis Wire can simplify or adapt bulletins in-cloud when online, falling back seamlessly to on-device Gemini Nano if connectivity degrades.

3. **Role-Specific Tri-Platform Split:**
   - **Web Flagship (Vite + React + TypeScript + Tailwind, Chrome Desktop v139+):** Command & Newsroom Desk (true offline on-device Gemini Nano for text + JPEG/PNG image + JSON) + Live Public & Global Crisis Wire deployed on Firebase Hosting.
   - **Android Field Companion (Kotlin + Jetpack Compose, Samsung Galaxy A55):** Real `firebase-ai` + `firebase-ai-ondevice` (`PREFER_ON_DEVICE`) field photo & rumor capture proving graceful mid-range device cloud fallback + Firestore offline persistence + live alerts feed (2 screens).
   - **Apple Rapid Briefing Companion (SwiftUI Universal iOS Simulator + macOS, MacBook Air M5):** Real `FirebaseAILogic` `HybridModel(primary: SystemLanguageModel.default, secondary: cloudModel)` running true on-device Apple Foundation Models for text-only offline briefing simplification & quick text report/rumor intake synced to Firestore (2 screens).

## Key Assumptions to Validate (Days 1–2)
- [ ] **Must Be True — Bahasa Indonesia quality on local models:** Chrome Gemini Nano and Apple Foundation Models reliably parse messy Indonesian/mixed field text into valid JSON schemas *(Validate on Day 1 with 5 synthetic Indonesian quake/flood/hoax samples; use English JSON schema keys with clear ID/EN string guidance if needed)*.
- [ ] **Must Be True — Local runtime readiness on target hardware:** Chrome v139+ Prompt API multimodal flag + Gemini Nano download works on Mac/Windows, and Apple Intelligence + Xcode iOS Simulator/macOS runs `SystemLanguageModel.default` on MacBook Air M5 *(Verify Day 1 before full UI build)*.
- [ ] **Must Be True — Search Grounding honesty:** Cloud Gemini with Google Search Grounding reliably outputs `UNVERIFIED_DEVELOPING` when a breaking rumor lacks official confirmation instead of inventing a false debunk *(Validate with strict prompt guardrails + synthetic breaking rumor tests on Day 2)*.
- [ ] **Should Be True — App Check across 3 clients:** Debug providers work cleanly for Web, Android, and Apple against the shared Firebase project without committing debug tokens into the public repository.

## MVP Scope (11-Day Sprint: Nov 19 → Nov 30, 2026)
- **Days 1–2 — Foundation & Validation Spikes:** Shared Firebase project setup (AI Logic, App Check, Firestore, Anonymous Auth, Hosting), Firestore schema & security rules, and Day-1 model validation spike in Chrome Desktop (Gemini Nano + Cloud Gemini).
- **Days 3–5 — Milestone 1: Web Flagship (`web/`):**
  - Screen 1: **Command Desk** (Shared Intake toggle: `Field Report` vs `Verify Rumor`, model download progress UI, live `ON_DEVICE` / `IN_CLOUD` badge, Local PII Redaction Diff, offline mode support).
  - Screen 2: **Broadcast Studio** (Select synced intakes → 1-click Cloud synthesis into Community Alert [ID], Press Release [ID], Global SitRep [EN], and Debunk Card).
  - Screen 3: **Live Public & Global Crisis Wire** (Public URL on Firebase Hosting with ID/EN switcher + resilient `PREFER_IN_CLOUD` reader simplification).
- **Days 6–7 — Milestone 2: Android Field Companion (`android/`):**
  - Screen 1: **Quick Field & Rumor Capture** (Camera/photo picker + raw note, `PREFER_ON_DEVICE` hybrid call showing live A55 fallback badge, offline queue indicator).
  - Screen 2: **Live Verified Alerts Feed** (Real-time Firestore sync from Web dispatches).
- **Days 8–9 — Milestone 3: Apple Briefing Companion (`apple/`, Day-8 Gate):**
  - *Gate Rule:* Start only if Web + Android work end-to-end cleanly.
  - Screen 1: **Executive / Journalist Offline Briefing Feed** (Synced dispatches + real on-device Apple Foundation Models streaming brief/quote/readability adapter).
  - Screen 2: **Quick Text Report / Rumor Intake** (Text-only hybrid intake synced to Firestore).
- **Days 10–11 — Milestone 4: Polish, Docs & 3-Minute Demo Video:**
  - End-to-end UI polish, realistic synthetic Indonesian disaster scenario pack, MIT open-source license, judge-ready README, and tightly scripted 2:50 YouTube demo video showcasing offline Chrome Nano, Samsung A55 cloud fallback, MacBook Air M5 Apple Foundation Models, and the live Public Crisis Wire.

## Not Doing (and Why)
- **No official BNPB branding, internal agency data, or government API scraping** — Keeps the project 100% compliant as an independent open-source hackathon submission using realistic synthetic/public scenarios.
- **No interactive GIS/polygon hazard mapping or drone/satellite overlays** — High build cost that dilutes focus from our hybrid AI architecture.
- **No multi-turn chatbot or Gemini Live audio/video streaming** — Not supported in Firebase AI Logic hybrid mode; single-turn structured JSON plays directly to on-device strengths.
- **No image input on the Apple client's on-device path** — Apple Foundation Models on-device is text-only; keeping Apple text-first respects platform boundaries while Web & Android showcase multimodal image intake.
- **No complex RBAC, multi-org admin, or paid SMS/WhatsApp Bot APIs** — One-click share cards + live public wire prove real distribution with zero third-party billing/approval bottlenecks.
- **No App Store / Google Play publishing** — Deliver hosted Web URL + Android APK + Xcode SwiftUI project and clear reproduction steps for judges.

## Open Questions
- Confirm local Firebase CLI login & target Firebase project creation (or create a fresh Spark-tier project in Firebase Console using Gemini Developer API).
- Verify exact Android SDK / Gradle tooling on Windows and Xcode version on MacBook Air M5 ahead of Milestones 2 and 3.
