# DESIGN.md: SigapWire Visual & Interaction System

## 1. Identity & Personality

- **Product:** SigapWire, an independent open-source crisis information clarity and rumor verification platform.
- **Visual Character:** **Crisis Newsroom & Emergency Dispatch Wire.** Inspired by international wire desks and civil defense situation boards: calm under pressure, scannable in daylight or blackout conditions, typographically authoritative, and visibly honest about what ran on-device vs. in-cloud.
- **Anti-Default Commitment:** No purple-blue AI gradients, no glowing orbs, no decorative capsule pills ("AI Powered"), no fake telemetry numbers, no invented avatars or testimonials, and no em dashes in UI copy.

## 2. Liveliness Dials

| Dial | Setting | What It Means for SigapWire |
| :--- | :--- | :--- |
| **ENERGY** | **2 (Balanced, Authoritative)** | Urgent without panic. High-contrast ink, structured wire borders, and a single deliberate vermilion signal reserved for active alerts and primary dispatch actions. |
| **RHYTHM** | **2 (Structured with Clear Focal Breaks)** | Each view follows its real operational job (two-column intake/diff workspace on Command Desk, selectable report queue + 4-audience preview studio on Broadcast Studio, editorial single-column dispatch feed on Public Crisis Wire). |
| **MOTION** | **1 (Purposeful Transitions Only)** | Crisp state feedback on tabs, streaming text arrival, and download progress bars. Zero endless pulsing dots, floating animations, or scroll-jacking. Respects `prefers-reduced-motion: reduce`. |

## 3. Color System (WCAG AA Verified)

Active palette is constrained to **neutral newsprint/charcoal surfaces** + **1 core accent (Signal Vermilion)**, plus strict **functional state tokens** paired with explicit text labels (never color alone).

### Light Mode (Default: Daylight & Field Readability)
- **Ground (`--bg-ground`):** `#F8F7F4` (warm newsprint off-white reduces glare vs. stark `#FFFFFF`).
- **Surface (`--bg-surface`):** `#FFFFFF` (elevated dispatch & intake panels separated by crisp 1px borders).
- **Subtle Surface (`--bg-subtle`):** `#F1EFEA` (secondary metadata bars and diff containers).
- **Primary Ink (`--ink-primary`):** `#14171A` (**16.79:1** on ground).
- **Secondary Ink (`--ink-muted`):** `#475569` (**7.07:1** on ground, **7.58:1** on white).
- **Interactive Border (`--border-strong`):** `#64748B` (**4.76:1** on white, exceeds 3:1 non-text contrast).
- **Hairline Divider (`--border-subtle`):** `#DDD9D0` (structural editorial rules).
- **Core Accent (`--accent-vermilion`):** `#C83219` with `#FFFFFF` label (**5.35:1**). Text accent on light ground: `#B92B14` (**5.73:1**).

### Dark Mode (Night-Shift Command Desk Toggle)
- **Ground (`--bg-ground`):** `#111315` (low-glare command charcoal).
- **Surface (`--bg-surface`):** `#1A1D21` (distinct panel step without heavy shadows).
- **Subtle Surface (`--bg-subtle`):** `#22262C`.
- **Primary Ink (`--ink-primary`):** `#F3F4F6` (**16.92:1** on ground).
- **Secondary Ink (`--ink-muted`):** `#9CA3AF` (**7.33:1** on ground, **6.66:1** on surface).
- **Interactive Border (`--border-strong`):** `#94A3B8` (**6.60:1** on surface).
- **Hairline Divider (`--border-subtle`):** `#2D333B`.
- **Core Accent (`--accent-vermilion`):** `#C83219` with `#FFFFFF` label (**5.35:1**).

### Functional State Tokens (Always Paired With Text Labels)
| Real State | Light Text / Fill (Contrast) | Dark Text / Fill (Contrast) | Purpose |
| :--- | :--- | :--- | :--- |
| **`ON_DEVICE` / `VERIFIED`** | `#0D6B53` on `#ECFDF5` (**6.14:1**) | `#6EE7B7` on `#064E3B` (**6.38:1**) | Confirms local on-device execution or source-verified rumor. |
| **`IN_CLOUD`** | `#1D4ED8` on `#EFF6FF` (**6.16:1**) | `#93C5FD` on `#1E3A8A` (**5.74:1**) | Shows cloud Gemini synthesis, fallback, or Search grounding. |
| **`UNVERIFIED_DEVELOPING` / `OFFLINE`** | `#92400E` on `#FEF3C7` (**6.37:1**) | `#FDE68A` on `#78350F` (**7.28:1**) | Warns of unconfirmed rumor or offline queued state. |
| **`CRITICAL` / `MISLEADING`** | `#991B1B` on `#FEE2E2` (**6.80:1**) | `#FCA5A5` on `#450A0A` (**8.51:1**) | Flags severe hazard or debunked misinformation. |

## 4. Typography

- **Editorial Display (`Source Serif 4`, Georgia fallback):** Dispatch headlines, crisis bulletin titles, and brand wordmark (`SigapWire`). Chosen to signal wire-service editorial seriousness rather than generic SaaS typography.
- **Interface Sans (`Plus Jakarta Sans`, system sans fallback):** Controls, summaries, Indonesian & English body copy, and forms. High legibility across Bahasa Indonesia diacritics/long compound words at mobile and desktop sizes.
- **Technical Mono (`IBM Plex Mono`, monospace fallback):** Used strictly for real operational telemetry: UTC/WIB timestamps, latency in `ms`, `ON_DEVICE` / `IN_CLOUD` tags, and `[PHONE_1]` / `[RESIDENT_1]` local redaction tokens. Never used for decorative headings.

## 5. Radii, Elevation & Borders

- **Radius Scale (Intentional Hierarchy):**
  - Editorial containers & panels: `8px` (`rounded-lg`) for crisp wire-desk geometry.
  - Buttons & inputs: `6px` (`rounded-md`), minimum `44px` touch target height on interactive controls.
  - Functional status tags (`ON_DEVICE`, `IN_CLOUD`, `VERIFIED`): `4px` (`rounded`) compact rectangular tags rather than decorative glowing pills.
- **Elevation:** Flat 1px hairline borders by default; subtle elevation (`0 1px 2px rgba(0,0,0,0.06)`) reserved only for the primary sticky top navigation bar and active dialogs. Zero glassmorphism blur stacks.

## 6. Logo, Assets & Content Honesty

- **Wordmark:** Plain typographic wordmark **`SigapWire`** rendered in `Source Serif 4` bold with a solid `10px` square vermilion dispatch mark. No invented mascot or robot icon.
- **Icons:** Minimal, high-clarity inline geometric SVG symbols strictly where they add operational clarity (offline status, privacy lock, copy, external source link), always with `aria-hidden="true"` alongside text or `aria-label`.
- **Synthetic Data Labeling:** Every bundled Indonesia drill scenario is explicitly marked `SYNTHETIC DRILL` with a transparent disclaimer banner stating SigapWire is an independent open-source project.
- **Empty, Loading, and Error States:** Every live collection view (`intakes`, `dispatches`, privacy diff, rumor check) explicitly names why it is empty, what model/service is running during loading, and the exact recovery action on error (including Firebase `.env.local` setup and App Check debug token instructions).

## 7. Information Architecture (3 Real Views on Web, 2 Screens on Mobile/Apple)

### Web Flagship (`web/`)
1. **Command Desk:**
   - Top bar: Wordmark, 3 real view tabs, live Hardware/Network Diagnostics indicator (`Nano Ready` / `Download Nano` / `Cloud Fallback` + `Online/Offline`), Light/Dark theme toggle.
   - Left column: Shared Intake Console with `Field Report` vs. `Verify Rumor` segmented toggle, one-click `Synthetic Drill` scenario loader, raw note input + optional JPEG/PNG photo dropzone, and explicit 2-step execution (`1. Local Privacy Redaction` -> `2. Hybrid Triage & Optional Search Check`).
   - Right column: Live **"Stayed Local vs. Sent to Cloud" Redaction Diff**, structured Situation/Rumor Card with real `ON_DEVICE` / `IN_CLOUD` + latency badge, clickable Google Search Grounding sources + required `searchEntryPoint` widget, and Save to Incident Queue action.
2. **Broadcast Studio:**
   - Left column: Real-time Firestore queue of synced intakes across **Web**, **Android**, and **Apple** (showing each intake's platform & `inferenceSource` badge) with checkboxes to select intakes for synthesis.
   - Right column: 1-click **Synthesize 4-Audience Dispatch (`ONLY_IN_CLOUD`)** previewing all 4 outputs in tabs (`Community Alert [ID]`, `Media Press Release [ID]`, `Global SitRep [EN]`, `Debunk Card`) with copy-to-clipboard and **Publish to Public Wire**.
3. **Public Crisis Wire:**
   - Clean, unauthenticated-readable editorial feed of published dispatches with Bahasa Indonesia / English audience tabs, official Google Search Grounding attribution when present, and an interactive **Resilient Reader Adapter (`PREFER_IN_CLOUD`)** that streams plain-language Indonesian, 3-bullet global wire, or 25-second radio script adaptations (automatically falling back to on-device Gemini Nano if connectivity drops).

### Android Field Companion (`android/`, 2 Screens)
- Mirrors the exact light/dark palette and severity/inference tokens in Material 3 Jetpack Compose:
  1. **Field & Rumor Intake** (Camera/photo + note, `PREFER_ON_DEVICE` badge clearly showing real `IN_CLOUD` fallback on Samsung A55 or `ON_DEVICE` on Pixel/S25+, plus offline Firestore queue banner).
  2. **Live Verified Alerts** (Real-time synced `dispatches` feed in ID/EN).

### Apple Briefing Companion (`apple/`, 2 Screens)
- Native SwiftUI typography & adaptive light/dark palette for macOS + iOS Simulator on Apple Silicon:
  1. **Offline Executive Briefing Wire** (Synced `dispatches` + real on-device **Apple Foundation Models** streaming brief/quote/readability adapter).
  2. **Quick Text Intake** (Text-only hybrid report/rumor intake synced to Firestore).

## 8. Accessibility & Cross-Platform Guarantees

- Base CSS applies `cursor: pointer` to all enabled native controls (`button`, `a[href]`, `select`, `label[for]`, `input[type=checkbox]`) and `cursor: not-allowed` when disabled.
- Visible 2px high-contrast `:focus-visible` outline (`#C83219` light / `#FCA5A5` dark) on every focusable element.
- Strict semantic landmarks (`header`, `nav`, `main`, `footer`), single `h1` per view, visible `<label>` on every input, `aria-live="polite"` on AI status updates and streaming output.
- Zero horizontal overflow down to 360px mobile viewport and 200% browser zoom.
