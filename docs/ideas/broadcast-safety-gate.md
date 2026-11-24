# Deterministic Pre-Publish Safety Gate (Broadcast Studio)

## Problem Statement
How might we guarantee that AI-synthesized crisis bulletins never leak citizen PII or declare an unverified hazard "safe," while allowing a stressed communications officer to verify, repair, and release broadcasts in seconds without depending on another cloud LLM call?

## Recommended Direction
Build a **Deterministic-First Pre-Publish Safety Gate** (`web/src/lib/broadcastSafetyGate.ts`) that sits between Cloud Gemini synthesis and **Publish to Public Crisis Wire** in `BroadcastStudio.tsx`. Inspired by Plant Debugger's strict separation between AI reasoning and deterministic safety authority, pure TypeScript rules evaluate every 4-audience draft synchronously (`<50ms`) and produce explicit `BLOCK`, `WARN`, or `PASS` verdicts before release is permitted.

Both **detection and recovery** are 100% deterministic so live crisis ops and hackathon demos never stall behind a `503` cloud outage or a read-only draft dead end:
- **Hard blocks (`BLOCK`)**: `ZERO_PII_LEAK`, `RUMOR_SAFETY_GUARD`, and multi-step `CRITICAL -> MEDIUM|LOW` severity downgrades lock publishing until cleared via one-click deterministic repair (`Auto-Scrub PII`, `Enforce Safe Guardrails`, `Restore Peak Severity`).
- **Warnings (`WARN`) + Release Sign-Off**: 1-step severity downgrades (`CRITICAL -> HIGH`, `HIGH -> MEDIUM`, `MEDIUM -> LOW`), omitted `verificationGaps`, and un-upgraded `Offline draft:` inputs offer one-click `Inject Missing Gaps` or `Restore Peak Severity` and require an explicit **Commander Release Sign-Off** checkbox whenever warnings or deterministic repairs are active.

To make deterministic authority provable live (even when upstream Stages 1-3 behave cleanly), the gate includes a clearly labeled **`Test Safety Gate (Drill)`** button that injects synthetic flaws (a phone number + resident name, an unverified all-clear claim, and a severity downgrade to `LOW`) into **local preview state only** (never Firestore). Once cleared, the structured **Pre-Release Verification Receipt** renders above Publish and is automatically appended as `## 5. Pre-Publish Safety Gate Verification` in exported Markdown SitReps (`web/src/lib/dispatchExport.ts`), requiring zero `firestore.rules` changes.

## Key Assumptions to Validate
- [ ] **Bounded Bahasa Indonesia & English reassurance matching avoids false positives:** Unit tests validate all 4 rules against legitimate Indonesian shelter/caution phrases (`titik aman evakuasi`, `tempat aman`, `rute aman`, `amankan dokumen`, `keamanan warga`, `tidak aman`, `belum aman`, `not confirmed safe`) while catching `sudah 100% aman`, `dipastikan aman`, `pasti hoax`, `confirmed safe`, `all clear`, and `false alarm`.
- [ ] **Deterministic repair yields valid, publish-ready payloads:** Stripping flagged sentences preserves non-empty required strings across all 4 channels so `firestore.rules` (`minLen: 1`) never rejects a repaired dispatch.
- [ ] **Zero-schema-churn verification is sufficient for release accountability:** Exported SitRep Markdown includes the full verification receipt (checks run, repairs applied, simulation status, and Commander sign-off).

## MVP Scope
**In scope (`web/` only):**
- `web/src/lib/piiScrubber.ts`: Pure deterministic PII scrubber shared between `hybridAi.ts` and `broadcastSafetyGate.ts`.
- `web/src/lib/broadcastSafetyGate.ts`: Pure deterministic evaluator + repair helpers covering:
  1. `ZERO_PII_LEAK` (`BLOCK`): Scans all 4 audiences (`communityAlertId`, `mediaPressReleaseId`, `globalSitrepEn`, `debunkCard`).
  2. `RUMOR_SAFETY_GUARD` (`BLOCK`): Blocks `VERIFIED`/`MISLEADING` verdicts when `debunkCard.sources.length === 0`, or unhedged all-clear claims when an included `RUMOR_CHECK` is unverified.
  3. `PEAK_SEVERITY_INVARIANT` (`BLOCK` on `CRITICAL -> MEDIUM|LOW`, `WARN` on 1-step downgrade): Compares draft severity against peak severity among selected intakes.
  4. `GAP_DISCLOSURE_CHECK` (`WARN`): Detects open `verificationGaps` and un-upgraded `Offline draft:` intakes missing from `globalSitrepEn.informationGaps`.
  5. **Commander Release Sign-Off**: Required checkbox when warnings or applied repairs exist.
- `web/src/components/BroadcastStudio.tsx`: Pre-Publish Safety Gate card above the 4-audience tabs, `Test Safety Gate (Drill)` local-state fault injector, Publish lock, and one-click repair buttons.
- `web/src/lib/dispatchExport.ts`: Appends `## 5. Pre-Publish Safety Gate Verification` to draft `.md` exports when `safetyGate` receipt is supplied.
- `web/tests/broadcastSafetyGate.test.ts`: Automated `node --test` unit test suite covering all rules, false-positive exclusions, drill cycle, repairs, and Markdown export.

**Not Doing (and Why):**
- **Cloud Re-Synthesis as recovery** - Relying on another Cloud Gemini round-trip to fix a safety failure risks `503` stalls mid-demo and blurs deterministic enforcement authority.
- **On-device Gemini Nano tone audit inside the gate** - Keeps pre-publish enforcement strictly synchronous, predictable, and deterministic.
- **Persisting gate receipts on Firestore `dispatches`** - Requires `firestore.rules` schema edits and Android/Apple model churn; exporting the verification receipt in Markdown `.md` proves release accountability cleanly with zero backend schema changes.
- **Inline text editor across 4 audience tabs** - Unnecessary UI complexity when deterministic one-click repair + Commander sign-off resolve all gate states reliably.
