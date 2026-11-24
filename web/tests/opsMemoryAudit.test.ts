import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAreaKnowledgeBlock,
  MAX_INJECTED_AREA_CHARS,
  MAX_INJECTED_AREA_FACTS,
} from "../src/lib/areaKnowledgeContext.ts";
import {
  buildUnifiedAuditTrail,
  formatIncidentAuditMarkdown,
} from "../src/lib/auditTrail.ts";
import type {
  AreaKnowledgeDoc,
  DispatchDoc,
  IntakeDoc,
  SessionAuditEvent,
  VerificationTaskDoc,
} from "../src/types/sigapwire.ts";

function makeFact(
  id: string,
  overrides: Partial<AreaKnowledgeDoc> = {},
): AreaKnowledgeDoc {
  return {
    id,
    incidentId: "inc_westjava_drill_2026",
    fact: `Verified field fact ${id}`,
    category: "ROUTE_ACCESS",
    sourceType: "HUMAN_DIRECT",
    sourceTaskId: null,
    active: true,
    createdBy: "cmd-uid",
    createdAt: new Date("2026-11-24T01:00:00Z"),
    updatedAt: new Date("2026-11-24T01:00:00Z"),
    ...overrides,
  };
}

test("formatAreaKnowledgeBlock excludes paused facts, labels [AK-N], and caps count and char budget", () => {
  const facts: AreaKnowledgeDoc[] = [
    makeFact("paused-1", { active: false, fact: "Should not appear" }),
    ...Array.from({ length: 12 }, (_, idx) =>
      makeFact(`fact-${idx + 1}`, {
        fact: `Sukamaju northern ring bridge load cap ${idx + 1} tons with dry surface access verified by field crew.`,
        category: idx % 2 === 0 ? "ROUTE_ACCESS" : "SAFETY_CONSTRAINT",
      }),
    ),
  ];

  const formatted = formatAreaKnowledgeBlock(facts);
  assert.ok(!formatted.block.includes("Should not appear"));
  assert.ok(formatted.block.includes("[AK-1]"));
  assert.ok(formatted.includedCount <= MAX_INJECTED_AREA_FACTS);
  assert.ok(formatted.block.length <= MAX_INJECTED_AREA_CHARS);
  assert.ok(formatted.estimatedTokens > 0);
});

test("buildUnifiedAuditTrail derives multi-platform operational lifecycle events and sorts newest-first", () => {
  const intakes: IntakeDoc[] = [
    {
      id: "in-1",
      incidentId: "inc_westjava_drill_2026",
      mode: "RUMOR_CHECK",
      sourcePlatform: "APPLE",
      inferenceSource: "ON_DEVICE",
      inferenceModeRequested: "PREFER_ON_DEVICE",
      latencyMs: 410,
      piiRedactedLocally: true,
      redactionCount: 3,
      sanitizedText: "Sanitized rumor text",
      hasAttachment: false,
      structured: {
        headline: "Unverified Cirata dam rumor",
        hazardType: "FLOOD",
        location: "Cirata",
        severity: "HIGH",
        summaryId: "Ringkasan rumor.",
        summaryEn: "Rumor summary.",
        keyFacts: ["Klaim tanggul retak"],
        urgentNeeds: ["Check PJT II"],
        verificationGaps: ["No official operator statement"],
        rumorVerdict: "UNVERIFIED_DEVELOPING",
        panicSignals: ["ALL CAPS urgency"],
        groundingSources: [
          { title: "BMKG", uri: "https://www.bmkg.go.id/" },
        ],
        searchEntryPointHtml: null,
      },
      status: "VERIFIED",
      createdBy: "apple-uid",
      createdAt: new Date("2026-11-24T01:05:00Z"),
      pendingSync: true,
    },
  ];

  const tasks: VerificationTaskDoc[] = [
    {
      id: "task-1",
      incidentId: "inc_westjava_drill_2026",
      linkedIntakeId: "in-1",
      question: "Confirm Sukamaju northern bridge weight limit.",
      location: "Cugenang",
      status: "ANSWERED",
      requestedBy: "web-uid",
      requestedPlatform: "WEB",
      answerText: "PUPR sign states 3-ton maximum limit.",
      answerPlatform: "APPLE",
      answerPiiRedactedLocally: true,
      answerRedactionCount: 1,
      answeredBy: "apple-uid",
      answeredAt: new Date("2026-11-24T01:10:00Z"),
      promotedKnowledgeId: null,
      createdAt: new Date("2026-11-24T01:07:00Z"),
      updatedAt: new Date("2026-11-24T01:10:00Z"),
    },
  ];

  const areaKnowledge: AreaKnowledgeDoc[] = [
    makeFact("ak-1", {
      fact: "Sukamaju northern bypass supports light 4x4 vehicles up to 3 tons.",
      sourceType: "PROMOTED_FIELD_CHECK",
      sourceTaskId: "task-1",
      createdAt: new Date("2026-11-24T01:12:00Z"),
    }),
  ];

  const dispatches: DispatchDoc[] = [
    {
      id: "disp-1",
      incidentId: "inc_westjava_drill_2026",
      dispatchNumber: 1,
      severity: "HIGH",
      sourceIntakeIds: ["in-1"],
      inferenceSource: "IN_CLOUD",
      communityAlertId: {
        title: "Update Darurat",
        whatHappened: "Ringkasan.",
        doNow: ["Ikuti jalur aman"],
        avoid: ["Hindari jembatan utama"],
        whatsappShortText: "WA copy.",
      },
      mediaPressReleaseId: {
        headline: "Rilis Pers",
        dateline: "CIANJUR",
        body: "Isi rilis.",
        keyMetrics: ["1 posko aktif"],
      },
      globalSitrepEn: {
        headline: "SitRep #1",
        executiveSummary: "Summary.",
        impactOverview: ["Access restricted"],
        priorityNeeds: ["Water"],
        informationGaps: ["None"],
      },
      debunkCard: {
        hasRumorAlert: false,
        verdict: "NOT_APPLICABLE",
        claim: "",
        factId: "",
        factEn: "",
        sources: [],
      },
      groundingSearchHtml: null,
      publishedBy: "web-uid",
      publishedAt: new Date("2026-11-24T01:15:00Z"),
    },
  ];

  const sessionEvents: SessionAuditEvent[] = [
    {
      id: "sess-1",
      timestamp: new Date("2026-11-24T01:20:00Z"),
      category: "HUMAN_GATE",
      eventType: "SAFETY_GATE_REPAIRED",
      title: "Auto-scrubbed PII across 4 audiences",
      detail: "Applied deterministic repair before publish.",
    },
  ];

  const trail = buildUnifiedAuditTrail({
    intakes,
    verificationTasks: tasks,
    areaKnowledge,
    dispatches,
    sessionEvents,
  });

  const types = trail.map((e) => e.eventType);
  assert.ok(types.includes("PII_SCRUBBED_LOCAL"));
  assert.ok(types.includes("OFFLINE_QUEUED"));
  assert.ok(types.includes("TRIAGE_ROUTED"));
  assert.ok(types.includes("RUMOR_GROUNDED"));
  assert.ok(types.includes("FIELD_TASK_REQUESTED"));
  assert.ok(types.includes("FIELD_TASK_ANSWERED"));
  assert.ok(types.includes("AREA_KNOWLEDGE_RECORDED"));
  assert.ok(types.includes("DISPATCH_PUBLISHED"));
  assert.ok(types.includes("SAFETY_GATE_REPAIRED"));
  assert.equal(trail[0].eventType, "SAFETY_GATE_REPAIRED");

  const markdown = formatIncidentAuditMarkdown({
    incidentTitle: "West Java M6.2 Earthquake",
    region: "Cianjur, West Java",
    intakes,
    verificationTasks: tasks,
    areaKnowledge,
    dispatches,
    events: trail,
  });

  const EM_DASH = String.fromCharCode(0x2014);
  assert.ok(markdown.includes("# SigapWire Incident Audit Dossier"));
  assert.ok(markdown.includes("[AK-1]"));
  assert.ok(markdown.includes("SAFETY_GATE_REPAIRED"));
  assert.ok(!markdown.includes(EM_DASH));
});
