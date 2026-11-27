import type { LocalPrivacyResult } from "../types/sigapwire";
import { InferenceBadge } from "./StatusBadges";

function highlightRedactions(text: string) {
  const parts = text.split(/(\[[A-Z0-9_]+\])/g);
  return parts.map((part, idx) => {
    if (/^\[[A-Z0-9_]+\]$/.test(part)) {
      return (
        <mark
          key={idx}
          className="font-mono-telemetry rounded px-1 py-0.5 text-xs font-semibold"
          style={{
            backgroundColor: "var(--state-ondevice-bg)",
            color: "var(--state-ondevice-ink)",
          }}
        >
          {part}
        </mark>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

interface PrivacyDiffPanelProps {
  rawInput: string;
  privacyResult: LocalPrivacyResult;
}

export function PrivacyDiffPanel({
  rawInput,
  privacyResult,
}: PrivacyDiffPanelProps) {
  return (
    <div className="sw-card p-5">
      <div
        className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div>
          <h2 className="text-base font-bold">
            Stage 1: Local Privacy Firewall (PII Diff)
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
            {privacyResult.usedRegexFallback
              ? "Executed via local deterministic privacy scrubber (Gemini Nano not active in this browser)."
              : "Executed strictly on-device via Firebase AI Logic ONLY_ON_DEVICE."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <InferenceBadge source="ON_DEVICE" latencyMs={privacyResult.latencyMs} />
          <span
            className="font-mono-telemetry rounded px-2 py-0.5 text-xs font-semibold border"
            style={{
              backgroundColor: "var(--bg-subtle)",
              borderColor: "var(--border-subtle)",
            }}
          >
            {privacyResult.redactions.length} redacted
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <div className="sw-card-subtle p-3">
          <div
            className="font-mono-telemetry font-semibold mb-1.5"
            style={{ color: "var(--ink-muted)" }}
          >
            STAYED LOCAL ONLY (NEVER UPLOADED)
          </div>
          <p className="leading-relaxed whitespace-pre-wrap break-words">
            {rawInput}
          </p>
        </div>

        <div
          className="rounded-md border p-3"
          style={{
            backgroundColor: "var(--bg-ground)",
            borderColor: "var(--state-ondevice-border)",
          }}
        >
          <div
            className="font-mono-telemetry font-semibold mb-1.5"
            style={{ color: "var(--state-ondevice-ink)" }}
          >
            SAFE PAYLOAD (ELIGIBLE FOR CLOUD &amp; SYNC)
          </div>
          <p className="leading-relaxed whitespace-pre-wrap break-words">
            {highlightRedactions(privacyResult.sanitizedText)}
          </p>
        </div>
      </div>

      {privacyResult.redactions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {privacyResult.redactions.map((r, i) => (
            <span
              key={`${r.placeholder}-${i}`}
              className="font-mono-telemetry rounded px-2 py-0.5 text-xs border"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: "var(--border-subtle)",
                color: "var(--ink-muted)",
              }}
            >
              {r.placeholder} ({r.category})
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
