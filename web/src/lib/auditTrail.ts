import type {
  AreaKnowledgeDoc,
  DispatchDoc,
  IntakeDoc,
  SessionAuditEvent,
  SourcePlatform,
  VerificationTaskDoc,
} from "../types/sigapwire.ts";

export type AuditCategory = "ON_DEVICE" | "IN_CLOUD" | "HUMAN_GATE";

export interface AuditEvent {
  id: string;
  timestamp: Date;
  category: AuditCategory;
  eventType: string;
  platform: SourcePlatform | "WEB" | "SYSTEM";
  title: string;
  detail: string;
  refId?: string;
}

/**
 * Deterministically derives a chronological Hybrid Decision Audit Trail from synced
 * Firestore operational records merged with local browser governance session events.
 */
export function buildUnifiedAuditTrail(params: {
  intakes: IntakeDoc[];
  verificationTasks: VerificationTaskDoc[];
  areaKnowledge: AreaKnowledgeDoc[];
  dispatches: DispatchDoc[];
  sessionEvents: SessionAuditEvent[];
}): AuditEvent[] {
  const events: AuditEvent[] = [];

  for (const intake of params.intakes) {
    if (intake.piiRedactedLocally) {
      events.push({
        id: `pii-${intake.id}`,
        timestamp: intake.createdAt,
        category: "ON_DEVICE",
        eventType: "PII_SCRUBBED_LOCAL",
        platform: intake.sourcePlatform,
        title:
          intake.redactionCount > 0
            ? `PII Scrubbed Locally (${intake.redactionCount} items masked)`
            : "Local Privacy Firewall Checked (0 PII found)",
        detail: `${intake.mode} on ${intake.sourcePlatform}: "${intake.structured.headline}" kept sensitive personal details off-cloud.`,
        refId: intake.id,
      });
    }

    if (intake.pendingSync) {
      events.push({
        id: `offline-${intake.id}`,
        timestamp: intake.createdAt,
        category: "ON_DEVICE",
        eventType: "OFFLINE_QUEUED",
        platform: intake.sourcePlatform,
        title: "Offline Intake Queued in Local Cache",
        detail: `Captured while offline ("${intake.structured.headline}"); pending Firestore sync when connectivity returns.`,
        refId: intake.id,
      });
    }

    events.push({
      id: `triage-${intake.id}`,
      timestamp: intake.createdAt,
      category: intake.inferenceSource === "ON_DEVICE" ? "ON_DEVICE" : "IN_CLOUD",
      eventType: "TRIAGE_ROUTED",
      platform: intake.sourcePlatform,
      title: `Structured Triage (${intake.inferenceSource}, ${intake.latencyMs}ms)`,
      detail: `Requested=${intake.inferenceModeRequested}, severity=${intake.structured.severity}, location=${intake.structured.location}, gaps=${intake.structured.verificationGaps.length}.`,
      refId: intake.id,
    });

    if (
      intake.mode === "RUMOR_CHECK" &&
      (intake.status === "VERIFIED" || intake.structured.groundingSources.length > 0)
    ) {
      events.push({
        id: `rumor-${intake.id}`,
        timestamp: intake.createdAt,
        category: "IN_CLOUD",
        eventType: "RUMOR_GROUNDED",
        platform: intake.sourcePlatform,
        title: `Grounded Rumor Check (${intake.structured.rumorVerdict})`,
        detail: `Verified via Google Search Grounding (${intake.structured.groundingSources.length} source citations).`,
        refId: intake.id,
      });
    }
  }

  for (const task of params.verificationTasks) {
    events.push({
      id: `task-req-${task.id}`,
      timestamp: task.createdAt,
      category: "HUMAN_GATE",
      eventType: "FIELD_TASK_REQUESTED",
      platform: task.requestedPlatform,
      title: `Field Check Dispatched (${task.location})`,
      detail: task.question,
      refId: task.id,
    });

    if (
      (task.status === "ANSWERED" || task.status === "PROMOTED") &&
      task.answeredAt
    ) {
      events.push({
        id: `task-ans-${task.id}`,
        timestamp: task.answeredAt,
        category: "HUMAN_GATE",
        eventType: "FIELD_TASK_ANSWERED",
        platform: task.answerPlatform ?? "WEB",
        title: `Field Answer Synced (${task.answerRedactionCount} PII scrubbed locally)`,
        detail: task.answerText ?? "Verified observation recorded.",
        refId: task.id,
      });
    }
  }

  for (const fact of params.areaKnowledge) {
    events.push({
      id: `ak-${fact.id}`,
      timestamp: fact.createdAt,
      category: "HUMAN_GATE",
      eventType: "AREA_KNOWLEDGE_RECORDED",
      platform: "WEB",
      title: `Area Knowledge Recorded (${fact.category}, ${fact.sourceType})`,
      detail: `${fact.fact} [${fact.active ? "ACTIVE IN PROMPTS" : "PAUSED"}]`,
      refId: fact.id,
    });
  }

  for (const dispatch of params.dispatches) {
    events.push({
      id: `dispatch-${dispatch.id}`,
      timestamp: dispatch.publishedAt,
      category: "IN_CLOUD",
      eventType: "DISPATCH_PUBLISHED",
      platform: "WEB",
      title: `Dispatch #${dispatch.dispatchNumber} Published (${dispatch.severity})`,
      detail: `Merged ${dispatch.sourceIntakeIds.length} synced intake(s) across 4 audiences: "${dispatch.globalSitrepEn.headline}".`,
      refId: dispatch.id,
    });
  }

  for (const s of params.sessionEvents) {
    events.push({
      id: `session-${s.id}`,
      timestamp: s.timestamp,
      category: s.category,
      eventType: s.eventType,
      platform: "WEB",
      title: s.title,
      detail: s.detail,
    });
  }

  return events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

/**
 * Formats a clean Markdown compliance & post-incident audit dossier with zero em dashes.
 */
export function formatIncidentAuditMarkdown(params: {
  incidentTitle: string;
  region: string;
  intakes: IntakeDoc[];
  verificationTasks: VerificationTaskDoc[];
  areaKnowledge: AreaKnowledgeDoc[];
  dispatches: DispatchDoc[];
  events: AuditEvent[];
}): string {
  const onDeviceCount = params.intakes.filter(
    (i) => i.inferenceSource === "ON_DEVICE",
  ).length;
  const inCloudCount = params.intakes.filter(
    (i) => i.inferenceSource === "IN_CLOUD",
  ).length;
  const totalRedactions =
    params.intakes.reduce((sum, i) => sum + i.redactionCount, 0) +
    params.verificationTasks.reduce((sum, t) => sum + t.answerRedactionCount, 0);

  const lines: string[] = [
    `# SigapWire Incident Audit Dossier: ${params.incidentTitle}`,
    "",
    `- **Region:** ${params.region}`,
    `- **Generated At:** ${new Date().toISOString()}`,
    `- **Synced Intakes:** ${params.intakes.length} (ON_DEVICE: ${onDeviceCount}, IN_CLOUD: ${inCloudCount})`,
    `- **Total PII Items Scrubbed Locally:** ${totalRedactions}`,
    `- **Field Verification Tasks:** ${params.verificationTasks.length}`,
    `- **Verified Area Knowledge Facts:** ${params.areaKnowledge.filter((f) => f.active).length} active / ${params.areaKnowledge.length} total`,
    `- **Published Broadcast Dispatches:** ${params.dispatches.length}`,
    "",
    "---",
    "",
    "## 1. Verified Area Knowledge (Human-Authored Ground Truth)",
    "",
  ];

  if (params.areaKnowledge.length === 0) {
    lines.push("- No human-authored area knowledge facts recorded yet.");
  } else {
    params.areaKnowledge.forEach((fact, idx) => {
      lines.push(
        `- **[AK-${idx + 1}]** (${fact.category} | ${fact.sourceType} | ${fact.active ? "ACTIVE" : "PAUSED"}): ${fact.fact}`,
      );
    });
  }

  lines.push("", "## 2. Two-Way Field Verification Loop", "");
  if (params.verificationTasks.length === 0) {
    lines.push("- No field verification tasks dispatched yet.");
  } else {
    for (const task of params.verificationTasks) {
      const answerPart = task.answerText
        ? ` | Answer (${task.answerPlatform ?? "WEB"}, ${task.answerRedactionCount} PII scrubbed): ${task.answerText}`
        : "";
      lines.push(
        `- **[${task.status}]** (${task.location}, requested on ${task.requestedPlatform}): ${task.question}${answerPart}`,
      );
    }
  }

  lines.push("", "## 3. Chronological Hybrid Decision Audit Trail", "");
  if (params.events.length === 0) {
    lines.push("- No decision trace events recorded yet.");
  } else {
    for (const ev of params.events) {
      lines.push(
        `- **${ev.timestamp.toISOString()}** | \`${ev.category}\` | \`${ev.platform}\` | **${ev.eventType}**: ${ev.title} (${ev.detail})`,
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}
