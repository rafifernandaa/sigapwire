import assert from "node:assert/strict";
import test from "node:test";
import {
  appendProvenanceSealToWhatsapp,
  computeDispatchProvenance,
  computeIntakeEvidenceSha256,
  extractProvenanceCodeFromQuery,
  PROVENANCE_CODE_REGEX,
  SHA256_HEX_REGEX,
  verifyDispatchProvenance,
} from "../src/lib/crisisProvenance.ts";
import type { DispatchDoc, IntakeDoc } from "../src/types/sigapwire.ts";

function makeIntake(id: string, evidenceSha256?: string): IntakeDoc {
  return {
    id,
    incidentId: "inc_westjava_drill_2026",
    mode: "FIELD_REPORT",
    sourcePlatform: "APPLE",
    inferenceSource: "ON_DEVICE",
    inferenceModeRequested: "PREFER_ON_DEVICE",
    latencyMs: 310,
    piiRedactedLocally: true,
    redactionCount: 3,
    sanitizedText: "Jembatan Sukamaju retak, akses maks 3 ton.",
    hasAttachment: false,
    evidenceSha256: evidenceSha256 ?? null,
    structured: {
      headline: "Jembatan Sukamaju retak",
      hazardType: "EARTHQUAKE",
      location: "Sukamaju, Cugenang",
      severity: "HIGH",
      summaryId: "Jembatan dibatasi 3 ton.",
      summaryEn: "Bridge capped at 3 tons.",
      keyFacts: ["Kapasitas 3 ton"],
      urgentNeeds: ["Air bersih"],
      verificationGaps: [],
      rumorVerdict: "NOT_APPLICABLE",
      panicSignals: [],
      groundingSources: [{ title: "BMKG", uri: "https://www.bmkg.go.id/" }],
      searchEntryPointHtml: null,
    },
    status: "INCLUDED_IN_DISPATCH",
    createdBy: "apple-uid",
    createdAt: new Date("2026-11-25T01:00:00Z"),
  };
}

function makeDispatch(overrides: Partial<DispatchDoc> = {}): DispatchDoc {
  return {
    id: "disp-1",
    incidentId: "inc_westjava_drill_2026",
    dispatchNumber: 2,
    severity: "HIGH",
    sourceIntakeIds: ["in-1"],
    inferenceSource: "IN_CLOUD",
    communityAlertId: {
      title: "Peringatan Gempa M6.2 Cianjur",
      whatHappened: "Jembatan utama dibatasi 3 ton.",
      doNow: ["Gunakan jalur utara"],
      avoid: ["Kendaraan berat di jembatan"],
      whatsappShortText: "Peringatan gempa M6.2 Cianjur.",
    },
    mediaPressReleaseId: {
      headline: "Press Release #2",
      dateline: "CIANJUR, 25 Nov 2026",
      body: "Ringkasan pers.",
      keyMetrics: ["3 ton limit"],
    },
    globalSitrepEn: {
      headline: "West Java M6.2 SitRep #2",
      executiveSummary: "Bridge load limit 3 tons verified.",
      impactOverview: ["Bridge crack"],
      priorityNeeds: ["Clean water"],
      informationGaps: [],
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
    publishedAt: new Date("2026-11-25T01:10:00Z"),
    ...overrides,
  };
}

test("computeIntakeEvidenceSha256 is deterministic and changes when image bytes change", async () => {
  const h1 = await computeIntakeEvidenceSha256({
    sanitizedText: "Jembatan Sukamaju retak",
    mode: "FIELD_REPORT",
    sourcePlatform: "WEB",
    redactionCount: 2,
    imageBytes: new Uint8Array([1, 2, 3, 4]),
  });
  const h2 = await computeIntakeEvidenceSha256({
    sanitizedText: "Jembatan Sukamaju retak",
    mode: "FIELD_REPORT",
    sourcePlatform: "WEB",
    redactionCount: 2,
    imageBytes: new Uint8Array([1, 2, 3, 4]),
  });
  const h3 = await computeIntakeEvidenceSha256({
    sanitizedText: "Jembatan Sukamaju retak",
    mode: "FIELD_REPORT",
    sourcePlatform: "WEB",
    redactionCount: 2,
    imageBytes: new Uint8Array([1, 2, 3, 5]),
  });

  assert.match(h1, SHA256_HEX_REGEX);
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
});

test("computeDispatchProvenance generates valid seal code and verifyDispatchProvenance detects tampering", async () => {
  const intakeHash = await computeIntakeEvidenceSha256({
    sanitizedText: "Jembatan Sukamaju retak, akses maks 3 ton.",
    mode: "FIELD_REPORT",
    sourcePlatform: "APPLE",
    redactionCount: 3,
  });
  const intake = makeIntake("in-1", intakeHash);
  const baseDispatch = makeDispatch();

  const { manifestSha256, provenanceCode } = await computeDispatchProvenance({
    dispatchNumber: baseDispatch.dispatchNumber,
    incidentId: baseDispatch.incidentId,
    severity: baseDispatch.severity,
    sourceIntakeIds: baseDispatch.sourceIntakeIds,
    sourceEvidenceHashes: [intakeHash],
    communityAlertId: baseDispatch.communityAlertId,
    globalSitrepEn: baseDispatch.globalSitrepEn,
    debunkCard: baseDispatch.debunkCard,
  });

  assert.match(manifestSha256, SHA256_HEX_REGEX);
  assert.match(provenanceCode, PROVENANCE_CODE_REGEX);

  const sealedDispatch = makeDispatch({
    manifestSha256,
    provenanceCode,
    communityAlertId: {
      ...baseDispatch.communityAlertId,
      whatsappShortText: appendProvenanceSealToWhatsapp(
        baseDispatch.communityAlertId.whatsappShortText,
        provenanceCode,
      ),
    },
  });

  const verified = await verifyDispatchProvenance({
    dispatch: sealedDispatch,
    linkedIntakes: [intake],
  });
  assert.equal(verified.status, "VERIFIED_INTACT");
  assert.equal(verified.totalPiiKeptOnDevice, 3);
  assert.equal(verified.onDeviceIntakeCount, 1);
  assert.equal(verified.hashedEvidenceCount, 1);
  assert.deepEqual(verified.platforms, ["APPLE"]);

  // Tamper with a single safety number in the community alert copy
  const tamperedDispatch = makeDispatch({
    manifestSha256,
    provenanceCode,
    communityAlertId: {
      ...sealedDispatch.communityAlertId,
      whatHappened: "Jembatan utama dibatasi 30 ton.",
    },
  });
  const tamperedReport = await verifyDispatchProvenance({
    dispatch: tamperedDispatch,
    linkedIntakes: [intake],
  });
  assert.equal(tamperedReport.status, "TAMPER_MISMATCH");

  // Older dispatch without stored manifest stays gracefully labeled LEGACY_UNSEALED
  const legacyReport = await verifyDispatchProvenance({
    dispatch: baseDispatch,
    linkedIntakes: [intake],
  });
  assert.equal(legacyReport.status, "LEGACY_UNSEALED");
});

test("extractProvenanceCodeFromQuery parses bare codes and full pasted WhatsApp messages", () => {
  assert.equal(
    extractProvenanceCodeFromQuery("sigap-d2-a1b2c3"),
    "SIGAP-D2-A1B2C3",
  );
  assert.equal(
    extractProvenanceCodeFromQuery(
      "Peringatan Gempa M6.2 Cianjur.\nSeal: SIGAP-D14-9F0E2A\nBagikan ke warga.",
    ),
    "SIGAP-D14-9F0E2A",
  );
  assert.equal(extractProvenanceCodeFromQuery("No seal code here"), null);
});
