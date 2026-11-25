import type {
  CommunityAlertPayload,
  DebunkCardPayload,
  DispatchDoc,
  GlobalSitrepPayload,
  IntakeDoc,
  SourcePlatform,
} from "../types/sigapwire.ts";

export const PROVENANCE_CODE_REGEX = /^SIGAP-D[0-9]{1,6}-[A-F0-9]{6}$/;
export const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/;

export interface DispatchManifestInput {
  dispatchNumber: number;
  incidentId: string;
  severity: string;
  sourceIntakeIds: string[];
  sourceEvidenceHashes?: string[];
  communityAlertId: Pick<
    CommunityAlertPayload,
    "title" | "whatHappened" | "doNow" | "avoid"
  >;
  globalSitrepEn: Pick<GlobalSitrepPayload, "headline" | "executiveSummary">;
  debunkCard: Pick<DebunkCardPayload, "hasRumorAlert" | "verdict" | "claim">;
}

export type ProvenanceVerificationStatus =
  | "VERIFIED_INTACT"
  | "TAMPER_MISMATCH"
  | "LEGACY_UNSEALED";

export interface ProvenanceVerificationReport {
  status: ProvenanceVerificationStatus;
  recomputedSha256: string;
  recomputedCode: string;
  storedSha256: string | null;
  storedCode: string | null;
  linkedIntakeCount: number;
  platforms: SourcePlatform[];
  totalPiiKeptOnDevice: number;
  onDeviceIntakeCount: number;
  inCloudIntakeCount: number;
  groundingSourceCount: number;
  hashedEvidenceCount: number;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Computes a lowercase 64-character SHA-256 hex digest using Web Crypto API
 * (available natively in both modern browsers and Node.js 20+).
 */
export async function sha256HexFromBytes(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto subtle.digest is unavailable in this runtime.");
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy.buffer);
  return bytesToHex(new Uint8Array(digest));
}

export async function sha256HexFromText(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  return sha256HexFromBytes(encoded);
}

/**
 * Computes an on-device privacy-preserving SHA-256 commitment over cloud-safe sanitized
 * intake text and optional EXIF-stripped image bytes (raw unredacted PII is never hashed).
 */
export async function computeIntakeEvidenceSha256(params: {
  sanitizedText: string;
  mode: string;
  sourcePlatform: string;
  redactionCount: number;
  imageBytes?: Uint8Array | null;
}): Promise<string> {
  const imageHash =
    params.imageBytes && params.imageBytes.byteLength > 0
      ? await sha256HexFromBytes(params.imageBytes)
      : null;

  const canonical = JSON.stringify({
    v: 1,
    mode: params.mode.trim().toUpperCase(),
    platform: params.sourcePlatform.trim().toUpperCase(),
    redactionCount: Math.max(0, Math.round(params.redactionCount)),
    sanitizedText: params.sanitizedText.trim(),
    imageSha256: imageHash,
  });

  return sha256HexFromText(canonical);
}

/**
 * Produces a canonical JSON serialization of a published dispatch manifest.
 * Intentionally excludes whatsappShortText so appending the human-readable seal code
 * to WhatsApp copy never alters the manifest digest.
 */
export function canonicalizeDispatchManifestInput(
  params: DispatchManifestInput,
): string {
  const sortedIntakeIds = [...params.sourceIntakeIds]
    .map((id) => id.trim())
    .filter(Boolean)
    .sort();
  const sortedHashes = [...(params.sourceEvidenceHashes ?? [])]
    .map((h) => h.trim().toLowerCase())
    .filter((h) => SHA256_HEX_REGEX.test(h))
    .sort();

  return JSON.stringify({
    v: 1,
    dispatchNumber: Math.max(1, Math.floor(params.dispatchNumber)),
    incidentId: params.incidentId.trim(),
    severity: params.severity.trim().toUpperCase(),
    sourceIntakeIds: sortedIntakeIds,
    sourceEvidenceHashes: sortedHashes,
    communityAlertId: {
      title: params.communityAlertId.title.trim(),
      whatHappened: params.communityAlertId.whatHappened.trim(),
      doNow: params.communityAlertId.doNow.map((s) => s.trim()).filter(Boolean),
      avoid: params.communityAlertId.avoid.map((s) => s.trim()).filter(Boolean),
    },
    globalSitrepEn: {
      headline: params.globalSitrepEn.headline.trim(),
      executiveSummary: params.globalSitrepEn.executiveSummary.trim(),
    },
    debunkCard: {
      hasRumorAlert: Boolean(params.debunkCard.hasRumorAlert),
      verdict: params.debunkCard.verdict.trim().toUpperCase(),
      claim: params.debunkCard.claim.trim(),
    },
  });
}

export function formatProvenanceCode(
  dispatchNumber: number,
  manifestSha256: string,
): string {
  const safeNum = Math.max(1, Math.min(999999, Math.floor(dispatchNumber)));
  const shortHex = manifestSha256.trim().slice(0, 6).toUpperCase();
  return `SIGAP-D${safeNum}-${shortHex}`;
}

export async function computeDispatchProvenance(
  params: DispatchManifestInput,
): Promise<{ manifestSha256: string; provenanceCode: string }> {
  const canonical = canonicalizeDispatchManifestInput(params);
  const manifestSha256 = await sha256HexFromText(canonical);
  const provenanceCode = formatProvenanceCode(
    params.dispatchNumber,
    manifestSha256,
  );
  return { manifestSha256, provenanceCode };
}

/**
 * Appends a short verification seal footer to WhatsApp copy while staying
 * strictly under the 2,000-char Firestore schema cap.
 */
export function appendProvenanceSealToWhatsapp(
  whatsappShortText: string,
  provenanceCode: string,
): string {
  const trimmed = whatsappShortText.trim();
  if (!provenanceCode || trimmed.toUpperCase().includes(provenanceCode.toUpperCase())) {
    return trimmed.slice(0, 2000);
  }
  const footer = `\nSeal: ${provenanceCode}`;
  const maxBodyLen = Math.max(1, 2000 - footer.length);
  return `${trimmed.slice(0, maxBodyLen).trimEnd()}${footer}`;
}

/**
 * Extracts a SIGAP-D{n}-{HEX6} verification code from either a bare code input
 * or a full pasted WhatsApp forwarded crisis message.
 */
export function extractProvenanceCodeFromQuery(input: string): string | null {
  const match = /\b(SIGAP-D[0-9]{1,6}-[A-F0-9]{6})\b/i.exec(input || "");
  return match ? match[1].toUpperCase() : null;
}

/**
 * Live client-side integrity verifier for a Public Crisis Wire dispatch.
 * Recomputes the canonical SHA-256 manifest and summarizes the linked hybrid chain of custody.
 */
export async function verifyDispatchProvenance(params: {
  dispatch: DispatchDoc;
  linkedIntakes: IntakeDoc[];
}): Promise<ProvenanceVerificationReport> {
  const { dispatch, linkedIntakes } = params;
  const sourceEvidenceHashes = linkedIntakes
    .map((intake) => intake.evidenceSha256)
    .filter((h): h is string => typeof h === "string" && SHA256_HEX_REGEX.test(h));

  const { manifestSha256: recomputedSha256, provenanceCode: recomputedCode } =
    await computeDispatchProvenance({
      dispatchNumber: dispatch.dispatchNumber,
      incidentId: dispatch.incidentId,
      severity: dispatch.severity,
      sourceIntakeIds: dispatch.sourceIntakeIds,
      sourceEvidenceHashes,
      communityAlertId: dispatch.communityAlertId,
      globalSitrepEn: dispatch.globalSitrepEn,
      debunkCard: dispatch.debunkCard,
    });

  const storedSha256 = dispatch.manifestSha256 ?? null;
  const storedCode = dispatch.provenanceCode ?? null;

  let status: ProvenanceVerificationStatus = "LEGACY_UNSEALED";
  if (storedSha256) {
    const hashMatches = storedSha256.toLowerCase() === recomputedSha256;
    const codeMatches =
      !storedCode || storedCode.toUpperCase() === recomputedCode;
    status = hashMatches && codeMatches ? "VERIFIED_INTACT" : "TAMPER_MISMATCH";
  }

  const platformSet = new Set<SourcePlatform>();
  let totalPiiKeptOnDevice = 0;
  let onDeviceIntakeCount = 0;
  let inCloudIntakeCount = 0;
  let groundingSourceCount = dispatch.debunkCard.sources.length;

  for (const intake of linkedIntakes) {
    platformSet.add(intake.sourcePlatform);
    totalPiiKeptOnDevice += Math.max(0, intake.redactionCount);
    if (intake.inferenceSource === "ON_DEVICE") {
      onDeviceIntakeCount += 1;
    } else {
      inCloudIntakeCount += 1;
    }
    groundingSourceCount += intake.structured.groundingSources.length;
  }

  return {
    status,
    recomputedSha256,
    recomputedCode,
    storedSha256,
    storedCode,
    linkedIntakeCount: linkedIntakes.length,
    platforms: Array.from(platformSet),
    totalPiiKeptOnDevice,
    onDeviceIntakeCount,
    inCloudIntakeCount,
    groundingSourceCount,
    hashedEvidenceCount: sourceEvidenceHashes.length,
  };
}
