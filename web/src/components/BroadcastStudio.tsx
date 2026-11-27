import { useMemo, useState } from "react";
import { formatAreaKnowledgeBlock } from "../lib/areaKnowledgeContext";
import {
  buildSafetyGateReceipt,
  evaluateBroadcastSafetyGate,
  injectSafetyGateDrillFault,
  repairDraftMissingGaps,
  repairDraftPii,
  repairDraftRumorSafety,
  repairDraftSeverity,
  type SafetyGateCheckId,
} from "../lib/broadcastSafetyGate";
import {
  appendProvenanceSealToWhatsapp,
  computeDispatchProvenance,
  SHA256_HEX_REGEX,
} from "../lib/crisisProvenance";
import { downloadDispatchMarkdown } from "../lib/dispatchExport";
import {
  synthesizeBroadcastPack,
  type SynthesizedBroadcastResult,
} from "../lib/hybridAi";
import { publishDispatchToFirestore } from "../lib/firestoreRepo";
import type {
  AreaKnowledgeDoc,
  IncidentDoc,
  IntakeDoc,
  OnDeviceDiagnostics,
  SessionAuditEvent,
} from "../types/sigapwire";
import {
  BroadcastChannelPreview,
  type AudienceTab,
} from "./BroadcastChannelPreview";
import { SafetyGatePanel } from "./SafetyGatePanel";
import {
  InferenceBadge,
  PlatformBadge,
  SeverityBadge,
  VerdictBadge,
} from "./StatusBadges";
import { CardListSkeleton } from "./ui";

interface BroadcastStudioProps {
  activeIncident: IncidentDoc | null;
  intakes: IntakeDoc[];
  intakesLoading: boolean;
  nextDispatchNumber: number;
  diagnostics: OnDeviceDiagnostics;
  areaKnowledge: AreaKnowledgeDoc[];
  onRequestFieldCheck: (
    question: string,
    location: string,
    linkedIntakeId: string | null,
  ) => Promise<void>;
  onLogSessionEvent: (event: Omit<SessionAuditEvent, "id" | "timestamp">) => void;
  onGoToCommand: () => void;
  onPublishedDispatch: () => void;
}

export function BroadcastStudio({
  activeIncident,
  intakes,
  intakesLoading,
  nextDispatchNumber,
  diagnostics,
  areaKnowledge,
  onRequestFieldCheck,
  onLogSessionEvent,
  onGoToCommand,
  onPublishedDispatch,
}: BroadcastStudioProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<AudienceTab>("community");
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<SynthesizedBroadcastResult | null>(null);
  const [draftSourceIds, setDraftSourceIds] = useState<string[]>([]);
  const [draftSourceIntakes, setDraftSourceIntakes] = useState<IntakeDoc[]>([]);
  const [preDrillDraft, setPreDrillDraft] =
    useState<SynthesizedBroadcastResult | null>(null);
  const [simulatedFaultActive, setSimulatedFaultActive] = useState(false);
  const [repairsApplied, setRepairsApplied] = useState<string[]>([]);
  const [commanderSignedOff, setCommanderSignedOff] = useState(false);
  const [gateGapDispatchBusy, setGateGapDispatchBusy] = useState(false);
  const [gateGapDispatched, setGateGapDispatched] = useState(false);

  const activeAkContext = useMemo(
    () => formatAreaKnowledgeBlock(areaKnowledge),
    [areaKnowledge],
  );

  const selectedIntakes = useMemo(
    () => intakes.filter((i) => selectedIds.includes(i.id)),
    [intakes, selectedIds],
  );

  const telemetry = useMemo(() => {
    let onDeviceCount = 0;
    let inCloudCount = 0;
    let totalRedactions = 0;
    let webCount = 0;
    let androidCount = 0;
    let appleCount = 0;

    for (const intake of intakes) {
      if (intake.inferenceSource === "ON_DEVICE") {
        onDeviceCount += 1;
      } else if (intake.inferenceSource === "IN_CLOUD") {
        inCloudCount += 1;
      }
      totalRedactions += intake.redactionCount;
      if (intake.sourcePlatform === "WEB") {
        webCount += 1;
      } else if (intake.sourcePlatform === "ANDROID") {
        androidCount += 1;
      } else if (intake.sourcePlatform === "APPLE") {
        appleCount += 1;
      }
    }

    const total = intakes.length;
    const onDevicePercent =
      total > 0 ? Math.round((onDeviceCount / total) * 100) : 0;

    return {
      total,
      onDeviceCount,
      inCloudCount,
      totalRedactions,
      webCount,
      androidCount,
      appleCount,
      onDevicePercent,
    };
  }, [intakes]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const selectAllOpen = () => {
    const openIds = intakes
      .filter((i) => i.status !== "INCLUDED_IN_DISPATCH")
      .map((i) => i.id);
    setSelectedIds(openIds.length > 0 ? openIds : intakes.map((i) => i.id));
  };

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      setErrorMsg("Clipboard copy blocked by browser permissions.");
    }
  };

  const handleSynthesize = async () => {
    if (selectedIntakes.length === 0) {
      setErrorMsg(
        "Select at least one synced field report or rumor check from the queue first.",
      );
      return;
    }
    if (!diagnostics.online) {
      setErrorMsg(
        "Multi-report 4-audience synthesis requires Cloud Gemini (ONLY_IN_CLOUD). Reconnect to synthesize and publish.",
      );
      return;
    }

    setErrorMsg(null);
    setIsSynthesizing(true);
    try {
      const result = await synthesizeBroadcastPack({
        incidentTitle:
          activeIncident?.title ||
          "West Java M6.2 Earthquake (Synthetic Drill)",
        region: activeIncident?.region || "West Java, Indonesia",
        dispatchNumber: nextDispatchNumber,
        intakes: selectedIntakes,
        areaKnowledge,
      });
      setDraft(result);
      setDraftSourceIds(selectedIntakes.map((i) => i.id));
      setDraftSourceIntakes(selectedIntakes);
      setPreDrillDraft(null);
      setSimulatedFaultActive(false);
      setRepairsApplied([]);
      setCommanderSignedOff(false);
      setGateGapDispatched(false);
      onLogSessionEvent({
        category: "IN_CLOUD",
        eventType: "BROADCAST_SYNTHESIZED",
        title: `Synthesized Dispatch #${nextDispatchNumber} Draft`,
        detail: `Merged ${selectedIntakes.length} intake(s) via ${result.modelUsed} with ${activeAkContext.includedCount} Area Knowledge facts.`,
      });
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Cloud synthesis failed. Verify Firebase AI Logic and App Check setup.",
      );
    } finally {
      setIsSynthesizing(false);
    }
  };

  const gateEvaluation = useMemo(
    () =>
      draft ? evaluateBroadcastSafetyGate(draft, draftSourceIntakes) : null,
    [draft, draftSourceIntakes],
  );

  const requiresSignOff = Boolean(
    gateEvaluation &&
      gateEvaluation.blockCount === 0 &&
      (gateEvaluation.warnCount > 0 || repairsApplied.length > 0),
  );

  const canPublish = Boolean(
    draft &&
      gateEvaluation &&
      gateEvaluation.blockCount === 0 &&
      (!requiresSignOff || commanderSignedOff),
  );

  const handleToggleDrillFault = () => {
    if (!draft) return;
    if (!simulatedFaultActive) {
      setPreDrillDraft(draft);
      setDraft(injectSafetyGateDrillFault(draft));
      setSimulatedFaultActive(true);
      setRepairsApplied([]);
      setCommanderSignedOff(false);
      onLogSessionEvent({
        category: "HUMAN_GATE",
        eventType: "SAFETY_GATE_DRILL",
        title: "Simulated Safety Gate Fault Injected",
        detail:
          "Injected synthetic PII, unverified all-clear claim, and severity downgrade in preview draft.",
      });
    } else if (preDrillDraft) {
      setDraft(preDrillDraft);
      setPreDrillDraft(null);
      setSimulatedFaultActive(false);
      setRepairsApplied([]);
      setCommanderSignedOff(false);
      onLogSessionEvent({
        category: "HUMAN_GATE",
        eventType: "SAFETY_GATE_DRILL_RESET",
        title: "Restored Pre-Drill Draft",
        detail: "Cleared simulated safety fault drill from draft preview.",
      });
    }
  };

  const handleRepairRule = (checkId: SafetyGateCheckId) => {
    if (!draft || !gateEvaluation) return;
    let nextDraft = draft;
    let label = "";

    if (checkId === "ZERO_PII_LEAK") {
      nextDraft = repairDraftPii(draft);
      label = "Auto-scrubbed PII across 4 audiences";
    } else if (checkId === "RUMOR_SAFETY_GUARD") {
      nextDraft = repairDraftRumorSafety(draft);
      label = "Enforced safe unverified rumor guardrails";
    } else if (
      checkId === "PEAK_SEVERITY_INVARIANT" &&
      gateEvaluation.peakIntakeSeverity
    ) {
      nextDraft = repairDraftSeverity(draft, gateEvaluation.peakIntakeSeverity);
      label = `Restored peak severity to ${gateEvaluation.peakIntakeSeverity}`;
    } else if (
      checkId === "GAP_DISCLOSURE_CHECK" &&
      gateEvaluation.missingGaps.length > 0
    ) {
      nextDraft = repairDraftMissingGaps(draft, gateEvaluation.missingGaps);
      label = `Injected ${gateEvaluation.missingGaps.length} missing verification gap(s)`;
    }

    if (!label) return;
    setDraft(nextDraft);
    setRepairsApplied((prev) =>
      prev.includes(label) ? prev : [...prev, label],
    );
    setCommanderSignedOff(false);
    onLogSessionEvent({
      category: "HUMAN_GATE",
      eventType: "SAFETY_GATE_REPAIRED",
      title: `Deterministic Repair (${checkId})`,
      detail: label,
    });
  };

  const handleDispatchFirstGap = async () => {
    if (!gateEvaluation || gateEvaluation.missingGaps.length === 0) return;
    setGateGapDispatchBusy(true);
    try {
      const firstGap = gateEvaluation.missingGaps[0];
      const loc =
        draftSourceIntakes[0]?.structured.location ||
        activeIncident?.region ||
        "Field Zone";
      const linkedId = draftSourceIntakes[0]?.id ?? null;
      await onRequestFieldCheck(firstGap, loc, linkedId);
      setGateGapDispatched(true);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to dispatch field check.",
      );
    } finally {
      setGateGapDispatchBusy(false);
    }
  };

  const handleChangeCommanderSignOff = (checked: boolean) => {
    setCommanderSignedOff(checked);
    if (checked) {
      onLogSessionEvent({
        category: "HUMAN_GATE",
        eventType: "COMMANDER_SIGNOFF",
        title: `Commander Signed Off Draft #${nextDispatchNumber}`,
        detail: "Human release authority confirmed after Safety Gate checks.",
      });
    }
  };

  const handlePublish = async () => {
    if (!draft || draftSourceIds.length === 0 || !canPublish) return;
    setErrorMsg(null);
    setIsPublishing(true);

    try {
      const incidentId = activeIncident?.id || "inc_westjava_drill_2026";
      const groundingHtml =
        draftSourceIntakes.find((i) => i.structured.searchEntryPointHtml)
          ?.structured.searchEntryPointHtml ?? null;
      const sourceEvidenceHashes = draftSourceIntakes
        .map((i) => i.evidenceSha256)
        .filter(
          (h): h is string =>
            typeof h === "string" && SHA256_HEX_REGEX.test(h),
        );

      const { manifestSha256, provenanceCode } =
        await computeDispatchProvenance({
          dispatchNumber: nextDispatchNumber,
          incidentId,
          severity: draft.severity,
          sourceIntakeIds: draftSourceIds,
          sourceEvidenceHashes,
          communityAlertId: draft.communityAlertId,
          globalSitrepEn: draft.globalSitrepEn,
          debunkCard: draft.debunkCard,
        });

      const sealedCommunityAlert = {
        ...draft.communityAlertId,
        whatsappShortText: appendProvenanceSealToWhatsapp(
          draft.communityAlertId.whatsappShortText,
          provenanceCode,
        ),
      };

      await publishDispatchToFirestore(
        {
          incidentId,
          dispatchNumber: nextDispatchNumber,
          severity: draft.severity,
          sourceIntakeIds: draftSourceIds,
          inferenceSource: "IN_CLOUD",
          communityAlertId: sealedCommunityAlert,
          mediaPressReleaseId: draft.mediaPressReleaseId,
          globalSitrepEn: draft.globalSitrepEn,
          debunkCard: draft.debunkCard,
          groundingSearchHtml: groundingHtml,
          manifestSha256,
          provenanceCode,
        },
        draftSourceIntakes,
      );

      onLogSessionEvent({
        category: "HUMAN_GATE",
        eventType: "SAFETY_GATE_PASSED",
        title: `Safety Gate Cleared for Dispatch #${nextDispatchNumber} (${provenanceCode})`,
        detail: `Published atomically with SHA-256 seal after ${repairsApplied.length} deterministic repair(s); sign-off=${commanderSignedOff ? "Confirmed" : "Not Required"}.`,
      });
      setDraft(null);
      setDraftSourceIds([]);
      setDraftSourceIntakes([]);
      setPreDrillDraft(null);
      setSimulatedFaultActive(false);
      setRepairsApplied([]);
      setCommanderSignedOff(false);
      setGateGapDispatched(false);
      setSelectedIds([]);
      onPublishedDispatch();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to publish dispatch.",
      );
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 py-5 sm:py-7">
      <div
        className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b pb-4"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div>
          <h1 className="font-editorial text-2xl sm:text-3xl font-bold tracking-tight">
            Multi-Audience Broadcast Studio
          </h1>
          <p
            className="mt-1.5 max-w-2xl text-sm"
            style={{ color: "var(--ink-muted)" }}
          >
            Merge sanitized field intakes and rumor checks synced from Web, Android, and Apple clients into synchronized Community Alerts (ID), National Press Releases (ID), Global SitReps (EN), and Debunk Cards via Cloud Gemini.
          </p>
        </div>
        <button
          type="button"
          onClick={selectAllOpen}
          disabled={intakes.length === 0}
          className="sw-btn-secondary inline-flex min-h-[44px] shrink-0 items-center justify-center px-4 text-xs font-semibold"
        >
          Select All Pending Intakes
        </button>
      </div>

      {activeAkContext.includedCount > 0 ? (
        <div
          className="mb-4 rounded-lg border px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
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
            Verified ground truth [AK-1..AK-{activeAkContext.includedCount}] is enforced in Cloud synthesis.
          </span>
        </div>
      ) : null}

      {telemetry.total > 0 ? (
        <section
          aria-label="Live Hybrid Telemetry Summary"
          className="sw-card mb-5 px-4 py-3 text-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
              <div className="flex items-baseline gap-1.5">
                <span style={{ color: "var(--ink-muted)" }}>
                  Synced intakes
                </span>
                <span className="font-mono-telemetry text-sm font-bold">
                  {telemetry.total}
                </span>
                <span
                  className="font-mono-telemetry text-xs"
                  style={{ color: "var(--ink-muted)" }}
                >
                  (WEB {telemetry.webCount} / AND {telemetry.androidCount} / APP {telemetry.appleCount})
                </span>
              </div>

              <div className="flex items-baseline gap-1.5">
                <span style={{ color: "var(--ink-muted)" }}>Hybrid split</span>
                <span className="font-mono-telemetry text-sm font-bold">
                  {telemetry.onDevicePercent}% ON_DEVICE
                </span>
                <span
                  className="font-mono-telemetry text-xs"
                  style={{ color: "var(--ink-muted)" }}
                >
                  ({telemetry.onDeviceCount} local / {telemetry.inCloudCount} cloud)
                </span>
              </div>

              <div className="flex items-baseline gap-1.5">
                <span style={{ color: "var(--ink-muted)" }}>
                  PII kept local
                </span>
                <span
                  className="font-mono-telemetry text-sm font-bold"
                  style={{ color: "var(--state-ondevice-ink)" }}
                >
                  {telemetry.totalRedactions} items
                </span>
              </div>
            </div>
            <span style={{ color: "var(--ink-muted)" }}>
              Live Firestore metadata
            </span>
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* LEFT COLUMN: Multi-Platform Synced Intake Queue */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2
              className="text-sm font-bold"
              style={{ color: "var(--ink-muted)" }}
            >
              Synced Incident Queue ({intakes.length})
            </h2>
            <span
              className="font-mono-telemetry text-xs"
              style={{ color: "var(--ink-muted)" }}
            >
              {selectedIds.length} selected
            </span>
          </div>

          {intakesLoading ? (
            <CardListSkeleton
              label="Loading real-time intakes from Firestore"
              rows={3}
            />
          ) : intakes.length === 0 ? (
            <div className="sw-card p-6">
              <h3 className="font-editorial text-lg font-bold">
                Incident queue is empty
              </h3>
              <p
                className="mt-1.5 text-sm"
                style={{ color: "var(--ink-muted)" }}
              >
                No field reports or rumor checks have been saved yet. Triage a Synthetic Drill in the Command Desk (or capture one from the Android / Apple companion apps) to synthesize a broadcast.
              </p>
              <button
                type="button"
                onClick={onGoToCommand}
                className="sw-btn-primary mt-4 inline-flex min-h-[44px] items-center px-4 text-sm font-semibold"
              >
                Open Command Desk
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {intakes.map((item) => {
                const checked = selectedIds.includes(item.id);
                return (
                  <label
                    key={item.id}
                    htmlFor={`select-intake-${item.id}`}
                    data-selected={checked}
                    className="sw-selectable-card block p-4"
                  >
                    <div className="flex items-start gap-3">
                      <input
                        id={`select-intake-${item.id}`}
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelect(item.id)}
                        className="mt-1 h-4 w-4 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 mb-2">
                          <PlatformBadge platform={item.sourcePlatform} />
                          <InferenceBadge
                            source={item.inferenceSource}
                            latencyMs={item.latencyMs}
                          />
                          <SeverityBadge severity={item.structured.severity} />
                          <VerdictBadge verdict={item.structured.rumorVerdict} />
                        </div>
                        <p className="text-sm font-bold leading-snug">
                          {item.structured.headline}
                        </p>
                        <p
                          className="mt-1 text-xs line-clamp-2"
                          style={{ color: "var(--ink-muted)" }}
                        >
                          {item.structured.summaryEn || item.structured.summaryId}
                        </p>
                        <div
                          className="mt-2 flex flex-wrap items-center gap-3 font-mono-telemetry text-xs"
                          style={{ color: "var(--ink-muted)" }}
                        >
                          {checked ? (
                            <span
                              className="rounded px-1.5 py-0.5 font-semibold border"
                              style={{
                                backgroundColor: "var(--bg-surface)",
                                borderColor: "var(--accent-vermilion)",
                                color: "var(--accent-text)",
                              }}
                            >
                              SELECTED
                            </span>
                          ) : null}
                          <span>{item.mode}</span>
                          <span>{item.redactionCount} PII redacted</span>
                          <span>Status: {item.status}</span>
                        </div>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Cloud Multi-Audience Synthesizer */}
        <div className="lg:col-span-7 sw-card p-5">
          <div
            className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <div>
              <h2 className="font-editorial text-xl font-bold">
                Dispatch #{nextDispatchNumber} Draft Preview
              </h2>
              <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
                Runs ONLY_IN_CLOUD synthesis across all selected reports.
              </p>
            </div>
            <button
              type="button"
              onClick={handleSynthesize}
              disabled={isSynthesizing || selectedIntakes.length === 0}
              className="sw-btn-primary min-h-[44px] px-4 py-2 text-sm font-semibold"
            >
              {isSynthesizing
                ? "Synthesizing 4 Audiences..."
                : `Synthesize (${selectedIntakes.length}) in Cloud`}
            </button>
          </div>

          {errorMsg ? (
            <div
              role="alert"
              className="mb-4 rounded-md border p-3 text-xs font-medium"
              style={{
                backgroundColor: "var(--state-critical-bg)",
                color: "var(--state-critical-ink)",
                borderColor: "var(--state-critical-border)",
              }}
            >
              {errorMsg}
            </div>
          ) : null}

          {!draft ? (
            <div className="py-6 text-sm" style={{ color: "var(--ink-muted)" }}>
              Select one or more triaged intakes from the left column and click{" "}
              <strong style={{ color: "var(--ink-primary)" }}>
                Synthesize in Cloud
              </strong>{" "}
              to simultaneously generate:
              <ul
                className="mt-3 list-disc pl-5 space-y-1.5"
                style={{ color: "var(--ink-primary)" }}
              >
                <li>
                  Calm, plain-language Indonesian Community Action Alert + WhatsApp copy
                </li>
                <li>National Media Press Release (Bahasa Indonesia)</li>
                <li>
                  Global Humanitarian Situation Report (English, OCHA / ReliefWeb format)
                </li>
                <li>Bilingual Debunk Card if rumor checks are included</li>
              </ul>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={draft.severity} />
                  <InferenceBadge source="IN_CLOUD" latencyMs={draft.latencyMs} />
                  <span
                    className="font-mono-telemetry rounded px-2 py-0.5 text-xs border"
                    style={{
                      backgroundColor: "var(--bg-subtle)",
                      borderColor: "var(--border-subtle)",
                      color: "var(--ink-muted)",
                    }}
                  >
                    {draft.modelUsed}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      downloadDispatchMarkdown(
                        `sigapwire-dispatch-${nextDispatchNumber}-draft.md`,
                        {
                          dispatchNumber: nextDispatchNumber,
                          severity: draft.severity,
                          inferenceSource: "IN_CLOUD",
                          incidentTitle: activeIncident?.title,
                          region: activeIncident?.region,
                          modelUsed: draft.modelUsed,
                          communityAlertId: draft.communityAlertId,
                          mediaPressReleaseId: draft.mediaPressReleaseId,
                          globalSitrepEn: draft.globalSitrepEn,
                          debunkCard: draft.debunkCard,
                          safetyGate: gateEvaluation
                            ? buildSafetyGateReceipt(gateEvaluation, {
                                simulatedFaultUsed: simulatedFaultActive,
                                repairsApplied,
                                commanderSignedOff,
                                activeAreaKnowledgeCount:
                                  activeAkContext.includedCount,
                              })
                            : undefined,
                        },
                      )
                    }
                    className="sw-btn-secondary min-h-[44px] px-4 py-2 text-xs font-semibold"
                  >
                    Export Markdown (.md)
                  </button>
                  <button
                    type="button"
                    onClick={handlePublish}
                    disabled={isPublishing || !canPublish}
                    title={
                      !canPublish
                        ? "Resolve all blocking Safety Gate findings and complete Commander sign-off before publishing"
                        : "Publish verified multi-audience dispatch to Public Crisis Wire"
                    }
                    className="sw-btn-primary min-h-[44px] px-5 py-2 text-sm font-semibold"
                  >
                    {isPublishing
                      ? "Publishing to Public Wire..."
                      : !canPublish
                        ? "Publish Locked by Safety Gate"
                        : "Publish to Public Crisis Wire"}
                  </button>
                </div>
              </div>

              {gateEvaluation ? (
                <SafetyGatePanel
                  gateEvaluation={gateEvaluation}
                  requiresSignOff={requiresSignOff}
                  commanderSignedOff={commanderSignedOff}
                  simulatedFaultActive={simulatedFaultActive}
                  repairsApplied={repairsApplied}
                  online={diagnostics.online}
                  gateGapDispatchBusy={gateGapDispatchBusy}
                  gateGapDispatched={gateGapDispatched}
                  onToggleDrillFault={handleToggleDrillFault}
                  onRepairRule={handleRepairRule}
                  onDispatchFirstGap={handleDispatchFirstGap}
                  onChangeCommanderSignOff={handleChangeCommanderSignOff}
                />
              ) : null}

              <BroadcastChannelPreview
                draft={draft}
                activeTab={activeTab}
                copiedKey={copiedKey}
                onSelectTab={setActiveTab}
                onCopy={handleCopy}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
