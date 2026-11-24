import assert from "node:assert/strict";
import test from "node:test";
import {
  audioInlinePartToPlayableWav,
  buildRadioScriptForTts,
  parsePcmRateFromMimeType,
  pcm16ToWavBytes,
} from "../src/lib/audioWav.ts";
import {
  detectSuggestedCrisisLanguage,
  extractCriticalNumericTokens,
  normalizeDigitsForSafetyCheck,
  verifyTranslationNumericSafety,
} from "../src/lib/crisisTranslation.ts";
import { computeHybridScorecard } from "../src/lib/hybridScorecard.ts";
import type {
  DispatchDoc,
  IntakeDoc,
  SessionAuditEvent,
  VerificationTaskDoc,
} from "../src/types/sigapwire.ts";

test("parsePcmRateFromMimeType extracts sample rate and clamps invalid bounds", () => {
  assert.equal(parsePcmRateFromMimeType("audio/L16;codec=pcm;rate=24000"), 24000);
  assert.equal(parsePcmRateFromMimeType("audio/pcm; RATE=16000"), 16000);
  assert.equal(parsePcmRateFromMimeType("audio/pcm"), 24000);
  assert.equal(parsePcmRateFromMimeType("audio/pcm;rate=2000"), 8000);
  assert.equal(parsePcmRateFromMimeType("audio/pcm;rate=192000"), 96000);
});

test("pcm16ToWavBytes prepends a valid 44-byte RIFF/WAVE header and sample rate", () => {
  const pcm = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const wav = pcm16ToWavBytes(pcm, 24000, 1);

  assert.equal(wav.byteLength, 44 + pcm.byteLength);
  assert.equal(String.fromCharCode(wav[0], wav[1], wav[2], wav[3]), "RIFF");
  assert.equal(String.fromCharCode(wav[8], wav[9], wav[10], wav[11]), "WAVE");
  assert.equal(String.fromCharCode(wav[12], wav[13], wav[14], wav[15]), "fmt ");
  assert.equal(String.fromCharCode(wav[36], wav[37], wav[38], wav[39]), "data");

  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  assert.equal(view.getUint32(4, true), 36 + pcm.byteLength);
  assert.equal(view.getUint16(20, true), 1); // PCM
  assert.equal(view.getUint16(22, true), 1); // Mono
  assert.equal(view.getUint32(24, true), 24000);
  assert.equal(view.getUint16(34, true), 16); // 16-bit
  assert.equal(view.getUint32(40, true), pcm.byteLength);
  assert.deepEqual(Array.from(wav.slice(44)), [1, 2, 3, 4, 5, 6]);
});

test("audioInlinePartToPlayableWav wraps raw PCM payloads and passes audio/wav through", () => {
  const rawPcmBase64 = Buffer.from([10, 20, 30, 40]).toString("base64");
  const wrapped = audioInlinePartToPlayableWav({
    mimeType: "audio/L16;codec=pcm;rate=16000",
    data: rawPcmBase64,
  });
  assert.equal(wrapped.mimeType, "audio/wav");
  assert.equal(wrapped.sampleRate, 16000);
  assert.equal(wrapped.bytes.byteLength, 48);

  const preEncodedWav = Buffer.from("RIFF_EXISTING_WAV").toString("base64");
  const passthrough = audioInlinePartToPlayableWav({
    mimeType: "audio/wav",
    data: preEncodedWav,
  });
  assert.equal(passthrough.mimeType, "audio/wav");
  assert.equal(
    Buffer.from(passthrough.bytes).toString("utf8"),
    "RIFF_EXISTING_WAV",
  );
});

test("buildRadioScriptForTts builds bounded single-speaker and dual-speaker prompts", () => {
  const dual = buildRadioScriptForTts({
    dispatchNumber: 4,
    title: "Peringatan Gempa M6.2 Cianjur",
    whatHappened: "Jembatan utama dibatasi 3 ton.",
    doNow: ["Menjauh dari bangunan retak", "Siapkan air bersih"],
    avoid: ["Sebarkan info tanpa sumber"],
    languageName: "Sundanese (Basa Sunda)",
    debunkCard: {
      hasRumorAlert: true,
      verdict: "MISLEADING",
      claim: "Bendungan Cirata jebol",
      factId: "PJT II memastikan bendungan aman.",
      factEn: "Operator confirms dam intact.",
    },
    dualSpeaker: true,
  });

  assert.ok(dual.includes("Anchor:"));
  assert.ok(dual.includes("Verifier:"));
  assert.ok(dual.includes("Sundanese (Basa Sunda)"));
  assert.ok(dual.length <= 1400);

  const longSingle = buildRadioScriptForTts({
    dispatchNumber: 5,
    title: "Alert ".repeat(300),
    whatHappened: "Long update ".repeat(200),
    doNow: ["Action 1", "Action 2", "Action 3", "Action 4"],
    avoid: ["Avoid 1"],
    languageName: "English",
    dualSpeaker: false,
  });
  assert.ok(!longSingle.includes("Anchor:"));
  assert.ok(!longSingle.includes("Action 4"));
  assert.ok(longSingle.length <= 1400);
});

test("detectSuggestedCrisisLanguage maps non-Indonesian browser locales cleanly", () => {
  assert.equal(detectSuggestedCrisisLanguage("en-US"), "en");
  assert.equal(detectSuggestedCrisisLanguage("ja-JP"), "ja");
  assert.equal(detectSuggestedCrisisLanguage("ko"), "ko");
  assert.equal(detectSuggestedCrisisLanguage("ar-SA"), "ar");
  assert.equal(detectSuggestedCrisisLanguage("su-ID"), "su");
  assert.equal(detectSuggestedCrisisLanguage("jv"), "jv");
  assert.equal(detectSuggestedCrisisLanguage("id-ID"), null);
  assert.equal(detectSuggestedCrisisLanguage("in-ID"), null);
  assert.equal(detectSuggestedCrisisLanguage("fr-FR"), null);
  assert.equal(detectSuggestedCrisisLanguage(undefined), null);
});

test("verifyTranslationNumericSafety validates numbers including Arabic-Indic numerals and catches drops", () => {
  const source =
    "Gempa M6.2 pukul 14.05 WIB. Jembatan [AK-1] maksimal 3 ton. Hubungi darurat 112 atau 35 posko.";

  assert.equal(
    normalizeDigitsForSafetyCheck("زلزال ٦.٢ الساعة ١٤.٠٥"),
    "زلزال 6.2 الساعة 14.05",
  );
  assert.deepEqual(extractCriticalNumericTokens("M6.2 [AK-1] 112"), [
    "m6.2",
    "[ak-1]",
    "112",
  ]);

  const arabicPass = verifyTranslationNumericSafety(
    source,
    "زلزال M٦.٢ الساعة ١٤.٠٥. جسر [AK-1] حد أقصى ٣ طن. اتصل بـ ١١٢ أو ٣٥ مركزاً.",
  );
  assert.equal(arabicPass.passed, true);
  assert.deepEqual(arabicPass.missingTokens, []);

  const commaDecimalPass = verifyTranslationNumericSafety(
    "Gempa M6.2 dan akses [AK-1].",
    "Lini M6,2 sarta aksés [AK-1].",
  );
  assert.equal(commaDecimalPass.passed, true);

  const droppedFigure = verifyTranslationNumericSafety(
    "Gempa M6.2 di [AK-1] hubungi 112.",
    "Strong earthquake reported near evacuation bridge.",
  );
  assert.equal(droppedFigure.passed, false);
  assert.deepEqual(droppedFigure.missingTokens, ["m6.2", "[ak-1]", "112"]);
});

test("computeHybridScorecard returns exact zeros on empty state and real aggregates otherwise", () => {
  const empty = computeHybridScorecard({
    intakes: [],
    verificationTasks: [],
    dispatches: [],
    sessionEvents: [],
  });
  assert.equal(empty.onDeviceExecutions, 0);
  assert.equal(empty.inCloudExecutions, 0);
  assert.equal(empty.onDeviceSharePct, 0);
  assert.equal(empty.totalPiiBlockedLocally, 0);
  assert.equal(empty.cloudCallsAvoided, 0);
  assert.equal(empty.humanGateActions, 0);
  assert.equal(empty.lastHandoffLabel, "Awaiting first intake or broadcast");

  const intakes: IntakeDoc[] = [
    {
      id: "i1",
      incidentId: "inc_1",
      mode: "RUMOR_CHECK",
      sourcePlatform: "APPLE",
      inferenceSource: "ON_DEVICE",
      inferenceModeRequested: "PREFER_ON_DEVICE",
      latencyMs: 320,
      piiRedactedLocally: true,
      redactionCount: 4,
      sanitizedText: "Sanitized rumor",
      hasAttachment: false,
      structured: {
        headline: "Rumor A",
        hazardType: "EARTHQUAKE",
        location: "Cugenang",
        severity: "HIGH",
        summaryId: "Ringkasan",
        summaryEn: "Summary",
        keyFacts: ["F1"],
        urgentNeeds: [],
        verificationGaps: ["Gap 1"],
        rumorVerdict: "UNVERIFIED_DEVELOPING",
        panicSignals: [],
        groundingSources: [{ title: "BMKG", uri: "https://bmkg.go.id/" }],
        searchEntryPointHtml: null,
      },
      status: "VERIFIED",
      createdBy: "u1",
      createdAt: new Date("2026-11-24T01:00:00Z"),
      pendingSync: true,
    },
    {
      id: "i2",
      incidentId: "inc_1",
      mode: "FIELD_REPORT",
      sourcePlatform: "ANDROID",
      inferenceSource: "IN_CLOUD",
      inferenceModeRequested: "PREFER_ON_DEVICE",
      latencyMs: 650,
      piiRedactedLocally: true,
      redactionCount: 2,
      sanitizedText: "Sanitized report",
      hasAttachment: false,
      structured: {
        headline: "Report B",
        hazardType: "EARTHQUAKE",
        location: "Sukamaju",
        severity: "CRITICAL",
        summaryId: "Ringkasan 2",
        summaryEn: "Summary 2",
        keyFacts: ["F2"],
        urgentNeeds: ["Water"],
        verificationGaps: [],
        rumorVerdict: "NOT_APPLICABLE",
        panicSignals: [],
        groundingSources: [],
        searchEntryPointHtml: null,
      },
      status: "TRIAGED",
      createdBy: "u2",
      createdAt: new Date("2026-11-24T01:05:00Z"),
    },
  ];

  const verificationTasks: VerificationTaskDoc[] = [
    {
      id: "t1",
      incidentId: "inc_1",
      linkedIntakeId: "i1",
      question: "Confirm bridge tonnage",
      location: "Sukamaju",
      status: "PROMOTED",
      requestedBy: "web",
      requestedPlatform: "WEB",
      answerText: "Max 3 tons.",
      answerPlatform: "APPLE",
      answerPiiRedactedLocally: true,
      answerRedactionCount: 3,
      answeredBy: "u1",
      answeredAt: new Date("2026-11-24T01:10:00Z"),
      promotedKnowledgeId: "ak1",
      createdAt: new Date("2026-11-24T01:06:00Z"),
      updatedAt: new Date("2026-11-24T01:12:00Z"),
    },
  ];

  const dispatches: DispatchDoc[] = [
    {
      id: "d1",
      incidentId: "inc_1",
      dispatchNumber: 1,
      severity: "CRITICAL",
      sourceIntakeIds: ["i1", "i2"],
      inferenceSource: "IN_CLOUD",
      communityAlertId: {
        title: "T",
        whatHappened: "W",
        doNow: ["D"],
        avoid: ["A"],
        whatsappShortText: "S",
      },
      mediaPressReleaseId: {
        headline: "H",
        dateline: "D",
        body: "B",
        keyMetrics: [],
      },
      globalSitrepEn: {
        headline: "G",
        executiveSummary: "E",
        impactOverview: [],
        priorityNeeds: [],
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
      publishedBy: "web",
      publishedAt: new Date("2026-11-24T01:15:00Z"),
    },
  ];

  const sessionEvents: SessionAuditEvent[] = [
    {
      id: "s1",
      timestamp: new Date("2026-11-24T01:20:00Z"),
      category: "IN_CLOUD",
      eventType: "RADIO_AUDIO_GENERATED",
      title: "Radio Audio for Dispatch #1 (Basa Sunda)",
      detail: "gemini-3.8-flash-tts (24000Hz WAV, 900ms)",
    },
    {
      id: "s2",
      timestamp: new Date("2026-11-24T01:18:00Z"),
      category: "ON_DEVICE",
      eventType: "OFFLINE_DRAFT_GENERATED",
      title: "Offline Deterministic Draft Created",
      detail: "Draft",
    },
    {
      id: "s3",
      timestamp: new Date("2026-11-24T01:19:00Z"),
      category: "HUMAN_GATE",
      eventType: "COMMANDER_SIGN_OFF",
      title: "Commander Signed Off Dispatch #1",
      detail: "Sign-off confirmed",
    },
  ];

  const scorecard = computeHybridScorecard({
    intakes,
    verificationTasks,
    dispatches,
    sessionEvents,
  });

  // On-device: 2 piiFirewallPasses + 1 onDeviceTriage + 1 taskAnswerScrub + 1 sessionOnDevice = 5
  assert.equal(scorecard.onDeviceExecutions, 5);
  // In-cloud: 1 inCloudTriage + 1 groundedRumor + 1 dispatch + 1 sessionInCloud = 4
  assert.equal(scorecard.inCloudExecutions, 4);
  assert.equal(scorecard.onDeviceSharePct, Math.round((5 / 9) * 100));
  // Total PII: 4 + 2 + 3 = 9
  assert.equal(scorecard.totalPiiBlockedLocally, 9);
  // Cloud calls avoided: 2 piiPasses + 1 taskAnswerScrub + 1 onDeviceTriage + 1 offlineQueued + 1 sessionOnDevice = 6
  assert.equal(scorecard.cloudCallsAvoided, 6);
  // Human gate actions: 3 task lifecycle transitions (requested + answered + promoted) + 1 sessionHumanGate = 4
  assert.equal(scorecard.humanGateActions, 4);
  assert.equal(
    scorecard.lastHandoffLabel,
    "IN_CLOUD: Radio Audio for Dispatch #1 (Basa Sunda)",
  );
});
