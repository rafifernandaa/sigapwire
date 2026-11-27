import type { AuditCategory, AuditEvent } from "../lib/auditTrail";
import { PlatformBadge } from "./StatusBadges";

interface AuditTimelinePanelProps {
  filteredEvents: AuditEvent[];
  auditFilter: "ALL" | AuditCategory;
  onChangeFilter: (filter: "ALL" | AuditCategory) => void;
}

const AUDIT_FILTERS: Array<["ALL" | AuditCategory, string]> = [
  ["ALL", "All Events"],
  ["ON_DEVICE", "On-Device"],
  ["IN_CLOUD", "In-Cloud"],
  ["HUMAN_GATE", "Human Gate"],
];

export function AuditTimelinePanel({
  filteredEvents,
  auditFilter,
  onChangeFilter,
}: AuditTimelinePanelProps) {
  return (
    <div className="sw-card p-5 space-y-4">
      <div
        className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div>
          <h2 className="text-base font-bold">
            Unified Hybrid Decision Audit Trail ({filteredEvents.length})
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
            Cross-platform timeline derived from Firestore operational records + local session safety gates.
          </p>
        </div>
      </div>

      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label="Filter audit timeline by authority"
      >
        {AUDIT_FILTERS.map(([cat, label]) => {
          const active = auditFilter === cat;
          return (
            <button
              key={cat}
              type="button"
              aria-pressed={active}
              onClick={() => onChangeFilter(cat)}
              className="sw-tab min-h-[44px] px-3 text-xs font-semibold"
            >
              {label}
            </button>
          );
        })}
      </div>

      {filteredEvents.length === 0 ? (
        <p className="text-xs py-4" style={{ color: "var(--ink-muted)" }}>
          No audit events match this filter yet. Run a Command Desk triage, Offline Drill, Field Check, or Safety Gate review to populate the trace.
        </p>
      ) : (
        <ol className="space-y-2.5 max-h-[780px] overflow-y-auto pr-1">
          {filteredEvents.map((ev) => {
            const catStyle =
              ev.category === "ON_DEVICE"
                ? {
                    backgroundColor: "var(--state-ondevice-bg)",
                    color: "var(--state-ondevice-ink)",
                    borderColor: "var(--state-ondevice-border)",
                  }
                : ev.category === "IN_CLOUD"
                  ? {
                      backgroundColor: "var(--state-cloud-bg)",
                      color: "var(--state-cloud-ink)",
                      borderColor: "var(--state-cloud-border)",
                    }
                  : {
                      backgroundColor: "var(--state-warn-bg)",
                      color: "var(--state-warn-ink)",
                      borderColor: "var(--state-warn-border)",
                    };

            return (
              <li key={ev.id} className="sw-card-ground p-3 text-xs space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className="font-mono-telemetry rounded px-1.5 py-0.5 text-xs font-bold border"
                      style={catStyle}
                    >
                      {ev.category}
                    </span>
                    {ev.platform === "WEB" ||
                    ev.platform === "ANDROID" ||
                    ev.platform === "APPLE" ? (
                      <PlatformBadge platform={ev.platform} />
                    ) : null}
                    <span
                      className="font-mono-telemetry text-xs"
                      style={{ color: "var(--ink-muted)" }}
                    >
                      {ev.eventType}
                    </span>
                  </div>
                  <time
                    dateTime={ev.timestamp.toISOString()}
                    className="font-mono-telemetry text-xs"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    {ev.timestamp.toLocaleTimeString()}
                  </time>
                </div>
                <div className="font-semibold text-sm">{ev.title}</div>
                <p style={{ color: "var(--ink-muted)" }}>{ev.detail}</p>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
