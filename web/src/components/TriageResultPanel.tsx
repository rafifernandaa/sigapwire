import type {
  GroundedVerificationResult,
  HybridTriageResult,
} from "../lib/hybridAi";
import type { IntakeMode } from "../types/sigapwire";
import { InferenceBadge, SeverityBadge, VerdictBadge } from "./StatusBadges";

interface TriageResultPanelProps {
  mode: IntakeMode;
  online: boolean;
  triageResult: HybridTriageResult;
  groundedResult: GroundedVerificationResult | null;
  isVerifyingSearch: boolean;
  isSaving: boolean;
  saveFeedback: string | null;
  gapDispatchBusy: Record<number, boolean>;
  dispatchedGaps: Record<number, boolean>;
  onDispatchGap: (index: number, item: string) => void;
  onVerifyWithSearch: () => void;
  onSaveToQueue: () => void;
}

export function TriageResultPanel({
  mode,
  online,
  triageResult,
  groundedResult,
  isVerifyingSearch,
  isSaving,
  saveFeedback,
  gapDispatchBusy,
  dispatchedGaps,
  onDispatchGap,
  onVerifyWithSearch,
  onSaveToQueue,
}: TriageResultPanelProps) {
  const gapOrPanicList =
    mode === "FIELD_REPORT"
      ? triageResult.structured.verificationGaps
      : triageResult.structured.panicSignals.length > 0
        ? triageResult.structured.panicSignals
        : triageResult.structured.verificationGaps;
  const isGapItem =
    mode === "FIELD_REPORT" ||
    triageResult.structured.panicSignals.length === 0;

  return (
    <div className="sw-card p-5">
      <div
        className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-2 border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={triageResult.structured.severity} />
          <span
            className="font-mono-telemetry rounded px-2 py-0.5 text-xs font-medium border"
            style={{
              backgroundColor: "var(--bg-subtle)",
              borderColor: "var(--border-subtle)",
            }}
          >
            {triageResult.structured.hazardType}
          </span>
          <VerdictBadge verdict={triageResult.structured.rumorVerdict} />
        </div>
        <InferenceBadge
          source={triageResult.inferenceSource}
          latencyMs={triageResult.latencyMs}
        />
      </div>

      <p
        className="font-mono-telemetry text-xs mb-3"
        style={{ color: "var(--ink-muted)" }}
      >
        Route: {triageResult.routingReason} (~
        {triageResult.estimatedInputTokens} est. input tokens)
      </p>

      {triageResult.isOfflineDraft ? (
        <div
          role="status"
          className="mb-3 rounded-md border px-3 py-2 text-xs font-medium"
          style={{
            backgroundColor: "var(--state-warn-bg)",
            color: "var(--state-warn-ink)",
            borderColor: "var(--state-warn-border)",
          }}
        >
          Offline draft (no on-device model). Upgrade with Cloud Triage after signal returns.
        </div>
      ) : null}

      <h2 className="font-editorial text-xl font-bold leading-snug">
        {triageResult.structured.headline}
      </h2>
      <p className="mt-1 text-xs font-medium" style={{ color: "var(--ink-muted)" }}>
        Location: {triageResult.structured.location}
      </p>

      {/* Bilingual Summaries */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div className="sw-card-ground p-3">
          <div
            className="font-mono-telemetry text-xs font-semibold mb-1"
            style={{ color: "var(--ink-muted)" }}
          >
            RINGKASAN (BAHASA INDONESIA)
          </div>
          <p className="leading-relaxed">{triageResult.structured.summaryId}</p>
        </div>
        <div className="sw-card-ground p-3">
          <div
            className="font-mono-telemetry text-xs font-semibold mb-1"
            style={{ color: "var(--ink-muted)" }}
          >
            SUMMARY (ENGLISH WIRE)
          </div>
          <p className="leading-relaxed">{triageResult.structured.summaryEn}</p>
        </div>
      </div>

      {/* Structured Facts / Needs / Gaps */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div>
          <h3 className="font-semibold mb-1.5">
            {mode === "FIELD_REPORT" ? "Observed Facts" : "Extracted Claims"}
          </h3>
          <ul className="list-disc pl-4 space-y-1">
            {triageResult.structured.keyFacts.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="font-semibold mb-1.5">
            {mode === "FIELD_REPORT" ? "Urgent Needs" : "Required Agency Checks"}
          </h3>
          <ul className="list-disc pl-4 space-y-1">
            {triageResult.structured.urgentNeeds.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="font-semibold mb-1.5">
            {mode === "FIELD_REPORT"
              ? "Verification Gaps"
              : "Panic / Rumor Signals"}
          </h3>
          <ul className="space-y-2">
            {gapOrPanicList.map((item, i) => {
              const isDispatched = Boolean(dispatchedGaps[i]);
              const isBusyGap = Boolean(gapDispatchBusy[i]);

              return (
                <li key={i} className="space-y-1">
                  <div className="leading-snug">- {item}</div>
                  {isGapItem ? (
                    <button
                      type="button"
                      disabled={isDispatched || isBusyGap || !online}
                      onClick={() => onDispatchGap(i, item)}
                      className={`${isDispatched ? "sw-btn-ondevice" : "sw-btn-secondary"} min-h-[44px] px-2.5 text-xs font-semibold`}
                    >
                      {isDispatched
                        ? "Dispatched to Field"
                        : isBusyGap
                          ? "Dispatching..."
                          : "Request Field Check"}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Stage 3: Google Search Grounding for Rumor Checks */}
      {mode === "RUMOR_CHECK" ? (
        <div className="sw-card-subtle mt-5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold">
                Stage 3: External Fact-Check via Google Search Grounding
              </h3>
              <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
                Escalates only the locally sanitized claim to Cloud Gemini with live Google Search verification.
              </p>
            </div>
            <button
              type="button"
              onClick={onVerifyWithSearch}
              disabled={isVerifyingSearch || !online}
              className="sw-btn-cloud min-h-[44px] px-4 py-2 text-xs font-semibold"
            >
              {isVerifyingSearch
                ? "Searching live sources..."
                : groundedResult
                  ? "Re-run Google Search Check"
                  : "Verify with Google Search (Cloud)"}
            </button>
          </div>

          {groundedResult ? (
            <div
              className="mt-3 pt-3 border-t space-y-3"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <VerdictBadge verdict={groundedResult.verdict} />
                <InferenceBadge
                  source="IN_CLOUD"
                  latencyMs={groundedResult.latencyMs}
                />
              </div>

              {groundedResult.sources.length > 0 ? (
                <div>
                  <div
                    className="font-mono-telemetry text-xs font-semibold mb-1.5"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    GROUNDING SOURCES ({groundedResult.sources.length})
                  </div>
                  <ul className="flex flex-wrap gap-2">
                    {groundedResult.sources.map((src, i) => (
                      <li key={`${src.uri}-${i}`}>
                        <a
                          href={src.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="sw-btn-secondary inline-flex min-h-[44px] items-center px-3 text-xs font-medium underline"
                        >
                          {src.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                  No authoritative web sources matched this synthetic or breaking claim yet; verdict remains guarded.
                </p>
              )}

              {groundedResult.searchEntryPointHtml ? (
                <div className="grounding-widget-frame pt-1">
                  <div
                    dangerouslySetInnerHTML={{
                      __html: groundedResult.searchEntryPointHtml,
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Save to Shared Incident Queue */}
      <div
        className="mt-5 pt-4 border-t flex flex-wrap items-center justify-between gap-3"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
          Only the sanitized text and structured JSON are written to Firestore.
        </p>
        <button
          type="button"
          onClick={onSaveToQueue}
          disabled={isSaving}
          className="sw-btn-primary min-h-[44px] px-5 py-2 text-sm font-semibold"
        >
          {isSaving ? "Saving to Queue..." : "Save to Incident Queue"}
        </button>
      </div>

      {saveFeedback ? (
        <div
          aria-live="polite"
          className="mt-3 rounded-md border p-3 text-xs font-medium"
          style={{
            backgroundColor: "var(--state-ondevice-bg)",
            color: "var(--state-ondevice-ink)",
            borderColor: "var(--state-ondevice-border)",
          }}
        >
          {saveFeedback}
        </div>
      ) : null}
    </div>
  );
}
