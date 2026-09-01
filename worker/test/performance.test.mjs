import assert from "node:assert";
import { test } from "node:test";
import { computePerformance } from "../src/performance.js";

test("computePerformance: perfect predictions score 1.0 across the board", () => {
  const rows = [
    { prediction: 1, actual: 1 },
    { prediction: 0, actual: 0 },
    { prediction: 1, actual: 1 },
    { prediction: 0, actual: 0 },
  ];
  assert.deepStrictEqual(computePerformance(rows), { accuracy: 1, precision: 1, recall: 1, f1: 1 });
});

test("computePerformance: all wrong predictions score 0", () => {
  const rows = [
    { prediction: 1, actual: 0 },
    { prediction: 0, actual: 1 },
  ];
  const result = computePerformance(rows);
  assert.strictEqual(result.accuracy, 0);
  assert.strictEqual(result.f1, 0);
});

test("computePerformance: mixed confusion matrix computes standard metrics", () => {
  // 2 TP, 1 TN, 1 FP, 1 FN
  const rows = [
    { prediction: 1, actual: 1 },
    { prediction: 1, actual: 1 },
    { prediction: 0, actual: 0 },
    { prediction: 1, actual: 0 },
    { prediction: 0, actual: 1 },
  ];
  const result = computePerformance(rows);
  assert.strictEqual(result.accuracy, 3 / 5);
  assert.strictEqual(result.precision, 2 / 3);
  assert.strictEqual(result.recall, 2 / 3);
  assert.ok(Math.abs(result.f1 - 2 / 3) < 1e-9);
});

test("computePerformance: no rows returns zeros instead of NaN", () => {
  assert.deepStrictEqual(computePerformance([]), { accuracy: 0, precision: 0, recall: 0, f1: 0 });
});

test("computePerformance: no positive predictions avoids divide-by-zero in precision", () => {
  const rows = [
    { prediction: 0, actual: 1 },
    { prediction: 0, actual: 0 },
  ];
  const result = computePerformance(rows);
  assert.strictEqual(result.precision, 0);
  assert.strictEqual(result.f1, 0);
});
