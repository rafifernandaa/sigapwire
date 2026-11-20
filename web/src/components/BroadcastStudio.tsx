import { useMemo, useState } from "react";
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

  const selectedIntakes = useMemo(
    () => intakes.filter((i) => selectedIds.includes(i.id)),
    [intakes, selectedIds],
  );

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

  const handlePublish = async () => {
    if (!draft || draftSourceIds.length === 0) return;
    setErrorMsg(null);
    setIsPublishing(true);

    try {
      const groundingHtml =
        selectedIntakes.find((i) => i.structured.searchEntryPointHtml)
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

      await markIntakesIncluded(selectedIntakes);
      setDraft(null);
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* LEFT COLUMN: Multi-Platform Synced Intake Queue */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
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
                    className="block rounded-lg border p-4 transition-colors"
                    style={{
                      backgroundColor: "var(--bg-surface)",
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
                <button
                  type="button"
                  onClick={handlePublish}
                  disabled={isPublishing}
                  className="min-h-[44px] rounded-md px-5 py-2 text-sm font-semibold text-white"
                  style={{ backgroundColor: "var(--accent-vermilion)" }}
                >
                  {isPublishing
                    ? "Publishing to Public Wire..."
                    : "Publish to Public Crisis Wire"}
                </button>
              </div>

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
                    className="min-h-[40px] rounded-md px-3 py-1.5 text-xs font-semibold border"
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
                      className="min-h-[36px] shrink-0 rounded border px-3 text-xs font-semibold"
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
                      className="min-h-[36px] shrink-0 rounded border px-3 text-xs font-semibold"
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
                      className="min-h-[36px] shrink-0 rounded border px-3 text-xs font-semibold"
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
