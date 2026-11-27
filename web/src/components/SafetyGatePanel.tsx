import type {
  SafetyGateCheckId,
  SafetyGateEvaluation,
} from "../lib/broadcastSafetyGate";

interface SafetyGatePanelProps {
  gateEvaluation: SafetyGateEvaluation;
  requiresSignOff: boolean;
  commanderSignedOff: boolean;
  simulatedFaultActive: boolean;
  repairsApplied: string[];
  online: boolean;
  gateGapDispatchBusy: boolean;
  gateGapDispatched: boolean;
  onToggleDrillFault: () => void;
  onRepairRule: (checkId: SafetyGateCheckId) => void;
  onDispatchFirstGap: () => void;
  onChangeCommanderSignOff: (checked: boolean) => void;
}

export function SafetyGatePanel({
  gateEvaluation,
  requiresSignOff,
  commanderSignedOff,
  simulatedFaultActive,
  repairsApplied,
  online,
  gateGapDispatchBusy,
  gateGapDispatched,
  onToggleDrillFault,
  onRepairRule,
  onDispatchFirstGap,
  onChangeCommanderSignOff,
}: SafetyGatePanelProps) {
  return (
    <section
      aria-label="Pre-Publish Safety Gate"
      className="rounded-lg border p-4 space-y-3"
      style={{
        backgroundColor: "var(--bg-ground)",
        borderColor:
          gateEvaluation.blockCount > 0
            ? "var(--state-critical-border)"
            : requiresSignOff && !commanderSignedOff
              ? "var(--state-warn-border)"
              : "var(--state-ondevice-border)",
      }}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold">
            Pre-Publish Safety Gate (Deterministic)
          </h3>
          <span
            aria-live="polite"
            className="font-mono-telemetry rounded px-2 py-0.5 text-xs font-semibold border"
            style={
              gateEvaluation.blockCount > 0
                ? {
                    backgroundColor: "var(--state-critical-bg)",
                    color: "var(--state-critical-ink)",
                    borderColor: "var(--state-critical-border)",
                  }
                : requiresSignOff && !commanderSignedOff
                  ? {
                      backgroundColor: "var(--state-warn-bg)",
                      color: "var(--state-warn-ink)",
                      borderColor: "var(--state-warn-border)",
                    }
                  : {
                      backgroundColor: "var(--state-ondevice-bg)",
                      color: "var(--state-ondevice-ink)",
                      borderColor: "var(--state-ondevice-border)",
                    }
            }
          >
            {gateEvaluation.blockCount > 0
              ? `PUBLISH BLOCKED (${gateEvaluation.blockCount})`
              : requiresSignOff && !commanderSignedOff
                ? "SIGN-OFF REQUIRED"
                : "GATE PASSED"}
          </span>
          {simulatedFaultActive ? (
            <span
              className="font-mono-telemetry rounded px-2 py-0.5 text-xs font-semibold border"
              style={{
                backgroundColor: "var(--state-warn-bg)",
                color: "var(--state-warn-ink)",
                borderColor: "var(--state-warn-border)",
              }}
            >
              SIMULATED FAULT ACTIVE
            </span>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onToggleDrillFault}
          className="sw-btn-secondary min-h-[44px] px-3 text-xs font-semibold"
        >
          {simulatedFaultActive
            ? "Restore Pre-Drill Draft"
            : "Test Safety Gate (Drill)"}
        </button>
      </div>

      <ul className="space-y-2">
        {gateEvaluation.checks.map((check) => {
          const badgeStyle =
            check.status === "BLOCK"
              ? {
                  backgroundColor: "var(--state-critical-bg)",
                  color: "var(--state-critical-ink)",
                  borderColor: "var(--state-critical-border)",
                }
              : check.status === "WARN"
                ? {
                    backgroundColor: "var(--state-warn-bg)",
                    color: "var(--state-warn-ink)",
                    borderColor: "var(--state-warn-border)",
                  }
                : {
                    backgroundColor: "var(--state-ondevice-bg)",
                    color: "var(--state-ondevice-ink)",
                    borderColor: "var(--state-ondevice-border)",
                  };

          return (
            <li key={check.id} className="sw-card p-3 text-xs space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="font-mono-telemetry rounded px-1.5 py-0.5 text-xs font-bold border"
                      style={badgeStyle}
                    >
                      {check.status}
                    </span>
                    <span className="font-semibold">{check.label}</span>
                  </div>
                  <p style={{ color: "var(--ink-muted)" }}>{check.summary}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {check.id === "GAP_DISCLOSURE_CHECK" &&
                  gateEvaluation.missingGaps.length > 0 ? (
                    <button
                      type="button"
                      disabled={
                        gateGapDispatchBusy || gateGapDispatched || !online
                      }
                      onClick={onDispatchFirstGap}
                      className={`${gateGapDispatched ? "sw-btn-ondevice" : "sw-btn-warn"} min-h-[44px] px-3 text-xs font-semibold`}
                    >
                      {gateGapDispatched
                        ? "Field Check Sent"
                        : gateGapDispatchBusy
                          ? "Dispatching..."
                          : "Request Field Check"}
                    </button>
                  ) : null}

                  {check.repairActionLabel ? (
                    <button
                      type="button"
                      onClick={() => onRepairRule(check.id)}
                      className="sw-btn-secondary min-h-[44px] px-3 text-xs font-semibold"
                    >
                      {check.repairActionLabel}
                    </button>
                  ) : null}
                </div>
              </div>

              {check.findings.length > 0 ? (
                <ul
                  className="list-disc pl-4 space-y-0.5 font-mono-telemetry text-xs"
                  style={{ color: "var(--ink-muted)" }}
                >
                  {check.findings.slice(0, 3).map((finding, idx) => (
                    <li key={`${check.id}-f-${idx}`}>
                      {finding.channel}.{finding.field}: {finding.excerpt}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>

      {repairsApplied.length > 0 ? (
        <div
          className="sw-card-subtle px-3 py-2 text-xs font-mono-telemetry"
          style={{ color: "var(--ink-muted)" }}
        >
          Repairs applied: {repairsApplied.join(" | ")}
        </div>
      ) : null}

      {requiresSignOff ? (
        <label
          htmlFor="commander-release-signoff"
          className="min-h-[44px] flex items-start gap-2.5 rounded-md border p-3 text-xs font-medium"
          style={{
            backgroundColor: "var(--state-warn-bg)",
            color: "var(--state-warn-ink)",
            borderColor: "var(--state-warn-border)",
          }}
        >
          <input
            id="commander-release-signoff"
            type="checkbox"
            checked={commanderSignedOff}
            onChange={(e) => onChangeCommanderSignOff(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span>
            <strong>Commander Release Sign-Off:</strong> I have reviewed the deterministic gate checks, applied repairs, and open information gaps, and authorize public release.
          </span>
        </label>
      ) : null}
    </section>
  );
}
