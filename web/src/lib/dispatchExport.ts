import type { SafetyGateReceipt } from "./broadcastSafetyGate.ts";
import type {
  CommunityAlertPayload,
  DebunkCardPayload,
  GlobalSitrepPayload,
  InferenceSourceLabel,
  MediaPressReleasePayload,
  SeverityLevel,
} from "../types/sigapwire.ts";

export interface DispatchExportPayload {
  dispatchNumber: number;
  severity: SeverityLevel;
  inferenceSource: InferenceSourceLabel;
  incidentTitle?: string;
  region?: string;
  publishedAt?: Date;
  modelUsed?: string;
  communityAlertId: CommunityAlertPayload;
  mediaPressReleaseId: MediaPressReleasePayload;
  globalSitrepEn: GlobalSitrepPayload;
  debunkCard: DebunkCardPayload;
  safetyGate?: SafetyGateReceipt;
}

function bulletList(items: string[], fallback = "None recorded"): string {
  if (items.length === 0) {
    return `- ${fallback}`;
  }
  return items.map((item) => `- ${item}`).join("\n");
}

/**
 * Formats a multi-audience SigapWire dispatch or draft into a clean Markdown SitRep
 * for archival, press distribution, or humanitarian coordination handoff.
 */
export function formatDispatchMarkdown(payload: DispatchExportPayload): string {
  const lines: string[] = [
    `# SigapWire Dispatch #${payload.dispatchNumber}`,
    "",
  ];

  if (payload.incidentTitle) {
    lines.push(`- **Incident:** ${payload.incidentTitle}`);
  }
  if (payload.region) {
    lines.push(`- **Region:** ${payload.region}`);
  }
  lines.push(`- **Severity:** ${payload.severity}`);
  lines.push(`- **Inference Route:** ${payload.inferenceSource}`);
  if (payload.modelUsed) {
    lines.push(`- **Cloud Model:** ${payload.modelUsed}`);
  }
  if (payload.publishedAt) {
    lines.push(`- **Published At:** ${payload.publishedAt.toISOString()}`);
  }

  lines.push(
    "",
    "---",
    "",
    "## 1. Community Action Alert (Bahasa Indonesia)",
    "",
    `### ${payload.communityAlertId.title}`,
    "",
    payload.communityAlertId.whatHappened,
    "",
    "**Lakukan Sekarang (Do Now)**",
    bulletList(payload.communityAlertId.doNow),
    "",
    "**Hindari (Avoid)**",
    bulletList(payload.communityAlertId.avoid),
    "",
    "**WhatsApp / SMS Broadcast Copy**",
    "",
    "```text",
    payload.communityAlertId.whatsappShortText,
    "```",
    "",
    "## 2. National Media Press Release (Bahasa Indonesia)",
    "",
    `### ${payload.mediaPressReleaseId.headline}`,
    "",
    `_${payload.mediaPressReleaseId.dateline}_`,
    "",
    payload.mediaPressReleaseId.body,
    "",
    "**Key Metrics**",
    bulletList(payload.mediaPressReleaseId.keyMetrics),
    "",
    "## 3. Global Humanitarian Situation Report (English)",
    "",
    `### ${payload.globalSitrepEn.headline}`,
    "",
    payload.globalSitrepEn.executiveSummary,
    "",
    "**Impact Overview**",
    bulletList(payload.globalSitrepEn.impactOverview),
    "",
    "**Priority Needs**",
    bulletList(payload.globalSitrepEn.priorityNeeds),
    "",
    "**Information Gaps**",
    bulletList(payload.globalSitrepEn.informationGaps),
  );

  if (payload.debunkCard.hasRumorAlert) {
    lines.push(
      "",
      `## 4. Fact-Check & Debunk Card (${payload.debunkCard.verdict})`,
      "",
      `- **Claim:** ${payload.debunkCard.claim}`,
      `- **Verified Fact (ID):** ${payload.debunkCard.factId}`,
      `- **Verified Fact (EN):** ${payload.debunkCard.factEn}`,
    );

    if (payload.debunkCard.sources.length > 0) {
      lines.push(
        "",
        "**Grounding Sources**",
        ...payload.debunkCard.sources.map((src) => `- [${src.title}](${src.uri})`),
      );
    }
  }

  if (payload.safetyGate) {
    const akLine =
      typeof payload.safetyGate.activeAreaKnowledgeCount === "number"
        ? `- **Verified Area Knowledge Injected:** ${payload.safetyGate.activeAreaKnowledgeCount} active fact(s)`
        : null;
    lines.push(
      "",
      "## 5. Pre-Publish Safety Gate Verification",
      "",
      `- **Evaluated At:** ${payload.safetyGate.evaluatedAtIso}`,
      `- **Drill Fault Injection Used:** ${payload.safetyGate.simulatedFaultUsed ? "Yes (Synthetic Drill)" : "No"}`,
      `- **Commander Release Sign-Off:** ${payload.safetyGate.commanderSignedOff ? "Confirmed" : "Not Required / Pending"}`,
      `- **Deterministic Repairs Applied:** ${payload.safetyGate.repairsApplied.length > 0 ? payload.safetyGate.repairsApplied.join("; ") : "None"}`,
      ...(akLine ? [akLine] : []),
      "",
      "**Rule Results**",
      ...payload.safetyGate.checks.map(
        (check) => `- [${check.status}] ${check.label}: ${check.summary}`,
      ),
    );
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Triggers a browser download of a UTF-8 text or Markdown file.
 */
export function downloadTextFile(
  filename: string,
  content: string,
  mimeType = "text/markdown;charset=utf-8",
): void {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

/**
 * Triggers a browser download of the dispatch as a UTF-8 `.md` file.
 */
export function downloadDispatchMarkdown(
  filename: string,
  payload: DispatchExportPayload,
): void {
  downloadTextFile(filename, formatDispatchMarkdown(payload));
}
