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
  const navItems: Array<{
    id: AppView;
    label: string;
    compactLabel: string;
    shortLabel: string;
    count?: number;
  }> = [
    {
      id: "command",
      label: "Command Desk",
      compactLabel: "Command",
      shortLabel: "Desk",
    },
    {
      id: "studio",
      label: "Broadcast Studio",
      compactLabel: "Broadcast",
      shortLabel: "Studio",
      count: intakeCount,
    },
    {
      id: "wire",
      label: "Public Crisis Wire",
      compactLabel: "Crisis Wire",
      shortLabel: "Wire",
      count: dispatchCount,
    },
    {
      id: "ops",
      label: "Ops Memory & Audit",
      compactLabel: "Ops Audit",
      shortLabel: "Ops",
      count: openTaskCount,
    },
  ];

  const nanoStatusText = (() => {
    if (isDownloadingNano && diagnostics.downloadProgress !== null) {
      return `Downloading ${Math.round(diagnostics.downloadProgress * 100)}%`;
    }
    if (diagnostics.availability === "available") return "Nano Ready";
    if (diagnostics.availability === "downloadable") return "Download Nano";
    if (diagnostics.availability === "downloading") return "Downloading Nano";
    return "Cloud Fallback";
  })();

  const nanoCompactText = (() => {
    if (isDownloadingNano && diagnostics.downloadProgress !== null) {
      return `${Math.round(diagnostics.downloadProgress * 100)}%`;
    }
    if (diagnostics.availability === "available") return "Nano";
    if (diagnostics.availability === "downloadable") return "Nano+";
    if (diagnostics.availability === "downloading") return "Load";
    return "Cloud";
  })();

  const nanoReady = diagnostics.availability === "available";
  const canDownloadNano =
    diagnostics.availability === "downloadable" ||
    diagnostics.availability === "downloading";

  return (
    <>
      <header
        className="sticky top-0 z-30 border-b"
        style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-subtle)",
          boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06)",
        }}
      >
        <div className="mx-auto max-w-7xl px-3 sm:px-6">
          <div className="flex min-h-[58px] items-center justify-between gap-2 py-2">
            {/* Wordmark */}
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => onSelectView("command")}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-md px-0.5 text-left transition-colors hover:opacity-85 active:opacity-75"
                aria-label="SigapWire Home"
              >
                <span
                  className="inline-block h-2.5 w-2.5 sm:h-3 sm:w-3 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: "var(--accent-vermilion)" }}
                  aria-hidden="true"
                />
                <span className="font-editorial text-base sm:text-xl font-bold tracking-tight whitespace-nowrap">
                  SigapWire
                </span>
              </button>
              <span
                className="hidden 2xl:inline-block h-5 w-px"
                style={{ backgroundColor: "var(--border-subtle)" }}
                aria-hidden="true"
              />
              <span
                className="hidden 2xl:inline-block text-xs font-medium whitespace-nowrap"
                style={{ color: "var(--ink-muted)" }}
              >
                Hybrid Crisis Clarity Desk
              </span>
            </div>

            {/* Desktop Primary Navigation (>= lg / 1024px) */}
            <nav
              aria-label="Primary sections"
              className="hidden lg:flex items-center gap-1 shrink-0"
            >
              {navItems.map((item) => {
                const active = activeView === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectView(item.id)}
                    aria-current={active ? "page" : undefined}
                    className="sw-nav-tab inline-flex min-h-[44px] shrink-0 items-center gap-1.5 px-2.5 xl:px-3 py-2 text-xs xl:text-sm whitespace-nowrap"
                  >
                    <span className="xl:hidden">{item.compactLabel}</span>
                    <span className="hidden xl:inline">{item.label}</span>
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
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              {/* Passive Runtime Telemetry Group */}
              <div className="flex items-center gap-1 sm:gap-1.5">
                <div aria-live="polite" className="inline-flex items-center">
                  {pendingSyncCount > 0 ? (
                    <span
                      className="font-mono-telemetry inline-flex min-h-[32px] items-center rounded px-1.5 sm:px-2 text-xs font-semibold border whitespace-nowrap"
                      style={{
                        backgroundColor: "var(--state-warn-bg)",
                        color: "var(--state-warn-ink)",
                        borderColor: "var(--state-warn-border)",
                      }}
                    >
                      <span className="sm:hidden">{pendingSyncCount}</span>
                      <span className="hidden sm:inline">
                        {pendingSyncCount} PENDING SYNC
                      </span>
                    </span>
                  ) : null}
                </div>

                {canDownloadNano ? (
                  <button
                    type="button"
                    onClick={onInitNano}
                    disabled={isDownloadingNano}
                    aria-label={nanoStatusText}
                    className="sw-btn-ondevice font-mono-telemetry inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-2 sm:px-3 text-xs font-semibold whitespace-nowrap"
                  >
                    <span className="sm:hidden">{nanoCompactText}</span>
                    <span className="hidden sm:inline">{nanoStatusText}</span>
                  </button>
                ) : (
                  <span
                    className="font-mono-telemetry inline-flex min-h-[32px] items-center rounded px-2 sm:px-2.5 text-xs font-medium border whitespace-nowrap"
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
                    <span className="sm:hidden">{nanoCompactText}</span>
                    <span className="hidden sm:inline">{nanoStatusText}</span>
                  </span>
                )}
              </div>

              <span
                className="hidden sm:inline-block h-5 w-px"
                style={{ backgroundColor: "var(--border-subtle)" }}
                aria-hidden="true"
              />

              {/* Interactive Controls Group */}
              <button
                type="button"
                onClick={onToggleSimulateOffline}
                disabled={!browserOnline}
                aria-pressed={simulateOffline}
                aria-label={
                  diagnostics.online
                    ? "Online. Click to simulate offline field drill"
                    : "Offline mode active. Click to restore signal"
                }
                title={
                  !browserOnline
                    ? "Browser is currently offline"
                    : simulateOffline
                      ? "Restore signal"
                      : "Simulate field signal loss: AI and sync stay on this device"
                }
                className={`${diagnostics.online ? "sw-btn-subtle" : "sw-btn-warn"} font-mono-telemetry inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-2 sm:px-2.5 text-xs font-medium whitespace-nowrap`}
              >
                <span className="sm:hidden">
                  {diagnostics.online ? "ON" : "OFF"}
                </span>
                <span className="hidden sm:inline">
                  {diagnostics.online
                    ? "ONLINE"
                    : simulateOffline
                      ? "OFFLINE (DRILL)"
                      : "OFFLINE"}
                </span>
              </button>

              <button
                type="button"
                onClick={onToggleTheme}
                aria-label={
                  theme === "light"
                    ? "Switch to night-shift dark mode"
                    : "Switch to daylight light mode"
                }
                className="sw-btn-secondary inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-2 sm:px-3 text-xs font-semibold whitespace-nowrap"
              >
                {theme === "light" ? "Dark" : "Light"}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Dedicated Mobile & Tablet Bottom Navigation Bar (< lg / < 1024px) */}
      <nav
        aria-label="Mobile primary sections"
        className="sw-mobile-bottom-nav fixed inset-x-0 bottom-0 z-30 lg:hidden"
      >
        <div className="mx-auto max-w-3xl grid grid-cols-4 gap-1 px-1.5 py-1">
          {navItems.map((item) => {
            const active = activeView === item.id;
            return (
              <button
                key={`mobile-${item.id}`}
                type="button"
                onClick={() => onSelectView(item.id)}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                className="flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 text-xs transition-colors"
                style={{
                  backgroundColor: active ? "var(--bg-subtle)" : "transparent",
                  color: active ? "var(--ink-primary)" : "var(--ink-muted)",
                  fontWeight: active ? 700 : 500,
                  borderTop: active
                    ? "2px solid var(--accent-vermilion)"
                    : "2px solid transparent",
                }}
              >
                <span className="flex items-center gap-1 leading-none">
                  <span className="sm:hidden">{item.shortLabel}</span>
                  <span className="hidden sm:inline">{item.compactLabel}</span>
                  {typeof item.count === "number" && item.count > 0 ? (
                    <span
                      className="font-mono-telemetry rounded px-1 py-0.5 text-[11px] leading-none"
                      style={{
                        backgroundColor: "var(--bg-surface)",
                        border: "1px solid var(--border-subtle)",
                        color: "var(--ink-primary)",
                      }}
                    >
                      {item.count}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
