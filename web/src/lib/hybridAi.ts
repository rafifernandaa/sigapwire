import {
  getGenerativeModel,
  InferenceMode,
  Schema,
  type GenerativeModel,
} from "firebase/ai";
import { getCachedModelConfig, getFirebaseBundle } from "./firebase";
import { formatAreaKnowledgeBlock } from "./areaKnowledgeContext.ts";
import {
  deterministicLocalPiiScrub,
  type PiiCounters,
} from "./piiScrubber.ts";
export { deterministicLocalPiiScrub, type PiiCounters };
import type {
  AreaKnowledgeDoc,
  CommunityAlertPayload,
  DebunkCardPayload,
  GlobalSitrepPayload,
  GroundingSource,
  HazardType,
  InferenceSourceLabel,
  IntakeDoc,
  IntakeMode,
  LocalPrivacyResult,
  MediaPressReleasePayload,
  OnDeviceDiagnostics,
  RedactionItem,
  RumorVerdict,
  SeverityLevel,
  StructuredIntakeData,
} from "../types/sigapwire";

export const ON_DEVICE_SAFE_INPUT_TOKENS = 2200;
export const IMAGE_TOKEN_ESTIMATE = 300;
const MAX_LOCAL_PRIVACY_SINGLE_CALL_CHARS = 2800;
const LOCAL_PRIVACY_CHUNK_CHARS = 2400;
const MAX_IMAGE_EDGE_PX = 1024;
const READER_SOURCE_MAX_CHARS = 2600;

export interface TokenRouteEvaluation {
  estimatedTokens: number;
  safeLocalLimit: number;
  exceedsLocalBudget: boolean;
}

/**
 * Conservative client-side token estimate tuned for Bahasa Indonesia + English text
 * plus optional image attachment overhead.
 */
export function estimateTokens(text: string, hasImage = false): number {
  const textTokens = text ? Math.ceil(text.length / 3.2) : 0;
  return textTokens + (hasImage ? IMAGE_TOKEN_ESTIMATE : 0);
}

export function evaluateTokenRoute(
  text: string,
  hasImage = false,
): TokenRouteEvaluation {
  const estimatedTokens = estimateTokens(text, hasImage);
  return {
    estimatedTokens,
    safeLocalLimit: ON_DEVICE_SAFE_INPUT_TOKENS,
    exceedsLocalBudget: estimatedTokens > ON_DEVICE_SAFE_INPUT_TOKENS,
  };
}

declare global {
  interface Window {
    LanguageModel?: {
      availability: () => Promise<
        "available" | "downloadable" | "downloading" | "unavailable"
      >;
      create: (opts?: {
        monitor?: (m: EventTarget) => void;
      }) => Promise<{ destroy?: () => void }>;
    };
  }
}

function normalizeInferenceSource(raw: unknown): InferenceSourceLabel {
  if (raw === "ON_DEVICE" || raw === "on_device") return "ON_DEVICE";
  return "IN_CLOUD";
}

function extractJsonFromText(rawText: string): string {
  const trimmed = rawText.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err ?? "Unknown error");
}

function isRateLimitOrQuotaError(err: unknown): boolean {
  const msg = getErrorMessage(err).toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("resource_exhausted") ||
    msg.includes("rate limit") ||
    msg.includes("quota") ||
    msg.includes("too many requests")
  );
}

function isTransientCloudError(err: unknown): boolean {
  const msg = getErrorMessage(err).toLowerCase();
  return (
    isRateLimitOrQuotaError(err) ||
    msg.includes("500") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("high demand") ||
    msg.includes("try again later") ||
    msg.includes("deadline expired") ||
    msg.includes("deadline_exceeded") ||
    msg.includes("unavailable") ||
    msg.includes("overloaded") ||
    msg.includes("timeout")
  );
}

async function runWithCloudModelFallback<T>(
  primaryModel: string,
  fallbackModel: string,
  runner: (modelName: string) => Promise<T>,
): Promise<{ result: T; modelUsed: string }> {
  try {
    return {
      result: await runner(primaryModel),
      modelUsed: primaryModel,
    };
  } catch (err) {
    if (
      isTransientCloudError(err) &&
      fallbackModel &&
      fallbackModel !== primaryModel
    ) {
      try {
        const tag = isRateLimitOrQuotaError(err)
          ? "quota fallback"
          : "timeout/503 fallback";
        return {
          result: await runner(fallbackModel),
          modelUsed: `${fallbackModel} (${tag})`,
        };
      } catch (fallbackErr) {
        throw formatFriendlyAiError(fallbackErr);
      }
    }
    throw formatFriendlyAiError(err);
  }
}

function isOnDeviceLimitError(err: unknown): boolean {
  if (err instanceof SyntaxError) return true;
  const errName =
    err && typeof err === "object" && "name" in err
      ? String((err as { name?: unknown }).name ?? "").toLowerCase()
      : "";
  if (errName === "quotaexceedederror" || errName === "notsupportederror") {
    return true;
  }
  const msg = getErrorMessage(err).toLowerCase();
  return (
    msg.includes("token") ||
    msg.includes("too long") ||
    msg.includes("too large") ||
    msg.includes("context") ||
    msg.includes("quota") ||
    msg.includes("limit") ||
    msg.includes("exceeded") ||
    msg.includes("json") ||
    msg.includes("unavailable") ||
    msg.includes("notsupported")
  );
}

function formatFriendlyAiError(err: unknown): Error {
  const raw = getErrorMessage(err);
  if (isRateLimitOrQuotaError(err)) {
    return new Error(
      `Cloud Gemini free-tier rate or token quota reached (429 / RESOURCE_EXHAUSTED). Wait 15 to 30 seconds and retry, or keep prompts under ${ON_DEVICE_SAFE_INPUT_TOKENS} estimated tokens to run locally on Chrome Gemini Nano at zero cloud quota. (${raw})`,
    );
  }
  return err instanceof Error ? err : new Error(raw);
}

async function readFileAsInlineData(file: File): Promise<{
  type: "inlineData";
  inlineData: { data: string; mimeType: string };
}> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const commaIdx = result.indexOf(",");
      if (commaIdx === -1) {
        reject(new Error("Failed to read image file as base64."));
        return;
      }
      resolve(result.slice(commaIdx + 1));
    };
    reader.onerror = () => reject(new Error("Could not read image attachment."));
    reader.readAsDataURL(file);
  });

  return {
    type: "inlineData",
    inlineData: {
      data: base64,
      mimeType: file.type || "image/jpeg",
    },
  };
}

/**
 * Downscales JPEG/PNG images on-device via canvas (max 1024px long edge, JPEG 0.82)
 * to stay well within both on-device Nano and Cloud free-tier token budgets.
 */
async function fileToInlinePart(file: File): Promise<{
  type: "inlineData";
  inlineData: { data: string; mimeType: string };
}> {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    return readFileAsInlineData(file);
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const imageEl = new Image();
      imageEl.onload = () => resolve(imageEl);
      imageEl.onerror = () => reject(new Error("Canvas image decode failed"));
      imageEl.src = objectUrl;
    });

    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    if (!srcW || !srcH) {
      return readFileAsInlineData(file);
    }

    const longEdge = Math.max(srcW, srcH);
    const scale = longEdge > MAX_IMAGE_EDGE_PX ? MAX_IMAGE_EDGE_PX / longEdge : 1;
    const targetW = Math.max(1, Math.round(srcW * scale));
    const targetH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return readFileAsInlineData(file);
    }

    ctx.drawImage(img, 0, 0, targetW, targetH);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    const commaIdx = dataUrl.indexOf(",");
    if (commaIdx === -1) {
      return readFileAsInlineData(file);
    }

    return {
      type: "inlineData",
      inlineData: {
        data: dataUrl.slice(commaIdx + 1),
        mimeType: "image/jpeg",
      },
    };
  } catch {
    return readFileAsInlineData(file);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function splitLongPiece(text: string, maxChars: number): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const parts: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) {
        parts.push(current);
        current = "";
      }
      let remaining = sentence;
      while (remaining.length > maxChars) {
        let cut = remaining.lastIndexOf(" ", maxChars);
        if (cut < Math.floor(maxChars * 0.5)) cut = maxChars;
        parts.push(remaining.slice(0, cut).trim());
        remaining = remaining.slice(cut).trim();
      }
      if (remaining) current = remaining;
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) parts.push(current);
      current = sentence;
    }
  }

  if (current) parts.push(current);
  return parts;
}

function splitTextIntoLocalChunks(
  rawText: string,
  maxChars = LOCAL_PRIVACY_CHUNK_CHARS,
): string[] {
  if (rawText.length <= MAX_LOCAL_PRIVACY_SINGLE_CALL_CHARS) {
    return [rawText];
  }

  const lines = rawText.split(/\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      const subPieces = splitLongPiece(line, maxChars);
      chunks.push(...subPieces);
      continue;
    }

    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      current = line;
    }
  }

  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [rawText];
}

export async function checkOnDeviceDiagnostics(): Promise<OnDeviceDiagnostics> {
  const online = typeof navigator !== "undefined" ? navigator.onLine : true;
  if (typeof window === "undefined" || !window.LanguageModel) {
    return {
      browserSupported: false,
      availability: "unsupported",
      downloadProgress: null,
      online,
    };
  }

  try {
    const availability = await window.LanguageModel.availability();
    return {
      browserSupported: true,
      availability,
      downloadProgress: availability === "available" ? 1 : null,
      online,
    };
  } catch {
    return {
      browserSupported: true,
      availability: "unavailable",
      downloadProgress: null,
      online,
    };
  }
}

/**
 * Must be called from a user gesture (e.g., button click) per Chrome Prompt API
 * user-activation requirements.
 */
export async function triggerOnDeviceModelInit(
  onProgress?: (fraction: number) => void,
): Promise<boolean> {
  try {
    const { ai } = getFirebaseBundle();
    const model = getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_ON_DEVICE,
    }) as GenerativeModel & {
      initializeDeviceModel?: (cb?: (val: number) => void) => Promise<void>;
    };

    if (typeof model.initializeDeviceModel === "function") {
      await model.initializeDeviceModel((val) => {
        onProgress?.(val);
      });
      return true;
    }
  } catch {
    // Fall through to direct Chrome LanguageModel trigger if Firebase isn't configured yet.
  }

  if (typeof window !== "undefined" && window.LanguageModel) {
    const session = await window.LanguageModel.create({
      monitor(m) {
        m.addEventListener("downloadprogress", (evt: Event) => {
          const loaded = (evt as unknown as { loaded?: number }).loaded;
          if (typeof loaded === "number") onProgress?.(loaded);
        });
      },
    });
    session.destroy?.();
    onProgress?.(1);
    return true;
  }

  return false;
}

const privacySchema = Schema.object({
  properties: {
    sanitizedText: Schema.string(),
    redactions: Schema.array({
      items: Schema.object({
        properties: {
          category: Schema.enumString({
            enum: [
              "PERSON_NAME",
              "PHONE_NUMBER",
              "CHAT_HANDLE",
              "ADDRESS_DETAIL",
              "OTHER_PII",
            ],
          }),
          placeholder: Schema.string(),
          reason: Schema.string(),
        },
      }),
    }),
  },
});

/**
 * STAGE 1: ONLY_ON_DEVICE Local Privacy Firewall with automatic chunking.
 * Splits raw notes > 2800 chars on newline/sentence boundaries into <= 2400-char chunks
 * so PII scrubbing stays 100% local even when raw logs exceed Gemini Nano's window.
 */
export async function runLocalPrivacyFirewall(
  rawText: string,
): Promise<LocalPrivacyResult> {
  const start = performance.now();
  const chunks = splitTextIntoLocalChunks(rawText);
  const counters: PiiCounters = { phone: 0, handle: 0, name: 0, addr: 0 };
  const dedupedRedactions = new Map<string, RedactionItem>();
  const sanitizedChunks: string[] = [];

  let localModel: GenerativeModel | null = null;
  try {
    const { ai } = getFirebaseBundle();
    localModel = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: {
        promptOptions: {
          responseConstraint: privacySchema,
        },
      },
    });
  } catch {
    localModel = null;
  }

  let anyChunkUsedRegexOnly = false;
  let anyChunkUsedOnDeviceModel = false;

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (!localModel) {
      anyChunkUsedRegexOnly = true;
      const scrubbed = deterministicLocalPiiScrub(chunk, counters);
      sanitizedChunks.push(scrubbed.sanitizedText);
      for (const r of scrubbed.redactions) {
        dedupedRedactions.set(r.placeholder, r);
      }
      continue;
    }

    try {
      const chunkPrefix =
        chunks.length > 1 ? `[Chunk ${i + 1}/${chunks.length}]\n` : "";
      const prompt = [
        "You are an on-device privacy redaction gate for disaster reports.",
        "Task: Remove ONLY private personal identifiers (individual person names, phone numbers, chat @handles, house-level street numbers) and replace them with bracketed placeholders like [PERSON_1], [PHONE_1], [HANDLE_1], [ADDRESS_1].",
        "CRITICAL: Keep district/city/regency names, bridge/dam/volcano names, hazard facts, counts, and urgent needs intact.",
        "Preserve the original language (Bahasa Indonesia / English).",
        "Return valid JSON matching the schema.",
        "",
        "RAW INPUT:",
        `${chunkPrefix}${chunk}`,
      ].join("\n");

      const result = await localModel.generateContent(prompt);
      const parsed = JSON.parse(extractJsonFromText(result.response.text())) as {
        sanitizedText?: string;
        redactions?: RedactionItem[];
      };

      const postGuard = deterministicLocalPiiScrub(
        parsed.sanitizedText || chunk,
        counters,
      );

      sanitizedChunks.push(postGuard.sanitizedText);
      anyChunkUsedOnDeviceModel = true;

      for (const item of parsed.redactions ?? []) {
        if (!item?.placeholder) continue;
        const normalizedPlaceholder =
          chunks.length > 1 && /^\[[A-Z_]+_\d+\]$/.test(item.placeholder)
            ? item.placeholder.replace(/\]$/, `_C${i + 1}]`)
            : item.placeholder;
        dedupedRedactions.set(normalizedPlaceholder, {
          ...item,
          placeholder: normalizedPlaceholder,
        });
      }
      for (const item of postGuard.redactions) {
        dedupedRedactions.set(item.placeholder, item);
      }
    } catch {
      anyChunkUsedRegexOnly = true;
      const fallback = deterministicLocalPiiScrub(chunk, counters);
      sanitizedChunks.push(fallback.sanitizedText);
      for (const item of fallback.redactions) {
        dedupedRedactions.set(item.placeholder, item);
      }
    }
  }

  return {
    sanitizedText: sanitizedChunks.join("\n\n"),
    redactions: Array.from(dedupedRedactions.values()),
    inferenceSource: "ON_DEVICE",
    latencyMs: Math.round(performance.now() - start),
    usedRegexFallback: !anyChunkUsedOnDeviceModel && anyChunkUsedRegexOnly,
  };
}

const intakeTriageSchema = Schema.object({
  properties: {
    headline: Schema.string(),
    hazardType: Schema.enumString({
      enum: ["EARTHQUAKE", "FLOOD", "VOLCANO", "LANDSLIDE", "TSUNAMI", "OTHER"],
    }),
    location: Schema.string(),
    severity: Schema.enumString({
      enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"],
    }),
    summaryId: Schema.string(),
    summaryEn: Schema.string(),
    keyFacts: Schema.array({ items: Schema.string() }),
    urgentNeeds: Schema.array({ items: Schema.string() }),
    verificationGaps: Schema.array({ items: Schema.string() }),
    panicSignals: Schema.array({ items: Schema.string() }),
  },
});

export interface HybridTriageResult {
  structured: StructuredIntakeData;
  inferenceSource: InferenceSourceLabel;
  latencyMs: number;
  routingReason: string;
  estimatedInputTokens: number;
  isOfflineDraft: boolean;
}

function detectHazardTypeOffline(text: string): HazardType {
  const lower = text.toLowerCase();
  if (lower.includes("gempa") || lower.includes("earthquake")) return "EARTHQUAKE";
  if (lower.includes("banjir") || lower.includes("flood")) return "FLOOD";
  if (
    lower.includes("erupsi") ||
    lower.includes("abu vulkanik") ||
    lower.includes("vulkanik") ||
    lower.includes("volcano")
  ) {
    return "VOLCANO";
  }
  if (lower.includes("longsor") || lower.includes("landslide")) return "LANDSLIDE";
  if (lower.includes("tsunami")) return "TSUNAMI";
  return "OTHER";
}

export function buildOfflineDraftTriage(
  mode: IntakeMode,
  sanitizedText: string,
  start: number,
): HybridTriageResult {
  const cleaned = sanitizedText.trim();
  const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0]?.trim() || cleaned;
  const headline = `Offline draft: ${firstSentence || "Crisis intake"}`.slice(0, 90);
  const routeEval = evaluateTokenRoute(sanitizedText, false);

  return {
    structured: {
      headline,
      hazardType: detectHazardTypeOffline(cleaned),
      location: "Indonesia (Location Unspecified)",
      severity: "MEDIUM",
      summaryId: cleaned.slice(0, 240),
      summaryEn:
        "Captured offline. English summary pending cloud triage when signal returns.",
      keyFacts: [],
      urgentNeeds: [],
      verificationGaps: [
        "Full AI triage pending: captured offline without an on-device model",
      ],
      panicSignals: [],
      rumorVerdict:
        mode === "RUMOR_CHECK" ? "UNVERIFIED_DEVELOPING" : "NOT_APPLICABLE",
      groundingSources: [],
      searchEntryPointHtml: null,
    },
    inferenceSource: "ON_DEVICE",
    latencyMs: Math.max(1, Math.round(performance.now() - start)),
    routingReason:
      "Offline deterministic draft: no on-device model available. Queued for cloud triage when signal returns.",
    estimatedInputTokens: routeEval.estimatedTokens,
    isOfflineDraft: true,
  };
}

/**
 * STAGE 2: Token-Budget-Aware Hybrid Structured Triage (Text + optional JPEG/PNG).
 * Routes <= 2200 estimated tokens to PREFER_ON_DEVICE (with automatic retry in Cloud
 * if local Nano hits context/output limits), and auto-escalates larger payloads to Cloud.
 */
export async function triageIntakeHybrid(params: {
  mode: IntakeMode;
  sanitizedText: string;
  imageFile?: File | null;
  forceCloudFallback?: boolean;
  offline?: boolean;
  areaKnowledge?: AreaKnowledgeDoc[];
}): Promise<HybridTriageResult> {
  const start = performance.now();
  if (params.offline && (typeof window === "undefined" || !window.LanguageModel)) {
    return buildOfflineDraftTriage(params.mode, params.sanitizedText, start);
  }

  const { ai } = getFirebaseBundle();
  const { fastCloudModel } = getCachedModelConfig();
  const areaCtx = formatAreaKnowledgeBlock(params.areaKnowledge ?? []);

  const routeEval = evaluateTokenRoute(
    areaCtx.block
      ? `${areaCtx.block}\n\n${params.sanitizedText}`
      : params.sanitizedText,
    Boolean(params.imageFile),
  );

  const instruction =
    params.mode === "FIELD_REPORT"
      ? [
          "You are a rapid disaster field-report structuring engine.",
          "Convert the messy Indonesian/English field report (and optional photo) into clean structured crisis data.",
          "- headline: crisp English headline (max 90 chars).",
          "- summaryId: concise, calm factual summary in Bahasa Indonesia (max 2 concise sentences).",
          "- summaryEn: concise factual summary in English (max 2 concise sentences).",
          "- keyFacts: 2-4 concrete observed facts (no speculation).",
          "- urgentNeeds: 1-4 concrete immediate relief/safety needs.",
          "- verificationGaps: 1-3 unknown or unconfirmed details that command must check.",
          "- panicSignals: empty array unless speculative rumors appear.",
          "- Keep each bullet <= 16 words and each summary <= 2 concise sentences.",
        ].join("\n")
      : [
          "You are a disaster rumor triage engine.",
          "Extract the core verifiable claim and manipulation/panic signals from the forwarded message (and optional screenshot).",
          "DO NOT declare a claim true or false without external verification; keep summary neutral.",
          "- headline: neutral English label describing the claim (e.g. 'Unverified claim: Cirata Dam collapse').",
          "- summaryId: neutral Bahasa Indonesia summary of what is being claimed.",
          "- summaryEn: neutral English summary of what is being claimed.",
          "- keyFacts: 1-3 specific verifiable factual assertions inside the rumor.",
          "- urgentNeeds: 1-2 official agency checks required (e.g. 'Check BMKG/operator status').",
          "- verificationGaps: 1-3 missing pieces of evidence (no timestamp, anonymous source, etc.).",
          "- panicSignals: 1-4 manipulation indicators (ALL CAPS urgency, 'forward to all groups', insider claim, etc.).",
          "- Keep each bullet <= 16 words and each summary <= 2 concise sentences.",
        ].join("\n");

  const promptBody = areaCtx.block
    ? `${instruction}\n\n${areaCtx.block}\n\nSANITIZED INPUT:\n${params.sanitizedText}`
    : `${instruction}\n\nSANITIZED INPUT:\n${params.sanitizedText}`;

  const promptParts: Array<
    string | { type: "inlineData"; inlineData: { data: string; mimeType: string } }
  > = [promptBody];

  if (params.imageFile) {
    const allowed = ["image/jpeg", "image/png"];
    if (allowed.includes(params.imageFile.type)) {
      promptParts.push(await fileToInlinePart(params.imageFile));
    }
  }

  let requestedMode: InferenceMode = InferenceMode.PREFER_ON_DEVICE;
  let initialCloudReason = "";

  if (params.offline) {
    requestedMode = InferenceMode.ONLY_ON_DEVICE;
  } else if (params.forceCloudFallback) {
    requestedMode = InferenceMode.ONLY_IN_CLOUD;
    initialCloudReason =
      "Simulated mid-range device cloud fallback (ONLY_IN_CLOUD)";
  } else if (routeEval.exceedsLocalBudget) {
    requestedMode = InferenceMode.ONLY_IN_CLOUD;
    initialCloudReason = `Auto-escalated to Cloud: ~${routeEval.estimatedTokens} est. tokens exceeds ${ON_DEVICE_SAFE_INPUT_TOKENS}-token local Nano budget`;
  }

  const createTriageModel = (modeToUse: InferenceMode) =>
    getGenerativeModel(ai, {
      mode: modeToUse,
      inCloudParams: {
        model: fastCloudModel,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: intakeTriageSchema,
          temperature: 0.2,
        },
      },
      onDeviceParams: {
        promptOptions: {
          responseConstraint: intakeTriageSchema,
        },
      },
    });

  const parseStructured = (rawText: string) =>
    JSON.parse(extractJsonFromText(rawText)) as Omit<
      StructuredIntakeData,
      "rumorVerdict" | "groundingSources" | "searchEntryPointHtml"
    >;

  let parsed: Omit<
    StructuredIntakeData,
    "rumorVerdict" | "groundingSources" | "searchEntryPointHtml"
  >;
  let inferenceSource: InferenceSourceLabel;
  let routingReason: string;

  try {
    const primaryModel = createTriageModel(requestedMode);
    const result = await primaryModel.generateContent(promptParts);
    const response = result.response as typeof result.response & {
      inferenceSource?: string;
    };
    parsed = parseStructured(response.text());
    inferenceSource = normalizeInferenceSource(response.inferenceSource);

    if (params.offline) {
      inferenceSource = "ON_DEVICE";
      routingReason =
        "Processed on Gemini Nano while offline (ONLY_ON_DEVICE)";
    } else if (requestedMode === InferenceMode.ONLY_IN_CLOUD) {
      inferenceSource = "IN_CLOUD";
      routingReason = initialCloudReason;
    } else if (inferenceSource === "ON_DEVICE") {
      routingReason =
        "Processed locally on Gemini Nano (0 cloud tokens used)";
    } else {
      routingReason = "Auto-fallback to Cloud Gemini via PREFER_ON_DEVICE";
    }
  } catch (primaryErr) {
    if (params.offline) {
      return buildOfflineDraftTriage(params.mode, params.sanitizedText, start);
    }
    const isOnline =
      !params.offline &&
      (typeof navigator === "undefined" ? true : navigator.onLine);
    if (
      requestedMode === InferenceMode.PREFER_ON_DEVICE &&
      isOnDeviceLimitError(primaryErr) &&
      isOnline
    ) {
      try {
        const cloudModel = createTriageModel(InferenceMode.ONLY_IN_CLOUD);
        const retryResult = await cloudModel.generateContent(promptParts);
        parsed = parseStructured(retryResult.response.text());
        inferenceSource = "IN_CLOUD";
        routingReason =
          "Auto-escalated to Cloud after hitting on-device token/output ceiling";
      } catch (cloudErr) {
        throw formatFriendlyAiError(cloudErr);
      }
    } else {
      throw formatFriendlyAiError(primaryErr);
    }
  }

  return {
    structured: {
      headline: parsed.headline || "Untitled Crisis Intake",
      hazardType: parsed.hazardType || "OTHER",
      location: parsed.location || "Indonesia (Location Unspecified)",
      severity: parsed.severity || "MEDIUM",
      summaryId: parsed.summaryId || "",
      summaryEn: parsed.summaryEn || "",
      keyFacts: parsed.keyFacts ?? [],
      urgentNeeds: parsed.urgentNeeds ?? [],
      verificationGaps: parsed.verificationGaps ?? [],
      panicSignals: parsed.panicSignals ?? [],
      rumorVerdict:
        params.mode === "RUMOR_CHECK"
          ? "UNVERIFIED_DEVELOPING"
          : "NOT_APPLICABLE",
      groundingSources: [],
      searchEntryPointHtml: null,
    },
    inferenceSource,
    latencyMs: Math.round(performance.now() - start),
    routingReason,
    estimatedInputTokens: routeEval.estimatedTokens,
    isOfflineDraft: false,
  };
}

export interface GroundedVerificationResult {
  verdict: RumorVerdict;
  factId: string;
  factEn: string;
  sources: GroundingSource[];
  searchEntryPointHtml: string | null;
  webSearchQueries: string[];
  latencyMs: number;
}

/**
 * STAGE 3: ONLY_IN_CLOUD + Google Search Grounding (with 429 quota fallback).
 * Verifies a locally-scrubbed rumor claim against live public sources.
 * Captures required groundingChunks and searchEntryPoint.renderedContent.
 */
export async function verifyRumorWithGoogleSearch(params: {
  sanitizedClaim: string;
  locationHint: string;
}): Promise<GroundedVerificationResult> {
  const start = performance.now();
  const { ai } = getFirebaseBundle();
  const { synthesisCloudModel, fastCloudModel } = getCachedModelConfig();

  const prompt = [
    "You are a crisis fact-checking assistant supporting disaster communications officers.",
    "Verify the following SANITIZED claim using live Google Search results (official agencies such as BMKG, BNPB, PVMBG, USGS, credible newsrooms).",
    "SAFETY RULE: Never declare a breaking physical hazard 'safe' unless corroborated by authoritative sources. If there is no clear confirmation or credible debunk, you MUST return verdict 'UNVERIFIED_DEVELOPING'.",
    "",
    "Respond ONLY with a valid JSON object (no markdown commentary outside JSON) with exact keys:",
    '{ "verdict": "VERIFIED" | "MISLEADING" | "UNVERIFIED_DEVELOPING", "factId": "2-3 calm sentences in Bahasa Indonesia explaining evidence & guidance", "factEn": "2-3 calm sentences in English explaining evidence & guidance" }',
    "",
    `REGION HINT: ${params.locationHint}`,
    `SANITIZED CLAIM: ${params.sanitizedClaim}`,
  ].join("\n");

  const runSearchModel = async (modelName: string) => {
    const model = getGenerativeModel(ai, {
      model: modelName,
      tools: [{ googleSearch: {} }],
    });
    return model.generateContent(prompt);
  };

  const { result } = await runWithCloudModelFallback(
    synthesisCloudModel,
    fastCloudModel,
    runSearchModel,
  );

  const text = result.response.text();
  const candidate = result.response.candidates?.[0] as
    | {
        groundingMetadata?: {
          webSearchQueries?: string[];
          searchEntryPoint?: { renderedContent?: string };
          groundingChunks?: Array<{ web?: { title?: string; uri?: string } }>;
        };
      }
    | undefined;

  const grounding = candidate?.groundingMetadata;
  const sources: GroundingSource[] = (grounding?.groundingChunks ?? [])
    .map((chunk) => ({
      title: chunk.web?.title || "Source",
      uri: chunk.web?.uri || "",
    }))
    .filter((s) => Boolean(s.uri));

  let verdict: RumorVerdict = "UNVERIFIED_DEVELOPING";
  let factId =
    "Klaim ini belum dapat dikonfirmasi dari sumber resmi. Ikuti informasi kanal resmi kebencanaan setempat.";
  let factEn =
    "This claim cannot yet be confirmed by authoritative sources. Follow official local disaster agency advisories.";

  try {
    const parsed = JSON.parse(extractJsonFromText(text)) as {
      verdict?: RumorVerdict;
      factId?: string;
      factEn?: string;
    };
    if (
      parsed.verdict === "VERIFIED" ||
      parsed.verdict === "MISLEADING" ||
      parsed.verdict === "UNVERIFIED_DEVELOPING"
    ) {
      verdict = parsed.verdict;
    }
    if (parsed.factId) factId = parsed.factId;
    if (parsed.factEn) factEn = parsed.factEn;
  } catch {
    factEn = text.slice(0, 600);
    factId = text.slice(0, 600);
  }

  return {
    verdict,
    factId,
    factEn,
    sources,
    searchEntryPointHtml: grounding?.searchEntryPoint?.renderedContent ?? null,
    webSearchQueries: grounding?.webSearchQueries ?? [],
    latencyMs: Math.round(performance.now() - start),
  };
}

const dispatchSynthesisSchema = Schema.object({
  properties: {
    severity: Schema.enumString({
      enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"],
    }),
    communityAlertId: Schema.object({
      properties: {
        title: Schema.string(),
        whatHappened: Schema.string(),
        doNow: Schema.array({ items: Schema.string() }),
        avoid: Schema.array({ items: Schema.string() }),
        whatsappShortText: Schema.string(),
      },
    }),
    mediaPressReleaseId: Schema.object({
      properties: {
        headline: Schema.string(),
        dateline: Schema.string(),
        body: Schema.string(),
        keyMetrics: Schema.array({ items: Schema.string() }),
      },
    }),
    globalSitrepEn: Schema.object({
      properties: {
        headline: Schema.string(),
        executiveSummary: Schema.string(),
        impactOverview: Schema.array({ items: Schema.string() }),
        priorityNeeds: Schema.array({ items: Schema.string() }),
        informationGaps: Schema.array({ items: Schema.string() }),
      },
    }),
    debunkCard: Schema.object({
      properties: {
        hasRumorAlert: Schema.boolean(),
        verdict: Schema.enumString({
          enum: [
            "VERIFIED",
            "MISLEADING",
            "UNVERIFIED_DEVELOPING",
            "NOT_APPLICABLE",
          ],
        }),
        claim: Schema.string(),
        factId: Schema.string(),
        factEn: Schema.string(),
      },
    }),
  },
});

export interface SynthesizedBroadcastResult {
  severity: SeverityLevel;
  communityAlertId: CommunityAlertPayload;
  mediaPressReleaseId: MediaPressReleasePayload;
  globalSitrepEn: GlobalSitrepPayload;
  debunkCard: DebunkCardPayload;
  latencyMs: number;
  modelUsed: string;
}

/**
 * STAGE 4: ONLY_IN_CLOUD Multi-Report Synthesis into 4 Synchronized Audiences.
 * Uses compact intake serialization, output token cap, and automatic 429 quota
 * fallback to fastCloudModel.
 */
export async function synthesizeBroadcastPack(params: {
  incidentTitle: string;
  region: string;
  dispatchNumber: number;
  intakes: IntakeDoc[];
  areaKnowledge?: AreaKnowledgeDoc[];
}): Promise<SynthesizedBroadcastResult> {
  const start = performance.now();
  const { ai } = getFirebaseBundle();
  const { synthesisCloudModel, fastCloudModel } = getCachedModelConfig();
  const areaCtx = formatAreaKnowledgeBlock(params.areaKnowledge ?? []);

  const collectedSources: GroundingSource[] = [];
  for (const intake of params.intakes) {
    for (const s of intake.structured.groundingSources) {
      if (!collectedSources.some((x) => x.uri === s.uri)) {
        collectedSources.push(s);
      }
    }
  }

  const serializedIntakes = params.intakes.map((intake, i) => ({
    index: i + 1,
    mode: intake.mode,
    platform: intake.sourcePlatform,
    inferenceSource: intake.inferenceSource,
    headline: intake.structured.headline,
    location: intake.structured.location,
    severity: intake.structured.severity,
    summaryId: intake.structured.summaryId,
    summaryEn: intake.structured.summaryEn,
    keyFacts: intake.structured.keyFacts,
    urgentNeeds: intake.structured.urgentNeeds,
    verificationGaps: intake.structured.verificationGaps,
    rumorVerdict: intake.structured.rumorVerdict,
    sanitizedExcerpt:
      intake.sanitizedText.length > 360
        ? `${intake.sanitizedText.slice(0, 360)}...`
        : intake.sanitizedText,
  }));

  const prompt = [
    "You are a senior crisis communications & humanitarian reporting synthesizer.",
    "Synthesize the verified, sanitized multi-source disaster intakes below into ONE coherent, synchronized 4-audience broadcast pack.",
    "Rules:",
    "- Never invent casualty numbers or facts not supported by the intakes. Explicitly list unconfirmed data in informationGaps.",
    "- communityAlertId: Plain, calm, actionable Bahasa Indonesia suitable for stressed citizens and WhatsApp forwarding.",
    "- mediaPressReleaseId: Crisp Indonesian national press release format with dateline and bullet metrics.",
    "- globalSitrepEn: Authoritative English humanitarian Situation Report (OCHA / ReliefWeb style) for international media & NGOs.",
    "- debunkCard: If any intake is RUMOR_CHECK, summarize the rumor & verified counter-fact in both ID and EN (hasRumorAlert=true). Otherwise set hasRumorAlert=false and verdict='NOT_APPLICABLE'.",
    "- Keep mediaPressReleaseId.body <= 180 words and all list bullets <= 18 words for rapid scanning.",
    "- Never use em dashes in any text.",
    ...(areaCtx.block ? ["", areaCtx.block] : []),
    "",
    `INCIDENT: ${params.incidentTitle} (${params.region}) - Dispatch #${params.dispatchNumber}`,
    `INTAKES JSON:${JSON.stringify(serializedIntakes)}`,
  ].join("\n");

  const runSynthesisModel = async (modelName: string) => {
    const model = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: modelName,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: dispatchSynthesisSchema,
          temperature: 0.25,
          maxOutputTokens: 2048,
        },
      },
    });
    return model.generateContent(prompt);
  };

  const { result, modelUsed } = await runWithCloudModelFallback(
    synthesisCloudModel,
    fastCloudModel,
    runSynthesisModel,
  );

  const parsed = JSON.parse(extractJsonFromText(result.response.text())) as {
    severity: SeverityLevel;
    communityAlertId: CommunityAlertPayload;
    mediaPressReleaseId: MediaPressReleasePayload;
    globalSitrepEn: GlobalSitrepPayload;
    debunkCard: Omit<DebunkCardPayload, "sources">;
  };

  return {
    severity: parsed.severity || "HIGH",
    communityAlertId: parsed.communityAlertId,
    mediaPressReleaseId: parsed.mediaPressReleaseId,
    globalSitrepEn: parsed.globalSitrepEn,
    debunkCard: {
      ...parsed.debunkCard,
      sources: collectedSources,
    },
    latencyMs: Math.round(performance.now() - start),
    modelUsed,
  };
}

/**
 * STAGE 5: PREFER_IN_CLOUD Resilient Public Reader Adaptation (Streaming).
 * Uses Cloud Gemini when online and seamlessly falls back to on-device Gemini Nano
 * if connectivity drops while a community member or journalist is reading.
 */
export async function streamReaderAdaptation(params: {
  sourceText: string;
  adaptation: "PLAIN_ID" | "THREE_BULLETS_EN" | "RADIO_SCRIPT_ID";
  onChunk: (accumulated: string) => void;
}): Promise<{
  text: string;
  inferenceSource: InferenceSourceLabel;
  latencyMs: number;
}> {
  const start = performance.now();
  const { ai } = getFirebaseBundle();
  const { fastCloudModel } = getCachedModelConfig();

  const model = getGenerativeModel(ai, {
    mode: InferenceMode.PREFER_IN_CLOUD,
    inCloudParams: {
      model: fastCloudModel,
      generationConfig: { temperature: 0.3 },
    },
  });

  const stylePrompt: Record<typeof params.adaptation, string> = {
    PLAIN_ID:
      "Rewrite this disaster bulletin into ultra-simple, calm Bahasa Indonesia (elementary reading level, short bullet points, max 100 words) for elderly residents and stressed families.",
    THREE_BULLETS_EN:
      "Distill this disaster bulletin into exactly 3 crisp English wire-service bullet points (What happened, Immediate impact, Priority needs) for global editors.",
    RADIO_SCRIPT_ID:
      "Turn this disaster bulletin into a calm 25-second Bahasa Indonesia community radio announcement script. Plain spoken wording, no jargon.",
  };

  const boundedSource =
    params.sourceText.length > READER_SOURCE_MAX_CHARS
      ? `${params.sourceText.slice(0, READER_SOURCE_MAX_CHARS)}...`
      : params.sourceText;

  try {
    const streamResult = await model.generateContentStream(
      `${stylePrompt[params.adaptation]}\n\nBULLETIN:\n${boundedSource}`,
    );

    let accumulated = "";
    for await (const chunk of streamResult.stream) {
      accumulated += chunk.text();
      params.onChunk(accumulated);
    }

    const finalResponse = (await streamResult.response) as {
      inferenceSource?: string;
      text: () => string;
    };

    return {
      text: accumulated || finalResponse.text(),
      inferenceSource: normalizeInferenceSource(finalResponse.inferenceSource),
      latencyMs: Math.round(performance.now() - start),
    };
  } catch (err) {
    throw formatFriendlyAiError(err);
  }
}
