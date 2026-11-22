import { useState } from "react";
import { downloadDispatchMarkdown } from "../lib/dispatchExport";
import { streamReaderAdaptation } from "../lib/hybridAi";
import type {
  DispatchDoc,
  IncidentDoc,
  InferenceSourceLabel,
} from "../types/sigapwire";
import { InferenceBadge, SeverityBadge, VerdictBadge } from "./StatusBadges";

interface PublicCrisisWireProps {
  activeIncident: IncidentDoc | null;
  dispatches: DispatchDoc[];
  dispatchesLoading: boolean;
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

export function PublicCrisisWire({
  activeIncident,
  dispatches,
  dispatchesLoading,
  onGoToStudio,
}: PublicCrisisWireProps) {
  const [channelByDispatch, setChannelByDispatch] = useState<
    Record<string, ReaderChannel>
  >({});
  const [adaptState, setAdaptState] = useState<ReaderAdaptState | null>(null);

  const getChannel = (id: string): ReaderChannel =>
    channelByDispatch[id] ?? "community";

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
          Verified, bilingual crisis bulletins published from multi-platform intakes. Readers can adapt any bulletin live via PREFER_IN_CLOUD streaming (automatically falling back to on-device Gemini Nano if internet drops).
        </p>
      </div>

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
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <time
                      dateTime={dispatch.publishedAt.toISOString()}
                      className="font-mono-telemetry text-xs"
                      style={{ color: "var(--ink-muted)" }}
                    >
                      {dispatch.publishedAt.toLocaleString()}
                    </time>
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
                  <div className="space-y-3 text-sm">
                    <h2 className="font-editorial text-xl font-bold">
                      {dispatch.communityAlertId.title}
                    </h2>
                    <p className="leading-relaxed">
                      {dispatch.communityAlertId.whatHappened}
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
                          {dispatch.communityAlertId.doNow.map((x, i) => (
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
                          {dispatch.communityAlertId.avoid.map((x, i) => (
                            <li key={i}>{x}</li>
                          ))}
                        </ul>
                      </div>
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

                {/* Resilient Reader Adapter (PREFER_IN_CLOUD streaming -> On-Device fallback offline!) */}
                <div
                  className="mt-5 rounded-md border p-4"
                  style={{
                    backgroundColor: "var(--bg-subtle)",
                    borderColor: "var(--border-subtle)",
                  }}
                >
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
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
