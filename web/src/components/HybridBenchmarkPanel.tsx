import { useState } from "react";
import { downloadTextFile } from "../lib/dispatchExport";
import {
  formatEvalReportMarkdown,
  runHybridCrisisEvalSuite,
  type HybridEvalReport,
} from "../lib/hybridEvalSuite";
import type { SessionAuditEvent } from "../types/sigapwire";

interface HybridBenchmarkPanelProps {
  onLogSessionEvent: (event: Omit<SessionAuditEvent, "id" | "timestamp">) => void;
}

export function HybridBenchmarkPanel({
  onLogSessionEvent,
}: HybridBenchmarkPanelProps) {
  const [report, setReport] = useState<HybridEvalReport | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [showCases, setShowCases] = useState(false);

  const handleRun = async () => {
    setIsRunning(true);
    try {
      const next = await runHybridCrisisEvalSuite();
      setReport(next);
      onLogSessionEvent({
        category: "HUMAN_GATE",
        eventType: "HYBRID_BENCHMARK_RUN",
        title: `Hybrid Crisis Readiness Benchmark (${next.passedCases}/${next.totalCases} PASS)`,
        detail: `Verified 4 pillars (Privacy, Hybrid Routing, Safety Gate, Multilingual/TTS/SHA-256 Provenance) in ${next.totalDurationMs}ms.`,
      });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <section
      aria-label="Hybrid Crisis Readiness Benchmark"
      className="rounded-lg border p-5 space-y-4"
      style={{
        backgroundColor: "var(--bg-surface)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <div
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-3 border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div>
          <h2 className="text-base font-bold">
            Hybrid Crisis Readiness Benchmark (32 Seeded Scenarios)
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
            Executes the exact 4-pillar deterministic suite from{" "}
            <code className="font-mono-telemetry">npm run eval</code> live in your browser (zero API keys, zero cloud quota) to verify privacy redaction, token routing, Safety Gate invariants, multilingual numerals, TTS WAV headers, and SHA-256 provenance seals.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleRun}
            disabled={isRunning}
            className="min-h-[44px] rounded-md px-4 text-xs font-semibold text-white disabled:opacity-60"
            style={{ backgroundColor: "var(--accent-vermilion)" }}
          >
            {isRunning
              ? "Running 32 Scenarios..."
              : report
                ? "Re-run 32-Scenario Benchmark"
                : "Run 32-Scenario Benchmark"}
          </button>

          {report ? (
            <>
              <button
                type="button"
                onClick={() =>
                  downloadTextFile(
                    "sigapwire-eval-report.md",
                    formatEvalReportMarkdown(report),
                  )
                }
                className="min-h-[44px] rounded-md border px-3 text-xs font-semibold"
                style={{
                  backgroundColor: "var(--bg-subtle)",
                  borderColor: "var(--border-strong)",
                  color: "var(--ink-primary)",
                }}
              >
                Export Report (.md)
              </button>
              <button
                type="button"
                onClick={() => setShowCases((prev) => !prev)}
                className="min-h-[44px] rounded-md border px-3 text-xs font-semibold"
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderColor: "var(--border-strong)",
                  color: "var(--ink-primary)",
                }}
              >
                {showCases ? "Hide Case Matrix" : `Inspect All ${report.totalCases} Cases`}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {report ? (
        <div aria-live="polite" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="font-mono-telemetry rounded px-2.5 py-1 text-xs font-bold border"
              style={
                report.failedCases === 0
                  ? {
                      backgroundColor: "var(--state-ondevice-bg)",
                      color: "var(--state-ondevice-ink)",
                      borderColor: "var(--state-ondevice-border)",
                    }
                  : {
                      backgroundColor: "var(--state-critical-bg)",
                      color: "var(--state-critical-ink)",
                      borderColor: "var(--state-critical-border)",
                    }
              }
            >
              {report.passedCases}/{report.totalCases} PASSED ({report.passRatePct}%) | {report.totalDurationMs}ms
            </span>
            <span
              className="font-mono-telemetry text-[11px]"
              style={{ color: "var(--ink-muted)" }}
            >
              Verified at {new Date(report.generatedAtIso).toLocaleTimeString()}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {report.pillarSummaries.map((pillar) => {
              const ok = pillar.passed === pillar.total;
              return (
                <div
                  key={pillar.pillar}
                  className="rounded-md border p-3 text-xs space-y-1"
                  style={
                    ok
                      ? {
                          backgroundColor: "var(--state-ondevice-bg)",
                          borderColor: "var(--state-ondevice-border)",
                          color: "var(--state-ondevice-ink)",
                        }
                      : {
                          backgroundColor: "var(--state-critical-bg)",
                          borderColor: "var(--state-critical-border)",
                          color: "var(--state-critical-ink)",
                        }
                  }
                >
                  <div className="font-mono-telemetry text-[11px] font-bold">
                    {pillar.passed}/{pillar.total} {ok ? "PASS" : "FAIL"}
                  </div>
                  <div className="font-semibold leading-snug">{pillar.label}</div>
                </div>
              );
            })}
          </div>

          {showCases ? (
            <div className="overflow-x-auto rounded-md border" style={{ borderColor: "var(--border-subtle)" }}>
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr style={{ backgroundColor: "var(--bg-subtle)" }}>
                    <th className="px-3 py-2 font-mono-telemetry">ID</th>
                    <th className="px-3 py-2">Scenario</th>
                    <th className="px-3 py-2 font-mono-telemetry">Result</th>
                    <th className="px-3 py-2 font-mono-telemetry">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {report.cases.map((item) => (
                    <tr
                      key={item.id}
                      className="border-t"
                      style={{ borderColor: "var(--border-subtle)" }}
                    >
                      <td className="px-3 py-2 font-mono-telemetry font-semibold whitespace-nowrap">
                        {item.id}
                      </td>
                      <td className="px-3 py-2">{item.name}</td>
                      <td className="px-3 py-2 font-mono-telemetry font-bold">
                        <span
                          style={{
                            color: item.passed
                              ? "var(--state-ondevice-ink)"
                              : "var(--state-critical-ink)",
                          }}
                        >
                          {item.passed ? "PASS" : "FAIL"}
                        </span>
                      </td>
                      <td
                        className="px-3 py-2 font-mono-telemetry text-[11px]"
                        style={{ color: "var(--ink-muted)" }}
                      >
                        {item.evidence}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
