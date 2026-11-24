import type { HybridScorecard } from "../lib/hybridScorecard";

interface HybridScorecardStripProps {
  scorecard: HybridScorecard;
  compact?: boolean;
}

export function HybridScorecardStrip({
  scorecard,
  compact = false,
}: HybridScorecardStripProps) {
  const paddingClass = compact ? "p-3" : "p-4";

  return (
    <section
      aria-label="Hybrid Routing and Privacy Scorecard"
      className={`rounded-lg border ${paddingClass} space-y-2.5`}
      style={{
        backgroundColor: "var(--bg-surface)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div
          className="rounded-md border px-3 py-2.5"
          style={{
            backgroundColor: "var(--state-ondevice-bg)",
            borderColor: "var(--state-ondevice-border)",
            color: "var(--state-ondevice-ink)",
          }}
        >
          <div className="font-mono-telemetry text-[11px] font-semibold uppercase tracking-wide">
            On-Device Share
          </div>
          <div className="mt-0.5 text-lg font-bold">
            {scorecard.onDeviceSharePct}%
          </div>
          <div className="font-mono-telemetry text-[11px]">
            {scorecard.onDeviceExecutions} local / {scorecard.inCloudExecutions} cloud
          </div>
        </div>

        <div
          className="rounded-md border px-3 py-2.5"
          style={{
            backgroundColor: "var(--bg-subtle)",
            borderColor: "var(--border-subtle)",
            color: "var(--ink-primary)",
          }}
        >
          <div
            className="font-mono-telemetry text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: "var(--ink-muted)" }}
          >
            PII Blocked On-Device
          </div>
          <div className="mt-0.5 text-lg font-bold">
            {scorecard.totalPiiBlockedLocally} items
          </div>
          <div
            className="font-mono-telemetry text-[11px]"
            style={{ color: "var(--ink-muted)" }}
          >
            Scrubbed before cloud sync
          </div>
        </div>

        <div
          className="rounded-md border px-3 py-2.5"
          style={{
            backgroundColor: "var(--state-cloud-bg)",
            borderColor: "var(--state-cloud-border)",
            color: "var(--state-cloud-ink)",
          }}
        >
          <div className="font-mono-telemetry text-[11px] font-semibold uppercase tracking-wide">
            Cloud Calls Avoided
          </div>
          <div className="mt-0.5 text-lg font-bold">
            {scorecard.cloudCallsAvoided} ops
          </div>
          <div className="font-mono-telemetry text-[11px]">
            Privacy + local triage + queue
          </div>
        </div>

        <div
          className="rounded-md border px-3 py-2.5"
          style={{
            backgroundColor: "var(--state-warn-bg)",
            borderColor: "var(--state-warn-border)",
            color: "var(--state-warn-ink)",
          }}
        >
          <div className="font-mono-telemetry text-[11px] font-semibold uppercase tracking-wide">
            Human Gate Actions
          </div>
          <div className="mt-0.5 text-lg font-bold">
            {scorecard.humanGateActions}
          </div>
          <div className="font-mono-telemetry text-[11px]">
            Field checks + gate checks
          </div>
        </div>
      </div>

      <div
        className="flex flex-wrap items-center gap-2 rounded border px-3 py-1.5 text-xs"
        style={{
          backgroundColor: "var(--bg-subtle)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <span
          className="font-mono-telemetry text-[11px] font-bold"
          style={{ color: "var(--ink-muted)" }}
        >
          LAST HANDOFF:
        </span>
        <span
          className="font-mono-telemetry text-[11px]"
          style={{ color: "var(--ink-primary)" }}
        >
          {scorecard.lastHandoffLabel}
        </span>
      </div>
    </section>
  );
}
