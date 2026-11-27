import type { FormEvent } from "react";
import type {
  AreaKnowledgeCategory,
  VerificationTaskDoc,
} from "../types/sigapwire";
import { PlatformBadge } from "./StatusBadges";
import { CardListSkeleton } from "./ui";

interface FieldVerificationPanelProps {
  verificationTasks: VerificationTaskDoc[];
  tasksLoading: boolean;
  online: boolean;
  questionInput: string;
  locationInput: string;
  isCreatingTask: boolean;
  replyDrafts: Record<string, string>;
  promoteCategories: Record<string, AreaKnowledgeCategory>;
  taskBusy: Record<string, boolean>;
  areaCategories: Array<{ value: AreaKnowledgeCategory; label: string }>;
  onChangeQuestion: (value: string) => void;
  onChangeLocation: (value: string) => void;
  onCreateTask: (e: FormEvent) => void;
  onChangeReplyDraft: (taskId: string, value: string) => void;
  onAnswerTask: (task: VerificationTaskDoc) => void;
  onChangePromoteCategory: (
    taskId: string,
    category: AreaKnowledgeCategory,
  ) => void;
  onPromoteTask: (task: VerificationTaskDoc) => void;
}

export function FieldVerificationPanel({
  verificationTasks,
  tasksLoading,
  online,
  questionInput,
  locationInput,
  isCreatingTask,
  replyDrafts,
  promoteCategories,
  taskBusy,
  areaCategories,
  onChangeQuestion,
  onChangeLocation,
  onCreateTask,
  onChangeReplyDraft,
  onAnswerTask,
  onChangePromoteCategory,
  onPromoteTask,
}: FieldVerificationPanelProps) {
  const openCount = verificationTasks.filter((t) => t.status === "OPEN").length;

  return (
    <div className="sw-card p-5 space-y-4">
      <div
        className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      >
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
          {openCount} open
        </span>
      </div>

      <form onSubmit={onCreateTask} className="space-y-3">
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
            onChange={(e) => onChangeQuestion(e.target.value)}
            placeholder="e.g. Confirm safe tonnage limit for northern ring bridge in Cugenang"
            className="sw-input w-full min-h-[44px] px-3 text-sm"
          />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end gap-2">
          <div className="flex-1">
            <label
              htmlFor="field-check-location"
              className="block text-xs font-semibold mb-1"
            >
              Sector / Location (optional)
            </label>
            <input
              id="field-check-location"
              type="text"
              value={locationInput}
              onChange={(e) => onChangeLocation(e.target.value)}
              placeholder="e.g. Cugenang Sector North"
              className="sw-input w-full min-h-[44px] px-3 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={isCreatingTask || !questionInput.trim() || !online}
            className="sw-btn-primary min-h-[44px] shrink-0 px-4 text-xs font-semibold"
          >
            {isCreatingTask ? "Dispatching..." : "Dispatch to Field"}
          </button>
        </div>
      </form>

      {tasksLoading ? (
        <CardListSkeleton label="Loading field verification tasks" rows={2} />
      ) : verificationTasks.length === 0 ? (
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
              <li key={task.id} className="sw-card-ground p-3.5 space-y-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className="font-mono-telemetry rounded px-2 py-0.5 text-xs font-semibold border"
                      style={statusStyle}
                    >
                      {task.status}
                    </span>
                    <PlatformBadge platform={task.requestedPlatform} />
                    <span
                      className="font-mono-telemetry text-xs"
                      style={{ color: "var(--ink-muted)" }}
                    >
                      {task.location}
                    </span>
                  </div>
                  <span
                    className="font-mono-telemetry text-xs"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    {task.createdAt.toLocaleTimeString()}
                  </span>
                </div>

                <p className="text-sm font-semibold">{task.question}</p>

                {task.status === "OPEN" ? (
                  <div className="space-y-1.5 pt-1">
                    <label
                      htmlFor={`field-reply-${task.id}`}
                      className="block text-xs font-semibold"
                      style={{ color: "var(--ink-muted)" }}
                    >
                      Responder Reply (PII scrubbed locally before upload)
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        id={`field-reply-${task.id}`}
                        type="text"
                        value={replyDrafts[task.id] ?? ""}
                        onChange={(e) =>
                          onChangeReplyDraft(task.id, e.target.value)
                        }
                        placeholder="Enter verified field observation..."
                        className="sw-input flex-1 min-h-[44px] px-3 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => onAnswerTask(task)}
                        disabled={busy || !(replyDrafts[task.id] ?? "").trim()}
                        className="sw-btn-ondevice min-h-[44px] shrink-0 px-3 text-xs font-semibold"
                      >
                        {busy
                          ? "Scrubbing & Sending..."
                          : "Scrub PII & Send Answer"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="sw-card p-2.5 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {task.answerPlatform ? (
                        <PlatformBadge platform={task.answerPlatform} />
                      ) : null}
                      <span
                        className="font-mono-telemetry text-xs"
                        style={{ color: "var(--ink-muted)" }}
                      >
                        {task.answerRedactionCount} PII item(s) scrubbed locally
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed">{task.answerText}</p>

                    {task.status === "ANSWERED" ? (
                      <div className="flex flex-wrap items-end gap-2 pt-1">
                        <div>
                          <label
                            htmlFor={`promote-category-${task.id}`}
                            className="block text-xs font-semibold mb-1"
                            style={{ color: "var(--ink-muted)" }}
                          >
                            Knowledge Category
                          </label>
                          <select
                            id={`promote-category-${task.id}`}
                            value={
                              promoteCategories[task.id] ?? "SAFETY_CONSTRAINT"
                            }
                            onChange={(e) =>
                              onChangePromoteCategory(
                                task.id,
                                e.target.value as AreaKnowledgeCategory,
                              )
                            }
                            className="sw-input min-h-[44px] px-2.5 text-xs"
                          >
                            {areaCategories.map((cat) => (
                              <option key={cat.value} value={cat.value}>
                                {cat.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <button
                          type="button"
                          onClick={() => onPromoteTask(task)}
                          disabled={busy}
                          className="sw-btn-primary min-h-[44px] px-3.5 text-xs font-semibold"
                        >
                          {busy ? "Promoting..." : "Promote to Area Knowledge"}
                        </button>
                      </div>
                    ) : (
                      <div
                        className="font-mono-telemetry text-xs font-semibold"
                        style={{ color: "var(--state-ondevice-ink)" }}
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
  );
}
