import { useRef, useState } from "react";
import { SYNTHETIC_SCENARIOS } from "../data/syntheticScenarios";
import { formatAreaKnowledgeBlock } from "../lib/areaKnowledgeContext";
import { computeIntakeEvidenceSha256 } from "../lib/crisisProvenance";
import {
  evaluateTokenRoute,
  runLocalPrivacyFirewall,
  triageIntakeHybrid,
  verifyRumorWithGoogleSearch,
  type GroundedVerificationResult,
  type HybridTriageResult,
} from "../lib/hybridAi";
import type { HybridScorecard } from "../lib/hybridScorecard";
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
import { HybridScorecardStrip } from "./HybridScorecardStrip";
import { OfflineQueuePanel } from "./OfflineQueuePanel";
import { PrivacyDiffPanel } from "./PrivacyDiffPanel";
import { TriageResultPanel } from "./TriageResultPanel";
import { handleTabListKeyDown } from "./ui";

interface CommandDeskProps {
  activeIncidentId: string;
  diagnostics: OnDeviceDiagnostics;
  areaKnowledge: AreaKnowledgeDoc[];
  scorecard: HybridScorecard;
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

const INTAKE_MODES: readonly IntakeMode[] = ["FIELD_REPORT", "RUMOR_CHECK"];

async function stripImageExifBytes(file: File): Promise<Uint8Array | null> {
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const maxEdge = 1024;
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.82),
      );
      if (!blob) return null;
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

export function CommandDesk({
  activeIncidentId,
  diagnostics,
  areaKnowledge,
  scorecard,
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
      setStepStatus(
        "Step 1/2: Running local privacy firewall (ONLY_ON_DEVICE) to strip PII...",
      );
      const privacy = await runLocalPrivacyFirewall(trimmed);
      setPrivacyResult(privacy);

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
        activeIncidentId ||
        (await ensureDemoIncidentExists()) ||
        DEFAULT_DEMO_INCIDENT_ID;
      const strippedImageBytes = imageFile
        ? await stripImageExifBytes(imageFile)
        : null;
      const evidenceSha256 = await computeIntakeEvidenceSha256({
        sanitizedText: privacyResult.sanitizedText,
        mode,
        sourcePlatform: "WEB",
        redactionCount: privacyResult.redactions.length,
        imageBytes: strippedImageBytes,
      });
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
        evidenceSha256,
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

  const handleDispatchGap = async (index: number, item: string) => {
    if (!triageResult) return;
    setGapDispatchBusy((prev) => ({ ...prev, [index]: true }));
    try {
      await onRequestFieldCheck(
        item,
        triageResult.structured.location,
        lastSavedIntakeId,
      );
      setDispatchedGaps((prev) => ({ ...prev, [index]: true }));
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Could not dispatch field check.",
      );
    } finally {
      setGapDispatchBusy((prev) => ({ ...prev, [index]: false }));
    }
  };

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
          err instanceof Error ? err.message : "Cloud triage upgrade failed.",
      }));
    } finally {
      setRowBusy((prev) => ({ ...prev, [intake.id]: false }));
    }
  };

  const offlineEntries = Object.entries(offlineQueue);
  const pct = Math.min(
    100,
    Math.round((tokenRoute.estimatedTokens / tokenRoute.safeLocalLimit) * 100),
  );
  const isCloudEscalate = forceCloudFallback || tokenRoute.exceedsLocalBudget;
  const routeBadgeColors =
    tokenRoute.exceedsLocalBudget && !diagnostics.online
      ? {
          bg: "var(--state-warn-bg)",
          ink: "var(--state-warn-ink)",
          border: "var(--state-warn-border)",
        }
      : isCloudEscalate
        ? {
            bg: "var(--state-cloud-bg)",
            ink: "var(--state-cloud-ink)",
            border: "var(--state-cloud-border)",
          }
        : {
            bg: "var(--state-ondevice-bg)",
            ink: "var(--state-ondevice-ink)",
            border: "var(--state-ondevice-border)",
          };
  const routeLabel = forceCloudFallback
    ? "Simulated Cloud Fallback"
    : tokenRoute.exceedsLocalBudget
      ? "Auto-Escalate to Cloud"
      : "On-Device Nano";

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 py-5 sm:py-7">
      {/* Section Header */}
      <div
        className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b pb-4"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div>
          <h1 className="font-editorial text-2xl sm:text-3xl font-bold tracking-tight">
            Rapid Intake &amp; Local Privacy Firewall
          </h1>
          <p
            className="mt-1.5 max-w-2xl text-sm"
            style={{ color: "var(--ink-muted)" }}
          >
            Scrub sensitive personal details strictly on-device, structure messy Indonesian or English field reports into verified JSON, and escalate scrubbed rumors to live Google Search grounding.
          </p>
        </div>
        {diagnostics.availability === "downloadable" ? (
          <button
            type="button"
            onClick={onInitNano}
            disabled={isDownloadingNano}
            className="sw-btn-ondevice inline-flex min-h-[44px] shrink-0 items-center justify-center px-4 text-sm font-semibold"
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
          className="mb-5 rounded-lg border px-4 py-3 text-xs font-medium"
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
          className="mb-5 rounded-lg border px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
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

      <div className="mb-5">
        <HybridScorecardStrip scorecard={scorecard} compact />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* LEFT COLUMN: Shared Intake Form */}
        <div className="lg:col-span-5 sw-card p-5">
          {/* WAI-ARIA APG Mode Tabs */}
          <div
            role="tablist"
            aria-label="Intake mode"
            className="grid grid-cols-2 gap-1.5 rounded-md p-1 mb-5 border"
            style={{
              backgroundColor: "var(--bg-subtle)",
              borderColor: "var(--border-subtle)",
            }}
          >
            {(
              [
                ["FIELD_REPORT", "Digest Field Report"],
                ["RUMOR_CHECK", "Verify Rumor"],
              ] as const
            ).map(([tabId, label]) => {
              const selected = mode === tabId;
              return (
                <button
                  key={tabId}
                  id={`intake-mode-tab-${tabId}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="intake-mode-panel"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => handleModeChange(tabId)}
                  onKeyDown={(e) =>
                    handleTabListKeyDown(
                      e,
                      INTAKE_MODES,
                      mode,
                      handleModeChange,
                      "intake-mode",
                    )
                  }
                  className="min-h-[44px] rounded px-3 py-2 text-sm font-semibold transition-colors"
                  style={{
                    backgroundColor: selected
                      ? "var(--bg-surface)"
                      : "transparent",
                    color: selected ? "var(--ink-primary)" : "var(--ink-muted)",
                    boxShadow: selected ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div
            id="intake-mode-panel"
            role="tabpanel"
            aria-labelledby={`intake-mode-tab-${mode}`}
          >
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
                    className="sw-btn-subtle min-h-[44px] px-3 py-2 text-left text-xs"
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
                  className="sw-input w-full px-3 py-2.5 text-sm leading-relaxed resize-y"
                />

                {/* Token-Budget Router Meter */}
                <div className="sw-card-subtle mt-2 p-2.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                    <span
                      className="font-mono-telemetry text-xs"
                      style={{ color: "var(--ink-muted)" }}
                    >
                      ~{tokenRoute.estimatedTokens} est. tokens /{" "}
                      {tokenRoute.safeLocalLimit} local budget
                    </span>
                    <span
                      className="font-mono-telemetry rounded px-1.5 py-0.5 text-xs font-semibold border"
                      style={{
                        backgroundColor: routeBadgeColors.bg,
                        color: routeBadgeColors.ink,
                        borderColor: routeBadgeColors.border,
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
                        backgroundColor: routeBadgeColors.ink,
                      }}
                    />
                  </div>
                </div>
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
                    className="min-h-[44px] max-w-full text-xs file:mr-3 file:min-h-[44px] file:rounded-md file:border file:px-3 file:py-2 file:text-xs file:font-semibold"
                    style={{ color: "var(--ink-muted)" }}
                  />
                  {imageFile ? (
                    <button
                      type="button"
                      onClick={() => {
                        handleImageSelect(null);
                        if (fileInputRef.current) {
                          fileInputRef.current.value = "";
                        }
                      }}
                      className="sw-btn-secondary min-h-[44px] px-3 text-xs font-semibold"
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
                className="sw-card-subtle flex items-start gap-2.5 p-3 text-xs transition-colors hover:border-[var(--border-strong)]"
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
                className="sw-btn-primary w-full min-h-[48px] px-4 py-2.5 text-sm font-semibold"
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
        </div>

        {/* RIGHT COLUMN: Offline Queue + Privacy Diff + Structured Result Card */}
        <div className="lg:col-span-7 space-y-6">
          <OfflineQueuePanel
            offlineEntries={offlineEntries}
            intakes={intakes}
            online={diagnostics.online}
            rowBusy={rowBusy}
            rowErrors={rowErrors}
            onEscalateVerify={handleEscalateVerify}
            onUpgradeCloudTriage={handleUpgradeCloudTriage}
            onResolveQueued={onResolveQueued}
          />

          {!privacyResult && !triageResult && !isRunning ? (
            <div className="sw-card p-6 sm:p-8 text-left">
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

          {privacyResult ? (
            <PrivacyDiffPanel rawInput={rawInput} privacyResult={privacyResult} />
          ) : null}

          {triageResult ? (
            <TriageResultPanel
              mode={mode}
              online={diagnostics.online}
              triageResult={triageResult}
              groundedResult={groundedResult}
              isVerifyingSearch={isVerifyingSearch}
              isSaving={isSaving}
              saveFeedback={saveFeedback}
              gapDispatchBusy={gapDispatchBusy}
              dispatchedGaps={dispatchedGaps}
              onDispatchGap={handleDispatchGap}
              onVerifyWithSearch={handleVerifyWithSearch}
              onSaveToQueue={handleSaveToQueue}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
