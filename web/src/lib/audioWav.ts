const DEFAULT_PCM_RATE = 24000;
const MIN_PCM_RATE = 8000;
const MAX_PCM_RATE = 96000;
const MAX_RADIO_SCRIPT_CHARS = 1400;

/**
 * Extracts PCM sample rate from mimeType strings such as
 * "audio/L16;codec=pcm;rate=24000", clamping to [8000, 96000].
 */
export function parsePcmRateFromMimeType(mimeType: string): number {
  const match = /rate\s*=\s*(\d+)/i.exec(mimeType || "");
  if (!match) return DEFAULT_PCM_RATE;
  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsed)) return DEFAULT_PCM_RATE;
  return Math.min(MAX_PCM_RATE, Math.max(MIN_PCM_RATE, parsed));
}

/**
 * Decodes a base64 audio payload into bytes in both Node test environments and browsers.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const clean = (base64 || "").replace(/\s+/g, "");
  if (!clean) return new Uint8Array(0);

  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(clean, "base64"));
  }

  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Wraps raw signed 16-bit little-endian PCM bytes in a 44-byte RIFF/WAVE header.
 */
export function pcm16ToWavBytes(
  pcmBytes: Uint8Array,
  sampleRate = DEFAULT_PCM_RATE,
  channels = 1,
): Uint8Array {
  const dataLen = pcmBytes.byteLength;
  const buffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buffer);
  const byteRate = sampleRate * channels * 2;
  const blockAlign = channels * 2;

  // "RIFF"
  view.setUint8(0, 0x52);
  view.setUint8(1, 0x49);
  view.setUint8(2, 0x46);
  view.setUint8(3, 0x46);
  view.setUint32(4, 36 + dataLen, true);
  // "WAVE"
  view.setUint8(8, 0x57);
  view.setUint8(9, 0x41);
  view.setUint8(10, 0x56);
  view.setUint8(11, 0x45);
  // "fmt "
  view.setUint8(12, 0x66);
  view.setUint8(13, 0x6d);
  view.setUint8(14, 0x74);
  view.setUint8(15, 0x20);
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // AudioFormat = 1 (PCM)
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // BitsPerSample
  // "data"
  view.setUint8(36, 0x64);
  view.setUint8(37, 0x61);
  view.setUint8(38, 0x74);
  view.setUint8(39, 0x61);
  view.setUint32(40, dataLen, true);

  const out = new Uint8Array(buffer);
  out.set(pcmBytes, 44);
  return out;
}

/**
 * Converts a Gemini InlineDataPart audio payload into browser-playable bytes,
 * passing compressed/container formats through untouched and wrapping raw PCM in WAV.
 */
export function audioInlinePartToPlayableWav(inlineData: {
  mimeType: string;
  data: string;
}): { bytes: Uint8Array; mimeType: string; sampleRate: number } {
  const rawMime = (inlineData.mimeType || "").trim();
  const normalizedMime = rawMime.toLowerCase();
  const sampleRate = parsePcmRateFromMimeType(rawMime);
  const decoded = base64ToUint8Array(inlineData.data);

  const passthroughPrefixes = [
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp3",
    "audio/ogg",
    "audio/webm",
  ];
  if (passthroughPrefixes.some((prefix) => normalizedMime.startsWith(prefix))) {
    return {
      bytes: decoded,
      mimeType: rawMime.split(";")[0].trim() || "audio/wav",
      sampleRate,
    };
  }

  return {
    bytes: pcm16ToWavBytes(decoded, sampleRate, 1),
    mimeType: "audio/wav",
    sampleRate,
  };
}

/**
 * Builds a bounded public-safety loudspeaker / radio script prompt with explicit
 * Director's Notes and optional dual-speaker Anchor/Verifier rumor debunk turns.
 */
export function buildRadioScriptForTts(params: {
  dispatchNumber: number;
  title: string;
  whatHappened: string;
  doNow: string[];
  avoid: string[];
  languageName: string;
  debunkCard?: {
    hasRumorAlert: boolean;
    verdict: string;
    claim: string;
    factId: string;
    factEn: string;
  };
  dualSpeaker?: boolean;
}): string {
  const cleanTitle = params.title.trim();
  const cleanSummary = params.whatHappened.trim();
  const doItems = params.doNow.map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const avoidItems = params.avoid.map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const useDual = Boolean(params.dualSpeaker && params.debunkCard?.hasRumorAlert);

  const lines: string[] = [
    `Speak in ${params.languageName}.`,
    "Director's Notes: Calm, steady, warm public-safety loudspeaker announcement with clear articulation and brief pauses between action steps. Never sound panicked or rushed.",
  ];

  if (useDual && params.debunkCard) {
    const debunkFact =
      params.languageName.toLowerCase().includes("english")
        ? params.debunkCard.factEn.trim() || params.debunkCard.factId.trim()
        : params.debunkCard.factId.trim() || params.debunkCard.factEn.trim();
    lines.push(
      `Anchor: SigapWire Dispatch ${params.dispatchNumber}. ${cleanTitle}. ${cleanSummary}`,
    );
    if (doItems.length > 0) {
      lines.push(`Anchor: Please do now: ${doItems.join(". ")}.`);
    }
    if (avoidItems.length > 0) {
      lines.push(`Anchor: Please avoid: ${avoidItems.join(". ")}.`);
    }
    lines.push(
      `Verifier: Rumor verification status is ${params.debunkCard.verdict}. Regarding the claim "${params.debunkCard.claim.trim()}", ${debunkFact}`,
    );
  } else {
    lines.push(
      `SigapWire Dispatch ${params.dispatchNumber}. ${cleanTitle}. ${cleanSummary}`,
    );
    if (doItems.length > 0) {
      lines.push(`Do now: ${doItems.join(". ")}.`);
    }
    if (avoidItems.length > 0) {
      lines.push(`Avoid: ${avoidItems.join(". ")}.`);
    }
  }

  const joined = lines.join("\n").trim();
  if (joined.length <= MAX_RADIO_SCRIPT_CHARS) {
    return joined;
  }
  return `${joined.slice(0, MAX_RADIO_SCRIPT_CHARS - 3).trimEnd()}...`;
}
