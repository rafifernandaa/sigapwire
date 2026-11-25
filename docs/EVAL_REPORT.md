# SigapWire Hybrid Crisis Readiness Evaluation Report

- **Generated At:** 2026-11-25T01:58:25.017Z
- **Runner:** `cd web && npm run eval` (deterministic pure-module benchmark, also executable live in **Ops Memory & Audit**)
- **Overall Score:** **32/32 passed (100%)** in 7.36ms
- **Failed Scenarios:** 0

---

## Pillar Summary

| Pillar | Passed | Total | Status |
| :--- | :---: | :---: | :---: |
| On-Device Privacy Firewall (ONLY_ON_DEVICE) | 8 | 8 | PASS |
| Hybrid Token Routing, Area Knowledge & Scorecard | 8 | 8 | PASS |
| Deterministic Pre-Publish Safety Gate | 8 | 8 | PASS |
| Multilingual Safety, TTS WAV & SHA-256 Provenance | 8 | 8 | PASS |

## Detailed Scenario Results

| ID | Pillar | Scenario | Result | Evidence |
| :--- | :--- | :--- | :---: | :--- |
| `PRIV-01` | `PRIVACY` | Redacts +62 Indonesian mobile phone numbers locally | PASS | redactions=1 |
| `PRIV-02` | `PRIVACY` | Redacts local 08xx dotted mobile formats | PASS | output="Nomor pelapor [PHONE_1] di posko." |
| `PRIV-03` | `PRIVACY` | Redacts social and chat @handles | PASS | redactions=1 |
| `PRIV-04` | `PRIVACY` | Redacts personal names following Indonesian honorifics | PASS | redactions=2 |
| `PRIV-05` | `PRIVACY` | Redacts house-level Jl. and RT/RW street addresses | PASS | output="Rumah retak di [STREET_ADDRESS_1] Cianjur." |
| `PRIV-06` | `PRIVACY` | Scrubs all 4 PII categories from a chaotic WhatsApp report | PASS | categories=4/4, total=4 |
| `PRIV-07` | `PRIVACY` | Preserves public hotlines (112, 117), magnitudes, and shelter counts | PASS | falseRedactions=0 |
| `PRIV-08` | `PRIVACY` | Leaves clean sanitized field notes untouched | PASS | redactions=0 |
| `ROUTE-01` | `HYBRID_ROUTING` | Keeps short single-zone field reports inside Web 2200-token Nano budget | PASS | estTokens=17 <= 2200 |
| `ROUTE-02` | `HYBRID_ROUTING` | Auto-escalates multi-subdistrict long dumps exceeding 2200 est. tokens | PASS | estTokens=2538 > 2200 |
| `ROUTE-03` | `HYBRID_ROUTING` | Accounts for +300 image token overhead on borderline multimodal reports | PASS | textOnly=2000, withImage=2300 |
| `ROUTE-04` | `HYBRID_ROUTING` | Excludes paused Area Knowledge facts from injected prompts | PASS | included=1 |
| `ROUTE-05` | `HYBRID_ROUTING` | Caps 15 active Area Knowledge facts to <=8 items and <=1200 chars | PASS | facts=8/8, chars=894/1200 |
| `ROUTE-06` | `HYBRID_ROUTING` | Safely bounds an oversized single Area Knowledge fact | PASS | chars=1200 |
| `ROUTE-07` | `HYBRID_ROUTING` | Empty Hybrid Scorecard reports exact zeros with zero fabricated numbers | PASS | share=0%, label="Awaiting first intake or broadcast" |
| `ROUTE-08` | `HYBRID_ROUTING` | Audit trail and scorecard aggregate cross-platform WEB/ANDROID/APPLE records | PASS | events=6, piiBlocked=6 |
| `GATE-01` | `SAFETY_GATE` | Clean 4-audience draft clears all 4 deterministic gate checks | PASS | pass=4/4, blocks=0, warns=0 |
| `GATE-02` | `SAFETY_GATE` | Zero-PII Leak Guard blocks leaked phone/@handle and auto-scrub clears block | PASS | beforeBlocks=1, afterBlocks=0 |
| `GATE-03` | `SAFETY_GATE` | Rumor Safety Guard blocks zero-source VERIFIED verdict and repairs safely | PASS | repairedVerdict=UNVERIFIED_DEVELOPING |
| `GATE-04` | `SAFETY_GATE` | Blocks unhedged Indonesian all-clear claim when rumor is unverified | PASS | beforeBlocks=1, afterBlocks=0 |
| `GATE-05` | `SAFETY_GATE` | Blocks unhedged English all-clear phrasing while rumor lacks grounding | PASS | blocks=1 |
| `GATE-06` | `SAFETY_GATE` | Negated safety and shelter phrasing causes zero false blocks | PASS | falseBlocks=0 |
| `GATE-07` | `SAFETY_GATE` | Peak Severity Invariant blocks CRITICAL->MEDIUM downgrade and restores CRITICAL | PASS | beforeBlocks=1, restored=CRITICAL |
| `GATE-08` | `SAFETY_GATE` | Drill fault injection + omitted gap repair restores clean gate state | PASS | faultBlocks=3, afterRepairBlocks=0 |
| `PROV-01` | `ACCESSIBILITY_PROVENANCE` | Detects regional and visitor browser locales without nagging Indonesian defaults | PASS | su/ja/ar mapped; id-ID=null |
| `PROV-02` | `ACCESSIBILITY_PROVENANCE` | Preserves safety numerals across Arabic-Indic digit translations | PASS | tokens=4, missing=0 |
| `PROV-03` | `ACCESSIBILITY_PROVENANCE` | Handles Sundanese comma decimals (M6,2) and [AK-1] citations cleanly | PASS | missing=0 |
| `PROV-04` | `ACCESSIBILITY_PROVENANCE` | Flags dropped safety numbers (M6.2, 112, [AK-1]) in faulty translation | PASS | flagged=m6.2,[ak-1],112 |
| `PROV-05` | `ACCESSIBILITY_PROVENANCE` | Wraps Gemini TTS 24kHz PCM bytes into valid 44-byte RIFF/WAVE header | PASS | header=RIFF/WAVE, bytes=52 |
| `PROV-06` | `ACCESSIBILITY_PROVENANCE` | Builds bounded 2-Voice Anchor/Verifier radio script for Gemini TTS | PASS | chars=498 |
| `PROV-07` | `ACCESSIBILITY_PROVENANCE` | End-to-end SHA-256 intake evidence + Dispatch Provenance Seal verifies intact | PASS | seal=SIGAP-D1-77E21D, status=VERIFIED_INTACT |
| `PROV-08` | `ACCESSIBILITY_PROVENANCE` | Detects single-digit dispatch tampering and parses forwarded WhatsApp seals | PASS | status=TAMPER_MISMATCH, extracted=SIGAP-D3-C2FE1B |

> **Note:** This benchmark evaluates deterministic safety, privacy, routing, multilingual numeric preservation, WAV container encoding, and SHA-256 provenance invariants using seeded synthetic disaster fixtures. It requires zero API keys and is 100% reproducible by judges.
