import type { IntakeDoc, IntakeMode } from "../types/sigapwire";

interface OfflineQueuePanelProps {
  offlineEntries: Array<[string, { mode: IntakeMode; isOfflineDraft: boolean }]>;
  intakes: IntakeDoc[];
  online: boolean;
  rowBusy: Record<string, boolean>;
  rowErrors: Record<string, string>;
  onEscalateVerify: (intake: IntakeDoc) => void;
  onUpgradeCloudTriage: (intake: IntakeDoc) => void;
  onResolveQueued: (id: string) => void;
}

export function OfflineQueuePanel({
  offlineEntries,
  intakes,
  online,
  rowBusy,
  rowErrors,
  onEscalateVerify,
  onUpgradeCloudTriage,
  onResolveQueued,
}: OfflineQueuePanelProps) {
  if (offlineEntries.length === 0) return null;

  return (
    <section
      aria-label="Offline Sync Queue"
      className="sw-card p-5 space-y-3"
    >
      <div
        className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div>
          <h2 className="text-base font-bold">
            Offline Sync Queue ({offlineEntries.length})
          </h2>
          {!online ? (
            <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
              Escalation actions unlock when signal returns and the card finishes syncing.
            </p>
          ) : null}
        </div>
      </div>

      <ul className="space-y-2.5">
        {offlineEntries.map(([id, meta]) => {
          const intake = intakes.find((item) => item.id === id);
          if (!intake) {
            return (
              <li
                key={id}
                className="sw-card-ground p-3 flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="font-mono-telemetry rounded px-2 py-0.5 text-xs border"
                    style={{
                      backgroundColor: "var(--bg-subtle)",
                      borderColor: "var(--border-subtle)",
                    }}
                  >
                    {meta.mode}
                  </span>
                  <span style={{ color: "var(--ink-muted)" }}>
                    Saving locally...
                  </span>
                </div>
                <span
                  className="font-mono-telemetry rounded px-2 py-0.5 text-xs font-semibold border"
                  style={{
                    backgroundColor: "var(--state-warn-bg)",
                    color: "var(--state-warn-ink)",
                    borderColor: "var(--state-warn-border)",
                  }}
                >
                  QUEUED LOCALLY
                </span>
              </li>
            );
          }

          const isSynced = !intake.pendingSync;
          const canAct = online && isSynced && !rowBusy[id];
          const isBusy = Boolean(rowBusy[id]);

          return (
            <li key={id} className="sw-card-ground p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="font-mono-telemetry rounded px-2 py-0.5 text-xs border"
                      style={{
                        backgroundColor: "var(--bg-subtle)",
                        borderColor: "var(--border-subtle)",
                      }}
                    >
                      {intake.mode}
                    </span>
                    <span
                      className="font-mono-telemetry rounded px-2 py-0.5 text-xs font-semibold border"
                      style={{
                        backgroundColor: intake.pendingSync
                          ? "var(--state-warn-bg)"
                          : "var(--state-ondevice-bg)",
                        color: intake.pendingSync
                          ? "var(--state-warn-ink)"
                          : "var(--state-ondevice-ink)",
                        borderColor: intake.pendingSync
                          ? "var(--state-warn-border)"
                          : "var(--state-ondevice-border)",
                      }}
                    >
                      {intake.pendingSync ? "QUEUED LOCALLY" : "SYNCED"}
                    </span>
                  </div>
                  <p className="text-sm font-semibold">
                    {intake.structured.headline}
                  </p>
                </div>

                {intake.mode === "RUMOR_CHECK" ? (
                  <button
                    type="button"
                    onClick={() => onEscalateVerify(intake)}
                    disabled={!canAct}
                    className="sw-btn-cloud min-h-[44px] px-3 text-xs font-semibold"
                  >
                    {isBusy ? "Verifying..." : "Verify with Google Search"}
                  </button>
                ) : meta.isOfflineDraft ? (
                  <button
                    type="button"
                    onClick={() => onUpgradeCloudTriage(intake)}
                    disabled={!canAct}
                    className="sw-btn-cloud min-h-[44px] px-3 text-xs font-semibold"
                  >
                    {isBusy ? "Upgrading..." : "Upgrade with Cloud Triage"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onResolveQueued(id)}
                    disabled={!canAct}
                    className="sw-btn-secondary min-h-[44px] px-3 text-xs font-semibold"
                  >
                    Dismiss
                  </button>
                )}
              </div>

              {rowErrors[id] ? (
                <div
                  role="alert"
                  className="rounded border p-2 text-xs font-medium"
                  style={{
                    backgroundColor: "var(--state-critical-bg)",
                    color: "var(--state-critical-ink)",
                    borderColor: "var(--state-critical-border)",
                  }}
                >
                  {rowErrors[id]}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
