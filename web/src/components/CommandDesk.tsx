import { useRef, useState } from "react";
import { SYNTHETIC_SCENARIOS } from "../data/syntheticScenarios";
import { formatAreaKnowledgeBlock } from "../lib/areaKnowledgeContext";
import {
  evaluateTokenRoute,
  runLocalPrivacyFirewall,
  triageIntakeHybrid,
  verifyRumorWithGoogleSearch,
  type GroundedVerificationResult,
  type HybridTriageResult,
} from "../lib/hybridAi";
import {
  DEFAULT_DEMO_INCIDENT_ID,
  ensureDemoIncidentExists,
  saveIntakeToFirestore,
  updateIntakeCloudTriage,
  updateIntakeVerification,
} from "../lib/firestoreRepo";
import { isFirebaseConfigured } from "../lib/firebase";
import type {
  AreaKnowledgeDoc,
  IntakeDoc,
  IntakeMode,
  LocalPrivacyResult,
  OnDeviceDiagnostics,
  SessionAuditEvent,
} from "../types/sigapwire";
import { InferenceBadge, SeverityBadge, VerdictBadge } from "./StatusBadges";

interface CommandDeskProps {
  activeIncidentId: string;
  diagnostics: OnDeviceDiagnostics;
  areaKnowledge: AreaKnowledgeDoc[];
  onRequestFieldCheck: (
    question: string,
    location: string,
    linkedIntakeId: string | null,
  ) => Promise<void>;
  onLogSessionEvent: (event: Omit<SessionAuditEvent, "id" | "timestamp">) => void;
  onSavedIntake: (
    id: string,
    meta: { capturedOffline: boolean; mode: IntakeMode; isOfflineDraft: boolean },
  ) => void;
  intakes: IntakeDoc[];
  offlineQueue: Record<string, { mode: IntakeMode; isOfflineDraft: boolean }>;
  onResolveQueued: (id: string) => void;
  onInitNano: () => void;
  isDownloadingNano: boolean;
}

function highlightRedactions(text: string) {
  const parts = text.split(/(\[[A-Z0-9_]+\])/g);
  return parts.map((part, idx) => {
    if (/^\[[A-Z0-9_]+\]$/.test(part)) {
      return (
        <mark
          key={idx}
          className="font-mono-telemetry rounded px-1 py-0.5 text-xs font-semibold"
          style={{
            backgroundColor: "var(--state-ondevice-bg)",
            color: "var(--state-ondevice-ink)",
          }}
        >
          {part}
        </mark>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

export function CommandDesk({
  activeIncidentId,
  diagnostics,
  areaKnowledge,
  onRequestFieldCheck,
  onLogSessionEvent,
  onSavedIntake,
  intakes,
  offlineQueue,
  onResolveQueued,
  onInitNano,
  isDownloadingNano,
}: CommandDeskProps) {
  const [mode, setMode] = useState<IntakeMode>("FIELD_REPORT");
  const [rawInput, setRawInput] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [forceCloudFallback, setForceCloudFallback] = useState(false);

  const [stepStatus, setStepStatus] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);
  const [isVerifyingSearch, setIsVerifyingSearch] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [lastSavedIntakeId, setLastSavedIntakeId] = useState<string | null>(null);
  const [gapDispatchBusy, setGapDispatchBusy] = useState<Record<number, boolean>>({});
  const [dispatchedGaps, setDispatchedGaps] = useState<Record<number, boolean>>({});

  const activeAkContext = formatAreaKnowledgeBlock(areaKnowledge);

  const [privacyResult, setPrivacyResult] = useState<LocalPrivacyResult | null>(
    null,
  );
  const [triageResult, setTriageResult] = useState<HybridTriageResult | null>(
    null,
  );
  const [groundedResult, setGroundedResult] =
    useState<GroundedVerificationResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const filteredScenarios = SYNTHETIC_SCENARIOS.filter((s) => s.mode === mode);
  const tokenRoute = evaluateTokenRoute(rawInput, Boolean(imageFile));

  const handleModeChange = (nextMode: IntakeMode) => {
    setMode(nextMode);
    setErrorMsg(null);
    setSaveFeedback(null);
  };

  const handleLoadScenario = (text: string) => {
    setRawInput(text);
    setPrivacyResult(null);
    setTriageResult(null);
    setGroundedResult(null);
    setErrorMsg(null);
    setSaveFeedback(null);
  };

  const handleImageSelect = (file: File | null) => {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    if (!file) {
      setImageFile(null);
      setImagePreviewUrl(null);
      return;
    }
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setErrorMsg(
        "On-device image analysis supports JPEG and PNG files. Please choose a .jpg or .png image.",
      );
      return;
    }
    setErrorMsg(null);
    setImageFile(file);
    setImagePreviewUrl(URL.createObjectURL(file));
  };

  const handleRunPipeline = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = rawInput.trim();
    if (!trimmed) {
      setErrorMsg(
        "Enter a raw field note or forwarded rumor (or load a Synthetic Drill below) before running triage.",
      );
      return;
    }

      setErrorMsg(null);
      setSaveFeedback(null);
      setLastSavedIntakeId(null);
      setDispatchedGaps({});
      setPrivacyResult(null);
      setTriageResult(null);
      setGroundedResult(null);
      setIsRunning(true);

    try {
      // Step 1: Strictly local PII redaction (ONLY_ON_DEVICE + deterministic guard)
      setStepStatus(
        "Step 1/2: Running local privacy firewall (ONLY_ON_DEVICE) to strip PII...",
      );
      const privacy = await runLocalPrivacyFirewall(trimmed);
      setPrivacyResult(privacy);

      // Step 2: Hybrid structured JSON triage (PREFER_ON_DEVICE -> auto Cloud escalation/fallback)
      setStepStatus(
        !diagnostics.online
          ? "Step 2/2: Offline. Running triage on this device only (ONLY_ON_DEVICE)..."
          : forceCloudFallback
            ? "Step 2/2: Structuring sanitized payload via Cloud Gemini (simulated mid-range fallback)..."
            : tokenRoute.exceedsLocalBudget
              ? `Step 2/2: Input (~${tokenRoute.estimatedTokens} est. tokens) exceeds local Nano budget; auto-escalating sanitized payload to Cloud Gemini...`
              : "Step 2/2: Running hybrid structured triage (PREFER_ON_DEVICE)...",
      );
      const triaged = await triageIntakeHybrid({
        mode,
        sanitizedText: privacy.sanitizedText,
        imageFile,
        forceCloudFallback,
        offline: !diagnostics.online,
        areaKnowledge,
      });
      setTriageResult(triaged);
      if (triaged.isOfflineDraft) {
        onLogSessionEvent({
          category: "ON_DEVICE",
          eventType: "OFFLINE_DRAFT_GENERATED",
          title: "Offline Deterministic Draft Created",
          detail: `${triaged.structured.headline} (${privacy.redactions.length} PII scrubbed locally).`,
        });
      }
      setStepStatus("");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Hybrid inference failed unexpectedly.";
      setErrorMsg(message);
      setStepStatus("");
    } finally {
      setIsRunning(false);
    }
  };

  const handleVerifyWithSearch = async () => {
    if (!privacyResult || !triageResult) return;
    if (!diagnostics.online) {
      setErrorMsg(
        "Device is offline. Google Search Grounding requires cloud connectivity; your local triage card is preserved until signal returns.",
      );
      return;
    }

    setErrorMsg(null);
    setIsVerifyingSearch(true);
    try {
      const verification = await verifyRumorWithGoogleSearch({
        sanitizedClaim: privacyResult.sanitizedText,
        locationHint: triageResult.structured.location,
      });
      setGroundedResult(verification);
      setTriageResult((prev) =>
        prev
          ? {
              ...prev,
              structured: {
                ...prev.structured,
                rumorVerdict: verification.verdict,
                summaryId: verification.factId,
                summaryEn: verification.factEn,
                groundingSources: verification.sources,
                searchEntryPointHtml: verification.searchEntryPointHtml,
              },
            }
          : prev,
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Google Search Grounding call failed. Verify App Check debug token registration.",
      );
    } finally {
      setIsVerifyingSearch(false);
    }
  };

  const handleSaveToQueue = async () => {
    if (!privacyResult || !triageResult) return;
    if (!isFirebaseConfigured()) {
      setErrorMsg(
        "Firebase is not configured yet. Add credentials to web/.env.local to sync across devices.",
      );
      return;
    }

    setErrorMsg(null);
    setSaveFeedback(null);
    setIsSaving(true);
    try {
      const capturedOffline = !diagnostics.online;
      const incidentId =
        activeIncidentId || (await ensureDemoIncidentExists()) || DEFAULT_DEMO_INCIDENT_ID;
      const { id, serverAck } = await saveIntakeToFirestore({
        incidentId,
        mode,
        sourcePlatform: "WEB",
        inferenceSource: triageResult.inferenceSource,
        inferenceModeRequested: capturedOffline
          ? "ONLY_ON_DEVICE"
          : forceCloudFallback || tokenRoute.exceedsLocalBudget
            ? "ONLY_IN_CLOUD"
            : "PREFER_ON_DEVICE",
        latencyMs: triageResult.latencyMs,
        piiRedactedLocally: true,
        redactionCount: privacyResult.redactions.length,
        sanitizedText: privacyResult.sanitizedText,
        hasAttachment: Boolean(imageFile),
        structured: triageResult.structured,
        status:
          mode === "RUMOR_CHECK" && groundedResult ? "VERIFIED" : "TRIAGED",
      });

      if (capturedOffline) {
        serverAck.catch((err) => {
          setErrorMsg(
            err instanceof Error
              ? err.message
              : "Failed to sync offline intake when connectivity returned.",
          );
        });
      } else {
        await serverAck;
      }

      setSaveFeedback(
        diagnostics.online
          ? "Saved sanitized card to Firestore Incident Queue. Ready in Broadcast Studio."
          : "Saved to local Firestore offline cache. Will automatically sync when connectivity returns.",
      );
      setLastSavedIntakeId(id);
      onSavedIntake(id, {
        capturedOffline,
        mode,
        isOfflineDraft: triageResult.isOfflineDraft,
      });
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Failed to save intake to Firestore.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const offlineEntries = Object.entries(offlineQueue);

  const handleEscalateVerify = async (intake: IntakeDoc) => {
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[intake.id];
      return next;
    });
    setRowBusy((prev) => ({ ...prev, [intake.id]: true }));
    try {
      const res = await verifyRumorWithGoogleSearch({
        sanitizedClaim: intake.sanitizedText,
        locationHint: intake.structured.location,
      });
      await updateIntakeVerification(intake.id, {
        verdict: res.verdict,
        factId: res.factId,
        factEn: res.factEn,
        sources: res.sources,
        searchEntryPointHtml: res.searchEntryPointHtml,
      });
      onResolveQueued(intake.id);
    } catch (err) {
      setRowErrors((prev) => ({
        ...prev,
        [intake.id]:
          err instanceof Error
            ? err.message
            : "Google Search verification failed.",
      }));
    } finally {
      setRowBusy((prev) => ({ ...prev, [intake.id]: false }));
    }
  };

  const handleUpgradeCloudTriage = async (intake: IntakeDoc) => {
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[intake.id];
      return next;
    });
    setRowBusy((prev) => ({ ...prev, [intake.id]: true }));
    try {
      const res = await triageIntakeHybrid({
        mode: intake.mode,
        sanitizedText: intake.sanitizedText,
        forceCloudFallback: true,
        areaKnowledge,
      });
      await updateIntakeCloudTriage(intake.id, res.structured, res.latencyMs);
      onLogSessionEvent({
        category: "IN_CLOUD",
        eventType: "OFFLINE_DRAFT_UPGRADED",
        title: "Offline Draft Upgraded with Cloud Triage",
        detail: `${res.structured.headline} (${res.latencyMs}ms).`,
      });
      onResolveQueued(intake.id);
    } catch (err) {
      setRowErrors((prev) => ({
        ...prev,
        [intake.id]:
          err instanceof Error
            ? err.message
            : "Cloud triage upgrade failed.",
      }));
    } finally {
      setRowBusy((prev) => ({ ...prev, [intake.id]: false }));
    }
  };

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
      {/* Section Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b pb-5" style={{ borderColor: "var(--border-subtle)" }}>
        <div>
          <h1 className="font-editorial text-2xl sm:text-3xl font-bold tracking-tight">
            Rapid Intake &amp; Local Privacy Firewall
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm" style={{ color: "var(--ink-muted)" }}>
            Scrub sensitive personal details strictly on-device, structure messy Indonesian or English field reports into verified JSON, and escalate scrubbed rumors to live Google Search grounding.
          </p>
        </div>
        {diagnostics.availability === "downloadable" ? (
          <button
            type="button"
            onClick={onInitNano}
            disabled={isDownloadingNano}
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-md px-4 text-sm font-semibold border"
            style={{
              backgroundColor: "var(--state-ondevice-bg)",
              color: "var(--state-ondevice-ink)",
              borderColor: "var(--state-ondevice-border)",
            }}
          >
            {isDownloadingNano
              ? "Downloading Gemini Nano..."
              : "Prepare On-Device Gemini Nano"}
          </button>
        ) : null}
      </div>

      {!diagnostics.online ? (
        <div
          role="status"
          className="mb-6 rounded-lg border px-4 py-3 text-xs font-medium"
          style={{
            backgroundColor: "var(--state-warn-bg)",
            color: "var(--state-warn-ink)",
            borderColor: "var(--state-warn-border)",
          }}
        >
          Field signal lost. Privacy scrub and triage run on this device only. Saved cards queue locally and sync automatically when signal returns.
        </div>
      ) : null}

      {activeAkContext.includedCount > 0 ? (
        <div
          className="mb-6 rounded-lg border px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
          style={{
            backgroundColor: "var(--state-ondevice-bg)",
            color: "var(--state-ondevice-ink)",
            borderColor: "var(--state-ondevice-border)",
          }}
        >
          <span className="font-mono-telemetry font-semibold">
            Area Knowledge Injected ({activeAkContext.includedCount} active | ~{activeAkContext.estimatedTokens} est. tokens)
          </span>
          <span>
            Verified local ground truth [AK-1..AK-{activeAkContext.includedCount}] is automatically included in triage prompts.
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* LEFT COLUMN: Shared Intake Form */}
        <div
          className="lg:col-span-5 rounded-lg border p-5"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: "var(--border-subtle)",
          }}
        >
          {/* Mode Tabs */}
          <div
            role="tablist"
            aria-label="Intake mode"
            className="grid grid-cols-2 gap-1.5 rounded-md p-1 mb-5 border"
            style={{
              backgroundColor: "var(--bg-subtle)",
              borderColor: "var(--border-subtle)",
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "FIELD_REPORT"}
              onClick={() => handleModeChange("FIELD_REPORT")}
              className="min-h-[44px] rounded px-3 py-2 text-sm font-semibold transition-colors"
              style={{
                backgroundColor:
                  mode === "FIELD_REPORT" ? "var(--bg-surface)" : "transparent",
                color: "var(--ink-primary)",
                boxShadow:
                  mode === "FIELD_REPORT"
                    ? "0 1px 2px rgba(0,0,0,0.08)"
                    : "none",
              }}
            >
              Digest Field Report
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "RUMOR_CHECK"}
              onClick={() => handleModeChange("RUMOR_CHECK")}
              className="min-h-[44px] rounded px-3 py-2 text-sm font-semibold transition-colors"
              style={{
                backgroundColor:
                  mode === "RUMOR_CHECK" ? "var(--bg-surface)" : "transparent",
                color: "var(--ink-primary)",
                boxShadow:
                  mode === "RUMOR_CHECK"
                    ? "0 1px 2px rgba(0,0,0,0.08)"
                    : "none",
              }}
            >
              Verify Rumor
            </button>
          </div>

          {/* Synthetic Drill Preset Buttons */}
          <div className="mb-4">
            <p
              className="text-xs font-semibold mb-2"
              style={{ color: "var(--ink-muted)" }}
            >
              Load Synthetic Drill Sample
            </p>
            <div className="flex flex-col gap-2">
              {filteredScenarios.map((scenario) => (
                <button
                  key={scenario.id}
                  type="button"
                  onClick={() => handleLoadScenario(scenario.rawInput)}
                  className="min-h-[44px] rounded-md border px-3 py-2 text-left text-xs transition-colors hover:opacity-90"
                  style={{
                    backgroundColor: "var(--bg-subtle)",
                    borderColor: "var(--border-subtle)",
                    color: "var(--ink-primary)",
                  }}
                >
                  <span className="font-semibold block">{scenario.label}</span>
                  <span
                    className="block mt-0.5"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    {scenario.regionHint}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleRunPipeline} className="space-y-4">
            <div>
              <label
                htmlFor="raw-intake-input"
                className="block text-sm font-semibold mb-1.5"
              >
                {mode === "FIELD_REPORT"
                  ? "Raw Field Note (Bahasa Indonesia / English)"
                  : "Forwarded Rumor or Suspicious Chat Message"}
              </label>
              <textarea
                id="raw-intake-input"
                rows={6}
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                placeholder={
                  mode === "FIELD_REPORT"
                    ? "Paste messy field updates from responders, including location, damage, and urgent needs..."
                    : "Paste a forwarded WhatsApp message or social post claiming a breaking disaster event..."
                }
                className="w-full rounded-md border px-3 py-2.5 text-sm leading-relaxed resize-y"
                style={{
                  backgroundColor: "var(--bg-ground)",
                  borderColor: "var(--border-strong)",
                  color: "var(--ink-primary)",
                }}
              />

              {/* Token-Budget Router Meter */}
              {(() => {
                const pct = Math.min(
                  100,
                  Math.round(
                    (tokenRoute.estimatedTokens / tokenRoute.safeLocalLimit) *
                      100,
                  ),
                );
                const isCloudEscalate =
                  forceCloudFallback || tokenRoute.exceedsLocalBudget;
                const badgeBg =
                  tokenRoute.exceedsLocalBudget && !diagnostics.online
                    ? "var(--state-warn-bg)"
                    : isCloudEscalate
                      ? "var(--state-cloud-bg)"
                      : "var(--state-ondevice-bg)";
                const badgeInk =
                  tokenRoute.exceedsLocalBudget && !diagnostics.online
                    ? "var(--state-warn-ink)"
                    : isCloudEscalate
                      ? "var(--state-cloud-ink)"
                      : "var(--state-ondevice-ink)";
                const badgeBorder =
                  tokenRoute.exceedsLocalBudget && !diagnostics.online
                    ? "var(--state-warn-border)"
                    : isCloudEscalate
                      ? "var(--state-cloud-border)"
                      : "var(--state-ondevice-border)";
                const routeLabel = forceCloudFallback
                  ? "Simulated Cloud Fallback"
                  : tokenRoute.exceedsLocalBudget
                    ? "Auto-Escalate to Cloud"
                    : "On-Device Nano";

                return (
                  <div
                    className="mt-2 rounded-md border p-2.5 text-xs"
                    style={{
                      backgroundColor: "var(--bg-subtle)",
                      borderColor: "var(--border-subtle)",
                    }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <span
                        className="font-mono-telemetry text-[11px]"
                        style={{ color: "var(--ink-muted)" }}
                      >
                        ~{tokenRoute.estimatedTokens} est. tokens /{" "}
                        {tokenRoute.safeLocalLimit} local budget (char estimate)
                      </span>
                      <span
                        className="font-mono-telemetry rounded px-1.5 py-0.5 text-[11px] font-semibold border"
                        style={{
                          backgroundColor: badgeBg,
                          color: badgeInk,
                          borderColor: badgeBorder,
                        }}
                      >
                        {routeLabel}
                      </span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label="Estimated input token budget for on-device Gemini Nano"
                      aria-valuemin={0}
                      aria-valuemax={tokenRoute.safeLocalLimit}
                      aria-valuenow={Math.min(
                        tokenRoute.estimatedTokens,
                        tokenRoute.safeLocalLimit,
                      )}
                      className="h-1.5 w-full overflow-hidden rounded-full"
                      style={{ backgroundColor: "var(--bg-ground)" }}
                    >
                      <div
                        className="h-full transition-all"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: badgeInk,
                        }}
                      />
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Optional JPEG/PNG Attachment */}
            <div>
              <label
                htmlFor="damage-photo-input"
                className="block text-sm font-semibold mb-1.5"
              >
                Optional Photo or Screenshot (JPEG / PNG)
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  id="damage-photo-input"
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={(e) =>
                    handleImageSelect(e.target.files?.[0] ?? null)
                  }
                  className="min-h-[44px] text-xs file:mr-3 file:min-h-[44px] file:rounded-md file:border file:px-3 file:py-2 file:text-xs file:font-semibold"
                  style={{ color: "var(--ink-muted)" }}
                />
                {imageFile ? (
                  <button
                    type="button"
                    onClick={() => {
                      handleImageSelect(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="min-h-[44px] rounded px-3 text-xs font-semibold border"
                    style={{
                      borderColor: "var(--border-strong)",
                      color: "var(--ink-primary)",
                    }}
                  >
                    Remove Image
                  </button>
                ) : null}
              </div>
              {imagePreviewUrl ? (
                <div
                  className="mt-2.5 overflow-hidden rounded-md border aspect-video w-full"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  <img
                    src={imagePreviewUrl}
                    alt="Attached disaster field photo or rumor screenshot preview"
                    width={640}
                    height={360}
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : null}
            </div>

            {/* Hybrid Routing Simulation Option */}
            <label
              htmlFor="simulate-fallback-toggle"
              className="flex items-start gap-2.5 rounded-md border p-3 text-xs"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: "var(--border-subtle)",
              }}
            >
              <input
                id="simulate-fallback-toggle"
                type="checkbox"
                checked={forceCloudFallback}
                onChange={(e) => setForceCloudFallback(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <span>
                <strong className="block text-xs">
                  Simulate mid-range device cloud fallback (ONLY_IN_CLOUD)
                </strong>
                <span style={{ color: "var(--ink-muted)" }}>
                  Compare local Chrome Gemini Nano vs. Cloud Gemini fallback (such as a Samsung A55 responder phone). Local PII redaction still runs first.
                </span>
              </span>
            </label>

            {/* Primary CTA */}
            <button
              type="submit"
              disabled={isRunning}
              className="w-full min-h-[48px] rounded-md px-4 py-2.5 text-sm font-semibold text-white transition-colors"
              style={{
                backgroundColor: "var(--accent-vermilion)",
              }}
            >
              {isRunning
                ? "Running Hybrid AI Pipeline..."
                : mode === "FIELD_REPORT"
                  ? "Redact Locally & Digest Report"
                  : "Redact Locally & Triage Rumor"}
            </button>
          </form>

          {/* Live Status & Error Announcements */}
          <div aria-live="polite" className="mt-4 space-y-2">
            {stepStatus ? (
              <div
                className="rounded-md border p-3 text-xs font-medium"
                style={{
                  backgroundColor: "var(--state-cloud-bg)",
                  color: "var(--state-cloud-ink)",
                  borderColor: "var(--state-cloud-border)",
                }}
              >
                {stepStatus}
              </div>
            ) : null}
            {errorMsg ? (
              <div
                role="alert"
                className="rounded-md border p-3 text-xs font-medium"
                style={{
                  backgroundColor: "var(--state-critical-bg)",
                  color: "var(--state-critical-ink)",
                  borderColor: "var(--state-critical-border)",
                }}
              >
                {errorMsg}
              </div>
            ) : null}
          </div>
        </div>

        {/* RIGHT COLUMN: Privacy Diff + Structured Result Card */}
        <div className="lg:col-span-7 space-y-6">
          {offlineEntries.length > 0 ? (
            <section
              aria-label="Offline Sync Queue"
              className="rounded-lg border p-5 space-y-3"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-subtle)",
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b" style={{ borderColor: "var(--border-subtle)" }}>
                <div>
                  <h2 className="text-base font-bold">
                    Offline Sync Queue ({offlineEntries.length})
                  </h2>
                  {!diagnostics.online ? (
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
                        className="rounded-md border p-3 flex flex-wrap items-center justify-between gap-2 text-xs"
                        style={{
                          backgroundColor: "var(--bg-ground)",
                          borderColor: "var(--border-subtle)",
                        }}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono-telemetry rounded px-2 py-0.5 text-[11px] border" style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-subtle)" }}>
                            {meta.mode}
                          </span>
                          <span style={{ color: "var(--ink-muted)" }}>
                            Saving locally...
                          </span>
                        </div>
                        <span
                          className="font-mono-telemetry rounded px-2 py-0.5 text-[11px] font-semibold border"
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
                  const canAct = diagnostics.online && isSynced && !rowBusy[id];
                  const isBusy = Boolean(rowBusy[id]);

                  return (
                    <li
                      key={id}
                      className="rounded-md border p-3 space-y-2"
                      style={{
                        backgroundColor: "var(--bg-ground)",
                        borderColor: "var(--border-subtle)",
                      }}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className="font-mono-telemetry rounded px-2 py-0.5 text-[11px] border"
                              style={{
                                backgroundColor: "var(--bg-subtle)",
                                borderColor: "var(--border-subtle)",
                              }}
                            >
                              {intake.mode}
                            </span>
                            <span
                              className="font-mono-telemetry rounded px-2 py-0.5 text-[11px] font-semibold border"
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
                            onClick={() => handleEscalateVerify(intake)}
                            disabled={!canAct}
                            className="min-h-[44px] rounded-md border px-3 text-xs font-semibold"
                            style={{
                              backgroundColor: "var(--state-cloud-bg)",
                              color: "var(--state-cloud-ink)",
                              borderColor: "var(--state-cloud-border)",
                            }}
                          >
                            {isBusy
                              ? "Verifying..."
                              : "Verify with Google Search"}
                          </button>
                        ) : meta.isOfflineDraft ? (
                          <button
                            type="button"
                            onClick={() => handleUpgradeCloudTriage(intake)}
                            disabled={!canAct}
                            className="min-h-[44px] rounded-md border px-3 text-xs font-semibold"
                            style={{
                              backgroundColor: "var(--state-cloud-bg)",
                              color: "var(--state-cloud-ink)",
                              borderColor: "var(--state-cloud-border)",
                            }}
                          >
                            {isBusy
                              ? "Upgrading..."
                              : "Upgrade with Cloud Triage"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onResolveQueued(id)}
                            disabled={!canAct}
                            className="min-h-[44px] rounded-md border px-3 text-xs font-semibold"
                            style={{
                              backgroundColor: "var(--bg-surface)",
                              color: "var(--ink-primary)",
                              borderColor: "var(--border-strong)",
                            }}
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
          ) : null}

          {/* Empty State */}
          {!privacyResult && !triageResult && !isRunning ? (
            <div
              className="rounded-lg border p-8 text-left"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-subtle)",
              }}
            >
              <h2 className="font-editorial text-xl font-bold">
                No intake analyzed yet
              </h2>
              <p
                className="mt-2 text-sm leading-relaxed"
                style={{ color: "var(--ink-muted)" }}
              >
                Select one of the Synthetic Drill samples on the left or paste a raw field update to observe both stages live:
              </p>
              <ol
                className="mt-4 list-decimal pl-5 space-y-2 text-sm"
                style={{ color: "var(--ink-primary)" }}
              >
                <li>
                  <strong>Local Privacy Firewall (ONLY_ON_DEVICE):</strong> Strips victim names, phone numbers, and chat handles on your machine before anything reaches cloud services.
                </li>
                <li>
                  <strong>Hybrid Structured Triage (PREFER_ON_DEVICE):</strong> Extracts standardized severity, needs, and gaps on Gemini Nano when available (even offline) or falls back to Cloud Gemini automatically.
                </li>
                <li>
                  <strong>Grounded Verification (ONLY_IN_CLOUD):</strong> Cross-checks scrubbed rumors against live Google Search results with source citations.
                </li>
              </ol>
            </div>
          ) : null}

          {/* PANEL A: Local Privacy Redaction Diff */}
          {privacyResult ? (
            <div
              className="rounded-lg border p-5"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-subtle)",
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b" style={{ borderColor: "var(--border-subtle)" }}>
                <div>
                  <h2 className="text-base font-bold">
                    Stage 1: Local Privacy Firewall (PII Diff)
                  </h2>
                  <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
                    {privacyResult.usedRegexFallback
                      ? "Executed via local deterministic privacy scrubber (Gemini Nano not active in this browser)."
                      : "Executed strictly on-device via Firebase AI Logic ONLY_ON_DEVICE."}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <InferenceBadge
                    source="ON_DEVICE"
                    latencyMs={privacyResult.latencyMs}
                  />
                  <span
                    className="font-mono-telemetry rounded px-2 py-0.5 text-xs font-semibold border"
                    style={{
                      backgroundColor: "var(--bg-subtle)",
                      borderColor: "var(--border-subtle)",
                    }}
                  >
                    {privacyResult.redactions.length} redacted
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div
                  className="rounded-md border p-3"
                  style={{
                    backgroundColor: "var(--bg-subtle)",
                    borderColor: "var(--border-subtle)",
                  }}
                >
                  <div
                    className="font-mono-telemetry font-semibold mb-1.5"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    STAYED LOCAL ONLY (NEVER UPLOADED)
                  </div>
                  <p className="leading-relaxed whitespace-pre-wrap break-words">
                    {rawInput}
                  </p>
                </div>

                <div
                  className="rounded-md border p-3"
                  style={{
                    backgroundColor: "var(--bg-ground)",
                    borderColor: "var(--state-ondevice-border)",
                  }}
                >
                  <div
                    className="font-mono-telemetry font-semibold mb-1.5"
                    style={{ color: "var(--state-ondevice-ink)" }}
                  >
                    SAFE PAYLOAD (ELIGIBLE FOR CLOUD &amp; SYNC)
                  </div>
                  <p className="leading-relaxed whitespace-pre-wrap break-words">
                    {highlightRedactions(privacyResult.sanitizedText)}
                  </p>
                </div>
              </div>

              {privacyResult.redactions.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {privacyResult.redactions.map((r, i) => (
                    <span
                      key={`${r.placeholder}-${i}`}
                      className="font-mono-telemetry rounded px-2 py-0.5 text-[11px] border"
                      style={{
                        backgroundColor: "var(--bg-subtle)",
                        borderColor: "var(--border-subtle)",
                        color: "var(--ink-muted)",
                      }}
                    >
                      {r.placeholder} ({r.category})
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* PANEL B: Structured Situation / Rumor Triage Card */}
          {triageResult ? (
            <div
              className="rounded-lg border p-5"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-subtle)",
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-2 border-b" style={{ borderColor: "var(--border-subtle)" }}>
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={triageResult.structured.severity} />
                  <span
                    className="font-mono-telemetry rounded px-2 py-0.5 text-xs font-medium border"
                    style={{
                      backgroundColor: "var(--bg-subtle)",
                      borderColor: "var(--border-subtle)",
                    }}
                  >
                    {triageResult.structured.hazardType}
                  </span>
                  <VerdictBadge verdict={triageResult.structured.rumorVerdict} />
                </div>
                <InferenceBadge
                  source={triageResult.inferenceSource}
                  latencyMs={triageResult.latencyMs}
                />
              </div>

              <p
                className="font-mono-telemetry text-[11px] mb-3"
                style={{ color: "var(--ink-muted)" }}
              >
                Route: {triageResult.routingReason} (~
                {triageResult.estimatedInputTokens} est. input tokens)
              </p>

              {triageResult.isOfflineDraft ? (
                <div
                  role="status"
                  className="mb-3 rounded-md border px-3 py-2 text-xs font-medium"
                  style={{
                    backgroundColor: "var(--state-warn-bg)",
                    color: "var(--state-warn-ink)",
                    borderColor: "var(--state-warn-border)",
                  }}
                >
                  Offline draft (no on-device model). Upgrade with Cloud Triage after signal returns.
                </div>
              ) : null}

              <h2 className="font-editorial text-xl font-bold leading-snug">
                {triageResult.structured.headline}
              </h2>
              <p className="mt-1 text-xs font-medium" style={{ color: "var(--ink-muted)" }}>
                Location: {triageResult.structured.location}
              </p>

              {/* Bilingual Summaries */}
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div
                  className="rounded-md border p-3"
                  style={{
                    backgroundColor: "var(--bg-ground)",
                    borderColor: "var(--border-subtle)",
                  }}
                >
                  <div className="font-mono-telemetry text-[11px] font-semibold mb-1" style={{ color: "var(--ink-muted)" }}>
                    RINGKASAN (BAHASA INDONESIA)
                  </div>
                  <p className="leading-relaxed">
                    {triageResult.structured.summaryId}
                  </p>
                </div>
                <div
                  className="rounded-md border p-3"
                  style={{
                    backgroundColor: "var(--bg-ground)",
                    borderColor: "var(--border-subtle)",
                  }}
                >
                  <div className="font-mono-telemetry text-[11px] font-semibold mb-1" style={{ color: "var(--ink-muted)" }}>
                    SUMMARY (ENGLISH WIRE)
                  </div>
                  <p className="leading-relaxed">
                    {triageResult.structured.summaryEn}
                  </p>
                </div>
              </div>

              {/* Structured Facts / Needs / Gaps */}
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <h3 className="font-semibold mb-1.5">
                    {mode === "FIELD_REPORT" ? "Observed Facts" : "Extracted Claims"}
                  </h3>
                  <ul className="list-disc pl-4 space-y-1">
                    {triageResult.structured.keyFacts.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="font-semibold mb-1.5">
                    {mode === "FIELD_REPORT" ? "Urgent Needs" : "Required Agency Checks"}
                  </h3>
                  <ul className="list-disc pl-4 space-y-1">
                    {triageResult.structured.urgentNeeds.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="font-semibold mb-1.5">
                    {mode === "FIELD_REPORT" ? "Verification Gaps" : "Panic / Rumor Signals"}
                  </h3>
                  <ul className="space-y-2">
                    {(mode === "FIELD_REPORT"
                      ? triageResult.structured.verificationGaps
                      : triageResult.structured.panicSignals.length > 0
                        ? triageResult.structured.panicSignals
                        : triageResult.structured.verificationGaps
                    ).map((item, i) => {
                      const isGapItem =
                        mode === "FIELD_REPORT" ||
                        triageResult.structured.panicSignals.length === 0;
                      const isDispatched = Boolean(dispatchedGaps[i]);
                      const isBusyGap = Boolean(gapDispatchBusy[i]);

                      return (
                        <li key={i} className="space-y-1">
                          <div className="leading-snug">- {item}</div>
                          {isGapItem ? (
                            <button
                              type="button"
                              disabled={
                                isDispatched || isBusyGap || !diagnostics.online
                              }
                              onClick={async () => {
                                setGapDispatchBusy((prev) => ({
                                  ...prev,
                                  [i]: true,
                                }));
                                try {
                                  await onRequestFieldCheck(
                                    item,
                                    triageResult.structured.location,
                                    lastSavedIntakeId,
                                  );
                                  setDispatchedGaps((prev) => ({
                                    ...prev,
                                    [i]: true,
                                  }));
                                } catch (err) {
                                  setErrorMsg(
                                    err instanceof Error
                                      ? err.message
                                      : "Could not dispatch field check.",
                                  );
                                } finally {
                                  setGapDispatchBusy((prev) => ({
                                    ...prev,
                                    [i]: false,
                                  }));
                                }
                              }}
                              className="min-h-[44px] rounded border px-2.5 text-[11px] font-semibold disabled:opacity-60"
                              style={{
                                backgroundColor: isDispatched
                                  ? "var(--state-ondevice-bg)"
                                  : "var(--bg-subtle)",
                                color: isDispatched
                                  ? "var(--state-ondevice-ink)"
                                  : "var(--ink-primary)",
                                borderColor: isDispatched
                                  ? "var(--state-ondevice-border)"
                                  : "var(--border-strong)",
                              }}
                            >
                              {isDispatched
                                ? "Dispatched to Field"
                                : isBusyGap
                                  ? "Dispatching..."
                                  : "Request Field Check"}
                            </button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>

              {/* Stage 3: Google Search Grounding for Rumor Checks */}
              {mode === "RUMOR_CHECK" ? (
                <div
                  className="mt-5 rounded-md border p-4"
                  style={{
                    backgroundColor: "var(--bg-subtle)",
                    borderColor: "var(--border-subtle)",
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold">
                        Stage 3: External Fact-Check via Google Search Grounding
                      </h3>
                      <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
                        Escalates only the locally sanitized claim to Cloud Gemini with live Google Search verification.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleVerifyWithSearch}
                      disabled={isVerifyingSearch || !diagnostics.online}
                      className="min-h-[44px] rounded-md px-4 py-2 text-xs font-semibold border"
                      style={{
                        backgroundColor: "var(--state-cloud-bg)",
                        color: "var(--state-cloud-ink)",
                        borderColor: "var(--state-cloud-border)",
                      }}
                    >
                      {isVerifyingSearch
                        ? "Searching live sources..."
                        : groundedResult
                          ? "Re-run Google Search Check"
                          : "Verify with Google Search (Cloud)"}
                    </button>
                  </div>

                  {groundedResult ? (
                    <div className="mt-3 pt-3 border-t space-y-3" style={{ borderColor: "var(--border-subtle)" }}>
                      <div className="flex flex-wrap items-center gap-2">
                        <VerdictBadge verdict={groundedResult.verdict} />
                        <InferenceBadge
                          source="IN_CLOUD"
                          latencyMs={groundedResult.latencyMs}
                        />
                      </div>

                      {groundedResult.sources.length > 0 ? (
                        <div>
                          <div className="font-mono-telemetry text-[11px] font-semibold mb-1.5" style={{ color: "var(--ink-muted)" }}>
                            GROUNDING SOURCES ({groundedResult.sources.length})
                          </div>
                          <ul className="flex flex-wrap gap-2">
                            {groundedResult.sources.map((src, i) => (
                              <li key={`${src.uri}-${i}`}>
                                <a
                                  href={src.uri}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex min-h-[44px] items-center rounded border px-3 text-xs font-medium underline"
                                  style={{
                                    backgroundColor: "var(--bg-surface)",
                                    borderColor: "var(--border-strong)",
                                    color: "var(--ink-primary)",
                                  }}
                                >
                                  {src.title}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                          No authoritative web sources matched this synthetic or breaking claim yet; verdict remains guarded.
                        </p>
                      )}

                      {/* Required Google Search Grounding Suggestions Widget */}
                      {groundedResult.searchEntryPointHtml ? (
                        <div className="grounding-widget-frame pt-1">
                          <div
                            dangerouslySetInnerHTML={{
                              __html: groundedResult.searchEntryPointHtml,
                            }}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Save to Shared Incident Queue */}
              <div className="mt-5 pt-4 border-t flex flex-wrap items-center justify-between gap-3" style={{ borderColor: "var(--border-subtle)" }}>
                <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                  Only the sanitized text and structured JSON are written to Firestore.
                </p>
                <button
                  type="button"
                  onClick={handleSaveToQueue}
                  disabled={isSaving}
                  className="min-h-[44px] rounded-md px-5 py-2 text-sm font-semibold text-white"
                  style={{ backgroundColor: "var(--accent-vermilion)" }}
                >
                  {isSaving ? "Saving to Queue..." : "Save to Incident Queue"}
                </button>
              </div>

              {saveFeedback ? (
                <div
                  aria-live="polite"
                  className="mt-3 rounded-md border p-3 text-xs font-medium"
                  style={{
                    backgroundColor: "var(--state-ondevice-bg)",
                    color: "var(--state-ondevice-ink)",
                    borderColor: "var(--state-ondevice-border)",
                  }}
                >
                  {saveFeedback}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
