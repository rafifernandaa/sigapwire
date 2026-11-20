import { useCallback, useEffect, useMemo, useState } from "react";
import { BroadcastStudio } from "./components/BroadcastStudio";
import { CommandDesk } from "./components/CommandDesk";
import { PublicCrisisWire } from "./components/PublicCrisisWire";
import { TopNav, type AppView } from "./components/TopNav";
import {
  ensureAnonymousAuth,
  isFirebaseConfigured,
  loadRemoteModelConfig,
} from "./lib/firebase";
import {
  DEFAULT_DEMO_INCIDENT_ID,
  ensureDemoIncidentExists,
  subscribeDispatches,
  subscribeIncidents,
  subscribeIntakes,
} from "./lib/firestoreRepo";
import {
  checkOnDeviceDiagnostics,
  triggerOnDeviceModelInit,
} from "./lib/hybridAi";
import type {
  DispatchDoc,
  IncidentDoc,
  IntakeDoc,
  OnDeviceDiagnostics,
} from "./types/sigapwire";

export function App() {
  const [activeView, setActiveView] = useState<AppView>("command");
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
      ? "dark"
      : "light",
  );

  const [diagnostics, setDiagnostics] = useState<OnDeviceDiagnostics>({
    browserSupported: false,
    availability: "unsupported",
    downloadProgress: null,
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
  });
  const [isDownloadingNano, setIsDownloadingNano] = useState(false);

  const [incidents, setIncidents] = useState<IncidentDoc[]>([]);
  const [intakes, setIntakes] = useState<IntakeDoc[]>([]);
  const [dispatches, setDispatches] = useState<DispatchDoc[]>([]);
  const [intakesLoading, setIntakesLoading] = useState(true);
  const [dispatchesLoading, setDispatchesLoading] = useState(true);
  const [firebaseNotice, setFirebaseNotice] = useState<string | null>(null);

  const activeIncidentId = incidents[0]?.id ?? DEFAULT_DEMO_INCIDENT_ID;
  const activeIncident = useMemo(
    () => incidents.find((i) => i.id === activeIncidentId) ?? null,
    [incidents, activeIncidentId],
  );

  const refreshDiagnostics = useCallback(async () => {
    const status = await checkOnDeviceDiagnostics();
    setDiagnostics(status);
  }, []);

  useEffect(() => {
    refreshDiagnostics();
    const handleNetwork = () => {
      setDiagnostics((prev) => ({ ...prev, online: navigator.onLine }));
    };
    window.addEventListener("online", handleNetwork);
    window.addEventListener("offline", handleNetwork);
    return () => {
      window.removeEventListener("online", handleNetwork);
      window.removeEventListener("offline", handleNetwork);
    };
  }, [refreshDiagnostics]);

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setIntakesLoading(false);
      setDispatchesLoading(false);
      setFirebaseNotice(
        "Firebase keys are missing in web/.env.local. On-device Chrome Gemini Nano and local PII redaction still work; add Firebase credentials to enable Firestore sync and Cloud Gemini.",
      );
      return;
    }

    let unsubIncidents: (() => void) | null = null;
    let unsubIntakes: (() => void) | null = null;
    let unsubDispatches: (() => void) | null = null;
    let cancelled = false;

    async function bootstrapFirebase() {
      try {
        await ensureAnonymousAuth();
        await loadRemoteModelConfig();
        const incId = await ensureDemoIncidentExists();
        if (cancelled) return;

        setFirebaseNotice(null);

        unsubIncidents = subscribeIncidents(
          (list) => setIncidents(list),
          (err) => setFirebaseNotice(`Firestore incidents sync error: ${err.message}`),
        );

        unsubIntakes = subscribeIntakes(
          incId,
          (list) => {
            setIntakes(list);
            setIntakesLoading(false);
          },
          (err) => {
            setIntakesLoading(false);
            setFirebaseNotice(`Firestore intakes sync error: ${err.message}`);
          },
        );

        unsubDispatches = subscribeDispatches(
          incId,
          (list) => {
            setDispatches(list);
            setDispatchesLoading(false);
          },
          (err) => {
            setDispatchesLoading(false);
            setFirebaseNotice(`Firestore dispatches sync error: ${err.message}`);
          },
        );
      } catch (err) {
        if (cancelled) return;
        setIntakesLoading(false);
        setDispatchesLoading(false);
        const msg = err instanceof Error ? err.message : String(err);
        setFirebaseNotice(
          `Firebase initialization warning: ${msg}. If App Check is enforced locally, copy the App Check debug token UUID from Chrome DevTools Console and register it under Security > App Check > Apps > Manage debug tokens.`,
        );
      }
    }

    bootstrapFirebase();

    return () => {
      cancelled = true;
      unsubIncidents?.();
      unsubIntakes?.();
      unsubDispatches?.();
    };
  }, []);

  const handleToggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("sigapwire-theme", next);
    } catch {
      // Ignore storage failures in private browsing.
    }
  };

  const handleInitNano = async () => {
    setIsDownloadingNano(true);
    try {
      await triggerOnDeviceModelInit((fraction) => {
        setDiagnostics((prev) => ({
          ...prev,
          availability: fraction >= 1 ? "available" : "downloading",
          downloadProgress: fraction,
        }));
      });
      await refreshDiagnostics();
    } catch (err) {
      setFirebaseNotice(
        err instanceof Error
          ? `On-device model init notice: ${err.message}`
          : "Could not initialize Chrome on-device model. Ensure Chrome Desktop v139+ with #prompt-api-for-gemini-nano-multimodal-input enabled.",
      );
    } finally {
      setIsDownloadingNano(false);
    }
  };

  const nextDispatchNumber =
    dispatches.reduce((max, d) => Math.max(max, d.dispatchNumber), 0) + 1;

  return (
    <div className="min-h-screen flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:px-3 focus:py-2 focus:text-sm focus:font-semibold"
        style={{
          backgroundColor: "var(--accent-vermilion)",
          color: "#ffffff",
        }}
      >
        Skip to main content
      </a>

      <TopNav
        activeView={activeView}
        onSelectView={setActiveView}
        intakeCount={intakes.length}
        dispatchCount={dispatches.length}
        diagnostics={diagnostics}
        isDownloadingNano={isDownloadingNano}
        onInitNano={handleInitNano}
        theme={theme}
        onToggleTheme={handleToggleTheme}
      />

      {firebaseNotice ? (
        <div
          role="status"
          className="border-b px-4 py-2.5 text-xs font-medium"
          style={{
            backgroundColor: "var(--state-warn-bg)",
            color: "var(--state-warn-ink)",
            borderColor: "var(--state-warn-border)",
          }}
        >
          <div className="mx-auto max-w-7xl">{firebaseNotice}</div>
        </div>
      ) : null}

      <main id="main-content" className="flex-1">
        {activeView === "command" ? (
          <CommandDesk
            activeIncidentId={activeIncidentId}
            diagnostics={diagnostics}
            onSavedIntake={() => {}}
            onInitNano={handleInitNano}
            isDownloadingNano={isDownloadingNano}
          />
        ) : null}

        {activeView === "studio" ? (
          <BroadcastStudio
            activeIncident={activeIncident}
            intakes={intakes}
            intakesLoading={intakesLoading}
            nextDispatchNumber={nextDispatchNumber}
            diagnostics={diagnostics}
            onGoToCommand={() => setActiveView("command")}
            onPublishedDispatch={() => setActiveView("wire")}
          />
        ) : null}

        {activeView === "wire" ? (
          <PublicCrisisWire
            activeIncident={activeIncident}
            dispatches={dispatches}
            dispatchesLoading={dispatchesLoading}
            onGoToStudio={() => setActiveView("studio")}
          />
        ) : null}
      </main>

      <footer
        className="border-t py-4 px-4 sm:px-6 text-xs"
        style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-subtle)",
          color: "var(--ink-muted)",
        }}
      >
        <div className="mx-auto max-w-7xl flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <span>
            SigapWire is an independent open-source project built with Firebase AI Logic hybrid inference.
          </span>
          <span>
            Bundled scenarios are synthetic disaster drills and do not represent official agency statements.
          </span>
        </div>
      </footer>
    </div>
  );
}
