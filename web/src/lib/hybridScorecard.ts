import type {
  DispatchDoc,
  IntakeDoc,
  SessionAuditEvent,
  VerificationTaskDoc,
} from "../types/sigapwire.ts";

export interface HybridScorecard {
  onDeviceExecutions: number;
  inCloudExecutions: number;
  onDeviceSharePct: number;
  totalPiiBlockedLocally: number;
  cloudCallsAvoided: number;
  humanGateActions: number;
  lastHandoffLabel: string;
}

function buildLastHandoffLabel(params: {
  intakes: IntakeDoc[];
  verificationTasks: VerificationTaskDoc[];
  dispatches: DispatchDoc[];
  sessionEvents: SessionAuditEvent[];
}): string {
  const candidates: Array<{ ts: number; label: string }> = [];

  for (const s of params.sessionEvents) {
    candidates.push({
      ts: s.timestamp.getTime(),
      label: `${s.category}: ${s.title}`,
    });
  }

  for (const intake of params.intakes) {
    const piiPart = intake.piiRedactedLocally ? "Privacy: ON_DEVICE -> " : "";
    const groundPart =
      intake.mode === "RUMOR_CHECK" &&
      (intake.status === "VERIFIED" ||
        intake.structured.groundingSources.length > 0)
        ? " -> Grounding: IN_CLOUD"
        : "";
    candidates.push({
      ts: intake.createdAt.getTime(),
      label: `${piiPart}Triage: ${intake.inferenceSource}${groundPart} (${intake.sourcePlatform})`,
    });
  }

  for (const task of params.verificationTasks) {
    const ts = (task.answeredAt ?? task.updatedAt ?? task.createdAt).getTime();
    const stateLabel =
      task.status === "PROMOTED"
        ? `Field Check Promoted (${task.location})`
        : task.status === "ANSWERED"
          ? `Field Answer Scrubbed (${task.answerPlatform ?? "WEB"})`
          : `Field Check Open (${task.location})`;
    candidates.push({
      ts,
      label: `HUMAN_GATE: ${stateLabel}`,
    });
  }

  for (const d of params.dispatches) {
    candidates.push({
      ts: d.publishedAt.getTime(),
      label: `Broadcast #${d.dispatchNumber}: ${d.inferenceSource} -> Public Wire`,
    });
  }

  if (candidates.length === 0) {
    return "Awaiting first intake or broadcast";
  }

  candidates.sort((a, b) => b.ts - a.ts);
  return candidates[0].label;
}

/**
 * Computes hybrid routing, local PII blocking, and human-gate telemetry strictly
 * from synced Firestore documents and live browser session events (zero fabrication).
 */
export function computeHybridScorecard(params: {
  intakes: IntakeDoc[];
  verificationTasks: VerificationTaskDoc[];
  dispatches: DispatchDoc[];
  sessionEvents: SessionAuditEvent[];
}): HybridScorecard {
  const piiFirewallPasses = params.intakes.filter(
    (i) => i.piiRedactedLocally,
  ).length;
  const onDeviceTriages = params.intakes.filter(
    (i) => i.inferenceSource === "ON_DEVICE",
  ).length;
  const inCloudTriages = params.intakes.filter(
    (i) => i.inferenceSource === "IN_CLOUD",
  ).length;
  const groundedRumors = params.intakes.filter(
    (i) =>
      i.mode === "RUMOR_CHECK" &&
      (i.status === "VERIFIED" || i.structured.groundingSources.length > 0),
  ).length;
  const offlineQueuedCount = params.intakes.filter((i) =>
    Boolean(i.pendingSync),
  ).length;

  const taskAnswerScrubs = params.verificationTasks.filter(
    (t) => t.answerPiiRedactedLocally,
  ).length;

  const sessionOnDevice = params.sessionEvents.filter(
    (e) => e.category === "ON_DEVICE",
  ).length;
  const sessionInCloud = params.sessionEvents.filter(
    (e) => e.category === "IN_CLOUD",
  ).length;
  const sessionHumanGate = params.sessionEvents.filter(
    (e) => e.category === "HUMAN_GATE",
  ).length;

  const onDeviceExecutions =
    piiFirewallPasses + onDeviceTriages + taskAnswerScrubs + sessionOnDevice;
  const inCloudExecutions =
    inCloudTriages + groundedRumors + params.dispatches.length + sessionInCloud;

  const totalExecutions = onDeviceExecutions + inCloudExecutions;
  const onDeviceSharePct =
    totalExecutions > 0
      ? Math.round((onDeviceExecutions / totalExecutions) * 100)
      : 0;

  const totalPiiBlockedLocally =
    params.intakes.reduce((sum, i) => sum + Math.max(0, i.redactionCount), 0) +
    params.verificationTasks.reduce(
      (sum, t) => sum + Math.max(0, t.answerRedactionCount),
      0,
    );

  const cloudCallsAvoided =
    piiFirewallPasses +
    taskAnswerScrubs +
    onDeviceTriages +
    offlineQueuedCount +
    sessionOnDevice;

  const taskLifecycleActions = params.verificationTasks.reduce((sum, t) => {
    let steps = 1; // requested
    if (t.status === "ANSWERED" || t.status === "PROMOTED") steps += 1;
    if (t.status === "PROMOTED") steps += 1;
    return sum + steps;
  }, 0);

  const humanGateActions = taskLifecycleActions + sessionHumanGate;

  return {
    onDeviceExecutions,
    inCloudExecutions,
    onDeviceSharePct,
    totalPiiBlockedLocally,
    cloudCallsAvoided,
    humanGateActions,
    lastHandoffLabel: buildLastHandoffLabel(params),
  };
}
