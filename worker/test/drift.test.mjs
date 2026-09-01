import assert from "node:assert";
import { test } from "node:test";
import { bucketIndex, computeDriftReport, scoreCategoricalFeature, scoreNumericFeature, severityFor } from "../src/drift.js";

test("bucketIndex: lowest value falls in bin 0 (include_lowest)", () => {
  assert.strictEqual(bucketIndex([0, 10, 20, 30], 0), 0);
});

test("bucketIndex: value on an interior edge falls in the lower bin (right-closed)", () => {
  assert.strictEqual(bucketIndex([0, 10, 20, 30], 10), 0);
  assert.strictEqual(bucketIndex([0, 10, 20, 30], 11), 1);
});

test("bucketIndex: values outside the training range clamp to the edge bins", () => {
  assert.strictEqual(bucketIndex([0, 10, 20, 30], -5), 0);
  assert.strictEqual(bucketIndex([0, 10, 20, 30], 999), 2);
});

test("scoreNumericFeature: identical distribution to baseline scores ~0", () => {
  const baseline = { bin_edges: [0, 10, 20, 30, 40], bin_proportions: [0.25, 0.25, 0.25, 0.25] };
  const values = [5, 5, 15, 15, 25, 25, 35, 35]; // evenly split across all 4 bins, like baseline
  assert.ok(scoreNumericFeature(baseline, values) < 0.01);
});

test("scoreNumericFeature: a shifted distribution scores high", () => {
  const baseline = { bin_edges: [0, 10, 20, 30, 40], bin_proportions: [0.25, 0.25, 0.25, 0.25] };
  const allInLastBin = [35, 36, 37, 38, 39, 35, 36, 37]; // baseline expects 25% here, actual is 100%
  assert.ok(scoreNumericFeature(baseline, allInLastBin) > 0.25);
});

test("scoreNumericFeature: no numeric samples scores 0 rather than throwing", () => {
  const baseline = { bin_edges: [0, 10, 20], bin_proportions: [0.5, 0.5] };
  assert.strictEqual(scoreNumericFeature(baseline, [null, undefined, "not a number"]), 0);
});

test("scoreCategoricalFeature: matching proportions score ~0", () => {
  const baseline = { PAYMENT: 0.5, TRANSFER: 0.5 };
  assert.ok(scoreCategoricalFeature(baseline, ["PAYMENT", "TRANSFER"]) < 0.01);
});

test("scoreCategoricalFeature: a category absent from training appearing now scores high", () => {
  const baseline = { PAYMENT: 1.0 };
  assert.ok(scoreCategoricalFeature(baseline, ["UNSEEN_TYPE", "UNSEEN_TYPE"]) > 0.25);
});

test("severityFor: standard PSI thresholds", () => {
  assert.strictEqual(severityFor(0.05), "LOW");
  assert.strictEqual(severityFor(0.15), "MEDIUM");
  assert.strictEqual(severityFor(0.3), "HIGH");
});

test("computeDriftReport: combines numeric + categorical scores and takes the max severity", () => {
  const baseline = {
    numeric: { amount: { bin_edges: [0, 10, 20], bin_proportions: [0.5, 0.5] } },
    categorical: { type: { PAYMENT: 1.0 } },
  };
  const samples = [
    { amount: 5, type: "UNSEEN_TYPE" },
    { amount: 5, type: "UNSEEN_TYPE" },
  ];
  const report = computeDriftReport(baseline, samples);
  assert.ok("amount" in report.scores && "type" in report.scores);
  assert.strictEqual(report.max_severity, "HIGH");
});
