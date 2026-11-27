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
} from "../lib/hybridAi";
import type {
  DispatchDoc,
  IncidentDoc,
  IntakeDoc,
  OnDeviceDiagnostics,
  SessionAuditEvent,
} from "../types/sigapwire";
import { DispatchProvenanceDrawer } from "./DispatchProvenanceDrawer";
import {
  DispatchReaderToolkit,
  type AdaptationKey,
  type RadioAudioState,
  type ReaderAdaptState,
  type TranslationCacheEntry,
} from "./DispatchReaderToolkit";
import { SealVerifierCard, type SealLookupResult } from "./SealVerifierCard";
import { InferenceBadge, SeverityBadge, VerdictBadge } from "./StatusBadges";
import { CardListSkeleton, handleTabListKeyDown } from "./ui";

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
  const [sealLookupResult, setSealLookupResult] =
    useState<SealLookupResult | null>(null);

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
        if (prevUrl) URL.revokeObjectURL(prevUrl);
        const safeBytes = new Uint8Array(res.wavBytes);
        const mime = res.mimeType || "audio/wav";
        const objectUrl = URL.createObjectURL(
          new Blob([safeBytes], { type: mime }),
        );
        objectUrlsRef.current[dispatch.id] = objectUrl;

        setRadioByDispatch((prev) => ({
          ...prev,
          [dispatch.id]: {
            isGenerating: false,
            usedBrowserSpeechFallback: false,
            isSpeakingBrowser: false,
            objectUrl,
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
          ? (res.fallbackReason ?? "On-device browser speech fallback.")
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
    <section className="mx-auto max-w-4xl px-4 sm:px-6 py-5 sm:py-7">
      {/* Editorial Header */}
      <div
        className="mb-5 border-b pb-4"
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
            <span
              className="font-mono-telemetry text-xs"
              style={{ color: "var(--ink-muted)" }}
            >
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

      <SealVerifierCard
        sealLookupInput={sealLookupInput}
        sealLookupBusy={sealLookupBusy}
        sealLookupResult={sealLookupResult}
        onChangeInput={setSealLookupInput}
        onSubmit={handleVerifyForwardedSeal}
      />

      {dispatchesLoading ? (
        <CardListSkeleton
          label="Loading published crisis dispatches"
          rows={2}
        />
      ) : dispatches.length === 0 ? (
        <div className="sw-card p-6 sm:p-8">
          <h2 className="font-editorial text-xl font-bold">
            No dispatches published yet
          </h2>
          <p className="mt-2 text-sm" style={{ color: "var(--ink-muted)" }}>
            Once an officer synthesizes and publishes intakes in Broadcast Studio, the verified Indonesian Community Alert, National Media Release, Global SitRep, and Debunk Card appear here immediately for the public and press.
          </p>
          <button
            type="button"
            onClick={onGoToStudio}
            className="sw-btn-primary mt-4 inline-flex min-h-[44px] items-center px-4 text-sm font-semibold"
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
            const cachedTranslation = !activeLang.isOriginal
              ? (translationsByKey[cacheKey] ?? null)
              : null;
            const displayedAlert =
              cachedTranslation?.translated ?? dispatch.communityAlertId;
            const translationErr = translationErrors[dispatch.id] ?? null;
            const isTranslating = translatingKey === cacheKey;
            const radio = radioByDispatch[dispatch.id] ?? null;
            const provenanceReport = provenanceByDispatch[dispatch.id] ?? null;
            const isProvenanceOpen = Boolean(
              provenanceOpenByDispatch[dispatch.id],
            );
            const isProvenanceBusy = provenanceBusyId === dispatch.id;

            const availableChannels: Array<[ReaderChannel, string]> = [
              ["community", "Warga (ID)"],
              ["media", "Pers Nasional (ID)"],
              ["global", "Global SitRep (EN)"],
              ...(dispatch.debunkCard.hasRumorAlert
                ? ([["debunk", "Fact-Check / Debunk"]] as Array<
                    [ReaderChannel, string]
                  >)
                : []),
            ];
            const orderedChannelIds = availableChannels.map(([id]) => id);
            const tabPrefix = `wire-${dispatch.id}`;

            return (
              <article key={dispatch.id} className="sw-card p-5 sm:p-6">
                {/* Dispatch Masthead */}
                <div
                  className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono-telemetry text-xs font-bold">
                      DISPATCH #{dispatch.dispatchNumber}
                    </span>
                    <SeverityBadge severity={dispatch.severity} />
                    <InferenceBadge source={dispatch.inferenceSource} />
                    {dispatch.provenanceCode ? (
                      <span
                        className="font-mono-telemetry rounded px-2 py-0.5 text-xs font-semibold border"
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
                      aria-expanded={isProvenanceOpen}
                      className={`${isProvenanceOpen ? "sw-btn-ondevice" : "sw-btn-secondary"} min-h-[44px] px-3 text-xs font-semibold`}
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
                      className="sw-btn-secondary min-h-[44px] px-3 text-xs font-semibold"
                    >
                      Export SitRep (.md)
                    </button>
                  </div>
                </div>

                {isProvenanceOpen && provenanceReport ? (
                  <DispatchProvenanceDrawer
                    dispatchId={dispatch.id}
                    dispatchNumber={dispatch.dispatchNumber}
                    report={provenanceReport}
                    copiedId={copiedId}
                    onCopySeal={handleCopyText}
                  />
                ) : null}

                {/* WAI-ARIA APG Channel Switcher */}
                <div
                  role="tablist"
                  aria-label={`Audience format for dispatch ${dispatch.dispatchNumber}`}
                  className="flex flex-wrap gap-1.5 mb-4"
                >
                  {availableChannels.map(([id, label]) => {
                    const selected = channel === id;
                    return (
                      <button
                        key={id}
                        id={`${tabPrefix}-tab-${id}`}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        aria-controls={`${tabPrefix}-panel`}
                        tabIndex={selected ? 0 : -1}
                        onClick={() =>
                          setChannelByDispatch((prev) => ({
                            ...prev,
                            [dispatch.id]: id,
                          }))
                        }
                        onKeyDown={(e) =>
                          handleTabListKeyDown(
                            e,
                            orderedChannelIds,
                            channel,
                            (nextId) =>
                              setChannelByDispatch((prev) => ({
                                ...prev,
                                [dispatch.id]: nextId,
                              })),
                            tabPrefix,
                          )
                        }
                        className="sw-tab min-h-[44px] px-3 py-1.5 text-xs font-semibold"
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {/* Editorial Bulletin Content FIRST (Headline + Safety Guidance lead) */}
                <div
                  id={`${tabPrefix}-panel`}
                  role="tabpanel"
                  aria-labelledby={`${tabPrefix}-tab-${channel}`}
                >
                  {channel === "community" ? (
                    <div dir={activeLang.dir} className="space-y-3.5 text-sm">
                      <h2 className="font-editorial text-xl sm:text-2xl font-bold leading-snug">
                        {displayedAlert.title}
                      </h2>
                      <p className="leading-relaxed">
                        {displayedAlert.whatHappened}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div
                          className="rounded-md border p-3.5"
                          style={{
                            backgroundColor: "var(--state-ondevice-bg)",
                            borderColor: "var(--state-ondevice-border)",
                            color: "var(--state-ondevice-ink)",
                          }}
                        >
                          <strong className="block mb-1.5">
                            LAKUKAN SEKARANG
                          </strong>
                          <ul className="list-disc pl-4 space-y-1">
                            {displayedAlert.doNow.map((x, i) => (
                              <li key={i}>{x}</li>
                            ))}
                          </ul>
                        </div>
                        <div
                          className="rounded-md border p-3.5"
                          style={{
                            backgroundColor: "var(--state-critical-bg)",
                            borderColor: "var(--state-critical-border)",
                            color: "var(--state-critical-ink)",
                          }}
                        >
                          <strong className="block mb-1.5">HINDARI</strong>
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
                            className="font-mono-telemetry text-xs"
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
                            className="sw-btn-secondary min-h-[44px] px-3 text-xs font-semibold"
                          >
                            {copiedId === `wa-${dispatch.id}`
                              ? "Copied WhatsApp Alert"
                              : "Copy WhatsApp Alert"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {channel === "media" ? (
                    <div className="space-y-2.5 text-sm">
                      <p
                        className="font-mono-telemetry text-xs"
                        style={{ color: "var(--ink-muted)" }}
                      >
                        {dispatch.mediaPressReleaseId.dateline}
                      </p>
                      <h2 className="font-editorial text-xl sm:text-2xl font-bold leading-snug">
                        {dispatch.mediaPressReleaseId.headline}
                      </h2>
                      <p className="leading-relaxed whitespace-pre-wrap">
                        {dispatch.mediaPressReleaseId.body}
                      </p>
                    </div>
                  ) : null}

                  {channel === "global" ? (
                    <div className="space-y-3 text-sm">
                      <h2 className="font-editorial text-xl sm:text-2xl font-bold leading-snug">
                        {dispatch.globalSitrepEn.headline}
                      </h2>
                      <p className="leading-relaxed">
                        {dispatch.globalSitrepEn.executiveSummary}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div>
                          <strong className="block mb-1">Priority Needs</strong>
                          <ul className="list-disc pl-4 space-y-1">
                            {dispatch.globalSitrepEn.priorityNeeds.map(
                              (x, i) => (
                                <li key={i}>{x}</li>
                              ),
                            )}
                          </ul>
                        </div>
                        <div>
                          <strong className="block mb-1">
                            Information Gaps
                          </strong>
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
                              className="sw-btn-secondary inline-flex min-h-[44px] items-center px-3 text-xs underline"
                            >
                              {src.title}
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {/* Required Google Search Grounding Suggestions Widget if present */}
                {dispatch.groundingSearchHtml ? (
                  <div
                    className="grounding-widget-frame mt-4 pt-3 border-t"
                    style={{ borderColor: "var(--border-subtle)" }}
                  >
                    <div
                      dangerouslySetInnerHTML={{
                        __html: dispatch.groundingSearchHtml,
                      }}
                    />
                  </div>
                ) : null}

                {/* Unified Editorial Reader & Accessibility Toolkit */}
                <DispatchReaderToolkit
                  dispatch={dispatch}
                  showTranslation={channel === "community"}
                  activeLang={activeLang}
                  suggestedLangOption={suggestedLangOption}
                  cachedTranslation={cachedTranslation}
                  isTranslating={isTranslating}
                  translationBusy={Boolean(translatingKey)}
                  translationErr={translationErr}
                  activeAdapt={activeAdapt}
                  radio={radio}
                  onSelectLanguage={(lang) =>
                    handleSelectLanguage(dispatch, lang)
                  }
                  onAdapt={(adaptation) => handleAdapt(dispatch, adaptation)}
                  onGenerateRadioAudio={(dualSpeaker) =>
                    handleGenerateRadioAudio(dispatch, dualSpeaker)
                  }
                  onStopBrowserSpeech={() =>
                    handleStopBrowserSpeech(dispatch.id)
                  }
                  onDownloadAudio={downloadBinaryBlob}
                />
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
