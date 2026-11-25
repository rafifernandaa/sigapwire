import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatEvalReportMarkdown,
  runHybridCrisisEvalSuite,
} from "../src/lib/hybridEvalSuite.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const docsDir = path.join(repoRoot, "docs");
const mdPath = path.join(docsDir, "EVAL_REPORT.md");
const jsonPath = path.join(docsDir, "eval-results.json");

const report = await runHybridCrisisEvalSuite();

mkdirSync(docsDir, { recursive: true });
writeFileSync(mdPath, formatEvalReportMarkdown(report), "utf8");
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(
  `SigapWire Hybrid Crisis Readiness Benchmark: ${report.passedCases}/${report.totalCases} passed (${report.passRatePct}%) in ${report.totalDurationMs}ms`,
);
for (const p of report.pillarSummaries) {
  console.log(`  - [${p.passed === p.total ? "PASS" : "FAIL"}] ${p.label}: ${p.passed}/${p.total}`);
}
console.log(`Wrote ${path.relative(repoRoot, mdPath)} and ${path.relative(repoRoot, jsonPath)}`);

if (report.failedCases > 0) {
  process.exitCode = 1;
}
