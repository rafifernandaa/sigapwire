import { useMemo, useState } from "react";
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
import { downloadDispatchMarkdown } from "../lib/dispatchExport";
import {
  synthesizeBroadcastPack,
  type SynthesizedBroadcastResult,
} from "../lib/hybridAi";
import {
  markIntakesIncluded,
  publishDispatchToFirestore,
} from "../lib/firestoreRepo";
import type {
  IncidentDoc,
  IntakeDoc,
  OnDeviceDiagnostics,
} from "../types/sigapwire";
import {
  InferenceBadge,
  PlatformBadge,
  SeverityBadge,
  VerdictBadge,
} from "./StatusBadges";

interface BroadcastStudioProps {
  activeIncident: IncidentDoc | null;
  intakes: IntakeDoc[];
  intakesLoading: boolean;
  nextDispatchNumber: number;
  diagnostics: OnDeviceDiagnostics;
  onGoToCommand: () => void;
  onPublishedDispatch: () => void;
}

type AudienceTab = "community" | "media" | "global" | "debunk";

export function BroadcastStudio({
  activeIncident,
  intakes,
  intakesLoading,
  nextDispatchNumber,
  diagnostics,
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
    const onDevicePercent = total > 0 ? Math.round((onDeviceCount / total) * 100) : 0;

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
      });
      setDraft(result);
      setDraftSourceIds(selectedIntakes.map((i) => i.id));
      setDraftSourceIntakes(selectedIntakes);
      setPreDrillDraft(null);
      setSimulatedFaultActive(false);
      setRepairsApplied([]);
      setCommanderSignedOff(false);
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
    } else if (preDrillDraft) {
      setDraft(preDrillDraft);
      setPreDrillDraft(null);
      setSimulatedFaultActive(false);
      setRepairsApplied([]);
      setCommanderSignedOff(false);
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
    setRepairsApplied((prev) => (prev.includes(label) ? prev : [...prev, label]));
    setCommanderSignedOff(false);
  };

  const handlePublish = async () => {
    if (!draft || draftSourceIds.length === 0 || !canPublish) return;
    setErrorMsg(null);
    setIsPublishing(true);

    try {
      const groundingHtml =
        draftSourceIntakes.find((i) => i.structured.searchEntryPointHtml)
          ?.structured.searchEntryPointHtml ?? null;

      await publishDispatchToFirestore({
        incidentId: activeIncident?.id || "inc_westjava_drill_2026",
        dispatchNumber: nextDispatchNumber,
        severity: draft.severity,
        sourceIntakeIds: draftSourceIds,
        inferenceSource: "IN_CLOUD",
        communityAlertId: draft.communityAlertId,
        mediaPressReleaseId: draft.mediaPressReleaseId,
        globalSitrepEn: draft.globalSitrepEn,
        debunkCard: draft.debunkCard,
        groundingSearchHtml: groundingHtml,
      });

      await markIntakesIncluded(draftSourceIntakes);
      setDraft(null);
      setDraftSourceIds([]);
      setDraftSourceIntakes([]);
      setPreDrillDraft(null);
      setSimulatedFaultActive(false);
      setRepairsApplied([]);
      setCommanderSignedOff(false);
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
    <section className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
      <div
        className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b pb-5"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div>
          <h1 className="font-editorial text-2xl sm:text-3xl font-bold tracking-tight">
            Multi-Audience Broadcast Studio
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm" style={{ color: "var(--ink-muted)" }}>
            Merge sanitized field intakes and rumor checks synced from Web, Android, and Apple clients into synchronized Community Alerts (ID), National Press Releases (ID), Global SitReps (EN), and Debunk Cards via Cloud Gemini.
          </p>
        </div>
        <button
          type="button"
          onClick={selectAllOpen}
          disabled={intakes.length === 0}
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-md border px-4 text-xs font-semibold"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: "var(--border-strong)",
            color: "var(--ink-primary)",
          }}
        >
          Select All Pending Intakes
        </button>
      </div>

      {telemetry.total > 0 ? (
        <div
          aria-label="Live Hybrid Telemetry Summary"
          className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3 rounded-lg border p-4"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <div>
            <p className="text-xs font-semibold" style={{ color: "var(--ink-muted)" }}>
              Synced Cross-Platform Intakes
            </p>
            <p className="mt-1 font-mono-telemetry text-lg font-bold">
              {telemetry.total} reports
            </p>
            <p className="mt-0.5 font-mono-telemetry text-[11px]" style={{ color: "var(--ink-muted)" }}>
              WEB {telemetry.webCount} | ANDROID {telemetry.androidCount} | APPLE {telemetry.appleCount}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold" style={{ color: "var(--ink-muted)" }}>
              Hybrid Inference Split
            </p>
            <p className="mt-1 font-mono-telemetry text-lg font-bold">
              {telemetry.onDevicePercent}% ON_DEVICE
            </p>
            <p className="mt-0.5 font-mono-telemetry text-[11px]" style={{ color: "var(--ink-muted)" }}>
              ON_DEVICE {telemetry.onDeviceCount} | IN_CLOUD {telemetry.inCloudCount}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold" style={{ color: "var(--ink-muted)" }}>
              PII Scrubbed Before Cloud
            </p>
            <p
              className="mt-1 font-mono-telemetry text-lg font-bold"
              style={{ color: "var(--semantic-on-device)" }}
            >
              {telemetry.totalRedactions} items kept local
            </p>
            <p className="mt-0.5 text-[11px]" style={{ color: "var(--ink-muted)" }}>
              Derived strictly from live Firestore intake metadata.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* LEFT COLUMN: Multi-Platform Synced Intake Queue */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold" style={{ color: "var(--ink-muted)" }}>
              Synced Incident Queue ({intakes.length})
            </h2>
            <span className="font-mono-telemetry text-xs" style={{ color: "var(--ink-muted)" }}>
              {selectedIds.length} selected
            </span>
          </div>

          {intakesLoading ? (
            <div
              className="rounded-lg border p-6 text-sm"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-subtle)",
                color: "var(--ink-muted)",
              }}
            >
              Loading real-time intakes from Firestore...
            </div>
          ) : intakes.length === 0 ? (
            <div
              className="rounded-lg border p-6"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-subtle)",
              }}
            >
              <h3 className="font-editorial text-lg font-bold">
                Incident queue is empty
              </h3>
              <p className="mt-1.5 text-sm" style={{ color: "var(--ink-muted)" }}>
                No field reports or rumor checks have been saved yet. Triage a Synthetic Drill in the Command Desk (or capture one from the Android / Apple companion apps) to synthesize a broadcast.
              </p>
              <button
                type="button"
                onClick={onGoToCommand}
                className="mt-4 inline-flex min-h-[44px] items-center rounded-md px-4 text-sm font-semibold text-white"
                style={{ backgroundColor: "var(--accent-vermilion)" }}
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
                    className="block rounded-lg border p-4 transition-colors hover:opacity-95"
                    style={{
                      backgroundColor: checked
                        ? "var(--bg-subtle)"
                        : "var(--bg-surface)",
                      borderColor: checked
                        ? "var(--accent-vermilion)"
                        : "var(--border-subtle)",
                    }}
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
                          className="mt-2 flex flex-wrap items-center gap-3 font-mono-telemetry text-[11px]"
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
        <div
          className="lg:col-span-7 rounded-lg border p-5"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b" style={{ borderColor: "var(--border-subtle)" }}>
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
              className="min-h-[44px] rounded-md px-4 py-2 text-sm font-semibold text-white"
              style={{ backgroundColor: "var(--accent-vermilion)" }}
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
              <strong style={{ color: "var(--ink-primary)" }}>Synthesize in Cloud</strong>{" "}
              to simultaneously generate:
              <ul className="mt-3 list-disc pl-5 space-y-1.5" style={{ color: "var(--ink-primary)" }}>
                <li>Calm, plain-language Indonesian Community Action Alert + WhatsApp copy</li>
                <li>National Media Press Release (Bahasa Indonesia)</li>
                <li>Global Humanitarian Situation Report (English, OCHA / ReliefWeb format)</li>
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
                              })
                            : undefined,
                        },
                      )
                    }
                    className="min-h-[44px] rounded-md border px-4 py-2 text-xs font-semibold"
                    style={{
                      backgroundColor: "var(--bg-surface)",
                      borderColor: "var(--border-strong)",
                      color: "var(--ink-primary)",
                    }}
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
                    className="min-h-[44px] rounded-md px-5 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                    style={{ backgroundColor: "var(--accent-vermilion)" }}
                  >
                    {isPublishing
                      ? "Publishing to Public Wire..."
                      : !canPublish
                        ? "Publish Locked by Safety Gate"
                        : "Publish to Public Crisis Wire"}
                  </button>
                </div>
              </div>

              {/* Pre-Publish Safety Gate (Deterministic) */}
              {gateEvaluation ? (
                <section
                  aria-label="Pre-Publish Safety Gate"
                  className="rounded-lg border p-4 space-y-3"
                  style={{
                    backgroundColor: "var(--bg-ground)",
                    borderColor:
                      gateEvaluation.blockCount > 0
                        ? "var(--state-critical-border)"
                        : requiresSignOff && !commanderSignedOff
                          ? "var(--state-warn-border)"
                          : "var(--state-ondevice-border)",
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b" style={{ borderColor: "var(--border-subtle)" }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold">
                        Pre-Publish Safety Gate (Deterministic)
                      </h3>
                      <span
                        aria-live="polite"
                        className="font-mono-telemetry rounded px-2 py-0.5 text-[11px] font-semibold border"
                        style={
                          gateEvaluation.blockCount > 0
                            ? {
                                backgroundColor: "var(--state-critical-bg)",
                                color: "var(--state-critical-ink)",
                                borderColor: "var(--state-critical-border)",
                              }
                            : requiresSignOff && !commanderSignedOff
                              ? {
                                  backgroundColor: "var(--state-warn-bg)",
                                  color: "var(--state-warn-ink)",
                                  borderColor: "var(--state-warn-border)",
                                }
                              : {
                                  backgroundColor: "var(--state-ondevice-bg)",
                                  color: "var(--state-ondevice-ink)",
                                  borderColor: "var(--state-ondevice-border)",
                                }
                        }
                      >
                        {gateEvaluation.blockCount > 0
                          ? `PUBLISH BLOCKED (${gateEvaluation.blockCount})`
                          : requiresSignOff && !commanderSignedOff
                            ? "SIGN-OFF REQUIRED"
                            : "GATE PASSED"}
                      </span>
                      {simulatedFaultActive ? (
                        <span
                          className="font-mono-telemetry rounded px-2 py-0.5 text-[11px] font-semibold border"
                          style={{
                            backgroundColor: "var(--state-warn-bg)",
                            color: "var(--state-warn-ink)",
                            borderColor: "var(--state-warn-border)",
                          }}
                        >
                          SIMULATED FAULT ACTIVE
                        </span>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      onClick={handleToggleDrillFault}
                      className="min-h-[44px] rounded-md border px-3 text-xs font-semibold"
                      style={{
                        backgroundColor: "var(--bg-surface)",
                        borderColor: "var(--border-strong)",
                        color: "var(--ink-primary)",
                      }}
                    >
                      {simulatedFaultActive
                        ? "Restore Pre-Drill Draft"
                        : "Test Safety Gate (Drill)"}
                    </button>
                  </div>

                  <ul className="space-y-2">
                    {gateEvaluation.checks.map((check) => {
                      const badgeStyle =
                        check.status === "BLOCK"
                          ? {
                              backgroundColor: "var(--state-critical-bg)",
                              color: "var(--state-critical-ink)",
                              borderColor: "var(--state-critical-border)",
                            }
                          : check.status === "WARN"
                            ? {
                                backgroundColor: "var(--state-warn-bg)",
                                color: "var(--state-warn-ink)",
                                borderColor: "var(--state-warn-border)",
                              }
                            : {
                                backgroundColor: "var(--state-ondevice-bg)",
                                color: "var(--state-ondevice-ink)",
                                borderColor: "var(--state-ondevice-border)",
                              };

                      return (
                        <li
                          key={check.id}
                          className="rounded-md border p-3 text-xs space-y-2"
                          style={{
                            backgroundColor: "var(--bg-surface)",
                            borderColor: "var(--border-subtle)",
                          }}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className="font-mono-telemetry rounded px-1.5 py-0.5 text-[10px] font-bold border"
                                  style={badgeStyle}
                                >
                                  {check.status}
                                </span>
                                <span className="font-semibold">
                                  {check.label}
                                </span>
                              </div>
                              <p style={{ color: "var(--ink-muted)" }}>
                                {check.summary}
                              </p>
                            </div>

                            {check.repairActionLabel ? (
                              <button
                                type="button"
                                onClick={() => handleRepairRule(check.id)}
                                className="min-h-[44px] shrink-0 rounded-md border px-3 text-xs font-semibold"
                                style={{
                                  backgroundColor: "var(--bg-subtle)",
                                  borderColor: "var(--border-strong)",
                                  color: "var(--ink-primary)",
                                }}
                              >
                                {check.repairActionLabel}
                              </button>
                            ) : null}
                          </div>

                          {check.findings.length > 0 ? (
                            <ul
                              className="list-disc pl-4 space-y-0.5 font-mono-telemetry text-[11px]"
                              style={{ color: "var(--ink-muted)" }}
                            >
                              {check.findings.slice(0, 3).map((finding, idx) => (
                                <li key={`${check.id}-f-${idx}`}>
                                  {finding.channel}.{finding.field}: {finding.excerpt}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>

                  {repairsApplied.length > 0 ? (
                    <div
                      className="rounded border px-3 py-2 text-[11px] font-mono-telemetry"
                      style={{
                        backgroundColor: "var(--bg-subtle)",
                        borderColor: "var(--border-subtle)",
                        color: "var(--ink-muted)",
                      }}
                    >
                      Repairs applied: {repairsApplied.join(" | ")}
                    </div>
                  ) : null}

                  {requiresSignOff ? (
                    <label
                      className="min-h-[44px] flex items-start gap-2.5 rounded-md border p-3 text-xs font-medium cursor-pointer"
                      style={{
                        backgroundColor: "var(--state-warn-bg)",
                        color: "var(--state-warn-ink)",
                        borderColor: "var(--state-warn-border)",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={commanderSignedOff}
                        onChange={(e) => setCommanderSignedOff(e.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0"
                      />
                      <span>
                        <strong>Commander Release Sign-Off:</strong> I have reviewed the deterministic gate checks, applied repairs, and open information gaps, and authorize public release.
                      </span>
                    </label>
                  ) : null}
                </section>
              ) : null}

              {/* 4 Audience Output Tabs */}
              <div
                role="tablist"
                aria-label="Broadcast audience channels"
                className="flex flex-wrap gap-1.5 border-b pb-3"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                {(
                  [
                    ["community", "Community Alert (ID)"],
                    ["media", "Media Release (ID)"],
                    ["global", "Global SitRep (EN)"],
                    ["debunk", "Debunk Card (ID/EN)"],
                  ] as Array<[AudienceTab, string]>
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === id}
                    onClick={() => setActiveTab(id)}
                    className="min-h-[44px] rounded-md px-3 py-1.5 text-xs font-semibold border"
                    style={{
                      backgroundColor:
                        activeTab === id ? "var(--bg-subtle)" : "transparent",
                      borderColor:
                        activeTab === id
                          ? "var(--border-strong)"
                          : "var(--border-subtle)",
                      color: "var(--ink-primary)",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {activeTab === "community" ? (
                <div className="space-y-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-editorial text-lg font-bold">
                      {draft.communityAlertId.title}
                    </h3>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy(
                          "wa",
                          draft.communityAlertId.whatsappShortText,
                        )
                      }
                      className="min-h-[44px] shrink-0 rounded border px-3 text-xs font-semibold"
                      style={{ borderColor: "var(--border-strong)" }}
                    >
                      {copiedKey === "wa" ? "Copied" : "Copy WhatsApp Alert"}
                    </button>
                  </div>
                  <p className="leading-relaxed">
                    {draft.communityAlertId.whatHappened}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div
                      className="rounded-md border p-3"
                      style={{
                        backgroundColor: "var(--state-ondevice-bg)",
                        borderColor: "var(--state-ondevice-border)",
                        color: "var(--state-ondevice-ink)",
                      }}
                    >
                      <strong className="block text-xs mb-1.5">
                        LAKUKAN SEKARANG (DO NOW)
                      </strong>
                      <ul className="list-disc pl-4 space-y-1 text-xs">
                        {draft.communityAlertId.doNow.map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </div>
                    <div
                      className="rounded-md border p-3"
                      style={{
                        backgroundColor: "var(--state-critical-bg)",
                        borderColor: "var(--state-critical-border)",
                        color: "var(--state-critical-ink)",
                      }}
                    >
                      <strong className="block text-xs mb-1.5">
                        HINDARI (AVOID)
                      </strong>
                      <ul className="list-disc pl-4 space-y-1 text-xs">
                        {draft.communityAlertId.avoid.map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ) : null}

              {activeTab === "media" ? (
                <div className="space-y-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono-telemetry text-xs" style={{ color: "var(--ink-muted)" }}>
                        {draft.mediaPressReleaseId.dateline}
                      </p>
                      <h3 className="font-editorial text-lg font-bold mt-1">
                        {draft.mediaPressReleaseId.headline}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy(
                          "pr",
                          `${draft.mediaPressReleaseId.headline}\n${draft.mediaPressReleaseId.dateline}\n\n${draft.mediaPressReleaseId.body}`,
                        )
                      }
                      className="min-h-[44px] shrink-0 rounded border px-3 text-xs font-semibold"
                      style={{ borderColor: "var(--border-strong)" }}
                    >
                      {copiedKey === "pr" ? "Copied" : "Copy Press Release"}
                    </button>
                  </div>
                  <p className="leading-relaxed whitespace-pre-wrap">
                    {draft.mediaPressReleaseId.body}
                  </p>
                  {draft.mediaPressReleaseId.keyMetrics.length > 0 ? (
                    <ul className="list-disc pl-5 text-xs space-y-1">
                      {draft.mediaPressReleaseId.keyMetrics.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {activeTab === "global" ? (
                <div className="space-y-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-editorial text-lg font-bold">
                      {draft.globalSitrepEn.headline}
                    </h3>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy(
                          "sitrep",
                          `${draft.globalSitrepEn.headline}\n\n${draft.globalSitrepEn.executiveSummary}\n\nPriority Needs:\n- ${draft.globalSitrepEn.priorityNeeds.join("\n- ")}`,
                        )
                      }
                      className="min-h-[44px] shrink-0 rounded border px-3 text-xs font-semibold"
                      style={{ borderColor: "var(--border-strong)" }}
                    >
                      {copiedKey === "sitrep" ? "Copied" : "Copy Global SitRep"}
                    </button>
                  </div>
                  <p className="leading-relaxed">
                    {draft.globalSitrepEn.executiveSummary}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <strong className="block mb-1">Impact Overview</strong>
                      <ul className="list-disc pl-4 space-y-1">
                        {draft.globalSitrepEn.impactOverview.map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <strong className="block mb-1">Priority Needs</strong>
                      <ul className="list-disc pl-4 space-y-1">
                        {draft.globalSitrepEn.priorityNeeds.map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <strong className="block mb-1">Information Gaps</strong>
                      <ul className="list-disc pl-4 space-y-1">
                        {draft.globalSitrepEn.informationGaps.map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ) : null}

              {activeTab === "debunk" ? (
                <div className="space-y-3 text-sm">
                  {!draft.debunkCard.hasRumorAlert ? (
                    <p style={{ color: "var(--ink-muted)" }}>
                      No rumor-check intakes were included in this selection. Select a Rumor Check intake to generate a bilingual Debunk Card.
                    </p>
                  ) : (
                    <>
                      <VerdictBadge verdict={draft.debunkCard.verdict} />
                      <p className="font-semibold">
                        Claim: {draft.debunkCard.claim}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div
                          className="rounded-md border p-3"
                          style={{
                            backgroundColor: "var(--bg-ground)",
                            borderColor: "var(--border-subtle)",
                          }}
                        >
                          <strong className="block mb-1">Klarifikasi (ID)</strong>
                          <p>{draft.debunkCard.factId}</p>
                        </div>
                        <div
                          className="rounded-md border p-3"
                          style={{
                            backgroundColor: "var(--bg-ground)",
                            borderColor: "var(--border-subtle)",
                          }}
                        >
                          <strong className="block mb-1">Clarification (EN)</strong>
                          <p>{draft.debunkCard.factEn}</p>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
