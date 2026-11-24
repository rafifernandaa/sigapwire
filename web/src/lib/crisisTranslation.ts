export type CrisisLanguageCode =
  | "id"
  | "su"
  | "jv"
  | "en"
  | "ja"
  | "ko"
  | "ar";

export interface CrisisLanguageOption {
  code: CrisisLanguageCode;
  label: string;
  nativeLabel: string;
  bcp47: string;
  regionHint: string;
  dir: "ltr" | "rtl";
  isOriginal?: boolean;
}

export const CRISIS_LANGUAGES: CrisisLanguageOption[] = [
  {
    code: "id",
    label: "Bahasa Indonesia",
    nativeLabel: "Bahasa Indonesia",
    bcp47: "id-ID",
    regionHint: "Original wire bulletin",
    dir: "ltr",
    isOriginal: true,
  },
  {
    code: "su",
    label: "Sundanese",
    nativeLabel: "Basa Sunda",
    bcp47: "id-ID",
    regionHint: "West Java & Cianjur communities",
    dir: "ltr",
  },
  {
    code: "jv",
    label: "Javanese",
    nativeLabel: "Basa Jawa",
    bcp47: "id-ID",
    regionHint: "Central & East Java communities",
    dir: "ltr",
  },
  {
    code: "en",
    label: "English",
    nativeLabel: "English",
    bcp47: "en-US",
    regionHint: "Global responders & travelers",
    dir: "ltr",
  },
  {
    code: "ja",
    label: "Japanese",
    nativeLabel: "日本語",
    bcp47: "ja-JP",
    regionHint: "Travelers & JICA teams",
    dir: "ltr",
  },
  {
    code: "ko",
    label: "Korean",
    nativeLabel: "한국어",
    bcp47: "ko-KR",
    regionHint: "Travelers & response teams",
    dir: "ltr",
  },
  {
    code: "ar",
    label: "Arabic",
    nativeLabel: "العربية",
    bcp47: "ar-SA",
    regionHint: "Travelers & humanitarian partners",
    dir: "rtl",
  },
];

const SUPPORTED_NON_ORIGINAL = new Set<CrisisLanguageCode>([
  "su",
  "jv",
  "en",
  "ja",
  "ko",
  "ar",
]);

/**
 * Maps browser navigator language tags (e.g. "en-US", "ja-JP", "su") to a suggested
 * crisis translation code, returning null for Indonesian or unsupported locales.
 */
export function detectSuggestedCrisisLanguage(
  browserLocale: string | undefined,
): CrisisLanguageCode | null {
  if (!browserLocale || typeof browserLocale !== "string") return null;
  const subtag = browserLocale.trim().toLowerCase().split(/[-_]/)[0];
  if (!subtag || subtag === "id" || subtag === "in") return null;
  if (SUPPORTED_NON_ORIGINAL.has(subtag as CrisisLanguageCode)) {
    return subtag as CrisisLanguageCode;
  }
  return null;
}

const ARABIC_INDIC_MAP: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

/**
 * Normalizes Arabic-Indic and Extended Arabic-Indic numerals to ASCII digits
 * so numeric preservation checks work cleanly across RTL translations.
 */
export function normalizeDigitsForSafetyCheck(text: string): string {
  return (text || "").replace(/[٠-٩۰-۹]/g, (ch) => ARABIC_INDIC_MAP[ch] ?? ch);
}

/**
 * Extracts unique critical numeric values, magnitudes, hotlines, and [AK-N] citations.
 */
export function extractCriticalNumericTokens(text: string): string[] {
  const normalized = normalizeDigitsForSafetyCheck(text);
  const matches = normalized.match(/\[AK-\d+\]|\bM?\d+(?:[.,]\d+)?\b/gi) ?? [];
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const raw of matches) {
    const token = raw.toLowerCase();
    if (!seen.has(token)) {
      seen.add(token);
      ordered.push(token);
    }
  }
  return ordered;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenAppearsInText(token: string, normalizedTargetLower: string): boolean {
  if (token.startsWith("[ak-")) {
    return normalizedTargetLower.includes(token);
  }
  // Allow decimal separator equivalence ("6.2" <-> "6,2")
  const variants = new Set([
    token,
    token.replace(/\./g, ","),
    token.replace(/,/g, "."),
  ]);
  for (const variant of variants) {
    // Use non-digit boundaries around digits so Arabic/CJK scripts without spaces match cleanly
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(variant)}(?=$|[^0-9])`, "i");
    if (pattern.test(normalizedTargetLower)) {
      return true;
    }
  }
  return false;
}

/**
 * Verifies deterministically that critical figures (magnitudes, capacities, hotlines, [AK-N])
 * present in the source bulletin were preserved in the translated output.
 */
export function verifyTranslationNumericSafety(
  sourceText: string,
  translatedText: string,
): { passed: boolean; sourceTokens: string[]; missingTokens: string[] } {
  const sourceTokens = extractCriticalNumericTokens(sourceText);
  if (sourceTokens.length === 0) {
    return { passed: true, sourceTokens: [], missingTokens: [] };
  }
  const normalizedTargetLower =
    normalizeDigitsForSafetyCheck(translatedText).toLowerCase();
  const missingTokens = sourceTokens.filter(
    (token) => !tokenAppearsInText(token, normalizedTargetLower),
  );
  return {
    passed: missingTokens.length === 0,
    sourceTokens,
    missingTokens,
  };
}
