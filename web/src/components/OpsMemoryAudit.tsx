import { useMemo, useState } from "react";
import {
  formatAreaKnowledgeBlock,
  MAX_INJECTED_AREA_FACTS,
} from "../lib/areaKnowledgeContext";
import {
  buildUnifiedAuditTrail,
  formatIncidentAuditMarkdown,
  type AuditCategory,
} from "../lib/auditTrail";
import { downloadTextFile } from "../lib/dispatchExport";
import { isFirebaseConfigured } from "../lib/firebase";
import type { HybridScorecard } from "../lib/hybridScorecard";
import {
  createAreaKnowledge,
  createVerificationTask,
  markVerificationTaskPromoted,
  setAreaKnowledgeActive,
  submitVerificationTaskAnswer,
} from "../lib/firestoreRepo";
import { deterministicLocalPiiScrub } from "../lib/piiScrubber";
import type {
  AreaKnowledgeCategory,
  AreaKnowledgeDoc,
  DispatchDoc,
  IncidentDoc,
  IntakeDoc,
  OnDeviceDiagnostics,
  SessionAuditEvent,
  VerificationTaskDoc,
} from "../types/sigapwire";
import { HybridScorecardStrip } from "./HybridScorecardStrip";
import { PlatformBadge } from "./StatusBadges";

interface OpsMemoryAuditProps {
  activeIncident: IncidentDoc | null;
  activeIncidentId: string;
  diagnostics: OnDeviceDiagnostics;
  scorecard: HybridScorecard;
  intakes: IntakeDoc[];
  dispatches: DispatchDoc[];
  verificationTasks: VerificationTaskDoc[];
  areaKnowledge: AreaKnowledgeDoc[];
  sessionEvents: SessionAuditEvent[];
  onLogSessionEvent: (event: Omit<SessionAuditEvent, "id" | "timestamp">) => void;
}

const AREA_CATEGORIES: Array<{ value: AreaKnowledgeCategory; label: string }> = [
  { value: "ROUTE_ACCESS", label: "Route & Bridge Access" },
  { value: "EVACUATION_SITE", label: "Evacuation Site" },
  { value: "INFRASTRUCTURE", label: "Critical Infrastructure" },
  { value: "OFFICIAL_SOURCE", label: "Official Agency Source" },
  { value: "SAFETY_CONSTRAINT", label: "Field Safety Constraint" },
];

export function OpsMemoryAudit({
  activeIncident,
  activeIncidentId,
  diagnostics,
  scorecard,
  intakes,
  dispatches,
  verificationTasks,
  areaKnowledge,
  sessionEvents,
  onLogSessionEvent,
}: OpsMemoryAuditProps) {
  const [questionInput, setQuestionInput] = useState("");
  const [locationInput, setLocationInput] = useState("");
  const [isCreatingTask, setIsCreatingTask] = useState(false);

  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [promoteCategories, setPromoteCategories] = useState<
    Record<string, AreaKnowledgeCategory>
  >({});
  const [taskBusy, setTaskBusy] = useState<Record<string, boolean>>({});

  const [factInput, setFactInput] = useState("");
  const [factCategory, setFactCategory] =
    useState<AreaKnowledgeCategory>("SAFETY_CONSTRAINT");
  const [isAddingFact, setIsAddingFact] = useState(false);
  const [factBusy, setFactBusy] = useState<Record<string, boolean>>({});

  const [auditFilter, setAuditFilter] = useState<"ALL" | AuditCategory>("ALL");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const akContext = useMemo(
    () => formatAreaKnowledgeBlock(areaKnowledge),
    [areaKnowledge],
  );

  const injectedRankById = useMemo(() => {
    const map = new Map<string, number>();
    akContext.includedIds.forEach((id, idx) => map.set(id, idx + 1));
    return map;
  }, [akContext]);

  const auditEvents = useMemo(
    () =>
      buildUnifiedAuditTrail({
        intakes,
        verificationTasks,
        areaKnowledge,
        dispatches,
        sessionEvents,
      }),
    [intakes, verificationTasks, areaKnowledge, dispatches, sessionEvents],
  );

  const filteredEvents = useMemo(
    () =>
      auditFilter === "ALL"
        ? auditEvents
        : auditEvents.filter((ev) => ev.category === auditFilter),
    [auditEvents, auditFilter],
  );

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = questionInput.trim();
    if (!q) return;
    if (!isFirebaseConfigured()) {
      setErrorMsg("Add Firebase credentials to web/.env.local to sync field tasks.");
      return;
    }

    setErrorMsg(null);
    setFeedback(null);
    setIsCreatingTask(true);
    try {
      const loc = locationInput.trim() || activeIncident?.region || "Field Zone";
      await createVerificationTask({
        incidentId: activeIncidentId,
        linkedIntakeId: null,
        question: q,
        location: loc,
        requestedPlatform: "WEB",
      });
      onLogSessionEvent({
        category: "HUMAN_GATE",
        eventType: "FIELD_TASK_DISPATCHED",
        title: `Dispatched field check (${loc})`,
        detail: q,
      });
      setQuestionInput("");
      setLocationInput("");
      setFeedback("Dispatched verification check to synced Web, Apple, and Android field clients.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to dispatch field check.");
    } finally {
      setIsCreatingTask(false);
    }
  };

  const handleAnswerTask = async (task: VerificationTaskDoc) => {
    const raw = (replyDrafts[task.id] ?? "").trim();
    if (!raw) return;
    if (!isFirebaseConfigured()) {
      setErrorMsg("Add Firebase credentials to web/.env.local to submit field answers.");
      return;
    }

    setErrorMsg(null);
    setFeedback(null);
    setTaskBusy((prev) => ({ ...prev, [task.id]: true }));
    try {
      const scrubbed = deterministicLocalPiiScrub(raw);
      await submitVerificationTaskAnswer({
        taskId: task.id,
        sanitizedAnswer: scrubbed.sanitizedText,
        redactionCount: scrubbed.redactions.length,
        answerPlatform: "WEB",
      });
      setReplyDrafts((prev) => {
        const next = { ...prev };
        delete next[task.id];
        return next;
      });
      setFeedback(
        `Submitted field reply (${scrubbed.redactions.length} PII item(s) scrubbed locally before upload).`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to submit verification answer.");
    } finally {
      setTaskBusy((prev) => ({ ...prev, [task.id]: false }));
    }
  };

  const handlePromoteTask = async (task: VerificationTaskDoc) => {
    if (!task.answerText) return;
    if (!isFirebaseConfigured()) {
      setErrorMsg("Firebase credentials required to promote verified facts.");
      return;
    }

    setErrorMsg(null);
    setFeedback(null);
    setTaskBusy((prev) => ({ ...prev, [task.id]: true }));
    try {
      const category = promoteCategories[task.id] ?? "SAFETY_CONSTRAINT";
      const knowledgeId = await createAreaKnowledge({
        incidentId: task.incidentId,
        fact: `${task.location}: ${task.answerText}`,
        category,
        sourceType: "PROMOTED_FIELD_CHECK",
        sourceTaskId: task.id,
        active: true,
      });
      await markVerificationTaskPromoted({
        taskId: task.id,
        promotedKnowledgeId: knowledgeId,
      });
      onLogSessionEvent({
        category: "HUMAN_GATE",
        eventType: "KNOWLEDGE_PROMOTED",
        title: `Promoted field check to Area Knowledge (${category})`,
        detail: `${task.location}: ${task.answerText}`,
      });
      setFeedback("Promoted verified field answer into active Area Knowledge prompt memory.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to promote field answer.");
    } finally {
      setTaskBusy((prev) => ({ ...prev, [task.id]: false }));
    }
  };

  const handleAddDirectFact = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = factInput.trim();
    if (!cleaned) return;
    if (!isFirebaseConfigured()) {
      setErrorMsg("Firebase credentials required to save Area Knowledge.");
      return;
    }

    setErrorMsg(null);
    setFeedback(null);
    setIsAddingFact(true);
    try {
      await createAreaKnowledge({
        incidentId: activeIncidentId,
        fact: cleaned,
        category: factCategory,
        sourceType: "HUMAN_DIRECT",
        sourceTaskId: null,
        active: true,
      });
      setFactInput("");
      setFeedback("Added verified Area Knowledge fact to bounded prompt memory.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to save Area Knowledge.");
    } finally {
      setIsAddingFact(false);
    }
  };

  const handleToggleFactActive = async (fact: AreaKnowledgeDoc) => {
    setErrorMsg(null);
    setFactBusy((prev) => ({ ...prev, [fact.id]: true }));
    try {
      await setAreaKnowledgeActive(fact.id, !fact.active);
      onLogSessionEvent({
        category: "HUMAN_GATE",
        eventType: "AREA_KNOWLEDGE_TOGGLED",
        title: `${!fact.active ? "Activated" : "Paused"} Area Knowledge (${fact.category})`,
        detail: fact.fact,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to update Area Knowledge status.");
    } finally {
      setFactBusy((prev) => ({ ...prev, [fact.id]: false }));
    }
  };

  const handleExportAudit = () => {
    const markdown = formatIncidentAuditMarkdown({
      incidentTitle:
        activeIncident?.title || "West Java M6.2 Earthquake (Synthetic Drill)",
      region: activeIncident?.region || "Cianjur & Bandung Raya, West Java",
      intakes,
      verificationTasks,
      areaKnowledge,
      dispatches,
      events: auditEvents,
    });
    downloadTextFile("sigapwire-incident-audit-dossier.md", markdown);
  };

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      <div
        className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b pb-5"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div>
          <h1 className="font-editorial text-2xl sm:text-3xl font-bold tracking-tight">
            Closed-Loop Ops Memory &amp; Hybrid Audit
          </h1>
          <p className="mt-1.5 max-w-3xl text-sm" style={{ color: "var(--ink-muted)" }}>
            Close open verification gaps with responders across Web, Apple, and Android, promote human-verified facts into bounded prompt memory, and inspect every hybrid AI decision.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportAudit}
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-md border px-4 text-xs font-semibold"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: "var(--border-strong)",
            color: "var(--ink-primary)",
          }}
        >
          Export Incident Audit (.md)
        </button>
      </div>

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

      {feedback ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border p-3 text-xs font-medium"
          style={{
            backgroundColor: "var(--state-ondevice-bg)",
            color: "var(--state-ondevice-ink)",
            borderColor: "var(--state-ondevice-border)",
          }}
        >
          {feedback}
        </div>
      ) : null}

      <HybridScorecardStrip scorecard={scorecard} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* LEFT COLUMN: Two-Way Field Verification + Verified Area Knowledge */}
        <div className="lg:col-span-6 space-y-6">
          {/* Two-Way Field Verification Tasks */}
          <div
            className="rounded-lg border p-5 space-y-4"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--border-subtle)",
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b" style={{ borderColor: "var(--border-subtle)" }}>
              <div>
                <h2 className="text-base font-bold">
                  Two-Way Field Verification Requests
                </h2>
                <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
                  Bounded questions dispatched to field responders; replies scrub PII locally before sync.
                </p>
              </div>
              <span
                className="font-mono-telemetry rounded px-2 py-0.5 text-xs border"
                style={{
                  backgroundColor: "var(--bg-subtle)",
                  borderColor: "var(--border-subtle)",
                }}
              >
                {verificationTasks.filter((t) => t.status === "OPEN").length} open
              </span>
            </div>

            <form onSubmit={handleCreateTask} className="space-y-2.5">
              <div>
                <label
                  htmlFor="field-check-question"
                  className="block text-xs font-semibold mb-1"
                >
                  Dispatch Field Check Question
                </label>
                <input
                  id="field-check-question"
                  type="text"
                  value={questionInput}
                  onChange={(e) => setQuestionInput(e.target.value)}
                  placeholder="e.g. Confirm safe tonnage limit for northern ring bridge in Cugenang"
                  className="w-full min-h-[44px] rounded-md border px-3 text-sm"
                  style={{
                    backgroundColor: "var(--bg-ground)",
                    borderColor: "var(--border-strong)",
                    color: "var(--ink-primary)",
                  }}
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  aria-label="Field sector or location"
                  value={locationInput}
                  onChange={(e) => setLocationInput(e.target.value)}
                  placeholder="Sector / Location (optional)"
                  className="flex-1 min-h-[44px] rounded-md border px-3 text-sm"
                  style={{
                    backgroundColor: "var(--bg-ground)",
                    borderColor: "var(--border-strong)",
                    color: "var(--ink-primary)",
                  }}
                />
                <button
                  type="submit"
                  disabled={isCreatingTask || !questionInput.trim() || !diagnostics.online}
                  className="min-h-[44px] shrink-0 rounded-md px-4 text-xs font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: "var(--accent-vermilion)" }}
                >
                  {isCreatingTask ? "Dispatching..." : "Dispatch to Field"}
                </button>
              </div>
            </form>

            {verificationTasks.length === 0 ? (
              <p className="text-xs py-2" style={{ color: "var(--ink-muted)" }}>
                No verification checks dispatched yet. Send one above or click &quot;Request Field Check&quot; on any Command Desk gap or Safety Gate warning.
              </p>
            ) : (
              <ul className="space-y-3">
                {verificationTasks.map((task) => {
                  const busy = Boolean(taskBusy[task.id]);
                  const statusStyle =
                    task.status === "OPEN"
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
                      key={task.id}
                      className="rounded-md border p-3.5 space-y-2.5 text-xs"
                      style={{
                        backgroundColor: "var(--bg-ground)",
                        borderColor: "var(--border-subtle)",
                      }}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className="font-mono-telemetry rounded px-2 py-0.5 text-[11px] font-semibold border"
                            style={statusStyle}
                          >
                            {task.status}
                          </span>
                          <PlatformBadge platform={task.requestedPlatform} />
                          <span className="font-mono-telemetry text-[11px]" style={{ color: "var(--ink-muted)" }}>
                            {task.location}
                          </span>
                        </div>
                        <span className="font-mono-telemetry text-[11px]" style={{ color: "var(--ink-muted)" }}>
                          {task.createdAt.toLocaleTimeString()}
                        </span>
                      </div>

                      <p className="text-sm font-semibold">{task.question}</p>

                      {task.status === "OPEN" ? (
                        <div className="flex flex-col sm:flex-row gap-2 pt-1">
                          <input
                            type="text"
                            aria-label={`Reply to verification task ${task.question}`}
                            value={replyDrafts[task.id] ?? ""}
                            onChange={(e) =>
                              setReplyDrafts((prev) => ({
                                ...prev,
                                [task.id]: e.target.value,
                              }))
                            }
                            placeholder="Field reply (PII scrubbed locally before upload)..."
                            className="flex-1 min-h-[44px] rounded-md border px-3 text-xs"
                            style={{
                              backgroundColor: "var(--bg-surface)",
                              borderColor: "var(--border-strong)",
                              color: "var(--ink-primary)",
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => handleAnswerTask(task)}
                            disabled={busy || !(replyDrafts[task.id] ?? "").trim()}
                            className="min-h-[44px] shrink-0 rounded-md border px-3 text-xs font-semibold disabled:opacity-50"
                            style={{
                              backgroundColor: "var(--state-ondevice-bg)",
                              color: "var(--state-ondevice-ink)",
                              borderColor: "var(--state-ondevice-border)",
                            }}
                          >
                            {busy ? "Scrubbing & Sending..." : "Scrub PII & Send Answer"}
                          </button>
                        </div>
                      ) : (
                        <div
                          className="rounded border p-2.5 space-y-2"
                          style={{
                            backgroundColor: "var(--bg-surface)",
                            borderColor: "var(--border-subtle)",
                          }}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            {task.answerPlatform ? (
                              <PlatformBadge platform={task.answerPlatform} />
                            ) : null}
                            <span
                              className="font-mono-telemetry text-[11px]"
                              style={{ color: "var(--ink-muted)" }}
                            >
                              {task.answerRedactionCount} PII item(s) scrubbed locally
                            </span>
                          </div>
                          <p className="text-xs leading-relaxed">
                            {task.answerText}
                          </p>

                          {task.status === "ANSWERED" ? (
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              <select
                                aria-label="Area Knowledge category"
                                value={promoteCategories[task.id] ?? "SAFETY_CONSTRAINT"}
                                onChange={(e) =>
                                  setPromoteCategories((prev) => ({
                                    ...prev,
                                    [task.id]: e.target.value as AreaKnowledgeCategory,
                                  }))
                                }
                                className="min-h-[44px] rounded-md border px-2.5 text-xs"
                                style={{
                                  backgroundColor: "var(--bg-ground)",
                                  borderColor: "var(--border-strong)",
                                  color: "var(--ink-primary)",
                                }}
                              >
                                {AREA_CATEGORIES.map((cat) => (
                                  <option key={cat.value} value={cat.value}>
                                    {cat.label}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => handlePromoteTask(task)}
                                disabled={busy}
                                className="min-h-[44px] rounded-md px-3.5 text-xs font-semibold text-white"
                                style={{ backgroundColor: "var(--accent-vermilion)" }}
                              >
                                {busy ? "Promoting..." : "Promote to Area Knowledge"}
                              </button>
                            </div>
                          ) : (
                            <div
                              className="font-mono-telemetry text-[11px] font-semibold"
                              style={{ color: "var(--semantic-on-device)" }}
                            >
                              PROMOTED TO AREA KNOWLEDGE ({task.promotedKnowledgeId})
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Human-Authored Area Knowledge Memory */}
          <div
            className="rounded-lg border p-5 space-y-4"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--border-subtle)",
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b" style={{ borderColor: "var(--border-subtle)" }}>
              <div>
                <h2 className="text-base font-bold">
                  Verified Area Knowledge ([AK-N] Prompt Memory)
                </h2>
                <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
                  Only human-confirmed facts enter prompt memory; unverified rumors and AI guesses are excluded.
                </p>
              </div>
              <span
                className="font-mono-telemetry rounded px-2 py-0.5 text-[11px] font-semibold border"
                style={{
                  backgroundColor: "var(--state-ondevice-bg)",
                  color: "var(--state-ondevice-ink)",
                  borderColor: "var(--state-ondevice-border)",
                }}
              >
                {akContext.includedCount}/{MAX_INJECTED_AREA_FACTS} active (~{akContext.estimatedTokens} est. tok)
              </span>
            </div>

            <form onSubmit={handleAddDirectFact} className="space-y-2.5">
              <div>
                <label
                  htmlFor="area-fact-input"
                  className="block text-xs font-semibold mb-1"
                >
                  Add Human-Verified Ground Truth
                </label>
                <input
                  id="area-fact-input"
                  type="text"
                  value={factInput}
                  onChange={(e) => setFactInput(e.target.value)}
                  placeholder="e.g. Sukamaju northern ring bridge max load is 3 tons for 4x4 vehicles"
                  className="w-full min-h-[44px] rounded-md border px-3 text-sm"
                  style={{
                    backgroundColor: "var(--bg-ground)",
                    borderColor: "var(--border-strong)",
                    color: "var(--ink-primary)",
                  }}
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  aria-label="Fact category"
                  value={factCategory}
                  onChange={(e) =>
                    setFactCategory(e.target.value as AreaKnowledgeCategory)
                  }
                  className="flex-1 min-h-[44px] rounded-md border px-3 text-xs"
                  style={{
                    backgroundColor: "var(--bg-ground)",
                    borderColor: "var(--border-strong)",
                    color: "var(--ink-primary)",
                  }}
                >
                  {AREA_CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={isAddingFact || !factInput.trim() || !diagnostics.online}
                  className="min-h-[44px] shrink-0 rounded-md border px-4 text-xs font-semibold disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--state-cloud-bg)",
                    color: "var(--state-cloud-ink)",
                    borderColor: "var(--state-cloud-border)",
                  }}
                >
                  {isAddingFact ? "Saving..." : "Save Ground Truth"}
                </button>
              </div>
            </form>

            {areaKnowledge.length === 0 ? (
              <p className="text-xs py-2" style={{ color: "var(--ink-muted)" }}>
                No Area Knowledge saved yet. Promote an answered Field Check or record a verified operational constraint above.
              </p>
            ) : (
              <ul className="space-y-2">
                {areaKnowledge.map((fact) => {
                  const akRank = injectedRankById.get(fact.id);
                  return (
                    <li
                      key={fact.id}
                      className="rounded-md border p-3 flex flex-wrap items-center justify-between gap-2 text-xs"
                      style={{
                        backgroundColor: "var(--bg-ground)",
                        borderColor: "var(--border-subtle)",
                      }}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className="font-mono-telemetry rounded px-1.5 py-0.5 text-[11px] font-bold border"
                            style={
                              fact.active
                                ? {
                                    backgroundColor: "var(--state-ondevice-bg)",
                                    color: "var(--state-ondevice-ink)",
                                    borderColor: "var(--state-ondevice-border)",
                                  }
                                : {
                                    backgroundColor: "var(--bg-subtle)",
                                    color: "var(--ink-muted)",
                                    borderColor: "var(--border-subtle)",
                                  }
                            }
                          >
                            {akRank ? `[AK-${akRank}]` : fact.active ? "QUEUED" : "PAUSED"}
                          </span>
                          <span className="font-mono-telemetry text-[11px]" style={{ color: "var(--ink-muted)" }}>
                            {fact.category} | {fact.sourceType}
                          </span>
                        </div>
                        <p className="text-sm leading-snug">{fact.fact}</p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleToggleFactActive(fact)}
                        disabled={Boolean(factBusy[fact.id])}
                        className="min-h-[44px] shrink-0 rounded-md border px-3 text-xs font-semibold"
                        style={{
                          backgroundColor: "var(--bg-surface)",
                          borderColor: "var(--border-strong)",
                          color: "var(--ink-primary)",
                        }}
                      >
                        {fact.active ? "Pause" : "Activate"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Unified Hybrid Decision Audit Trail */}
        <div className="lg:col-span-6">
          <div
            className="rounded-lg border p-5 space-y-4"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--border-subtle)",
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b" style={{ borderColor: "var(--border-subtle)" }}>
              <div>
                <h2 className="text-base font-bold">
                  Unified Hybrid Decision Audit Trail ({filteredEvents.length})
                </h2>
                <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
                  Cross-platform timeline derived from Firestore operational records + local session safety gates.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter audit timeline by authority">
              {(
                [
                  ["ALL", "All Events"],
                  ["ON_DEVICE", "On-Device"],
                  ["IN_CLOUD", "In-Cloud"],
                  ["HUMAN_GATE", "Human Gate"],
                ] as Array<["ALL" | AuditCategory, string]>
              ).map(([cat, label]) => {
                const active = auditFilter === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setAuditFilter(cat)}
                    className="min-h-[44px] rounded-md border px-3 text-xs font-semibold"
                    style={{
                      backgroundColor: active ? "var(--bg-subtle)" : "var(--bg-ground)",
                      borderColor: active
                        ? "var(--border-strong)"
                        : "var(--border-subtle)",
                      color: "var(--ink-primary)",
                    }}
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
                    <li
                      key={ev.id}
                      className="rounded-md border p-3 text-xs space-y-1"
                      style={{
                        backgroundColor: "var(--bg-ground)",
                        borderColor: "var(--border-subtle)",
                      }}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className="font-mono-telemetry rounded px-1.5 py-0.5 text-[10px] font-bold border"
                            style={catStyle}
                          >
                            {ev.category}
                          </span>
                          {ev.platform === "WEB" ||
                          ev.platform === "ANDROID" ||
                          ev.platform === "APPLE" ? (
                            <PlatformBadge platform={ev.platform} />
                          ) : null}
                          <span className="font-mono-telemetry text-[10px]" style={{ color: "var(--ink-muted)" }}>
                            {ev.eventType}
                          </span>
                        </div>
                        <time
                          dateTime={ev.timestamp.toISOString()}
                          className="font-mono-telemetry text-[10px]"
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
        </div>
      </div>
    </section>
  );
}
