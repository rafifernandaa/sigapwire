import type { AreaKnowledgeDoc } from "../types/sigapwire.ts";

export const MAX_INJECTED_AREA_FACTS = 8;
export const MAX_INJECTED_AREA_CHARS = 1200;

export interface FormattedAreaKnowledgeContext {
  block: string;
  includedIds: string[];
  includedCount: number;
  estimatedTokens: number;
}

/**
 * Formats active human-verified Area Knowledge facts into a bounded prompt section.
 * Enforces strict fact and character limits so on-device Nano budgets stay protected.
 */
export function formatAreaKnowledgeBlock(
  facts: AreaKnowledgeDoc[],
): FormattedAreaKnowledgeContext {
  const activeFacts = facts.filter((f) => f.active && f.fact.trim().length > 0);
  if (activeFacts.length === 0) {
    return {
      block: "",
      includedIds: [],
      includedCount: 0,
      estimatedTokens: 0,
    };
  }

  const header =
    "VERIFIED AREA KNOWLEDGE (HUMAN-CONFIRMED GROUND TRUTH - DO NOT CONTRADICT; CITE [AK-N] WHEN RELEVANT):";
  const lines: string[] = [header];
  const includedIds: string[] = [];
  let charCount = header.length;

  for (const item of activeFacts) {
    if (includedIds.length >= MAX_INJECTED_AREA_FACTS) break;
    const tag = `[AK-${includedIds.length + 1}]`;
    const entry = `${tag} (${item.category}) ${item.fact.trim()}`;
    const candidateLen = charCount + 1 + entry.length;
    if (candidateLen > MAX_INJECTED_AREA_CHARS && includedIds.length > 0) {
      break;
    }
    if (candidateLen > MAX_INJECTED_AREA_CHARS) {
      const remaining = Math.max(40, MAX_INJECTED_AREA_CHARS - charCount - 4);
      lines.push(`${entry.slice(0, remaining)}...`);
      includedIds.push(item.id);
      charCount += 1 + remaining + 3;
      break;
    }
    lines.push(entry);
    includedIds.push(item.id);
    charCount = candidateLen;
  }

  const block = lines.join("\n");
  return {
    block,
    includedIds,
    includedCount: includedIds.length,
    estimatedTokens: Math.ceil(block.length / 3.2),
  };
}
