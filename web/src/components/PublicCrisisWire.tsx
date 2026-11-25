import { useEffect, useMemo, useRef, useState } from "react";
import { buildRadioScriptForTts } from "../lib/audioWav";
import {
  extractProvenanceCodeFromQuery,
  verifyDispatchProvenance,
  type ProvenanceVerificationReport,
} from "../lib/crisisProvenance";
import {
  CRISIS_LANGUAGES,
  detectSuggestedCrisisLanguage,
  type CrisisLanguageCode,
  type CrisisLanguageOption,
} from "../lib/crisisTranslation";
import { downloadDispatchMarkdown } from "../lib/dispatchExport";
import {
  generateCrisisRadioAudio,
  streamReaderAdaptation,
  translateDispatchBulletinHybrid,
  type TranslatedCommunityAlert,
} from "../lib/hybridAi";
import type {
  DispatchDoc,
  IncidentDoc,
  InferenceSourceLabel,
  IntakeDoc,
  OnDeviceDiagnostics,
  SessionAuditEvent,
} from "../types/sigapwire";
import { InferenceBadge, SeverityBadge, VerdictBadge } from "./StatusBadges";

interface PublicCrisisWireProps {
  activeIncident: IncidentDoc | null;
  dispatches: DispatchDoc[];
  intakes: IntakeDoc[];
  dispatchesLoading: boolean;
  diagnostics: OnDeviceDiagnostics;
  onLogSessionEvent: (event: Omit<SessionAuditEvent, "id" | "timestamp">) => void;
  onGoToStudio: () => void;
}

type ReaderChannel = "community" | "media" | "global" | "debunk";
type AdaptationKey = "PLAIN_ID" | "THREE_BULLETS_EN" | "RADIO_SCRIPT_ID";

interface ReaderAdaptState {
  dispatchId: string;
  adaptation: AdaptationKey;
  text: string;
  isStreaming: boolean;
  inferenceSource: InferenceSourceLabel | null;
  latencyMs: number | null;
  error: string | null;
}

interface TranslationCacheEntry {
  translated: TranslatedCommunityAlert;
  inferenceSource: InferenceSourceLabel;
  latencyMs: number;
  numericSafety: {
    passed: boolean;
    sourceTokens: string[];
    missingTokens: string[];
  };
}

interface RadioAudioState {
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

function downloadBinaryBlob(objectUrl: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function PublicCrisisWire({
  activeIncident,
  dispatches,
  intakes,
  dispatchesLoading,
  diagnostics,
  onLogSessionEvent,
  onGoToStudio,
}: PublicCrisisWireProps) {
  const [channelByDispatch, setChannelByDispatch] = useState<
    Record<string, ReaderChannel>
  >({});
  const [adaptState, setAdaptState] = useState<ReaderAdaptState | null>(null);

  const [selectedLangByDispatch, setSelectedLangByDispatch] = useState<
    Record<string, CrisisLanguageCode>
  >({});
  const [translationsByKey, setTranslationsByKey] = useState<
    Record<string, TranslationCacheEntry>
  >({});
  const [translatingKey, setTranslatingKey] = useState<string | null>(null);
  const [translationErrors, setTranslationErrors] = useState<
    Record<string, string>
  >({});

  const [radioByDispatch, setRadioByDispatch] = useState<
    Record<string, RadioAudioState>
  >({});
  const objectUrlsRef = useRef<Record<string, string>>({});

  const [provenanceByDispatch, setProvenanceByDispatch] = useState<
    Record<string, ProvenanceVerificationReport>
  >({});
  const [provenanceOpenByDispatch, setProvenanceOpenByDispatch] = useState<
    Record<string, boolean>
  >({});
  const [provenanceBusyId, setProvenanceBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [sealLookupInput, setSealLookupInput] = useState("");
  const [sealLookupBusy, setSealLookupBusy] = useState(false);
  const [sealLookupResult, setSealLookupResult] = useState<{
    kind: "AUTHENTIC" | "TAMPERED" | "NOT_FOUND" | "INVALID";
    codeSearched: string | null;
    dispatchNumber?: number;
    headline?: string;
    report?: ProvenanceVerificationReport;
    message: string;
  } | null>(null);

  const intakesById = useMemo(() => {
    const map = new Map<string, IntakeDoc>();
    for (const item of intakes) {
      map.set(item.id, item);
    }
    return map;
  }, [intakes]);

  const getLinkedIntakes = (dispatch: DispatchDoc): IntakeDoc[] =>
    dispatch.sourceIntakeIds
      .map((id) => intakesById.get(id))
      .filter((item): item is IntakeDoc => Boolean(item));

  const handleCopyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(key);
      window.setTimeout(() => {
        setCopiedId((curr) => (curr === key ? null : curr));
      }, 2000);
    } catch {
      // Clipboard may be blocked in non-focused frames.
    }
  };

  const handleToggleProvenance = async (dispatch: DispatchDoc) => {
    const currentlyOpen = Boolean(provenanceOpenByDispatch[dispatch.id]);
    if (currentlyOpen) {
      setProvenanceOpenByDispatch((prev) => ({ ...prev, [dispatch.id]: false }));
      return;
    }

    setProvenanceBusyId(dispatch.id);
    try {
      const report = await verifyDispatchProvenance({
        dispatch,
        linkedIntakes: getLinkedIntakes(dispatch),
      });
      setProvenanceByDispatch((prev) => ({ ...prev, [dispatch.id]: report }));
      setProvenanceOpenByDispatch((prev) => ({ ...prev, [dispatch.id]: true }));
      onLogSessionEvent({
        category: "HUMAN_GATE",
        eventType: "PROVENANCE_VERIFIED",
        title: `Verified Dispatch #${dispatch.dispatchNumber} (${report.status})`,
        detail: `Seal ${report.recomputedCode} | ${report.totalPiiKeptOnDevice} PII kept on-device | ${report.linkedIntakeCount} linked source(s).`,
      });
    } finally {
      setProvenanceBusyId((curr) => (curr === dispatch.id ? null : curr));
    }
  };

  const handleVerifyForwardedSeal = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = sealLookupInput.trim();
    if (!trimmed) return;

    const extracted = extractProvenanceCodeFromQuery(trimmed);
    if (!extracted) {
      setSealLookupResult({
        kind: "INVALID",
        codeSearched: null,
        message:
          "No SIGAP-D{n}-{HEX6} verification seal found in that text. Paste a seal code or an entire forwarded WhatsApp alert containing a SigapWire seal.",
      });
      return;
    }

    setSealLookupBusy(true);
    try {
      for (const dispatch of dispatches) {
        const report = await verifyDispatchProvenance({
          dispatch,
          linkedIntakes: getLinkedIntakes(dispatch),
        });
        const matchesStored =
          dispatch.provenanceCode?.toUpperCase() === extracted;
        const matchesRecomputed = report.recomputedCode === extracted;

        if (matchesStored || matchesRecomputed) {
          setProvenanceByDispatch((prev) => ({ ...prev, [dispatch.id]: report }));
          setProvenanceOpenByDispatch((prev) => ({ ...prev, [dispatch.id]: true }));

          if (report.status === "TAMPER_MISMATCH") {
            setSealLookupResult({
              kind: "TAMPERED",
              codeSearched: extracted,
              dispatchNumber: dispatch.dispatchNumber,
              headline: dispatch.communityAlertId.title,
              report,
              message: `Seal ${extracted} matched Dispatch #${dispatch.dispatchNumber}, but the recomputed SHA-256 manifest differs from the stored digest.`,
            });
          } else {
            setSealLookupResult({
              kind: "AUTHENTIC",
              codeSearched: extracted,
              dispatchNumber: dispatch.dispatchNumber,
              headline: dispatch.communityAlertId.title,
              report,
              message: `Authentic SigapWire Dispatch #${dispatch.dispatchNumber} verified intact via live browser SHA-256 recomputation.`,
            });
          }
          onLogSessionEvent({
            category: "HUMAN_GATE",
            eventType: "FORWARDED_SEAL_CHECKED",
            title: `Public Seal Check: ${extracted} (${report.status})`,
            detail: `Matched Dispatch #${dispatch.dispatchNumber} ("${dispatch.communityAlertId.title}").`,
          });
          return;
        }
      }

      setSealLookupResult({
        kind: "NOT_FOUND",
        codeSearched: extracted,
        message: `No published SigapWire bulletin matches seal ${extracted}. Treat this forwarded message as unverified and cross-check official dispatches below.`,
      });
    } finally {
      setSealLookupBusy(false);
    }
  };

  const suggestedLangOption = useMemo(() => {
    const locale =
      typeof navigator !== "undefined" ? navigator.language : undefined;
    const code = detectSuggestedCrisisLanguage(locale);
    return code
      ? (CRISIS_LANGUAGES.find((item) => item.code === code) ?? null)
      : null;
  }, []);

  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => {
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const getChannel = (id: string): ReaderChannel =>
    channelByDispatch[id] ?? "community";

  const getActiveLang = (dispatchId: string): CrisisLanguageOption => {
    const code = selectedLangByDispatch[dispatchId] ?? "id";
    return CRISIS_LANGUAGES.find((l) => l.code === code) ?? CRISIS_LANGUAGES[0];
  };

  const handleSelectLanguage = async (
    dispatch: DispatchDoc,
    lang: CrisisLanguageOption,
  ) => {
    setSelectedLangByDispatch((prev) => ({
      ...prev,
      [dispatch.id]: lang.code,
    }));
    setTranslationErrors((prev) => {
      if (!(dispatch.id in prev)) return prev;
      const next = { ...prev };
      delete next[dispatch.id];
      return next;
    });

    if (lang.isOriginal) return;

    const cacheKey = `${dispatch.id}:${lang.code}`;
    if (translationsByKey[cacheKey]) return;

    setTranslatingKey(cacheKey);
    try {
      const res = await translateDispatchBulletinHybrid({
        alert: dispatch.communityAlertId,
        targetLanguage: lang,
        offline: !diagnostics.online,
      });
      setTranslationsByKey((prev) => ({
        ...prev,
        [cacheKey]: res,
      }));
      onLogSessionEvent({
        category: res.inferenceSource,
        eventType: "BULLETIN_TRANSLATED",
        title: `Translated Dispatch #${dispatch.dispatchNumber} to ${lang.nativeLabel}`,
        detail: `${res.inferenceSource} (${res.latencyMs}ms), Numeric Guard: ${res.numericSafety.passed ? "PASS" : `Check ${res.numericSafety.missingTokens.join(", ")}`}.`,
      });
    } catch (err) {
      setTranslationErrors((prev) => ({
        ...prev,
        [dispatch.id]:
          err instanceof Error ? err.message : "Translation failed.",
      }));
    } finally {
      setTranslatingKey((prev) => (prev === cacheKey ? null : prev));
    }
  };

  const handleAdapt = async (
    dispatch: DispatchDoc,
    adaptation: AdaptationKey,
  ) => {
    const sourceText = [
      dispatch.communityAlertId.title,
      dispatch.communityAlertId.whatHappened,
      dispatch.globalSitrepEn.executiveSummary,
      `Do now: ${dispatch.communityAlertId.doNow.join("; ")}`,
      `Priority needs: ${dispatch.globalSitrepEn.priorityNeeds.join("; ")}`,
    ].join("\n");

    setAdaptState({
      dispatchId: dispatch.id,
      adaptation,
      text: "",
      isStreaming: true,
      inferenceSource: null,
      latencyMs: null,
      error: null,
    });

    try {
      const res = await streamReaderAdaptation({
        sourceText,
        adaptation,
        onChunk: (accumulated) => {
          setAdaptState((prev) =>
            prev ? { ...prev, text: accumulated } : prev,
          );
        },
      });

      setAdaptState({
        dispatchId: dispatch.id,
        adaptation,
        text: res.text,
        isStreaming: false,
        inferenceSource: res.inferenceSource,
        latencyMs: res.latencyMs,
        error: null,
      });
    } catch (err) {
      setAdaptState((prev) =>
        prev
          ? {
              ...prev,
              isStreaming: false,
              error:
                err instanceof Error
                  ? err.message
                  : "Reader adaptation failed.",
            }
          : prev,
      );
    }
  };

  const handleStopBrowserSpeech = (dispatchId: string) => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setRadioByDispatch((prev) => {
      const existing = prev[dispatchId];
      if (!existing) return prev;
      return {
        ...prev,
        [dispatchId]: { ...existing, isSpeakingBrowser: false },
      };
    });
  };

  const handleGenerateRadioAudio = async (
    dispatch: DispatchDoc,
    dualSpeaker: boolean,
  ) => {
    const activeLang = getActiveLang(dispatch.id);
    const cacheKey = `${dispatch.id}:${activeLang.code}`;
    const displayedAlert =
      !activeLang.isOriginal && translationsByKey[cacheKey]
        ? translationsByKey[cacheKey].translated
        : dispatch.communityAlertId;

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    const scriptText = buildRadioScriptForTts({
      dispatchNumber: dispatch.dispatchNumber,
      title: displayedAlert.title,
      whatHappened: displayedAlert.whatHappened,
      doNow: displayedAlert.doNow,
      avoid: displayedAlert.avoid,
      languageName: `${activeLang.label} (${activeLang.nativeLabel})`,
      debunkCard: dispatch.debunkCard,
      dualSpeaker,
    });

    setRadioByDispatch((prev) => ({
      ...prev,
      [dispatch.id]: {
        isGenerating: true,
        usedBrowserSpeechFallback: false,
        isSpeakingBrowser: false,
        objectUrl: prev[dispatch.id]?.objectUrl ?? null,
        wavBytes: null,
        mimeType: "audio/wav",
        sampleRate: null,
        inferenceSource: null,
        modelUsed: null,
        latencyMs: null,
        languageLabel: activeLang.nativeLabel,
        dualSpeaker,
        fallbackReason: null,
        error: null,
      },
    }));

    try {
      const res = await generateCrisisRadioAudio({
        scriptText,
        languageCode: activeLang.code,
        bcp47: activeLang.bcp47,
        dualSpeaker,
        offline: !diagnostics.online,
      });

      if (!res.usedBrowserSpeechFallback && res.wavBytes) {
        const prevUrl = objectUrlsRef.current[dispatch.id];
        if (prevUrl) {
          URL.revokeObjectURL(prevUrl);
        }
        const safeBytes = new Uint8Array(res.wavBytes);
        const mime = res.mimeType || "audio/wav";
        const objectUrl = URL.createObjectURL(new Blob([safeBytes], { type: mime }));
        objectUrlsRef.current[dispatch.id] = objectUrl;

        setRadioByDispatch((prev) => ({
          ...prev,
          [dispatch.id]: {
            isGenerating: false,
            usedBrowserSpeechFallback: false,
            isSpeakingBrowser: false,
            objectUrl,
            wavBytes: safeBytes,
            mimeType: mime,
            sampleRate: res.sampleRate ?? 24000,
            inferenceSource: res.inferenceSource,
            modelUsed: res.modelUsed ?? "gemini-3.8-flash-tts",
            latencyMs: res.latencyMs,
            languageLabel: activeLang.nativeLabel,
            dualSpeaker,
            fallbackReason: null,
            error: null,
          },
        }));
      } else {
        let speakingNow = false;
        if (typeof window !== "undefined" && "speechSynthesis" in window) {
          const spokenLines = [
            `${displayedAlert.title}. ${displayedAlert.whatHappened}`,
            displayedAlert.doNow.length > 0
              ? `${displayedAlert.doNow.slice(0, 3).join(". ")}.`
              : "",
            dualSpeaker && dispatch.debunkCard.hasRumorAlert
              ? `${dispatch.debunkCard.verdict}: ${activeLang.code === "en" ? dispatch.debunkCard.factEn : dispatch.debunkCard.factId}`
              : "",
          ]
            .filter(Boolean)
            .join(" ");

          const utterance = new SpeechSynthesisUtterance(spokenLines);
          utterance.lang = activeLang.bcp47;
          utterance.rate = 0.95;
          const langPrefix = activeLang.bcp47.split("-")[0].toLowerCase();
          const matchedVoice = window.speechSynthesis
            .getVoices()
            .find((v) => v.lang.toLowerCase().startsWith(langPrefix));
          if (matchedVoice) {
            utterance.voice = matchedVoice;
          }
          utterance.onend = () => {
            setRadioByDispatch((curr) =>
              curr[dispatch.id]
                ? {
                    ...curr,
                    [dispatch.id]: {
                      ...curr[dispatch.id],
                      isSpeakingBrowser: false,
                    },
                  }
                : curr,
            );
          };
          utterance.onerror = () => {
            setRadioByDispatch((curr) =>
              curr[dispatch.id]
                ? {
                    ...curr,
                    [dispatch.id]: {
                      ...curr[dispatch.id],
                      isSpeakingBrowser: false,
                    },
                  }
                : curr,
            );
          };
          window.speechSynthesis.speak(utterance);
          speakingNow = true;
        }

        setRadioByDispatch((prev) => ({
          ...prev,
          [dispatch.id]: {
            isGenerating: false,
            usedBrowserSpeechFallback: true,
            isSpeakingBrowser: speakingNow,
            objectUrl: null,
            wavBytes: null,
            mimeType: "audio/wav",
            sampleRate: null,
            inferenceSource: "ON_DEVICE",
            modelUsed: "Web Speech API (Browser Fallback)",
            latencyMs: res.latencyMs,
            languageLabel: activeLang.nativeLabel,
            dualSpeaker,
            fallbackReason:
              res.fallbackReason ??
              "Switched to on-device browser speech synthesis.",
            error: null,
          },
        }));
      }

      onLogSessionEvent({
        category: res.inferenceSource,
        eventType: "RADIO_AUDIO_GENERATED",
        title: `Radio Audio for Dispatch #${dispatch.dispatchNumber} (${activeLang.nativeLabel})`,
        detail: res.usedBrowserSpeechFallback
          ? res.fallbackReason ?? "On-device browser speech fallback."
          : `${res.modelUsed ?? "Gemini TTS"} (${res.sampleRate ?? 24000}Hz WAV, ${res.latencyMs}ms).`,
      });
    } catch (err) {
      setRadioByDispatch((prev) => ({
        ...prev,
        [dispatch.id]: {
          ...(prev[dispatch.id] ?? {
            usedBrowserSpeechFallback: false,
            isSpeakingBrowser: false,
            objectUrl: null,
            wavBytes: null,
            mimeType: "audio/wav",
            sampleRate: null,
            inferenceSource: null,
            modelUsed: null,
            latencyMs: null,
            languageLabel: activeLang.nativeLabel,
            dualSpeaker,
            fallbackReason: null,
          }),
          isGenerating: false,
          error:
            err instanceof Error
              ? err.message
              : "Could not generate radio broadcast audio.",
        },
      }));
    }
  };

  return (
    <section className="mx-auto max-w-4xl px-4 sm:px-6 py-6 sm:py-8">
      {/* Editorial Header */}
      <div
        className="mb-6 border-b pb-5"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span
            className="font-mono-telemetry rounded px-2 py-0.5 text-xs font-semibold border"
            style={{
              backgroundColor: "var(--state-warn-bg)",
              color: "var(--state-warn-ink)",
              borderColor: "var(--state-warn-border)",
            }}
          >
            SYNTHETIC DRILL FEED
          </span>
          {activeIncident ? (
            <span className="font-mono-telemetry text-xs" style={{ color: "var(--ink-muted)" }}>
              {activeIncident.region}
            </span>
          ) : null}
        </div>
        <h1 className="font-editorial text-2xl sm:text-3xl font-bold tracking-tight">
          Public &amp; Global Crisis Wire
        </h1>
        <p className="mt-1.5 text-sm" style={{ color: "var(--ink-muted)" }}>
          Verified, multilingual crisis bulletins published from multi-platform intakes. Citizens and responders can verify forwarded WhatsApp alert seals, translate alerts into regional dialects, stream adaptations via PREFER_IN_CLOUD, or generate Crisis Radio audio via Firebase AI Logic TTS.
        </p>
      </div>

      {/* Anti-Forgery Public Seal Verifier */}
      <section
        aria-label="Verify Forwarded Alert Seal"
        className="mb-6 rounded-lg border p-4 space-y-3"
        style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <div>
          <h2 className="text-sm font-bold">
            Verify Forwarded WhatsApp Alert (Anti-Forgery Seal Check)
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
            Paste a SIGAP-D1-XXXXXX code or an entire forwarded alert to recompute its SHA-256 manifest live and verify that zero raw victim PII left field devices.
          </p>
        </div>
        <form
          onSubmit={handleVerifyForwardedSeal}
          className="flex flex-col sm:flex-row gap-2"
        >
          <input
            type="text"
            aria-label="Forwarded alert text or SigapWire seal code"
            value={sealLookupInput}
            onChange={(e) => setSealLookupInput(e.target.value)}
            placeholder="Paste SIGAP-D1-XXXXXX or full forwarded WhatsApp alert..."
            className="min-h-[44px] flex-1 rounded-md border px-3 text-xs"
            style={{
              backgroundColor: "var(--bg-ground)",
              borderColor: "var(--border-strong)",
              color: "var(--ink-primary)",
            }}
          />
          <button
            type="submit"
            disabled={sealLookupBusy || !sealLookupInput.trim()}
            className="min-h-[44px] shrink-0 rounded-md px-4 text-xs font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: "var(--accent-vermilion)" }}
          >
            {sealLookupBusy ? "Verifying SHA-256..." : "Verify Seal"}
          </button>
        </form>

        {sealLookupResult ? (
          <div
            role="status"
            aria-live="polite"
            className="rounded-md border p-3 text-xs space-y-1.5"
            style={
              sealLookupResult.kind === "AUTHENTIC"
                ? {
                    backgroundColor: "var(--state-ondevice-bg)",
                    borderColor: "var(--state-ondevice-border)",
                    color: "var(--state-ondevice-ink)",
                  }
                : sealLookupResult.kind === "TAMPERED"
                  ? {
                      backgroundColor: "var(--state-critical-bg)",
                      borderColor: "var(--state-critical-border)",
                      color: "var(--state-critical-ink)",
                    }
                  : {
                      backgroundColor: "var(--state-warn-bg)",
                      borderColor: "var(--state-warn-border)",
                      color: "var(--state-warn-ink)",
                    }
            }
          >
            <div className="font-mono-telemetry font-bold">
              {sealLookupResult.kind === "AUTHENTIC"
                ? `AUTHENTIC BULLETIN VERIFIED (${sealLookupResult.codeSearched})`
                : sealLookupResult.kind === "TAMPERED"
                  ? `INTEGRITY MISMATCH DETECTED (${sealLookupResult.codeSearched})`
                  : sealLookupResult.kind === "NOT_FOUND"
                    ? `UNVERIFIED FORWARD (${sealLookupResult.codeSearched})`
                    : "NO SEAL FOUND"}
            </div>
            <p>{sealLookupResult.message}</p>
            {sealLookupResult.report ? (
              <p className="font-mono-telemetry text-[11px]">
                Headline: {sealLookupResult.headline} | PII Blocked Locally: {sealLookupResult.report.totalPiiKeptOnDevice} | Sources: {sealLookupResult.report.linkedIntakeCount} ({sealLookupResult.report.platforms.join(", ") || "Synced"}) | Grounding Citations: {sealLookupResult.report.groundingSourceCount}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {dispatchesLoading ? (
        <div
          className="rounded-lg border p-6 text-sm"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: "var(--border-subtle)",
            color: "var(--ink-muted)",
          }}
        >
          Loading published crisis dispatches...
        </div>
      ) : dispatches.length === 0 ? (
        <div
          className="rounded-lg border p-8"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <h2 className="font-editorial text-xl font-bold">
            No dispatches published yet
          </h2>
          <p className="mt-2 text-sm" style={{ color: "var(--ink-muted)" }}>
            Once an officer synthesizes and publishes intakes in Broadcast Studio, the verified Indonesian Community Alert, National Media Release, Global SitRep, and Debunk Card appear here immediately for the public and press.
          </p>
          <button
            type="button"
            onClick={onGoToStudio}
            className="mt-4 inline-flex min-h-[44px] items-center rounded-md px-4 text-sm font-semibold text-white"
            style={{ backgroundColor: "var(--accent-vermilion)" }}
          >
            Go to Broadcast Studio
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {dispatches.map((dispatch) => {
            const channel = getChannel(dispatch.id);
            const activeAdapt =
              adaptState?.dispatchId === dispatch.id ? adaptState : null;
            const activeLang = getActiveLang(dispatch.id);
            const cacheKey = `${dispatch.id}:${activeLang.code}`;
            const cachedTranslation =
              !activeLang.isOriginal ? translationsByKey[cacheKey] ?? null : null;
            const displayedAlert =
              cachedTranslation?.translated ?? dispatch.communityAlertId;
            const translationErr = translationErrors[dispatch.id] ?? null;
            const isTranslating = translatingKey === cacheKey;
            const radio = radioByDispatch[dispatch.id] ?? null;
            const provenanceReport = provenanceByDispatch[dispatch.id] ?? null;
            const isProvenanceOpen = Boolean(provenanceOpenByDispatch[dispatch.id]);
            const isProvenanceBusy = provenanceBusyId === dispatch.id;

            return (
              <article
                key={dispatch.id}
                className="rounded-lg border p-5 sm:p-6"
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderColor: "var(--border-subtle)",
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b" style={{ borderColor: "var(--border-subtle)" }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono-telemetry text-xs font-bold">
                      DISPATCH #{dispatch.dispatchNumber}
                    </span>
                    <SeverityBadge severity={dispatch.severity} />
                    <InferenceBadge source={dispatch.inferenceSource} />
                    {dispatch.provenanceCode ? (
                      <span
                        className="font-mono-telemetry rounded px-2 py-0.5 text-[11px] font-semibold border"
                        style={{
                          backgroundColor: "var(--state-ondevice-bg)",
                          color: "var(--state-ondevice-ink)",
                          borderColor: "var(--state-ondevice-border)",
                        }}
                      >
                        SEAL: {dispatch.provenanceCode}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <time
                      dateTime={dispatch.publishedAt.toISOString()}
                      className="font-mono-telemetry text-xs"
                      style={{ color: "var(--ink-muted)" }}
                    >
                      {dispatch.publishedAt.toLocaleString()}
                    </time>
                    <button
                      type="button"
                      onClick={() => handleToggleProvenance(dispatch)}
                      disabled={isProvenanceBusy}
                      className="min-h-[44px] rounded-md border px-3 text-xs font-semibold"
                      style={{
                        backgroundColor: isProvenanceOpen
                          ? "var(--state-ondevice-bg)"
                          : "var(--bg-subtle)",
                        borderColor: isProvenanceOpen
                          ? "var(--state-ondevice-border)"
                          : "var(--border-strong)",
                        color: isProvenanceOpen
                          ? "var(--state-ondevice-ink)"
                          : "var(--ink-primary)",
                      }}
                    >
                      {isProvenanceBusy
                        ? "Checking SHA-256..."
                        : isProvenanceOpen
                          ? "Hide Provenance"
                          : "Verify Provenance"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        downloadDispatchMarkdown(
                          `sigapwire-dispatch-${dispatch.dispatchNumber}.md`,
                          {
                            dispatchNumber: dispatch.dispatchNumber,
                            severity: dispatch.severity,
                            inferenceSource: dispatch.inferenceSource,
                            incidentTitle: activeIncident?.title,
                            region: activeIncident?.region,
                            publishedAt: dispatch.publishedAt,
                            communityAlertId: dispatch.communityAlertId,
                            mediaPressReleaseId: dispatch.mediaPressReleaseId,
                            globalSitrepEn: dispatch.globalSitrepEn,
                            debunkCard: dispatch.debunkCard,
                            manifestSha256: dispatch.manifestSha256,
                            provenanceCode: dispatch.provenanceCode,
                          },
                        )
                      }
                      className="min-h-[44px] rounded-md border px-3 text-xs font-semibold"
                      style={{
                        backgroundColor: "var(--bg-subtle)",
                        borderColor: "var(--border-strong)",
                        color: "var(--ink-primary)",
                      }}
                    >
                      Export SitRep (.md)
                    </button>
                  </div>
                </div>

                {isProvenanceOpen && provenanceReport ? (
                  <div
                    role="region"
                    aria-label={`Provenance receipt for dispatch ${dispatch.dispatchNumber}`}
                    className="mb-4 rounded-md border p-3.5 text-xs space-y-2.5"
                    style={{
                      backgroundColor: "var(--bg-subtle)",
                      borderColor:
                        provenanceReport.status === "VERIFIED_INTACT"
                          ? "var(--state-ondevice-border)"
                          : provenanceReport.status === "TAMPER_MISMATCH"
                            ? "var(--state-critical-border)"
                            : "var(--state-warn-border)",
                    }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        className="font-mono-telemetry rounded px-2 py-0.5 text-[11px] font-bold border"
                        style={
                          provenanceReport.status === "VERIFIED_INTACT"
                            ? {
                                backgroundColor: "var(--state-ondevice-bg)",
                                color: "var(--state-ondevice-ink)",
                                borderColor: "var(--state-ondevice-border)",
                              }
                            : provenanceReport.status === "TAMPER_MISMATCH"
                              ? {
                                  backgroundColor: "var(--state-critical-bg)",
                                  color: "var(--state-critical-ink)",
                                  borderColor: "var(--state-critical-border)",
                                }
                              : {
                                  backgroundColor: "var(--state-warn-bg)",
                                  color: "var(--state-warn-ink)",
                                  borderColor: "var(--state-warn-border)",
                                }
                        }
                      >
                        {provenanceReport.status === "VERIFIED_INTACT"
                          ? "SHA-256 VERIFIED INTACT"
                          : provenanceReport.status === "TAMPER_MISMATCH"
                            ? "TAMPER MISMATCH"
                            : "LEGACY UNSEALED (PRE-PROVENANCE)"}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyText(
                            `seal-${dispatch.id}`,
                            provenanceReport.storedCode ??
                              provenanceReport.recomputedCode,
                          )
                        }
                        className="min-h-[44px] rounded border px-3 text-[11px] font-semibold"
                        style={{
                          backgroundColor: "var(--bg-surface)",
                          borderColor: "var(--border-strong)",
                          color: "var(--ink-primary)",
                        }}
                      >
                        {copiedId === `seal-${dispatch.id}`
                          ? "Copied Seal Code"
                          : `Copy Seal (${provenanceReport.storedCode ?? provenanceReport.recomputedCode})`}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono-telemetry text-[11px]">
                      <div className="rounded border p-2" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
                        <div style={{ color: "var(--ink-muted)" }}>SOURCES</div>
                        <div className="font-bold">
                          {provenanceReport.linkedIntakeCount} ({provenanceReport.platforms.join("/") || "Synced"})
                        </div>
                      </div>
                      <div className="rounded border p-2" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
                        <div style={{ color: "var(--ink-muted)" }}>PII ON-DEVICE</div>
                        <div className="font-bold">
                          {provenanceReport.totalPiiKeptOnDevice} blocked
                        </div>
                      </div>
                      <div className="rounded border p-2" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
                        <div style={{ color: "var(--ink-muted)" }}>HYBRID SPLIT</div>
                        <div className="font-bold">
                          {provenanceReport.onDeviceIntakeCount} local / {provenanceReport.inCloudIntakeCount} cloud
                        </div>
                      </div>
                      <div className="rounded border p-2" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
                        <div style={{ color: "var(--ink-muted)" }}>EVIDENCE</div>
                        <div className="font-bold">
                          {provenanceReport.hashedEvidenceCount} hash | {provenanceReport.groundingSourceCount} web
                        </div>
                      </div>
                    </div>

                    <div className="font-mono-telemetry text-[11px] break-all" style={{ color: "var(--ink-muted)" }}>
                      Live Recomputed SHA-256: {provenanceReport.recomputedSha256}
                    </div>
                  </div>
                ) : null}

                {/* Channel Switcher */}
                <div
                  role="tablist"
                  aria-label={`Audience format for dispatch ${dispatch.dispatchNumber}`}
                  className="flex flex-wrap gap-1.5 mb-4"
                >
                  {(
                    [
                      ["community", "Warga (ID)"],
                      ["media", "Pers Nasional (ID)"],
                      ["global", "Global SitRep (EN)"],
                      ...(dispatch.debunkCard.hasRumorAlert
                        ? ([["debunk", "Fact-Check / Debunk"]] as Array<
                            [ReaderChannel, string]
                          >)
                        : []),
                    ] as Array<[ReaderChannel, string]>
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={channel === id}
                      onClick={() =>
                        setChannelByDispatch((prev) => ({
                          ...prev,
                          [dispatch.id]: id,
                        }))
                      }
                      className="min-h-[44px] rounded-md px-3 py-1.5 text-xs font-semibold border"
                      style={{
                        backgroundColor:
                          channel === id ? "var(--bg-subtle)" : "transparent",
                        borderColor:
                          channel === id
                            ? "var(--border-strong)"
                            : "var(--border-subtle)",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {channel === "community" ? (
                  <div className="space-y-4 text-sm">
                    {/* Karrot-Inspired Hyperlocal & Tourist Language Banner */}
                    <div
                      className="rounded-md border p-3 space-y-2.5"
                      style={{
                        backgroundColor: "var(--bg-subtle)",
                        borderColor: "var(--border-subtle)",
                      }}
                    >
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
                                className="font-mono-telemetry rounded px-2 py-0.5 text-[11px] font-semibold border"
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

                      {suggestedLangOption &&
                      activeLang.code !== suggestedLangOption.code ? (
                        <button
                          type="button"
                          onClick={() =>
                            handleSelectLanguage(dispatch, suggestedLangOption)
                          }
                          className="min-h-[44px] w-full rounded-md border px-3 py-2 text-left text-xs font-semibold"
                          style={{
                            backgroundColor: "var(--state-cloud-bg)",
                            color: "var(--state-cloud-ink)",
                            borderColor: "var(--state-cloud-border)",
                          }}
                        >
                          Browser language detected: Translate this alert to {suggestedLangOption.nativeLabel}?
                        </button>
                      ) : null}

                      <div className="flex flex-wrap gap-1.5">
                        {CRISIS_LANGUAGES.map((lang) => {
                          const selected = activeLang.code === lang.code;
                          return (
                            <button
                              key={lang.code}
                              type="button"
                              onClick={() => handleSelectLanguage(dispatch, lang)}
                              disabled={Boolean(translatingKey)}
                              aria-pressed={selected}
                              title={`${lang.label} (${lang.regionHint})`}
                              className="min-h-[44px] rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                              style={{
                                backgroundColor: selected
                                  ? "var(--bg-surface)"
                                  : "transparent",
                                borderColor: selected
                                  ? "var(--border-strong)"
                                  : "var(--border-subtle)",
                                color: "var(--ink-primary)",
                              }}
                            >
                              {lang.nativeLabel}
                            </button>
                          );
                        })}
                      </div>

                      {isTranslating ? (
                        <p
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

                    <div dir={activeLang.dir} className="space-y-3">
                      <h2 className="font-editorial text-xl font-bold">
                        {displayedAlert.title}
                      </h2>
                      <p className="leading-relaxed">
                        {displayedAlert.whatHappened}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div
                          className="rounded-md border p-3"
                          style={{
                            backgroundColor: "var(--state-ondevice-bg)",
                            borderColor: "var(--state-ondevice-border)",
                            color: "var(--state-ondevice-ink)",
                          }}
                        >
                          <strong className="block mb-1">LAKUKAN SEKARANG</strong>
                          <ul className="list-disc pl-4 space-y-1">
                            {displayedAlert.doNow.map((x, i) => (
                              <li key={i}>{x}</li>
                            ))}
                          </ul>
                        </div>
                        <div
                          className="rounded-md border p-3"
                          style={{
                            backgroundColor: "var(--state-critical-bg)",
                            borderColor: "var(--state-critical-border)",
                            color: "var(--state-critical-ink)",
                          }}
                        >
                          <strong className="block mb-1">HINDARI</strong>
                          <ul className="list-disc pl-4 space-y-1">
                            {displayedAlert.avoid.map((x, i) => (
                              <li key={i}>{x}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                      {dispatch.communityAlertId.whatsappShortText ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <span
                            className="font-mono-telemetry text-[11px]"
                            style={{ color: "var(--ink-muted)" }}
                          >
                            {dispatch.provenanceCode
                              ? `WhatsApp copy includes verification seal ${dispatch.provenanceCode}.`
                              : "Ready to copy for community WhatsApp / SMS groups."}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              handleCopyText(
                                `wa-${dispatch.id}`,
                                dispatch.communityAlertId.whatsappShortText,
                              )
                            }
                            className="min-h-[44px] rounded-md border px-3 text-xs font-semibold"
                            style={{
                              backgroundColor: "var(--bg-subtle)",
                              borderColor: "var(--border-strong)",
                              color: "var(--ink-primary)",
                            }}
                          >
                            {copiedId === `wa-${dispatch.id}`
                              ? "Copied WhatsApp Alert"
                              : "Copy WhatsApp Alert"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {channel === "media" ? (
                  <div className="space-y-2.5 text-sm">
                    <p className="font-mono-telemetry text-xs" style={{ color: "var(--ink-muted)" }}>
                      {dispatch.mediaPressReleaseId.dateline}
                    </p>
                    <h2 className="font-editorial text-xl font-bold">
                      {dispatch.mediaPressReleaseId.headline}
                    </h2>
                    <p className="leading-relaxed whitespace-pre-wrap">
                      {dispatch.mediaPressReleaseId.body}
                    </p>
                  </div>
                ) : null}

                {channel === "global" ? (
                  <div className="space-y-3 text-sm">
                    <h2 className="font-editorial text-xl font-bold">
                      {dispatch.globalSitrepEn.headline}
                    </h2>
                    <p className="leading-relaxed">
                      {dispatch.globalSitrepEn.executiveSummary}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div>
                        <strong className="block mb-1">Priority Needs</strong>
                        <ul className="list-disc pl-4 space-y-1">
                          {dispatch.globalSitrepEn.priorityNeeds.map((x, i) => (
                            <li key={i}>{x}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <strong className="block mb-1">Information Gaps</strong>
                        <ul className="list-disc pl-4 space-y-1">
                          {dispatch.globalSitrepEn.informationGaps.map(
                            (x, i) => (
                              <li key={i}>{x}</li>
                            ),
                          )}
                        </ul>
                      </div>
                    </div>
                  </div>
                ) : null}

                {channel === "debunk" && dispatch.debunkCard.hasRumorAlert ? (
                  <div className="space-y-3 text-sm">
                    <VerdictBadge verdict={dispatch.debunkCard.verdict} />
                    <p className="font-semibold">
                      Claim: {dispatch.debunkCard.claim}
                    </p>
                    <p>{dispatch.debunkCard.factId}</p>
                    <p style={{ color: "var(--ink-muted)" }}>
                      {dispatch.debunkCard.factEn}
                    </p>
                    {dispatch.debunkCard.sources.length > 0 ? (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {dispatch.debunkCard.sources.map((src, i) => (
                          <a
                            key={`${src.uri}-${i}`}
                            href={src.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-[44px] items-center rounded border px-3 text-xs underline"
                            style={{ borderColor: "var(--border-strong)" }}
                          >
                            {src.title}
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* Required Google Search Grounding Suggestions Widget if present */}
                {dispatch.groundingSearchHtml ? (
                  <div className="grounding-widget-frame mt-4 pt-3 border-t" style={{ borderColor: "var(--border-subtle)" }}>
                    <div
                      dangerouslySetInnerHTML={{
                        __html: dispatch.groundingSearchHtml,
                      }}
                    />
                  </div>
                ) : null}

                {/* Resilient Reader Adaptation + Crisis Radio Audio Broadcast */}
                <div
                  className="mt-5 rounded-md border p-4 space-y-4"
                  style={{
                    backgroundColor: "var(--bg-subtle)",
                    borderColor: "var(--border-subtle)",
                  }}
                >
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
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
                          onClick={() => handleAdapt(dispatch, key)}
                          disabled={activeAdapt?.isStreaming}
                          className="min-h-[44px] rounded-md border px-3 py-1.5 text-xs font-semibold"
                          style={{
                            backgroundColor: "var(--bg-surface)",
                            borderColor: "var(--border-strong)",
                            color: "var(--ink-primary)",
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {activeAdapt ? (
                      <div aria-live="polite" className="mt-3">
                        {activeAdapt.error ? (
                          <p
                            role="alert"
                            className="text-xs font-medium"
                            style={{ color: "var(--state-critical-ink)" }}
                          >
                            {activeAdapt.error}
                          </p>
                        ) : (
                          <div
                            className="rounded-md border p-3 text-sm leading-relaxed whitespace-pre-wrap"
                            style={{
                              backgroundColor: "var(--bg-surface)",
                              borderColor: "var(--border-subtle)",
                            }}
                          >
                            {activeAdapt.text || "Streaming adaptation..."}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>

                  {/* Crisis Radio Audio Broadcast (Firebase AI Logic TTS + Offline Speech Fallback) */}
                  <div
                    className="pt-3 border-t space-y-2.5"
                    style={{ borderColor: "var(--border-subtle)" }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-bold block">
                          Crisis Radio &amp; PA Loudspeaker Audio ({activeLang.nativeLabel})
                        </span>
                        <span
                          className="text-[11px]"
                          style={{ color: "var(--ink-muted)" }}
                        >
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
                              className="font-mono-telemetry rounded px-2 py-0.5 text-[11px] font-semibold border"
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
                        onClick={() => handleGenerateRadioAudio(dispatch, false)}
                        disabled={Boolean(radio?.isGenerating)}
                        className="min-h-[44px] rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                        style={{
                          backgroundColor: "var(--bg-surface)",
                          borderColor: "var(--border-strong)",
                          color: "var(--ink-primary)",
                        }}
                      >
                        {radio?.isGenerating && !radio.dualSpeaker
                          ? "Synthesizing Radio Audio..."
                          : "Play Radio Audio (Gemini TTS)"}
                      </button>

                      {dispatch.debunkCard.hasRumorAlert ? (
                        <button
                          type="button"
                          onClick={() => handleGenerateRadioAudio(dispatch, true)}
                          disabled={Boolean(radio?.isGenerating)}
                          className="min-h-[44px] rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                          style={{
                            backgroundColor: "var(--state-cloud-bg)",
                            borderColor: "var(--state-cloud-border)",
                            color: "var(--state-cloud-ink)",
                          }}
                        >
                          {radio?.isGenerating && radio.dualSpeaker
                            ? "Synthesizing 2-Voice Debunk..."
                            : "2-Voice Rumor Debunk Audio"}
                        </button>
                      ) : null}

                      {radio?.isSpeakingBrowser ? (
                        <button
                          type="button"
                          onClick={() => handleStopBrowserSpeech(dispatch.id)}
                          className="min-h-[44px] rounded-md border px-3 py-1.5 text-xs font-semibold"
                          style={{
                            backgroundColor: "var(--state-critical-bg)",
                            borderColor: "var(--state-critical-border)",
                            color: "var(--state-critical-ink)",
                          }}
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
                      <div
                        className="rounded-md border p-3 space-y-2"
                        style={{
                          backgroundColor: "var(--bg-surface)",
                          borderColor: "var(--border-subtle)",
                        }}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono-telemetry" style={{ color: "var(--ink-muted)" }}>
                          <span>
                            Model: {radio.modelUsed} | Language: {radio.languageLabel} | {radio.sampleRate ?? 24000}Hz
                          </span>
                        </div>
                        <audio controls src={radio.objectUrl} className="w-full" />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              downloadBinaryBlob(
                                radio.objectUrl!,
                                `sigapwire-dispatch-${dispatch.dispatchNumber}-${activeLang.code}.wav`,
                              )
                            }
                            className="min-h-[44px] rounded-md border px-3 py-1.5 text-xs font-semibold"
                            style={{
                              backgroundColor: "var(--bg-subtle)",
                              borderColor: "var(--border-strong)",
                              color: "var(--ink-primary)",
                            }}
                          >
                            Download Radio Clip (.wav)
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
