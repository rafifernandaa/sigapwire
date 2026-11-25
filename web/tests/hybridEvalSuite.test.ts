import assert from "node:assert/strict";
import test from "node:test";
import {
  formatEvalReportMarkdown,
  runHybridCrisisEvalSuite,
} from "../src/lib/hybridEvalSuite.ts";

test("runHybridCrisisEvalSuite passes all 32 adversarial scenarios across 4 pillars", async () => {
  const report = await runHybridCrisisEvalSuite();
  assert.equal(report.totalCases, 32);
  assert.equal(report.failedCases, 0);
  assert.equal(report.passedCases, 32);
  assert.equal(report.passRatePct, 100);
  assert.equal(report.pillarSummaries.length, 4);
  for (const summary of report.pillarSummaries) {
    assert.equal(summary.passed, summary.total);
    assert.equal(summary.total, 8);
  }

  const md = formatEvalReportMarkdown(report);
  assert.ok(md.includes("# SigapWire Hybrid Crisis Readiness Evaluation Report"));
  assert.ok(md.includes("32/32 passed (100%)"));
  assert.ok(!md.includes("\u2014"));
});
