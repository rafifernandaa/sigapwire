import type { OnDeviceDiagnostics } from "../types/sigapwire";

export type AppView = "command" | "studio" | "wire" | "ops";

interface TopNavProps {
  activeView: AppView;
  onSelectView: (view: AppView) => void;
  intakeCount: number;
  dispatchCount: number;
  openTaskCount: number;
  diagnostics: OnDeviceDiagnostics;
  simulateOffline: boolean;
  browserOnline: boolean;
  pendingSyncCount: number;
  onToggleSimulateOffline: () => void;
  isDownloadingNano: boolean;
  onInitNano: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}

export function TopNav({
  activeView,
  onSelectView,
  intakeCount,
  dispatchCount,
  openTaskCount,
  diagnostics,
  simulateOffline,
  browserOnline,
  pendingSyncCount,
  onToggleSimulateOffline,
  isDownloadingNano,
  onInitNano,
  theme,
  onToggleTheme,
}: TopNavProps) {
  const navItems: Array<{ id: AppView; label: string; count?: number }> = [
    { id: "command", label: "Command Desk" },
    { id: "studio", label: "Broadcast Studio", count: intakeCount },
    { id: "wire", label: "Public Crisis Wire", count: dispatchCount },
    { id: "ops", label: "Ops Memory & Audit", count: openTaskCount },
  ];

  const nanoStatusText = (() => {
    if (isDownloadingNano && diagnostics.downloadProgress !== null) {
      return `Downloading Nano ${Math.round(diagnostics.downloadProgress * 100)}%`;
    }
    if (diagnostics.availability === "available") return "Nano Ready";
    if (diagnostics.availability === "downloadable") return "Download Nano";
    if (diagnostics.availability === "downloading") return "Downloading Nano";
    return "Cloud Fallback";
  })();

  const nanoReady = diagnostics.availability === "available";
  const canDownloadNano =
    diagnostics.availability === "downloadable" ||
    diagnostics.availability === "downloading";

  return (
    <header
      className="sticky top-0 z-30 border-b"
      style={{
        backgroundColor: "var(--bg-surface)",
        borderColor: "var(--border-subtle)",
        boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06)",
      }}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3 py-3">
          {/* Wordmark */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onSelectView("command")}
              className="inline-flex min-h-[44px] items-center gap-2.5 text-left"
              aria-label="SigapWire Home"
            >
              <span
                className="inline-block h-3 w-3 shrink-0 rounded-[2px]"
                style={{ backgroundColor: "var(--accent-vermilion)" }}
                aria-hidden="true"
              />
              <span className="font-editorial text-xl font-bold tracking-tight">
                SigapWire
              </span>
            </button>
            <span
              className="hidden sm:inline-block h-5 w-px"
              style={{ backgroundColor: "var(--border-subtle)" }}
              aria-hidden="true"
            />
            <span
              className="hidden lg:inline-block text-xs font-medium"
              style={{ color: "var(--ink-muted)" }}
            >
              Hybrid Crisis Clarity Desk
            </span>
          </div>

          {/* Primary Navigation */}
          <nav
            aria-label="Primary sections"
            className="order-3 w-full md:order-2 md:w-auto flex items-center gap-1 overflow-x-auto pb-1 md:pb-0"
          >
            {navItems.map((item) => {
              const active = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectView(item.id)}
                  aria-current={active ? "page" : undefined}
                  className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-md px-3.5 py-2 text-sm transition-colors"
                  style={{
                    backgroundColor: active ? "var(--bg-subtle)" : "transparent",
                    color: "var(--ink-primary)",
                    fontWeight: active ? 700 : 500,
                    borderBottom: active
                      ? "2px solid var(--accent-vermilion)"
                      : "2px solid transparent",
                  }}
                >
                  <span>{item.label}</span>
                  {typeof item.count === "number" && item.count > 0 ? (
                    <span
                      className="font-mono-telemetry rounded px-1.5 py-0.5 text-xs"
                      style={{
                        backgroundColor: "var(--bg-surface)",
                        border: "1px solid var(--border-subtle)",
                        color: "var(--ink-muted)",
                      }}
                    >
                      {item.count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          {/* Runtime Diagnostics & Theme Controls */}
          <div className="order-2 md:order-3 flex items-center gap-2">
            {/* Network Status & Simulated Signal Loss Drill Toggle */}
            <button
              type="button"
              onClick={onToggleSimulateOffline}
              disabled={!browserOnline}
              aria-pressed={simulateOffline}
              title={
                !browserOnline
                  ? "Browser is currently offline"
                  : simulateOffline
                    ? "Restore signal"
                    : "Simulate field signal loss: AI and sync stay on this device"
              }
              className="font-mono-telemetry inline-flex min-h-[44px] items-center rounded px-2.5 text-xs font-medium border transition-colors"
              style={{
                backgroundColor: diagnostics.online
                  ? "var(--bg-subtle)"
                  : "var(--state-warn-bg)",
                color: diagnostics.online
                  ? "var(--ink-muted)"
                  : "var(--state-warn-ink)",
                borderColor: diagnostics.online
                  ? "var(--border-subtle)"
                  : "var(--state-warn-border)",
              }}
            >
              {diagnostics.online
                ? "ONLINE"
                : simulateOffline
                  ? "OFFLINE (DRILL)"
                  : "OFFLINE"}
            </button>

            <div aria-live="polite" className="inline-flex items-center">
              {pendingSyncCount > 0 ? (
                <span
                  className="font-mono-telemetry inline-flex min-h-[36px] items-center rounded px-2.5 text-xs font-semibold border"
                  style={{
                    backgroundColor: "var(--state-warn-bg)",
                    color: "var(--state-warn-ink)",
                    borderColor: "var(--state-warn-border)",
                  }}
                >
                  {pendingSyncCount} PENDING SYNC
                </span>
              ) : null}
            </div>

            {/* On-Device Nano Status / Trigger */}
            {canDownloadNano ? (
              <button
                type="button"
                onClick={onInitNano}
                disabled={isDownloadingNano}
                className="font-mono-telemetry inline-flex min-h-[44px] items-center rounded-md px-3 text-xs font-semibold border transition-colors"
                style={{
                  backgroundColor: "var(--state-ondevice-bg)",
                  color: "var(--state-ondevice-ink)",
                  borderColor: "var(--state-ondevice-border)",
                }}
              >
                {nanoStatusText}
              </button>
            ) : (
              <span
                className="font-mono-telemetry inline-flex min-h-[36px] items-center rounded px-2.5 text-xs font-medium border"
                style={{
                  backgroundColor: nanoReady
                    ? "var(--state-ondevice-bg)"
                    : "var(--state-cloud-bg)",
                  color: nanoReady
                    ? "var(--state-ondevice-ink)"
                    : "var(--state-cloud-ink)",
                  borderColor: nanoReady
                    ? "var(--state-ondevice-border)"
                    : "var(--state-cloud-border)",
                }}
                title={
                  nanoReady
                    ? "Chrome Prompt API Gemini Nano is active on this device"
                    : "This browser will route hybrid calls to Cloud Gemini automatically"
                }
              >
                {nanoStatusText}
              </span>
            )}

            {/* Theme Toggle */}
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={
                theme === "light"
                  ? "Switch to night-shift dark mode"
                  : "Switch to daylight light mode"
              }
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md px-3 text-xs font-semibold border transition-colors"
              style={{
                backgroundColor: "var(--bg-surface)",
                color: "var(--ink-primary)",
                borderColor: "var(--border-strong)",
              }}
            >
              {theme === "light" ? "Dark" : "Light"}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
