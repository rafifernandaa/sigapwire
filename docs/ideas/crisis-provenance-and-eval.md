# Crisis Provenance Seal & Hybrid Readiness Verifier

## Problem Statement
How might we let any citizen, journalist, or hackathon judge verify in one click that a forwarded SigapWire crisis alert is authentic, unmodified, and produced under strict local PII containment, without ever uploading raw victim data to the cloud or running a custom backend?

## Recommended Direction
Build a zero-backend **Hybrid Provenance & Readiness Layer** native to disaster communication and `#BuildHybridAI 2026`:

1. **Public Anti-Forgery Provenance Seal (`SIGAP-D{n}-{HEX6}`):**
   - During Indonesian disasters, edited screenshots and fake "official" WhatsApp forwards spread within minutes.
   - When an officer publishes a dispatch from **Broadcast Studio**, SigapWire deterministically computes a **SHA-256 manifest digest** over the canonical published bulletin + its sanitized source intake fingerprints (computed locally via Web Crypto `crypto.subtle.digest` over EXIF-stripped photo bytes and cloud-safe text, never raw PII) and embeds a short human-readable verification code (`SIGAP-D1-7A4F9C`) into the WhatsApp copy, Markdown SitRep, and Public Crisis Wire header.
   - On **Public Crisis Wire**, any citizen or journalist can click **Verify Provenance** on a dispatch (or paste a forwarded `SIGAP-D...` code into a **Verify Forwarded Alert** bar) to recompute the live SHA-256 digest in-browser and inspect the full **Hybrid Chain of Custody** (`WEB`/`ANDROID`/`APPLE` source mix, `N` PII items blocked strictly on-device, `ON_DEVICE` vs `IN_CLOUD` split, Google Search Grounding citation count, and `INTACT` vs `MISMATCH` verification status).

2. **Atomic Firestore Chain-of-Custody Writes (`writeBatch`):**
   - Upgrade multi-document operations in `web/src/lib/firestoreRepo.ts` (`publishDispatchToFirestore` + marking source intakes `INCLUDED_IN_DISPATCH`, and promoting an answered field verification task to `area_knowledge`) to single atomic Firestore **`writeBatch(db)`** commits so intermittent disaster connectivity never produces half-written provenance chains.
   - Add optional, backward-compatible integrity fields (`evidenceSha256` on `intakes`; `manifestSha256` and `provenanceCode` on `dispatches`) in `firestore.rules` via `firestore-rules-author` so existing Android and Apple clients continue syncing with zero breakage.

3. **4-Pillar Hybrid Crisis Readiness Benchmark (CLI + Live In-App):**
   - Build a shared pure benchmark engine (`web/src/lib/hybridEvalSuite.ts`) evaluating **30+ seeded adversarial crisis scenarios** across the 4 failure modes unique to Hybrid Crisis AI:
     1. *On-Device Privacy Firewall* (Indonesian `+62`/`08xx` phones, `@handles`, honorific names, `Jl.`/`RT/RW` addresses -> `0` leaks)
     2. *Hybrid Token-Budget & Offline Routing* (local Nano bounds vs cloud auto-escalation vs bounded `[AK-N]` memory caps)
     3. *Broadcast Safety Gate & Rumor Anti-Hallucination* (zero-source verdicts, unhedged all-clear claims, Indonesian/English negated safety zero-false-positives, `CRITICAL` severity floor)
     4. *Multilingual, Audio & Provenance Integrity* (Arabic-Indic + Latin numeral preservation across 7 languages, 44-byte RIFF/WAVE PCM headers, and SHA-256 seal tamper detection)
   - Runnable both from CLI (`npm run eval` -> generates `docs/EVAL_REPORT.md` + `docs/eval-results.json` for repo judges) and live inside **Ops Memory & Audit** via a compact **`Run Hybrid Crisis Benchmark`** panel.

## Key Assumptions to Validate
- [ ] **Must Be True (Backward Compatibility):** Making `evidenceSha256`, `manifestSha256`, and `provenanceCode` strictly optional/nullable in `firestore.rules` guarantees older published dispatches and current Apple/Android writes never fail rules validation *(verify via rules inspection + unit tests + live deployment test)*.
- [ ] **Must Be True (Reproducible Proof):** Keeping the 30-scenario benchmark 100% deterministic over pure modules ensures `npm run eval` and the live in-app runner return identical `30/30` pass results in `< 100ms` with zero 429 quota flakiness *(verify via `npm run eval` + `npm test`)*.
- [ ] **Should Be True (Citizen Clarity):** The **Verify Forwarded Alert** box on Public Crisis Wire takes one click or one pasted `SIGAP-D...` code and reads like a calm trust check rather than raw cryptography jargon *(verify across light/dark tokens and `min-h-[44px]` targets)*.

## MVP Scope
- **In:**
  - Pure module `web/src/lib/crisisProvenance.ts` (SHA-256 canonical manifest hashing in Node & Browser, `SIGAP-D{n}-{HEX6}` seal generator, live tamper verifier, EXIF-stripped local image/text digest helper).
  - Pure module `web/src/lib/hybridEvalSuite.ts` + CLI runner `web/scripts/run_eval.ts` generating `docs/EVAL_REPORT.md` and `docs/eval-results.json` (`npm run eval`).
  - Minor additive `firestore.rules` update via `firestore-rules-author` (optional `evidenceSha256` on `intakes`; optional `manifestSha256` & `provenanceCode` on `dispatches`).
  - Atomic `writeBatch(db)` in `web/src/lib/firestoreRepo.ts` for publish and promotion flows.
  - **Public Crisis Wire:** Provenance Seal badge + **Verify Forwarded Alert (`SIGAP-D...`)** lookup & live SHA-256 chain-of-custody inspector + WhatsApp copy footer containing the seal code.
  - **Ops Memory & Audit:** Compact extracted `HybridBenchmarkPanel` running the 30-scenario Hybrid Crisis Readiness suite live in-browser.
  - ADR (`docs/decisions/ADR-001-crisis-provenance-and-hybrid-eval.md`), unit tests, and `README.md` links.

## Not Doing (and Why)
- **No Firebase Storage raw photo bucket uploads:** Uploading raw disaster photos to cloud buckets adds Storage rules/CORS/billing risk before submission and introduces cloud PII surface; hashing EXIF-stripped image bytes locally gives cryptographic proof with zero cloud image exposure.
- **No Cloud Run / Pub/Sub / server-side ADK backend:** Violates SigapWire's zero-backend Firebase AI Logic hybrid thesis.
- **No blockchain or external ledger:** Unnecessary overhead; deterministic SHA-256 manifests over schema-enforced Firestore documents already deliver verifiable tamper detection.
- **No live-LLM calls inside `npm run eval`:** Avoids 429 rate-limit flakiness and keeps judge reproduction instant and free without requiring API keys.
- **No separate multi-incident switcher across mobile yet:** Keeping `inc_westjava_drill_2026` shared across Web, Apple, and Android guarantees zero cross-device demo breakage before Nov 30.
