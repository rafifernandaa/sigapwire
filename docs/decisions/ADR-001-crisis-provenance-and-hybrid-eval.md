# ADR-001: Client-Side Crisis Provenance Seals, Atomic Firestore Batches, and Deterministic Hybrid Evaluation

## Status
Accepted

## Date
2026-11-25

## Context
During fast-moving disasters in Indonesia, two integrity failures undermine public crisis alerts:
1. **Viral bulletin forgery:** Malicious or panicked actors forward edited screenshots or altered WhatsApp copies claiming to be official emergency alerts.
2. **Partial writes and unverified guardrails under hybrid execution:** Multi-document state transitions (publishing a dispatch while marking source intakes `INCLUDED_IN_DISPATCH`, or promoting a field answer into `area_knowledge`) can half-commit when connectivity drops, and hackathon judges / humanitarian reviewers need reproducible empirical proof that on-device PII redaction, token routing, safety gates, and multilingual numeral checks hold up under adversarial inputs.

SigapWire operates as a **zero-custom-backend** Firebase AI Logic hybrid architecture across Web, Android, and Apple. Any integrity or evaluation solution must preserve:
- Zero cloud upload of raw victim PII or raw unstripped photo EXIF metadata.
- Full backward compatibility with existing Android and Apple clients writing to `intakes` and reading `dispatches`.
- Instant, repeatable verification without requiring cloud server infrastructure or paid storage buckets.

## Decision
1. **Client-Side SHA-256 Provenance Seals (`web/src/lib/crisisProvenance.ts`):**
   - Hash sanitized intake text (and `<canvas>`-resized, EXIF-stripped image bytes when attached) strictly on-device via Web Crypto (`crypto.subtle.digest("SHA-256")`) into an optional `evidenceSha256` field on `intakes`.
   - When publishing a 4-audience dispatch, compute a canonical SHA-256 manifest digest (`manifestSha256`) over the dispatch payload and its linked source intake hashes, deriving a human-verifiable anti-forgery code (`provenanceCode`, format `SIGAP-D{dispatchNumber}-{HEX6}`) appended to WhatsApp copy and Markdown SitReps.
   - Allow any reader on the **Public Crisis Wire** to recompute the SHA-256 manifest in-browser and inspect the hybrid chain of custody (source platforms, local PII redaction counts, on-device vs cloud routing, and grounding source counts).
2. **Additive Optional Schema Fields in `firestore.rules`:**
   - Add strictly optional/nullable `evidenceSha256` (64 lowercase hex chars) to `intakes/{intakeId}` and optional/nullable `manifestSha256` (64 lowercase hex chars) + `provenanceCode` (`^SIGAP-D[0-9]{1,6}-[A-F0-9]{6}$`) to `dispatches/{dispatchId}` via `firestore-rules-author`.
3. **Atomic Multi-Document `writeBatch(db)` Commits (`web/src/lib/firestoreRepo.ts`):**
   - Replace sequential multi-write loops in Broadcast publish (`dispatches` create + `intakes` status updates) and Area Knowledge promotion (`area_knowledge` create + `verification_tasks` `PROMOTED` update) with atomic Firestore `writeBatch(db)` commits.
4. **Shared Deterministic 4-Pillar Hybrid Crisis Readiness Benchmark (`web/src/lib/hybridEvalSuite.ts`):**
   - Run 30+ seeded adversarial crisis scenarios deterministically in both Node CLI (`npm run eval` -> `docs/EVAL_REPORT.md` + `docs/eval-results.json`) and live in-browser inside **Ops Memory & Audit** (`HybridBenchmarkPanel`).

## Alternatives Considered

### Firebase Storage Buckets for Raw Field Photos + Server Verification
- **Pros:** Persists full field photos in cloud storage with server-side digests.
- **Cons:** Introduces Storage security rules, CORS configuration, paid bucket storage surface, and risk of uploading unstripped EXIF GPS / victim faces to cloud infrastructure before local review.
- **Rejected:** Client-side EXIF-stripped SHA-256 hashing delivers tamper evidence with zero cloud PII exposure and zero new billing dependencies.

### Cloud Run / Server-Side Agent Orchestration + Live LLM Eval Runs
- **Pros:** Server-controlled audit pipelines and live model response scoring.
- **Cons:** Contradicts SigapWire's zero-backend Firebase AI Logic client-first thesis; live LLM evaluation benchmarks flake under free-tier `429` rate limits and require judges to provision API keys.
- **Rejected:** Client-side hybrid architecture + deterministic adversarial benchmark delivers 100% reproducible, zero-quota verification for both judges and automated evaluation.

### External Blockchain / Public Ledger Anchoring
- **Pros:** Decentralized timestamping buzzword appeal.
- **Cons:** Adds wallet/RPC complexity, latency, and cost with zero benefit over canonical SHA-256 manifests backed by schema-enforced Firestore documents on an authoritative public wire.
- **Rejected:** Simplicity and crisis reliability win over unnecessary infrastructure.

## Consequences
- **Positive:** Citizens and journalists can verify forwarded WhatsApp crisis alerts in one click on the Public Crisis Wire without exposing raw victim PII.
- **Positive:** Multi-document publish and promotion flows become atomic under flaky disaster networks via Firestore `writeBatch`.
- **Positive:** Existing Android and Apple builds remain 100% compatible because all new Firestore fields are strictly optional/nullable.
- **Positive:** Judges can both inspect committed `docs/EVAL_REPORT.md` and trigger the exact same 30-scenario benchmark live inside the hosted Web app.
- **Trade-off:** Requires one `npx -y firebase-tools@latest deploy --only firestore:rules` deployment so live Cloud Firestore accepts the optional provenance fields on new Web writes.
