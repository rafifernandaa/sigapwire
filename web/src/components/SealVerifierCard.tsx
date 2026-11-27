import type { FormEvent } from "react";
import type { ProvenanceVerificationReport } from "../lib/crisisProvenance";

export interface SealLookupResult {
  kind: "AUTHENTIC" | "TAMPERED" | "NOT_FOUND" | "INVALID";
  codeSearched: string | null;
  dispatchNumber?: number;
  headline?: string;
  report?: ProvenanceVerificationReport;
  message: string;
}

interface SealVerifierCardProps {
  sealLookupInput: string;
  sealLookupBusy: boolean;
  sealLookupResult: SealLookupResult | null;
  onChangeInput: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
}

export function SealVerifierCard({
  sealLookupInput,
  sealLookupBusy,
  sealLookupResult,
  onChangeInput,
  onSubmit,
}: SealVerifierCardProps) {
  return (
    <section
      aria-label="Verify Forwarded Alert Seal"
      className="sw-card mb-6 p-4 space-y-3"
    >
      <div>
        <h2 className="text-sm font-bold">
          Verify Forwarded WhatsApp Alert (Anti-Forgery Seal Check)
        </h2>
        <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
          Paste a SIGAP-D1-XXXXXX code or an entire forwarded alert to recompute its SHA-256 manifest live and verify that zero raw victim PII left field devices.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-1.5">
        <label
          htmlFor="seal-lookup-input"
          className="block text-xs font-semibold"
        >
          Forwarded Alert Text or Verification Seal Code
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            id="seal-lookup-input"
            type="text"
            value={sealLookupInput}
            onChange={(e) => onChangeInput(e.target.value)}
            placeholder="Paste SIGAP-D1-XXXXXX or full forwarded WhatsApp alert..."
            className="sw-input min-h-[44px] flex-1 px-3 text-xs"
          />
          <button
            type="submit"
            disabled={sealLookupBusy || !sealLookupInput.trim()}
            className="sw-btn-primary min-h-[44px] shrink-0 px-4 text-xs font-semibold"
          >
            {sealLookupBusy ? "Verifying SHA-256..." : "Verify Seal"}
          </button>
        </div>
      </form>

      {sealLookupResult ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border p-3 text-xs space-y-1.5"
          style={
            sealLookupResult.kind === "AUTHENTIC"
              ? {
                  backgroundColor: "var(--state-ondevice-bg)",
                  borderColor: "var(--state-ondevice-border)",
                  color: "var(--state-ondevice-ink)",
                }
              : sealLookupResult.kind === "TAMPERED"
                ? {
                    backgroundColor: "var(--state-critical-bg)",
                    borderColor: "var(--state-critical-border)",
                    color: "var(--state-critical-ink)",
                  }
                : {
                    backgroundColor: "var(--state-warn-bg)",
                    borderColor: "var(--state-warn-border)",
                    color: "var(--state-warn-ink)",
                  }
          }
        >
          <div className="font-mono-telemetry font-bold">
            {sealLookupResult.kind === "AUTHENTIC"
              ? `AUTHENTIC BULLETIN VERIFIED (${sealLookupResult.codeSearched})`
              : sealLookupResult.kind === "TAMPERED"
                ? `INTEGRITY MISMATCH DETECTED (${sealLookupResult.codeSearched})`
                : sealLookupResult.kind === "NOT_FOUND"
                  ? `UNVERIFIED FORWARD (${sealLookupResult.codeSearched})`
                  : "NO SEAL FOUND"}
          </div>
          <p>{sealLookupResult.message}</p>
          {sealLookupResult.report ? (
            <p className="font-mono-telemetry text-xs">
              Headline: {sealLookupResult.headline} | PII Blocked Locally:{" "}
              {sealLookupResult.report.totalPiiKeptOnDevice} | Sources:{" "}
              {sealLookupResult.report.linkedIntakeCount} (
              {sealLookupResult.report.platforms.join(", ") || "Synced"}) |
              Grounding Citations: {sealLookupResult.report.groundingSourceCount}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
