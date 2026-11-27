import { useMemo, useState } from "react";
import { formatAreaKnowledgeBlock } from "../lib/areaKnowledgeContext";
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
  promoteTaskToAreaKnowledgeAtomic,
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
import { AreaKnowledgePanel } from "./AreaKnowledgePanel";
import { AuditTimelinePanel } from "./AuditTimelinePanel";
import { FieldVerificationPanel } from "./FieldVerificationPanel";
import { HybridBenchmarkPanel } from "./HybridBenchmarkPanel";
import { HybridScorecardStrip } from "./HybridScorecardStrip";

interface OpsMemoryAuditProps {
  activeIncident: IncidentDoc | null;
  activeIncidentId: string;
  diagnostics: OnDeviceDiagnostics;
  scorecard: HybridScorecard;
  intakes: IntakeDoc[];
  dispatches: DispatchDoc[];
  verificationTasks: VerificationTaskDoc[];
  areaKnowledge: AreaKnowledgeDoc[];
  tasksLoading: boolean;
  knowledgeLoading: boolean;
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
  tasksLoading,
  knowledgeLoading,
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
      setErrorMsg(
        "Add Firebase credentials to web/.env.local to sync field tasks.",
      );
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
      setFeedback(
        "Dispatched verification check to synced Web, Apple, and Android field clients.",
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to dispatch field check.",
      );
    } finally {
      setIsCreatingTask(false);
    }
  };

  const handleAnswerTask = async (task: VerificationTaskDoc) => {
    const raw = (replyDrafts[task.id] ?? "").trim();
    if (!raw) return;
    if (!isFirebaseConfigured()) {
      setErrorMsg(
        "Add Firebase credentials to web/.env.local to submit field answers.",
      );
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
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Failed to submit verification answer.",
      );
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
      await promoteTaskToAreaKnowledgeAtomic({
        incidentId: task.incidentId,
        taskId: task.id,
        fact: `${task.location}: ${task.answerText}`,
        category,
      });
      onLogSessionEvent({
        category: "HUMAN_GATE",
        eventType: "KNOWLEDGE_PROMOTED",
        title: `Promoted field check to Area Knowledge (${category})`,
        detail: `${task.location}: ${task.answerText}`,
      });
      setFeedback(
        "Promoted verified field answer into active Area Knowledge prompt memory.",
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to promote field answer.",
      );
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
      setFeedback(
        "Added verified Area Knowledge fact to bounded prompt memory.",
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to save Area Knowledge.",
      );
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
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Failed to update Area Knowledge status.",
      );
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
    <section className="mx-auto max-w-7xl px-4 sm:px-6 py-5 sm:py-7 space-y-6">
      <div
        className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b pb-4"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div>
          <h1 className="font-editorial text-2xl sm:text-3xl font-bold tracking-tight">
            Closed-Loop Ops Memory &amp; Hybrid Audit
          </h1>
          <p
            className="mt-1.5 max-w-3xl text-sm"
            style={{ color: "var(--ink-muted)" }}
          >
            Close open verification gaps with responders across Web, Apple, and Android, promote human-verified facts into bounded prompt memory, and inspect every hybrid AI decision.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportAudit}
          className="sw-btn-secondary inline-flex min-h-[44px] shrink-0 items-center justify-center px-4 text-xs font-semibold"
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
        <div className="lg:col-span-6 space-y-6">
          <FieldVerificationPanel
            verificationTasks={verificationTasks}
            tasksLoading={tasksLoading}
            online={diagnostics.online}
            questionInput={questionInput}
            locationInput={locationInput}
            isCreatingTask={isCreatingTask}
            replyDrafts={replyDrafts}
            promoteCategories={promoteCategories}
            taskBusy={taskBusy}
            areaCategories={AREA_CATEGORIES}
            onChangeQuestion={setQuestionInput}
            onChangeLocation={setLocationInput}
            onCreateTask={handleCreateTask}
            onChangeReplyDraft={(taskId, value) =>
              setReplyDrafts((prev) => ({ ...prev, [taskId]: value }))
            }
            onAnswerTask={handleAnswerTask}
            onChangePromoteCategory={(taskId, category) =>
              setPromoteCategories((prev) => ({ ...prev, [taskId]: category }))
            }
            onPromoteTask={handlePromoteTask}
          />

          <AreaKnowledgePanel
            areaKnowledge={areaKnowledge}
            knowledgeLoading={knowledgeLoading}
            includedCount={akContext.includedCount}
            estimatedTokens={akContext.estimatedTokens}
            injectedRankById={injectedRankById}
            factInput={factInput}
            factCategory={factCategory}
            isAddingFact={isAddingFact}
            factBusy={factBusy}
            online={diagnostics.online}
            areaCategories={AREA_CATEGORIES}
            onChangeFactInput={setFactInput}
            onChangeFactCategory={setFactCategory}
            onAddDirectFact={handleAddDirectFact}
            onToggleFactActive={handleToggleFactActive}
          />
        </div>

        <div className="lg:col-span-6">
          <AuditTimelinePanel
            filteredEvents={filteredEvents}
            auditFilter={auditFilter}
            onChangeFilter={setAuditFilter}
          />
        </div>
      </div>

      <HybridBenchmarkPanel onLogSessionEvent={onLogSessionEvent} />
    </section>
  );
}
