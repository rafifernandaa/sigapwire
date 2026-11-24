# AGENTS.md - SigapWire Project Context & Rules

## Project Overview
**SigapWire** is a Unified Crisis Clarity & Rumor Verification Engine built for the **#BuildHybridAI 2026** hackathon (`https://firebasehybridaihackathon.devpost.com/`). It bridges Web Command (`web/`), Android Field (`android/`), and Apple Briefing (`apple/`) clients over one Firebase backend using **Firebase AI Logic hybrid inference** (on-device Gemini Nano / Apple Foundation Models + Cloud Gemini with Google Search Grounding).

## #BuildHybridAI 2026 Judging & Submission Requirements
Keep all architectural decisions, features, and docs aligned with the official hackathon criteria:

1. **Judging Criteria:**
   - **Technological Implementation:** Real runtime usage of Firebase AI Logic hybrid inference imported and called in code (`ONLY_ON_DEVICE`, `PREFER_ON_DEVICE`, `ONLY_IN_CLOUD`, `PREFER_IN_CLOUD`, and Apple `HybridModel`) across platforms.
   - **Design:** Coherent, complete, accessible end-to-end product (`DESIGN.md` tokens, zero AI slop, WCAG AA contrast, 44px/44dp/44pt tap targets), not an unpolished proof-of-concept.
   - **Potential Impact:** Credible, concrete crisis communication workflow anchored in real field constraints (PII privacy, offline zone loss, unverified rumor containment, closed-loop verification).
   - **Quality of the Idea:** Non-obvious hybrid AI architecture where deterministic safety authorities, on-device privacy/triage, and cloud grounding/synthesis complement each other cleanly.
2. **Submission Checklist:**
   - Public GitHub repository with visible open-source MIT `LICENSE` (`LICENSE`).
   - All source code, setup instructions (`README.md`), and runtime Firebase AI Logic calls included.
   - Live hosted Web URL (`firebase deploy --only hosting`) + English/subtitled YouTube demo video (`<= 3 minutes`) showing live hybrid on-device/cloud execution.

## Monorepo Structure
- `web/` - Flagship Command & Broadcast Web App (Vite, React 19, TypeScript strict, Tailwind CSS v4, Firebase JS SDK v13)
- `android/` - Field Companion (Kotlin, Jetpack Compose, Material 3, Firebase Android BoM / `FirebaseAIOnDevice`)
- `apple/` - Briefing Companion (SwiftUI iOS 26+ & macOS 26+, Swift 6 strict concurrency, `firebase-ios-sdk` v12.13.0+ `FirebaseAILogic` / `FoundationModels`)
- `firestore.rules`, `firestore.indexes.json`, `firebase.json` - Firebase security rules, indexes, Hosting config
- `DESIGN.md` - Verified light/dark color tokens, typography, tap target & contrast standards
- `docs/` - Architecture matrix (`docs/architecture.md`) and refined feature specs (`docs/ideas/*.md`)

## Commands & Verification
- **Web (`cd web`):**
  - `npm test` (`node --test tests/*.test.ts`)
  - `npm run typecheck` (`tsc --noEmit`)
  - `npm run build` (`tsc -b && vite build`)
  - `npm run dev` (local Vite dev server)
- **Apple (`cd apple` or repo root):**
  - `xcodebuild -project apple/SigapWireApple.xcodeproj -scheme SigapWireApple_macOS -destination 'platform=macOS' CODE_SIGN_ALLOWED=NO build`
  - `xcodebuild -project apple/SigapWireApple.xcodeproj -scheme SigapWireApple_iOS -destination 'generic/platform=iOS Simulator' CODE_SIGN_ALLOWED=NO build`
- **Android (`cd android`, requires JDK 17):**
  - `./gradlew testDebugUnitTest` (or `.\gradlew.bat testDebugUnitTest` on Windows)
  - `./gradlew assembleDebug`
- **Formatting Check:** Scan `AGENTS.md`, `README.md`, `docs/`, `web/src`, `web/tests`, `apple/SigapWireApple`, `android/app/src` for Unicode em dashes (`\u2014`) -> must return `EM_DASH_HITS: 0`.

## Non-Negotiable Conventions & Boundaries
1. **Zero Em Dashes:** Never use U+2014 (`\u2014`) in UI copy, prompts, docs, tests, or code comments.
2. **Touch & Contrast Targets:** Every interactive control must meet `min-h-[44px]` (Web), `minHeight: 44` (Apple), and `heightIn(min = 44.dp)` (Android). Follow `DESIGN.md` tokens only.
3. **Never Fabricate Telemetry:** Compute all counts, latencies, redactions, and inference badges strictly from live runtime/Firestore state. Keep synthetic drill scenarios labeled `SYNTHETIC DRILL`.
4. **Pure Shared Testable Modules (`web/src/lib/`):** Pure TypeScript modules imported by `node --test` (`piiScrubber.ts`, `broadcastSafetyGate.ts`, `areaKnowledgeContext.ts`, `auditTrail.ts`, `dispatchExport.ts`) must avoid Vite/Firebase/DOM side effects and use explicit `.ts` extensions on relative imports.
5. **Bounded On-Device Prompts:** Always enforce conservative token/character caps (`2200` est. tokens on Web, `1600` est. tokens on Android & Apple; Area Knowledge capped at `<= 8` facts / `1,200` chars on Web and `<= 6` facts / `900` chars on mobile).
6. **Security Rules Authority:** Always delegate any creation or edit of `firestore.rules` to the `firestore-rules-author` subagent. Keep schema field lists explicit (`hasOnlyAllowedFields` / `hasRequiredFields`) and never persist client-only UI flags (such as `pendingSync`) to Firestore.
7. **Secrets Protection:** Never commit `web/.env.local`, `apple/GoogleService-Info.plist`, `android/app/google-services.json`, raw API keys, or App Check debug UUIDs. Keep `apple/SigapWireApple.xcodeproj/project.pbxproj` team/signing settings clean when adding Swift logic inside existing `.swift` files.
