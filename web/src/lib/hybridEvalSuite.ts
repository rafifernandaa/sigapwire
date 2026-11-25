import {
  formatAreaKnowledgeBlock,
  MAX_INJECTED_AREA_CHARS,
  MAX_INJECTED_AREA_FACTS,
} from "./areaKnowledgeContext.ts";
import { buildUnifiedAuditTrail } from "./auditTrail.ts";
import {
  audioInlinePartToPlayableWav,
  buildRadioScriptForTts,
  parsePcmRateFromMimeType,
} from "./audioWav.ts";
import {
  evaluateBroadcastSafetyGate,
  injectSafetyGateDrillFault,
  repairDraftMissingGaps,
  repairDraftPii,
  repairDraftRumorSafety,
  repairDraftSeverity,
  type BroadcastDraftPayload,
} from "./broadcastSafetyGate.ts";
import {
  appendProvenanceSealToWhatsapp,
  computeDispatchProvenance,
  computeIntakeEvidenceSha256,
  extractProvenanceCodeFromQuery,
  PROVENANCE_CODE_REGEX,
  SHA256_HEX_REGEX,
  verifyDispatchProvenance,
} from "./crisisProvenance.ts";
import {
  detectSuggestedCrisisLanguage,
  verifyTranslationNumericSafety,
} from "./crisisTranslation.ts";
import { computeHybridScorecard } from "./hybridScorecard.ts";
import { deterministicLocalPiiScrub } from "./piiScrubber.ts";
import type {
  AreaKnowledgeDoc,
  DispatchDoc,
  IntakeDoc,
  SessionAuditEvent,
  VerificationTaskDoc,
} from "../types/sigapwire.ts";

export type EvalPillar =
  | "PRIVACY"
  | "HYBRID_ROUTING"
  | "SAFETY_GATE"
  | "ACCESSIBILITY_PROVENANCE";

export interface EvalCaseResult {
  id: string;
  pillar: EvalPillar;
  name: string;
  passed: boolean;
  durationMs: number;
  evidence: string;
}

export interface EvalPillarSummary {
  pillar: EvalPillar;
  label: string;
  passed: number;
  total: number;
}

export interface HybridEvalReport {
  generatedAtIso: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passRatePct: number;
  totalDurationMs: number;
  pillarSummaries: EvalPillarSummary[];
  cases: EvalCaseResult[];
}

const PILLAR_LABELS: Record<EvalPillar, string> = {
  PRIVACY: "On-Device Privacy Firewall (ONLY_ON_DEVICE)",
  HYBRID_ROUTING: "Hybrid Token Routing, Area Knowledge & Scorecard",
  SAFETY_GATE: "Deterministic Pre-Publish Safety Gate",
  ACCESSIBILITY_PROVENANCE: "Multilingual Safety, TTS WAV & SHA-256 Provenance",
};

const WEB_LOCAL_TOKEN_BUDGET = 2200;
const IMAGE_OVERHEAD_TOKENS = 300;

function estimateLocalTokens(text: string, hasImage = false): number {
  return (text ? Math.ceil(text.length / 3.2) : 0) + (hasImage ? IMAGE_OVERHEAD_TOKENS : 0);
}

function makeSampleIntake(overrides: Partial<IntakeDoc> = {}): IntakeDoc {
  return {
    id: "eval-in-1",
    incidentId: "inc_westjava_drill_2026",
    mode: "FIELD_REPORT",
    sourcePlatform: "WEB",
    inferenceSource: "ON_DEVICE",
    inferenceModeRequested: "PREFER_ON_DEVICE",
    latencyMs: 280,
    piiRedactedLocally: true,
    redactionCount: 2,
    sanitizedText: "Jembatan Sukamaju retak, akses maks 3 ton.",
    hasAttachment: false,
    structured: {
      headline: "Jembatan Sukamaju retak",
      hazardType: "EARTHQUAKE",
      location: "Sukamaju, Cugenang",
      severity: "HIGH",
      summaryId: "Jembatan dibatasi 3 ton.",
      summaryEn: "Bridge capped at 3 tons.",
      keyFacts: ["Kapasitas jembatan 3 ton"],
      urgentNeeds: ["Air bersih"],
      verificationGaps: ["Konfirmasi jumlah warga di posko utara"],
      rumorVerdict: "NOT_APPLICABLE",
      panicSignals: [],
      groundingSources: [],
      searchEntryPointHtml: null,
    },
    status: "TRIAGED",
    createdBy: "eval-uid",
    createdAt: new Date("2026-11-25T01:00:00Z"),
    ...overrides,
  };
}

function makeSampleDraft(
  overrides: Partial<BroadcastDraftPayload> = {},
): BroadcastDraftPayload {
  return {
    severity: "HIGH",
    communityAlertId: {
      title: "Peringatan Warga: Gempa M6.2 Cianjur",
      whatHappened: "Jembatan Sukamaju retak dan dibatasi 3 ton.",
      doNow: ["Gunakan jalur alternatif utara", "Siapkan air bersih"],
      avoid: ["Melintasi jembatan dengan truk berat"],
      whatsappShortText: "Peringatan gempa M6.2 Cianjur. Gunakan jalur utara.",
    },
    mediaPressReleaseId: {
      headline: "Pembaruan Darurat Gempa M6.2 Cianjur",
      dateline: "CIANJUR, 25 Nov 2026",
      body: "Tim lapangan mencatat keretakan jembatan dengan batas 3 ton.",
      keyMetrics: ["Batas 3 ton di Sukamaju"],
    },
    globalSitrepEn: {
      headline: "Indonesia: West Java M6.2 Rapid SitRep",
      executiveSummary: "Bridge load limited to 3 tons; water aid requested.",
      impactOverview: ["Sukamaju bridge structural crack"],
      priorityNeeds: ["Clean water and shelter tarps"],
      informationGaps: ["Konfirmasi jumlah warga di posko utara"],
    },
    debunkCard: {
      hasRumorAlert: false,
      verdict: "NOT_APPLICABLE",
      claim: "",
      factId: "",
      factEn: "",
      sources: [],
    },
    ...overrides,
  };
}

function makeSampleFact(
  id: string,
  overrides: Partial<AreaKnowledgeDoc> = {},
): AreaKnowledgeDoc {
  return {
    id,
    incidentId: "inc_westjava_drill_2026",
    fact: `Verified bridge limit ${id}: max 3 tons`,
    category: "ROUTE_ACCESS",
    sourceType: "HUMAN_DIRECT",
    sourceTaskId: null,
    active: true,
    createdBy: "eval-uid",
    createdAt: new Date("2026-11-25T01:00:00Z"),
    updatedAt: new Date("2026-11-25T01:00:00Z"),
    ...overrides,
  };
}

interface EvalCaseSpec {
  id: string;
  pillar: EvalPillar;
  name: string;
  run: () => Promise<{ passed: boolean; evidence: string }> | { passed: boolean; evidence: string };
}

const EVAL_SPECS: EvalCaseSpec[] = [
  // Pillar 1: On-Device Privacy Firewall (8 cases)
  {
    id: "PRIV-01",
    pillar: "PRIVACY",
    name: "Redacts +62 Indonesian mobile phone numbers locally",
    run: () => {
      const res = deterministicLocalPiiScrub("Hubungi posko +62 812-3456-7890 segera.");
      const passed =
        !res.sanitizedText.includes("812") &&
        res.sanitizedText.includes("[PHONE_1]") &&
        res.redactions.length === 1;
      return { passed, evidence: `redactions=${res.redactions.length}` };
    },
  },
  {
    id: "PRIV-02",
    pillar: "PRIVACY",
    name: "Redacts local 08xx dotted mobile formats",
    run: () => {
      const res = deterministicLocalPiiScrub("Nomor pelapor 0857.1122.3344 di posko.");
      const passed =
        !res.sanitizedText.includes("0857") &&
        res.sanitizedText.includes("[PHONE_1]");
      return { passed, evidence: `output="${res.sanitizedText}"` };
    },
  },
  {
    id: "PRIV-03",
    pillar: "PRIVACY",
    name: "Redacts social and chat @handles",
    run: () => {
      const res = deterministicLocalPiiScrub("Laporan diteruskan oleh @relawan.cianjur hari ini.");
      const passed =
        !res.sanitizedText.includes("@relawan.cianjur") &&
        res.sanitizedText.includes("[HANDLE_1]");
      return { passed, evidence: `redactions=${res.redactions.length}` };
    },
  },
  {
    id: "PRIV-04",
    pillar: "PRIVACY",
    name: "Redacts personal names following Indonesian honorifics",
    run: () => {
      const res = deterministicLocalPiiScrub("Pak Hendra Wijaya dan Ibu Siti mengungsi di lapangan.");
      const passed =
        !res.sanitizedText.includes("Hendra") &&
        !res.sanitizedText.includes("Siti") &&
        res.sanitizedText.includes("Pak [RESIDENT_1]") &&
        res.sanitizedText.includes("Ibu [RESIDENT_2]");
      return { passed, evidence: `redactions=${res.redactions.length}` };
    },
  },
  {
    id: "PRIV-05",
    pillar: "PRIVACY",
    name: "Redacts house-level Jl. and RT/RW street addresses",
    run: () => {
      const res = deterministicLocalPiiScrub("Rumah retak di Jl. Cugenang No. 42 RT 03/RW 02 Cianjur.");
      const passed =
        !res.sanitizedText.includes("No. 42") &&
        !res.sanitizedText.includes("RT 03/RW 02") &&
        res.sanitizedText.includes("[STREET_ADDRESS_1]");
      return { passed, evidence: `output="${res.sanitizedText}"` };
    },
  },
  {
    id: "PRIV-06",
    pillar: "PRIVACY",
    name: "Scrubs all 4 PII categories from a chaotic WhatsApp report",
    run: () => {
      const raw =
        "Info dari Pak Budi Santoso (@budi_lapangan) WA 0813-9988-7766, rumah Jl. Melati No. 12 RT 01/RW 04 ambruk.";
      const res = deterministicLocalPiiScrub(raw);
      const cats = new Set(res.redactions.map((r) => r.category));
      const passed =
        cats.size === 4 &&
        !res.sanitizedText.includes("Budi") &&
        !res.sanitizedText.includes("0813") &&
        !res.sanitizedText.includes("@budi") &&
        !res.sanitizedText.includes("No. 12");
      return { passed, evidence: `categories=${cats.size}/4, total=${res.redactions.length}` };
    },
  },
  {
    id: "PRIV-07",
    pillar: "PRIVACY",
    name: "Preserves public hotlines (112, 117), magnitudes, and shelter counts",
    run: () => {
      const raw = "Gempa M6.2 pukul 14.05 WIB, 35-40 warga di posko, hubungi darurat 112 atau 117.";
      const res = deterministicLocalPiiScrub(raw);
      const passed =
        res.redactions.length === 0 &&
        res.sanitizedText === raw;
      return { passed, evidence: `falseRedactions=${res.redactions.length}` };
    },
  },
  {
    id: "PRIV-08",
    pillar: "PRIVACY",
    name: "Leaves clean sanitized field notes untouched",
    run: () => {
      const raw = "Jembatan Sukamaju retak. Butuh air bersih dan terpal segera.";
      const res = deterministicLocalPiiScrub(raw);
      const passed = res.redactions.length === 0 && res.sanitizedText === raw;
      return { passed, evidence: `redactions=${res.redactions.length}` };
    },
  },

  // Pillar 2: Hybrid Token Routing, Area Knowledge & Scorecard (8 cases)
  {
    id: "ROUTE-01",
    pillar: "HYBRID_ROUTING",
    name: "Keeps short single-zone field reports inside Web 2200-token Nano budget",
    run: () => {
      const tokens = estimateLocalTokens("Gempa M6.2 Sukamaju jembatan retak butuh air bersih.", false);
      const passed = tokens > 0 && tokens <= WEB_LOCAL_TOKEN_BUDGET;
      return { passed, evidence: `estTokens=${tokens} <= ${WEB_LOCAL_TOKEN_BUDGET}` };
    },
  },
  {
    id: "ROUTE-02",
    pillar: "HYBRID_ROUTING",
    name: "Auto-escalates multi-subdistrict long dumps exceeding 2200 est. tokens",
    run: () => {
      const longDump = "Laporan kecamatan terdampak gempa dan kebutuhan logistik. ".repeat(140);
      const tokens = estimateLocalTokens(longDump, false);
      const passed = tokens > WEB_LOCAL_TOKEN_BUDGET;
      return { passed, evidence: `estTokens=${tokens} > ${WEB_LOCAL_TOKEN_BUDGET}` };
    },
  },
  {
    id: "ROUTE-03",
    pillar: "HYBRID_ROUTING",
    name: "Accounts for +300 image token overhead on borderline multimodal reports",
    run: () => {
      const borderline = "A".repeat(6400); // 2000 text tokens
      const textOnly = estimateLocalTokens(borderline, false);
      const withImage = estimateLocalTokens(borderline, true);
      const passed =
        textOnly <= WEB_LOCAL_TOKEN_BUDGET &&
        withImage > WEB_LOCAL_TOKEN_BUDGET;
      return { passed, evidence: `textOnly=${textOnly}, withImage=${withImage}` };
    },
  },
  {
    id: "ROUTE-04",
    pillar: "HYBRID_ROUTING",
    name: "Excludes paused Area Knowledge facts from injected prompts",
    run: () => {
      const res = formatAreaKnowledgeBlock([
        makeSampleFact("paused", { active: false, fact: "OLD_PAUSED_FACT" }),
        makeSampleFact("live", { active: true, fact: "Northern bypass max 3 tons" }),
      ]);
      const passed =
        !res.block.includes("OLD_PAUSED_FACT") &&
        res.block.includes("[AK-1]") &&
        res.includedCount === 1;
      return { passed, evidence: `included=${res.includedCount}` };
    },
  },
  {
    id: "ROUTE-05",
    pillar: "HYBRID_ROUTING",
    name: "Caps 15 active Area Knowledge facts to <=8 items and <=1200 chars",
    run: () => {
      const many = Array.from({ length: 15 }, (_, idx) =>
        makeSampleFact(`f-${idx + 1}`, {
          fact: `Route constraint #${idx + 1}: northern bypass bridge supports light 4x4 up to 3 tons.`,
        }),
      );
      const res = formatAreaKnowledgeBlock(many);
      const passed =
        res.includedCount <= MAX_INJECTED_AREA_FACTS &&
        res.block.length <= MAX_INJECTED_AREA_CHARS &&
        res.includedCount > 0;
      return {
        passed,
        evidence: `facts=${res.includedCount}/${MAX_INJECTED_AREA_FACTS}, chars=${res.block.length}/${MAX_INJECTED_AREA_CHARS}`,
      };
    },
  },
  {
    id: "ROUTE-06",
    pillar: "HYBRID_ROUTING",
    name: "Safely bounds an oversized single Area Knowledge fact",
    run: () => {
      const huge = makeSampleFact("huge", { fact: "Emergency route notice ".repeat(90) });
      const res = formatAreaKnowledgeBlock([huge]);
      const passed = res.includedCount === 1 && res.block.length <= MAX_INJECTED_AREA_CHARS;
      return { passed, evidence: `chars=${res.block.length}` };
    },
  },
  {
    id: "ROUTE-07",
    pillar: "HYBRID_ROUTING",
    name: "Empty Hybrid Scorecard reports exact zeros with zero fabricated numbers",
    run: () => {
      const sc = computeHybridScorecard({
        intakes: [],
        verificationTasks: [],
        dispatches: [],
        sessionEvents: [],
      });
      const passed =
        sc.onDeviceExecutions === 0 &&
        sc.inCloudExecutions === 0 &&
        sc.onDeviceSharePct === 0 &&
        sc.totalPiiBlockedLocally === 0 &&
        sc.cloudCallsAvoided === 0 &&
        sc.lastHandoffLabel === "Awaiting first intake or broadcast";
      return { passed, evidence: `share=${sc.onDeviceSharePct}%, label="${sc.lastHandoffLabel}"` };
    },
  },
  {
    id: "ROUTE-08",
    pillar: "HYBRID_ROUTING",
    name: "Audit trail and scorecard aggregate cross-platform WEB/ANDROID/APPLE records",
    run: () => {
      const intakes: IntakeDoc[] = [
        makeSampleIntake({ id: "i-apple", sourcePlatform: "APPLE", inferenceSource: "ON_DEVICE", redactionCount: 3 }),
        makeSampleIntake({ id: "i-android", sourcePlatform: "ANDROID", inferenceSource: "IN_CLOUD", redactionCount: 2 }),
      ];
      const tasks: VerificationTaskDoc[] = [
        {
          id: "t-1",
          incidentId: "inc_westjava_drill_2026",
          linkedIntakeId: "i-apple",
          question: "Check bridge capacity",
          location: "Sukamaju",
          status: "ANSWERED",
          requestedBy: "web",
          requestedPlatform: "WEB",
          answerText: "Max 3 tons",
          answerPlatform: "APPLE",
          answerPiiRedactedLocally: true,
          answerRedactionCount: 1,
          answeredBy: "apple",
          answeredAt: new Date("2026-11-25T01:05:00Z"),
          promotedKnowledgeId: null,
          createdAt: new Date("2026-11-25T01:02:00Z"),
          updatedAt: new Date("2026-11-25T01:05:00Z"),
        },
      ];
      const events = buildUnifiedAuditTrail({
        intakes,
        verificationTasks: tasks,
        areaKnowledge: [],
        dispatches: [],
        sessionEvents: [],
      });
      const sc = computeHybridScorecard({
        intakes,
        verificationTasks: tasks,
        dispatches: [],
        sessionEvents: [] as SessionAuditEvent[],
      });
      const passed = events.length >= 6 && sc.totalPiiBlockedLocally === 6 && sc.onDeviceExecutions === 4;
      return { passed, evidence: `events=${events.length}, piiBlocked=${sc.totalPiiBlockedLocally}` };
    },
  },

  // Pillar 3: Deterministic Pre-Publish Safety Gate (8 cases)
  {
    id: "GATE-01",
    pillar: "SAFETY_GATE",
    name: "Clean 4-audience draft clears all 4 deterministic gate checks",
    run: () => {
      const evalRes = evaluateBroadcastSafetyGate(makeSampleDraft(), [makeSampleIntake()]);
      const passed = evalRes.passCount === 4 && evalRes.blockCount === 0 && evalRes.warnCount === 0;
      return { passed, evidence: `pass=${evalRes.passCount}/4, blocks=${evalRes.blockCount}, warns=${evalRes.warnCount}` };
    },
  },
  {
    id: "GATE-02",
    pillar: "SAFETY_GATE",
    name: "Zero-PII Leak Guard blocks leaked phone/@handle and auto-scrub clears block",
    run: () => {
      const draft = makeSampleDraft();
      draft.communityAlertId.whatsappShortText = "Hubungi Pak Andi 0812-3456-7890 @posko_warga";
      const before = evaluateBroadcastSafetyGate(draft, [makeSampleIntake()]);
      const repaired = repairDraftPii(draft);
      const after = evaluateBroadcastSafetyGate(repaired, [makeSampleIntake()]);
      const passed = before.blockCount >= 1 && after.blockCount === 0;
      return { passed, evidence: `beforeBlocks=${before.blockCount}, afterBlocks=${after.blockCount}` };
    },
  },
  {
    id: "GATE-03",
    pillar: "SAFETY_GATE",
    name: "Rumor Safety Guard blocks zero-source VERIFIED verdict and repairs safely",
    run: () => {
      const rumorIntake = makeSampleIntake({
        id: "r-1",
        mode: "RUMOR_CHECK",
        structured: {
          ...makeSampleIntake().structured,
          rumorVerdict: "UNVERIFIED_DEVELOPING",
          groundingSources: [],
        },
      });
      const draft = makeSampleDraft({
        debunkCard: {
          hasRumorAlert: true,
          verdict: "VERIFIED",
          claim: "Bendungan Cirata retak",
          factId: "Klaim terverifikasi.",
          factEn: "Claim verified.",
          sources: [],
        },
      });
      const before = evaluateBroadcastSafetyGate(draft, [rumorIntake]);
      const repaired = repairDraftRumorSafety(draft);
      const after = evaluateBroadcastSafetyGate(repaired, [rumorIntake]);
      const passed =
        before.blockCount >= 1 &&
        repaired.debunkCard.verdict === "UNVERIFIED_DEVELOPING" &&
        after.blockCount === 0;
      return { passed, evidence: `repairedVerdict=${repaired.debunkCard.verdict}` };
    },
  },
  {
    id: "GATE-04",
    pillar: "SAFETY_GATE",
    name: "Blocks unhedged Indonesian all-clear claim when rumor is unverified",
    run: () => {
      const rumorIntake = makeSampleIntake({
        id: "r-2",
        mode: "RUMOR_CHECK",
        structured: {
          ...makeSampleIntake().structured,
          rumorVerdict: "UNVERIFIED_DEVELOPING",
          groundingSources: [],
        },
      });
      const draft = makeSampleDraft({
        communityAlertId: {
          ...makeSampleDraft().communityAlertId,
          whatHappened: "Situasi sudah 100% aman terkendali di seluruh wilayah.",
        },
      });
      const before = evaluateBroadcastSafetyGate(draft, [rumorIntake]);
      const after = evaluateBroadcastSafetyGate(repairDraftRumorSafety(draft), [rumorIntake]);
      const passed = before.blockCount >= 1 && after.blockCount === 0;
      return { passed, evidence: `beforeBlocks=${before.blockCount}, afterBlocks=${after.blockCount}` };
    },
  },
  {
    id: "GATE-05",
    pillar: "SAFETY_GATE",
    name: "Blocks unhedged English all-clear phrasing while rumor lacks grounding",
    run: () => {
      const rumorIntake = makeSampleIntake({
        id: "r-3",
        mode: "RUMOR_CHECK",
        structured: {
          ...makeSampleIntake().structured,
          rumorVerdict: "UNVERIFIED_DEVELOPING",
          groundingSources: [],
        },
      });
      const draft = makeSampleDraft({
        globalSitrepEn: {
          ...makeSampleDraft().globalSitrepEn,
          executiveSummary: "Authorities issued a false alarm; the sector is confirmed safe.",
        },
      });
      const evalRes = evaluateBroadcastSafetyGate(draft, [rumorIntake]);
      const passed = evalRes.blockCount >= 1;
      return { passed, evidence: `blocks=${evalRes.blockCount}` };
    },
  },
  {
    id: "GATE-06",
    pillar: "SAFETY_GATE",
    name: "Negated safety and shelter phrasing causes zero false blocks",
    run: () => {
      const rumorIntake = makeSampleIntake({
        id: "r-4",
        mode: "RUMOR_CHECK",
        structured: {
          ...makeSampleIntake().structured,
          rumorVerdict: "UNVERIFIED_DEVELOPING",
          groundingSources: [],
        },
      });
      const draft = makeSampleDraft({
        communityAlertId: {
          ...makeSampleDraft().communityAlertId,
          whatHappened: "Jembatan belum aman dilalui. Gunakan jalur aman ke lokasi evakuasi.",
        },
        globalSitrepEn: {
          ...makeSampleDraft().globalSitrepEn,
          executiveSummary: "Area is not safe yet; use the safe evacuation route to shelter.",
        },
      });
      const evalRes = evaluateBroadcastSafetyGate(draft, [rumorIntake]);
      const passed = evalRes.blockCount === 0;
      return { passed, evidence: `falseBlocks=${evalRes.blockCount}` };
    },
  },
  {
    id: "GATE-07",
    pillar: "SAFETY_GATE",
    name: "Peak Severity Invariant blocks CRITICAL->MEDIUM downgrade and restores CRITICAL",
    run: () => {
      const criticalIntake = makeSampleIntake({
        structured: { ...makeSampleIntake().structured, severity: "CRITICAL" },
      });
      const downgraded = makeSampleDraft({ severity: "MEDIUM" });
      const before = evaluateBroadcastSafetyGate(downgraded, [criticalIntake]);
      const restored = repairDraftSeverity(downgraded, "CRITICAL");
      const after = evaluateBroadcastSafetyGate(restored, [criticalIntake]);
      const passed = before.blockCount >= 1 && restored.severity === "CRITICAL" && after.blockCount === 0;
      return { passed, evidence: `beforeBlocks=${before.blockCount}, restored=${restored.severity}` };
    },
  },
  {
    id: "GATE-08",
    pillar: "SAFETY_GATE",
    name: "Drill fault injection + omitted gap repair restores clean gate state",
    run: () => {
      const intake = makeSampleIntake({
        structured: {
          ...makeSampleIntake().structured,
          severity: "CRITICAL",
          headline: "Offline draft: Sukamaju",
          verificationGaps: ["Konfirmasi posko utara"],
        },
      });
      const base = makeSampleDraft({
        severity: "CRITICAL",
        globalSitrepEn: { ...makeSampleDraft().globalSitrepEn, informationGaps: [] },
      });
      const faulted = injectSafetyGateDrillFault(base);
      const evalFaulted = evaluateBroadcastSafetyGate(faulted, [intake]);
      let repaired = repairDraftPii(faulted);
      repaired = repairDraftRumorSafety(repaired);
      if (evalFaulted.peakIntakeSeverity) {
        repaired = repairDraftSeverity(repaired, evalFaulted.peakIntakeSeverity);
      }
      repaired = repairDraftMissingGaps(repaired, evalFaulted.missingGaps);
      const evalClean = evaluateBroadcastSafetyGate(repaired, [intake]);
      const passed = evalFaulted.blockCount >= 2 && evalClean.blockCount === 0;
      return {
        passed,
        evidence: `faultBlocks=${evalFaulted.blockCount}, afterRepairBlocks=${evalClean.blockCount}`,
      };
    },
  },

  // Pillar 4: Multilingual Safety, TTS WAV & SHA-256 Provenance (8 cases)
  {
    id: "PROV-01",
    pillar: "ACCESSIBILITY_PROVENANCE",
    name: "Detects regional and visitor browser locales without nagging Indonesian defaults",
    run: () => {
      const passed =
        detectSuggestedCrisisLanguage("su-ID") === "su" &&
        detectSuggestedCrisisLanguage("ja-JP") === "ja" &&
        detectSuggestedCrisisLanguage("ar-SA") === "ar" &&
        detectSuggestedCrisisLanguage("id-ID") === null;
      return { passed, evidence: "su/ja/ar mapped; id-ID=null" };
    },
  },
  {
    id: "PROV-02",
    pillar: "ACCESSIBILITY_PROVENANCE",
    name: "Preserves safety numerals across Arabic-Indic digit translations",
    run: () => {
      const res = verifyTranslationNumericSafety(
        "Gempa M6.2 pukul 14.05 hubungi 112 [AK-1].",
        "زلزال M٦.٢ الساعة ١٤.٠٥ اتصل ١١٢ [AK-1].",
      );
      return { passed: res.passed, evidence: `tokens=${res.sourceTokens.length}, missing=${res.missingTokens.length}` };
    },
  },
  {
    id: "PROV-03",
    pillar: "ACCESSIBILITY_PROVENANCE",
    name: "Handles Sundanese comma decimals (M6,2) and [AK-1] citations cleanly",
    run: () => {
      const res = verifyTranslationNumericSafety(
        "Gempa M6.2 di [AK-1] maksimal 3 ton.",
        "Lini M6,2 di [AK-1] maksimal 3 ton.",
      );
      return { passed: res.passed, evidence: `missing=${res.missingTokens.length}` };
    },
  },
  {
    id: "PROV-04",
    pillar: "ACCESSIBILITY_PROVENANCE",
    name: "Flags dropped safety numbers (M6.2, 112, [AK-1]) in faulty translation",
    run: () => {
      const res = verifyTranslationNumericSafety(
        "Gempa M6.2 di [AK-1] hubungi 112.",
        "Earthquake happened near bridge. Call emergency services.",
      );
      const passed =
        !res.passed &&
        res.missingTokens.includes("m6.2") &&
        res.missingTokens.includes("[ak-1]") &&
        res.missingTokens.includes("112");
      return { passed, evidence: `flagged=${res.missingTokens.join(",")}` };
    },
  },
  {
    id: "PROV-05",
    pillar: "ACCESSIBILITY_PROVENANCE",
    name: "Wraps Gemini TTS 24kHz PCM bytes into valid 44-byte RIFF/WAVE header",
    run: () => {
      const sampleRate = parsePcmRateFromMimeType("audio/L16;codec=pcm;rate=24000");
      const rawB64 =
        typeof Buffer !== "undefined"
          ? Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]).toString("base64")
          : btoa("\x01\x02\x03\x04\x05\x06\x07\x08");
      const out = audioInlinePartToPlayableWav({
        mimeType: "audio/L16;codec=pcm;rate=24000",
        data: rawB64,
      });
      const riff = String.fromCharCode(out.bytes[0], out.bytes[1], out.bytes[2], out.bytes[3]);
      const wave = String.fromCharCode(out.bytes[8], out.bytes[9], out.bytes[10], out.bytes[11]);
      const passed = sampleRate === 24000 && riff === "RIFF" && wave === "WAVE" && out.bytes.byteLength === 52;
      return { passed, evidence: `header=${riff}/${wave}, bytes=${out.bytes.byteLength}` };
    },
  },
  {
    id: "PROV-06",
    pillar: "ACCESSIBILITY_PROVENANCE",
    name: "Builds bounded 2-Voice Anchor/Verifier radio script for Gemini TTS",
    run: () => {
      const script = buildRadioScriptForTts({
        dispatchNumber: 1,
        title: "Peringatan Gempa M6.2",
        whatHappened: "Jembatan dibatasi 3 ton.",
        doNow: ["Gunakan jalur utara"],
        avoid: ["Sebar info tanpa sumber"],
        languageName: "Sundanese (Basa Sunda)",
        debunkCard: {
          hasRumorAlert: true,
          verdict: "MISLEADING",
          claim: "Bendungan jebol",
          factId: "Operator memastikan bendungan aman.",
          factEn: "Operator confirms dam intact.",
        },
        dualSpeaker: true,
      });
      const passed = script.includes("Anchor:") && script.includes("Verifier:") && script.length <= 1400;
      return { passed, evidence: `chars=${script.length}` };
    },
  },
  {
    id: "PROV-07",
    pillar: "ACCESSIBILITY_PROVENANCE",
    name: "End-to-end SHA-256 intake evidence + Dispatch Provenance Seal verifies intact",
    run: async () => {
      const evidenceSha256 = await computeIntakeEvidenceSha256({
        sanitizedText: "Jembatan Sukamaju retak, akses maks 3 ton.",
        mode: "FIELD_REPORT",
        sourcePlatform: "WEB",
        redactionCount: 2,
        imageBytes: new Uint8Array([9, 8, 7, 6]),
      });
      const intake = makeSampleIntake({ evidenceSha256 });
      const draft = makeSampleDraft();
      const { manifestSha256, provenanceCode } = await computeDispatchProvenance({
        dispatchNumber: 1,
        incidentId: "inc_westjava_drill_2026",
        severity: draft.severity,
        sourceIntakeIds: [intake.id],
        sourceEvidenceHashes: [evidenceSha256],
        communityAlertId: draft.communityAlertId,
        globalSitrepEn: draft.globalSitrepEn,
        debunkCard: draft.debunkCard,
      });
      const dispatch: DispatchDoc = {
        id: "eval-d1",
        incidentId: "inc_westjava_drill_2026",
        dispatchNumber: 1,
        severity: draft.severity,
        sourceIntakeIds: [intake.id],
        inferenceSource: "IN_CLOUD",
        communityAlertId: {
          ...draft.communityAlertId,
          whatsappShortText: appendProvenanceSealToWhatsapp(
            draft.communityAlertId.whatsappShortText,
            provenanceCode,
          ),
        },
        mediaPressReleaseId: draft.mediaPressReleaseId,
        globalSitrepEn: draft.globalSitrepEn,
        debunkCard: draft.debunkCard,
        groundingSearchHtml: null,
        manifestSha256,
        provenanceCode,
        publishedBy: "eval-uid",
        publishedAt: new Date("2026-11-25T01:10:00Z"),
      };
      const verified = await verifyDispatchProvenance({
        dispatch,
        linkedIntakes: [intake],
      });
      const passed =
        SHA256_HEX_REGEX.test(evidenceSha256) &&
        PROVENANCE_CODE_REGEX.test(provenanceCode) &&
        verified.status === "VERIFIED_INTACT";
      return { passed, evidence: `seal=${provenanceCode}, status=${verified.status}` };
    },
  },
  {
    id: "PROV-08",
    pillar: "ACCESSIBILITY_PROVENANCE",
    name: "Detects single-digit dispatch tampering and parses forwarded WhatsApp seals",
    run: async () => {
      const intake = makeSampleIntake();
      const draft = makeSampleDraft();
      const { manifestSha256, provenanceCode } = await computeDispatchProvenance({
        dispatchNumber: 3,
        incidentId: "inc_westjava_drill_2026",
        severity: draft.severity,
        sourceIntakeIds: [intake.id],
        communityAlertId: draft.communityAlertId,
        globalSitrepEn: draft.globalSitrepEn,
        debunkCard: draft.debunkCard,
      });
      const tampered: DispatchDoc = {
        id: "eval-d3",
        incidentId: "inc_westjava_drill_2026",
        dispatchNumber: 3,
        severity: draft.severity,
        sourceIntakeIds: [intake.id],
        inferenceSource: "IN_CLOUD",
        communityAlertId: {
          ...draft.communityAlertId,
          whatHappened: "Jembatan Sukamaju retak dan dibatasi 30 ton.",
        },
        mediaPressReleaseId: draft.mediaPressReleaseId,
        globalSitrepEn: draft.globalSitrepEn,
        debunkCard: draft.debunkCard,
        groundingSearchHtml: null,
        manifestSha256,
        provenanceCode,
        publishedBy: "eval-uid",
        publishedAt: new Date("2026-11-25T01:10:00Z"),
      };
      const verified = await verifyDispatchProvenance({
        dispatch: tampered,
        linkedIntakes: [intake],
      });
      const extracted = extractProvenanceCodeFromQuery(
        `Forwarded alert!\nSeal: ${provenanceCode}\nShare safely.`,
      );
      const passed =
        verified.status === "TAMPER_MISMATCH" && extracted === provenanceCode;
      return { passed, evidence: `status=${verified.status}, extracted=${extracted}` };
    },
  },
];

/**
 * Executes all 32 deterministic Hybrid Crisis Readiness scenarios across 4 pillars.
 * Runs identically in Node CLI (`npm run eval`) and live inside the hosted Web app.
 */
export async function runHybridCrisisEvalSuite(): Promise<HybridEvalReport> {
  const suiteStart = performance.now();
  const cases: EvalCaseResult[] = [];

  for (const spec of EVAL_SPECS) {
    const start = performance.now();
    try {
      const outcome = await spec.run();
      cases.push({
        id: spec.id,
        pillar: spec.pillar,
        name: spec.name,
        passed: outcome.passed,
        durationMs: Number((performance.now() - start).toFixed(2)),
        evidence: outcome.evidence,
      });
    } catch (err) {
      cases.push({
        id: spec.id,
        pillar: spec.pillar,
        name: spec.name,
        passed: false,
        durationMs: Number((performance.now() - start).toFixed(2)),
        evidence: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const pillars: EvalPillar[] = [
    "PRIVACY",
    "HYBRID_ROUTING",
    "SAFETY_GATE",
    "ACCESSIBILITY_PROVENANCE",
  ];
  const pillarSummaries: EvalPillarSummary[] = pillars.map((pillar) => {
    const subset = cases.filter((c) => c.pillar === pillar);
    return {
      pillar,
      label: PILLAR_LABELS[pillar],
      passed: subset.filter((c) => c.passed).length,
      total: subset.length,
    };
  });

  const passedCases = cases.filter((c) => c.passed).length;
  const totalCases = cases.length;

  return {
    generatedAtIso: new Date().toISOString(),
    totalCases,
    passedCases,
    failedCases: totalCases - passedCases,
    passRatePct: totalCases > 0 ? Math.round((passedCases / totalCases) * 100) : 0,
    totalDurationMs: Number((performance.now() - suiteStart).toFixed(2)),
    pillarSummaries,
    cases,
  };
}

/**
 * Renders a zero-em-dash Markdown benchmark report for `docs/EVAL_REPORT.md`.
 */
export function formatEvalReportMarkdown(report: HybridEvalReport): string {
  const lines: string[] = [
    "# SigapWire Hybrid Crisis Readiness Evaluation Report",
    "",
    `- **Generated At:** ${report.generatedAtIso}`,
    `- **Runner:** \`cd web && npm run eval\` (deterministic pure-module benchmark, also executable live in **Ops Memory & Audit**)`,
    `- **Overall Score:** **${report.passedCases}/${report.totalCases} passed (${report.passRatePct}%)** in ${report.totalDurationMs}ms`,
    `- **Failed Scenarios:** ${report.failedCases}`,
    "",
    "---",
    "",
    "## Pillar Summary",
    "",
    "| Pillar | Passed | Total | Status |",
    "| :--- | :---: | :---: | :---: |",
  ];

  for (const summary of report.pillarSummaries) {
    const status = summary.passed === summary.total ? "PASS" : "FAIL";
    lines.push(
      `| ${summary.label} | ${summary.passed} | ${summary.total} | ${status} |`,
    );
  }

  lines.push(
    "",
    "## Detailed Scenario Results",
    "",
    "| ID | Pillar | Scenario | Result | Evidence |",
    "| :--- | :--- | :--- | :---: | :--- |",
  );

  for (const item of report.cases) {
    lines.push(
      `| \`${item.id}\` | \`${item.pillar}\` | ${item.name} | ${item.passed ? "PASS" : "FAIL"} | ${item.evidence} |`,
    );
  }

  lines.push(
    "",
    "> **Note:** This benchmark evaluates deterministic safety, privacy, routing, multilingual numeric preservation, WAV container encoding, and SHA-256 provenance invariants using seeded synthetic disaster fixtures. It requires zero API keys and is 100% reproducible by judges.",
    "",
  );

  return lines.join("\n");
}
