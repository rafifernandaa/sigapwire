import type { HybridScorecard } from "../lib/hybridScorecard";

interface HybridScorecardStripProps {
  scorecard: HybridScorecard;
  compact?: boolean;
}

export function HybridScorecardStrip({
  scorecard,
  compact = false,
}: HybridScorecardStripProps) {
  if (compact) {
    return (
      <section
        aria-label="Live Hybrid Routing Telemetry"
        className="sw-card px-4 py-3 text-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
            <div className="flex items-baseline gap-1.5">
              <span style={{ color: "var(--ink-muted)" }}>On-device share</span>
              <span
                className="font-mono-telemetry text-sm font-bold"
                style={{ color: "var(--state-ondevice-ink)" }}
              >
                {scorecard.onDeviceSharePct}%
              </span>
              <span
                className="font-mono-telemetry text-[11px]"
                style={{ color: "var(--ink-muted)" }}
              >
                ({scorecard.onDeviceExecutions} local / {scorecard.inCloudExecutions} cloud)
              </span>
            </div>

            <div className="flex items-baseline gap-1.5">
              <span style={{ color: "var(--ink-muted)" }}>PII kept local</span>
              <span className="font-mono-telemetry text-sm font-bold">
                {scorecard.totalPiiBlockedLocally}
              </span>
            </div>

            <div className="flex items-baseline gap-1.5">
              <span style={{ color: "var(--ink-muted)" }}>Cloud calls avoided</span>
              <span
                className="font-mono-telemetry text-sm font-bold"
                style={{ color: "var(--state-cloud-ink)" }}
              >
                {scorecard.cloudCallsAvoided}
              </span>
            </div>

            <div className="flex items-baseline gap-1.5">
              <span style={{ color: "var(--ink-muted)" }}>Human gates</span>
              <span
                className="font-mono-telemetry text-sm font-bold"
                style={{ color: "var(--state-warn-ink)" }}
              >
                {scorecard.humanGateActions}
              </span>
            </div>
          </div>

          <div
            className="font-mono-telemetry text-[11px]"
            style={{ color: "var(--ink-muted)" }}
          >
            Last handoff:{" "}
            <span style={{ color: "var(--ink-primary)" }}>
              {scorecard.lastHandoffLabel}
            </span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Hybrid Routing and Privacy Scorecard"
      className="sw-card p-4 sm:p-5 space-y-3"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* Primary Lead Metric: On-Device Share */}
        <div
          className="lg:col-span-4 rounded-md border p-4 flex flex-col justify-between"
          style={{
            backgroundColor: "var(--state-ondevice-bg)",
            borderColor: "var(--state-ondevice-border)",
            color: "var(--state-ondevice-ink)",
          }}
        >
          <div>
            <div className="text-xs font-semibold">
              On-Device Hybrid Share
            </div>
            <div className="mt-1 font-mono-telemetry text-2xl font-bold">
              {scorecard.onDeviceSharePct}%
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            <div
              className="h-1.5 w-full overflow-hidden rounded-full"
              style={{ backgroundColor: "var(--bg-surface)" }}
              role="progressbar"
              aria-label="Percentage of hybrid executions completed on-device"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={scorecard.onDeviceSharePct}
            >
              <div
                className="h-full"
                style={{
                  width: `${scorecard.onDeviceSharePct}%`,
                  backgroundColor: "var(--state-ondevice-ink)",
                }}
              />
            </div>
            <div className="font-mono-telemetry text-xs">
              {scorecard.onDeviceExecutions} on-device / {scorecard.inCloudExecutions} in-cloud
            </div>
          </div>
        </div>

        {/* Supporting Operational Metrics on Clean Neutral Surfaces */}
        <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sw-card-ground p-4 flex flex-col justify-between">
            <div className="text-xs font-semibold" style={{ color: "var(--ink-muted)" }}>
              PII Blocked On-Device
            </div>
            <div className="mt-1 font-mono-telemetry text-xl font-bold">
              {scorecard.totalPiiBlockedLocally} items
            </div>
            <div className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
              Scrubbed before cloud sync
            </div>
          </div>

          <div className="sw-card-ground p-4 flex flex-col justify-between">
            <div className="text-xs font-semibold" style={{ color: "var(--ink-muted)" }}>
              Cloud Calls Avoided
            </div>
            <div
              className="mt-1 font-mono-telemetry text-xl font-bold"
              style={{ color: "var(--state-cloud-ink)" }}
            >
              {scorecard.cloudCallsAvoided} ops
            </div>
            <div className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
              Local privacy, triage &amp; queue
            </div>
          </div>

          <div className="sw-card-ground p-4 flex flex-col justify-between">
            <div className="text-xs font-semibold" style={{ color: "var(--ink-muted)" }}>
              Human Gate Actions
            </div>
            <div
              className="mt-1 font-mono-telemetry text-xl font-bold"
              style={{ color: "var(--state-warn-ink)" }}
            >
              {scorecard.humanGateActions}
            </div>
            <div className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
              Field checks &amp; release gates
            </div>
          </div>
        </div>
      </div>

      <div className="sw-card-subtle flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
        <span
          className="font-mono-telemetry font-bold"
          style={{ color: "var(--ink-muted)" }}
        >
          LAST HANDOFF:
        </span>
        <span
          className="font-mono-telemetry"
          style={{ color: "var(--ink-primary)" }}
        >
          {scorecard.lastHandoffLabel}
        </span>
      </div>
    </section>
  );
}
