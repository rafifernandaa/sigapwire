import type { ProvenanceVerificationReport } from "../lib/crisisProvenance";

interface DispatchProvenanceDrawerProps {
  dispatchId: string;
  dispatchNumber: number;
  report: ProvenanceVerificationReport;
  copiedId: string | null;
  onCopySeal: (key: string, text: string) => void;
}

export function DispatchProvenanceDrawer({
  dispatchId,
  dispatchNumber,
  report,
  copiedId,
  onCopySeal,
}: DispatchProvenanceDrawerProps) {
  const sealCode = report.storedCode ?? report.recomputedCode;

  return (
    <div
      role="region"
      aria-label={`Provenance receipt for dispatch ${dispatchNumber}`}
      className="mb-4 rounded-md border p-3.5 text-xs space-y-2.5"
      style={{
        backgroundColor: "var(--bg-subtle)",
        borderColor:
          report.status === "VERIFIED_INTACT"
            ? "var(--state-ondevice-border)"
            : report.status === "TAMPER_MISMATCH"
              ? "var(--state-critical-border)"
              : "var(--state-warn-border)",
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className="font-mono-telemetry rounded px-2 py-0.5 text-xs font-bold border"
          style={
            report.status === "VERIFIED_INTACT"
              ? {
                  backgroundColor: "var(--state-ondevice-bg)",
                  color: "var(--state-ondevice-ink)",
                  borderColor: "var(--state-ondevice-border)",
                }
              : report.status === "TAMPER_MISMATCH"
                ? {
                    backgroundColor: "var(--state-critical-bg)",
                    color: "var(--state-critical-ink)",
                    borderColor: "var(--state-critical-border)",
                  }
                : {
                    backgroundColor: "var(--state-warn-bg)",
                    color: "var(--state-warn-ink)",
                    borderColor: "var(--state-warn-border)",
                  }
          }
        >
          {report.status === "VERIFIED_INTACT"
            ? "SHA-256 VERIFIED INTACT"
            : report.status === "TAMPER_MISMATCH"
              ? "TAMPER MISMATCH"
              : "LEGACY UNSEALED (PRE-PROVENANCE)"}
        </span>
        <button
          type="button"
          onClick={() => onCopySeal(`seal-${dispatchId}`, sealCode)}
          className="sw-btn-secondary min-h-[44px] px-3 text-xs font-semibold"
        >
          {copiedId === `seal-${dispatchId}`
            ? "Copied Seal Code"
            : `Copy Seal (${sealCode})`}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono-telemetry text-xs">
        <div className="sw-card p-2">
          <div style={{ color: "var(--ink-muted)" }}>SOURCES</div>
          <div className="font-bold">
            {report.linkedIntakeCount} ({report.platforms.join("/") || "Synced"})
          </div>
        </div>
        <div className="sw-card p-2">
          <div style={{ color: "var(--ink-muted)" }}>PII ON-DEVICE</div>
          <div className="font-bold">{report.totalPiiKeptOnDevice} blocked</div>
        </div>
        <div className="sw-card p-2">
          <div style={{ color: "var(--ink-muted)" }}>HYBRID SPLIT</div>
          <div className="font-bold">
            {report.onDeviceIntakeCount} local / {report.inCloudIntakeCount} cloud
          </div>
        </div>
        <div className="sw-card p-2">
          <div style={{ color: "var(--ink-muted)" }}>EVIDENCE</div>
          <div className="font-bold">
            {report.hashedEvidenceCount} hash | {report.groundingSourceCount} web
          </div>
        </div>
      </div>

      <div
        className="font-mono-telemetry text-xs break-all"
        style={{ color: "var(--ink-muted)" }}
      >
        Live Recomputed SHA-256: {report.recomputedSha256}
      </div>
    </div>
  );
}
