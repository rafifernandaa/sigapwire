import {
  deterministicLocalPiiScrub,
  type PiiCounters,
} from "./piiScrubber.ts";
import type {
  CommunityAlertPayload,
  DebunkCardPayload,
  GlobalSitrepPayload,
  IntakeDoc,
  MediaPressReleasePayload,
  SeverityLevel,
} from "../types/sigapwire.ts";

export type SafetyGateCheckId =
  | "ZERO_PII_LEAK"
  | "RUMOR_SAFETY_GUARD"
  | "PEAK_SEVERITY_INVARIANT"
  | "GAP_DISCLOSURE_CHECK";

export type SafetyGateStatus = "PASS" | "WARN" | "BLOCK";

export type SafetyGateChannel =
  | "communityAlertId"
  | "mediaPressReleaseId"
  | "globalSitrepEn"
  | "debunkCard"
  | "severity";

export interface SafetyGateFinding {
  channel: SafetyGateChannel;
  field: string;
  excerpt: string;
}

export interface SafetyGateCheckResult {
  id: SafetyGateCheckId;
  label: string;
  status: SafetyGateStatus;
  summary: string;
  findings: SafetyGateFinding[];
  repairActionLabel?: string;
}

export interface BroadcastDraftPayload {
  severity: SeverityLevel;
  communityAlertId: CommunityAlertPayload;
  mediaPressReleaseId: MediaPressReleasePayload;
  globalSitrepEn: GlobalSitrepPayload;
  debunkCard: DebunkCardPayload;
}

export interface SafetyGateEvaluation {
  checks: SafetyGateCheckResult[];
  blockCount: number;
  warnCount: number;
  passCount: number;
  peakIntakeSeverity: SeverityLevel | null;
  missingGaps: string[];
  offlineDraftIntakeCount: number;
  evaluatedAtIso: string;
}

export interface SafetyGateReceipt {
  evaluatedAtIso: string;
  simulatedFaultUsed: boolean;
  repairsApplied: string[];
  commanderSignedOff: boolean;
  checks: Array<{
    id: SafetyGateCheckId;
    label: string;
    status: SafetyGateStatus;
    summary: string;
  }>;
}

const SEVERITY_RANK: Record<SeverityLevel, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

const ALL_CLEAR_PATTERN =
  /\b(?:sudah\s+(?:100%\s+)?aman|dipastikan\s+aman|100%\s*aman|aman\s+terkendali|kondisi\s+(?:sudah\s+)?aman|pasti\s+hoax|pasti\s+hoaks|hoaks\s+belaka|hoax\s+belaka|confirmed\s+safe|100%\s*safe|completely\s+safe|all\s+clear|false\s+alarm)\b/gi;

const NEGATION_PREFIX_PATTERN =
  /\b(?:tidak|belum|bukan|not|no|unconfirmed|unverified|belum\s+tentu|belum\s+bisa|belum\s+dapat|tidak\s+dapat|tidak\s+bisa|jangan\s+menganggap)\s+$/i;

function findUnhedgedAllClearMatches(text: string): string[] {
  const matches: string[] = [];
  ALL_CLEAR_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ALL_CLEAR_PATTERN.exec(text)) !== null) {
    const startIdx = m.index;
    const prefixStart = Math.max(0, startIdx - 32);
    const preceding = text.slice(prefixStart, startIdx);
    if (NEGATION_PREFIX_PATTERN.test(preceding)) {
      continue;
    }
    matches.push(m[0]);
  }
  return matches;
}

function collectTextEntries(
  draft: BroadcastDraftPayload,
): Array<{ channel: SafetyGateChannel; field: string; text: string }> {
  const entries: Array<{
    channel: SafetyGateChannel;
    field: string;
    text: string;
  }> = [];

  const pushString = (
    channel: SafetyGateChannel,
    field: string,
    val: string,
  ) => {
    if (val) entries.push({ channel, field, text: val });
  };

  const pushList = (
    channel: SafetyGateChannel,
    field: string,
    list: string[],
  ) => {
    list.forEach((item, idx) => {
      if (item) entries.push({ channel, field: `${field}[${idx}]`, text: item });
    });
  };

  pushString("communityAlertId", "title", draft.communityAlertId.title);
  pushString(
    "communityAlertId",
    "whatHappened",
    draft.communityAlertId.whatHappened,
  );
  pushList("communityAlertId", "doNow", draft.communityAlertId.doNow);
  pushList("communityAlertId", "avoid", draft.communityAlertId.avoid);
  pushString(
    "communityAlertId",
    "whatsappShortText",
    draft.communityAlertId.whatsappShortText,
  );

  pushString("mediaPressReleaseId", "headline", draft.mediaPressReleaseId.headline);
  pushString("mediaPressReleaseId", "dateline", draft.mediaPressReleaseId.dateline);
  pushString("mediaPressReleaseId", "body", draft.mediaPressReleaseId.body);
  pushList("mediaPressReleaseId", "keyMetrics", draft.mediaPressReleaseId.keyMetrics);

  pushString("globalSitrepEn", "headline", draft.globalSitrepEn.headline);
  pushString(
    "globalSitrepEn",
    "executiveSummary",
    draft.globalSitrepEn.executiveSummary,
  );
  pushList("globalSitrepEn", "impactOverview", draft.globalSitrepEn.impactOverview);
  pushList("globalSitrepEn", "priorityNeeds", draft.globalSitrepEn.priorityNeeds);
  pushList("globalSitrepEn", "informationGaps", draft.globalSitrepEn.informationGaps);

  pushString("debunkCard", "claim", draft.debunkCard.claim);
  pushString("debunkCard", "factId", draft.debunkCard.factId);
  pushString("debunkCard", "factEn", draft.debunkCard.factEn);

  return entries;
}

function mapDraftTextFields<T extends BroadcastDraftPayload>(
  draft: T,
  transformString: (
    value: string,
    meta: { requiredFallback?: string },
  ) => string,
  transformArrayItem: (value: string) => string | null,
): T {
  const idGuard =
    "Status masih dalam verifikasi resmi; ikuti arahan petugas posko.";
  const idHeadlineGuard = "Pembaruan Darurat SigapWire (Verifikasi Berjalan)";
  const enGuard =
    "Verification remains ongoing; no official all-clear has been confirmed yet.";
  const enHeadlineGuard = "Developing Crisis Bulletin (Verification Ongoing)";

  const mapArray = (arr: string[]) =>
    arr
      .map((item) => transformArrayItem(item))
      .filter((item): item is string => Boolean(item && item.trim()));

  return {
    ...draft,
    communityAlertId: {
      title: transformString(draft.communityAlertId.title, {
        requiredFallback: idHeadlineGuard,
      }),
      whatHappened: transformString(draft.communityAlertId.whatHappened, {
        requiredFallback: idGuard,
      }),
      doNow: mapArray(draft.communityAlertId.doNow),
      avoid: mapArray(draft.communityAlertId.avoid),
      whatsappShortText: transformString(
        draft.communityAlertId.whatsappShortText,
        { requiredFallback: idGuard },
      ),
    },
    mediaPressReleaseId: {
      headline: transformString(draft.mediaPressReleaseId.headline, {
        requiredFallback: idHeadlineGuard,
      }),
      dateline: transformString(draft.mediaPressReleaseId.dateline, {
        requiredFallback: "INDONESIA",
      }),
      body: transformString(draft.mediaPressReleaseId.body, {
        requiredFallback: idGuard,
      }),
      keyMetrics: mapArray(draft.mediaPressReleaseId.keyMetrics),
    },
    globalSitrepEn: {
      headline: transformString(draft.globalSitrepEn.headline, {
        requiredFallback: enHeadlineGuard,
      }),
      executiveSummary: transformString(
        draft.globalSitrepEn.executiveSummary,
        { requiredFallback: enGuard },
      ),
      impactOverview: mapArray(draft.globalSitrepEn.impactOverview),
      priorityNeeds: mapArray(draft.globalSitrepEn.priorityNeeds),
      informationGaps: mapArray(draft.globalSitrepEn.informationGaps),
    },
    debunkCard: {
      ...draft.debunkCard,
      claim: transformString(draft.debunkCard.claim, {
        requiredFallback: draft.debunkCard.hasRumorAlert
          ? "Unverified disaster claim under review."
          : "",
      }),
      factId: transformString(draft.debunkCard.factId, {
        requiredFallback: draft.debunkCard.hasRumorAlert ? idGuard : "",
      }),
      factEn: transformString(draft.debunkCard.factEn, {
        requiredFallback: draft.debunkCard.hasRumorAlert ? enGuard : "",
      }),
    },
  };
}

function extractMeaningfulWords(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
  return Array.from(new Set(matches));
}

function isGapCovered(
  sourceGap: string,
  publishedGaps: string[],
): boolean {
  const normSource = sourceGap.trim().toLowerCase();
  const sourceWords = extractMeaningfulWords(sourceGap);
  const threshold = sourceWords.length <= 1 ? sourceWords.length : 2;

  for (const pub of publishedGaps) {
    const normPub = pub.trim().toLowerCase();
    if (!normPub) continue;
    if (normPub.includes(normSource)) return true;
    if (sourceWords.length === 0) continue;
    const pubWords = new Set(extractMeaningfulWords(pub));
    let overlap = 0;
    for (const w of sourceWords) {
      if (pubWords.has(w)) overlap += 1;
    }
    if (overlap >= threshold) return true;
  }
  return false;
}

export function evaluateBroadcastSafetyGate(
  draft: BroadcastDraftPayload,
  sourceIntakes: IntakeDoc[],
): SafetyGateEvaluation {
  const entries = collectTextEntries(draft);

  // Rule 1: ZERO_PII_LEAK
  const piiFindings: SafetyGateFinding[] = [];
  for (const entry of entries) {
    const { redactions } = deterministicLocalPiiScrub(entry.text);
    if (redactions.length > 0) {
      piiFindings.push({
        channel: entry.channel,
        field: entry.field,
        excerpt: `${redactions.length} match(es): ${redactions.map((r) => r.placeholder).join(", ")}`,
      });
    }
  }
  const piiCheck: SafetyGateCheckResult = {
    id: "ZERO_PII_LEAK",
    label: "Zero-PII Leak Guard",
    status: piiFindings.length > 0 ? "BLOCK" : "PASS",
    summary:
      piiFindings.length > 0
        ? `Detected personal identifiers across ${piiFindings.length} field(s). Publishing blocked until scrubbed.`
        : "Zero phone numbers, @handles, honorific names, or house addresses across all 4 channels.",
    findings: piiFindings,
    repairActionLabel: piiFindings.length > 0 ? "Auto-Scrub PII" : undefined,
  };

  // Rule 2: RUMOR_SAFETY_GUARD
  const rumorFindings: SafetyGateFinding[] = [];
  if (
    draft.debunkCard.hasRumorAlert &&
    (draft.debunkCard.verdict === "VERIFIED" ||
      draft.debunkCard.verdict === "MISLEADING") &&
    draft.debunkCard.sources.length === 0
  ) {
    rumorFindings.push({
      channel: "debunkCard",
      field: "verdict",
      excerpt: `Verdict ${draft.debunkCard.verdict} requires >= 1 grounding source (currently 0).`,
    });
  }

  const hasUnverifiedRumor =
    sourceIntakes.some(
      (i) =>
        i.mode === "RUMOR_CHECK" &&
        (i.structured.rumorVerdict === "UNVERIFIED_DEVELOPING" ||
          i.structured.groundingSources.length === 0),
    ) ||
    (draft.debunkCard.hasRumorAlert &&
      (draft.debunkCard.verdict === "UNVERIFIED_DEVELOPING" ||
        draft.debunkCard.sources.length === 0));

  if (hasUnverifiedRumor) {
    for (const entry of entries) {
      const hits = findUnhedgedAllClearMatches(entry.text);
      if (hits.length > 0) {
        rumorFindings.push({
          channel: entry.channel,
          field: entry.field,
          excerpt: `Unhedged all-clear claim ("${hits.join('", "')}") while rumor status is unverified.`,
        });
      }
    }
  }

  const rumorCheck: SafetyGateCheckResult = {
    id: "RUMOR_SAFETY_GUARD",
    label: "Rumor Safety Guard",
    status: rumorFindings.length > 0 ? "BLOCK" : "PASS",
    summary:
      rumorFindings.length > 0
        ? "Blocked unverified all-clear claim or zero-source rumor verdict."
        : "No unsupported all-clear assurances or zero-source verdicts detected.",
    findings: rumorFindings,
    repairActionLabel:
      rumorFindings.length > 0 ? "Enforce Safe Guardrails" : undefined,
  };

  // Rule 3: PEAK_SEVERITY_INVARIANT
  let peakIntakeSeverity: SeverityLevel | null = null;
  for (const intake of sourceIntakes) {
    if (
      !peakIntakeSeverity ||
      SEVERITY_RANK[intake.structured.severity] > SEVERITY_RANK[peakIntakeSeverity]
    ) {
      peakIntakeSeverity = intake.structured.severity;
    }
  }

  const severityFindings: SafetyGateFinding[] = [];
  let severityStatus: SafetyGateStatus = "PASS";
  let severitySummary = "Broadcast severity preserves peak source intake severity.";

  if (
    peakIntakeSeverity &&
    SEVERITY_RANK[peakIntakeSeverity] > SEVERITY_RANK[draft.severity]
  ) {
    const isCriticalMajorDowngrade =
      peakIntakeSeverity === "CRITICAL" &&
      (draft.severity === "MEDIUM" || draft.severity === "LOW");
    severityStatus = isCriticalMajorDowngrade ? "BLOCK" : "WARN";
    severitySummary = isCriticalMajorDowngrade
      ? `Blocked severity downgrade from ${peakIntakeSeverity} intake to ${draft.severity}.`
      : `Broadcast severity (${draft.severity}) is lower than peak source intake severity (${peakIntakeSeverity}).`;
    severityFindings.push({
      channel: "severity",
      field: "severity",
      excerpt: `Source peak is ${peakIntakeSeverity}; draft is ${draft.severity}.`,
    });
  }

  const severityCheck: SafetyGateCheckResult = {
    id: "PEAK_SEVERITY_INVARIANT",
    label: "Peak Severity Invariant",
    status: severityStatus,
    summary: severitySummary,
    findings: severityFindings,
    repairActionLabel:
      severityStatus !== "PASS" ? "Restore Peak Severity" : undefined,
  };

  // Rule 4: GAP_DISCLOSURE_CHECK
  const uniqueSourceGaps = new Map<string, string>();
  for (const intake of sourceIntakes) {
    for (const gap of intake.structured.verificationGaps) {
      const cleaned = gap.trim();
      if (cleaned && !uniqueSourceGaps.has(cleaned.toLowerCase())) {
        uniqueSourceGaps.set(cleaned.toLowerCase(), cleaned);
      }
    }
  }

  const offlineDraftIntakeCount = sourceIntakes.filter((i) =>
    i.structured.headline.startsWith("Offline draft:"),
  ).length;
  if (offlineDraftIntakeCount > 0) {
    const offlineNotice = `${offlineDraftIntakeCount} source intake(s) captured as Offline draft without full cloud triage`;
    uniqueSourceGaps.set(offlineNotice.toLowerCase(), offlineNotice);
  }

  const missingGaps: string[] = [];
  for (const gap of uniqueSourceGaps.values()) {
    if (!isGapCovered(gap, draft.globalSitrepEn.informationGaps)) {
      missingGaps.push(gap);
    }
  }

  const gapFindings: SafetyGateFinding[] = missingGaps.map((gap, idx) => ({
    channel: "globalSitrepEn",
    field: `informationGaps[${idx}]`,
    excerpt: `Unclosed gap omitted from SitRep: "${gap}"`,
  }));

  const hasGapWarn = missingGaps.length > 0 || offlineDraftIntakeCount > 0;
  const gapSummary = !hasGapWarn
    ? "All source verification gaps are disclosed in Global SitRep information gaps."
    : missingGaps.length > 0
      ? `${missingGaps.length} source verification gap(s) missing from Global SitRep disclosure.`
      : `${offlineDraftIntakeCount} Offline draft intake(s) included (disclosed in information gaps); Commander review recommended.`;

  const gapCheck: SafetyGateCheckResult = {
    id: "GAP_DISCLOSURE_CHECK",
    label: "Gap & Offline-Draft Disclosure",
    status: hasGapWarn ? "WARN" : "PASS",
    summary: gapSummary,
    findings: gapFindings,
    repairActionLabel:
      missingGaps.length > 0 ? "Inject Missing Gaps" : undefined,
  };

  const checks = [piiCheck, rumorCheck, severityCheck, gapCheck];
  const blockCount = checks.filter((c) => c.status === "BLOCK").length;
  const warnCount = checks.filter((c) => c.status === "WARN").length;
  const passCount = checks.filter((c) => c.status === "PASS").length;

  return {
    checks,
    blockCount,
    warnCount,
    passCount,
    peakIntakeSeverity,
    missingGaps,
    offlineDraftIntakeCount,
    evaluatedAtIso: new Date().toISOString(),
  };
}

export function repairDraftPii<T extends BroadcastDraftPayload>(draft: T): T {
  const counters: PiiCounters = { phone: 0, handle: 0, name: 0, addr: 0 };
  const scrub = (val: string) =>
    deterministicLocalPiiScrub(val, counters).sanitizedText;
  return mapDraftTextFields(
    draft,
    (val, { requiredFallback }) => {
      const cleaned = scrub(val).trim();
      return cleaned || (requiredFallback ?? "");
    },
    (item) => scrub(item),
  );
}

function stripUnsafeAllClearSentences(text: string): string {
  const chunks = text.split(/(?<=[.!?])\s+|\n+/);
  const kept = chunks
    .map((c) => c.trim())
    .filter((c) => c.length > 0 && findUnhedgedAllClearMatches(c).length === 0);
  return kept.join(" ").trim();
}

export function repairDraftRumorSafety<T extends BroadcastDraftPayload>(
  draft: T,
): T {
  const cleaned = mapDraftTextFields(
    draft,
    (val, { requiredFallback }) => {
      if (!val.trim()) return val;
      if (findUnhedgedAllClearMatches(val).length === 0) return val;
      const stripped = stripUnsafeAllClearSentences(val);
      return stripped || (requiredFallback ?? "");
    },
    (item) => {
      if (findUnhedgedAllClearMatches(item).length === 0) return item;
      const stripped = stripUnsafeAllClearSentences(item);
      return stripped || null;
    },
  );

  if (
    cleaned.debunkCard.hasRumorAlert &&
    cleaned.debunkCard.sources.length === 0 &&
    (cleaned.debunkCard.verdict === "VERIFIED" ||
      cleaned.debunkCard.verdict === "MISLEADING")
  ) {
    return {
      ...cleaned,
      debunkCard: {
        ...cleaned.debunkCard,
        verdict: "UNVERIFIED_DEVELOPING",
      },
    };
  }

  return cleaned;
}

export function repairDraftSeverity<T extends BroadcastDraftPayload>(
  draft: T,
  peakSeverity: SeverityLevel,
): T {
  return {
    ...draft,
    severity: peakSeverity,
  };
}

export function repairDraftMissingGaps<T extends BroadcastDraftPayload>(
  draft: T,
  missingGaps: string[],
): T {
  const existing = draft.globalSitrepEn.informationGaps;
  const seen = new Set(existing.map((g) => g.trim().toLowerCase()));
  const merged = [...existing];
  for (const gap of missingGaps) {
    const trimmed = gap.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(trimmed);
    if (merged.length >= 20) break;
  }

  return {
    ...draft,
    globalSitrepEn: {
      ...draft.globalSitrepEn,
      informationGaps: merged.slice(0, 20),
    },
  };
}

export function injectSafetyGateDrillFault<T extends BroadcastDraftPayload>(
  draft: T,
): T {
  const currentClaim = draft.debunkCard.claim.trim();
  const currentFactId = draft.debunkCard.factId.trim();
  const currentFactEn = draft.debunkCard.factEn.trim();

  return {
    ...draft,
    severity: "LOW",
    communityAlertId: {
      ...draft.communityAlertId,
      whatsappShortText: `${draft.communityAlertId.whatsappShortText.trim()} Hubungi Pak Budi Santoso (0812-0000-9988) untuk info.`.trim(),
    },
    mediaPressReleaseId: {
      ...draft.mediaPressReleaseId,
      body: `${draft.mediaPressReleaseId.body.trim()} Kondisi Bendungan Cirata sudah 100% aman.`.trim(),
    },
    debunkCard: {
      ...draft.debunkCard,
      hasRumorAlert: true,
      verdict: "VERIFIED",
      sources: [],
      claim:
        currentClaim ||
        "Beredar kabar bahwa bendungan sudah aman dan warga diminta kembali ke rumah.",
      factId: currentFactId
        ? `${currentFactId} Kondisi sudah 100% aman.`
        : "Kondisi sudah 100% aman.",
      factEn: currentFactEn
        ? `${currentFactEn} Situation confirmed safe.`
        : "Situation confirmed safe.",
    },
  };
}

export function buildSafetyGateReceipt(
  evaluation: SafetyGateEvaluation,
  opts: {
    simulatedFaultUsed: boolean;
    repairsApplied: string[];
    commanderSignedOff: boolean;
  },
): SafetyGateReceipt {
  return {
    evaluatedAtIso: evaluation.evaluatedAtIso,
    simulatedFaultUsed: opts.simulatedFaultUsed,
    repairsApplied: [...opts.repairsApplied],
    commanderSignedOff: opts.commanderSignedOff,
    checks: evaluation.checks.map((c) => ({
      id: c.id,
      label: c.label,
      status: c.status,
      summary: c.summary,
    })),
  };
}
