import type { RedactionItem } from "../types/sigapwire.ts";

export interface PiiCounters {
  phone: number;
  handle: number;
  name: number;
  addr: number;
}

/**
 * Deterministic local PII scrubber used as an offline privacy floor, post-pass
 * guard, and pre-publish Broadcast Studio leak check.
 */
export function deterministicLocalPiiScrub(
  rawText: string,
  counters: PiiCounters = { phone: 0, handle: 0, name: 0, addr: 0 },
): {
  sanitizedText: string;
  redactions: RedactionItem[];
} {
  let sanitized = rawText;
  const redactions: RedactionItem[] = [];

  sanitized = sanitized.replace(
    /(?:\+62|62|0)\s?8\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{3,5}/g,
    () => {
      counters.phone += 1;
      const placeholder = `[PHONE_${counters.phone}]`;
      redactions.push({
        category: "PHONE_NUMBER",
        placeholder,
        reason: "Indonesian mobile number redacted locally",
      });
      return placeholder;
    },
  );

  sanitized = sanitized.replace(/@[a-zA-Z0-9._]{3,30}/g, () => {
    counters.handle += 1;
    const placeholder = `[HANDLE_${counters.handle}]`;
    redactions.push({
      category: "CHAT_HANDLE",
      placeholder,
      reason: "Social/chat handle redacted locally",
    });
    return placeholder;
  });

  sanitized = sanitized.replace(
    /\b(Pak|Bu|Ibu|Bapak|Sdr|Sdri)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
    (_m, honorific: string) => {
      counters.name += 1;
      const placeholder = `[RESIDENT_${counters.name}]`;
      redactions.push({
        category: "PERSON_NAME",
        placeholder,
        reason: `Personal name after "${honorific}" redacted locally`,
      });
      return `${honorific} ${placeholder}`;
    },
  );

  sanitized = sanitized.replace(
    /\bJl\.\s+[A-Za-z0-9.\s]+?(?:No\.?\s*\d+)(?:\s+RT\s*\d+(?:\/RW\s*\d+)?)?/gi,
    () => {
      counters.addr += 1;
      const placeholder = `[STREET_ADDRESS_${counters.addr}]`;
      redactions.push({
        category: "ADDRESS_DETAIL",
        placeholder,
        reason: "House-level street address redacted locally",
      });
      return placeholder;
    },
  );

  return { sanitizedText: sanitized, redactions };
}
