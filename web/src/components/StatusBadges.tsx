import type {
  InferenceSourceLabel,
  RumorVerdict,
  SeverityLevel,
  SourcePlatform,
} from "../types/sigapwire";

export function InferenceBadge({
  source,
  latencyMs,
}: {
  source: InferenceSourceLabel;
  latencyMs?: number;
}) {
  const isLocal = source === "ON_DEVICE";
  return (
    <span
      className="font-mono-telemetry inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium border"
      style={{
        backgroundColor: isLocal
          ? "var(--state-ondevice-bg)"
          : "var(--state-cloud-bg)",
        color: isLocal ? "var(--state-ondevice-ink)" : "var(--state-cloud-ink)",
        borderColor: isLocal
          ? "var(--state-ondevice-border)"
          : "var(--state-cloud-border)",
      }}
    >
      <span>{isLocal ? "ON_DEVICE" : "IN_CLOUD"}</span>
      {typeof latencyMs === "number" && latencyMs > 0 ? (
        <span>{latencyMs}ms</span>
      ) : null}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: SeverityLevel }) {
  const palette =
    severity === "CRITICAL"
      ? {
          bg: "var(--state-critical-bg)",
          ink: "var(--state-critical-ink)",
          border: "var(--state-critical-border)",
        }
      : severity === "HIGH"
        ? {
            bg: "var(--state-warn-bg)",
            ink: "var(--state-warn-ink)",
            border: "var(--state-warn-border)",
          }
        : severity === "MEDIUM"
          ? {
              bg: "var(--state-cloud-bg)",
              ink: "var(--state-cloud-ink)",
              border: "var(--state-cloud-border)",
            }
          : {
              bg: "var(--bg-subtle)",
              ink: "var(--ink-muted)",
              border: "var(--border-subtle)",
            };

  return (
    <span
      className="font-mono-telemetry inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold border"
      style={{
        backgroundColor: palette.bg,
        color: palette.ink,
        borderColor: palette.border,
      }}
    >
      {severity}
    </span>
  );
}

export function VerdictBadge({ verdict }: { verdict: RumorVerdict }) {
  if (verdict === "NOT_APPLICABLE") return null;

  const config =
    verdict === "VERIFIED"
      ? {
          label: "VERIFIED",
          bg: "var(--state-ondevice-bg)",
          ink: "var(--state-ondevice-ink)",
          border: "var(--state-ondevice-border)",
        }
      : verdict === "MISLEADING"
        ? {
            label: "MISLEADING / HOAX",
            bg: "var(--state-critical-bg)",
            ink: "var(--state-critical-ink)",
            border: "var(--state-critical-border)",
          }
        : {
            label: "UNVERIFIED / DEVELOPING",
            bg: "var(--state-warn-bg)",
            ink: "var(--state-warn-ink)",
            border: "var(--state-warn-border)",
          };

  return (
    <span
      className="font-mono-telemetry inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold border"
      style={{
        backgroundColor: config.bg,
        color: config.ink,
        borderColor: config.border,
      }}
    >
      {config.label}
    </span>
  );
}

export function PlatformBadge({ platform }: { platform: SourcePlatform }) {
  return (
    <span
      className="font-mono-telemetry inline-flex items-center rounded px-2 py-0.5 text-xs font-medium border"
      style={{
        backgroundColor: "var(--bg-subtle)",
        color: "var(--ink-primary)",
        borderColor: "var(--border-subtle)",
      }}
    >
      {platform}
    </span>
  );
}
