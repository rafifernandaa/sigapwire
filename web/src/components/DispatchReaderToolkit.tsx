import {
  CRISIS_LANGUAGES,
  type CrisisLanguageOption,
} from "../lib/crisisTranslation";
import type { TranslatedCommunityAlert } from "../lib/hybridAi";
import type { DispatchDoc, InferenceSourceLabel } from "../types/sigapwire";
import { InferenceBadge } from "./StatusBadges";

export type AdaptationKey = "PLAIN_ID" | "THREE_BULLETS_EN" | "RADIO_SCRIPT_ID";

export interface ReaderAdaptState {
  dispatchId: string;
  adaptation: AdaptationKey;
  text: string;
  isStreaming: boolean;
  inferenceSource: InferenceSourceLabel | null;
  latencyMs: number | null;
  error: string | null;
}

export interface TranslationCacheEntry {
  translated: TranslatedCommunityAlert;
  inferenceSource: InferenceSourceLabel;
  latencyMs: number;
  numericSafety: {
    passed: boolean;
    sourceTokens: string[];
    missingTokens: string[];
  };
}

export interface RadioAudioState {
  isGenerating: boolean;
  usedBrowserSpeechFallback: boolean;
  isSpeakingBrowser: boolean;
  objectUrl: string | null;
  mimeType: string;
  sampleRate: number | null;
  inferenceSource: InferenceSourceLabel | null;
  modelUsed: string | null;
  latencyMs: number | null;
  languageLabel: string;
  dualSpeaker: boolean;
  fallbackReason: string | null;
  error: string | null;
}

interface DispatchReaderToolkitProps {
  dispatch: DispatchDoc;
  showTranslation: boolean;
  activeLang: CrisisLanguageOption;
  suggestedLangOption: CrisisLanguageOption | null;
  cachedTranslation: TranslationCacheEntry | null;
  isTranslating: boolean;
  translationBusy: boolean;
  translationErr: string | null;
  activeAdapt: ReaderAdaptState | null;
  radio: RadioAudioState | null;
  onSelectLanguage: (lang: CrisisLanguageOption) => void;
  onAdapt: (adaptation: AdaptationKey) => void;
  onGenerateRadioAudio: (dualSpeaker: boolean) => void;
  onStopBrowserSpeech: () => void;
  onDownloadAudio: (objectUrl: string, filename: string) => void;
}

export function DispatchReaderToolkit({
  dispatch,
  showTranslation,
  activeLang,
  suggestedLangOption,
  cachedTranslation,
  isTranslating,
  translationBusy,
  translationErr,
  activeAdapt,
  radio,
  onSelectLanguage,
  onAdapt,
  onGenerateRadioAudio,
  onStopBrowserSpeech,
  onDownloadAudio,
}: DispatchReaderToolkitProps) {
  return (
    <div
      className="mt-5 pt-4 border-t space-y-4"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      {/* 1. Hyperlocal Dialect & Visitor Translation */}
      {showTranslation ? (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold">
              Hyperlocal Dialect &amp; Visitor Translation
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {cachedTranslation ? (
                <>
                  <InferenceBadge
                    source={cachedTranslation.inferenceSource}
                    latencyMs={cachedTranslation.latencyMs}
                  />
                  <span
                    className="font-mono-telemetry rounded px-2 py-0.5 text-xs font-semibold border"
                    style={
                      cachedTranslation.numericSafety.passed
                        ? {
                            backgroundColor: "var(--state-ondevice-bg)",
                            color: "var(--state-ondevice-ink)",
                            borderColor: "var(--state-ondevice-border)",
                          }
                        : {
                            backgroundColor: "var(--state-warn-bg)",
                            color: "var(--state-warn-ink)",
                            borderColor: "var(--state-warn-border)",
                          }
                    }
                  >
                    {cachedTranslation.numericSafety.passed
                      ? "Numeric Guard: PASS"
                      : `Check figures: ${cachedTranslation.numericSafety.missingTokens.join(", ")}`}
                  </span>
                </>
              ) : null}
            </div>
          </div>

          {suggestedLangOption && activeLang.code !== suggestedLangOption.code ? (
            <button
              type="button"
              onClick={() => onSelectLanguage(suggestedLangOption)}
              className="sw-btn-cloud min-h-[44px] w-full px-3 py-2 text-left text-xs font-semibold"
            >
              Browser language detected: Translate this alert to{" "}
              {suggestedLangOption.nativeLabel}?
            </button>
          ) : null}

          <div
            className="flex flex-wrap gap-1.5"
            role="group"
            aria-label={`Select translation language for dispatch ${dispatch.dispatchNumber}`}
          >
            {CRISIS_LANGUAGES.map((lang) => {
              const selected = activeLang.code === lang.code;
              return (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => onSelectLanguage(lang)}
                  disabled={translationBusy}
                  aria-pressed={selected}
                  title={`${lang.label} (${lang.regionHint})`}
                  className="sw-tab min-h-[44px] px-3 py-1.5 text-xs font-semibold"
                >
                  {lang.nativeLabel}
                </button>
              );
            })}
          </div>

          {isTranslating ? (
            <p
              role="status"
              aria-live="polite"
              className="font-mono-telemetry text-xs"
              style={{ color: "var(--ink-muted)" }}
            >
              Translating to {activeLang.label} ({activeLang.nativeLabel})...
            </p>
          ) : null}

          {translationErr ? (
            <p
              role="alert"
              className="text-xs font-medium"
              style={{ color: "var(--state-critical-ink)" }}
            >
              {translationErr}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* 2. Crisis Radio & PA Loudspeaker Audio */}
      <div
        className={showTranslation ? "pt-4 border-t space-y-2.5" : "space-y-2.5"}
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="text-xs font-bold block">
              Crisis Radio &amp; PA Loudspeaker Audio ({activeLang.nativeLabel})
            </span>
            <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
              Firebase AI Logic Gemini TTS (ResponseModality.AUDIO) with automatic on-device Web Speech fallback offline.
            </span>
          </div>
          {radio?.inferenceSource ? (
            <div className="flex flex-wrap items-center gap-2">
              <InferenceBadge
                source={radio.inferenceSource}
                latencyMs={radio.latencyMs ?? undefined}
              />
              {radio.usedBrowserSpeechFallback ? (
                <span
                  className="font-mono-telemetry rounded px-2 py-0.5 text-xs font-semibold border"
                  style={{
                    backgroundColor: "var(--state-ondevice-bg)",
                    color: "var(--state-ondevice-ink)",
                    borderColor: "var(--state-ondevice-border)",
                  }}
                >
                  ON_DEVICE FALLBACK (BROWSER SPEECH)
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onGenerateRadioAudio(false)}
            disabled={Boolean(radio?.isGenerating)}
            className="sw-btn-secondary min-h-[44px] px-3 py-1.5 text-xs font-semibold"
          >
            {radio?.isGenerating && !radio.dualSpeaker
              ? "Synthesizing Radio Audio..."
              : "Play Radio Audio (Gemini TTS)"}
          </button>

          {dispatch.debunkCard.hasRumorAlert ? (
            <button
              type="button"
              onClick={() => onGenerateRadioAudio(true)}
              disabled={Boolean(radio?.isGenerating)}
              className="sw-btn-cloud min-h-[44px] px-3 py-1.5 text-xs font-semibold"
            >
              {radio?.isGenerating && radio.dualSpeaker
                ? "Synthesizing 2-Voice Debunk..."
                : "2-Voice Rumor Debunk Audio"}
            </button>
          ) : null}

          {radio?.isSpeakingBrowser ? (
            <button
              type="button"
              onClick={onStopBrowserSpeech}
              className="sw-btn-critical min-h-[44px] px-3 py-1.5 text-xs font-semibold"
            >
              Stop Speech
            </button>
          ) : null}
        </div>

        {radio?.error ? (
          <p
            role="alert"
            className="text-xs font-medium"
            style={{ color: "var(--state-critical-ink)" }}
          >
            {radio.error}
          </p>
        ) : null}

        {radio?.fallbackReason ? (
          <p
            role="status"
            className="text-xs"
            style={{ color: "var(--ink-muted)" }}
          >
            {radio.fallbackReason}
          </p>
        ) : null}

        {radio?.objectUrl && !radio.usedBrowserSpeechFallback ? (
          <div className="sw-card-ground p-3 space-y-2">
            <div
              className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono-telemetry"
              style={{ color: "var(--ink-muted)" }}
            >
              <span>
                Model: {radio.modelUsed} | Language: {radio.languageLabel} |{" "}
                {radio.sampleRate ?? 24000}Hz
              </span>
            </div>
            <audio controls src={radio.objectUrl} className="w-full" />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  onDownloadAudio(
                    radio.objectUrl!,
                    `sigapwire-dispatch-${dispatch.dispatchNumber}-${activeLang.code}.wav`,
                  )
                }
                className="sw-btn-secondary min-h-[44px] px-3 py-1.5 text-xs font-semibold"
              >
                Download Radio Clip (.wav)
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* 3. Resilient Reader Adaptation */}
      <div
        className="pt-4 border-t space-y-2.5"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-bold">
            Resilient Reader Adaptation (PREFER_IN_CLOUD streaming)
          </span>
          {activeAdapt?.inferenceSource ? (
            <InferenceBadge
              source={activeAdapt.inferenceSource}
              latencyMs={activeAdapt.latencyMs ?? undefined}
            />
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {(
            [
              ["PLAIN_ID", "Plain Indonesian (Families)"],
              ["THREE_BULLETS_EN", "3-Bullet Global Wire (EN)"],
              ["RADIO_SCRIPT_ID", "25s Radio Script (ID)"],
            ] as Array<[AdaptationKey, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => onAdapt(key)}
              disabled={activeAdapt?.isStreaming}
              className="sw-btn-secondary min-h-[44px] px-3 py-1.5 text-xs font-semibold"
            >
              {label}
            </button>
          ))}
        </div>

        {activeAdapt ? (
          <div aria-live="polite" className="mt-2">
            {activeAdapt.error ? (
              <p
                role="alert"
                className="text-xs font-medium"
                style={{ color: "var(--state-critical-ink)" }}
              >
                {activeAdapt.error}
              </p>
            ) : (
              <div className="sw-card-ground p-3 text-sm leading-relaxed whitespace-pre-wrap">
                {activeAdapt.text || "Streaming adaptation..."}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
