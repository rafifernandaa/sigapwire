import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSafetyGateReceipt,
  evaluateBroadcastSafetyGate,
  injectSafetyGateDrillFault,
  repairDraftMissingGaps,
  repairDraftPii,
  repairDraftRumorSafety,
  repairDraftSeverity,
  type BroadcastDraftPayload,
} from "../src/lib/broadcastSafetyGate.ts";
import { formatDispatchMarkdown } from "../src/lib/dispatchExport.ts";
import type { IntakeDoc } from "../src/types/sigapwire.ts";

function makeIntake(overrides: Partial<IntakeDoc> = {}): IntakeDoc {
  const base: IntakeDoc = {
    id: "intake-1",
    incidentId: "inc_westjava_drill_2026",
    mode: "FIELD_REPORT",
    sourcePlatform: "WEB",
    inferenceSource: "ON_DEVICE",
    inferenceModeRequested: "PREFER_ON_DEVICE",
    latencyMs: 320,
    piiRedactedLocally: true,
    redactionCount: 2,
    sanitizedText:
      "Jembatan Sukamaju retak struktural; 40 warga mengungsi ke lapangan sekolah dan membutuhkan air bersih.",
    hasAttachment: false,
    structured: {
      headline: "Structural bridge crack reported in Desa Sukamaju",
      hazardType: "EARTHQUAKE",
      location: "Desa Sukamaju, Cugenang",
      severity: "HIGH",
      summaryId: "Jembatan penghubung Sukamaju retak dan 40 warga mengungsi.",
      summaryEn: "Sukamaju bridge cracked; 40 residents evacuated to school field.",
      keyFacts: ["Jembatan penghubung retak parah"],
      urgentNeeds: ["Air bersih dan terpal darurat"],
      verificationGaps: ["Status teknis jembatan oleh tim PUPR belum terkonfirmasi"],
      rumorVerdict: "NOT_APPLICABLE",
      panicSignals: [],
      groundingSources: [],
      searchEntryPointHtml: null,
    },
    status: "TRIAGED",
    createdBy: "anon-user",
    createdAt: new Date("2026-11-24T01:00:00Z"),
  };

  return {
    ...base,
    ...overrides,
    structured: {
      ...base.structured,
      ...(overrides.structured ?? {}),
    },
  };
}

function makeCleanDraft(
  overrides: Partial<BroadcastDraftPayload> = {},
): BroadcastDraftPayload {
  return {
    severity: "HIGH",
    communityAlertId: {
      title: "Peringatan Darurat Desa Sukamaju",
      whatHappened:
        "Terjadi guncangan gempa yang merusak akses jembatan di Desa Sukamaju.",
      doNow: [
        "Gunakan titik aman evakuasi di lapangan sekolah terdekat.",
        "Amankan dokumen penting dan tunggu arahan petugas.",
      ],
      avoid: ["Jangan melintasi jalur tidak aman atau jembatan yang retak."],
      whatsappShortText:
        "INFO DARURAT CUGENANG: Jauhi jembatan Sukamaju yang retak dan menuju titik aman evakuasi di SD Sukamaju.",
    },
    mediaPressReleaseId: {
      headline: "Rilis Resmi Penanganan Gempa Cugenang",
      dateline: "CIANJUR, JAWA BARAT",
      body: "Tim lapangan mencatat keretakan jembatan dan kondisi belum dipastikan aman untuk truk logistik. Keamanan warga diprioritaskan di posko darurat.",
      keyMetrics: ["40 warga di titik pengungsian sementara"],
    },
    globalSitrepEn: {
      headline: "West Java Earthquake Field Situation Report",
      executiveSummary:
        "Bridge damage in Sukamaju requires urgent inspection; relief supplies are needed at temporary shelter.",
      impactOverview: ["Access bridge restricted to light traffic"],
      priorityNeeds: ["Clean drinking water", "Emergency tarpaulins"],
      informationGaps: [
        "Technical bridge status by PUPR engineers remains unconfirmed",
      ],
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

test("clean draft passes all 4 deterministic rules without blocks or warnings", () => {
  const result = evaluateBroadcastSafetyGate(makeCleanDraft(), [makeIntake()]);
  assert.equal(result.blockCount, 0);
  assert.equal(result.warnCount, 0);
  assert.equal(result.passCount, 4);
});

test("Zero-PII Leak Guard blocks personal identifiers and repairDraftPii scrubs them cleanly", () => {
  const leaked = makeCleanDraft({
    communityAlertId: {
      ...makeCleanDraft().communityAlertId,
      whatsappShortText:
        "Hubungi Pak Hendra Santoso di +62 812-0000-4411 atau @hendra_ops di Jl. Melati No. 14 RT 02.",
    },
  });

  const before = evaluateBroadcastSafetyGate(leaked, [makeIntake()]);
  const piiCheck = before.checks.find((c) => c.id === "ZERO_PII_LEAK");
  assert.equal(piiCheck?.status, "BLOCK");
  assert.equal(before.blockCount, 1);
  assert.ok(piiCheck && piiCheck.findings.length > 0);
  assert.ok(!piiCheck.findings[0].excerpt.includes("0812-0000-4411"));

  const repaired = repairDraftPii(leaked);
  assert.ok(!repaired.communityAlertId.whatsappShortText.includes("Hendra Santoso"));
  assert.ok(!repaired.communityAlertId.whatsappShortText.includes("0812-0000-4411"));
  assert.ok(!repaired.communityAlertId.whatsappShortText.includes("@hendra_ops"));
  assert.ok(!repaired.communityAlertId.whatsappShortText.includes("Jl. Melati No. 14"));

  const after = evaluateBroadcastSafetyGate(repaired, [makeIntake()]);
  assert.equal(after.checks.find((c) => c.id === "ZERO_PII_LEAK")?.status, "PASS");
});

test("Rumor Safety Guard blocks zero-source definitive verdicts and unhedged all-clear claims, then repairs cleanly", () => {
  const rumorIntake = makeIntake({
    id: "intake-rumor",
    mode: "RUMOR_CHECK",
    structured: {
      ...makeIntake().structured,
      rumorVerdict: "UNVERIFIED_DEVELOPING",
      groundingSources: [],
    },
  });

  const unsafeDraft = makeCleanDraft({
    mediaPressReleaseId: {
      ...makeCleanDraft().mediaPressReleaseId,
      body: "Kondisi bendungan sudah 100% aman. Warga bisa beraktivitas seperti biasa.",
    },
    debunkCard: {
      hasRumorAlert: true,
      verdict: "VERIFIED",
      claim: "Bendungan Cirata retak dan jebol.",
      factId: "Kabar tersebut hoaks belaka.",
      factEn: "False alarm; situation is confirmed safe.",
      sources: [],
    },
  });

  const before = evaluateBroadcastSafetyGate(unsafeDraft, [rumorIntake]);
  const rumorCheck = before.checks.find((c) => c.id === "RUMOR_SAFETY_GUARD");
  assert.equal(rumorCheck?.status, "BLOCK");
  assert.ok((rumorCheck?.findings.length ?? 0) >= 3);

  const repaired = repairDraftRumorSafety(unsafeDraft);
  assert.equal(repaired.debunkCard.verdict, "UNVERIFIED_DEVELOPING");
  assert.ok(repaired.mediaPressReleaseId.body.length > 0);
  assert.ok(repaired.debunkCard.factId.length > 0);
  assert.ok(repaired.debunkCard.factEn.length > 0);
  assert.ok(!repaired.mediaPressReleaseId.body.includes("100% aman"));

  const after = evaluateBroadcastSafetyGate(repaired, [rumorIntake]);
  assert.equal(after.checks.find((c) => c.id === "RUMOR_SAFETY_GUARD")?.status, "PASS");
});

test("Indonesian and English negated or shelter safety phrasing never triggers false blocks", () => {
  const unverifiedIntake = makeIntake({
    id: "intake-rumor-safe-phrases",
    mode: "RUMOR_CHECK",
    structured: {
      ...makeIntake().structured,
      rumorVerdict: "UNVERIFIED_DEVELOPING",
      groundingSources: [],
    },
  });

  const guardedDraft = makeCleanDraft({
    communityAlertId: {
      title: "Arahan Titik Aman Evakuasi",
      whatHappened:
        "Cari tempat aman dan ikuti rute aman menuju posko. Amankan barang berharga.",
      doNow: ["Utamakan keamanan warga di lapangan terbuka."],
      avoid: ["Jalur tidak aman karena retakan tanah."],
      whatsappShortText:
        "Kondisi belum aman dan status belum dipastikan aman. Jangan kembali sebelum ada rilis resmi.",
    },
    globalSitrepEn: {
      ...makeCleanDraft().globalSitrepEn,
      executiveSummary:
        "Dam integrity is not confirmed safe and clearance remains unconfirmed safe at this hour.",
    },
    debunkCard: {
      hasRumorAlert: true,
      verdict: "UNVERIFIED_DEVELOPING",
      claim: "Claim circulating about dam safety.",
      factId: "Kondisi belum aman dan tidak dipastikan aman oleh pengelola.",
      factEn: "Situation is not confirmed safe by authorities yet.",
      sources: [],
    },
  });

  const evalResult = evaluateBroadcastSafetyGate(guardedDraft, [unverifiedIntake]);
  assert.equal(evalResult.checks.find((c) => c.id === "RUMOR_SAFETY_GUARD")?.status, "PASS");
  assert.equal(evalResult.blockCount, 0);
});

test("Peak Severity Invariant blocks CRITICAL->MEDIUM/LOW downgrades, warns on 1-step downgrades, and restores cleanly", () => {
  const criticalIntake = makeIntake({
    structured: { ...makeIntake().structured, severity: "CRITICAL" },
  });

  const lowDraft = makeCleanDraft({ severity: "LOW" });
  const lowEval = evaluateBroadcastSafetyGate(lowDraft, [criticalIntake]);
  assert.equal(
    lowEval.checks.find((c) => c.id === "PEAK_SEVERITY_INVARIANT")?.status,
    "BLOCK",
  );

  const highDraft = makeCleanDraft({ severity: "HIGH" });
  const highEval = evaluateBroadcastSafetyGate(highDraft, [criticalIntake]);
  assert.equal(
    highEval.checks.find((c) => c.id === "PEAK_SEVERITY_INVARIANT")?.status,
    "WARN",
  );

  const restored = repairDraftSeverity(lowDraft, "CRITICAL");
  const restoredEval = evaluateBroadcastSafetyGate(restored, [criticalIntake]);
  assert.equal(
    restoredEval.checks.find((c) => c.id === "PEAK_SEVERITY_INVARIANT")?.status,
    "PASS",
  );
});

test("Gap & Offline-Draft Disclosure detects omitted gaps and Offline draft intakes, then injects deduplicated gaps capped at 20", () => {
  const offlineDraftIntake = makeIntake({
    id: "intake-offline",
    structured: {
      ...makeIntake().structured,
      headline: "Offline draft: Flash flood water level rising in Dayeuhkolot",
      verificationGaps: [
        "Korban luka di dusun terluar belum terkonfirmasi",
        "Debit sungai Citarum menunggu pembacaan resmi",
      ],
    },
  });

  const draft = makeCleanDraft({
    globalSitrepEn: {
      ...makeCleanDraft().globalSitrepEn,
      informationGaps: Array.from({ length: 19 }, (_, idx) => `Existing gap #${idx + 1}`),
    },
  });

  const before = evaluateBroadcastSafetyGate(draft, [offlineDraftIntake]);
  const gapCheck = before.checks.find((c) => c.id === "GAP_DISCLOSURE_CHECK");
  assert.equal(gapCheck?.status, "WARN");
  assert.equal(before.offlineDraftIntakeCount, 1);
  assert.equal(before.missingGaps.length, 3);

  const repaired = repairDraftMissingGaps(draft, before.missingGaps);
  assert.equal(repaired.globalSitrepEn.informationGaps.length, 20);

  const smallerDraft = makeCleanDraft({
    globalSitrepEn: {
      ...makeCleanDraft().globalSitrepEn,
      informationGaps: [],
    },
  });
  const smallerBefore = evaluateBroadcastSafetyGate(smallerDraft, [offlineDraftIntake]);
  const smallerRepaired = repairDraftMissingGaps(
    smallerDraft,
    smallerBefore.missingGaps,
  );
  const after = evaluateBroadcastSafetyGate(smallerRepaired, [offlineDraftIntake]);
  assert.equal(after.missingGaps.length, 0);
  assert.equal(after.checks.find((c) => c.id === "GAP_DISCLOSURE_CHECK")?.status, "WARN");
});

test("drill fault injection trips Zero-PII, Rumor Safety, and Peak Severity and deterministic repairs clear all blocks", () => {
  const criticalIntake = makeIntake({
    structured: { ...makeIntake().structured, severity: "CRITICAL" },
  });
  const drilled = injectSafetyGateDrillFault(makeCleanDraft());

  const brokenEval = evaluateBroadcastSafetyGate(drilled, [criticalIntake]);
  assert.equal(brokenEval.checks.find((c) => c.id === "ZERO_PII_LEAK")?.status, "BLOCK");
  assert.equal(brokenEval.checks.find((c) => c.id === "RUMOR_SAFETY_GUARD")?.status, "BLOCK");
  assert.equal(
    brokenEval.checks.find((c) => c.id === "PEAK_SEVERITY_INVARIANT")?.status,
    "BLOCK",
  );
  assert.equal(brokenEval.blockCount, 3);

  let fixed = repairDraftPii(drilled);
  fixed = repairDraftRumorSafety(fixed);
  fixed = repairDraftSeverity(fixed, brokenEval.peakIntakeSeverity ?? "CRITICAL");
  fixed = repairDraftMissingGaps(fixed, brokenEval.missingGaps);

  const finalEval = evaluateBroadcastSafetyGate(fixed, [criticalIntake]);
  assert.equal(finalEval.blockCount, 0);
  assert.equal(finalEval.warnCount, 0);
  assert.equal(finalEval.passCount, 4);
});

test("formatDispatchMarkdown appends Section 5 verification receipt when provided and omits it when absent", () => {
  const clean = makeCleanDraft();
  const basePayload = {
    dispatchNumber: 2,
    severity: clean.severity,
    inferenceSource: "IN_CLOUD" as const,
    incidentTitle: "West Java M6.2 Earthquake",
    region: "West Java, Indonesia",
    modelUsed: "gemini-3.8-flash",
    communityAlertId: clean.communityAlertId,
    mediaPressReleaseId: clean.mediaPressReleaseId,
    globalSitrepEn: clean.globalSitrepEn,
    debunkCard: clean.debunkCard,
  };

  const withoutReceipt = formatDispatchMarkdown(basePayload);
  assert.ok(!withoutReceipt.includes("## 5. Pre-Publish Safety Gate Verification"));
  assert.ok(!withoutReceipt.includes("\u2014"));

  const evalResult = evaluateBroadcastSafetyGate(clean, [makeIntake()]);
  const receipt = buildSafetyGateReceipt(evalResult, {
    simulatedFaultUsed: true,
    repairsApplied: ["Auto-scrubbed PII across 4 audiences"],
    commanderSignedOff: true,
  });
  const withReceipt = formatDispatchMarkdown({
    ...basePayload,
    safetyGate: receipt,
  });

  assert.ok(withReceipt.includes("## 5. Pre-Publish Safety Gate Verification"));
  assert.ok(withReceipt.includes("Yes (Synthetic Drill)"));
  assert.ok(withReceipt.includes("Auto-scrubbed PII across 4 audiences"));
  assert.ok(withReceipt.includes("Confirmed"));
  assert.ok(withReceipt.includes("[PASS] Zero-PII Leak Guard"));
  assert.ok(!withReceipt.includes("\u2014"));
});
