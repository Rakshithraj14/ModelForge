import assert from "node:assert";
import { test } from "node:test";
import { buildDays, statusOf } from "./health";
import type { DriftDay, PerformanceDay } from "./schema";

const drift = (max_severity: DriftDay["max_severity"], scores: Record<string, number> = { amount: 0.05 }): DriftDay => ({
  day: "2026-01-01",
  ts: "2026-01-01T23:45:00.000Z",
  sample_size: 100,
  max_severity,
  scores,
});
const perf = (recall: number, fraud_cases: number | null): PerformanceDay => ({
  day: "2026-01-01",
  ts: "2026-01-01T23:45:00.000Z",
  sample_size: 200,
  accuracy: 0.9,
  precision: 0.5,
  recall,
  f1: 0.5,
  fraud_cases,
});

test("high drift is an alert, naming the worst feature", () => {
  const { status, reasons } = statusOf(drift("HIGH", { amount: 0.8, type: 0.3 }), null);
  assert.strictEqual(status, "alert");
  assert.match(reasons[0], /Amount drifted \(PSI 0\.80\)/);
});

test("low recall with real fraud cases is an alert, even when features look stable", () => {
  assert.strictEqual(statusOf(drift("LOW"), perf(0.13, 9)).status, "alert");
});

test("recall 0 with no fraud labeled is no signal, not a failure", () => {
  assert.strictEqual(statusOf(drift("LOW"), perf(0, 0)).status, "healthy");
  assert.strictEqual(statusOf(drift("LOW"), perf(0, null)).status, "healthy");
});

test("medium drift is watch; no reports at all is none", () => {
  assert.strictEqual(statusOf(drift("MEDIUM"), perf(0.95, 10)).status, "watch");
  assert.strictEqual(statusOf(null, null).status, "none");
});

test("buildDays fills calendar gaps so missing days stay visible", () => {
  const daily = {
    days: 365,
    drift: [
      { ...drift("LOW"), day: "2026-01-01" },
      { ...drift("LOW"), day: "2026-01-04" },
    ],
    performance: [],
    traffic: [],
  };
  const days = buildDays(daily);
  assert.deepStrictEqual(days.map((d) => d.day), ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]);
  assert.deepStrictEqual(days.map((d) => d.status), ["healthy", "none", "none", "healthy"]);
});
